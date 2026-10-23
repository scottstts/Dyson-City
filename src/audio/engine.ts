/**
 * The audio engine: one context, the listener, the four spaces' reverberation, and the emitters
 * (docs/audio.md). Works on any BaseAudioContext, so the offline preview tool renders exactly what
 * the game plays. All timing is explicit (`t`), never read from the context inside updates.
 */
import { OPEN_PATH, SPEED_OF_SOUND, transmission, wallDistance, zoneAt, ZONES, type CabinState, type Path, type Zone } from './acoustics';
import { glide } from './params';
import type { Emitter } from './emitter';
import type { AudioBank } from './bank';

/** Where the ears are and what the spaces between them and the sounds are doing. */
export interface ListenerState {
  x: number;
  y: number;
  z: number;
  /** Unit forward and up vectors of the head. */
  forward: [number, number, number];
  up: [number, number, number];
  zone: Zone;
  /** Gate openness (0..1) and chamber pressure (bar), for paths and the medium. */
  outerOpen: number;
  innerOpen: number;
  bar: number;
  /** The house's outer doors: the widest open leaf (0..1). */
  houseOpen: number;
  /** The intro's ship: its door's openness and whether it is in vacuum (acoustics.ts transmission). */
  cabin: CabinState;
}

/** Amplitude of the drum's/gatehouse's slap echo relative to the direct sound at 1 m, per metre of distance. */
const WALL_REFLECTION = 0.8;
const MAX_SLAP = 3.9;

interface ZoneBus {
  input: GainNode;
  ret: GainNode;
  retFilter: BiquadFilterNode;
  /** Fed per emitter (its own send, weighted by its distance), not from `input`. */
  slap?: { input: GainNode; delay: DelayNode; gain: GainNode };
}

export class AudioEngine {
  readonly ctx: BaseAudioContext;
  /** Direct sound from every emitter, already spatialised. */
  readonly dry: GainNode;
  /** Everything before the output protection; pause fades this. */
  readonly master: GainNode;
  /**
   * The listener's own hearing, after everything: transparent (a low-pass at the Nyquist rate, unity
   * gain) except while the intro's Guardian wakes, muffled and faint (intro/audio/sounds.ts).
   */
  readonly hearing: BiquadFilterNode;
  readonly hearingGain: GainNode;
  /** Shared white noise (6 s) for continuous voices; each voice loops it from its own offset. */
  readonly noise: AudioBuffer;
  private readonly buses: Record<Zone, ZoneBus>;
  private readonly emitters: Emitter[] = [];
  private listenerFirst = true;
  private readonly slapPaths: Record<Zone, number> = { outside: 0, chamber: 0, city: 0, house: 0, cabin: 0 };
  /** Each zone's path to the listener this frame: the same for every emitter radiating into it. */
  private readonly paths: Record<Zone, Readonly<Path>> = { outside: OPEN_PATH, chamber: OPEN_PATH, city: OPEN_PATH, house: OPEN_PATH, cabin: OPEN_PATH };
  /** Is a world point inside the house's rooms? (Set once the house is known.) */
  interior: ((x: number, y: number, z: number) => boolean) | null = null;
  /**
   * Time constant (s) of the listener's position and orientation smoothing. The intro sets it to 0
   * while the listener rides its ship, with the sounds carried with it (emitter.ts `glide`).
   */
  listenerGlide = 0.02;
  /** Is a world point inside the intro's ship's cabin? (Set while the intro runs.) */
  cabin: ((x: number, y: number, z: number) => boolean) | null = null;

  /** The synthesised samples (bank.ts), at the context's rate. */
  readonly bank: AudioBank;

