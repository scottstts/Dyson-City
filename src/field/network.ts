/**
 * The network (city_plan.md §5.3, docs/field.md): what ties the compound into one plant.
 *
 *  - The square main: one closed viaduct on the Dome's rib lines (GRID.main) with long rounded
 *    corners, at 10 m: the compound's second ring main after the Halo, and the inner precincts'
 *    edge in the air.
 *  - Trunks: from the Halo out along the Axis Road (to the main portal) and the Meridian (to the
 *    square main), each line dropping from its ring line between the arches and turning out along
 *    the trunk. The Meridian trunks swoop down to the main and end in gold manifolds on it; the
 *    Axis trunk passes over the main and runs on toward the portal.
 *  - The viaduct: a lens-section spine (ceramic below, brushed gold above) on Y-piers at irregular
 *    spacing (a tapered trunk on a plinth forking into two arms). Piers stand clear of roads, the
 *    craft corridor and the pavilions. Cryogen supply and return and the data line ride its back
 *    on saddles at every pier.
 *  - Valve pavilions stand under the viaducts (layout PAVILIONS): round ceramic houses with a
 *    shallow gold dome; supply and return drop into each. Power runs in the flush trenches.
 */
import { v3, type Vec2, type Vec3 } from '../geometry/polyMesh';
import { framesFrom, sweep } from '../geometry/sweep';
import { box, lathe, orientOutward, tube, type Basis } from '../geometry/solids';
import { FIELD_SLOT } from './materials/materials';
import { Parts, rng } from './kit/parts';
import { pipeRun } from './kit/pipe';
import { RING_MAIN, lineCentreY, type RingLine } from './halo';
import { CORRIDOR, FIELD_Y, PAVILIONS, onRoad, rackLines, type RackLine } from './layout';

/** Lines on the viaduct: which ring-main line feeds it, its radius, lateral offset on the spine, slot. */
export const VIADUCT_LINES = [
  { from: 'supply', r: 0.42, off: -1.0, slot: FIELD_SLOT.foil },
  { from: 'data', r: 0.2, off: 0.05, slot: FIELD_SLOT.gold },
  { from: 'return', r: 0.36, off: 1.0, slot: FIELD_SLOT.foil },
] as const;

export const SPINE = { halfWidth: 1.6, halfDepth: 0.5 } as const;
export const PAVILION = { r: 4.2, wall: 5.0 } as const;
/** Corner radius of the square main, and the manifold where a trunk meets it. */
const CORNER = 28;
const MANIFOLD = { half: 3.4, height: 3.2 } as const;

/** Height of a line's centre above the spine's centreline: clear of the spine by its flange, with margin for the trunks' slope. */
export function lineLift(r: number): number {
  return SPINE.halfDepth * 0.55 + r * 1.32 + 0.03 + 0.15;
}

export interface ViaductPath {
  name: string;
  /** Samples along the centreline (plan), arc lengths, unit tangents, left normals. */
  p: Vec2[];
  s: number[];
  t: Vec2[];
  n: Vec2[];
  L: number;
  closed: boolean;
  /** Spine height at arc length s. */
  y(s: number): number;
}

