/**
 * The crew's sounds (docs/audio.md, "The crew"), each from the robot making it. Nothing ships as a
 * recording: every voice is a clone or the bank's own synthesis.
 *
 *  - Drones: the user's drone recording, cloned (models/droneRotor.ts). Rotor speed follows thrust,
 *    so pitch follows its square root and level and brightness the thrust; a Ferry's bigger rotors
 *    run slower (lower) and louder. Resting on its cradle or pad a drone is silent.
 *  - Wheeled machines reuse the car's drive clone (models/vehicleCar.ts): a Dray's hub motors (small,
 *    so higher than the car's) idle energised and rise with speed over its tyres' roll on the stone; a
 *    Linewalker's drive is smaller still, its rollers a hollow rumble on the pipe; the estate's mower
 *    whirs with its reel's chatter, the hedge trimmer buzzes with its reciprocating blades.
 *  - Actuators reuse the hydraulic power unit's clone pitched up, as the car's wheel actuators do: a
 *    Rigger's boom drums and stage while they move, a Dray's probe; the probe seats with the vault
 *    latch's clone.
 *  - Walkers' feet: the player's footstep recordings made metal (synth/footstep.ts synthRobotStep),
 *    voiced on what is underfoot as the player's are.
 *
 * As the field's machines: a pool of HRTF voices goes to the loops loudest where the listener
 * stands, with hysteresis; loops feed no reverb (two dozen robots in the city's diffuse field would
 * be a hum without a source). Steps take a small pool of one-shot emitters and feed the space's
 * reverb as the player's do. The field's crew is behind the estate's silencer (`gain`), the
 * estate's three are not.
 */
import { Emitter } from '../emitter';
import type { AudioEngine } from '../engine';
import { glide } from '../params';
import { between, rng } from '../dsp';
import { LEVEL } from '../mix';
import { playInto, VariantPicker } from './oneShot';
import { robotSurface, type RobotFoot } from '../synth/footstep';
import type { RobotStepKey } from '../bank';
import type { GroundSurface } from '../../city/walk';
import type { CrewEvent, CrewLoop, CrewLoopKind } from '../../crew/sound';

/** What the sound needs from the crew (crew/sound.ts). */
export interface AudioCrew {
  readonly loops: readonly CrewLoop[];
  readonly events: readonly CrewEvent[];
  /** This frame's events: the first \`count\`. */
  readonly count: number;
}

type LoopBuffer = 'drone' | 'car' | 'hydraulic';

interface Voicing {
  buffer: LoopBuffer;
  /** Source size (m): its level is the level here. */
  size: number;
  level: number;
  /** Playback rate (pitch) and the loop's low-pass (Hz) for its work and speed. */
  rate(work: number, speed: number): number;
  tone(work: number): number;
  /** A noise layer: band centre (Hz), Q and level for its speed and work, or none. */
  noise?: { f(speed: number): number; q: number; level(work: number, speed: number): number };
  /** Amplitude modulation (Hz, depth): a reel's chatter, blades' strokes. */
  am?: [number, number];
}

const C = LEVEL.crew;

