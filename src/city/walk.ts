/**
 * Where the walker can go in the city's structure: the Dome's glass and sill are a wall (inside and
 * outside), the gatehouse's piers and the closed leaves are walls, the frame's plinths stand on the
 * steps; the chamber's basalt floor and the apron outside are walkable surfaces a few centimetres
 * above the platform and deck.
 */
import { CollisionWorld } from '../player/collision';
import { groundHeight } from '../ground/site';
import { DOME, GATE_OPENING, LAYER, POST_T1_SILL, MEMBER, SILL } from './dome/spec';
import type { FrameLayout } from './dome/frame';
import { GATE } from './gate/spec';
import { DIAL, VENTS } from './gate/gatehouse';

export interface CityWalk {
  readonly walls: CollisionWorld;
  ground(x: number, z: number): number;
}

const RING_SEGMENTS = 2880;

export function buildWalk(layout: FrameLayout): CityWalk {
  const walls = new CollisionWorld();
  const gap = (x: number, z: number) => x < 0 && Math.abs(z) < GATE_OPENING.halfWidth + 0.05;
  // The glass from inside (the sill's inner face) and from outside (clear of the sill).
  for (const r of [SILL.rIn, DOME.a + 0.25]) {
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const a0 = (2 * Math.PI * i) / RING_SEGMENTS;
      const a1 = (2 * Math.PI * (i + 1)) / RING_SEGMENTS;
      const p0: [number, number] = [r * Math.cos(a0), r * Math.sin(a0)];
      const p1: [number, number] = [r * Math.cos(a1), r * Math.sin(a1)];
      if (gap(...p0) || gap(...p1)) continue;
      walls.addSegment(p0[0], p0[1], p1[0], p1[1]);
    }
  }
  // Piers (with their base course on the end faces).
  for (const s of [-1, 1]) walls.addBox(GATE.westX - 0.18, s * GATE.passageHalf, GATE.eastX + 0.18, s * GATE.outerHalf);
  // Vents and the dial stand off the piers' inner faces.
  for (const s of [-1, 1]) for (const xc of VENTS) walls.addBox(xc - 1.1, s * (GATE.passageHalf - 0.2), xc + 1.1, s * GATE.passageHalf);
  walls.addBox(DIAL.x - DIAL.radius - 0.1, DIAL.side * (GATE.passageHalf - 0.26), DIAL.x + DIAL.radius + 0.1, DIAL.side * GATE.passageHalf);
  // The leaves, while not fully open.
  walls.addBox(GATE.outerLipX - 0.25, -GATE.passageHalf, GATE.outerLipX + 0.45, GATE.passageHalf, 'gate:outer');
  walls.addBox(GATE.innerLipX - 0.3, -GATE.passageHalf, GATE.innerLipX + 0.4, GATE.passageHalf, 'gate:inner');
  // Plinths under the frame's feet.
  for (const f of layout.feet) {
    const p = f.curve(f.u);
    const out = [p[0], p[2]];
    const len = Math.hypot(out[0], out[1]);
    const ox = out[0] / len;
    const oz = out[1] / len;
    const hw = MEMBER[f.kind].halfWidth + 0.08;
    const r0 = DOME.a + LAYER.memberT0Sill - 0.07;
    const r1 = DOME.a + POST_T1_SILL;
    const at = (r: number, s: number): [number, number] => [ox * r - oz * s, oz * r + ox * s];
    walls.addPolygon([at(r0, -hw), at(r1, -hw), at(r1, hw), at(r0, hw)]);
  }
  return {
    walls,
    ground(x, z) {
      const g = groundHeight(x, z);
      // Chamber floor slab (chamfered ends).
      if (Math.abs(z) < GATE.passageHalf && x > -499.6 && x < -472.4) {
        const ramp = Math.min(1, (x + 499.6) / 0.035, (-472.4 - x) / 0.035);
        return Math.max(g, DOME.centreY + 0.015 + (GATE.floor - DOME.centreY - 0.015) * Math.max(ramp, 0));
      }
      // Apron outside the outer gate.
      const r = Math.hypot(x, z);
      const inApron = (Math.abs(z) < GATE.passageHalf - 0.01 && r > 502.42 && x > GATE.westX - 0.19) || (x <= GATE.westX - 0.19 && x > -560 && Math.abs(z) < 20);
      if (inApron) return g + 0.015;
      return g;
    },
  };
}
