/**
 * The terminal's own sounds (docs/audio.md, "The terminal"): what its small speaker plays as the
 * player works it. They are a device's tones, so they are tones, built here once at the context's
 * rate: a key's tick (the click of a haptic actuator with the panel's thump under it), a soft rising
 * pair on opening something, the pair falling on going back, a single low note on stopping, a dull
 * knock when there is nowhere to go, a three-note swell on waking and its fall on sleeping.
 */
import type { OsEventKind } from '../../terminal/os/os';

/** A decaying partial: frequency (Hz), amplitude, decay time constant (s), onset delay (s). */
type Partial = [number, number, number, number];

function render(sr: number, length: number, partials: Partial[], attack = 0.004): Float32Array {
  const n = Math.ceil(length * sr);
  const out = new Float32Array(n);
  for (const [f, a, tau, t0] of partials) {
    const i0 = Math.floor(t0 * sr);
    for (let i = i0; i < n; i++) {
      const t = (i - i0) / sr;
      const env = Math.min(1, t / attack) * Math.exp(-t / tau);
      out[i] += a * env * Math.sin(2 * Math.PI * f * t);
    }
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < n; i++) out[i] /= peak;
  // A short fade at the end (no click where the buffer stops).
  const fade = Math.min(n, Math.floor(0.01 * sr));
  for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
  return out;
}

/** Note frequencies (Hz). */
const C5 = 523.25;
const G5 = 783.99;
const D6 = 1174.66;
const E6 = 1318.51;
const A4 = 440;

export function synthTerminalSounds(sr: number): Record<OsEventKind, Float32Array> {
  const tone = (f: number, a: number, t0: number, tau = 0.07): Partial[] => [
    [f, a, tau, t0],
    [f * 2, a * 0.12, tau * 0.5, t0],
  ];
  return {
    tick: render(sr, 0.05, [[2600, 0.55, 0.0018, 0], [380, 1, 0.009, 0], [1150, 0.2, 0.004, 0]], 0.0006),
    open: render(sr, 0.32, [...tone(G5, 0.8, 0), ...tone(D6, 1, 0.065)]),
    back: render(sr, 0.32, [...tone(D6, 0.8, 0), ...tone(G5, 1, 0.065)]),
    stop: render(sr, 0.3, tone(A4, 1, 0, 0.08)),
    deny: render(sr, 0.12, [[170, 1, 0.025, 0], [240, 0.4, 0.015, 0]], 0.002),
    wake: render(sr, 1.2, [...tone(C5, 0.7, 0, 0.3), ...tone(G5, 0.8, 0.08, 0.3), ...tone(E6, 0.6, 0.16, 0.32)], 0.02),
    sleep: render(sr, 0.9, [...tone(E6, 0.5, 0, 0.22), ...tone(G5, 0.6, 0.07, 0.22), ...tone(C5, 0.7, 0.14, 0.26)], 0.01),
  };
}
