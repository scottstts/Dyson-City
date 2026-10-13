/**
 * Analytic ray tracing of the Dyson structure, for a ray from any origin inside the sphere.
 *
 * Units: shell radii, observer frame (observer at the origin, sphere centre C = (0, 1, 0)). The
 * primary view ray starts at the observer; reflection rays start on structure surfaces.
 *
 * A raised part is "slab ∩ layer" or "cone ∩ layer", where the layer is the shell between radius
 * 1 − depth and 1. A ray inside the sphere crosses that layer in up to two intervals: [0, a1]
 * (rising out of the layer near its origin) and [b0, tExit] (descending into it at the far side).
 * Both are tested: hubs and frames near the city are met in the first. The layout is layout.ts.
 */
import { float, vec2, vec3, If, dot, normalize, sqrt, max, min, abs, floor, smoothstep, clamp, asin, atan, cos, sin, acos, select, length, cross } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { STRUCTURE, hubAxes, isWide, meridianNormal, sphereDir, struts } from './layout';

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
   * Per-material coordinates.
   *  frame: (signed offset across the centreline, 1 on a side face, member index)
   *  hub:   (angle from the axis / radius, 1 on a side face, component index)
   *  panel / panelEdge / girdle: (latitude, longitude, 0)
   */
  aux: V3;
  /** Slab plane normal (frames) or cone axis (hubs). */
  axis: V3;
  /**
   * Member size: frames (half-width in plane-offset units, depth, centre offset of the slab plane);
   * hubs (angular radius, depth, 0).
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
export function traceStructure(o: V3, d: V3, footprint0: F): StructureHit {
  const S = STRUCTURE;
  const oc = o.sub(vec3(0, 1, 0)).toVar();
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
  };

  // Meridian spines: three planes, each carrying two spines 180° apart (indices 0–2).
  S.meridianLongitudes.slice(0, 3).forEach((lon, i) => {
    slabLayer(ctx, best, meridianNormal(lon), -S.spineWidth / 2, S.spineWidth / 2, S.spineDepth, MAT.frame, i);
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
  // Posts and braces across the open bands (20+): great-circle slabs clipped to their arc.
  struts().forEach((s, i) => {
    const nv = vec3(...s.n);
    const av = vec3(...s.a);
    const bv = vec3(...s.b);
    slabLayer(ctx, best, s.n, -s.width / 2, s.width / 2, s.depth, MAT.frame, 20 + i, (qn) =>
      dot(cross(av, qn), nv).greaterThanEqual(0.0).and(dot(cross(qn, bv), nv).greaterThanEqual(0.0)),
    );
  });

  // Hubs: equatorial ring hubs with a crown (0–5, 10–15), polar hubs (40, 41).
  const hubs = hubAxes();
  hubs.equatorial.forEach((a, i) => {
    coneLayer(ctx, best, a, S.hubRadius, S.hubDepth, MAT.hub, i);
    coneLayer(ctx, best, a, S.hubCrownRadius, S.hubCrownDepth, MAT.hub, 10 + i);
  });
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
          const ll = latLon(qShell);
          best.aux.assign(vec3(ll.lat, ll.lon, 0));
        })
        .Else(() => {
          best.mat.assign(float(MAT.space));
        });
    });
  });

  return best;
}
