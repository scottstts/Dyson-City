import { describe, expect, it } from 'vitest';
import { STRUCTURE, NEAR_MERIDIAN_LONGITUDE, hubAxes, isWide, pointElevation, railFacePlane, shellView, sphereDir, strutTopCap, struts } from '../src/sky/structure/layout';
import { BAND_SPIN_PERIOD, frameAngle } from '../src/sky/structure/spin';
import { STAR_RADIUS_R } from '../src/world/constants';

const DEG = 180 / Math.PI;

describe('shell geometry', () => {
  it('a shell point at central angle γ appears at elevation γ/2', () => {
    for (const g of [0.1, 0.5, 1.2]) expect(pointElevation(g, 1)).toBeCloseTo(shellView(g).elevation, 9);
  });
  it('a mirror on the shell never reflects a visible chord into the star', () => {
    for (const eDeg of [1, 10, 30, 44.9]) expect(Math.cos(eDeg / DEG)).toBeGreaterThan(STAR_RADIUS_R);
    expect(Math.cos(46 / DEG)).toBeLessThan(STAR_RADIUS_R);
  });
});

describe('layout (the logo)', () => {
  it('the city sits on the band west of a hub with a wide opening', () => {
    const hub = hubAxes().equatorial[0];
    expect(Math.atan2(hub[0], -hub[1])).toBeCloseTo(NEAR_MERIDIAN_LONGITUDE, 9);
    expect(isWide(0)).toBe(true);
    expect(NEAR_MERIDIAN_LONGITUDE - STRUCTURE.hubOuter).toBeGreaterThan(0);
  });
  it('six spines and hubs, alternating wide openings and narrow slots', () => {
    expect(STRUCTURE.meridianLongitudes.length).toBe(6);
    expect(hubAxes().equatorial.length).toBe(6);
    expect([0, 1, 2, 3, 4, 5].filter(isWide).length).toBe(3);
  });
  it('open bands separate the band from the panels; panels end before the collars', () => {
    expect(STRUCTURE.panelLow).toBeGreaterThan(STRUCTURE.girdleHalfLatitude + 5 / DEG);
    expect(STRUCTURE.panelHigh).toBeLessThan(STRUCTURE.collarLatitude);
  });
  it('struts are short arcs with their plane normal perpendicular to both ends', () => {
    const s = struts();
    expect(s.length).toBe(24);
    for (const t of s) {
      const d = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
      expect(Math.abs(d(t.n, t.a))).toBeLessThan(1e-9);
      expect(Math.abs(d(t.n, t.b))).toBeLessThan(1e-9);
      expect(Math.acos(d(t.a, t.b)) * DEG).toBeLessThan(15);
    }
  });
});

describe('a spinning band (nothing of the frame crosses it)', () => {
  const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  it('spines end inside their hub collar, which clears the band', () => {
    expect(STRUCTURE.hubInner).toBeGreaterThan(STRUCTURE.girdleHalfLatitude);
    expect(STRUCTURE.spineEnd).toBeGreaterThan(STRUCTURE.hubInner + STRUCTURE.spineWidth / 2);
    expect(STRUCTURE.spineEnd).toBeLessThan(STRUCTURE.hubOuter);
    expect(STRUCTURE.spineDepth).toBeLessThan(STRUCTURE.hubDepth);
  });
  it('the rail face planes bound the band from both sides', () => {
    for (const hemi of [1, -1] as const) {
      const p = railFacePlane(hemi);
      // The band's centre line is outside the kept half-space; a point at 4° on that side is inside.
      expect(dot(sphereDir(0, 0.3), p.n)).toBeGreaterThanOrEqual(p.c);
      expect(dot(sphereDir((hemi * 4) / DEG, 0.3), p.n)).toBeLessThan(p.c);
    }
  });
  it('struts keep the arc from their foot to the panel corner, and stop there', () => {
    for (const s of struts()) {
      const cap = strutTopCap(s);
      const mid = [0, 1, 2].map((k) => (s.a[k] + s.b[k]) / 2);
      expect(dot(mid, cap.n)).toBeLessThan(cap.c);
      const beyond = [0, 1, 2].map((k) => 2 * s.b[k] - mid[k]);
      expect(dot(beyond, cap.n)).toBeGreaterThan(cap.c);
      // Brace feet clear the collar.
      const hub = hubAxes().equatorial.reduce((best, h) => (dot(h, s.a) > dot(best, s.a) ? h : best));
      expect(Math.acos(dot(hub, s.a))).toBeGreaterThan(STRUCTURE.hubOuter);
    }
  });
  it('the frame turns once per spin period, from zero at spawn', () => {
    expect(frameAngle(0)).toBe(0);
    expect(frameAngle(BAND_SPIN_PERIOD / 4)).toBeCloseTo(Math.PI / 2, 9);
  });
});
