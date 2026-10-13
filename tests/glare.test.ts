import { describe, expect, it } from 'vitest';
import { GLARE_CORE_FRACTION, EYE_SCATTER_SHARE, eyePsf, psfEnergy, screenGlareLobes, starGlareAt } from '../src/render/glare';
import { LIMB_DARKENING_EXPONENT } from '../src/world/radiometry';

describe('eye glare (CIE 180 disability-glare scatter)', () => {
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

  it('dazzles without a halo: ~1 % veil beside the star, falling as a power law, no fixed-size glow', () => {
    const mean = 2 / (LIMB_DARKENING_EXPONENT[1] + 2);
    const veil = (t: number) => starGlareAt(t, 45)[1] / mean;
    expect(EYE_SCATTER_SHARE).toBeGreaterThan(0.15);
    expect(EYE_SCATTER_SHARE).toBeLessThan(0.4);
    expect(veil(55)).toBeGreaterThan(0.004);
    expect(veil(55)).toBeLessThan(0.02);
    // Scale-free: the veil 40° from the limb is still a sizeable share of the veil 10° from it
    // (a Gaussian halo of a few degrees would have vanished).
    expect(veil(85) / veil(55)).toBeGreaterThan(0.4);
  });
});
