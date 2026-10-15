/**
 * Solid-building operations beyond sweeps (geometry/sweep.ts), all producing closed, outward
 * PolyMesh solids with metric UVs:
 *
 *  - `extrudeBevel`: a planar outline extruded along a frame's w axis, its rims bevelled (inset
 *    rings), so no manufactured edge stays a razor edge;
 *  - `lathe`: an (r, h) profile revolved about an axis, from the axis back to the axis, or a closed
 *    loop off the axis (rings, flanges, tori); u is arc length at each vertex's own radius;
 *  - `tube`: a circular (or n-gon) section transported along a 3D path with a per-ring radius and a
 *    per-segment material slot (flanges, bellows, bands and clamps in one continuous solid);
 *  - `orientOutward`: flips a closed mesh whose signed volume is negative.
 *
 * Frames: a `Basis` is an origin and three orthonormal axes u, v, w (right-handed).
 */
import { PolyMesh, v3, type Vec2, type Vec3 } from './polyMesh';

export interface Basis {
  o: Vec3;
  u: Vec3;
  v: Vec3;
  w: Vec3;
}

export const WORLD: Basis = { o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] };

/** A basis at `o` whose w is `axis` (unit), with u chosen stably (or along `hint` projected). */
export function basisAlong(o: Vec3, axis: Vec3, hint?: Vec3): Basis {
  const w = v3.norm(axis);
  let ref: Vec3 = hint ?? (Math.abs(w[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
  ref = v3.sub(ref, v3.scale(w, v3.dot(ref, w)));
  if (v3.len(ref) < 1e-6) ref = Math.abs(w[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  const u = v3.norm(ref);
  const v = v3.cross(w, u);
  return { o, u, v, w };
}

export const at = (b: Basis, x: number, y: number, z: number): Vec3 => [
  b.o[0] + b.u[0] * x + b.v[0] * y + b.w[0] * z,
  b.o[1] + b.u[1] * x + b.v[1] * y + b.w[1] * z,
  b.o[2] + b.u[2] * x + b.v[2] * y + b.w[2] * z,
];

/** Signed volume of a closed mesh (positive when outward-wound). */
export function signedVolume(m: PolyMesh): number {
  let vol = 0;
  for (const f of m.faces) {
    const a = m.verts[f[0]];
    for (let i = 1; i + 1 < f.length; i++) {
      const b = m.verts[f[i]];
      const c = m.verts[f[i + 1]];
      vol += v3.dot(a, v3.cross(b, c));
    }
  }
  return vol / 6;
}

export function orientOutward(m: PolyMesh): PolyMesh {
  if (signedVolume(m) < 0) {
    m.faces = m.faces.map((f) => [...f].reverse());
    m.uvs = m.uvs.map((u) => [...u].reverse());
  }
  return m;
}

function area2(loop: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export const ccw = (loop: Vec2[]): Vec2[] => (area2(loop) >= 0 ? loop : [...loop].reverse());

/**
 * Offsets a simple counter-clockwise polygon inward by d (mitred corners). Exact for convex
 * outlines and for concave ones whose features are wider than 2d.
 */
export function insetPolygon(loop: Vec2[], d: number): Vec2[] {
  const n = loop.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = loop[(i - 1 + n) % n];
    const p1 = loop[i];
    const p2 = loop[(i + 1) % n];
    const e0 = norm2([p1[0] - p0[0], p1[1] - p0[1]]);
    const e1 = norm2([p2[0] - p1[0], p2[1] - p1[1]]);
    // Inward normals of a CCW loop: rotate the edge +90°.
    const n0: Vec2 = [-e0[1], e0[0]];
    const n1: Vec2 = [-e1[1], e1[0]];
    const bis = norm2([n0[0] + n1[0], n0[1] + n1[1]]);
    const cos = bis[0] * n1[0] + bis[1] * n1[1];
    const k = d / Math.max(cos, 0.2);
    out.push([p1[0] + bis[0] * k, p1[1] + bis[1] * k]);
  }
  return out;
}

function norm2(a: Vec2): Vec2 {
  const l = Math.hypot(a[0], a[1]) || 1;
  return [a[0] / l, a[1] / l];
}

function perimeterUV(loop: Vec2[]): number[] {
  const out = [0];
  for (let i = 1; i <= loop.length; i++) {
    const a = loop[i - 1];
    const b = loop[i % loop.length];
    out.push(out[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return out;
}

/**
 * Extrudes an outline in a basis's (u, v) plane along w from d0 to d1, bevelling both rims by
 * `bevel` (0: sharp). `sideSlot` for the walls, `capSlot` for both ends (default: sideSlot).
 */
export function extrudeBevel(outline: Vec2[], b: Basis, d0: number, d1: number, bevel: number, sideSlot = 0, capSlot = sideSlot, crease = 32): PolyMesh {
  const loop = ccw(outline);
  const mesh = new PolyMesh(crease);
  const inner = bevel > 0 ? insetPolygon(loop, bevel) : loop;
  const levels: [Vec2[], number][] = bevel > 0 ? [[inner, d0], [loop, d0 + bevel], [loop, d1 - bevel], [inner, d1]] : [[loop, d0], [loop, d1]];
  const rings = levels.map(([pts, d]) => pts.map((p) => mesh.vert(at(b, p[0], p[1], d))));
  const per = levels.map(([pts]) => perimeterUV(pts));
  const n = loop.length;
  for (let i = 0; i + 1 < rings.length; i++) {
    const s0 = levels[i][1];
    const s1 = levels[i + 1][1];
    for (let j = 0; j < n; j++) {
      const j1 = (j + 1) % n;
      mesh.face([rings[i][j], rings[i][j1], rings[i + 1][j1], rings[i + 1][j]], sideSlot, [
        [per[i][j], s0],
        [per[i][j + 1], s0],
        [per[i + 1][j + 1], s1],
        [per[i + 1][j], s1],
      ]);
    }
  }
  const first = rings[0];
  const last = rings[rings.length - 1];
  mesh.face([...first].reverse(), capSlot, [...levels[0][0]].reverse().map((p) => [p[0], p[1]] as Vec2));
  mesh.face([...last], capSlot, levels[levels.length - 1][0].map((p) => [p[0], p[1]] as Vec2));
  return orientOutward(mesh);
}

/** A chamfered box (all twelve edges bevelled) from its centre, half-extents and basis. */
export function box(b: Basis, hx: number, hy: number, hz: number, bevel: number, slot = 0, capSlot = slot): PolyMesh {
  const outline: Vec2[] = [
    [-hx, -hy],
    [hx, -hy],
    [hx, hy],
    [-hx, hy],
  ];
  const c = Math.min(bevel, hx * 0.45, hy * 0.45);
  const chamfered: Vec2[] =
    c > 0
      ? [
          [-hx + c, -hy],
          [hx - c, -hy],
          [hx, -hy + c],
          [hx, hy - c],
          [hx - c, hy],
          [-hx + c, hy],
          [-hx, hy - c],
          [-hx, -hy + c],
        ]
      : outline;
  return extrudeBevel(chamfered, b, -hz, hz, Math.min(bevel, hz * 0.45), slot, capSlot);
}

/** An axis-aligned chamfered box between two corners. */
export function boxBetween(lo: Vec3, hi: Vec3, bevel: number, slot = 0, capSlot = slot): PolyMesh {
  const c: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  return box({ o: c, u: [1, 0, 0], v: [0, 0, -1], w: [0, 1, 0] }, (hi[0] - lo[0]) / 2, (hi[2] - lo[2]) / 2, (hi[1] - lo[1]) / 2, bevel, slot, capSlot);
}

/**
 * Revolves an (r, h) profile about a basis's w axis (h along w). If the profile starts and ends on
 * the axis (r = 0) the result is closed at the poles; otherwise the profile must be a closed loop
 * (its last point joins its first). Faces point outward for a profile running counter-clockwise
 * in (r, h) (i.e. up the outside). u is arc length at each vertex's radius, v the profile length.
 */
export function lathe(profile: Vec2[], segments: number, b: Basis, slots: number | number[] = 0, crease = 38, phase = 0, sweepAngle = 2 * Math.PI): PolyMesh {
  const mesh = new PolyMesh(crease);
  const open = profile[0][0] === 0 && profile[profile.length - 1][0] === 0;
  const partial = sweepAngle < 2 * Math.PI - 1e-9;
  if (partial && open) throw new Error('lathe: partial sweeps need a closed loop profile');
  const n = profile.length;
  const cols = partial ? segments + 1 : segments;
  const slotOf = (i: number) => (typeof slots === 'number' ? slots : slots[i % slots.length]);
  const rings: number[][] = profile.map(([r, h]) => {
    if (open && r === 0) return [mesh.vert(at(b, 0, 0, h))];
    const ring: number[] = [];
    for (let s = 0; s < cols; s++) {
      const a = phase + (sweepAngle * s) / segments;
      ring.push(mesh.vert(at(b, r * Math.cos(a), r * Math.sin(a), h)));
    }
    return ring;
  });
  const per = perimeterUV(profile);
  const edges = open ? n - 1 : n;
  for (let i = 0; i < edges; i++) {
    const i1 = (i + 1) % n;
    const A = rings[i];
    const B = rings[i1];
    const rA = profile[i][0];
    const rB = profile[i1][0];
    const vA = per[i];
    const vB = per[i] + Math.hypot(profile[i1][0] - rA, profile[i1][1] - profile[i][1]);
    const span = partial ? segments : segments;
    for (let s = 0; s < span; s++) {
      const s1 = partial ? s + 1 : (s + 1) % segments;
      const a0 = (sweepAngle * s) / segments;
      const a1 = (sweepAngle * (s + 1)) / segments;
      if (A.length === 1) mesh.face([A[0], B[s1], B[s]], slotOf(i), [[0, vA], [rB * a1, vB], [rB * a0, vB]]);
      else if (B.length === 1) mesh.face([A[s], A[s1], B[0]], slotOf(i), [[rA * a0, vA], [rA * a1, vA], [0, vB]]);
      else mesh.face([A[s], A[s1], B[s1], B[s]], slotOf(i), [[rA * a0, vA], [rA * a1, vA], [rB * a1, vB], [rB * a0, vB]]);
    }
  }
  if (partial) {
    // End caps of a partial sweep: the profile loop at both ends.
    const capSlot = slotOf(0);
    const c0 = rings.map((r) => r[0]);
    const c1 = rings.map((r) => r[cols - 1]);
    mesh.face([...c0], capSlot, profile.map((p) => [p[0], p[1]] as Vec2));
    mesh.face([...c1].reverse(), capSlot, [...profile].reverse().map((p) => [p[0], p[1]] as Vec2));
  }
  return orientOutward(mesh);
}

/** Parallel-transport normals along a polyline (no flips), seeded with `seed` or a stable perpendicular. */
export function transportNormals(points: Vec3[], closed = false, seed?: Vec3): Vec3[] {
  const n = points.length;
  const tangents: Vec3[] = points.map((_, i) => {
    const prev = closed ? points[(i - 1 + n) % n] : points[Math.max(0, i - 1)];
    const next = closed ? points[(i + 1) % n] : points[Math.min(n - 1, i + 1)];
    return v3.norm(v3.sub(next, prev));
  });
  const t0 = tangents[0];
  let ref: Vec3 = seed ?? (Math.abs(t0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
  ref = v3.norm(v3.sub(ref, v3.scale(t0, v3.dot(ref, t0))));
  const out: Vec3[] = [ref];
  for (let i = 1; i < n; i++) {
    const a = tangents[i - 1];
    const b = tangents[i];
    const axis = v3.cross(a, b);
    const s = v3.len(axis);
    let r = out[i - 1];
    if (s > 1e-9) {
      const k = v3.scale(axis, 1 / s);
      const c = v3.dot(a, b);
      const ang = Math.atan2(s, c);
      // Rodrigues rotation of r about k by ang.
      const cosA = Math.cos(ang);
      const sinA = Math.sin(ang);
      r = v3.add(v3.add(v3.scale(r, cosA), v3.scale(v3.cross(k, r), sinA)), v3.scale(k, v3.dot(k, r) * (1 - cosA)));
    }
    r = v3.norm(v3.sub(r, v3.scale(b, v3.dot(r, b))));
    out.push(r);
  }
  return out;
}

export interface TubeRing {
  p: Vec3;
  /** Section radius at this ring. */
  r: number;
}

/**
 * A tube through rings (centre and radius), with `segments` sides, transported frames, closed
 * end caps (or closed on itself), and a slot per segment between rings i and i + 1.
 */
export function tube(rings: TubeRing[], segments: number, slots: number | ((i: number) => number) = 0, opts: { closed?: boolean; capSlot?: number; crease?: number; seed?: Vec3 } = {}): PolyMesh {
  const mesh = new PolyMesh(opts.crease ?? 40);
  const closed = opts.closed ?? false;
  const pts = rings.map((r) => r.p);
  const normals = transportNormals(pts, closed, opts.seed);
  const n = rings.length;
  const tangents = pts.map((_, i) => {
    const prev = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)];
    const next = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    return v3.norm(v3.sub(next, prev));
  });
  // A closed loop's transported normal does not return to itself: spread the holonomy evenly.
  let twist = 0;
  if (closed) {
    const nEnd = normals[n - 1];
    const t = tangents[0];
    const back = v3.norm(v3.sub(nEnd, v3.scale(t, v3.dot(nEnd, t))));
    const b0 = v3.cross(t, normals[0]);
    twist = Math.atan2(v3.dot(back, b0), v3.dot(back, normals[0]));
  }
  const ids: number[][] = [];
  const arc: number[] = [0];
  for (let i = 1; i < n; i++) arc.push(arc[i - 1] + v3.dist(pts[i], pts[i - 1]));
  rings.forEach((ring, i) => {
    const t = tangents[i];
    const nn = normals[i];
    const bb = v3.cross(t, nn);
    const rot = closed ? (-twist * i) / n : 0;
    const row: number[] = [];
    for (let s = 0; s < segments; s++) {
      const a = rot + (2 * Math.PI * s) / segments;
      const d = v3.add(v3.scale(nn, Math.cos(a)), v3.scale(bb, Math.sin(a)));
      row.push(mesh.vert(v3.add(ring.p, v3.scale(d, ring.r))));
    }
    ids.push(row);
  });
  const slotOf = (i: number) => (typeof slots === 'number' ? slots : slots(i));
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const i1 = (i + 1) % n;
    const s0 = arc[i];
    const s1 = closed && i1 === 0 ? arc[n - 1] + v3.dist(pts[n - 1], pts[0]) : arc[i1];
    const r0 = rings[i].r;
    const r1 = rings[i1].r;
    for (let s = 0; s < segments; s++) {
      const s2 = (s + 1) % segments;
      const c0 = (2 * Math.PI * s) / segments;
      const c1 = (2 * Math.PI * (s + 1)) / segments;
      mesh.face([ids[i][s], ids[i1][s], ids[i1][s2], ids[i][s2]], slotOf(i), [
        [s0, c0 * r0],
        [s1, c0 * r1],
        [s1, c1 * r1],
        [s0, c1 * r0],
      ]);
    }
  }
  if (!closed) {
    const cap = opts.capSlot ?? slotOf(0);
    const capUV = (i: number) => ids[i].map((_, s) => [Math.cos((2 * Math.PI * s) / segments) * rings[i].r, Math.sin((2 * Math.PI * s) / segments) * rings[i].r] as Vec2);
    mesh.face([...ids[0]], cap, capUV(0));
    mesh.face([...ids[n - 1]].reverse(), opts.capSlot ?? slotOf(n - 2), capUV(n - 1).reverse());
  }
  return orientOutward(mesh);
}

/** Samples a polyline with filleted corners (arc radius `bend`, clamped to fit) every `ds` metres. */
export function filletPath(points: Vec3[], bend: number, ds: number, arcSegments = 10): Vec3[] {
  if (points.length < 3) return resample(points, ds);
  const out: Vec3[] = [points[0]];
  let start = points[0];
  for (let i = 1; i + 1 < points.length; i++) {
    const p = points[i];
    const a = v3.norm(v3.sub(start, p));
    const b = v3.norm(v3.sub(points[i + 1], p));
    const cosT = Math.min(1, Math.max(-1, v3.dot(a, b)));
    const theta = Math.acos(cosT);
    if (theta > Math.PI - 1e-4) {
      out.push(p);
      start = p;
      continue;
    }
    const half = theta / 2;
    const maxCut = Math.min(v3.dist(start, p), v3.dist(points[i + 1], p) / 2) * 0.95;
    const cut = Math.min(bend / Math.tan(half), maxCut);
    const r = cut * Math.tan(half);
    const p0 = v3.add(p, v3.scale(a, cut));
    const p1 = v3.add(p, v3.scale(b, cut));
    out.push(...resample([out[out.length - 1], p0], ds).slice(1));
    const bis = v3.norm(v3.add(a, b));
    const centre = v3.add(p, v3.scale(bis, r / Math.sin(half)));
    const u0 = v3.norm(v3.sub(p0, centre));
    const u1 = v3.norm(v3.sub(p1, centre));
    const sweep = Math.acos(Math.min(1, Math.max(-1, v3.dot(u0, u1))));
    const k = v3.norm(v3.cross(u0, u1));
    for (let s = 1; s <= arcSegments; s++) {
      const ang = (sweep * s) / arcSegments;
      const d = v3.add(v3.scale(u0, Math.cos(ang)), v3.scale(v3.cross(k, u0), Math.sin(ang)));
      out.push(v3.add(centre, v3.scale(d, r)));
    }
    start = p1;
  }
  out.push(...resample([out[out.length - 1], points[points.length - 1]], ds).slice(1));
  return out;
}

/** Points along a polyline no more than ds apart (corners kept). */
export function resample(points: Vec3[], ds: number): Vec3[] {
  const out: Vec3[] = [points[0]];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const k = Math.max(1, Math.ceil(v3.dist(a, b) / ds));
    for (let j = 1; j <= k; j++) out.push(v3.lerp(a, b, j / k));
  }
  return out;
}

/** Arc-length positions of a polyline's points. */
export function arcLengths(points: Vec3[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) out.push(out[i - 1] + v3.dist(points[i], points[i - 1]));
  return out;
}

/** Inserts points into a polyline at the given arc lengths (sorted), so features land exactly. */
export function insertAt(points: Vec3[], cuts: number[]): Vec3[] {
  const s = arcLengths(points);
  const out: Vec3[] = [points[0]];
  let c = 0;
  const sorted = [...cuts].sort((a, b) => a - b);
  for (let i = 1; i < points.length; i++) {
    while (c < sorted.length && sorted[c] <= s[i - 1] + 1e-6) c++;
    while (c < sorted.length && sorted[c] < s[i] - 1e-6) {
      const t = (sorted[c] - s[i - 1]) / (s[i] - s[i - 1]);
      out.push(v3.lerp(points[i - 1], points[i], t));
      c++;
    }
    out.push(points[i]);
  }
  return out;
}
