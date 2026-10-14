/**
 * Relief of the collector panels, traced inside the panel layer.
 *
 * The shell is seen at a grazing angle equal to its elevation (a shell point 5° up is seen 5° off
 * its surface), so the lower sky shows the panels almost edge-on. Flat shading reads as plastic
 * there; real structure reads through occlusion with an understandable cause: a nearer lip hiding
 * part of a recessed channel, a branch's channel opening into a deeper one. The relief follows the
 * panel's collection network (districts.ts): broad shallow fields, and recessed channels along the
 * cut lines — manifolds wide and deep (~3,000 km across, ~1,500 km deep), branches narrower and
 * shallower — with deeper inlet sumps where a branch meets a larger channel. Only the first
 * `reliefLevels` of the network are cut (the finer branches are shading), and each channel fades out
 * where it falls below a pixel, so distant panels are the flat plating they average to.
 *
 * Rejected: a rib grid on a regular module lattice (and an irregular quadtree inside each module):
 * a coffered ceiling, a countable human-scale rhythm whatever its sub-division.
 *
 * The height field is ray-marched from the panel's top surface (bounded steps, then a bisection),
 * only for primary rays. Units: shell radii; depth is measured outward from the top surface
 * (radius 1 − panelDepth).
 */
import { float, vec3, vec4, If, max, min, smoothstep, length, normalize, dot, cross, asin, atan, clamp, select, mix } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { loop } from '../../render/tsl/helpers';
import { DISTRICTS, channelHalfWidth, descend, panelCoords, reliefDepthIn, sideDistances, type Cell, type PanelCoords } from './districts';

type F = Node<'float'>;
type V3 = Node<'vec3'>;
type V4 = Node<'vec4'>;

export const RELIEF = {
  /** Deepest the field can go: the largest channel, its inlet sump and a field step. */
  maxDepth: 0.0016 * (1 + DISTRICTS.sump) + DISTRICTS.fieldStep,
  /** Widest channel half-width (districts.ts channelHalfWidth): below a few pixels nothing is cut. */
  widest: 0.0016,
  steps: 20,
  refine: 5,
} as const;

/** The panel a march runs in, fixed at the entry point (constant across the short march). */
export interface PanelFrame {
  /** Western bound of the panel's plated span and its width (longitude, radians). */
  lon0: F;
  lonSpan: F;
  seed: F;
  /** Pixel footprint at the entry (arc units): channels narrower than a pixel are not cut. */
  fp: F;
  /** 0..1: the relief's amplitude (it flattens toward the panel's rim). */
  amp: F;
}

function coordsAt(qn: V3, fr: PanelFrame): PanelCoords {
  const lat = asin(clamp(qn.z.negate(), -1, 1));
  const lon = atan(qn.x, qn.y.negate());
  return panelCoords(lon, lat.abs(), fr.lon0, fr.lonSpan, fr.seed);
}

/** Depth below the top surface at a sphere-frame unit vector, within `cell`. */
function depthAt(qn: V3, fr: PanelFrame, cell: Cell) {
  const c = coordsAt(qn, fr);
  const r = reliefDepthIn(c, cell, fr.fp);
  return { depth: r.depth.mul(fr.amp), channel: r.channel, c };
}

export interface ReliefHit {
  t: F;
  normal: V3;
  /** Share of the star's 45° cap seen from the hit (1 on the face, less in a channel near its walls). */
  occlusion: F;
}

/** Whether the relief is worth marching at all for a panel hit with this frame. */
export function reliefActive(fr: PanelFrame): Node<'bool'> {
  const w = RELIEF.widest;
  return fr.amp.mul(float(1).sub(smoothstep(w * 1.2, w * 3.0, fr.fp))).greaterThan(0.02);
}

/** The smallest margin by which a point (its side distances) clears the cell's channels (negative: in or near one). */
function clearance(d: { outer: V4; inner: V4 }, cell: Cell): F {
  // Twice a channel's half-width also clears the inlet sumps (centred at 0.9 hw, radius 0.9 hw).
  const reach = (S: V4) => vec4(channelHalfWidth(S.x), channelHalfWidth(S.y), channelHalfWidth(S.z), channelHalfWidth(S.w)).mul(2.0);
  const m = d.outer.sub(reach(cell.side)).min(d.inner.sub(reach(cell.iside)));
  return min(min(m.x, m.y), min(m.z, m.w));
}

