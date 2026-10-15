/**
 * Footsteps (docs/audio.md, "Footsteps"), resynthesised from steps recorded on polished stone
 * (models/footsteps.ts): six measured steps, each a variant, every playback with new fine structure.
 *
 * Walking on stone is the recording itself. The other gaits reshape it as a body would: running
 * plants the foot harder and quicker (the heel-to-ball roll compressed, more force), landing brings
 * both feet down nearly together with the body's weight behind them (more low end), stopping is a
 * light half-step, and pushing off is mostly the ball and the sole's scuff. The floors differ from
 * the recorded stone by what they are: the chamber's basalt is harder (a little brighter), the deck's
 * glazed plates over structure are hollow (a low-mid body, a glassy ring, dust underfoot) and the
 * bronze sills ring. Pure: returns sample arrays.
 */
import { addPrint, BAND_COUNT, printLength, THIRD_OCTAVES } from './spectral';
import { addBurst, addMode, between, logBetween, rng } from '../dsp';
import { FOOTSTEP_WALK } from '../models/footsteps';
import type { GroundSurface } from '../../city/walk';

export type FootGait = 'walk' | 'run' | 'land' | 'takeoff' | 'stop';
export const FOOT_GAITS: readonly FootGait[] = ['walk', 'run', 'land', 'takeoff', 'stop'];
export const FOOT_SURFACES: readonly GroundSurface[] = ['stone', 'basalt', 'bronze', 'deck'];
/** Recorded steps (variants). */
export const FOOT_VARIANTS = FOOTSTEP_WALK.length;

/** Per-band gain (dB) as a function of band centre. */
function tilt(fn: (f: number) => number): number[] {
  return THIRD_OCTAVES.map(fn);
}

/** 0 below f0, 1 above f1, log-linear between. */
const ramp = (f: number, f0: number, f1: number) => Math.min(Math.max(Math.log(f / f0) / Math.log(f1 / f0), 0), 1);

interface GaitShape {
  /** Time scale of the step (heel-to-ball roll). */
  stretch: number;
  /** Per-band gain (dB). */
  gain: number[];
  /** A second foot landing this long after the first (s), at this gain (dB). */
  second?: [number, number];
}

const GAITS: Record<FootGait, GaitShape> = {
  walk: { stretch: 1, gain: tilt(() => 0) },
  // Forefoot planted hard: the roll a third quicker, ~5 dB more force, a little brighter.
  run: { stretch: 0.68, gain: tilt((f) => 5 + 2 * ramp(f, 500, 4000)) },
  // Both feet, the body's weight: +7 dB, +5 dB more below 250 Hz.
  land: { stretch: 0.55, gain: tilt((f) => 7 + 5 * (1 - ramp(f, 125, 400))), second: [0.025, -3] },
  // The trailing foot set down alongside.
  stop: { stretch: 0.6, gain: tilt(() => -7) },
  // Push-off: the ball and the scuff, little heel.
  takeoff: { stretch: 0.8, gain: tilt((f) => -2 - 10 * (1 - ramp(f, 300, 1200))) },
};

const SURFACES: Record<GroundSurface, number[]> = {
  stone: tilt((f) => -1.5 * ramp(f, 2000, 8000)),
  basalt: tilt((f) => 1.5 * ramp(f, 800, 4000)),
  bronze: tilt((f) => ramp(f, 1000, 4000)),
  // Hollow plates over structure: a low-mid body.
  deck: tilt((f) => 5 * Math.exp(-0.5 * Math.pow(Math.log2(f / 200) / 0.8, 2)) + ramp(f, 2000, 6000)),
};

/** The step's length (s) for a gait, with room for the floor's ring. */
export function footstepLength(gait: FootGait): number {
  const g = GAITS[gait];
  return printLength(FOOTSTEP_WALK[0], g.stretch * 1.06) + (g.second ? g.second[0] * 1.4 : 0) + 0.25;
}

/** One footfall: mono samples at `sr`, at the recording's level (gaits and floors keep their force). */
export function synthFootstep(surface: GroundSurface, gait: FootGait, variant: number, sr: number, seed: number): Float32Array {
  const r = rng(seed);
  const g = GAITS[gait];
  const out = new Float32Array(Math.ceil(footstepLength(gait) * sr));
  const print = FOOTSTEP_WALK[variant % FOOT_VARIANTS];
  // A little variation across the bands: no two steps land the same.
  const wobble = between(r, -1.5, 1.5);
  const phase = r() * 6.28;
  const gain = new Array<number>(BAND_COUNT);
  for (let b = 0; b < BAND_COUNT; b++) gain[b] = g.gain[b] + SURFACES[surface][b] + wobble * Math.sin(b * 0.6 + phase);
  const stretch = g.stretch * between(r, 0.94, 1.06);
  addPrint(out, print, sr, r, { gain, stretch });
  if (g.second) {
    const other = FOOTSTEP_WALK[(variant + 3) % FOOT_VARIANTS];
    addPrint(out, other, sr, r, { gain: gain.map((v) => v + g.second![1]), stretch, at: g.second[0] * between(r, 0.6, 1.4) });
  }
  addSurface(out, surface, gait, sr, r);
  return out;
}

/** What a floor adds beyond the recorded stone: the deck's glassy ring and grit, the bronze's ring. */
function addSurface(out: Float32Array, surface: GroundSurface, gait: FootGait, sr: number, r: () => number): void {
  if (surface !== 'deck' && surface !== 'bronze') return;
  // Scale the floor's response to the step's own strength at the heel.
  let peak = 0;
  for (let i = 0; i < Math.min(out.length, Math.round(0.08 * sr)); i++) peak = Math.max(peak, Math.abs(out[i]));
  const force = peak * (gait === 'land' ? 1.3 : gait === 'stop' || gait === 'takeoff' ? 0.5 : 1);
  const heel = 0.03;
  if (surface === 'deck') {
    for (let i = 0; i < 6; i++) addMode(out, sr, heel, logBetween(r, 1800, 5500), logBetween(r, 0.05, 0.12), force * between(r, 0.02, 0.05), r() * 6.28);
    // Dust crushed under the sole.
    for (let i = 0; i < 10; i++) addBurst(out, sr, r, heel + between(r, 0, 0.12), 0.0001, 0.002, force * between(r, 0.01, 0.05), [['highpass', 4000, 0.7]]);
  } else {
    // A 20 mm plate bolted into stone: a bright ring a few tenths of a second long.
    for (let i = 0; i < 10; i++) addMode(out, sr, heel, logBetween(r, 1100, 7000), logBetween(r, 0.2, 0.6), force * between(r, 0.04, 0.1), r() * 6.28);
  }
}
