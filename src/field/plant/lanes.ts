/**
 * Service lanes (docs/field.md, "Secondary plant"): planned before the buildings, so the plant is
 * laid out along its services the way a works is. In each precinct, lanes run square from the
 * viaduct along its longest border into the precinct, about every 56 m. Each lane carries a pipe
 * rack (services.ts) that rises into the viaduct's spine where the lane leaves it. The packer
 * (lots.ts) keeps the lane clear, so the buildings line up along it.
 *
 * Pure data (no geometry): lots.ts, services.ts, the site plan and the tests read it.
 */
import { PAVILIONS, rackLines, type Precinct } from '../layout';
import { SPINE, pierPlan, viaductPaths, type ViaductPath } from '../network';

type V2 = [number, number];

/** Half-width kept clear for a lane (the rack and room to reach it), lane spacing, least run. */
export const LANE = { half: 4.6, spacing: 56, min: 30, bottom: 5.0 } as const;

export interface Stretch {
  a: V2;
  b: V2;
  path: ViaductPath;
  piers: V2[];
}

export interface Lane {
  id: string;
  precinct: string;
  /** The viaduct it leaves, where (plan), its direction into the precinct, and how far it may run. */
  line: string;
  path: ViaductPath;
  hit: V2;
  d: V2;
  length: number;
}

/** Straight stretches of the viaducts (corners trimmed), with their path and their piers. */
export function stretches(): Stretch[] {
  const paths = viaductPaths();
  const piers = pierPlan(paths);
  const out: Stretch[] = [];
  for (const [pi, l] of rackLines().entries()) {
    const pa = paths[pi];
    const pierXZ = piers[pi].map((i): V2 => [pa.p[i][0], pa.p[i][1]]);
    const n = l.pts.length;
    const segs = l.close ? n : n - 1;
    for (let k = 0; k < segs; k++) {
      const a = l.pts[k];
      const b = l.pts[(k + 1) % n];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ux = (b[0] - a[0]) / len;
      const uz = (b[1] - a[1]) / len;
      const t0 = l.close || k > 0 ? 32 : 6;
      const t1 = l.close || k < segs - 1 ? 32 : 6;
      if (len - t0 - t1 < 10) continue;
      out.push({ a: [a[0] + ux * t0, a[1] + uz * t0], b: [b[0] - ux * t1, b[1] - uz * t1], path: pa, piers: pierXZ });
    }
  }
  return out;
}

/** Spine height (above the platform) at the sample nearest a point. */
export function spineAt(pa: ViaductPath, x: number, z: number): number {
  let bi = 0;
  let bd = Infinity;
  pa.p.forEach((p, i) => {
    const d = Math.hypot(p[0] - x, p[1] - z);
    if (d < bd) {
      bd = d;
      bi = i;
    }
  });
  return pa.y(pa.s[bi]);
}

/** Can lines rise into the spine here (clear of piers and pavilions, with headroom under the spine)? */
export function riseOk(st: Stretch, x: number, z: number): boolean {
  return !st.piers.some((p) => Math.hypot(p[0] - x, p[1] - z) < 3.2) && !PAVILIONS.some((p) => Math.hypot(p.x - x, p.z - z) < 9) && spineAt(st.path, x, z) - SPINE.halfDepth - 1.0 > LANE.bottom + 0.6;
}

const inside = (p: Precinct, x: number, z: number) => x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1;

/**
 * A precinct's lanes. `blocked(x, z)` says where a lane must stop (keep-outs other than the viaduct
 * itself); the lane runs at most to the precinct's far edge.
 */
export function precinctLanes(p: Precinct, blocked: (x: number, z: number) => boolean): Lane[] {
  const pc: V2 = [(p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2];
  // The stretch along the precinct's longest border: where a point 14 m in lies in the precinct.
  let best: { st: Stretch; t: V2; d: V2; w0: number; w1: number } | null = null;
  for (const st of stretches()) {
    const sl = Math.hypot(st.b[0] - st.a[0], st.b[1] - st.a[1]);
    const t: V2 = [(st.b[0] - st.a[0]) / sl, (st.b[1] - st.a[1]) / sl];
    let d: V2 = [-t[1], t[0]];
    if ((pc[0] - st.a[0]) * d[0] + (pc[1] - st.a[1]) * d[1] < 0) d = [-d[0], -d[1]];
    let w0 = Infinity;
    let w1 = -Infinity;
    for (let w = 0; w <= sl; w += 1) {
      const x = st.a[0] + t[0] * w + d[0] * 14;
      const z = st.a[1] + t[1] * w + d[1] * 14;
      if (inside(p, x, z)) {
        w0 = Math.min(w0, w);
        w1 = Math.max(w1, w);
      }
    }
    if (w1 - w0 > 40 && (!best || w1 - w0 > best.w1 - best.w0)) best = { st, t, d, w0, w1 };
  }
  if (!best) return [];
  const { st, t, d, w0, w1 } = best;
  const lanes: Lane[] = [];
  const n = Math.max(1, Math.floor((w1 - w0 - 24) / LANE.spacing) + 1);
  const span = (n - 1) * LANE.spacing;
  for (let k = 0; k < n; k++) {
    const target = (w0 + w1) / 2 - span / 2 + k * LANE.spacing;
    // Nudge off the piers and pavilions.
    for (const dw of [0, 2, -2, 4, -4, 6, -6, 8, -8]) {
      const w = target + dw;
      if (w < w0 + 8 || w > w1 - 8) continue;
      const hx = st.a[0] + t[0] * w;
      const hz = st.a[1] + t[1] * w;
      if (!riseOk(st, hx, hz)) continue;
      let length = 0;
      for (let s = 8; s < 240; s += 1) {
        const x = hx + d[0] * s;
        const z = hz + d[1] * s;
        if (!inside(p, x, z)) break;
        if ([-LANE.half + 1, 0, LANE.half - 1].some((l) => blocked(x + t[0] * l, z + t[1] * l))) break;
        length = s;
      }
      // Only where there is ground to serve either side: a lane through a thin strip would split it
      // into pieces too narrow to build on.
      let n = 0;
      let open = 0;
      for (let s = 8; s <= length; s += 3) {
        for (let l = -26; l <= 26; l += 3) {
          if (Math.abs(l) < LANE.half) continue;
          const x = hx + d[0] * s + t[0] * l;
          const z = hz + d[1] * s + t[1] * l;
          n++;
          if (inside(p, x, z) && !blocked(x, z)) open++;
        }
      }
      if (length >= LANE.min && open >= 0.72 * n) lanes.push({ id: `${p.name}-l${lanes.length}`, precinct: p.name, line: st.path.name, path: st.path, hit: [hx, hz], d, length });
      break;
    }
  }
  return lanes;
}

/** Is (x, z) within a lane's reserved strip (grown by m)? */
export function inLane(ln: Lane, x: number, z: number, m = 0): boolean {
  const rx = x - ln.hit[0];
  const rz = z - ln.hit[1];
  const s = rx * ln.d[0] + rz * ln.d[1];
  const l = -rx * ln.d[1] + rz * ln.d[0];
  return s > -2 - m && s < ln.length + m && Math.abs(l) < LANE.half + m;
}
