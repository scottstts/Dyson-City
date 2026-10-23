/**
 * Faceted solids from half-spaces: a convex body is the intersection of planes, so every face is
 * planar by construction and adjacent faces share their edges exactly.
 *
 *  - `convexFaces`: the polyhedron of a set of half-spaces (n·x ≤ d), each face tagged with the
 *    plane that made it. Redundant planes make no face.
 *  - `withBevels`: a chamfer plane on every edge sharper than a given turn, cut to a given width,
 *    so no edge of a faceted body stays a razor edge. Corners where several chamfers meet resolve
 *    themselves in the intersection.
 *  - `facetedShell`: a thick shell between the body and the same planes moved in by a wall
 *    thickness, pierced by rounded-rectangle apertures (windows, a door, slots) through both
 *    skins, with walls joining the two openings. One closed, outward solid.
 *
 * Frames: an aperture is a rounded rectangle in its plane, centred at `centre`, `u` along its
 * width and v = n × u along its height.
 */
import { ShapeUtils, Vector2 } from 'three';
import { PolyMesh, v3, type Vec2, type Vec3 } from './polyMesh';

export interface HalfSpace {
  /** Outward unit normal. */
  n: Vec3;
  /** Inside: n·x ≤ d. */
  d: number;
}

export interface ConvexFace {
  /** Index of the plane that made the face. */
  plane: number;
  /** Corners, counter-clockwise seen from outside. */
  loop: Vec3[];
}

const EPS = 1e-9;

/** A plane through a point with an outward normal (normalised). */
export function planeAt(n: Vec3, p: Vec3): HalfSpace {
  const u = v3.norm(n);
  return { n: u, d: v3.dot(u, p) };
}

/** The convex polyhedron of a set of half-spaces, bounded by a cube of half-size `bound` that must not survive. */
export function convexFaces(planes: readonly HalfSpace[], bound = 1000): ConvexFace[] {
  const B = bound;
  const cube: Vec3[] = [
    [-B, -B, -B], [B, -B, -B], [B, B, -B], [-B, B, -B],
    [-B, -B, B], [B, -B, B], [B, B, B], [-B, B, B],
  ];
  const quad = (a: number, b: number, c: number, d: number, plane: number): ConvexFace => ({ plane, loop: [cube[a], cube[b], cube[c], cube[d]] });
  let faces: ConvexFace[] = [
    quad(0, 3, 2, 1, -1), // -z
    quad(4, 5, 6, 7, -2), // +z
    quad(0, 4, 7, 3, -3), // -x
    quad(1, 2, 6, 5, -4), // +x
    quad(0, 1, 5, 4, -5), // -y
    quad(3, 7, 6, 2, -6), // +y
  ];
  planes.forEach((pl, index) => {
    const next: ConvexFace[] = [];
    const cut: Vec3[] = [];
    let changed = false;
    for (const f of faces) {
      const out: Vec3[] = [];
      const loop = f.loop;
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i];
        const b = loop[(i + 1) % loop.length];
        const da = v3.dot(pl.n, a) - pl.d;
        const db = v3.dot(pl.n, b) - pl.d;
        if (da <= EPS) out.push(a);
        else changed = true;
        if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
          const t = da / (da - db);
          const p = v3.lerp(a, b, t);
          out.push(p);
          cut.push(p);
        } else if (Math.abs(da) <= EPS) cut.push(a);
      }
      const clean = dedupe(out);
      if (clean.length >= 3 && polygonArea(clean) > 1e-10) next.push({ plane: f.plane, loop: clean });
    }
    faces = next;
    if (!changed) return;
    const cap = hullOnPlane(dedupe(cut), pl.n);
    if (cap.length >= 3 && polygonArea(cap) > 1e-10) faces.push({ plane: index, loop: cap });
  });
  if (faces.some((f) => f.plane < 0)) throw new Error('convexFaces: the planes do not bound a finite body');
  return faces;
}

