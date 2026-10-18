/**
 * Every sample the game's sound plays, synthesised once at load (in a worker: bankWorker.ts). Pure.
 *
 * Levels: sounds resynthesised from one recording share one scale, so they keep the balance they
 * had there: the hydraulics' start and stop against their run (scaled to RMS 1), a door's shut and
 * latch against its roll (RMS 1). Footsteps are scaled so a walking step on stone peaks at 1. mix.ts
 * sets each family's level in the world.
 */
import { REVERBS, synthesizeImpulse } from './reverb';
import { ZONES, type Zone } from './acoustics';
import { filter, noise, peak, rng } from './dsp';
import { addPrint, printLength, synthTexture, type SpectralPrint } from './synth/spectral';
import { FOOT_GAITS, FOOT_SURFACES, footSource, synthFootstep, type FootGait } from './synth/footstep';
import { FOOTSTEP_GRASS } from './models/footstepsGrass';
import { FOOTSTEP_GRAVEL } from './models/footstepsGravel';
import { DOOR_OPEN } from './models/doorOpen';
import { DOOR_CLOSE } from './models/doorClose';
import { synthValve } from './synth/valve';
import { synthKettle, synthTick, type ClockKind } from './synth/house';
import { synthRustle } from './synth/rustle';
import { HYDRAULIC_RUN } from './models/hydraulicRun';
import { HYDRAULIC_START } from './models/hydraulicStart';
import { HYDRAULIC_STOP } from './models/hydraulicStop';
import { VAULT_RUMBLE } from './models/vaultRumble';
import { VAULT_SHUT } from './models/vaultShut';
import { VAULT_LATCH } from './models/vaultLatch';
import { FIELD_HUM } from './models/fieldHum';
import { FIELD_CRYO } from './models/fieldCryo';
import { FIELD_PUMP } from './models/fieldPump';
import { FIELD_FURNACE } from './models/fieldFurnace';
import { FIELD_CRANE } from './models/fieldCrane';
import { FIELD_SLEW } from './models/fieldSlew';
import { FIELD_VENT } from './models/fieldVent';
import type { TextureModel } from './synth/spectral';
import { VEHICLE_CAR } from './models/vehicleCar';
import { VEHICLE_CRAFT } from './models/vehicleCraft';
import { synthImpact } from './synth/vehicle';
import type { GroundSurface } from '../city/walk';

export type FootKey = `${GroundSurface}:${FootGait}`;

export interface AudioBank {
  sampleRate: number;
  /** White noise (6 s) for continuous voices. */
  noise: Float32Array;
  /** Stereo impulse responses of the three spaces. */
  irs: Record<Zone, [Float32Array, Float32Array]>;
  footsteps: Record<FootKey, Float32Array[]>;
  /** Seamless loops at RMS 1. */
  hydraulicRun: Float32Array;
  leafRumble: Float32Array;
  /** On the run's scale. */
  hydraulicStart: Float32Array;
  hydraulicStop: Float32Array[];
  /** On the rumble's scale. */
  leafShut: Float32Array[];
  latch: Float32Array[];
  /** Peak 1. */
  valveOpen: Float32Array;
  valveClose: Float32Array;
  /** The field's machines (docs/audio.md, "The field"): seamless loops at RMS 1. */
  field: Record<FieldLoop, Float32Array>;
  /** The house's doors (docs/audio.md, "The house"): one recording, the shut peaking at 1. */
  door: DoorSounds;
  /** The clocks' beats (each kind's mean peak 1), [ticks, tocks]. */
  ticks: Record<ClockKind, [Float32Array[], Float32Array[]]>;
  /** Seamless loops at RMS 1: the kettle simmering, leaves in the breeze. */
  kettle: Float32Array;
  rustle: Float32Array;
  /** The vehicles (docs/audio.md, "The car", "The craft"): drive and engine loops at RMS 1; the car's knocks, peak 1. */
  car: Float32Array;
  craft: Float32Array;
  impact: Float32Array[];
}

export interface DoorSounds {
  /** Latch drawn, the leaf freed, the tongue home: from the hand on the handle. */
  open: Float32Array[];
  /** The handle turned and the leaf swung (quiet), from the hand. */
  swing: Float32Array[];
  /** The leaf meeting its stop with the latch: its strike lands `strike` seconds in. */
  shut: Float32Array[];
  strike: number;
}

/** Where the close recording is cut between the swing and the shut (s): before the latch first touches the keep. */
const DOOR_SPLIT = 0.43;

