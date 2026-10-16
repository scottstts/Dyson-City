/**
 * The terrace's retaining wall and balustrade (city_plan §4: "a dressed stone retaining wall with a
 * balustrade on its top"; docs/estate.md "Walls").
 *
 *  - The wall: honey sandstone ashlar on a chamfered plinth course, 1.6 m from the pad to a cream
 *    limestone coping with a rounded nosing; one mitred sweep round the whole terrace from one
 *    gateway pier to the other.
 *  - The balustrade on the coping: a moulded plinth, vase balusters and a moulded top rail between
 *    square piers. Along straight runs the piers stand at even bays (~3.2 m); along the back arc,
 *    at every vertex of the arc's polygon, so each bay is a straight chord. Corner piers carry ball
 *    finials, as do every fourth pier.
 *
 * Balusters and piers are instanced (one mesh each, thousands of instances). Walking uses proxies:
 * the wall's own sweep and a slab per bay.
 */
import { Matrix4, Quaternion, Vector3 } from 'three/webgpu';
import { PolyMesh, type Vec2, type Vec3 } from '../geometry/polyMesh';
import { box as boxSolid, lathe, WORLD } from '../geometry/solids';
import { Parts } from '../field/kit/parts';
import { PAD_HEIGHT } from '../ground/site';
import { ESTATE } from '../field/layout';
import { GATEWAY, TERRACE_OUTLINE, TERRACE_Y, WALL } from './layout';
import { runSweep, pathLength, upright, type RunProfile } from './kit';
import { ESTATE_SLOT } from './materials/materials';
import type { V2 } from './sdf2';

const T = TERRACE_Y;
const S = ESTATE_SLOT;

/** Balustrade dimensions (heights above the terrace), and its line: b across the wall (outward +). */
export const BALUSTRADE = {
  line: -0.3,
  copingTop: 0.06,
  plinthTop: 0.24,
  railBottom: 0.86,
  railTop: 1.02,
  pierShaft: 0.23,
  pierBase: 0.28,
  pierCapBottom: 1.04,
  pierCapTop: 1.17,
  bay: 3.2,
  baluster: 0.27,
} as const;
const B = BALUSTRADE;

/** The wall's section: plinth course, face, limestone coping with a rounded nosing. */
function wallProfile(): RunProfile {
  const y0 = PAD_HEIGHT - 0.05;
  const t = WALL.thickness;
  const pts: Vec2[] = [
    [-t, y0],
    [0.1, y0],
    [0.1, PAD_HEIGHT + 0.38],
    [0.0, PAD_HEIGHT + 0.48],
    [0.0, T - 0.17],
    [0.075, T - 0.17],
    [0.075, T - 0.145],
  ];
  // Nosing: a half round from the soffit up to the coping's top.
  for (let i = 1; i <= 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * Math.PI * 0.75;
    pts.push([0.075 + Math.cos(a) * 0.03, T - 0.115 + Math.sin(a) * 0.03]);
  }
  pts.push([0.07, T - 0.02], [0.05, T + B.copingTop], [-t, T + B.copingTop]);
  // Slots per edge: sandstone up to the coping's soffit, limestone from there to the top, sandstone down the buried back.
  const slots = pts.map((_, i) => (i >= 4 && i < pts.length - 1 ? S.limestone : S.sandstone));
  return { pts, slots };
}

function plinthProfile(): RunProfile {
  const c = B.line;
  const y0 = T + B.copingTop;
  const y1 = T + B.plinthTop;
  return {
    pts: [
      [c - 0.2, y0],
      [c + 0.2, y0],
      [c + 0.2, y1 - 0.06],
      [c + 0.17, y1 - 0.02],
      [c + 0.13, y1],
      [c - 0.13, y1],
      [c - 0.17, y1 - 0.02],
      [c - 0.2, y1 - 0.06],
    ],
    slots: [],
  };
}

function railProfile(): RunProfile {
  const c = B.line;
  const y0 = T + B.railBottom;
  const y1 = T + B.railTop;
  return {
    pts: [
      [c - 0.13, y0],
      [c + 0.13, y0],
      [c + 0.13, y0 + 0.015],
      [c + 0.16, y0 + 0.035],
      [c + 0.165, y0 + 0.07],
      [c + 0.16, y1 - 0.045],
      [c + 0.14, y1 - 0.02],
      [c + 0.1, y1 - 0.005],
      [c, y1],
      [c - 0.1, y1 - 0.005],
      [c - 0.14, y1 - 0.02],
      [c - 0.16, y1 - 0.045],
      [c - 0.165, y0 + 0.07],
      [c - 0.16, y0 + 0.035],
      [c - 0.13, y0 + 0.015],
    ],
  };
}

