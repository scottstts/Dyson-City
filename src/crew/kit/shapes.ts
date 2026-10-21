/**
 * The crew's modelling kit (docs/crew.md): the few operations every robot is built from, on the
 * project's polygon kernel (geometry/polyMesh.ts, solids.ts).
 *
 *  - `shell`: a superellipse loft along a basis's w axis, its section's half-axes, exponent and
 *    centre following monotone tracks, closed by rounded caps that end in a pole. Panel seams are
 *    narrow grooves cut into the section (three rings, the middle one inset) in their own slot, so
 *    a shell reads as fitted panels rather than one moulding.
 *  - `boss`: a turned bearing boss about an axis (chamfered drum, its faces stepped in to a hub).
 *  - `mirrorX`: the left-hand copy of a right-hand part (x negated, winding reversed).
 *  - `track`: an overshoot-free cubic through (t, value) knots: dimension curves that never bulge
 *    past their knots.
 *
 * Every solid is closed and outward; a part is one PolyMesh, a semantic name, merged by slot only
 * at emission.
 */
import { PolyMesh, v3, type Vec2, type Vec3 } from '../../geometry/polyMesh';
import { at, lathe, orientOutward, tube, type Basis, type TubeRing } from '../../geometry/solids';

/**
 * Tessellation level while a model is built (1: as authored). The crew's far level builds every
 * model again at a fraction: sides, rings and arcs scale down, never below what keeps a form round.
 */
let detail = 1;

export function withDetail<T>(level: number, build: () => T): T {
  const prev = detail;
  detail = level;
  try {
    return build();
  } finally {
    detail = prev;
  }
}

export function currentDetail(): number {
  return detail;
}

/** An authored count of sides (or segments) at the current level: even, at least `min`. */
export function seg(n: number, min = 8): number {
  return Math.max(min, 2 * Math.round((n * detail) / 2));
}

/** A lathe at the current level. */
export function turn(profile: Vec2[], segments: number, b: Basis, slots: number | number[] = 0, crease = 38, phase = 0, sweepAngle = 2 * Math.PI): PolyMesh {
  return lathe(profile, seg(segments), b, slots, crease, phase, sweepAngle);
}

/** A tube at the current level. */
export function pipe(rings: TubeRing[], segments: number, slots: number | ((i: number) => number) = 0, opts: { closed?: boolean; capSlot?: number; crease?: number; seed?: Vec3 } = {}): PolyMesh {
  return tube(rings, seg(segments, 6), slots, opts);
}

export type Track = (t: number) => number;

