/**
 * Surfaces of the far structure: what each part is made of, how it is laid out, and how hot it
 * runs. Lighting is in shading.ts; the light transport these finishes take part in is solved in
 * enclosure.ts; the materials are in materials.ts and the heat glow in thermal.ts.
 *
 *  - Collector panels: one collection network (districts.ts) lays out everything — channels cut as
 *    relief (relief.ts), districts of polished, satin or striped plating in strips along their flow,
 *    and the heat: coolant warming toward each district's drain, channels hotter by the size of what
 *    they collect, basins at their own loads. The plating (plating.ts) is a warm refractory alloy —
 *    polished and satin tiles, a few offline. The metal mirrors its own piece of the enclosure (the
 *    mosaic, brightest toward the star) and glows dark bronze with heat.
 *  - Panel edges: a layered cross-section (trace.ts PANEL_EDGE) — the collector plate's edge, a dark
 *    recessed distribution layer with its hot pipe runs, the structural backing, and full-depth
 *    connections where the network meets the perimeter.
 *  - Headers: the hottest coolant runs along each panel's perimeter and both edges of every girder
 *    and hub rim — continuous orange-gold lines (the logo's lines), real in width, a few percent of
 *    the star's radiance at most, so they never saturate, bloom or flicker.
 *  - Frames, rings, collars, hubs and the band's rims: the alloy as structural girder decks with a
 *    recessed spine channel, chamfered edges and sections of collector plating; it runs cooler than
 *    the collectors, so the frames read dark.
 *  - The band (the Veil's top): a precision mirror shield in circumferential courses (courses.ts).
 *
 * Seen from 30,000–1,400,000 km, one pixel spans tens to thousands of km; every feature is
 * footprint-filtered to its mean before it can alias.
 */
import { float, vec2, vec3, vec4, If, dot, normalize, max, min, abs, floor, fract, smoothstep, mix, clamp, cos, select, atan, length, cross, step, sqrt } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { hash33, valueNoise3 } from '../../render/tsl/noise';
import { STRUCTURE } from './layout';
import { MAT, PANEL_EDGE, latLon, panelField, type StructureHit } from './trace';
import { plating, quadDivisions, gridLines, lineCoverage, resolved, eastAt, northAt, axisFootprint, type Division, type PlatingSpec, type PlatingSample, type QuadSpec } from './plating';
import { DISTRICTS, DISTRICT_KINDS, assembly, basinCharacter, district, panelCoords, panelSeed } from './districts';
import { BELT, beltAssembly } from './courses';
import { frameSpin, rotateZ } from './spin';
import { COLLECTOR_DIFFUSE, COLLECTOR_F0, STRUCTURE_DIFFUSE, STRUCTURE_F0, VEIL_F0 } from './materials';
import { COLLECTOR_TEMPERATURE, HEADER_TEMPERATURE, OFFLINE_SHARE, OFFLINE_TEMPERATURE, STRUCTURE_TEMPERATURE, glowNode } from './thermal';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;
type V4 = Node<'vec4'>;

/**
 * The finishes a pixel can mix when its tiles are unresolved (shading.ts evaluates each with the
 * prefiltered enclosure): polished collector, satin collector, offline collector (same metal, cold),
 * structural alloy. `tilt` is each finish's normal spread; `mirror` selects the Gaussian facet lobe.
 */
export const FINISHES = [
  { f0: COLLECTOR_F0, roughness: 0.08, albedo: COLLECTOR_DIFFUSE, tilt: 0.03, mirror: true },
  { f0: COLLECTOR_F0, roughness: 0.32, albedo: COLLECTOR_DIFFUSE, tilt: 0.05, mirror: false },
  { f0: COLLECTOR_F0, roughness: 0.08, albedo: COLLECTOR_DIFFUSE, tilt: 0.04, mirror: true },
  { f0: STRUCTURE_F0, roughness: 0.18, albedo: STRUCTURE_DIFFUSE, tilt: 0.05, mirror: true },
] as const;

/** Shares (polished, satin, offline, structural) among the tiles of each kind of field. */
const COLLECTOR_FIELD = vec4(0.72 - OFFLINE_SHARE, 0.28, OFFLINE_SHARE, 0.0);
const SATIN_FIELD = vec4(0.3 - OFFLINE_SHARE, 0.7, OFFLINE_SHARE, 0.0);
const DECK_COLLECTOR = vec4(0.5, 0.28, 0.02, 0.2);
const STRUCTURAL_DECK = vec4(0.0, 0.0, 0.0, 1.0);

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
  /** Rogue facet under the pixel (plating.ts): normal and area weight. */
  rogueNormal: V3;
  rogueWeight: F;
  /** Share of the star's cap the surface sees (relief occlusion). */
  occlusion: F;
  /** Thermal emission (scene radiance), footprint-filtered. */
  emission: V3;
}

