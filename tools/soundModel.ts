/**
 * Measures reference recordings and fits procedural models to them (run by tools/sound-model.mjs;
 * not part of the game). The recordings are only read here, from paths given on the command line:
 * what the game ships is the fitted model (src/audio/models/), never the audio.
 *
 *  - Prints: an event's third-octave envelope at knot times, fitted by resynthesising, re-measuring
 *    and correcting until the resynthesis measures like the recording.
 *  - Textures: a stationary segment's PSD floor and tonal lines, fitted the same way.
 */
import { addPrint, BAND_COUNT, PRINT_BASE, PRINT_RANGE, STRIKE_MIN_HZ, synthTexture, texturePsd, THIRD_OCTAVES, type SpectralPrint, type TextureClicks, type TextureModel } from '../src/audio/synth/spectral';
import { fft } from '../src/audio/synth/fft';
import { Biquad, rng } from '../src/audio/dsp';

export interface Audio {
  x: Float32Array;
  sr: number;
}

/** Parses a 16-bit PCM WAV, mixed to mono. */
export function parseWav(bytes: Uint8Array): Audio {
  const buf = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  let off = 12;
  let sr = 48000;
  let ch = 1;
  let data = -1;
  let size = 0;
  while (off + 8 <= bytes.length) {
    const id = tag(off);
    size = buf.getUint32(off + 4, true);
    if (id === 'fmt ') {
      ch = buf.getUint16(off + 10, true);
      sr = buf.getUint32(off + 12, true);
    }
    if (id === 'data') {
      data = off + 8;
      break;
    }
    off += 8 + size;
  }
  if (data < 0) throw new Error('no data chunk (16-bit PCM WAV expected)');
  const n = Math.floor(Math.min(size, bytes.length - data) / 2 / ch);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) s += buf.getInt16(data + (i * ch + c) * 2, true);
    x[i] = s / ch / 32768;
  }
  return { x, sr };
}

/** Encodes mono 16-bit PCM WAV. */
export function encodeWav(x: Float32Array, sr: number): Uint8Array {
  const n = x.length;
  const bytes = new Uint8Array(44 + n * 2);
  const v = new DataView(bytes.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => (bytes[o + i] = c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), true);
  return bytes;
}

/** Analysis window per band: ~4 periods of the band centre, 256..8192 samples at 48 kHz. */
function windowFor(f: number, sr: number): number {
  const want = (4 * sr) / f;
  let n = 256;
  while (n < want && n < 8192) n <<= 1;
  return n;
}

const hann = new Map<number, Float64Array>();
function window(n: number): Float64Array {
  let w = hann.get(n);
  if (!w) {
    w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    hann.set(n, w);
  }
  return w;
}

/**
 * Third-octave band levels (dB, mean square of the band's signal) at the given times (s), each band
 * measured with its own window length (short for highs, long for lows).
 */
export function bandLevels(a: Audio, times: readonly number[]): number[][] {
  const { x, sr } = a;
  const out = times.map(() => new Array<number>(BAND_COUNT).fill(-120));
  const byN = new Map<number, number[]>();
  THIRD_OCTAVES.forEach((f, b) => {
    const n = windowFor(f, sr);
    byN.set(n, [...(byN.get(n) ?? []), b]);
  });
  for (const [n, bands] of byN) {
    const w = window(n);
    let ws = 0;
    for (let i = 0; i < n; i++) ws += w[i] * w[i];
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    times.forEach((t, k) => {
      const c = Math.round(t * sr) - n / 2;
      for (let i = 0; i < n; i++) {
        const j = c + i;
        re[i] = (j >= 0 && j < x.length ? x[j] : 0) * w[i];
        im[i] = 0;
      }
      fft(re, im);
      for (const b of bands) {
        const f = THIRD_OCTAVES[b];
        const lo = (f / Math.pow(2, 1 / 6) / sr) * n;
        const hi = (f * Math.pow(2, 1 / 6) / sr) * n;
        let e = 0;
        for (let i = Math.max(1, Math.floor(lo)); i <= Math.ceil(hi) && i < n / 2; i++) {
          // Fractional bins at the band edges.
          const wgt = Math.min(1, Math.max(0, Math.min(i + 0.5, hi) - Math.max(i - 0.5, lo)));
          e += wgt * (re[i] * re[i] + im[i] * im[i]);
        }
        out[k][b] = 10 * Math.log10((2 * e) / (n * ws) + 1e-14);
      }
    });
  }
  return out;
}

