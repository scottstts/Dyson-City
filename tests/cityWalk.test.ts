import { describe, expect, it } from 'vitest';
import { frameLayout } from '../src/city/dome/frame';
import { buildWalk } from '../src/city/walk';
import { GATE } from '../src/city/gate/spec';
import { StarVisibility, domeStarVisibility } from '../src/city/visibility';
import { adaptationTarget, adaptStep, ADAPT_MAX, ADAPT_REF } from '../src/render/adaptation';

describe('walls and walkable surfaces', () => {
  const walk = buildWalk(frameLayout());
  const go = (x: number, z: number, dx: number, dz: number, n = 400) => {
    let p: [number, number] = [x, z];
    for (let i = 0; i < n; i++) p = walk.walls.move(p[0], p[1], dx / n, dz / n, 0.3);
    return p;
  };

  it('the glass is a wall from inside and outside', () => {
    expect(Math.hypot(...go(400, 200, 300, 150))).toBeLessThan(499.5);
    expect(Math.hypot(...go(-300, 500, 200, -100))).toBeGreaterThan(499.7);
  });

  it('the closed gates block the passage; open, it leads through the airlock into the city', () => {
    walk.walls.setEnabled('gate:outer', true);
    walk.walls.setEnabled('gate:inner', true);
    expect(go(-540, 0, 100, 0)[0]).toBeLessThan(GATE.outerLipX);
    walk.walls.setEnabled('gate:outer', false);
    walk.walls.setEnabled('gate:inner', false);
    expect(go(-540, 0, 100, 0)[0]).toBeGreaterThan(-445);
    // The piers keep a walker in the passage.
    expect(Math.abs(go(-485, 0, 0, 30)[1])).toBeLessThan(GATE.passageHalf);
  });

  it('the chamber floor and the apron are walkable a few centimetres up', () => {
    expect(walk.ground(-485, 0)).toBeCloseTo(GATE.floor, 3);
    expect(walk.ground(-530, 0)).toBeCloseTo(0.015, 3);
  });
});

describe('star visibility', () => {
  const v = new StarVisibility(0.5);
  it('is full in the open, reduced under the Dome, nil in the chamber', () => {
    expect(v.at({ x: -620, y: 1.7, z: 0 })).toEqual({ visible: 1, transmission: 1 });
    const dome = domeStarVisibility();
    expect(dome).toBeGreaterThan(0.75);
    expect(dome).toBeLessThan(0.97);
    expect(v.at({ x: 0, y: 2.9, z: 0 }).visible).toBeCloseTo(dome, 5);
    // Under the tinted glass the star's glare is halved; its halation (the clipped disc) is not.
    expect(v.at({ x: 0, y: 2.9, z: 0 }).transmission).toBe(0.5);
    expect(v.at({ x: -485, y: 2.95, z: 0 }).visible).toBe(0);
  });  it('fades under a roof as the eye walks in, never stepping', () => {
    // A 10 m square roof 4 m up (a porch), its slab 0.3 m thick, on a 0.25 m occluder map.
    const N = 128;
    const cell = 0.25;
    const map = new Float32Array(N * N * 2);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = 2 * (j * N + i);
        const x = i * cell - 16;
        const z = j * cell - 16;
        const roof = Math.abs(x) < 5 && Math.abs(z) < 5;
        map[k] = roof ? 4 : 1e9;
        map[k + 1] = roof ? 4.3 : -1e9;
      }
    }
    const s = new StarVisibility(1);
    s.addOccluders({ grid: { N, originX: -16, originZ: -16, cell }, map, top: 4.3 });
    // (At the datum, under the Dome: its frame's share applies on top.)
    let prev = s.at({ x: -14, y: 1.7, z: 0 }).visible;
    expect(prev).toBeCloseTo(domeStarVisibility(), 5);
    for (let x = -13.75; x <= 0; x += 0.25) {
      const now = s.at({ x, y: 1.7, z: 0 }).visible;
      expect(now).toBeLessThanOrEqual(prev + 1e-9);
      expect(prev - now).toBeLessThan(0.15);
      prev = now;
    }
    // Under the middle of the roof the star is hidden.
    expect(prev).toBe(0);
  });
});

describe('eye adaptation', () => {
  it('leaves bright views alone, adapts fully to the Dome, partly to interiors', () => {
    expect(adaptationTarget(Math.log(1))).toBe(1);
    // The estate under the Dome (~0.18) is brought fully to the key.
    expect(adaptationTarget(Math.log(0.18)) * 0.18).toBeCloseTo(ADAPT_REF, 6);
    // Darker places read darker, but legible: shortfall below the key, in stops.
    const shortfall = (L: number) => Math.log2(ADAPT_REF / (L * adaptationTarget(Math.log(L))));
    const dayRoom = shortfall(0.18 / 2 ** 8);
    const hall = shortfall(0.18 / 2 ** 11);
    expect(dayRoom).toBeGreaterThan(0.8);
    expect(dayRoom).toBeLessThan(1.8);
    expect(hall).toBeGreaterThan(dayRoom);
    expect(hall).toBeLessThan(2.5);
    expect(adaptationTarget(Math.log(1e-9))).toBe(ADAPT_MAX);
    let prev = 0;
    for (let s = 0; s < 20; s += 0.1) {
      const t = adaptationTarget(Math.log(2 ** -s));
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });
  it('opens slowly and clamps down fast', () => {
    let up = 1;
    for (let i = 0; i < 60; i++) up = adaptStep(up, 16, 1 / 60);
    let down = 16;
    for (let i = 0; i < 60; i++) down = adaptStep(down, 1, 1 / 60);
    expect(up).toBeLessThan(8);
    // Within ~0.2 stop of the outdoor exposure after a second.
    expect(down).toBeLessThan(1.15);
  });
});
