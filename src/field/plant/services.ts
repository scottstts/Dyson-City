/**
 * The secondary plant's services (docs/field.md, "Secondary plant"): the plant is fed from the
 * viaducts, so it reads as one works on one network, not boxes on a lot.
 *
 *  - Lane racks: in each precinct, up to three pipe racks run from a viaduct, square to it, down the
 *    lanes between the buildings. Each carries a cryogen supply and return (foil) and a power line
 *    (gold) on steel T-posts at lane headroom. At the viaduct the lines rise into the spine's
 *    underside. The racks are placed where they serve the most buildings.
 *  - Branches: a building beside a rack takes a short line from its wall to the rack line on its
 *    side, teeing into it.
 *  - Feeders: a building with no rack but a clear straight run to a viaduct is fed directly by a
 *    pair of lines on their own posts, rising into the spine.
 *
 * Everything runs only where its path is clear: no building, road, hero's ground or pavilion in
 * the way, square to a straight stretch of a viaduct (no corners), clear of the viaduct's piers.
 * Buildings lower than a branch's height at the wall (most labs) are served from the trenches.
 */
import { PolyMesh, v3, type Vec3 } from '../../geometry/polyMesh';
import { box } from '../../geometry/solids';
import { FIELD_SLOT } from '../materials/materials';
import type { Parts } from '../kit/parts';
import { pipeRun } from '../kit/pipe';
import { FIELD_Y, PAVILIONS, PRECINCTS, TRENCH_HALF, distToSegment, onRoad, trenchLines, type Precinct } from '../layout';
import { SPINE } from '../network';
import { riseOk, spineAt, stretches, type Stretch } from './lanes';
import { heroKeepouts, inShape, plantLanes, plantLots, type Lot } from './lots';

/** A rack's lines: offset across it, radius, slot. Their bottoms are level at RACK.bottom. */
export const RACK_LINES = [
  { name: 'supply', off: -0.75, r: 0.26, slot: FIELD_SLOT.foil },
  { name: 'power', off: 0, r: 0.15, slot: FIELD_SLOT.gold },
  { name: 'return', off: 0.75, r: 0.21, slot: FIELD_SLOT.foil },
] as const;

/** A direct feeder's two lines (their bottoms level too). */
export const FEEDER_LINES = [
  { name: 'cryo', off: -0.45, r: 0.22, slot: FIELD_SLOT.foil },
  { name: 'power', off: 0.45, r: 0.15, slot: FIELD_SLOT.gold },
] as const;

/**
 * Lines' bottoms over the lanes (headroom), post spacing, a feeder's longest leg to a viaduct and
 * its longest first leg out of a building.
 */
export const SERVICE = { bottom: 5.0, post: 6, reach: 130, leg: 80, seat: 0.03 } as const;

export interface Rack {
  id: string;
  precinct: Precinct;
  /** The viaduct it rises into, the point it rises at, its direction into the precinct, its length. */
  line: string;
  hit: Vec3;
  d: Vec3;
  length: number;
  /** Height the risers end at (bedded in the spine's underside), above the platform. */
  top: number;
  branches: Branch[];
  posts: Vec3[];
}

export interface Branch {
  lot: Lot;
  /** Wall start (bedded) at its entry height, the wall's normal, the rack line it tees into, the tee point. */
  start: Vec3;
  n: Vec3;
  line: (typeof RACK_LINES)[number];
  end: Vec3;
}

export interface Feeder {
  lot: Lot;
  line: string;
  /** Last leg's direction, the wall start (at ground; bedded), the corner of an L (if any), the wall's normal. */
  d: Vec3;
  start: Vec3;
  corner?: Vec3;
  n: Vec3;
  /** Height it leaves the wall at (it rises to the run height clear of the wall when lower). */
  yIn: number;
  hit: Vec3;
  top: number;
  posts: Vec3[];
}