function dedupe(pts: Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  for (const p of pts) if (!out.some((q) => v3.dist(p, q) < 1e-7)) out.push(p);
  return out;
}

function polygonArea(loop: Vec3[]): number {
  let n: Vec3 = [0, 0, 0];
  for (let i = 0; i < loop.length; i++) n = v3.add(n, v3.cross(loop[i], loop[(i + 1) % loop.length]));
  return v3.len(n) / 2;
}

/** In-plane basis (u, v) with u × v = n. */
export function planeBasis(n: Vec3, hint?: Vec3): { u: Vec3; v: Vec3 } {
  let ref: Vec3 = hint ?? (Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
  ref = v3.sub(ref, v3.scale(n, v3.dot(ref, n)));
  if (v3.len(ref) < 1e-6) ref = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  const u = v3.norm(ref);
  return { u, v: v3.cross(n, u) };
}

/** Points on a plane ordered counter-clockwise about n (their convex hull). */
function hullOnPlane(pts: Vec3[], n: Vec3): Vec3[] {
  if (pts.length < 3) return pts;
  const { u, v } = planeBasis(n);
  const p2 = pts.map((p) => [v3.dot(p, u), v3.dot(p, v)] as Vec2);
  const idx = p2.map((_, i) => i).sort((a, b) => p2[a][0] - p2[b][0] || p2[a][1] - p2[b][1]);
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: number[] = [];
  for (const i of idx) {
    while (lower.length >= 2 && cross(p2[lower[lower.length - 2]], p2[lower[lower.length - 1]], p2[i]) <= 1e-12) lower.pop();
    lower.push(i);
  }
  const upper: number[] = [];
  for (let k = idx.length - 1; k >= 0; k--) {
    const i = idx[k];
    while (upper.length >= 2 && cross(p2[upper[upper.length - 2]], p2[upper[upper.length - 1]], p2[i]) <= 1e-12) upper.pop();
    upper.push(i);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)].map((i) => pts[i]);
}

/** Pairs of planes whose faces share an edge, with the edge's end points. */
export function faceEdges(faces: readonly ConvexFace[]): { i: number; j: number; a: Vec3; b: Vec3 }[] {
  const out: { i: number; j: number; a: Vec3; b: Vec3 }[] = [];
  for (let fa = 0; fa < faces.length; fa++) {
    const A = faces[fa].loop;
    for (let fb = fa + 1; fb < faces.length; fb++) {
      const Bl = faces[fb].loop;
      const shared = A.filter((p) => Bl.some((q) => v3.dist(p, q) < 1e-6));
      if (shared.length >= 2) {
        let a = shared[0];
        let b = shared[1];
        let best = v3.dist(a, b);
        for (let x = 0; x < shared.length; x++) for (let y = x + 1; y < shared.length; y++) {
          const d = v3.dist(shared[x], shared[y]);
          if (d > best) [a, b, best] = [shared[x], shared[y], d];
        }
        if (best > 1e-5) out.push({ i: faces[fa].plane, j: faces[fb].plane, a, b });
      }
    }
  }
  return out;
}

/**
 * Adds a chamfer plane on every edge of the body whose faces turn by more than `minTurn` (rad),
 * cut `width(i, j)` metres wide (measured across the chamfer). Returns the planes, the chamfers
 * appended after the originals.
 */
export function withBevels(planes: readonly HalfSpace[], width: (i: number, j: number) => number, minTurn = 0.05): HalfSpace[] {
  const faces = convexFaces(planes);
  const out = [...planes];
  for (const e of faceEdges(faces)) {
    const w = width(e.i, e.j);
    if (w <= 0) continue;
    const ni = planes[e.i].n;
    const nj = planes[e.j].n;
    const turn = Math.acos(Math.min(1, Math.max(-1, v3.dot(ni, nj))));
    if (turn < minTurn) continue;
    // Interior angle α = π − turn; a chamfer `w` wide sits δ = w / (2 tan(α/2)) inside the edge.
    const alpha = Math.PI - turn;
    const delta = w / (2 * Math.tan(alpha / 2));
    const nb = v3.norm(v3.add(ni, nj));
    out.push({ n: nb, d: v3.dot(nb, e.a) - delta });
  }
  return out;
}

