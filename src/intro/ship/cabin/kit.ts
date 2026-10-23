/**
 * The cabin's modelling kit (docs/intro-ship.md, "Cabin"): everything inside is shaped by the hull
 * it sits in. A console, the floor, a bulkhead are convex solids bounded by the hull's inner skin
 * (moved in by a clearance, so nothing is coplanar with it) and their own planes; liner panels
 * follow the inner skin's facets; frames follow its section.
 */
import { clipPolygon, convexFaces, convexSolid, inset, insetConvex, planeAt, planeBasis, withBevels, type HalfSpace } from '../../../geometry/convex';
import { extrudeBevel, type Basis } from '../../../geometry/solids';
import { PolyMesh, v3, type Vec2, type Vec3 } from '../../../geometry/polyMesh';
import { HULL_BEVELLED } from '../hull';
import { HULL_T } from '../spec';

/** The inner skin's planes. */
export const INNER: readonly HalfSpace[] = inset(HULL_BEVELLED, HULL_T);

/** The inner skin moved in by `clearance` (m): the bounds of anything that stands against it. */
export function cabinBounds(clearance: number): HalfSpace[] {
  return inset(HULL_BEVELLED, HULL_T + clearance);
}

/**
 * A solid bounded by the hull (clearance off its inner skin) and `own` planes, every exposed edge
 * chamfered `bevel` wide. Faces against the hull are hidden; their chamfers cost nothing.
 */
export function cabinSolid(own: readonly HalfSpace[], slot: (plane: number) => number, opts: { clearance?: number; bevel?: number } = {}): PolyMesh {
  const bounds = cabinBounds(opts.clearance ?? 0.012);
  const planes = [...own, ...bounds];
  const bevel = opts.bevel ?? 0.012;
  const n = own.length;
  // Only the solid's own edges are chamfered (an edge between two hull-bound faces is hidden).
  return convexSolid(withBevels(planes, (i, j) => (i < n || j < n ? bevel : 0)), (p) => slot(p < n ? p : -1));
}

/** The hull's inner section at station x: a convex loop in (z, y), counter-clockwise seen from +x. */
export function sectionAt(x: number, clearance = 0): Vec2[] {
  let poly: Vec3[] = [
    [x, -50, -50],
    [x, -50, 50],
    [x, 50, 50],
    [x, 50, -50],
  ];
  for (const h of cabinBounds(clearance)) poly = clipPolygon(poly, h);
  // Seen from +x, counter-clockwise in (z, y) means clockwise in (y, z)…: order by angle about the centroid.
  const c = poly.reduce((a, p) => [a[0] + p[2] / poly.length, a[1] + p[1] / poly.length] as Vec2, [0, 0] as Vec2);
  return poly
    .map((p) => [p[2], p[1]] as Vec2)
    .sort((a, b) => Math.atan2(a[1] - c[1], a[0] - c[0]) - Math.atan2(b[1] - c[1], b[0] - c[0]));
}

/** An inner facet's polygon (on the inner skin), by the hull plane that makes it. */
export function innerFacet(plane: number): Vec3[] | null {
  const f = convexFaces(INNER).find((g) => g.plane === plane);
  return f ? f.loop : null;
}

/**
 * Liner panels on an inner facet: its polygon clipped by `clip` (inside: n·x ≤ d), cut along x at
 * `cuts` (a seam each, `gap` wide, or [x, width] where something stands in the seam: a frame),
 * each piece inset by half the gap and set `stand` off the skin, `thick` deep, its exposed edges
 * chamfered.
 */
