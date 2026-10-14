/**
 * Light transport inside the shell, solved once at boot.
 *
 * From any point of the inner face, the star is a 45° cap centred on the normal, and every other
 * direction at elevation ε is a chord to another shell point, which is itself seen at elevation ε
 * (inscribed angle). So the whole enclosure is symmetric: what a surface reflects depends only on
 * the elevation of each incoming direction, and the mean radiance of the shell seen at elevation ε,
 * L_shell(ε), satisfies a 1D fixed-point equation:
 *
 *     L_shell(ε) = Σ_m a_m ∫ f_m(ω_i, ε) L_in(ω_i) cos θ_i dω_i
 *     L_in(ω)    = star (limb-darkened, through the plasma)      for ε(ω) > 45°
 *                = T_pl(ε)·L_shell(ε) + S_pl(ε)                  for 0 ≤ ε ≤ 45° (a chord)
 *                = L_shell(|ε|)                                  below the local tangent plane
 *
 * with a_m the area share of each surface class (open slots reflect nothing: light escapes there),
 * plus each class's thermal glow (thermal.ts), which the rest of the shell reflects in turn. The
 * solution is not a mean: polished metal near the limb sees the star through its lobes and blazes,
 * and reflections lower down chain around the sphere until they escape through a gap, so the shell
 * darkens with distance from the star. That gradient is a property of the enclosure.
 *
 * Outputs (all relative to the reference photosphere; the shader scales them by the star's
 * measured illuminant):
 *   - prefiltered environment Lpre(ε_r, roughness): split-sum GGX convolution of L_in about a
 *     reflected direction at elevation ε_r — the specular light of any surface on the shell;
 *   - L_m(ε) per surface class, reflected light only (REFLECTION_CLASSES): what a traced reflection
 *     hit returns for the class it meets, with that surface's own glow added in the shader;
 *   - irradiance E(tilt) for diffuse parts, with horizon clipping;
 *   - the shell's mean radiance (lights the plasma).
 */
import { STAR_ANGULAR_RADIUS, STAR_RADIUS_R } from '../../world/constants';
import { LIMB_DARKENING_EXPONENT, STAR_CENTER_RADIANCE } from '../../world/radiometry';
import { combinePlasmaLut, plasmaSegment, type PlasmaLut } from '../medium/plasma';
import { COLLECTOR_DIFFUSE, COLLECTOR_F0, STRUCTURE_DIFFUSE, STRUCTURE_F0, VEIL_F0 } from './materials';
import { COLLECTOR_TEMPERATURE, COLLECTOR_TEMPERATURE_SPREAD, OFFLINE_SHARE, STRUCTURE_TEMPERATURE, meanGlowRadiance } from './thermal';

type RGB = [number, number, number];

/**
 * A surface class of the inner face: specular (F0) over a Lambert base, plus its thermal glow.
 * Rough finishes use a GGX lobe of `roughness`; mirror finishes set `sigma`, the 1σ spread of
 * their facet normals (figure and set errors), whose lobe is Gaussian — short-tailed, unlike GGX,
 * which matters under a star 90° across.
 */
export interface SurfaceClass {
  f0: RGB;
  albedo: RGB;
  roughness: number;
  sigma?: number;
  /** Thermal emission (scene radiance, isotropic). */
  emission?: RGB;
}

/** Micro-roughness of the polished plating as a normal spread (≈ 0.25°). */
export const MIRROR_MICRO_SIGMA = 0.0045;

const collectorGlow = meanGlowRadiance(COLLECTOR_TEMPERATURE, COLLECTOR_TEMPERATURE_SPREAD).map((v) => v * (1 - OFFLINE_SHARE)) as RGB;

/**
 * Surface classes and their area shares of the inner face as seen from anywhere (shares from
 * tools/coverage.mjs for the layout in layout.ts; materials.ts, thermal.ts). Collector plating's
 * spread σ combines module set errors (~1.1°), tile set errors (~1.7°) and each tile's shallow dome
 * (plating.ts, resolved per tile and per pixel in the shader).
 */
