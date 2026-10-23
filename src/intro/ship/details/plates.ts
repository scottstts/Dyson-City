/**
 * Doubler plates (docs/intro-ship.md, "Exterior fittings"): the skin's structure shown on its
 * face. Where a facet is carried over a frame or opened for service, a plate is bonded over it,
 * standing 14 mm proud; some carry a lift handle. Unseamed (their edges are the joint), they break
 * the long facets into the large-scale patchwork a working hull has.
 */
import { extrudeBevel, tube, type Basis } from '../../../geometry/solids';
import type { Vec3 } from '../../../geometry/polyMesh';
import { roundedRect } from '../../../geometry/sweep';
import { HULL_BEVELLED } from '../hull';
import { mirrorZ, NAC, NACELLE_PLANES } from '../nacelle';
import { HULL } from '../spec';
import { SHIP_SLOT as S } from '../slots';
import type { ShipParts } from '../parts';
import { facetFrame, footprint, frameAt, SINK } from './mount';

interface Plate {
  body: 'hull' | 'nacelle';
  plane: number;
  /** A point near the plate's centre (projected onto the facet), its half-sizes, a handle. */
  at: Vec3;
  hx: number;
  hy: number;
  handle?: boolean;
  /** Mirrored to port (named -s/-p). */
  mirror?: boolean;
}

const PLATES: readonly Plate[] = [
  // The starboard side.
  { body: 'hull', plane: HULL.sideS, at: [-0.05, 2.9, 2.9], hx: 0.36, hy: 0.32, handle: true },
  { body: 'hull', plane: HULL.sideS, at: [1.05, 2.6, 2.9], hx: 0.55, hy: 0.5 },
  { body: 'hull', plane: HULL.sideS, at: [2.9, 3.35, 2.9], hx: 0.9, hy: 0.7, handle: true },
  { body: 'hull', plane: HULL.sideS, at: [5.2, 2.75, 2.9], hx: 0.6, hy: 0.55 },
  { body: 'hull', plane: HULL.sideS, at: [6.55, 3.6, 2.9], hx: 0.4, hy: 0.4, handle: true },
  // The port side, round the door and its keypad.
  { body: 'hull', plane: HULL.sideP, at: [-0.05, 2.9, -2.9], hx: 0.36, hy: 0.32, handle: true },
  { body: 'hull', plane: HULL.sideP, at: [1.3, 3.0, -2.9], hx: 0.6, hy: 0.8, handle: true },
  { body: 'hull', plane: HULL.sideP, at: [5.6, 2.8, -2.9], hx: 0.5, hy: 0.5 },
  { body: 'hull', plane: HULL.sideP, at: [6.6, 3.7, -2.9], hx: 0.4, hy: 0.35 },
  // The roof, its slopes, the tail.
  { body: 'hull', plane: HULL.top, at: [2.2, 5.15, 0.78], hx: 0.55, hy: 0.26, mirror: true },
  { body: 'hull', plane: HULL.top, at: [5.0, 5.15, 0.8], hx: 0.9, hy: 0.26, mirror: true },
  { body: 'hull', plane: HULL.roofS, at: [1.0, 4.85, 2.05], hx: 1.0, hy: 0.35, mirror: true, handle: true },
  { body: 'hull', plane: HULL.roofS, at: [4.6, 4.85, 2.05], hx: 1.3, hy: 0.35, mirror: true },
  { body: 'hull', plane: HULL.tailTop, at: [-4.0, 4.8, 1.3], hx: 0.9, hy: 0.35, mirror: true },
  { body: 'hull', plane: HULL.tailTop, at: [-8.5, 4.3, 0.9], hx: 1.1, hy: 0.4, mirror: true, handle: true },
  { body: 'hull', plane: HULL.tailS, at: [-8.6, 3.1, 2.4], hx: 1.0, hy: 0.55, mirror: true, handle: true },
  // The belly.
  { body: 'hull', plane: HULL.belly, at: [5.2, 1.5, 1.6], hx: 1.2, hy: 0.5, mirror: true },
  { body: 'hull', plane: HULL.belly, at: [-1.2, 1.5, 0.9], hx: 0.9, hy: 0.4, mirror: true, handle: true },
  // The nacelles (starboard; mirrored).
  { body: 'nacelle', plane: NAC.outboard, at: [-3.85, 3.82, 5.9], hx: 0.75, hy: 0.26, mirror: true },
  { body: 'nacelle', plane: NAC.outboard, at: [-6.6, 3.82, 5.9], hx: 1.3, hy: 0.26, mirror: true, handle: true },
  { body: 'nacelle', plane: NAC.top, at: [-3.6, 4.74, 5.05], hx: 0.9, hy: 0.26, mirror: true },
];

export function buildPlates(parts: ShipParts): void {
  PLATES.forEach((p, i) => {
    const planes = p.body === 'hull' ? HULL_BEVELLED : NACELLE_PLANES;
    // Port side facets: u aft, so v runs up them as it does to starboard.
    const hint: Vec3 = p.plane === HULL.sideP ? [-1, 0, 0] : [1, 0, 0];
    const b = facetFrame(planes[p.plane], p.at, hint);
    const name = `plate-${i}`;
    const host = p.body === 'hull' ? 'hull' : 'nacelle';
    const plate = extrudeBevel(roundedRect(p.hx, p.hy, 0.05, 4), b, -SINK, 0.014, 0.004, S.hullPlate);
    const grip = p.handle ? handle(b, p.hx) : null;
    footprint(parts, name, p.body, p.plane, b, p.hx, p.hy);
    if (p.mirror) {
      for (const [side, m, g] of [['s', plate, grip], ['p', mirrorZ(plate), grip && mirrorZ(grip)]] as const) {
        parts.add(`${name}-${side}`, m);
        parts.seat(`${name}-${side}`, p.body === 'hull' ? host : `${host}-${side}`);
        if (g) {
          parts.add(`${name}-grip-${side}`, g);
          parts.seat(`${name}-grip-${side}`, `${name}-${side}`);
        }
      }
    } else {
      parts.add(name, plate);
      parts.seat(name, host);
      if (grip) {
        parts.add(`${name}-grip`, grip);
        parts.seat(`${name}-grip`, name);
      }
    }
  });
}

/** A lift handle near a plate's end: a bar on two legs. */
function handle(b: Basis, hx: number) {
  const p = (x: number, z: number): Vec3 => frameAt(b, hx - 0.16 + x, 0, z);
  return tube([{ p: p(-0.06, 0.01), r: 0.009 }, { p: p(-0.06, 0.04), r: 0.009 }, { p: p(0.06, 0.04), r: 0.009 }, { p: p(0.06, 0.01), r: 0.009 }], 10, S.titanium);
}
