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
    const f = flareEvent(3, buildStarCatalogue().regions);
    expect(flareEnvelope(f, f.start - 1)).toBe(0);
    expect(flareEnvelope(f, f.start + f.rise)).toBeCloseTo(1, 6);
    expect(flareEnvelope(f, f.start + f.rise + f.decay * 3)).toBeLessThan(0.06);
  });
});

describe('flare bursts and echoes', () => {
  it('bursts spike on top of the smooth envelope during the rise', async () => {
    const { flareBrightness } = await import('../src/sky/star/features');
    const f = flareEvent(9, buildStarCatalogue().regions);
    for (const tb of f.bursts) {
      expect(tb).toBeGreaterThan(f.start);
      expect(tb).toBeLessThan(f.start + f.rise);
      expect(flareBrightness(f, tb)).toBeGreaterThan(flareBrightness(f, tb + 6) * 1.2);
    }
  });

  it('erupts in a region facing the observer at its start', async () => {
    const { subObserverAt } = await import('../src/sky/star/features');
    const cat = buildStarCatalogue();
    for (let k = 0; k < 20; k++) {
      const f = flareEvent(k, cat.regions);
      const s = subObserverAt(f.start);
      const c = cat.regions[f.region].center;
      expect(c[0] * s[0] + c[1] * s[1] + c[2] * s[2]).toBeGreaterThan(0.78);
    }
  });

  it('the far shell is light-seconds away: echoes arrive seconds after the disc flashes', async () => {
    const { SHELL_LIGHT_SECONDS } = await import('../src/world/constants');
    expect(SHELL_LIGHT_SECONDS).toBeCloseTo(3.28, 2);
    // A mirror tile near the limb (~1.39 radii away) reflecting the star adds at least a radius of path.
    expect(SHELL_LIGHT_SECONDS * 1.0).toBeGreaterThan(2);
  });
});
