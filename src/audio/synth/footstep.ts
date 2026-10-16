/**
 * Footsteps (docs/audio.md, "Footsteps"), resynthesised from three recordings: six steps on polished
 * stone (models/footsteps.ts), three through lawn grass (models/footstepsGrass.ts) and six on fine
 * gravel over sand (models/footstepsGravel.ts). Each recorded step is a variant; every playback has
 * new fine structure.
 *
 * Walking on stone, grass and gravel are the recordings themselves. The other gaits reshape them as a
 * body would: running plants the foot harder and quicker (the heel-to-ball roll compressed, more
 * force), landing brings both feet down nearly together with the body's weight behind them (more
 * low end), stopping is a light half-step, and pushing off is mostly the ball and the sole's scuff.
 *
 * The other floors differ from their recording by what they are:
 *  - basalt is harder than the recorded stone (a little brighter); bronze sills ring;
 *  - the deck's glazed plates over structure are hollow (a low-mid body, a glassy ring, dust);
 *  - the house's timber floors are boards on joists: a low-mid body and the boards' short ring;
 *    the porches' boards span a void, hollower and longer;
 *  - rugs and stair runners keep the heel's thud and swallow the click.
 * Pure: returns sample arrays.
 */
import { addPrint, BAND_COUNT, printLength, THIRD_OCTAVES, type SpectralPrint } from './spectral';
import { addBurst, addMode, between, filter, logBetween, rng } from '../dsp';
import { FOOTSTEP_WALK } from '../models/footsteps';
import { FOOTSTEP_GRASS } from '../models/footstepsGrass';
import { FOOTSTEP_GRAVEL } from '../models/footstepsGravel';
import type { GroundSurface } from '../../city/walk';

export type FootGait = 'walk' | 'run' | 'land' | 'takeoff' | 'stop';
export const FOOT_GAITS: readonly FootGait[] = ['walk', 'run', 'land', 'takeoff', 'stop'];
export const FOOT_SURFACES: readonly GroundSurface[] = ['stone', 'basalt', 'bronze', 'deck', 'grass', 'gravel', 'wood', 'rug', 'boards'];

/** The recording a floor's steps are made from. */
export function footSource(surface: GroundSurface): readonly SpectralPrint[] {
  return surface === 'grass' ? FOOTSTEP_GRASS : surface === 'gravel' ? FOOTSTEP_GRAVEL : FOOTSTEP_WALK;
}

/** Per-band gain (dB) as a function of band centre. */
function tilt(fn: (f: number) => number): number[] {
  return THIRD_OCTAVES.map(fn);
}

/** 0 below f0, 1 above f1, log-linear between. */
const ramp = (f: number, f0: number, f1: number) => Math.min(Math.max(Math.log(f / f0) / Math.log(f1 / f0), 0), 1);
/** A bump of `db` at `f0`, `width` octaves wide (standard deviation). */
const bump = (f: number, f0: number, width: number, db: number) => db * Math.exp(-0.5 * Math.pow(Math.log2(f / f0) / width, 2));

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
  deck: tilt((f) => bump(f, 200, 0.8, 5) + ramp(f, 2000, 6000)),
  grass: tilt(() => 0),
  gravel: tilt(() => 0),
  // Boards on joists: a low-mid body; a leather heel on oak clicks less than on marble.
  wood: tilt((f) => bump(f, 180, 0.9, 5) - 3 * ramp(f, 2500, 8000)),
  // Boards over the porch's void: hollower, lower.
  boards: tilt((f) => bump(f, 140, 0.8, 7) - 4 * ramp(f, 2000, 8000)),
  // Pile and underlay: the heel's thud stays, the click is swallowed (with a low-pass: addSurface).
  rug: tilt((f) => -4 - 6 * ramp(f, 400, 3000)),
};

/** The step's length (s) for a gait, with room for the floor's ring. */
export function footstepLength(gait: FootGait, surface: GroundSurface = 'stone'): number {
  const g = GAITS[gait];
  const src = footSource(surface);
  const longest = Math.max(...src.map((p) => printLength(p)));
  return longest * g.stretch * 1.06 + (g.second ? g.second[0] * 1.4 : 0) + 0.25;
}