/** Collector assemblies (districts.ts): 1,000–4,000 km strip segments, tiles down to ~300 km. */
export const COLLECTOR_PLATING: PlatingSpec = {
  tileSplit: [0.75, 0.45],
  mirrors: 8,
  mirrorSigma: 0.004,
  rogueShare: 0.001,
  rogueTilt: 0.7,
  pillow: 0.02,
  moduleSigma: 0.02,
  tileSigma: 0.03,
  activeShare: 0.28,
  activeSigma: 0.07,
  tileSeam: 0.04,
  flatMax: 0.006,
};

/**
 * The band's panes (the Veil's top, courses.ts): set like a precision mirror (~0.1–0.2°). With the
 * collector's 1–2° set errors, panes near the rails sent their reflections off the band, out
 * through the gap beside it, and mirrored black space: a mosaic of dark rectangles along both rails.
 */
export const VEIL_PLATING: PlatingSpec = {
  tileSplit: [0.55, 0.35],
  mirrors: 8,
  mirrorSigma: 0.0005,
  rogueShare: 0,
  rogueTilt: 0,
  pillow: 0.0015,
  moduleSigma: 0.0012,
  tileSigma: 0.002,
  activeShare: 0,
  activeSigma: 0,
  tileSeam: 0.02,
  flatMax: 0.004,
};

const DECK_QUAD: QuadSpec = { splitUp: 0, splitChance: [0], mullion: 0.04 };

export const DECK_PLATING: PlatingSpec = {
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
  flatMax: 0.05,
};

/**
 * Header lines: half-width (shell units, ≈ 400–500 km) and their offset in from the outline. The
 * headers carry the hottest coolant; their temperature drifts slowly along their length.
 */
export const PANEL_HEADER = { offset: 0.0026, halfWidth: 0.00055 };
const GIRDER_HEADER = { at: 0.86, halfWidth: 0.0006 };
/**
 * Hub header rings, as fractions of the outer radius: the rim, inset by outerInset plus a share of
 * the ring's width; the shaft lip (solid hubs) or the bore rim plus a share of the width (collars).
 */
const HUB_HEADER = { outerInset: 0.04, outerWidthShare: 0.06, shaft: 0.2, boreShare: 0.12, halfWidth: 0.00055 };

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
 * Picks a tile's finish from its hash given the field's shares (polished, satin, offline,
 * structural). The satin interval comes first so it coincides with plating.ts's actively trimmed
 * tiles (their larger set errors).
 */
function pickFinish(h: F, w: V4): F {
  const c1 = w.y;
  const c2 = c1.add(w.x);
  const c3 = c2.add(w.z);
  return select(h.lessThan(c1), float(1), select(h.lessThan(c2), float(0), select(h.lessThan(c3), float(2), float(3))));
}

function finishF0(i: F): V3 {
  return select(i.lessThan(2.5), vec3(...COLLECTOR_F0), vec3(...STRUCTURE_F0));
}

function finishRoughness(i: F): F {
  return select(i.lessThan(0.5), float(FINISHES[0].roughness), select(i.lessThan(1.5), float(FINISHES[1].roughness), select(i.lessThan(2.5), float(FINISHES[2].roughness), float(FINISHES[3].roughness))));
}

function finishAlbedo(i: F): V3 {
  return select(i.lessThan(2.5), vec3(...COLLECTOR_DIFFUSE), vec3(...STRUCTURE_DIFFUSE));
}

/** 1 for mirror-lobed finishes, 0 for the satin (GGX) finish. */
function finishMirror(i: F): F {
  return select(i.greaterThan(0.5).and(i.lessThan(1.5)), float(0), float(1));
}

/**
 * Temperature of a plated surface (K). `base` is the field's working temperature; tile-scale
 * variation (set per tile, a dome hotter at the centre, cooled seams) fades out as tiles fall below a
 * pixel. `facetResolved` weights a coolant gradient across each division (decks; the collectors'
 * flow is in their base). Offline tiles are cold.
 */
function platedTemperature(p: PlatingSample, base: F, fin: F, facetResolved: F, occlusion: F): F {
  const rT = p.tileResolved;
  const tile = p.tileHash.z.sub(0.5).mul(0.05);
  const r2 = dot(p.tileLocal, p.tileLocal).mul(0.5).min(1.0);
  const dome = float(0.5).sub(r2).mul(0.05);
  // Coolant enters each facet on one side and warms across it (direction set per facet).
  const dir = select(p.moduleHash.y.lessThan(0.5), p.facetLocal.x, p.facetLocal.y);
  const flow = dir.sub(0.5).mul(0.05).mul(select(p.moduleHash.x.lessThan(0.5), float(1), float(-1)));
  // Shaded bay floors near rib walls absorb less and run cooler.
  const shade = occlusion.sub(1).mul(0.08);
  const rel = float(1).add(tile.add(dome).mul(rT)).add(flow.mul(facetResolved)).add(shade).sub(p.seam.mul(0.06)).sub(p.mullion.mul(0.05));
  return select(fin.greaterThan(1.5).and(fin.lessThan(2.5)), float(OFFLINE_TEMPERATURE), base.mul(rel));
}

