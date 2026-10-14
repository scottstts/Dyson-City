/**
 * Organisation of a collector panel: one engineering system from the panel's perimeter header
 * down to the plating,
 *
 *   perimeter header → regional manifolds → collection branches → districts → assemblies → tiles
 *
 * so that seams, relief, finishes and heat all follow the same layout. Each gore panel (some
 * 700,000 km across) is cut recursively, guillotine fashion: a cell is split across its longer side
 * at an irregular position, and the cut is a collection channel running from one side of the cell to
 * the other. Every channel therefore ends on a larger one (or on the perimeter header): branches
 * visibly join manifolds at T-junctions, never crossing them, and nothing repeats at a countable
 * spacing. Channels are sized by the cell they drain: manifolds cut across the largest cells are
 * wide, deep and hot; branches narrower, shallower and cooler. Cutting stops at district size
 * (~10,000–40,000 km): each district drains into its largest bounding channel, and its assemblies
 * (1,000–4,000 km) are laid in strips along that flow, its coolant warming toward the drain.
 *
 * Two stages:
 *  - The manifolds (the first `basinLevel` cuts) run along meridians and parallels, as the panel's
 *    own edges do, in the panel's (longitude, latitude) coordinates. They bound manifold basins of
 *    ~300,000 km: regional installations, each of one era, character and load.
 *  - Inside a basin the network has the basin's own orientation (in its rotated arc frame), and its
 *    branches end obliquely on the manifolds. Rejected: one orientation for the whole network —
 *    every long cut ran along a parallel, perpendicular to the view, and the panels read as ruled
 *    paper (a stack of evenly lit lines).
 *
 * The same descent serves three consumers at different depths: the full one shades a pixel
 * (surfaces.ts), the first `reliefLevels` are cut into the surface as relief (relief.ts), and the
 * first `coarseLevels` (the manifolds) give the broad regions a traced reflection shows
 * (reflected.ts).
 */
import { float, vec2, vec3, vec4, floor, max, min, mix, cos, sin, abs, select, smoothstep, clamp, step, sqrt } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { hash33 } from '../../render/tsl/noise';
import { STRUCTURE, DEG } from './layout';
import { lineCoverage } from './plating';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;
type V4 = Node<'vec4'>;

export const DISTRICTS = {
  /** Descent depth when shading a pixel, cut into relief, and for reflections. */
  levels: 12,
  reliefLevels: 6,
  coarseLevels: 3,
  /** Cuts in the panel's axes (the manifolds); the cell they end in is a manifold basin. */
  basinLevel: 3,
  /** A basin's network is turned by up to this angle (radians); some basins are not turned. */
  basinTurn: 45 * DEG,
  basinAligned: 0.3,
  /** A cell stops splitting once its larger side is below a threshold drawn per cell in this range: districts. */
  stopMin: 0.018,
  stopMax: 0.042,
  /** Cut position as a fraction of the cell: splitLo + splitSpan·u. */
  splitLo: 0.3,
  splitSpan: 0.4,
  /** Chance of cutting the shorter side of a cell that is not yet elongated. */
  crossCut: 0.18,
  /** Assemblies: strip width range across the flow, and segment length as a multiple of it. */
  stripMin: 0.0012,
  stripMax: 0.0042,
  segmentMin: 1.2,
  segmentMax: 4.0,
  /** The finest tile (sample-statistics lattice). */
  finest: 0.0003,
  /** Joints between assemblies (half-width) and the shared set error of a district (1σ, radians). */
  jointHalf: 0.00002,
  districtSigma: 0.006,
  /** Inlet sumps where a branch meets a larger channel: extra depth as a share of the larger channel's. */
  sump: 0.45,
  /** Fields (relief-level cells) step by up to this depth: broad, shallow. */
  fieldStep: 0.00008,
} as const;

/** Lattice quantisation of cell corners for hashing (exact: every pixel in a cell computes them identically). */
const QUANT = 1e5;
/** Side code of the panel's perimeter: it drains everything that touches it. */
const PERIMETER = 4;

