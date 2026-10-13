/**
 * Relief of the collector panels, traced inside the panel layer.
 *
 * The shell is seen at a grazing angle equal to its elevation (a shell point 5° up is seen 5° off
 * its surface), so the lower sky shows the panels almost edge-on. Flat shading reads as plastic
 * there; real structure reads through occlusion: ribs standing proud of recessed bays, their walls
 * catching light, the bays hidden behind them. The height field is a structural grid — primary ribs
 * on the module lattice, and inside each module lower secondary ribs on an irregular quadtree (no
 * countable rhythm: a regular sub-grid reads as a tiled roof) — with each bay set at its own depth. It is ray-marched from the panel's top surface down to the deepest bay floor (bounded
 * steps, then a bisection), only for primary rays, and its amplitude fades to zero where the ribs
 * fall below a pixel, so distant panels are the flat plating they average to.
 *
 * Units: shell radii. Depth is measured outward from the panel's top surface (radius 1 − panelDepth).
 */
import { float, vec2, vec3, If, abs, fract, floor, min, max, smoothstep, length, normalize, dot, cross, asin, atan, clamp, select, mix } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { hash33 } from '../../render/tsl/noise';
import { loop } from '../../render/tsl/helpers';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

/** Bay depth below the rib tops (≈ 1,500 km) and rib half-widths as fractions of the module. */
export const RELIEF = {
  bayDepth: 0.0015,
  ribHalf: 0.018,
  subRibHalf: 0.01,
  subRibDepth: 0.45,
  bevel: 0.5,
  steps: 20,
  refine: 5,
} as const;

/** Panel-local frame fixed at the entry point (constant across the short march). */
export interface PanelFrame {
  /** Longitude of the cell's western bound, its span (radians) and latitude origin. */
  lon0: F;
  lonSpan: F;
  latLow: F;
  /** Module size in arc units (u along longitude·cos lat, v along latitude). */
  module: V2;
  cosLat: F;
  /** Hemisphere sign of the cell. */
  hemi: F;
  seed: F;
}

/** Arc coordinates of a sphere-frame unit vector in the panel frame. */
function panelArc(qn: V3, fr: PanelFrame): V2 {
  const lat = asin(clamp(qn.z.negate(), -1, 1));
  const lon = atan(qn.x, qn.y.negate());
  return vec2(lon.sub(fr.lon0).mul(fr.cosLat), abs(lat).sub(fr.latLow)) as unknown as V2;
}

/** Depth below the rib tops (0 on a rib, up to bayDepth on a bay floor) at arc coordinates a. */
export function reliefDepth(a: V2, fr: PanelFrame, amplitude: F): F {
  const m = a.div(fr.module);
  const cell = floor(m);
  const f = fract(m);
  // Distance to the module's own edge (module units): the primary ribs.
  const dm = min(min(f.x, f.x.oneMinus()), min(f.y, f.y.oneMinus()));
  // Irregular subdivision: split into quarters with chance 0.7, the quarters again with chance 0.45.
  const h0 = hash33(vec3(cell, fr.seed.add(901.0)));
  const s1 = h0.x.lessThan(0.7);
  const c1 = floor(f.mul(2.0));
  const h1 = hash33(vec3(cell.mul(2.0).add(c1), fr.seed.add(917.0)));
  const s2 = s1.and(h1.x.lessThan(0.45));
  const leaf = select(s2, float(4), select(s1, float(2), float(1)));
  const g = fract(f.mul(leaf));
  const dl = min(min(g.x, g.x.oneMinus()), min(g.y, g.y.oneMinus())).div(leaf);
  const leafHash = select(s2, hash33(vec3(cell.mul(4.0).add(floor(f.mul(4.0))), fr.seed.add(931.0))).y, select(s1, h1.y, h0.y));
  const bay = leafHash.mul(0.45).add(0.55);
  // Ribs with bevelled shoulders; secondary ribs stand lower and thinner where they split deeper.
  const rib = float(1).sub(smoothstep(RELIEF.ribHalf, RELIEF.ribHalf * (1 + RELIEF.bevel), dm));
  const subHalf = float(RELIEF.subRibHalf).div(leaf.sqrt());
  const sub = float(1).sub(smoothstep(subHalf, subHalf.mul(1 + RELIEF.bevel), dl)).mul(1 - RELIEF.subRibDepth).mul(select(s1, float(1), float(0)));
  const top = max(rib, sub);
  return float(1).sub(top).mul(bay).mul(amplitude).mul(RELIEF.bayDepth);
}

