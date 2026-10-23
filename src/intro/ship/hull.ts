/**
 * The hull (docs/intro-ship.md): one faceted thick shell, every edge chamfered, pierced by the
 * cockpit's panes and the door. The panes themselves are not geometry: the glass is composited
 * analytically in post (canopy.ts), so this module also publishes each pane's outline.
 */
import { clipPolygon, convexFaces, facetedShell, inset, insetConvex, roundedPolygonLoop, simplifyConvex, withBevels, type Aperture, type HalfSpace } from '../../geometry/convex';
import { v3, type Vec3 } from '../../geometry/polyMesh';
import type { PolyMesh } from '../../geometry/polyMesh';
import { DOOR, HULL, HULL_BEVEL, HULL_PLANES, HULL_T } from './spec';
import { SHIP_SLOT } from './slots';
import { LEGS } from './gear';
import { VENTS } from './engines';

/** The chamfered hull planes (the originals first, so HULL indices still name them). */
export const HULL_BEVELLED: readonly HalfSpace[] = withBevels(HULL_PLANES, () => HULL_BEVEL);

/**
 * A cockpit pane: a glazed facet. The glass fills its facet clipped to the glazing's bounds, inset
 * by a frame of even width with rounded corners, so every pane follows its facet and every mullion
 * is the same width: the faceted canopy's look.
 */
export interface Pane {
  name: string;
  plane: number;
  /** The glass's outline on the outer skin's plane (counter-clockwise about the plane's normal). */
  outline: Vec3[];
  /** The same outline before its corners were rounded, and the rounding radius. */
  core: Vec3[];
  r: number;
}

/** How far each pane sits in from the outer skin (m), the frame round it and its corner radius. */
export const GLASS_INSET = 0.05;
export const PANE_FRAME = 0.07;
export const PANE_CORNER = 0.09;

/** The glazed facets, each clipped (inside: n·x ≤ d) to where the glass ends. */
const GLAZING: readonly { name: string; plane: number; clip: HalfSpace[] }[] = [
  // Down to the coaming over the instruments; up to the roof.
  { name: 'windshield', plane: HULL.windshield, clip: [{ n: [0, -1, 0], d: -2.98 }] },
  { name: 'windshield-s', plane: HULL.windshieldS, clip: [{ n: [0, -1, 0], d: -2.98 }, { n: [-1, 0, 0], d: -7.92 }] },
  { name: 'windshield-p', plane: HULL.windshieldP, clip: [{ n: [0, -1, 0], d: -2.98 }, { n: [-1, 0, 0], d: -7.92 }] },
];

function buildPanes(): Pane[] {
  const outerFaces = convexFaces(HULL_BEVELLED);
  const innerFaces = convexFaces(inset(HULL_BEVELLED, HULL_T));
  return GLAZING.map((g) => {
    const pl = HULL_BEVELLED[g.plane];
    const inner = innerFaces.find((f) => f.plane === g.plane);
    if (!outerFaces.some((f) => f.plane === g.plane) || !inner) throw new Error(`pane ${g.name}: its facet is missing`);
    // The inner skin's face, carried out to the outer plane: the smaller of the two.
    let poly = inner.loop.map((p) => v3.add(p, v3.scale(pl.n, HULL_T)));
    for (const c of g.clip) poly = clipPolygon(poly, c);
    const core = simplifyConvex(insetConvex(poly, pl.n, PANE_FRAME + PANE_CORNER));
    const outline = roundedPolygonLoop(core, pl.n, PANE_CORNER);
    return { name: g.name, plane: g.plane, outline, core, r: PANE_CORNER };
  });
}

export const PANES: readonly Pane[] = buildPanes();

/** The door's opening in the port side facet. */
export function doorAperture(): Aperture {
  const n = HULL_PLANES[HULL.sideP].n;
  const cy = (DOOR.bottom + DOOR.top) / 2;
  // The facet leans in by the tumblehome: its v runs up it, so the height along it is a touch more.
  const lean = Math.hypot(n[1], n[2]);
  const hh = (DOOR.top - DOOR.bottom) / 2 / Math.abs(n[2] / lean);
  return { plane: HULL.sideP, centre: [DOOR.x, cy, -3], u: [1, 0, 0], hw: DOOR.halfWidth, hh, r: DOOR.corner, slot: SHIP_SLOT.reveal };
}

export function paneAperture(p: Pane): Aperture {
  // A pane's reveal is inside the glass: it is lit as the cabin is, through the (shaded) glass.
  return { plane: p.plane, outline: p.outline, slot: SHIP_SLOT.paneReveal };
}

/** An opening in a floor (the belly, a nacelle's floor) for a gear bay or a lift vent. */
export function floorAperture(plane: number, x: number, z: number, hx: number, hz: number, y: number): Aperture {
  return { plane, centre: [x, y, z], u: [1, 0, 0], hw: hx, hh: hz, r: 0.03, slot: SHIP_SLOT.matte };
}

/** The belly's openings: the nose gear's bay and the belly's lift vent. */
export function bellyApertures(): Aperture[] {
  const nose = LEGS[0];
  const out = [floorAperture(HULL.belly, nose.pivot[0] + (nose.fore - nose.aft) / 2, 0, (nose.fore + nose.aft) / 2, nose.bayHalf, nose.skinY)];
  for (const v of VENTS) if (v.name === 'belly') out.push(floorAperture(HULL.belly, v.x, v.z, v.hx, v.hz, v.skinY));
  return out;
}

/** The lower hull's facets (darker), the chamfers (worn edges), the rest. */
const LOWER = new Set<number>([HULL.belly, HULL.bellyS, HULL.bellyP, HULL.chin, HULL.cheekS, HULL.cheekP, HULL.tailBelly]);
function hullSlot(plane: number): number {
  if (plane >= HULL_PLANES.length) return SHIP_SLOT.hullEdge;
  return LOWER.has(plane) ? SHIP_SLOT.hullLow : SHIP_SLOT.hull;
}

export function buildHull(opts: { panes?: boolean } = {}): PolyMesh {
  return facetedShell(HULL_BEVELLED, HULL_T, {
    slot: (plane, skin) => (skin === 'outer' ? hullSlot(plane) : SHIP_SLOT.hullInner),
    apertures: [...(opts.panes === false ? [] : PANES.map(paneAperture)), doorAperture(), ...bellyApertures()],
    margin: 0.03,
  });
}

