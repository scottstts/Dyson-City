/**
 * Boot-time atmosphere precompute for the concave band geometry.
 *
 * The observer and the star are fixed relative to each other (eternal day, the star always at the
 * zenith), so every view-dependent atmospheric quantity is static and is integrated once:
 *
 *  1. J(h, μ): in-scatter source at altitude h toward a view direction making cos μ with the local
 *     "up" (toward the star centre). Single scattering integrates the whole limb-darkened 90° star
 *     cap with Rayleigh + Cornette–Shanks phase functions and per-direction transmittance; a
 *     Hillaire-style isotropic multiple-scattering term is added.
 *  2. Sky view: for each view direction, in-scatter and transmittance along the ray up to where it
 *     leaves the near air. (The far Girdle's air lies under the Veil's mirrored top and is never
 *     seen from here.)
 *  3. Aerial perspective for local geometry as a function of view elevation and distance.
 *
 * Pure functions on Float64 maths; runs in a worker at boot and in unit tests.
 */

import { SHELL_RADIUS_KM, STAR_ANGULAR_RADIUS } from '../world/constants';
import { LIMB_DARKENING_EXPONENT, STAR_CENTER_RADIANCE } from '../world/radiometry';
import { ATMOSPHERE, LUT, type AtmosphereParams } from './params';

const R = SHELL_RADIUS_KM;
const PI = Math.PI;

export interface AtmosphereLuts {
  /** Sky view, local segment: RGB in-scatter + RGB transmittance, interleaved as 6 floats per texel. */
  readonly skyLocal: Float32Array;
  /** Aerial perspective: 6 floats per texel (in-scatter RGB, transmittance RGB). */
  readonly aerial: Float32Array;
  /** Source J(h, μ), 3 floats per texel (for diagnostics/tests). */
  readonly source: Float32Array;
  /** Multiple-scattering luminance Ψ(h) per channel, sampled on the source altitude grid. */
  readonly multiScatter: Float32Array;
  /** Irradiance on a horizontal surface at the deck from the star (attenuated), RGB. */
  readonly groundIrradiance: [number, number, number];
  /** Irradiance on a horizontal surface at the deck from the scattered sky light, RGB. */
  readonly skyIrradiance: [number, number, number];
}

// ---------------------------------------------------------------------------------------------
// Medium

interface Medium {
  scattering: [number, number, number];
  extinction: [number, number, number];
  rayleigh: number;
  mie: number;
}

export function densityRayleigh(p: AtmosphereParams, h: number): number {
  return h >= p.top ? 0 : Math.exp(-Math.max(h, 0) / p.rayleighScaleHeight);
}

export function densityMie(p: AtmosphereParams, h: number): number {
  return h >= p.top ? 0 : Math.exp(-Math.max(h, 0) / p.mieScaleHeight);
}

export function densityOzone(p: AtmosphereParams, h: number): number {
  return Math.max(0, 1 - Math.abs(h - p.ozoneCenter) / p.ozoneHalfWidth);
}

function medium(p: AtmosphereParams, h: number, out: Medium): Medium {
  const r = densityRayleigh(p, h);
  const m = densityMie(p, h);
  const o = h >= p.top ? 0 : densityOzone(p, h);
  for (let c = 0; c < 3; c++) {
    const rs = p.rayleighScattering[c] * r;
    const ms = p.mieScattering[c] * m;
    out.scattering[c] = rs + ms;
    out.extinction[c] = rs + p.mieExtinction[c] * m + p.ozoneAbsorption[c] * o;
  }
  out.rayleigh = r;
  out.mie = m;
  return out;
}

const newMedium = (): Medium => ({ scattering: [0, 0, 0], extinction: [0, 0, 0], rayleigh: 0, mie: 0 });

/** Vertical optical depth from altitude h to the top, per channel (analytic exponentials + numeric ozone). */
export function verticalOpticalDepth(p: AtmosphereParams, h: number, out: [number, number, number]): [number, number, number] {
  const hh = Math.max(h, 0);
  const er = p.rayleighScaleHeight * (Math.exp(-hh / p.rayleighScaleHeight) - Math.exp(-p.top / p.rayleighScaleHeight));
  const em = p.mieScaleHeight * (Math.exp(-hh / p.mieScaleHeight) - Math.exp(-p.top / p.mieScaleHeight));
  const oz = ozoneColumn(p, hh);
  for (let c = 0; c < 3; c++) {
    out[c] = p.rayleighScattering[c] * er + p.mieExtinction[c] * em + p.ozoneAbsorption[c] * oz;
  }
  return out;
}

