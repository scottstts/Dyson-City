/**
 * The vehicles' sounds (docs/audio.md, "The car", "The craft"), each from where it is made.
 *
 * The car (an electric GT on four hub motors), from its centre:
 *  - the drive: the user's recording of the car's drive resynthesised as a loop (its motors' low
 *    hum, the inverter's tonal line). Pitch follows the rotor speed, from a faint inverter idle at
 *    rest to about half an octave over the recording at the top speed; level and brightness follow
 *    the load (power and regeneration). It spins up as the driver gets in and down when they leave;
 *  - rolling: the tyres on polished stone, band noise rising with speed;
 *  - scrub: the tyres at the limit, a narrow band near 1.3 kHz rising with the slide;
 *  - walls: a knock (synth/vehicle.ts) scaled by the contact's impulse, and a scrape while it
 *    slides along one;
 *  - the wheels deploying and drawing in: the hub actuators' run (the hydraulic power unit's
 *    recording, a small unit: pitched up, quiet) while they travel, and a light latch at each stop.
 *
 * The craft, from its main nozzle: its engines' roar (the user's recording resynthesised), beamed
 * aft (quieter and duller ahead of it), its level, pitch and brightness following the burn. It feeds
 * the city's reverberation (without its lift: DOME_SEND), so its arrival fills the Dome while its
 * level still falls with distance across it. It is a sound of the Dome only (by the
 * user's decision): a listener outside it, or in the West Gate's chamber with the inner gate shut,
 * hears nothing of it; once the inner gate starts to open, the chamber hears it through the gap.
 */
import { Emitter } from '../emitter';
import type { AudioEngine } from '../engine';
import { glide } from '../params';
import { between, rng } from '../dsp';
import { DOME_SEND, LEVEL } from '../mix';
import { playInto, VariantPicker } from './oneShot';
import { PAD_HEIGHT } from '../../ground/site';
import type { ListenerState } from '../engine';
import { domeAudible } from '../acoustics';

/** What the sound needs from the car. */
export interface AudioCar {
  readonly state: { x: number; z: number; speed: number; load: number; scrub: number };
  readonly driven: boolean;
  /** The wheels' deployment, 0 drawn in … 1 out. */
  readonly deploy: number;
  /** The hardest wall contact since the last call. */
  takeContact(): { impulse: number; scrape: number };
}

/** What the sound needs from the craft. */
export interface AudioCraft {
  readonly visible: boolean;
  readonly burn: number;
  /** The hull's place (world). */
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  /** The main nozzle (world) and the exhaust's direction (world, unit). */
  nozzle(out: [number, number, number], axis: [number, number, number]): void;
}


/** The car's top speed (m/s), for the drive's pitch. */
const TOP = 38.9;
/** Contact impulse (N s) under which nothing is heard, and the one at full level. */
const KNOCK = { from: 520, full: 15_000 } as const;


class LoopVoice {
  src: AudioBufferSourceNode | null = null;
  readonly gain: GainNode;
  readonly tone: BiquadFilterNode;
  private readonly ctx: BaseAudioContext;
  private readonly buffer: AudioBuffer;
  private readonly random: () => number;

  constructor(ctx: BaseAudioContext, buffer: AudioBuffer, out: AudioNode, tone: BiquadFilterOptions, random: () => number) {
    this.ctx = ctx;
    this.buffer = buffer;
    this.random = random;
    this.tone = new BiquadFilterNode(ctx, tone);
    this.gain = new GainNode(ctx, { gain: 0 });
    this.tone.connect(this.gain).connect(out);
  }

  start(t: number, rate = 1): void {
    if (this.src) return;
    this.src = new AudioBufferSourceNode(this.ctx, { buffer: this.buffer, loop: true, playbackRate: rate });
    this.src.connect(this.tone);
    this.src.start(t, this.random() * this.buffer.duration);
  }

  stop(t: number): void {
    if (!this.src) return;
    this.src.stop(t);
    this.src = null;
  }
}

