/**
 * Surfaces of the far structure: what each part is made of and how it is laid out. Lighting is in
 * shading.ts; the light transport these finishes take part in is solved in enclosure.ts.
 *
 *  - Collector panels: fields of aluminium mirror plating (plating.ts) — polished, satin and aged
 *    tiles — with clustered photovoltaic modules (dark glass). The mirrors are what make the shell
 *    a mosaic: each tile reflects its own piece of the enclosure, star near the limb, dark chains of
 *    reflections lower down.
 *  - Frames, rings, collars, hubs and the band's rims: brushed structural-steel girder decks with a
 *    recessed spine channel, chamfered edges and receiver lines; hub drums under a white ceramic
 *    thermal coating.
 *  - Receivers: absorber tubes at the focus of trough concentrators along every frame edge and hub
 *    rim. Concentrated starlight makes them several times brighter than the star's disc: the only
 *    "lights" that can show in this daylight (a lamp would be invisible).
 *  - The band (the Veil's top): mirror panes, rejecting the star's heat by reflection.
 *
 * Seen from 30,000–1,400,000 km, one pixel spans tens to thousands of km; every feature is
 * footprint-filtered to its mean before it can alias.
 */
import { float, vec2, vec3, vec4, If, dot, normalize, max, min, abs, floor, fract, smoothstep, mix, clamp, cos, select, atan, length, cross, step, sqrt } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { hash33, valueNoise3 } from '../../render/tsl/noise';
import { STRUCTURE } from './layout';
import { MAT, panelField, type StructureHit } from './trace';
import { plating, gridLines, resolved, eastAt, northAt, axisFootprint, type PlatingSpec } from './plating';
import { BLACK_CHROME, PLATE_DIFFUSE, STEEL_DIFFUSE, BLACK_STEEL, SURFACES } from './enclosure';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;
type V4 = Node<'vec4'>;

/**
 * The finishes a pixel can mix when its tiles are unresolved (shading.ts evaluates each with the
 * prefiltered enclosure): passive polished aluminium, actively trimmed (heliostat) polished
 * aluminium, photovoltaic cell glass (dark, single tiles among the mirrors), brushed structural
 * steel. `tilt` is each finish's normal spread.
 */
export const FINISHES = [
  { f0: BLACK_CHROME, roughness: 0.08, albedo: PLATE_DIFFUSE, tilt: 0.03, mirror: true },
  { f0: BLACK_CHROME, roughness: 0.08, albedo: PLATE_DIFFUSE, tilt: 0.08, mirror: true },
  { f0: SURFACES.pv.cls.f0, roughness: SURFACES.pv.cls.roughness, albedo: SURFACES.pv.cls.albedo, tilt: 0.006, mirror: true },
  { f0: BLACK_STEEL, roughness: 0.15, albedo: STEEL_DIFFUSE, tilt: 0.05, mirror: true },
] as const;

/** Share of each finish among the tiles of a mirror field and of a structural deck. */
const MIRROR_FIELD = vec4(0.72, 0.28, 0.0, 0.0);
/** Collector regions dense in heliostats, and in cell glass (see the panel block). */
const MODULE_HELIO = vec4(0.35, 0.65, 0.0, 0.0);
const MODULE_CELL = vec4(0.45, 0.1, 0.45, 0.0);
/** Girder deck sections: mirror-plated and dark radiator sections among the steel. */
const DECK_MIRROR = vec4(0.55, 0.2, 0.05, 0.2);
const DECK_RADIATOR = vec4(0.0, 0.0, 0.85, 0.15);
const STRUCTURAL_DECK = vec4(0.0, 0.0, 0.08, 0.92);

/**
 * Concentrated-light receivers fed by the heliostat fields: radiance relative to the star's disc
 * mean, C·ρ/2 with concentration C ≈ 300 and a selective absorber's visible reflectance ρ ≈ 0.08 —
 * far brighter than the star itself, as real solar-tower receivers are.
 */
export const RECEIVER_RADIANCE = 12;
/** A selective absorber reflects more red than blue, and the hot receiver adds a little glow. */
export const RECEIVER_TINT = [1.18, 0.98, 0.8] as const;