/** Half-width of the channel cut across a cell whose larger side is S (arc units). */
export function channelHalfWidth(S: F): F {
  return clamp(S.mul(0.0035), 0.00018, 0.0016).mul(step(1e-6, S).mul(step(S, PERIMETER - 1)));
}

/** Depth of that channel below the collector face. */
export function channelDepth(S: F): F {
  return clamp(S.mul(0.0022), 0.00012, 0.0016).mul(step(1e-6, S).mul(step(S, PERIMETER - 1)));
}

/** Relative temperature rise of the coolant that channel carries (the collected heat of its cell). */
export function channelHeat(S: F): F {
  return clamp(S.mul(0.09), 0.015, 0.07);
}

/** A panel point in cell coordinates. */
export interface PanelCoords {
  /** (longitude − panel west bound, |latitude| − panelLow), radians. */
  p: V2;
  /** Panel extent in the same coordinates. */
  ext: V2;
  seed: F;
}

/**
 * The cell a descent ends in: an axis-aligned outer cell (the basin, or a larger cell if the descent
 * stopped above it) and, inside a basin, an inner cell in the basin's rotated arc frame.
 */
export interface Cell {
  /** Outer cell in panel coordinates. */
  lo: V2;
  hi: V2;
  /**
   * For each bounding line (lo.x, hi.x, lo.y, hi.y): the larger side S of the cell it was cut
   * across, which sizes its channel; 0 for none, PERIMETER for the panel's edge.
   */
  side: V4;
  /** Inner cell in the basin frame (arc units about the basin's centre, turned by rot), and its sides. */
  ilo: V2;
  ihi: V2;
  iside: V4;
  /** Basin frame: centre (panel coordinates), cos of its latitude, rotation (cos, sin). */
  centre: V2;
  cosB: F;
  rot: V2;
  hash: V3;
  /** Hash of the manifold basin. */
  basin: V3;
}

const latOf = (y: F): F => y.add(STRUCTURE.panelLow);

/** One guillotine cut: updates (lo, hi, side) toward point q, for a cell of extents (ex, ey) in arc units. */
function cut(q: V2, lo: V2, hi: V2, side: V4, ex: F, ey: F, h: V3, alive: F): F {
  const D = DISTRICTS;
  const ext = hi.sub(lo);
  const S = max(ex, ey);
  const split = alive.mul(step(mix(float(D.stopMin), float(D.stopMax), h.z), S));
  const elongated = S.div(max(min(ex, ey), 1e-6)).greaterThan(2.2);
  const cross = h.x.lessThan(D.crossCut).and(elongated.not());
  // Cut across x when x is the longer side, unless this cell cuts the other way.
  const cutX = select(cross, ex.lessThanEqual(ey), ex.greaterThan(ey));
  const f = h.y.mul(D.splitSpan).add(D.splitLo);
  const pos = select(cutX, lo.x.add(ext.x.mul(f)), lo.y.add(ext.y.mul(f)));
  const below = select(cutX, q.x, q.y).lessThan(pos);
  const sx = split.mul(select(cutX, float(1), float(0)));
  const sy = split.sub(sx);
  const bl = select(below, float(1), float(0));
  hi.x.assign(mix(hi.x, pos, sx.mul(bl)));
  lo.x.assign(mix(lo.x, pos, sx.mul(bl.oneMinus())));
  hi.y.assign(mix(hi.y, pos, sy.mul(bl)));
  lo.y.assign(mix(lo.y, pos, sy.mul(bl.oneMinus())));
  side.assign(mix(side, vec4(S), vec4(sx.mul(bl.oneMinus()), sx.mul(bl), sy.mul(bl.oneMinus()), sy.mul(bl))));
  return split;
}

/** The point's arc coordinates in a basin frame. */
function toBasin(p: V2, centre: V2, cosB: F, rot: V2): V2 {
  const v = vec2(p.x.sub(centre.x).mul(cosB), p.y.sub(centre.y));
  return vec2(rot.x.mul(v.x).add(rot.y.mul(v.y)), rot.x.mul(v.y).sub(rot.y.mul(v.x))) as unknown as V2;
}

