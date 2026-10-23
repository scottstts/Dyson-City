/**
 * The ship's cabin for its light bake in Blender (docs/intro-ship.md, "Light"; blender/ship/bake.py).
 *
 *   node tools/run-ts.mjs tools/ship-bake/export.ts
 *
 * Writes blender/bake/ship/scene.json + scene.bin, in the ship frame (x forward, y up, z starboard;
 * Blender reads it as (x, −z, y)):
 *  - `cabin`: the cabin set (bake/cabinMesh.ts), corner order the game's;
 *  - `leaf`: the door leaf, shut (its cabin-slot faces are the leaf set), and its open offset;
 *  - `outside`: every other fixed face, an occluder (the stair is stowed in the floor and the gear
 *    is under the belly: neither stands in an opening's view);
 *  - per slot its finish (linear albedo, roughness, metalness) and any glow (game radiance);
 *  - the openings (the panes, the door), the glass's transmission, the reflection captures' boxes.
 */
import { Color } from 'three';
import fs from 'node:fs';
import path from 'node:path';
import { cornerNormals, PolyMesh, v3, type Vec3 } from '../../src/geometry/polyMesh';
import { buildShipParts } from '../../src/intro/ship/ship';
import { buildDoorLeaf, doorOffset, DOOR_TIME } from '../../src/intro/ship/door';
import { cabinFaces, fingerprint, firstCorner, slotsOf } from '../../src/intro/ship/bake/cabinMesh';
import { CABIN_CAPTURES, CABIN_BAKE } from '../../src/intro/ship/bake/spec';
import { SHIP_SLOT, SHIP_SLOTS, isCabinSlot } from '../../src/intro/ship/slots';
import { FINISH, LAMP_GLOW, LAMP_RADIANCE, SCREEN_MEAN, SCREEN_PANEL, SCREEN_RADIANCE, SPOT_GLOW, SPOT_RADIANCE } from '../../src/intro/ship/materials';
import { DOOR_OPENING, WINDOWS, type Opening } from '../../src/intro/ship/glazing';
import { GLASS } from '../../src/intro/ship/canopy';

const OUT = path.resolve('blender/bake/ship');
fs.mkdirSync(OUT, { recursive: true });

