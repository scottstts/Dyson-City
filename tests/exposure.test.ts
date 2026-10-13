import { describe, expect, it } from 'vitest';
import { cameraExposure, whiteBalanceGains, STAR_KEY } from '../src/render/exposure';
import { STAR_CHROMA, STAR_DISC_MEAN_RADIANCE, luminance } from '../src/world/radiometry';

describe('camera', () => {
  it('daylight white balance has unit luminance and makes the bare star neutral', () => {
    const g = whiteBalanceGains();
    expect(luminance(...g)).toBeCloseTo(1, 9);
    const s = STAR_CHROMA.map((c, i) => c * g[i]);
    expect(s[0]).toBeCloseTo(s[1], 6);
    expect(s[2]).toBeCloseTo(s[1], 6);
  });
  it('exposes the star disc mean to the key', () => {
    const g = whiteBalanceGains();
    const k = cameraExposure(STAR_DISC_MEAN_RADIANCE, g);
    const star = STAR_DISC_MEAN_RADIANCE.map((c, i) => c * g[i]) as [number, number, number];
    expect(luminance(...star) * k).toBeCloseTo(STAR_KEY, 9);
  });
});

describe('tone curve', () => {
  it('keeps mid-grey and black linear, and takes the star near white with texture', async () => {
    const { curveCpu } = await import('../src/render/tsl/toneMap');
    expect(curveCpu(0.18)).toBeCloseTo(0.18, 6);
    expect(curveCpu(0.18 / 8)).toBeLessThan(0.02);
    const star = 0.18 * 2 ** 3.8;
    expect(curveCpu(star)).toBeGreaterThan(0.94);
    expect(curveCpu(star * 1.3) - curveCpu(star * 0.7)).toBeGreaterThan(0.015);
    // Continuous at the knee.
    const k = 0.6 / 0.18;
    const sKnee = Math.log2(k) / 1.1;
    expect(Math.abs(curveCpu(0.18 * 2 ** (sKnee - 1e-6)) - curveCpu(0.18 * 2 ** (sKnee + 1e-6)))).toBeLessThan(1e-4);
  });
});