/** Descends `levels` cuts from the whole panel to the cell containing c.p. */
export function descend(c: PanelCoords, levels: number): Cell {
  const D = DISTRICTS;
  const lo = vec2(0, 0).toVar();
  const hi = c.ext.toVar();
  const side = vec4(PERIMETER).toVar();
  const hash = vec3(0.5).toVar();
  const alive = float(1).toVar();
  const outer = Math.min(levels, D.basinLevel);
  for (let k = 0; k < outer; k++) {
    const h = hash33(vec3(floor(lo.mul(QUANT)), c.seed.add(k * 7 + 3)));
    hash.assign(mix(hash, h, alive));
    const ex = hi.x.sub(lo.x).mul(cos(latOf(lo.y.add(hi.y).mul(0.5))));
    alive.assign(cut(c.p, lo, hi, side, ex, hi.y.sub(lo.y), h, alive));
  }
  // The basin's frame: centred on it, turned by its own angle.
  const basinKey = floor(lo.mul(QUANT));
  const basin = hash33(vec3(basinKey, c.seed.add(D.basinLevel * 7 + 3))).toVar();
  const centre = lo.add(hi).mul(0.5);
  const cosB = cos(latOf(centre.y));
  // (Its x and y set its load and finish character: basinCharacter.)
  const turn = select(basin.z.lessThan(D.basinAligned), float(0), basin.z.sub((1 + D.basinAligned) / 2).mul((2 * D.basinTurn) / (1 - D.basinAligned)));
  const rot = vec2(cos(turn), sin(turn)) as unknown as V2;
  const wx = hi.x.sub(lo.x).mul(cosB).mul(0.5);
  const wy = hi.y.sub(lo.y).mul(0.5);
  const half = vec2(abs(rot.x).mul(wx).add(abs(rot.y).mul(wy)), abs(rot.y).mul(wx).add(abs(rot.x).mul(wy)));
  const ilo = half.negate().toVar();
  const ihi = half.toVar();
  const iside = vec4(0).toVar();
  if (levels > D.basinLevel) {
    hash.assign(mix(hash, basin, alive));
    const q = toBasin(c.p, centre as unknown as V2, cosB, rot);
    const key = basinKey.x.mul(0.37).add(basinKey.y.mul(0.61)).floor().mod(997.0);
    for (let k = D.basinLevel; k < levels; k++) {
      const h = hash33(vec3(floor(ilo.mul(QUANT)), c.seed.add(k * 7 + 3).add(key.mul(131.0))));
      hash.assign(mix(hash, h, alive));
      alive.assign(cut(q, ilo, ihi, iside, ihi.x.sub(ilo.x), ihi.y.sub(ilo.y), h, alive));
    }
    // A cell still splitting at the last level gets its own identity (it would share its parent's).
    hash.assign(mix(hash, hash33(vec3(floor(ilo.mul(QUANT)), c.seed.add(levels * 7 + 3).add(key.mul(131.0)))), alive));
  }
  return { lo, hi, side, ilo, ihi, iside, centre: centre as unknown as V2, cosB, rot, hash, basin };
}

/** Arc distances from c.p to the cell's bounding lines: outer (lo.x, hi.x, lo.y, hi.y) and inner (same, in the basin frame). */
export function sideDistances(c: PanelCoords, cell: Cell): { outer: V4; inner: V4 } {
  const cl = cos(latOf(c.p.y));
  const q = toBasin(c.p, cell.centre, cell.cosB, cell.rot);
  return {
    outer: vec4(c.p.x.sub(cell.lo.x).mul(cl), cell.hi.x.sub(c.p.x).mul(cl), c.p.y.sub(cell.lo.y), cell.hi.y.sub(c.p.y)) as unknown as V4,
    inner: vec4(q.x.sub(cell.ilo.x), cell.ihi.x.sub(q.x), q.y.sub(cell.ilo.y), cell.ihi.y.sub(q.y)) as unknown as V4,
  };
}