export interface ReliefHit {
  t: F;
  normal: V3;
  /** Share of the star's 45° cap seen from the hit (1 on rib tops, less deep in a bay near a wall). */
  occlusion: F;
}

/**
 * March the relief from the panel top at tTop (ray o + t·d relative to the sphere centre, top
 * radius rTop). `amplitude` (0..1) scales the relief with how well its ribs are resolved.
 */
export function marchRelief(oc: V3, d: V3, tTop: F, rTop: number, fr: PanelFrame, amplitude: F, flatNormal: V3): ReliefHit {
  const result: ReliefHit = { t: tTop.toVar(), normal: flatNormal.toVar(), occlusion: float(1).toVar() };
  If(amplitude.greaterThan(0.02), () => {
    const p0 = oc.add(d.mul(tTop));
    const rate = max(dot(d, normalize(p0)), 0.03);
    const span = float(RELIEF.bayDepth).mul(amplitude).div(rate).toVar();
    const dt = span.div(RELIEF.steps);
    const lo = float(0).toVar();
    const hi = span.toVar();
    const found = float(0).toVar();
    // Coarse march: first sample below the height field.
    loop('rk', RELIEF.steps, (k) => {
      If(found.lessThan(0.5), () => {
        const t = dt.mul(float(k).add(1.0));
        const p = oc.add(d.mul(tTop.add(t)));
        const below = length(p).sub(rTop);
        const surf = reliefDepth(panelArc(normalize(p), fr), fr, amplitude);
        If(below.greaterThanEqual(surf), () => {
          hi.assign(t);
          lo.assign(t.sub(dt));
          found.assign(1);
        });
      });
    });
    // Bisection between the last sample above and the first below.
    loop('rb', RELIEF.refine, () => {
      const mid = lo.add(hi).mul(0.5);
      const p = oc.add(d.mul(tTop.add(mid)));
      const below = length(p).sub(rTop);
      const surf = reliefDepth(panelArc(normalize(p), fr), fr, amplitude);
      If(below.greaterThanEqual(surf), () => {
        hi.assign(mid);
      }).Else(() => {
        lo.assign(mid);
      });
    });
    result.t.assign(tTop.add(hi));
    // Normal from the height field's gradient in the tangent plane.
    const p = oc.add(d.mul(result.t));
    const qn = normalize(p);
    const east = normalize(vec3(qn.y.negate(), qn.x, 0).add(vec3(1e-6, 0, 0)));
    const north = normalize(cross(qn, east));
    const h = float(0.004).mul(min(fr.module.x, fr.module.y));
    const a0 = panelArc(qn, fr);
    const dE = reliefDepth(panelArc(normalize(qn.add(east.mul(h))), fr), fr, amplitude).sub(reliefDepth(panelArc(normalize(qn.sub(east.mul(h))), fr), fr, amplitude)).div(h.mul(2));
    const dN = reliefDepth(panelArc(normalize(qn.add(north.mul(h))), fr), fr, amplitude).sub(reliefDepth(panelArc(normalize(qn.sub(north.mul(h))), fr), fr, amplitude)).div(h.mul(2));
    // Depth grows outward (along +qn); the inward-facing surface normal is −qn tilted up the slope.
    // Rib walls are dressed (bevelled, not sheer): their facing tilt is held under ~35°, so a wall
    // never mirrors the star into a thin bright slit.
    const grad = east.mul(dE).add(north.mul(dN));
    const g = length(grad);
    const n = normalize(qn.negate().add(grad.mul(min(g, 0.36).div(max(g, 1e-6)))));
    result.normal.assign(select(found.greaterThan(0.5), n, flatNormal));
    // Occlusion of the star's cap: a bay floor sees the whole cap only at more than one bay depth
    // from the nearest rib wall (the cap is 45° in half-angle).
    const depth = reliefDepth(a0, fr, amplitude);
    const m = a0.div(fr.module);
    const f = fract(m);
    const wall = min(min(f.x, f.x.oneMinus()), min(f.y, f.y.oneMinus())).mul(min(fr.module.x, fr.module.y));
    const shade = clamp(depth.div(max(wall, 1e-6)), 0, 1);
    result.occlusion.assign(mix(float(1), float(0.55), shade.mul(smoothstep(0.0, RELIEF.bayDepth * 0.3, depth))));
  });
  return result;
}
