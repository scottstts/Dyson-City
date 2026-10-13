/**
 * Camera exposure and colour: a photograph taken standing on the Girdle.
 *
 * The exposure is set from the key light, the star: its disc mean lands STAR_KEY on the tone curve's
 * input (~4.3 stops over mid-grey). The star is blinding, white-hot, its granulation, limb darkening
 * and spots only just held by the long shoulder (tsl/toneMap.ts); stone facing it is ~1 stop under
 * the disc and burns near white, as ground under a sun this close should. Everything else falls where its radiance puts it: the shell
 * is dark warm metal, so it stays dark except where it mirrors something bright or glows with heat.
 * Metering on the shell instead would lift dark metal to grey. The light never changes, so the
 * exposure is fixed — no pumping.
 *
 * White balance is standard daylight (D65, sRGB's own white), as a camera set to "daylight" would
 * have it. The star is a 5,772 K body, a little cooler than D65, so its light — and everything it
 * lights — reads hot cream-white: one coherent warm cast for the whole frame, carried by the light
 * itself rather than a grade. (Balancing on the star made it, and the world, a neutral grey-white:
 * an overcast day, not a sun.) The Veil is spectrally neutral, so nothing else tints the world but
 * the media it is seen through.
 */
import { luminance } from '../world/radiometry';

/** Tone-curve input that the star's disc-mean luminance maps to. */
export const STAR_KEY = 4.4;

type RGB = readonly [number, number, number];


/** Chromaticity the camera renders as white (linear sRGB, unit luminance): D65. */
export const CAMERA_WHITE: RGB = [1, 1, 1];

/** White-balance gains (unit luminance) that render CAMERA_WHITE neutral. */
export function whiteBalanceGains(): [number, number, number] {
  const g = CAMERA_WHITE.map((c) => 1 / c);
  const y = luminance(g[0], g[1], g[2]);
  return [g[0] / y, g[1] / y, g[2] / y];
}

/** Linear exposure that maps the star's disc-mean radiance (scene radiance, RGB) to STAR_KEY. */
export function cameraExposure(starDiscMean: RGB, g: RGB): number {
  return STAR_KEY / luminance(starDiscMean[0] * g[0], starDiscMean[1] * g[1], starDiscMean[2] * g[2]);
}
