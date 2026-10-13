/**
 * The interior medium: the star's own wind, trapped by the shell.
 *
 * What fills the ~10⁶ km between the city and the far shell? Not air: the habitat's air is held to
 * the band. Not dust: at 1.4 stellar radii any grain sits above ~3,400 K and sublimates. What
 * remains is the stellar wind (1.5·10⁹ kg/s for a Sun-like star) that the shell's magnetic cage
 * holds in: a few centuries of it is ~10¹⁹ kg of fully ionised hydrogen and helium at coronal
 * temperatures, ~10¹² electrons per cm³, densest near the star.
 *
 * How it looks follows from the mechanism. Fully ionised gas has no bound electrons, so there is no
 * Rayleigh scattering (no blue), no absorption bands and no ionisation glow worth the name: its
 * free electrons Thomson-scatter, which is grey — the same for every wavelength — with phase
 * (3/16π)(1 + cos²θ). So the medium glows in the star's own colour, white, in proportion to the
 * column of electrons and the starlight reaching them:
 *
 *  - along lines that graze the star, a bright, continuous corona (no ring);
 *  - across the whole interior, a thin white veil (fillDepth): invisible over the 10⁴ km to the
 *    nearby band, it lifts and softens structure and gaps 10⁶ km away — the aerial perspective of
 *    this enclosure, white where Earth's is blue.
 *
 * The habitat's own air (atmosphere/) is ordinary Rayleigh air, so the lowest few degrees, seen
 * through hundreds of km of it, go blue-grey: two media, two colours, one light.
 *
 * Because star, medium and shell are all spherically symmetric about the star centre, every ray
 * inside the sphere is fixed by its impact parameter b (closest distance to the centre) and its
 * coordinate x along the line (0 at closest approach). Cumulative optical depth τ(b, x) and
 * transmittance-weighted in-scatter Ĩ(b, x) = ∫ J·e^{−τ} dx, both from the near shell crossing,
 * give the exact single-scattering integral of any segment [x0, x1]:
 *
 *     T = e^{−(τ1 − τ0)},   S = e^{τ0}·(Ĩ1 − Ĩ0).
 *
 * Units: shell radii (R = 1), scene radiance (world/radiometry.ts). Pure functions; run in the boot
 * worker and in tests.
 */
import { STAR_RADIUS_R } from '../../world/constants';
import { LIMB_DARKENING_EXPONENT, STAR_CENTER_RADIANCE } from '../../world/radiometry';

export const PLASMA = {
  /** Thomson optical depth along the line of sight that grazes the limb (both halves). */
  limbOpticalDepth: 1.2,
  /** Hydrostatic scale height near the star (shell units; ≈ 70,000 km, a ~2 MK corona). */
  scaleHeight: 0.045,
  /** Share of the grazing optical depth carried by the 1/r² wind tail. */
  windShare: 0.03,
  /**
   * Optical depth per shell radius of path of the thin plasma that fills the whole interior (the
   * wind's slow-moving remainder, held in by the shell's magnetic cage). Over the ~10⁴ km to the
   * nearby band it is invisible; over the ~10⁶ km to the shell near the star it veils and softens
   * — the aerial perspective of this enclosure, and its main cue of distance.
   */
  fillDepth: 0.01,
} as const;

/** LUT layout. u = b ∈ [0, 1]; v = (x + L)/(2L), L = √(1 − b²) (near shell → far shell). */
export const PLASMA_LUT = { width: 384, height: 256, sourceR: 96, sourceMu: 48 } as const;

const S = STAR_RADIUS_R;

/** Unnormalised density profile (hydrostatic + wind). */
function profile(r: number): number {
  const rr = Math.max(r, S);
  return (1 - PLASMA.windShare) * Math.exp(-(rr - S) / PLASMA.scaleHeight) / hydroGrazing + (PLASMA.windShare * (S / rr) ** 2) / windGrazing;
}

/** Grazing line integrals of each unit profile at b = S, so each part carries its share of τ. */
const hydroGrazing = grazingIntegral((r) => Math.exp(-(r - S) / PLASMA.scaleHeight));
const windGrazing = grazingIntegral((r) => (S / r) ** 2);

function grazingIntegral(f: (r: number) => number): number {
  const L = Math.sqrt(1 - S * S);
  const n = 4000;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const x = -L + ((i + 0.5) / n) * 2 * L;
    sum += f(Math.sqrt(S * S + x * x));
  }
  return (sum * 2 * L) / n;
}

