import { describe, expect, it } from 'vitest';
import { STRUCTURE, NEAR_MERIDIAN_LONGITUDE, hubAxes, isWide, pointElevation, shellView, struts } from '../src/sky/structure/layout';
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
    expect(NEAR_MERIDIAN_LONGITUDE - STRUCTURE.hubRadius).toBeGreaterThan(0);
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
