/**
 * Profile sweeps and lofts: the modelling operations for members, bars, rings and cast nodes.
 *
 * A sweep places a closed section profile, in (b, t) coordinates, at each frame of a path:
 * point = p + B·b + N·t, with B = N × T. Profiles are counter-clockwise in (b, t), so with
 * (B, N, T) right-handed every side quad faces outward and the result is one closed solid
 * (the end caps are planar n-gons). UVs: u = arc length along the path, v = perimeter distance
 * around the section, both in metres, so materials lay joints and grain in real units.
 */
import { PolyMesh, v3, type Vec2, type Vec3 } from './polyMesh';

export interface Frame {
  p: Vec3;
  /** Unit tangent. */
  t: Vec3;
  /** Unit normal (the section's "up": t-axis). */
  n: Vec3;
  /** Unit binormal N × T (the section's "across": b-axis). */
  b: Vec3;
  /** Arc length at this frame (m). */
  s: number;
}

export interface Profile {
  /** Closed loop, counter-clockwise in (b, t). */
  pts: Vec2[];
  /** Material slot per edge pts[i] → pts[i+1]; defaults to 0. */
  slots?: number[];
}

export interface Plane {
  point: Vec3;
  normal: Vec3;
}

export interface SweepOptions {
  /** Slot of the end caps. */
  capSlot?: number;
  /** Omit caps (the path closes on itself). */
  closed?: boolean;
  /** Move the first/last ring along its tangent onto this plane (exact butt or mitre). */
  trimStart?: Plane;
  trimEnd?: Plane;
  crease?: number;
}

/**
 * Builds orthonormal frames along sampled points with a prescribed normal at each. For a closed
 * loop (no repeated end point) tangents wrap across the seam.
 */
export function framesFrom(points: Vec3[], normals: Vec3[], closed = false): Frame[] {
  const out: Frame[] = [];
  let s = 0;
  const count = points.length;
  for (let i = 0; i < count; i++) {
    const prev = closed ? points[(i - 1 + count) % count] : points[Math.max(0, i - 1)];
    const next = closed ? points[(i + 1) % count] : points[Math.min(count - 1, i + 1)];
    let t = v3.norm(v3.sub(next, prev));
    const nRaw = normals[i];
    // Remove the tangent's component from the normal, then rebuild the tangent.
    const n = v3.norm(v3.sub(nRaw, v3.scale(t, v3.dot(nRaw, t))));
    const b = v3.norm(v3.cross(n, t));
    t = v3.cross(b, n);
    if (i > 0) s += v3.dist(points[i], points[i - 1]);
    out.push({ p: points[i], t, n, b, s });
  }
  return out;
}

/**
 * Resamples a parametric curve c(u), u ∈ [u0, u1], at near-uniform arc length with at most `ds`
 * between samples (at least `minSegments` segments).
 */
export function sampleCurve(c: (u: number) => Vec3, u0: number, u1: number, ds: number, minSegments = 1): { u: number[]; p: Vec3[] } {
  const fine = 2048;
  const us: number[] = [];
  const len: number[] = [0];
  let prev = c(u0);
  us.push(u0);
  for (let i = 1; i <= fine; i++) {
    const u = u0 + ((u1 - u0) * i) / fine;
    const p = c(u);
    len.push(len[i - 1] + v3.dist(p, prev));
    us.push(u);
    prev = p;
  }
  const total = len[fine];
  const n = Math.max(minSegments, Math.ceil(total / ds));
  const outU: number[] = [];
  let j = 0;
  for (let i = 0; i <= n; i++) {
    const target = (total * i) / n;
    while (j < fine - 1 && len[j + 1] < target) j++;
    const f = len[j + 1] > len[j] ? (target - len[j]) / (len[j + 1] - len[j]) : 0;
    outU.push(us[j] + (us[j + 1] - us[j]) * Math.min(Math.max(f, 0), 1));
  }
  outU[0] = u0;
  outU[n] = u1;
  return { u: outU, p: outU.map(c) };
}