/** Footprints (arc units) of the basin frame's two coordinates, from those of longitude (fpX) and latitude (fpY) arcs. */
export function basinFootprints(cell: Cell, fpX: F, fpY: F): V2 {
  const cx = cell.rot.x.mul(fpX);
  const sx = cell.rot.y.mul(fpX);
  const cy = cell.rot.x.mul(fpY);
  const sy = cell.rot.y.mul(fpY);
  return vec2(sqrt(cx.mul(cx).add(sy.mul(sy))), sqrt(sx.mul(sx).add(cy.mul(cy)))) as unknown as V2;
}

type Axis = 'x' | 'y' | 'z' | 'w';
const AXES: Axis[] = ['x', 'y', 'z', 'w'];

/**
 * Profile of a channel of half-width hw across signed distance d from its line: 1 on the floor, 0
 * on the face, bevelled walls. It is symmetric about the line, so it holds on the far side of a
 * cell's bounding line too (relief.ts marches a short way past it in the same cell).
 */
function channelProfile(d: F, hw: F): F {
  const w = max(hw, 1e-7);
  return float(1).sub(smoothstep(w.mul(0.55), w, abs(d))).mul(step(1e-7, hw));
}

/** Channels narrower than about a pixel are shading, not relief (surfaces.ts draws them). */
function reliefFade(hw: F, fp: F): F {
  const w = max(hw, 1e-7);
  return float(1).sub(smoothstep(w.mul(1.2), w.mul(3.0), fp)).mul(step(1e-7, hw));
}

/** The deepest channel at a point: its depth below the face, and the bounding line it belongs to. */
export interface ChannelAt {
  depth: F;
  /** Half-width and distance from the line of the channel the point is in (or nearest). */
  hw: F;
  dist: F;
}

/**
 * Channels and inlet sumps of one rectangle of lines (d: distances, S: sizes): the depth of the
 * deepest channel, plus pits where a smaller line ends on a larger one, centred on the smaller line
 * at the larger channel's edge, within its near half (so a pit never crosses its centreline).
 */
function rectRelief(d: V4, S: V4, fp: F): { depth: F; near: ChannelAt } {
  const hw = vec4(channelHalfWidth(S.x), channelHalfWidth(S.y), channelHalfWidth(S.z), channelHalfWidth(S.w));
  const dep = vec4(channelDepth(S.x), channelDepth(S.y), channelDepth(S.z), channelDepth(S.w));
  const ch = AXES.map((i) => channelProfile(d[i], hw[i]).mul(dep[i]).mul(reliefFade(hw[i], fp)));
  const depth = max(max(ch[0], ch[1]), max(ch[2], ch[3]));
  const corner = (ix: 'x' | 'y', iy: 'z' | 'w', sxSign: number, sySign: number) => {
    const trunkX = S[ix].greaterThan(S[iy]);
    const hwT = select(trunkX, hw[ix], hw[iy]);
    const depT = select(trunkX, dep[ix], dep[iy]);
    const ox = d[ix].mul(sxSign).sub(select(trunkX, hwT.mul(0.9 * sxSign), float(0)));
    const oy = d[iy].mul(sySign).sub(select(trunkX, float(0), hwT.mul(0.9 * sySign)));
    const both = step(1e-7, min(hw[ix], hw[iy]));
    const r = max(hwT, 1e-7).mul(0.9);
    return float(1).sub(smoothstep(r.mul(0.45), r, vec2(ox, oy).length())).mul(depT).mul(DISTRICTS.sump).mul(both).mul(reliefFade(hwT, fp));
  };
  const sump = max(max(corner('x', 'z', 1, 1), corner('y', 'z', -1, 1)), max(corner('x', 'w', 1, -1), corner('y', 'w', -1, -1)));
  const a = abs(d);
  const nearX = min(a.x, a.y);
  const nearY = min(a.z, a.w);
  const hwX = select(a.x.lessThan(a.y), hw.x, hw.y);
  const hwY = select(a.z.lessThan(a.w), hw.z, hw.w);
  const useX = nearX.sub(hwX).lessThan(nearY.sub(hwY));
  return { depth: depth.add(sump), near: { depth, hw: select(useX, hwX, hwY), dist: select(useX, nearX, nearY) } };
}

