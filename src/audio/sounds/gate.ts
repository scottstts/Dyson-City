/**
 * The West Gate's sounds (docs/audio.md, "The West Gate"), each radiated from where it happens and
 * resynthesised from recordings of the real thing (models/):
 *
 *  - Hydraulics at the two hoists (outside for the outer gate, in the chamber for the inner): a
 *    hydraulic power unit's run (motor, piston pump, oil, rumble) looped, spinning up from 62 % of
 *    its pitch over ~0.75 s as the measured unit does, sagging slightly under the lifting load, and
 *    spinning down when the gate stops. Its start (contactor, valve onto the load) opens each run
 *    and each reversal.
 *  - The leaf: a massive door's roll while it moves (in proportion to its speed, swelling slowly
 *    as the recorded door does); on the open stop the lift-stop (the pump cutting out, the load
 *    seating with heavy clanks, the structure's boom); landing shut, the vault door's shut. A dipole
 *    at the skin's centre, radiating into both spaces it divides.
 *  - The floor bolts: a heavy lock's throw, as they withdraw and as they shoot home.
 */
import { Emitter } from '../emitter';
import type { AudioEngine } from '../engine';
import { glide } from '../params';
import { between, rng } from '../dsp';
import { LEVEL } from '../mix';
import { playInto, VariantPicker } from './oneShot';
import type { GateEvent, GateName } from '../airlockEvents';
import type { GateActuator } from '../../city/gate/airlock';
import { TIMING } from '../../city/gate/airlock';
import { GATE } from '../../city/gate/spec';
import { boltPose, hoistPoses } from '../../city/gate/mechanism';
import type { Zone } from '../acoustics';

/** Leaf speed at the middle of its eased travel (openness per second). */
const MAX_LEAF_SPEED = 1.5 / TIMING.travel;
const BOLT_Z = [-4.5, 4.5];
/** The pump's speed on starting (fraction) and its spin-up time constant (s), as measured. */
const SPIN_FROM = 0.62;
const SPIN_UP = 0.75;
const SPIN_DOWN = 0.2;

/** A looping buffer source started at a random point, stopped (and released) on demand. */
class Loop {
  private src: AudioBufferSourceNode | null = null;
  private readonly ctx: BaseAudioContext;
  private readonly buffer: AudioBuffer;
  private readonly out: AudioNode;
  private readonly random: () => number;
  constructor(ctx: BaseAudioContext, buffer: AudioBuffer, out: AudioNode, random: () => number) {
    this.ctx = ctx;
    this.buffer = buffer;
    this.out = out;
    this.random = random;
  }
  get running(): boolean {
    return this.src !== null;
  }
  get rate(): AudioParam | null {
    return this.src?.playbackRate ?? null;
  }
  start(t: number, rate = 1): void {
    this.src = new AudioBufferSourceNode(this.ctx, { buffer: this.buffer, loop: true, playbackRate: rate });
    this.src.connect(this.out);
    this.src.start(t, this.random() * this.buffer.duration);
  }
  stop(t: number): void {
    this.src?.stop(t);
    this.src = null;
  }
}

/** One gate's hydraulic power unit, heard at its two hoists. */
class Hydraulics {
  private readonly level: GainNode;
  private readonly loop: Loop;
  private spin = 0;
  private on = false;
  /** Set when the stop has its own sound (the lift-stop): the run cuts out instead of spinning down. */
  private cut = false;

  constructor(engine: AudioEngine, hoists: Emitter[], random: () => number) {
    const ctx = engine.ctx;
    this.level = new GainNode(ctx, { gain: 0 });
    for (const h of hoists) this.level.connect(new GainNode(ctx, { gain: Math.SQRT1_2 })).connect(h.input);
    this.loop = new Loop(ctx, engine.buffer(engine.bank.hydraulicRun), this.level, random);
  }

  cutOut(): void {
    this.cut = true;
  }