export const SURFACES = {
  collector: { area: 0.34, cls: { f0: COLLECTOR_F0, albedo: COLLECTOR_DIFFUSE, roughness: 0.08, sigma: 0.045, emission: collectorGlow } },
  satin: { area: 0.1, cls: { f0: COLLECTOR_F0, albedo: COLLECTOR_DIFFUSE, roughness: 0.32, emission: collectorGlow } },
  structure: { area: 0.07, cls: { f0: STRUCTURE_F0, albedo: STRUCTURE_DIFFUSE, roughness: 0.18, sigma: 0.05, emission: meanGlowRadiance(STRUCTURE_TEMPERATURE, 0.03) } },
  veil: { area: 0.06, cls: { f0: VEIL_F0, albedo: [0.0057, 0.0057, 0.0057], roughness: 0.05, sigma: 0.02 } },
  open: { area: 0.43, cls: null },
} as const satisfies Record<string, { area: number; cls: SurfaceClass | null }>;

export const ENCLOSURE_LUT = {
  /** Lpre: u = (ε_r + 90°)/180°, v = roughness (GGX table) or √(σ/σmax) (mirror table). */
  preWidth: 256,
  preHeight: 32,
  mirrorSigmaMax: 0.25,
  /** Irradiance: u = tilt/180°. */
  irrWidth: 64,
  /** Rows of the irradiance table: irradiance by tilt, then one per REFLECTION_CLASSES entry. */
  irrRows: 5,
} as const;

/** The classes a traced reflection can meet, in their rows (1..) of the irradiance table. */
export const REFLECTION_CLASSES = ['collector', 'satin', 'structure', 'veil'] as const satisfies readonly (keyof typeof SURFACES)[];

const S = STAR_RADIUS_R;
const SIN_A = Math.sin(STAR_ANGULAR_RADIUS);
const N_EPS = 90;

// ---------------------------------------------------------------------------------------------
// GGX sampling (Hammersley)

function radicalInverse(i: number): number {
  let b = i;
  b = ((b << 16) | (b >>> 16)) >>> 0;
  b = (((b & 0x55555555) << 1) | ((b & 0xaaaaaaaa) >>> 1)) >>> 0;
  b = (((b & 0x33333333) << 2) | ((b & 0xcccccccc) >>> 2)) >>> 0;
  b = (((b & 0x0f0f0f0f) << 4) | ((b & 0xf0f0f0f0) >>> 4)) >>> 0;
  b = (((b & 0x00ff00ff) << 8) | ((b & 0xff00ff00) >>> 8)) >>> 0;
  return b / 4294967296;
}

interface Sampler {
  n: number;
  u: Float64Array;
  v: Float64Array;
}

function hammersley(n: number): Sampler {
  const u = new Float64Array(n);
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    u[i] = (i + 0.5) / n;
    v[i] = radicalInverse(i);
  }
  return { n, u, v };
}

/** Gaussian-facet half-vector about +z for slope spread σ (Box–Muller on the sample). */
function gaussHalf(sigma: number, u: number, v: number, out: number[]): void {
  const r = sigma * Math.sqrt(-2 * Math.log(Math.max(1 - u, 1e-12)));
  const phi = 2 * Math.PI * v;
  const sx = r * Math.cos(phi);
  const sy = r * Math.sin(phi);
  const l = Math.hypot(sx, sy, 1);
  out[0] = -sx / l;
  out[1] = -sy / l;
  out[2] = 1 / l;
}

/** GGX half-vector about +z for α, sample (u, v). */
function ggxHalf(alpha: number, u: number, v: number, out: number[]): void {
  const a2 = alpha * alpha;
  const cosT = Math.sqrt((1 - u) / (1 + (a2 - 1) * u));
  const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
  const phi = 2 * Math.PI * v;
  out[0] = sinT * Math.cos(phi);
  out[1] = sinT * Math.sin(phi);
  out[2] = cosT;
}

function smithG1(nx: number, alpha: number): number {
  const a2 = alpha * alpha;
  return (2 * nx) / (nx + Math.sqrt(a2 + (1 - a2) * nx * nx));
}

function schlick(f0: number, c: number): number {
  const m = 1 - Math.min(Math.max(c, 0), 1);
  return f0 + (1 - f0) * m * m * m * m * m;
}

// ---------------------------------------------------------------------------------------------
// Incoming radiance by direction (local frame at a shell point: +z toward the star centre)

interface Incoming {
  /** L_shell(ε) at N_EPS + 1 elevations 0..90° (only 0..45° are reachable by chords). */
  shell: Float64Array[];
  /** Chord transmittance and in-scatter by elevation (plasma). */
  chordT: Float64Array;
  chordS: Float64Array[];
  /** Star (through the plasma) by angle from the centre, 0..45°, N_EPS + 1 samples. */
  star: Float64Array[];
}