/** Arc-length table of a curve on [u0, u1]: parameter ↔ arc length (u1 may be below u0). */
export interface ArcTable {
  length: number;
  uAt(s: number): number;
}

export function arcTable(c: (u: number) => Vec3, u0: number, u1: number, n = 1024): ArcTable {
  const us = new Float64Array(n + 1);
  const ss = new Float64Array(n + 1);
  let prev = c(u0);
  us[0] = u0;
  for (let i = 1; i <= n; i++) {
    const u = u0 + ((u1 - u0) * i) / n;
    const q = c(u);
    ss[i] = ss[i - 1] + v3.dist(q, prev);
    us[i] = u;
    prev = q;
  }
  return {
    length: ss[n],
    uAt(s) {
      // Binary search for the bracketing interval.
      let lo = 0;
      let hi = n;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (ss[mid] < s) lo = mid;
        else hi = mid;
      }
      const f = ss[hi] > ss[lo] ? (s - ss[lo]) / (ss[hi] - ss[lo]) : 0;
      return us[lo] + (us[hi] - us[lo]) * Math.min(Math.max(f, 0), 1);
    },
  };
}

function moveToPlane(p: Vec3, dir: Vec3, plane: Plane): Vec3 {
  const denom = v3.dot(dir, plane.normal);
  if (Math.abs(denom) < 1e-9) return p;
  const k = v3.dot(v3.sub(plane.point, p), plane.normal) / denom;
  return v3.add(p, v3.scale(dir, k));
}

/** Sweeps a profile (fixed, or one per frame with equal point counts) along frames. */
export function sweep(frames: Frame[], profile: Profile | ((f: Frame, i: number) => Profile), opts: SweepOptions = {}): PolyMesh {
  const mesh = new PolyMesh(opts.crease ?? 30);
  const prof = (i: number): Profile => (typeof profile === 'function' ? profile(frames[i], i) : profile);
  const m = prof(0).pts.length;
  const rings: number[][] = [];
  const perim: number[][] = [];
  frames.forEach((f, i) => {
    const pr = prof(i);
    if (pr.pts.length !== m) throw new Error('sweep: profile point count changed along the path');
    const ring: number[] = [];
    const pv: number[] = [0];
    pr.pts.forEach(([b, t], j) => {
      let p = v3.madd(f.p, f.b, b, f.n, t);
      if (i === 0 && opts.trimStart) p = moveToPlane(p, f.t, opts.trimStart);
      if (i === frames.length - 1 && opts.trimEnd) p = moveToPlane(p, f.t, opts.trimEnd);
      ring.push(mesh.vert(p));
      if (j > 0) pv.push(pv[j - 1] + Math.hypot(b - pr.pts[j - 1][0], t - pr.pts[j - 1][1]));
    });
    const last = pr.pts[m - 1];
    pv.push(pv[m - 1] + Math.hypot(pr.pts[0][0] - last[0], pr.pts[0][1] - last[1]));
    rings.push(ring);
    perim.push(pv);
  });
  const slots = prof(0).slots;
  const count = opts.closed ? frames.length : frames.length - 1;
  for (let i = 0; i < count; i++) {
    const i1 = (i + 1) % frames.length;
    const s0 = frames[i].s;
    const s1 = opts.closed && i1 === 0 ? frames[i].s + v3.dist(frames[i].p, frames[0].p) : frames[i1].s;
    for (let j = 0; j < m; j++) {
      const j1 = (j + 1) % m;
      const a = rings[i][j];
      const b = rings[i][j1];
      const c = rings[i1][j1];
      const d = rings[i1][j];
      const va = perim[i][j];
      const vb = perim[i][j + 1];
      mesh.face([a, b, c, d], slots?.[j] ?? 0, [
        [s0, va],
        [s0, vb],
        [s1, vb],
        [s1, va],
      ]);
    }
  }
  if (!opts.closed) {
    const capSlot = opts.capSlot ?? slots?.[0] ?? 0;
    const capUV = (ring: number[], f: Frame): Vec2[] => ring.map((k) => {
      const d = v3.sub(mesh.verts[k], f.p);
      return [v3.dot(d, f.b), v3.dot(d, f.n)];
    });
    const r0 = [...rings[0]].reverse();
    mesh.face(r0, capSlot, capUV(r0, frames[0]));
    const rN = rings[rings.length - 1];
    mesh.face([...rN], capSlot, capUV(rN, frames[frames.length - 1]));
  }
  return mesh;
}