/** A vase baluster, its base at the origin (y up), 0.62 m tall: square plinth, turned body, square cap. */
export function balusterMesh(): PolyMesh {
  const h = B.railBottom - B.plinthTop;
  const m = new PolyMesh(40);
  m.append(boxSolid({ ...WORLD, o: [0, 0.03, 0] }, 0.072, 0.03, 0.072, 0.006, S.limestone));
  // Turned body from the plinth block to the cap block (r, y): torus base, vase bulb, neck, collar.
  const prof: Vec2[] = [
    [0, 0.055],
    [0.062, 0.055],
    [0.066, 0.068],
    [0.06, 0.082],
    [0.052, 0.09],
    [0.062, 0.12],
    [0.07, 0.17],
    [0.069, 0.22],
    [0.062, 0.27],
    [0.05, 0.32],
    [0.038, 0.37],
    [0.032, 0.41],
    [0.031, 0.44],
    [0.036, 0.46],
    [0.046, 0.472],
    [0.046, 0.49],
    [0.038, 0.5],
    [0.04, 0.53],
    [0.052, h - 0.05],
    [0.056, h - 0.035],
    [0, h - 0.035],
  ];
  m.append(lathe(prof, 20, upright(), S.limestone, 40));
  m.append(boxSolid({ ...WORLD, o: [0, h - 0.02, 0] }, 0.066, 0.02, 0.066, 0.006, S.limestone));
  return m;
}

/** A pier (square shaft on a base, moulded cap), its base at the origin; with a ball finial if `finial`. */
export function pierMesh(finial: boolean): PolyMesh {
  const m = new PolyMesh(35);
  const y0 = B.copingTop;
  // Base block (bedded 4 mm into the coping, so it never shares the rails' bottom plane), shaft and
  // cap, each a bevelled block seated on the one below.
  const bed = -0.004;
  m.append(boxSolid({ ...WORLD, o: [0, (B.plinthTop + 0.06 - y0 + bed) / 2, 0] }, B.pierBase, (B.plinthTop + 0.06 - y0 - bed) / 2, B.pierBase, 0.012, S.limestone));
  const sy0 = B.plinthTop + 0.06 - y0;
  const sy1 = B.pierCapBottom - y0;
  m.append(boxSolid({ ...WORLD, o: [0, (sy0 + sy1) / 2, 0] }, B.pierShaft, (sy1 - sy0) / 2, B.pierShaft, 0.008, S.limestone));
  const cy0 = sy1;
  const cy1 = B.pierCapTop - y0;
  m.append(boxSolid({ ...WORLD, o: [0, (cy0 + cy1) / 2, 0] }, 0.29, (cy1 - cy0) / 2, 0.29, 0.02, S.limestone));
  if (finial) {
    // Necked plinth and a ball.
    const r = 0.13;
    const prof: Vec2[] = [
      [0, cy1],
      [0.13, cy1],
      [0.13, cy1 + 0.03],
      [0.09, cy1 + 0.06],
      [0.06, cy1 + 0.1],
      [0.07, cy1 + 0.12],
    ];
    const c = cy1 + 0.12 + r * 0.92;
    for (let i = 1; i < 12; i++) {
      const a = -Math.PI / 2 + Math.asin(0.07 / r) + (i / 12) * (Math.PI - Math.asin(0.07 / r));
      prof.push([Math.cos(a) * r, c + Math.sin(a) * r]);
    }
    prof.push([0, c + r]);
    m.append(lathe(prof, 24, upright(), S.limestone, 40));
  }
  return m;
}

export interface Instances {
  mesh: PolyMesh;
  matrices: Matrix4[];
}

export interface TerraceWall {
  parts: Parts;
  balusters: Instances;
  piers: Instances;
  finials: Instances;
  /** Simple solids the walker collides with (walls are parts already). */
  proxies: PolyMesh[];
  /** Pier stations (plan) for tests and planting clearances. */
  stations: V2[];
}

const Y_AXIS = new Vector3(0, 1, 0);

function place(p: V2, y: number, dir: V2): Matrix4 {
  const q = new Quaternion().setFromAxisAngle(Y_AXIS, Math.atan2(-dir[1], dir[0]));
  return new Matrix4().compose(new Vector3(p[0], y, p[1]), q, new Vector3(1, 1, 1));
}

