/**
 * One radiance scale for the whole world. Every emitter, reflector and the atmosphere use these
 * numbers; the camera (exposure, filter tint, white balance) is the only thing that maps them to
 * the screen.
 *
 * Units are arbitrary but linear: the photosphere at disc centre has luminance STAR_LUMINANCE.
 * Colours are linear Rec.709/sRGB primaries.
 */

/** Disc-centre luminance of the photosphere (scene units). */
export const STAR_LUMINANCE = 10;

/** 5772 K blackbody in linear sRGB, normalised to unit luminance. */
export const STAR_CHROMA: readonly [number, number, number] = normaliseLuminance([1.1374, 1.0, 0.9343]);

/** Disc-centre photosphere radiance per channel. */
export const STAR_CENTER_RADIANCE: readonly [number, number, number] = [
  STAR_CHROMA[0] * STAR_LUMINANCE,
  STAR_CHROMA[1] * STAR_LUMINANCE,
  STAR_CHROMA[2] * STAR_LUMINANCE,
];

/**
 * Wavelength-dependent limb darkening, I(μ)/I(1) = μ^a (Hestroffer & Magnan 1998 power law,
 * a = −0.023 + 0.292/λ[µm], evaluated at ~650/550/450 nm). Gives the white-gold centre and the
 * deep orange limb.
 */
export const LIMB_DARKENING_EXPONENT: readonly [number, number, number] = [0.426, 0.508, 0.626];

export function limbDarkening(mu: number, channel: 0 | 1 | 2): number {
  return Math.pow(Math.max(mu, 0), LIMB_DARKENING_EXPONENT[channel]);
}

/** Mean of μ^a over the projected disc: ∫ μ^a 2μ dμ = 2 / (a + 2). */
export function discAverageLimbFactor(channel: 0 | 1 | 2): number {
  return 2 / (LIMB_DARKENING_EXPONENT[channel] + 2);
}

/**
 * Projected-disc mean radiance of the white-light photosphere: the source the atmosphere LUTs are
 * integrated with. The star's actual (measured) illuminant is expressed relative to this.
 */
export const STAR_DISC_MEAN_RADIANCE: readonly [number, number, number] = [0, 1, 2].map((i) => (STAR_CENTER_RADIANCE[i] * 2) / (LIMB_DARKENING_EXPONENT[i] + 2)) as unknown as [number, number, number];

/** Mean albedo of the bare Girdle deck (used by atmosphere ground bounce and distant shading). */
export const DECK_MEAN_ALBEDO: readonly [number, number, number] = [0.075, 0.073, 0.071];

export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function normaliseLuminance(c: [number, number, number]): [number, number, number] {
  const y = luminance(c[0], c[1], c[2]);
  return [c[0] / y, c[1] / y, c[2] / y];
}
