/**
 * Analytic ray tracing of the Dyson structure, for a ray from any origin inside the sphere.
 *
 * Units: shell radii, observer frame (observer at the origin, sphere centre C = (0, 1, 0)). The
 * primary view ray starts at the observer; reflection rays start on structure surfaces. Rays are
 * given in band coordinates (the observer rides the band) and traced in frame coordinates
 * (spin.ts); the band's own parts are symmetric about the spin axis, so they trace there too.
 * Hit normals and axes are returned in band coordinates.
 *
 * A raised part is a convex piece ∩ layer, where the layer is the shell between radius 1 − depth
 * and 1 and the piece is bounded by planes and cones. A ray inside the sphere crosses that layer in
 * up to two intervals: [0, a1] (rising out of the layer near its origin) and [b0, tExit]
 * (descending into it at the far side). Both are tested: hubs and frames near the city are met in
 * the first. Pieces whose ends cut across the observer's path (spines, collars, struts sweep past
 * the city as the band turns) are bounded exactly, so their end faces exist from every side. The
 * layout is layout.ts.
 */
import { float, vec2, vec3, If, dot, normalize, sqrt, max, min, abs, floor, smoothstep, clamp, asin, atan, cos, sin, acos, select, length } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { STRUCTURE, hubAxes, isWide, meridianNormal, railFacePlane, sphereDir, strutTopCap, struts } from './layout';
import { marchRelief, RELIEF } from './relief';
import { toBand, toFrame } from './spin';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;
type B = Node<'bool'>;

const BIG = 1e9;

export const MAT = {
  none: 0,
  frame: 1,
  hub: 2,
  panel: 3,
  panelEdge: 4,
  girdle: 5,
  space: 7,
} as const;

export interface StructureHit {
  t: F;
  normal: V3;
  mat: F;
  /**
   * Per-material coordinates. Face: 0 top, 1 side, 2 end (a cut face across the member).
   *  frame: (signed offset across the centreline, face, member index)
   *  hub:   (angle from the axis / outer radius, face, component index)
   *  panel / panelEdge: (latitude, longitude, 0) in frame coordinates
   *  girdle: (latitude, longitude, 0) in band coordinates
   */
  aux: V3;
  /** Slab plane normal (frames) or cone axis (hubs). */
  axis: V3;
  /** Share of the star's cap the hit point sees (relief occlusion; 1 on open surfaces). */
  occlusion: F;
  /**
   * Member size: frames (half-width in plane-offset units, depth, centre offset of the slab plane);
   * hubs (outer angular radius, depth, inner radius / outer radius: 0 for a solid hub).
   */
  size: V3;
}

interface Ctx {
  /** Ray origin relative to the sphere centre. */
  oc: V3;
  d: V3;
  /** Exit through the shell (radius 1). */
  tExit: F;
}

/** Latitude / longitude of a sphere-frame unit vector. */
export function latLon(qn: V3): { lat: F; lon: F } {
  return { lat: asin(clamp(qn.z.negate(), -1, 1)), lon: atan(qn.x, qn.y.negate()) };
}

/** Ray–layer intervals: [0, a1] and [b0, tExit]; a1 = b0 = tExit when the ray never leaves it. */
function layer(ctx: Ctx, depth: number): { a1: F; b0: F } {
  const rin = 1 - depth;
  const b = dot(ctx.oc, ctx.d);
  const c = dot(ctx.oc, ctx.oc).sub(rin * rin);
  const disc = b.mul(b).sub(c);
  const sq = sqrt(max(disc, 0.0));
  const crosses = disc.greaterThan(0.0).and(b.negate().add(sq).greaterThan(0.0));
  return {
    a1: select(crosses, max(b.negate().sub(sq), 0.0), ctx.tExit),
    b0: select(crosses, b.negate().add(sq), ctx.tExit),
  };
}

/**
 * First entry of the interval [e0, e1] (along the ray) into the layer's two intervals.
 * Returns the entry distance and whether it came through the interval's own start (a side face).
 */
