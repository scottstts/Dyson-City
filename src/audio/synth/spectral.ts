/**
 * Analysis–resynthesis primitives (docs/audio.md, "Cloning a recording"). Two kinds of model,
 * both measured from reference recordings by tools/sound-model.mjs and stored as data in
 * src/audio/models/:
 *
 *  - A spectral print: an event's spectro-temporal envelope, the mean-square level of each
 *    third-octave band at knot times, plus the times of its sharp onsets. Resynthesised as
 *    band-limited noise under those envelopes, except that at each onset every band is struck by
 *    the same impulse: a blow is one coherent wavefront (a heel's thud, a clank), not a rustle.
 *    The spectrogram is the recording's; every playback's fine structure is new.
 *  - A texture: a stationary sound's power spectral density (a smooth floor plus tonal lines with
 *    their measured widths). Resynthesised by inverse FFT with random phases into a seamless loop.
 *
 * Pure: no Web Audio.
 */
import { Biquad } from '../dsp';
import { fft } from './fft';

/** Third-octave band centres, 25 Hz to 16 kHz. */
export const THIRD_OCTAVES: readonly number[] = Array.from({ length: 29 }, (_, i) => 25 * Math.pow(2, i / 3));
export const BAND_COUNT = THIRD_OCTAVES.length;
/** Per-stage Q of the two cascaded band-passes that make one third-octave band. */
const BAND_Q = 2.9;
/**
 * A strike excites each band through one wider band-pass (Q 1.6, about an octave): a blow decays
 * faster than a third-octave filter can ring down, so it is wider in frequency than one band.
 */
const STRIKE_Q = 1.6;
/** A strike's nominal ring (s), over which its level is a mean square: ~2 / its bandwidth, 1.5–25 ms. */
function ringTime(f: number): number {
  return Math.min(0.025, Math.max(0.0015, 2 / (f / STRIKE_Q)));
}
/**
 * Bands below this take no coherent strike: their rings outlast a blow, and an analysis window
 * long enough to measure them cannot see one.
 */
export const STRIKE_MIN_HZ = 100;

/**
 * Band levels (dB, mean square) at knot times (s): levels[k][b] is band b at times[k]. Onsets are
 * the sharp blows within the event: a time, each band's strike level (dB, the mean square the strike
 * carries over its ring; −200 where the blow does not strike that band) and the contact's duration.
 */
export interface SpectralPrint {
  times: readonly number[];
  levels: readonly (readonly number[])[];
  onsets?: readonly Onset[];
}

/** A blow: time (s), each band's strike level (dB) and the contact's duration (s; 0 = an impulse). */
export type Onset = readonly [time: number, strike: readonly number[], contact?: number];

export interface PrintOptions {
  /** Offset (dB) added to every band, or per band. */
  gain?: number | readonly number[];
  /** Time scale (>1 slower). */
  stretch?: number;
  /** Start offset in the output (s). */
  at?: number;
}

/** Prints are stored as text: one printable char per value, 1 dB steps over a 90 dB range. */
export const PRINT_BASE = 33;
export const PRINT_RANGE = 90;

/** Decodes a stored print: value = offset + (char code − PRINT_BASE) dB; the range's bottom is silence. */
export function decodePrint(times: readonly number[], data: string, offset: number, onsets?: readonly Onset[]): SpectralPrint {
  if (data.length !== times.length * BAND_COUNT) throw new Error('print data does not match its knots');
  const levels: number[][] = [];
  for (let k = 0; k < times.length; k++) {
    const row: number[] = [];
    for (let b = 0; b < BAND_COUNT; b++) {
      const q = data.charCodeAt(k * BAND_COUNT + b) - PRINT_BASE;
      row.push(q <= 0 ? -200 : offset + q);
    }
    levels.push(row);
  }
  return { times, levels, onsets };
}

/** Decodes a strike's band levels, stored like a print's row. */
export function decodeStrike(data: string, offset: number): number[] {
  return Array.from(data, (c) => {
    const q = c.charCodeAt(0) - PRINT_BASE;
    return q <= 0 ? -200 : offset + q;
  });
}

/** Duration of a print (s) at a stretch. */
export function printLength(p: SpectralPrint, stretch = 1): number {
  return p.times[p.times.length - 1] * stretch;
}

/** A contact force pulse: Hann of n samples (n ≤ 1: an impulse). */
function contactPulse(n: number): Float32Array {
  if (n <= 1) return new Float32Array([1]);
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / n);
  return w;
}

