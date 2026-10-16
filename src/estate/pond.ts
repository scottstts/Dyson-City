/**
 * The lily pool in the pond garden (city_plan §4: "a lily pond (the Dome's air is 1 bar and
 * humid)"; docs/estate.md "Pond"): a stadium-shaped basin with a limestone coping whose rounded
 * nosing overhangs the water, the water 16 cm below the coping, lily pads and a few flowers.
 *
 * The basin is a closed wall ring and a floor slab under the water; the water surface is its own
 * mesh (water.ts material). Pads are instanced.
 */
import { Matrix4, Quaternion, Vector3 } from 'three/webgpu';
import { PolyMesh, type Vec2, type Vec3 } from '../geometry/polyMesh';
import { extrudeBevel, lathe } from '../geometry/solids';
import { Parts, rng } from '../field/kit/parts';
import { POOL, TERRACE_Y } from './layout';
import { densify, runSweep, upright } from './kit';
import { ESTATE_SLOT } from './materials/materials';
import type { V2 } from './sdf2';

const T = TERRACE_Y;

export const POND = {
  /** Water level and the basin's floor. */
  water: T - 0.1,
  floor: T - 0.9,
  coping: { top: T + 0.06, out: 0.36, over: 0.06 },
} as const;

/** The pool's outline (a stadium), anticlockwise in plan (x right, z down). */
export function poolOutline(grow = 0, step = 0.15): V2[] {
  const r = POOL.hz + grow;
  const l = POOL.hx - POOL.hz;
  const pts: V2[] = [];
  const arc = (cx: number, a0: number) => {
    const n = Math.max(8, Math.ceil((Math.PI * r) / step));
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i / n) * Math.PI;
      pts.push([cx + Math.cos(a) * r, POOL.z + Math.sin(a) * r]);
    }
  };
  arc(POOL.x + l, -Math.PI / 2);
  arc(POOL.x - l, Math.PI / 2);
  return densify(pts, step, true);
}

export interface Pond {
  parts: Parts;
  /** Water surface outline (inside the coping's nosing). */
  water: V2[];
  pads: Matrix4[];
  flowers: Matrix4[];
}

export function buildPond(): Pond {
  const parts = new Parts('estate:pond');
  const c = POND.coping;
  // The coping runs round the pool's outline; b is outward from the water. The outline turns
  // anticlockwise (x right, z down), so its left is the water: run it backwards.
  const path = poolOutline(0, 0.12).reverse();
  const prof: Vec2[] = [
    [-c.over, T - 0.04],
    [0.02, T - 0.04],
    [0.02, T - 0.12],
    [c.out, T - 0.12],
    [c.out, T + 0.02],
    [c.out - 0.02, c.top],
    [0.02, c.top],
  ];
  // Rounded nosing over the water.
  for (let i = 1; i <= 5; i++) {
    const a = Math.PI / 2 + (i / 6) * Math.PI;
    prof.push([-c.over + 0.05 + Math.cos(a) * 0.05, T + 0.01 + Math.sin(a) * 0.05]);
  }
  parts.add('coping', runSweep(path, { pts: orient(prof) }, { closed: true, slot: ESTATE_SLOT.limestone }));
  // Basin walls: from the floor up under the coping (0.25 thick behind the water's edge).
  const wall: Vec2[] = [
    [-0.0, POND.floor - 0.08],
    [0.26, POND.floor - 0.08],
    [0.26, T - 0.125],
    [0.0, T - 0.125],
  ];
  parts.add('basin', runSweep(path, { pts: orient(wall) }, { closed: true, slot: ESTATE_SLOT.sandstone }));
  // The floor, under the water, inside the walls.
  const floorOutline = poolOutline(-0.02, 0.3).map(([x, z]) => [x - POOL.x, z - POOL.z] as Vec2);
  parts.add('floor', extrudeBevel(floorOutline, { o: [POOL.x, 0, POOL.z], u: [1, 0, 0], v: [0, 0, 1], w: [0, -1, 0] }, -(POND.floor), -(POND.floor - 0.1), 0, ESTATE_SLOT.sandstone));
  // Pads in a few drifts, never in the middle of the water's reflection or against the coping.
  const rand = rng(7331);
  const pads: Matrix4[] = [];
  const flowers: Matrix4[] = [];
  const drifts: [number, number, number][] = [
    [POOL.x - POOL.hx + 2.4, POOL.z - 0.6, 1.5],
    [POOL.x + POOL.hx - 2.1, POOL.z + 0.9, 1.3],
    [POOL.x + 1.4, POOL.z - 1.7, 0.9],
  ];
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const placed: [number, number, number][] = [];
  for (const [dx, dz, r] of drifts) {
    for (let k = 0; k < 40; k++) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * r;
      const x = dx + Math.cos(a) * d;
      const z = dz + Math.sin(a) * d;
      const s = 0.1 + rand() * 0.11;
      // Inside the water by a margin, and not overlapping another pad.
      if (stadiumDistance(x, z) > -s - 0.12) continue;
      if (placed.some(([px, pz, ps]) => Math.hypot(px - x, pz - z) < (ps + s) * 1.02)) continue;
      placed.push([x, z, s]);
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      pads.push(new Matrix4().compose(new Vector3(x, POND.water + 0.004 + (placed.length % 7) * 0.0008, z), q.clone(), new Vector3(s, 1, s)));
      if (rand() < 0.12) flowers.push(new Matrix4().compose(new Vector3(x + s * 0.2, POND.water + 0.01, z), q.clone(), new Vector3(1, 1, 1)));
    }
  }
  return { parts, water: poolOutline(c.over * 0.2, 0.15), pads, flowers };
}

