/**
 * Plan shapes as 2D signed distance functions (negative inside, metres), and their contours.
 *
 * The estate's ground is drawn as regions (lawn, gravel, flags, brick, beds, water) that touch and
 * nest. Each region is described as an SDF composed from simple shapes (unions, differences,
 * offsets), and its outline is extracted by marching squares on a fine grid with linear edge
 * interpolation: unions and rounded offsets need no polygon booleans, and every region's outline
 * follows the same field its neighbours were cut from, so they meet exactly.
 */

export type V2 = [number, number];
export type Sdf = (x: number, z: number) => number;

export interface Shape {
  sdf: Sdf;
  /** Plan bounds the shape's interior (and the margin its users need) lies in: x0, z0, x1, z1. */
  bounds: [number, number, number, number];
}

const EMPTY: Shape['bounds'] = [Infinity, Infinity, -Infinity, -Infinity];

export function circle(cx: number, cz: number, r: number): Shape {
  return { sdf: (x, z) => Math.hypot(x - cx, z - cz) - r, bounds: [cx - r, cz - r, cx + r, cz + r] };
}

/** A box centred at (cx, cz), half sizes (hx, hz), turned by `angle` (rad, x toward z), corners rounded by r. */
export function box(cx: number, cz: number, hx: number, hz: number, angle = 0, r = 0): Shape {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const ex = Math.abs(hx * c) + Math.abs(hz * s);
  const ez = Math.abs(hx * s) + Math.abs(hz * c);
  return {
    sdf: (x, z) => {
      const dx = x - cx;
      const dz = z - cz;
      const u = Math.abs(dx * c + dz * s) - (hx - r);
      const v = Math.abs(-dx * s + dz * c) - (hz - r);
      return Math.hypot(Math.max(u, 0), Math.max(v, 0)) + Math.min(Math.max(u, v), 0) - r;
    },
    bounds: [cx - ex, cz - ez, cx + ex, cz + ez],
  };
}

/** Signed distance to a simple polygon (any winding). */
export function polygon(pts: V2[]): Shape {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of pts) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  const n = pts.length;
  return {
    sdf: (x, z) => {
      let d = Infinity;
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [ax, az] = pts[j];
        const [bx, bz] = pts[i];
        const ex = bx - ax, ez = bz - az;
        const l2 = ex * ex + ez * ez;
        const t = l2 > 0 ? Math.min(Math.max(((x - ax) * ex + (z - az) * ez) / l2, 0), 1) : 0;
        d = Math.min(d, (x - ax - ex * t) ** 2 + (z - az - ez * t) ** 2);
        if ((az > z) !== (bz > z) && x < (ex * (z - az)) / ez + ax) inside = !inside;
      }
      return inside ? -Math.sqrt(d) : Math.sqrt(d);
    },
    bounds: [x0, z0, x1, z1],
  };
}

/** A band of half-width `half` along a polyline (round ends unless `flat`). */
export function stroke(pts: V2[], half: number): Shape {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of pts) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  return {
    sdf: (x, z) => {
      let d = Infinity;
      for (let i = 1; i < pts.length; i++) {
        const [ax, az] = pts[i - 1];
        const [bx, bz] = pts[i];
        const ex = bx - ax, ez = bz - az;
        const l2 = ex * ex + ez * ez;
        const t = l2 > 0 ? Math.min(Math.max(((x - ax) * ex + (z - az) * ez) / l2, 0), 1) : 0;
        d = Math.min(d, (x - ax - ex * t) ** 2 + (z - az - ez * t) ** 2);
      }
      return Math.sqrt(d) - half;
    },
    bounds: [x0 - half, z0 - half, x1 + half, z1 + half],
  };
}

export function union(...shapes: Shape[]): Shape {
  return {
    sdf: (x, z) => {
      let d = Infinity;
      for (const s of shapes) {
        const b = s.bounds;
        // Outside a shape's bounds its distance is at least the distance to the bounds.
        const bx = Math.max(b[0] - x, x - b[2], 0);
        const bz = Math.max(b[1] - z, z - b[3], 0);
        if (Math.hypot(bx, bz) >= d) continue;
        d = Math.min(d, s.sdf(x, z));
      }
      return d;
    },
    bounds: shapes.reduce<Shape['bounds']>((b, s) => [Math.min(b[0], s.bounds[0]), Math.min(b[1], s.bounds[1]), Math.max(b[2], s.bounds[2]), Math.max(b[3], s.bounds[3])], [...EMPTY]),
  };
}

