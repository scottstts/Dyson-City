import { describe, expect, it } from 'vitest';
import { H } from '../src/estate/layout';
import { TestWalker } from './helpers/walker';
import { hasPack, houseWorld } from './helpers/houseWorld';

/**
 * The house's collision proves itself against what is drawn (docs/house.md "Collision"), so a hole
 * is found here, not by a player falling through it:
 *
 *  - every drawn mesh has a proxy or a geometric reason for none (blender/build/collision.py);
 *  - everywhere a walker can get to (flood-filled from the garden with the controller's own step,
 *    jump and body: doors open), no visible geometry is inside the body, and no visible surface it
 *    could step or jump onto lacks a floor (the balcony over the west porch had none: the walker
 *    fell through to the porch).
 */
const STEP = 0.45;
const JUMP = 0.78;
const R = 0.3;
/** Visible geometry closer than this to the body's axis is inside the body (the body keeps R from colliders). */
const INSIDE = 0.2;
/** Heights above the feet the body is checked at (each a sphere of INSIDE): above what a step clears, to the head (1.75). */
const BODY = [0.6, 1.0, 1.3, 1.55];
const CELL = 0.15;

interface Grid {
  cell: number;
  map: Map<number, number[]>;
}

const gkey = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);

function triGrid(T: Float32Array, cell: number): Grid {
  const map = new Map<number, number[]>();
  for (let t = 0; t < T.length / 9; t++) {
    const o = t * 9;
    const x0 = Math.min(T[o], T[o + 3], T[o + 6]), x1 = Math.max(T[o], T[o + 3], T[o + 6]);
    const z0 = Math.min(T[o + 2], T[o + 5], T[o + 8]), z1 = Math.max(T[o + 2], T[o + 5], T[o + 8]);
    for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) {
      for (let j = Math.floor(z0 / cell); j <= Math.floor(z1 / cell); j++) {
        const k = gkey(i, j);
        let l = map.get(k);
        if (!l) map.set(k, (l = []));
        l.push(t);
      }
    }
  }
  return { cell, map };
}

/** Squared distance from p to triangle t (Ericson's closest point). */
function pointTri2(T: Float32Array, t: number, px: number, py: number, pz: number): number {
  const o = t * 9;
  const ax = T[o], ay = T[o + 1], az = T[o + 2];
  const abx = T[o + 3] - ax, aby = T[o + 4] - ay, abz = T[o + 5] - az;
  const acx = T[o + 6] - ax, acy = T[o + 7] - ay, acz = T[o + 8] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  let qx: number, qy: number, qz: number;
  if (d1 <= 0 && d2 <= 0) [qx, qy, qz] = [ax, ay, az];
  else {
    const bpx = px - T[o + 3], bpy = py - T[o + 4], bpz = pz - T[o + 5];
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    const cpx = px - T[o + 6], cpy = py - T[o + 7], cpz = pz - T[o + 8];
    const d5 = abx * cpx + aby * cpy + abz * cpz;
    const d6 = acx * cpx + acy * cpy + acz * cpz;
    const vc = d1 * d4 - d3 * d2;
    const vb = d5 * d2 - d1 * d6;
    const va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) [qx, qy, qz] = [T[o + 3], T[o + 4], T[o + 5]];
    else if (d6 >= 0 && d5 <= d6) [qx, qy, qz] = [T[o + 6], T[o + 7], T[o + 8]];
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const v = d1 / (d1 - d3);
      [qx, qy, qz] = [ax + abx * v, ay + aby * v, az + abz * v];
    } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      const w = d2 / (d2 - d6);
      [qx, qy, qz] = [ax + acx * w, ay + acy * w, az + acz * w];
    } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
      [qx, qy, qz] = [T[o + 3] + (T[o + 6] - T[o + 3]) * w, T[o + 4] + (T[o + 7] - T[o + 4]) * w, T[o + 5] + (T[o + 8] - T[o + 5]) * w];
    } else {
      const den = 1 / (va + vb + vc);
      const v = vb * den;
      const w = vc * den;
      [qx, qy, qz] = [ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w];
    }
  }
  return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
}

/** Height of triangle t over (x, z) if it is up-facing and covers it, else null. */
function upHeight(T: Float32Array, t: number, x: number, z: number): number | null {
  const o = t * 9;
  const ax = T[o], ay = T[o + 1], az = T[o + 2];
  const ux = T[o + 3] - ax, uy = T[o + 4] - ay, uz = T[o + 5] - az;
  const vx = T[o + 6] - ax, vy = T[o + 7] - ay, vz = T[o + 8] - az;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz);
  if (l < 1e-12 || ny / l < 0.55) return null;
  const det = ux * vz - uz * vx;
  if (Math.abs(det) < 1e-12) return null;
  const px = x - ax, pz = z - az;
  const b = (px * vz - pz * vx) / det;
  const c = (ux * pz - uz * px) / det;
  if (b < 0 || c < 0 || b + c > 1) return null;
  return ay + uy * b + vy * c;
}