function enterLayer(ctx: Ctx, L: { a1: F; b0: F }, e0: F, e1: F): { t: F; ok: B; side: B } {
  const c1 = max(e0, 0.0);
  const ok1 = c1.lessThan(min(e1, L.a1));
  const c2 = max(e0, L.b0);
  const ok2 = c2.lessThan(min(e1, ctx.tExit));
  const t = select(ok1, c1, c2);
  const start = select(ok1, float(0), L.b0);
  return { t, ok: ok1.or(ok2), side: e0.greaterThanEqual(start) };
}

/**
 * Slab ∩ layer. With `clip` (a predicate on the hit direction), the member exists only where the
 * predicate holds; both layer intervals are tried so a clipped near hit does not hide a far one.
 */
function slabLayer(ctx: Ctx, best: StructureHit, n: [number, number, number], s0: number, s1: number, depth: number, mat: number, index: number, clip?: (qn: V3) => B): void {
  const nn = vec3(...n);
  const dn = dot(ctx.d, nn);
  const on = dot(ctx.oc, nn);
  const parallel = abs(dn).lessThan(1e-7);
  const safe = select(parallel, float(1e-7), dn);
  const ta = float(s0).sub(on).div(safe);
  const tb = float(s1).sub(on).div(safe);
  const inside = on.greaterThan(s0).and(on.lessThan(s1));
  const e0 = select(parallel, select(inside, float(-BIG), float(BIG)), min(ta, tb));
  const e1 = select(parallel, select(inside, float(BIG), float(-BIG)), max(ta, tb));
  const L = layer(ctx, depth);
  let hit: { t: F; ok: B; side: B };
  if (!clip) {
    hit = enterLayer(ctx, L, e0, e1);
  } else {
    const c1 = max(e0, 0.0);
    const ok1 = c1.lessThan(min(e1, L.a1));
    const c2 = max(e0, L.b0);
    const ok2 = c2.lessThan(min(e1, ctx.tExit));
    const v1 = ok1.and(clip(normalize(ctx.oc.add(ctx.d.mul(c1)))));
    const v2 = ok2.and(clip(normalize(ctx.oc.add(ctx.d.mul(c2)))));
    hit = { t: select(v1, c1, c2), ok: v1.or(v2), side: select(v1, e0.greaterThanEqual(0.0), e0.greaterThanEqual(L.b0)) };
  }
  If(hit.ok.and(hit.t.lessThan(best.t)).and(hit.t.greaterThan(1e-6)), () => {
    const q = ctx.oc.add(ctx.d.mul(hit.t));
    const top = normalize(q).negate();
    const side = nn.mul(select(dn.greaterThan(0.0), float(-1), float(1)));
    best.t.assign(hit.t);
    best.normal.assign(select(hit.side, side, top));
    best.mat.assign(float(mat));
    best.aux.assign(vec3(dot(q, nn).sub((s0 + s1) * 0.5), select(hit.side, float(1), float(0)), float(index)));
    best.axis.assign(nn);
    best.size.assign(vec3((s1 - s0) / 2, depth, (s0 + s1) / 2));
  });
}