function ozoneColumn(p: AtmosphereParams, h: number): number {
  // ∫_h^∞ tent(h') dh' for a symmetric tent of half-width w centred at c.
  const c = p.ozoneCenter;
  const w = p.ozoneHalfWidth;
  const full = w; // area of the tent
  const lo = c - w;
  const hi = c + w;
  if (h <= lo) return full;
  if (h >= hi) return 0;
  if (h <= c) {
    const x = h - lo;
    return full - (x * x) / (2 * w);
  }
  const x = hi - h;
  return (x * x) / (2 * w);
}

// ---------------------------------------------------------------------------------------------
// Phase functions

export function phaseRayleigh(cosTheta: number): number {
  return (3 / (16 * PI)) * (1 + cosTheta * cosTheta);
}

export function phaseMie(cosTheta: number, g: number): number {
  const g2 = g * g;
  const k = (3 / (8 * PI)) * ((1 - g2) / (2 + g2));
  return (k * (1 + cosTheta * cosTheta)) / Math.pow(1 + g2 - 2 * g * cosTheta, 1.5);
}

// ---------------------------------------------------------------------------------------------
// Star cap quadrature (directions around local up)

interface CapSample {
  cosT: number;
  sinT: number;
  phi: number;
  weight: number; // solid angle
  radiance: [number, number, number]; // limb-darkened star radiance in this direction
}

export function buildCapQuadrature(nTheta = 40, nPhi = 96): CapSample[] {
  const alpha = STAR_ANGULAR_RADIUS;
  const sinA = Math.sin(alpha);
  const samples: CapSample[] = [];
  // Uniform in cosθ (equal solid angle rings) for stable weights.
  const cosMin = Math.cos(alpha);
  for (let i = 0; i < nTheta; i++) {
    const c = 1 - ((i + 0.5) / nTheta) * (1 - cosMin);
    const s = Math.sqrt(1 - c * c);
    const sinRatio = Math.min(1, s / sinA);
    const muStar = Math.sqrt(Math.max(0, 1 - sinRatio * sinRatio));
    const radiance: [number, number, number] = [0, 0, 0];
    for (let ch = 0; ch < 3; ch++) radiance[ch] = STAR_CENTER_RADIANCE[ch] * Math.pow(muStar, LIMB_DARKENING_EXPONENT[ch]);
    for (let j = 0; j < nPhi; j++) {
      samples.push({
        cosT: c,
        sinT: s,
        phi: ((j + 0.5) / nPhi) * 2 * PI,
        weight: ((1 - cosMin) * 2 * PI) / (nTheta * nPhi),
        radiance,
      });
    }
  }
  return samples;
}

/**
 * Quadrature over the whole upper hemisphere for a given light field (radiance by cos θ from the
 * zenith): the star cap and the shell around it, as filtered by the Veil. Rings are denser near the
 * star's limb, where the field changes fastest.
 */
export function buildSkyQuadrature(light: (cosTheta: number, out: [number, number, number]) => void, nTheta = 120, nPhi = 64): CapSample[] {
  const samples: CapSample[] = [];
  const alpha = STAR_ANGULAR_RADIUS;
  // Ring edges in θ: fine just around the limb, coarser elsewhere.
  const edges: number[] = [];
  for (let i = 0; i <= nTheta; i++) {
    const u = i / nTheta;
    // Map u to θ with density peaked at the limb.
    const t = u < 0.5 ? alpha * Math.pow(u / 0.5, 0.6) : alpha + (PI / 2 - alpha) * Math.pow((u - 0.5) / 0.5, 1.6);
    edges.push(t);
  }
  for (let i = 0; i < nTheta; i++) {
    const t0 = edges[i];
    const t1 = edges[i + 1];
    const c = Math.cos(0.5 * (t0 + t1));
    const s = Math.sqrt(1 - c * c);
    const radiance: [number, number, number] = [0, 0, 0];
    light(c, radiance);
    const ring = 2 * PI * (Math.cos(t0) - Math.cos(t1));
    for (let j = 0; j < nPhi; j++) {
      samples.push({ cosT: c, sinT: s, phi: ((j + 0.5) / nPhi) * 2 * PI, weight: ring / nPhi, radiance });
    }
  }
  return samples;
}

