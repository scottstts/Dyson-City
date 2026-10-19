import { describe, expect, it } from 'vitest';
import { FLOOR_NY, pushOff, SOLE, triHeight, triNy, WalkMesh } from '../src/player/walkMesh';

/**
 * Dynamic sets (door leaves) are rejected by their bounds before their triangles are tested
 * (player/walkMesh.ts). The rejection must never change a result: every query matches testing
 * every triangle of every set, in order.
 */

/** A box (half sizes hx, hy, hz) turned by `yaw` about its centre, as 12 triangles. */
function box(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw: number): Float32Array {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const corner = (i: number) => {
    const x = (i & 1 ? 1 : -1) * hx, y = (i & 2 ? 1 : -1) * hy, z = (i & 4 ? 1 : -1) * hz;
    return [cx + c * x + s * z, cy + y, cz - s * x + c * z];
  };
  const faces = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  return new Float32Array(faces.flatMap((f) => [f[0], f[1], f[2], f[0], f[2], f[3]]).flatMap(corner));
}

function heightAll(sets: Float32Array[], x: number, z: number, yMax: number): number {
  let best = -Infinity;
  for (const T of sets) {
    for (let o = 0; o < T.length; o += 9) {
      if (triNy(T, o) < FLOOR_NY) continue;
      const y = triHeight(T, o, x, z, SOLE);
      if (y !== null && y <= yMax && y > best) best = y;
    }
  }
  return best;
}

function resolveAll(sets: Float32Array[], x: number, z: number, r: number, y0: number, y1: number): [number, number] {
  let px = x, pz = z;
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    for (const T of sets) {
      for (let o = 0; o < T.length; o += 9) {
        if (triNy(T, o) >= FLOOR_NY) continue;
        const out = pushOff(T, o, px, pz, r, y0, y1);
        if (out) [px, pz, moved] = [out[0], out[1], true];
      }
    }
    if (!moved) break;
  }
  return [px, pz];
}

describe('walk mesh dynamic sets', () => {
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  it('bounds rejection matches testing every triangle', () => {
    const walk = new WalkMesh();
    const sets: Float32Array[] = [];
    for (let k = 0; k < 24; k++) {
      // Door-sized leaves (and a few slabs a walker can stand on) scattered over 30 m.
      const slab = k % 6 === 0;
      const t = slab ? box(rnd() * 30, rnd() * 3, rnd() * 30, 0.8, 0.05, 0.8, rnd() * 6.3) : box(rnd() * 30, rnd() * 4 + 1, rnd() * 30, 0.45, 1.05, 0.025, rnd() * 6.3);
      sets.push(t);
      walk.setDynamic(`set${k}`, t);
    }
    let near = 0;
    for (let q = 0; q < 20000; q++) {
      const x = rnd() * 32 - 1, z = rnd() * 32 - 1, y = rnd() * 6;
      const h = walk.height(x, z, y + 0.3);
      expect(h).toBe(heightAll(sets, x, z, y + 0.3));
      const got = walk.resolve(x, z, 0.3, y + 0.35, y + 1.7);
      const want = resolveAll(sets, x, z, 0.3, y + 0.35, y + 1.7);
      expect(got).toEqual(want);
      if (got[0] !== x || got[1] !== z || h > -Infinity) near++;
    }
    // The sample reaches the sets often enough to mean something.
    expect(near).toBeGreaterThan(300);
  });

  it('a set rewritten in place moves with its contents', () => {
    const walk = new WalkMesh();
    const t = box(0, 1, 0, 0.45, 1.05, 0.025, 0);
    walk.setDynamic('leaf', t);
    expect(walk.resolve(0, 0.1, 0.3, 0.35, 1.7)[1]).toBeGreaterThan(0.3);
    t.set(box(10, 1, 0, 0.45, 1.05, 0.025, 0));
    walk.setDynamic('leaf', t);
    expect(walk.resolve(0, 0.1, 0.3, 0.35, 1.7)).toEqual([0, 0.1]);
    expect(walk.resolve(10, 0.1, 0.3, 0.35, 1.7)[1]).toBeGreaterThan(0.3);
    walk.setDynamic('leaf', null);
    expect(walk.resolve(10, 0.1, 0.3, 0.35, 1.7)).toEqual([10, 0.1]);
  });
});
