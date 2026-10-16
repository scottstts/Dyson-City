/**
 * Modelling kit for the estate: profile sweeps along plan polylines (walls, copings, rails, kerbs,
 * edgings, hedges) with exact mitres, open (capped) or closed. A profile is a closed loop in
 * (b, y): b across the run (positive to the run's outward side, the left of travel in x-right,
 * z-down plan), y absolute height. Each profile edge may carry its own material slot.
 */
import { PolyMesh, type Vec2, type Vec3 } from '../geometry/polyMesh';
import { orientOutward, type Basis } from '../geometry/solids';

/** A basis at `o` whose w (a lathe's axis) points up: turned work stands upright. */
export function upright(o: Vec3 = [0, 0, 0]): Basis {
  return { o, u: [1, 0, 0], v: [0, 0, -1], w: [0, 1, 0] };
}
import type { V2 } from './sdf2';

export interface RunProfile {
  /** Closed loop in (b, y). */
  pts: Vec2[];
  /** Slot per edge pts[i] → pts[i+1] (default: `slot`). */
  slots?: number[];
}

/** Outward (left-of-travel) unit normal in plan for a direction (dx, dz): (−dz, dx)… normalised. */
function leftOf(dx: number, dz: number): V2 {
  const l = Math.hypot(dx, dz) || 1;
  return [-dz / l, dx / l];
}

/**
 * Mitred offsets along a plan polyline: for each vertex the offset direction and its length scale,
 * so a profile offset b lands exactly on both adjoining segments' offset lines.
 */
export function mitres(path: V2[], closed: boolean): { m: V2; s: number }[] {
  const n = path.length;
  const out: { m: V2; s: number }[] = [];
  for (let i = 0; i < n; i++) {
    const prev = closed ? path[(i - 1 + n) % n] : path[Math.max(i - 1, 0)];
    const next = closed ? path[(i + 1) % n] : path[Math.min(i + 1, n - 1)];
    const a = i > 0 || closed ? leftOf(path[i][0] - prev[0], path[i][1] - prev[1]) : leftOf(next[0] - path[i][0], next[1] - path[i][1]);
    const b = i < n - 1 || closed ? leftOf(next[0] - path[i][0], next[1] - path[i][1]) : a;
    let mx = a[0] + b[0];
    let mz = a[1] + b[1];
    const l = Math.hypot(mx, mz);
    if (l < 1e-6) {
      mx = b[0];
      mz = b[1];
    } else {
      mx /= l;
      mz /= l;
    }
    const cos = mx * b[0] + mz * b[1];
    out.push({ m: [mx, mz], s: 1 / Math.max(cos, 0.3) });
  }
  return out;
}

/**
 * Sweeps a profile along a plan polyline. Open runs get planar end caps (`capSlot`). UVs: u is arc
 * length along the run (m), v the perimeter around the profile (m).
 */
export function runSweep(path: V2[], profile: RunProfile, opts: { closed?: boolean; slot?: number; capSlot?: number; crease?: number } = {}): PolyMesh {
  const closed = opts.closed ?? false;
  const slot = opts.slot ?? 0;
  const mesh = new PolyMesh(opts.crease ?? 35);
  const P = profile.pts;
  const np = P.length;
  const mt = mitres(path, closed);
  const arc: number[] = [0];
  for (let i = 1; i < path.length; i++) arc.push(arc[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const per: number[] = [0];
  for (let k = 1; k <= np; k++) per.push(per[k - 1] + Math.hypot(P[k % np][0] - P[k - 1][0], P[k % np][1] - P[k - 1][1]));
  const rings = path.map((p, i) => P.map(([b, y]) => mesh.vert([p[0] + mt[i].m[0] * b * mt[i].s, y, p[1] + mt[i].m[1] * b * mt[i].s] as Vec3)));
  const segs = closed ? path.length : path.length - 1;
  for (let i = 0; i < segs; i++) {
    const i1 = (i + 1) % path.length;
    const u0 = arc[i];
    const u1 = i1 === 0 ? arc[path.length - 1] + Math.hypot(path[0][0] - path[path.length - 1][0], path[0][1] - path[path.length - 1][1]) : arc[i1];
    for (let k = 0; k < np; k++) {
      const k1 = (k + 1) % np;
      mesh.face([rings[i][k], rings[i1][k], rings[i1][k1], rings[i][k1]], profile.slots?.[k] ?? slot, [
        [u0, per[k]],
        [u1, per[k]],
        [u1, per[k + 1]],
        [u0, per[k + 1]],
      ]);
    }
  }
  if (!closed) {
    const cs = opts.capSlot ?? slot;
    // Caps run each end ring opposite to how the side faces use its edges, so the solid is consistent.
    mesh.face([...rings[0]], cs, P.map(([b, y]) => [b, y] as Vec2));
    mesh.face([...rings[path.length - 1]].reverse(), cs, [...P].reverse().map(([b, y]) => [b, y] as Vec2));
  }
  return orientOutward(mesh);
}

/** A rounded-rectangle profile (b0..b1 across, y0..y1 up), corners rounded by r with `seg` steps. */
export function roundedProfile(b0: number, b1: number, y0: number, y1: number, r: number, seg = 3, roundBottom = false): Vec2[] {
  const pts: Vec2[] = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  const rb = roundBottom ? r : 0;
  if (rb > 0) corner(b0 + rb, y0 + rb, Math.PI);
  else pts.push([b0, y0]);
  if (rb > 0) corner(b1 - rb, y0 + rb, -Math.PI / 2);
  else pts.push([b1, y0]);
  corner(b1 - r, y1 - r, 0);
  corner(b0 + r, y1 - r, Math.PI / 2);
  return pts;
}

/** Resamples a polyline so no segment is longer than `ds` (keeps every original vertex). */
export function densify(path: V2[], ds: number, closed = false): V2[] {
  const out: V2[] = [];
  const n = path.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = path[i];
    const b = path[(i + 1) % n];
    const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / ds));
    for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  if (!closed) out.push(path[n - 1]);
  return out;
}

/** Points at distances `at` along a polyline, with the unit direction there. */
export function pointsAlong(path: V2[], at: number[]): { p: V2; d: V2 }[] {
  const out: { p: V2; d: V2 }[] = [];
  let i = 0;
  let s0 = 0;
  for (const s of [...at].sort((a, b) => a - b)) {
    while (i < path.length - 2) {
      const l = Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
      if (s0 + l >= s) break;
      s0 += l;
      i++;
    }
    const a = path[i];
    const b = path[i + 1];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const t = Math.min(Math.max((s - s0) / l, 0), 1);
    out.push({ p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], d: [(b[0] - a[0]) / l, (b[1] - a[1]) / l] });
  }
  return out;
}

export function pathLength(path: V2[]): number {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return s;
}
