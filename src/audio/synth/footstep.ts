/**
 * Footsteps (docs/audio.md, "Footsteps"), resynthesised from four recordings: six steps on polished
 * stone (models/footsteps.ts), three through lawn grass (models/footstepsGrass.ts), six on fine
 * gravel over sand (models/footstepsGravel.ts) and twenty on a timber floor (models/footstepsWood.ts).
 * Each recorded step is a variant; every playback has new fine structure.
 *
 * Walking on stone, grass, gravel and the house's hard floors (all of them voiced as timber) are the recordings themselves. The other gaits reshape them as a
 * body would: running plants the foot harder and quicker (the heel-to-ball roll compressed, more
 * force), landing brings both feet down nearly together with the body's weight behind them (more
 * low end), stopping is a light half-step, and pushing off is mostly the ball and the sole's scuff.
 *
 * The other floors differ from their recording by what they are:
 *  - basalt is harder than the recorded stone (a little brighter); bronze sills ring;
 *  - the deck's glazed plates over structure are hollow (a low-mid body, a glassy ring, dust);
 *  - the porches' boards span a void: the timber recording, hollower and lower;
 *  - rugs, runners and mats lie on the hard floors: the timber's thud kept, its tap swallowed.
 * Pure: returns sample arrays.
 */
import { addPrint, BAND_COUNT, printLength, THIRD_OCTAVES, type SpectralPrint } from './spectral';
import { addBurst, addMode, between, filter, logBetween, rng } from '../dsp';
import { FOOTSTEP_WALK } from '../models/footsteps';
import { FOOTSTEP_GRASS } from '../models/footstepsGrass';
import { FOOTSTEP_GRAVEL } from '../models/footstepsGravel';
import { FOOTSTEP_WOOD } from '../models/footstepsWood';
import type { GroundSurface } from '../../city/walk';

export type FootGait = 'walk' | 'run' | 'land' | 'takeoff' | 'stop';
export const FOOT_GAITS: readonly FootGait[] = ['walk', 'run', 'land', 'takeoff', 'stop'];
export const FOOT_SURFACES: readonly GroundSurface[] = ['stone', 'basalt', 'bronze', 'deck', 'grass', 'gravel', 'wood', 'rug', 'boards'];

/** The recording a floor's steps are made from. */
export function footSource(surface: GroundSurface): readonly SpectralPrint[] {
  if (surface === 'grass') return FOOTSTEP_GRASS;
  if (surface === 'gravel') return FOOTSTEP_GRAVEL;
  if (surface === 'wood' || surface === 'boards' || surface === 'rug') return FOOTSTEP_WOOD;
  return FOOTSTEP_WALK;
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
  // The recording itself (its band leakage trimmed by real filters: addSurface).
  wood: tilt(() => 0),
  // Boards over the porch's void: the timber floor hollower, lower.
  boards: tilt((f) => bump(f, 130, 0.7, 4) - 2 * ramp(f, 2000, 8000)),
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
      // Each strike's band-pass leaks 6 dB/octave, which band gains cannot take back: above 6 kHz the
      // clone ran 4–12 dB over the recording, below 40 Hz over it too. Real filters set both (±4 dB).
      filter(out, sr, ['highpass', 62, 0.7], ['lowpass', 6500, 0.6]);
      return;
    case 'boards': {
      // The void under the porch's deck: a few low modes struck at the heel, ringing longer than a floor on joists.
      const force = heelForce(out, gait, sr);
      for (let i = 0; i < 4; i++) addMode(out, sr, heel, logBetween(r, 75, 190), logBetween(r, 0.1, 0.2), force * between(r, 0.03, 0.06), r() * 6.28);
      return;
    }
    default:
      return;
  }
}


/**
 * The crew's walkers (docs/crew.md, "Sound"): the player's recorded steps, made metal. A robot's
 * foot is a cast shell on a hard rubber sole, planted nearly flat by an ankle actuator: the boot's
 * heel-to-ball roll is compressed, its leather scuff taken off, its weight a little heavier; and as
 * it lands the shell and the leg ring (a few inharmonic modes, short: the sole damps them) over a
 * low knock from the actuator's gear lash. On turf and gravel the ground takes most of the ring.
 */
