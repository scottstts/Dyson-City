/**
 * The field's machines (docs/audio.md, "The field"). Every sound comes from the machine making it:
 * nothing in the field is heard as a diffuse bed.
 *
 *  - No reverb send. The city's reverb is a diffuse field heard the same everywhere under the
 *    Dome; fed by two dozen machines it became a hum heard everywhere (rejected by the user). The
 *    Dome is a kilometre of open air: what reaches you from a machine is its direct sound, delayed,
 *    spread (1/d beyond its size), dulled by the air, and placed by HRTF.
 *  - A pool of HRTF voices goes to the machines loud enough to hear where you stand (their level
 *    at your distance), nearest first, with hysteresis so voices do not hop. A voice fades out
 *    before it is given to another machine. Machines below audibility make no sound at all.
 *  - Each machine's level breathes with its load: a slow random wander of a dB or two and a
 *    fraction of a percent in speed (pitch), its own, so no two of a kind move together.
 *
 * The Cold Hold's relief stacks (field/vents.ts) take their own voices when one lifts: the valve
 * pops, the roar follows the stack's flow (brighter at full lift), and the valve thunks as it
 * reseats.
 */
import { Emitter } from '../emitter';
import type { AudioEngine } from '../engine';
import type { FieldLoop } from '../bank';
import { glide } from '../params';
import { between, rng } from '../dsp';
import { LEVEL } from '../mix';
import { playInto } from './oneShot';
import type { Vec3 } from '../../geometry/polyMesh';
import type { FieldSoundSource } from '../../field/sources';
import type { ReliefVents } from '../../field/vents';

/** What the sound needs from the field. */
export interface AudioField {
  sources: readonly FieldSoundSource[];
  vents: ReliefVents;
  /** Game time (the machines' state is a function of it). */
  time(): number;
}

/** Voices for the machines, and the quietest a machine may be (at the listener) to get one. */
export const FIELD_VOICES = 6;
const AUDIBLE = 0.003;
const FADE = 0.35;

interface Voice {
  emitter: Emitter;
  gain: GainNode;
  node: AudioBufferSourceNode | null;
  /** Index of the source it plays, or −1. */
  source: number;
  /** Context time from which it may be given to another source (after its fade). */
  freeAt: number;
}

interface VentVoice {
  emitter: Emitter;
  gain: GainNode;
  tone: BiquadFilterNode;
  stack: number;
}

interface Load {
  /** Current level and speed wander. */
  db: number;
  rate: number;
  dbTarget: number;
  rateTarget: number;
}

const VENT_VOICES = 3;

/** A machine's level at a listener: its level at its own size, spread 1/d beyond it (air absorption aside). */
export function machineLevel(s: FieldSoundSource, gt: number, lx: number, ly: number, lz: number, tmp: Vec3 = [0, 0, 0]): number {
  s.at(gt, tmp);
  const d = Math.max(Math.hypot(tmp[0] - lx, tmp[1] - ly, tmp[2] - lz), s.size);
  return LEVEL.field[s.kind] * s.level(gt) * (s.size / d);
}

export { AUDIBLE as FIELD_AUDIBLE };

export class FieldSounds {
  private readonly engine: AudioEngine;
  private readonly field: AudioField;
  private readonly buffers: Record<FieldLoop, AudioBuffer>;
  private readonly voices: Voice[];
  private readonly vents: VentVoice[];
  private readonly loads: Load[];
  private readonly random = rng(0xf1e1d);
  private readonly p: Vec3 = [0, 0, 0];
  private readonly audibility: Float32Array;
  private ventStarted = false;