/** A polyline with rounded corners (arcs of radius CORNER), sampled every ~2 m. */
export function route(l: RackLine): ViaductPath {
  const pts = l.pts;
  const n = pts.length;
  const out: Vec2[] = [];
  const corners = l.close ? n : n - 2;
  const at = (i: number) => pts[((i % n) + n) % n];
  const lerp = (a: Vec2, b: Vec2, k: number): Vec2 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  const seg = (a: Vec2, b: Vec2) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.ceil(L / 2));
    for (let j = 0; j < k; j++) out.push(lerp(a, b, j / k));
  };
  if (corners <= 0) {
    seg(pts[0], pts[1]);
    out.push(pts[1]);
  } else {
    const arcs: { a: Vec2; b: Vec2; c: Vec2; t0: number; t1: number }[] = [];
    for (let k = 0; k < corners; k++) {
      const i = l.close ? k : k + 1;
      const p = at(i);
      const d0 = [p[0] - at(i - 1)[0], p[1] - at(i - 1)[1]];
      const d1 = [at(i + 1)[0] - p[0], at(i + 1)[1] - p[1]];
      const l0 = Math.hypot(d0[0], d0[1]);
      const l1 = Math.hypot(d1[0], d1[1]);
      const u0: Vec2 = [d0[0] / l0, d0[1] / l0];
      const u1: Vec2 = [d1[0] / l1, d1[1] / l1];
      const a: Vec2 = [p[0] - u0[0] * CORNER, p[1] - u0[1] * CORNER];
      const b: Vec2 = [p[0] + u1[0] * CORNER, p[1] + u1[1] * CORNER];
      // Right-angle corners: the centre is offset from a along the inward normal.
      const turn = Math.sign(u0[0] * u1[1] - u0[1] * u1[0]);
      const nIn: Vec2 = [-u0[1] * turn, u0[0] * turn];
      const c: Vec2 = [a[0] + nIn[0] * CORNER, a[1] + nIn[1] * CORNER];
      arcs.push({ a, b, c, t0: Math.atan2(a[1] - c[1], a[0] - c[0]), t1: Math.atan2(b[1] - c[1], b[0] - c[0]) });
    }
    const start: Vec2 = l.close ? arcs[arcs.length - 1].b : pts[0];
    let cur = start;
    arcs.forEach((arc) => {
      seg(cur, arc.a);
      let d = arc.t1 - arc.t0;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      const k = Math.ceil((Math.abs(d) * CORNER) / 2);
      for (let j = 0; j < k; j++) {
        const t = arc.t0 + (d * j) / k;
        out.push([arc.c[0] + Math.cos(t) * CORNER, arc.c[1] + Math.sin(t) * CORNER]);
      }
      cur = arc.b;
    });
    // A closed loop ends where it began (the last arc's end): nothing more to add, or the seam doubles a point.
    if (l.close) {
      if (Math.hypot(cur[0] - start[0], cur[1] - start[1]) > 1e-6) seg(cur, start);
    }
    else {
      seg(cur, pts[n - 1]);
      out.push(pts[n - 1]);
    }
  }
  const s = [0];
  for (let i = 1; i < out.length; i++) s.push(s[i - 1] + Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]));
  const L = l.close ? s[s.length - 1] + Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) : s[s.length - 1];
  const t: Vec2[] = out.map((_, i) => {
    const a = out[l.close ? (i - 1 + out.length) % out.length : Math.max(0, i - 1)];
    const b = out[l.close ? (i + 1) % out.length : Math.min(out.length - 1, i + 1)];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
  });
  const nrm: Vec2[] = t.map(([x, z]) => [-z, x]);
  // Constant on the main; trunks ease from y0 to y1 over their last 40 %.
  const y = (sv: number) => {
    const k = Math.min(1, Math.max(0, (sv / L - 0.6) / 0.4));
    return l.y0 + (l.y1 - l.y0) * (0.5 - 0.5 * Math.cos(Math.PI * k));
  };
  return { name: l.name, p: out, s, t, n: nrm, L, closed: !!l.close, y };
}

const at3 = (pa: ViaductPath, i: number, lateral: number, dy: number): Vec3 => [pa.p[i][0] + pa.n[i][0] * lateral, FIELD_Y + pa.y(pa.s[i]) + dy, pa.p[i][1] + pa.n[i][1] * lateral];

/** The spine: a lens section (flat brushed-gold back, a ceramic underside) along the path. */
function spine(pa: ViaductPath) {
  const pts = pa.p.map((_, i) => at3(pa, i, 0, 0));
  const frames = framesFrom(pts, pts.map(() => [0, 1, 0] as Vec3), pa.closed);
  const { halfWidth: w, halfDepth: d } = SPINE;
  const loop: Vec2[] = [];
  const slots: number[] = [];
  for (let k = 0; k <= 10; k++) {
    const b = -w + (2 * w * k) / 10;
    loop.push([b, -d * (1 - 0.55 * (b / w) ** 2)]);
    slots.push(FIELD_SLOT.ceramic);
  }
  loop.push([w, d * 0.35], [w - 0.15, d * 0.55], [-w + 0.15, d * 0.55], [-w, d * 0.35]);
  slots.push(FIELD_SLOT.satin, FIELD_SLOT.satin, FIELD_SLOT.satin, FIELD_SLOT.ceramic);
  return orientOutward(sweep(frames, { pts: loop, slots }, { crease: 34, capSlot: FIELD_SLOT.ceramic, closed: pa.closed }));
}

