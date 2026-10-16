/**
 * Bump from a procedural height (Mikkelsen's surface-gradient bump, screen derivatives), for
 * world-space materials with no tangent frame. The height should already fade to its mean with the
 * pixel footprint, or the derivatives alias. The base is the geometric normal (reading the shaded
 * normal inside a normalNode is circular).
 */
import { cross, dot, normalize, positionView, normalViewGeometry, sign, abs } from 'three/tsl';
import type { Node } from 'three/webgpu';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

/** Perturbed view-space normal for a height field `h` (metres) scaled by `scale`. */
export function heightBump(h: F, scale = 1, base: V3 = normalViewGeometry as unknown as V3): V3 {
  const dpdx = positionView.dFdx();
  const dpdy = positionView.dFdy();
  const r1 = cross(dpdy, base);
  const r2 = cross(base, dpdx);
  const det = dot(dpdx, r1);
  const dhx = h.dFdx().mul(scale);
  const dhy = h.dFdy().mul(scale);
  const grad = sign(det).mul(r1.mul(dhx).add(r2.mul(dhy)));
  return normalize(abs(det).mul(base).sub(grad)) as V3;
}
