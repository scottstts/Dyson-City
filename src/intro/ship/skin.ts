/**
 * The skin's surface (docs/intro-ship.md, "Skin"): what makes a faceted body read as a built,
 * flown ship rather than a moulding. Shaded, not modelled: a seam is a centimetre-wide recessed
 * joint, a fastener a 14 mm head, a stencil a few millimetres of paint, far below what geometry
 * should carry on a 24 m hull. (Doubler plates, hatches and grilles are geometry: details/.)
 *
 *  - Transverse seams at the frames' stations (x = const), so each runs unbroken round the body
 *    from facet to facet, as a frame's joint does; some bays split again by a second joint. On
 *    facets facing along x (the aft plates, the intakes' faces) the frames are z = const instead.
 *  - Longitudinal seams along each facet, staggered bay to bay like brickwork.
 *  - Each panel its own lay-up: a tone and roughness of its own, so reflections break into a
 *    patchwork of plates under a grazing light.
 *  - Access panels in some bays: a rounded hatch with a ring of quick-release fasteners; rows of
 *    fasteners along the transverse seams.
 *  - Stencils on some panels: maintenance legends in ochre, white or red, a few lines of small
 *    lettering near a corner.
 *  - Grime: streaked down the facets by weather and handling, lifting the roughness.
 *
 * Panel edges roll into each joint (the highlight that draws a seam), the joint itself is dark.
 * Everything is box-filtered to the pixel's footprint: a seam below a pixel becomes its coverage,
 * a fastener or a letter below a pixel its share of the area, so the skin never shimmers as the
 * ship flies off.
 *
 * Coordinates are the ship's own frame (positionLocal/normalLocal of the ship's meshes).
 */
