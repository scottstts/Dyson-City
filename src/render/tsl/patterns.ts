/**
 * Footprint-filtered pattern primitives for world-space materials (joints, inlay lines, grids).
 * Every function takes the pixel footprint in the pattern's units and degrades to the feature's
 * mean coverage instead of aliasing.
 */
import { float, vec2, abs, fract, floor, min, max, smoothstep } from 'three/tsl';
import type { Node } from 'three/webgpu';

type F = Node<'float'>;
type V2 = Node<'vec2'>;

/** Coverage (0..1) of a band of half-width hw around distance x = 0, area-preserving under blur. */
export function band(x: F, hw: number | F, footprint: F): F {
  const w: F = typeof hw === 'number' ? float(hw) : hw;
  const e = max(footprint, 1e-6);
  const soft = float(1).sub(smoothstep(w.sub(e.mul(0.5)), w.add(e.mul(0.5)), abs(x)));
  return soft.mul(min(w.mul(2).div(e), 1.0));
}

/** Distance to the nearest grid line of a running-bond (stretcher) layout, plus cell id. */
export function runningBond(p: V2, size: V2): { dist: F; id: V2; local: V2 } {
  const row = floor(p.y.div(size.y));
  const offset = fract(row.mul(0.5)).mul(2).mul(size.x.mul(0.5)); // every other row offset by half
  const q = vec2(p.x.add(offset), p.y);
  const cell = floor(q.div(size));
  const local = fract(q.div(size)).mul(size);
  const dx = min(local.x, size.x.sub(local.x));
  const dy = min(local.y, size.y.sub(local.y));
  return { dist: min(dx, dy), id: cell, local };
}

/** Distance to the nearest line of a square grid of period `period`. */
export function gridDistance(p: V2, period: number): F {
  const l = fract(p.div(period)).mul(period);
  const d = min(l, vec2(period).sub(l));
  return min(d.x, d.y);
}

/** Blend a detail value toward its mean as the footprint approaches the feature size. */
export function lodFade(footprint: F, featureSize: number): F {
  return float(1).sub(smoothstep(featureSize * 0.25, featureSize * 0.8, footprint));
}