/**
 * Union with fillets of radius ~k where shapes meet (polynomial smooth minimum), as a gravel path
 * flares into a forecourt. Only shapes within k of the nearest one take part.
 */
export function smoothUnion(k: number, ...shapes: Shape[]): Shape {
  const plain = union(...shapes);
  return {
    sdf: (x, z) => {
      let d = Infinity;
      const near: number[] = [];
      for (const s of shapes) {
        const b = s.bounds;
        const bx = Math.max(b[0] - x, x - b[2], 0);
        const bz = Math.max(b[1] - z, z - b[3], 0);
        if (Math.hypot(bx, bz) >= Math.min(d, 1e9) + k) continue;
        const v = s.sdf(x, z);
        near.push(v);
        d = Math.min(d, v);
      }
      if (near.length < 2) return near.length ? near[0] : plain.sdf(x, z);
      let r = near[0];
      for (let i = 1; i < near.length; i++) {
        const b = near[i];
        const h = Math.max(k - Math.abs(r - b), 0) / k;
        r = Math.min(r, b) - h * h * k * 0.25;
      }
      return r;
    },
    bounds: [plain.bounds[0] - k, plain.bounds[1] - k, plain.bounds[2] + k, plain.bounds[3] + k],
  };
}

export function subtract(a: Shape, ...cut: Shape[]): Shape {
  const c = union(...cut);
  return { sdf: (x, z) => Math.max(a.sdf(x, z), -c.sdf(x, z)), bounds: a.bounds };
}

export function intersect(a: Shape, b: Shape): Shape {
  return {
    sdf: (x, z) => Math.max(a.sdf(x, z), b.sdf(x, z)),
    bounds: [Math.max(a.bounds[0], b.bounds[0]), Math.max(a.bounds[1], b.bounds[1]), Math.min(a.bounds[2], b.bounds[2]), Math.min(a.bounds[3], b.bounds[3])],
  };
}

/** Grows (r > 0) or shrinks a shape; rounds its convex corners. */
export function offset(a: Shape, r: number): Shape {
  return { sdf: (x, z) => a.sdf(x, z) - r, bounds: [a.bounds[0] - r, a.bounds[1] - r, a.bounds[2] + r, a.bounds[3] + r] };
}

/** A shell between `inner` and `outer` distance from a shape (a border round it). */
export function band(a: Shape, inner: number, outer: number): Shape {
  return {
    sdf: (x, z) => {
      const d = a.sdf(x, z);
      return Math.max(inner - d, d - outer);
    },
    bounds: [a.bounds[0] - outer, a.bounds[1] - outer, a.bounds[2] + outer, a.bounds[3] + outer],
  };
}

