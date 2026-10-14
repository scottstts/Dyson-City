/**
 * Mirror plating of the shell's inner face.
 *
 *   assembly (a division of the surface)  →  tiles (the visible mosaic)  →  mirrors (sub-pixel)
 *
 * The divisions are laid out by each surface (quadDivisions for girder and hub decks, districts.ts
 * for the collectors, courses.ts for the band); this module plates one division. A division is
 * built to the shell's curve and set as a unit with its own orientation error; only small ones
 * (up to `flatMax`) are flat frames whose normal stays that of their centre while the sphere's
 * turns. (A flat frame of 330,000 km would sag 13,500 km from the shell and tilt ±9° at its edges:
 * whole regions shaded like single panes of glass.) Each tile in a division is a mount carrying
 * thousands of lightweight membrane mirrors; the mount is set with its own orientation error, so
 * neighbouring tiles show different pieces of the enclosure — the mosaic of any real field of
 * mirrors — and is gently domed, so each tile carries a smooth highlight. Actively trimmed tiles
 * (heliostats) carry larger tilts. The mirrors themselves are individually below a pixel at every
 * distance; each is set and pillowed on its own.
 *
 * Resolved tiles shade per pixel with their pillow normal. When a pixel covers N tiles, it does not
 * collapse to the field's average: the N tiles under it are a sample, so their mean tilt deviates
 * by σ/√N and their mix of finishes varies binomially. Those statistics are drawn per world-anchored
 * cell at the pixel's level of detail, and the rest of the spread folds into the reflection lobe.
 * The footprint is kept per axis: the shell is seen at a grazing angle equal to its elevation, so a
 * pixel's footprint is ~1/sin(e) times longer along the view than across it (6:1 at 10°). Cells
 * follow that shape (2^kx × 2^ky tiles, blended in both), and N is the footprint's area, not the
 * square of its longest side: detail stays resolved across the view where it is lost along it, and
 * the low sky keeps tightly compressed, directional complexity instead of a softened mosaic.
 * Assemblies below a pixel join the sample the same way (their set errors average as σ/√M).
 *
 * Units: arc length in shell radii (1 ≈ 984,000 km), which equals radians of normal rotation.
 */