  constructor(engine: AudioEngine, field: AudioField) {
    this.engine = engine;
    this.field = field;
    const ctx = engine.ctx;
    this.buffers = Object.fromEntries(Object.entries(engine.bank.field).map(([k, x]) => [k, engine.buffer(x)])) as Record<FieldLoop, AudioBuffer>;
    this.audibility = new Float32Array(field.sources.length);
    this.loads = field.sources.map(() => ({ db: 0, rate: 1, dbTarget: 0, rateTarget: 1 }));
    this.voices = Array.from({ length: FIELD_VOICES }, (_, k) => {
      const emitter = new Emitter(engine, { name: `field:voice${k}`, zones: ['city'], refDistance: 1, send: 0 });
      const gain = new GainNode(ctx, { gain: 0 });
      gain.connect(emitter.input);
      return { emitter, gain, node: null, source: -1, freeAt: 0 };
    });
    this.vents = Array.from({ length: VENT_VOICES }, (_, k) => {
      const emitter = new Emitter(engine, { name: `field:vent${k}`, zones: ['city'], refDistance: 1, send: 0 });
      const tone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 4000, Q: 0.5 });
      const gain = new GainNode(ctx, { gain: 0 });
      tone.connect(gain).connect(emitter.input);
      return { emitter, gain, tone, stack: -1 };
    });
  }

  private level(i: number, gt: number, lx: number, ly: number, lz: number): number {
    return machineLevel(this.field.sources[i], gt, lx, ly, lz, this.p);
  }

  update(dt: number, t: number, listener: { x: number; y: number; z: number }): void {
    const ctx = this.engine.ctx;
    const gt = this.field.time();
    const r = this.random;
    // Load wander per machine (slow, its own).
    for (const l of this.loads) {
      if (r() < dt / 4) {
        l.dbTarget = between(r, -1.8, 1.2);
        l.rateTarget = between(r, 0.994, 1.006);
      }
      const k = 1 - Math.exp(-dt / 2.5);
      l.db += (l.dbTarget - l.db) * k;
      l.rate += (l.rateTarget - l.rate) * k;
    }
    for (let i = 0; i < this.audibility.length; i++) this.audibility[i] = this.level(i, gt, listener.x, listener.y, listener.z);
    // The loudest machines get voices; a voice keeps its machine while it stays in the top few.
    const order = [...this.audibility.keys()].filter((i) => this.audibility[i] > AUDIBLE).sort((a, b) => this.audibility[b] - this.audibility[a]);
    const keep = new Set(order.slice(0, FIELD_VOICES + 2));
    const want = order.slice(0, FIELD_VOICES).filter((i) => !this.voices.some((v) => v.source === i));
    for (const v of this.voices) {
      if (v.source >= 0 && !keep.has(v.source)) {
        glide(v.gain.gain, 0, t, FADE / 3);
        v.node?.stop(t + FADE);
        v.node = null;
        v.source = -1;
        v.freeAt = t + FADE;
      }
    }
    for (const i of want) {
      const v = this.voices.find((x) => x.source < 0 && t >= x.freeAt);
      if (!v) break;
      const src = this.field.sources[i];
      const buffer = this.buffers[src.kind];
      const node = new AudioBufferSourceNode(ctx, { buffer, loop: true });
      node.connect(v.gain);
      node.start(t, between(r, 0, buffer.duration));
      v.node = node;
      v.source = i;
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setValueAtTime(0, t);
    }
    for (const v of this.voices) {
      if (v.source < 0 || !v.node) continue;
      const src = this.field.sources[v.source];
      const load = this.loads[v.source];
      src.at(gt, this.p);
      v.emitter.setPosition(this.p[0], this.p[1], this.p[2]);
      v.emitter.setRefDistance(src.size);
      glide(v.gain.gain, LEVEL.field[src.kind] * src.level(gt) * Math.pow(10, load.db / 20), t, 0.4);
      glide(v.node.playbackRate, load.rate, t, 1.5);
    }
    this.updateVents(t);
  }

  private updateVents(t: number): void {
    const ctx = this.engine.ctx;
    if (!this.ventStarted) {
      for (const v of this.vents) {
        const node = new AudioBufferSourceNode(ctx, { buffer: this.buffers.vent, loop: true, playbackRate: between(this.random, 0.95, 1.05) });
        node.connect(v.tone);
        node.start(t, between(this.random, 0, this.buffers.vent.duration));
      }
      this.ventStarted = true;
    }
    const vents = this.field.vents;
    for (const e of vents.drain()) {
      if (e.kind === 'lift') {
        // Take a free voice, or the one whose stack is flowing least.
        const v = this.vents.find((x) => x.stack < 0) ?? this.vents.reduce((a, b) => (vents.flow[a.stack] <= vents.flow[b.stack] ? a : b));
        v.stack = e.stack;
        const s = vents.stacks[e.stack];
        v.emitter.setPosition(s.p[0], s.p[1], s.p[2]);
        playInto(v.emitter, this.valve('open'), t, LEVEL.ventValve * (0.7 + 0.3 * s.size), between(this.random, 0.9, 1.05));
      } else {
        const v = this.vents.find((x) => x.stack === e.stack);
        if (v) playInto(v.emitter, this.valve('close'), t, LEVEL.ventValve * 0.6, between(this.random, 0.9, 1.05));
      }
    }
    for (const v of this.vents) {
      const f = v.stack >= 0 ? vents.flow[v.stack] : 0;
      const size = v.stack >= 0 ? vents.stacks[v.stack].size : 1;
      glide(v.gain.gain, LEVEL.field.vent * f * (0.6 + 0.4 * size), t, 0.04);
      glide(v.tone.frequency, 1500 + 9000 * f, t, 0.08);
      if (v.stack >= 0 && f < 0.002) v.stack = -1;
    }
  }

  private valveBuffers: { open: AudioBuffer; close: AudioBuffer } | null = null;

  private valve(kind: 'open' | 'close'): AudioBuffer {
    this.valveBuffers ??= { open: this.engine.buffer(this.engine.bank.valveOpen), close: this.engine.buffer(this.engine.bank.valveClose) };
    return this.valveBuffers[kind];
  }
}