/** The recorded close split at DOOR_SPLIT, with a 4 ms crossfade. */
function splitClose(x: Float32Array, sr: number): [Float32Array, Float32Array] {
  const at = Math.round(DOOR_SPLIT * sr);
  const fade = Math.round(0.004 * sr);
  const swing = x.slice(0, at + fade);
  const shut = x.slice(at);
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    swing[at + i] *= 1 - g;
    shut[i] *= g;
  }
  return [swing, shut];
}

/** Energy as the ear weighs it, roughly: above ~250 Hz (two high-pass stages). */
function loudness(x: Float32Array, sr: number): number {
  const y = filter(x.slice(), sr, ['highpass', 250, 0.7], ['highpass', 250, 0.7]);
  let e = 0;
  for (let i = 0; i < y.length; i++) e += y[i] * y[i];
  return e;
}

/** A loop scaled to RMS 1. */
function atRms(x: Float32Array): Float32Array {
  return scaled(x, 1 / rms(x));
}

/** Three ticks and three tocks of a clock, scaled to a mean peak of 1. */
function clockBeats(kind: ClockKind, sr: number, seed: number): [Float32Array[], Float32Array[]] {
  const beats = ([0, 1] as const).map((side) => [0, 1, 2].map((v) => synthTick(kind, side, sr, seed + side * 10 + v))) as [Float32Array[], Float32Array[]];
  const ref = beats.flat().reduce((m, x) => m + peak(x), 0) / 6;
  for (const x of beats.flat()) scaled(x, 1 / ref);
  return beats;
}

/** The house doors' samples, scaled so the shut peaks at 1. */
function doorSounds(sr: number): DoorSounds {
  const closes = [811, 812, 813].map((s) => splitClose(renderPrint(DOOR_CLOSE[0], sr, s, 0.2), sr));
  const open = [801, 802, 803].map((s) => renderPrint(DOOR_OPEN[0], sr, s, 0.1));
  const ref = closes.reduce((m, [, shut]) => m + peak(shut), 0) / closes.length;
  // The strongest blow of the close: the stile on the stop.
  const onsets = DOOR_CLOSE[0].onsets ?? [];
  let strike = 0;
  let best = -Infinity;
  for (const [t, s] of onsets) {
    const e = s.reduce((m, v) => m + Math.pow(10, v / 10), 0);
    if (e > best) {
      best = e;
      strike = t;
    }
  }
  return {
    open: open.map((x) => scaled(x, 1 / ref)),
    swing: closes.map(([x]) => scaled(x, 1 / ref)),
    shut: closes.map(([, x]) => scaled(x, 1 / ref)),
    strike: strike - DOOR_SPLIT,
  };
}

/** The field's looping sounds, each cloned from a recording (src/audio/models/field*.ts). */
export type FieldLoop = 'hum' | 'cryo' | 'pump' | 'furnace' | 'crane' | 'slew' | 'vent';
const FIELD_MODELS: Record<FieldLoop, TextureModel> = { hum: FIELD_HUM, cryo: FIELD_CRYO, pump: FIELD_PUMP, furnace: FIELD_FURNACE, crane: FIELD_CRANE, slew: FIELD_SLEW, vent: FIELD_VENT };

/** Footstep variants per floor and gait (each a different recorded step, new fine structure). */
export const FOOT_BANK_VARIANTS = 3;
/**
 * Walking steps on the other recordings against one on stone (dB, by loudness above ~250 Hz): turf
 * takes the heel's click; gravel crunches nearly as loud as a heel on marble.
 */
const GRASS_DB = -8;
const GRAVEL_DB = -2;

function rms(x: Float32Array): number {
  let e = 0;
  for (let i = 0; i < x.length; i++) e += x[i] * x[i];
  return Math.sqrt(e / x.length);
}

function scaled(x: Float32Array, s: number): Float32Array {
  for (let i = 0; i < x.length; i++) x[i] *= s;
  return x;
}

function renderPrint(p: SpectralPrint, sr: number, seed: number, tail = 0.05): Float32Array {
  const out = new Float32Array(Math.ceil((printLength(p) + tail) * sr));
  addPrint(out, p, sr, rng(seed));
  // A short fade so the print\x27s end is never a cut.
  const n = Math.min(out.length, Math.round(0.05 * sr));
  for (let i = 0; i < n; i++) out[out.length - 1 - i] *= i / n;
  return out;
}

