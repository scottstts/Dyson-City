/**
 * The house (docs/audio.md "The house"): its doors, its clocks and the kettle on the range, each
 * from where it is. The house's logic knows nothing of sound: this watches the leaves' motion and
 * plays what a door does, and it voices the Sound_ markers the export placed.
 *
 *  - A door opening from shut: the latch drawn and the leaf freed (the recording's opening), from
 *    the handle as the hand turns it. Opening further from ajar makes no latch sound.
 *  - A door closing: the handle and the swing as it starts (quiet), and the shut timed so the
 *    stile meets its stop when the leaf does (the leaf's own time to rest). If the leaf is stopped
 *    short (the walker in its way, or opened again), a pending shut is cancelled.
 *  - Door voices are a small pool, not one per leaf: two inside the house, one for the outer doors
 *    (which radiate both into the hall and onto the porch).
 *  - The clocks beat their escapements (a longcase's seconds, a mantel clock's quicker beat; the
 *    tock a touch late, as no clock is perfectly in beat) and the kettle simmers, only within
 *    earshot of the house: beyond it nothing is scheduled and the kettle's loop is stopped.
 *  - Reverberation is the room's, not the house's: a sound feeds the house's reverb at its level
 *    at 1 m (its input is its level at `refDistance`) and in full only while the listener is in
 *    the room it sounds in. From any other room, or outdoors, its room's reverb reaches the
 *    listener ROOM_LEAK down (and outdoors through the shell's path besides). The house shares
 *    one reverb sized like one furnished room; fed at the 0.3 m level and heard in every room, the
 *    kitchen's kettle filled the whole house ~30 dB over its own direct sound.
 */
import { Vector3 } from 'three';
import { Emitter } from '../emitter';
import type { AudioEngine, ListenerState } from '../engine';
import { LEVEL } from '../mix';
import { between, rng } from '../dsp';
import { playInto, VariantPicker } from './oneShot';
import { CLOCKS, type ClockKind } from '../synth/house';

/** What the sound needs from a door leaf (house/doors.ts). */
export interface AudioDoor {
  readonly pair: string;
  readonly amount: number;
  readonly target: number;
  readonly spec: { readonly kind: 'hinge' | 'slide'; readonly exterior: boolean };
  handleWorld(out: Vector3): Vector3;
  timeToTarget(): number;
}

/** A Sound_ marker (house/house.ts). */
export interface AudioHouseSound {
  readonly clip: string;
  readonly gain: number;
  readonly position: readonly [number, number, number];
}

/** What the sound needs from the house. */
export interface AudioHouse {
  /** Is a world point inside the house's rooms? */
  inside(x: number, y: number, z: number): boolean;
  /** The room a world point is in, or null outside them. */
  roomAt(x: number, y: number, z: number): string | null;
  readonly doors: { readonly list: readonly AudioDoor[] };
  /** Grows as the floors stream in. */
  readonly sounds: readonly AudioHouseSound[];
  readonly centre: { readonly x: number; readonly y: number; readonly z: number };
}

/** Beyond this from the house's middle (m) its clocks and kettle are inaudible: nothing is scheduled. */
const EARSHOT = 45;
/** Beats are scheduled this far ahead (s), comfortably over a frame. */
const AHEAD = 0.15;
/** A leaf counts as shut below this much open. */
const SHUT = 0.03;
/** A room's reverberation heard from another room (or outdoors): through partitions and doorways. First pass, by ear. */
const ROOM_LEAK = 0.1;
/** Reference distances (m): doors from the handle, clocks and the kettle from the movement or the pan. */
const DOOR_REF = 0.5;
const MARKER_REF = 0.3;

interface DoorState {
  target: number;
  /** A scheduled shut, and when its strike lands. */
  shut: { src: AudioBufferSourceNode; strike: number } | null;
}

interface Clock {
  emitter: Emitter;
  kind: ClockKind;
  gain: number;
  next: number;
  side: 0 | 1;
}

interface Simmer {
  emitter: Emitter;
  gain: number;
  src: AudioBufferSourceNode | null;
  level: GainNode;
}

export class HouseSounds {
  private readonly engine: AudioEngine;
  private readonly house: AudioHouse;
  private readonly random = rng(0x40053);
  private readonly picker: VariantPicker;
  private readonly inner: Emitter[];
  private readonly outer: Emitter;
  private innerNext = 0;
  private readonly open: AudioBuffer[];
  private readonly swing: AudioBuffer[];
  private readonly shut: AudioBuffer[];
  private readonly strike: number;
  private readonly states = new Map<string, DoorState>();
  private readonly ticks: Record<ClockKind, [AudioBuffer[], AudioBuffer[]]>;
  private readonly kettle: AudioBuffer;
  private readonly clocks: Clock[] = [];
  private readonly simmers: Simmer[] = [];
  private voiced = 0;
  private readonly tmp = new Vector3();
  /** The room the listener is in this frame (null outdoors). */
  private listenerRoom: string | null = null;

  constructor(engine: AudioEngine, house: AudioHouse) {
    this.engine = engine;
    this.house = house;
    this.picker = new VariantPicker(this.random);
    const make = (name: string, zones: ('house' | 'city')[]) => {
      const e: Emitter = new Emitter(engine, { name, zones, refDistance: DOOR_REF, sendScale: (zone) => this.sendScale(zone, DOOR_REF, house.roomAt(...e.position)) });
      return e;
    };
    this.inner = [make('house.door.0', ['house']), make('house.door.1', ['house'])];
    this.outer = make('house.door.outer', ['house', 'city']);
    const b = engine.bank;
    this.open = b.door.open.map((x) => engine.buffer(x));
    this.swing = b.door.swing.map((x) => engine.buffer(x));
    this.shut = b.door.shut.map((x) => engine.buffer(x));
    this.strike = b.door.strike;
    this.ticks = {
      longcase: [b.ticks.longcase[0].map((x) => engine.buffer(x)), b.ticks.longcase[1].map((x) => engine.buffer(x))],
      mantel: [b.ticks.mantel[0].map((x) => engine.buffer(x)), b.ticks.mantel[1].map((x) => engine.buffer(x))],
    };
    this.kettle = engine.buffer(b.kettle);
  }