/** Energy of a band's strike filter driven by a unit contact pulse (cached per band, pulse and rate). */
const strikeEnergy = new Map<string, number>();
function bandStrikeEnergy(f: number, n: number, sr: number): number {
  const key = `${f}:${n}:${sr}`;
  let e = strikeEnergy.get(key);
  if (e === undefined) {
    const h = new Float32Array(Math.ceil(0.5 * sr) + n);
    h.set(contactPulse(n));
    new Biquad('bandpass', f, STRIKE_Q, sr).process(h);
    e = 0;
    for (let i = 0; i < h.length; i++) e += h[i] * h[i];
    strikeEnergy.set(key, e);
  }
  return e;
}

/**
 * Adds the print's resynthesis into `out` (mono, at `sr`). Per band: unit-mean-square band noise
 * shaped by the band's envelope (linear in dB between knots, as amplitude every 16 samples), plus
 * each onset's strike: the band's response to one impulse shared by all bands, so they strike
 * together as one blow.
 */
export function addPrint(out: Float32Array, p: SpectralPrint, sr: number, r: () => number, opts: PrintOptions = {}): void {
  const stretch = opts.stretch ?? 1;
  const start = Math.round((opts.at ?? 0) * sr);
  const len = Math.min(out.length - start, Math.ceil(printLength(p, stretch) * sr) + 1);
  if (len <= 0) return;
  const band = new Float32Array(len);
  const imp = new Float32Array(len);
  const env = new Float32Array(len);
  const grid = new Float32Array((len >> 4) + 2);
  const times = p.times;
  const onsets = (p.onsets ?? []).map(([t, strike, contact]) => [Math.round(t * stretch * sr), strike, Math.round((contact ?? 0) * sr)] as const).filter(([i]) => i >= 0 && i < len);
  // Bands more than 70 dB under the print's loudest are inaudible beneath it.
  const gainOf = (b: number) => (typeof opts.gain === 'number' ? opts.gain : (opts.gain?.[b] ?? 0));
  const loudest = (b: number) => {
    let m = -Infinity;
    for (let k = 0; k < times.length; k++) m = Math.max(m, p.levels[k][b]);
    for (const [, strike] of p.onsets ?? []) m = Math.max(m, strike[b]);
    return m + gainOf(b);
  };
  const louds = Array.from({ length: BAND_COUNT }, (_, b) => loudest(b));
  const top = Math.max(...louds);
  for (let b = 0; b < BAND_COUNT; b++) {
    const g = gainOf(b);
    if (louds[b] < top - 70) continue;
    // Envelope: dB interpolated between knots, as amplitude on a 16-sample grid, linear between.
    const nodes = (len >> 4) + 2;
    let k = 0;
    for (let j = 0; j < nodes; j++) {
      const t = (j * 16) / sr / stretch;
      while (k < times.length - 2 && times[k + 1] < t) k++;
      const u = Math.min(Math.max((t - times[k]) / (times[k + 1] - times[k]), 0), 1);
      grid[j] = Math.pow(10, (p.levels[k][b] + (p.levels[k + 1][b] - p.levels[k][b]) * u + g) / 20);
    }
    for (let i = 0; i < len; i++) {
      const j = i >> 4;
      env[i] = grid[j] + (grid[j + 1] - grid[j]) * ((i & 15) / 16);
    }
    const f = THIRD_OCTAVES[b];
    for (let i = 0; i < len; i++) band[i] = 2 * r() - 1;
    new Biquad('bandpass', f, BAND_Q, sr).process(band);
    new Biquad('bandpass', f, BAND_Q, sr).process(band);
    // Unit mean square (the cascade's gain depends on f and sr).
    let ms = 0;
    for (let i = 0; i < len; i++) ms += band[i] * band[i];
    const norm = ms > 0 ? 1 / Math.sqrt(ms / len) : 0;
    for (let i = 0; i < len; i++) band[i] *= norm;
    const strikes = f >= STRIKE_MIN_HZ ? onsets.filter(([, strike]) => strike[b] > -150) : [];
    for (let i = 0; i < len; i++) out[start + i] += band[i] * env[i];
    if (strikes.length) {
      // Each strike: the band's response to the blow's contact pulse (shared by all bands), carrying
      // the strike's level as the mean square over its ring and contact.
      imp.fill(0);
      for (const [i0, strike, n] of strikes) {
        const pulse = contactPulse(n);
        const a = Math.sqrt((ringTime(f) * sr + n) / bandStrikeEnergy(f, n, sr)) * Math.pow(10, (strike[b] + g) / 20);
        for (let i = 0; i < pulse.length && i0 + i < len; i++) imp[i0 + i] += a * pulse[i];
      }
      new Biquad('bandpass', f, STRIKE_Q, sr).process(imp);
      for (let i = 0; i < len; i++) out[start + i] += imp[i];
    }
  }
}