export function buildAudioBank(sr: number): AudioBank {
  const seeds: Record<Zone, number> = { outside: 11, chamber: 23, city: 37, house: 41 };
  const irs = {} as Record<Zone, [Float32Array, Float32Array]>;
  for (const z of ZONES) irs[z] = synthesizeImpulse(REVERBS[z], sr, seeds[z]);

  const footsteps = {} as Record<FootKey, Float32Array[]>;
  let seed = 1;
  for (const s of FOOT_SURFACES)
    for (const g of FOOT_GAITS) {
      const list: Float32Array[] = [];
      for (let v = 0; v < FOOT_BANK_VARIANTS; v++) list.push(synthFootstep(s, g, v + (seed % 3), sr, seed++ * 7919));
      footsteps[`${s}:${g}`] = list;
    }
  const meanPeak = (k: FootKey) => footsteps[k].reduce((m, x) => m + peak(x), 0) / FOOT_BANK_VARIANTS;
  const ref = meanPeak('stone:walk');
  // The lawn and gravel recordings have their own scales: a step there is set against one on stone
  // by loudness, not peak (a low thud carries energy the ear barely weighs; a crunch is many peaks).
  const meanLoud = (k: FootKey) => footsteps[k].reduce((m, x) => m + loudness(x, sr), 0) / FOOT_BANK_VARIANTS;
  const against = (db: number, k: FootKey) => Math.pow(10, db / 20) * Math.sqrt(meanLoud('stone:walk') / meanLoud(k));
  const lawn = against(GRASS_DB, 'grass:walk');
  const gravel = against(GRAVEL_DB, 'gravel:walk');
  for (const [key, list] of Object.entries(footsteps)) {
    const src = footSource(key.split(':')[0] as GroundSurface);
    const s = (src === FOOTSTEP_GRASS ? lawn : src === FOOTSTEP_GRAVEL ? gravel : 1) / ref;
    for (const x of list) scaled(x, s);
  }

  const hydraulicRun = synthTexture(HYDRAULIC_RUN, 18, sr, rng(101));
  const run = rms(hydraulicRun);
  scaled(hydraulicRun, 1 / run);
  const leafRumble = synthTexture(VAULT_RUMBLE, 19, sr, rng(202));
  const roll = rms(leafRumble);
  scaled(leafRumble, 1 / roll);

  return {
    sampleRate: sr,
    noise: noise(Math.round(6 * sr), rng(0x5eed)),
    irs,
    footsteps,
    hydraulicRun,
    leafRumble,
    hydraulicStart: scaled(renderPrint(HYDRAULIC_START[0], sr, 301), 1 / run),
    hydraulicStop: [302, 303].map((s) => scaled(renderPrint(HYDRAULIC_STOP[0], sr, s, 0.2), 1 / run)),
    leafShut: [401, 402].map((s) => scaled(renderPrint(VAULT_SHUT[0], sr, s, 0.3), 1 / roll)),
    latch: [501, 502, 503].map((s) => scaled(renderPrint(VAULT_LATCH[0], sr, s, 0.1), 1 / roll)),
    valveOpen: synthValve('open', sr, 601),
    valveClose: synthValve('close', sr, 602),
    field: Object.fromEntries((Object.keys(FIELD_MODELS) as FieldLoop[]).map((k, i) => {
      const x = synthTexture(FIELD_MODELS[k], 10, sr, rng(701 + i));
      return [k, scaled(x, 1 / rms(x))];
    })) as Record<FieldLoop, Float32Array>,
    door: doorSounds(sr),
    ticks: { longcase: clockBeats('longcase', sr, 901), mantel: clockBeats('mantel', sr, 951) },
    kettle: atRms(synthKettle(9, sr, 991)),
    rustle: atRms(synthRustle(19, sr, 997)),
    // Long loops: the drive's tonal lines are a few hertz wide.
    car: atRms(synthTexture(VEHICLE_CAR, 19, sr, rng(1101))),
    craft: atRms(synthTexture(VEHICLE_CRAFT, 18, sr, rng(1201))),
    impact: [1301, 1302, 1303].map((seed) => synthImpact(sr, seed)),
  };
}

/** The bank's sample buffers, for a transfer list. */
export function bankBuffers(b: AudioBank): ArrayBuffer[] {
  const arrays: Float32Array[] = [b.noise, ...Object.values(b.irs).flat(), ...Object.values(b.footsteps).flat(), b.hydraulicRun, b.leafRumble, b.hydraulicStart, ...b.hydraulicStop, ...b.leafShut, ...b.latch, b.valveOpen, b.valveClose, ...Object.values(b.field), ...b.door.open, ...b.door.swing, ...b.door.shut, ...Object.values(b.ticks).flat(2), b.kettle, b.rustle, b.car, b.craft, ...b.impact];
  return arrays.map((a) => a.buffer as ArrayBuffer);
}
