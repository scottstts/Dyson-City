/**
 * The star's atmosphere: the corona, and the chromosphere at the limb.
 *
 * The corona is the star's photosphere light Thomson-scattered by coronal electrons. Its density
 * falls steeply with height (the Baumbach–Allen profile, n ∝ 2.99 r⁻¹⁶ + 1.55 r⁻⁶ + 0.036 r⁻¹·⁵),
 * and each electron sees the disc diluted by W(r) = ½(1 − √(1 − 1/r²)). The city sits at 1.41 star
 * radii, inside the corona: every sight line from the city runs from shell to shell (or down to the
 * photosphere), so its column depends only on its impact parameter b — a 1D table.
 *
 * It is drawn far brighter than the real K-corona (~10⁻⁶ of the disc, invisible beside it): the
 * star needs a visible atmosphere, and the corona is the one that is really there. Its shape is
 * kept true: brightest hugging the limb, halving every ~3° and fading by the horizon, white (it is
 * scattered photosphere light), structured into radial rays, streamers and polar plumes that turn
 * with the star. The structure is what keeps it from reading as a lamp's halo in haze, a glow of
 * fixed size around a disc.
 *
 * The chromosphere is the thin layer (~2,000 km, with spicules to ~10,000 km) where the photosphere
 * ends: seen edge-on it is a ragged orange-red fringe a fraction of a degree deep, the same plasma
 * that rises into the prominences (plasmaColour.ts).
 *
 * Units: star radii (r = 1 is the photosphere); radiance relative to the disc mean.
 */
import { STAR_RADIUS_R } from '../../world/constants';

/** The observer's (and the shell's) distance from the star centre, in star radii. */
export const OBSERVER_RADIUS = 1 / STAR_RADIUS_R;

/** Coronal radiance just above the limb, relative to the disc mean. */
export const CORONA_LIMB = 0.15;

/** Chromospheric emission at its base seen edge-on (relative to the disc mean), its scale height and the height its spicule tongues reach (star radii). */
export const CHROMOSPHERE = { radiance: 0.9, scaleHeight: 0.0045, flameHeight: 0.012 } as const;

/** Table samples over the impact parameter. */
export const CORONA_SAMPLES = 1024;

export function electronDensity(r: number): number {
  return 2.99 * r ** -16 + 1.55 * r ** -6 + 0.036 * r ** -1.5;
}

export function dilution(r: number): number {
  return 0.5 * (1 - Math.sqrt(Math.max(0, 1 - 1 / (r * r))));
}

/** Unnormalised column of n·W along the sight line of impact parameter b (star radii). */
export function coronaColumnRaw(b: number, steps = 2000): number {
  const ro = OBSERVER_RADIUS;
  if (b >= ro) return 0;
  // On the disc the line ends at the photosphere; off it the line crosses the whole cavity.
  const lo = b < 1 ? Math.sqrt(1 - b * b) : 0;
  const hi = Math.sqrt(ro * ro - b * b);
  // Substitution x = lo + (hi − lo)·s² concentrates samples at the tangent point, where the steep
  // profile peaks.
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const s = (i + 0.5) / steps;
    const x = lo + (hi - lo) * s * s;
    const dx = (hi - lo) * 2 * s / steps;
    const r = Math.hypot(b, x);
    sum += electronDensity(r) * dilution(r) * dx;
  }
  return b < 1 ? sum : 2 * sum;
}

const LIMB_COLUMN = coronaColumnRaw(1 + 1e-7);

/** Coronal radiance (relative to the disc mean) along the sight line of impact parameter b. */
export function coronaColumn(b: number): number {
  return (CORONA_LIMB * coronaColumnRaw(b)) / LIMB_COLUMN;
}

/**
 * Table coordinate for impact parameter b: u = ½ + ½·sign(b − 1)·√(|b − 1| / side), dense at the
 * limb where the column changes fastest.
 */
export function coronaTableU(b: number): number {
  const x = b - 1;
  const side = x < 0 ? 1 : OBSERVER_RADIUS - 1;
  return 0.5 + 0.5 * Math.sign(x) * Math.sqrt(Math.min(Math.abs(x) / side, 1));
}

function coronaTableB(u: number): number {
  const t = (u - 0.5) * 2;
  const side = t < 0 ? 1 : OBSERVER_RADIUS - 1;
  return 1 + Math.sign(t) * t * t * side;
}

/** RGBA float table (r = coronal radiance relative to the disc mean) over u. */
export function computeCoronaTable(): Float32Array {
  const out = new Float32Array(CORONA_SAMPLES * 4);
  for (let i = 0; i < CORONA_SAMPLES; i++) {
    const b = coronaTableB(i / (CORONA_SAMPLES - 1));
    out[i * 4] = coronaColumn(Math.min(Math.max(b, 0), OBSERVER_RADIUS - 1e-6));
    out[i * 4 + 3] = 1;
  }
  return out;
}