/**
 * Lofts closed rings (equal point counts) into a solid, capping the first and last ring.
 * Rings must be ordered so that each ring is counter-clockwise seen from the loft's end
 * direction (the side the last ring faces).
 */
export function loftRings(rings: Vec3[][], slots: number | number[] = 0, crease = 30): PolyMesh {
  const mesh = new PolyMesh(crease);
  const ids = rings.map((r) => r.map((p) => mesh.vert(p)));
  const m = rings[0].length;
  const slotOf = (i: number) => (typeof slots === 'number' ? slots : slots[Math.min(i, slots.length - 1)]);
  let s = 0;
  for (let i = 0; i + 1 < rings.length; i++) {
    const s1 = s + v3.dist(centroid(rings[i]), centroid(rings[i + 1]));
    let v = 0;
    for (let j = 0; j < m; j++) {
      const j1 = (j + 1) % m;
      const e = v3.dist(rings[i][j], rings[i][j1]);
      mesh.face([ids[i][j], ids[i][j1], ids[i + 1][j1], ids[i + 1][j]], slotOf(i), [
        [v, s],
        [v + e, s],
        [v + e, s1],
        [v, s1],
      ]);
      v += e;
    }
    s = s1;
  }
  const flat = (ring: Vec3[]): Vec2[] => {
    const c = centroid(ring);
    return ring.map((p) => [p[0] - c[0], p[2] - c[2]]);
  };
  const first = [...ids[0]].reverse();
  mesh.face(first, slotOf(0), flat([...rings[0]].reverse()));
  mesh.face([...ids[rings.length - 1]], slotOf(rings.length - 2), flat(rings[rings.length - 1]));
  return mesh;
}

export function centroid(ring: Vec3[]): Vec3 {
  let c: Vec3 = [0, 0, 0];
  for (const p of ring) c = v3.add(c, p);
  return v3.scale(c, 1 / ring.length);
}

// --- profiles ------------------------------------------------------------------------------------

/**
 * A rectangle in (b, t) with independent chamfers on the bottom (t0) and top (t1) corners, and
 * optional side reveals (shallow grooves) at the given heights: the dressed-girder section.
 */
export function girderProfile(opts: {
  halfWidth: number;
  t0: number;
  t1: number;
  chamferBottom: number;
  chamferTop: number;
  /** Grooves cut into both sides: [tFrom, tTo, depth]. */
  grooves?: [number, number, number][];
  /** Slot of the outer (top) face and its chamfers; sides use `sideSlot`. */
  topSlot?: number;
  sideSlot?: number;
  bottomSlot?: number;
}): Profile {
  const { halfWidth: w, t0, t1, chamferBottom: cb, chamferTop: ct } = opts;
  const top = opts.topSlot ?? 0;
  const side = opts.sideSlot ?? 0;
  const bottom = opts.bottomSlot ?? 0;
  const grooves = [...(opts.grooves ?? [])].sort((a, b) => a[0] - b[0]);
  const pts: Vec2[] = [];
  const slots: number[] = [];
  const push = (b: number, t: number, slot: number) => {
    pts.push([b, t]);
    slots.push(slot);
  };
  // Bottom edge, left to right, then up the right side, across the top, down the left side.
  push(-w + cb, t0, bottom);
  push(w - cb, t0, side);
  push(w, t0 + cb, side);
  for (const [g0, g1, d] of grooves) {
    push(w, g0, side);
    push(w - d, g0 + d, side);
    push(w - d, g1 - d, side);
    push(w, g1, side);
  }
  push(w, t1 - ct, top);
  push(w - ct, t1, top);
  push(-w + ct, t1, top);
  push(-w, t1 - ct, side);
  for (const [g0, g1, d] of [...grooves].reverse()) {
    push(-w, g1, side);
    push(-w + d, g1 - d, side);
    push(-w + d, g0 + d, side);
    push(-w, g0, side);
  }
  push(-w, t0 + cb, bottom);
  return { pts, slots };
}

