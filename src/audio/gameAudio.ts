/**
 * The game's sound (docs/audio.md): the one object the runtime talks to. Each frame it moves the
 * ears to the camera, turns the airlock's state changes and the player's footfalls into sounds at
 * their sources, and lets the engine re-derive every path.
 */
import { AudioEngine, type ListenerState } from './engine';
import { AirlockWatcher, type AirlockState } from './airlockEvents';
import { Footsteps } from './sounds/footsteps';
import { GateSounds, LOCK_GATE_SOUND } from './sounds/gate';
import { CarSounds, CraftSounds, type AudioCar, type AudioCraft } from './sounds/vehicles';
import { VentSounds } from './sounds/vents';
import { FieldSounds, type AudioField } from './sounds/field';
import { HouseSounds, type AudioHouse } from './sounds/house';
import { SpeechSounds } from './sounds/speech';
import { SpeechCues } from './speechCues';
import { TerminalSounds, type AudioTerminal } from './sounds/terminal';
import { CrewSounds, type AudioCrew } from './sounds/crew';
import { AIRLOCK_SPEECH, type SpeechClips } from './loadSpeech';
import { LEVEL } from './mix';
import type { AudioBank } from './bank';
import type { Airlock } from '../city/gate/airlock';
import type { GroundSurface } from '../city/walk';
import type { FootEvent } from '../player/controller';

/** What the sound needs from the world. */
export interface AudioWorld {
  airlock: Airlock;
  /** What is underfoot at a point (feet height y: the house has storeys). */
  surface(x: number, z: number, y: number): GroundSurface;
  /** The field's machines (absent in tools that only drive the airlock). */
  field?: AudioField;
  /** The house (absent in tools without it). */
  house?: AudioHouse;
  /** The East Lock's airlock, the car and the craft (absent in tools without them). */
  lock?: AirlockState;
  car?: AudioCar;
  craft?: AudioCraft;
  /** The announcements' recordings (absent in tools without them: then none is made). */
  speech?: SpeechClips;
  /** The West Gate terminal (absent in tools without it). */
  terminal?: AudioTerminal;
  /** The crew's robots (absent in tools without them); `gain` is the field's silencer by the listener's place. */
  crew?: { state: AudioCrew; gain(x: number, z: number): number };
}

/** The ears: a camera's world matrix (column-major, as three.js stores it). */
export interface Ears {
  matrixWorld: { elements: ArrayLike<number> };
}

/**
 * A sound system that exists only for a while and drives the listener's coupling to it: the intro's
 * ship (intro/audio/sounds.ts). It sounds through the same engine; GameAudio only gives it its turn
 * each frame, the ship's door and vacuum for the paths, and what is underfoot aboard.
 */
