import { describe, expect, it } from 'vitest';
import { GALACTIC_CENTRE, GALACTIC_POLE, NEBULAE, angleBetween, raDec, tangentFrame } from '../src/sky/space/catalogue';

const DEG = Math.PI / 180;
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe('the sky beyond the shell', () => {
  it('the galactic plane passes near both celestial poles; the centre lies on it', () => {
    expect(Math.abs(dot(GALACTIC_POLE, [0, 0, 1]))).toBeLessThan(Math.sin(15 * DEG));
    expect(Math.abs(dot(GALACTIC_CENTRE, GALACTIC_POLE))).toBeLessThan(1e-9);
    expect(Math.hypot(...GALACTIC_CENTRE)).toBeCloseTo(1, 9);
    expect(Math.asin(GALACTIC_CENTRE[2]) / DEG).toBeCloseTo(55, 6);
  });
  it('showpieces sit where the openings look (|dec| 15°–75°), never on the band-hidden equator', () => {
    for (const n of NEBULAE) {
      const dec = Math.abs(Math.asin(n.centre[2])) / DEG;
      expect(dec - n.radius / DEG).toBeGreaterThan(5);
      expect(dec).toBeLessThan(75);
    }
  });
  it('tangent frames are orthonormal at the centre', () => {
    const c = raDec(40 * DEG, 30 * DEG);
    const { e1, e2 } = tangentFrame(c, 0.7);
    expect(dot(e1, c)).toBeCloseTo(0, 9);
    expect(dot(e2, c)).toBeCloseTo(0, 9);
    expect(dot(e1, e2)).toBeCloseTo(0, 9);
    expect(angleBetween(e1, e2)).toBeCloseTo(Math.PI / 2, 9);
  });
});
