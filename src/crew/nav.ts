/**
 * Where the crew can walk and drive (docs/crew.md, "Routes"): a plan grid of free cells, each with
 * its distance to the nearest blocked one, and paths on it.
 *
 *  - Blocked is whatever stands at body height (the field's own occupancy, field/walk.ts), and
 *    everywhere the crew never goes: every road (driving stays unencumbered), the craft corridor's
 *    ground, the core, the estate (outside the estate's own grid), beyond the compound.
 *  - A robot of clearance c may stand where the distance is at least c.
 *  - Paths: A* on the 8-connected grid within a robot's home (its precinct's box), then pulled
 *    taut (a corner is dropped wherever the straight line past it keeps the clearance).
 *
 * Everything is typed arrays and reused buffers: a search is a few milliseconds.
 */
export interface NavGrid {
  x0: number;
  z0: number;
  cell: number;
  nx: number;
  nz: number;
  /** Distance (m) from each cell's centre to the nearest blocked cell (0: blocked). */
  dist: Float32Array;
}

export type P2 = [number, number];

/** Where a rule puts each cell out of bounds (1), evaluated once and reused. */
export function outMask(x0: number, z0: number, cell: number, nx: number, nz: number, out: (x: number, z: number) => boolean): Uint8Array {
  const m = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    const z = z0 + (j + 0.5) * cell;
    for (let i = 0; i < nx; i++) if (out(x0 + (i + 0.5) * cell, z)) m[j * nx + i] = 1;
  }
  return m;
}

/** A grid from an occupancy raster (1: occupied) and where else is out of bounds (a mask or a rule). */
export function navGrid(occ: Uint8Array, x0: number, z0: number, cell: number, nx: number, nz: number, out: Uint8Array | ((x: number, z: number) => boolean)): NavGrid {
  const mask = typeof out === 'function' ? outMask(x0, z0, cell, nx, nz, out) : out;
  const dist = new Float32Array(nx * nz);
  const BIG = 1e6;
  for (let k = 0; k < nx * nz; k++) dist[k] = occ[k] || mask[k] ? 0 : BIG;
  chamfer(dist, nx, nz, cell);
  return { x0, z0, cell, nx, nz, dist };
}

/** Two-pass chamfer distance (3-4 weights, in metres): within ~8 % of Euclidean. */
function chamfer(d: Float32Array, nx: number, nz: number, cell: number): void {
  const a = cell;
  const b = cell * Math.SQRT2;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      let v = d[k];
      if (v === 0) continue;
      if (i > 0) v = Math.min(v, d[k - 1] + a);
      if (j > 0) {
        v = Math.min(v, d[k - nx] + a);
        if (i > 0) v = Math.min(v, d[k - nx - 1] + b);
        if (i < nx - 1) v = Math.min(v, d[k - nx + 1] + b);
      }
      d[k] = v;
    }
  }
  for (let j = nz - 1; j >= 0; j--) {
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      let v = d[k];
      if (v === 0) continue;
      if (i < nx - 1) v = Math.min(v, d[k + 1] + a);
      if (j < nz - 1) {
        v = Math.min(v, d[k + nx] + a);
        if (i < nx - 1) v = Math.min(v, d[k + nx + 1] + b);
        if (i > 0) v = Math.min(v, d[k + nx - 1] + b);
      }
      d[k] = v;
    }
  }
}

/** Clearance at a plan point (the cell's distance less half a cell: conservative). */
export function clearanceAt(g: NavGrid, x: number, z: number): number {
  const i = Math.floor((x - g.x0) / g.cell);
  const j = Math.floor((z - g.z0) / g.cell);
  if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) return 0;
  return Math.max(0, g.dist[j * g.nx + i] - g.cell * 0.5);
}

/** The nearest point to (x, z) within `search` m with at least clearance c (or null). */
export function nearestFree(g: NavGrid, x: number, z: number, c: number, search = 12): P2 | null {
  const ci = Math.floor((x - g.x0) / g.cell);
  const cj = Math.floor((z - g.z0) / g.cell);
  const R = Math.ceil(search / g.cell);
  let best: P2 | null = null;
  let bd = Infinity;
  for (let dj = -R; dj <= R; dj++) {
    for (let di = -R; di <= R; di++) {
      const i = ci + di;
      const j = cj + dj;
      if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) continue;
      if (g.dist[j * g.nx + i] - g.cell * 0.5 < c) continue;
      const d = di * di + dj * dj;
      if (d < bd) {
        bd = d;
        best = [g.x0 + (i + 0.5) * g.cell, g.z0 + (j + 0.5) * g.cell];
      }
    }
  }
  return best;
}

/** Whether the straight segment a → b keeps clearance c all along (sampled every half cell). */
export function lineClear(g: NavGrid, a: P2, b: P2, c: number): boolean {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.ceil(L / (g.cell * 0.5)));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    if (clearanceAt(g, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) < c) return false;
  }
  return true;
}

// Search buffers, grown as needed and reused.
let gScore = new Float32Array(0);
let parent = new Int32Array(0);
let stamp = new Uint32Array(0);
let closed = new Uint32Array(0);
let heapK = new Int32Array(0);
let heapF = new Float32Array(0);
let round = 1;

function ensure(n: number): void {
  if (gScore.length >= n) return;
  gScore = new Float32Array(n);
  parent = new Int32Array(n);
  stamp = new Uint32Array(n);
  closed = new Uint32Array(n);
  heapK = new Int32Array(n);
  heapF = new Float32Array(n);
}

/** A disc to keep out of (a robot or a person standing in the way). */
export interface Disc {
  x: number;
  z: number;
  r: number;
}

