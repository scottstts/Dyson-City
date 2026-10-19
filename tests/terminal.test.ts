import { describe, expect, it } from 'vitest';
import { buildPlatform } from '../src/terminal/build/platform';
import { buildConsole } from '../src/terminal/build/console';
import { STAND_SLOTS } from '../src/terminal/materials';
import { assemblyAudit, describeTopology, topologyFailures, type NamedPart } from './geometryGate';

import { CollisionWorld } from '../src/player/collision';
import { TestWalker } from './helpers/walker';
import { Car } from '../src/vehicles/car/car';
import { CAR_FOOTPRINT } from '../src/vehicles/car/collision';
import { FIELD_Y, ESTATE_GATEWAY } from '../src/field/layout';
import { GATE } from '../src/city/gate/spec';
import { DOME } from '../src/city/dome/spec';
import { TERRACE_OUTLINE } from '../src/estate/layout';
import { standWalk, addStandCarWalls } from '../src/terminal/walk';
import { standSilenceTarget, StandSilencer } from '../src/terminal/silencer';
import {
  CAR_SPOT, DECK_Y, RAIL_R, RAMP, RAMP_FOOT, RAMP_LENGTH, RAMP_TOP, STAIR, STAIR_FOOT, STAIR_TOP, STAND, TERMINAL,
  carGround, notchPoint, rampRise, rampSlope, standHeight, standOutline, terminalFrame,
} from '../src/terminal/layout';

/**
 * Declared seats: posts and rails into what they stand on or end in, the flights' ends against the
 * drum, the cheeks over the drum, the coping over the drum's arris, the terminal's parts into one
 * another (the hood into the housing, the arms into the pedestal and the bosses, the keys on the ledge).
 */
const ALLOW: [string, string][] = [
  ['stand:set:rail', 'stand:drum'],
  ['stand:set:rail', 'stand:coping'],
  // The flights' rails end in the rim's newels, which stand on the flights' kerbs.
  ['stand:set:rail', 'stand:set:ramp-rail'],
  ['stand:set:rail', 'stand:set:stair-rail'],
  ['stand:set:rail', 'stand:ramp-cheek'],
  ['stand:set:rail', 'stand:stair-cheek'],
  ['stand:set:ramp-rail', 'stand:ramp-cheek'],
  ['stand:set:ramp-rail', 'stand:drum'],
  ['stand:set:stair-rail', 'stand:stair-cheek'],
  ['stand:set:stair-rail', 'stand:drum'],
  ['stand:ramp-cheek', 'stand:drum'],
  ['stand:ramp-cheek', 'stand:ramp'],
  ['stand:ramp-cheek', 'stand:coping'],
  ['stand:ramp-cheek', 'stand:plinth'],
  ['stand:ramp-joint', 'stand:ramp'],
  ['stand:ramp-joint', 'stand:drum'],
  ['stand:ramp-joint', 'stand:ramp-cheek'],
  ['stand:ramp-foot', 'stand:ramp'],
  ['stand:ramp-foot', 'stand:ramp-cheek'],
  ['stand:ramp', 'stand:plinth'],
  ['stand:ramp', 'stand:drum'],
  ['stand:stair', 'stand:drum'],
  ['stand:stair', 'stand:plinth'],
  ['stand:stair', 'stand:stair-cheek'],
  ['stand:stair-cheek', 'stand:drum'],
  ['stand:stair-cheek', 'stand:coping'],
  ['stand:stair-cheek', 'stand:plinth'],
  ['stand:set:stair-nosings', 'stand:stair'],
  ['stand:set:stair-nosings', 'stand:drum'],
  ['stand:coping', 'stand:drum'],
  ['stand:plinth', 'stand:drum'],
  ['terminal:base', 'stand:drum'],
  ['terminal:base', 'terminal:pedestal'],
  ['terminal:set:base-bolts', 'terminal:base'],
  ['terminal:shoulder', 'terminal:pedestal'],
  ['terminal:grille', 'terminal:pedestal'],
  ['terminal:arm', 'terminal:pedestal'],
  ['terminal:arm', 'terminal:shoulder'],
  ['terminal:arm', 'terminal:boss'],
  ['terminal:boss', 'terminal:housing'],
  ['terminal:hood', 'terminal:housing'],
  ['terminal:bezel', 'terminal:housing'],
  ['terminal:ledge', 'terminal:hood'],
  ['terminal:ledge', 'terminal:housing'],
  ['terminal:service-panel', 'terminal:housing'],
  ['terminal:set:vents', 'terminal:housing'],
  ['terminal:set:panel-bolts', 'terminal:service-panel'],
];