/**
 * Side faces of girders and hub drums, tens of thousands of km tall: alloy walls with a patchwork of
 * panels at a power-law spread of sizes (two irregular quadtree levels), continuous tonal variation
 * at several scales, and recessed gallery decks whose heights change from one irregular section of
 * the wall to the next. No joints at a single spacing and no countable rhythm: those read as
 * masonry. `along`/`depth` in shell units, `height` 0..1 up the face.
 */
function sideFace(out: SurfaceSample, along: F, height: F, depth: F, fpAlongFace: F, fpUp: F, seed: F): void {
  const fpH = fpUp.div(depth);
  const uu = along.div(0.03).add(valueNoise3(vec3(along.div(0.09), seed, 7.0)).mul(0.7));
  const sec = hash33(vec3(floor(uu), seed, 71.0));
  const g1 = sec.x.mul(0.3).add(0.25);
  const g2 = g1.add(sec.y.mul(0.3).add(0.2));
  const deck = max(lineCoverage(height.sub(g1), 0.02, fpH), lineCoverage(height.sub(g2), 0.014, fpH).mul(step(0.35, sec.z)));
  const p = vec2(along, height.mul(depth));
  const c0 = hash33(vec3(floor(p.div(0.008)), seed.add(80.0)));
  const c1 = hash33(vec3(floor(p.div(0.004)), seed.add(81.0)));
  const c2 = hash33(vec3(floor(p.div(0.002)), seed.add(82.0)));
  const cell = select(c0.x.lessThan(0.6), select(c1.x.lessThan(0.5), c2, c1), c0);
  const fade = resolved(float(0.002), max(fpAlongFace, fpUp));
  const panelTone = mix(float(0.5), cell.y, fade);
  const broad = valueNoise3(vec3(along.div(0.05), height.mul(2.0), seed)).mul(0.6).add(valueNoise3(vec3(along.div(0.012), height.mul(6.0), seed.add(2.0))).mul(0.4));
  const tone = float(0.5).add(broad.mul(0.3)).add(panelTone.mul(0.16)).add(sec.z.mul(0.1));
  out.f0.assign(vec3(...STRUCTURE_F0).mul(tone.mul(0.7).add(0.65)).mul(float(1).sub(deck.mul(0.5))));
  out.roughness.assign(mix(float(0.14).add(cell.z.mul(0.12)), float(0.45), deck));
  out.albedo.assign(vec3(...STRUCTURE_DIFFUSE).mul(float(1).sub(deck.mul(0.5))));
  out.mixWeights.assign(vec4(0, 0, 0, 1));
  // Walls face sideways (they see half the star) and only conduct: they run well below the decks.
  const T = float(STRUCTURE_TEMPERATURE * 0.86).mul(float(1).add(broad.sub(0.5).mul(0.04)).add(panelTone.sub(0.5).mul(0.02).mul(fade)));
  out.emission.assign(glowNode(T).mul(float(1).sub(deck.mul(0.3))));
}

/**
 * The rounded top edge of a wall: dressed and matte, its normal tilted at most ~16° toward the
 * star. Walls face the city as the frame sweeps past; a polished edge turning further would mirror
 * the overhead star into a thin bright line along every wall (an LED strip, not a girder).
 */
function roundedTopEdge(out: SurfaceSample, wallNormal: V3, qn: V3, height: F, resolvedShare: F): void {
  const edge = smoothstep(0.96, 0.995, height).mul(resolvedShare);
  out.normal.assign(normalize(mix(out.normal, wallNormal.add(qn.negate()).normalize(), edge.mul(0.35))));
  out.roughness.assign(mix(out.roughness, float(0.6), edge));
}

