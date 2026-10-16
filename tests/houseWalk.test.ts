import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { Matrix4, Vector3, Quaternion } from 'three';
import { compilePart } from '../src/house/compile';
import { ProbeGrid } from '../src/house/probeGrid';
import { WalkMesh } from '../src/player/walkMesh';
import { H, HOUSE_F, HOUSE_FOOTPRINT } from '../src/estate/layout';
import { inside } from '../src/estate/sdf2';
import { HOUSE_GRADE } from '../src/estate/levels';
import { HOUSE_SITE } from '../src/field/layout';
import { TestWalker } from './helpers/walker';
import { estateGeometry, estateWalk } from '../src/estate/build';
import { HouseFloors } from '../src/house/floors';
import { roomOf } from '../src/house/rooms';

/**
 * Walking into and through the house on its collision proxies (blender/docs/house.md "Collision"),
 * placed as the game places it. Skipped when the pack has not been exported.
 */
const PACK = new URL('../assets/house.pack', import.meta.url);
const has = fs.existsSync(PACK);

describe.skipIf(!has)('walking the house', () => {
  const buf = has ? fs.readFileSync(PACK) : null;
  const len = buf ? buf.readUInt32LE(8) : 0;
  const index = buf ? JSON.parse(buf.toString('utf8', 12, 12 + len)) : { entries: [] };
  const by = new Map<string, { offset: number; length: number; [k: string]: unknown }>(index.entries.map((e: { name: string }) => [e.name, e]));
  const slice = (n: string) => {
    const e = by.get(n)!;
    return buf!.buffer.slice(buf!.byteOffset + e.offset, buf!.byteOffset + e.offset + e.length) as ArrayBuffer;
  };
  const pe = by.get('probes') as unknown as { points: [number, number, number, number, number][]; rooms: string[] };
  const boxes = index.entries.filter((e: { name: string }) => e.name.startsWith('refl_')).map((e: { room: string; level: number; box: never; position: never }) => ({ name: e.room, level: e.level, box: e.box, position: e.position }));
  const grid = has ? new ProbeGrid({ coefficients: new Float32Array(slice('probes')), points: pe.points, rooms: pe.rooms, boxes }) : null;
  const root = new Matrix4().compose(new Vector3(HOUSE_SITE[0], HOUSE_GRADE, HOUSE_SITE[1]), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(HOUSE_F[0], HOUSE_F[1])), new Vector3(1, 1, 1));
  const walk = new WalkMesh();
  const terrace = estateWalk(estateGeometry());
  const doors: { name: string; tris: Float32Array }[] = [];
  const floors = new HouseFloors();
  const markers: { name: string; position: [number, number, number] }[] = [];
  const v = new Vector3();
  for (const part of has ? ['exterior', 'G', 'L1'] : []) {
    const doc = JSON.parse(new TextDecoder().decode(slice(`house_${part}.gltf`)));
    const c = compilePart(part, doc, slice(`house_${part}.bin`), grid!);
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
  }
  const shutAll = () => doors.forEach((d) => walk.setDynamic(d.name, d.tris));
  const openAll = () => doors.forEach((d) => walk.setDynamic(d.name, null));
  const toHouse = new Vector3(-HOUSE_F[0], 0, -HOUSE_F[1]);
  const local = (w: { x: number; y: number; z: number }) => new Vector3(w.x, w.y, w.z).applyMatrix4(root.clone().invert());
  const underfoot = (w: { x: number; y: number; z: number }) => {
    const p = local(w);
    return floors.at(p.x, p.y, p.z);
  };
  /** Walks in quarter-metre steps, listing the surfaces met underfoot in order. */
  const along = (w: TestWalker, dx: number, dz: number, dist: number) => {
    const seen: string[] = [];
    for (let d = 0; d < dist; d += 0.25) {
      w.walk(dx, dz, 0.25);
      const s = underfoot(w) ?? 'off';
      if (seen.at(-1) !== s) seen.push(s);
    }
    return seen;
  };
  const walker = () => {
    const [x, z] = H(0, 7);
    return new TestWalker([walk, terrace]).place(x, z);
  };

  it('climbs the porch steps and is stopped by the shut front door', () => {
    shutAll();
    const w = walker();
    const seen = along(w, toHouse.x, toHouse.z, 8);
    expect(w.y).toBeGreaterThan(HOUSE_GRADE + 0.85);
    // Stopped at the door: still on the porch, in front of the house's front wall.
    expect(local(w).z).toBeGreaterThan(0);
    // Underfoot (footsteps): off the house, up its stone steps, across the porch's boards to the door's mat.
    expect(seen.join(' ')).toBe('off stone boards rug');
  });

  it('walks through the open door into the hall, on the ground floor', () => {
    openAll();
    const w = walker();
    const seen = along(w, toHouse.x, toHouse.z, 12);
    expect(local(w).z).toBeLessThan(-3);
    expect(w.y).toBeCloseTo(HOUSE_GRADE + 1.05, 2);
    // Steps, porch boards, the coir mat, the oak threshold, the vestibule's mat and tiles, the hall's boards and runner.
    expect(seen.join(' ')).toBe('off stone boards rug wood rug stone wood rug');
  });

  it('climbs the west porch steps (they walk as their own mesh) onto its deck', () => {
    const [x, z] = H(-16.6, 0.3);
    const [ex, ez] = H(1, 0.3);
    const [ox, oz] = H(0, 0.3);
    const w = new TestWalker([walk, terrace]).place(x, z);
    const seen = along(w, ex - ox, ez - oz, 4.5);
    expect(local(w).x).toBeGreaterThan(-12.5);
    expect(w.y).toBeCloseTo(HOUSE_GRADE + 0.9, 1);
    expect(seen.join(' ')).toBe('off stone boards');
  });

  it('never slips past a flight or its cheeks into the void under a deck', () => {
    // Every flight approached from an arc of directions and offsets, up to the deck and on: the
    // walker must never stand under a deck (a floor overhead, at grade within the porches' plan).
    // The cheeks and skirts had no proxies, and a 2 cm crack between the deck and its top step
    // let a walker drop through the deck; both left it trapped under the porch.
    const decks = HOUSE_FOOTPRINT.slice(1);
    const under = (w: TestWalker) => {
      const q = local(w);
      return decks.some((p) => inside(p, q.x, q.z)) && walk.height(w.x, w.z, w.y + 3) - w.y > 0.3;
    };
    // Foot of each flight (house frame) and the direction up it.
    const flights: [string, number, number, number, number][] = [
      ['front', 0, 5.89, 0, -1],
      ['west', -15.09, 0.3, 1, 0],
      ['rear', 1.1, -16.09, 0, 1],
    ];
    const [ox, oz] = H(0, 0);
    for (const [name, fx, fz, ux, uz] of flights) {
      for (let a = -80; a <= 80; a += 10) {
        const s = Math.sin((a * Math.PI) / 180);
        const c = Math.cos((a * Math.PI) / 180);
        // Up the flight turned by a (house frame), from 7 m out along the reverse.
        const dx = ux * c - uz * s;
        const dz = uz * c + ux * s;
        for (const off of [-1.4, -0.8, 0, 0.8, 1.4]) {
          const sx = fx - dx * 7 - uz * off;
          const sz = fz - dz * 7 + ux * off;
          const w = new TestWalker([walk, terrace]).place(...H(sx, sz));
          const [ex, ez] = H(dx, dz);
          for (let k = 0; k < 220; k++) {
            w.walk(ex - ox, ez - oz, 0.05);
            expect(under(w), `${name} flight, from (${sx.toFixed(1)}, ${sz.toFixed(1)}) at ${a}°: under the deck at ${local(w).toArray().map((n) => n.toFixed(2))}`).toBe(false);
          }
        }
      }
    }
  });

  it('lands on the porch deck from a fall, never through it', () => {
    // From 0.5–4 m above the deck (8.9 m/s at the end of the longest): each frame's drop is swept.
    for (const h of [0.5, 1, 2, 3, 4]) {
      for (const [x, z] of [[0, 3], [-1, 2.5], [8.5, -1], [-0.8, 4.41]]) {
        const w = new TestWalker([walk, terrace]).place(...H(x, z), HOUSE_GRADE + 1.2);
        w.y += h;
        w.drop();
        expect(w.y - HOUSE_GRADE, `fell ${h} m at (${x}, ${z})`).toBeCloseTo(0.9, 2);
      }
    }
  });

  it('places each sound in its room, whose reverb it feeds (docs/audio.md "The house")', () => {
    // Marker positions are house frame (glTF); rooms are Blender axes: (x, −z, y).
    const room = (name: string) => {
      const m = markers.find((k) => k.name === name)!;
      return roomOf(boxes, m.position[0], -m.position[2], m.position[1]);
    };
    expect(room('Sound_Kitchen_Kettle')).toBe('Kitchen');
    expect(room('Sound_Hall_Clock')).toBe('Hall');
    expect(room('Sound_Parlour_Clock')).toBe('Parlour');
    // On the porch, outdoors: no room.
    expect(roomOf(boxes, 0, -3, 1.5)).toBe(null);
  });

  it('climbs the main stair to the first floor', () => {
    openAll();
    // From the hall behind the stair's foot, up it toward the front.
    const [x, z] = H(1.47, -9.0);
    const w = new TestWalker([walk, terrace]).place(x, z, HOUSE_GRADE + 1.5);
    const seen = along(w, HOUSE_F[0], HOUSE_F[1], 8.5);
    expect(w.y, `stopped at ${local(w).toArray().map((n) => n.toFixed(2))}`).toBeCloseTo(HOUSE_GRADE + 5.25, 1);
    // Oak treads beside the runner, then the landing's boards.
    expect(seen.join(' ')).toBe('wood');
  });
});