/** Per-band background floor (dB): a low percentile of the band's level over the whole recording. */
export function floorLevels(a: Audio, percentile = 0.08): number[] {
  const times: number[] = [];
  for (let t = 0.05; t < a.x.length / a.sr - 0.05; t += 0.01) times.push(t);
  const lv = bandLevels(a, times);
  return THIRD_OCTAVES.map((_, b) => {
    const v = lv.map((row) => row[b]).sort((p, q) => p - q);
    return v[Math.floor(v.length * percentile)];
  });
}

/** Mean band levels (dB, power average) over a segment: the background a print is measured over. */
export function segmentLevels(a: Audio, t0: number, t1: number): number[] {
  const times: number[] = [];
  for (let t = t0; t < t1; t += 0.01) times.push(t);
  const lv = bandLevels(a, times);
  return THIRD_OCTAVES.map((_, b) => 10 * Math.log10(lv.reduce((s, row) => s + Math.pow(10, row[b] / 10), 0) / lv.length));
}

/**
 * Knot times for an event of length d (s): fine at the onset, coarser later (≤ maxStep), and
 * 1.25 ms apart from 5 ms before to 20 ms after each transient (so a click stays a click).
 */
export function knots(d: number, maxStep = 0.02, transients: readonly number[] = []): number[] {
  const t: number[] = [0];
  while (t[t.length - 1] < d) {
    const last = t[t.length - 1];
    let step = Math.min(maxStep, Math.max(0.00125, 0.12 * last));
    if (transients.some((x) => last > x - 0.006 && last < x + 0.02)) step = 0.00125;
    else {
      // Do not step over the start of a dense region.
      const next = transients.find((x) => x - 0.005 > last && x - 0.005 < last + step);
      if (next !== undefined) step = Math.max(0.00125, next - 0.005 - last);
    }
    t.push(last + step);
  }
  return t;
}

/** Sharp onsets inside [t0, t0 + d): times (relative) where the 1–16 kHz level jumps ≥ rise dB within 5 ms. */
export function transientsIn(a: Audio, t0: number, d: number, rise = 9): number[] {
  const hop = 0.00125;
  const times: number[] = [];
  for (let t = t0 - 0.01; t < t0 + d; t += hop) times.push(t);
  const hf = THIRD_OCTAVES.map((f, b) => (f >= 1000 ? b : -1)).filter((b) => b >= 0);
  const lv = bandLevels(a, times).map((row) => 10 * Math.log10(hf.reduce((s, b) => s + Math.pow(10, row[b] / 10), 0)));
  const out: number[] = [];
  for (let k = 4; k < lv.length; k++) {
    const before = Math.min(...lv.slice(k - 4, k));
    const t = times[k] - t0;
    if (lv[k] - before >= rise && t >= 0 && (out.length === 0 || t - out[out.length - 1] > 0.015)) out.push(Math.max(0, refineOnset(a, t0 + t) - t0));
  }
  return out;
}

/**
 * The sample where a blow near `t` starts: on the waveform above 1 kHz, the first sample within
 * the preceding 10 ms that reaches 15 % of the blow's peak (the band analysis places it a few
 * milliseconds early: its window sees the blow before it happens).
 */
function refineOnset(a: Audio, t: number): number {
  const sr = a.sr;
  const i0 = Math.max(1, Math.round((t - 0.01) * sr));
  const i1 = Math.min(a.x.length - 1, Math.round((t + 0.012) * sr));
  const hp = new Float32Array(i1 - i0);
  const lp = new Biquad('lowpass', 1000, 0.707, sr);
  const seg = a.x.slice(Math.max(0, i0 - 480), i1);
  const low = lp.process(Float32Array.from(seg));
  for (let i = 0; i < hp.length; i++) hp[i] = seg[i + (i0 - Math.max(0, i0 - 480))] - low[i + (i0 - Math.max(0, i0 - 480))];
  let peak = 0;
  let at = 0;
  for (let i = 0; i < hp.length; i++)
    if (Math.abs(hp[i]) > peak) {
      peak = Math.abs(hp[i]);
      at = i;
    }
  for (let i = 0; i <= at; i++) if (Math.abs(hp[i]) >= 0.15 * peak) return (i0 + i) / sr;
  return t;
}