function interp(arr: Float64Array, x: number): number {
  const f = Math.min(Math.max(x, 0), 1) * (arr.length - 1);
  const i = Math.min(Math.floor(f), arr.length - 2);
  const w = f - i;
  return arr[i] * (1 - w) + arr[i + 1] * w;
}

/** Radiance arriving from a direction whose cosine with the normal is cz (channel c). */
function incoming(inc: Incoming, cz: number, c: number): number {
  const theta = Math.acos(Math.min(Math.max(cz, -1), 1));
  if (theta < STAR_ANGULAR_RADIUS) return interp(inc.star[c], theta / STAR_ANGULAR_RADIUS);
  const eps = Math.PI / 2 - theta;
  if (eps >= 0) {
    const x = eps / (Math.PI / 2);
    return interp(inc.chordT, x) * interp(inc.shell[c], x) + interp(inc.chordS[c], x);
  }
  return interp(inc.shell[c], -eps / (Math.PI / 2));
}

function starAndChords(plasma: Float32Array): Omit<Incoming, 'shell'> {
  const star = [0, 1, 2].map(() => new Float64Array(N_EPS + 1));
  const chordT = new Float64Array(N_EPS + 1);
  const chordS = [0, 1, 2].map(() => new Float64Array(N_EPS + 1));
  for (let i = 0; i <= N_EPS; i++) {
    // Star at angle ψ from the centre direction, seen from r = 1.
    const psi = (i / N_EPS) * STAR_ANGULAR_RADIUS * 0.9999;
    const b = Math.sin(psi);
    const seg = plasmaSegment(plasma, b, -Math.cos(psi), -Math.sqrt(Math.max(S * S - b * b, 0)));
    const muStar = Math.sqrt(Math.max(0, 1 - (Math.sin(psi) / SIN_A) ** 2));
    for (let c = 0; c < 3; c++) star[c][i] = STAR_CENTER_RADIANCE[c] * Math.pow(muStar, LIMB_DARKENING_EXPONENT[c]) * seg.T + seg.S[c];
    // Chord at elevation ε: b = cos ε, from x = −sin ε to + sin ε.
    const eps = (i / N_EPS) * (Math.PI / 2);
    if (eps < Math.PI / 4) {
      const ch = plasmaSegment(plasma, Math.cos(eps), -Math.sin(eps), Math.sin(eps));
      chordT[i] = ch.T;
      for (let c = 0; c < 3; c++) chordS[c][i] = ch.S[c];
    } else {
      chordT[i] = chordT[i - 1];
      for (let c = 0; c < 3; c++) chordS[c][i] = chordS[c][i - 1];
    }
  }
  return { star, chordT, chordS };
}

/** Outgoing radiance of a class viewed from elevation ε (per channel), reflecting `inc`. */
function classRadiance(cls: SurfaceClass, eps: number, inc: Incoming, smp: Sampler, out: number[]): void {
  const alpha = cls.sigma !== undefined ? Math.max(cls.sigma * Math.SQRT2, 1e-4) : Math.max(cls.roughness * cls.roughness, 1e-4);
  const V = [Math.cos(eps), 0, Math.sin(eps)];
  const nv = Math.max(V[2], 1e-4);
  const H = [0, 0, 0];
  const acc = [0, 0, 0];
  const dif = [0, 0, 0];
  for (let k = 0; k < smp.n; k++) {
    if (cls.sigma !== undefined) gaussHalf(cls.sigma, smp.u[k], smp.v[k], H);
    else ggxHalf(alpha, smp.u[k], smp.v[k], H);
    const vh = V[0] * H[0] + V[1] * H[1] + V[2] * H[2];
    if (vh <= 0) continue;
    const lz = 2 * vh * H[2] - V[2];
    if (lz <= 0) continue;
    const g = smithG1(nv, alpha) * smithG1(lz, alpha);
    const w = (g * vh) / (nv * Math.max(H[2], 1e-6));
    for (let c = 0; c < 3; c++) acc[c] += schlick(cls.f0[c], vh) * w * incoming(inc, lz, c);
    // Cosine-weighted direction for the diffuse base from the same sequence.
    const cz = Math.sqrt(Math.max(0, 1 - smp.u[k]));
    for (let c = 0; c < 3; c++) dif[c] += incoming(inc, cz, c);
  }
  for (let c = 0; c < 3; c++) out[c] = acc[c] / smp.n + (cls.albedo[c] * dif[c]) / smp.n + (cls.emission?.[c] ?? 0);
}

