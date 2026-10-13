/**
 * The universe outside, seen through the gaps in the structure: the baked diffuse sky (the Milky
 * Way, dust and nebulae; field.ts, bake.ts) and the analytic point stars (stars.ts). Directions are
 * in frame coordinates (structure/spin.ts), so the sky turns with the frame as the band carries the
 * observer round.
 *
 * Its brightness is a deliberate departure from radiometry: at a daylight exposure a real sky
 * beyond the shell would be black. It is lifted until the stars and nebulae read through the air in
 * front of the openings (the veil there is ~0.07 in scene radiance): the moving sky is the cue that
 * the band turns.
 */
import { cubeTexture, log2, max, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { SPACE_TEXEL, type SpaceBackdrop } from './bake';
import { starRadiance } from './stars';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

/** The baked diffuse sky (no point stars) toward frame direction d, at an explicit level of detail. */
export function spaceBackdropRadiance(backdrop: SpaceBackdrop, d: V3, lod: F): V3 {
  return vec3(cubeTexture(backdrop.texture, d).level(lod).rgb) as unknown as V3;
}

export function spaceRadiance(backdrop: SpaceBackdrop, d: V3, pixelAngle: F): V3 {
  // Explicit level of detail from the pixel footprint (derivatives are unreliable across the sky's
  // branches).
  const lod = max(log2(pixelAngle.div(SPACE_TEXEL)), 0.0);
  return spaceBackdropRadiance(backdrop, d, lod).add(starRadiance(d, pixelAngle)) as unknown as V3;
}