/** Below what height a building's wall is plain (under its clerestory, its eaves, its doors). */
function wallTop(l: Lot): number {
  switch (l.kind) {
    case 'hall':
    case 'hangar': {
      const rise = l.kind === 'hangar' ? l.W * 0.24 : Math.min(l.W * 0.2, l.H * 0.38);
      return Math.max(6, l.H - rise) - 2.6;
    }
    case 'lab':
      return Math.max(1.2, l.H * (l.H > 16 ? 0.42 : 0.58) - 2.6) - 0.2;
    case 'drum':
      return Math.min(l.H, l.cap - 2) - 2.8;
    case 'store':
      return Math.max(5, l.H - 2.4) - 0.6;
    case 'chiller':
      return Math.max(1.2, Math.min(l.H, 11) - 2.6) - 0.2;
    default:
      return 0;
  }
}

interface Face {
  /** Outward normal (unit, plan), the point on the wall (bedded 0.3 m) where lines leave it, at ground. */
  n: Vec3;
  at: Vec3;
}

/** A lot's usable faces: walls plain at the height lines enter, clear of doors, louvres and ribs. */
function faces(l: Lot): Face[] {
  const u: Vec3 = l.axis === 0 ? [1, 0, 0] : [0, 0, 1];
  const v: Vec3 = [-u[2], 0, u[0]];
  const c: Vec3 = [l.x, 0, l.z];
  const face = (axis: 'u' | 'v', s: number, along: number): Face => {
    const n = v3.scale(axis === 'u' ? u : v, s);
    const ext = l.kind === 'drum' ? l.W / 2 - 3.2 : axis === 'u' ? l.L / 2 : l.W / 2;
    return { n, at: v3.add(v3.add(c, v3.scale(axis === 'u' ? v : u, along)), v3.scale(n, ext - 0.3)) };
  };
  switch (l.kind) {
    case 'hall':
    case 'hangar': {
      // Mid-bay between the frame ribs on the long walls.
      const nb = Math.max(1, Math.round((l.L - 6) / 8));
      const along = -l.L / 2 + 3 + ((l.L - 6) * (Math.floor(nb / 2) + 0.5)) / nb;
      return [face('v', 1, along), face('v', -1, along)];
    }
    case 'lab':
      return [face('v', -l.face, 0), face('u', 1, 0), face('u', -1, 0)];
    case 'drum':
      return [face('u', 1, 0), face('u', -1, 0), face('v', 1, 0), face('v', -1, 0)];
    case 'store':
    case 'chiller':
      return [face('v', -l.face, 0)];
    default:
      return [];
  }
}


let cache: { racks: Rack[]; feeders: Feeder[] } | null = null;