  constructor(ctx: BaseAudioContext, bank: AudioBank) {
    if (bank.sampleRate !== ctx.sampleRate) throw new Error(`Audio bank is at ${bank.sampleRate} Hz, the context at ${ctx.sampleRate} Hz`);
    this.ctx = ctx;
    this.bank = bank;
    this.master = ctx.createGain();
    // Output protection: a soft limiter for the gate's landings, transparent below.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 8;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.25;
    this.hearing = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: ctx.sampleRate / 2, Q: Math.SQRT1_2 });
    this.hearingGain = ctx.createGain();
    this.master.connect(this.hearing).connect(this.hearingGain).connect(limiter).connect(ctx.destination);
    this.dry = ctx.createGain();
    this.dry.connect(this.master);

    this.noise = this.buffer(bank.noise);

    const buses = {} as Record<Zone, ZoneBus>;
    for (const zone of ZONES) {
      const input = ctx.createGain();
      const retFilter = ctx.createBiquadFilter();
      retFilter.type = 'lowpass';
      retFilter.Q.value = 0.5;
      const ret = ctx.createGain();
      retFilter.connect(ret).connect(this.master);
      const conv = ctx.createConvolver();
      conv.normalize = false;
      const [l, r] = bank.irs[zone];
      const ir = ctx.createBuffer(2, l.length, ctx.sampleRate);
      ir.copyToChannel(l as Float32Array<ArrayBuffer>, 0);
      ir.copyToChannel(r as Float32Array<ArrayBuffer>, 1);
      conv.buffer = ir;
      input.connect(conv).connect(retFilter);
      const bus: ZoneBus = { input, ret, retFilter };
      if (zone === 'outside' || zone === 'city') {
        // The nearest big face (the drum, the gatehouse) returns a slap that moves with the listener.
        const slapIn = ctx.createGain();
        const delay = ctx.createDelay(MAX_SLAP + 0.1);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 4000;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        slapIn.connect(delay).connect(lp).connect(gain).connect(retFilter);
        bus.slap = { input: slapIn, delay, gain };
      }
      buses[zone] = bus;
    }
    this.buses = buses;
  }

  /** A mono buffer of samples at the context's rate. */
  buffer(samples: Float32Array): AudioBuffer {
    const b = this.ctx.createBuffer(1, samples.length, this.ctx.sampleRate);
    b.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    return b;
  }

  /** The space a world point is in: the intro's ship's cabin, the house's rooms, or the plan's zones. */
  locate(x: number, y: number, z: number): Zone {
    if (this.cabin?.(x, y, z)) return 'cabin';
    return this.interior?.(x, y, z) ? 'house' : zoneAt(x, z);
  }

  zoneInput(zone: Zone): AudioNode {
    return this.buses[zone].input;
  }

  /** The input of a zone's slap echo (the outside and the city have one). */
  slapInput(zone: Zone): AudioNode | null {
    return this.buses[zone].slap?.input ?? null;
  }

  /** The path from a zone to the listener this frame (acoustics.ts transmission; set by update). */
  path(zone: Zone): Readonly<Path> {
    return this.paths[zone];
  }

  /** The slap's path this frame (m): out to the listener's nearest big face and back (acoustics.ts slapShare). */
  slapPath(zone: Zone): number {
    return this.slapPaths[zone];
  }

  addEmitter(e: Emitter): void {
    this.emitters.push(e);
  }

  /** Takes an emitter out of the frame's updates (a sound that exists only for a while: the intro's). */
  removeEmitter(e: Emitter): void {
    const i = this.emitters.indexOf(e);
    if (i >= 0) this.emitters.splice(i, 1);
  }

  /** Per frame: moves the ears, re-derives every emitter's path and the spaces' returns. */
  update(l: ListenerState, t: number): void {
    const L = this.ctx.listener;
    const tc = this.listenerFirst ? 0 : this.listenerGlide;
    glide(L.positionX, l.x, t, tc);
    glide(L.positionY, l.y, t, tc);
    glide(L.positionZ, l.z, t, tc);
    glide(L.forwardX, l.forward[0], t, tc);
    glide(L.forwardY, l.forward[1], t, tc);
    glide(L.forwardZ, l.forward[2], t, tc);
    glide(L.upX, l.up[0], t, tc);
    glide(L.upY, l.up[1], t, tc);
    glide(L.upZ, l.up[2], t, tc);
    this.listenerFirst = false;

    for (const zone of ZONES) {
      const bus = this.buses[zone];
      const p = transmission(zone, l.zone, l.outerOpen, l.innerOpen, l.houseOpen, l.cabin);
      this.paths[zone] = p;
      glide(bus.ret.gain, p.gain, t, 0.05);
      glide(bus.retFilter.frequency, p.cutoff, t, 0.05);
      if (bus.slap) {
        const d = wallDistance(zone, l.x, l.z);
        this.slapPaths[zone] = 2 * d;
        glide(bus.slap.delay.delayTime, Math.min((2 * d) / SPEED_OF_SOUND, MAX_SLAP), t, 0.3);
        glide(bus.slap.gain.gain, WALL_REFLECTION / (2 * d), t, 0.1);
      }
    }
    for (const e of this.emitters) e.update(l, t);
  }
}
