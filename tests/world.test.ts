import { describe, expect, it } from 'vitest';
import { STAR_ANGULAR_RADIUS, SHELL_RADIUS_KM, STAR_RADIUS_KM, SPIN_RATE, starDriftRate, shellDistanceKm, GRAVITY, SHELL_RADIUS_M } from '../src/world/constants';
import { StarState } from '../src/sky/star/starState';

const DEG = 180 / Math.PI;

describe('world frame', () => {
  it('the star is 90° across: its limb sits 45° up', () => {
    expect(STAR_ANGULAR_RADIUS * DEG).toBeCloseTo(45, 1);
    expect(SHELL_RADIUS_KM - STAR_RADIUS_KM).toBe(288_000);
  });

  it('spin gives 1 g at the equator with a ~17.5 h period', () => {
    expect(SPIN_RATE * SPIN_RATE * SHELL_RADIUS_M).toBeCloseTo(GRAVITY, 6);
    expect((2 * Math.PI) / SPIN_RATE / 3600).toBeCloseTo(17.48, 1);
  });

  it('the star surface drifts at ~0.83° per minute at disc centre', () => {
    expect(starDriftRate() * DEG * 60).toBeCloseTo(0.83, 1);
  });

  it('a shell point at elevation e lies 2R·sin(e) away', () => {
    expect(shellDistanceKm(Math.PI / 4)).toBeCloseTo(SHELL_RADIUS_KM * Math.SQRT2, 0);
    expect(shellDistanceKm(Math.PI / 2)).toBeCloseTo(2 * SHELL_RADIUS_KM, 0);
  });

  it('star features drift west (−X) over the sub-observer point', () => {
    // A feature fixed in the star frame at the sub-observer point at t=0 …
    const a0 = StarState.rotationAngle(0);
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    // star-frame position X = Rz(a)·n  →  n = Rz(−a)·X ; with X chosen so that n(0) = (0,−1,0)
    const X = [c0 * 0 - s0 * -1, s0 * 0 + c0 * -1];
    const a1 = StarState.rotationAngle(60);
    const n1x = Math.cos(-a1) * X[0] - Math.sin(-a1) * X[1];
    expect(n1x).toBeLessThan(0);
  });
});
