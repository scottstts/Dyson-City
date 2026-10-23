/**
 * The cabin bake's game file (docs/intro-ship.md, "Light"): blender/bake/ship/out/ (blender/ship/bake.py)
 * packed into assets/ship-cabin.bin.
 *
 *   node tools/run-ts.mjs tools/ship-bake/pack.ts
 *
 * Layout (bake/cabinBake.ts reads it): `DCSB`, u32 version, u32 JSON length, the JSON index, then
 * 4-aligned sections:
 *  - uv.<object>: per corner of the set (bake/cabinMesh.ts order) its lightmap UV, u16 × 2
 *    normalised (0xffff × 2: no lightmap, the corner's own light instead);
 *  - vx.<object>.<set>: per corner its baked light (RGB9E5);
 *  - lm.<object>.<set>: the lightmap, RGB9E5, rows from v = 0;
 *  - refl.<set>: the reflection captures prefiltered (house/reflections.ts layout), one atlas layer
 *    per capture.
 * The sets are the game's (bake/cabinBake.ts CABIN_LIGHT): the interior's bake summed into each
 * scene's (space, band), the door's alone, and the short-range AO.
 * Everything in game radiance (white-Lambertian outgoing radiance for the light).
 */
import fs from 'node:fs';
import path from 'node:path';
import { encodeRGB9E5, prefilterCapture, REFL } from '../../src/house/reflections';
import { CABIN_BAKE_VERSION, CABIN_LIGHT, CAPTURE_SETS, type BakeObject } from '../../src/intro/ship/bake/cabinBake';

const IN = path.resolve('blender/bake/ship/out');
const OUT = path.resolve('assets/ship-cabin.bin');

/** A little-endian float32 .npy: its shape and data. */
function npy(name: string): { shape: number[]; data: Float32Array } {
  const b = fs.readFileSync(path.join(IN, name));
  if (b.toString('latin1', 1, 6) !== 'NUMPY') throw new Error(`${name}: not .npy`);
  const hl = b.readUInt16LE(8);
  const header = b.toString('latin1', 10, 10 + hl);
  if (!header.includes("'<f4'") || header.includes("'fortran_order': True")) throw new Error(`${name}: expected little-endian float32, C order`);
  const shape = header.match(/\(([^)]*)\)/)![1].split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  const start = 10 + hl;
  const copy = new Uint8Array(b.subarray(start, b.length));
  return { shape, data: new Float32Array(copy.buffer, 0, copy.length / 4) };
}

/** A game set from the baked ones: a scene's outside with the interior, or the door alone. */
function summed(set: string, read: (baked: string) => Float32Array): Float32Array {
  if (set === 'door' || set === 'ao') return read(set);
  const a = read(set);
  const b = read('interior');
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] + b[i];
  return out;
}

