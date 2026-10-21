/**
 * The crew's sounds (docs/audio.md, "The crew"): the walkers' steps are the player's recorded steps
 * made metal (a ringing shell over a heavier, shorter footfall, damped by turf), and the drone's clone
 * resynthesises as a seamless loop with its blade-pass line.
 *
 * Metal is measured as tonality: after the strike a shell rings in a few narrow lines where a boot's
 * roll and scuff are broadband, so the tail's spectral flatness falls.
 */
import { describe, expect, it } from 'vitest';
import { Biquad, peak, rng } from '../src/audio/dsp';
import { robotSurface, synthFootstep, synthRobotStep } from '../src/audio/synth/footstep';
import { synthTexture } from '../src/audio/synth/spectral';
import { fft } from '../src/audio/synth/fft';
import { DRONE_ROTOR } from '../src/audio/models/droneRotor';

const SR = 48000;

function energy(x: Float32Array, from = 0, to = x.length): number {
  let e = 0;
  for (let i = from; i < Math.min(to, x.length); i++) e += x[i] * x[i];
  return e;
}

function band(x: Float32Array, lo: number, hi: number): Float32Array {
  const y = Float32Array.from(x);
  new Biquad('highpass', lo, 0.7, SR).process(y);
  new Biquad('lowpass', hi, 0.7, SR).process(y);
  return y;
}

/** Power spectrum of 4096 samples from `s` (Hann window). */
function power(x: Float32Array, s: number): Float64Array {
  const N = 4096;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = (x[s + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  fft(re, im);
  const p = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k] + 1e-30;
  return p;
}

/** Spectral flatness (geometric over arithmetic mean, 1–6 kHz) of a step's tail, 30 ms after its strike. */
function flatness(x: Float32Array): number {
  let at = 0;
  for (let i = 0; i < Math.min(x.length, 0.12 * SR); i++) if (Math.abs(x[i]) > Math.abs(x[at])) at = i;
  const p = power(x, at + Math.round(0.03 * SR));
  let lg = 0;
  let ar = 0;
  let n = 0;
  for (let k = Math.ceil((1000 * 4096) / SR); k <= Math.floor((6000 * 4096) / SR); k++) {
    lg += Math.log(p[k]);
    ar += p[k];
    n++;
  }
  return Math.exp(lg / n) / (ar / n);
}

const mean = (f: (v: number) => number) => [0, 1, 2, 3].reduce((m, v) => m + f(v), 0) / 4;

describe('the walkers’ steps', () => {
  it('ring like metal where the player’s boots do not', () => {
    const robot = mean((v) => flatness(synthRobotStep('hand', 'stone', v, SR, 31 + v)));
    const boot = mean((v) => flatness(synthFootstep('stone', 'walk', v, SR, 31 + v)));
    expect(robot).toBeLessThan(0.75 * boot);
  });

  it('keep the footfall’s weight: the Rigger’s pads thud lower and harder than the Hand’s feet', () => {
    // (Both on the player's steps' scale: the same recording.)
    const low = (foot: 'hand' | 'rigger') => mean((v) => energy(band(synthRobotStep(foot, 'stone', v, SR, 41 + v), 30, 200)));
    expect(low('rigger')).toBeGreaterThan(1.4 * low('hand'));
  });

  it('ring less on turf than on stone', () => {
    expect(mean((v) => flatness(synthRobotStep('hand', 'grass', v, SR, 51 + v)))).toBeGreaterThan(1.5 * mean((v) => flatness(synthRobotStep('hand', 'stone', v, SR, 51 + v))));
  });

  it('are voiced on the floors each walker meets', () => {
    expect(robotSurface('hand', 'grass')).toBe('grass');
    expect(robotSurface('hand', 'basalt')).toBe('stone');
    expect(robotSurface('hand', 'bronze')).toBe('stone');
    expect(robotSurface('rigger', 'deck')).toBe('stone');
  });

  it('are clean and die away', () => {
    for (const foot of ['hand', 'rigger'] as const) {
      const x = synthRobotStep(foot, 'stone', 0, SR, 61);
      for (const v of x) expect(Number.isFinite(v)).toBe(true);
      expect(peak(x.subarray(Math.round(x.length * 0.9)))).toBeLessThan(0.02 * peak(x));
    }
  });
});

describe('the drone’s rotors', () => {
  it('resynthesise as a seamless loop', () => {
    const x = synthTexture(DRONE_ROTOR, 16, SR, rng(9));
    let step = 0;
    for (let i = 1; i < x.length; i++) step = Math.max(step, Math.abs(x[i] - x[i - 1]));
    expect(Math.abs(x[0] - x[x.length - 1])).toBeLessThanOrEqual(step);
    // Its blade-pass line near 230 Hz stands well over the rotor noise a third-octave up (frames averaged).
    const p = new Float64Array(2048);
    for (let s = 0; s + 4096 <= x.length; s += 2048) power(x, s).forEach((v, k) => (p[k] += v));
    const sum = (lo: number, hi: number) => {
      let e = 0;
      for (let k = Math.ceil((lo * 4096) / SR); k <= Math.floor((hi * 4096) / SR); k++) e += p[k];
      return e;
    };
    expect(10 * Math.log10(sum(205, 260) / sum(285, 355))).toBeGreaterThan(12);
  });
});
