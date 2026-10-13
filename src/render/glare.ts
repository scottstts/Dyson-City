/**
 * Glare: light the eye and the camera spread over the field. A star 90° across floods the frame.
 *
 * Two components:
 *
 *  - The eye's scatter, with the shape of the CIE 180 disability-glare function: a power law with
 *    no characteristic size, concentrated within a degree or two of each source. It is linear: every
 *    source loses the same share to it.
 *  - The camera's bloom (CAMERA_BLOOM): what an overexposed sensor and lens do with light far past
 *    saturation (blooming, halation, lens flare). It acts on the radiance above BLOOM_THRESHOLD, so
 *    the star and its mirror images bloom and ordinary sunlit surfaces stay crisp. It is what makes
 *    the star engulf the frame: the far structure beside the limb dissolves into white light, and
 *    only the lower sky and the ground keep their contrast. It is deliberately strong (the picture
 *    asks for it), but it is a sum of widths spanning 1°–20°, so it has no single size; a lone
 *    Gaussian halo of a few degrees reads as a lamp in haze. It falls off steeply: a veil spread
 *    evenly over the frame lifts every shadow and reads as fog or a dirty lens, not blinding light.
 *
 * Both are energy-conserving: what the glare adds, the sources lose. Energy within GLARE_CORE_DEG
 * stays in the rendered image (it is the image's own sharpness); the rest is the glare. The star's
 * share is exact and analytic (a 1D table over the angle from the star's centre, because the disc
 * is radially symmetric about the zenith and always in the same place); every other source is
 * spread by screen-space Gaussians.
 */
import { LIMB_DARKENING_EXPONENT } from '../world/radiometry';

/** Angular radius inside which the PSF's energy is left in the image (≈ 2 px at 1080p, 62° FOV). */
export const GLARE_CORE_DEG = 0.1;

const RAD = Math.PI / 180;

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

// --- The eye ------------------------------------------------------------------------------------

/**
 * The eye's scatter, with the shape of the CIE 180 general disability-glare function (young eye,
 * average pigmentation): L_veil/E = 10/θ³ + 5/θ² + 0.05/θ + 0.00125 per steradian, θ in degrees.
 */
function scatterRaw(thetaDeg: number): number {
  const t = thetaDeg + 0.05;
  return 10 / t ** 3 + 5 / t ** 2 + 0.05 / t + 0.00125;
}

/** Share of every source's light the eye scatters (the CIE function's own integral). */
export const EYE_SCATTER_SHARE = integrate(scatterRaw, 1e-5, 180, 0, 8000);

/** The sharp core (the diffraction-limited image), θ in degrees. */
function coreRaw(thetaDeg: number): number {
  return Math.exp(-((thetaDeg / 0.02) ** 2));
}
const CORE_TOTAL = integrate(coreRaw, 1e-5, 2, 0, 20000);

/** The eye's normalised PSF (per steradian), θ in degrees: the sharp core plus the scatter. */
export function eyePsf(thetaDeg: number): number {
  return ((1 - EYE_SCATTER_SHARE) * coreRaw(thetaDeg)) / CORE_TOTAL + scatterRaw(thetaDeg);
}

/** Fraction of the eye PSF's energy within [a, b] degrees. */
export function psfEnergy(aDeg: number, bDeg: number, moment = 0, steps = 4000): number {
  return integrate(eyePsf, aDeg, bDeg, moment, steps);
}

/** Fraction of every source's light the eye leaves in the rendered image. */
export const GLARE_CORE_FRACTION = psfEnergy(1e-5, GLARE_CORE_DEG);

/** Outer edge of the eye's screen-space glare; beyond it only the CIE function's faint constant tail remains. */
export const GLARE_SCREEN_MAX_DEG = 60;

/**
 * Screen-space eye glare for sources other than the star: three Gaussians, each carrying the PSF's
 * energy in one annulus, with σ matched to that annulus's second moment (a 2D Gaussian has
 * E[r²] = 2σ²).
 */
export interface GlareLobe {
  weight: number;
  sigmaDeg: number;
}

export function screenGlareLobes(): GlareLobe[] {
  const edges = [GLARE_CORE_DEG, 0.7, 5, GLARE_SCREEN_MAX_DEG];
  const lobes: GlareLobe[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const e = psfEnergy(edges[i], edges[i + 1]);
    const m2 = psfEnergy(edges[i], edges[i + 1], 2);
    lobes.push({ weight: e, sigmaDeg: Math.sqrt(m2 / e / 2) });
  }
  return lobes;
}

// --- The camera ---------------------------------------------------------------------------------

/**
 * The camera's bloom: Gaussian lobes (σ in degrees, share of the light above the threshold).
 * Together they carry ~46 % of it, most within ~10°: beside the star the veil is ~12 % of the disc
 * mean 1° outside the limb, ~6 % at 5°, ~3 % at 10° and ~0.5 % at the horizon.
 */
