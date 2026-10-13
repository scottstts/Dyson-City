/**
 * What the far structure is made of: one fictional refractory alloy (it does not melt at these
 * temperatures; physics is used here only where it shapes the picture) in a few finishes.
 *
 *  - Collector faces: the alloy polished to a warm metallic sheen (F0 ≈ 0.22, a little warm: it
 *    reflects slightly more red than blue). Metallic reflections give the shell its mosaic — each
 *    tile mirrors its own piece of the enclosure, the star near the limb — and brighten it toward the
 *    star; the heat glow (thermal.ts) gives it its dark bronze body and its detail.
 *  - Satin collector faces: the same alloy, rougher.
 *  - Structure (frames, hubs, rails): the alloy, slightly brighter and less polished, running cooler
 *    (it carries load, not heat), so it reads darker than the collectors.
 *  - The Veil's top (the band): a true mirror — its job is to reject the light.
 *
 * Diffuse residue is small: any meaningful diffuse share under a star 90° across lifts dark metal
 * to grey.
 */
type RGB = [number, number, number];

export const COLLECTOR_F0: RGB = [0.2, 0.188, 0.172];
export const COLLECTOR_DIFFUSE: RGB = [0.006, 0.005, 0.004];
export const STRUCTURE_F0: RGB = [0.26, 0.25, 0.235];
export const STRUCTURE_DIFFUSE: RGB = [0.008, 0.007, 0.006];
export const VEIL_F0: RGB = [0.86, 0.86, 0.85];
