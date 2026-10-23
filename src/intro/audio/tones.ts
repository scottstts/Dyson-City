/**
 * The intro's synthesised tones (docs/intro-audio.md), built from their mechanisms, pure: sample
 * arrays at a rate.
 *
 *  - The cabin PA's attention chime: two struck tone bars falling a fourth (C6, then G5 0.42 s
 *    later), each its fundamental with a bar's inharmonic overtones (2.76×, 5.40×) dying sooner, a
 *    soft mallet's ~2 ms rise; the second rings on under the first word.
 *  - An avionics key's confirm: a piezo sounder's short tone (2.4 kHz with its odd partials, 70 ms,
 *    a 3 ms rise and fall) on the haptic actuator's dull thump.
 */
import { rng } from '../../audio/dsp';

/** A struck bar: fundamental f, its overtones, decay T60 of the fundamental (s). */
function addBar(out: Float32Array, sr: number, t0: number, f: number, amp: number, t60: number): void {
  const partials: [number, number, number][] = [
    [1, 1, t60],
    [2.76, 0.22, t60 * 0.35],
    [5.4, 0.07, t60 * 0.15],
  ];
  const i0 = Math.round(t0 * sr);
  const rise = 0.002 * sr;
  for (const [k, a, t] of partials) {
    const w = (2 * Math.PI * f * k) / sr;
    const decay = Math.pow(10, -3 / (t * sr));
    let env = amp * a;
    // A faint beat: the bar's two bending modes 1.2 Hz apart.
    const beat = (2 * Math.PI * 1.2) / sr;
    for (let i = 0; i0 + i < out.length && env > 1e-5; i++) {
      const r = i < rise ? i / rise : 1;
      out[i0 + i] += env * r * Math.sin(w * i) * (k === 1 ? 0.92 + 0.08 * Math.cos(beat * i) : 1);
      env *= decay;
    }
  }
}

/** The PA's two-bar chime, peak 1. */
export function synthChime(sr: number): Float32Array {
  const out = new Float32Array(Math.round(2.6 * sr));
  addBar(out, sr, 0, 1046.5, 1, 1.4);
  addBar(out, sr, 0.42, 784, 0.9, 1.8);
  return normalise(out);
}

/** A key's confirm tone on its haptic thump, peak 1. */
export function synthConfirm(sr: number, freq = 2400, seed = 7): Float32Array {
  const len = 0.09;
  const out = new Float32Array(Math.round(len * sr));
  const ramp = 0.003 * sr;
  const n = Math.round(0.07 * sr);
  const w = (2 * Math.PI * freq) / sr;
  for (let i = 0; i < n; i++) {
    const e = Math.min(1, i / ramp, (n - i) / ramp);
    // A piezo's square-ish drive: odd partials, falling.
    out[i] += e * (Math.sin(w * i) + 0.18 * Math.sin(3 * w * i) + 0.06 * Math.sin(5 * w * i));
  }
  // The actuator's thump: a few ms of low, damped noise.
  const r = rng(seed);
  let lp = 0;
  const m = Math.round(0.012 * sr);
  for (let i = 0; i < m; i++) {
    lp += 0.08 * (r() * 2 - 1 - lp);
    out[i] += 1.6 * lp * Math.exp(-i / (0.003 * sr));
  }
  return normalise(out);
}

function normalise(x: Float32Array): Float32Array {
  let p = 0;
  for (const v of x) p = Math.max(p, Math.abs(v));
  if (p > 0) for (let i = 0; i < x.length; i++) x[i] /= p;
  return x;
}
