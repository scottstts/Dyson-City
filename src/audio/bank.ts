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
import { noise, peak, rng } from './dsp';
import { addPrint, printLength, synthTexture, type SpectralPrint } from './synth/spectral';
import { FOOT_GAITS, FOOT_SURFACES, synthFootstep, type FootGait } from './synth/footstep';
import { synthValve } from './synth/valve';
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
}

/** The field's looping sounds, each cloned from a recording (src/audio/models/field*.ts). */
export type FieldLoop = 'hum' | 'cryo' | 'pump' | 'furnace' | 'crane' | 'slew' | 'vent';
const FIELD_MODELS: Record<FieldLoop, TextureModel> = { hum: FIELD_HUM, cryo: FIELD_CRYO, pump: FIELD_PUMP, furnace: FIELD_FURNACE, crane: FIELD_CRANE, slew: FIELD_SLEW, vent: FIELD_VENT };

/** Footstep variants per floor and gait (each a different recorded step, new fine structure). */
export const FOOT_BANK_VARIANTS = 3;

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
  const seeds: Record<Zone, number> = { outside: 11, chamber: 23, city: 37 };
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
  const ref = footsteps['stone:walk'].reduce((m, x) => m + peak(x), 0) / FOOT_BANK_VARIANTS;
  for (const list of Object.values(footsteps)) for (const x of list) scaled(x, 1 / ref);

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
  };
}

/** The bank's sample buffers, for a transfer list. */
export function bankBuffers(b: AudioBank): ArrayBuffer[] {
  const arrays: Float32Array[] = [b.noise, ...Object.values(b.irs).flat(), ...Object.values(b.footsteps).flat(), b.hydraulicRun, b.leafRumble, b.hydraulicStart, ...b.hydraulicStop, ...b.leafShut, ...b.latch, b.valveOpen, b.valveClose, ...Object.values(b.field)];
  return arrays.map((a) => a.buffer as ArrayBuffer);
}
