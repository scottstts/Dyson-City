import { beforeAll, describe, expect, it } from 'vitest';
import { computeAtmosphere, elevationFromV, vFromElevation, azimuthFromU, buildCapQuadrature, capIrradiance, phaseMie, phaseRayleigh, type AtmosphereLuts } from '../src/atmosphere/precompute';
import { ATMOSPHERE, LUT } from '../src/atmosphere/params';
import { STAR_CENTER_RADIANCE, discAverageLimbFactor } from '../src/world/radiometry';

let luts: AtmosphereLuts;
beforeAll(() => {
  luts = computeAtmosphere();
}, 30_000);

const W = LUT.skyWidth;
const H = LUT.skyHeight;
function sky(which: 'skyLocal', elevationDeg: number, azimuthDeg: number) {
  const v = vFromElevation((elevationDeg * Math.PI) / 180);
  const u = Math.sqrt(azimuthDeg / 90);
  const j = Math.min(H - 1, Math.max(0, Math.round(v * H - 0.5)));
  const i = Math.min(W - 1, Math.max(0, Math.round(u * W - 0.5)));
  const o = (j * W + i) * 6;
  const a = luts[which];
  return { S: [a[o], a[o + 1], a[o + 2]], T: [a[o + 3], a[o + 4], a[o + 5]] };
}
const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe('phase functions', () => {
  it('integrate to 1 over the sphere', () => {
    for (const p of [(c: number) => phaseRayleigh(c), (c: number) => phaseMie(c, ATMOSPHERE.mieG)]) {
      let s = 0;
      const n = 20000;
      for (let k = 0; k < n; k++) {
        const c = -1 + (2 * (k + 0.5)) / n;
        s += p(c) * 2 * Math.PI * (2 / n);
      }
      expect(s).toBeCloseTo(1, 2);
    }
  });
});

describe('star cap irradiance', () => {
  it('matches the analytic limb-darkened sphere-light value above the air', () => {
    const cap = buildCapQuadrature();
    const top = capIrradiance({ ...ATMOSPHERE }, ATMOSPHERE.top, cap);
    for (const c of [0, 1, 2] as const) {
      const analytic = Math.PI * 0.5 * STAR_CENTER_RADIANCE[c] * discAverageLimbFactor(c);
      expect(top[c] / analytic).toBeCloseTo(1, 2);
    }
  });
  it('is attenuated more in blue than red at the deck', () => {
    const g = luts.groundIrradiance;
    const cap = buildCapQuadrature();
    const top = capIrradiance({ ...ATMOSPHERE }, ATMOSPHERE.top, cap);
    expect(g[2] / top[2]).toBeLessThan(g[0] / top[0]);
  });
});

describe('sky-view LUT', () => {
  it('mappings round-trip', () => {
    for (const e of [-1.2, -0.01, 0.003, 0.4, 1.5]) expect(elevationFromV(vFromElevation(e))).toBeCloseTo(e, 9);
    expect(azimuthFromU(1)).toBeCloseTo(Math.PI / 2);
  });
  it('all values finite, transmittance within [0, 1], in-scatter non-negative', { timeout: 60_000 }, () => {
    for (const a of [luts.skyLocal, luts.aerial]) {
      for (let i = 0; i < a.length; i += 6) {
        for (let c = 0; c < 3; c++) {
          expect(Number.isFinite(a[i + c])).toBe(true);
          expect(a[i + c]).toBeGreaterThanOrEqual(0);
          expect(a[i + 3 + c]).toBeGreaterThanOrEqual(0);
          expect(a[i + 3 + c]).toBeLessThanOrEqual(1.0000001);
        }
      }
    }
  });
  it('the horizon is hazier and brighter than the mid sky', () => {
    expect(lum(sky('skyLocal', 1, 45).S)).toBeGreaterThan(lum(sky('skyLocal', 25, 45).S));
    expect(lum(sky('skyLocal', 25, 45).T)).toBeGreaterThan(lum(sky('skyLocal', 3, 45).T));
  });
  it('the airlight is bluer than the star light that makes it', () => {
    const s = sky('skyLocal', 25, 45).S;
    expect(s[2] / s[0]).toBeGreaterThan(STAR_CENTER_RADIANCE[2] / STAR_CENTER_RADIANCE[0]);
  });
});

describe('aerial perspective LUT', () => {
  it('starts clear at zero distance and thickens monotonically', () => {
    const AW = LUT.apWidth;
    const row = Math.round(vFromElevation(-0.02) * LUT.apHeight - 0.5);
    let prev = 1.0000001;
    for (let i = 0; i < AW; i++) {
      const t = luts.aerial[(row * AW + i) * 6 + 4];
      expect(t).toBeLessThanOrEqual(prev);
      prev = t;
    }
    expect(luts.aerial[row * AW * 6 + 4]).toBeCloseTo(1, 6);
  });
});