import { float, vec2, vec3, floor, fract, smoothstep, max, min, abs, sqrt, normalize, dot, length, select, step, mix, log2, exp2 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { hash33 } from '../../render/tsl/noise';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

export interface PlatingSpec {
  /**
   * Tiles within each division: it splits into quarters with the given chance at each level, so
   * tiles come in a power-law spread of sizes (one finish, set error and dome per tile) — a
   * patchwork with no single countable size, like any field seen from orbit.
   */
  tileSplit: readonly number[];
  /** Mirrors per finest tile side (each set and pillowed on its own; individually sub-pixel), and their normal spread (1σ, radians). */
  mirrors: number;
  mirrorSigma: number;
  /** Share of mirrors with failed actuators, pointing anywhere within ±rogueTilt (radians). */
  rogueShare: number;
  rogueTilt: number;
  /** Pillow: maximum normal sweep across a tile (radians, at its edges). */
  pillow: number;
  /** Division (assembly) set error (1σ, radians). */
  moduleSigma: number;
  /** Tile set error (1σ, radians); actively trimmed tiles: share and spread. */
  tileSigma: number;
  activeShare: number;
  activeSigma: number;
  /** Tile gap width as a fraction of the tile. */
  tileSeam: number;
  /** Largest flat frame (arc units): larger divisions follow the shell's curve. */
  flatMax: number;
}

/** One division of a plated surface: the assembly a point lies in. */
export interface Division {
  /** Lower corner (in the plated coordinates) and size. */
  origin: V2;
  size: V2;
  hash: V3;
  /** Coverage of the division's own joints (footprint-filtered, fading to their mean). */
  mullion: F;
}

export interface PlatingSample {
  /** Shading normal: division, tile set error and pillow (when tiles are resolved). */
  normal: V3;
  /** Division normal only. */
  facetNormal: V3;
  /** Unresolved normal spread under the pixel (σ, radians). */
  spread: F;
  /** Spread within the sample apart from the finishes' own (pillows, unresolved mirrors and assemblies), for the mixture. */
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
  /** Unresolved tiles: division normal tilted by the mean set error of the tiles under the pixel. */
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
  /** Position within the tile (−1..1) and within the division (0..1). */
  tileLocal: V2;
  facetLocal: V2;
  /** Tile size (arc units), for footprint tests of tile-scale detail. */
  tileSize: V2;
  /** Coverage of tile gaps and of division joints (footprint-filtered, fading to their mean). */
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

/** Coverage of a line of half-width hw at signed distance x, filtered by the pixel footprint. */
export function lineCoverage(x: F, hw: F | number, footprint: F): F {
  const w: F = typeof hw === 'number' ? float(hw) : hw;
  const edge = max(footprint, w.mul(0.25));
  return float(1).sub(smoothstep(w.sub(edge.mul(0.5)), w.add(edge.mul(0.5)), abs(x))).mul(min(w.mul(2).div(max(footprint, 1e-9)), 1.0));
}

/**
 * 1 while cells of size `size` span more than about a pixel, 0 once a pixel covers several. Cells of
 * one to a few pixels stay individual (temporal AA supersamples them, keeping the real
 * pixel-to-pixel variance of a mosaic); only finer cells collapse to their statistics.
 */
export function resolved(size: F, footprint: F): F {
  return float(1).sub(smoothstep(size.mul(0.8), size.mul(2.5), footprint));
}

/** `resolved` per axis: a cell counts as resolved only when it is resolved both ways. */
export function resolved2(size: V2, fp: V2): F {
  return resolved(size.x, fp.x).mul(resolved(size.y, fp.y));
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

/** Quadtree divisions of a deck: a module lattice split into quarters level by level. */
export interface QuadSpec {
  /** Divisions start at moduleSize·2^splitUp and split into quarters with the given chance at each level (splitUp + 1 entries). */
  splitUp: number;
  splitChance: readonly number[];
  /** Joint width as a fraction of the division. */
  mullion: number;
}

/** The quadtree division containing `a`; joints widen with the division they bound. */
export function quadDivisions(a: V2, moduleSize: V2, spec: QuadSpec, fp: V2, seed: F): Division {
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
  return { origin: floor(a.div(leafSize)).mul(leafSize) as unknown as V2, size: leafSize as unknown as V2, hash: leafHash as unknown as V3, mullion };
}

/**
 * Plating at coordinates `a` (arc units along tU, tV) inside division `div`. `finest` is the
 * smallest tile (the lattice of the sample statistics), `n0` the macro normal, `fp` the pixel
 * footprints of the two coordinates, `seed` decorrelates surfaces. `baseTilt` (radians along tU, tV)
 * is a set error shared by a larger unit the division belongs to; `asmScale` scales the
 * division's own set error (a surface whose precision varies by region).
 */
export function plating(a: V2, div: Division, finest: V2, tU: V3, tV: V3, n0: V3, fp: V2, spec: PlatingSpec, seed: F, baseTilt?: V2, asmScale?: F): PlatingSample {
  const l = a.sub(div.origin);
  const mUV = l.div(div.size);
  const mh = div.hash;
  // The division: flat frames tilt by their offset from the centre; larger ones follow the curve.
  const flat = step(max(div.size.x, div.size.y), spec.flatMax);
  const off = mUV.sub(0.5).mul(div.size).mul(flat);
  const asmSigma: F = asmScale ? asmScale.mul(spec.moduleSigma) : float(spec.moduleSigma);
  const asmError = mh.xy.sub(0.5).mul(SQRT12).mul(asmSigma);
  const rA = resolved2(div.size, fp);
  const shared: V2 = (baseTilt ?? vec2(0, 0)) as V2;
  const facetTilt = off.add(shared).add(asmError.mul(rA));

  // Tiles: an irregular quadtree inside the division, keyed by the division.
  const key = floor(mh.mul(4096.0));
  const tileSize = div.size.toVar();
  const th = hash33(vec3(key.xy, seed.add(17.0).add(key.z))).toVar();
  const alive = float(1).toVar();
  let tsize: V2 = div.size;
  let seam: F = float(0);
  spec.tileSplit.forEach((chance, j) => {
    const split = alive.mul(step(th.x, chance));
    const child = tsize.mul(0.5) as unknown as V2;
    const childHash = hash33(vec3(floor(l.div(child)).add(key.xy.mul(64.0)), seed.add(601.0 + j).add(key.z)));
    tileSize.assign(mix(tileSize, child, split));
    th.assign(mix(th, childHash, split));
    alive.assign(split);
    seam = max(seam, max(gridLines(l.x, child.x, child.x.mul(spec.tileSeam), fp.x), gridLines(l.y, child.y, child.y.mul(spec.tileSeam), fp.y)).mul(split));
    tsize = child;
  });
  const local = fract(l.div(tileSize)).mul(2).sub(1);
  const rT = resolved2(tileSize as unknown as V2, fp);
  const bh = hash33(th.mul(97.0).add(seed));
  const active = step(bh.z, spec.activeShare);
  const tileSigma = mix(float(spec.tileSigma), float(spec.activeSigma), active);
  const setError = th.xy.sub(0.5).mul(SQRT12).mul(tileSigma);
  // Pillow: a shallow dome bulging toward the star; its normal leans outward from the tile centre.
  const pillow = local.mul(spec.pillow);

  // Mirrors within the tile: the mean tilt of those under the pixel (σ/√N, world-anchored cells).
  // Their deviation is a fraction of a degree, so isotropic cells at the footprint's mean suffice.
  const fpMean = sqrt(fp.x.mul(fp.y));
  const mirrorSize = finest.div(spec.mirrors);
  const mlod = log2(max(fpMean.div(min(mirrorSize.x, mirrorSize.y)), 1.0));
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

  // Sample statistics of the tiles under a pixel (see header): anisotropic cells of 2^kx × 2^ky
  // finest tiles, blended bilinearly across both levels.
  const lx = log2(max(fp.x.div(finest.x), 1.0));
  const ly = log2(max(fp.y.div(finest.y), 1.0));
  const kx = floor(lx);
  const ky = floor(ly);
  const fx = fract(lx);
  const fy = fract(ly);
  const meanSigma = Math.sqrt((1 - spec.activeShare) * spec.tileSigma ** 2 + spec.activeShare * spec.activeSigma ** 2);
  // Assemblies under the pixel (M) join the sample: their set errors average as σa/√M.
  const cellsPerAssembly = max(div.size.x.mul(div.size.y).div(finest.x.mul(finest.y)), 1.0);
  const asmVar = rA.oneMinus().mul(asmSigma.mul(asmSigma));
  const sampleAt = (dx: number, dy: number) => {
    const kxx = kx.add(dx);
    const kyy = ky.add(dy);
    const h = hash33(vec3(floor(a.x.div(finest.x.mul(exp2(kxx)))), floor(a.y.div(finest.y.mul(exp2(kyy)))), seed.add(kxx.mul(13.0)).add(kyy.mul(29.0)).add(101.0)));
    const n = exp2(kxx.add(kyy));
    const scale = sqrt(float(meanSigma * meanSigma).div(n).add(asmVar.mul(cellsPerAssembly).div(max(n, cellsPerAssembly))));
    return { h, dev: h.xy.sub(0.5).mul(scale) };
  };
  const s00 = sampleAt(0, 0);
  const s10 = sampleAt(1, 0);
  const s01 = sampleAt(0, 1);
  const s11 = sampleAt(1, 1);
  const sTilt = mix(mix(s00.dev, s10.dev, fx), mix(s01.dev, s11.dev, fx), fy).mul(SQRT12);
  const sampleHash = select(fy.lessThan(0.5), select(fx.lessThan(0.5), s00.h, s10.h), select(fx.lessThan(0.5), s01.h, s11.h));
  const sampleNormal = normalize(n0.add(tU.mul(facetTilt.x.add(sTilt.x).add(mDev.x))).add(tV.mul(facetTilt.y.add(sTilt.y).add(mDev.y))));
  // Finishes are per tile, and tiles average several finest cells: fewer independent draws.
  const lsum = lx.add(ly);
  const count = max(exp2(lsum).div(4.0), 1.0);
  // A uniform sweep of ±δ has σ = δ/√3.
  const pillowSigma = float(spec.pillow / Math.sqrt(3));
  const mirrorSpread2 = mirrorKeep.mul(spec.mirrorSigma * spec.mirrorSigma);
  // Assemblies under the pixel spread about the sample's mean by what their mean does not absorb.
  const asmSpread2 = asmVar.mul(float(1).sub(float(1).div(max(exp2(lsum).div(cellsPerAssembly), 1.0))));

  return {
    normal,
    facetNormal,
    spread: sqrt(tileSigma.mul(tileSigma).add(pillowSigma.mul(pillowSigma)).mul(rT.oneMinus()).add(mirrorSpread2).add(asmSpread2)),
    pillowSigma: sqrt(pillowSigma.mul(pillowSigma).add(mirrorSpread2).add(asmSpread2)),
    tileResolved: rT,
    active,
    rogueNormal,
    rogueWeight,
    sampleNormal,
    sampleKeep: float(1).sub(exp2(lsum.negate())),
    sampleCount: count,
    sampleHash,
    tileHash: th,
    blockHash: bh,
    moduleHash: mh,
    tileLocal: local as unknown as V2,
    facetLocal: mUV as unknown as V2,
    tileSize: tileSize as unknown as V2,
    seam,
    mullion: div.mullion,
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