export interface TransientSounds {
  update(t: number, l: ListenerState): void;
  /** The ship's door's openness (0..1) and whether it is in vacuum. */
  readonly cabin: { open: number; vacuum: boolean };
  /** What is underfoot at a point, where it knows better than the world (aboard, the stair). */
  surface(x: number, y: number, z: number): GroundSurface | null;
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
  private readonly field: FieldSounds | null;
  private readonly house: HouseSounds | null;
  private readonly houseDoors: AudioHouse['doors'] | null;
  private readonly lock: { state: AirlockState; watcher: AirlockWatcher; sounds: GateSounds } | null;
  private readonly car: CarSounds | null;
  private readonly craft: CraftSounds | null;
  private readonly speech: { sounds: SpeechSounds; cues: SpeechCues; airlockCount: number } | null;
  private readonly world: AudioWorld;
  private readonly terminal: TerminalSounds | null;
  private readonly crew: CrewSounds | null;
  private readonly pending: FootEvent[] = [];
  private transient: TransientSounds | null = null;
  private active = false;
  /** The player's volume on top of the mix (ui/audioPrefs.ts): 1 is the mix as authored, 0 is muted. */
  private userGain = 1;
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
    houseOpen: 0,
    cabin: { open: 0, vacuum: false },
  };

  constructor(ctx: BaseAudioContext, world: AudioWorld, bank: AudioBank) {
    this.engine = new AudioEngine(ctx, bank);
    this.engine.master.gain.value = LEVEL.master;
    this.airlock = world.airlock;
    this.watcher = new AirlockWatcher(world.airlock);
    this.footsteps = new Footsteps(this.engine, (x, z, y) => this.transient?.surface(x, y, z) ?? world.surface(x, z, y));
    this.gate = new GateSounds(this.engine, world.airlock.outer, world.airlock.inner);
    this.vents = new VentSounds(this.engine, world.airlock);
    this.field = world.field ? new FieldSounds(this.engine, world.field) : null;
    const house = world.house;
    if (house) this.engine.interior = (x, y, z) => house.inside(x, y, z);
    this.house = house ? new HouseSounds(this.engine, house) : null;
    this.houseDoors = house?.doors ?? null;
    const lock = world.lock;
    this.lock = lock ? { state: lock, watcher: new AirlockWatcher(lock), sounds: new GateSounds(this.engine, lock.outer, lock.inner, LOCK_GATE_SOUND) } : null;
    this.car = world.car ? new CarSounds(this.engine, world.car) : null;
    this.craft = world.craft ? new CraftSounds(this.engine, world.craft) : null;
    this.world = world;
    this.terminal = world.terminal ? new TerminalSounds(this.engine, world.terminal) : null;
    const crew = world.crew;
    this.crew = crew ? new CrewSounds(this.engine, crew.state, (x, z, y) => world.surface(x, z, y), (x, z) => crew.gain(x, z)) : null;
    this.speech = world.speech
      ? { sounds: new SpeechSounds(this.engine, world.speech, { car: world.car ?? null }), cues: new SpeechCues(), airlockCount: world.airlock.announcement.count }
      : null;
  }

  /**
   * A realtime context, created early in boot (its rate decides the bank's). It stays suspended
   * until a user gesture resumes it (setActive).
   */
  static context(): AudioContext {
    return new AudioContext({ latencyHint: 'interactive' });
  }

  /** Gives a transient sound system (the intro's ship) its turn each frame, or ends it (null). */
  setTransient(s: TransientSounds | null): void {
    this.transient = s;
    if (!s) {
      this.listener.cabin.open = 0;
      this.listener.cabin.vacuum = false;
    }
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
    l.zone = this.engine.locate(l.x, l.y, l.z);
    l.outerOpen = this.airlock.outer.openness;
    l.innerOpen = this.airlock.inner.openness;
    l.bar = this.airlock.bar;
    let open = 0;
    if (this.houseDoors) for (const d of this.houseDoors.list) if (d.spec.exterior && d.amount > open) open = d.amount;
    l.houseOpen = open;
    if (this.transient) {
      l.cabin.open = this.transient.cabin.open;
      l.cabin.vacuum = this.transient.cabin.vacuum;
    }

    const ev = this.watcher.step(this.airlock);
    for (const g of ev.gates) this.gate.play(g.gate, g.event, t);
    if (ev.pressure) this.vents.play(ev.pressure, t);

    // The body's horizontal right, for the feet's stance.
    const rl = Math.hypot(m[0], m[2]) || 1;
    this.footsteps.follow(feet.x, feet.y, feet.z, m[0] / rl, m[2] / rl);
    for (const e of this.pending) this.footsteps.play(e, feet.x, feet.y, feet.z, t);
    this.pending.length = 0;

    this.gate.update(dt, t);
    if (this.lock) {
      for (const g of this.lock.watcher.step(this.lock.state).gates) this.lock.sounds.play(g.gate, g.event, t);
      this.lock.sounds.update(dt, t, l);
    }
    this.car?.update(dt, t);
    this.craft?.update(t, l);
    this.vents.update(dt, t, this.airlock);
    this.field?.update(dt, t, l);
    this.crew?.update(t, l);
    this.house?.update(t, l);
    if (this.speech) this.announce(dt, t, l);
    this.terminal?.update(t, l);
    this.transient?.update(t, l);
    this.engine.update(l, t);
  }

  /** The announcements: the airlock's as it makes them, the others as the listener crosses into places. */
  private announce(dt: number, t: number, l: ListenerState): void {
    const sp = this.speech!;
    const a = this.airlock.announcement;
    if (a.count !== sp.airlockCount) {
      sp.airlockCount = a.count;
      if (a.cue) sp.sounds.play(AIRLOCK_SPEECH[a.cue], t, l);
    }
    const w = this.world;
    for (const s of sp.cues.update(dt, { x: l.x, z: l.z, driven: w.car?.driven ?? false, craft: w.craft?.visible ? w.craft.position : null })) sp.sounds.play(s, t, l);
    sp.sounds.update(t, l);
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
      g.setTargetAtTime(LEVEL.master * this.userGain, t, 0.08);
      void ctx.resume().catch((e: unknown) => console.warn('[Dyson] audio could not start', e));
    } else {
      g.setTargetAtTime(0, t, 0.04);
      setTimeout(() => {
        if (!this.active && ctx.state === 'running') void ctx.suspend();
      }, 250);
    }
  }

  /** The player's volume (0 mutes). Takes effect at once while playing, and on the next resume. */
  setUserGain(gain: number): void {
    this.userGain = Math.max(0, gain);
    if (!this.active) return;
    const g = this.engine.master.gain;
    const t = this.engine.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(LEVEL.master * this.userGain, t, 0.05);
  }

  /** Stops all sound for good (fatal errors). */
  close(): void {
    const ctx = this.engine.ctx;
    if (ctx instanceof AudioContext) void ctx.close();
  }
}