export function structureSurface(hitBand: StructureHit, pos: V3, fpcBand: Footprint): SurfaceSample {
  const S = STRUCTURE;
  // Each part is laid out in its own coordinates: the band and its rails (frame members 10, 11) in
  // band coordinates, everything else in frame coordinates (spin.ts), so detail stays on the part.
  const member = hitBand.aux.z;
  const onBand = hitBand.mat.equal(float(MAT.girdle)).or(hitBand.mat.equal(float(MAT.frame)).and(member.greaterThan(9.5)).and(member.lessThan(11.5)));
  const rc = select(onBand, float(1), frameSpin.x as unknown as F).toVar();
  const rs = select(onBand, float(0), frameSpin.y as unknown as F).toVar();
  const into = (v: V3): V3 => rotateZ(v, rc, rs);
  const back = (v: V3): V3 => rotateZ(v, rc, rs.negate());
  const hit: StructureHit = { ...hitBand, normal: into(hitBand.normal).toVar(), axis: into(hitBand.axis).toVar() };
  const fpc: Footprint = { ...fpcBand, d: into(fpcBand.d), n: into(fpcBand.n) };
  const q = into(pos.sub(vec3(0, 1, 0))).toVar();
  const qn = normalize(q).toVar();
  const out: SurfaceSample = {
    f0: vec3(...STRUCTURE_F0).toVar(),
    roughness: float(0.36).toVar(),
    albedo: vec3(...STRUCTURE_DIFFUSE).toVar(),
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
    occlusion: hit.occlusion.toVar(),
    emission: vec3(0).toVar(),
  };

  /** Applies a plating sample with a field of finishes; returns the picked finish index. */
  const applyPlating = (p: PlatingSample, field: V4, seamDark: number): F => {
    const fin = pickFinish(p.blockHash.z, field).toVar();
    out.f0.assign(finishF0(fin).mul(float(1).sub(p.seam.mul(seamDark))));
    out.roughness.assign(mix(finishRoughness(fin).add(p.tileHash.x.sub(0.5).mul(0.04)), float(0.7), p.seam));
    // Batches vary in tone.
    out.albedo.assign(finishAlbedo(fin).mul(p.tileHash.y.mul(0.3).add(0.82)).mul(float(1).sub(p.seam)));
    out.normal.assign(p.normal);
    out.spread.assign(p.spread);
    out.mix.assign(p.tileResolved.oneMinus());
    // The finish mix of the N tiles under the pixel varies binomially about the field's shares.
    const n = max(p.sampleCount, 1.0);
    const dev = (w: F, h: F) => h.sub(0.5).mul(Math.sqrt(12)).mul(sqrt(w.mul(w.oneMinus()).div(n)));
    const satin = clamp(field.y.add(dev(field.y, p.sampleHash.y)), 0, 1);
    const cold = clamp(field.z.add(dev(field.z, p.sampleHash.z)), 0, float(1).sub(satin));
    const rest = float(1).sub(satin).sub(cold);
    const restShare = field.x.add(field.w).max(1e-4);
    out.mixWeights.assign(vec4(rest.mul(field.x).div(restShare), satin, cold, rest.mul(field.w).div(restShare)));
    out.mixNormal.assign(p.sampleNormal);
    out.mixSpread.assign(p.pillowSigma);
    out.mixKeep.assign(sqrt(p.sampleKeep));
    out.mirror.assign(finishMirror(fin).mul(float(1).sub(p.seam)));
    out.rogueNormal.assign(p.rogueNormal);
    out.rogueWeight.assign(p.rogueWeight.mul(float(1).sub(p.seam)).mul(select(fin.lessThan(0.5), float(1), float(0))));
    // Structural tiles: their brushing spread rides on the tile's own.
    out.spread.assign(select(fin.greaterThan(2.5), sqrt(p.spread.mul(p.spread).add(FINISHES[3].tilt * FINISHES[3].tilt)), p.spread));
    return fin;
  };

  /**
   * Heat glow of a plated surface: the pixel's own tile where resolved, blending to the mean of the
   * sample under the pixel (its share of cold tiles, and the convexity of glow in temperature).
   */
  const applyGlow = (p: PlatingSample, fin: F, base: F, facetResolved: F) => {
    const own = glowNode(platedTemperature(p, base, fin, facetResolved, out.occlusion));
    const mean = glowNode(base.mul(float(1).sub(out.occlusion.oneMinus().mul(0.04)))).mul(float(1.04).mul(out.mixWeights.z.oneMinus()));
    out.emission.assign(mix(own, mean, p.tileResolved.oneMinus()));
  };

  If(hit.mat.equal(MAT.frame), () => {
    // Box girders: plated top deck with a recessed spine channel, hot headers near both edges and
    // chamfered edges; plated side faces.
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
      const collecting = step(0.42, kind).mul(step(kind, 0.72));
      const field = select(collecting.greaterThan(0.5), DECK_COLLECTOR, STRUCTURAL_DECK);
      const da = vec2(along, across) as unknown as V2;
      const dfp = vec2(fA, fX) as unknown as V2;
      const p = plating(da, quadDivisions(da, vec2(0.03, 0.03) as unknown as V2, DECK_QUAD, dfp, idx.add(100.0)), vec2(0.0075, 0.0075) as unknown as V2, alongDir, acrossDir, hit.normal, dfp, DECK_PLATING, idx.add(100.0));
      const fin = applyPlating(p, field, 0.7);
      const tone = hs.y.mul(0.3).add(0.82);
      out.f0.mulAssign(tone);
      out.albedo.mulAssign(tone);
      // Section joints and, in some sections, transverse cross-girders (spacing set per section).
      const joints = max(lineCoverage(big.d, 0.0005, fA), lineCoverage(small.d, 0.00018, fA).mul(0.7));
      const ribbed = step(hs.z, 0.3).mul(gridLines(along, hs.y.mul(0.002).add(0.0022), float(0.0005), fA));
      const dark = max(joints, ribbed.mul(0.8));
      out.f0.assign(mix(out.f0, vec3(...STRUCTURE_F0).mul(0.3), dark));
      out.albedo.assign(mix(out.albedo, vec3(0.01), dark));
      out.mix.mulAssign(dark.oneMinus());
      out.mirror.mulAssign(dark.oneMinus());
      // Spine channel: a recessed, darker trough along the centreline, its width set per section.
      const channel = lineCoverage(u, hb.y.mul(0.1).add(0.04), fX.div(hw));
      out.f0.assign(mix(out.f0, vec3(...STRUCTURE_F0).mul(0.35), channel));
      out.roughness.assign(mix(out.roughness, float(0.55), channel));
      out.mirror.mulAssign(channel.oneMinus());
      out.rogueWeight.mulAssign(channel.oneMinus());
      // Chamfered edges catch the star where they are wide enough to resolve.
      const chamferRes = resolved(hw.mul(0.03), fX);
      const chamfer = smoothstep(0.955, 0.985, u).mul(chamferRes);
      out.normal.assign(normalize(mix(out.normal, normalize(hit.normal.add(acrossDir.mul(select(across.greaterThan(0.0), float(1), float(-1))))), chamfer.mul(0.8))));
      out.mix.mulAssign(chamfer.oneMinus());
      // Heat: collecting sections run at collector temperature, structural ones cooler; joints and
      // the channel cooler still. Headers run hot along both edges.
      const base = mix(float(STRUCTURE_TEMPERATURE), float(COLLECTOR_TEMPERATURE), collecting).mul(hs.x.sub(0.5).mul(0.03).add(1));
      applyGlow(p, fin, base, float(1));
      out.emission.mulAssign(float(1).sub(max(dark.mul(0.5), channel.mul(0.6))));
      const drift = valueNoise3(vec3(along.div(0.05), idx, 3.0)).sub(0.5).mul(0.05).add(1);
      const header = lineCoverage(abs(across).sub(hw.mul(GIRDER_HEADER.at)), GIRDER_HEADER.halfWidth, fX).mul(joints.mul(0.6).oneMinus());
      out.emission.assign(mix(out.emission, glowNode(float(HEADER_TEMPERATURE).mul(drift)), header));
    }).Else(() => {
      const height = float(1).sub(length(q)).div(depth);
      // Side walls run along the girder; end faces (cut across it) run across it.
      const end = hit.aux.y.greaterThan(1.5);
      sideFace(out, select(end, across, along), height, depth, fpAlong(fpc, select(end, acrossDir, alongDir)), fpAlong(fpc, qn.negate()), idx);
      // The rounded top edge of the girder.
      roundedTopEdge(out, hit.normal, qn, height, resolved(depth.mul(0.035), fpAlong(fpc, qn.negate())));
    });
  });

  If(hit.mat.equal(MAT.hub), () => {
    // Hubs: plated concentric terraces, radial spokes and hot header rings; the polar hubs have a
    // dark central shaft, the equatorial collars an open bore (the band runs through it).
    const idx = hit.aux.z;
    const beta = hit.size.x;
    const r = hit.aux.x;
    const rIn = hit.size.z;
    const collar = rIn.greaterThan(0.0);
    const width = float(1).sub(rIn);
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
      const ha = vec2(az.mul(rArc), rArc) as unknown as V2;
      const hfp = vec2(fT, fR) as unknown as V2;
      const hm = beta.mul(0.16);
      const p = plating(ha, quadDivisions(ha, vec2(hm, hm) as unknown as V2, DECK_QUAD, hfp, idx.add(300.0)), vec2(hm.mul(0.25), hm.mul(0.25)) as unknown as V2, tangent, radial, hit.normal, hfp, DECK_PLATING, idx.add(300.0));
      // Terraces of irregular width (each hub its own), alternate ones carrying collector plating.
      // Three terraces across a collar's ring; a solid hub steps every 0.16 of its radius.
      const pitch = select(collar, width.div(3), float(0.16));
      const rw = r.sub(rIn).add(valueNoise3(vec3(r.mul(5.0), idx, 13.0)).sub(0.5).mul(pitch.mul(0.56)));
      const terrace = floor(rw.div(pitch));
      const sector = floor(az.div(Math.PI / 6).add(terrace.mul(0.37)));
      const collecting = step(0.45, hash33(vec3(terrace, sector, idx.add(41.0))).x);
      const fin = applyPlating(p, select(collecting.greaterThan(0.5), DECK_COLLECTOR, STRUCTURAL_DECK), 0.7);
      // Terrace steps: a dark riser line and a sloped lip.
      const tr = fract(rw.div(pitch));
      const riser = lineCoverage(tr.sub(0.5).abs().sub(0.5).abs(), 0.025, fR.div(beta.mul(pitch)));
      out.f0.assign(mix(out.f0, vec3(...STRUCTURE_F0).mul(0.7), riser));
      out.roughness.assign(mix(out.roughness, float(0.6), riser));
      const spokes = gridLines(az.mul(rArc), rArc.mul(Math.PI / 8).max(1e-4), beta.mul(0.012), fT);
      out.f0.assign(mix(out.f0, vec3(...STRUCTURE_F0).mul(0.45), spokes.mul(0.7)));
      const shaft = smoothstep(0.17, 0.14, r).mul(select(collar, float(0), float(1)));
      out.f0.assign(mix(out.f0, vec3(0.03), shaft));
      out.albedo.assign(mix(out.albedo, vec3(0.005), shaft));
      out.mirror.mulAssign(float(1).sub(max(riser, shaft)));
      out.rogueWeight.mulAssign(float(1).sub(max(riser, shaft)));
      out.mix.mulAssign(float(1).sub(shaft));
      const chamfer = smoothstep(0.955, 0.99, r).mul(resolved(beta.mul(0.035), fR));
      out.normal.assign(normalize(mix(out.normal, normalize(hit.normal.add(radial)), chamfer.mul(0.8))));
      // A collar's bore rim, chamfered toward the open bore.
      const boreChamfer = smoothstep(rIn.add(0.035), rIn.add(0.01), r).mul(select(collar, float(1), float(0))).mul(resolved(beta.mul(0.035), fR));
      out.normal.assign(normalize(mix(out.normal, normalize(hit.normal.sub(radial)), boreChamfer.mul(0.8))));
      const base = mix(float(STRUCTURE_TEMPERATURE), float(COLLECTOR_TEMPERATURE), collecting);
      applyGlow(p, fin, base, float(1));
      out.emission.mulAssign(float(1).sub(max(riser.mul(0.5), max(shaft, spokes.mul(0.3)))));
      // Header rings: the rim and the shaft lip (a collar's bore rim), where the hub gathers the
      // heat of its spines.
      const outerHeader = float(1 - HUB_HEADER.outerInset).sub(width.mul(HUB_HEADER.outerWidthShare));
      const innerHeader = select(collar, rIn.add(width.mul(HUB_HEADER.boreShare)), float(HUB_HEADER.shaft));
      const ring = max(lineCoverage(rArc.sub(beta.mul(outerHeader)), HUB_HEADER.halfWidth, fR), lineCoverage(rArc.sub(beta.mul(innerHeader)), HUB_HEADER.halfWidth * 0.7, fR));
      const drift = valueNoise3(vec3(az.mul(3.0), idx, 5.0)).sub(0.5).mul(0.04).add(1);
      out.emission.assign(mix(out.emission, glowNode(float(HEADER_TEMPERATURE).mul(drift)), ring));
    }).Else(() => {
      const hDepth = hit.size.y;
      const height = float(1).sub(length(q)).div(hDepth);
      const fT = fpAlong(fpc, tangent);
      const fUp = fpAlong(fpc, qn.negate());
      // Walls run around the hub; a collar's cut faces (against the rails) run across its ring.
      const cut = hit.aux.y.greaterThan(1.5);
      sideFace(out, select(cut, rArc, az.mul(beta)), height, hDepth, select(cut, fpAlong(fpc, radial), fT), fUp, idx);
      roundedTopEdge(out, hit.normal, qn, height, resolved(hDepth.mul(0.035), fUp));
    });
  });

  If(hit.mat.equal(MAT.panel), () => {
    // Collector fields: the panel's collection network (districts.ts) lays out the channels, the
    // districts and their assemblies; finishes and heat follow the same layout.
    const pf = panelField(qn);
    const ll = latLon(qn);
    const seed = panelSeed(pf.cell);
    const c = panelCoords(ll.lon, abs(ll.lat), pf.lon0, pf.lonSpan, seed);
    const tU = eastAt(qn);
    const tV = northAt(qn).mul(pf.cell.y);
    const fU = fpAlong(fpc, tU);
    const fV = fpAlong(fpc, tV);
    const dist = district(c, fU, fV);
    const asm = assembly(c, dist);
    // The basin's network has its own orientation: plate in its frame.
    const rot = dist.cell.rot;
    const tQx = tU.mul(rot.x).add(tV.mul(rot.y));
    const tQy = tV.mul(rot.x).sub(tU.mul(rot.y));
    const dKey = floor(dist.cell.hash.xy.mul(65536.0));
    const dh = hash33(vec3(dKey, seed.add(921.0)));
    const dh2 = hash33(vec3(dKey, seed.add(923.0)));
    // A district is installed as a unit: its assemblies share an orientation error.
    const dTilt = dh.xy.sub(0.5).mul(Math.sqrt(12) * DISTRICTS.districtSigma) as unknown as V2;
    const div: Division = { origin: asm.origin, size: asm.size, hash: asm.hash, mullion: asm.joint };
    const p = plating(asm.a, div, vec2(DISTRICTS.finest, DISTRICTS.finest) as unknown as V2, tQx, tQy, hit.normal, dist.fpQ, COLLECTOR_PLATING, seed, dTilt);
    // Finishes: the district's kind (satin, striped along its flow, or polished) within its basin's
    // character; stripes below a pixel blend to their mean.
    const basin = basinCharacter(dist.cell.basin);
    const kind = dist.cell.hash.y;
    const satinP = basin.satin.mul(DISTRICT_KINDS.satinPerShare);
    const striped = kind.greaterThanEqual(satinP).and(kind.lessThan(satinP.add(DISTRICT_KINDS.striped)));
    const plain = select(kind.lessThan(satinP), SATIN_FIELD, COLLECTOR_FIELD);
    const stripe = mix(SATIN_FIELD.add(COLLECTOR_FIELD).mul(0.5), select(asm.stripOdd.greaterThan(0.5), SATIN_FIELD, COLLECTOR_FIELD), resolved(min(asm.size.x, asm.size.y), max(dist.fpQ.x, dist.fpQ.y)));
    const fin = applyPlating(p, select(striped, stripe, plain), 0.85);
    // Districts differ in tone (batches, coatings, eras).
    out.f0.mulAssign(dh.z.sub(0.5).mul(0.16).add(1));
    // Channel walls and bevels (relief.ts) are matte structural faces in the channels' shade, not
    // polished collector: a polished wall would mirror the star into a thin bright slit.
    const wall = smoothstep(0.005, 0.04, float(1).sub(dot(hit.normal, qn.negate())));
    out.roughness.assign(mix(out.roughness, float(0.6), wall));
    out.f0.mulAssign(wall.mul(-0.7).add(1));
    out.mirror.mulAssign(wall.oneMinus());
    out.mix.mulAssign(wall.oneMinus());
    out.rogueWeight.mulAssign(wall.oneMinus());
    // Channel floors (the finer branches exist only as this shading): dark structural alloy down in
    // the recess, which hides part of the star's cap from them as the cut channels' walls do.
    const chan = dist.channel;
    out.f0.assign(mix(out.f0, vec3(...STRUCTURE_F0).mul(0.4), chan));
    out.roughness.assign(mix(out.roughness, float(0.25), chan));
    out.albedo.assign(mix(out.albedo, vec3(...STRUCTURE_DIFFUSE).mul(0.6), chan));
    out.occlusion.assign(min(out.occlusion, mix(float(1), float(0.6), chan)));
    out.mirror.mulAssign(chan.oneMinus());
    out.mix.mulAssign(chan.oneMinus());
    out.rogueWeight.mulAssign(chan.oneMinus());
    // Regional ageing: broad tonal variation at continental scales.
    const arc = vec2(c.p.x.mul(cos(ll.lat)), c.p.y);
    const age = valueNoise3(vec3(arc.div(0.5), seed.add(9.0))).mul(0.6).add(valueNoise3(vec3(arc.div(0.16), seed.add(10.0))).mul(0.4));
    out.f0.mulAssign(age.mul(0.2).add(0.88));
    // Heat: the basin's load, the district's own, coolant warming along the flow toward the drain,
    // strips at slightly different loads; then the plated detail.
    const rel = basin.heat.add(dh2.x.sub(0.5).mul(0.024)).add(dist.flowPos.sub(0.5).mul(0.04)).add(asm.stripHash.z.sub(0.5).mul(0.015));
    applyGlow(p, fin, float(COLLECTOR_TEMPERATURE).mul(rel.add(1)), float(0));
    // Channels carry the collected heat: hotter the more they collect.
    const chHeat = dist.channelHeat.div(max(chan, 1e-4));
    out.emission.assign(mix(out.emission, glowNode(float(COLLECTOR_TEMPERATURE).mul(basin.heat.add(chHeat).add(1))), chan));
    // The panel's border: a structural rim with a rounded outer edge, running cooler.
    const fG = fpAlong(fpc, pf.grad);
    const rim = float(1).sub(smoothstep(max(float(0.0016).sub(fG), 0.0008), float(0.0016), pf.dist));
    out.f0.assign(mix(out.f0, vec3(...STRUCTURE_F0), rim));
    out.roughness.assign(mix(out.roughness, float(0.3), rim));
    out.normal.assign(normalize(mix(out.normal, normalize(hit.normal.add(pf.grad.negate().mul(0.6))), rim.mul(smoothstep(0.0009, 0.0002, pf.dist)).mul(resolved(float(0.0007), fG)))));
    out.mix.mulAssign(rim.oneMinus());
    out.mirror.mulAssign(rim.oneMinus());
    out.rogueWeight.mulAssign(rim.oneMinus());
    out.emission.assign(mix(out.emission, glowNode(float(STRUCTURE_TEMPERATURE)), rim));
    // The perimeter header: the network's heat leaves each panel along its border.
    const header = lineCoverage(pf.dist.sub(PANEL_HEADER.offset), PANEL_HEADER.halfWidth, fG);
    const drift = valueNoise3(vec3(arc.x.add(arc.y).div(0.04), seed, 11.0)).sub(0.5).mul(0.05).add(1);
    out.emission.assign(mix(out.emission, glowNode(float(HEADER_TEMPERATURE).mul(drift)), header));
  });

  If(hit.mat.equal(MAT.panelEdge), () => {
    // The exposed edge in cross-section (trace.ts PANEL_EDGE). The backing and the connections are
    // dressed like the girders' walls; the layers above are set by the hit's layer.
    const E = PANEL_EDGE;
    const layer = hit.aux.z;
    const h = hit.size.x;
    const pf = panelField(qn);
    const ll = latLon(qn);
    const east = eastAt(qn);
    const meridianSide = abs(dot(pf.grad, east)).greaterThan(0.7);
    const along = select(meridianSide, abs(ll.lat), ll.lon.mul(cos(ll.lat)));
    const fEdge = fpAlong(fpc, select(meridianSide, northAt(qn), east));
    const fUp = fpAlong(fpc, qn.negate());
    const D = S.panelDepth;
    sideFace(out, along, float(1).sub(h).div(1 - E.recess).clamp(0, 1), float(D * (1 - E.recess)), fEdge, fUp, panelSeed(pf.cell).add(700.0));
    If(layer.equal(float(E.layer.face)), () => {
      // The collector plate's own edge, at its working temperature.
      out.f0.assign(vec3(...STRUCTURE_F0).mul(0.95));
      out.roughness.assign(0.3);
      out.emission.assign(glowNode(float(COLLECTOR_TEMPERATURE * 0.97)));
    });
    If(layer.equal(float(E.layer.recessWall)).or(layer.equal(float(E.layer.ledge))), () => {
      // The recessed distribution layer in the face layer's shadow: dark alloy, its pipe runs hot.
      out.f0.assign(vec3(...STRUCTURE_F0).mul(0.45));
      out.roughness.assign(0.6);
      out.occlusion.assign(select(layer.equal(float(E.layer.ledge)), float(0.35), float(0.3)));
      const hr = h.sub(E.face).div(E.recess - E.face);
      const fpH = fUp.div(D * (E.recess - E.face));
      const pipes = max(max(lineCoverage(hr.sub(0.28), 0.06, fpH), lineCoverage(hr.sub(0.55), 0.05, fpH)), lineCoverage(hr.sub(0.8), 0.07, fpH)).mul(select(layer.equal(float(E.layer.ledge)), float(0), float(1)));
      out.emission.assign(mix(glowNode(float(STRUCTURE_TEMPERATURE * 0.95)), glowNode(float(COLLECTOR_TEMPERATURE * 1.1)), pipes));
    });
    If(layer.equal(float(E.layer.connection)), () => {
      // A full-depth connection where a manifold meets the perimeter: brighter alloy, warm with its coolant.
      out.f0.mulAssign(1.12);
      out.emission.assign(mix(out.emission, glowNode(float(COLLECTOR_TEMPERATURE * 1.05)), 0.6));
    });
  });

  If(hit.mat.equal(MAT.girdle), () => {
    // The Veil's top: a precision mirror shield in courses (courses.ts). It rejects the light; it
    // does not glow.
    const east = eastAt(qn);
    const north = northAt(qn);
    const fE = fpAlong(fpc, east);
    const fN = fpAlong(fpc, north);
    const b = beltAssembly(hit.aux.x, hit.aux.y, fE, fN);
    const p = plating(b.a, b.pane, vec2(BELT.finest, BELT.finest) as unknown as V2, east, north, hit.normal, vec2(fE, fN) as unknown as V2, VEIL_PLATING, float(500.0), b.sectionTilt, b.precision);
    applyPlating(p, vec4(1, 0, 0, 0), 0.85);
    // Coatings change by section within each course: reflectance and a faint warm or cool cast.
    const cast = b.courseHash.x.sub(0.5).mul(0.04);
    const coat = vec3(...VEIL_F0).mul(b.coat).mul(vec3(cast.add(1), 1, cast.negate().add(1)));
    // Joints, and the structural seams between courses (matte, cooler alloy).
    const joint = max(max(p.mullion, p.seam), b.seam);
    out.f0.assign(mix(coat, vec3(...STRUCTURE_F0), joint));
    out.roughness.assign(mix(float(0.05), float(0.34), joint));
    // A hazed coating scatters a little of the star's light at wide angles: aged sections read
    // lighter whatever they mirror.
    out.albedo.assign(mix(vec3(b.scatter), vec3(...STRUCTURE_DIFFUSE), joint));
    // Unresolved panes and tiles: the sample's mean tilt (anisotropic cells, plating.ts); each
    // course's figure widens the lobe.
    out.normal.assign(normalize(mix(p.sampleNormal, p.normal, p.tileResolved)));
    out.spread.assign(sqrt(p.spread.mul(p.spread).add(b.figure.mul(b.figure))));
    out.mirror.mulAssign(joint.oneMinus());
    out.rogueWeight.assign(0);
    out.mix.assign(0);
    out.emission.assign(glowNode(float(STRUCTURE_TEMPERATURE)).mul(joint));
  });

  out.normal.assign(back(out.normal));
  out.mixNormal.assign(back(out.mixNormal));
  out.rogueNormal.assign(back(out.rogueNormal));
  return out;
}