/**
 * March the relief from the panel top at tTop (ray o + t·d relative to the sphere centre, top radius
 * rTop). The march runs only as far as the deepest the field goes, a short stretch of the surface
 * (~0.01 shell radii at 10° elevation; relief cells are 0.1–0.3), so it runs in the entry point's
 * cell throughout, found once: past the cell's edge it still meets the shared bounding channel
 * (channels are symmetric about their lines), and the next cell's own lines lie much further in.
 * Where the stretch clears every channel of the cell (they line its edges) the surface is the cell's
 * flat field and the hit is closed-form. Rejected: a descent per march sample, whose register
 * pressure alone cost ~4 ms at 1080p across the whole sky shader.
 */
export function marchRelief(oc: V3, d: V3, tTop: F, rTop: number, fr: PanelFrame, flatNormal: V3): ReliefHit {
  const result: ReliefHit = { t: tTop.toVar(), normal: flatNormal.toVar(), occlusion: float(1).toVar() };
  If(reliefActive(fr), () => {
    const p0 = oc.add(d.mul(tTop));
    const rate = max(dot(d, normalize(p0)), 0.03);
    const span = float(RELIEF.maxDepth).mul(fr.amp).div(rate).toVar();
    const c0 = coordsAt(normalize(p0), fr);
    const c1 = coordsAt(normalize(oc.add(d.mul(tTop.add(span)))), fr);
    const cell = descend(c0, DISTRICTS.reliefLevels);
    const d1 = sideDistances(c1, cell);
    const m1 = d1.outer.min(d1.inner);
    const stays = min(min(m1.x, m1.y), min(m1.z, m1.w)).greaterThanEqual(0.0);
    const clear = stays.and(min(clearance(sideDistances(c0, cell), cell), clearance(d1, cell)).greaterThan(0.0));
    If(clear, () => {
      // The flat field: the hit is where the ray reaches the field's depth.
      result.t.assign(tTop.add(cell.hash.z.mul(DISTRICTS.fieldStep).mul(fr.amp).div(rate)));
    }).Else(() => {
      const lo = float(0).toVar();
      const hi = span.toVar();
      const found = float(0).toVar();
      const dt = span.div(RELIEF.steps);
      const depth = (p: V3) => depthAt(normalize(p), fr, cell).depth;
      // Coarse march: first sample below the height field.
      loop('rk', RELIEF.steps, (k) => {
        If(found.lessThan(0.5), () => {
          const t = dt.mul(float(k).add(1.0));
          const p = oc.add(d.mul(tTop.add(t)));
          If(length(p).sub(rTop).greaterThanEqual(depth(p)), () => {
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
        If(length(p).sub(rTop).greaterThanEqual(depth(p)), () => {
          hi.assign(mid);
        }).Else(() => {
          lo.assign(mid);
        });
      });
      result.t.assign(tTop.add(hi));
      const qn = normalize(oc.add(d.mul(result.t)));
      // Normal from the height field's gradient in the tangent plane, within the hit's own cell.
      const east = normalize(vec3(qn.y.negate(), qn.x, 0).add(vec3(1e-6, 0, 0)));
      const north = normalize(cross(qn, east));
      const h = float(2e-5);
      const at = (v: V3) => depthAt(normalize(v), fr, cell).depth;
      const dE = at(qn.add(east.mul(h))).sub(at(qn.sub(east.mul(h)))).div(h.mul(2));
      const dN = at(qn.add(north.mul(h))).sub(at(qn.sub(north.mul(h)))).div(h.mul(2));
      // Depth grows outward (along +qn); the inward-facing surface normal is −qn tilted up the slope.
      // Channel walls are dressed (bevelled, not sheer): their facing tilt is held under ~20°, so a
      // wall never mirrors the star into a thin bright slit.
      const grad = east.mul(dE).add(north.mul(dN));
      const g = length(grad);
      const n = normalize(qn.negate().add(grad.mul(min(g, 0.36).div(max(g, 1e-6)))));
      result.normal.assign(select(found.greaterThan(0.5), n, flatNormal));
      // The star's cap (45° in half-angle) seen from a channel floor: each wall blocks the directions
      // steeper than its distance over its height, (1 − g)/2 of the cap for g = distance/height < 1.
      const ch = depthAt(qn, fr, cell).channel;
      const height = max(ch.depth.mul(fr.amp), 1e-7);
      const gNear = max(ch.hw.sub(ch.dist), 0.0).div(height);
      const gFar = ch.hw.add(ch.dist).div(height);
      const blocked = clamp(float(1).sub(gNear).mul(0.5), 0, 0.5).add(clamp(float(1).sub(gFar).mul(0.5), 0, 0.5));
      const inChannel = smoothstep(0.0, RELIEF.maxDepth * 0.1, ch.depth.mul(fr.amp));
      result.occlusion.assign(mix(float(1), float(1).sub(blocked).max(0.25), inChannel));
    });
  });
  return result;
}
