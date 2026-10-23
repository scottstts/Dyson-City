/**
 * The ship's dimensions (docs/intro-ship.md): every datum the hull, the cabin, the door, the stair
 * and the gear share, in the ship's own frame.
 *
 * Frame: metres, x forward (the nose), y up, z to starboard; the origin on the ground under the
 * hull's middle with the ship standing on its gear.
 *
 * The hull is a faceted body (geometry/convex.ts): the intersection of the planes below, every
 * edge chamfered. Flat composite panels, flat panes: an angular black ship, unlike the city's
 * gilded ivory curves.
 */
import { planeAt, type HalfSpace } from '../../geometry/convex';
import type { Vec3 } from '../../geometry/polyMesh';

const rad = (d: number) => (d * Math.PI) / 180;
const C = Math.cos;
const S = Math.sin;

/** Hull skin thickness (outer skin to inner skin), m. */
export const HULL_T = 0.14;

/** The cabin's floor (top of the deck plates) and the inner ceiling's liner. */
export const FLOOR_Y = 2.35;
export const CEILING_Y = 4.9;

/** The cabin's cross-section, constant from the tail taper to the nose taper. */
export const SECTION = {
  top: 5.15,
  belly: 1.5,
  /** Half-width of the flat top, where the roof facets start. */
  topHalf: 1.25,
  roofSlope: rad(22),
  /** The side facets: their line at y = sideY, leaning in by the tumblehome. */
  sideZ: 2.95,
  sideY: 3.2,
  tumblehome: rad(5),
  /** The belly chamfers: through (bellyHalf, belly) at bellySlope from the horizontal. */
  bellyHalf: 2.78,
  bellySlope: rad(36),
} as const;

/** Stations along x. */
export const STATION = {
  nose: 12.4,
  tail: -11.2,
} as const;

/** Named hull planes (indices into HULL_PLANES). */
export const HULL = {
  top: 0,
  belly: 1,
  roofS: 2,
  roofP: 3,
  sideS: 4,
  sideP: 5,
  bellyS: 6,
  bellyP: 7,
  windshield: 8,
  windshieldS: 9,
  windshieldP: 10,
  chin: 11,
  noseFace: 12,
  noseS: 13,
  noseP: 14,
  cheekS: 15,
  cheekP: 16,
  aft: 17,
  tailS: 18,
  tailP: 19,
  tailTop: 20,
  tailBelly: 21,
} as const;