export interface SurfaceSample {
  /** The pixel's own finish (a resolved tile). */
  f0: V3;
  roughness: F;
  albedo: V3;
  normal: V3;
  /** Unresolved tilt spread under the pixel (σ, radians), folded into the lobe. */
  spread: F;
  /** Blend toward the finish mixture (1 where a pixel covers many tiles). */
  mix: F;
  mixWeights: V4;
  mixNormal: V3;
  mixSpread: F;
  /** Share of each finish's tile spread still unresolved within the sample under the pixel. */
  mixKeep: F;
  /** 1 for a mirror finish (Gaussian facet lobe), 0 for a rough one (GGX). */
  mirror: F;
  /** Rogue mirror under the pixel (plating.ts): normal and area weight. */
  rogueNormal: V3;
  rogueWeight: F;
  /** Emitted/concentrated radiance relative to the star's disc mean. */
  emission: F;
}

const MIRROR_PLATING: PlatingSpec = {
  splitUp: 2,
  splitChance: [0.85, 0.7, 0.35],
  tileSplit: [0.95, 0.8, 0.65, 0.5],
  mirrors: 8,
  mirrorSigma: 0.004,
  rogueShare: 0.002,
  rogueTilt: 0.7,
  pillow: 0.02,
  moduleSigma: 0.02,
  tileSigma: 0.03,
  activeShare: 0.25,
  activeSigma: 0.08,
  tileSeam: 0.04,
  mullion: 0.025,
};

const DECK_PLATING: PlatingSpec = {
  splitUp: 0,
  splitChance: [0],
  tileSplit: [1, 1],
  mirrors: 1,
  mirrorSigma: 0,
  rogueShare: 0,
  rogueTilt: 0,
  pillow: 0.03,
  moduleSigma: 0.003,
  tileSigma: 0.012,
  activeShare: 0,
  activeSigma: 0,
  tileSeam: 0.03,
  mullion: 0.04,
};

/** Coverage of a line of half-width hw at signed distance x, filtered by the pixel footprint. */
export function lineCoverage(x: F, hw: F | number, footprint: F): F {
  const w: F = typeof hw === 'number' ? float(hw) : hw;
  const edge = max(footprint, w.mul(0.25));
  return float(1).sub(smoothstep(w.sub(edge.mul(0.5)), w.add(edge.mul(0.5)), abs(x))).mul(min(w.mul(2).div(max(footprint, 1e-9)), 1.0));
}

/** Pixel footprint context of a surface hit (plating.ts axisFootprint). */
export interface Footprint {
  d: V3;
  t: F;
  pixelAngle: F;
  n: V3;
}

/** Footprint of a coordinate running along unit tangent g. */
function fpAlong(fp: Footprint, g: V3): F {
  return axisFootprint(g, fp.n, fp.d, fp.t, fp.pixelAngle);
}

/**
 * Receiver line: the absorbers each heliostat field concentrates onto. They are installations
 * hundreds to thousands of km long, so they never read as a row of lamps: one continuous luminous
 * line whose strength drifts (fed by fields in different states of tracking) over two octaves of
 * `scale` (arc units) with no period. Unresolved
 * stretches fade to their mean. `fpAcross`/`fpAlongLine` are the coordinates' footprints. Returns
 * radiance relative to the star's disc mean.
 */
function receiver(across: F, hw: number, along: F, scale: number, fpAcross: F, fpAlongLine: F, seed: F): F {
  const cover = lineCoverage(across, hw, fpAcross);
  const n1 = valueNoise3(vec3(along.div(scale), seed, 1.7));
  const n2 = valueNoise3(vec3(along.div(scale * 0.27), seed.add(5.3), 3.1));
  // Continuous: strength drifts along the line, never switching off like a row of lamps.
  const stretch = n1.mul(n1).mul(1.6).add(0.15).mul(n2.mul(0.6).add(0.7));
  const r = resolved(float(scale * 0.27), fpAlongLine);
  const lit = mix(float(0.75), stretch, r);
  return cover.mul(lit).mul(RECEIVER_RADIANCE);
}

/**
 * Picks a tile's finish from its hash given the field's shares (polished, heliostat, satin,
 * structural). The heliostat interval comes first so it matches plating.ts's active tiles.
 */
function pickFinish(h: F, w: V4): F {
  const c1 = w.y;
  const c2 = c1.add(w.x);
  const c3 = c2.add(w.z);
  return select(h.lessThan(c1), float(1), select(h.lessThan(c2), float(0), select(h.lessThan(c3), float(2), float(3))));
}