/**
 * A stationary sound: PSD floor (Hz, dB re 1/Hz), tonal lines (Hz, peak dB re 1/Hz, −3 dB width Hz)
 * and, for grinding or ratcheting sounds, a layer of clicks riding on it.
 */
export interface TextureModel {
  floor: readonly (readonly [number, number])[];
  lines: readonly (readonly [number, number, number])[];
  clicks?: TextureClicks;
}

/**
 * Clicks in clusters (a ratchet's run): clusters per second, clicks per cluster, the spacing within
 * a cluster (s), each click's level over the band's own mean (dB) and the band (Hz).
 */
export interface TextureClicks {
  clustersPerSecond: number;
  perCluster: readonly [number, number];
  spacing: readonly [number, number];
  excess: readonly [number, number];
  band: readonly [number, number];
}

/** The model's PSD (linear, per Hz) at f. Floor interpolated in log f; lines Gaussian, added in power. */
export function texturePsd(m: TextureModel, f: number): number {
  const fl = m.floor;
  let db: number;
  if (f <= fl[0][0]) db = fl[0][1];
  else if (f >= fl[fl.length - 1][0]) db = fl[fl.length - 1][1];
  else {
    let i = 0;
    while (fl[i + 1][0] < f) i++;
    const u = Math.log(f / fl[i][0]) / Math.log(fl[i + 1][0] / fl[i][0]);
    db = fl[i][1] + (fl[i + 1][1] - fl[i][1]) * u;
  }
  let p = Math.pow(10, db / 10);
  for (const [lf, ldb, bw] of m.lines) {
    const s = bw / 2.355; // −3 dB full width → σ (power profile)
    const d = f - lf;
    if (Math.abs(d) < 6 * s) p += Math.pow(10, ldb / 10) * Math.exp((-0.5 * d * d) / (s * s));
  }
  return p;
}

/**
 * A seamless loop of the texture, 2^log2n samples long: random-phase spectrum with the model's
 * PSD, inverse-transformed. Its mean square in any band is the model's PSD integrated over it.
 */
export function synthTexture(m: TextureModel, log2n: number, sr: number, r: () => number): Float32Array {
  const n = 1 << log2n;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const df = sr / n;
  for (let k = 1; k < n / 2; k++) {
    const a = n * Math.sqrt((texturePsd(m, k * df) * df) / 2);
    const ph = 2 * Math.PI * r();
    re[k] = a * Math.cos(ph);
    im[k] = a * Math.sin(ph);
    re[n - k] = re[k];
    im[n - k] = -im[k];
  }
  fft(re, im, true);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = re[i] / n;
  if (m.clicks) addClicks(out, m, sr, r);
  return out;
}

/** Adds the texture's click layer (wrapping, so the loop stays seamless). */
function addClicks(out: Float32Array, m: TextureModel, sr: number, r: () => number): void {
  const c = m.clicks!;
  const [lo, hi] = c.band;
  // The band's own mean square: its PSD integrated over the band.
  let ms = 0;
  for (let f = lo; f < hi; f += 5) ms += texturePsd(m, f) * 5;
  const n = out.length;
  const dur = n / sr;
  const burst = new Float32Array(Math.round(0.004 * sr));
  const clusters = Math.round(c.clustersPerSecond * dur);
  for (let k = 0; k < clusters; k++) {
    let t = r() * dur;
    const count = Math.round(c.perCluster[0] + r() * (c.perCluster[1] - c.perCluster[0]));
    for (let j = 0; j < count; j++) {
      // A click: a 0.1 ms rise, ~3 ms decay, band-limited; its RMS over 2 ms sits `excess` over the band.
      for (let i = 0; i < burst.length; i++) burst[i] = (2 * r() - 1) * Math.min(1, i / (0.0001 * sr)) * Math.exp(-i / (0.0007 * sr));
      new Biquad('highpass', lo, 0.707, sr).process(burst);
      new Biquad('lowpass', hi, 0.707, sr).process(burst);
      let e = 0;
      const w = Math.round(0.002 * sr);
      for (let i = 0; i < w; i++) e += burst[i] * burst[i];
      const excess = c.excess[0] + r() * (c.excess[1] - c.excess[0]);
      const g = Math.sqrt((ms * Math.pow(10, excess / 10)) / (e / w + 1e-20));
      const at = Math.floor(t * sr);
      for (let i = 0; i < burst.length; i++) out[(at + i) % n] += g * burst[i];
      t += c.spacing[0] + r() * (c.spacing[1] - c.spacing[0]);
    }
  }
}