/** Subtracts a floor (power) from measured levels; what is left at or under the floor is 25 dB below it. */
function minusFloor(levels: number[][], floor: readonly number[] | null): number[][] {
  if (!floor) return levels;
  return levels.map((row) =>
    row.map((db, b) => {
      const p = Math.pow(10, db / 10) - Math.pow(10, floor[b] / 10);
      return p > 0 ? Math.max(10 * Math.log10(p), floor[b] - 25) : floor[b] - 25;
    }),
  );
}

export interface FitReport {
  /** Mean absolute error (dB) over cells within 40 dB of the event's loudest band level. */
  error: number;
  /** The error at each iteration. */
  history: number[];
}

export interface PrintFitOptions {
  /** Keep only bands within [lo, hi] Hz (others silent). */
  bands?: [number, number];
  /** Longest knot step (s). */
  maxStep?: number;
  /** Detect sharp onsets: dense knots around them, and coherent blows in the resynthesis. */
  transients?: boolean;
  iterations?: number;
}

/** Octave groups whose time-domain envelopes pin down timing that third-octave analysis smears. */
const GROUPS: readonly (readonly [number, number])[] = [
  [20, 63],
  [63, 250],
  [250, 1000],
  [1000, 4000],
  [4000, 20000],
];
const groupOf = THIRD_OCTAVES.map((f) => GROUPS.findIndex(([lo, hi]) => f >= lo && f < hi));
/** A group's envelope window (s): two periods of its lowest frequency, at least 2.5 ms. */
const groupWindow = (g: number) => Math.max(0.0025, 2 / GROUPS[g][0]);
/** Fine timing steers only bands from here up: below, a group's window is no shorter than a band's. */
const FINE_MIN_HZ = 250;

/** Envelopes (dB, mean square over the group's window) of each octave group at the given times (s). */
export function groupLevels(a: Audio, times: readonly number[]): number[][] {
  const out = times.map(() => new Array<number>(GROUPS.length).fill(-200));
  GROUPS.forEach(([lo, hi], g) => {
    const n = Math.round(groupWindow(g) * a.sr);
    const y = Float32Array.from(a.x);
    new Biquad('highpass', lo, 0.707, a.sr).process(y);
    new Biquad('highpass', lo, 0.707, a.sr).process(y);
    new Biquad('lowpass', hi, 0.707, a.sr).process(y);
    new Biquad('lowpass', hi, 0.707, a.sr).process(y);
    times.forEach((t, k) => {
      const c = Math.round(t * a.sr);
      let e = 0;
      for (let i = c - (n >> 1); i < c + (n >> 1); i++) if (i >= 0 && i < y.length) e += y[i] * y[i];
      out[k][g] = 10 * Math.log10(e / n + 1e-14);
    });
  });
  return out;
}

/**
 * Measures an event (onset t0, length d) and fits a print whose resynthesis measures the same.
 * `floor` (per band) is removed first so the recording's background is not part of the model.
 *
 * Two measurements steer the fit: third-octave levels (spectral balance; each band's window smears
 * time by its own length) and, wherever that smear would hide a blow (within half a band's window
 * of an onset), octave-group envelopes at 2.5 ms, which pin its timing.
 *
 * With transients, each onset strikes the bands that jump at it (resolvable at the band's window
 * and ≥ 6 dB over what sounded before): a coherent blow whose level follows the group envelope just
 * after the onset, and whose contact duration is chosen to match the fine envelope's shape.
 */