const VOICES: Record<CrewLoopKind, Voicing> = {
  spotter: { buffer: 'drone', size: 0.6, level: C.spotter, rate: (w) => 0.8 + 0.28 * Math.sqrt(w), tone: (w) => 2500 + 12000 * w },
  ferry: { buffer: 'drone', size: 1.6, level: C.ferry, rate: (w) => 0.52 + 0.18 * Math.sqrt(w), tone: (w) => 1400 + 7000 * w },
  dray: {
    buffer: 'car',
    size: 1.2,
    level: C.dray,
    rate: (_w, v) => 0.9 + 0.75 * v,
    tone: (w) => 900 + 5000 * w,
    noise: { f: (v) => 360 + 320 * v, q: 0.6, level: (_w, v) => C.drayRoll * Math.pow(v, 1.3) },
  },
  probe: { buffer: 'hydraulic', size: 0.4, level: C.probe, rate: () => 1.9, tone: () => 6000 },
  linewalker: {
    buffer: 'car',
    size: 0.5,
    level: C.linewalker,
    rate: (_w, v) => 1.3 + 0.6 * v,
    tone: (w) => 1500 + 5000 * w,
    noise: { f: () => 260, q: 1.4, level: (_w, v) => C.lineRoll * v },
  },
  boom: { buffer: 'hydraulic', size: 0.5, level: C.boom, rate: (w) => 1.6 + 0.15 * w, tone: () => 5000 },
  mower: {
    buffer: 'car',
    size: 0.4,
    level: C.mower,
    rate: () => 1.9,
    tone: () => 6000,
    noise: { f: () => 2800, q: 1.2, level: (w) => C.reel * w },
    am: [22, 0.35],
  },
  trimmer: {
    buffer: 'car',
    size: 0.3,
    level: C.trimmer,
    rate: () => 2.3,
    tone: () => 7000,
    noise: { f: () => 3500, q: 1.0, level: (w) => C.blades * w },
    am: [45, 0.6],
  },
};

/** Loop voices beyond the estate's silencer and within it; the quietest a loop may be (at the listener) to get one. */
export const CREW_LOOP_VOICES = { field: 4, estate: 2 } as const;
const AUDIBLE = 0.003;
const FADE = 0.35;
/** Step emitters, and the farthest a step is voiced (m). */
const STEP_VOICES = { field: 3, estate: 2 } as const;
const STEP_RANGE = 40;
/** A step's ring (s): an emitter is free for another step after it. */
const STEP_LENGTH = 0.45;
/** The feet's size (m), as the player's. */
const FOOT_REF = 0.3;
const CUT_TC = 0.3;

interface LoopVoice {
  emitter: Emitter;
  src: AudioBufferSourceNode | null;
  noise: AudioBufferSourceNode | null;
  tone: BiquadFilterNode;
  gain: GainNode;
  band: BiquadFilterNode;
  noiseGain: GainNode;
  am: GainNode;
  osc: OscillatorNode;
  depth: GainNode;
  /** Index of the loop it voices, or −1; from when it may take another. */
  source: number;
  freeAt: number;
}

interface StepVoice {
  emitter: Emitter;
  freeAt: number;
}

export class CrewSounds {
  private readonly engine: AudioEngine;
  private readonly crew: AudioCrew;
  private readonly surface: (x: number, z: number, y: number) => GroundSurface;
  private readonly fieldGain: (x: number, z: number) => number;
  private readonly cut: GainNode;
  private readonly buffers: Record<LoopBuffer, AudioBuffer>;
  private readonly loopVoices: { field: LoopVoice[]; estate: LoopVoice[] };
  private readonly stepVoices: { field: StepVoice[]; estate: StepVoice[] };
  private readonly steps = new Map<RobotStepKey, AudioBuffer[]>();
  private readonly latches: AudioBuffer[];
  private readonly pickers = new Map<string, VariantPicker>();
  private readonly random = rng(0xc4e3);
  private readonly audibility: Float32Array;
  private readonly order: number[] = [];

