/**
 * The intro's sound (docs/intro-audio.md): the ship's cabin, its voices and its machines, through
 * the game's engine (audio/engine.ts) and its rules (docs/audio.md): every sound radiated from
 * where it is made, carried by its path, reverberated by the space it is in.
 *
 *  - The cabin is its own space (acoustics.ts `cabin`): its machinery's hum (the user's recording,
 *    resynthesised), Aurelia from the overhead loudspeaker, the Guardian's own voice from the
 *    mouth, the PA's chime and the avionics' tones. In deep space nothing from outside reaches it;
 *    on the band the hull passes a low rumble, and the open door the band itself.
 *  - The engines: the craft's roar (the user's recording, cloned) at the nozzles and the lift
 *    vents, its pitch and brightness following each engine's spool, which lags the thrust (a
 *    turbine runs down slowly: the pitch falls after shutdown); the lift fans' narrowband whine;
 *    and through the floor, structure-borne, their low rumble, heard even in vacuum.
 *  - The gear: the nose leg's actuators under the cockpit floor, the mains' in the nacelles (the
 *    gate's hydraulic power unit, cloned, pitched up and quiet), and their latches down and locked.
 *  - Touchdown: the gear's thud through the floor and the pads' knock on the deck.
 *  - The door: unlatching, the seal breaking (the cabin is at 1 bar, the band at 0.55), the
 *    actuator running it out and aft, its stop; closing, its shut. The stair: its actuator and its
 *    stops.
 *
 * The intro sets its state each frame (`set`); GameAudio gives it its turn (`update`), when it
 * moves its emitters with the ship and turns crossings of the film's times into sounds. Nothing
 * outlives it: `dispose` stops its voices and takes its emitters out of the engine.
 */
import { Matrix4, Vector3 } from 'three/webgpu';
import type { AudioEngine, ListenerState } from '../../audio/engine';
import { Emitter, type EmitterOptions } from '../../audio/emitter';
import { LoopVoice } from '../../audio/sounds/vehicles';
import { playInto } from '../../audio/sounds/oneShot';
import { LEVEL } from '../../audio/mix';
import { glide } from '../../audio/params';
import { rng } from '../../audio/dsp';
import type { GroundSurface } from '../../city/walk';
import type { TransientSounds } from '../../audio/gameAudio';
import type { Vec3 } from '../../geometry/polyMesh';
import { SPEAKER, type Timeline } from '../timeline';
import type { ShipState } from '../ship/ship';
import { doorOffset, DOOR_TIME } from '../ship/door';
import { HINGE, STAIR_TIME } from '../ship/stair';
import { LEGS } from '../ship/gear';
import { VENTS } from '../ship/engines';
import { DOOR, FLOOR_Y, NOZZLE_CENTRE } from '../ship/spec';
import { MONITOR } from '../ship/cabin/cockpit';
import { synthChime, synthConfirm } from './tones';

const L = LEVEL.intro;

/** What the intro hands its sound each frame. */
export interface IntroSoundFrame {
  /** The film's clock (s). */
  time: number;
  /** Deep space (scene 1): vacuum outside. */
  space: boolean;
  /** The ship's frame in the world. */
  ship: Matrix4;
  state: Readonly<ShipState>;
}

/** The cabin's box in the ship's frame (spec.ts): floor to ceiling, bulkhead to nose. */
const CABIN_BOX = { x0: 0.06, x1: 11.4, y0: FLOOR_Y - 0.05, y1: 5.05, z: 2.8 } as const;

interface Placed {
  emitter: Emitter;
  /** Ship-frame position (null: placed each frame by other means). */
  at: Vec3 | null;
  /** Ship-frame axis for its directivity. */
  axis?: Vec3;
  /** Its distance from the listener this frame (m). */
  distance: number;
}

