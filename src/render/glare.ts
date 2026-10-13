/**
 * Veiling glare from first principles: the image is convolved with the point-spread function of the
 * eye looking through a camera lens. Light scattered in the cornea, lens and retina spreads a fraction of every source over
 * the whole field; a star 90° across therefore floods the view. Nothing here is tuned by eye: the
 * strength and shape come from the PSF and the star's radiance.
 *
 * PSF: Spencer, Shirley, Zimmerman & Greenberg 1995, "Physically-based glare effects for digital
 * images" (photopic), θ in degrees:
 *   f0 = 2.61e6·exp(−(θ/0.02)²)   (the sharp core)
 *   f1 = 20.91 / (θ + 0.02)³
 *   f2 = 72.37 / (θ + 0.02)²
 *   P  = 0.384·f0 + 0.478·f1 + 0.138·f2, normalised to unit integral over the sphere.
 *
 * The lens adds its own halo (scattering in its glass and at its surfaces, the aperture's edge and
 * the sensor stack): here half of every source's light, spread over a few to tens of degrees — a
 * camera looking into a star 90° across, whose light floods the frame so that the scene is made
 * out through a bright veil. The share is a property of this camera, not a free tuning of the
 * scene: the spread is energy-conserving, so what the glow adds the sources lose.
 *
 * Energy within GLARE_CORE_DEG stays in the rendered image (it is the image's own sharpness); the
 * rest is the glare. The star's share is exact and analytic (a 1D table over the angle from the
 * star's centre, because the disc is radially symmetric about the zenith and always in the same
 * place); every other bright source is spread by Gaussians moment-matched to the PSF's annuli.
 */
import { LIMB_DARKENING_EXPONENT } from '../world/radiometry';

/** Angular radius inside which the PSF's energy is left in the image (≈ 2 px at 1080p, 62° FOV). */
export const GLARE_CORE_DEG = 0.1;

const RAD = Math.PI / 180;

/** Unnormalised photopic PSF of the eye (Spencer et al. 1995), θ in degrees. */
export function eyePsfRaw(thetaDeg: number): number {
  const t = thetaDeg;
  const f0 = 2.61e6 * Math.exp(-((t / 0.02) ** 2));
  const f1 = 20.91 / (t + 0.02) ** 3;
  const f2 = 72.37 / (t + 0.02) ** 2;
  return 0.384 * f0 + 0.478 * f1 + 0.138 * f2;
}

/** Lens halo: share of each source's light and its lobes (weights, σ in degrees). */
export const LENS = {
  share: 0.6,
  lobes: [
    { w: 0.6, sigmaDeg: 3.5 },
    { w: 0.32, sigmaDeg: 11 },
    { w: 0.08, sigmaDeg: 30 },
  ],
} as const;

/** ∫ f dΩ over polar angles [a, b] (degrees) by log-spaced quadrature. */
function integrate(f: (t: number) => number, aDeg: number, bDeg: number, moment = 0, steps = 4000): number {
  const lo = Math.log(Math.max(aDeg, 1e-5));
  const hi = Math.log(bDeg);
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const u = lo + ((i + 0.5) / steps) * (hi - lo);
    const t = Math.exp(u);
    const dt = t * ((hi - lo) / steps);
    sum += f(t) * Math.sin(t * RAD) * 2 * Math.PI * dt * RAD * t ** moment;
  }
  return sum;
}

const LENS_NORMS = LENS.lobes.map((l) => integrate((t) => Math.exp(-(t * t) / (2 * l.sigmaDeg * l.sigmaDeg)), 1e-5, 180, 0, 8000));

function lensPsf(thetaDeg: number): number {
  let s = 0;
  LENS.lobes.forEach((l, i) => {
    s += (l.w * Math.exp(-(thetaDeg * thetaDeg) / (2 * l.sigmaDeg * l.sigmaDeg))) / LENS_NORMS[i];
  });
  return s;
}

/** The camera's sharp core (the diffraction-limited image), θ in degrees. */
function coreRaw(thetaDeg: number): number {
  return Math.exp(-((thetaDeg / 0.02) ** 2));
}
const CORE_TOTAL = integrate(coreRaw, 1e-5, 2, 0, 20000);

/**
 * Normalised PSF of the camera (per steradian), θ in degrees: a sharp core and the lens halo. The
 * eye's own PSF (Spencer et al., eyePsfRaw) has a 1/θ² tail that, under a star filling 29 % of the
 * sky, veils every dark surface in the frame grey; a camera lens's halo falls off within a few tens
 * of degrees, so the glow engulfs the star's surroundings while dark structure further off stays
 * dark.
 */
export function eyePsf(thetaDeg: number): number {
  return ((1 - LENS.share) * coreRaw(thetaDeg)) / CORE_TOTAL + LENS.share * lensPsf(thetaDeg);
}