/** Cubic Bézier sampled to a polyline (`n` segments). */
export function bezier(p0: V2, p1: V2, p2: V2, p3: V2, n = 32): V2[] {
  const out: V2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

/** A grid over a plan rectangle. */
export interface Grid {
  x0: number;
  z0: number;
  step: number;
  nx: number;
  nz: number;
}

export function gridOver(bounds: Shape['bounds'], step: number): Grid {
  const x0 = Math.floor(bounds[0] / step) * step - step;
  const z0 = Math.floor(bounds[1] / step) * step - step;
  return { x0, z0, step, nx: Math.ceil((bounds[2] - x0) / step) + 2, nz: Math.ceil((bounds[3] - z0) / step) + 2 };
}

/**
 * Samples a shape on a grid, finely only near its outline: the field is evaluated on a coarse grid
 * first, and a coarse cell whose corners all lie farther from the outline than the cell's diagonal
 * cannot contain it (distance fields are 1-Lipschitz), so it is filled from its corners. Outside
 * the shape's bounds (plus a margin) the samples keep their previous value (`out`'s initial +1e3).
 * Composed with min, so several shapes stamp into one field.
 */
export function sample(g: Grid, s: Shape, out = new Float32Array(g.nx * g.nz).fill(1e3), margin = 1): Float32Array {
  const C = 8;
  const b = s.bounds;
  const i0 = Math.max(0, Math.floor((b[0] - margin - g.x0) / g.step));
  const i1 = Math.min(g.nx - 1, Math.ceil((b[2] + margin - g.x0) / g.step));
  const j0 = Math.max(0, Math.floor((b[1] - margin - g.z0) / g.step));
  const j1 = Math.min(g.nz - 1, Math.ceil((b[3] + margin - g.z0) / g.step));
  const cw = Math.ceil((i1 - i0) / C) + 1;
  const ch = Math.ceil((j1 - j0) / C) + 1;
  const coarse = new Float32Array(cw * ch);
  for (let cj = 0; cj < ch; cj++) for (let ci = 0; ci < cw; ci++) coarse[cj * cw + ci] = s.sdf(g.x0 + (i0 + ci * C) * g.step, g.z0 + (j0 + cj * C) * g.step);
  const diag = C * g.step * Math.SQRT2;
  for (let cj = 0; cj < ch - 1; cj++) {
    for (let ci = 0; ci < cw - 1; ci++) {
      const a00 = coarse[cj * cw + ci], a10 = coarse[cj * cw + ci + 1];
      const a01 = coarse[(cj + 1) * cw + ci], a11 = coarse[(cj + 1) * cw + ci + 1];
      const far = Math.min(Math.abs(a00), Math.abs(a10), Math.abs(a01), Math.abs(a11)) > diag && Math.sign(a00) === Math.sign(a10) && Math.sign(a00) === Math.sign(a01) && Math.sign(a00) === Math.sign(a11);
      for (let dj = 0; dj < C; dj++) {
        const j = j0 + cj * C + dj;
        if (j > j1) break;
        const z = g.z0 + j * g.step;
        for (let di = 0; di < C; di++) {
          const i = i0 + ci * C + di;
          if (i > i1) break;
          const k = j * g.nx + i;
          let v: number;
          if (far) {
            const u = di / C, w = dj / C;
            v = (a00 * (1 - u) + a10 * u) * (1 - w) + (a01 * (1 - u) + a11 * u) * w;
          } else v = s.sdf(g.x0 + i * g.step, z);
          if (v < out[k]) out[k] = v;
        }
      }
    }
  }
  return out;
}

/**
 * Closed contour loops of a sampled field at 0 (marching squares, linear interpolation), simplified
 * to `tolerance`. Loops wind counter-clockwise (x right, z down the page) around the negative side.
 */
export function contours(g: Grid, f: Float32Array, tolerance = 0.01): V2[][] {
  const { nx, nz } = g;
  // Edge points keyed by their edge: horizontal edges (i, j)→(i+1, j) are 2k, vertical (i, j)→(i, j+1) 2k+1.
  const next = new Map<number, number>();
  const point = new Map<number, V2>();
  const pos = (e: number): V2 => {
    let p = point.get(e);
    if (p) return p;
    const k = e >> 1;
    const i = k % nx;
    const j = (k - i) / nx;
    const a = f[k];
    const b = e & 1 ? f[k + nx] : f[k + 1];
    const t = a / (a - b);
    p = e & 1 ? [g.x0 + i * g.step, g.z0 + (j + t) * g.step] : [g.x0 + (i + t) * g.step, g.z0 + j * g.step];
    point.set(e, p);
    return p;
  };
  const H = (i: number, j: number) => 2 * (j * nx + i);
  const Vt = (i: number, j: number) => 2 * (j * nx + i) + 1;
  const link = (a: number, b: number) => {
    next.set(a, b);
    pos(a);
    pos(b);
  };
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const v0 = f[j * nx + i] < 0 ? 1 : 0;
      const v1 = f[j * nx + i + 1] < 0 ? 1 : 0;
      const v2 = f[(j + 1) * nx + i + 1] < 0 ? 1 : 0;
      const v3 = f[(j + 1) * nx + i] < 0 ? 1 : 0;
      const c = v0 | (v1 << 1) | (v2 << 2) | (v3 << 3);
      if (c === 0 || c === 15) continue;
      const top = H(i, j);
      const right = Vt(i + 1, j);
      const bottom = H(i, j + 1);
      const left = Vt(i, j);
      // Segments run with the inside on their left (counter-clockwise in x-right, z-down).
      switch (c) {
        case 1: link(left, top); break;
        case 2: link(top, right); break;
        case 3: link(left, right); break;
        case 4: link(right, bottom); break;
        case 5: {
          const centre = (f[j * nx + i] + f[j * nx + i + 1] + f[(j + 1) * nx + i + 1] + f[(j + 1) * nx + i]) / 4;
          if (centre < 0) { link(left, bottom); link(right, top); } else { link(left, top); link(right, bottom); }
          break;
        }
        case 6: link(top, bottom); break;
        case 7: link(left, bottom); break;
        case 8: link(bottom, left); break;
        case 9: link(bottom, top); break;
        case 10: {
          const centre = (f[j * nx + i] + f[j * nx + i + 1] + f[(j + 1) * nx + i + 1] + f[(j + 1) * nx + i]) / 4;
          if (centre < 0) { link(top, left); link(bottom, right); } else { link(top, right); link(bottom, left); }
          break;
        }
        case 11: link(bottom, right); break;
        case 12: link(right, left); break;
        case 13: link(right, top); break;
        case 14: link(top, left); break;
      }
    }
  }
  const loops: V2[][] = [];
  const done = new Set<number>();
  for (const start of next.keys()) {
    if (done.has(start)) continue;
    const loop: V2[] = [];
    let e = start;
    while (!done.has(e)) {
      done.add(e);
      loop.push(point.get(e)!);
      const n = next.get(e);
      if (n === undefined) break;
      e = n;
    }
    if (loop.length >= 3) loops.push(simplifyLoop(loop, tolerance));
  }
  return loops.filter((l) => l.length >= 3);
}