describe.skipIf(!hasPack)('house collision matches what is drawn', () => {
  const world = hasPack ? houseWorld() : null;

  it('accounts for every drawn mesh: a proxy or a reason for none', () => {
    const missing = world!.parts.flatMap((p) => p.unaccounted.map((n) => `${p.part}: ${n}`));
    expect(missing).toEqual([]);
  });

  it('lets the walker nowhere into visible geometry, and drops it through no visible floor', () => {
    const w = world!;
    for (const d of w.doors) w.walk.setDynamic(d.name, null);
    const T = w.visible;
    const grid = triGrid(T, 0.5);
    const walker = new TestWalker([w.walk, w.terrace]);
    // The house's plan, 2.5 m round it: the flood stays here.
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < T.length; i += 3) {
      x0 = Math.min(x0, T[i]);
      x1 = Math.max(x1, T[i]);
      z0 = Math.min(z0, T[i + 2]);
      z1 = Math.max(z1, T[i + 2]);
    }
    x0 -= 2.5;
    x1 += 2.5;
    z0 -= 2.5;
    z1 += 2.5;
    const near = (x: number, z: number, r: number, fn: (t: number) => boolean | void) => {
      const seen = new Set<number>();
      for (let i = Math.floor((x - r) / grid.cell); i <= Math.floor((x + r) / grid.cell); i++) {
        for (let j = Math.floor((z - r) / grid.cell); j <= Math.floor((z + r) / grid.cell); j++) {
          for (const t of grid.map.get(gkey(i, j)) ?? []) {
            if (seen.has(t)) continue;
            seen.add(t);
            if (fn(t) === true) return true;
          }
        }
      }
      return false;
    };
    const insideBody = (x: number, y: number, z: number): number => {
      let hit = -1;
      near(x, z, INSIDE, (t) => {
        for (const h of BODY) {
          if (pointTri2(T, t, x, y + h, z) < INSIDE * INSIDE) {
            hit = t;
            return true;
          }
        }
      });
      return hit;
    };
    const visibleFloor = (x: number, z: number, lo: number, hi: number): [number, number] | null => {
      let best: [number, number] | null = null;
      near(x, z, 0, (t) => {
        const y = upHeight(T, t, x, z);
        if (y !== null && y > lo && y <= hi && (!best || y > best[0])) best = [y, t];
      });
      return best;
    };
    const where = (x: number, y: number, z: number) => `(${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`;
    const failures = new Map<string, string>();
    const fail = (kind: string, t: number, x: number, y: number, z: number) => {
      const k = `${kind} ${w.material[t]} @ ${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
      if (!failures.has(k)) failures.set(k, `${kind}: ${w.material[t]} at ${where(x, y, z)}`);
    };
    // Flood fill over (plan cell, feet height).
    const [sx, sz] = H(0, 7);
    walker.place(sx, sz);
    const key = (i: number, j: number, y: number) => `${i},${j},${Math.round(y * 20)}`;
    const queue: [number, number, number][] = [[sx, walker.y, sz]];
    const visited = new Set<string>([key(Math.round(sx / CELL), Math.round(sz / CELL), walker.y)]);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    let nodes = 0;
    while (queue.length && nodes < 400_000) {
      const [x, y, z] = queue.pop()!;
      nodes++;
      const t = insideBody(x, y, z);
      if (t >= 0) fail('inside the body', t, x, y, z);
      for (const [di, dj] of dirs) {
        const tx = x + di * CELL;
        const tz = z + dj * CELL;
        if (tx < x0 || tx > x1 || tz < z0 || tz > z1) continue;
        for (const lift of [0, JUMP]) {
          const [nx, nz] = walker.walls.move(x, z, tx - x, tz - z, R, [y + lift + STEP - 0.03, y + lift + 1.75]);
          if (Math.hypot(nx - tx, nz - tz) > 1e-3) continue;
          let g = walker.ground(tx, tz, y + lift + STEP);
          if (lift > 0 && g <= y + STEP) continue;          // nothing a jump adds
          if (g < y - STEP) g = walker.ground(tx, tz, y);      // a fall: lands on what is below
          if (!Number.isFinite(g)) continue;
          // Where it lands, the walls push the body out (the controller's next frame): a spot they
          // move it from is not a place it rests.
          const [rx, rz] = walker.walls.move(tx, tz, 0, 0, R, [g + STEP - 0.03, g + 1.75]);
          if (Math.hypot(rx - tx, rz - tz) > 1e-3) continue;
          // A visible surface it would have stood on, above the floor it finds.
          const v = visibleFloor(tx, tz, g + 0.06, y + lift + STEP);
          if (v) fail('visible floor without collision', v[1], tx, v[0], tz);
          const k = key(Math.round(tx / CELL), Math.round(tz / CELL), g);
          if (visited.has(k)) continue;
          visited.add(k);
          queue.push([tx, g, tz]);
        }
      }
    }
    expect(nodes).toBeGreaterThan(5000);
    expect([...failures.values()]).toEqual([]);
  }, 600_000);
});