/** One footfall: mono samples at `sr`, at its recording's level (gaits and floors keep their force). */
export function synthFootstep(surface: GroundSurface, gait: FootGait, variant: number, sr: number, seed: number): Float32Array {
  const r = rng(seed);
  const g = GAITS[gait];
  const src = footSource(surface);
  const out = new Float32Array(Math.ceil(footstepLength(gait, surface) * sr));
  const print = src[variant % src.length];
  // A little variation across the bands: no two steps land the same.
  const wobble = between(r, -1.5, 1.5);
  const phase = r() * 6.28;
  const gain = new Array<number>(BAND_COUNT);
  for (let b = 0; b < BAND_COUNT; b++) gain[b] = g.gain[b] + SURFACES[surface][b] + wobble * Math.sin(b * 0.6 + phase);
  const stretch = g.stretch * between(r, 0.94, 1.06);
  addPrint(out, print, sr, r, { gain, stretch });
  if (g.second) {
    const other = src[(variant + 3) % src.length];
    addPrint(out, other, sr, r, { gain: gain.map((v) => v + g.second![1]), stretch, at: g.second[0] * between(r, 0.6, 1.4) });
  }
  addSurface(out, surface, gait, sr, r);
  return out;
}

/** The heel's peak in the first 80 ms: a floor's own response scales with the step's strength. */
function heelForce(out: Float32Array, gait: FootGait, sr: number): number {
  let peak = 0;
  for (let i = 0; i < Math.min(out.length, Math.round(0.08 * sr)); i++) peak = Math.max(peak, Math.abs(out[i]));
  return peak * (gait === 'land' ? 1.3 : gait === 'stop' || gait === 'takeoff' ? 0.5 : 1);
}

/** What a floor adds beyond its recording: rings, grit, the boards' body. */
function addSurface(out: Float32Array, surface: GroundSurface, gait: FootGait, sr: number, r: () => number): void {
  const heel = 0.03;
  switch (surface) {
    case 'deck': {
      const force = heelForce(out, gait, sr);
      for (let i = 0; i < 6; i++) addMode(out, sr, heel, logBetween(r, 1800, 5500), logBetween(r, 0.05, 0.12), force * between(r, 0.02, 0.05), r() * 6.28);
      // Dust crushed under the sole.
      for (let i = 0; i < 10; i++) addBurst(out, sr, r, heel + between(r, 0, 0.12), 0.0001, 0.002, force * between(r, 0.01, 0.05), [['highpass', 4000, 0.7]]);
      return;
    }
    case 'bronze': {
      // A 20 mm plate bolted into stone: a bright ring a few tenths of a second long.
      const force = heelForce(out, gait, sr);
      for (let i = 0; i < 10; i++) addMode(out, sr, heel, logBetween(r, 1100, 7000), logBetween(r, 0.2, 0.6), force * between(r, 0.04, 0.1), r() * 6.28);
      return;
    }
    case 'rug':
      // The pile takes the click: band gains alone cannot (each strike's band leaks 6 dB/octave).
      filter(out, sr, ['lowpass', 1300, 0.6], ['lowpass', 2000, 0.7]);
      return;
    case 'wood':
    case 'boards': {
      // The boards and joists: a few low modes struck at the heel, and the boards' short ring.
      const force = heelForce(out, gait, sr);
      const hollow = surface === 'boards';
      for (let i = 0; i < 4; i++) addMode(out, sr, heel, logBetween(r, hollow ? 75 : 95, hollow ? 190 : 240), logBetween(r, hollow ? 0.1 : 0.06, hollow ? 0.2 : 0.11), force * between(r, 0.05, 0.1), r() * 6.28);
      for (let i = 0; i < 5; i++) addMode(out, sr, heel, logBetween(r, 500, 1600), logBetween(r, 0.03, 0.07), force * between(r, 0.01, 0.025), r() * 6.28);
      return;
    }
    default:
      return;
  }
}

