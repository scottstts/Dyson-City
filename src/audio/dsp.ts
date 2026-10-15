/**
 * Offline DSP for synthesising sample buffers (impacts, footsteps, impulse responses). Pure
 * functions on Float32Arrays: no Web Audio, so everything here runs (and is tested) in Node.
 */

/** Seeded PRNG (mulberry32): uniform in [0, 1). Every synthesised sound is reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform in [a, b). */
export function between(r: () => number, a: number, b: number): number {
  return a + (b - a) * r();
}

/** Log-uniform in [a, b): for frequencies and decay times. */
export function logBetween(r: () => number, a: number, b: number): number {
  return a * Math.pow(b / a, r());
}

/** T60 (s) to the per-sample amplitude multiplier of an exponential decay. */
export function decayPerSample(t60: number, sampleRate: number): number {
  return Math.exp(-6.907755 / (t60 * sampleRate));
}

export type BiquadType = 'lowpass' | 'highpass' | 'bandpass' | 'peaking';

/** RBJ cookbook biquad (direct form I), for offline filtering. */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(type: BiquadType, freq: number, q: number, sampleRate: number, gainDb = 0) {
    const w = (2 * Math.PI * Math.min(freq, sampleRate * 0.49)) / sampleRate;
    const cw = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const A = Math.pow(10, gainDb / 40);
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    switch (type) {
      case 'lowpass':
        b0 = (1 - cw) / 2;
        b1 = 1 - cw;
        b2 = b0;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
      case 'highpass':
        b0 = (1 + cw) / 2;
        b1 = -(1 + cw);
        b2 = b0;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
      case 'bandpass':
        // Constant 0 dB peak gain.
        b0 = alpha;
        b1 = 0;
        b2 = -alpha;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
      case 'peaking':
        b0 = 1 + alpha * A;
        b1 = -2 * cw;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cw;
        a2 = 1 - alpha / A;
        break;
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  /** Filters `x` in place over [from, to). */
  process(x: Float32Array, from = 0, to = x.length): Float32Array {
    let { x1, x2, y1, y2 } = this;
    const { b0, b1, b2, a1, a2 } = this;
    for (let i = from; i < to; i++) {
      const x0 = x[i];
      const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;
      x[i] = y0;
    }
    this.x1 = x1;
    this.x2 = x2;
    this.y1 = y1;
    this.y2 = y2;
    return x;
  }
}

/** Applies a chain of filters in place. */
export function filter(x: Float32Array, sampleRate: number, ...stages: [BiquadType, number, number, number?][]): Float32Array {
  for (const [type, f, q, g] of stages) new Biquad(type, f, q, sampleRate, g ?? 0).process(x);
  return x;
}

/** White noise in [−1, 1). */
export function noise(n: number, r: () => number): Float32Array {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 2 * r() - 1;
  return x;
}

/**
 * Spectral envelope of a contact force lasting `w` (s) at frequency f, normalised to 1 at DC: flat
 * below 1/(2w), falling as 1/f² above (a half-sine pulse's envelope, without the notches of that
 * idealised shape). A short, hard contact excites high modes; a soft or slow one (a rubber heel,
 * a seal) only the low ones.
 */
export function pulseSpectrum(f: number, w: number): number {
  const u = 2 * f * w;
  return 1 / (1 + 0.7 * u * u);
}

/**
 * Adds a damped mode (exponentially decaying sine) starting at t0 (s). Uses a rotating phasor and
 * a multiplicative decay, so the cost is two multiplies per sample.
 */
export function addMode(out: Float32Array, sampleRate: number, t0: number, freq: number, t60: number, amp: number, phase = 0): void {
  const start = Math.max(0, Math.round(t0 * sampleRate));
  const k = decayPerSample(t60, sampleRate);
  const w = (2 * Math.PI * freq) / sampleRate;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  let re = Math.cos(phase);
  let im = Math.sin(phase);
  let a = amp;
  // Stop once the mode is 100 dB down.
  const end = Math.min(out.length, start + Math.ceil(t60 * (100 / 60) * sampleRate));
  for (let i = start; i < end; i++) {
    out[i] += a * im;
    const nr = re * cw - im * sw;
    im = re * sw + im * cw;
    re = nr;
    a *= k;
  }
}

/**
 * Adds a noise burst with an attack/decay envelope (t0, attack, T60 in s), already filtered by the
 * caller-supplied stages. Used for contact clicks, scuffs and hiss bursts.
 */
export function addBurst(
  out: Float32Array,
  sampleRate: number,
  r: () => number,
  t0: number,
  attack: number,
  t60: number,
  amp: number,
  stages: [BiquadType, number, number, number?][] = [],
): void {
  const start = Math.max(0, Math.round(t0 * sampleRate));
  const len = Math.min(out.length - start, Math.ceil((attack + t60 * 1.2) * sampleRate));
  if (len <= 0) return;
  const x = noise(len, r);
  filter(x, sampleRate, ...stages);
  const na = Math.max(1, Math.round(attack * sampleRate));
  const k = decayPerSample(t60, sampleRate);
  let env = 1;
  for (let i = 0; i < len; i++) {
    const att = i < na ? 0.5 - 0.5 * Math.cos((Math.PI * i) / na) : 1;
    if (i >= na) env *= k;
    out[start + i] += amp * att * env * x[i];
  }
}

/** Peak absolute value. */
export function peak(x: Float32Array): number {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  return m;
}

/** Scales to the given peak (no-op for silence). */
export function normalise(x: Float32Array, target = 1): Float32Array {
  const p = peak(x);
  if (p > 0) {
    const s = target / p;
    for (let i = 0; i < x.length; i++) x[i] *= s;
  }
  return x;
}

/** Raised-cosine fades at both ends (s), so a buffer never starts or stops on a click. */
export function fadeEdges(x: Float32Array, sampleRate: number, fadeIn: number, fadeOut: number): Float32Array {
  const ni = Math.min(x.length, Math.round(fadeIn * sampleRate));
  const no = Math.min(x.length, Math.round(fadeOut * sampleRate));
  for (let i = 0; i < ni; i++) x[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / ni);
  for (let i = 0; i < no; i++) x[x.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / no);
  return x;
}

/** Removes DC with a one-pole high-pass at ~10 Hz (modal sums of low modes can drift). */
export function removeDc(x: Float32Array, sampleRate: number): Float32Array {
  const R = Math.exp((-2 * Math.PI * 10) / sampleRate);
  let px = 0;
  let py = 0;
  for (let i = 0; i < x.length; i++) {
    const y = x[i] - px + R * py;
    px = x[i];
    py = y;
    x[i] = y;
  }
  return x;
}

/** Energy decay curve (Schroeder backward integration), in dB relative to the total. */
export function energyDecayDb(x: Float32Array): Float32Array {
  const out = new Float32Array(x.length);
  let acc = 0;
  for (let i = x.length - 1; i >= 0; i--) {
    acc += x[i] * x[i];
    out[i] = acc;
  }
  const total = out[0] || 1;
  for (let i = 0; i < x.length; i++) out[i] = 10 * Math.log10(out[i] / total + 1e-30);
  return out;
}

/** Reverberation time from an energy decay curve: the slope between −5 and −25 dB, extrapolated to 60 dB. */
export function t60FromDecay(edc: Float32Array, sampleRate: number): number {
  let i5 = -1;
  let i25 = -1;
  for (let i = 0; i < edc.length; i++) {
    if (i5 < 0 && edc[i] <= -5) i5 = i;
    if (edc[i] <= -25) {
      i25 = i;
      break;
    }
  }
  if (i5 < 0 || i25 < 0) return Infinity;
  return ((i25 - i5) / sampleRate) * 3;
}
