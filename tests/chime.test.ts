import { describe, expect, it } from 'vitest';
import { CHIME, synthChime } from '../src/audio/synth/chime';
import { airlockAnnouncements, chimed, SPEECHES } from '../src/audio/loadSpeech';

const SR = 48000;

/** Amplitude of a frequency over a window (a single-bin DFT). */
function level(x: Float32Array, f: number, t0: number, t1: number): number {
  let re = 0;
  let im = 0;
  const a = Math.round(t0 * SR);
  const b = Math.round(t1 * SR);
  for (let i = a; i < b; i++) {
    re += x[i] * Math.cos((2 * Math.PI * f * i) / SR);
    im += x[i] * Math.sin((2 * Math.PI * f * i) / SR);
  }
  return (2 * Math.hypot(re, im)) / (b - a);
}

describe('announcement chime', () => {
  const x = synthChime(SR);

  it('is two bars rising a fourth, the second struck after the first', () => {
    let peak = 0;
    for (const v of x) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeCloseTo(1, 5);
    const [[f1], [f2, at2]] = CHIME.notes;
    expect(f2 / f1).toBeCloseTo(4 / 3, 2);
    // Before the second strike only the first rings; after it the second leads.
    expect(level(x, f1, 0.02, at2 - 0.01)).toBeGreaterThan(10 * level(x, f2, 0.02, at2 - 0.01));
    expect(level(x, f2, at2 + 0.01, at2 + 0.2)).toBeGreaterThan(level(x, f1, at2 + 0.01, at2 + 0.2));
  });

  it('starts without a click and is brief: well down by the speech, silent at its end', () => {
    expect(Math.abs(x[0])).toBeLessThan(1e-3);
    let start = 0;
    for (let i = 0; i < 0.003 * SR; i++) start = Math.max(start, Math.abs(x[i]));
    expect(start).toBeLessThan(0.9);
    let tail = 0;
    for (let i = Math.round(CHIME.lead * SR); i < Math.round((CHIME.lead + 0.05) * SR); i++) tail = Math.max(tail, Math.abs(x[i]));
    expect(tail).toBeLessThan(0.35);
    expect(Math.abs(x[x.length - 1])).toBeLessThan(1e-4);
  });

  it('comes before every announcement but the chamber’s, and the airlock waits for it', () => {
    expect(SPEECHES.filter((s) => !chimed(s))).toEqual(['pressurization', 'depressurization']);
    const clips = Object.fromEntries(SPEECHES.map((s) => [s, { duration: 2 }])) as Record<(typeof SPEECHES)[number], { duration: number }>;
    const a = airlockAnnouncements(clips);
    expect(a.enter).toBeCloseTo(2 + CHIME.lead, 6);
    expect(a.exit).toBeCloseTo(2 + CHIME.lead, 6);
    expect(a.pressurize).toBe(2);
    expect(a.depressurize).toBe(2);
  });
});