  /** `running`: driving the bolts or the leaf; `lift`: raising the leaf; `speed`: 0..1 of the leaf's fastest. */
  update(dt: number, t: number, running: boolean, lift: boolean, speed: number): void {
    if (running && !this.on) {
      this.on = true;
      this.cut = false;
      this.spin = SPIN_FROM;
      if (!this.loop.running) this.loop.start(t, SPIN_FROM);
    }
    if (!running && this.on) this.on = false;
    if (!this.loop.running) return;
    if (this.on) this.spin += (1 - this.spin) * (1 - Math.exp(-dt / SPIN_UP));
    else this.spin += (SPIN_FROM - this.spin) * (1 - Math.exp(-dt / (this.cut ? 0.05 : SPIN_DOWN)));
    // Lifting loads the pump: a little slower and louder.
    const load = lift ? speed : 0;
    glide(this.loop.rate!, this.spin * (1 - 0.015 * load), t, 0.03);
    const fade = this.on ? Math.min(1, (this.spin - SPIN_FROM + 0.08) / 0.2) : Math.max(0, (this.spin - SPIN_FROM) / (1 - SPIN_FROM));
    glide(this.level.gain, LEVEL.hydraulic * fade * Math.pow(10, (1.5 * load) / 20), t, this.cut && !this.on ? 0.02 : 0.05);
    if (!this.on && fade < 0.01) this.loop.stop(t + 0.1);
  }
}

/** A leaf's roll: in proportion to its speed, with the recorded door's slow swell. */
class Roll {
  private readonly level: GainNode;
  private readonly loop: Loop;
  private swell = 1;
  private swellTarget = 1;
  private readonly random: () => number;

  constructor(engine: AudioEngine, leaf: Emitter, random: () => number) {
    this.random = random;
    this.level = new GainNode(engine.ctx, { gain: 0 });
    this.level.connect(leaf.input);
    this.loop = new Loop(engine.ctx, engine.buffer(engine.bank.leafRumble), this.level, random);
  }

  update(dt: number, t: number, speed: number): void {
    if (speed > 0.01 && !this.loop.running) this.loop.start(t);
    if (!this.loop.running) return;
    // ±2.5 dB at 0.5–6 Hz, as the recorded roll swells.
    if (this.random() < dt * 4) this.swellTarget = Math.pow(10, between(this.random, -2.5, 2.5) / 20);
    this.swell += (this.swellTarget - this.swell) * (1 - Math.exp(-dt / 0.12));
    glide(this.level.gain, LEVEL.leafRoll * speed * this.swell, t, 0.06);
    if (speed <= 0.005) this.loop.stop(t + 0.3);
  }
}

interface GateRig {
  act: GateActuator;
  trunnionX: number;
  lipX: number;
  hoists: Emitter[];
  leaf: Emitter;
  bolts: Emitter[];
  hydraulics: Hydraulics;
  roll: Roll;
  prevOpenness: number;
}

export class GateSounds {
  private readonly rigs: Record<GateName, GateRig>;
  private readonly start: AudioBuffer;
  private readonly stops: AudioBuffer[];
  private readonly shuts: AudioBuffer[];
  private readonly latches: AudioBuffer[];
  private readonly random = rng(0x6a7e);
  private readonly picker = new VariantPicker(this.random);