/** Every rack, branch and feeder (deterministic). */
export function servicePlan(): { racks: Rack[]; feeders: Feeder[] } {
  if (cache) return cache;
  const lots = plantLots();
  const heroes = heroKeepouts();
  const trenches = trenchLines();
  /** Obstacles: rectangles (centre, half sizes) of the lots, grown by m; and the racks placed so far. */
  const corridors: { x: number; z: number; hx: number; hz: number }[] = [];
  const builtAt = (x: number, z: number, m: number, skip?: Lot) =>
    lots.some((o) => o !== skip && Math.abs(x - o.x) < (o.axis === 0 ? o.L : o.W) / 2 + m && Math.abs(z - o.z) < (o.axis === 0 ? o.W : o.L) / 2 + m) ||
    corridors.some((c) => Math.abs(x - c.x) < c.hx + m && Math.abs(z - c.z) < c.hz + m);
  const groundOk = (x: number, z: number, road: boolean) =>
    !(road && onRoad(x, z, 0.5)) && !heroes.some((h) => inShape(h.shape, x, z, 0)) && !PAVILIONS.some((p) => Math.hypot(p.x - x, p.z - z) < 6);
  const lineY = (r: number) => SERVICE.bottom + r;
  const postsAlong = (o: Vec3, d: Vec3, s0: number, s1: number, avoid: number[]) => {
    const out: Vec3[] = [];
    const np = Math.max(1, Math.ceil((s1 - s0) / SERVICE.post));
    for (let k = 0; k <= np; k++) {
      const s = s0 + ((s1 - s0) * k) / np;
      if (avoid.some((a) => Math.abs(a - s) < 1.3)) continue;
      const p = v3.add(o, v3.scale(d, s));
      if (onRoad(p[0], p[2], 0.6) || trenches.some((tr) => distToSegment(p[0], p[2], tr) < TRENCH_HALF + 0.5)) continue;
      out.push(p);
    }
    return out;
  };

  // --- Lane racks: one down each service lane, serving the buildings either side ----------------
  const served = new Set<Lot>();
  const racks: Rack[] = [];
  for (const lane of plantLanes()) {
    const d: Vec3 = [lane.d[0], 0, lane.d[1]];
    const e: Vec3 = [-d[2], 0, d[0]];
    const hit: Vec3 = [lane.hit[0], 0, lane.hit[1]];
    const branches: Branch[] = [];
    for (const l of lots) {
      if (l.precinct !== lane.precinct || served.has(l)) continue;
      for (const f of faces(l)) {
        // A face square to the lane, facing it, beside it, within its run.
        if (Math.abs(f.n[0] * e[0] + f.n[2] * e[2]) < 0.99) continue;
        const toward = (hit[0] - f.at[0]) * f.n[0] + (hit[2] - f.at[2]) * f.n[2];
        if (toward < 2.2 || toward > 14) continue;
        const sAt = (f.at[0] - hit[0]) * d[0] + (f.at[2] - hit[2]) * d[2];
        if (sAt < 9 || sAt > lane.length - 1.5) continue;
        // The rack line on the building's side.
        const side = (f.at[0] - hit[0]) * e[0] + (f.at[2] - hit[2]) * e[2];
        const ln = side < 0 ? RACK_LINES[0] : RACK_LINES[2];
        const y = lineY(ln.r);
        // It leaves the wall below its clerestory and rises to the rack's height clear of the wall.
        const yIn = Math.min(y, wallTop(l) - ln.r - 0.3);
        if (yIn < 0.9) continue;
        const run = toward - Math.abs(ln.off) + ln.r * 0.5;
        let clear = true;
        for (let s = 0.5; s < run - 1 && clear; s += 1) {
          const q = v3.add(f.at, v3.scale(f.n, s));
          if (builtAt(q[0], q[2], 0.6, l) || !groundOk(q[0], q[2], true)) clear = false;
        }
        if (!clear) continue;
        branches.push({ lot: l, start: v3.add(f.at, [0, yIn, 0]), n: f.n, line: ln, end: v3.add(v3.add(f.at, v3.scale(f.n, run)), [0, y, 0]) });
        break;
      }
    }
    if (!branches.length) continue;
    const at = (b: Branch) => (b.end[0] - hit[0]) * d[0] + (b.end[2] - hit[2]) * d[2];
    const length = Math.min(lane.length, Math.max(...branches.map(at)) + 2.5);
    const top = spineAt(lane.path, hit[0], hit[2]) - SPINE.halfDepth + 0.2;
    const posts = postsAlong(hit, d, 4, length - 0.6, branches.map(at));
    for (const b of branches) served.add(b.lot);
    racks.push({ id: lane.id, precinct: PRECINCTS.find((p) => p.name === lane.precinct)!, line: lane.line, hit, d, length, top, branches, posts });
    const mid = v3.add(hit, v3.scale(d, length / 2));
    corridors.push({ x: mid[0], z: mid[2], hx: Math.abs(d[0]) * (length / 2) + Math.abs(d[2]) * 1.4, hz: Math.abs(d[2]) * (length / 2) + Math.abs(d[0]) * 1.4 });
  }

  // --- Direct feeders for buildings no rack serves: straight, or with one square turn ---------
  const feeders: Feeder[] = [];
  const stretchList = stretches();
  const Y = SERVICE.bottom + Math.max(...FEEDER_LINES.map((f) => f.r));
  /** Clear along a straight leg (plan), sampled every metre, `skip` its own building. */
  // (Roads may be crossed: the lines bridge them at lane headroom; no post stands on one.)
  const legClear = (a: Vec3, b: Vec3, skip: Lot) => {
    const len = v3.dist(a, b);
    const u = v3.scale(v3.sub(b, a), 1 / Math.max(len, 1e-6));
    const e: Vec3 = [-u[2], 0, u[0]];
    for (let s = 0; s <= len; s += 1) {
      for (const lat of [-1.1, 0, 1.1]) {
        const q = v3.add(v3.add(a, v3.scale(u, s)), v3.scale(e, lat));
        if (builtAt(q[0], q[2], 1.0, skip) || !groundOk(q[0], q[2], false)) return false;
      }
    }
    return true;
  };
  /** Where a leg from p along u meets a straight stretch square to it (distance, stretch), within reach. */
  const meet = (p: Vec3, u: Vec3, reach: number) => {
    let best: { t: number; st: Stretch } | null = null;
    for (const st of stretchList) {
      const sx = st.b[0] - st.a[0];
      const sz = st.b[1] - st.a[1];
      const sl = Math.hypot(sx, sz);
      if (Math.abs((sx * u[0] + sz * u[2]) / sl) > 1e-3) continue;
      const nx = -sz / sl;
      const nz = sx / sl;
      const t = ((st.a[0] - p[0]) * nx + (st.a[1] - p[2]) * nz) / (u[0] * nx + u[2] * nz);
      if (!(t > 3) || t > reach || (best && t >= best.t)) continue;
      const h = v3.add(p, v3.scale(u, t));
      const along = ((h[0] - st.a[0]) * sx + (h[2] - st.a[1]) * sz) / sl;
      if (along < 2 || along > sl - 2 || !riseOk(st, h[0], h[2])) continue;
      best = { t, st };
    }
    return best;
  };
  for (const l of lots) {
    if (served.has(l)) continue;
    let best: (Feeder & { len: number }) | null = null;
    for (const f of faces(l)) {
      const yIn = Math.min(Y, wallTop(l) - 0.22 - 0.3);
      if (yIn < 0.9) continue;
      // Out from the wall a legs (straight on to a viaduct, or turning square onto one).
      const options: { pts: Vec3[]; hit: Vec3; st: Stretch; dLast: Vec3 }[] = [];
      const straight = meet(f.at, f.n, SERVICE.reach);
      if (straight) options.push({ pts: [f.at], hit: v3.add(f.at, v3.scale(f.n, straight.t)), st: straight.st, dLast: f.n });
      for (let a = 4; a <= SERVICE.leg; a += 2) {
        const corner = v3.add(f.at, v3.scale(f.n, a));
        for (const s of [-1, 1]) {
          const m: Vec3 = [-f.n[2] * s, 0, f.n[0] * s];
          const hit = meet(corner, m, SERVICE.reach);
          if (hit) options.push({ pts: [f.at, corner], hit: v3.add(corner, v3.scale(m, hit.t)), st: hit.st, dLast: m });
        }
      }
      for (const o of options) {
        const legs = [...o.pts, o.hit];
        let len = 0;
        for (let i = 0; i + 1 < legs.length; i++) len += v3.dist(legs[i], legs[i + 1]);
        if (best && len >= best.len) continue;
        let ok = true;
        for (let i = 0; i + 1 < legs.length && ok; i++) ok = legClear(i === 0 ? v3.add(legs[0], v3.scale(f.n, 0.5)) : legs[i], legs[i + 1], l);
        if (!ok) continue;
        const posts: Vec3[] = [];
        for (let i = 0; i + 1 < legs.length; i++) {
          const u = v3.norm(v3.sub(legs[i + 1], legs[i]));
          const L = v3.dist(legs[i], legs[i + 1]);
          posts.push(...postsAlong(legs[i], u, i === 0 ? 2.5 : 1.5, L - 2.2, []));
        }
        best = { lot: l, line: o.st.path.name, d: o.dLast, start: f.at, corner: o.pts[1], n: f.n, yIn, hit: o.hit, top: spineAt(o.st.path, o.hit[0], o.hit[2]) - SPINE.halfDepth + 0.2, posts, len };
      }
    }
    if (!best) continue;
    const { len: _len, ...fd } = best;
    feeders.push(fd);
    served.add(l);
    // Later feeders keep off this one's legs.
    const legs = [fd.start, ...(fd.corner ? [fd.corner] : []), fd.hit];
    for (let i = 0; i + 1 < legs.length; i++) {
      const a = legs[i];
      const b = legs[i + 1];
      corridors.push({ x: (a[0] + b[0]) / 2, z: (a[2] + b[2]) / 2, hx: Math.abs(a[0] - b[0]) / 2 + 1.0, hz: Math.abs(a[2] - b[2]) / 2 + 1.0 });
    }
  }
  cache = { racks, feeders };
  return cache;
}