const chunks: Buffer[] = [];
let offset = 0;
const entries: Record<string, { offset: number; type: string; length: number }> = {};
function put(name: string, a: Float32Array | Uint32Array | Uint8Array): void {
  const b = Buffer.from(a.buffer, a.byteOffset, a.byteLength);
  const pad = (4 - (offset % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    offset += pad;
  }
  entries[name] = { offset, type: a.constructor.name, length: a.length };
  chunks.push(b);
  offset += b.byteLength;
}

/** One Blender object from meshes: vertices, faces (start offsets), corner indices, slots, corner normals. */
function object(name: string, meshes: PolyMesh[]): { faces: number; corners: number } {
  const verts: number[] = [];
  const starts: number[] = [0];
  const idx: number[] = [];
  const slots: number[] = [];
  const nrm: number[] = [];
  for (const m of meshes) {
    const base = verts.length / 3;
    for (const p of m.verts) verts.push(p[0], p[1], p[2]);
    const normals = cornerNormals(m);
    m.faces.forEach((f, fi) => {
      // From the canonical first corner (bake/cabinMesh.ts): the game numbers the corners so.
      const s = firstCorner(m, fi);
      for (let c = 0; c < f.length; c++) {
        const k = (s + c) % f.length;
        idx.push(base + f[k]);
        const n = normals[fi][k];
        nrm.push(n[0], n[1], n[2]);
      }
      starts.push(idx.length);
      slots.push(m.faceMat[fi]);
    });
  }
  put(`${name}.verts`, new Float32Array(verts));
  put(`${name}.starts`, new Uint32Array(starts));
  put(`${name}.corners`, new Uint32Array(idx));
  put(`${name}.slots`, new Uint8Array(slots));
  put(`${name}.normals`, new Float32Array(nrm));
  return { faces: slots.length, corners: idx.length };
}

const parts = buildShipParts();
const fixed = parts.list.map((p) => p.mesh);
const cabin = cabinFaces(fixed);
const leaf = buildDoorLeaf();
const outside = fixed.map((m) => slotsOf(m, (s) => !isCabinSlot(s))).filter((m) => m.faces.length > 0);

const objects = {
  cabin: object('cabin', cabin),
  leaf: object('leaf', leaf),
  outside: object('outside', outside),
};

const linear = (hex: string): Vec3 => {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
};
const glowOf = (hex: string, k: number): Vec3 => v3.scale(linear(hex), k);
const GLOW: Record<number, Vec3> = {
  [SHIP_SLOT.lamp]: glowOf(LAMP_GLOW, LAMP_RADIANCE),
  [SHIP_SLOT.spot]: glowOf(SPOT_GLOW, SPOT_RADIANCE),
  [SHIP_SLOT.screen]: v3.scale([...SCREEN_PANEL] as Vec3, SCREEN_RADIANCE),
  [SHIP_SLOT.display]: [0, 0, 0].map(() => SCREEN_RADIANCE * SCREEN_MEAN.display) as Vec3,
  [SHIP_SLOT.monitor]: [0, 0, 0].map(() => SCREEN_RADIANCE * SCREEN_MEAN.monitor) as Vec3,
};
const slots = Array.from({ length: SHIP_SLOTS }, (_, slot) => {
  const f = FINISH[slot];
  const name = Object.entries(SHIP_SLOT).find(([, v]) => v === slot)?.[0] ?? `slot${slot}`;
  return {
    slot,
    name,
    cabin: isCabinSlot(slot),
    albedo: f ? linear(f.hex) : [0.02, 0.02, 0.02],
    roughness: f ? f.roughness : 0.5,
    metalness: f ? f.metalness : 0,
    glow: GLOW[slot] ?? null,
  };
});

/** An opening's outline: its rounded polygon (each corner's arc in 6 steps), in the ship frame. */
function outline(o: Opening): Vec3[] {
  const pts: Vec3[] = [];
  const n = o.core.length;
  for (let i = 0; i < n; i++) {
    const p = o.core[i];
    const a = o.core[(i + n - 1) % n];
    const b = o.core[(i + 1) % n];
    // Outward normals of the edges into and out of this corner (counter-clockwise core).
    const nIn = Math.atan2(-(p[0] - a[0]), p[1] - a[1]);
    let nOut = Math.atan2(-(b[0] - p[0]), b[1] - p[1]);
    while (nOut < nIn) nOut += 2 * Math.PI;
    for (let s = 0; s <= 6; s++) {
      const t = nIn + ((nOut - nIn) * s) / 6;
      const q = [p[0] + o.r * Math.cos(t), p[1] + o.r * Math.sin(t)];
      pts.push(v3.add(o.o, v3.add(v3.scale(o.u, q[0]), v3.scale(o.v, q[1]))));
    }
  }
  return pts;
}

const openings = [...WINDOWS.map((w) => ({ kind: 'pane', w })), { kind: 'door', w: DOOR_OPENING }].map(({ kind, w }) => ({
  name: w.name,
  kind,
  n: w.n,
  d: w.d,
  outline: outline(w),
}));

const scene = {
  version: 1,
  frame: 'ship frame: x forward, y up, z starboard (metres); Blender (x, -z, y)',
  units: 'game radiance (docs/world.md)',
  fingerprint: { cabin: fingerprint(cabin), leaf: fingerprint(leaf, isCabinSlot) },
  objects,
  leafOpen: doorOffset(DOOR_TIME).offset,
  glass: { transmission: GLASS.transmission },
  slots,
  openings,
  captures: CABIN_CAPTURES,
  bake: CABIN_BAKE,
  entries,
};
fs.writeFileSync(path.join(OUT, 'scene.bin'), Buffer.concat(chunks));
fs.writeFileSync(path.join(OUT, 'scene.json'), JSON.stringify(scene, null, 1));
console.info(`${OUT}/scene.{json,bin}: cabin ${objects.cabin.faces} faces / ${objects.cabin.corners} corners, leaf ${objects.leaf.faces}, outside ${objects.outside.faces}; fingerprint ${scene.fingerprint.cabin} ${scene.fingerprint.leaf}`);