/**
 * A* from a to b (plan points) through cells of clearance ≥ c, within the box [bx0, bx1] × [bz0, bz1],
 * keeping out of any `avoid` discs. Returns the cell path's points, pulled taut, or null.
 */
export function findPath(g: NavGrid, a: P2, b: P2, c: number, box: [number, number, number, number], avoid: Disc[] = []): P2[] | null {
  const n = g.nx * g.nz;
  ensure(n);
  round++;
  const toI = (x: number) => Math.floor((x - g.x0) / g.cell);
  const toJ = (z: number) => Math.floor((z - g.z0) / g.cell);
  const i0 = Math.max(0, toI(box[0]));
  const i1 = Math.min(g.nx - 1, toI(box[1]));
  const j0 = Math.max(0, toJ(box[2]));
  const j1 = Math.min(g.nz - 1, toJ(box[3]));
  const sa = toJ(a[1]) * g.nx + toI(a[0]);
  const sb = toJ(b[1]) * g.nx + toI(b[0]);
  const inDisc = (k: number) => {
    if (!avoid.length) return false;
    const x = g.x0 + ((k % g.nx) + 0.5) * g.cell;
    const z = g.z0 + (Math.floor(k / g.nx) + 0.5) * g.cell;
    return avoid.some((d) => Math.hypot(d.x - x, d.z - z) < d.r);
  };
  const ok = (k: number) => g.dist[k] - g.cell * 0.5 >= c && !inDisc(k);
  if (g.dist[sa] - g.cell * 0.5 < c || !ok(sb)) return null;
  const bi = sb % g.nx;
  const bj = Math.floor(sb / g.nx);
  const h = (k: number) => {
    const di = Math.abs((k % g.nx) - bi);
    const dj = Math.abs(Math.floor(k / g.nx) - bj);
    return (Math.max(di, dj) + (Math.SQRT2 - 1) * Math.min(di, dj)) * g.cell;
  };
  let size = 0;
  const push = (k: number, f: number) => {
    let i = size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapF[p] <= f) break;
      heapK[i] = heapK[p];
      heapF[i] = heapF[p];
      i = p;
    }
    heapK[i] = k;
    heapF[i] = f;
  };
  const pop = (): number => {
    const top = heapK[0];
    const k = heapK[--size];
    const f = heapF[size];
    let i = 0;
    for (;;) {
      let m = i * 2 + 1;
      if (m >= size) break;
      if (m + 1 < size && heapF[m + 1] < heapF[m]) m++;
      if (heapF[m] >= f) break;
      heapK[i] = heapK[m];
      heapF[i] = heapF[m];
      i = m;
    }
    heapK[i] = k;
    heapF[i] = f;
    return top;
  };
  stamp[sa] = round;
  gScore[sa] = 0;
  parent[sa] = -1;
  push(sa, h(sa));
  const D = [1, -1, g.nx, -g.nx, g.nx + 1, g.nx - 1, -g.nx + 1, -g.nx - 1];
  const W = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
  let found = false;
  while (size > 0) {
    const k = pop();
    if (closed[k] === round) continue;
    closed[k] = round;
    if (k === sb) {
      found = true;
      break;
    }
    const ki = k % g.nx;
    const kj = Math.floor(k / g.nx);
    for (let d = 0; d < 8; d++) {
      const di = d === 0 || d === 4 || d === 6 ? 1 : d === 1 || d === 5 || d === 7 ? -1 : 0;
      const dj = d === 2 || d === 4 || d === 5 ? 1 : d === 3 || d === 6 || d === 7 ? -1 : 0;
      const ni = ki + di;
      const nj = kj + dj;
      if (ni < i0 || ni > i1 || nj < j0 || nj > j1) continue;
      const m = k + D[d];
      if (closed[m] === round || !ok(m)) continue;
      // Diagonals may not cut a blocked corner.
      if (di !== 0 && dj !== 0 && (!ok(k + di) || !ok(k + dj * g.nx))) continue;
      // Prefer the middle of open ground: cells near the clearance limit cost a little more.
      const extra = Math.max(0, 1.5 - (g.dist[m] - c)) * 0.6;
      const gs = gScore[k] + W[d] * g.cell * (1 + extra);
      if (stamp[m] !== round || gs < gScore[m]) {
        stamp[m] = round;
        gScore[m] = gs;
        parent[m] = k;
        push(m, gs + h(m));
      }
    }
  }
  if (!found) return null;
  const cells: P2[] = [];
  for (let k = sb; k !== -1; k = parent[k]) cells.push([g.x0 + ((k % g.nx) + 0.5) * g.cell, g.z0 + (Math.floor(k / g.nx) + 0.5) * g.cell]);
  cells.reverse();
  cells[0] = [a[0], a[1]];
  cells[cells.length - 1] = [b[0], b[1]];
  return taut(g, cells, c, avoid);
}

/** Drops every corner the straight line past keeps clear of (string pulling). */
export function taut(g: NavGrid, pts: P2[], c: number, avoid: Disc[] = []): P2[] {
  if (pts.length <= 2) return pts;
  const out: P2[] = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !(lineClear(g, pts[i], pts[j], c) && avoid.every((d) => segDist(pts[i], pts[j], d) >= d.r))) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

/** Distance from a disc's centre to a segment. */
function segDist(a: P2, b: P2, d: Disc): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const t = Math.min(1, Math.max(0, ((d.x - a[0]) * dx + (d.z - a[1]) * dz) / Math.max(1e-9, dx * dx + dz * dz)));
  return Math.hypot(d.x - a[0] - dx * t, d.z - a[1] - dz * t);
}

/** Length of a polyline. */
export function pathLength(p: P2[]): number {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return s;
}