/** Irradiance on a surface facing local up at altitude h (attenuated light field), RGB. */
export function capIrradiance(p: AtmosphereParams, h: number, cap: CapSample[]): [number, number, number] {
  const tau: [number, number, number] = [0, 0, 0];
  verticalOpticalDepth(p, h, tau);
  const e: [number, number, number] = [0, 0, 0];
  for (const s of cap) {
    for (let c = 0; c < 3; c++) e[c] += s.radiance[c] * Math.exp(-tau[c] / s.cosT) * s.cosT * s.weight;
  }
  return e;
}

// ---------------------------------------------------------------------------------------------
// Source LUT J(h, μ) and multiple scattering Ψ(h)

export function sourceAltitude(p: AtmosphereParams, y: number): number {
  return p.top * y * y;
}

function sourceY(p: AtmosphereParams, h: number): number {
  return Math.sqrt(Math.min(Math.max(h, 0), p.top) / p.top);
}

/** Ψ_ms(h): Hillaire 2020 isotropic multiple-scattering transfer, flat-stratified. */
export function computeMultiScatter(p: AtmosphereParams, cap: CapSample[]): Float32Array {
  const nH = LUT.sourceH;
  const out = new Float32Array(nH * 3);
  const nDir = 64;
  const steps = 48;
  const med = newMedium();
  const tau: [number, number, number] = [0, 0, 0];
  const groundE = capIrradiance(p, 0, cap);

  // Isotropic in-scatter illumination at altitude h: (1/4π) ∫cap L T dω.
  const isoCache = new Map<number, [number, number, number]>();
  const iso = (h: number): [number, number, number] => {
    const key = Math.round(h * 1000);
    let v = isoCache.get(key);
    if (v) return v;
    verticalOpticalDepth(p, h, tau);
    v = [0, 0, 0];
    for (const s of cap) for (let c = 0; c < 3; c++) v[c] += (s.radiance[c] * Math.exp(-tau[c] / s.cosT) * s.weight) / (4 * PI);
    isoCache.set(key, v);
    return v;
  };

  for (let ih = 0; ih < nH; ih++) {
    const h0 = sourceAltitude(p, (ih + 0.5) / nH);
    const L2 = [0, 0, 0];
    const fms = [0, 0, 0];
    for (let k = 0; k < nDir; k++) {
      // Fibonacci sphere direction; only its vertical component matters (flat stratification).
      const mu = 1 - (2 * (k + 0.5)) / nDir;
      let tMax: number;
      let hitsGround = false;
      if (mu > 1e-4) tMax = (p.top - h0) / mu;
      else if (mu < -1e-4) {
        tMax = h0 / -mu;
        hitsGround = true;
      } else tMax = 4000;
      tMax = Math.min(tMax, 4000);
      const T = [1, 1, 1];
      const L = [0, 0, 0];
      const F = [0, 0, 0];
      let tPrev = 0;
      for (let i = 0; i < steps; i++) {
        const x = (i + 1) / steps;
        const t = tMax * x * x;
        const dt = t - tPrev;
        const tm = 0.5 * (t + tPrev);
        tPrev = t;
        const h = h0 + tm * mu;
        medium(p, h, med);
        const s = iso(h);
        for (let c = 0; c < 3; c++) {
          const ext = Math.max(med.extinction[c], 1e-9);
          const stepT = Math.exp(-ext * dt);
          const integ = (1 - stepT) / ext;
          L[c] += T[c] * med.scattering[c] * s[c] * integ;
          F[c] += T[c] * med.scattering[c] * integ;
          T[c] *= stepT;
        }
      }
      if (hitsGround) {
        for (let c = 0; c < 3; c++) L[c] += T[c] * (p.groundAlbedo[c] / PI) * groundE[c];
      }
      for (let c = 0; c < 3; c++) {
        L2[c] += L[c] / nDir;
        // f_ms carries the isotropic phase (1/4π) integrated over the sphere: average of F/… × 1.
        fms[c] += F[c] / nDir;
      }
    }
    for (let c = 0; c < 3; c++) out[ih * 3 + c] = L2[c] / Math.max(1e-6, 1 - Math.min(fms[c], 0.999));
  }
  return out;
}