/** A slab standing on the coping along a bay (the walker's proxy for the balustrade). */
function slab(a: V2, b: V2, y0: number, y1: number, half: number): PolyMesh {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l = Math.hypot(dx, dz);
  const ux = dx / l;
  const uz = dz / l;
  const m = new PolyMesh();
  const c: Vec3 = [(a[0] + b[0]) / 2, (y0 + y1) / 2, (a[1] + b[1]) / 2];
  m.append(boxSolid({ o: c, u: [ux, 0, uz], v: [0, 1, 0], w: [-uz, 0, ux] }, l / 2, (y1 - y0) / 2, half, 0));
  return m;
}

/**
 * The wall's run: from the gateway's east pier round the terrace (anticlockwise in plan: east,
 * north, the back arc, south) to its west pier.
 */
export function wallRun(): V2[] {
  const g = GATEWAY;
  const o = TERRACE_OUTLINE;
  // TERRACE_OUTLINE: south-east corner, north-east corner, the arc from north to south.
  return [[g.x1 + g.pier, ESTATE.south], ...o, [g.x0 - g.pier, ESTATE.south]];
}

export function buildTerraceWall(): TerraceWall {
  const parts = new Parts('estate:wall');
  const run = wallRun();
  parts.add('retaining', runSweep(run, wallProfile(), { slot: S.sandstone, capSlot: S.sandstone }));
  // The balustrade's line: offset inward from the wall face by the balustrade's own b.
  const line = offsetLine(run, B.line);
  // Stations: corners (every run vertex except the arc's interior chords spaced >= bay) and even bays between.
  const stations: { p: V2; major: boolean }[] = [];
  const corners: number[] = [0];
  for (let i = 1; i < line.length - 1; i++) {
    const a = line[i - 1];
    const b = line[i];
    const c = line[i + 1];
    const d0 = norm([b[0] - a[0], b[1] - a[1]]);
    const d1 = norm([c[0] - b[0], c[1] - b[1]]);
    if (d0[0] * d1[0] + d0[1] * d1[1] < 0.9999) corners.push(i);
  }
  corners.push(line.length - 1);
  for (let k = 0; k < corners.length; k++) {
    const i = corners[k];
    const sharp = i === 0 || i === line.length - 1 || isSharp(line, i);
    stations.push({ p: line[i], major: sharp });
    if (k === corners.length - 1) break;
    const j = corners[k + 1];
    const seg: V2[] = line.slice(i, j + 1);
    const len = pathLength(seg);
    const n = Math.max(1, Math.round(len / B.bay));
    for (let s = 1; s < n; s++) stations.push({ p: lerpAlong(seg, (len * s) / n), major: false });
  }
  // Every fourth pier on long straight runs carries a finial too.
  let count = 0;
  for (const st of stations) {
    if (st.major) count = 0;
    else if (++count % 4 === 0) st.major = true;
  }
  const out: BalustradeOut = { balusters: [], piers: [], finials: [], proxies: [] };
  // At the gateway the rails butt into the gate piers: the end stations stand a shaft's half inside them.
  const st: Station[] = stations.map((s) => ({ p: s.p, kind: s.major ? 'finial' : 'pier' }));
  for (const [i, j] of [[0, 1], [st.length - 1, st.length - 2]]) {
    const d = norm([st[i].p[0] - st[j].p[0], st[i].p[1] - st[j].p[1]]);
    st[i] = { p: [st[i].p[0] + d[0] * B.pierShaft, st[i].p[1] + d[1] * B.pierShaft], kind: 'none' };
  }
  addBalustrade(parts, 'bay', st, T + B.copingTop, out);
  return {
    parts,
    balusters: { mesh: balusterMesh(), matrices: out.balusters },
    piers: { mesh: pierMesh(false), matrices: out.piers },
    finials: { mesh: pierMesh(true), matrices: out.finials },
    proxies: out.proxies,
    stations: stations.map((s) => s.p),
  };
}

/** A balustrade station: a pier, a pier with a finial, or none (the rail butts into something else there). */
export interface Station {
  p: V2;
  kind: 'pier' | 'finial' | 'none';
}

export interface BalustradeOut {
  balusters: Matrix4[];
  piers: Matrix4[];
  finials: Matrix4[];
  proxies: PolyMesh[];
}

/**
 * A balustrade on its line through `stations` (piers; `major` ones carry finials), standing on a
 * coping at `yBase` (the balustrade's own heights are above the terrace, so a coping elsewhere
 * shifts them by yBase − (T + copingTop)). The rails are parts; piers and balusters are instances.
 */
