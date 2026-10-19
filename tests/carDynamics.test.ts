import { describe, expect, it } from 'vitest';
import { CarState, steerLock, stepCar, type DriveInput } from '../src/vehicles/car/dynamics';
import { CarCollider, CAR_FOOTPRINT } from '../src/vehicles/car/collision';
import { CollisionWorld } from '../src/player/collision';
import { boxShade } from '../src/vehicles/shade';

const input = (p: Partial<DriveInput>): DriveInput => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, ...p });

function run(s: CarState, inp: DriveInput, seconds: number, dt = 1 / 60, each?: (t: number) => void, collide?: (s: CarState) => void): void {
  const carry = { t: 0 };
  // Whole frames: the same simulated time at every frame rate.
  const frames = Math.round(seconds / dt);
  for (let f = 0; f < frames; f++) {
    stepCar(s, inp, dt, carry, collide);
    each?.(f * dt);
  }
}

describe('car dynamics', () => {
  it('reports its character', () => {
    const s = new CarState();
    let t100 = -1;
    run(s, input({ throttle: 1 }), 30, 1 / 60, (t) => {
      if (t100 < 0 && s.u >= 100 / 3.6) t100 = t;
    });
    const top = s.u;
    const b = new CarState();
    run(b, input({ throttle: 1 }), 30);
    b.u = 100 / 3.6;
    const x0 = b.z;
    let far = 0;
    run(b, input({ brake: 1 }), 2.5, 1 / 60, () => (far = Math.max(far, b.z - x0)));
    const stop = far;
    // Skidpad: full lock at 15 m/s held: steady lateral acceleration.
    const c = new CarState();
    c.u = 20;
    let ayMax = 0;
    run(c, input({ throttle: 0.35, steer: 1 }), 6, 1 / 60, (t) => {
      if (t > 2) ayMax = Math.max(ayMax, Math.abs(c.ay));
    });
    expect(t100).toBeGreaterThan(2.8);
    expect(t100).toBeLessThan(4);
    expect(top * 3.6).toBeGreaterThan(135);
    expect(top * 3.6).toBeLessThan(142);
    expect(stop).toBeGreaterThan(28);
    expect(stop).toBeLessThan(38);
    expect(ayMax / 9.81).toBeGreaterThan(1.0);
    expect(ayMax / 9.81).toBeLessThan(1.3);
  });

  it('stays put at rest and is frame-rate independent', () => {
    const s = new CarState();
    run(s, input({}), 3);
    expect(Math.hypot(s.x, s.z)).toBeLessThan(1e-6);
    const a = new CarState();
    const b = new CarState();
    const inp = input({ throttle: 0.8, steer: 0.6 });
    run(a, inp, 4, 1 / 30);
    run(b, inp, 4, 1 / 144);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(0.8);
  });

  it('does not spin at speed under full steer, and the handbrake swings the tail', () => {
    const s = new CarState();
    s.u = 38;
    let beta = 0;
    run(s, input({ throttle: 1, steer: 1 }), 5, 1 / 60, () => (beta = Math.max(beta, Math.abs(Math.atan2(s.v, s.u)))));
    expect(beta).toBeLessThan(0.25);
    const h = new CarState();
    h.u = 18;
    let yawed = 0;
    run(h, input({ steer: 0.6, handbrake: true }), 1.2, 1 / 60, () => (yawed = Math.max(yawed, Math.abs(Math.atan2(h.v, h.u)))));
    expect(yawed).toBeGreaterThan(0.2);
  });

  it('stays composed: braking or lifting off in a corner does not spin it, and turn-in settles', () => {
    for (const v of [15, 25, 35]) {
      // Cornering hard under power, then full braking (or a lift) with the steering held.
      const b = new CarState();
      b.u = v;
      let slip = 0;
      run(b, input({ steer: 1, throttle: 0.4 }), 2);
      run(b, input({ steer: 1, brake: 1 }), 1.5, 1 / 60, () => (slip = Math.max(slip, Math.abs(Math.atan2(b.v, Math.abs(b.u) + 0.01)))));
      expect(slip, `brake at ${v}`).toBeLessThan(0.21);
      const l = new CarState();
      l.u = v;
      slip = 0;
      run(l, input({ steer: 1, throttle: 1 }), 2);
      run(l, input({ steer: 1 }), 1.5, 1 / 60, () => (slip = Math.max(slip, Math.abs(Math.atan2(l.v, Math.abs(l.u) + 0.01)))));
      expect(slip, `lift at ${v}`).toBeLessThan(0.15);
    }
    // A full-lock key press at speed: the yaw rate settles near what the grip can turn, without a
    // large overshoot, and the cornering stays within the tyres (stability control brakes wheels;
    // it cannot add grip).
    for (const v of [20, 30]) {
      const s = new CarState();
      s.u = v;
      const rates: number[] = [];
      let ay = 0;
      run(s, input({ steer: 1, throttle: 0.25 }), 1.2, 1 / 60, () => {
        rates.push(Math.abs(s.r * s.u));
        ay = Math.max(ay, Math.abs(s.ay));
      });
      const settled = rates[rates.length - 1];
      expect(Math.max(...rates) / settled, `overshoot at ${v}`).toBeLessThan(1.3);
      expect(ay / 9.81).toBeLessThan(1.32);
    }
  });

  it('turns under power: W held through a corner keeps it on its line', () => {
    // The commonest keyboard input. Without cornering traction management the car sped from 15 to
    // 27 m/s round the corner (a circle three times as wide); without torque vectoring the front's
    // drive pushed it wide.
    const s = new CarState();
    s.u = 15;
    let ay = 0;
    run(s, input({ throttle: 1, steer: 1 }), 2, 1 / 60, (t) => {
      if (t > 0.7) ay = Math.max(ay, Math.abs(s.r * s.u));
    });
    expect(s.u).toBeLessThan(20);
    expect(ay / 9.81).toBeGreaterThan(1.15);
    const t = new CarState();
    t.u = 10;
    run(t, input({ throttle: 1, steer: 1 }), 0.8);
    expect(t.yaw).toBeGreaterThan((34 * Math.PI) / 180);
  });

  it('winds the steering on rather than snapping to lock', () => {
    const s = new CarState();
    s.u = 30;
    run(s, input({ steer: 1 }), 0.1);
    const lock = steerLock(s.speed);
    expect(s.steer).toBeGreaterThan(0.2 * lock);
    expect(s.steer).toBeLessThan(0.6 * lock);
  });

  it('turns tightly at low speed (four-wheel steering)', () => {
    const s = new CarState();
    s.u = 3;
    let r = Infinity;
    run(s, input({ throttle: 0.12, steer: 1 }), 6, 1 / 60, (t) => {
      if (t > 3) r = Math.min(r, s.speed / Math.max(Math.abs(s.r), 1e-6));
    });
    expect(Math.abs(s.rearSteer)).toBeGreaterThan(0.05);
    expect(r).toBeLessThan(6.8);
  });

  it('reverses only after standing with the brake held', () => {
    const s = new CarState();
    s.u = 10;
    run(s, input({ brake: 1 }), 3);
    expect(s.gear).toBe(-1);
    expect(s.u).toBeLessThan(0);
    run(s, input({ throttle: 1 }), 3);
    expect(s.gear).toBe(1);
  });
});

