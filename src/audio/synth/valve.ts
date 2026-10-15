/**
 * The chamber's equalising valves (docs/audio.md, "Pressurisation"), by modal synthesis. Pure:
 * returns sample arrays, peak-normalised (levels are set in mix.ts).
 */
import { addBurst, addMode, between, fadeEdges, normalise, removeDc, rng } from '../dsp';

export type ValveAction = 'open' | 'close';

/**
 * Opening: the actuator's thunk and the pop as the pressure difference first breaks through (a
 * broadband burst with a deep thump, before the steady jet). Closing: the thunk and the jet's last
 * breath cut off.
 */
export function synthValve(action: ValveAction, sr: number, seed: number): Float32Array {
  const r = rng(seed);
  const out = new Float32Array(Math.round(0.9 * sr));
  for (const [f, t60, a] of [
    [180, 0.12, 0.7],
    [410, 0.09, 0.45],
    [950, 0.06, 0.3],
  ]) addMode(out, sr, 0, f * between(r, 0.95, 1.05), t60, a, between(r, 0, 6.28));
  addBurst(out, sr, r, 0, 0.0003, 0.01, 0.4, [['highpass', 1800, 0.7]]);
  if (action === 'open') {
    addMode(out, sr, 0.01, between(r, 38, 48), 0.3, 1.2);
    addBurst(out, sr, r, 0.008, 0.004, 0.16, 1.0, [
      ['highpass', 300, 0.6],
      ['lowpass', 10000, 0.7],
    ]);
  } else {
    addBurst(out, sr, r, 0, 0.002, 0.06, 0.35, [['highpass', 2500, 0.7]]);
  }
  removeDc(out, sr);
  return normalise(fadeEdges(out, sr, 0.0003, 0.08), 1);
}
