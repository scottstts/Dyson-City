/**
 * Where the field's crew works (docs/crew.md, "The field"): every ground robot belongs to one
 * precinct and never leaves it (the precincts are islands between the roads, so no robot ever
 * stands on a road). Its work is a beat of posts, found from what the precinct holds:
 *
 *  - Hands read their slates at the plant's doors and the valve pavilions, crouch at the pipe
 *    racks' posts, and stand looking up at the hero;
 *  - Riggers raise their booms to the racks' lines at lane headroom;
 *  - Drays park over bronze service sockets set in the lanes' paving (fixtures.ts).
 *
 * Posts are chosen from the layout (deterministic), placed on the navigation grid with the robot's
 * clearance, and kept only if every leg of the beat has a path inside the precinct.
 */
import { COMPOUND_R, CORDON, CORRIDOR, distToSegment, inCompound, inEstate, onRoad, PAVILIONS, PRECINCTS, RING_ROAD, ROADS, type Precinct } from '../../field/layout';
import { heroKeepouts, plantLanes, plantLots } from '../../field/plant/lots';
import { SERVICE, RACK_LINES, servicePlan } from '../../field/plant/services';
import { PAVILION } from '../../field/network';
import { tankLayout } from '../../field/heroes/coldHold';
import { rng } from '../../field/kit/parts';
import { clearanceAt, findPath, lineClear, nearestFree, type NavGrid, type P2 } from '../nav';
import { DRAY } from '../models/dray';
import type { Vec3 } from '../../geometry/polyMesh';
import { FIELD_Y } from '../../field/layout';

/** Where the crew may never stand (beyond what the field's occupancy blocks). */
export function fieldOut(x: number, z: number): boolean {
  if (!inCompound(x, z, 1)) return true;
  if (inEstate(x, z, 3)) return true;
  if (onRoad(x, z, 1.4)) return true;
  if (Math.hypot(x, z) < RING_ROAD.r1 + 3) return true;
  // The craft corridor's ground (craft fly it a few tens of metres up).
  if (x > CORRIDOR.x0 - 3 && Math.abs(z) < CORRIDOR.half + 1.5) return true;
  return false;
}

/**
 * The same rule as `fieldOut`, for a whole grid at once: the cheap tests per cell, the roads
 * rasterised segment by segment (a per-cell test of every road was most of the crew's boot).
 */
export function fieldOutMask(x0: number, z0: number, cell: number, nx: number, nz: number): Uint8Array {
  const m = new Uint8Array(nx * nz);
  const rOut = COMPOUND_R - 1;
  const rIn = RING_ROAD.r1 + 3;
  for (let j = 0; j < nz; j++) {
    const z = z0 + (j + 0.5) * cell;
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * cell;
      const r = Math.hypot(x, z);
      if (r > rOut || r < rIn || x < CORDON.frontX + 7 || (x > CORRIDOR.x0 - 3 && Math.abs(z) < CORRIDOR.half + 1.5) || inEstate(x, z, 12)) m[j * nx + i] = 1;
    }
  }
  for (const s of ROADS) {
    const w = s.half + 1.4;
    const i0 = Math.max(0, Math.floor((Math.min(s.a[0], s.b[0]) - w - x0) / cell));
    const i1 = Math.min(nx - 1, Math.floor((Math.max(s.a[0], s.b[0]) + w - x0) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(s.a[1], s.b[1]) - w - z0) / cell));
    const j1 = Math.min(nz - 1, Math.floor((Math.max(s.a[1], s.b[1]) + w - z0) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (distToSegment(x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell, s) < w) m[j * nx + i] = 1;
  }
  return m;
}

export type HandTask = 'read' | 'crouch' | 'survey';

export interface Post {
  /** Where the robot stands, and the yaw it faces (0: +z). */
  x: number;
  z: number;
  face: number;
  /** What it looks at, or reaches toward. */
  look: Vec3;
  task: HandTask | 'boom' | 'dock';
  /** Seconds it stays (min, max). */
  dwell: [number, number];
}

export interface Beat {
  precinct: Precinct;
  posts: Post[];
  /** legs[i]: the path from post i to post i + 1 (the last back to the first). */
  legs: P2[][];
}

/** Clearances on the grid (m): a Hand, a Rigger (its pads' spread), a Dray (half its width and some). */
export const CLEARANCE = { hand: 0.5, rigger: 1.25, dray: 1.45 } as const;

const box = (p: Precinct, m: number): [number, number, number, number] => [p.x0 + m, p.x1 - m, p.z0 + m, p.z1 - m];
const inBox = (p: Precinct, x: number, z: number, m = 2) => x > p.x0 + m && x < p.x1 - m && z > p.z0 + m && z < p.z1 - m;
const yawTo = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z);

