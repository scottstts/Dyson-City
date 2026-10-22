/**
 * Offline illustration of the loading glyph's sphere (src/ui/sphereFrame.ts), ray traced per pixel
 * with stratified supersampling. Run through tools/sphere-art.mjs, which splits the work across
 * worker threads and encodes the layers.
 *
 * Two parts, so the band can turn: the sphere with the belt (the band and the hub collars it runs
 * through) left out, and the belt alone at each of its sprite's turns. Each has layers so the page can bring the star up with
 * loading without re-rendering:
 *  - `front`: the outside;
 *  - `back` (the fixed part only): what the openings show (the star, the lit inner face of the far
 *    shell, the cavity's glow), under `front`;
 *  - `glow`: the light the star throws on the outside (spill on edges facing an opening, the
 *    gores' coolant seams, the hub lenses), added (plus-lighter) over `front`. It is the
 *    difference tone mapping makes with and without it, so front + glow is exact at full heat.
 * All are straight-alpha and transparent past what they hold (renderRows).
 */
import { FRAME, HALF, SHELL, SPINES, UNIT, fromHub, fromSpine, fromView, goreLow, sectorOf, toView, wrapLon, type V3 } from '../src/ui/sphereFrame.ts';

const DEG = Math.PI / 180;

// Noise ---------------------------------------------------------------------

function hash(a: number, b: number, c = 0): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const h = (i: number, j: number, k: number) => hash(xi + i, yi + j, zi + k);
  return l(l(l(h(0, 0, 0), h(1, 0, 0), u), l(h(0, 1, 0), h(1, 1, 0), u), v), l(l(h(0, 0, 1), h(1, 0, 1), u), l(h(0, 1, 1), h(1, 1, 1), u), v), w);
}

