/**
 * The scene pass's normal attachment (render/pipeline.ts): the packed view normal, and in alpha the
 * pixel's contact-AO weight (how much GTAO darkens it).
 *
 *  - 1 by default.
 *  - 0 for baked light that already holds its occlusion (the house's lightmaps).
 *  - 0 for glass: a thin pane drawn over another surface, whose own normal would misguide GTAO for
 *    what is behind it.
 */
import { vec4, packNormalToRGB, normalView } from 'three/tsl';
import type { Node } from 'three/webgpu';

export function contactAO(weight: number): Node<'vec4'> {
  return vec4(packNormalToRGB(normalView), weight) as unknown as Node<'vec4'>;
}

/** The normal attachment of a material that takes no contact AO. */
export const noContactAO = (): Node<'vec4'> => contactAO(0);