export function fitPrint(a: Audio, t0: number, d: number, floor: readonly number[] | null, o: PrintFitOptions = {}): { print: SpectralPrint; report: FitReport } {
  const iterations = o.iterations ?? 8;
  const tr = o.transients ? transientsIn(a, t0, d) : [];
  const times = knots(d, o.maxStep ?? 0.02, tr);
  const at = times.map((t) => t0 + t);
  const measured = minusFloor(bandLevels(a, at), floor);
  if (o.bands) {
    const [lo, hi] = o.bands;
    for (const row of measured) THIRD_OCTAVES.forEach((f, b) => (f < lo || f > hi) && (row[b] = -200));
  }
  const groupFloor = floor ? GROUPS.map((_, g) => 10 * Math.log10(floor.reduce((s, v, b) => (groupOf[b] === g ? s + Math.pow(10, v / 10) : s), 0) + 1e-20)) : null;
  const fine = groupLevels(a, at).map((row) =>
    row.map((db, g) => {
      if (!groupFloor) return db;
      const p = Math.pow(10, db / 10) - Math.pow(10, groupFloor[g] / 10);
      return p > 0 ? Math.max(10 * Math.log10(p), groupFloor[g] - 25) : groupFloor[g] - 25;
    }),
  );
  const top = Math.max(...measured.flat());
  // Where a band's window straddles an onset (its "zone") its own time shape cannot be measured:
  // it starts as its group's fine envelope at the band's share of the group over the zone, and is
  // steered by the group's fine envelope from there.
  const nearOnset = times.map((t) => THIRD_OCTAVES.map((f) => f >= FINE_MIN_HZ && tr.some((on) => Math.abs(t - on) < windowFor(f, a.sr) / a.sr / 2)));
  const levels = measured.map((r) => [...r]);
  const zoneDb = (rows: number[][], b: number) => {
    let e = 0;
    let n = 0;
    rows.forEach((row, k) => {
      if (nearOnset[k][b]) {
        e += Math.pow(10, row[b] / 10);
        n++;
      }
    });
    return n ? 10 * Math.log10(e / n + 1e-20) : 0;
  };
  for (let b = 0; b < BAND_COUNT; b++) {
    const g = groupOf[b];
    const share = zoneDb(measured, b) - zoneDb(fine.map((row) => THIRD_OCTAVES.map(() => row[g])), b);
    for (let k = 0; k < times.length; k++) if (nearOnset[k][b]) levels[k][b] = fine[k][g] + share;
  }
  const strikes = tr.map(() => new Array<number>(BAND_COUNT).fill(-200));
  THIRD_OCTAVES.forEach((f, b) => {
    if (f < STRIKE_MIN_HZ) return;
    const half = windowFor(f, a.sr) / a.sr / 2;
    let last = -Infinity;
    tr.forEach((on, j) => {
      if (on - last < half) return;
      let before = -200;
      let after = -200;
      for (let k = 0; k < times.length; k++) {
        if (times[k] <= on - half) before = measured[k][b];
        if (times[k] >= on && times[k] <= on + Math.max(half, 0.004)) after = Math.max(after, measured[k][b]);
      }
      if (after - before < 6) return;
      strikes[j][b] = after - 6;
      last = on;
    });
  });
  const contacts = tr.map(() => 0);
  const print = (): SpectralPrint => ({ times, levels, onsets: tr.length ? tr.map((on, j) => [on, strikes[j], contacts[j]] as const) : undefined });
  const PRE = 0.2;
  const render = (p: SpectralPrint, seed: number): Audio => {
    const y = new Float32Array(Math.ceil((d + 0.3 + PRE) * a.sr));
    addPrint(y, p, a.sr, rng(seed), { at: PRE });
    return { x: y, sr: a.sr };
  };
  const measure = (p: SpectralPrint) => {
    // Average of three resyntheses (power), measured exactly as the recording was.
    const bands = times.map(() => new Array<number>(BAND_COUNT).fill(0));
    const groups = times.map(() => new Array<number>(GROUPS.length).fill(0));
    const shifted = times.map((t) => t + PRE);
    for (let s = 0; s < 3; s++) {
      const y = render(p, 1000 + s);
      bandLevels(y, shifted).forEach((row, k) => row.forEach((db, b) => (bands[k][b] += Math.pow(10, db / 10) / 3)));
      groupLevels(y, shifted).forEach((row, k) => row.forEach((db, g) => (groups[k][g] += Math.pow(10, db / 10) / 3)));
    }
    const db = (v: number) => 10 * Math.log10(v + 1e-14);
    return { bands: bands.map((r) => r.map(db)), groups: groups.map((r) => r.map(db)) };
  };
  const history: number[] = [];
  // The fit is kept at its best iteration (strikes and contacts can trade off against the bands).
  let best: { error: number; print: SpectralPrint } | null = null;
  const snapshot = (): SpectralPrint => ({
    times,
    levels: levels.map((r) => [...r]),
    onsets: tr.length ? tr.map((on, j) => [on, [...strikes[j]], contacts[j]] as const) : undefined,
  });
  for (let it = 0; it <= iterations; it++) {
    const m = measure(print());
    let sum = 0;
    let cnt = 0;
    for (let k = 0; k < times.length; k++)
      for (let b = 0; b < BAND_COUNT; b++) {
        if (measured[k][b] < top - 40) continue;
        sum += Math.abs(measured[k][b] - m.bands[k][b]);
        cnt++;
      }
    const error = sum / Math.max(cnt, 1);
    history.push(error);
    if (!best || error < best.error) best = { error, print: snapshot() };
    if (it === iterations) break;
    for (let k = 0; k < times.length; k++)
      for (let b = 0; b < BAND_COUNT; b++) {
        const g = groupOf[b];
        const err = nearOnset[k][b] ? fine[k][g] - m.groups[k][g] : measured[k][b] - m.bands[k][b];
        levels[k][b] = Math.max(-120, Math.min(levels[k][b] + 0.7 * Math.max(-12, Math.min(12, err)), measured[k][b] + 24));
      }
    // A strike follows its group's envelope over the first 5 ms after its onset.
    strikes.forEach((row, j) =>
      row.forEach((lv, b) => {
        const g = groupOf[b];
        if (lv <= -150) return;
        let want = 0;
        let got = 0;
        for (let k = 0; k < times.length; k++)
          if (times[k] >= tr[j] && times[k] <= tr[j] + Math.max(0.005, groupWindow(g))) {
            want += Math.pow(10, fine[k][g] / 10);
            got += Math.pow(10, m.groups[k][g] / 10);
          }
        if (got > 0 && want > 0) row[b] = lv + 0.7 * Math.max(-12, Math.min(12, 10 * Math.log10(want / got)));
      }),
    );
    if (it === 2)
      tr.forEach(
        (on, j) =>
          (contacts[j] = bestContact(a, t0, on, (c) => {
            contacts[j] = c;
            return render(print(), 31).x.subarray(Math.round(PRE * a.sr));
          })),
      );
  }
  return { print: best!.print, report: { error: best!.error, history } };
}