import { abs, clamp, dot, float, floor, fwidth, length, max, min, mix, normalize, normalLocal, positionLocal, select, sign, smoothstep, transformNormalToView, vec2, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { fbm3, hash33 } from '../../render/tsl/noise';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

export interface PanelSpec {
  /** Frame pitch (transverse seams) and panel width (longitudinal seams), m. 0 frame: no seams. */
  frame: number;
  panel: number;
  /** Share of bays split again by a second transverse joint. */
  split: number;
  /** Joint half-width and the width over which a panel's edge rolls into it (m), the roll's slope. */
  gap: number;
  roll: number;
  slope: number;
  /** Fasteners: head radius, pitch along a row, the row's offset from its seam (m). */
  fastener: number;
  pitch: number;
  rowOffset: number;
  /** Share of panels carrying an access hatch; a stencil; per-panel spread of tone and roughness. */
  access: number;
  stencils: number;
  tone: number;
  rough: number;
  /** Grime: its strength on the albedo and the roughness, and its scale (m). */
  grime: number;
  grimeScale: number;
}

/** The hull's skin. */
export const HULL_PANELS: PanelSpec = {
  frame: 1.25,
  panel: 0.95,
  split: 0.45,
  gap: 0.005,
  roll: 0.014,
  slope: 0.6,
  fastener: 0.007,
  pitch: 0.12,
  rowOffset: 0.03,
  access: 0.3,
  stencils: 0.35,
  tone: 0.22,
  rough: 0.12,
  grime: 0.35,
  grimeScale: 1.6,
};

/** The doubler plates: no joints of their own (their edges are geometry), weathered the same. */
export const PLATE_PANELS: PanelSpec = { ...HULL_PANELS, frame: 0, access: 0, stencils: 0.5 };

/** The consoles and the dash: screwed panels, a few millimetres of joint, small legends. */
export const CONSOLE_PANELS: PanelSpec = {
  frame: 0.42,
  panel: 0.3,
  split: 0.3,
  gap: 0.0012,
  roll: 0.003,
  slope: 0.45,
  fastener: 0.003,
  pitch: 0.1,
  rowOffset: 0.012,
  access: 0.2,
  stencils: 0.0,
  tone: 0.06,
  rough: 0.08,
  grime: 0.1,
  grimeScale: 0.4,
};

export interface Skin {
  /** The perturbed normal (view space), for `normalNode`. */
  normal: V3;
  /** Multiplier on the base colour: panel tone, the joints' dark, grime. */
  albedo: F;
  /** Added to the base roughness. */
  roughness: F;
  /** Share of the pixel that is fastener head (bare metal). */
  metal: F;
  /** Share of the pixel painted with a stencil, and the stencil's paint. */
  stencil: F;
  stencilColor: V3;
}

/** Box-filtered coverage of a band |d| < w at footprint fp (its integral is kept below a pixel). */
function band(d: F, w: number, fp: F): F {
  const ww = float(w);
  return clamp(float(1).sub(abs(d).sub(ww).div(fp)), 0, 1).mul(min(float(1), ww.mul(2).div(fp))) as F;
}

/** Box-filtered coverage of a disc of radius r at distance `dist`. */
function disc(dist: F, r: number, fp: F): F {
  const k = min(float(1), float(2 * r).div(fp));
  return smoothstep(fp.add(r), float(r).sub(fp).max(0), dist).mul(k.mul(k)) as F;
}

/** Box-filtered coverage of the box [0, w] × [0, h] at a point. */
function rect(p: V2, w: F, h: F, fp: F): F {
  const cx = clamp(min(p.x, w.sub(p.x)).div(fp).add(0.5), 0, 1);
  const cy = clamp(min(p.y, h.sub(p.y)).div(fp).add(0.5), 0, 1);
  return cx.mul(cy) as F;
}

const on = (c: Node<'bool'>): F => select(c, float(1), float(0)) as F;

export function panelSkin(spec: PanelSpec): Skin {
  const p = positionLocal;
  const n = normalize(normalLocal) as V3;
  // Facets facing along x are framed in z; every other facet at its stations along x.
  const xFacing = abs(n.x).greaterThan(0.8);
  const axis = select(xFacing, vec3(0, 0, 1), vec3(1, 0, 0)) as V3;
  const raw = axis.sub(n.mul(dot(n, axis))) as V3;
  // In-plane distance per unit of the frame coordinate (a station plane cuts a raked facet slant).
  const stretch = max(length(raw), 0.3) as F;
  const ea = normalize(raw) as V3;
  const eb = normalize(n.cross(ea)) as V3;
  const a = select(xFacing, p.z, p.x) as F;
  const b = dot(p, eb) as F;
  const fp = max(max(fwidth(a), fwidth(b)), 1e-5) as F;
  const facet = floor(n.mul(7.5).add(7.5));
  const facetId = facet.x.add(facet.y.mul(16)).add(facet.z.mul(256));

  const seams = spec.frame > 0;
  const frame = Math.max(spec.frame, 1);
  const panelW = spec.panel;
  // Bays between frames, some split again; panels across them, every other bay's half a panel along.
  const bay = floor(a.div(frame));
  const hb = hash33(vec3(bay, facetId, 17));
  const isSplit = hb.x.lessThan(spec.split);
  const splitAt = hb.y.mul(0.4).add(0.3).mul(frame);
  const inBay = a.sub(bay.mul(frame)) as F;
  const second = select(isSplit.and(inBay.greaterThan(splitAt)), float(1), float(0)) as F;
  const lo = second.mul(splitAt) as F;
  const hi = mix(select(isSplit, splitAt, float(frame)), float(frame), second) as F;
  const width = hi.sub(lo) as F;
  const da = inBay.sub(lo.add(hi).mul(0.5)) as F; // from the panel's middle along a
  const stagger = bay.mod(2).mul(0.5);
  const bs = b.div(panelW).add(stagger);
  const row = floor(bs);
  const db = bs.sub(row).sub(0.5).mul(panelW) as F;
  // Distance to the nearest joint (in-plane, m): transverse and longitudinal.
  const toA = width.mul(0.5).sub(abs(da)).div(stretch) as F;
  const toB = float(panelW / 2).sub(abs(db)) as F;

  const h = hash33(vec3(bay.mul(2).add(second), row, facetId));
  const h2 = hash33(vec3(row, bay.mul(2).add(second), facetId.add(911)));
  const tone = float(1).add(h.x.sub(0.5).mul(spec.tone)) as F;
  const rough = h.y.sub(0.5).mul(spec.rough) as F;

  // An access hatch in some panels: rounded, about a point in the panel.
  const isAccess = on(h.z.lessThan(spec.access));
  const local = vec2(da.div(stretch), db) as V2;
  const hw = width.div(stretch).mul(mix(float(0.16), float(0.3), h.x));
  const hh = mix(float(panelW * 0.18), float(panelW * 0.32), h.y);
  const centre = vec2(h.y.sub(0.5).mul(width.div(stretch)).mul(0.25), h.x.sub(0.5).mul(panelW * 0.25));
  const q = local.sub(centre) as V2;
  const r = 0.035;
  const qa = abs(q).sub(vec2(hw, hh)).add(r) as V2;
  const sdf = length(max(qa, vec2(0, 0))).add(min(max(qa.x, qa.y), 0)).sub(r) as F;
  const accessGap = band(sdf, spec.gap * 0.7, fp).mul(isAccess) as F;
  const alongX = on(qa.x.greaterThan(qa.y));

  // Joints and the roll of each panel's edge into them.
  const seamOn = seams ? 1 : 0;
  const seamGap = max(band(toA, spec.gap, fp), band(toB, spec.gap, fp)).mul(seamOn) as F;
  const gap = max(seamGap, accessGap) as F;
  const fade = clamp(float(1).sub(fp.div(spec.roll)), 0, 1) as F;
  const roll = (dist: F) => smoothstep(float(spec.roll + spec.gap), float(spec.gap), dist).mul(spec.slope).mul(fade) as F;
  let tilt = ea.mul(sign(da).mul(roll(toA))).add(eb.mul(sign(db).mul(roll(toB)))).mul(seamOn) as V3;
  tilt = tilt.add(ea.mul(sign(q.x).mul(roll(abs(sdf) as F)).mul(isAccess).mul(alongX))) as V3;
  tilt = tilt.add(eb.mul(sign(q.y).mul(roll(abs(sdf) as F)).mul(isAccess).mul(float(1).sub(alongX)))) as V3;

  // Fasteners: rows either side of each transverse joint; a ring inside each hatch's edge.
  const along = b.div(spec.pitch);
  const rowDist = length(vec2(abs(toA).sub(spec.rowOffset), along.sub(floor(along).add(0.5)).mul(spec.pitch))) as F;
  const edgeAlong = select(qa.x.greaterThan(qa.y), q.y, q.x).div(spec.pitch * 0.8);
  const ringDist = length(vec2(sdf.add(spec.rowOffset * 0.8), edgeAlong.sub(floor(edgeAlong).add(0.5)).mul(spec.pitch * 0.8))) as F;
  const head = max(disc(rowDist, spec.fastener, fp).mul(seamOn), disc(ringDist, spec.fastener, fp).mul(isAccess)) as F;

  // A stencil: lines of 5 × 7 letters near the panel's lower corner, away from any hatch.
  const hasText = on(h2.x.lessThan(spec.stencils)).mul(float(1).sub(isAccess));
  const corner = vec2(local.x.add(width.div(stretch).mul(0.5)), local.y.add(panelW / 2)).sub(vec2(0.07, 0.07)) as V2;
  const glyph = vec2(0.011, 0.022);
  const lines = floor(h2.y.mul(3)).add(1);
  const lineLen = h2.z.mul(0.12).add(0.06);
  const block = rect(corner, lineLen as F, lines.mul(glyph.y) as F, fp);
  const cell = floor(corner.div(glyph));
  const inCell = corner.div(glyph).sub(cell);
  const px = floor(inCell.mul(vec2(7, 11)));
  // Letters fill 5 of 7 columns and 7 of 11 rows of their cell; their pixels on by hash.
  const inGlyph = on(px.x.greaterThanEqual(1).and(px.x.lessThan(6)).and(px.y.greaterThanEqual(2)).and(px.y.lessThan(9)));
  const pix = on(hash33(vec3(cell.x.add(cell.y.mul(64)), px.x.add(px.y.mul(8)), facetId.add(bay.mul(13)).add(row))).x.greaterThan(0.45));
  const fine = clamp(fp.div(0.0016).sub(0.5), 0, 1);
  const stencil = block.mul(hasText).mul(mix(inGlyph.mul(pix), float(0.22), fine)) as F;
  const paint = h2.y.mul(7).fract();
  const stencilColor = select(paint.lessThan(0.55), vec3(0.42, 0.3, 0.08), select(paint.lessThan(0.85), vec3(0.5, 0.5, 0.48), vec3(0.42, 0.06, 0.04))) as V3;

  // Grime: streaked down the facets.
  const g = fbm3(vec3(p.x, p.y.mul(0.25), p.z).div(spec.grimeScale) as V3, 3, fp.div(spec.grimeScale) as F) as F;
  const grime = smoothstep(float(0.45), float(0.8), g).mul(spec.grime) as F;

  const nLocal = normalize(n.sub(tilt)) as V3;
  return {
    normal: transformNormalToView(nLocal) as V3,
    albedo: tone.mul(float(1).sub(gap.mul(0.85))).mul(float(1).sub(grime.mul(0.6))) as F,
    roughness: rough.add(gap.mul(0.25)).add(grime.mul(0.2)).sub(head.mul(0.2)) as F,
    metal: head,
    stencil,
    stencilColor,
  };
}

/** In-plane coordinates on a facet (as panelSkin lays them) and the pixel's footprint in metres. */
function facetCoords(): { n: V3; ea: V3; eb: V3; a: F; b: F; fp: F } {
  const p = positionLocal;
  const n = normalize(normalLocal) as V3;
  const xFacing = abs(n.x).greaterThan(0.8);
  const axis = select(xFacing, vec3(0, 0, 1), vec3(1, 0, 0)) as V3;
  const ea = normalize(axis.sub(n.mul(dot(n, axis)))) as V3;
  const eb = normalize(n.cross(ea)) as V3;
  const a = dot(p, ea) as F;
  const b = dot(p, eb) as F;
  const fp = max(max(fwidth(a), fwidth(b)), 1e-5) as F;
  return { n, ea, eb, a, b, fp };
}

/**
 * The cabin floor's tread: a diamond pattern of low raised lozenges on the graphite plates (the
 * anti-slip face of a composite deck panel), filtered away below a pixel.
 */
export function treadSkin(): { normal: V3; roughness: F } {
  const { n, ea, eb, a, b, fp } = facetCoords();
  const pitch = 0.024;
  // Two families of ridges at ±45°, each a lozenge where they cross.
  const u = a.add(b).div(pitch);
  const v = a.sub(b).div(pitch);
  const du = u.sub(floor(u).add(0.5)) as F;
  const dv = v.sub(floor(v).add(0.5)) as F;
  const fade = clamp(float(1).sub(fp.div(pitch * 0.25)), 0, 1) as F;
  const lozenge = smoothstep(float(0.36), float(0.22), max(abs(du), abs(dv))) as F;
  // Slopes on the lozenge's flanks, toward its centre's normal.
  const flank = smoothstep(float(0.2), float(0.36), max(abs(du), abs(dv))).mul(lozenge) as F;
  const su = select(abs(du).greaterThan(abs(dv)), sign(du), float(0));
  const sv = select(abs(du).greaterThan(abs(dv)), float(0), sign(dv));
  const tilt = ea.add(eb).mul(su).add(ea.sub(eb).mul(sv)).mul(flank.mul(0.25).mul(fade)) as V3;
  return {
    normal: transformNormalToView(normalize(n.add(tilt)) as V3) as V3,
    roughness: lozenge.mul(-0.12).mul(fade).add(fade.oneMinus().mul(-0.05)) as F,
  };
}

/**
 * The liners' acoustic perforation: a square grid of small holes in each panel's facing, dark in
 * the near view, their share of the area (a slight darkening) beyond it.
 */
export function perforation(pitch: number, radius: number): F {
  const { a, b, fp } = facetCoords();
  const cell = vec2(a, b).div(pitch);
  const d = length(cell.sub(floor(cell).add(0.5)).mul(pitch)) as F;
  const hole = disc(d, radius, fp);
  const share = (Math.PI * radius * radius) / (pitch * pitch);
  const resolved = clamp(float(1.5).sub(fp.div(radius)), 0, 1);
  return float(1).sub(mix(float(share), hole, resolved).mul(0.75)) as F;
}
