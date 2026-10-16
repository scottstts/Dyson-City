/**
 * The house's own sounds, built from their mechanisms (docs/audio.md "The house"; no recording).
 * Pure: returns sample arrays.
 *
 *  - Clocks. An anchor escapement beats twice per swing of the pendulum: each beat the escape
 *    wheel is unlocked (a faint click), then runs a few milliseconds until a tooth drops onto the
 *    other pallet (the strong click). That blow rings the movement's brass plates (bright, short)
 *    and the case it stands in (wood: low, longer). The modes are the clock's own, the same every
 *    beat; what differs from beat to beat is the blow, and the entry and exit pallets differ, so
 *    the beats go tick, tock. The longcase's tall oak trunk gives its beat a deep body; the mantel
 *    clock's small case is higher and lighter, and it beats faster.
 *  - The kettle simmering on the range: just under the boil, vapour bubbles form on the hot base
 *    and collapse in the cooler water above (a dense fizz of tiny clicks, 1.5–7 kHz), the odd larger
 *    bubble rises and rings at its Minnaert frequency (a few hundred hertz to ~1.4 kHz), and the
 *    kettle's body and water column hum underneath. The heat wanders, and the fizz with it.
 */
import { addBurst, addMode, between, filter, logBetween, noise, rng } from '../dsp';

export type ClockKind = 'longcase' | 'mantel';

interface ClockSpec {
  /** Seconds between beats. */
  beat: number;
  /** Unlocking to drop (s). */
  drop: number;
  /** Plate modes: count, frequency range (Hz), t60 range (s), amplitude range. */
  plate: [number, number, number, number, number, number, number];
  /** Case modes, likewise. */
  body: [number, number, number, number, number, number, number];
}

export const CLOCKS: Record<ClockKind, ClockSpec> = {
  // A seconds pendulum (≈ 1 m): one beat a second.
  longcase: { beat: 1, drop: 0.011, plate: [8, 1800, 8000, 0.02, 0.06, 0.06, 0.18], body: [7, 105, 620, 0.06, 0.16, 0.14, 0.32] },
  // A short pendulum at 11,520 beats an hour.
  mantel: { beat: 0.3125, drop: 0.006, plate: [7, 2600, 9500, 0.012, 0.035, 0.08, 0.2], body: [5, 300, 1500, 0.025, 0.07, 0.08, 0.2] },
};

/** One beat of a clock: `side` 0 is the entry pallet (tick), 1 the exit (tock). Peak near 1. */
export function synthTick(kind: ClockKind, side: 0 | 1, sr: number, seed: number): Float32Array {
  const spec = CLOCKS[kind];
  const out = new Float32Array(Math.ceil(0.32 * sr));
  // The clock's modes: fixed by the clock, not by the beat.
  const modes = rng(kind === 'longcase' ? 0xc10c : 0x3a7e1);
  const r = rng(seed);
  const unlock = 0.003;
  const drop = unlock + spec.drop * (side ? 1.12 : 1) * between(r, 0.97, 1.03);
  addBurst(out, sr, r, unlock, 0.00005, 0.0008, 0.12, [['highpass', 3000, 0.7]]);
  // The drop: a hard brass-on-steel blow.
  const blow = between(r, 0.9, 1.1);
  addBurst(out, sr, r, drop, 0.00004, 0.0012, 0.6 * blow, [['highpass', side ? 1200 : 1600, 0.7]]);
  const [pn, pf0, pf1, pt0, pt1, pa0, pa1] = spec.plate;
  for (let i = 0; i < pn; i++) {
    const f = logBetween(modes, pf0, pf1);
    const t60 = logBetween(modes, pt0, pt1);
    const a = between(modes, pa0, pa1);
    // The exit pallet strikes a little softer at the top.
    const tilt = side ? Math.pow(pf0 / f, 0.35) : 1;
    addMode(out, sr, drop, f, t60, a * tilt * blow * Math.pow(10, between(r, -2, 2) / 20), r() * 6.28);
  }
  const [bn, bf0, bf1, bt0, bt1, ba0, ba1] = spec.body;
  for (let i = 0; i < bn; i++) {
    const f = logBetween(modes, bf0, bf1);
    const t60 = logBetween(modes, bt0, bt1);
    const a = between(modes, ba0, ba1);
    addMode(out, sr, drop + 0.0006, f, t60, a * blow * (side ? 1.15 : 1) * Math.pow(10, between(r, -2, 2) / 20), r() * 6.28);
  }
  return out;
}

/** Adds events over a loop of `n` samples, folding what runs past the end back onto the start (seamless). */
function folded(n: number, sr: number, tail: number, add: (out: Float32Array) => void): Float32Array {
  const long = new Float32Array(n + Math.ceil(tail * sr));
  add(long);
  const out = long.slice(0, n);
  for (let i = n; i < long.length; i++) out[i - n] += long[i];
  return out;
}

/** A periodic slow wander over a loop (0..1): a few sines with whole cycles per loop. */
export function loopWander(t: number, length: number, phases: readonly number[]): number {
  let v = 0;
  phases.forEach((p, i) => (v += Math.sin((2 * Math.PI * (i + 2) * t) / length + p) / (i + 1)));
  return 0.5 + 0.5 * Math.tanh(v);
}

/** Overlaps the end of a filtered loop into its start (equal power) over `fade` seconds; returns the shortened loop. */
export function crossfadeLoop(x: Float32Array, sr: number, fade: number): Float32Array {
  const m = Math.round(fade * sr);
  const n = x.length - m;
  const out = x.slice(0, n);
  for (let i = 0; i < m; i++) {
    const g = i / m;
    out[i] = x[i] * Math.sin((Math.PI / 2) * g) + x[n + i] * Math.cos((Math.PI / 2) * g);
  }
  return out;
}

/** The kettle simmering: a seamless loop of `seconds`. */
export function synthKettle(seconds: number, sr: number, seed: number): Float32Array {
  const r = rng(seed);
  const n = Math.round(seconds * sr);
  const phases = [r() * 6.28, r() * 6.28, r() * 6.28];
  const heat = (t: number) => 0.55 + 0.45 * loopWander(t, seconds, phases);
  const fizz = folded(n, sr, 0.05, (out) => {
    // Tiny collapses: Poisson, their rate following the heat.
    for (let t = 0; t < seconds; t += -Math.log(1 - r()) / 420) {
      if (r() > heat(t)) continue;
      const size = Math.pow(r(), 2.2);
      addBurst(out, sr, r, t, 0.0001, logBetween(r, 0.0008, 0.003), 0.04 + 0.4 * size, [['bandpass', logBetween(r, 1500, 7000), 1.8]]);
    }
    // Larger bubbles ringing as they detach and collapse.
    for (let t = 0; t < seconds; t += -Math.log(1 - r()) / 22) {
      if (r() > heat(t)) continue;
      addMode(out, sr, t, logBetween(r, 350, 1400), logBetween(r, 0.008, 0.022), between(r, 0.15, 0.6), r() * 6.28);
    }
  });
  // The body and water column: a low hum, following the heat.
  const hum = noise(n + Math.round(0.1 * sr), r);
  filter(hum, sr, ['bandpass', 260, 0.9], ['lowpass', 700, 0.7]);
  for (let i = 0; i < hum.length; i++) hum[i] *= 0.35 * heat((i % n) / sr);
  const bed = crossfadeLoop(hum, sr, 0.1);
  for (let i = 0; i < n; i++) fizz[i] += bed[i];
  return fizz;
}