/**
 * Depth below the collector face at c.p inside a relief-level cell: channels along its bounding
 * lines, inlet sumps, and the cell's own shallow field step. Channels narrower than a few pixels at
 * footprint `fp` are not cut.
 */
export function reliefDepthIn(c: PanelCoords, cell: Cell, fp: F): { depth: F; channel: ChannelAt } {
  const d = sideDistances(c, cell);
  const o = rectRelief(d.outer, cell.side, fp);
  const i = rectRelief(d.inner, cell.iside, fp);
  const depth = max(o.depth, i.depth);
  // The field steps only between channels: inside one, its floor is the same from both sides.
  const field = cell.hash.z.mul(DISTRICTS.fieldStep);
  const useO = o.near.dist.sub(o.near.hw).lessThan(i.near.dist.sub(i.near.hw));
  return {
    depth: max(depth, field),
    channel: { depth: max(o.near.depth, i.near.depth), hw: select(useO, o.near.hw, i.near.hw), dist: select(useO, o.near.dist, i.near.dist) },
  };
}

/** What shading needs of a district (the leaf cell of a full descent). */
export interface District {
  cell: Cell;
  /** Coverage of the bounding channels under the pixel and the heat they carry (coverage × relative rise). */
  channel: F;
  channelHeat: F;
  /** Flow in the basin frame: 1 when the district drains along its x, and the position along it (0 far end, 1 at the drain). */
  flowX: F;
  flowPos: F;
  /** Footprints of the basin frame's coordinates. */
  fpQ: V2;
}

/** Coverage of a channel's floor (half-width hw, line at distance d), fading to its mean when unresolved. */
function floorCover(d: F, hw: F, fp: F): F {
  return lineCoverage(d, max(hw, 1e-7).mul(0.8), fp).mul(step(1e-7, hw));
}

/**
 * The district at c.p, with its channel coverage filtered by the footprints of the two coordinates
 * (fpX along longitude, fpY along latitude; arc units).
 */
export function district(c: PanelCoords, fpX: F, fpY: F): District {
  const cell = descend(c, DISTRICTS.levels);
  const d = sideDistances(c, cell);
  const fpQ = basinFootprints(cell, fpX, fpY);
  const cover = (dist: V4, S: V4, fx: F, fy: F) =>
    AXES.map((i, k) => {
      const cov = floorCover(dist[i], channelHalfWidth(S[i]), k < 2 ? fx : fy);
      return { cov, heat: cov.mul(channelHeat(S[i])) };
    });
  const all = [...cover(d.outer, cell.side, fpX, fpY), ...cover(d.inner, cell.iside, fpQ.x, fpQ.y)];
  const channel = all.map((a) => a.cov).reduce((a, b) => max(a, b));
  const heat = all.map((a) => a.heat).reduce((a, b) => max(a, b));
  // Drain: the district's largest bounding line in the basin's network.
  const S = cell.iside;
  const flowX = select(max(S.x, S.y).greaterThanEqual(max(S.z, S.w)), float(1), float(0));
  const toHi = select(flowX.greaterThan(0.5), S.y.greaterThan(S.x), S.w.greaterThan(S.z));
  const fx = flowX.greaterThan(0.5);
  const along = select(fx, cell.ihi.x.sub(cell.ilo.x), cell.ihi.y.sub(cell.ilo.y));
  const u = select(fx, d.inner.x, d.inner.z).div(max(along, 1e-6)).clamp(0, 1);
  return { cell, channel, channelHeat: heat, flowX, flowPos: select(toHi, u, u.oneMinus()), fpQ };
}

/** An assembly of a district: a segment of a strip laid along its flow. */
export interface Assembly {
  /** Coordinates to plate in: arc units in the basin frame from the district's corner. */
  a: V2;
  origin: V2;
  size: V2;
  hash: V3;
  /** Coverage of the joints between assemblies. */
  joint: F;
  /** Strip parity and hash (finish patterns run in strips), and the district's packing hash. */
  stripOdd: F;
  stripHash: V3;
  pack: V3;
}