function hullPlanes(): HalfSpace[] {
  const s = SECTION;
  const out: HalfSpace[] = [];
  out[HULL.top] = planeAt([0, 1, 0], [0, s.top, 0]);
  out[HULL.belly] = planeAt([0, -1, 0], [0, s.belly, 0]);
  for (const side of [1, -1]) {
    const roof = planeAt([0, C(s.roofSlope), side * S(s.roofSlope)], [0, s.top, side * s.topHalf]);
    const wall = planeAt([0, S(s.tumblehome), side * C(s.tumblehome)], [0, s.sideY, side * s.sideZ]);
    const chamfer = planeAt([0, -C(s.bellySlope), side * S(s.bellySlope)], [0, s.belly, side * s.bellyHalf]);
    out[side > 0 ? HULL.roofS : HULL.roofP] = roof;
    out[side > 0 ? HULL.sideS : HULL.sideP] = wall;
    out[side > 0 ? HULL.bellyS : HULL.bellyP] = chamfer;
  }
  // The windshield: inclined 42° from the horizontal, its wings turned 36° out.
  const ws = rad(48);
  out[HULL.windshield] = planeAt([C(ws), S(ws), 0], WINDSHIELD_POINT);
  const wing = rad(36);
  out[HULL.windshieldS] = planeAt([C(ws) * C(wing), S(ws), C(ws) * S(wing)], [9.1, 4.45, 1.05]);
  out[HULL.windshieldP] = planeAt([C(ws) * C(wing), S(ws), -C(ws) * S(wing)], [9.1, 4.45, -1.05]);
  // Under the windshield the chin falls forward to the nose plate.
  out[HULL.chin] = planeAt([C(rad(-28)), S(rad(-28)), 0], [11.6, 2.35, 0]);
  out[HULL.noseFace] = planeAt([1, 0, 0], [STATION.nose, 0, 0]);
  // The nose narrows: its cheeks turned 21° in, the lower nose sides 14°.
  out[HULL.noseS] = planeAt([S(rad(21)), 0.06, C(rad(21))], [7.6, 3.6, s.sideZ - 0.1]);
  out[HULL.noseP] = planeAt([S(rad(21)), 0.06, -C(rad(21))], [7.6, 3.6, -(s.sideZ - 0.1)]);
  out[HULL.cheekS] = planeAt([S(rad(26)), -S(rad(30)), C(rad(26)) * C(rad(30))], [9.4, 2.1, 1.9]);
  out[HULL.cheekP] = planeAt([S(rad(26)), -S(rad(30)), -C(rad(26)) * C(rad(30))], [9.4, 2.1, -1.9]);
  // The tail: aft of the cabin the body draws in to a wedge between the nacelles, its roof falling
  // and its belly rising to a small aft plate.
  out[HULL.aft] = planeAt([-1, 0, 0], [STATION.tail, 0, 0]);
  out[HULL.tailS] = planeAt([-S(rad(5.5)), 0, C(rad(5.5))], [-0.6, 0, s.sideZ + 0.05]);
  out[HULL.tailP] = planeAt([-S(rad(5.5)), 0, -C(rad(5.5))], [-0.6, 0, -(s.sideZ + 0.05)]);
  out[HULL.tailTop] = planeAt([-S(rad(6)), C(rad(6)), 0], [-0.8, s.top, 0]);
  out[HULL.tailBelly] = planeAt([-S(rad(5)), -C(rad(5)), 0], [-2.6, s.belly, 0]);
  return out;
}

/** A point on the windshield's centre facet. */
const WINDSHIELD_POINT: Vec3 = [9.55, 4.4, 0];

/** The hull's planes before chamfering. */
export const HULL_PLANES: readonly HalfSpace[] = hullPlanes();

/** Chamfer width across each hull edge (m): the long body lines wider than the nose's facets. */
export const HULL_BEVEL = 0.09;

/** The pilot's eye, seated (ship frame). */
export const EYE: Vec3 = [8.3, FLOOR_Y + 1.2, 0];

/**
 * The door (port side, on the side facet): its opening's centre and half-sizes. The opening runs
 * from under the floor (the stair slides out beneath the threshold) to 1.92 m over it.
 */
export const DOOR = {
  x: 3.55,
  bottom: 2.06,
  top: FLOOR_Y + 1.98,
  halfWidth: 0.64,
  corner: 0.16,
  /** The leaf's travel: out from the hull, then aft along it. */
  out: 0.11,
  aft: 1.62,
  /** Gap round the leaf in its opening. */
  gap: 0.008,
} as const;

/** The airstair: its run out and its pitch, deployed. */
export const STAIR = {
  width: 0.92,
  length: 3.55,
  /** Stringer depth and the treads' count. */
  depth: 0.16,
  treads: 10,
  /** Height of the stair's top face, stowed and sliding (under the threshold plate). */
  stowY: 2.27,
} as const;

/** The starboard pod: its axis (y, z), half-sizes, and its ends along x. */
export const NACELLE = {
  y: 3.82,
  z: 5.05,
  halfWidth: 0.86,
  halfHeight: 0.92,
  /** Half-width of its flat roof and floor, where the chamfers start. */
  flat: 0.42,
  front: 0.9,
  rear: -12.9,
  wall: 0.1,
  /** The intake opening on the raked front face, and the nozzle's throat on the aft plate. */
  intake: { hw: 0.56, hh: 0.21, r: 0.1 },
  nozzle: { r: 0.52 },
} as const;

/** The nozzle throat's centre on the pod's aft plate (starboard). */
export const NOZZLE_CENTRE: Vec3 = [NACELLE.rear, NACELLE.y - 0.03, NACELLE.z - 0.09];