describe('the car against walls', () => {
  const wall = () => {
    const w = new CollisionWorld();
    // A wall across the car's way at z = 40, from x −50 to 50.
    w.addSegment(-50, 40, 50, 40);
    return w;
  };

  it('stops at a wall it drives into square, without passing it', () => {
    const s = new CarState();
    s.u = 25;
    const c = new CarCollider([wall()]);
    let maxZ = -Infinity;
    let hit = 0;
    run(s, input({ throttle: 1 }), 4, 1 / 60, () => {
      // The nose (footprint front) never crosses the wall.
      maxZ = Math.max(maxZ, s.z + CAR_FOOTPRINT.centreZ + CAR_FOOTPRINT.halfLength);
      hit = Math.max(hit, c.take().impulse);
    }, (st) => c.resolve(st));
    expect(maxZ).toBeLessThan(40.05);
    expect(hit).toBeGreaterThan(11_000);
  });

  it('scrapes along a wall it meets at a glancing angle, keeping most of its speed', () => {
    const s = new CarState();
    s.place(-20, 35.5, Math.PI / 2 - 0.2);
    s.u = 20;
    const c = new CarCollider([wall()]);
    run(s, input({ throttle: 0.4 }), 3, 1 / 60, undefined, (st) => c.resolve(st));
    expect(s.z).toBeLessThan(40);
    expect(Math.hypot(s.vx, s.vz)).toBeGreaterThan(8);
  });
});

describe('the vehicles’ shade on the pad', () => {
  const box = { x: 0, z: 0, yaw: 0.4, a: 2.2, b: 3.1, h: 0.85, opacity: 1 };
  it('is deep under the car, none well clear of it, and soft between', () => {
    // Under the body: the whole star and nearly all the sky.
    expect(boxShade(box, 0, 0)).toBeGreaterThan(0.97);
    expect(boxShade(box, 0, 0)).toBeLessThan(1);
    expect(boxShade(box, 12, 0)).toBeLessThan(0.002);
    let prev = 1;
    for (let d = 0; d <= 6; d += 0.1) {
      const f = boxShade(box, d * Math.cos(0.4), -d * Math.sin(0.4));
      expect(f).toBeLessThanOrEqual(prev + 1e-9);
      prev = f;
    }
    // The star's penumbra spans about the body's height either side of its edge; the sky's is wider.
    const edge = (d: number) => boxShade(box, d * Math.cos(0.4), -d * Math.sin(0.4));
    expect(edge(box.a - box.h)).toBeGreaterThan(0.9);
    expect(edge(box.a + box.h)).toBeLessThan(0.12);
    // The sky's view factor of an infinite plane overhead is 1 (the formula's limit).
    const huge = { ...box, a: 1e5, b: 1e5, opacity: 1 };
    expect(boxShade(huge, 0, 0)).toBeCloseTo(1, 3);
  });
});