/** Candidate posts for a Hand in a precinct, from what stands in it. */
type Candidate = Omit<Post, 'x' | 'z' | 'face'> & { at: P2 };

function handCandidates(p: Precinct): Candidate[] {
  const out: (Omit<Post, 'x' | 'z' | 'face'> & { at: P2 })[] = [];
  // The plant's fronts: its doors face the lanes.
  for (const l of plantLots()) {
    if (l.precinct !== p.name) continue;
    const n: P2 = l.axis === 0 ? [0, l.face] : [l.face, 0];
    const half = l.W / 2;
    const front: P2 = [l.x + n[0] * half, l.z + n[1] * half];
    out.push({ at: [front[0] + n[0] * 2.2, front[1] + n[1] * 2.2], look: [front[0], FIELD_Y + 2.2, front[1]], task: 'read', dwell: [16, 30] });
  }
  // The valve pavilions' doors.
  for (const pv of PAVILIONS) {
    const d = Math.hypot(pv.x, pv.z);
    const n: P2 = [pv.x / d, pv.z / d];
    const door: P2 = [pv.x + n[0] * PAVILION.r, pv.z + n[1] * PAVILION.r];
    if (!inBox(p, door[0], door[1], 0)) continue;
    out.push({ at: [door[0] + n[0] * 2.0, door[1] + n[1] * 2.0], look: [door[0], FIELD_Y + 1.8, door[1]], task: 'read', dwell: [18, 34] });
  }
  // The pipe racks' posts: crouched, looking at the post's foot.
  for (const rk of servicePlan().racks) {
    if (rk.precinct.name !== p.name) continue;
    const side: P2 = [-rk.d[2], rk.d[0]];
    rk.posts.forEach((q, k) => {
      if (k % 3 !== 1) return;
      out.push({ at: [q[0] + side[0] * 1.15, q[2] + side[1] * 1.15], look: [q[0], FIELD_Y + 0.25, q[2]], task: 'crouch', dwell: [10, 18] });
    });
  }
  // The Cold Hold's spheres: between their columns, looking up at each one's equator.
  for (const t of tankLayout()) {
    if (!inBox(p, t.x, t.z, 0)) continue;
    for (const a of [0.4, 2.5, 4.6]) {
      const r = t.colAt + t.colR + 1.6;
      out.push({ at: [t.x + Math.cos(a) * r, t.z + Math.sin(a) * r], look: [t.x, FIELD_Y + t.eq, t.z], task: 'survey', dwell: [12, 22] });
    }
  }
  // The hero: from its working margin, looking up at it.
  for (const h of heroKeepouts()) {
    const s = h.shape;
    const c: P2 = s.kind === 'rect' ? [(s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2] : [s.x, s.z];
    if (!inBox(p, c[0], c[1], -40)) continue;
    const ring: P2[] = [];
    if (s.kind === 'circle') for (let k = 0; k < 10; k++) ring.push([c[0] + Math.cos((2 * Math.PI * k) / 10 + 0.2) * (s.r + 4), c[1] + Math.sin((2 * Math.PI * k) / 10 + 0.2) * (s.r + 4)]);
    else if (s.kind === 'rect') {
      // Every 24 m round the rectangle's sides, 4 m out.
      const [x0, x1, z0, z1] = [s.x0 - 4, s.x1 + 4, s.z0 - 4, s.z1 + 4];
      for (let x = x0; x <= x1; x += 24) ring.push([x, z0], [x, z1]);
      for (let z = z0 + 24; z < z1; z += 24) ring.push([x0, z], [x1, z]);
    } else for (const [u, v] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 1], [-0.7, 1], [0.7, -1], [-0.7, -1]]) ring.push([c[0] + (s.ux * u * (s.hu + 4) - s.uz * v * (s.hv + 4)), c[1] + (s.uz * u * (s.hu + 4) + s.ux * v * (s.hv + 4))]);
    // Looking up at the hero's middle, from wherever round it the post stands.
    for (const q of ring) if (inBox(p, q[0], q[1], 3)) out.push({ at: q, look: [c[0], FIELD_Y + 35, c[1]], task: 'survey', dwell: [12, 20] });
  }
  return out;
}

/**
 * A beat of `n` posts in a precinct for a robot of clearance `c`: candidates placed on free ground,
 * spread apart (each the farthest from those already taken), every leg routed inside the precinct
 * (and `accept`ed: a Dray's legs must round its corners). A post no leg reaches is dropped and the
 * beat chosen again. `taken` keeps robots sharing a precinct off each other's posts.
 */
