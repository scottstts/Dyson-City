import { describe, expect, it } from 'vitest';
import { combinePlasmaLut, computePlasmaLut, plasmaExtinction, plasmaSegment, PLASMA } from '../src/sky/medium/plasma';
import { STAR_RADIUS_R } from '../src/world/constants';

const S = STAR_RADIUS_R;
const lut = combinePlasmaLut(computePlasmaLut(), [0.5, 0.5, 0.5]);

/** Glow and transmittance seen from the observer at angle θ from the star centre. */
function view(thetaDeg: number) {
  const t = (thetaDeg * Math.PI) / 180;
  const b = Math.sin(t);
  const x0 = -Math.cos(t);
  const x1 = b < S ? -Math.sqrt(S * S - b * b) : Math.sqrt(1 - b * b);
  return plasmaSegment(lut, b, x0, x1);
}

describe('trapped plasma', () => {
  it('has the configured optical depth along the grazing line', () => {
    const L = Math.sqrt(1 - S * S);
    let tau = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const x = -L + ((i + 0.5) / n) * 2 * L;
      tau += plasmaExtinction(Math.hypot(S, x)) * ((2 * L) / n);
    }
    expect(tau).toBeCloseTo(PLASMA.limbOpticalDepth + PLASMA.fillDepth * 2 * L, 3);
  });

  it('segment integrals compose: S(a→c) = S(a→b)·… with T multiplicative', () => {
    const b = 0.8;
    const L = Math.sqrt(1 - b * b);
    const ab = plasmaSegment(lut, b, -L, 0);
    const bc = plasmaSegment(lut, b, 0, L);
    const ac = plasmaSegment(lut, b, -L, L);
    expect(ac.T).toBeCloseTo(ab.T * bc.T, 4);
    for (let c = 0; c < 3; c++) expect(ac.S[c]).toBeCloseTo(ab.S[c] + ab.T * bc.S[c], 3);
  });

  it('glows brightest at the limb, stays fainter than the disc beside it, and fades outward with no ring', () => {
    // Just inside the limb the disc hides the far half of the grazing path; the limb-darkened disc
    // (μ ≈ 0.1 there) still outshines the full glow just outside, so the radiance falls across the limb.
    const discNearLimb = 10 * Math.pow(0.1, 0.508);
    const at = view(45.2).S[1];
    const out10 = view(55).S[1];
    const out30 = view(75).S[1];
    expect(discNearLimb + view(44.9).S[1]).toBeGreaterThan(at);
    expect(at).toBeGreaterThan(out10);
    expect(out10).toBeGreaterThan(out30);
    // Monotone decrease outside the limb.
    let prev = Infinity;
    for (let th = 45.2; th < 89; th += 0.5) {
      const g = view(th).S[1];
      expect(g).toBeLessThanOrEqual(prev * 1.0001);
      prev = g;
    }
  });
});
