import { describe, expect, it } from 'vitest';
import { BLACK_POINT, LOOK, lookCpu, vignetteCpu } from '../src/render/tsl/look';

describe('high-contrast look', () => {
  it('takes the veil floor toward black, lowers mid-grey a little, keeps highlights', () => {
    expect(lookCpu(0)).toBeLessThan(1e-3);
    // The starry gaps (exposed ~0.11 under the glare veil) end up several stops under mid-grey.
    expect(Math.log2(lookCpu(0.11) / 0.18)).toBeLessThan(-2.5);
    const mid = Math.log2(lookCpu(0.18) / 0.18);
    expect(mid).toBeLessThan(0);
    expect(mid).toBeGreaterThan(-1);
    // Bright stone (two stops over) moves by well under a stop.
    expect(Math.abs(Math.log2(lookCpu(0.72) / 0.72))).toBeLessThan(0.6);
    expect(BLACK_POINT.floor).toBeLessThan(0.11);
    expect(LOOK.shadowGain).toBeGreaterThan(LOOK.highlightGain);
  });
  it('takes off only the veil a pixel carries: sunlit darks far from the star keep their tone', () => {
    // Looking level under the Dome the star's veil is ~0.01 exposed; sunlit foliage is ~0.035.
    const foliage = Math.log2(lookCpu(0.035, 0.01) / 0.035);
    expect(foliage).toBeGreaterThan(-1.5);
    // The deepest floor (beside the star) would have crushed it by several stops.
    expect(Math.log2(lookCpu(0.035) / 0.035)).toBeLessThan(-4);
    // Indoors (no star in view) nothing is taken off: only the contrast curve acts.
    expect(Math.log2(lookCpu(0.18, 0) / 0.18)).toBeCloseTo(0, 1);
  });
  it('is monotonic', () => {
    let prev = 0;
    for (let s = -12; s <= 8; s += 0.05) {
      const v = lookCpu(0.18 * 2 ** s);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });
});

describe('lens vignette', () => {
  it('is very light: none on axis, ~0.2 stop in the corners of the default 62° field', () => {
    expect(vignetteCpu(1)).toBe(1);
    // Corner of a 16:10 frame at a 62° vertical field: tan θ = tan 31° · √(1 + 1.6²).
    const theta = Math.atan(Math.tan((31 * Math.PI) / 180) * Math.hypot(1, 1.6));
    const stops = -Math.log2(vignetteCpu(Math.cos(theta)));
    expect(stops).toBeGreaterThan(0.1);
    expect(stops).toBeLessThan(0.3);
  });
});
