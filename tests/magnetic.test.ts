import { describe, expect, it } from 'vitest';
import { buildRopes, MagneticState, ROPE_COUNT, ROPE_SLOTS } from '../src/sky/star/magnetic';
import { subObserverAt } from '../src/sky/star/features';

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe('prominences', () => {
  it('are deterministic, on the star, and of solar size', () => {
    expect(JSON.stringify(buildRopes(3))).toBe(JSON.stringify(buildRopes(3)));
    const ropes = buildRopes();
    expect(ropes.length).toBe(ROPE_COUNT);
    for (const r of ropes) {
      expect(Math.hypot(...r.centre)).toBeCloseTo(1, 6);
      expect(Math.abs(dot(r.centre, r.axis))).toBeLessThan(1e-6);
      // Arch height (label − depth) of 30,000–150,000 km.
      const h = (r.label - r.depth) * 696_000;
      expect(h).toBeGreaterThan(30_000);
      expect(h).toBeLessThan(150_000);
    }
  });

  it('fill their slots with ones standing near the limb', () => {
    const state = new MagneticState();
    const sub = subObserverAt(1000);
    state.update(sub);
    let filled = 0;
    for (let k = 0; k < ROPE_SLOTS; k++) {
      const v = state.ropes.values[k * 3];
      if (state.ropes.values[k * 3 + 2].y === 0) continue;
      filled++;
      const theta = Math.acos(dot([v.x, v.y, v.z], sub));
      expect(Math.abs(theta - Math.PI / 4)).toBeLessThan(0.6);
    }
    expect(filled).toBeGreaterThan(0);
  });
});