/** Rounded rectangle loop (counter-clockwise) centred at the origin. */
export function roundedRect(hw: number, hh: number, r: number, seg = 4): Vec2[] {
  const out: Vec2[] = [];
  const corners: [number, number, number][] = [
    [hw - r, -hh + r, -Math.PI / 2],
    [hw - r, hh - r, 0],
    [-hw + r, hh - r, Math.PI / 2],
    [-hw + r, -hh + r, Math.PI],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (Math.PI / 2) * (i / seg);
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return out;
}

/** Chamfered rectangle (octagon) loop, counter-clockwise, centred at the origin. */
export function chamferRect(hw: number, hh: number, c: number): Vec2[] {
  return [
    [-hw + c, -hh],
    [hw - c, -hh],
    [hw, -hh + c],
    [hw, hh - c],
    [hw - c, hh],
    [-hw + c, hh],
    [-hw, hh - c],
    [-hw, -hh + c],
  ];
}

/**
 * Revolves an open profile (r, h) about an axis into a closed solid. The profile runs from the axis
 * (r = 0) out and back to the axis (r = 0), counter-clockwise in (r, h) seen with r to the right and
 * h up, so faces point outward. `frame(r·cosφ, r·sinφ, h)` maps local coordinates (axis = local h)
 * to the world.
 */
export function revolve(profile: Vec2[], segments: number, frame: (x: number, y: number, h: number) => Vec3, slots: number | number[] = 0, crease = 35): PolyMesh {
  const mesh = new PolyMesh(crease);
  const n = profile.length;
  if (profile[0][0] !== 0 || profile[n - 1][0] !== 0) throw new Error('revolve: profile must start and end on the axis');
  const slotOf = (i: number) => (typeof slots === 'number' ? slots : slots[i]);
  const rings: number[][] = profile.map(([r, h]) => {
    if (r === 0) return [mesh.vert(frame(0, 0, h))];
    const ring: number[] = [];
    for (let s = 0; s < segments; s++) {
      const a = (2 * Math.PI * s) / segments;
      ring.push(mesh.vert(frame(r * Math.cos(a), r * Math.sin(a), h)));
    }
    return ring;
  });
  let v = 0;
  for (let i = 0; i + 1 < n; i++) {
    const A = rings[i];
    const B = rings[i + 1];
    const e = Math.hypot(profile[i + 1][0] - profile[i][0], profile[i + 1][1] - profile[i][1]);
    for (let s = 0; s < segments; s++) {
      const s1 = (s + 1) % segments;
      const u0 = s / segments;
      const u1 = (s + 1) / segments;
      if (A.length === 1) mesh.face([A[0], B[s1], B[s]], slotOf(i), [[u0, v], [u1, v + e], [u0, v + e]]);
      else if (B.length === 1) mesh.face([A[s], A[s1], B[0]], slotOf(i), [[u0, v], [u1, v], [u0, v + e]]);
      else mesh.face([A[s], A[s1], B[s1], B[s]], slotOf(i), [[u0, v], [u1, v], [u1, v + e], [u0, v + e]]);
    }
    v += e;
  }
  return mesh;
}

/** A straight sweep from a to b with a fixed profile, oriented by `up` (the profile's t axis). */
export function straightSweep(a: Vec3, b: Vec3, up: Vec3, profile: Profile, opts: SweepOptions = {}, segments = 1): PolyMesh {
  const pts: Vec3[] = [];
  for (let i = 0; i <= segments; i++) pts.push(v3.lerp(a, b, i / segments));
  return sweep(framesFrom(pts, pts.map(() => up)), profile, opts);
}

/** A closed loop profile from an outline (counter-clockwise), with every edge on one slot. */
export function loopProfile(pts: Vec2[], slot = 0): Profile {
  return { pts, slots: pts.map(() => slot) };
}