function fbm(x: number, y: number, z: number, octaves: number): number {
  let s = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    s += a * vnoise(x * f, y * f, z * f);
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// Surfaces ------------------------------------------------------------------

type Mat = 'gore' | 'frame' | 'band' | 'collar' | 'hub';

/** A hit on the structure: material, a tangent-space slope for the normal, albedo scale, spill and emission. */
interface Surface {
  mat: Mat;
  /** Height-field slope along east and north (radians of tilt). */
  ge: number;
  gn: number;
  /** Albedo multiplier (seams, plates, recesses). */
  shade: number;
  /** Roughness. */
  rough: number;
  /** 0–1: how strongly this point faces an opening (lit from inside on the outside face). */
  spill: number;
  /** Self-emission (coolant seams, hub lenses), relative. */
  emit: number;
}

/** The gore's plating: rows of ~5.6° and columns of ~6.4° (physical), seams, inset hatches, rivets. */
function plating(lat: number, lon: number, lo: number, hi: number, w0: number, w1: number, s: Surface): void {
  const a = Math.abs(lat);
  const hemi = lat >= 0 ? 1 : -1;
  const rows = Math.max(1, Math.round((hi - lo) / 5.6));
  const rowH = (hi - lo) / rows;
  const row = Math.min(rows - 1, Math.floor((a - lo) / rowH));
  const r0 = lo + row * rowH;
  const latC = r0 + rowH / 2;
  const span = w1 - w0;
  const cols = Math.max(1, Math.round((span * Math.cos(latC * DEG)) / 6.4));
  const colW = span / cols;
  const col = Math.min(cols - 1, Math.floor((lon - w0) / colW));
  const c0 = w0 + col * colW;
  const cosl = Math.cos(a * DEG);
  // Distances to this plate's edges, physical degrees.
  const dLat = Math.min(a - r0, r0 + rowH - a);
  const dLon = Math.min(lon - c0, c0 + colW - lon) * cosl;
  const id = hash(Math.round(c0 * 100), row, hemi * 7 + 11);
  const seam = Math.min(dLat, dLon);
  // Plate tone and finish.
  s.shade *= 0.72 + 0.56 * id;
  s.rough = 0.38 + 0.22 * hash(Math.round(c0 * 100), row, 3);
  // Seam: a dark recessed joint with bevelled plate edges.
  if (seam < 0.12) s.shade *= 0.18;
  else if (seam < 0.42) {
    const k = 1 - (seam - 0.12) / 0.3;
    const toward = dLat < dLon ? 'lat' : 'lon';
    const sign = toward === 'lat' ? (a - r0 < rowH / 2 ? 1 : -1) * hemi : lon - c0 < colW / 2 ? 1 : -1;
    if (toward === 'lat') s.gn += 0.55 * k * sign;
    else s.ge += 0.55 * k * sign;
  }
  // Rivets along the seams.
  const along = dLat < dLon ? lon * cosl : a;
  const rv = ((along % 1.15) + 1.15) % 1.15;
  if (seam > 0.42 && seam < 0.78 && Math.abs(rv - 0.575) < 0.16) {
    const d = Math.hypot(seam - 0.6, Math.abs(rv - 0.575));
    if (d < 0.16) {
      s.shade *= 1.6;
      s.rough *= 0.55;
      s.gn += (0.6 * (0.6 - seam)) / 0.16;
    }
  }
  // Inset hatch on some plates: a recessed panel with its own fine joint.
  if (id < 0.34 && rowH > 3.5) {
    const m = 1.05 + 0.6 * hash(Math.round(c0 * 100), row, 9);
    const inner = Math.min(dLat, dLon) - m;
    if (inner > 0) {
      s.shade *= 0.82;
      if (inner < 0.1) s.shade *= 0.35;
      else if (inner < 0.3) {
        const k = 1 - (inner - 0.1) / 0.2;
        if (dLat < dLon) s.gn -= 0.4 * k * (a - r0 < rowH / 2 ? 1 : -1) * hemi;
        else s.ge -= 0.4 * k * (lon - c0 < colW / 2 ? 1 : -1);
      }
    }
  }
  // Fine surface: brushed grain and wear.
  s.shade *= 0.9 + 0.2 * fbm(lon * 0.9, a * 0.9, hemi * 3.1, 3);
}

/** The belt: the band and the hub collars (with their lenses) it runs through. */
const BELT_SHELLS = ['collar', 'hub', 'band'] as const;

/**
 * The structure on shell `shell` at a model-space unit direction, or null where it is open; the
 * band turned by `spin` degrees (only the band turns).
 */
export function surfaceAt(shell: keyof typeof SHELL, lat: number, lonIn: number, spin = 0): Surface | null {
  const lon = wrapLon(shell === 'band' ? lonIn - spin : lonIn);
  const a = Math.abs(lat);
  const hemi = lat >= 0 ? 1 : -1;
  const s: Surface = { mat: 'gore', ge: 0, gn: 0, shade: 1, rough: 0.4, spill: 0, emit: 0 };

  if (shell === 'collar' || shell === 'hub') {
    let best = Infinity;
    let hubLon = 0;
    for (const h of SPINES) {
      const d = fromHub(lat, lon, h);
      if (d < best) {
        best = d;
        hubLon = h;
      }
    }
    // Radial direction in the tangent plane (east, north) from the hub.
    let de = wrapLon(lon - hubLon);
    if (de > 180) de -= 360;
    const re = de * Math.cos(lat * DEG);
    const rl = Math.hypot(re, lat) || 1;
    const ue = re / rl;
    const un = lat / rl;
    if (shell === 'collar') {
      if (best < FRAME.collarIn || best > FRAME.collarOut) return null;
      // A rounded torus section with a turned groove for the coolant line near its outer rim.
      const mid = (FRAME.collarIn + FRAME.collarOut) / 2;
      const half = (FRAME.collarOut - FRAME.collarIn) / 2;
      const u = (best - mid) / half;
      s.mat = 'collar';
      s.ge = ue * 1.25 * u;
      s.gn = un * 1.25 * u;
      s.rough = 0.22;
      s.shade = 1;
      const groove = Math.abs(best - (FRAME.collarOut - 0.55));
      if (groove < 0.18) s.shade *= 0.3;
      const inner = Math.abs(best - (FRAME.collarIn + 0.35));
      if (inner < 0.12) s.shade *= 0.35;
      s.spill = smooth(0.9, 0.1, best - FRAME.collarIn) * 0.8;
      return s;
    }
    if (best >= FRAME.collarIn) return null;
    // The hub's lens: a dark boss with a hot annulus, the coolant manifold seen through glass.
    s.mat = 'hub';
    s.rough = 0.15;
    const u = best / FRAME.collarIn;
    s.ge = ue * 0.5 * u;
    s.gn = un * 0.5 * u;
    s.shade = 0.6;
    s.emit = Math.exp(-(((u - 0.62) / 0.09) ** 2)) * 1.6 + Math.exp(-((u / 0.18) ** 2)) * 0.5;
    return s;
  }

  if (shell === 'band') {
    if (a > FRAME.band) return null;
    s.mat = 'band';
    const u = lat / FRAME.band;
    // Chamfered edges, two coolant channels, ribs every 4°.
    if (Math.abs(u) > 0.84) s.gn = -Math.sign(u) * 0.9;
    const ch = Math.abs(a - (FRAME.band - 0.75));
    if (ch < 0.2) {
      s.shade *= 0.25;
      s.gn += Math.sign(lat) * (a > FRAME.band - 0.75 ? -0.5 : 0.5);
    }
    const rib = ((lon % 4) + 4) % 4;
    if (rib < 0.14) s.shade *= 0.35;
    else if (rib < 0.4) s.ge += 0.35;
    else if (rib > 3.75) s.ge -= 0.35;
    // Grain on a circle that closes every 60°, so the turning band's sprite loops seamlessly.
    const g = (lon * 6 * DEG) % (2 * Math.PI);
    s.shade *= 0.85 + 0.3 * fbm(5.73 * Math.cos(g), 5.73 * Math.sin(g), lat * 0.6 + 5.2, 3);
    s.rough = 0.3;
    s.spill = smooth(0.85, 1, Math.abs(u)) * 0.7;
    return s;
  }

  if (shell === 'frame') {
    s.mat = 'frame';
    s.rough = 0.28;
    // Polar collars.
    const dp = a - FRAME.polar;
    if (Math.abs(dp) < FRAME.polarHalf) {
      const u = dp / FRAME.polarHalf;
      if (Math.abs(u) > 0.8) s.gn = -Math.sign(u) * hemi * 0.9;
      if (Math.abs(Math.abs(dp) - 0.8) < 0.16) s.shade *= 0.3;
      s.spill = smooth(0.75, 1, u) * 0.8;
      s.shade *= 0.9 + 0.2 * fbm(lon * 0.8, a, 1.7, 3);
      return s;
    }
    // Spines: box beams from the polar collar down to the hub collar's rim.
    const { d, spine } = fromSpine(lat, lon);
    if (Math.abs(d) < FRAME.spineHalf && a < FRAME.polar && fromHub(lat, lon, spine) > FRAME.collarOut - 0.4) {
      const u = d / FRAME.spineHalf;
      if (Math.abs(u) > 0.74) s.ge = -Math.sign(u) * 0.95;
      if (Math.abs(u) < 0.16) {
        s.shade *= 0.3;
        s.ge += u * 1.8;
      }
      // Splice plates every 9° along the spine.
      const sp = ((a % 9) + 9) % 9;
      if (sp < 0.12) s.shade *= 0.4;
      s.shade *= 0.9 + 0.2 * fbm(a * 0.8, lon, 2.3, 3);
      s.spill = smooth(0.7, 1, Math.abs(u)) * 0.9;
      return s;
    }
    // Latitude rings bounding the open bands.
    const dr = a - FRAME.ring;
    if (Math.abs(dr) < FRAME.ringHalf) {
      const u = dr / FRAME.ringHalf;
      if (Math.abs(u) > 0.72) s.gn = -Math.sign(u) * hemi * 0.95;
      if (Math.abs(u) < 0.18) s.shade *= 0.32;
      s.shade *= 0.9 + 0.2 * fbm(lon * 0.8, a, 4.4, 3);
      s.spill = smooth(0.6, 1, Math.abs(u)) * 0.9;
      return s;
    }
    return null;
  }

  // Gores.
  const sector = sectorOf(lon);
  const lo = goreLow(sector);
  const hi = FRAME.goreHi;
  if (a < lo || a > hi) return null;
  const cosl = Math.cos(a * DEG);
  const inner = FRAME.spineHalf + FRAME.slot;
  const w0 = sector + inner / cosl;
  const w1 = sector + 60 - inner / cosl;
  if (lon < w0 || lon > w1) return null;
  const dEdge = Math.min(a - lo, hi - a, (lon - w0) * cosl, (w1 - lon) * cosl);
  s.mat = 'gore';
  // The gore's rim: a raised lip, its coolant seam just inside.
  if (dEdge < 0.55) {
    const k = 1 - dEdge / 0.55;
    const dl = Math.min(a - lo, hi - a);
    const dw = Math.min(lon - w0, w1 - lon) * cosl;
    if (dl < dw) s.gn -= 0.9 * k * (a - lo < hi - a ? 1 : -1) * hemi;
    else s.ge -= 0.9 * k * (lon - w0 < w1 - lon ? 1 : -1);
    s.shade *= 1.15;
    s.rough = 0.3;
  } else {
    plating(lat, lon, lo, hi, w0, w1, s);
  }
  const cool = Math.abs(dEdge - 0.85);
  if (cool < 0.13) {
    s.shade *= 0.3;
    s.emit = 0.9 * (1 - cool / 0.13);
  }
  s.spill = Math.exp(-dEdge / 0.45) * 0.9;
  return s;
}

// Shading -------------------------------------------------------------------

/** Exterior lights in view space: the key (upper left, in front) and a warm kicker from behind. */
const KEY = norm([-0.5, 0.6, 0.62]);
const KICK = norm([0.82, 0.2, -0.36]);
const KEY_RGB: V3 = [1.25, 1.18, 1.08];
const KICK_RGB: V3 = [1.1, 0.62, 0.3];
/** The light the star throws out of an opening onto an edge facing it. */
const SPILL_RGB: V3 = [2.4, 1.15, 0.42];
const EMIT_RGB: V3 = [3.2, 1.45, 0.5];
const AMBIENT: V3 = [0.022, 0.018, 0.015];

const MATS: Record<Mat, { albedo: V3; f0: V3 }> = {
  gore: { albedo: [0.032, 0.03, 0.028], f0: [0.2, 0.19, 0.18] },
  frame: { albedo: [0.05, 0.046, 0.042], f0: [0.32, 0.3, 0.28] },
  band: { albedo: [0.045, 0.042, 0.038], f0: [0.3, 0.28, 0.26] },
  collar: { albedo: [0.08, 0.055, 0.03], f0: [0.75, 0.52, 0.26] },
  hub: { albedo: [0.02, 0.018, 0.016], f0: [0.5, 0.45, 0.4] },
};

function norm(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** GGX specular with Schlick Fresnel and a Smith visibility term; returns the scalar lobe. */
function ggx(n: V3, l: V3, v: V3, rough: number): { spec: number; fres: number } {
  const h = norm([l[0] + v[0], l[1] + v[1], l[2] + v[2]]);
  const nl = Math.max(dot(n, l), 0);
  const nv = Math.max(dot(n, v), 1e-3);
  const nh = Math.max(dot(n, h), 0);
  const a = Math.max(rough * rough, 0.002);
  const a2 = a * a;
  const dd = nh * nh * (a2 - 1) + 1;
  const D = a2 / (Math.PI * dd * dd);
  const k = a / 2;
  const vis = 1 / ((nl * (1 - k) + k) * (nv * (1 - k) + k));
  const fres = Math.pow(1 - Math.max(dot(h, v), 0), 5);
  return { spec: (D * vis * nl) / 4, fres };
}

/** Normal in view space from a model-space position and the surface's tangent slopes. */
function normalOf(pm: V3, lat: number, lon: number, ge: number, gn: number, inward: boolean): V3 {
  const t = lat * DEG;
  const p = lon * DEG;
  const e: V3 = [Math.cos(p), 0, -Math.sin(p)];
  const nn: V3 = [-Math.sin(t) * Math.sin(p), Math.cos(t), -Math.sin(t) * Math.cos(p)];
  const r = Math.hypot(pm[0], pm[1], pm[2]);
  const o: V3 = [pm[0] / r, pm[1] / r, pm[2] / r];
  const sgn = inward ? -1 : 1;
  return norm(toView([sgn * o[0] + ge * e[0] + gn * nn[0], sgn * o[1] + ge * e[1] + gn * nn[1], sgn * o[2] + ge * e[2] + gn * nn[2]]));
}

function exterior(s: Surface, n: V3): { base: V3; emit: V3 } {
  const m = MATS[s.mat];
  const v: V3 = [0, 0, 1];
  const base: V3 = [0, 0, 0];
  for (const [l, c] of [
    [KEY, KEY_RGB],
    [KICK, KICK_RGB],
  ] as const) {
    const nl = Math.max(dot(n, l), 0);
    const { spec, fres } = ggx(n, l, v, s.rough);
    for (let i = 0; i < 3; i++) {
      const f = m.f0[i] + (1 - m.f0[i]) * fres;
      base[i] += c[i] * (m.albedo[i] * s.shade * nl * 0.7 + spec * f * Math.min(1.4, s.shade));
    }
  }
  // A faint warm environment: the glow of the cavity on the surrounding space.
  const nv = Math.max(n[2], 0);
  for (let i = 0; i < 3; i++) base[i] += AMBIENT[i] * s.shade * (0.4 + 0.6 * nv) + m.f0[i] * 0.012 * Math.pow(1 - nv, 3);
  const emit: V3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) emit[i] = SPILL_RGB[i] * s.spill * (0.25 + 0.75 * m.f0[i]) * Math.max(0.35, s.shade) * 0.55 + EMIT_RGB[i] * s.emit;
  return { base, emit };
}

/** The far shell's inner face, lit square-on by the star; darker members and seams read as relief. */
function interior(s: Surface, distToStarAxis: number): V3 {
  const k = s.mat === 'gore' ? 1 : 0.62;
  const occ = 0.75 + 0.25 * smooth(0.3, 0.9, distToStarAxis);
  const lum = 0.15 * k * Math.min(1.6, s.shade) * occ;
  return [lum * 1.0, lum * 0.46, lum * 0.13];
}

const STAR_LIMB: V3 = [0.5, 0.66, 0.85];
const STAR_RGB: V3 = [1.3, 0.56, 0.14];

function star(x: number, y: number): V3 {
  const r = SHELL.star;
  const mu = Math.sqrt(Math.max(0, 1 - (x * x + y * y) / (r * r)));
  const z = mu * r;
  const p = fromView([x / r, y / r, z / r]);
  // Turbulent convection: domain-warped cells over fine granulation; hotter where it wells up.
  const q = fbm(p[0] * 5 + 3, p[1] * 5, p[2] * 5, 3);
  const w = fbm(p[0] * 11 + q * 4, p[1] * 11 + q * 4, p[2] * 11 - q * 4, 4);
  const g = fbm(p[0] * 40, p[1] * 40, p[2] * 40, 2);
  const heat = Math.max(0, 0.35 + 1.5 * (w - 0.42) + 0.35 * (g - 0.5));
  const limb = Math.pow(mu, 0.55);
  const out: V3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) out[i] = STAR_RGB[i] * (0.45 + heat) * (1 - STAR_LIMB[i] * (1 - limb));
  // The core runs whiter.
  const core = Math.pow(mu, 2.5) * heat * heat * 0.9;
  out[0] += core * 0.8;
  out[1] += core * 0.75;
  out[2] += core * 0.45;
  return out;
}

