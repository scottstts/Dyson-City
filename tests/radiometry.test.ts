import { describe, expect, it } from 'vitest';
import { STAR_CENTER_RADIANCE, STAR_DISC_MEAN_RADIANCE, LIMB_DARKENING_EXPONENT } from '../src/world/radiometry';

describe('radiometry', () => {
  it('the disc-mean radiance integrates limb darkening over the projected disc', () => {
    // Numerical ∫ μ^a 2μ dμ over the projected disc, per channel.
    for (let ch = 0; ch < 3; ch++) {
      let sum = 0;
      const n = 20000;
      for (let i = 0; i < n; i++) {
        const r = (i + 0.5) / n;
        sum += Math.pow(Math.sqrt(1 - r * r), LIMB_DARKENING_EXPONENT[ch]) * 2 * r;
      }
      expect(STAR_DISC_MEAN_RADIANCE[ch]).toBeCloseTo(STAR_CENTER_RADIANCE[ch] * (sum / n), 3);
    }
  });
});