export function addBalustrade(parts: Parts, prefix: string, stations: Station[], yBase: number, out: BalustradeOut): void {
  const dy = yBase - (T + B.copingTop);
  const plinth = shiftProfile(plinthProfile(), dy);
  const rail = shiftProfile(railProfile(), dy);
  // Each pier faces the bisector of its two bays; reach(k, u) is how far its square reaches along u.
  const dirs: V2[] = stations.map((s, k) => {
    const into = k > 0 ? norm([s.p[0] - stations[k - 1].p[0], s.p[1] - stations[k - 1].p[1]]) : null;
    const out2 = k < stations.length - 1 ? norm([stations[k + 1].p[0] - s.p[0], stations[k + 1].p[1] - s.p[1]]) : null;
    if (into && out2) return norm([into[0] + out2[0], into[1] + out2[1]]);
    return (into ?? out2)!;
  });
  const reach = (k: number, u: V2, half: number) => {
    if (stations[k].kind === 'none') return half;
    const d = dirs[k];
    const c = Math.abs(d[0] * u[0] + d[1] * u[1]);
    const sn = Math.abs(d[0] * u[1] - d[1] * u[0]);
    return half * (c + sn);
  };
  for (let k = 0; k < stations.length; k++) {
    const a = stations[k].p;
    if (stations[k].kind !== 'none') (stations[k].kind === 'finial' ? out.finials : out.piers).push(place(a, yBase, dirs[k]));
    if (k === stations.length - 1) break;
    const b = stations[k + 1].p;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u = norm([b[0] - a[0], b[1] - a[1]]);
    // Rails butt 1 cm into the piers' base blocks (plinth) and shafts (top rail).
    const end = (d: number): V2[] => [
      [a[0] + u[0] * d, a[1] + u[1] * d],
      [b[0] - u[0] * d, b[1] - u[1] * d],
    ];
    parts.add(`${prefix}:plinth:${k}`, runSweep(centred(end(B.pierBase - 0.01), B.line), plinth, { slot: S.limestone }));
    parts.add(`${prefix}:rail:${k}`, runSweep(centred(end(B.pierShaft - 0.01), B.line), rail, { slot: S.limestone }));
    // Balusters clear each pier's base (turned piers reach further along the bay).
    const r0 = reach(k, u, B.pierBase) + 0.02;
    const r1 = reach(k + 1, u, B.pierBase) + 0.02;
    const clear = len - r0 - r1;
    const nb = Math.max(1, Math.floor((clear - 0.06) / B.baluster));
    const gap = clear / nb;
    for (let i = 0; i < nb; i++) {
      const s = r0 + gap * (i + 0.5);
      out.balusters.push(place([a[0] + u[0] * s, a[1] + u[1] * s], yBase - B.copingTop + B.plinthTop, u));
    }
    out.proxies.push(slab(a, b, yBase, yBase - B.copingTop + B.railTop, 0.14));
  }
}

function shiftProfile(p: RunProfile, dy: number): RunProfile {
  return { pts: p.pts.map(([b, y]) => [b, y + dy] as Vec2), slots: p.slots };
}

function isSharp(line: V2[], i: number): boolean {
  const a = line[i - 1];
  const b = line[i];
  const c = line[i + 1];
  const d0 = norm([b[0] - a[0], b[1] - a[1]]);
  const d1 = norm([c[0] - b[0], c[1] - b[1]]);
  return d0[0] * d1[0] + d0[1] * d1[1] < 0.9;
}

function norm(v: V2): V2 {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

function lerpAlong(path: V2[], s: number): V2 {
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const l = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    if (acc + l >= s) {
      const t = (s - acc) / l;
      return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t];
    }
    acc += l;
  }
  return path[path.length - 1];
}

/** Offsets a polyline by b along its mitred left normal (b < 0: inward). */
export function offsetLine(path: V2[], b: number): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < path.length; i++) {
    const prev = path[Math.max(i - 1, 0)];
    const next = path[Math.min(i + 1, path.length - 1)];
    const la = i > 0 ? left(path[i][0] - prev[0], path[i][1] - prev[1]) : left(next[0] - path[i][0], next[1] - path[i][1]);
    const lb = i < path.length - 1 ? left(next[0] - path[i][0], next[1] - path[i][1]) : la;
    let mx = la[0] + lb[0];
    let mz = la[1] + lb[1];
    const l = Math.hypot(mx, mz) || 1;
    mx /= l;
    mz /= l;
    const s = 1 / Math.max(mx * lb[0] + mz * lb[1], 0.3);
    out.push([path[i][0] + mx * b * s, path[i][1] + mz * b * s]);
  }
  return out;
}

function left(dx: number, dz: number): V2 {
  const l = Math.hypot(dx, dz) || 1;
  return [-dz / l, dx / l];
}

/** A two-point run whose profile is centred on b = `line` (shift the run so b = 0 lies on it). */
function centred(seg: V2[], line: number): V2[] {
  return offsetLine(seg, -line);
}