function finishF0(i: F): V3 {
  return select(i.lessThan(1.5), vec3(...BLACK_CHROME), select(i.lessThan(2.5), vec3(...FINISHES[2].f0), vec3(...BLACK_STEEL)));
}

function finishRoughness(i: F): F {
  return select(i.lessThan(1.5), float(FINISHES[0].roughness), select(i.lessThan(2.5), float(FINISHES[2].roughness), float(FINISHES[3].roughness)));
}

function finishAlbedo(i: F): V3 {
  return select(i.lessThan(1.5), vec3(...PLATE_DIFFUSE), select(i.lessThan(2.5), vec3(...FINISHES[2].albedo), vec3(...FINISHES[3].albedo)));
}

/**
 * Side faces of girders and hub drums, tens of thousands of km tall: black glossy metal walls with a
 * patchwork of panels at a power-law spread of sizes (two irregular quadtree levels), continuous
 * tonal variation at several scales, and recessed gallery decks whose heights change from one
 * irregular section of the wall to the next. No joints at a single spacing and no countable rhythm:
 * those read as masonry. `along`/`depth` in shell units, `height` 0..1 up the face.
 */
function sideFace(out: SurfaceSample, along: F, height: F, depth: F, fpAlongFace: F, fpUp: F, seed: F): void {
  const fpH = fpUp.div(depth);
  const uu = along.div(0.03).add(valueNoise3(vec3(along.div(0.09), seed, 7.0)).mul(0.7));
  const sec = hash33(vec3(floor(uu), seed, 71.0));
  const g1 = sec.x.mul(0.3).add(0.25);
  const g2 = g1.add(sec.y.mul(0.3).add(0.2));
  const deck = max(lineCoverage(height.sub(g1), 0.02, fpH), lineCoverage(height.sub(g2), 0.014, fpH).mul(step(0.35, sec.z)));
  // Panel patchwork: cells of 0.008 split once or twice, each with its own tone.
  const p = vec2(along, height.mul(depth));
  const c0 = hash33(vec3(floor(p.div(0.008)), seed.add(80.0)));
  const c1 = hash33(vec3(floor(p.div(0.004)), seed.add(81.0)));
  const c2 = hash33(vec3(floor(p.div(0.002)), seed.add(82.0)));
  const cell = select(c0.x.lessThan(0.6), select(c1.x.lessThan(0.5), c2, c1), c0);
  const fade = resolved(float(0.002), max(fpAlongFace, fpUp));
  const panelTone = mix(float(0.5), cell.y, fade);
  const broad = valueNoise3(vec3(along.div(0.05), height.mul(2.0), seed)).mul(0.6).add(valueNoise3(vec3(along.div(0.012), height.mul(6.0), seed.add(2.0))).mul(0.4));
  const tone = float(0.5).add(broad.mul(0.3)).add(panelTone.mul(0.16)).add(sec.z.mul(0.1));
  out.f0.assign(vec3(...BLACK_STEEL).mul(tone.mul(0.8).add(0.6)).mul(float(1).sub(deck.mul(0.6))));
  out.roughness.assign(mix(float(0.12).add(cell.z.mul(0.1)), float(0.4), deck));
  out.albedo.assign(vec3(...STEEL_DIFFUSE).mul(float(1).sub(deck.mul(0.5))));
  out.mixWeights.assign(vec4(0, 0, 0, 1));
}

