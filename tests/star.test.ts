import { describe, expect, it } from 'vitest';
import { buildStarCatalogue, flareEnvelope, flareEvent, MAX_REGIONS, MAX_SPOTS } from '../src/sky/star/features';

describe('star catalogue', () => {
  it('is deterministic for a seed', () => {
    expect(JSON.stringify(buildStarCatalogue(5))).toBe(JSON.stringify(buildStarCatalogue(5)));
    expect(JSON.stringify(buildStarCatalogue(5))).not.toBe(JSON.stringify(buildStarCatalogue(6)));
  });
  it('fits the shader uniform budgets with unit directions', () => {
    const c = buildStarCatalogue();
    expect(c.spots.length).toBeLessThanOrEqual(MAX_SPOTS);
    expect(c.regions.length).toBeLessThanOrEqual(MAX_REGIONS);
    for (const s of c.spots) {
      expect(Math.hypot(...s.dir)).toBeCloseTo(1, 6);
      expect(s.umbraRatio).toBeLessThan(1);
    }
  });
});

describe('flares', () => {
  it('rise smoothly and decay', () => {
    const f = flareEvent(3, 20);
    expect(flareEnvelope(f, f.start - 1)).toBe(0);
    expect(flareEnvelope(f, f.start + f.rise)).toBeCloseTo(1, 6);
    expect(flareEnvelope(f, f.start + f.rise + f.decay * 3)).toBeLessThan(0.06);
  });
});