/** One line from a point at its run height to a riser into the spine. */
function riserRun(from: Vec3, hit: Vec3, off: Vec3, y: number, top: number, r: number, slot: number): PolyMesh {
  const a = v3.add(from, [0, FIELD_Y + y, 0]);
  const b = v3.add(v3.add(hit, off), [0, FIELD_Y + y, 0]);
  const c = v3.add(v3.add(hit, off), [0, FIELD_Y + top, 0]);
  return pipeRun([v3.add(a, off), b, c], { r, slot, bend: r * 4, spool: 24, segments: r > 0.2 ? 12 : 10, bareEnds: true });
}

/** T-posts: a steel stem and a crossbar of half-width `half` the lines rest on (bedded in both). */
function tPosts(posts: Vec3[], d: Vec3, half: number): PolyMesh {
  const e: Vec3 = [-d[2], 0, d[0]];
  const m = new PolyMesh(36);
  const under = SERVICE.bottom;
  for (const p of posts) {
    const g: Vec3 = [p[0], FIELD_Y, p[2]];
    m.append(box({ o: v3.add(g, [0, (under - 0.14) / 2 - 0.01, 0]), u: d, v: e, w: [0, 1, 0] }, 0.12, 0.12, (under - 0.14) / 2 + 0.03, 0.02, FIELD_SLOT.steel));
    m.append(box({ o: v3.add(g, [0, under - 0.07 + SERVICE.seat / 2, 0]), u: d, v: e, w: [0, 1, 0] }, 0.1, half, 0.07 + SERVICE.seat / 2, 0.02, FIELD_SLOT.steel));
  }
  return m;
}