export class CarSounds {
  private readonly car: AudioCar;
  private readonly emitter: Emitter;
  private readonly drive: LoopVoice;
  private readonly roll: LoopVoice;
  private readonly scrub: LoopVoice;
  private readonly scrape: LoopVoice;
  private readonly actuator: LoopVoice;
  private readonly latches: AudioBuffer[];
  private lastDeploy = 0;
  private moving = false;
  private readonly knocks: AudioBuffer[];
  private readonly random = rng(0xca2);
  private readonly picker = new VariantPicker(this.random);
  /** The drive's spin: 0 asleep … 1 awake. */
  private spin = 0;
  private load = 0;

  constructor(engine: AudioEngine, car: AudioCar) {
    this.car = car;
    const ctx = engine.ctx;
    this.emitter = new Emitter(engine, { name: 'car', zones: 'located', refDistance: 1.5 });
    const out = this.emitter.input;
    this.drive = new LoopVoice(ctx, engine.buffer(engine.bank.car), out, { type: 'lowpass', frequency: 4000, Q: 0.5 }, this.random);
    this.roll = new LoopVoice(ctx, engine.noise, out, { type: 'bandpass', frequency: 420, Q: 0.55 }, this.random);
    this.scrub = new LoopVoice(ctx, engine.noise, out, { type: 'bandpass', frequency: 1300, Q: 5 }, this.random);
    this.scrape = new LoopVoice(ctx, engine.noise, out, { type: 'bandpass', frequency: 2300, Q: 1.3 }, this.random);
    this.knocks = engine.bank.impact.map((x) => engine.buffer(x));
    this.actuator = new LoopVoice(ctx, engine.buffer(engine.bank.hydraulicRun), out, { type: 'highpass', frequency: 180, Q: 0.6 }, this.random);
    this.latches = engine.bank.latch.map((x) => engine.buffer(x));
    this.lastDeploy = car.deploy;
  }

  update(dt: number, t: number): void {
    const c = this.car;
    const s = c.state;
    this.emitter.setPosition(s.x, PAD_HEIGHT + 0.6, s.z);
    const v = Math.min(1, s.speed / TOP);
    // The drive spins up with the driver in, down without.
    const awake = c.driven ? 1 : 0;
    this.spin += (awake - this.spin) * (1 - Math.exp(-dt / (c.driven ? 0.45 : 0.9)));
    this.load += (Math.abs(s.load) - this.load) * (1 - Math.exp(-dt / 0.08));
    if (this.spin > 0.01 || v > 0.01) this.drive.start(t, 0.4);
    if (this.drive.src) {
      const rate = (0.4 + 0.15 * this.spin) * (1 - v) + (0.55 + 0.9 * v) * v;
      glide(this.drive.src.playbackRate, Math.max(0.3, rate), t, 0.04);
      const level = LEVEL.car.drive * Math.max(this.spin, v) * (0.1 + 0.5 * this.load + 0.4 * Math.pow(v, 0.8));
      glide(this.drive.gain.gain, level, t, 0.05);
      glide(this.drive.tone.frequency, 900 + 8000 * (0.25 + 0.75 * this.load) * (0.5 + 0.5 * v), t, 0.05);
      if (this.spin < 0.01 && v < 0.01) this.drive.stop(t + 0.2);
    }
    // The tyres rolling.
    if (v > 0.005) this.roll.start(t);
    if (this.roll.src) {
      glide(this.roll.gain.gain, LEVEL.car.roll * Math.pow(v, 1.3), t, 0.05);
      glide(this.roll.tone.frequency, 320 + 380 * v, t, 0.1);
      if (v <= 0.005) this.roll.stop(t + 0.2);
    }
    // Scrub at the limit.
    const slide = Math.max(0, Math.min(1, (s.scrub - 0.7) / 0.35)) * Math.sqrt(v);
    if (slide > 0.01) this.scrub.start(t);
    if (this.scrub.src) {
      glide(this.scrub.gain.gain, LEVEL.car.scrub * slide, t, 0.04);
      glide(this.scrub.tone.frequency, 1150 + 350 * slide, t, 0.08);
      if (slide <= 0.01) this.scrub.stop(t + 0.3);
    }
    // The wheels deploying or drawing in.
    const travel = dt > 0 ? Math.abs(c.deploy - this.lastDeploy) / dt : 0;
    this.lastDeploy = c.deploy;
    const run = Math.min(1, travel * 0.9);
    if (run > 0.01) {
      this.actuator.start(t, 1.7);
      this.moving = true;
    }
    if (this.actuator.src) {
      glide(this.actuator.src.playbackRate, 1.55 + 0.2 * run, t, 0.05);
      glide(this.actuator.gain.gain, LEVEL.car.deploy * run, t, 0.05);
      if (run <= 0.01) this.actuator.stop(t + 0.3);
    }
    if (this.moving && run <= 0.01 && (c.deploy <= 0 || c.deploy >= 1)) {
      this.moving = false;
      playInto(this.emitter, this.latches[this.picker.pick(this.latches.length)], t, LEVEL.car.latch, between(this.random, 1.35, 1.5));
    }
    // Walls.
    const hit = c.takeContact();
    if (hit.impulse > KNOCK.from) {
      const k = Math.pow(Math.min(1, hit.impulse / KNOCK.full), 0.6);
      playInto(this.emitter, this.knocks[this.picker.pick(this.knocks.length)], t, LEVEL.car.impact * k, between(this.random, 0.92, 1.05));
    }
    const scrape = Math.min(1, hit.scrape / 8);
    if (scrape > 0.02) this.scrape.start(t);
    if (this.scrape.src) {
      glide(this.scrape.gain.gain, LEVEL.car.scrub * 0.8 * scrape, t, 0.03);
      if (scrape <= 0.02) this.scrape.stop(t + 0.2);
    }
  }
}