describe('the Stand', () => {
  const platform = buildPlatform();
  const term = buildConsole();
  const parts: NamedPart[] = [...platform.parts.list, ...term.parts.list];

  it('every part is a closed outward solid (sets: one per component)', () => {
    const single = topologyFailures(parts.filter((p) => !p.name.includes(':set:')));
    const sets = topologyFailures(parts.filter((p) => p.name.includes(':set:')), { maxComponents: 2000 });
    expect([...single, ...sets], describeTopology([...single, ...sets])).toEqual([]);
  });

  it('no coplanar overlap and no clash beyond declared seats', { timeout: 120_000 }, () => {
    const report = assemblyAudit(parts, STAND_SLOTS, ALLOW);
    expect(report.defects, JSON.stringify(report.defects.slice(0, 5))).toEqual([]);
    expect(report.zfight, JSON.stringify(report.zfight.slice(0, 8))).toEqual([]);
    expect(report.clash, JSON.stringify(report.clash.slice(0, 8))).toEqual([]);
  });
});


/** Distance from a point to a polygon's edges. */
function edgeDistance(x: number, z: number, loop: [number, number][]): number {
  let d = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const [ax, az] = loop[i];
    const [bx, bz] = loop[(i + 1) % loop.length];
    const ex = bx - ax;
    const ez = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
    d = Math.min(d, Math.hypot(x - ax - ex * t, z - az - ez * t));
  }
  return d;
}

describe('the Stand in the Gate Court', () => {
  // Its whole footprint: the drum, the ramp to its foot, the stair to its foot.
  const footprint: [number, number][] = [
    ...standOutline(48),
    notchPoint(RAMP.angle, RAMP_FOOT, RAMP.half + RAMP.cheek),
    notchPoint(RAMP.angle, RAMP_FOOT, -RAMP.half - RAMP.cheek),
    notchPoint(STAIR.angle, STAIR_FOOT, STAIR.half + STAIR.cheek),
    notchPoint(STAIR.angle, STAIR_FOOT, -STAIR.half - STAIR.cheek),
  ];

  it('keeps clear of the estate wall, its gateway, the gate\'s passage and the glass', () => {
    for (const [x, z] of footprint) {
      expect(edgeDistance(x, z, TERRACE_OUTLINE as [number, number][]), `wall at ${x.toFixed(1)},${z.toFixed(1)}`).toBeGreaterThan(1.5);
      expect(z, 'north of the gate\'s passage').toBeLessThan(-GATE.outerHalf + 2);
      expect(x < ESTATE_GATEWAY.x0 - 2 || z > -28, 'clear of the gateway\'s stub').toBe(true);
      expect(Math.hypot(x, z), 'inside the glass').toBeLessThan(DOME.a - 20);
    }
  });

  it('its ramp rises smoothly from the court to the deck', () => {
    let prev = rampRise(0);
    expect(prev).toBeCloseTo(RAMP.lip, 6);
    for (let s = 0.05; s <= RAMP_LENGTH; s += 0.05) {
      const h = rampRise(s);
      expect(h).toBeGreaterThanOrEqual(prev);
      // Continuous, and its slope never steeper than the grade a low car takes.
      expect(h - prev).toBeLessThan(0.05 * 0.1);
      expect(rampSlope(s)).toBeLessThan(0.1);
      prev = h;
    }
    expect(rampRise(RAMP_LENGTH)).toBeCloseTo(STAND.H, 6);
    const [x, z] = notchPoint(RAMP.angle, RAMP_TOP + 0.01, 0);
    expect(standHeight(x, z)! - DECK_Y).toBeGreaterThan(-0.001);
  });

  it('parks the car on the deck, inside the rails', () => {
    const fx = Math.sin(CAR_SPOT.yaw);
    const fz = Math.cos(CAR_SPOT.yaw);
    for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = CAR_SPOT.x + fx * a * CAR_FOOTPRINT.halfLength + fz * b * CAR_FOOTPRINT.halfWidth;
      const z = CAR_SPOT.z + fz * a * CAR_FOOTPRINT.halfLength - fx * b * CAR_FOOTPRINT.halfWidth;
      expect(Math.hypot(x - STAND.cx, z - STAND.cz)).toBeLessThan(RAIL_R - 0.3);
      expect(standHeight(x, z)).toBeCloseTo(DECK_Y, 6);
    }
  });

  const build = buildPlatform();
  const term = buildConsole();
  const walk = standWalk([...build.parts.list, ...term.parts.list], build.proxies, term.footprint);
  const { base, inward } = terminalFrame();
  const spot: [number, number] = [base[0] + inward[0] * TERMINAL.stand, base[2] + inward[1] * TERMINAL.stand];

  it('a walker climbs the ramp and the stair to the terminal, and cannot walk off the rim', () => {
    for (const [angle, foot] of [[RAMP.angle, RAMP_FOOT + 3], [STAIR.angle, STAIR_FOOT + 2]] as const) {
      const [x, z] = notchPoint(angle, foot, 0);
      const w = new TestWalker([walk]).place(x, z);
      expect(w.y).toBeCloseTo(FIELD_Y, 2);
      w.walk(STAND.cx - x, STAND.cz - z, Math.hypot(STAND.cx - x, STAND.cz - z));
      expect(w.y, `up the ${angle === RAMP.angle ? 'ramp' : 'stair'}`).toBeCloseTo(DECK_Y, 2);
      w.walk(spot[0] - w.x, spot[1] - w.z, Math.hypot(spot[0] - w.x, spot[1] - w.z));
      expect(Math.hypot(w.x - spot[0], w.z - spot[1])).toBeLessThan(TERMINAL.reach);
    }
    // Out toward the rim from the middle: the rails stop it on the deck; the terminal stops it too.
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 7) {
      const w = new TestWalker([walk]).place(STAND.cx, STAND.cz);
      w.walk(Math.cos(a), Math.sin(a), STAND.R + 3);
      const r = Math.hypot(w.x - STAND.cx, w.z - STAND.cz);
      if (r > STAND.R) expect(w.y < DECK_Y - 0.05 && r > STAND.R + 0.5, `left the deck at ${a.toFixed(2)} only down a flight`).toBe(true);
    }
    const into = new TestWalker([walk]).place(...spot).walk(base[0] - spot[0], base[2] - spot[1], 2);
    expect(Math.hypot(into.x - base[0], into.z - base[2])).toBeGreaterThan(0.45);
  });

  it('the car drives down the ramp between its cheeks, and holds still on it', { timeout: 60_000 }, () => {
    const walls = new CollisionWorld();
    addStandCarWalls(walls, term.carFootprint);
    const car = new Car([walls], carGround);
    car.park(CAR_SPOT.x, CAR_SPOT.z, CAR_SPOT.yaw);
    expect(car.groundY).toBeCloseTo(DECK_Y, 3);
    car.driven = true;
    const input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    for (let i = 0; i < 120; i++) car.update(1 / 60, input);
    input.throttle = 0.35;
    let pitched = false;
    for (let i = 0; i < 60 * 8; i++) {
      car.update(1 / 60, input);
      const [f, l] = [car.state.x - STAND.cx, car.state.z - STAND.cz];
      if (f > RAMP_TOP && f < RAMP_FOOT) {
        expect(Math.abs(l)).toBeLessThan(RAMP.half);
        if (car.group.rotation.x > 0.03) pitched = true;
      }
    }
    expect(car.state.x - STAND.cx).toBeGreaterThan(RAMP_FOOT + 2);
    expect(car.groundY).toBeCloseTo(FIELD_Y, 3);
    expect(pitched, 'nose down on the ramp').toBe(true);
    // Parked half way up, it stays.
    car.park(STAND.cx + RAMP_TOP + RAMP_LENGTH / 2, STAND.cz, -Math.PI / 2);
    const x0 = car.state.x;
    for (let i = 0; i < 180; i++) car.update(1 / 60, { throttle: 0, brake: 0, steer: 0, handbrake: false });
    expect(Math.abs(car.state.x - x0)).toBeLessThan(0.02);
  });
});