export function computeSource(p: AtmosphereParams, cap: CapSample[], multiScatter: Float32Array): Float32Array {
  const nMu = LUT.sourceMu;
  const nH = LUT.sourceH;
  const out = new Float32Array(nMu * nH * 3);
  const med = newMedium();
  const tau: [number, number, number] = [0, 0, 0];
  for (let ih = 0; ih < nH; ih++) {
    const y = ih / (nH - 1);
    const h = sourceAltitude(p, y);
    medium(p, h, med);
    verticalOpticalDepth(p, h, tau);
    // Pre-attenuated cap radiance for this altitude.
    const lr = new Float64Array(cap.length * 3);
    for (let k = 0; k < cap.length; k++) {
      for (let c = 0; c < 3; c++) lr[k * 3 + c] = cap[k].radiance[c] * Math.exp(-tau[c] / cap[k].cosT) * cap[k].weight;
    }
    const ms = msAt(multiScatter, y, nH);
    for (let im = 0; im < nMu; im++) {
      const mu = -1 + (2 * im) / (nMu - 1);
      const sv = Math.sqrt(Math.max(0, 1 - mu * mu));
      let rr = 0;
      let rg = 0;
      let rb = 0;
      let mr = 0;
      let mg = 0;
      let mb = 0;
      for (let k = 0; k < cap.length; k++) {
        const s = cap[k];
        const cosScatter = mu * s.cosT + sv * s.sinT * Math.cos(s.phi);
        const pr = phaseRayleigh(cosScatter);
        const pm = phaseMie(cosScatter, p.mieG);
        rr += lr[k * 3] * pr;
        rg += lr[k * 3 + 1] * pr;
        rb += lr[k * 3 + 2] * pr;
        mr += lr[k * 3] * pm;
        mg += lr[k * 3 + 1] * pm;
        mb += lr[k * 3 + 2] * pm;
      }
      const o = (ih * nMu + im) * 3;
      const rS = p.rayleighScattering;
      const mS = p.mieScattering;
      out[o] = rS[0] * med.rayleigh * rr + mS[0] * med.mie * mr + med.scattering[0] * ms[0];
      out[o + 1] = rS[1] * med.rayleigh * rg + mS[1] * med.mie * mg + med.scattering[1] * ms[1];
      out[o + 2] = rS[2] * med.rayleigh * rb + mS[2] * med.mie * mb + med.scattering[2] * ms[2];
    }
  }
  return out;
}

function msAt(ms: Float32Array, y: number, nH: number): [number, number, number] {
  const f = Math.min(Math.max(y * nH - 0.5, 0), nH - 1);
  const i0 = Math.floor(f);
  const i1 = Math.min(i0 + 1, nH - 1);
  const w = f - i0;
  return [0, 1, 2].map((c) => ms[i0 * 3 + c] * (1 - w) + ms[i1 * 3 + c] * w) as [number, number, number];
}

