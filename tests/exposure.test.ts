import { describe, expect, it } from 'vitest';
import { cameraExposure, whiteBalanceGains, STAR_KEY } from '../src/render/exposure';
import { STAR_CHROMA, STAR_DISC_MEAN_RADIANCE, luminance } from '../src/world/radiometry';

describe('camera', () => {
  it('daylight (D65) white balance has unit luminance and renders the 5,772 K star warm', () => {
    const g = whiteBalanceGains();
    expect(luminance(...g)).toBeCloseTo(1, 9);
    const s = STAR_CHROMA.map((c, i) => c * g[i]);
    expect(s[0]).toBeGreaterThan(s[1]);
    expect(s[2]).toBeLessThan(s[1]);
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
    // The star's disc centre (~4.1 stops over mid-grey) is near white but keeps its texture:
    // ±13 % granulation must still move the display value.
    const centre = 0.18 * 2 ** 4.1;
    expect(curveCpu(centre)).toBeGreaterThan(0.88);
    expect(curveCpu(centre)).toBeLessThan(0.97);
    expect(curveCpu(centre * 1.13) - curveCpu(centre / 1.13)).toBeGreaterThan(0.012);
    // The limb (μ ≈ 0.1, ~0.3 of the centre) reads clearly darker than the centre.
    expect(curveCpu(centre) - curveCpu(centre * 0.3)).toBeGreaterThan(0.12);
    // Continuous at the knee.
    const k = 0.45 / 0.18;
    const sKnee = Math.log2(k) / 1.1;
    expect(Math.abs(curveCpu(0.18 * 2 ** (sKnee - 1e-6)) - curveCpu(0.18 * 2 ** (sKnee + 1e-6)))).toBeLessThan(1e-4);
  });
});
