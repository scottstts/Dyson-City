/**
 * The West Gate: single source of truth for the airlock's dimensions (metres, world frame; the gate
 * lies on the Spinward axis, z = 0, at the Dome's west cardinal). See docs/gate.md.
 *
 * Both gates are sector (tainter) gates with identical leaves: a cylindrical skin of radius R about
 * a horizontal trunnion axis (along z) west of it, convex toward the east, where the higher
 * pressure always is (the chamber holds 1 bar against the band; the city holds 1 bar against the
 * vented chamber). A leaf opens by rotating up about its trunnions through OPEN_ANGLE.
 */
import { PAD_HEIGHT } from '../../ground/site';

const R = 16;
/** Chamber floor: a basalt slab 50 mm proud of the platform. */
const FLOOR = PAD_HEIGHT + 0.05;
/** Leaves seal on bronze sill plates 20 mm proud of the floor. */
const SEAL = FLOOR + 0.02;
const BOTTOM = (-30 * Math.PI) / 180;
const CLEAR_TOP = 15.2;
const TRUNNION_Y = SEAL - R * Math.sin(BOTTOM);
const deg = Math.PI / 180;

function trunnionX(lipX: number): number {
  return lipX - R * Math.cos(BOTTOM);
}

export const GATE = {
  R,
  floor: FLOOR,
  seal: SEAL,
  /** Skin span in the closed pose (angles about the trunnion, from +x, counter-clockwise up). */
  thetaBottom: BOTTOM,
  thetaTop: Math.asin((CLEAR_TOP - TRUNNION_Y) / R),
  openAngle: 62 * deg,
  clearTop: CLEAR_TOP,
  trunnionY: TRUNNION_Y,
  /** Lip (bottom seal) lines of the two leaves. */
  outerLipX: -499.0,
  innerLipX: -473.0,
  outerTrunnionX: trunnionX(-499.0),
  innerTrunnionX: trunnionX(-473.0),
  /** Clear passage between the piers' inner faces, and the piers' outer faces. */
  passageHalf: 9,
  outerHalf: 16,
  /** The gatehouse block. */
  westX: -518,
  eastX: -470,
  /** West face of the head over the outer gate (its bottom is the outer leaf's top seal). */
  headWestX: -497.95,
  /** East face of the outer head / west face of the chamber vault. */
  vaultWestX: -496.0,
  vaultEastX: -471.95,
  /** Chamber vault: segmental, springing and crown heights. */
  springY: 26,
  crownY: 29,
  /** Roof (head between the piers) and pier tops. */
  topY: 31,
  /** Hood over the open outer leaf: shell radii about the outer trunnion axis. */
  hoodInner: 17.4,
  hoodOuter: 18.6,
  hoodEndX: -517.4,
  /** Leaf: skin half-width (along z), skin plate thickness, main girder angles. */
  leafHalf: 8.9,
  skin: 0.08,
  girders: [-16 * deg, 8 * deg] as readonly number[],
  /** Arm frames (one each side) and hubs. */
  armZ: 8.6,
  armHalf: 0.25,
  hubR: 1.4,
  /** Hoists: fixed pivot (polar about the trunnion), moving pivot radius on the upper strut. */
  hoistA: { r: 17.0, theta: 100 * deg },
  hoistB: 8,
  hoistZ: 7.7,
} as const;

/** Angle (rad) of a leaf at openness s ∈ [0, 1]. */
export function leafAngle(s: number): number {
  return GATE.openAngle * s;
}