function rgb9e5(data: Float32Array): Uint32Array {
  const out = new Uint32Array(data.length / 3);
  for (let i = 0; i < out.length; i++) out[i] = encodeRGB9E5(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
  return out;
}

const meta = JSON.parse(fs.readFileSync(path.join(IN, 'meta.json'), 'utf8'));

/**
 * The corners of an object's set among all its corners (Blender bakes every corner of the object;
 * the set is its cabin-slot faces: bake/cabinMesh.ts).
 */
function setCorners(name: string): Uint32Array {
  const dir = path.resolve('blender/bake/ship');
  const scene = JSON.parse(fs.readFileSync(path.join(dir, 'scene.json'), 'utf8'));
  const bin = fs.readFileSync(path.join(dir, 'scene.bin'));
  const view = (e: { offset: number; length: number }, C: typeof Uint32Array | typeof Uint8Array) => new C(bin.buffer.slice(bin.byteOffset + e.offset, bin.byteOffset + e.offset + e.length * C.BYTES_PER_ELEMENT));
  const starts = view(scene.entries[`${name}.starts`], Uint32Array);
  const slots = view(scene.entries[`${name}.slots`], Uint8Array);
  const cabin = new Set((scene.slots as { slot: number; cabin: boolean }[]).filter((s) => s.cabin).map((s) => s.slot));
  const out: number[] = [];
  for (let f = 0; f < slots.length; f++) if (cabin.has(slots[f])) for (let k = starts[f]; k < starts[f + 1]; k++) out.push(k);
  return new Uint32Array(out);
}

const pick = (a: Float32Array, idx: Uint32Array, size: number) => {
  const out = new Float32Array(idx.length * size);
  idx.forEach((k, i) => out.set(a.subarray(k * size, (k + 1) * size), i * size));
  return out;
};
const sections: Buffer[] = [];
const index: Record<string, { offset: number; length: number }> = {};
let size = 0;
function put(name: string, a: Uint32Array | Uint16Array): void {
  const b = Buffer.from(a.buffer, a.byteOffset, a.byteLength);
  const pad = (4 - (b.byteLength % 4)) % 4;
  index[name] = { offset: size, length: a.length };
  sections.push(b, Buffer.alloc(pad));
  size += b.byteLength + pad;
}

const objects: Record<string, { atlas: number; sets: readonly string[]; corners: number }> = {};
for (const [name, o] of Object.entries(meta.objects) as [BakeObject, { atlas: number; sets: string[] }][]) {
  const sel = setCorners(name);
  const uv = pick(npy(`uv_${name}.npy`).data, sel, 2);
  const corners = sel.length;
  const q = new Uint16Array(corners * 2);
  for (let i = 0; i < corners * 2; i++) q[i] = uv[i] < 0 ? 0xffff : Math.min(Math.round(uv[i] * 0xfffe), 0xfffe);
  put(`uv.${name}`, q);
  for (const set of CABIN_LIGHT[name]) {
    const lm = summed(set, (b) => {
      const a = npy(`lm_${name}_${b}.npy`);
      if (a.shape[0] !== o.atlas || a.shape[1] !== o.atlas) throw new Error(`lm_${name}_${b}: shape ${a.shape}`);
      return a.data;
    });
    put(`lm.${name}.${set}`, rgb9e5(lm));
    const vx = summed(set, (b) => {
      const a = npy(`vx_${name}_${b}.npy`);
      if (a.shape[0] * 2 !== npy(`uv_${name}.npy`).data.length) throw new Error(`vx_${name}_${b}: ${a.shape[0]} corners, the UVs another`);
      return pick(a.data, sel, 3);
    });
    put(`vx.${name}.${set}`, rgb9e5(vx));
  }
  objects[name] = { atlas: o.atlas, sets: CABIN_LIGHT[name], corners };
}

const captures = meta.captures as { name: string }[];
const reflSets = CAPTURE_SETS;
for (const set of reflSets) {
  const layers = new Uint32Array(REFL.atlasW * REFL.atlasH * captures.length);
  captures.forEach((c, i) => {
    const w = REFL.width;
    const h = REFL.height;
    const data = summed(set, (b) => {
      const cap = npy(`cap_${b}_${c.name}.npy`);
      if (cap.shape[1] !== w || cap.shape[0] !== h) throw new Error(`cap_${b}_${c.name}: ${cap.shape}`);
      return cap.data;
    });
    // Blender's rows run from the bottom; the captures' from the top (house/reflections.ts).
    const top = new Float32Array(data.length);
    for (let j = 0; j < h; j++) top.set(data.subarray((h - 1 - j) * w * 3, (h - j) * w * 3), j * w * 3);
    prefilterCapture(rgb9e5(top), layers.subarray(i * REFL.atlasW * REFL.atlasH, (i + 1) * REFL.atlasW * REFL.atlasH));
  });
  put(`refl.${set}`, layers);
}

const json = Buffer.from(
  JSON.stringify({
    fingerprint: meta.fingerprint,
    tag: meta.tag,
    objects,
    captures: meta.captures,
    reflSets,
    sections: index,
  }),
);
const head = Buffer.alloc(12);
head.write('DCSB', 0, 'ascii');
head.writeUInt32LE(CABIN_BAKE_VERSION, 4);
head.writeUInt32LE(json.length, 8);
const pad = (4 - ((12 + json.length) % 4)) % 4;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([head, json, Buffer.alloc(pad), ...sections]));
console.info(`${OUT}: ${((12 + json.length + pad + size) / 1e6).toFixed(1)} MB (${meta.tag}); fingerprint ${meta.fingerprint.cabin} ${meta.fingerprint.leaf}`);
