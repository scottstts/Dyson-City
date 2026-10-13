import { describe, expect, it } from 'vitest';
import { GAS_CELL, GAS_HEIGHT, GAS_JACOBI, GAS_NX, GAS_TOP, GAS_VISIBLE_HEIGHT } from '../src/sky/star/gas/domain';
import { VENT_BASE, VENT_COUNT, VENT_SITE_CYCLES, ventAt, ventCycle, ventPulse, ventSite } from '../src/sky/star/gas/vents';
import { STAR_RADIUS_R } from '../src/world/constants';

describe('gas domain', () => {
  it('runs all round the limb, below the highest visible height', () => {
    // A sight line at the horizon passes one shell radius from the star's centre.
    expect(GAS_VISIBLE_HEIGHT).toBeCloseTo(1 / STAR_RADIUS_R - 1, 9);
    expect(GAS_HEIGHT).toBeGreaterThanOrEqual(GAS_TOP);
    expect(GAS_HEIGHT - GAS_TOP).toBeLessThan(GAS_CELL);
    expect(GAS_HEIGHT).toBeLessThan(GAS_VISIBLE_HEIGHT);
    expect(GAS_CELL * GAS_NX).toBeCloseTo(2 * Math.PI, 9);
  });

  it('ends the pressure ping-pong in the buffer it started from', () => {
    expect(GAS_JACOBI % 2).toBe(0);
  });
});

describe('vents', () => {
  it('are deterministic and spread round the whole limb', () => {
    expect(JSON.stringify(ventAt(5, 1234.5))).toBe(JSON.stringify(ventAt(5, 1234.5)));
    const sectors = new Set<number>();
    for (let i = 0; i < VENT_COUNT; i++) {
      const v = ventAt(i, 3000);
      expect(Math.abs(v.angle)).toBeLessThanOrEqual(Math.PI);
      sectors.add(Math.floor(((v.angle + Math.PI) / (2 * Math.PI)) * 8));
    }
    expect(sectors.size).toBe(8);
  });

  it('launch gas up from the limb at the reference look\'s speeds and sizes', () => {
    for (let i = 0; i < VENT_COUNT; i++) {
      for (let m = 0; m < 10; m++) {
        const v = ventSite(i, m);
        expect(v.vy).toBeGreaterThan(0.037);
        expect(v.vy).toBeLessThan(0.063);
        expect(Math.abs(v.vx)).toBeLessThan(v.vy * 0.6);
        // Resolved by the grid: at least two cells.
        expect(v.radius).toBeGreaterThan(2 * GAS_CELL);
        expect(v.radius).toBeLessThan(0.0105);
      }
    }
  });

  it('always vent a little and erupt once per cycle', () => {
    expect(ventPulse(0)).toBeCloseTo(VENT_BASE, 9);
    expect(ventPulse(3)).toBeCloseTo(1, 9);
    expect(ventPulse(12)).toBeCloseTo(VENT_BASE, 9);
    for (let t = 0; t < 200; t += 0.37) {
      const s = ventAt(3, t).strength;
      expect(s).toBeGreaterThanOrEqual(VENT_BASE - 1e-9);
      expect(s).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('move to a new site only between cycles, after a few cycles', () => {
    const { period, offset } = ventCycle(7);
    const tenure = period * VENT_SITE_CYCLES;
    const start = Math.ceil((1000 + offset) / tenure) * tenure - offset;
    expect(ventAt(7, start + 0.01).angle).toBe(ventAt(7, start + tenure - 0.01).angle);
    expect(ventAt(7, start - 0.01).angle).not.toBe(ventAt(7, start + 0.01).angle);
  });
});