/** Envelopes (dB, 1.25 ms RMS) of a signal below and above 800 Hz over [t0, t1) s. */
function fineEnvelopes(x: Float32Array, sr: number, t0: number, t1: number): [number[], number[]] {
  const i0 = Math.max(0, Math.round(t0 * sr) - 2400);
  const seg = x.slice(i0, Math.min(x.length, Math.round(t1 * sr)));
  const low = Float32Array.from(seg);
  new Biquad('lowpass', 800, 0.707, sr).process(low);
  new Biquad('lowpass', 800, 0.707, sr).process(low);
  const n = Math.round(0.00125 * sr);
  const lo: number[] = [];
  const hi: number[] = [];
  for (let s = Math.round(t0 * sr) - i0; s + n <= seg.length; s += n) {
    let el = 0;
    let eh = 0;
    for (let i = s; i < s + n; i++) {
      el += low[i] * low[i];
      eh += (seg[i] - low[i]) ** 2;
    }
    lo.push(10 * Math.log10(el / n + 1e-14));
    hi.push(10 * Math.log10(eh / n + 1e-14));
  }
  return [lo, hi];
}

/**
 * The contact duration (s) for the blow at `on` (relative to the event at t0) whose resynthesis
 * envelope, below and above 800 Hz at 1.25 ms resolution, best follows the recording's from 3 ms
 * before the blow to 25 ms after. `render(c)` resynthesises the event with that contact.
 */
function bestContact(a: Audio, t0: number, on: number, render: (contact: number) => Float32Array): number {
  const [rl, rh] = fineEnvelopes(a.x, a.sr, t0 + on - 0.003, t0 + on + 0.025);
  const top = Math.max(...rl, ...rh);
  let best = 0;
  let bestErr = Infinity;
  for (const c of [0, 0.0005, 0.001, 0.002, 0.003, 0.004, 0.005, 0.006, 0.008]) {
    const [cl, ch] = fineEnvelopes(render(c), a.sr, on - 0.003, on + 0.025);
    let e = 0;
    let n = 0;
    for (let k = 0; k < Math.min(rl.length, cl.length); k++) {
      if (rl[k] > top - 40) {
        e += Math.abs(rl[k] - cl[k]);
        n++;
      }
      if (rh[k] > top - 40) {
        e += Math.abs(rh[k] - ch[k]);
        n++;
      }
    }
    if (n && e / n < bestErr) {
      bestErr = e / n;
      best = c;
    }
  }
  return best;
}