/** A turbine's tonal whine: noise through narrow bands at its blade-pass and harmonics. */
class Whine {
  readonly gain: GainNode;
  private readonly bands: BiquadFilterNode[];
  private readonly src: AudioBufferSourceNode;
  constructor(ctx: BaseAudioContext, noise: AudioBuffer, out: AudioNode, offset: number) {
    this.gain = new GainNode(ctx, { gain: 0 });
    this.gain.connect(out);
    this.src = new AudioBufferSourceNode(ctx, { buffer: noise, loop: true });
    this.bands = [1, 2.02, 3.07].map((k, i) => {
      const f = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1000 * k, Q: 45 });
      const g = new GainNode(ctx, { gain: [3.2, 1.6, 0.8][i] });
      this.src.connect(f).connect(g).connect(this.gain);
      return f;
    });
    this.src.start(ctx.currentTime, offset);
  }
  set(f0: number, level: number, t: number): void {
    this.bands.forEach((b, i) => glide(b.frequency, f0 * [1, 2.02, 3.07][i], t, 0.15));
    glide(this.gain.gain, level, t, 0.15);
  }
  stop(): void {
    this.src.stop();
    this.gain.disconnect();
  }
}

export class IntroSounds implements TransientSounds {
  readonly cabin = { open: 0, vacuum: true };
  private readonly engine: AudioEngine;
  private readonly tl: Timeline;
  private readonly lines: AudioBuffer[];
  private readonly ctx: BaseAudioContext;
  private readonly random = rng(0x1a7e0);
  /**
   * The intro's direct sound, straight to the master (in vacuum the world's dry bus is shut): the
   * voices, and the machines, which dip under every line (the speech carries the scene).
   */
  private readonly out: GainNode;
  private readonly machines: GainNode;
  /** Structure-borne sources' inputs: what the floor passes of the nose gear and the touchdown. */
  private readonly noseIn: AudioNode;
  private readonly floorIn: AudioNode;
  private readonly placed: Placed[] = [];
  private readonly loops: LoopVoice[] = [];
  private readonly ambient: LoopVoice[] = [];
  private readonly whines: Whine[] = [];
  private readonly frame: IntroSoundFrame = { time: 0, space: true, ship: new Matrix4(), state: { door: 0, stair: 0, gear: 0, compression: 0, main: 0, lift: 0 } };
  private readonly inverse = new Matrix4();
  private prev: { time: number; door: number; stair: number; gear: number } | null = null;
  private spool = { main: 0, lift: 0 };
  /** The lines sounding now (stopped on a jump in the film), and whether the film is held (review). */
  private readonly speaking = new Set<AudioBufferSourceNode>();
  private held = false;
  private lastT = 0;

  // Voices.
  private readonly speaker: Emitter;
  private readonly mouth: Emitter;
  private readonly speakerIn: AudioNode;
  private readonly mouthIn: AudioNode;
  private readonly dash: Emitter;
  private readonly monitor: Emitter;
  private readonly noseGear: Emitter;
  private readonly floor: Emitter;
  private readonly mains: Emitter[];
  private readonly door: Emitter;
  private readonly stair: Emitter;
  // Loops.
  private readonly mainRoar: LoopVoice[];
  private readonly liftRoar: LoopVoice[];
  private readonly rumble: LoopVoice;
  private readonly gearRun: LoopVoice[];
  private readonly doorRun: LoopVoice;
  private readonly doorRoll: LoopVoice;
  private readonly stairRun: LoopVoice;
  // Buffers.
  private readonly chime: AudioBuffer;
  private readonly confirm: AudioBuffer;
  private readonly confirmLow: AudioBuffer;
  private readonly hydraulic: AudioBuffer;
  private readonly roar: AudioBuffer;
  private readonly latch: AudioBuffer[];
  private readonly impact: AudioBuffer[];
  private readonly shut: AudioBuffer[];
  private readonly stop: AudioBuffer[];