export function structureSurface(hit: StructureHit, pos: V3, fpc: Footprint): SurfaceSample {
  const S = STRUCTURE;
  const q = pos.sub(vec3(0, 1, 0));
  const qn = normalize(q).toVar();
  const out: SurfaceSample = {
    f0: vec3(...BLACK_STEEL).toVar(),
    roughness: float(0.36).toVar(),
    albedo: vec3(...STEEL_DIFFUSE).toVar(),
    normal: hit.normal.toVar(),
    spread: float(0).toVar(),
    mix: float(0).toVar(),
    mixWeights: vec4(0, 0, 0, 1).toVar(),
    mixNormal: hit.normal.toVar(),
    mixSpread: float(0).toVar(),
    mixKeep: float(1).toVar(),
    mirror: float(0).toVar(),
    rogueNormal: hit.normal.toVar(),
    rogueWeight: float(0).toVar(),
    emission: float(0).toVar(),
  };

  /** Applies a plating sample with a field of finishes. */
  const applyPlating = (p: ReturnType<typeof plating>, field: V4, seamDark: number) => {
    const fin = pickFinish(p.blockHash.z, field);
    out.f0.assign(finishF0(fin).mul(float(1).sub(p.seam.mul(seamDark))));
    out.roughness.assign(mix(finishRoughness(fin).add(p.tileHash.x.sub(0.5).mul(0.04)), float(0.7), p.seam));
    // Coated tiles vary batch to batch in tone.
    out.albedo.assign(finishAlbedo(fin).mul(p.tileHash.y.mul(0.3).add(0.82)).mul(float(1).sub(p.seam)));
    out.normal.assign(p.normal);
    out.spread.assign(p.spread);
    out.mix.assign(p.tileResolved.oneMinus());
    // The finish mix of the N tiles under the pixel varies binomially about the field's shares.
    const n = max(p.sampleCount, 1.0);
    const dev = (w: F, h: F) => h.sub(0.5).mul(Math.sqrt(12)).mul(sqrt(w.mul(w.oneMinus()).div(n)));
    const helio = clamp(field.y.add(dev(field.y, p.sampleHash.y)), 0, 1);
    const cell = clamp(field.z.add(dev(field.z, p.sampleHash.z)), 0, float(1).sub(helio));
    const rest = float(1).sub(helio).sub(cell);
    const restShare = field.x.add(field.w).max(1e-4);
    out.mixWeights.assign(vec4(rest.mul(field.x).div(restShare), helio, cell, rest.mul(field.w).div(restShare)));
    out.mixNormal.assign(p.sampleNormal);
    out.mixSpread.assign(p.pillowSigma);
    out.mixKeep.assign(sqrt(p.sampleKeep));
    out.mirror.assign(float(1).sub(p.seam));
    out.rogueNormal.assign(p.rogueNormal);
    out.rogueWeight.assign(p.rogueWeight.mul(float(1).sub(p.seam)).mul(select(fin.lessThan(1.5), float(1), float(0))));
    // Brushed steel: its brushing spread rides on the tile's own.
    out.spread.assign(select(fin.greaterThan(2.5), sqrt(p.spread.mul(p.spread).add(FINISHES[3].tilt * FINISHES[3].tilt)), p.spread));
  };

  If(hit.mat.equal(MAT.frame), () => {
    // Box girders: plated top deck with a recessed spine channel, receiver lines near both edges
    // and chamfered edges; plated side faces.
    // Every member is a slab of the plane (axis, offset c) ∩ the layer: its centreline is a circle
    // of radius √(1 − c²); arc lengths across and along follow from that, for any member.
    const idx = hit.aux.z;
    const ringR = sqrt(max(float(1).sub(hit.size.z.mul(hit.size.z)), 0.04));
    const hw = hit.size.x.div(ringR);
    const depth = hit.size.y;
    const across = hit.aux.x.div(ringR);
    const alongDir = normalize(cross(hit.axis, qn));
    const acrossDir = normalize(hit.axis.sub(qn.mul(dot(hit.axis, qn))));
    const pe1 = normalize(cross(hit.axis, select(abs(hit.axis.z).lessThan(0.9), vec3(0, 0, 1), vec3(1, 0, 0))));
    const along = atan(dot(qn, cross(hit.axis, pe1)), dot(qn, pe1)).mul(ringR);
    const onTop = hit.aux.y.lessThan(0.5);
    const u = abs(across).div(hw);
    If(onTop, () => {
      const fA = fpAlong(fpc, alongDir);
      const fX = fpAlong(fpc, acrossDir);
      // Sections along the girder at two irregular scales (installations of different eras and
      // functions): a girder hundreds of thousands of km long is never one uniform deck.
      const section = (s: number, k: number) => {
        const uu = along.div(s).add(valueNoise3(vec3(along.div(s * 3), idx, k)).mul(0.7));
        return { id: floor(uu), d: min(fract(uu), fract(uu).oneMinus()).mul(s) };
      };
      const big = section(0.06, 1);
      const small = section(0.017, 2);
      const hb = hash33(vec3(big.id, idx, 61.0));
      const hs = hash33(vec3(small.id, idx, 67.0));
      const kind = hb.x.mul(0.7).add(hs.x.mul(0.3));
      const field = select(kind.lessThan(0.42), STRUCTURAL_DECK, select(kind.lessThan(0.66), DECK_MIRROR, select(kind.lessThan(0.82), DECK_RADIATOR, STRUCTURAL_DECK)));
      const p = plating(vec2(along, across) as unknown as V2, vec2(0.03, 0.03) as unknown as V2, alongDir, acrossDir, hit.normal, vec2(fA, fX) as unknown as V2, DECK_PLATING, idx.add(100.0));
      applyPlating(p, field, 0.7);
      const tone = hs.y.mul(0.3).add(0.82);
      out.f0.mulAssign(tone);
      out.albedo.mulAssign(tone);
      // Section joints and, in some sections, transverse cross-girders.
      const joints = max(lineCoverage(big.d, 0.0005, fA), lineCoverage(small.d, 0.00018, fA).mul(0.7));
      const ribbed = step(hs.z, 0.3).mul(gridLines(along, float(0.0026), float(0.0005), fA));
      const dark = max(joints, ribbed.mul(0.8));
      out.f0.assign(mix(out.f0, vec3(...BLACK_STEEL).mul(0.25), dark));
      out.albedo.assign(mix(out.albedo, vec3(0.01), dark));
      out.mix.mulAssign(dark.oneMinus());
      out.mirror.mulAssign(dark.oneMinus());
      // Spine channel: a recessed, darker trough along the centreline, its width set per section.
      const channel = lineCoverage(u, hb.y.mul(0.1).add(0.04), fX.div(hw));
      out.f0.assign(mix(out.f0, vec3(...BLACK_STEEL).mul(0.3), channel));
      out.roughness.assign(mix(out.roughness, float(0.55), channel));
      out.mirror.mulAssign(channel.oneMinus());
      out.rogueWeight.mulAssign(channel.oneMinus());
      // Chamfered edges catch the star: their normals lean outward across the girder.
      const chamfer = smoothstep(0.955, 0.985, u);
      out.normal.assign(normalize(mix(out.normal, normalize(hit.normal.add(acrossDir.mul(select(across.greaterThan(0.0), float(1), float(-1))))), chamfer.mul(0.8))));
      out.mix.mulAssign(chamfer.oneMinus());
      // Receiver lines near both edges.
      const rx = abs(across).sub(hw.mul(0.9));
      out.emission.assign(receiver(rx, 0.00028, along, 0.012, fX, fA, idx.add(across.greaterThan(0.0).select(float(0), float(31.0)))).mul(step(0.3, hb.z)).mul(joints.oneMinus()));
    }).Else(() => {
      const height = float(1).sub(length(q)).div(depth);
      sideFace(out, along, height, depth, fpAlong(fpc, alongDir), fpAlong(fpc, qn.negate()), idx);
      // The rounded top edge of the girder.
      const edge = smoothstep(0.96, 0.995, height);
      out.normal.assign(normalize(mix(out.normal, hit.normal.add(qn.negate()).normalize(), edge.mul(0.7))));
    });
  });

  If(hit.mat.equal(MAT.hub), () => {
    // Hubs: plated concentric terraces, radial spokes, a dark central shaft, receiver rings.
    const idx = hit.aux.z;
    const beta = hit.size.x;
    const r = hit.aux.x;
    const rArc = r.mul(beta);
    const axis = hit.axis;
    const e1 = normalize(cross(axis, select(abs(axis.z).lessThan(0.9), vec3(0, 0, 1), vec3(1, 0, 0))));
    const e2 = cross(axis, e1);
    const az = atan(dot(qn, e2), dot(qn, e1));
    const tangent = normalize(cross(axis, qn));
    const radial = normalize(qn.sub(axis.mul(dot(qn, axis))));
    const onTop = hit.aux.y.lessThan(0.5);
    If(onTop, () => {
      const fT = fpAlong(fpc, tangent);
      const fR = fpAlong(fpc, radial);
      const p = plating(vec2(az.mul(rArc), rArc) as unknown as V2, vec2(beta.mul(0.16), beta.mul(0.16)) as unknown as V2, tangent, radial, hit.normal, vec2(fT, fR) as unknown as V2, DECK_PLATING, idx.add(300.0));
      applyPlating(p, STRUCTURAL_DECK, 0.7);
      // Terrace steps every 0.16 of the radius: a dark riser line and a sloped lip.
      const tr = fract(r.div(0.16));
      const riser = lineCoverage(tr.sub(0.5).abs().sub(0.5).abs(), 0.03, fR.div(beta.mul(0.16)));
      out.f0.assign(mix(out.f0, vec3(...BLACK_STEEL).mul(0.25), riser));
      out.roughness.assign(mix(out.roughness, float(0.6), riser));
      const spokes = gridLines(az.mul(rArc), rArc.mul(Math.PI / 8).max(1e-4), beta.mul(0.012), fT);
      out.f0.assign(mix(out.f0, vec3(...BLACK_STEEL).mul(0.45), spokes.mul(0.7)));
      const shaft = smoothstep(0.17, 0.14, r);
      out.f0.assign(mix(out.f0, vec3(0.02), shaft));
      out.albedo.assign(mix(out.albedo, vec3(0.005), shaft));
      out.mirror.mulAssign(float(1).sub(max(riser, shaft)));
      out.rogueWeight.mulAssign(float(1).sub(max(riser, shaft)));
      out.mix.mulAssign(float(1).sub(shaft));
      const chamfer = smoothstep(0.955, 0.99, r);
      out.normal.assign(normalize(mix(out.normal, normalize(hit.normal.add(radial)), chamfer.mul(0.8))));
      // Receiver rings: the rim, the inner terrace edge and the shaft lip.
      const along = az.mul(rArc);
      out.emission.assign(
        receiver(rArc.sub(beta.mul(0.93)), 0.00026, along, 0.01, fR, fT, idx).add(receiver(rArc.sub(beta.mul(0.19)), 0.00014, along, 0.006, fR, fT, idx.add(19.0)).mul(1.4)),
      );
    }).Else(() => {
      const hDepth = hit.size.y;
      const height = float(1).sub(length(q)).div(hDepth);
      const fT = fpAlong(fpc, tangent);
      const fUp = fpAlong(fpc, qn.negate());
      sideFace(out, az.mul(beta), height, hDepth, fT, fUp, idx);
      const edge = smoothstep(0.96, 0.995, height);
      out.normal.assign(normalize(mix(out.normal, hit.normal.add(qn.negate()).normalize(), edge.mul(0.7))));
      
    });
  });

  If(hit.mat.equal(MAT.panel), () => {
    // Collector fields: modules sized to fit each cell exactly, mullions between them; PV modules
    // in clustered blocks.
    const pf = panelField(qn);
    const nu = max(floor(pf.span.x.div(S.panelModule).add(0.5)), 1.0);
    const nv = max(floor(pf.span.y.div(S.panelModule).add(0.5)), 1.0);
    const msize = vec2(pf.span.x.div(nu), pf.span.y.div(nv)) as unknown as V2;
    const a = vec2(pf.uv.x.mul(pf.span.x), pf.uv.y.mul(pf.span.y)) as unknown as V2;
    const tU = eastAt(qn);
    const tV = northAt(qn).mul(pf.cell.y);
    const seed = pf.cell.z.mul(7.0).add(pf.cell.x.mul(31.0)).add(pf.cell.y.mul(3.0));
    const fU = fpAlong(fpc, tU);
    const fV = fpAlong(fpc, tV);
    const p = plating(a, msize, tU, tV, hit.normal, vec2(fU, fV) as unknown as V2, MIRROR_PLATING, seed);
    // Module types follow a regional field (three octaves, from continental to district scale)
    // evaluated at each division's centre, so regions are patchworks of whole divisions with
    // ragged, division-aligned borders — fields of different installation eras, never isolated
    // countable rectangles.
    const lc = p.leafCentre;
    const region = valueNoise3(vec3(lc.div(0.3), seed.add(3.0))).mul(0.5)
      .add(valueNoise3(vec3(lc.div(0.1), seed.add(4.0))).mul(0.32))
      .add(valueNoise3(vec3(lc.div(0.035), seed.add(5.0))).mul(0.18));
    const mt = region.add(p.moduleHash.z.sub(0.5).mul(0.1));
    const field = select(mt.lessThan(0.36), MODULE_HELIO, select(mt.lessThan(0.6), MIRROR_FIELD, select(mt.lessThan(0.66), MODULE_CELL, MIRROR_FIELD)));
    applyPlating(p, field, 0.85);
    // Photovoltaic regions: dark blue cell glass where the field runs high; rare service modules.
    const pv = max(step(0.66, mt), step(p.moduleHash.z, 0.025));
    // Regional ageing: broad tonal variation of the mirror fields at continental scales.
    const age = valueNoise3(vec3(a.div(0.5), seed.add(9.0))).mul(0.6).add(valueNoise3(vec3(a.div(0.16), seed.add(10.0))).mul(0.4));
    out.f0.mulAssign(age.mul(0.16).add(0.9));
    out.albedo.mulAssign(age.mul(0.9).add(0.55));
    const pvGrid = gridLines(a.x, msize.x.div(24), msize.x.div(24).mul(0.06), fU).mul(0.6);
    out.f0.assign(mix(out.f0, vec3(...SURFACES.pv.cls.f0).add(pvGrid.mul(0.3)), pv));
    out.roughness.assign(mix(out.roughness, float(SURFACES.pv.cls.roughness), pv));
    out.albedo.assign(mix(out.albedo, vec3(...SURFACES.pv.cls.albedo), pv));
    out.normal.assign(mix(out.normal, p.facetNormal, pv));
    out.spread.assign(mix(out.spread, float(0.004), pv));
    out.mix.mulAssign(pv.oneMinus());
    out.mirror.mulAssign(pv.oneMinus());
    out.rogueWeight.mulAssign(pv.oneMinus());
    // Mullions: structural strips between modules.
    const mull = p.mullion.mul(smoothstep(0.0, 0.002, pf.dist));
    out.f0.assign(mix(out.f0, vec3(...BLACK_STEEL).mul(0.9), mull));
    out.roughness.assign(mix(out.roughness, float(0.34), mull));
    out.albedo.assign(mix(out.albedo, vec3(...STEEL_DIFFUSE), mull));
    out.mirror.mulAssign(mull.oneMinus());
    out.rogueWeight.mulAssign(mull.oneMinus());
    out.mix.mulAssign(mull.oneMinus());
    // The panel's border: a structural rim with a rounded outer edge.
    const fG = fpAlong(fpc, pf.grad);
    const rim = float(1).sub(smoothstep(max(float(0.0016).sub(fG), 0.0008), float(0.0016), pf.dist));
    out.f0.assign(mix(out.f0, vec3(...BLACK_STEEL), rim));
    out.roughness.assign(mix(out.roughness, float(0.3), rim));
    out.normal.assign(normalize(mix(out.normal, normalize(hit.normal.add(pf.grad.negate().mul(0.6))), rim.mul(smoothstep(0.0009, 0.0002, pf.dist)))));
    out.mix.mulAssign(rim.oneMinus());
    out.mirror.mulAssign(rim.oneMinus());
    out.rogueWeight.mulAssign(rim.oneMinus());
    // Receivers along the panel's rim: each field concentrates onto its own edge.
    out.emission.assign(receiver(pf.dist.sub(0.0011), 0.00012, a.x.add(a.y), 0.014, fG, max(fU, fV), seed.add(800.0)).mul(0.7));
  });

  If(hit.mat.equal(MAT.panelEdge), () => {
    out.f0.assign(vec3(...BLACK_STEEL).mul(0.8));
    out.roughness.assign(0.45);
    out.mixWeights.assign(vec4(0, 0, 0, 1));
  });

  If(hit.mat.equal(MAT.girdle), () => {
    // The Veil's top: mirror panes on a metal grid.
    const lat = hit.aux.x;
    const lon = hit.aux.y;
    const a = vec2(lon.mul(cos(lat)), lat) as unknown as V2;
    const fE = fpAlong(fpc, eastAt(qn));
    const fN = fpAlong(fpc, northAt(qn));
    const p = plating(a, vec2(0.042, 0.042) as unknown as V2, eastAt(qn), northAt(qn), hit.normal, vec2(fE, fN) as unknown as V2, MIRROR_PLATING, float(500.0));
    applyPlating(p, MIRROR_FIELD, 0.85);
    out.f0.assign(mix(out.f0, vec3(...BLACK_STEEL), p.mullion));
    out.roughness.assign(mix(out.roughness, float(0.34), p.mullion));
    out.mirror.mulAssign(p.mullion.oneMinus());
    out.rogueWeight.mulAssign(p.mullion.oneMinus());
    out.mix.mulAssign(p.mullion.oneMinus());
  });

  out.emission.assign(clamp(out.emission, 0, RECEIVER_RADIANCE * 2));
  return out;
}
