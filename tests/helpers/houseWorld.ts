/**
 * The house as the game places it, read from `assets/house.pack` for tests: every part compiled,
 * its collision proxies in a walk mesh (world space), the terrace round it, the door leaves' shut
 * boxes, what is underfoot, the markers, and the visible triangles (world space, door leaves
 * excluded: they swing). `has` is false when the pack has not been exported.
 */
import fs from 'node:fs';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { compilePart, type CompiledPart } from '../../src/house/compile';
import { ProbeGrid } from '../../src/house/probeGrid';
import { WalkMesh } from '../../src/player/walkMesh';
import { HOUSE_F } from '../../src/estate/layout';
import { HOUSE_GRADE } from '../../src/estate/levels';
import { HOUSE_SITE } from '../../src/field/layout';
import { estateGeometry, estateWalk } from '../../src/estate/build';
import { HouseFloors } from '../../src/house/floors';

const PACK = new URL('../../assets/house.pack', import.meta.url);
export const hasPack = fs.existsSync(PACK);

export interface RoomBox {
  name: string;
  level: number;
  box: [number, number, number, number, number, number];
  position: [number, number, number];
}

export interface HouseWorld {
  root: Matrix4;
  walk: WalkMesh;
  terrace: WalkMesh;
  doors: { name: string; tris: Float32Array }[];
  floors: HouseFloors;
  markers: { name: string; position: [number, number, number] }[];
  boxes: RoomBox[];
  parts: CompiledPart[];
  /** Visible triangles (world, 9 floats each) and each one's material name. */
  visible: Float32Array;
  material: string[];
  index: { lamps?: Record<string, { radiance: [number, number, number] }>; entries: { name: string }[] };
}

let cached: HouseWorld | null = null;

export function houseWorld(): HouseWorld {
  if (cached) return cached;
  const buf = fs.readFileSync(PACK);
  const len = buf.readUInt32LE(8);
  const index = JSON.parse(buf.toString('utf8', 12, 12 + len));
  const by = new Map<string, { offset: number; length: number; [k: string]: unknown }>(index.entries.map((e: { name: string }) => [e.name, e]));
  const slice = (n: string) => {
    const e = by.get(n)!;
    return buf.buffer.slice(buf.byteOffset + e.offset, buf.byteOffset + e.offset + e.length) as ArrayBuffer;
  };
  const pe = by.get('probes') as unknown as { points: [number, number, number, number, number][]; rooms: string[] };
  const boxes = index.entries.filter((e: { name: string }) => e.name.startsWith('refl_')).map((e: { room: string; level: number; box: never; position: never }) => ({ name: e.room, level: e.level, box: e.box, position: e.position }));
  const grid = new ProbeGrid({ coefficients: new Float32Array(slice('probes')), points: pe.points, rooms: pe.rooms, boxes });
  const root = new Matrix4().compose(new Vector3(HOUSE_SITE[0], HOUSE_GRADE, HOUSE_SITE[1]), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(HOUSE_F[0], HOUSE_F[1])), new Vector3(1, 1, 1));
  const walk = new WalkMesh();
  const terrace = estateWalk(estateGeometry());
  const doors: { name: string; tris: Float32Array }[] = [];
  const floors = new HouseFloors();
  const markers: { name: string; position: [number, number, number] }[] = [];
  const parts: CompiledPart[] = [];
  const vis: number[] = [];
  const material: string[] = [];
  const v = new Vector3();
  for (const part of ['exterior', 'G', 'L1', 'L2']) {
    const doc = JSON.parse(new TextDecoder().decode(slice(`house_${part}.gltf`)));
    const c = compilePart(part, doc, slice(`house_${part}.bin`), grid);
    parts.push(c);
    floors.add(c.floors);
    markers.push(...c.markers);
    for (const m of c.collision) {
      const w = new Float32Array(m.position.length);
      for (let i = 0; i < w.length; i += 3) {
        v.set(m.position[i], m.position[i + 1], m.position[i + 2]).applyMatrix4(root);
        w[i] = v.x;
        w[i + 1] = v.y;
        w[i + 2] = v.z;
      }
      walk.add(w, m.index);
    }
    // Door leaves shut, as moving walls (their boxes in the rig frame at angle 0).
    for (const d of c.doors) {
      if (!d.box) continue;
      const rig = new Matrix4().fromArray(d.rig);
      const shut = new Vector3(d.translation[0] - (d.kind === 'slide' ? d.rest : 0), d.translation[1], d.translation[2]);
      const m = root.clone().multiply(rig).multiply(new Matrix4().makeTranslation(shut.x, shut.y, shut.z));
      const b = d.box;
      const corner = (i: number) => new Vector3(i & 1 ? b[3] : b[0], i & 2 ? b[4] : b[1], i & 4 ? b[5] : b[2]).applyMatrix4(m);
      const faces = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
      const tris: number[] = [];
      for (const f of faces) for (const t of [[f[0], f[1], f[2]], [f[0], f[2], f[3]]]) for (const k of t) tris.push(...corner(k).toArray());
      doors.push({ name: d.name, tris: Float32Array.from(tris) });
    }
    for (const g of c.groups) {
      const name = doc.materials[g.material]?.name ?? String(g.material);
      for (let t = 0; t < g.index.length; t += 3) {
        for (let k = 0; k < 3; k++) {
          const i = g.index[t + k] * 3;
          v.set(g.position[i], g.position[i + 1], g.position[i + 2]).applyMatrix4(root);
          vis.push(v.x, v.y, v.z);
        }
        material.push(name);
      }
    }
  }
  cached = { root, walk, terrace, doors, floors, markers, boxes, parts, visible: Float32Array.from(vis), material, index };
  return cached;
}