describe('the Stand\'s silencer', () => {
  it('takes the field away up the ramp and the stair, and gives it back coming down, without a step', () => {
    expect(standSilenceTarget(STAND.cx + 30, FIELD_Y, STAND.cz)).toBe(1);
    expect(standSilenceTarget(STAND.cx, DECK_Y, STAND.cz)).toBe(0);
    // Below the deck's edge, beside the drum, it is not on the Stand.
    expect(standSilenceTarget(STAND.cx, FIELD_Y, STAND.cz)).toBe(1);
    let prev = 1;
    for (let s = 0; s <= RAMP_LENGTH; s += 0.25) {
      const [x, z] = notchPoint(RAMP.angle, RAMP_FOOT - s, 0);
      const g = standSilenceTarget(x, FIELD_Y + rampRise(s), z);
      expect(g).toBeLessThanOrEqual(prev + 1e-9);
      prev = g;
    }
    expect(prev).toBeLessThan(0.01);
    // Followed over time: up the stair at a walk (1.4 m/s over its 0.9 m), no frame jumps more than 5 %.
    const sil = new StandSilencer();
    const dt = 1 / 60;
    let last = sil.gain;
    for (let i = 0; i < 240; i++) {
      const f = STAIR_FOOT - Math.min(1, (i * dt * 1.4) / (STAIR_FOOT - STAIR_TOP + 0.6)) * (STAIR_FOOT - STAIR_TOP + 0.6);
      const [x, z] = notchPoint(STAIR.angle, f, 0);
      const y = standHeight(x, z) ?? FIELD_Y;
      const g = sil.update(dt, x, y, z);
      expect(Math.abs(g - last)).toBeLessThan(0.05);
      last = g;
    }
    expect(last).toBeLessThan(0.05);
  });
});