/** The same planes moved in by `t` (the inner skin of a shell). */
export function inset(planes: readonly HalfSpace[], t: number): HalfSpace[] {
  return planes.map((p) => ({ n: p.n, d: p.d - t }));
}

/** An opening through a shell: a rounded rectangle, or any outline on the plane. */
export type Aperture = RectAperture | OutlineAperture;

interface ApertureBase {
  /** The plane (index) the opening pierces: it must make a face on both skins. */
  plane: number;
  /** Material slot of the aperture's walls (its reveal). */
  slot: number;
}

export interface RectAperture extends ApertureBase {
  /** Centre on the outer face's plane, the width axis (in the plane), half-sizes, corner radius. */
  centre: Vec3;
  u: Vec3;
  hw: number;
  hh: number;
  r: number;
  /** Segments per rounded corner. */
  corner?: number;
}

export interface OutlineAperture extends ApertureBase {
  /** The opening's outline on the outer face's plane, counter-clockwise about its normal. */
  outline: Vec3[];
}

/**
 * A convex polygon grown by r with round corners (its Minkowski sum with a disc of radius r),
 * counter-clockwise about n: every point within r of the polygon. Each corner is an arc about the
 * corner itself, so loops of one polygon at different radii match point for point.
 */
export function roundedPolygonLoop(poly: readonly Vec3[], n: Vec3, r: number, corner = 6): Vec3[] {
  const m = poly.length;
  const edgeOut = (i: number): Vec3 => v3.norm(v3.cross(v3.sub(poly[(i + 1) % m], poly[i]), n));
  const out: Vec3[] = [];
  for (let i = 0; i < m; i++) {
    const nPrev = edgeOut((i - 1 + m) % m);
    const nNext = edgeOut(i);
    const ang = Math.acos(Math.min(1, Math.max(-1, v3.dot(nPrev, nNext))));
    for (let k = 0; k <= corner; k++) {
      const t = (ang * k) / corner;
      // Rotate nPrev toward nNext about n.
      const d = v3.add(v3.scale(nPrev, Math.cos(t)), v3.scale(v3.cross(n, nPrev), Math.sin(t)));
      out.push(v3.add(poly[i], v3.scale(d, r)));
    }
  }
  return out;
}

/** A convex polygon without corners closer than `eps` to the next or too shallow to be corners. */
export function simplifyConvex(poly: readonly Vec3[], eps = 1e-3): Vec3[] {
  let out = [...poly];
  for (let pass = 0; pass < 4; pass++) {
    const next: Vec3[] = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length];
      const p = out[i];
      const b = out[(i + 1) % out.length];
      if (v3.dist(p, b) < eps) continue;
      const e0 = v3.norm(v3.sub(p, a));
      const e1 = v3.norm(v3.sub(b, p));
      if (v3.dot(e0, e1) > 1 - 1e-6) continue;
      next.push(p);
    }
    if (next.length === out.length) break;
    out = next;
  }
  return out;
}

/** Clips a convex polygon to the half-space n·x ≤ d. */
export function clipPolygon(poly: readonly Vec3[], h: HalfSpace): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = v3.dot(h.n, a) - h.d;
    const db = v3.dot(h.n, b) - h.d;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) out.push(v3.lerp(a, b, da / (da - db)));
  }
  return dedupe(out);
}

/** A convex polygon (counter-clockwise about n) moved in by d along every edge. */
export function insetConvex(poly: readonly Vec3[], n: Vec3, d: number): Vec3[] {
  const m = poly.length;
  let out = [...poly];
  for (let i = 0; i < m; i++) {
    const a = poly[i];
    const e = v3.norm(v3.cross(v3.sub(poly[(i + 1) % m], a), n));
    out = clipPolygon(out, { n: e, d: v3.dot(e, a) - d });
  }
  return out;
}