/** Overshoot-free (Fritsch–Carlson) cubic through knots sorted by t; constant beyond the ends. */
export function track(knots: readonly (readonly [number, number])[]): Track {
  const n = knots.length;
  if (n === 1) return () => knots[0][1];
  const d: number[] = [];
  const m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d[i] = (knots[i + 1][1] - knots[i][1]) / (knots[i + 1][0] - knots[i][0]);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(d[i]) < 1e-12) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const r = a * a + b * b;
    if (r > 9) {
      const s = 3 / Math.sqrt(r);
      m[i] = s * a * d[i];
      m[i + 1] = s * b * d[i];
    }
  }
  return (x) => {
    if (x <= knots[0][0]) return knots[0][1];
    if (x >= knots[n - 1][0]) return knots[n - 1][1];
    let i = 0;
    while (knots[i + 1][0] < x) i++;
    const h = knots[i + 1][0] - knots[i][0];
    const t = (x - knots[i][0]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * knots[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * knots[i + 1][1] + (t3 - t2) * h * m[i + 1];
  };
}

export const constant = (v: number): Track => () => v;

/** A point of a superellipse section: half-axes per side (+u, −u, +v, −v) and exponent n (2: ellipse). */
export function superPoint(theta: number, ap: number, an: number, bp: number, bn: number, n: number): Vec2 {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const e = 2 / n;
  const x = Math.sign(c) * Math.abs(c) ** e * (c >= 0 ? ap : an);
  const y = Math.sign(s) * Math.abs(s) ** e * (s >= 0 ? bp : bn);
  return [x, y];
}

export interface ShellSpec {
  /** Axial extent (along the basis's w) of the lofted body, before the caps. */
  t0: number;
  t1: number;
  /** Half-axes across (u: +side, −side) and through (v: +side, −side) at t. */
  ap: Track;
  an?: Track;
  bp: Track;
  bn?: Track;
  /** Superellipse exponent (2: ellipse; 3–5: squarer). */
  n?: Track;
  /** Section centre offset in (u, v) at t. */
  cu?: Track;
  cv?: Track;
  /** Sides round the section (even), and the most axial spacing between rings. */
  sides: number;
  ds: number;
  /** Rounded caps: their length beyond t0 / t1 (0: flat cap). */
  cap0?: number;
  cap1?: number;
  /** Seams: grooves at t (half-width w, depth d) in the seam slot. */
  seams?: { t: number; w?: number; d?: number }[];
  slot: number;
  seamSlot?: number;
  /** Slot of a side face by its axial middle t and section angle θ (overrides `slot`). */
  slotAt?: (t: number, theta: number) => number;
  crease?: number;
  /** Phase of the section's first vertex (radians). */
  phase?: number;
}

const SEAM_W = 0.003;
const SEAM_D = 0.0025;

/**
 * A closed, outward superellipse loft along `b.w` (see the module note). Seams shrink the section
 * uniformly toward its centre by d, keeping their walls at the shell's own angle.
 */
export function shell(b: Basis, s: ShellSpec): PolyMesh {
  const mesh = new PolyMesh(s.crease ?? 48);
  const an = s.an ?? s.ap;
  const bn = s.bn ?? s.bp;
  const ex = s.n ?? constant(2);
  const cu = s.cu ?? constant(0);
  const cv = s.cv ?? constant(0);
  const seamSlot = s.seamSlot ?? s.slot;
  // Axial stations: even spacing, plus every seam's three rings.
  const ts = new Set<number>();
  const k = Math.max(1, Math.ceil((s.t1 - s.t0) / (s.ds / Math.max(detail, 0.2))));
  for (let i = 0; i <= k; i++) ts.add(s.t0 + ((s.t1 - s.t0) * i) / k);
  // Seams are a few millimetres: at the far level they would be sub-pixel, so none.
  const seams = detail < 0.5 ? [] : (s.seams ?? []).map((q) => ({ t: q.t, w: q.w ?? SEAM_W, d: q.d ?? SEAM_D }));
  for (const q of seams) {
    // Plain rings within a seam would only crowd it.
    for (const t of [...ts]) if (Math.abs(t - q.t) < q.w * 2.5 && t !== s.t0 && t !== s.t1) ts.delete(t);
    ts.add(q.t - q.w);
    ts.add(q.t);
    ts.add(q.t + q.w);
  }
  const stations = [...ts].filter((t) => t >= s.t0 - 1e-9 && t <= s.t1 + 1e-9).sort((p, q) => p - q);
  const inset = (t: number) => {
    for (const q of seams) if (Math.abs(t - q.t) < 1e-9) return q.d;
    return 0;
  };
  const inSeam = (t: number) => seams.some((q) => t > q.t - q.w - 1e-9 && t < q.t + q.w + 1e-9);
  const m = seg(s.sides, 8);
  const phase = s.phase ?? 0;
  const thetas = Array.from({ length: m }, (_, j) => phase + (2 * Math.PI * j) / m);
  /** A ring at axial t, scaled about its centre by k and pulled in by `pull`. */
  const ring = (t: number, axial: number, scale: number, pull: number): Vec3[] => {
    const c: Vec2 = [cu(t), cv(t)];
    return thetas.map((th) => {
      const p = superPoint(th, Math.max(s.ap(t) - pull, 1e-4), Math.max(an(t) - pull, 1e-4), Math.max(s.bp(t) - pull, 1e-4), Math.max(bn(t) - pull, 1e-4), ex(t));
      return at(b, c[0] + p[0] * scale, c[1] + p[1] * scale, axial);
    });
  };
  const rings: { pts: Vec3[]; t: number }[] = [];
  const capRings = (t: number, len: number, dir: 1 | -1): { pts: Vec3[]; t: number }[] => {
    const out: { pts: Vec3[]; t: number }[] = [];
    const K = detail < 0.6 ? 3 : 5;
    for (let i = 1; i < K; i++) {
      const f = i / K;
      out.push({ pts: ring(t, t + dir * len * Math.sin((Math.PI / 2) * f), Math.cos((Math.PI / 2) * f) ** 0.8, 0), t });
    }
    return out;
  };
  const c0 = s.cap0 ?? 0;
  const c1 = s.cap1 ?? 0;
  if (c0 > 0) rings.push(...capRings(s.t0, c0, -1).reverse());
  for (const t of stations) rings.push({ pts: ring(t, t, 1, inset(t)), t });
  if (c1 > 0) rings.push(...capRings(s.t1, c1, 1));
  const ids = rings.map((r) => r.pts.map((p) => mesh.vert(p)));
  // Side faces: ring i → i + 1. Their slot: a seam's own, or the caller's by place.
  let vAcc = 0;
  for (let i = 0; i + 1 < rings.length; i++) {
    const tMid = (rings[i].t + rings[i + 1].t) / 2;
    const seam = inSeam(rings[i].t) && inSeam(rings[i + 1].t) && rings[i].t !== rings[i + 1].t;
    const len = v3.dist(rings[i].pts[0], rings[i + 1].pts[0]);
    for (let j = 0; j < m; j++) {
      const j1 = (j + 1) % m;
      const th = (thetas[j] + (j1 === 0 ? thetas[j] + (2 * Math.PI) / m : thetas[j1])) / 2;
      const slot = seam ? seamSlot : s.slotAt ? s.slotAt(tMid, th) : s.slot;
      mesh.face([ids[i][j], ids[i][j1], ids[i + 1][j1], ids[i + 1][j]], slot, [
        [(j * 2 * Math.PI) / m, vAcc],
        [((j + 1) * 2 * Math.PI) / m, vAcc],
        [((j + 1) * 2 * Math.PI) / m, vAcc + len],
        [(j * 2 * Math.PI) / m, vAcc + len],
      ]);
    }
    vAcc += len;
  }
  // Ends: a pole past a rounded cap, a flat n-gon otherwise.
  const endSlot = (i: number, th: number) => (s.slotAt ? s.slotAt(rings[i].t, th) : s.slot);
  const close = (i: number, polePos: Vec3 | null, first: boolean) => {
    const r = ids[i];
    if (!polePos) {
      const loop = first ? [...r].reverse() : [...r];
      mesh.face(loop, endSlot(i, 0), loop.map((k2) => [mesh.verts[k2][0], mesh.verts[k2][2]] as Vec2));
      return;
    }
    const pole = mesh.vert(polePos);
    for (let j = 0; j < m; j++) {
      const j1 = (j + 1) % m;
      const th = thetas[j] + Math.PI / m;
      if (first) mesh.face([r[j1], r[j], pole], endSlot(i, th), [[0, 0], [0.01, 0], [0, 0.01]]);
      else mesh.face([r[j], r[j1], pole], endSlot(i, th), [[0, 0], [0.01, 0], [0, 0.01]]);
    }
  };
  close(0, c0 > 0 ? at(b, cu(s.t0), cv(s.t0), s.t0 - c0) : null, true);
  close(rings.length - 1, c1 > 0 ? at(b, cu(s.t1), cv(s.t1), s.t1 + c1) : null, false);
  return orientOutward(mesh);
}

/** A shell's surface as a function of (t, θ): its point and outward unit normal (no seams, no caps). */
export function shellSurface(b: Basis, s: ShellSpec): (t: number, theta: number) => { p: Vec3; n: Vec3 } {
  const an = s.an ?? s.ap;
  const bn = s.bn ?? s.bp;
  const ex = s.n ?? constant(2);
  const cu = s.cu ?? constant(0);
  const cv = s.cv ?? constant(0);
  const pt = (t: number, th: number): Vec3 => {
    const q = superPoint(th, s.ap(t), an(t), s.bp(t), bn(t), ex(t));
    return at(b, cu(t) + q[0], cv(t) + q[1], t);
  };
  return (t, th) => {
    const p = pt(t, th);
    const e = 1e-4;
    const dt = v3.sub(pt(t + e, th), pt(t - e, th));
    const dth = v3.sub(pt(t, th + e), pt(t, th - e));
    let n = v3.norm(v3.cross(dth, dt));
    // Outward: away from the section's centre.
    const c = at(b, cu(t), cv(t), t);
    if (v3.dot(n, v3.sub(p, c)) < 0) n = v3.scale(n, -1);
    return { p, n };
  };
}

export interface PanelSpec {
  t0: number;
  t1: number;
  th0: number;
  th1: number;
  /** Inner and outer offsets along the surface normal (d0 < 0: bedded into the shell). */
  d0: number;
  d1: number;
  nt: number;
  nth: number;
  /** Width of the outer face's edge chamfer (m). */
  bevel?: number;
  slot: number;
  sideSlot?: number;
  crease?: number;
}

/**
 * A panel standing proud of a surface over a (t, θ) window: a closed slab between offsets d0 and
 * d1 along the surface's normal, its outer face's rim chamfered. Visors, chest plates, covers.
 */
export function panel(surf: (t: number, th: number) => { p: Vec3; n: Vec3 }, s: PanelSpec): PolyMesh {
  const mesh = new PolyMesh(s.crease ?? 40);
  const bev = s.bevel ?? 0.002;
  s = { ...s, nt: Math.max(2, Math.round(s.nt * detail)), nth: Math.max(2, Math.round(s.nth * detail)) };
  const side = s.sideSlot ?? s.slot;
  // Parameter insets that move the outer face's edge in by about `bev`.
  const dtLen = v3.dist(surf(s.t0, (s.th0 + s.th1) / 2).p, surf(s.t1, (s.th0 + s.th1) / 2).p) / Math.max(s.t1 - s.t0, 1e-9);
  const dthLen = v3.dist(surf((s.t0 + s.t1) / 2, s.th0).p, surf((s.t0 + s.t1) / 2, s.th1).p) / Math.max(s.th1 - s.th0, 1e-9);
  const it = Math.min(bev / Math.max(dtLen, 1e-9), (s.t1 - s.t0) * 0.2);
  const ith = Math.min(bev / Math.max(dthLen, 1e-9), (s.th1 - s.th0) * 0.2);
  // The window's boundary, walked once round (counter-clockwise in (θ, t)).
  const loop = (a0: number, a1: number, b0: number, b1: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let j = 0; j < s.nth; j++) out.push([a0, b0 + ((b1 - b0) * j) / s.nth]);
    for (let i = 0; i < s.nt; i++) out.push([a0 + ((a1 - a0) * i) / s.nt, b1]);
    for (let j = s.nth; j > 0; j--) out.push([a1, b0 + ((b1 - b0) * j) / s.nth]);
    for (let i = s.nt; i > 0; i--) out.push([a0 + ((a1 - a0) * i) / s.nt, b0]);
    return out;
  };
  const off = (t: number, th: number, d: number): Vec3 => {
    const q = surf(t, th);
    return v3.add(q.p, v3.scale(q.n, d));
  };
  // Outer face grid.
  const ta0 = s.t0 + it, ta1 = s.t1 - it, tb0 = s.th0 + ith, tb1 = s.th1 - ith;
  const grid: number[][] = [];
  for (let i = 0; i <= s.nt; i++) {
    const row: number[] = [];
    for (let j = 0; j <= s.nth; j++) row.push(mesh.vert(off(ta0 + ((ta1 - ta0) * i) / s.nt, tb0 + ((tb1 - tb0) * j) / s.nth, s.d1)));
    grid.push(row);
  }
  for (let i = 0; i < s.nt; i++) {
    for (let j = 0; j < s.nth; j++) mesh.face([grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]], s.slot, [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]]);
  }
  // Boundary loops: the outer face's edge (from the grid), the chamfer's foot, the inner face's edge.
  const edgeIdx: number[] = [];
  for (let j = 0; j < s.nth; j++) edgeIdx.push(grid[0][j]);
  for (let i = 0; i < s.nt; i++) edgeIdx.push(grid[i][s.nth]);
  for (let j = s.nth; j > 0; j--) edgeIdx.push(grid[s.nt][j]);
  for (let i = s.nt; i > 0; i--) edgeIdx.push(grid[i][0]);
  const rim = loop(s.t0, s.t1, s.th0, s.th1).map(([t, th]) => mesh.vert(off(t, th, s.d1 - bev)));
  const inner = loop(s.t0, s.t1, s.th0, s.th1).map(([t, th]) => mesh.vert(off(t, th, s.d0)));
  const n = rim.length;
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    // Each shared edge is walked once each way (the grid walks its edge k1 → k).
    mesh.face([edgeIdx[k], edgeIdx[k1], rim[k1], rim[k]], s.slot, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    mesh.face([rim[k], rim[k1], inner[k1], inner[k]], side, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  // The inner face (inside the shell: unseen, but it closes the solid).
  const innerGrid: number[][] = [];
  for (let i = 0; i <= s.nt; i++) {
    const row: number[] = [];
    for (let j = 0; j <= s.nth; j++) {
      const onEdge = i === 0 || j === 0 || i === s.nt || j === s.nth;
      row.push(onEdge ? -1 : mesh.vert(off(s.t0 + ((s.t1 - s.t0) * i) / s.nt, s.th0 + ((s.th1 - s.th0) * j) / s.nth, s.d0)));
    }
    innerGrid.push(row);
  }
  // Edge vertices of the inner grid are the inner loop's.
  const at2 = (i: number, j: number): number => {
    if (innerGrid[i][j] >= 0) return innerGrid[i][j];
    if (i === 0) return inner[j === s.nth ? s.nth : j];
    if (j === s.nth) return inner[s.nth + i];
    if (i === s.nt) return inner[s.nth + s.nt + (s.nth - j)];
    return inner[2 * s.nth + s.nt + (s.nt - i)];
  };
  for (let i = 0; i < s.nt; i++) {
    for (let j = 0; j < s.nth; j++) mesh.face([at2(i, j + 1), at2(i + 1, j + 1), at2(i + 1, j), at2(i, j)], side, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  return orientOutward(mesh);
}

/**
 * A turned bearing boss about `b.w`, centred on b.o: a drum of radius r and half-length h, its
 * rims chamfered and each face stepped in to a hub (radius rh, standing hs proud).
 */
export function boss(b: Basis, r: number, h: number, slot: number, opts: { hub?: number; hubProud?: number; chamfer?: number; segments?: number; hubSlot?: number } = {}): PolyMesh {
  const c = opts.chamfer ?? Math.min(r * 0.12, h * 0.3);
  const rh = opts.hub ?? r * 0.55;
  const hp = opts.hubProud ?? Math.min(0.004, h * 0.15);
  const ch = Math.min(c * 0.5, hp * 0.6);
  const prof: Vec2[] = [
    [0, -h - hp],
    [rh - ch, -h - hp],
    [rh, -h - hp + ch],
    [rh, -h],
    [r - c, -h],
    [r, -h + c],
    [r, h - c],
    [r - c, h],
    [rh, h],
    [rh, h + hp - ch],
    [rh - ch, h + hp],
    [0, h + hp],
  ];
  const slots = prof.map((_, i) => (i <= 2 || i >= 8 ? (opts.hubSlot ?? slot) : slot));
  return lathe(prof, seg(opts.segments ?? 24), b, slots, 40);
}

/**
 * A hollow rectangular tube along `b.w` from t0 to t1: outer half-sizes (hu, hv), wall thickness,
 * corners rounded (radius rc outside, rc − wall inside). Closed: its two ends are annular faces. A
 * telescoping member's outer stage, which the inner slides inside.
 */
export function hollowBox(b: Basis, t0: number, t1: number, hu: number, hv: number, wall: number, rc: number, slot: number, endSlot = slot): PolyMesh {
  const mesh = new PolyMesh(40);
  const loop = (u: number, v: number, r: number): Vec2[] => {
    const out: Vec2[] = [];
    const seg = 4;
    const corners: [number, number, number][] = [
      [u - r, -v + r, -Math.PI / 2],
      [u - r, v - r, 0],
      [-u + r, v - r, Math.PI / 2],
      [-u + r, -v + r, Math.PI],
    ];
    for (const [cx, cy, a0] of corners) for (let i = 0; i <= seg; i++) out.push([cx + r * Math.cos(a0 + (Math.PI / 2) * (i / seg)), cy + r * Math.sin(a0 + (Math.PI / 2) * (i / seg))]);
    return out;
  };
  const outer = loop(hu, hv, rc);
  const inner = loop(hu - wall, hv - wall, Math.max(rc - wall, 0.001));
  const ring = (pts: Vec2[], t: number) => pts.map((p) => mesh.vert(at(b, p[0], p[1], t)));
  const o0 = ring(outer, t0);
  const o1 = ring(outer, t1);
  const i0 = ring(inner, t0);
  const i1 = ring(inner, t1);
  const n = outer.length;
  const len = t1 - t0;
  for (let j = 0; j < n; j++) {
    const k = (j + 1) % n;
    // Outside faces out, inside faces in, ends join them.
    mesh.face([o0[j], o0[k], o1[k], o1[j]], slot, [[j * 0.01, 0], [k * 0.01, 0], [k * 0.01, len], [j * 0.01, len]]);
    mesh.face([i0[k], i0[j], i1[j], i1[k]], slot, [[k * 0.01, 0], [j * 0.01, 0], [j * 0.01, len], [k * 0.01, len]]);
    mesh.face([o0[k], o0[j], i0[j], i0[k]], endSlot, [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01]]);
    mesh.face([o1[j], o1[k], i1[k], i1[j]], endSlot, [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01]]);
  }
  return orientOutward(mesh);
}

/** The mirror image across x = 0 (a left part from a right one): x negated, winding reversed. */
export function mirrorX(src: PolyMesh): PolyMesh {
  const m = new PolyMesh(src.crease);
  m.verts = src.verts.map((p) => [-p[0], p[1], p[2]] as Vec3);
  m.faces = src.faces.map((f) => [...f].reverse());
  m.faceMat = [...src.faceMat];
  m.uvs = src.uvs.map((u) => [...u].reverse());
  return m;
}

/** Copies a mesh, moved by d. */
export function moved(src: PolyMesh, d: Vec3): PolyMesh {
  const m = new PolyMesh(src.crease);
  m.append(src);
  m.verts = m.verts.map((p) => v3.add(p, d));
  return m;
}

/** A basis at o with w along `axis`, u along `uHint` (projected). */
export function frame(o: Vec3, w: Vec3, uHint: Vec3): Basis {
  const ww = v3.norm(w);
  const u = v3.norm(v3.sub(uHint, v3.scale(ww, v3.dot(uHint, ww))));
  const v = v3.cross(ww, u);
  return { o, u, v, w: ww };
}

/** The basis whose w is world +y, u world +x, v world −z (sections in plan, lofted upward). */
export const upright = (o: Vec3): Basis => ({ o, u: [1, 0, 0], v: [0, 0, -1], w: [0, 1, 0] });

/** Closes a mesh and orients it outward (a convenience for generators that build loops by hand). */
export function solid(m: PolyMesh): PolyMesh {
  return orientOutward(m);
}