/** Bilinear lookup of J(h, μ). */
export function sampleSource(p: AtmosphereParams, src: Float32Array, h: number, mu: number, out: [number, number, number]): [number, number, number] {
  const nMu = LUT.sourceMu;
  const nH = LUT.sourceH;
  const fx = ((Math.min(Math.max(mu, -1), 1) + 1) / 2) * (nMu - 1);
  const fy = sourceY(p, h) * (nH - 1);
  const x0 = Math.min(Math.floor(fx), nMu - 2);
  const y0 = Math.min(Math.floor(fy), nH - 2);
  const wx = fx - x0;
  const wy = fy - y0;
  for (let c = 0; c < 3; c++) {
    const a = src[(y0 * nMu + x0) * 3 + c];
    const b = src[(y0 * nMu + x0 + 1) * 3 + c];
    const d = src[((y0 + 1) * nMu + x0) * 3 + c];
    const e = src[((y0 + 1) * nMu + x0 + 1) * 3 + c];
    out[c] = (a * (1 - wx) + b * wx) * (1 - wy) + (d * (1 - wx) + e * wx) * wy;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Ray geometry in the local frame (km): observer at (0, h0, 0), sphere centre (0, R, 0),
// spin axis parallel to Z. Directions: x east, y up, z south.

/** Cylinder altitude (depth below the equatorial cylinder of radius R) of a point at distance t. */
export function rayAltitude(dx: number, dy: number, t: number, h0: number): number {
  const qx = t * dx;
  const qy = h0 + t * dy - R;
  return R - Math.sqrt(qx * qx + qy * qy);
}

/** cos of the angle between the ray direction and the local up (toward the centre) at distance t. */
export function rayMuUp(dx: number, dy: number, dz: number, t: number, h0: number): number {
  const ux = -t * dx;
  const uy = R - h0 - t * dy;
  const uz = -t * dz;
  const len = Math.sqrt(ux * ux + uy * uy + uz * uz);
  return (dx * ux + dy * uy + dz * uz) / len;
}

/** Distance along the ray to the shell sphere (|p − C| = R), from an observer h0 inside it. */
export function rayShellDistance(dy: number, h0: number): number {
  const a = R - h0;
  const b = a * dy;
  return b + Math.sqrt(b * b + R * R - a * a);
}

interface SegmentResult {
  S: [number, number, number];
  T: [number, number, number];
}

function integrate(
  p: AtmosphereParams,
  src: Float32Array,
  dx: number,
  dy: number,
  dz: number,
  h0: number,
  t0: number,
  t1: number,
  steps: number,
  emphasis: 'start' | 'end' | 'both',
  acc: SegmentResult,
  med: Medium,
  tmp: [number, number, number],
): void {
  let tPrev = t0;
  const span = t1 - t0;
  for (let i = 1; i <= steps; i++) {
    const x = i / steps;
    let f: number;
    if (emphasis === 'start') f = x * x;
    else if (emphasis === 'end') f = 1 - (1 - x) * (1 - x);
    else f = x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x);
    const t = t0 + span * f;
    const dt = t - tPrev;
    const tm = 0.5 * (t + tPrev);
    tPrev = t;
    const h = rayAltitude(dx, dy, tm, h0);
    if (h >= p.top) continue;
    medium(p, h, med);
    const mu = rayMuUp(dx, dy, dz, tm, h0);
    sampleSource(p, src, h, mu, tmp);
    for (let c = 0; c < 3; c++) {
      const ext = Math.max(med.extinction[c], 1e-12);
      const stepT = Math.exp(-ext * dt);
      acc.S[c] += acc.T[c] * tmp[c] * ((1 - stepT) / ext);
      acc.T[c] *= stepT;
    }
  }
}

/** Distances where the ray crosses the top of the air (approximate quadratic in t), if any. */
function topCrossings(p: AtmosphereParams, dx: number, dy: number, h0: number): [number, number] | null {
  // h(t) ≈ h0 + t·dy − t²(dx² + dy²)/(2R)
  const k = (dx * dx + dy * dy) / (2 * R);
  const c = p.top - h0;
  if (k < 1e-15) return dy > 0 ? [c / dy, Infinity] : null;
  const disc = dy * dy - 4 * k * c;
  if (disc <= 0) return null;
  const s = Math.sqrt(disc);
  return [(dy - s) / (2 * k), (dy + s) / (2 * k)];
}

export function integrateSkyRay(
  p: AtmosphereParams,
  src: Float32Array,
  dx: number,
  dy: number,
  dz: number,
): SegmentResult {
  const h0 = p.eyeAltitude;
  const med = newMedium();
  const tmp: [number, number, number] = [0, 0, 0];
  const tShell = rayShellDistance(dy, h0);
  const local: SegmentResult = { S: [0, 0, 0], T: [1, 1, 1] };
  const cross = dy > 0 ? topCrossings(p, dx, dy, h0) : null;
  if (!cross || cross[0] >= tShell) {
    // The ray never leaves the air before reaching the shell (or ground).
    integrate(p, src, dx, dy, dz, h0, 0, tShell, 160, dy > 0 ? 'both' : 'start', local, med, tmp);
    return local;
  }
  integrate(p, src, dx, dy, dz, h0, 0, cross[0], 96, 'start', local, med, tmp);
  return local;
}

// ---------------------------------------------------------------------------------------------
// LUT parametrisations (mirrored in the shader)

export function elevationFromV(v: number): number {
  const s = (v - 0.5) * 2;
  return Math.sign(s) * s * s * (PI / 2);
}

export function vFromElevation(e: number): number {
  return 0.5 + 0.5 * Math.sign(e) * Math.sqrt(Math.min(Math.abs(e) / (PI / 2), 1));
}

/** Azimuth measured from the equator plane (0 = east/west, π/2 = north/south). */
export function azimuthFromU(u: number): number {
  return u * u * (PI / 2);
}

export function apDistanceFromU(u: number): number {
  return u * u * LUT.apMaxDistanceKm;
}

/** ∫ S(ω) cosθ dω over the upper hemisphere of the sky-view LUT (quadrant symmetric). */
export function integrateSkyIrradiance(sky: Float32Array, W: number, H: number): [number, number, number] {
  const e: [number, number, number] = [0, 0, 0];
  for (let j = 0; j < H; j++) {
    const v0 = j / H;
    const v1 = (j + 1) / H;
    if (v0 < 0.5) continue;
    const e0 = elevationFromV(v0);
    const e1 = elevationFromV(v1);
    // ∫ sin(e) cos(e) de over the texel row
    const rowWeight = 0.5 * (Math.sin(e1) ** 2 - Math.sin(e0) ** 2);
    for (let i = 0; i < W; i++) {
      const dAz = azimuthFromU((i + 1) / W) - azimuthFromU(i / W);
      const w = rowWeight * dAz * 4;
      const o = (j * W + i) * 6;
      for (let c = 0; c < 3; c++) e[c] += sky[o + c] * w;
    }
  }
  return e;
}

// ---------------------------------------------------------------------------------------------

/**
 * `light` is the radiance arriving at the top of the air by cos θ from the zenith (the star and the
 * shell through the Veil); without it, the bare star cap alone.
 */
export function computeAtmosphere(p: AtmosphereParams = ATMOSPHERE, light?: (cosTheta: number, out: [number, number, number]) => void): AtmosphereLuts {
  const cap = light ? buildSkyQuadrature(light) : buildCapQuadrature();
  const multiScatter = computeMultiScatter(p, cap);
  const source = computeSource(p, cap, multiScatter);

  const W = LUT.skyWidth;
  const H = LUT.skyHeight;
  const skyLocal = new Float32Array(W * H * 6);
  for (let j = 0; j < H; j++) {
    const e = elevationFromV((j + 0.5) / H);
    const ce = Math.cos(e);
    const se = Math.sin(e);
    for (let i = 0; i < W; i++) {
      const az = azimuthFromU((i + 0.5) / W);
      const dx = ce * Math.cos(az);
      const dz = ce * Math.sin(az);
      const local = integrateSkyRay(p, source, dx, se, dz);
      const o = (j * W + i) * 6;
      skyLocal.set([local.S[0], local.S[1], local.S[2], local.T[0], local.T[1], local.T[2]], o);
    }
  }

  const AW = LUT.apWidth;
  const AH = LUT.apHeight;
  const aerial = new Float32Array(AW * AH * 6);
  const med = newMedium();
  const tmp: [number, number, number] = [0, 0, 0];
  const h0 = p.eyeAltitude;
  for (let j = 0; j < AH; j++) {
    const e = elevationFromV((j + 0.5) / AH);
    const dx = Math.cos(e);
    const dy = Math.sin(e);
    const acc: SegmentResult = { S: [0, 0, 0], T: [1, 1, 1] };
    let tPrev = 0;
    for (let i = 0; i < AW; i++) {
      const t = apDistanceFromU(i / (AW - 1));
      if (t > tPrev) {
        integrate(p, source, dx, dy, 0, h0, tPrev, t, 12, 'start', acc, med, tmp);
        tPrev = t;
      }
      aerial.set([acc.S[0], acc.S[1], acc.S[2], acc.T[0], acc.T[1], acc.T[2]], (j * AW + i) * 6);
    }
  }

  const groundIrradiance = capIrradiance(p, 0, cap);
  const skyIrradiance = integrateSkyIrradiance(skyLocal, W, H);
  return { skyLocal, aerial, source, multiScatter, groundIrradiance, skyIrradiance };
}