/** A rounded rectangle's outline in a plane (counter-clockwise about n = u × v). */
export function roundedRectLoop(centre: Vec3, u: Vec3, v: Vec3, hw: number, hh: number, r: number, corner = 6): Vec3[] {
  const out: Vec3[] = [];
  const rr = Math.min(r, hw * 0.999, hh * 0.999);
  const corners: [number, number, number][] = [
    [hw - rr, -hh + rr, -Math.PI / 2],
    [hw - rr, hh - rr, 0],
    [-hw + rr, hh - rr, Math.PI / 2],
    [-hw + rr, -hh + rr, Math.PI],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= corner; i++) {
      const a = a0 + (Math.PI / 2) * (i / corner);
      const x = cx + rr * Math.cos(a);
      const y = cy + rr * Math.sin(a);
      out.push(v3.add(centre, v3.add(v3.scale(u, x), v3.scale(v, y))));
    }
  }
  return dedupe(out);
}

export interface ShellOptions {
  /** Slot of a face of the outer and inner skins, by the plane that made it. */
  slot(plane: number, skin: 'outer' | 'inner'): number;
  apertures?: readonly Aperture[];
  crease?: number;
  /** Clearance the openings must keep from their face's edges (m). */
  margin?: number;
}

/**
 * A thick faceted shell: the body of `planes` hollowed by the same planes moved in by `thickness`,
 * pierced by `apertures` through both skins. Closed and outward: the outer skin faces out, the
 * inner skin faces the hollow, each aperture's walls face its opening.
 */
export function facetedShell(planes: readonly HalfSpace[], thickness: number, opts: ShellOptions): PolyMesh {
  const outer = convexFaces(planes);
  const inner = convexFaces(inset(planes, thickness));
  const mesh = new PolyMesh(opts.crease ?? 30);
  const weld = new Weld(mesh);
  const margin = opts.margin ?? 0.02;
  const holes = new Map<string, Vec3[][]>();
  for (const a of opts.apertures ?? []) {
    const n = planes[a.plane].n;
    const loop = apertureLoop(a, planes[a.plane]);
    const innerLoop = loop.map((p) => v3.sub(p, v3.scale(n, thickness)));
    const push = (k: string, l: Vec3[]) => holes.set(k, [...(holes.get(k) ?? []), l]);
    push(`o${a.plane}`, loop);
    push(`i${a.plane}`, innerLoop);
    // The walls: from the outer opening to the inner one, facing into the opening.
    const ids = loop.map((p) => weld.id(p));
    const iids = innerLoop.map((p) => weld.id(p));
    const m = loop.length;
    let s = 0;
    for (let k = 0; k < m; k++) {
      const k1 = (k + 1) % m;
      const e = v3.dist(loop[k], loop[k1]);
      // Loop is CCW about n: the quad (k, k+1, inner k+1, inner k) faces into the opening.
      mesh.face([ids[k], ids[k1], iids[k1], iids[k]], a.slot, [
        [s, 0],
        [s + e, 0],
        [s + e, thickness],
        [s, thickness],
      ]);
      s += e;
    }
  }
  const emit = (faces: ConvexFace[], skin: 'outer' | 'inner', source: readonly HalfSpace[]) => {
    for (const f of faces) {
      const n = source[f.plane].n;
      const slot = opts.slot(f.plane, skin);
      const hs = holes.get(`${skin === 'outer' ? 'o' : 'i'}${f.plane}`) ?? [];
      const { u, v } = planeBasis(n);
      const to2 = (p: Vec3): Vec2 => [v3.dot(p, u), v3.dot(p, v)];
      for (const h of hs) for (const p of h) if (!insideConvex(f.loop, n, p, margin)) throw new Error(`facetedShell: an aperture leaves its ${skin} face (plane ${f.plane})`);
      const sign = skin === 'outer' ? 1 : -1;
      if (!hs.length) {
        const ids = f.loop.map((p) => weld.id(p));
        const ordered = sign > 0 ? ids : [...ids].reverse();
        const pts = sign > 0 ? f.loop : [...f.loop].reverse();
        mesh.face(ordered, slot, pts.map(to2));
        continue;
      }
      // A face with openings: triangulated with holes, in the face's own plane.
      const contour = f.loop.map((p) => new Vector2(...to2(p)));
      const holes2 = hs.map((h) => h.map((p) => new Vector2(...to2(p))));
      if (ShapeUtils.isClockWise(contour)) throw new Error('facetedShell: face loop is clockwise');
      const holesCW = holes2.map((h) => (ShapeUtils.isClockWise(h) ? h : [...h].reverse()));
      const holes3 = hs.map((h, k) => (holes2[k] === holesCW[k] ? h : [...h].reverse()));
      const all3 = [...f.loop, ...holes3.flat()];
      const tris = ShapeUtils.triangulateShape(contour, holesCW);
      for (const t of tris) {
        const p = t.map((k) => all3[k]);
        const tn = v3.cross(v3.sub(p[1], p[0]), v3.sub(p[2], p[0]));
        const flip = v3.dot(tn, n) * sign < 0;
        const order = flip ? [t[0], t[2], t[1]] : t;
        mesh.face(order.map((k) => weld.id(all3[k])), slot, order.map((k) => to2(all3[k])));
      }
    }
  };
  emit(outer, 'outer', planes);
  emit(inner, 'inner', inset(planes, thickness));
  return mesh;
}