  constructor(engine: AudioEngine, lines: AudioBuffer[], timeline: Timeline) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.tl = timeline;
    this.lines = lines;
    const ctx = this.ctx;
    const bank = engine.bank;
    this.out = new GainNode(ctx, { gain: 1 });
    this.out.connect(engine.master);
    this.machines = new GainNode(ctx, { gain: 1 });
    this.machines.connect(engine.master);
    this.chime = engine.buffer(synthChime(ctx.sampleRate));
    this.confirm = engine.buffer(synthConfirm(ctx.sampleRate, 2400, 7));
    this.confirmLow = engine.buffer(synthConfirm(ctx.sampleRate, 1800, 11));
    this.hydraulic = engine.buffer(bank.hydraulicRun);
    this.roar = engine.buffer(bank.craft);
    this.latch = bank.latch.map((x) => engine.buffer(x));
    this.impact = bank.impact.map((x) => engine.buffer(x));
    this.shut = bank.leafShut.map((x) => engine.buffer(x));
    this.stop = bank.hydraulicStop.map((x) => engine.buffer(x));

    const cabin = (name: string, at: Vec3 | null, refDistance: number, extra: Partial<EmitterOptions> = {}, axis?: Vec3) => this.place({ name, zones: ['cabin'], refDistance, ...extra }, at, axis);
    const outside = (name: string, at: Vec3, refDistance: number, extra: Partial<EmitterOptions> = {}, axis?: Vec3) => this.place({ name, zones: ['outside'], refDistance, ...extra }, at, axis);

    // The cabin's machinery: an air-handling grille aft and the avionics bay under the dash.
    const amb = engine.buffer(bank.introCabin);
    for (const at of [[0.35, 3.6, 1.4], [9.5, 2.6, 0]] as Vec3[]) {
      const e = cabin('intro:cabin', at, 1.5);
      const v = new LoopVoice(ctx, amb, e.input, { type: 'lowpass', frequency: 16000, Q: 0.5 }, this.random);
      this.loops.push(v);
      this.ambient.push(v);
    }
    // The engines through the floor (structure-borne: heard in vacuum too).
    const rumbleAt = cabin('intro:rumble', [4.5, FLOOR_Y, 0], 2);
    this.rumble = new LoopVoice(ctx, this.roar, rumbleAt.input, { type: 'lowpass', frequency: 150, Q: 0.7 }, this.random);
    this.loops.push(this.rumble);

