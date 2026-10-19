/**
 * The announcements' chime (docs/audio.md, "Announcements"): two tuned tone bars struck in turn,
 * rising a fourth (E5, then A5), as a PA's chime unit plays them. Built from the mechanism: each
 * bar rings its fundamental and the overtones a tone bar is tuned to (4× and 10×), the higher ones
 * dying sooner; a soft mallet gives each a ~1.5 ms rise rather than a click; a faint second
 * harmonic is the horn's own; the fundamental's two bending modes sit 1.5 Hz apart, a slow shimmer.
 * Pure: returns samples, peak-normalised (levels are set in mix.ts).
 */
import { fadeEdges, normalise } from '../dsp';

export const CHIME = {
  /** Each bar: frequency (Hz), when it is struck (s), relative strength. */
  notes: [
    [659.26, 0, 1],
    [880.0, 0.24, 0.9],
  ] as readonly (readonly [number, number, number])[],
  /** Seconds from the first strike to the speech's start. */
  lead: 0.75,
  /** Length of the buffer (s): the second bar rings under the speech's first word, then fades. */
  length: 1.5,
} as const;

/** Partials of a tuned tone bar: ratio to the fundamental, amplitude, decay time constant (s). */
const PARTIALS: readonly (readonly [number, number, number])[] = [
  [1, 1, 0.42],
  [1 + 1.5 / 659.26, 0.18, 0.5],
  [2, 0.05, 0.2],
  [4, 0.11, 0.09],
  [10, 0.025, 0.025],
];
/** The mallet's contact: rise time constant (s). */
const RISE = 0.0015;

export function synthChime(sr: number): Float32Array {
  const out = new Float32Array(Math.round(CHIME.length * sr));
  for (const [f0, at, strength] of CHIME.notes) {
    const start = Math.round(at * sr);
    for (const [ratio, amp, tau] of PARTIALS) {
      const f = f0 * ratio;
      if (f > sr * 0.45) continue;
      const w = (2 * Math.PI * f) / sr;
      const end = Math.min(out.length, start + Math.ceil(tau * 12 * sr));
      for (let i = start; i < end; i++) {
        const t = (i - start) / sr;
        out[i] += strength * amp * (1 - Math.exp(-t / RISE)) * Math.exp(-t / tau) * Math.sin(w * (i - start));
      }
    }
  }
  return normalise(fadeEdges(out, sr, 0, 0.3), 1);
}