export interface EnclosureResult {
  /** Lpre for GGX finishes, RGBA (a = 1). */
  pre: Float32Array;
  /** Lpre for Gaussian-facet mirrors, RGBA (a = 1). */
  preMirror: Float32Array;
  /** Row 0: irradiance by normal tilt from the radial direction. Rows 1..: each reflection class's reflected radiance by view elevation. RGBA. */
  irr: Float32Array;
  /** Shell mean radiance (cosine-weighted over the hemisphere of chords). */
  shellMean: RGB;
  /** The plasma LUT combined with that shell radiance (RGBA: Ĩ, τ). */
  plasma: Float32Array;
  /** L_shell(ε), ε = 0..90° in N_EPS + 1 steps, for diagnostics. */
  shell: Float64Array[];
  /**
   * What a point of the inner face sees by angle θ from its normal (θ = 0..90° in SKY_SAMPLES
   * steps, RGB): the star through the plasma, then the shell. This is the sky over the habitat
   * before the Veil; the atmosphere is lit by it.
   */
  sky: Float32Array;
}

export const SKY_SAMPLES = 721;

/** Samples an enclosure sky table at angle θ (radians) from the zenith. */
export function sampleSky(sky: Float32Array, theta: number, out: number[]): void {
  const f = Math.min(Math.max(theta / (Math.PI / 2), 0), 1) * (SKY_SAMPLES - 1);
  const i = Math.min(Math.floor(f), SKY_SAMPLES - 2);
  const w = f - i;
  for (let c = 0; c < 3; c++) out[c] = sky[i * 3 + c] * (1 - w) + sky[(i + 1) * 3 + c] * w;
}

