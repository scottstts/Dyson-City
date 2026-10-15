/**
 * The chamber's equalising vents while it fills or vents (docs/audio.md). Air jets through the vent
 * louvres on both piers: a hiss whose spectrum rises to a peak near 8 kHz while the pressure
 * difference is large, with a low buffeting under it. As the pressures equalise the jet slows: it
 * falls quieter and darker (the jet's peak frequency scales with its velocity, ∝ √Δp). The valves
 * thump open with a pop and thunk shut. The louvres face the chamber, so the hiss is directional.
 */
import { Emitter } from '../emitter';
import type { AudioEngine } from '../engine';
import { glide } from '../params';
import { between, rng } from '../dsp';
import { LEVEL } from '../mix';
import { playInto } from './oneShot';
import { TIMING, type Airlock } from '../../city/gate/airlock';
import { GATE } from '../../city/gate/spec';
import { VENTS } from '../../city/gate/gatehouse';
import type { PressureEvent } from '../airlockEvents';

/** Fastest change of the dial (bar/s): the eased 0.45 bar swing over TIMING.cycle. */
const MAX_RATE = (0.45 * 1.5) / TIMING.cycle;
/** Louvre centre height (gatehouse.ts: louvres from y 1.8 to 3.4 m). */
const VENT_Y = 2.6;

interface VentVoice {
  emitter: Emitter;
  jet: GainNode;
  peak: BiquadFilterNode;
  top: BiquadFilterNode;
  buffet: GainNode;
  sources: AudioBufferSourceNode[];
}

export class VentSounds {
  private readonly engine: AudioEngine;
  private readonly vents: VentVoice[];
  private readonly valveOpen: AudioBuffer;
  private readonly valveClose: AudioBuffer;
  private readonly random = rng(0x7e47);
  private prevBar = 0;
  private flowing = false;
  private flow = 0;
  private buffetLevel = 0.5;
  private buffetTarget = 0.5;

  constructor(engine: AudioEngine, lock: Airlock) {
    const ctx = engine.ctx;
    this.engine = engine;
    this.prevBar = lock.bar;
    this.valveOpen = engine.buffer(engine.bank.valveOpen);
    this.valveClose = engine.buffer(engine.bank.valveClose);
    const x = (VENTS[0] + VENTS[1]) / 2;
    this.vents = [-1, 1].map((side) => {
      const emitter = new Emitter(engine, {
        name: `vent${side}`,
        zones: ['chamber'],
        refDistance: 1,
        directivity: { axis: [0, 0, -side], rear: 0.3, rearCutoff: 1500 },
      });
      emitter.setPosition(x, VENT_Y, side * (GATE.passageHalf - 0.2));
      const jet = new GainNode(ctx, { gain: 0 });
      const top = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 13000, Q: 0.7 });
      const peak = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 7500, Q: 0.6, gain: 12 });
      const buffet = new GainNode(ctx, { gain: 0 });
      jet.connect(emitter.input);
      buffet.connect(emitter.input);
      return { emitter, jet, peak, top, buffet, sources: [] };
    });
  }

  play(e: PressureEvent, t: number): void {
    const buffer = e === 'valve-open' ? this.valveOpen : this.valveClose;
    this.vents.forEach((v, i) => playInto(v.emitter, buffer, t + i * between(this.random, 0.005, 0.03), LEVEL.valve, between(this.random, 0.97, 1.03)));
  }

  private start(t: number): void {
    const ctx = this.engine.ctx;
    for (const v of this.vents) {
      const a = new AudioBufferSourceNode(ctx, { buffer: this.engine.noise, loop: true });
      const b = new AudioBufferSourceNode(ctx, { buffer: this.engine.noise, loop: true });
      a.connect(new BiquadFilterNode(ctx, { type: 'highpass', frequency: 1000, Q: 0.5 }))
        .connect(new BiquadFilterNode(ctx, { type: 'highpass', frequency: 1000, Q: 0.5 }))
        .connect(v.peak).connect(v.top).connect(v.jet);
      b.connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 90, Q: 0.7 })).connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 90, Q: 0.7 })).connect(v.buffet);
      a.start(t, between(this.random, 0, this.engine.noise.duration));
      b.start(t, between(this.random, 0, this.engine.noise.duration));
      v.sources = [a, b];
    }
  }

  private stop(t: number): void {
    for (const v of this.vents) {
      for (const s of v.sources) s.stop(t);
      v.sources = [];
    }
  }

  update(dt: number, t: number, lock: Airlock): void {
    const bar = lock.bar;
    const rate = dt > 0 ? Math.abs(bar - this.prevBar) / dt / MAX_RATE : 0;
    const moving = lock.pressure !== 0 && lock.pressure !== 1 ? rate > 0 : false;
    // Pressure still to equalise across the valves (0..1 of the 0.45 bar swing).
    const filling = bar > this.prevBar;
    const dp = filling ? (1 - bar) / 0.45 : (bar - 0.55) / 0.45;
    this.prevBar = bar;
    const target = moving ? 0.5 * Math.sqrt(Math.min(rate, 1)) + 0.5 * Math.pow(Math.max(dp, 0), 0.7) : 0;
    this.flow += (target - this.flow) * (1 - Math.exp(-dt / (target > this.flow ? 0.05 : 0.12)));
    if (moving && !this.flowing) this.start(t);
    if (!moving && this.flowing && this.flow < 0.002) {
      this.stop(t + 0.05);
      this.flowing = false;
    }
    if (moving) this.flowing = true;
    if (!this.flowing) return;
    const r = this.random;
    if (r() < dt * 2) this.buffetTarget = between(r, 0.2, 1);
    this.buffetLevel += (this.buffetTarget - this.buffetLevel) * (1 - Math.exp(-dt / 0.25));
    const v = Math.sqrt(Math.max(dp, 0));
    for (const vent of this.vents) {
      glide(vent.jet.gain, LEVEL.jet * this.flow, t, 0.04);
      glide(vent.buffet.gain, LEVEL.buffet * this.flow * this.buffetLevel, t, 0.08);
      glide(vent.peak.frequency, 3000 + 4500 * v, t, 0.1);
      glide(vent.top.frequency, 6000 + 7000 * v, t, 0.1);
    }
  }
}
