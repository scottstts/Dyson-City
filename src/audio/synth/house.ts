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
 */
import { addBurst, addMode, between, logBetween, rng } from '../dsp';

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