/**
 * The assembly at c.p in district `dist`: strips run along the flow, their width and segment length
 * set per district (its packing), segments staggered in some districts, aligned in others.
 */
export function assembly(c: PanelCoords, dist: District): Assembly {
  const D = DISTRICTS;
  const cell = dist.cell;
  const a = sideDistances(c, cell).inner.xz;
  const pack = hash33(vec3(floor(cell.hash.xy.mul(65536.0)), c.seed.add(911.0)));
  const fx = dist.flowX.greaterThan(0.5);
  const along = select(fx, a.x, a.y);
  const across = select(fx, a.y, a.x);
  const fpAlong = select(fx, dist.fpQ.x, dist.fpQ.y);
  const fpAcross = select(fx, dist.fpQ.y, dist.fpQ.x);
  const width = mix(float(D.stripMin), float(D.stripMax), pack.x);
  const length = width.mul(mix(float(D.segmentMin), float(D.segmentMax), pack.y));
  const strip = floor(across.div(width));
  const key = floor(pack.z.mul(4096.0));
  const sh = hash33(vec3(strip, key, c.seed.add(917.0)));
  // Brick-staggered segments in about half the districts.
  const offset = select(pack.z.lessThan(0.5), sh.x.mul(length), float(0));
  const seg = floor(along.add(offset).div(length));
  const h = hash33(vec3(seg, strip.add(key.mul(1024.0)), c.seed.add(919.0)));
  const oAlong = seg.mul(length).sub(offset);
  const oAcross = strip.mul(width);
  const origin = select(fx, vec2(oAlong, oAcross), vec2(oAcross, oAlong));
  const size = select(fx, vec2(length, width), vec2(width, length));
  const dAlong = min(along.sub(oAlong), oAlong.add(length).sub(along));
  const dAcross = min(across.sub(oAcross), oAcross.add(width).sub(across));
  const joint = max(lineCoverage(dAlong, D.jointHalf, fpAlong), lineCoverage(dAcross, D.jointHalf, fpAcross));
  const odd = strip.sub(floor(strip.mul(0.5)).mul(2.0));
  return { a: a as unknown as V2, origin: origin as unknown as V2, size: size as unknown as V2, hash: h, joint, stripOdd: odd, stripHash: sh, pack };
}

/** The panel point of a frame-coordinate shell direction, given its panel field (trace.ts). */
export function panelCoords(lon: F, absLat: F, lon0: F, lonSpan: F, seed: F): PanelCoords {
  const dl = lon.sub(lon0);
  // Wrapped to (−π, π] about the panel's bound: it may straddle atan's cut at ±π.
  const wrapped = dl.sub(floor(dl.add(Math.PI).div(Math.PI * 2)).mul(Math.PI * 2));
  return { p: vec2(wrapped, absLat.sub(STRUCTURE.panelLow)) as unknown as V2, ext: vec2(lonSpan, STRUCTURE.panelHigh - STRUCTURE.panelLow) as unknown as V2, seed };
}

/** Seed of a panel cell (trace.ts PanelField.cell). */
export function panelSeed(cell: V3): F {
  return cell.z.mul(7.0).add(cell.x.mul(31.0)).add(cell.y.mul(3.0));
}

/**
 * Regional character of a manifold basin (an installation of one era and load): the share of its
 * districts plated satin, and its load as a relative temperature offset.
 */
export function basinCharacter(basin: V3): { satin: F; heat: F } {
  return { satin: mix(float(0.1), float(0.65), basin.y), heat: basin.x.sub(0.5).mul(0.05) };
}

/**
 * The kinds of district a basin holds, by a district's own hash u: satin fields, striped fields
 * (strips alternating polished and satin along the flow), and polished fields.
 */
export const DISTRICT_KINDS = {
  /** Share of satin fields per unit of the basin's satin character, and of striped fields. */
  satinPerShare: 0.7,
  striped: 0.25,
} as const;
