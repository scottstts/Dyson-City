/**
 * Camera exposure and colour: a photograph taken standing on the Girdle.
 *
 * The exposure is set from the key light, the star: its disc mean lands STAR_KEY on the tone curve's
 * input (~4.5 stops over mid-grey), blinding white with its texture just held by the long shoulder
 * (tsl/toneMap.ts). Everything else falls where its radiance puts it: the shell is black glossy
 * metal, so it stays dark except where it mirrors something bright. Metering on the shell instead
 * would lift black metal to grey. The light never changes, so the exposure is fixed — no pumping.
 *
 * White balance is daylight: the star's own ~5,800 K light is white. The Veil is spectrally neutral
 * (a broadband attenuator), so nothing tints the world but the media it is seen through.
 */
import { STAR_CHROMA, luminance } from '../world/radiometry';

/** Tone-curve input that the star's disc-mean luminance maps to. */
export const STAR_KEY = 2.5;

type RGB = readonly [number, number, number];


/** Daylight white-balance gains (unit luminance): the bare star is neutral. */
export function whiteBalanceGains(): [number, number, number] {
  const g = STAR_CHROMA.map((c) => 1 / c);
  const y = luminance(g[0], g[1], g[2]);
  return [g[0] / y, g[1] / y, g[2] / y];
}

/** Linear exposure that maps the star's disc-mean radiance (scene radiance, RGB) to STAR_KEY. */
export function cameraExposure(starDiscMean: RGB, g: RGB): number {
  return STAR_KEY / luminance(starDiscMean[0] * g[0], starDiscMean[1] * g[1], starDiscMean[2] * g[2]);
}