/** Signed distance to the pool's outline (negative over the water). */
export function stadiumDistance(x: number, z: number): number {
  const l = POOL.hx - POOL.hz;
  const dx = Math.max(Math.abs(x - POOL.x) - l, 0);
  return Math.hypot(dx, z - POOL.z) - POOL.hz;
}

/** Profiles here are written outward-first; make them anticlockwise in (b, y). */
function orient(p: Vec2[]): Vec2[] {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % p.length];
    a += x0 * y1 - x1 * y0;
  }
  return a >= 0 ? p : [...p].reverse();
}

/** A lily pad: a thin disc (radius 1, scaled per instance) with its notch and a slightly turned-up rim. */
export function padMesh(): PolyMesh {
  const m = new PolyMesh(50);
  const n = 28;
  const notch = 0.22;
  const ring = (r: number, y: number): number[] => {
    const ids: number[] = [];
    for (let i = 0; i <= n; i++) {
      const a = notch / 2 + (i / n) * (Math.PI * 2 - notch);
      ids.push(m.vert([Math.cos(a) * r, y, Math.sin(a) * r] as Vec3));
    }
    return ids;
  };
  const centre = m.vert([0, 0.006, 0]);
  const centreB = m.vert([0, 0, 0]);
  const top = ring(1, 0.012);
  const bottom = ring(1, 0.0);
  for (let i = 0; i < n; i++) {
    m.face([centre, top[i + 1], top[i]], 0);
    m.face([centreB, bottom[i], bottom[i + 1]], 0);
    m.face([top[i], top[i + 1], bottom[i + 1], bottom[i]], 0);
  }
  // The notch's two straight edges.
  m.face([centre, top[0], bottom[0], centreB], 0);
  m.face([centre, centreB, bottom[n], top[n]], 0);
  return m;
}

/** A water lily flower: two rings of pointed petals round a yellow centre (turned, then shaped). */
export function lilyMesh(): PolyMesh {
  const prof: Vec2[] = [
    [0, 0],
    [0.03, 0.005],
    [0.075, 0.03],
    [0.09, 0.06],
    [0.07, 0.08],
    [0.035, 0.07],
    [0.02, 0.055],
    [0, 0.05],
  ];
  return lathe(prof, 16, upright(), 0, 60);
}
