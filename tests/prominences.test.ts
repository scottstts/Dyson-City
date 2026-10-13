import { describe, expect, it } from 'vitest';
import { buildProminences, eruptionAge, footprintPoint, ERUPTION_ACCELERATION, ERUPTION_DURATION, PROMINENCE_COUNT } from '../src/sky/star/prominences';

describe('prominences', () => {
  it('are deterministic, on the star, and of solar size', () => {
    expect(JSON.stringify(buildProminences(3))).toBe(JSON.stringify(buildProminences(3)));
    const ps = buildProminences();
    expect(ps.length).toBe(PROMINENCE_COUNT);
    for (const p of ps) {
      expect(Math.hypot(...p.centre)).toBeCloseTo(1, 6);
      expect(Math.abs(p.centre[0] * p.axis[0] + p.centre[1] * p.axis[1] + p.centre[2] * p.axis[2])).toBeLessThan(1e-6);
      // 40,000–140,000 km tall (star radii of 696,000 km).
      expect(p.height * 696_000).toBeGreaterThan(35_000);
      expect(p.height * 696_000).toBeLessThan(150_000);
      for (const u of [-1, 0, 1]) expect(Math.hypot(...footprintPoint(p, u))).toBeCloseTo(1, 6);
    }
  });

  it('erupt once per cycle, for a bounded time', () => {
    const p = buildProminences()[0];
    let erupting = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) if (eruptionAge(p, (i / N) * p.period) >= 0) erupting++;
    expect(erupting / N).toBeCloseTo(ERUPTION_DURATION / p.period, 2);
  });

  it('climb at physical eruption speeds (a few hundred km/s), slow on screen', () => {
    const v = ERUPTION_ACCELERATION * ERUPTION_DURATION * 696_000; // km/s at the end of an eruption
    expect(v).toBeGreaterThan(200);
    expect(v).toBeLessThan(1500);
    // At the limb (≈696,000 km away) that is a few degrees per minute at most.
    const degPerMin = ((v * 60) / 696_000) * (180 / Math.PI);
    expect(degPerMin).toBeLessThan(6);
  });
});
