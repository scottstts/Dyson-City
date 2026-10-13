import { describe, expect, it } from 'vitest';
import { groundHeight, deckHeight, PAD_HEIGHT, PAD_OUTER_RADIUS, SITE } from '../src/ground/site';
import { platformProfile, createPlatformGeometry, createDeckGeometry } from '../src/ground/geometry';

describe('site surface', () => {
  it('the platform top is flat at 1.2 m', () => {
    expect(PAD_HEIGHT).toBeCloseTo(1.2);
    expect(groundHeight(0, 0)).toBeCloseTo(1.2);
    expect(groundHeight(350, -350)).toBeCloseTo(1.2);
  });

  it('steps down in walkable 0.4 m treads to the deck', () => {
    expect(groundHeight(SITE.padRadius + 0.6, 0)).toBeCloseTo(0.8);
    expect(groundHeight(SITE.padRadius + 1.8, 0)).toBeCloseTo(0.4);
    expect(groundHeight(PAD_OUTER_RADIUS + 1, 0)).toBeCloseTo(deckHeight(PAD_OUTER_RADIUS + 1), 6);
  });

  it('the deck follows the concave shell (rises with distance, millimetres near the city)', () => {
    expect(deckHeight(1000)).toBeGreaterThan(0);
    expect(deckHeight(1000)).toBeLessThan(0.001);
    expect(deckHeight(15000)).toBeCloseTo(15000 ** 2 / (2 * 984_000_000), 6);
  });
});

describe('platform geometry', () => {
  it('profile strips meet without gaps and end below the deck', () => {
    const strips = platformProfile();
    for (let i = 1; i < strips.length; i++) {
      const prev = strips[i - 1][strips[i - 1].length - 1];
      const first = strips[i][0];
      expect(first.r).toBeCloseTo(prev.r, 9);
      expect(first.y).toBeCloseTo(prev.y, 9);
    }
    const last = strips[strips.length - 1];
    expect(last[last.length - 1].y).toBeLessThan(0);
  });

  it('emits finite, unit normals and non-degenerate up-facing top triangles', () => {
    const g = createPlatformGeometry(256);
    const n = g.getAttribute('normal').array as Float32Array;
    for (let i = 0; i < n.length; i += 3) {
      const l = Math.hypot(n[i], n[i + 1], n[i + 2]);
      expect(Number.isFinite(l)).toBe(true);
      expect(l).toBeCloseTo(1, 4);
    }
    const p = g.getAttribute('position').array as Float32Array;
    const idx = g.getIndex()!.array;
    // First strip (the top) must face up.
    for (let t = 0; t < 600; t += 3) {
      const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const ny = uz * vx - ux * vz;
      expect(ny).toBeGreaterThan(0);
      expect(Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx)).toBeGreaterThan(0);
    }
  });

  it('the deck tucks under the bottom step (no crack, no overlap with the treads)', () => {
    const g = createDeckGeometry(4, 64);
    const p = g.getAttribute('position').array as Float32Array;
    let minR = Infinity;
    for (let i = 0; i < p.length; i += 3) minR = Math.min(minR, Math.hypot(p[i], p[i + 2]));
    expect(minR).toBeLessThan(PAD_OUTER_RADIUS);
    expect(minR).toBeGreaterThan(PAD_OUTER_RADIUS - SITE.stepTread);
  });
});
