import { describe, expect, it } from 'vitest';
import { frameLayout } from '../src/city/dome/frame';
import { buildWalk } from '../src/city/walk';
import { GATE } from '../src/city/gate/spec';
import { StarVisibility, domeStarVisibility } from '../src/city/visibility';
import { adaptationTarget, adaptStep, ADAPT_MAX } from '../src/render/adaptation';

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
  });
});

describe('eye adaptation', () => {
  it('leaves bright views alone and opens up at most four stops in dim ones', () => {
    expect(adaptationTarget(Math.log(1))).toBe(1);
    expect(adaptationTarget(Math.log(0.0005))).toBe(ADAPT_MAX);
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