function beat(nav: NavGrid, p: Precinct, cands: Candidate[], n: number, c: number, rand: () => number, taken: P2[], spread = 22, accept: (b: Beat) => boolean = () => true): Beat | null {
  let placed: Post[] = [];
  for (const q of cands) {
    const f = nearestFree(nav, q.at[0], q.at[1], c, 4);
    if (!f || !inBox(p, f[0], f[1], 3)) continue;
    if (taken.some((t) => Math.hypot(t[0] - f[0], t[1] - f[1]) < 6)) continue;
    if (placed.some((t) => Math.hypot(t.x - f[0], t.z - f[1]) < 3)) continue;
    placed.push({ x: f[0], z: f[1], face: yawTo(f[0], f[1], q.look[0], q.look[2]), look: q.look, task: q.task, dwell: q.dwell });
  }
  const bx = box(p, 1);
  for (let attempt = 0; attempt < 10 && placed.length >= 2; attempt++) {
    // Farthest-point picks, seeded by a random start.
    const chosen: Post[] = [placed[Math.floor(rand() * placed.length)]];
    while (chosen.length < Math.min(n, placed.length)) {
      let best: Post | null = null;
      let bd = -1;
      for (const q of placed) {
        if (chosen.includes(q)) continue;
        const d = Math.min(...chosen.map((r) => Math.hypot(r.x - q.x, r.z - q.z)));
        // A little randomness, so beats in like precincts differ.
        const score = d * (0.8 + rand() * 0.4);
        if (d > spread && score > bd) {
          bd = score;
          best = q;
        }
      }
      if (!best) break;
      chosen.push(best);
    }
    if (chosen.length < 2) return null;
    // Visit them in a loop round their centroid (no crossing legs).
    const cx = chosen.reduce((t, q) => t + q.x, 0) / chosen.length;
    const cz = chosen.reduce((t, q) => t + q.z, 0) / chosen.length;
    chosen.sort((u, v) => Math.atan2(u.z - cz, u.x - cx) - Math.atan2(v.z - cz, v.x - cx));
    const legs: P2[][] = [];
    let dead: Post | null = null;
    for (let i = 0; i < chosen.length && !dead; i++) {
      const from = chosen[i];
      const to = chosen[(i + 1) % chosen.length];
      const path = findPath(nav, [from.x, from.z], [to.x, to.z], c, bx);
      if (path) legs.push(path);
      else dead = to;
    }
    const out: Beat = { precinct: p, posts: chosen, legs };
    if (dead) {
      placed = placed.filter((q) => q !== dead);
      continue;
    }
    if (!accept(out)) {
      placed = placed.filter((q) => q !== chosen[0]);
      continue;
    }
    for (const q of chosen) taken.push([q.x, q.z]);
    return out;
  }
  return null;
}

/** The field's ground crew, by precinct: how many Hands, Riggers and Drays work each. */
export const FIELD_CREW: Record<string, { hands: number; riggers: number; drays: number }> = {
  // The Cold Hold's block is its spheres: Hands among them; its plant's work is next door.
  'nw-inner': { hands: 2, riggers: 0, drays: 0 },
  'nw-north': { hands: 1, riggers: 1, drays: 1 },
  'nw-west': { hands: 0, riggers: 0, drays: 1 },
  'nw-corner': { hands: 0, riggers: 0, drays: 1 },
  'ne-inner': { hands: 2, riggers: 1, drays: 1 },
  'ne-north': { hands: 2, riggers: 0, drays: 1 },
  'ne-east': { hands: 1, riggers: 1, drays: 0 },
  'ne-corner': { hands: 1, riggers: 0, drays: 1 },
  'sw-inner': { hands: 2, riggers: 0, drays: 0 },
  'sw-south': { hands: 2, riggers: 1, drays: 0 },
  'sw-west': { hands: 0, riggers: 1, drays: 2 },
  'se-inner': { hands: 1, riggers: 0, drays: 0 },
  'sw-corner': { hands: 0, riggers: 0, drays: 1 },
  'se-east': { hands: 1, riggers: 1, drays: 1 },
  'se-south': { hands: 1, riggers: 0, drays: 0 },
};

export interface FieldPlan {
  hands: Beat[];
  riggers: Beat[];
  drays: Beat[];
}