    // Aurelia's loudspeaker in the overhead panel, facing down; the Guardian's mouth.
    this.speaker = cabin('intro:aurelia', [8.0, 4.72, 0], 0.3, { directivity: { axis: [0, -1, 0], rear: 0.3, rearCutoff: 1500 }, out: this.out }, [0, -1, 0]);
    // A small cabin loudspeaker: its band (no deep bass, rolled-off top) and a presence lift.
    const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 190, Q: 0.7 });
    const pres = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 2600, Q: 0.9, gain: 3 });
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 7800, Q: 0.6 });
    hp.connect(pres).connect(lp).connect(this.speaker.input);
    this.speakerIn = hp;
    this.mouth = this.place({ name: 'intro:guardian', zones: 'located', refDistance: 0.12, directivity: { axis: [0, 0, -1], rear: 0.5, rearCutoff: 2500 }, out: this.out }, null);
    // One's own voice is heard through the skull as well: fuller in the lows.
    const bone = new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 280, gain: 4 });
    bone.connect(this.mouth.input);
    this.mouthIn = bone;
    this.dash = cabin('intro:dash', [9.3, 3.08, 0], 0.2);
    this.monitor = cabin('intro:monitor', MONITOR.centre, 0.2);

    // The nose gear's actuators and latch under the cockpit floor; the mains' in the nacelles.
    this.noseGear = cabin('intro:nose-gear', [9.2, FLOOR_Y, 0], 0.8);
    this.floor = cabin('intro:floor', [6.5, FLOOR_Y, 0], 1.5);
    // Through the floor's structure: only the lows, and little of them (the cabin is sealed and lined).
    this.noseIn = structural(ctx, this.noseGear.input, 320, 0.3);
    this.floorIn = structural(ctx, this.floor.input, 200, 0.45);
    this.mains = LEGS.filter((l) => l.name !== 'nose').map((l) => outside(`intro:${l.name}`, [l.pivot[0], l.pivot[1] - 0.3, l.pivot[2]], 1));
    this.gearRun = [this.noseIn, ...this.mains.map((e) => e.input)].map((into) => {
      const v = new LoopVoice(ctx, this.hydraulic, into, { type: 'lowpass', frequency: 5000, Q: 0.5 }, this.random);
      this.loops.push(v);
      return v;
    });

    // The engines: the mains at their nozzles (beamed aft), the lifts at their vents (beamed down).
    this.mainRoar = [1, -1].map((s) => {
      const e = outside('intro:main', [NOZZLE_CENTRE[0] - 0.6, NOZZLE_CENTRE[1], s * NOZZLE_CENTRE[2]], 3, { directivity: { axis: [-1, 0, 0], rear: 0.35, rearCutoff: 1600 } }, [-1, 0, 0]);
      const v = new LoopVoice(ctx, this.roar, e.input, { type: 'lowpass', frequency: 3000, Q: 0.5 }, this.random);
      this.loops.push(v);
      return v;
    });
    const lifts = [VENTS.find((v) => v.name === 'belly')!, ...VENTS.filter((v) => v.name.startsWith('fore'))];
    this.liftRoar = lifts.map((v) => {
      const e = outside('intro:lift', [v.x, v.skinY - 0.2, v.z], 2.5, { directivity: { axis: [0, -1, 0], rear: 0.45, rearCutoff: 2000 } }, [0, -1, 0]);
      const voice = new LoopVoice(ctx, this.roar, e.input, { type: 'lowpass', frequency: 3000, Q: 0.5 }, this.random);
      this.loops.push(voice);
      this.whines.push(new Whine(ctx, engine.noise, e.input, this.random() * 5));
      return voice;
    });

    // The door (radiating into the cabin and out onto the band) and the stair's actuator.
    const dn = -Math.cos((5 * Math.PI) / 180);
    this.door = this.place({ name: 'intro:door', zones: ['cabin', 'outside'], refDistance: 0.8, directivity: { axis: [0, 0, -1], rear: 1, rearCutoff: 20000, dipole: true } }, [DOOR.x, (DOOR.bottom + DOOR.top) / 2, dn * 2.95], [0, 0, -1]);
    this.doorRun = new LoopVoice(ctx, this.hydraulic, this.door.input, { type: 'lowpass', frequency: 6000, Q: 0.5 }, this.random);
    this.doorRoll = new LoopVoice(ctx, engine.buffer(bank.leafRumble), this.door.input, { type: 'lowpass', frequency: 4000, Q: 0.5 }, this.random);
    this.stair = outside('intro:stair', [HINGE.x, HINGE.y, HINGE.out + 0.3], 1);
    this.stairRun = new LoopVoice(ctx, this.hydraulic, this.stair.input, { type: 'lowpass', frequency: 5000, Q: 0.5 }, this.random);
    this.loops.push(this.doorRun, this.doorRoll, this.stairRun);

    // The listener's space: aboard is the cabin's. The listener rides the ship: placed exactly each
    // frame, like the sounds carried with it.
    engine.cabin = (x, y, z) => this.aboard(x, y, z);
    engine.listenerGlide = 0;
  }

  private place(opts: EmitterOptions, at: Vec3 | null, axis?: Vec3): Emitter {
    // Each feeds its space's reverberation at its level at 1 m (docs/audio.md, "The send is the
    // level at 1 m"): its input is its level at refDistance.
    // Carried with the listener through the ship's flight: placed exactly each frame, as the listener
    // is while the intro runs (emitter.ts `glide`).
    // The band's reverberation is the scatter round the listener; a source far off feeds it as its
    // direct sound falls (BAND_SCATTER), or the ship climbing away held its level to the last.
    const placed: Placed = { emitter: null as unknown as Emitter, at, axis, distance: 1 };
    const e = new Emitter(this.engine, { ...opts, out: opts.out ?? this.machines, sendScale: (zone) => opts.refDistance * (zone === 'outside' ? Math.min(1, BAND_SCATTER / placed.distance) : 1), glide: 0 });
    placed.emitter = e;
    this.placed.push(placed);
    return e;
  }

  /** The intro's state this frame. */
  set(f: IntroSoundFrame): void {
    this.frame.time = f.time;
    this.frame.space = f.space;
    this.frame.ship.copy(f.ship);
    Object.assign(this.frame.state, f.state);
    this.inverse.copy(f.ship).invert();
    this.cabin.vacuum = f.space;
    this.cabin.open = doorOffset(f.state.door).open;
  }

  /** Is a world point inside the cabin? */
  private aboard(x: number, y: number, z: number): boolean {
    const p = V.set(x, y, z).applyMatrix4(this.inverse);
    const B = CABIN_BOX;
    return p.x > B.x0 && p.x < B.x1 && p.y > B.y0 && p.y < B.y1 && Math.abs(p.z) < B.z;
  }

  /** Aboard and on the stair the feet are on the ship's deck plates and treads. */
  surface(x: number, y: number, z: number): GroundSurface | null {
    const p = V.set(x, y + 0.05, z).applyMatrix4(this.inverse);
    if (this.aboard(x, y + 0.05, z)) return 'deck';
    const onStair = Math.abs(p.x - DOOR.x) < 0.6 && p.z < -2.8 && p.z > HINGE.out - 0.5 && p.y > 0.08;
    return onStair ? 'deck' : null;
  }

  update(t: number, l: ListenerState): void {
    const f = this.frame;
    const dt = Math.min(Math.max(t - this.lastT, 0), 0.1);
    this.lastT = t;
    // Place every emitter with the ship (the mouth with the head).
    const m = f.ship;
    for (const p of this.placed) {
      if (p.at) {
        V.set(p.at[0], p.at[1], p.at[2]).applyMatrix4(m);
        p.emitter.setPosition(V.x, V.y, V.z);
      }
      const q = p.emitter.position;
      p.distance = Math.hypot(q[0] - l.x, q[1] - l.y, q[2] - l.z);
      if (p.axis) {
        A.set(p.axis[0], p.axis[1], p.axis[2]).transformDirection(m);
        p.emitter.setAxis(A.x, A.y, A.z);
      }
    }
    this.mouth.setPosition(l.x + l.forward[0] * 0.08 - l.up[0] * 0.09, l.y + l.forward[1] * 0.08 - l.up[1] * 0.09, l.z + l.forward[2] * 0.08 - l.up[2] * 0.09);
    this.mouth.setAxis(l.forward[0], l.forward[1], l.forward[2]);

    // In vacuum only the ship is heard: the world's direct sound is shut off (its reverberation
    // already is, by the paths).
    glide(this.engine.dry.gain, f.space ? 0 : 1, t, 0.05);
    // The waking ear: muffled and faint until the eyes open, clearing over a few seconds.
    const wake = Math.min(Math.max((f.time - this.tl.scene1.wake + 0.8) / 3, 0), 1);
    const nyquist = this.ctx.sampleRate / 2;
    glide(this.engine.hearing.frequency, wake >= 1 ? nyquist : 320 * Math.pow(nyquist / 320, wake * wake), t, 0.05);
    glide(this.engine.hearingGain.gain, 0.25 + 0.75 * wake, t, 0.05);

    this.continuous(t, dt);
    this.events(t);
    // The machines dip under the voices.
    glide(this.machines.gain, this.speaking.size > 0 ? DUCK : 1, t, 0.25);
  }

  /** The loops: the cabin's hum, the engines' spool, the actuators while they move. */
  private continuous(t: number, dt: number): void {
    const s = this.frame.state;
    for (const v of this.ambient) {
      v.start(t);
      glide(v.gain.gain, L.ambient, t, 0.2);
    }
    // Spool: up in a second or so, down over several (the turbines run down).
    const toward = (cur: number, target: number) => cur + (target - cur) * (1 - Math.exp(-dt / (target > cur ? 1.1 : 3.4)));
    this.spool.main = toward(this.spool.main, s.main);
    this.spool.lift = toward(this.spool.lift, s.lift);
    const sm = this.spool.main;
    const sl = this.spool.lift;
    const roar = (v: LoopVoice, spool: number, level: number, bright = true) => {
      if (spool < 0.004) {
        if (v.src) {
          glide(v.gain.gain, 0, t, 0.2);
          v.stop(t + 1);
        }
        return;
      }
      if (!v.src) v.gain.gain.setValueAtTime(0, t);
      v.start(t, 0.7);
      glide(v.src!.playbackRate, 0.66 + 0.42 * spool, t, 0.1);
      glide(v.gain.gain, level * (0.04 + 0.96 * Math.pow(spool, 1.4)), t, 0.1);
      if (bright) glide(v.tone.frequency, 450 + 9000 * Math.pow(spool, 1.2), t, 0.1);
    };
    for (const v of this.mainRoar) roar(v, sm, L.main);
    for (const v of this.liftRoar) roar(v, sl, L.lift);
    // The floor passes only the lows, whatever the spool.
    roar(this.rumble, Math.max(sm, sl), L.rumble, false);
    for (const w of this.whines) w.set(900 + 1700 * sl, L.whine * Math.pow(sl, 1.2), t);

    // Actuators run while what they drive moves: its rate on the film's clock. The audio clock
    // advances in blocks, so between two frames it often had not moved (or moved twice): the rate
    // read 0, the loop stopped and restarted under its own tail every few frames, a crackle.
    // Held (no film time passed) or jumped (review), they are left as they are.
    const p = this.prev;
    const df = p ? this.frame.time - p.time : 0;
    const steady = df > 0 && df <= 1;
    const rate = (a: number, b: number) => Math.abs(a - b) / df;
    const run = (v: LoopVoice, moving: boolean, pitch: number, level: number = L.actuator, rise = 0.08, fall = 0.06) => {
      if (!steady) return;
      if (moving) {
        if (!v.src) v.gain.gain.setValueAtTime(0, t);
        v.start(t, pitch);
        glide(v.gain.gain, level, t, rise);
      } else if (v.src) {
        glide(v.gain.gain, 0, t, fall);
        v.stop(t + 0.4);
      }
    };
    const gearMoving = !!p && rate(s.gear, p.gear) > 0.02;
    this.gearRun.forEach((v, i) => run(v, gearMoving, i === 0 ? 1.45 : 1.3));
    run(this.doorRun, !!p && rate(s.door, p.door) > 0.05, 1.7);
    run(this.stairRun, !!p && rate(s.stair, p.stair) > 0.05, 1.35);
    // The leaf's roll on its track while it slides (the latter part of its motion).
    run(this.doorRoll, !!p && rate(s.door, p.door) > 0.05 && s.door > 1.1, 2.2, L.actuator * 0.6, 0.1, 0.08);
  }

  /** One-shots at the film's moments and the machines' end stops. */
  private events(t: number): void {
    const f = this.frame;
    const s = f.state;
    const now = f.time;
    const p = this.prev;
    // A jump in the film (review) re-arms without sounding its one-shots, and picks up a line
    // already under way from where it is.
    if (!p || now < p.time - 0.5 || now > p.time + 1) {
      this.prev = { time: now, door: s.door, stair: s.stair, gear: s.gear };
      if (!this.held) this.tl.lines.forEach((at, i) => {
        if (now > at && now < at + this.lines[i].duration) this.speak(i, t, now - at);
      });
      return;
    }
    const crossed = (at: number) => p.time < at && now >= at;
    const tl = this.tl;
    const pick = (list: AudioBuffer[]) => list[Math.floor(this.random() * list.length)];
    const vary = () => 0.94 + 0.12 * this.random();

    // The lines, from Aurelia's loudspeaker or the Guardian's mouth; the PA's chime before hers
    // that open an exchange.
    tl.lines.forEach((at, i) => {
      if (crossed(at)) this.speak(i, t, Math.max(0, now - at));
    });
    for (const i of [0, 2, 5]) if (crossed(tl.lines[i] - 1.0)) playInto(this.speaker, this.chime, t, L.ai * L.chime);

    // The avionics: a key on the monitor as the eye comes to it; the dash's tones as the descent
    // begins (two) and once the ship is down (one, lower).
    if (crossed(tl.scene1.monitor + 0.7)) playInto(this.monitor, this.confirm, t, L.tone);
    if (crossed(tl.scene2.hover)) {
      playInto(this.dash, this.confirm, t, L.tone);
      playInto(this.dash, this.confirm, t + 0.16, L.tone);
    }
    if (crossed(tl.scene2.touchdown + 1.6)) playInto(this.dash, this.confirmLow, t, L.tone);

    // Touchdown: the gear's blow through the floor, the pads on the deck.
    if (crossed(tl.scene2.touchdown)) {
      oneShot(this.floorIn, pick(this.impact), t, L.touchdown, 0.62 * vary());
      oneShot(this.floorIn, pick(this.shut), t + 0.015, L.touchdown * 0.5, 1.35 * vary());
      oneShot(this.noseIn, pick(this.latch), t + 0.04, L.latch, 1.05 * vary());
      for (const e of this.mains) playInto(e, pick(this.impact), t, L.pads, 0.55 * vary());
    }

    // The gear down and locked, or up.
    if ((p.gear < 0.999 && s.gear >= 0.999) || (p.gear > 0.001 && s.gear <= 0.001)) {
      oneShot(this.noseIn, pick(this.latch), t, L.latch, 1.2 * vary());
      for (const e of this.mains) playInto(e, pick(this.latch), t + 0.05 * this.random(), L.latch, 1.1 * vary());
    }

    // The door: unlatching and its seal breaking; its open stop; its shut.
    if (p.door <= 0 && s.door > 0) {
      playInto(this.door, pick(this.latch), t, L.latch, 1.3 * vary());
      this.seal(t + 0.12);
    }
    if (p.door < DOOR_TIME && s.door >= DOOR_TIME) playInto(this.door, pick(this.stop), t, L.actuator * 1.4, 1.5 * vary());
    if (p.door > 0 && s.door <= 0) {
      playInto(this.door, pick(this.shut), t, L.latch * 0.5, 1.9 * vary());
      playInto(this.door, pick(this.latch), t + 0.08, L.latch, 1.3 * vary());
    }
    // The stair at its stops: out and down (its feet meeting the deck), and stowed.
    if (p.stair < STAIR_TIME && s.stair >= STAIR_TIME) {
      playInto(this.stair, pick(this.latch), t, L.latch, 0.9 * vary());
      playInto(this.stair, pick(this.impact), t, L.pads * 0.4, 0.8 * vary());
    }
    if (p.stair > 0 && s.stair <= 0) playInto(this.stair, pick(this.latch), t, L.latch, 1.0 * vary());

    p.time = now;
    p.door = s.door;
    p.stair = s.stair;
    p.gear = s.gear;
  }

  /** Line i from Aurelia's loudspeaker or the Guardian's mouth, `offset` s in. */
  private speak(i: number, t: number, offset: number): void {
    const ai = SPEAKER[i] === 'ai';
    const src = new AudioBufferSourceNode(this.ctx, { buffer: this.lines[i] });
    const g = new GainNode(this.ctx, { gain: ai ? L.ai : L.voice });
    src.connect(g).connect(ai ? this.speakerIn : this.mouthIn);
    this.speaking.add(src);
    src.onended = () => {
      g.disconnect();
      this.speaking.delete(src);
    };
    src.start(t, offset);
  }

  /**
   * The film jumped or was held (review, intro/review.ts): the lines under way stop, and the next
   * update re-arms from where the film is (unless held: then nothing speaks until it runs again).
   */
  resync(held: boolean): void {
    const t = this.ctx.currentTime;
    for (const src of this.speaking) src.stop(t + 0.03);
    this.speaking.clear();
    this.prev = null;
    this.held = held;
  }

  /** The door's seal breaking: the cabin's air out through the crack, a hiss falling off. */
  private seal(t: number): void {
    const ctx = this.ctx;
    const src = new AudioBufferSourceNode(ctx, { buffer: this.engine.noise, loop: true });
    const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 1800, Q: 0.7 });
    const pk = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 5200, Q: 1.2, gain: 8 });
    const g = new GainNode(ctx, { gain: 0 });
    src.connect(hp).connect(pk).connect(g).connect(this.door.input);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(L.seal, t + 0.03);
    g.gain.setTargetAtTime(0, t + 0.05, 0.35);
    pk.frequency.setValueAtTime(5200, t);
    pk.frequency.setTargetAtTime(3200, t + 0.05, 0.5);
    src.start(t, this.random() * 5);
    src.stop(t + 2.5);
    src.onended = () => g.disconnect();
  }

  /** Stops every voice and takes the intro's emitters out of the engine. */
  dispose(): void {
    const t = this.ctx.currentTime;
    for (const v of this.loops) v.stop(t);
    for (const w of this.whines) w.stop();
    for (const p of this.placed) p.emitter.dispose();
    this.out.disconnect();
    this.machines.disconnect();
    this.engine.hearing.frequency.cancelScheduledValues(t);
    this.engine.hearing.frequency.setValueAtTime(this.ctx.sampleRate / 2, t);
    this.engine.hearingGain.gain.cancelScheduledValues(t);
    this.engine.hearingGain.gain.setValueAtTime(1, t);
    this.engine.dry.gain.cancelScheduledValues(t);
    this.engine.dry.gain.setValueAtTime(1, t);
    if (this.engine.cabin) this.engine.cabin = null;
    this.engine.listenerGlide = 0.02;
  }
}

/**
 * Within this distance (m) of the listener a source feeds the band's reverberation in full; beyond
 * it, falling as 1/d with its direct sound. The band's reverberation is the open deck's faint
 * scatter about the listener, not a room: a ship a kilometre off scatters next to nothing back.
 */
const BAND_SCATTER = 15;

/** How far the machines dip while a line is spoken. */
const DUCK = 0.5;

/** A structure-borne path into an emitter: a low-pass for what the structure passes, and its loss. */
function structural(ctx: BaseAudioContext, into: AudioNode, cutoff: number, gain: number): AudioNode {
  const g = new GainNode(ctx, { gain });
  g.connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: cutoff, Q: 0.7 })).connect(into);
  return g;
}

/** A buffer into a node at t (gain, playback rate); disconnects itself when done. */
function oneShot(into: AudioNode, buffer: AudioBuffer, t: number, gain: number, rate: number): void {
  const src = new AudioBufferSourceNode(into.context, { buffer, playbackRate: rate });
  const g = new GainNode(into.context, { gain });
  src.connect(g).connect(into);
  src.onended = () => g.disconnect();
  src.start(t);
}

const V = new Vector3();
const A = new Vector3();
