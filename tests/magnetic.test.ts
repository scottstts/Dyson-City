import { describe, expect, it } from 'vitest';
import { buildRopes, eruptionLift, jetEvent, jetHead, jetLifetime, ERUPTION_DURATION, KM, ROPE_COUNT } from '../src/sky/star/magnetic';
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

  it('erupt at energetic but solar speeds and leave the limb within the eruption', () => {
    const v = (8 * KM * ERUPTION_DURATION) / KM; // km/s at the end
    expect(v).toBeGreaterThan(1000);
    expect(v).toBeLessThan(3000);
    expect(eruptionLift(ERUPTION_DURATION)).toBeGreaterThan(0.2);
    expect(eruptionLift(-1)).toBe(0);
  });
});

describe('jets', () => {
  it('start near the limb as seen at launch, rise and fall back within their life', () => {
    for (let k = 1; k < 40; k++) {
      const j = jetEvent(k);
      const theta = Math.acos(dot(j.site, subObserverAt(j.start)));
      expect(Math.abs(theta - Math.PI / 4)).toBeLessThan(0.25);
      const apex = j.speed / j.decel;
      expect(jetHead(j, apex)).toBeGreaterThan(jetHead(j, apex * 0.5));
      expect(jetHead(j, 2 * apex)).toBeCloseTo(0, 9);
      expect(jetLifetime(j)).toBeGreaterThan(2 * apex);
      // Launch speeds of 500–1,400 km/s.
      expect(j.speed / KM).toBeGreaterThan(450);
      expect(j.speed / KM).toBeLessThan(1500);
    }
  });
});
