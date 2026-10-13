/**
 * Mirror plating of the shell's inner face.
 *
 *   module (flat frame, a few degrees)  →  tiles (the visible mosaic)  →  mirrors (sub-pixel)
 *
 * A module is a flat frame, so across it the mean normal stays that of its centre while the
 * sphere's turns: relative to the local radial direction a module tilts by the offset from its
 * centre. Each tile in it is a mount carrying thousands of lightweight membrane mirrors; the mount is
 * set with its own orientation error, so neighbouring tiles show different pieces of the enclosure —
 * the mosaic of any real field of mirrors — and is gently domed, so each tile carries a smooth
 * highlight. Actively trimmed tiles (heliostats) carry larger tilts. The mirrors themselves are
 * individually below a pixel at every distance; each is set and pillowed on its own.
 *
 * Resolved tiles shade per pixel with their pillow normal. When a pixel covers N tiles, it does not
 * collapse to the field's average: the N tiles under it are a sample, so their mean tilt deviates
 * by σ/√N and their mix of finishes varies binomially. Those statistics are drawn per world-anchored
 * cell at the pixel's level of detail (2^k tiles on a side, blended across k), and the rest of the
 * spread folds into the reflection lobe. Distant plating therefore keeps the fine, stable shimmer
 * of countless pieces — a primary cue of its scale — and the mean stays exact with no aliasing.
 *
 * Units: arc length in shell radii (1 ≈ 984,000 km), which equals radians of normal rotation.
 */