  constructor(engine: AudioEngine, outer: GateActuator, inner: GateActuator) {
    const b = engine.bank;
    this.start = engine.buffer(b.hydraulicStart);
    this.stops = b.hydraulicStop.map((x) => engine.buffer(x));
    this.shuts = b.leafShut.map((x) => engine.buffer(x));
    this.latches = b.latch.map((x) => engine.buffer(x));

    const rig = (name: GateName, act: GateActuator, trunnionX: number, lipX: number, machineZone: Zone, sides: [Zone, Zone]): GateRig => {
      const hoists = [-1, 1].map((s) => new Emitter(engine, { name: `${name}.hoist${s}`, zones: [machineZone], refDistance: 2.5 }));
      const leaf = new Emitter(engine, {
        name: `${name}.leaf`,
        zones: sides,
        refDistance: 7,
        directivity: { axis: [1, 0, 0], rear: 0.45, rearCutoff: 1800, dipole: true },
      });
      const bolts = BOLT_Z.map((z) => new Emitter(engine, { name: `${name}.bolt${z}`, zones: sides, refDistance: 0.5, simplePanning: true }));
      return { act, trunnionX, lipX, hoists, leaf, bolts, hydraulics: new Hydraulics(engine, hoists, this.random), roll: new Roll(engine, leaf, this.random), prevOpenness: act.openness };
    };
    this.rigs = {
      outer: rig('outer', outer, GATE.outerTrunnionX, GATE.outerLipX, 'outside', ['outside', 'chamber']),
      inner: rig('inner', inner, GATE.innerTrunnionX, GATE.innerLipX, 'chamber', ['chamber', 'city']),
    };
  }

  /** Per frame: emitters follow the moving parts; the hydraulics and the roll follow the leaf. */
  update(dt: number, t: number): void {
    for (const g of Object.values(this.rigs)) {
      const s = g.act.openness;
      g.hoists.forEach((h, i) => {
        const p = hoistPoses(g.trunnionX, i === 0 ? -1 : 1, s);
        h.setPosition((p.barrel.t[0] + p.rod.t[0]) / 2, (p.barrel.t[1] + p.rod.t[1]) / 2, (p.barrel.t[2] + p.rod.t[2]) / 2);
      });
      // The skin's centre, and its normal as the leaf's axis.
      const th = GATE.thetaBottom + GATE.openAngle * s + (GATE.thetaTop - GATE.thetaBottom) / 2;
      g.leaf.setPosition(g.trunnionX + GATE.R * Math.cos(th), GATE.trunnionY + GATE.R * Math.sin(th), 0);
      g.leaf.setAxis(Math.cos(th), Math.sin(th), 0);
      g.bolts.forEach((b, i) => {
        const p = boltPose(g.lipX, BOLT_Z[i], g.act.bolts);
        b.setPosition(p.t[0], p.t[1], p.t[2]);
      });
      const speed = dt > 0 ? Math.min(Math.abs(s - g.prevOpenness) / dt / MAX_LEAF_SPEED, 1) : 0;
      g.prevOpenness = s;
      const phase = g.act.phase;
      const moving = phase === 'opening' || phase === 'closing';
      g.hydraulics.update(dt, t, phase !== 'closed' && phase !== 'open', phase === 'opening' || phase === 'unbolting', moving ? speed : 0);
      g.roll.update(dt, t, moving ? speed : 0);
    }
  }

  play(gate: GateName, event: GateEvent, t: number): void {
    const g = this.rigs[gate];
    const r = this.random;
    const pick = (list: AudioBuffer[]) => list[this.picker.pick(list.length)];
    switch (event) {
      case 'unbolt':
        for (const h of g.hoists) playInto(h, this.start, t, LEVEL.hydraulic * Math.SQRT1_2);
        break;
      case 'reverse':
        // The direction valve shifting onto the load.
        for (const h of g.hoists) playInto(h, this.start, t, LEVEL.hydraulic * 0.5);
        break;
      case 'opened':
        g.hydraulics.cutOut();
        playInto(g.leaf, pick(this.stops), t, LEVEL.openStop, between(r, 0.98, 1.02));
        break;
      case 'closed':
        playInto(g.leaf, pick(this.shuts), t, LEVEL.shut, between(r, 0.98, 1.02));
        break;
      case 'unbolted':
      case 'bolted':
        g.bolts.forEach((b, i) => playInto(b, pick(this.latches), t + i * between(r, 0.01, 0.04), LEVEL.bolt * between(r, 0.85, 1), between(r, 0.97, 1.03)));
        break;
      case 'bolt':
        break;
    }
  }
}