export const CAMERA_BLOOM: readonly GlareLobe[] = [
  { sigmaDeg: 1, weight: 0.12 },
  { sigmaDeg: 3, weight: 0.15 },
  { sigmaDeg: 8, weight: 0.13 },
  { sigmaDeg: 20, weight: 0.06 },
];

export const CAMERA_BLOOM_SHARE = CAMERA_BLOOM.reduce((s, l) => s + l.weight, 0);

/**
 * Radiance (relative to the star's disc mean) above which the camera blooms. Sunlit stone facing
 * the star reaches ~0.5 of the disc mean and glows only faintly; the star, its glints and its
 * images in the far shell's mirrors bloom fully.
 */
export const BLOOM_THRESHOLD = 0.15;

/** Share of light of luminance `l` that is above the threshold `t` (hue preserved). */
export function bloomExcess(l: number, t: number): number {
  return l > t ? 1 - t / l : 0;
}

const gaussian = (thetaDeg: number, sigmaDeg: number): number => Math.exp(-(thetaDeg * thetaDeg) / (2 * sigmaDeg * sigmaDeg));
const BLOOM_NORMS = CAMERA_BLOOM.map((l) => integrate((t) => gaussian(t, l.sigmaDeg), 1e-5, 180, 0, 8000));

/** The bloom's PSF (per steradian, integrating to CAMERA_BLOOM_SHARE), θ in degrees. */
export function bloomPsf(thetaDeg: number): number {
  let sum = 0;
  for (let i = 0; i < CAMERA_BLOOM.length; i++) sum += (CAMERA_BLOOM[i].weight * gaussian(thetaDeg, CAMERA_BLOOM[i].sigmaDeg)) / BLOOM_NORMS[i];
  return sum;
}

// --- The star -----------------------------------------------------------------------------------

/** Star glare table: angle from the star centre (degrees, uniform samples over [0, 180]). */
export const STAR_GLARE_SAMPLES = 1024;

const REC709 = [0.2126, 0.7152, 0.0722];

/**
 * Glare from the star's disc at angle θ from its centre, per channel, relative to the disc-centre
 * radiance: the eye's share ∫ P_eye(β)·I(ψ)/I(0) dΩ plus the camera's ∫ P_bloom(β)·I_excess(ψ)/I(0) dΩ
 * over directions at least GLARE_CORE_DEG away. Integrated in polar coordinates about the target
 * direction (β log-spaced, so the PSF's steep near field is resolved), with I the
 * wavelength-dependent limb darkening. `thresholdRel` is the bloom threshold relative to the
 * disc-centre radiance.
 */
export function starGlareAt(thetaDeg: number, starRadiusDeg: number, thresholdRel = bloomThresholdRelCentre()): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  const th = thetaDeg * RAD;
  const sa = Math.sin(starRadiusDeg * RAD);
  const ca = Math.cos(starRadiusDeg * RAD);
  const NB = 160;
  const NP = 96;
  const lo = Math.log(GLARE_CORE_DEG);
  const hi = Math.log(180);
  const I = [0, 0, 0];
  for (let i = 0; i < NB; i++) {
    const u = lo + ((i + 0.5) / NB) * (hi - lo);
    const bDeg = Math.exp(u);
    const b = bDeg * RAD;
    const dB = bDeg * ((hi - lo) / NB) * RAD;
    const ring = Math.sin(b) * dB * (Math.PI / NP) * 2;
    const wEye = eyePsf(bDeg) * ring;
    const wBloom = bloomPsf(bDeg) * ring;
    const cb = Math.cos(b);
    const sb = Math.sin(b);
    for (let j = 0; j < NP; j++) {
      const phi = ((j + 0.5) / NP) * Math.PI;
      const cpsi = Math.cos(th) * cb + Math.sin(th) * sb * Math.cos(phi);
      if (cpsi <= ca) continue;
      const spsi = Math.sqrt(Math.max(0, 1 - cpsi * cpsi));
      const mu = Math.sqrt(Math.max(0, 1 - (spsi / sa) ** 2));
      for (let c = 0; c < 3; c++) I[c] = Math.pow(mu, LIMB_DARKENING_EXPONENT[c]);
      const excess = bloomExcess(REC709[0] * I[0] + REC709[1] * I[1] + REC709[2] * I[2], thresholdRel);
      for (let c = 0; c < 3; c++) out[c] += I[c] * (wEye + wBloom * excess);
    }
  }
  return out;
}

/** BLOOM_THRESHOLD relative to the disc-centre radiance (green channel's limb-darkened mean). */
export function bloomThresholdRelCentre(): number {
  return BLOOM_THRESHOLD * (2 / (LIMB_DARKENING_EXPONENT[1] + 2));
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