import { float, vec3, floor, fract, smoothstep, max, min, abs, sqrt, normalize, dot, length, select, step, mix, log2, exp2 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { hash33 } from '../../render/tsl/noise';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

export interface PlatingSpec {
  /**
   * Irregular hierarchy above the module: divisions start at moduleSize·2^splitUp and split into
   * quarters with the given chance at each level, down to moduleSize/2 (splitChance has splitUp + 1
   * entries). Leaves are the flat facets; seams widen with the division they bound.
   */
  splitUp: number;
  splitChance: readonly number[];
  /**
   * Tiles within each facet: the facet splits into quarters with the given chance at each level, so
   * tiles come in a power-law spread of sizes (one finish, set error and dome per tile) — a
   * patchwork with no single countable size, like any field seen from orbit.
   */
  tileSplit: readonly number[];
  /** Mirrors per tile side (each set and pillowed on its own; individually sub-pixel), and their normal spread (1σ, radians). */
  mirrors: number;
  mirrorSigma: number;
  /** Share of mirrors with failed actuators, pointing anywhere within ±rogueTilt (radians). */
  rogueShare: number;
  rogueTilt: number;
  /** Pillow: maximum normal sweep across a tile (radians, at its edges). */
  pillow: number;
  /** Module set error (1σ, radians). */
  moduleSigma: number;
  /** Tile set error (1σ, radians); actively trimmed tiles: share and spread. */
  tileSigma: number;
  activeShare: number;
  activeSigma: number;
  /** Seam widths as a fraction of the cell: tile gaps and module mullions. */
  tileSeam: number;
  mullion: number;
}

export interface PlatingSample {
  /** Shading normal: module facet, tile set error and pillow (when tiles are resolved). */
  normal: V3;
  /** Module facet normal only (used for the unresolved-tile mixture). */
  facetNormal: V3;
  /** Unresolved normal spread under the pixel (σ, radians). */
  spread: F;
  /** Spread within a tile (its pillow ⊕ the unresolved mirrors), for the mixture. */
  pillowSigma: F;
  /** 1 where individual tiles are resolved, 0 where a pixel covers several. */
  tileResolved: F;
  /** 1 on an actively trimmed tile. */
  active: F;
  /**
   * A rogue mirror in this pixel's cell: its normal, and its weight (mirror area / cell area, 0 when
   * the cell holds none). Rogue mirrors point anywhere; those that mirror the star toward the viewer
   * are point glints at the star's own radiance.
   */
  rogueNormal: V3;
  rogueWeight: F;
  /** Unresolved tiles: module facet normal tilted by the mean set error of the tiles under the pixel. */
  sampleNormal: V3;
  /** Share of the tile set-error variance still unresolved within the sample (1 − 1/N). */
  sampleKeep: F;
  /** Installation blocks under the pixel (N) and a per-sample hash for its finish mix. */
  sampleCount: F;
  sampleHash: V3;
  tileHash: V3;
  /** Hash of the tile's installation block: its finish and whether it is actively trimmed. */
  blockHash: V3;
  moduleHash: V3;
  moduleId: V2;
  /** Centre of the leaf division (arc coordinates), for fields that must follow its edges. */
  leafCentre: V2;
  /** Position within the tile (−1..1) and within the leaf facet (0..1). */
  tileLocal: V2;
  facetLocal: V2;
  /** Tile size (arc units), for footprint tests of tile-scale detail. */
  tileSize: V2;
  /** Coverage of tile gaps and of module mullions (footprint-filtered, fading to their mean). */
  seam: F;
  mullion: F;
}

const SQRT12 = Math.sqrt(12);

/** Coverage of grid lines of period P and width w at coordinate x, fading to w/P when unresolved. */
export function gridLines(x: F, P: F, w: F, footprint: F): F {
  const d = abs(fract(x.div(P)).sub(0.5)).mul(P).negate().add(P.mul(0.5));
  const e = max(footprint, w.mul(0.25));
  const sharp = float(1).sub(smoothstep(w.mul(0.5).sub(e.mul(0.5)), w.mul(0.5).add(e.mul(0.5)), d)).mul(min(w.div(max(footprint, 1e-9)), 1.0));
  return sharp.add(w.div(P).sub(sharp).mul(smoothstep(P.mul(0.2), P.mul(0.6), footprint)));
}

/**
 * 1 while cells of size `size` span more than about a pixel, 0 once a pixel covers several. Cells of
 * one to a few pixels stay individual (temporal AA supersamples them, keeping the real
 * pixel-to-pixel variance of a mosaic); only finer cells collapse to their statistics.
 */
export function resolved(size: F, footprint: F): F {
  return float(1).sub(smoothstep(size.mul(0.8), size.mul(2.5), footprint));
}

/**
 * Pixel footprint of a surface coordinate whose gradient is the unit tangent `g`, on a surface of
 * normal `n` seen along `d` at distance `t` (pixel angle `pixelAngle`). Exact for any orientation:
 * a coordinate running along the view is foreshortened, one across it is not.
 */
export function axisFootprint(g: V3, n: V3, d: V3, t: F, pixelAngle: F): F {
  const dn = dot(d, n);
  const safe = select(abs(dn).lessThan(0.02), select(dn.lessThan(0.0), float(-0.02), float(0.02)), dn);
  const v = g.sub(n.mul(dot(g, d).div(safe)));
  const perp = v.sub(d.mul(dot(v, d)));
  return length(perp).mul(pixelAngle).mul(t).max(1e-9);
}

/**
 * Plating at arc coordinates `a` (along tU, tV) with module size `moduleSize`. `n0` is the macro
 * normal, `fp` the pixel footprints of the two coordinates, `seed` decorrelates surfaces.
 */
export function plating(a: V2, moduleSize: V2, tU: V3, tV: V3, n0: V3, fp: V2, spec: PlatingSpec, seed: F): PlatingSample {
  const footprint = max(fp.x, fp.y);
  // Irregular divisions (quadtree): the leaf containing `a`, and seams at every level it splits.
  let size: V2 = moduleSize.mul(2 ** spec.splitUp) as unknown as V2;
  const leafSize = size.toVar();
  const leafHash = hash33(vec3(floor(a.div(size)), seed.add(500.0))).toVar();
  const alive = float(1).toVar();
  let mullion: F = gridLines(a.x, size.x, size.x.mul(spec.mullion), fp.x).max(gridLines(a.y, size.y, size.y.mul(spec.mullion), fp.y));
  spec.splitChance.forEach((chance, i) => {
    const split = alive.mul(step(leafHash.x, chance));
    const child = size.mul(0.5) as unknown as V2;
    const childHash = hash33(vec3(floor(a.div(child)), seed.add(501.0 + i)));
    leafSize.assign(mix(leafSize, child, split));
    leafHash.assign(mix(leafHash, childHash, split));
    alive.assign(split);
    mullion = max(mullion, max(gridLines(a.x, child.x, child.x.mul(spec.mullion), fp.x), gridLines(a.y, child.y, child.y.mul(spec.mullion), fp.y)).mul(split));
    size = child;
  });
  const mId = floor(a.div(leafSize));
  const mUV = fract(a.div(leafSize));
  // Leaf frame: normal of its centre = local normal + offset from the centre (radians).
  const off = mUV.sub(0.5).mul(leafSize);
  const mh = leafHash;
  const facetTilt = off.add(mh.xy.sub(0.5).mul(SQRT12 * spec.moduleSigma));

  const finest = moduleSize.mul(2 ** (spec.splitUp - spec.splitChance.length - spec.tileSplit.length)) as unknown as V2;
  // Tiles: a second irregular quadtree inside the facet.
  const tileSize = leafSize.toVar();
  const th = hash33(vec3(mId, seed.add(17.0))).toVar();
  const alive2 = float(1).toVar();
  let tsize: V2 = leafSize as unknown as V2;
  let seam: F = float(0);
  spec.tileSplit.forEach((chance, j) => {
    const split = alive2.mul(step(th.x, chance));
    const child = tsize.mul(0.5) as unknown as V2;
    const childHash = hash33(vec3(floor(a.div(child)), seed.add(601.0 + j)));
    tileSize.assign(mix(tileSize, child, split));
    th.assign(mix(th, childHash, split));
    alive2.assign(split);
    seam = max(seam, max(gridLines(a.x, child.x, child.x.mul(spec.tileSeam), fp.x), gridLines(a.y, child.y, child.y.mul(spec.tileSeam), fp.y)).mul(split));
    tsize = child;
  });
  const local = fract(a.div(tileSize)).mul(2).sub(1);
  const rT = resolved(min(tileSize.x, tileSize.y), footprint);
  const bh = hash33(th.mul(97.0).add(seed));
  const active = step(bh.z, spec.activeShare);
  const tileSigma = mix(float(spec.tileSigma), float(spec.activeSigma), active);
  const setError = th.xy.sub(0.5).mul(SQRT12).mul(tileSigma);
  // Pillow: a shallow dome bulging toward the star; its normal leans outward from the tile centre.
  const pillow = local.mul(spec.pillow);
  // Mirrors within the tile: the mean tilt of those under the pixel (σ/√N, world-anchored cells).
  const mirrorSize = finest.div(spec.mirrors);
  const mlod = log2(max(footprint.div(min(mirrorSize.x, mirrorSize.y)), 1.0));
  const mk0 = floor(mlod);
  const mkf = fract(mlod);
  const mirrorAt = (k: F) => hash33(vec3(floor(a.div(mirrorSize.mul(exp2(k)))), seed.add(k.mul(7.0)).add(211.0)));
  const mDev = mix(mirrorAt(mk0).xy.sub(0.5).div(exp2(mk0)), mirrorAt(mk0.add(1.0)).xy.sub(0.5).div(exp2(mk0.add(1.0))), mkf).mul(SQRT12 * spec.mirrorSigma);
  const mirrorKeep = float(1).sub(float(1).div(exp2(mlod.mul(2.0))));
  // Rogue mirrors: cells of 4^k mirrors at most a pixel across (k = floor of the mirror LOD); each
  // holds one rogue with probability min(q·4^k, 1), covering 4^−k of the cell, so the mean is q.
  const cellCount = exp2(mk0.mul(2.0));
  const rh = hash33(vec3(floor(a.div(mirrorSize.mul(exp2(mk0)))), seed.add(mk0.mul(11.0)).add(401.0)));
  const rogueP = min(cellCount.mul(spec.rogueShare), 1.0);
  const rogueWeight = select(rh.x.lessThan(rogueP), cellCount.mul(spec.rogueShare).div(rogueP).div(cellCount), float(0));
  const rTilt = rh.yz.sub(0.5).mul(2 * spec.rogueTilt);
  const rogueNormal = normalize(n0.add(tU.mul(facetTilt.x.add(rTilt.x))).add(tV.mul(facetTilt.y.add(rTilt.y))));
  const tilt = facetTilt.add(setError.add(pillow).mul(rT)).add(mDev);
  const normal = normalize(n0.add(tU.mul(tilt.x)).add(tV.mul(tilt.y)));
  const facetNormal = normalize(n0.add(tU.mul(facetTilt.x)).add(tV.mul(facetTilt.y)));
  // Sample statistics of the tiles under a pixel (see header), on the finest tile lattice.
  const tileMin = min(finest.x, finest.y);
  const lod = log2(max(footprint.div(tileMin), 1.0));
  const k0 = floor(lod);
  const kf = fract(lod);
  const meanSigma = Math.sqrt((1 - spec.activeShare) * spec.tileSigma ** 2 + spec.activeShare * spec.activeSigma ** 2);
  const sampleAt = (k: F) => {
    const scale = exp2(k);
    return hash33(vec3(floor(a.div(finest.mul(scale))), seed.add(k.mul(13.0)).add(101.0)));
  };
  const h0 = sampleAt(k0);
  const h1 = sampleAt(k0.add(1.0));
  const sTilt = mix(h0.xy.div(exp2(k0)), h1.xy.div(exp2(k0.add(1.0))), kf).sub(mix(float(0.5).div(exp2(k0)), float(0.5).div(exp2(k0.add(1.0))), kf)).mul(SQRT12 * meanSigma);
  const sampleNormal = normalize(n0.add(tU.mul(facetTilt.x.add(sTilt.x).add(mDev.x))).add(tV.mul(facetTilt.y.add(sTilt.y).add(mDev.y))));
  // Finishes are per tile, and tiles average several finest cells: fewer independent draws.
  const count = max(exp2(lod.mul(2.0)).div(4.0), 1.0);
  // A uniform sweep of ±δ has σ = δ/√3.
  const pillowSigma = float(spec.pillow / Math.sqrt(3));
  const mirrorSpread2 = mirrorKeep.mul(spec.mirrorSigma * spec.mirrorSigma);


  return {
    normal,
    facetNormal,
    spread: sqrt(tileSigma.mul(tileSigma).add(pillowSigma.mul(pillowSigma)).mul(rT.oneMinus()).add(mirrorSpread2)),
    pillowSigma: sqrt(pillowSigma.mul(pillowSigma).add(mirrorSpread2)),
    tileResolved: rT,
    active,
    rogueNormal,
    rogueWeight,
    sampleNormal,
    sampleKeep: float(1).sub(float(1).div(exp2(lod.mul(2.0)))),
    sampleCount: count,
    sampleHash: mix(h0, h1, step(0.5, kf)),
    tileHash: th,
    blockHash: bh,
    moduleHash: mh,
    moduleId: mId,
    leafCentre: mId.add(0.5).mul(leafSize) as unknown as V2,
    tileLocal: local as unknown as V2,
    facetLocal: mUV as unknown as V2,
    tileSize: tileSize as unknown as V2,
    seam,
    mullion,
  };
}

/** Unit vector toward increasing longitude at shell direction qn (sphere frame, observer frame axes). */
export function eastAt(qn: V3): V3 {
  return normalize(vec3(qn.y.negate(), qn.x, 0).add(vec3(1e-6, 0, 0)));
}

/** Unit vector toward the north pole (−Z) along the surface at qn. */
export function northAt(qn: V3): V3 {
  return normalize(vec3(0, 0, -1).add(qn.mul(qn.z)));
}