/** Solves the enclosure, alternating with the plasma's shell illumination until both agree. */
export function solveEnclosure(plasmaLut: PlasmaLut, surfaces: Record<string, { area: number; cls: SurfaceClass | null }> = SURFACES): EnclosureResult {
  const smp = hammersley(384);
  const shell = [0, 1, 2].map(() => new Float64Array(N_EPS + 1));
  let shellMean: RGB = [0, 0, 0];
  let plasma = combinePlasmaLut(plasmaLut, shellMean);
  let inc: Incoming = { shell, ...starAndChords(plasma) };
  const classes = Object.values(surfaces).filter((s) => s.cls);
  const tmp = [0, 0, 0];
  for (let outer = 0; outer < 2; outer++) {
    for (let iter = 0; iter < 18; iter++) {
      const next = [0, 1, 2].map(() => new Float64Array(N_EPS + 1));
      for (let i = 0; i <= N_EPS; i++) {
        const eps = Math.min((i / N_EPS) * (Math.PI / 2), Math.PI / 4);
        for (const s of classes) {
          classRadiance(s.cls as SurfaceClass, eps, inc, smp, tmp);
          for (let c = 0; c < 3; c++) next[c][i] += s.area * tmp[c];
        }
      }
      for (let c = 0; c < 3; c++) shell[c].set(next[c]);
    }
    // Mean radiance of the shell seen from inside, cosine-weighted over chord elevations.
    let wsum = 0;
    const m = [0, 0, 0];
    for (let i = 0; i <= N_EPS / 2; i++) {
      const eps = (i / N_EPS) * (Math.PI / 2);
      const w = Math.cos(eps);
      wsum += w;
      for (let c = 0; c < 3; c++) m[c] += w * shell[c][i];
    }
    shellMean = [m[0] / wsum, m[1] / wsum, m[2] / wsum];
    plasma = combinePlasmaLut(plasmaLut, shellMean);
    inc = { shell, ...starAndChords(plasma) };
  }

  // Prefiltered environment about a reflected direction at elevation ε_r (split sum, N = V = R).
  const { preWidth: PW, preHeight: PH, irrWidth: IW } = ENCLOSURE_LUT;
  const pre = new Float32Array(PW * PH * 4);
  const preMirror = new Float32Array(PW * PH * 4);
  const smpPre = hammersley(512);
  const H = [0, 0, 0];
  for (let table = 0; table < 2; table++)
  for (let j = 0; j < PH; j++) {
    const x = j / (PH - 1);
    const alpha = Math.max(x * x, 1e-4);
    const sigma = Math.max(x * x * ENCLOSURE_LUT.mirrorSigmaMax, 1e-5);
    for (let i = 0; i < PW; i++) {
      const er = ((i + 0.5) / PW) * Math.PI - Math.PI / 2;
      // Basis about R.
      const R = [Math.cos(er), 0, Math.sin(er)];
      const T1 = [-Math.sin(er), 0, Math.cos(er)];
      const acc = [0, 0, 0];
      let wsum = 0;
      for (let k = 0; k < smpPre.n; k++) {
        if (table === 0) ggxHalf(alpha, smpPre.u[k], smpPre.v[k], H);
        else gaussHalf(sigma, smpPre.u[k], smpPre.v[k], H);
        // L = reflect(−R, H) in R's frame: L = 2(R·H)H − R with R = +z there.
        const lzR = 2 * H[2] * H[2] - 1;
        if (lzR <= 0) continue;
        const lx = 2 * H[2] * H[0];
        const ly = 2 * H[2] * H[1];
        // To the shell frame: components along T1, Y, R.
        const cz = T1[2] * lx + R[2] * lzR;
        void ly;
        for (let c = 0; c < 3; c++) acc[c] += lzR * incoming(inc, cz, c);
        wsum += lzR;
      }
      const o = (j * PW + i) * 4;
      const dst = table === 0 ? pre : preMirror;
      for (let c = 0; c < 3; c++) dst[o + c] = acc[c] / Math.max(wsum, 1e-9);
      dst[o + 3] = 1;
    }
  }

  // Irradiance on a surface whose normal is tilted β from the radial direction (horizon-clipped).
  // Row 0: irradiance by face tilt. Rows 1..: the light each class reflects when seen at elevation
  // ε (0..90°), without its own glow — what a traced reflection meets (the shader adds the glow of
  // the region it hits).
  const irr = new Float32Array(IW * ENCLOSURE_LUT.irrRows * 4);
  const NT = 96;
  const NP = 96;
  for (let i = 0; i < IW; i++) {
    const beta = (i / (IW - 1)) * Math.PI;
    const n = [Math.sin(beta), 0, Math.cos(beta)];
    const acc = [0, 0, 0];
    for (let a = 0; a < NT; a++) {
      const ct = 1 - (a + 0.5) / NT; // cos θ about n, uniform → cosine weight applied below
      const st = Math.sqrt(1 - ct * ct);
      for (let b = 0; b < NP; b++) {
        const phi = ((b + 0.5) / NP) * 2 * Math.PI;
        // Direction in a frame about n: t1 = (cos β, 0, −sin β), t2 = y.
        const lx = st * Math.cos(phi);
        const ly = st * Math.sin(phi);
        const cz = n[2] * ct + -Math.sin(beta) * lx + 0 * ly;
        const dOmega = (2 * Math.PI) / (NT * NP);
        for (let c = 0; c < 3; c++) acc[c] += incoming(inc, cz, c) * ct * dOmega;
      }
    }
    for (let c = 0; c < 3; c++) irr[i * 4 + c] = acc[c];
    irr[i * 4 + 3] = 1;
  }

  const sky = new Float32Array(SKY_SAMPLES * 3);
  for (let i = 0; i < SKY_SAMPLES; i++) {
    const theta = (i / (SKY_SAMPLES - 1)) * (Math.PI / 2);
    for (let c = 0; c < 3; c++) sky[i * 3 + c] = incoming(inc, Math.cos(theta), c);
  }

  REFLECTION_CLASSES.forEach((name, row) => {
    const cls = surfaces[name]?.cls;
    const L = [0, 1, 2].map(() => new Float64Array(N_EPS + 1));
    if (cls) {
      for (let i = 0; i <= N_EPS; i++) {
        classRadiance(cls, Math.min((i / N_EPS) * (Math.PI / 2), Math.PI / 4), inc, smp, tmp);
        for (let c = 0; c < 3; c++) L[c][i] = tmp[c] - (cls.emission?.[c] ?? 0);
      }
    }
    for (let i = 0; i < IW; i++) {
      const x = i / (IW - 1);
      const o = ((row + 1) * IW + i) * 4;
      for (let c = 0; c < 3; c++) irr[o + c] = interp(L[c], Math.min(x, 0.5));
      irr[o + 3] = 1;
    }
  });

  return { pre, preMirror, irr, shellMean, plasma, shell, sky };
}