/** A lot's front: its face's middle and outward normal (the side its doors face). */
function front(l: ReturnType<typeof plantLots>[number]): { c: P2; n: P2; along: P2 } {
  const n: P2 = l.axis === 0 ? [0, l.face] : [l.face, 0];
  return { c: [l.x + n[0] * (l.W / 2), l.z + n[1] * (l.W / 2)], n, along: [n[1], -n[0]] };
}

/**
 * Rigger posts: its boom raised to the plant's upper fittings (vents and headers on a building's
 * front at 4.6 m), to a valve pavilion's louvre band, or to a rack's supply line at lane headroom.
 */
function riggerCandidates(p: Precinct): Candidate[] {
  const out: Candidate[] = [];
  for (const l of plantLots()) {
    if (l.precinct !== p.name || l.H < 8) continue;
    const f = front(l);
    for (const k of [-0.25, 0.25]) {
      const c: P2 = [f.c[0] + f.along[0] * l.L * k, f.c[1] + f.along[1] * l.L * k];
      out.push({ at: [c[0] + f.n[0] * 3.8, c[1] + f.n[1] * 3.8], look: [c[0], FIELD_Y + 4.6, c[1]], task: 'boom', dwell: [20, 36] });
    }
  }
  for (const pv of PAVILIONS) {
    const d = Math.hypot(pv.x, pv.z);
    const n: P2 = [pv.x / d, pv.z / d];
    const t: P2 = [-n[1], n[0]];
    for (const k of [-1, 1]) {
      const w: P2 = [pv.x + (n[0] * 0.6 + t[0] * k * 0.8) * PAVILION.r, pv.z + (n[1] * 0.6 + t[1] * k * 0.8) * PAVILION.r];
      const dir = Math.hypot(w[0] - pv.x, w[1] - pv.z);
      const u: P2 = [(w[0] - pv.x) / dir, (w[1] - pv.z) / dir];
      if (!inBox(p, w[0], w[1], 0)) continue;
      out.push({ at: [w[0] + u[0] * 4.2, w[1] + u[1] * 4.2], look: [w[0], FIELD_Y + PAVILION.wall - 1.15, w[1]], task: 'boom', dwell: [22, 38] });
    }
  }
  const supply = RACK_LINES.find((l) => l.name === 'supply')!;
  for (const rk of servicePlan().racks) {
    if (rk.precinct.name !== p.name) continue;
    const side: [number, number] = [-rk.d[2], rk.d[0]];
    for (let s = 14; s < rk.length - 10; s += 13) {
      const o: P2 = [rk.hit[0] + rk.d[0] * s, rk.hit[2] + rk.d[2] * s];
      const line: P2 = [o[0] + side[0] * supply.off, o[1] + side[1] * supply.off];
      out.push({ at: [o[0] + side[0] * -2.3, o[1] + side[1] * -2.3], look: [line[0], FIELD_Y + SERVICE.bottom, line[1]], task: 'boom', dwell: [20, 36] });
    }
  }
  return out;
}

/**
 * Dray stations: before the plant's fronts (a socket in the paving along the face, the dray
 * parked along it) and down the service lanes.
 */
function drayCandidates(p: Precinct): Candidate[] {
  const out: Candidate[] = [];
  for (const l of plantLots()) {
    if (l.precinct !== p.name) continue;
    const f = front(l);
    const c: P2 = [f.c[0] + f.n[0] * 5.2, f.c[1] + f.n[1] * 5.2];
    for (const sgn of [-1, 1]) out.push({ at: c, look: [c[0] + f.along[0] * sgn, FIELD_Y, c[1] + f.along[1] * sgn], task: 'dock', dwell: [25, 50] });
  }
  for (const ln of plantLanes()) {
    if (ln.precinct !== p.name) continue;
    const side: P2 = [-ln.d[1], ln.d[0]];
    for (let s = 14; s < ln.length - 10; s += 19) {
      const o: P2 = [ln.hit[0] + ln.d[0] * s + side[0] * 2.6, ln.hit[1] + ln.d[1] * s + side[1] * 2.6];
      out.push({ at: o, look: [o[0] + ln.d[0], FIELD_Y, o[1] + ln.d[1]], task: 'dock', dwell: [25, 50] });
    }
  }
  return out;
}