/** Ramer–Douglas–Peucker on a closed loop. */
export function simplifyLoop(loop: V2[], tol: number): V2[] {
  if (loop.length < 8) return loop;
  // Split at the two farthest-apart points so both halves are open polylines.
  let far = 0;
  let best = 0;
  for (let i = 1; i < loop.length; i++) {
    const d = (loop[i][0] - loop[0][0]) ** 2 + (loop[i][1] - loop[0][1]) ** 2;
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const a = rdp(loop.slice(0, far + 1), tol);
  const b = rdp([...loop.slice(far), loop[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function rdp(pts: V2[], tol: number): V2[] {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const [ax, az] = pts[s];
    const [bx, bz] = pts[e];
    const ex = bx - ax, ez = bz - az;
    const l = Math.hypot(ex, ez) || 1;
    let worst = -1;
    let wd = tol;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs((pts[i][0] - ax) * ez - (pts[i][1] - az) * ex) / l;
      if (d > wd) {
        wd = d;
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([s, worst], [worst, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Signed area (positive: counter-clockwise in x-right, z-down, i.e. clockwise seen from +y). */
export function area(loop: V2[]): number {
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const [ax, az] = loop[i];
    const [bx, bz] = loop[(i + 1) % loop.length];
    s += ax * bz - bx * az;
  }
  return s / 2;
}

export function inside(loop: V2[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [ax, az] = loop[j];
    const [bx, bz] = loop[i];
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) c = !c;
  }
  return c;
}

/** Groups loops into outlines with their holes (by containment and winding). */
export function nest(loops: V2[][]): { outer: V2[]; holes: V2[][] }[] {
  const sign = loops.length ? Math.sign(area(loops.reduce((a, b) => (Math.abs(area(a)) > Math.abs(area(b)) ? a : b)))) : 1;
  const outers = loops.filter((l) => Math.sign(area(l)) === sign);
  const holes = loops.filter((l) => Math.sign(area(l)) !== sign);
  const out = outers.map((o) => ({ outer: o, holes: [] as V2[][] }));
  for (const h of holes) {
    // The smallest outline containing the hole.
    let best: (typeof out)[number] | null = null;
    for (const o of out) if (inside(o.outer, h[0][0], h[0][1]) && (!best || Math.abs(area(o.outer)) < Math.abs(area(best.outer)))) best = o;
    best?.holes.push(h);
  }
  return out;
}
