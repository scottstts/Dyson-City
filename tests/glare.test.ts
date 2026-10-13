import { describe, expect, it } from 'vitest';
import { GLARE_CORE_FRACTION, eyePsf, psfEnergy, screenGlareLobes, starGlareAt } from '../src/render/glare';

describe('eye glare (Spencer et al. 1995 PSF)', () => {
  it('is normalised over the sphere', () => {
    expect(psfEnergy(1e-5, 180)).toBeCloseTo(1, 3);
    expect(eyePsf(1)).toBeGreaterThan(eyePsf(10));
  });
  it('conserves energy: what leaves the image core is the glare', () => {
    const lobes = screenGlareLobes();
    const spread = lobes.reduce((s, l) => s + l.weight, 0);
    expect(GLARE_CORE_FRACTION + spread + psfEnergy(60, 180)).toBeCloseTo(1, 3);
    for (let i = 1; i < lobes.length; i++) expect(lobes[i].sigmaDeg).toBeGreaterThan(lobes[i - 1].sigmaDeg);
  });
  it('the star glare is continuous across the limb and falls off outside it', () => {
    const inside = starGlareAt(44.9, 45)[1];
    const outside = starGlareAt(45.1, 45)[1];
    expect(Math.abs(inside - outside) / inside).toBeLessThan(0.6);
    let prev = Infinity;
    for (const t of [45.5, 50, 60, 80, 120, 180]) {
      const g = starGlareAt(t, 45)[1];
      expect(g).toBeLessThan(prev);
      prev = g;
    }
    // Strongest over the disc centre, where the most disc surrounds the view direction.
    expect(starGlareAt(0, 45)[1]).toBeGreaterThan(starGlareAt(40, 45)[1]);
  });
});
