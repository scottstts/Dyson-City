import { describe, expect, it } from 'vitest';
import { HeadMotion, cadence, type GaitInput } from '../src/player/headMotion';

const gait = (speed: number, grounded = true): GaitInput => ({ speed, walkSpeed: 2, runSpeed: 5.6, grounded, accelForward: 0, accelRight: 0 });

function simulate(h: HeadMotion, seconds: number, hz: number, speed: number, record?: number[]): void {
  const dt = 1 / hz;
  for (let i = 0; i < Math.round(seconds * hz); i++) {
    h.update(dt, gait(speed));
    record?.push(h.up);
  }
}

describe('head motion', () => {
  it('steps at human cadences', () => {
    expect(cadence(2)).toBeCloseTo(2.08, 2);
    expect(cadence(5.6)).toBeGreaterThan(2.8);
    expect(cadence(5.6)).toBeLessThan(3.1);
  });
  it('bobs a few centimetres walking and roughly twice that running', () => {
    const walk: number[] = [];
    simulate(new HeadMotion(), 6, 120, 2, walk);
    const run: number[] = [];
    simulate(new HeadMotion(), 6, 120, 5.6, run);
    const p2p = (a: number[]) => Math.max(...a.slice(-240)) - Math.min(...a.slice(-240));
    expect(p2p(walk)).toBeGreaterThan(0.035);
    expect(p2p(walk)).toBeLessThan(0.06);
    expect(p2p(run)).toBeGreaterThan(1.6 * p2p(walk));
    expect(p2p(run)).toBeLessThan(0.12);
  });
  it('is frame-rate independent', () => {
    const a = new HeadMotion();
    const b = new HeadMotion();
    simulate(a, 3, 60, 2);
    simulate(b, 3, 240, 2);
    expect(Math.abs(a.up - b.up)).toBeLessThan(0.004);
    expect(Math.abs(a.right - b.right)).toBeLessThan(0.002);
  });
  it('settles when the body stops, and stays finite at dt = 0', () => {
    const h = new HeadMotion();
    simulate(h, 3, 60, 5.6);
    simulate(h, 1.5, 60, 0);
    expect(Math.abs(h.up)).toBeLessThan(0.002);
    expect(Math.abs(h.roll)).toBeLessThan(0.0005);
    h.update(0, gait(2));
    expect(Number.isFinite(h.up) && Number.isFinite(h.pitch)).toBe(true);
  });
  it('dips on landing and recovers', () => {
    const h = new HeadMotion();
    h.land(3.9);
    let low = 0;
    for (let i = 0; i < 120; i++) {
      h.update(1 / 120, gait(0));
      low = Math.min(low, h.up);
    }
    expect(low).toBeLessThan(-0.03);
    expect(low).toBeGreaterThan(-0.15);
    for (let i = 0; i < 240; i++) h.update(1 / 120, gait(0));
    expect(Math.abs(h.up)).toBeLessThan(0.002);
  });
});