/** An aperture's outline on its plane (outer skin), counter-clockwise about the plane's normal. */
export function apertureLoop(a: Aperture, pl: HalfSpace): Vec3[] {
  const n = pl.n;
  if ('outline' in a) return a.outline.map((p) => v3.sub(p, v3.scale(n, v3.dot(n, p) - pl.d)));
  const u = v3.norm(v3.sub(a.u, v3.scale(n, v3.dot(a.u, n))));
  const v = v3.cross(n, u);
  const c = v3.sub(a.centre, v3.scale(n, v3.dot(n, a.centre) - pl.d));
  return roundedRectLoop(c, u, v, a.hw, a.hh, a.r, a.corner ?? 6);
}

function insideConvex(loop: Vec3[], n: Vec3, p: Vec3, margin: number): boolean {
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const edgeIn = v3.norm(v3.cross(n, v3.sub(b, a)));
    if (v3.dot(v3.sub(p, a), edgeIn) < margin) return false;
  }
  return true;
}

/** The convex body of the planes as a closed solid (no hollow), one slot per plane. */
export function convexSolid(planes: readonly HalfSpace[], slot: (plane: number) => number, crease = 30): PolyMesh {
  const mesh = new PolyMesh(crease);
  const weld = new Weld(mesh);
  for (const f of convexFaces(planes)) {
    const { u, v } = planeBasis(planes[f.plane].n);
    mesh.face(f.loop.map((p) => weld.id(p)), slot(f.plane), f.loop.map((p) => [v3.dot(p, u), v3.dot(p, v)] as Vec2));
  }
  return mesh;
}

/** Welds points closer than 2 × 10⁻⁵ m into one vertex. */
class Weld {
  private readonly cells = new Map<string, number[]>();
  private readonly mesh: PolyMesh;

  constructor(mesh: PolyMesh) {
    this.mesh = mesh;
  }

  id(p: Vec3): number {
    const C = 1e-4;
    const k = (x: number) => Math.floor(x / C);
    const [cx, cy, cz] = [k(p[0]), k(p[1]), k(p[2])];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const i of this.cells.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) if (v3.dist(this.mesh.verts[i], p) < 2e-5) return i;
    }
    const i = this.mesh.vert(p);
    const key = `${cx},${cy},${cz}`;
    const list = this.cells.get(key);
    if (list) list.push(i);
    else this.cells.set(key, [i]);
    return i;
  }
}