  constructor(engine: AudioEngine, crew: AudioCrew, surface: (x: number, z: number, y: number) => GroundSurface, fieldGain: (x: number, z: number) => number) {
    this.engine = engine;
    this.crew = crew;
    this.surface = surface;
    this.fieldGain = fieldGain;
    const ctx = engine.ctx;
    this.cut = new GainNode(ctx, { gain: 1 });
    this.cut.connect(engine.dry);
    this.buffers = { drone: engine.buffer(engine.bank.drone), car: engine.buffer(engine.bank.car), hydraulic: engine.buffer(engine.bank.hydraulicRun) };
    for (const [key, list] of Object.entries(engine.bank.robotSteps)) this.steps.set(key as RobotStepKey, list.map((x) => engine.buffer(x)));
    this.latches = engine.bank.latch.map((x) => engine.buffer(x));
    this.audibility = new Float32Array(crew.loops.length);
    const loopVoice = (name: string, out: AudioNode | undefined): LoopVoice => {
      const emitter = new Emitter(engine, { name, zones: ['city'], refDistance: 1, send: 0, out });
      const am = new GainNode(ctx, { gain: 1 });
      am.connect(emitter.input);
      const tone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 4000, Q: 0.5 });
      const gain = new GainNode(ctx, { gain: 0 });
      tone.connect(gain).connect(am);
      const band = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 400, Q: 0.7 });
      const noiseGain = new GainNode(ctx, { gain: 0 });
      band.connect(noiseGain).connect(am);
      const depth = new GainNode(ctx, { gain: 0 });
      const osc = new OscillatorNode(ctx, { type: 'sine', frequency: 20 });
      osc.connect(depth).connect(am.gain);
      osc.start();
      return { emitter, src: null, noise: null, tone, gain, band, noiseGain, am, osc, depth, source: -1, freeAt: 0 };
    };
    this.loopVoices = {
      field: Array.from({ length: CREW_LOOP_VOICES.field }, (_, k) => loopVoice(`crew:loop${k}`, this.cut)),
      estate: Array.from({ length: CREW_LOOP_VOICES.estate }, (_, k) => loopVoice(`crew:estate${k}`, undefined)),
    };
    const stepVoice = (name: string, out: AudioNode | undefined): StepVoice => ({ emitter: new Emitter(engine, { name, zones: 'located', refDistance: FOOT_REF, out }), freeAt: 0 });
    this.stepVoices = {
      field: Array.from({ length: STEP_VOICES.field }, (_, k) => stepVoice(`crew:step${k}`, this.cut)),
      estate: Array.from({ length: STEP_VOICES.estate }, (_, k) => stepVoice(`crew:estateStep${k}`, undefined)),
    };
  }

  /** A loop's level at a listener: at its size, spread 1/d beyond it. */
  private level(l: CrewLoop, lx: number, ly: number, lz: number): number {
    const v = VOICES[l.kind];
    const d = Math.max(Math.hypot(l.x - lx, l.y - ly, l.z - lz), v.size);
    return v.level * l.work * (v.size / d);
  }

  update(t: number, listener: { x: number; y: number; z: number }): void {
    glide(this.cut.gain, this.fieldGain(listener.x, listener.z), t, CUT_TC);
    const loops = this.crew.loops;
    for (let i = 0; i < loops.length; i++) this.audibility[i] = this.level(loops[i], listener.x, listener.y, listener.z);
    this.assign(this.loopVoices.field, false, t);
    this.assign(this.loopVoices.estate, true, t);
    for (const v of this.loopVoices.field) this.voice(v, t);
    for (const v of this.loopVoices.estate) this.voice(v, t);
    const ev = this.crew.events;
    for (let k = 0; k < this.crew.count; k++) this.play(ev[k], t, listener);
  }

  /** The loudest loops on this side of the silencer get its voices; a voice keeps its loop while it stays in the top few. */
  private assign(voices: LoopVoice[], estate: boolean, t: number): void {
    const loops = this.crew.loops;
    const order = this.order;
    order.length = 0;
    for (let i = 0; i < loops.length; i++) if (loops[i].estate === estate && this.audibility[i] > AUDIBLE) order.push(i);
    order.sort((a, b) => this.audibility[b] - this.audibility[a]);
    const keep = Math.min(order.length, voices.length + 2);
    for (const v of voices) {
      if (v.source < 0) continue;
      let kept = false;
      for (let k = 0; k < keep; k++) if (order[k] === v.source) kept = true;
      if (!kept) this.release(v, t);
    }
    for (let k = 0; k < Math.min(order.length, voices.length); k++) {
      const i = order[k];
      if (voices.some((v) => v.source === i)) continue;
      const v = voices.find((x) => x.source < 0 && t >= x.freeAt);
      if (!v) break;
      this.take(v, i, t);
    }
  }

  private take(v: LoopVoice, i: number, t: number): void {
    const ctx = this.engine.ctx;
    const l = this.crew.loops[i];
    const voicing = VOICES[l.kind];
    const buffer = this.buffers[voicing.buffer];
    const src = new AudioBufferSourceNode(ctx, { buffer, loop: true, playbackRate: voicing.rate(l.work, l.speed) });
    src.connect(v.tone);
    src.start(t, between(this.random, 0, buffer.duration));
    v.src = src;
    if (voicing.noise) {
      const noise = new AudioBufferSourceNode(ctx, { buffer: this.engine.noise, loop: true });
      noise.connect(v.band);
      noise.start(t, between(this.random, 0, this.engine.noise.duration));
      v.noise = noise;
      v.band.Q.setValueAtTime(voicing.noise.q, t);
    }
    const [f, depth] = voicing.am ?? [20, 0];
    v.osc.frequency.setValueAtTime(f * between(this.random, 0.95, 1.05), t);
    v.depth.gain.setValueAtTime(depth / 2, t);
    v.am.gain.setValueAtTime(1 - depth / 2, t);
    for (const g of [v.gain.gain, v.noiseGain.gain]) {
      g.cancelScheduledValues(t);
      g.setValueAtTime(0, t);
    }
    v.emitter.setRefDistance(voicing.size);
    // A new source elsewhere: jump to it rather than sweep the delay across the gap.
    v.emitter.revoice(0);
    v.source = i;
  }

  private release(v: LoopVoice, t: number): void {
    glide(v.gain.gain, 0, t, FADE / 3);
    glide(v.noiseGain.gain, 0, t, FADE / 3);
    v.src?.stop(t + FADE);
    v.noise?.stop(t + FADE);
    v.src = null;
    v.noise = null;
    v.source = -1;
    v.freeAt = t + FADE;
  }

  private voice(v: LoopVoice, t: number): void {
    if (v.source < 0 || !v.src) return;
    const l = this.crew.loops[v.source];
    const voicing = VOICES[l.kind];
    v.emitter.setPosition(l.x, l.y, l.z);
    // Motors spool: pitch over ~0.3 s, level a little quicker.
    glide(v.src.playbackRate, voicing.rate(l.work, l.speed), t, 0.3);
    glide(v.gain.gain, voicing.level * l.work, t, 0.15);
    glide(v.tone.frequency, voicing.tone(l.work), t, 0.15);
    if (voicing.noise && v.noise) {
      glide(v.band.frequency, voicing.noise.f(l.speed), t, 0.2);
      glide(v.noiseGain.gain, voicing.noise.level(l.work, l.speed), t, 0.15);
    }
  }

  private play(e: CrewEvent, t: number, l: { x: number; y: number; z: number }): void {
    const d = Math.hypot(e.x - l.x, e.y - l.y, e.z - l.z);
    if (d > STEP_RANGE) return;
    const pool = e.estate ? this.stepVoices.estate : this.stepVoices.field;
    // The voice that falls free first (a step still ringing on it is cut short only if none is free).
    let v = pool[0];
    for (const p of pool) if (p.freeAt < v.freeAt) v = p;
    v.emitter.setPosition(e.x, e.y + 0.02, e.z);
    v.emitter.revoice(1);
    v.freeAt = t + STEP_LENGTH;
    const r = this.random;
    if (e.kind === 'latch') {
      playInto(v.emitter, this.latches[this.pick('latch', this.latches.length)], t, C.latch, between(r, 1.15, 1.3));
      return;
    }
    const foot: RobotFoot = e.kind;
    const key: RobotStepKey = `${foot}:${robotSurface(foot, this.surface(e.x, e.z, e.y))}`;
    const list = this.steps.get(key);
    if (!list) return;
    const gain = (foot === 'hand' ? C.hand : C.rigger) * e.force * Math.pow(10, between(r, -1.5, 1.5) / 20);
    playInto(v.emitter, list[this.pick(key, list.length)], t, gain, foot === 'hand' ? between(r, 0.97, 1.03) : between(r, 0.88, 0.95));
  }

  private pick(key: string, n: number): number {
    let p = this.pickers.get(key);
    if (!p) this.pickers.set(key, (p = new VariantPicker(this.random, Math.floor(n / 2))));
    return p.pick(n);
  }
}