/** Welch PSD (per Hz, one-sided) of a segment, n-point Hann frames with 75 % overlap. */
export function welch(a: Audio, t0: number, t1: number, n = 32768): Float64Array {
  const { x, sr } = a;
  const w = window(n);
  let ws = 0;
  for (let i = 0; i < n; i++) ws += w[i] * w[i];
  const P = new Float64Array(n / 2);
  let frames = 0;
  for (let s = Math.round(t0 * sr); s + n <= Math.round(t1 * sr); s += n / 4) {
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = x[s + i] * w[i];
    fft(re, im);
    for (let k = 0; k < n / 2; k++) P[k] += (2 * (re[k] * re[k] + im[k] * im[k])) / (sr * ws);
    frames++;
  }
  for (let k = 0; k < n / 2; k++) P[k] /= Math.max(frames, 1);
  return P;
}

/** Floor of a PSD: median over ±1/6 octave, sampled on a 1/12-octave grid from 20 Hz. */
function psdFloor(P: Float64Array, sr: number): [number, number][] {
  const n = P.length * 2;
  const df = sr / n;
  const db = Array.from(P, (v) => 10 * Math.log10(v + 1e-30));
  const grid: [number, number][] = [];
  for (let i = 0; ; i++) {
    const f = 20 * Math.pow(2, i / 12);
    if (f > Math.min(20000, sr / 2 - 100)) break;
    const lo = Math.max(1, Math.floor(f / Math.pow(2, 1 / 6) / df));
    const hi = Math.min(P.length - 1, Math.ceil((f * Math.pow(2, 1 / 6)) / df));
    const v = db.slice(lo, hi + 1).sort((p, q) => p - q);
    grid.push([f, v[Math.floor(v.length / 2)]]);
  }
  return grid;
}

/** Tonal lines: local maxima ≥ `over` dB above the floor, with −3 dB widths, below fmax. */
function psdLines(P: Float64Array, sr: number, floor: [number, number][], over = 8, fmax = 6000): [number, number, number][] {
  const df = sr / (P.length * 2);
  const db = Array.from(P, (v) => 10 * Math.log10(v + 1e-30));
  const m: TextureModel = { floor, lines: [] };
  const lines: [number, number, number][] = [];
  for (let k = 3; k < P.length - 3 && k * df < fmax; k++) {
    const fl = 10 * Math.log10(texturePsd(m, k * df));
    if (!(db[k] >= db[k - 1] && db[k] > db[k + 1] && db[k] - fl > over)) continue;
    let l = k;
    let r = k;
    while (l > 1 && db[l] > db[k] - 3) l--;
    while (r < P.length - 1 && db[r] > db[k] - 3) r++;
    lines.push([k * df, db[k], Math.max((r - l) * df, df)]);
  }
  // Keep the strongest line within any 2 % neighbourhood.
  lines.sort((p, q) => q[1] - p[1]);
  const kept: [number, number, number][] = [];
  for (const L of lines) if (!kept.some((K) => Math.abs(K[0] - L[0]) < 0.02 * L[0])) kept.push(L);
  return kept.sort((p, q) => p[0] - q[0]);
}

/**
 * Clicks riding on a stationary segment in [lo, hi] Hz: 2 ms envelope peaks ≥ 6 dB over the band's
 * median, grouped into clusters (gaps ≤ 30 ms).
 */