export function linerPanels(plane: number, clip: readonly HalfSpace[], cuts: readonly (number | readonly [number, number])[], slot: number, opts: { gap?: number; stand?: number; thick?: number; edgeInset?: number } = {}): PolyMesh[] {
  const facet = innerFacet(plane);
  if (!facet) return [];
  const gap = opts.gap ?? 0.016;
  // Kept back from the facet's own edges: panels on facets meeting at an angle must not meet.
  const edgeInset = opts.edgeInset ?? 0.03;
  const stand = opts.stand ?? 0.006;
  const thick = opts.thick ?? 0.028;
  const n = INNER[plane].n;
  let poly = insetConvex(facet, n, edgeInset);
  for (const c of clip) poly = clipPolygon(poly, c);
  if (poly.length < 3) return [];
  const xs = cuts.map((c) => (typeof c === 'number' ? ([c, gap] as const) : c)).sort((a, b) => a[0] - b[0]);
  const pieces: Vec3[][] = [];
  let rest = poly;
  for (const [x, w] of xs) {
    // The seam's own width beyond the panels' inset gap.
    const half = Math.max(w - gap, 0) / 2;
    const fore = clipPolygon(rest, { n: [-1, 0, 0], d: -(x + half) });
    const aft = clipPolygon(rest, { n: [1, 0, 0], d: x - half });
    if (aft.length >= 3) pieces.push(aft);
    rest = fore;
    if (rest.length < 3) break;
  }
  if (rest.length >= 3) pieces.push(rest);
  const out: PolyMesh[] = [];
  const { u } = planeBasis(n);
  for (const piece of pieces) {
    const p = insetConvex(piece, n, gap / 2);
    if (p.length < 3 || area(p, n) < 0.01) continue;
    // Basis on the facet: w into the cabin (−n), so depths run from the skin inward.
    const o = p[0];
    const w = v3.scale(n, -1);
    const uu = u;
    const vv = v3.cross(w, uu);
    const b: Basis = { o, u: uu, v: vv, w };
    const loop: Vec2[] = p.map((q) => [v3.dot(v3.sub(q, o), uu), v3.dot(v3.sub(q, o), vv)]);
    out.push(extrudeBevel(loop, b, stand, stand + thick, Math.min(0.008, thick * 0.3), slot));
  }
  return out;
}

function area(loop: Vec3[], n: Vec3): number {
  let s: Vec3 = [0, 0, 0];
  for (let i = 0; i < loop.length; i++) s = v3.add(s, v3.cross(loop[i], loop[(i + 1) % loop.length]));
  return Math.abs(v3.dot(s, n)) / 2;
}

/**
 * A rib frame at station x: a band `width` wide following the hull's inner section from floor
 * level up and over, `depth` proud of the skin, `along` long in x. Its feet stand on the floor.
 */
export function ribFrame(x: number, floorY: number, opts: { width: number; along: number; clearance?: number }, slot: number): PolyMesh {
  const outerLoop = sectionAt(x, opts.clearance ?? 0.004);
  // The band: the section above the floor, and the same section moved in by the band's width.
  const above = (loop: Vec2[]): Vec2[] => clip2(loop, [0, -1], -floorY);
  const outer = above(outerLoop);
  const inner = above(inset2(outerLoop, opts.width));
  // A U: up the outer chain, back down the inner one (both open at the floor).
  const openAt = (loop: Vec2[]) => {
    // Rotate the loop so its floor edge (both ends at floorY) is the closing edge.
    const k = loop.findIndex((p, i) => Math.abs(p[1] - floorY) < 1e-6 && Math.abs(loop[(i + 1) % loop.length][1] - floorY) < 1e-6);
    return [...loop.slice(k + 1), ...loop.slice(0, k + 1)];
  };
  const o = openAt(outer);
  const i = openAt(inner).reverse();
  const outline: Vec2[] = [...o, ...i];
  const b: Basis = { o: [x, 0, 0], u: [0, 0, 1], v: [0, 1, 0], w: [1, 0, 0] };
  return extrudeBevel(outline, b, -opts.along / 2, opts.along / 2, 0.01, slot);
}

/** Clips a 2D convex loop to n·p ≤ d. */
export function clip2(loop: Vec2[], n: Vec2, d: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const da = n[0] * a[0] + n[1] * a[1] - d;
    const db = n[0] * b[0] + n[1] * b[1] - d;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/** A counter-clockwise 2D convex loop moved in by d along every edge. */
export function inset2(loop: Vec2[], d: number): Vec2[] {
  let out = [...loop];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const l = Math.hypot(ex, ey) || 1;
    // Outward normal of a CCW edge: (ey, −ex).
    const nx = ey / l;
    const ny = -ex / l;
    out = clip2(out, [nx, ny], nx * a[0] + ny * a[1] - d);
  }
  return out;
}

/** A plane through a point (re-exported for the cabin's modules). */
export { planeAt };