export type RobotFoot = 'hand' | 'rigger';
/** The floors each walker meets: the Hands the compound's stone, the decks, the estate's lawns and walks; the Riggers only the compound's. */
export const ROBOT_SURFACES: Record<RobotFoot, readonly GroundSurface[]> = { hand: ['stone', 'deck', 'grass', 'gravel'], rigger: ['stone'] };
/** Variants per walker and floor. */
export const ROBOT_STEP_VARIANTS = 5;

/** The floor a robot's step is voiced on: its own, or the nearest it has (every hard floor is stone). */
export function robotSurface(foot: RobotFoot, s: GroundSurface): GroundSurface {
  const own = ROBOT_SURFACES[foot];
  if (own.includes(s)) return s;
  return s === 'rug' && own.includes('grass') ? 'grass' : 'stone';
}

interface RobotShape {
  /** The print's roll, compressed. */
  stretch: number;
  /** Per-band gain (dB) on the walking step. */
  gain: number[];
  /** The shell's ring: mode count, band (Hz), T60 (s), amplitude against the heel's peak. */
  modes: number;
  band: [number, number];
  t60: [number, number];
  ring: [number, number];
  /** The actuator's lash: a low knock's band (Hz) and amplitude. */
  knock: [number, number];
  lash: number;
}

const ROBOT: Record<RobotFoot, RobotShape> = {
  // A ~90 kg biped on cast feet.
  hand: { stretch: 0.62, gain: tilt((f) => 2 * (1 - ramp(f, 120, 400)) - 5 * ramp(f, 2500, 8000)), modes: 7, band: [1400, 5200], t60: [0.07, 0.2], ring: [0.1, 0.22], knock: [220, 420], lash: 0.16 },
  // A quarter of a much heavier frame on each broad pad: deeper, longer.
  rigger: { stretch: 0.55, gain: tilt((f) => 5 * (1 - ramp(f, 100, 400)) - 3 * ramp(f, 2000, 8000)), modes: 9, band: [650, 3200], t60: [0.1, 0.3], ring: [0.12, 0.24], knock: [110, 200], lash: 0.22 },
};

/** How much of the shell's ring a floor lets through (turf and gravel take most of it). */
const RING_ON: Partial<Record<GroundSurface, number>> = { grass: 0.3, gravel: 0.55 };

/** One robot footfall: mono samples at `sr`, on its recording's scale (as the player's steps). */
export function synthRobotStep(foot: RobotFoot, surface: GroundSurface, variant: number, sr: number, seed: number): Float32Array {
  const r = rng(seed);
  const shape = ROBOT[foot];
  const src = footSource(surface);
  const out = new Float32Array(Math.ceil(footstepLength('walk', surface) * sr));
  const print = src[variant % src.length];
  const wobble = between(r, -1.5, 1.5);
  const phase = r() * 6.28;
  const gain = new Array<number>(BAND_COUNT);
  for (let b = 0; b < BAND_COUNT; b++) gain[b] = GAITS.walk.gain[b] + SURFACES[surface][b] + shape.gain[b] + wobble * Math.sin(b * 0.6 + phase);
  addPrint(out, print, sr, r, { gain, stretch: shape.stretch * between(r, 0.95, 1.05) });
  addSurface(out, surface, 'walk', sr, r);
  // The strike: the heel's peak in the first 120 ms.
  let at = 0;
  let force = 0;
  for (let i = 0; i < Math.min(out.length, Math.round(0.12 * sr)); i++) {
    const a = Math.abs(out[i]);
    if (a > force) {
      force = a;
      at = i;
    }
  }
  const t0 = Math.max(0, at / sr - 0.002);
  const damp = RING_ON[surface] ?? 1;
  for (let i = 0; i < shape.modes; i++) addMode(out, sr, t0, logBetween(r, shape.band[0], shape.band[1]), logBetween(r, shape.t60[0], shape.t60[1]), force * damp * between(r, shape.ring[0], shape.ring[1]), r() * 6.28);
  addMode(out, sr, t0 + between(r, 0.004, 0.009), logBetween(r, shape.knock[0], shape.knock[1]), between(r, 0.03, 0.06), force * Math.sqrt(damp) * shape.lash, r() * 6.28);
  return out;
}
