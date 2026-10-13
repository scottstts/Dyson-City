/**
 * Shader side of the interior plasma (plasma.ts): exact single-scattering segment integrals from
 * the (b, x) line table, for any ray inside the sphere — primary view rays and reflection rays.
 */
import { vec2, texture, dot, length, sqrt, max, exp, clamp } from 'three/tsl';
import type { DataTexture, Node } from 'three/webgpu';
import { PLASMA_LUT } from './plasma';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

const W = PLASMA_LUT.width;
const H = PLASMA_LUT.height;

export interface PlasmaSegment {
  /** In-scattered radiance (reference photosphere units; × star illuminant by the caller). */
  S: V3;
  /** Transmittance. */
  T: F;
}

/**
 * Plasma between `oc + t0·d` and `oc + t1·d` (oc relative to the star centre, shell units, d unit).
 */
export function plasmaSegment(tex: DataTexture, oc: V3, d: V3, t0: F | number, t1: F): PlasmaSegment {
  const xo = dot(oc, d);
  const b = clamp(length(oc.sub(d.mul(xo))), 0.0, 1.0);
  const L = sqrt(max(b.mul(b).oneMinus(), 1e-6));
  const u = b.mul((W - 1) / W).add(0.5 / W);
  const vAt = (x: F) => clamp(x.add(L).div(L.mul(2)), 0.0, 1.0).mul((H - 1) / H).add(0.5 / H);
  const a = texture(tex, vec2(u, vAt(xo.add(t0)))) as unknown as Node<'vec4'>;
  const c = texture(tex, vec2(u, vAt(xo.add(t1)))) as unknown as Node<'vec4'>;
  return {
    S: max(c.rgb.sub(a.rgb), 0.0).mul(exp(a.w)) as unknown as V3,
    T: exp(max(c.w.sub(a.w), 0.0).negate()) as unknown as F,
  };
}