  private voiceFor(exterior: boolean): Emitter {
    if (exterior) return this.outer;
    const e = this.inner[this.innerNext];
    this.innerNext = (this.innerNext + 1) % this.inner.length;
    return e;
  }

  private at(e: Emitter, d: AudioDoor): void {
    const h = d.handleWorld(this.tmp);
    e.setPosition(h.x, h.y, h.z);
  }

  private doors(t: number): void {
    for (const d of this.house.doors.list) {
      const st = this.states.get(d.pair);
      if (!st) {
        this.states.set(d.pair, { target: d.target, shut: null });
        continue;
      }
      // A pair moves together: its first leaf speaks for it (the state is the pair's).
      const slide = d.spec.kind === 'slide';
      const force = slide ? 0.6 : 1;
      if (d.target !== st.target) {
        if (st.shut && t < st.shut.strike) st.shut.src.stop();
        st.shut = null;
        if (d.target > st.target && d.amount < SHUT) {
          const e = this.voiceFor(d.spec.exterior);
          this.at(e, d);
          playInto(e, this.open[this.picker.pick(this.open.length)], t, LEVEL.door * force * this.jitter(), between(this.random, 0.97, 1.03));
        } else if (d.target === 0 && d.amount > 0.1) {
          const e = this.voiceFor(d.spec.exterior);
          this.at(e, d);
          playInto(e, this.swing[this.picker.pick(this.swing.length)], t, LEVEL.door * force * this.jitter());
        }
        st.target = d.target;
      }
      if (d.target === 0 && d.amount > 0 && !st.shut) {
        const eta = d.timeToTarget();
        if (eta <= this.strike + AHEAD) {
          const e = this.voiceFor(d.spec.exterior);
          this.at(e, d);
          const start = t + eta - this.strike;
          const buffer = this.shut[this.picker.pick(this.shut.length)];
          const src = playInto(e, buffer, Math.max(start, t), LEVEL.door * force * this.jitter(), 1, Math.max(t - start, 0));
          st.shut = { src, strike: t + eta };
        }
      }
    }
  }

  private jitter(): number {
    return Math.pow(10, between(this.random, -1.5, 1.5) / 20);
  }

  /** New Sound_ markers (as floors stream in) get their voices. */
  private voice(t: number): void {
    const list = this.house.sounds;
    for (; this.voiced < list.length; this.voiced++) {
      const s = list[this.voiced];
      const room = this.house.roomAt(...s.position);
      const emitter = new Emitter(this.engine, { name: `house.${s.clip}`, zones: ['house'], refDistance: MARKER_REF, sendScale: (zone) => this.sendScale(zone, MARKER_REF, room) });
      emitter.setPosition(...s.position);
      if (s.clip === 'clock_tick_longcase' || s.clip === 'clock_tick_mantel') {
        const kind: ClockKind = s.clip === 'clock_tick_longcase' ? 'longcase' : 'mantel';
        this.clocks.push({ emitter, kind, gain: s.gain, next: t + this.random() * CLOCKS[kind].beat, side: 0 });
      } else if (s.clip === 'kettle_simmer') {
        const level = new GainNode(this.engine.ctx, { gain: 0 });
        level.connect(emitter.input);
        this.simmers.push({ emitter, gain: s.gain, src: null, level });
      } else console.warn(`[Dyson] house sound '${s.clip}' has no voice`);
    }
  }

  /** The reverb send of a sound in `room` (docs/audio.md "The house"): its level at 1 m, its room's only. */
  private sendScale(zone: string, ref: number, room: string | null): number {
    if (zone !== 'house') return ref;
    return room !== null && room === this.listenerRoom ? ref : ref * ROOM_LEAK;
  }

  update(t: number, l: ListenerState): void {
    this.listenerRoom = this.house.roomAt(l.x, l.y, l.z);
    this.voice(t);
    this.doors(t);
    const c = this.house.centre;
    const near = Math.hypot(l.x - c.x, l.y - c.y, l.z - c.z) < EARSHOT;
    for (const k of this.clocks) {
      if (!near) {
        k.next = Math.max(k.next, t);
        continue;
      }
      if (k.next < t - 0.5) k.next = t;
      const beat = CLOCKS[k.kind].beat;
      while (k.next < t + AHEAD) {
        const list = this.ticks[k.kind][k.side];
        playInto(k.emitter, list[Math.floor(this.random() * list.length)], k.next, LEVEL.tick * k.gain * Math.pow(10, between(this.random, -0.8, 0.8) / 20));
        // Not quite in beat: the tock comes a little late.
        k.next += beat * (k.side === 0 ? 1.015 : 0.985);
        k.side = k.side === 0 ? 1 : 0;
      }
    }
    for (const s of this.simmers) {
      if (near && !s.src) {
        s.src = new AudioBufferSourceNode(this.engine.ctx, { buffer: this.kettle, loop: true });
        s.src.connect(s.level);
        s.src.start(t, this.random() * this.kettle.duration);
        s.level.gain.setTargetAtTime(LEVEL.kettle * s.gain, t, 0.3);
      } else if (!near && s.src) {
        s.level.gain.setTargetAtTime(0, t, 0.1);
        s.src.stop(t + 0.6);
        s.src = null;
      }
    }
  }
}