function coneLayer(ctx: Ctx, best: StructureHit, a: [number, number, number], beta: number, depth: number, mat: number, index: number): void {
  const av = vec3(...a);
  const k = Math.cos(beta) ** 2;
  const m = dot(ctx.d, av);
  const p = dot(ctx.oc, av);
  const A = m.mul(m).sub(k);
  const Bh = p.mul(m).sub(dot(ctx.oc, ctx.d).mul(k));
  const Cc = p.mul(p).sub(dot(ctx.oc, ctx.oc).mul(k));
  const disc = Bh.mul(Bh).sub(A.mul(Cc));
  If(disc.greaterThan(0.0).and(A.lessThan(0.0)), () => {
    const sq = sqrt(disc);
    const r0 = Bh.negate().sub(sq).div(A);
    const r1 = Bh.negate().add(sq).div(A);
    const e0 = min(r0, r1);
    const e1 = max(r0, r1);
    // Only the nappe on the axis side.
    const mid = e0.add(e1).mul(0.5);
    const onAxisSide = p.add(m.mul(mid)).greaterThan(0.0);
    const L = layer(ctx, depth);
    const hit = enterLayer(ctx, L, e0, e1);
    If(onAxisSide.and(hit.ok).and(hit.t.lessThan(best.t)).and(hit.t.greaterThan(1e-6)), () => {
      const q = ctx.oc.add(ctx.d.mul(hit.t));
      const coneN = normalize(q.mul(k).sub(av.mul(dot(q, av))));
      const sideN = coneN.mul(select(dot(coneN, ctx.d).greaterThan(0.0), float(-1), float(1)));
      const top = normalize(q).negate();
      best.t.assign(hit.t);
      best.normal.assign(select(hit.side, sideN, top));
      best.mat.assign(float(mat));
      best.aux.assign(vec3(acos(clamp(dot(normalize(q), av), -1, 1)).div(beta), select(hit.side, float(1), float(0)), float(index)));
      best.axis.assign(av);
      best.size.assign(vec3(beta, depth, 0));
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Exact convex pieces: an intersection of half-spaces and cones, entered through a real face

/** Ray interval [lo, hi] inside one bound, and the face id it enters through at lo. */
interface Span {
  lo: F;
  hi: F;
  face: F;
}

/** Face ids: planes are numbered from 0 in the order given. */
const FACE_CONE = 20;
const FACE_BORE = 21;
const FACE_TOP = 22;
const FACE_NONE = 23;

/** A cut plane, as the half-space q·n < c the piece keeps (q from the centre). */
interface Plane {
  n: [number, number, number];
  c: number;
}

function planeSpan(ctx: Ctx, p: Plane, face: number): Span {
  const nv = vec3(...p.n);
  const nd = dot(ctx.d, nv);
  const gap = float(p.c).sub(dot(ctx.oc, nv));
  const parallel = abs(nd).lessThan(1e-9);
  const tc = gap.div(select(parallel, float(1e-9), nd));
  const inside = gap.greaterThan(0.0);
  return {
    lo: select(parallel, select(inside, float(-BIG), float(BIG)), select(nd.lessThan(0.0), tc, float(-BIG))),
    hi: select(parallel, select(inside, float(BIG), float(-BIG)), select(nd.greaterThan(0.0), tc, float(BIG))),
    face: float(face),
  };
}

/** Interval inside the axis-side nappe of the cone of half-angle β about a (empty when missed). */
function coneSpan(ctx: Ctx, a: [number, number, number], beta: number): { lo: F; hi: F; ok: B } {
  const av = vec3(...a);
  const k = Math.cos(beta) ** 2;
  const m = dot(ctx.d, av);
  const p = dot(ctx.oc, av);
  const A = m.mul(m).sub(k);
  const Bh = p.mul(m).sub(dot(ctx.oc, ctx.d).mul(k));
  const Cc = p.mul(p).sub(dot(ctx.oc, ctx.oc).mul(k));
  const disc = Bh.mul(Bh).sub(A.mul(Cc));
  const sq = sqrt(max(disc, 0.0));
  const safeA = min(A, -1e-9);
  const r0 = Bh.negate().sub(sq).div(safeA);
  const r1 = Bh.negate().add(sq).div(safeA);
  const e0 = min(r0, r1);
  const e1 = max(r0, r1);
  const ok = disc.greaterThan(0.0).and(A.lessThan(0.0)).and(p.add(m.mul(e0.add(e1).mul(0.5))).greaterThan(0.0));
  return { lo: select(ok, e0, float(BIG)), hi: select(ok, e1, float(-BIG)), ok };
}

function meet(a: Span, b: Span): Span {
  return { lo: max(a.lo, b.lo), hi: min(a.hi, b.hi), face: select(b.lo.greaterThan(a.lo), b.face, a.face) };
}

/**
 * First entry into (∩ spans) ∩ layer, optionally ∩ (one of `alts`, a union of spans: the outside
 * of a cone is two intervals). An entry at the ray's origin is not an entry.
 */
function pieceEntry(ctx: Ctx, L: { a1: F; b0: F }, spans: Span[], alts?: Span[]): { t: F; face: F; ok: B } {
  const base = spans.reduce(meet);
  const layers: Span[] = [
    { lo: float(0), hi: L.a1, face: float(FACE_NONE) },
    { lo: L.b0, hi: ctx.tExit, face: float(FACE_TOP) },
  ];
  let t: F = float(BIG);
  let face: F = float(FACE_NONE);
  for (const l of layers) {
    for (const alt of alts ?? [null]) {
      const s = alt ? meet(meet(base, l), alt) : meet(base, l);
      const better = s.lo.lessThan(s.hi).and(s.lo.greaterThan(1e-6)).and(s.lo.lessThan(t));
      t = select(better, s.lo, t);
      face = select(better, s.face, face);
    }
  }
  return { t, face, ok: t.lessThan(BIG * 0.5) };
}

/** Outward normal of a plane face, by id, among `planes` (or `fallback` for any other face). */
function planeNormal(face: F, planes: Plane[], fallback: V3): V3 {
  let n: V3 = fallback;
  planes.forEach((p, i) => {
    n = select(face.equal(float(i)), vec3(...p.n), n) as unknown as V3;
  });
  return n;
}

/**
 * A girder exactly bounded: slab s0 < q·n < s1, cut by `caps` (end faces across the member).
 * Same hit coordinates as slabLayer.
 */
function slabPiece(ctx: Ctx, best: StructureHit, n: [number, number, number], s0: number, s1: number, depth: number, caps: Plane[], mat: number, index: number): void {
  const planes: Plane[] = [{ n, c: s1 }, { n: [-n[0], -n[1], -n[2]], c: -s0 }, ...caps];
  const L = layer(ctx, depth);
  const e = pieceEntry(ctx, L, planes.map((p, i) => planeSpan(ctx, p, i)));
  If(e.ok.and(e.t.lessThan(best.t)), () => {
    const q = ctx.oc.add(ctx.d.mul(e.t));
    const nn = vec3(...n);
    const top = e.face.equal(float(FACE_TOP));
    best.t.assign(e.t);
    best.normal.assign(planeNormal(e.face, planes, normalize(q).negate()));
    best.mat.assign(float(mat));
    best.aux.assign(vec3(dot(q, nn).sub((s0 + s1) * 0.5), select(top, float(0), select(e.face.greaterThan(1.5), float(2), float(1))), float(index)));
    best.axis.assign(nn);
    best.size.assign(vec3((s1 - s0) / 2, depth, (s0 + s1) / 2));
  });
}

/**
 * A hub collar: the ring between cones of half-angle `inner` and `outer` about the crossing point
 * a, in one hemisphere, cut flush against that rail's face (the band runs through the ring).
 */
function collarPieces(ctx: Ctx, best: StructureHit, a: [number, number, number], inner: number, outer: number, depth: number, index: number): void {
  const out = coneSpan(ctx, a, outer);
  If(out.ok, () => {
    const bore = coneSpan(ctx, a, inner);
    const L = layer(ctx, depth);
    // Outside the inner cone: before it, or after it.
    const alts: Span[] = [
      { lo: float(-BIG), hi: select(bore.ok, bore.lo, float(BIG)), face: float(FACE_NONE) },
      { lo: select(bore.ok, bore.hi, float(BIG)), hi: float(BIG), face: float(FACE_BORE) },
    ];
    const av = vec3(...a);
    const kOut = Math.cos(outer) ** 2;
    const kIn = Math.cos(inner) ** 2;
    for (const hemi of [1, -1] as const) {
      const cut = railFacePlane(hemi);
      const e = pieceEntry(ctx, L, [{ lo: out.lo, hi: out.hi, face: float(FACE_CONE) }, planeSpan(ctx, cut, 0)], alts);
      If(e.ok.and(e.t.lessThan(best.t)), () => {
        const q = ctx.oc.add(ctx.d.mul(e.t));
        const qa = dot(q, av);
        const coneOut = normalize(q.mul(kOut).sub(av.mul(qa)));
        const coneIn = normalize(q.mul(kIn).sub(av.mul(qa))).negate();
        const n = select(e.face.equal(float(FACE_CONE)), coneOut, select(e.face.equal(float(FACE_BORE)), coneIn, select(e.face.equal(float(0)), vec3(...cut.n), normalize(q).negate())));
        best.t.assign(e.t);
        best.normal.assign(n);
        best.mat.assign(float(MAT.hub));
        best.aux.assign(vec3(acos(clamp(dot(normalize(q), av), -1, 1)).div(outer), select(e.face.equal(float(FACE_TOP)), float(0), select(e.face.equal(float(0)), float(2), float(1))), float(index)));
        best.axis.assign(av);
        best.size.assign(vec3(outer, depth, inner / outer));
      });
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Collector panels

/** Panel layout at a shell point: signed distance to the panel outline (+ inside) and cell coords. */
export interface PanelField {
  /** Signed arc distance to the rounded panel outline (positive inside the panel). */
  dist: F;
  /** In-surface unit gradient of `dist` (points inward, away from the outline). */
  grad: V3;
  /** Cell-local coordinates in [0, 1]² across the plated span (u along longitude, v along latitude). */
  uv: V2;
  /** Cell size in arc units (u, v) for footprint conversion. */
  span: V2;
  /** Cell identity: (latitude band 0–2, hemisphere ±1, meridian sector 0–5). */
  cell: V3;
  /** Western bound of the plated span and its width (longitude, radians). */
  lon0: F;
  lonSpan: F;
}

/**
 * The gore panel at a shell point: signed arc distance to its rounded outline, gradient and cell
 * coordinates. Sector k lies between meridians k and k+1 (60° apart); its panel is bounded by the
 * meridian planes at λ_k + h_k and λ_{k+1} − h_{k+1} (h = wideHalf for even meridians, slotHalf for
 * odd ones; q·n = cos φ·sin Δλ is the arc distance to such a plane) and by latitudes panelLow and
 * panelHigh in each hemisphere.
 */
export function panelField(qn: V3): PanelField {
  const S = STRUCTURE;
  const { lat, lon } = latLon(qn);
  const absLat = abs(lat);
  const sgnLat = select(lat.greaterThanEqual(0.0), float(1), float(-1));
  const north = normalize(vec3(0, 0, -1).sub(qn.mul(qn.z.negate())));
  const lon0 = S.meridianLongitudes[0];
  const sRaw = floor(lon.sub(lon0).div(Math.PI / 3));
  const sector = sRaw.sub(floor(sRaw.div(6)).mul(6)).toVar();
  const wideA = sector.sub(floor(sector.div(2)).mul(2)).lessThan(0.5);
  const lonA = sRaw.mul(Math.PI / 3).add(lon0);
  const bA = lonA.add(select(wideA, float(S.wideHalf), float(S.slotHalf)));
  const bB = lonA.add(Math.PI / 3).sub(select(wideA, float(S.slotHalf), float(S.wideHalf)));
  const nA = vec3(cos(bA), sin(bA), 0);
  const nB = vec3(cos(bB), sin(bB), 0);
  const dA = dot(qn, nA);
  const dB = dot(qn, nB).negate();
  const useA = dA.lessThan(dB);
  const dm = min(dA, dB);
  const gm = normalize(select(useA, nA, nB.negate()).sub(qn.mul(dot(qn, select(useA, nA, nB.negate())))));
  const dLo = absLat.sub(S.panelLow);
  const dHi = float(S.panelHigh).sub(absLat);
  const dl = min(dLo, dHi);
  const gl = north.mul(sgnLat).mul(select(dLo.lessThan(dHi), float(1), float(-1)));
  // Rounded rectangle: corners are arcs of radius r.
  const r = float(S.panelCornerRadius);
  const inCorner = dm.lessThan(r).and(dl.lessThan(r));
  const cv = vec2(r.sub(dm), r.sub(dl));
  const cLen = max(length(cv), 1e-6);
  const dist = select(inCorner, r.sub(cLen), min(dm, dl));
  const gradCorner = normalize(gm.mul(cv.x).add(gl.mul(cv.y)));
  const grad = select(inCorner, gradCorner, select(dm.lessThan(dl), gm, gl));
  const cosLat = cos(lat).max(0.05);
  const lonSpan = bB.sub(bA).max(1e-3);
  return {
    dist,
    grad,
    uv: vec2(lon.sub(bA).div(lonSpan), absLat.sub(S.panelLow).div(S.panelHigh - S.panelLow)),
    span: vec2(lonSpan.mul(cosLat), S.panelHigh - S.panelLow),
    cell: vec3(0, sgnLat, sector),
    lon0: bA,
    lonSpan,
  };
}

function panelCoverage(qn: V3, footprint: F): F {
  const f = panelField(qn);
  return smoothstep(footprint.mul(-0.5), footprint.mul(0.5), f.dist);
}

function inGirdle(qn: V3): B {
  return abs(asin(clamp(qn.z.negate(), -1, 1))).lessThan(STRUCTURE.girdleHalfLatitude);
}

// ---------------------------------------------------------------------------------------------
// Intersection

/**
 * Nearest structure hit along o + t·d (o relative to the observer, d unit). `footprint0` is the
 * angular pixel size, used only to anti-alias panel outlines.
 */
export function traceStructure(o: V3, dBand: V3, footprint0: F, withRelief = false): StructureHit {
  const S = STRUCTURE;
  const ocBand = o.sub(vec3(0, 1, 0));
  // Trace in frame coordinates (spin.ts).
  const oc = toFrame(ocBand).toVar();
  const d = toFrame(dBand).toVar();
  const b = dot(oc, d);
  const c = dot(oc, oc).sub(1);
  const tExit = b.negate().add(sqrt(max(b.mul(b).sub(c), 0.0))).toVar();
  const ctx: Ctx = { oc, d, tExit };
  const best: StructureHit = {
    t: float(BIG).toVar(),
    normal: vec3(0, 1, 0).toVar(),
    mat: float(MAT.none).toVar(),
    aux: vec3(0).toVar(),
    axis: vec3(0, 0, 1).toVar(),
    size: vec3(0).toVar(),
    occlusion: float(1).toVar(),
  };

  // Meridian spines: three planes, each carrying two spines 180° apart (indices 0–2), from each pole
  // to just short of the band, where they end inside their hub collars.
  const spineEnd = Math.sin(S.spineEnd);
  S.meridianLongitudes.slice(0, 3).forEach((lon, i) => {
    for (const hemi of [1, -1]) {
      slabPiece(ctx, best, meridianNormal(lon), -S.spineWidth / 2, S.spineWidth / 2, S.spineDepth, [{ n: [0, 0, hemi], c: -spineEnd }], MAT.frame, i);
    }
  });
  // Latitude slabs (q.z = −sin φ), optionally clipped.
  const zSlab = (lat: number, width: number, depth: number, idx: number, clip?: (qn: V3) => B) => {
    const z = -Math.sin(lat);
    const hw = (width / 2) * Math.cos(lat);
    slabLayer(ctx, best, [0, 0, 1], z - hw, z + hw, depth, MAT.frame, idx, clip);
  };
  // The band's twin edge rails (10, 11) and the polar collars (12, 13).
  const rimLat = S.girdleHalfLatitude - S.rimWidth / 2;
  zSlab(rimLat, S.rimWidth, S.rimDepth, 10);
  zSlab(-rimLat, S.rimWidth, S.rimDepth, 11);
  zSlab(S.collarLatitude, S.collarWidth, S.collarDepth, 12);
  zSlab(-S.collarLatitude, S.collarWidth, S.collarDepth, 13);
  // Latitude members across the wide openings (14–17): only within ±wideHalf of a wide meridian.
  const wideLons = S.meridianLongitudes.filter((_, k) => isWide(k));
  const inWideOpening = (qn: V3): B => {
    let any: B | null = null;
    for (const lon of wideLons) {
      const mn = vec3(...meridianNormal(lon));
      const md = vec3(...sphereDir(0, lon));
      const cosLat = sqrt(max(float(1).sub(qn.z.mul(qn.z)), 1e-6));
      const ok = abs(dot(qn, mn)).lessThan(cosLat.mul(Math.sin(S.wideHalf))).and(dot(qn, md).greaterThan(0.0));
      any = any ? any.or(ok) : ok;
    }
    return any as B;
  };
  S.memberLatitudes.forEach((lat, i) => {
    zSlab(lat, S.memberWidth, S.memberDepth, 14 + i * 2, inWideOpening);
    zSlab(-lat, S.memberWidth, S.memberDepth, 15 + i * 2, inWideOpening);
  });
  // Posts and braces across the open bands (20+): great-circle slabs from the panel corner (cut
  // square across the member) down to the rail (cut flush against its face).
  struts().forEach((s, i) => {
    slabPiece(ctx, best, s.n, -s.width / 2, s.width / 2, s.depth, [railFacePlane(s.hemi), strutTopCap(s)], MAT.frame, 20 + i);
  });

  // Hubs: equatorial hub collars (0–5), polar hubs (40, 41).
  const hubs = hubAxes();
  hubs.equatorial.forEach((a, i) => collarPieces(ctx, best, a, S.hubInner, S.hubOuter, S.hubDepth, i));
  hubs.poles.forEach((a, i) => coneLayer(ctx, best, a, S.poleRadius, S.poleDepth, MAT.hub, 40 + i));

  // Collector panels (top faces at radius 1 − panelDepth, edges down to the shell) and the band.
  const L = layer(ctx, S.panelDepth);
  const tTop = select(L.b0.lessThan(tExit), L.b0, tExit);
  If(tTop.lessThan(best.t), () => {
    const qTop = normalize(oc.add(d.mul(tTop)));
    const qShell = normalize(oc.add(d.mul(tExit))).toVar();
    const fpTop = footprint0.mul(tTop);
    If(panelCoverage(qTop, fpTop).greaterThan(0.5), () => {
      best.t.assign(tTop);
      best.normal.assign(qTop.negate());
      best.mat.assign(float(MAT.panel));
      const ll = latLon(qTop);
      best.aux.assign(vec3(ll.lat, ll.lon, 0));
      if (withRelief) {
        // Relief: ribs and recessed bays on the module lattice (relief.ts), sized as in surfaces.ts.
        const pf = panelField(qTop);
        const nu = max(floor(pf.span.x.div(S.panelModule).add(0.5)), 1.0);
        const nv = max(floor(pf.span.y.div(S.panelModule).add(0.5)), 1.0);
        const module = vec2(pf.span.x.div(nu), pf.span.y.div(nv));
        const cosLat = cos(ll.lat).max(0.05);
        const seed = pf.cell.z.mul(7.0).add(pf.cell.x.mul(31.0)).add(pf.cell.y.mul(3.0));
        // Fade with how well the ribs are resolved, and away from the panel's outline (its rim is flat).
        const ribWidth = min(module.x, module.y).mul(RELIEF.ribHalf * 2);
        const amp = float(1).sub(smoothstep(ribWidth.mul(0.6), ribWidth.mul(1.8), fpTop)).mul(smoothstep(0.002, 0.004, pf.dist));
        const fr = { lon0: pf.lon0, lonSpan: pf.lonSpan, latLow: float(S.panelLow), module, cosLat, hemi: pf.cell.y, seed };
        const rh = marchRelief(oc, d, tTop, 1 - S.panelDepth, fr, amp, qTop.negate());
        best.t.assign(rh.t);
        best.normal.assign(rh.normal);
        best.occlusion.assign(rh.occlusion);
        const lr = latLon(normalize(oc.add(d.mul(rh.t))));
        best.aux.assign(vec3(lr.lat, lr.lon, 0));
      }
    }).ElseIf(tExit.lessThan(best.t), () => {
      If(panelCoverage(qShell, footprint0.mul(tExit)).greaterThan(0.5), () => {
        // The ray dropped past a panel's outline and met its edge face.
        const pf = panelField(qShell);
        best.t.assign(tExit);
        best.normal.assign(normalize(pf.grad.negate().add(qShell.negate().mul(0.1))));
        best.mat.assign(float(MAT.panelEdge));
        const ll = latLon(qShell);
        best.aux.assign(vec3(ll.lat, ll.lon, 0));
      })
        .ElseIf(inGirdle(qShell), () => {
          best.t.assign(tExit);
          best.normal.assign(qShell.negate());
          best.mat.assign(float(MAT.girdle));
          // The band turns with the observer: its coordinates are band coordinates.
          const ll = latLon(toBand(qShell));
          best.aux.assign(vec3(ll.lat, ll.lon, 0));
        })
        .Else(() => {
          best.mat.assign(float(MAT.space));
        });
    });
  });

  best.normal.assign(toBand(best.normal));
  best.axis.assign(toBand(best.axis));
  return best;
}