/** A Y-pier at sample i: trunk from its plinth up to a fork, two arms up into the spine's underside. */
function pier(parts: Parts, name: string, pa: ViaductPath, i: number): void {
  const top = pa.y(pa.s[i]) - SPINE.halfDepth * 0.45;
  const fork = top - 3.4;
  const foot: Vec3 = [pa.p[i][0], FIELD_Y, pa.p[i][1]];
  const u: Vec3 = [pa.t[i][0], 0, pa.t[i][1]];
  const nn: Vec3 = [pa.n[i][0], 0, pa.n[i][1]];
  parts.add(`${name}:plinth`, box({ o: v3.add(foot, [0, 0.35, 0]), u, v: nn, w: [0, 1, 0] }, 1.1, 1.1, 0.37, 0.06, FIELD_SLOT.ceramic));
  parts.add(`${name}:trunk`, tube([
    { p: v3.add(foot, [0, 0.66, 0]), r: 0.62 },
    { p: v3.add(foot, [0, fork * 0.5, 0]), r: 0.5 },
    { p: v3.add(foot, [0, fork, 0]), r: 0.46 },
    { p: v3.add(foot, [0, fork + 0.5, 0]), r: 0.4 },
  ], 20, FIELD_SLOT.ceramic));
  for (const e of [-1, 1]) {
    const a0 = v3.add(foot, [0, fork + 0.2, 0]);
    const a1 = v3.add(v3.add(foot, v3.scale(nn, e * 0.55)), [0, fork + 1.6, 0]);
    const a2 = v3.add(v3.add(foot, v3.scale(nn, e * 0.85)), [0, top + 0.12, 0]);
    parts.add(`${name}:arm${e}`, tube([{ p: a0, r: 0.3 }, { p: a1, r: 0.27 }, { p: a2, r: 0.24 }], 14, FIELD_SLOT.ceramic));
  }
  for (const vl of VIADUCT_LINES) {
    const lo = SPINE.halfDepth * 0.55 - 0.02;
    const hi = lineLift(vl.r) - vl.r + 0.03;
    parts.add(`${name}:saddle:${vl.from}`, box({ o: at3(pa, i, vl.off, (lo + hi) / 2), u, v: nn, w: [0, 1, 0] }, 0.2, vl.r * 0.8, (hi - lo) / 2, 0.02, FIELD_SLOT.steel));
  }
}

/** A valve pavilion: a round ceramic house, a band of black louvres, a shallow gold dome, a bronze door. */
function pavilion(parts: Parts, name: string, c: Vec3, door: Vec3): void {
  const b: Basis = { o: c, u: [1, 0, 0], v: [0, 0, 1], w: [0, 1, 0] };
  const R = PAVILION.r;
  const H = PAVILION.wall;
  parts.add(`${name}:base`, lathe([[R - 0.6, -0.02], [R + 0.5, -0.02], [R + 0.5, 0.35], [R + 0.3, 0.5], [R - 0.6, 0.5]], 64, b, FIELD_SLOT.ceramic));
  parts.add(`${name}:wall`, lathe([[R - 0.45, 0.45], [R, 0.45], [R, H - 0.6], [R + 0.25, H - 0.35], [R + 0.25, H], [R - 0.45, H]], 64, b, FIELD_SLOT.ceramic));
  const dome: Vec2[] = [[0, H - 0.08], [R + 0.4, H - 0.08], [R + 0.4, H + 0.15]];
  for (let k = 1; k <= 12; k++) {
    const a = (Math.PI / 2) * (k / 13);
    dome.push([(R + 0.4) * Math.cos(a), H + 0.15 + 2.1 * Math.sin(a)]);
  }
  dome.push([0, H + 2.25]);
  parts.add(`${name}:dome`, lathe(dome, 64, b, FIELD_SLOT.satin));
  parts.add(`${name}:band`, lathe([[R - 0.02, H - 1.5], [R + 0.05, H - 1.5], [R + 0.05, H - 0.8], [R - 0.02, H - 0.8]], 64, b, FIELD_SLOT.black));
  const dc = v3.add(c, [door[0] * (R + 0.01), 1.78, door[2] * (R + 0.01)]);
  parts.add(`${name}:door`, box({ o: dc, u: [-door[2], 0, door[0]], v: [0, 1, 0], w: door }, 0.75, 1.2, 0.06, 0.02, FIELD_SLOT.bronze));
}

/** The branches off the ring main at a trunk's start: each line drops from its ring line, then runs out along the trunk. */
function branch(pa: ViaductPath, vl: (typeof VIADUCT_LINES)[number]): Vec3[] {
  const ring = RING_MAIN.find((l) => l.name === vl.from)! as RingLine;
  const o: Vec2 = [pa.p[0][0] + pa.n[0][0] * vl.off, pa.p[0][1] + pa.n[0][1] * vl.off];
  const u = pa.t[0];
  const b = o[0] * u[0] + o[1] * u[1];
  const c = o[0] * o[0] + o[1] * o[1] - ring.r * ring.r;
  // Back along the trunk to the ring line: the nearer crossing (the far one is across the core).
  const t = -b + Math.sqrt(Math.max(0, b * b - c));
  const p: Vec2 = [o[0] + u[0] * t, o[1] + u[1] * t];
  const yRun = FIELD_Y + pa.y(0) + lineLift(vl.r);
  return [
    [p[0], FIELD_Y + lineCentreY(ring) - 0.2, p[1]],
    [p[0], yRun, p[1]],
  ];
}