export function fieldPlan(nav: NavGrid): FieldPlan {
  const rand = rng(77031);
  const plan: FieldPlan = { hands: [], riggers: [], drays: [] };
  for (const [name, crew] of Object.entries(FIELD_CREW)) {
    const p = PRECINCTS.find((q) => q.name === name)!;
    const taken: P2[] = [];
    for (let k = 0; k < crew.riggers; k++) {
      const b = beat(nav, p, riggerCandidates(p), 3, CLEARANCE.rigger, rand, taken, 18);
      if (b) plan.riggers.push(b);
    }
    for (let k = 0; k < crew.drays; k++) {
      const b = beat(nav, p, drayCandidates(p), 3, CLEARANCE.dray, rand, taken, 20, (q) => drayLegs(nav, q) !== null);
      if (b) plan.drays.push(b);
    }
    for (let k = 0; k < crew.hands; k++) {
      const b = beat(nav, p, handCandidates(p), 4, CLEARANCE.hand, rand, taken, 22);
      if (b) plan.hands.push(b);
    }
  }
  return plan;
}

/** Whether a plan point is free for a robot of clearance c (tests). */
export function freeFor(nav: NavGrid, x: number, z: number, c: number): boolean {
  return clearanceAt(nav, x, z) >= c;
}

/** A route rounded to a turning circle: each corner filleted (radius r, clamped to fit), sampled. */
export function rounded(pts: P2[], r: number): P2[] {
  if (pts.length < 3) return pts;
  const out: P2[] = [pts[0]];
  for (let i = 1; i + 1 < pts.length; i++) {
    const p = pts[i];
    const a = out[out.length - 1];
    const b = pts[i + 1];
    const ua = norm2(a[0] - p[0], a[1] - p[1]);
    const ub = norm2(b[0] - p[0], b[1] - p[1]);
    const cos = ua[0] * ub[0] + ua[1] * ub[1];
    const th = Math.acos(Math.max(-1, Math.min(1, cos)));
    // Straight on (nothing to round), or doubling back (no fillet fits).
    if (th > Math.PI - 0.02 || th < 0.05) {
      out.push(p);
      continue;
    }
    const half = th / 2;
    const cut = Math.min(r / Math.tan(half), Math.hypot(a[0] - p[0], a[1] - p[1]) * 0.48, Math.hypot(b[0] - p[0], b[1] - p[1]) * 0.48);
    const rr = cut * Math.tan(half);
    const p0: P2 = [p[0] + ua[0] * cut, p[1] + ua[1] * cut];
    const p1: P2 = [p[0] + ub[0] * cut, p[1] + ub[1] * cut];
    const bis = norm2(ua[0] + ub[0], ua[1] + ub[1]);
    const cc: P2 = [p[0] + bis[0] * (rr / Math.sin(half)), p[1] + bis[1] * (rr / Math.sin(half))];
    const a0 = Math.atan2(p0[1] - cc[1], p0[0] - cc[0]);
    let d = Math.atan2(p1[1] - cc[1], p1[0] - cc[0]) - a0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const k = Math.max(2, Math.ceil((Math.abs(d) * rr) / 0.5));
    for (let q = 0; q <= k; q++) {
      const t = a0 + (d * q) / k;
      out.push([cc[0] + Math.cos(t) * rr, cc[1] + Math.sin(t) * rr]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

const norm2 = (x: number, z: number): P2 => {
  const l = Math.hypot(x, z) || 1;
  return [x / l, z / l];
};

/** The Dray's turning radius (all-wheel steer at full lock). */
export const DRAY_TURN = DRAY.wheel.z / Math.tan(DRAY.lock);

/**
 * A Dray's legs: out of each dock straight along its face, routed to a point behind the next socket,
 * in along that one over it; every corner rounded to its turning circle, and the rounded route
 * still clear for its body.
 */
export function drayLegs(nav: NavGrid, b: Beat): P2[][] | null {
  const legs: P2[][] = [];
  const c = CLEARANCE.dray;
  const bx: [number, number, number, number] = [b.precinct.x0, b.precinct.x1, b.precinct.z0, b.precinct.z1];
  for (let i = 0; i < b.posts.length; i++) {
    const p = b.posts[i];
    const q = b.posts[(i + 1) % b.posts.length];
    const out: P2 = [p.x + Math.sin(p.face) * 5, p.z + Math.cos(p.face) * 5];
    const into: P2 = [q.x - Math.sin(q.face) * 5.5, q.z - Math.cos(q.face) * 5.5];
    if (!lineClear(nav, [p.x, p.z], out, c) || !lineClear(nav, into, [q.x, q.z], c)) return null;
    const mid = findPath(nav, out, into, c, bx);
    if (!mid) return null;
    const leg = rounded([[p.x, p.z], ...mid, [q.x, q.z]], DRAY_TURN * 1.1);
    // The rounded corners cut in: the body must still clear by its half-width and a margin.
    for (let k = 1; k < leg.length; k++) if (!lineClear(nav, leg[k - 1], leg[k], 1.0)) return null;
    legs.push(leg);
  }
  return legs;
}