/** Extinction coefficient (per shell radius) at radius r. */
export function plasmaExtinction(r: number): number {
  return PLASMA.limbOpticalDepth * profile(r) + PLASMA.fillDepth;
}

/**
 * Source J(r, |μ|) per unit extinction: the phase-weighted radiance incident at radius r for a
 * direction making cos μ with the direction to the star centre. Four channels: the limb-darkened
 * disc (rgb) and the shell's share of the sphere for an isotropic shell of unit radiance (a), which
 * the enclosure solve scales by the shell's actual mean radiance.
 */
export function plasmaSource(): Float32Array {
  const { sourceR: NR, sourceMu: NM } = PLASMA_LUT;
  const out = new Float32Array(NR * NM * 4);
  const NPSI = 48;
  const NPHI = 64;
  for (let ir = 0; ir < NR; ir++) {
    const r = S + ((1 - S) * ir) / (NR - 1);
    const sinA = S / r;
    const cosA = Math.sqrt(Math.max(0, 1 - sinA * sinA));
    const omegaStar = 2 * Math.PI * (1 - cosA);
    for (let im = 0; im < NM; im++) {
      const mu = im / (NM - 1);
      const sv = Math.sqrt(Math.max(0, 1 - mu * mu));
      const acc = [0, 0, 0];
      // Rings of equal solid angle across the disc (uniform in cos ψ).
      for (let i = 0; i < NPSI; i++) {
        const cpsi = 1 - ((i + 0.5) / NPSI) * (1 - cosA);
        const spsi = Math.sqrt(Math.max(0, 1 - cpsi * cpsi));
        // Emergent angle on the star surface for a ray at ψ from the centre direction.
        const sinT = Math.min(1, (r * spsi) / S);
        const muStar = Math.sqrt(Math.max(0, 1 - sinT * sinT));
        const dOmega = ((1 - cosA) * 2 * Math.PI) / (NPSI * NPHI);
        for (let j = 0; j < NPHI; j++) {
          const phi = ((j + 0.5) / NPHI) * 2 * Math.PI;
          const c = mu * cpsi + sv * spsi * Math.cos(phi);
          const phase = (3 / (16 * Math.PI)) * (1 + c * c);
          for (let ch = 0; ch < 3; ch++) acc[ch] += STAR_CENTER_RADIANCE[ch] * Math.pow(muStar, LIMB_DARKENING_EXPONENT[ch]) * phase * dOmega;
        }
      }
      const o = (ir * NM + im) * 4;
      for (let ch = 0; ch < 3; ch++) out[o + ch] = acc[ch];
      // Isotropic shell outside the disc: phase integrates to the shell's solid-angle share.
      out[o + 3] = (4 * Math.PI - omegaStar) / (4 * Math.PI);
    }
  }
  return out;
}

function sampleSource(src: Float32Array, r: number, mu: number, out: number[]): void {
  const { sourceR: NR, sourceMu: NM } = PLASMA_LUT;
  const fr = Math.min(Math.max((r - S) / (1 - S), 0), 1) * (NR - 1);
  const fm = Math.min(Math.max(Math.abs(mu), 0), 1) * (NM - 1);
  const r0 = Math.min(Math.floor(fr), NR - 2);
  const m0 = Math.min(Math.floor(fm), NM - 2);
  const wr = fr - r0;
  const wm = fm - m0;
  for (let c = 0; c < 4; c++) {
    const a = src[(r0 * NM + m0) * 4 + c];
    const b = src[(r0 * NM + m0 + 1) * 4 + c];
    const d = src[((r0 + 1) * NM + m0) * 4 + c];
    const e = src[((r0 + 1) * NM + m0 + 1) * 4 + c];
    out[c] = (a * (1 - wm) + b * wm) * (1 - wr) + (d * (1 - wm) + e * wm) * wr;
  }
}

export interface PlasmaLut {
  /** Per texel: Ĩ from the disc (rgb), τ (a). */
  star: Float32Array;
  /** Per texel: Ĩ from an isotropic shell of unit radiance. */
  iso: Float32Array;
  width: number;
  height: number;
}

