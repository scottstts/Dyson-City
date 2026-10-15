/**
 * The East Lock (docs/east-lock.md, city_plan.md §6): the craft airlock through the Dome's skin in
 * the East Collar, the West Gate's construction at craft size. Single source of truth for its
 * dimensions.
 *
 * Modelled in the West Gate's frame (the city toward +x, the band toward −x) and mirrored onto
 * the east cardinal (world x = −x): `toWorld` and `mirrorMesh` do the mapping. In that frame:
 * two sector gates with identical leaves, convex toward the higher pressure (the chamber against
 * the band, the city against the vented chamber), each opening by rotating up about its trunnions.
 */
import { PAD_HEIGHT } from '../../ground/site';
import type { PolyMesh, Vec3 } from '../../geometry/polyMesh';

const R = 34;
/** Chamber floor: a basalt slab 60 mm proud of the platform; seals on sills 30 mm above it. */
const FLOOR = PAD_HEIGHT + 0.06;
const SEAL = FLOOR + 0.03;
const BOTTOM = (-30 * Math.PI) / 180;
/** Clear opening: 30 m over the floor. */
const CLEAR_TOP = FLOOR + 30;
const TRUNNION_Y = SEAL - R * Math.sin(BOTTOM);
const deg = Math.PI / 180;
const trunnionX = (lipX: number) => lipX - R * Math.cos(BOTTOM);

/** Leaf skin's top seal radius margin and the head faces just outside the swept annulus. */
const headFace = (xt: number) => xt + Math.sqrt((R + 0.05) ** 2 - (CLEAR_TOP - TRUNNION_Y) ** 2);

export const LOCK = {
  R,
  skin: 0.12,
  floor: FLOOR,
  seal: SEAL,
  thetaBottom: BOTTOM,
  thetaTop: Math.asin((CLEAR_TOP - TRUNNION_Y) / R),
  openAngle: 62 * deg,
  clearTop: CLEAR_TOP,
  trunnionY: TRUNNION_Y,
  outerLipX: -534,
  innerLipX: -474,
  outerTrunnionX: trunnionX(-534),
  innerTrunnionX: trunnionX(-474),
  /** Clear passage between the piers, and the piers' outer faces (10 m thick). */
  passageHalf: 26,
  outerHalf: 36,
  /** The gatehouse block (frame x). */
  westX: -573,
  eastX: -466,
  headWestX: headFace(trunnionX(-534)),
  vaultWestX: headFace(trunnionX(-534)) + 2.0,
  vaultEastX: headFace(trunnionX(-474)),
  /** Chamber vault (segmental), roof, and where the Spinward rails land on it. */
  springY: 53.5,
  crownY: 56.5,
  topY: 59.5,
  railY: 57.5,
  /** Hood over the outer leaf's open position (radii about the outer trunnion axis). */
  hoodInner: R + 1.4,
  hoodOuter: R + 2.6,
  hoodEndX: -572.4,
  /** Leaf: skin half-width, main girder angles, arm frames (each side) and hubs. */
  leafHalf: 26 - 0.1,
  girders: [-21 * deg, -2 * deg, 15 * deg] as readonly number[],
  girderDepth: 1.7,
  armZ: 25.2,
  armHalf: 0.55,
  hubR: 2.9,
  /** Hoists: fixed pivot (polar about the trunnion), moving pivot radius on the upper strut. */
  hoistA: { r: R + 0.5, theta: 100 * deg },
  hoistB: 15,
  hoistZ: 24.0,
} as const;

/** Where the glass stops round the gatehouse (east cardinal), and the bronze trim it stops on. */
export const LOCK_OPENING = { halfWidth: LOCK.outerHalf, top: LOCK.topY, trim: 0.6 } as const;

/** Leaf angle at openness s ∈ [0, 1]. */
export function lockLeafAngle(s: number): number {
  return LOCK.openAngle * s;
}

/** The lock's frame → world (mirror in x). */
export function toWorld(p: Vec3): Vec3 {
  return [-p[0], p[1], p[2]];
}

/** Mirrors a mesh built in the lock's frame onto the east cardinal (faces re-wound to stay outward). */
export function mirrorMesh<M extends PolyMesh>(m: M): M {
  m.verts = m.verts.map(toWorld);
  m.faces = m.faces.map((f) => [...f].reverse());
  m.uvs = m.uvs.map((u) => [...u].reverse());
  return m;
}