function integrateRaw(aDeg: number, bDeg: number, moment = 0, steps = 4000): number {
  return integrate(eyePsf, aDeg, bDeg, moment, steps);
}

const TOTAL = 1;

/** Fraction of the PSF's energy within [a, b] degrees. */
export function psfEnergy(aDeg: number, bDeg: number): number {
  return integrateRaw(aDeg, bDeg) / TOTAL;
}

/** Fraction of every source's light that stays in the rendered image. */
export const GLARE_CORE_FRACTION = psfEnergy(1e-5, GLARE_CORE_DEG);

/**
 * Screen-space glare for sources other than the star: three Gaussians, each carrying the PSF's
 * energy in one annulus, with σ matched to that annulus's second moment (a 2D Gaussian has
 * E[r²] = 2σ²).
 */
export interface GlareLobe {
  weight: number;
  sigmaDeg: number;
}

export function screenGlareLobes(): GlareLobe[] {
  const edges = [GLARE_CORE_DEG, 0.7, 5, 60];
  const lobes: GlareLobe[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const e = integrateRaw(edges[i], edges[i + 1]);
    const m2 = integrateRaw(edges[i], edges[i + 1], 2);
    lobes.push({ weight: e / TOTAL, sigmaDeg: Math.sqrt(m2 / e / 2) });
  }
  return lobes;
}

/** Star glare table: angle from the star centre (degrees, uniform samples over [0, 180]). */
export const STAR_GLARE_SAMPLES = 1024;

/**
 * Glare from the star's disc at angle θ from its centre, per channel, relative to the disc-centre
 * radiance: G(θ) = ∫_disc P(β)·I(ψ)/I(0) dΩ over directions at least GLARE_CORE_DEG away.
 * Integrated in polar coordinates about the target direction (β log-spaced, so the PSF's steep
 * near field is resolved), with I the wavelength-dependent limb darkening.
 */
export function starGlareAt(thetaDeg: number, starRadiusDeg: number): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  const th = thetaDeg * RAD;
  const sa = Math.sin(starRadiusDeg * RAD);
  const ca = Math.cos(starRadiusDeg * RAD);
  const NB = 160;
  const NP = 96;
  const lo = Math.log(GLARE_CORE_DEG);
  const hi = Math.log(180);
  for (let i = 0; i < NB; i++) {
    const u = lo + ((i + 0.5) / NB) * (hi - lo);
    const bDeg = Math.exp(u);
    const b = bDeg * RAD;
    const dB = bDeg * ((hi - lo) / NB) * RAD;
    const w = eyePsf(bDeg) * Math.sin(b) * dB * (Math.PI / NP) * 2;
    const cb = Math.cos(b);
    const sb = Math.sin(b);
    for (let j = 0; j < NP; j++) {
      const phi = ((j + 0.5) / NP) * Math.PI;
      const cpsi = Math.cos(th) * cb + Math.sin(th) * sb * Math.cos(phi);
      if (cpsi <= ca) continue;
      const spsi = Math.sqrt(Math.max(0, 1 - cpsi * cpsi));
      const mu = Math.sqrt(Math.max(0, 1 - (spsi / sa) ** 2));
      for (let c = 0; c < 3; c++) out[c] += w * Math.pow(mu, LIMB_DARKENING_EXPONENT[c]);
    }
  }
  return out;
}

/** The full table, RGBA (A unused), over θ ∈ [0, 180°]. Coarse samples refined near the limb. */
export function computeStarGlareTable(starRadiusDeg: number): Float32Array {
  // Sample densely near the limb, where G changes fastest, then resample uniformly.
  const coarse: number[] = [];
  for (let t = 0; t <= 180; t += t < starRadiusDeg - 6 || t > starRadiusDeg + 12 ? 1.5 : 0.1) coarse.push(Math.min(t, 180));
  if (coarse[coarse.length - 1] !== 180) coarse.push(180);
  const values = coarse.map((t) => starGlareAt(t, starRadiusDeg));
  const table = new Float32Array(STAR_GLARE_SAMPLES * 4);
  let k = 0;
  for (let i = 0; i < STAR_GLARE_SAMPLES; i++) {
    const t = (i / (STAR_GLARE_SAMPLES - 1)) * 180;
    while (k < coarse.length - 2 && coarse[k + 1] < t) k++;
    const f = Math.min(1, Math.max(0, (t - coarse[k]) / (coarse[k + 1] - coarse[k])));
    for (let c = 0; c < 3; c++) table[i * 4 + c] = values[k][c] * (1 - f) + values[k + 1][c] * f;
    table[i * 4 + 3] = 1;
  }
  return table;
}
