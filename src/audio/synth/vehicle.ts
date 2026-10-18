/**
 * The car striking a wall (docs/audio.md, "The car"), built from its mechanism: no recording
 * exists. The contact is a short crack (the composite skin's fracture-free knock, its highs
 * short-lived), a dull thump of the body's mass on its suspension, and the shell's panel modes
 * ringing down: a hollow body of ceramic composite over a metal frame, so the modes are low and
 * damped quickly. Each variant draws its own mode amplitudes and decays. Peak 1. Pure.
 */
import { filter, peak, rng } from '../dsp';

/** Panel and frame modes (Hz) and their decay times (s). */
const MODES: readonly [number, number][] = [
  [86, 0.16],
  [141, 0.12],
  [229, 0.09],
  [372, 0.07],
  [598, 0.05],
  [947, 0.035],
  [1510, 0.022],
];

export function synthImpact(sr: number, seed: number): Float32Array {
  const r = rng(seed);
  const n = Math.round(0.6 * sr);
  const out = new Float32Array(n);
  // The crack: a few ms of noise, highs only.
  const crack = new Float32Array(Math.round(0.006 * sr));
  for (let i = 0; i < crack.length; i++) crack[i] = (r() * 2 - 1) * Math.exp(-i / (0.0012 * sr));
  filter(crack, sr, ['highpass', 900, 0.7]);
  for (let i = 0; i < crack.length; i++) out[i] += crack[i] * 0.8;
  // The thump: the mass arrested, a half-cycle near 55 Hz.
  const tn = Math.round(0.03 * sr);
  for (let i = 0; i < tn; i++) out[i] += Math.sin((Math.PI * i) / tn) * 0.9 * (0.85 + 0.3 * r());
  // The shell's modes, struck together.
  for (const [f0, tau0] of MODES) {
    const f = f0 * (0.96 + 0.08 * r());
    const tau = tau0 * (0.8 + 0.4 * r());
    const a = (0.25 + 0.5 * r()) * Math.pow(f / 200, -0.35);
    const ph = r() * Math.PI * 2;
    for (let i = 0; i < n; i++) out[i] += a * Math.exp(-i / (tau * sr)) * Math.sin((2 * Math.PI * f * i) / sr + ph);
  }
  // The last of the ring fades out rather than being cut.
  const fade = Math.round(0.2 * sr);
  for (let i = 0; i < fade; i++) out[n - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fade);
  const p = peak(out);
  for (let i = 0; i < n; i++) out[i] /= p;
  return out;
}