/** Light scattered in the cavity, by the ray's closest approach to the star. */
function cavityGlow(b: number): V3 {
  const d = Math.max(0, b - SHELL.star);
  const k = 0.9 * Math.exp(-d / 0.018) + 0.32 * Math.exp(-d / 0.09) + 0.08 * Math.exp(-d / 0.35);
  return [k * 1.0, k * 0.42, k * 0.1];
}

/** Filmic tone map and sRGB encode, per channel. */
function display(x: number): number {
  const t = Math.max(0, x);
  const f = (t * (2.51 * t + 0.03)) / (t * (2.43 * t + 0.59) + 0.14);
  const c = Math.min(1, Math.max(0, f));
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

// Tracing -------------------------------------------------------------------

/** What a render holds: the sphere with the belt left out, or the belt alone. */
export type Part = 'fixed' | 'belt';

const FRONT_ORDER: Record<Part, readonly (keyof typeof SHELL)[]> = { fixed: ['frame', 'gore'], belt: BELT_SHELLS };
const BACK_ORDER = ['gore', 'frame', 'band', 'hub', 'collar'] as const;

interface Sample {
  /** Linear exterior colour and its emission, when the ray hits the outside. */
  front: { base: V3; emit: V3 } | null;
  /** Linear radiance of what the openings show (black past the sphere). */
  back: V3;
}

function latLon(pv: V3, r: number): [number, number, V3] {
  const pm = fromView(pv);
  const lat = Math.asin(Math.max(-1, Math.min(1, pm[1] / r))) / DEG;
  const lon = Math.atan2(pm[0], pm[2]) / DEG;
  return [lat, lon, pm];
}

function trace(x: number, y: number, part: Part, spin: number): Sample {
  const b2 = x * x + y * y;
  for (const shell of FRONT_ORDER[part]) {
    const r = SHELL[shell];
    if (b2 >= r * r) continue;
    const pv: V3 = [x, y, Math.sqrt(r * r - b2)];
    const [lat, lon, pm] = latLon(pv, r);
    const s = surfaceAt(shell, lat, lon, spin);
    if (s) return { front: exterior(s, normalOf(pm, lat, lon, s.ge, s.gn, false)), back: [0, 0, 0] };
  }
  // The belt alone is only ever its outside; past it lies the fixed render.
  if (part === 'belt') return { front: null, back: [0, 0, 0] };
  const b = Math.sqrt(b2);
  if (b2 >= 1) return { front: null, back: [0, 0, 0] };
  const glow = cavityGlow(b);
  if (b < SHELL.star) {
    const st = star(x, y);
    return { front: null, back: [st[0] + glow[0] * 0.15, st[1] + glow[1] * 0.15, st[2] + glow[2] * 0.15] };
  }
  // The far shell's inner face, the belt at rest: its pattern is lost in the cavity's glow.
  for (const shell of BACK_ORDER) {
    const r = SHELL[shell];
    if (b2 >= r * r) continue;
    const pv: V3 = [x, y, -Math.sqrt(r * r - b2)];
    const [lat, lon] = latLon(pv, r);
    const s = surfaceAt(shell, lat, lon);
    if (s) {
      const c = interior(s, b);
      return { front: null, back: [c[0] + glow[0], c[1] + glow[1], c[2] + glow[2]] };
    }
  }
  return { front: null, back: glow };
}

/** An image's frame on the drawing: pixel (0, 0)'s top-left corner at (x0, y0) radii, y up; radii per pixel. */
export interface View {
  readonly width: number;
  readonly x0: number;
  readonly y0: number;
  readonly sx: number;
  readonly sy: number;
}

/** The whole drawing as a `size`² image. */
export function squareView(size: number): View {
  const s = (2 * HALF) / UNIT / size;
  return { width: size, x0: -HALF / UNIT, y0: HALF / UNIT, sx: s, sy: s };
}

/**
 * Renders rows [y0, y1) of a view with `ss`² stratified samples per pixel, the band turned by
 * `spin`. Returns, per pixel, three straight-alpha RGBA layers, display-referred in 0–1:
 *  - front: the outside's colour, alpha its coverage;
 *  - back: what the openings show, alpha the coverage of the shell's inner disc (the cavity is
 *    opaque: the star and the far shell hide what lies behind the sphere); empty for the belt;
 *  - glow: the light added on the outside, alpha the outside's coverage (it falls nowhere else),
 *    so colour × alpha is exactly what tone mapping adds.
 * Every layer is fully transparent past the sphere (and, for the belt, past the belt).
 */
export function renderRows(view: View, y0: number, y1: number, ss: number, part: Part, spin = 0): { front: Float32Array; back: Float32Array; glow: Float32Array } {
  const rows = y1 - y0;
  const size = view.width;
  const front = new Float32Array(rows * size * 4);
  const back = new Float32Array(rows * size * 4);
  const glow = new Float32Array(rows * size * 4);
  const n = ss * ss;
  for (let py = y0; py < y1; py++) {
    for (let px = 0; px < size; px++) {
      let cover = 0;
      let disc = 0;
      let seen = 0;
      const fc: V3 = [0, 0, 0];
      const bc: V3 = [0, 0, 0];
      const gc: V3 = [0, 0, 0];
      for (let j = 0; j < ss; j++) {
        for (let i = 0; i < ss; i++) {
          const jx = hash(px, py, j * ss + i) * 0.8 + 0.1;
          const x = view.x0 + (px + (i + jx) / ss) * view.sx;
          const y = view.y0 - (py + (j + 0.5) / ss) * view.sy;
          const inDisc = part === 'fixed' && x * x + y * y < 1;
          if (inDisc) disc++;
          const s = trace(x, y, part, spin);
          if (s.front) {
            cover++;
            for (let c = 0; c < 3; c++) {
              const d0 = display(s.front.base[c]);
              fc[c] += d0;
              gc[c] += display(s.front.base[c] + s.front.emit[c]) - d0;
            }
          } else if (inDisc) {
            seen++;
            for (let c = 0; c < 3; c++) bc[c] += display(s.back[c]);
          }
        }
      }
      const o = ((py - y0) * size + px) * 4;
      for (let c = 0; c < 3; c++) {
        front[o + c] = cover ? fc[c] / cover : 0;
        back[o + c] = seen ? bc[c] / seen : 0;
        glow[o + c] = cover ? Math.min(1, gc[c] / cover) : 0;
      }
      front[o + 3] = cover / n;
      back[o + 3] = disc / n;
      glow[o + 3] = cover / n;
    }
  }
  return { front, back, glow };
}