export function buildRack(parts: Parts, rk: Rack): void {
  const e: Vec3 = [-rk.d[2], 0, rk.d[0]];
  const end = v3.add(rk.hit, v3.scale(rk.d, rk.length));
  for (const ln of RACK_LINES) {
    const off = v3.scale(e, ln.off);
    parts.add(`rack:${rk.id}:${ln.name}`, riserRun(end, rk.hit, off, SERVICE.bottom + ln.r, rk.top, ln.r, ln.slot));
  }
  if (rk.posts.length) parts.addSet(`rack:${rk.id}:posts`, tPosts(rk.posts, rk.d, 1.15));
  for (const br of rk.branches) {
    const r = br.line.r * 0.7;
    const a = v3.add(br.start, [0, FIELD_Y, 0]);
    const z = v3.add(br.end, [0, FIELD_Y, 0]);
    // Level when it enters at the rack's height; otherwise out 1.4 m, up, and across.
    const pts = Math.abs(z[1] - a[1]) < 0.05 ? [a, z] : [a, v3.add(a, v3.scale(br.n, 1.4)), [a[0] + br.n[0] * 1.4, z[1], a[2] + br.n[2] * 1.4] as Vec3, z];
    parts.add(`${br.lot.name}:branch`, pipeRun(pts, { r, slot: br.line.slot, bend: r * 3, spool: 24, segments: 10, bareEnds: true }));
  }
}

