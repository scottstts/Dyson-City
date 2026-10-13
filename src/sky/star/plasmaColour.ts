/**
 * Colour of the star's atmospheric plasma (chromosphere, loops, prominences) as the camera records
 * it: a hot-plasma ramp. Faint strands are deep orange-red; as emission grows the camera's red
 * channel saturates first, so denser plasma reads gold and the brightest (dense cores, footpoints,
 * flaring loops) white-gold. The corona is different: it is photosphere light scattered by free
 * electrons, so it keeps the star's own white.
 */
import { mix, smoothstep, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

const PLASMA_FAINT = [1.0, 0.42, 0.1] as const;
const PLASMA_GLOW = [1.0, 0.66, 0.26] as const;
const PLASMA_CORE = [1.0, 0.8, 0.5] as const;

/** Colour of emission of relative strength `i`: deep orange-red, then gold, then white-gold. */
export function plasmaColour(i: F): V3 {
  return mix(mix(vec3(...PLASMA_FAINT), vec3(...PLASMA_GLOW), smoothstep(0.2, 1.0, i)), vec3(...PLASMA_CORE), smoothstep(1.8, 4.5, i)) as unknown as V3;
}