/** Cumulative τ and Ĩ along every line of the sphere, from the near shell crossing. */
export function computePlasmaLut(): PlasmaLut {
  const { width: W, height: H } = PLASMA_LUT;
  const src = plasmaSource();
  const star = new Float32Array(W * H * 4);
  const iso = new Float32Array(W * H);
  const J = [0, 0, 0, 0];
  const SUB = 6;
  for (let i = 0; i < W; i++) {
    const b = Math.min(i / (W - 1), 0.99999);
    const L = Math.sqrt(1 - b * b);
    // Inside the star (b < S, |x| < √(S² − b²)) the line is opaque: values hold constant there.
    const xs = b < S ? Math.sqrt(S * S - b * b) : 0;
    let tau = 0;
    const I = [0, 0, 0, 0];
    let xPrev = -L;
    for (let j = 0; j < H; j++) {
      const x = -L + (j / (H - 1)) * 2 * L;
      if (j > 0) {
        const dx = (x - xPrev) / SUB;
        for (let k = 0; k < SUB; k++) {
          const xm = xPrev + (k + 0.5) * dx;
          if (b < S && Math.abs(xm) < xs) continue;
          const r = Math.sqrt(b * b + xm * xm);
          const kExt = plasmaExtinction(r);
          sampleSource(src, r, -xm / r, J);
          const w = Math.exp(-tau) * (1 - Math.exp(-kExt * dx));
          for (let c = 0; c < 4; c++) I[c] += w * J[c];
          tau += kExt * dx;
        }
      }
      xPrev = x;
      const o = (j * W + i) * 4;
      star[o] = I[0];
      star[o + 1] = I[1];
      star[o + 2] = I[2];
      star[o + 3] = tau;
      iso[j * W + i] = I[3];
    }
  }
  return { star, iso, width: W, height: H };
}

/** The LUT for a shell of mean radiance `shellRadiance`: RGBA = (Ĩ rgb, τ). */
export function combinePlasmaLut(lut: PlasmaLut, shellRadiance: readonly [number, number, number]): Float32Array {
  const out = new Float32Array(lut.star.length);
  for (let k = 0; k < lut.iso.length; k++) {
    for (let c = 0; c < 3; c++) out[k * 4 + c] = lut.star[k * 4 + c] + shellRadiance[c] * lut.iso[k];
    out[k * 4 + 3] = lut.star[k * 4 + 3];
  }
  return out;
}

/** CPU segment integral (tests, enclosure solve): in-scatter and transmittance between x0 < x1 on line b. */
export function plasmaSegment(lut: Float32Array, b: number, x0: number, x1: number): { S: [number, number, number]; T: number } {
  const a = lookup(lut, b, x0);
  const c = lookup(lut, b, x1);
  const e = Math.exp(a[3]);
  return {
    S: [Math.max(0, (c[0] - a[0]) * e), Math.max(0, (c[1] - a[1]) * e), Math.max(0, (c[2] - a[2]) * e)],
    T: Math.exp(-(c[3] - a[3])),
  };
}

function lookup(data: Float32Array, b: number, x: number): number[] {
  const { width: W, height: H } = PLASMA_LUT;
  const L = Math.sqrt(Math.max(1 - b * b, 1e-9));
  const fu = Math.min(Math.max(b, 0), 1) * (W - 1);
  const fv = Math.min(Math.max((x + L) / (2 * L), 0), 1) * (H - 1);
  const u0 = Math.min(Math.floor(fu), W - 2);
  const v0 = Math.min(Math.floor(fv), H - 2);
  const wu = fu - u0;
  const wv = fv - v0;
  const out = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const p = data[(v0 * W + u0) * 4 + c];
    const q = data[(v0 * W + u0 + 1) * 4 + c];
    const r = data[((v0 + 1) * W + u0) * 4 + c];
    const s = data[((v0 + 1) * W + u0 + 1) * 4 + c];
    out[c] = (p * (1 - wu) + q * wu) * (1 - wv) + (r * (1 - wu) + s * wu) * wv;
  }
  return out;
}

/**
 * The line through a point `o` (relative to the star centre) along unit `d`: impact parameter and
 * the coordinate of `o` along it.
 */
export function lineCoordinates(o: readonly [number, number, number], d: readonly [number, number, number]): { b: number; x: number } {
  const x = o[0] * d[0] + o[1] * d[1] + o[2] * d[2];
  const px = o[0] - d[0] * x;
  const py = o[1] - d[1] * x;
  const pz = o[2] - d[2] * x;
  return { b: Math.hypot(px, py, pz), x };
}