export function buildFeeder(parts: Parts, fd: Feeder): void {
  const plan = [fd.start, ...(fd.corner ? [fd.corner] : []), fd.hit];
  for (const ln of FEEDER_LINES) {
    const y = FIELD_Y + SERVICE.bottom + ln.r;
    // Each line offset to the left of the run by ln.off (mitred at the square turn: for a right
    // angle the mitre is the sum of the two legs' left offsets).
    const left = (u: Vec3): Vec3 => [-u[2], 0, u[0]];
    const dir = (i: number) => v3.norm(v3.sub(plan[i + 1], plan[i]));
    const off = (i: number): Vec3 => {
      if (i === 0) return v3.scale(left(dir(0)), ln.off);
      if (i === plan.length - 1) return v3.scale(left(dir(i - 1)), ln.off);
      return v3.scale(v3.add(left(dir(i - 1)), left(dir(i))), ln.off);
    };
    const pts: Vec3[] = [];
    const a0 = v3.add(fd.start, off(0));
    const yIn = FIELD_Y + Math.min(fd.yIn, SERVICE.bottom + ln.r);
    pts.push([a0[0], yIn, a0[2]]);
    if (y - yIn > 0.05) {
      const out = v3.add(a0, v3.scale(fd.n, 1.4));
      pts.push([out[0], yIn, out[2]], [out[0], y, out[2]]);
    }
    for (let i = 1; i < plan.length; i++) {
      const p = v3.add(plan[i], off(i));
      pts.push([p[0], y, p[2]]);
    }
    const h = pts[pts.length - 1];
    pts.push([h[0], FIELD_Y + fd.top, h[2]]);
    parts.add(`${fd.lot.name}:feeder:${ln.name}`, pipeRun(pts, { r: ln.r, slot: ln.slot, bend: ln.r * 4, spool: 24, segments: ln.r > 0.2 ? 12 : 10, bareEnds: true }));
  }
  if (fd.posts.length) {
    // Posts square to the leg they stand under.
    const m = new PolyMesh(36);
    for (let i = 0; i + 1 < plan.length; i++) {
      const u = v3.norm(v3.sub(plan[i + 1], plan[i]));
      const mine = fd.posts.filter((p) => {
        const r = v3.sub(p, plan[i]);
        const s = r[0] * u[0] + r[2] * u[2];
        return Math.abs(r[0] * -u[2] + r[2] * u[0]) < 0.01 && s > 0 && s < v3.dist(plan[i], plan[i + 1]);
      });
      m.append(tPosts(mine, u, 0.8));
    }
    parts.addSet(`${fd.lot.name}:feedposts`, m);
  }
}

/** Declared seats: lines bedded in their building and in the spine, branches teed into their rack line, posts under the lines. */
export function serviceAllow(): [string, string][] {
  const { racks, feeders } = servicePlan();
  const out: [string, string][] = [];
  for (const rk of racks) {
    out.push([`plant:rack:${rk.id}:`, `net:${rk.line}:spine`], [`plant:set:rack:${rk.id}:posts`, `plant:rack:${rk.id}:`]);
    for (const br of rk.branches) {
      const p = `plant:${br.lot.name}:`;
      out.push([`${p}branch`, `plant:rack:${rk.id}:${br.line.name}`], [`${p}branch`, `${p}body`], [`${p}branch`, `${p}tier`], [`${p}branch`, `plant:set:${br.lot.name}:pilasters`]);
    }
  }
  for (const fd of feeders) {
    const p = `plant:${fd.lot.name}:`;
    out.push([`${p}feeder`, `${p}body`], [`${p}feeder`, `${p}tier`], [`${p}feeder`, `plant:set:${fd.lot.name}:pilasters`], [`plant:set:${fd.lot.name}:feedposts`, `${p}feeder`], [`${p}feeder`, `net:${fd.line}:spine`]);
  }
  return out;
}