export function measureClicks(a: Audio, t0: number, t1: number, lo: number, hi: number): TextureClicks {
  const y = a.x.slice(Math.round(t0 * a.sr), Math.round(t1 * a.sr));
  new Biquad('highpass', lo, 0.707, a.sr).process(y);
  new Biquad('highpass', lo, 0.707, a.sr).process(y);
  new Biquad('lowpass', hi, 0.707, a.sr).process(y);
  const n = Math.round(0.002 * a.sr);
  const env: number[] = [];
  for (let s = 0; s + n <= y.length; s += n) {
    let e = 0;
    for (let i = s; i < s + n; i++) e += y[i] * y[i];
    env.push(10 * Math.log10(e / n + 1e-14));
  }
  const med = [...env].sort((p, q) => p - q)[env.length >> 1];
  const peaks: [number, number][] = [];
  for (let k = 1; k < env.length - 1; k++) if (env[k] > env[k - 1] && env[k] >= env[k + 1] && env[k] - med > 6) peaks.push([k * 0.002, env[k] - med]);
  const pct = (v: number[], q: number) => (v.length ? [...v].sort((p, r) => p - r)[Math.min(v.length - 1, Math.floor(q * v.length))] : 0);
  const sizes: number[] = [];
  const spacing: number[] = [];
  let size = peaks.length ? 1 : 0;
  for (let i = 1; i < peaks.length; i++) {
    const gap = peaks[i][0] - peaks[i - 1][0];
    if (gap <= 0.03) {
      size++;
      spacing.push(gap);
    } else {
      sizes.push(size);
      size = 1;
    }
  }
  if (size) sizes.push(size);
  return {
    clustersPerSecond: sizes.length / (t1 - t0),
    perCluster: [Math.max(1, pct(sizes, 0.25)), Math.max(1, pct(sizes, 0.75))],
    spacing: [pct(spacing, 0.1) || 0.004, pct(spacing, 0.6) || 0.012],
    excess: [6, Math.max(8, pct(peaks.map((p) => p[1]), 0.9))],
    band: [lo, hi],
  };
}

/** Measures a stationary segment and fits a texture model whose resynthesis measures the same. */
export function fitTexture(a: Audio, t0: number, t1: number, iterations = 4, over = 8, clickBand?: [number, number]): { model: TextureModel; report: FitReport } {
  const target = welch(a, t0, t1);
  const floor = psdFloor(target, a.sr);
  const lines = psdLines(target, a.sr, floor, over);
  const clicks = clickBand ? measureClicks(a, t0, t1, clickBand[0], clickBand[1]) : undefined;
  let model: TextureModel = { floor, lines, clicks };
  const targetFloor = floor.map(([, v]) => v);
  let error = 0;
  for (let it = 0; it <= iterations; it++) {
    const y = synthTexture(model, 19, a.sr, rng(77 + it));
    const P = welch({ x: y, sr: a.sr }, 0, y.length / a.sr);
    const mf = psdFloor(P, a.sr);
    error = mf.reduce((s, [, v], i) => s + Math.abs(v - targetFloor[i]), 0) / mf.length;
    if (it === iterations) break;
    const nf = model.floor.map(([f, v], i): [number, number] => [f, v + 0.8 * (targetFloor[i] - mf[i][1])]);
    // Lines: correct peak levels against the target spectrum.
    const df = a.sr / (P.length * 2);
    const nl = model.lines.map(([f, v, bw]): [number, number, number] => {
      const k = Math.round(f / df);
      const err = 10 * Math.log10(target[k] + 1e-30) - 10 * Math.log10(P[k] + 1e-30);
      return [f, v + 0.6 * Math.max(-6, Math.min(6, err)), bw];
    });
    model = { floor: nf, lines: nl, clicks };
  }
  return { model, report: { error, history: [] } };
}

/** Encodes one row of band levels with a print's offset (silence at the range's bottom). */
export function encodeLevels(row: readonly number[], offset: number): string {
  return row.map((v) => String.fromCharCode(PRINT_BASE + (v <= -150 ? 0 : Math.max(1, Math.min(PRINT_RANGE, Math.round(v - offset)))))).join('');
}

/** Encodes a print's levels as printable text, one char per value: 1 dB steps over a 90 dB range. */
export function encodePrint(p: SpectralPrint): { offset: number; data: string } {
  const flat = [...p.levels.flat(), ...(p.onsets ?? []).flatMap(([, s]) => s)];
  const offset = Math.ceil(Math.max(...flat)) - PRINT_RANGE;
  const levels = p.levels.flat();
  let data = '';
  for (const v of levels) data += String.fromCharCode(PRINT_BASE + Math.max(0, Math.min(PRINT_RANGE, Math.round(v - offset))));
  return { offset, data };
}

export function synthPrint(p: SpectralPrint, sr: number, seed: number, pad = 0.05): Float32Array {
  const y = new Float32Array(Math.ceil((p.times[p.times.length - 1] + pad) * sr));
  addPrint(y, p, sr, rng(seed));
  return y;
}
