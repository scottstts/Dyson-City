/**
 * The far Dyson structure inside the sky shader: trace, surface, light.
 *
 * Helpers emit TSL into the caller's Fn stack (plain functions, not Fn), so the sky composition
 * stays one shader with shared intermediates.
 */
import type { Node } from 'three/webgpu';
import { traceStructure, type StructureHit } from './trace';
import { structureSurface } from './surfaces';
import { shadeSurface, type ShellLight } from './shading';

export { MAT, traceStructure, type StructureHit } from './trace';
export type { ShellLight } from './shading';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

/** Radiance of a primary structure hit along view direction d (before the plasma and air). */
export function shadeStructure(hit: StructureHit, d: V3, pixelAngle: F, light: ShellLight, noise: Node<'vec2'>): V3 {
  const pos = d.mul(hit.t).toVar();
  const surf = structureSurface(hit, pos, { d, t: hit.t, pixelAngle, n: hit.normal });
  return shadeSurface(d, pos, surf, light, (o, dir) => traceStructure(o, dir, pixelAngle), noise);
}