export class CraftSounds {
  private readonly craft: AudioCraft;
  private readonly emitter: Emitter;
  private readonly roar: LoopVoice;
  private readonly at: [number, number, number] = [0, 0, 0];
  private readonly axis: [number, number, number] = [0, 0, 1];
  private readonly random = rng(0xc4af7);

  constructor(engine: AudioEngine, craft: AudioCraft) {
    this.craft = craft;
    this.emitter = new Emitter(engine, {
      name: 'craft',
      zones: 'located',
      refDistance: 8,
      send: DOME_SEND,
      directivity: { axis: [1, 0, 0], rear: 0.4, rearCutoff: 1800 },
    });
    this.roar = new LoopVoice(engine.ctx, engine.buffer(engine.bank.craft), this.emitter.input, { type: 'lowpass', frequency: 3000, Q: 0.5 }, this.random);
  }

  update(t: number, l: Pick<ListenerState, 'zone' | 'innerOpen'>): void {
    const c = this.craft;
    // Cut at the source, so its reverberation goes with it.
    if (!c.visible || !domeAudible(l)) {
      if (this.roar.src) {
        glide(this.roar.gain.gain, 0, t, 0.1);
        this.roar.stop(t + 0.5);
      }
      return;
    }
    c.nozzle(this.at, this.axis);
    this.emitter.setPosition(this.at[0], this.at[1], this.at[2]);
    this.emitter.setAxis(this.axis[0], this.axis[1], this.axis[2]);
    const b = c.burn;
    // Comes back in over a moment (passing in through the gate, or the inner gate's first opening).
    if (!this.roar.src) this.roar.gain.gain.setValueAtTime(0, t);
    this.roar.start(t, 0.85);
    glide(this.roar.src!.playbackRate, 0.82 + 0.28 * b, t, 0.08);
    glide(this.roar.gain.gain, LEVEL.craft * (0.08 + 0.92 * Math.pow(b, 1.4)), t, 0.08);
    glide(this.roar.tone.frequency, 600 + 9000 * Math.pow(b, 1.2), t, 0.08);
  }
}
