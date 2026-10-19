/**
 * Where the walker and the car may go on and round the Stand (docs/terminal.md):
 *
 *  - the walker: one walk mesh from the Stand's own surfaces (the deck, the ramp, the treads, the
 *    cheeks' tops are floors; the drum and the cheeks are walls), with invisible fences along the
 *    balustrade's lines and a block round the terminal (the rails are too fine to walk against);
 *  - the car: plan walls. The drum (open where the ramp meets it), the cheeks, the balustrade's
 *    runs set in by the car's clearance from the posts, and the terminal. On the deck it is kept
 *    inside the rails; outside, off the drum; on the ramp, between its cheeks.
 */
import { WalkMesh } from '../player/walkMesh';
import { CollisionWorld } from '../player/collision';
import { emitParts, type PolyMesh } from '../geometry/polyMesh';
import { extrudeBevel } from '../geometry/solids';
import type { GroundSurface } from '../city/walk';
import type { Part } from '../field/kit/parts';
import { DECK_Y, RAIL_R, RAMP, RAMP_FOOT, RAMP_OUTER, RAMP_TOP, STAND, notchPoint, railRuns, standHeight, standOutline } from './layout';

/** Parts the walker meets as they are (not too fine to walk against). */
const SOLID = /^stand:(drum|plinth|coping|ramp|ramp-cheek|stair|stair-cheek|ramp-joint|ramp-foot|set:stair-nosings)/;

function add(walk: WalkMesh, m: PolyMesh, walls = true): void {
  const g = emitParts([m], { slots: 64 });
  walk.add(g.getAttribute('position').array as Float32Array, g.getIndex()!.array as Uint32Array, { walls });
}

export function standWalk(parts: readonly Part[], proxies: readonly PolyMesh[], terminalFootprint: [number, number][]): WalkMesh {
  const walk = new WalkMesh();
  for (const p of parts) if (SOLID.test(p.name)) add(walk, p.mesh);
  for (const p of proxies) add(walk, p);
  // The terminal: a block over its base's footprint, head high.
  const loop = terminalFootprint.map(([x, z]) => [x, -z] as [number, number]);
  add(walk, extrudeBevel(loop, { o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, -1], w: [0, 1, 0] }, DECK_Y - 0.05, DECK_Y + 1.95, 0));
  return walk;
}

/** The car's walls round the Stand, added to a plan collision world. */
export function addStandCarWalls(walls: CollisionWorld, terminalFootprint: [number, number][]): void {
  // The drum, open across the ramp's chord.
  const outline = standOutline();
  const n = outline.length;
  const [ax, az] = notchPoint(RAMP.angle, RAMP_TOP, -RAMP_OUTER);
  const [bx, bz] = notchPoint(RAMP.angle, RAMP_TOP, RAMP_OUTER);
  for (let i = 0; i < n; i++) {
    const p = outline[i];
    const q = outline[(i + 1) % n];
    const chord = (Math.hypot(p[0] - ax, p[1] - az) < 1e-6 && Math.hypot(q[0] - bx, q[1] - bz) < 1e-6) || (Math.hypot(p[0] - bx, p[1] - bz) < 1e-6 && Math.hypot(q[0] - ax, q[1] - az) < 1e-6);
    if (!chord) walls.addSegment(p[0], p[1], q[0], q[1]);
  }
  // The cheeks (both faces), from the deck's kerb ends to the ramp's foot.
  for (const side of [-1, 1]) {
    const l0 = side * RAMP.half;
    const l1 = side * RAMP_OUTER;
    walls.addPolygon([notchPoint(RAMP.angle, RAMP_TOP - 0.3, l0), notchPoint(RAMP.angle, RAMP_FOOT + 0.02, l0), notchPoint(RAMP.angle, RAMP_FOOT + 0.02, l1), notchPoint(RAMP.angle, RAMP_TOP - 0.3, l1)]);
  }
  // The balustrade's runs, 0.12 m in from the posts' centres.
  const r = RAIL_R - 0.12;
  for (const { a0, a1 } of railRuns()) {
    const steps = Math.max(2, Math.ceil(((a1 - a0) * r) / 0.5));
    for (let i = 0; i < steps; i++) {
      const u0 = a0 + ((a1 - a0) * i) / steps;
      const u1 = a0 + ((a1 - a0) * (i + 1)) / steps;
      walls.addSegment(STAND.cx + r * Math.cos(u0), STAND.cz + r * Math.sin(u0), STAND.cx + r * Math.cos(u1), STAND.cz + r * Math.sin(u1));
    }
  }
  // The terminal.
  walls.addPolygon(terminalFootprint);
}

/** What is underfoot on the Stand (footsteps): basalt on the deck, the ramp and the treads. */
export function standSurface(x: number, z: number, y: number): GroundSurface | null {
  const h = standHeight(x, z);
  return h !== null && Math.abs(y - h) < 0.3 ? 'basalt' : null;
}

/** The Stand's floor for the star-shade (its texels march from the deck, not the pad). */
export function standFloor(x: number, z: number): number | null {
  return standHeight(x, z);
}