/** Sample indices where piers stand: irregular, clear of roads, the corridor and the pavilions. */
function pierStations(pa: ViaductPath, rand: () => number): number[] {
  const out: number[] = [];
  const avoid = (x: number, z: number) =>
    onRoad(x, z, 2.2) ||
    (x > CORRIDOR.x0 - 4 && Math.abs(z) < CORRIDOR.half + 2) ||
    PAVILIONS.some((p) => Math.hypot(p.x - x, p.z - z) < PAVILION.r + 3);
  let s = pa.closed ? 0 : 3;
  while (s < pa.L - (pa.closed ? 0 : 3)) {
    let i = 0;
    while (i + 1 < pa.s.length && pa.s[i + 1] <= s) i++;
    if (!avoid(pa.p[i][0], pa.p[i][1])) {
      out.push(i);
      s += 17 + rand() * 10;
    } else s += 2;
  }
  return out;
}

export function viaductPaths(): ViaductPath[] {
  return rackLines().map(route);
}

/** Where the piers stand: sample indices per viaduct path (one seeded sequence, the same everywhere it is read). */
export function pierPlan(paths: ViaductPath[] = viaductPaths()): number[][] {
  const rand = rng(5150);
  return paths.map((pa) => pierStations(pa, rand));
}

export function buildNetwork(): Parts {
  const parts = new Parts('net');
  const paths = viaductPaths();
  const piers = pierPlan(paths);
  for (const [pi, pa] of paths.entries()) {
    parts.add(`${pa.name}:spine`, spine(pa));
    piers[pi].forEach((i, k) => pier(parts, `${pa.name}:pier${k}`, pa, i));
    for (const vl of VIADUCT_LINES) {
      const lift = lineLift(vl.r);
      const pts: Vec3[] = [];
      if (pa.name.startsWith('trunk')) pts.push(...branch(pa, vl));
      pa.p.forEach((_, i) => pts.push(at3(pa, i, vl.off, lift)));
      if (pa.closed) {
        parts.add(`${pa.name}:${vl.from}`, tube(pts.map((p) => ({ p, r: vl.r })), vl.r > 0.3 ? 20 : 12, vl.slot, { closed: true, seed: [0, 1, 0] }));
      } else {
        parts.add(`${pa.name}:${vl.from}`, pipeRun(pts, { r: vl.r, slot: vl.slot, bend: vl.r * 3.5, bareEnds: true }));
      }
    }
  }
  // Manifolds where the Meridian trunks meet the main: a gold-clad block straddling the main's spine.
  for (const pa of paths.filter((p) => p.name === 'trunk-n' || p.name === 'trunk-s')) {
    const e = pa.p[pa.p.length - 1];
    const u = pa.t[pa.t.length - 1];
    const c: Vec3 = [e[0] + u[0] * 3, FIELD_Y + pa.y(pa.L) + 0.9, e[1] + u[1] * 3];
    parts.add(`${pa.name}:manifold`, box({ o: c, u: [u[0], 0, u[1]], v: [-u[1], 0, u[0]], w: [0, 1, 0] }, MANIFOLD.half, MANIFOLD.half, MANIFOLD.height / 2, 0.15, FIELD_SLOT.gold));
  }
  // Valve pavilions under the viaducts, with taps from supply and return down into their domes.
  PAVILIONS.forEach((pv, k) => {
    let best = { pa: paths[0], i: 0, d: Infinity };
    for (const pa of paths) pa.p.forEach((p, i) => {
      const d = Math.hypot(p[0] - pv.x, p[1] - pv.z);
      if (d < best.d) best = { pa, i, d };
    });
    const c: Vec3 = [pv.x, FIELD_Y, pv.z];
    pavilion(parts, `pavilion${k}`, c, v3.norm([pv.x, 0, pv.z]));
    for (const vl of VIADUCT_LINES.filter((l) => l.from !== 'data')) {
      const top = at3(best.pa, best.i, vl.off, lineLift(vl.r) - 0.2);
      parts.add(`pavilion${k}:tap:${vl.from}`, pipeRun([top, [top[0], FIELD_Y + PAVILION.wall + 1.0, top[2]]], { r: vl.r * 0.7, slot: vl.slot, bareEnds: true }));
    }
  });
  return parts;
}
