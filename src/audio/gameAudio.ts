/**
 * The game's sound (docs/audio.md): the one object the runtime talks to. Each frame it moves the
 * ears to the camera, turns the airlock's state changes and the player's footfalls into sounds at
 * their sources, and lets the engine re-derive every path.
 */
import { AudioEngine, type ListenerState } from './engine';
import { zoneAt } from './acoustics';
import { AirlockWatcher } from './airlockEvents';
import { Footsteps } from './sounds/footsteps';
import { GateSounds } from './sounds/gate';
import { VentSounds } from './sounds/vents';
import { LEVEL } from './mix';
import type { AudioBank } from './bank';
import type { Airlock } from '../city/gate/airlock';
import type { GroundSurface } from '../city/walk';
import type { FootEvent } from '../player/controller';

/** What the sound needs from the world. */
export interface AudioWorld {
  airlock: Airlock;
  surface(x: number, z: number): GroundSurface;
}

/** The ears: a camera's world matrix (column-major, as three.js stores it). */
export interface Ears {
  matrixWorld: { elements: ArrayLike<number> };
}

export interface Point {
  x: number;
  y: number;
  z: number;
}

export class GameAudio {
  readonly engine: AudioEngine;
  private readonly airlock: Airlock;
  private readonly watcher: AirlockWatcher;
  private readonly footsteps: Footsteps;
  private readonly gate: GateSounds;
  private readonly vents: VentSounds;
  private readonly pending: FootEvent[] = [];
  private active = false;
  private readonly listener: ListenerState = {
    x: 0,
    y: 0,
    z: 0,
    forward: [0, 0, -1],
    up: [0, 1, 0],
    zone: 'outside',
    outerOpen: 0,
    innerOpen: 0,
    bar: 0.55,
  };

  constructor(ctx: BaseAudioContext, world: AudioWorld, bank: AudioBank) {
    this.engine = new AudioEngine(ctx, bank);
    this.engine.master.gain.value = LEVEL.master;
    this.airlock = world.airlock;
    this.watcher = new AirlockWatcher(world.airlock);
    this.footsteps = new Footsteps(this.engine, (x, z) => world.surface(x, z));
    this.gate = new GateSounds(this.engine, world.airlock.outer, world.airlock.inner);
    this.vents = new VentSounds(this.engine, world.airlock);
  }

  /**
   * A realtime context, created early in boot (its rate decides the bank's). It stays suspended
   * until a user gesture resumes it (setActive).
   */
  static context(): AudioContext {
    return new AudioContext({ latencyHint: 'interactive' });
  }

  /** Queues a footfall; it sounds at the feet on the next update. */
  foot(e: FootEvent): void {
    this.pending.push(e);
  }

  /** Per frame, after the airlock and the camera have moved. `t` defaults to the context's clock. */
  update(dt: number, ears: Ears, feet: Point, t = this.engine.ctx.currentTime): void {
    const m = ears.matrixWorld.elements;
    const l = this.listener;
    l.x = m[12];
    l.y = m[13];
    l.z = m[14];
    l.forward[0] = -m[8];
    l.forward[1] = -m[9];
    l.forward[2] = -m[10];
    l.up[0] = m[4];
    l.up[1] = m[5];
    l.up[2] = m[6];
    l.zone = zoneAt(l.x, l.z);
    l.outerOpen = this.airlock.outer.openness;
    l.innerOpen = this.airlock.inner.openness;
    l.bar = this.airlock.bar;

    const ev = this.watcher.step(this.airlock);
    for (const g of ev.gates) this.gate.play(g.gate, g.event, t);
    if (ev.pressure) this.vents.play(ev.pressure, t);

    // The body's horizontal right, for the feet's stance.
    const rl = Math.hypot(m[0], m[2]) || 1;
    this.footsteps.follow(feet.x, feet.y, feet.z, m[0] / rl, m[2] / rl);
    for (const e of this.pending) this.footsteps.play(e, feet.x, feet.z, t);
    this.pending.length = 0;

    this.gate.update(dt, t);
    this.vents.update(dt, t, this.airlock);
    this.engine.update(l, t);
  }

  /**
   * Playing or paused. Resuming needs a user gesture (the pointer-lock click); pausing fades out
   * and suspends the context so nothing renders while the menu is up.
   */
  setActive(active: boolean): void {
    const ctx = this.engine.ctx;
    if (!(ctx instanceof AudioContext)) return;
    this.active = active;
    const g = this.engine.master.gain;
    const t = ctx.currentTime;
    g.cancelScheduledValues(t);
    if (active) {
      g.setValueAtTime(0, t);
      g.setTargetAtTime(LEVEL.master, t, 0.08);
      void ctx.resume().catch((e: unknown) => console.warn('[Dyson] audio could not start', e));
    } else {
      g.setTargetAtTime(0, t, 0.04);
      setTimeout(() => {
        if (!this.active && ctx.state === 'running') void ctx.suspend();
      }, 250);
    }
  }

  /** Stops all sound for good (fatal errors). */
  close(): void {
    const ctx = this.engine.ctx;
    if (ctx instanceof AudioContext) void ctx.close();
  }
}
