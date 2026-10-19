/**
 * Emitter: the only way a sound reaches the listener (docs/audio.md). Every sound in the game,
 * footsteps included, is radiated from a point in the world by an emitter, which applies, per
 * frame:
 *
 *  - propagation delay d/c (a gate seen landing 80 m away is heard a quarter-second later; moving
 *    sources Doppler-shift naturally);
 *  - spherical spreading (1/d beyond the source's own size, `refDistance`);
 *  - air absorption over d (a low-pass, stronger in the band's thin air);
 *  - the path from the zone(s) it radiates into to the listener's zone (a shut leaf or the Dome's
 *    glass passes only a low rumble);
 *  - the medium it radiates into (0.55 bar outside: 5 dB quieter);
 *  - its directivity: off its axis a source is quieter and duller (highs beam, lows do not);
 *  - direction at the ears (HRTF panning: azimuth, elevation, head shadow).
 *
 * It also excites the reverberation of the zones it radiates into (a diffuse field: independent of
 * where the listener stands in that zone). Nothing bypasses this to play "2D".
 */
import type { AudioEngine, ListenerState } from './engine';
import { airCutoff, mediumFactor, slapShare, SPEED_OF_SOUND, ZONES, type Zone } from './acoustics';
import { glide } from './params';

export interface Directivity {
  /** Unit vector the source radiates along most strongly (world frame). */
  axis: [number, number, number];
  /** Broadband gain at the rear (180° off axis). 1 = omnidirectional. */
  rear: number;
  /** Low-pass cutoff (Hz) at the rear: the highs a source sends backward. */
  rearCutoff: number;
  /** Radiates equally from both faces (a plate, a leaf): the axis' sign does not matter. */
  dipole?: boolean;
}

export interface EmitterOptions {
  name: string;
  /**
   * The zone(s) it radiates into (a leaf radiates into both spaces it divides), or 'located' for a
   * source that moves between spaces (the feet): the zone its position is in.
   */
  zones: readonly Zone[] | 'located';
  /** Size of the source (m): spreading loss starts beyond it. The input level is the level here. */
  refDistance: number;
  /** Reverb send relative to the direct sound at 1 m (1 = physical diffuse-field level). */
  send?: number;
  /**
   * Per frame, a further factor on the send into each zone (default 1). The house's sounds use it
   * to feed their reverb at their level at 1 m (the input is the level at `refDistance`) and only
   * into the room they are in (sounds/house.ts).
   */
  sendScale?: (zone: Zone) => number;
  directivity?: Directivity;
  /** Equal-power instead of HRTF panning, for small, numerous sources. */
  simplePanning?: boolean;
  /** Where the direct sound arrives at the ears (default the engine's dry bus). */
  out?: AudioNode;
}

const MAX_DELAY = 2.5;

export class Emitter {
  /** Connect the sound here; its level is the level at `refDistance`. */
  readonly input: GainNode;
  readonly name: string;
  readonly position: [number, number, number] = [0, 0, 0];
  private readonly zones: readonly Zone[] | 'located';
  private readonly delay: DelayNode;
  private readonly lowpass: BiquadFilterNode;
  private readonly gain: GainNode;
  private readonly panner: PannerNode;
  /** Per zone: the reverb send, and the slap send where the zone has a slap. */
  private readonly sends: { zone: Zone; gain: GainNode; slap: GainNode | null }[];
  private readonly sendLevel: number;
  private readonly sendScale: ((zone: Zone) => number) | undefined;
  private readonly directivity: Directivity | undefined;
  private readonly engine: AudioEngine;
  private first = true;
  /** The zone a 'located' source is in this frame (reused). */
  private readonly located: Zone[] = ['outside'];

  constructor(engine: AudioEngine, opts: EmitterOptions) {
    const ctx = engine.ctx;
    this.engine = engine;
    this.name = opts.name;
    this.zones = opts.zones;
    this.directivity = opts.directivity ? { ...opts.directivity, axis: [...opts.directivity.axis] } : undefined;
    this.sendLevel = opts.send ?? 1;
    this.sendScale = opts.sendScale;
    this.input = ctx.createGain();
    this.delay = ctx.createDelay(MAX_DELAY);
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.Q.value = 0.5;
    this.gain = ctx.createGain();
    this.panner = new PannerNode(ctx, {
      panningModel: opts.simplePanning ? 'equalpower' : 'HRTF',
      distanceModel: 'inverse',
      refDistance: opts.refDistance,
      rolloffFactor: 1,
      maxDistance: 20000,
    });
    this.input.connect(this.delay).connect(this.lowpass).connect(this.gain).connect(this.panner).connect(opts.out ?? engine.dry);
    this.sends = (opts.zones === 'located' ? ZONES : opts.zones).map((zone) => {
      const g = ctx.createGain();
      g.gain.value = 0;
      this.delay.connect(g).connect(engine.zoneInput(zone));
      const slapIn = engine.slapInput(zone);
      let slap: GainNode | null = null;
      if (slapIn) {
        slap = ctx.createGain();
        slap.gain.value = 0;
        this.delay.connect(slap).connect(slapIn);
      }
      return { zone, gain: g, slap };
    });
    engine.addEmitter(this);
  }

  setPosition(x: number, y: number, z: number): void {
    this.position[0] = x;
    this.position[1] = y;
    this.position[2] = z;
  }

  /** The source's size (spreading begins beyond it), for an emitter that voices different sources in turn. */
  setRefDistance(r: number): void {
    this.panner.refDistance = r;
  }

  /** Turns the directivity axis (unit vector) with a moving source. */
  setAxis(x: number, y: number, z: number): void {
    if (!this.directivity) return;
    this.directivity.axis[0] = x;
    this.directivity.axis[1] = y;
    this.directivity.axis[2] = z;
  }

  /** Per frame: re-derives every path term for the listener. */
  update(l: ListenerState, t: number): void {
    const [x, y, z] = this.position;
    const dx = l.x - x;
    const dy = l.y - y;
    const dz = l.z - z;
    const d = Math.max(Math.hypot(dx, dy, dz), 0.05);

    // The loudest path from any zone the source radiates into.
    let zones = this.zones;
    if (zones === 'located') {
      this.located[0] = this.engine.locate(x, y, z);
      zones = this.located;
    }
    // Each zone's path to the listener is the engine's, derived once this frame.
    let pathGain = 0;
    let pathCutoff = 20;
    let medium = 0;
    for (const zone of zones) {
      const p = this.engine.path(zone);
      const m = mediumFactor(zone, l.bar);
      if (p.gain * m > pathGain * medium) {
        pathGain = p.gain;
        pathCutoff = p.cutoff;
        medium = m;
      }
    }

    let dirGain = 1;
    let dirCutoff = 20000;
    const dv = this.directivity;
    if (dv) {
      // cos of the angle between the source's axis and the direction to the listener.
      let c = (dv.axis[0] * dx + dv.axis[1] * dy + dv.axis[2] * dz) / d;
      if (dv.dipole) c = Math.abs(c);
      const off = (1 - c) / 2; // 0 on axis, 1 at the rear
      dirGain = 1 - (1 - dv.rear) * off;
      dirCutoff = 20000 * Math.pow(dv.rearCutoff / 20000, off);
    }

    const cutoff = Math.min(pathCutoff, airCutoff(l.zone, d), dirCutoff);
    const tc = this.first ? 0 : 0.04;
    glide(this.panner.positionX, x, t, tc);
    glide(this.panner.positionY, y, t, tc);
    glide(this.panner.positionZ, z, t, tc);
    glide(this.delay.delayTime, Math.min(d / SPEED_OF_SOUND, MAX_DELAY), t, this.first ? 0 : 0.08);
    glide(this.lowpass.frequency, cutoff, t, tc);
    glide(this.gain.gain, pathGain * medium * dirGain, t, tc);
    for (const s of this.sends) {
      let g = zones.includes(s.zone) ? (this.sendLevel * mediumFactor(s.zone, l.bar)) / zones.length : 0;
      if (g > 0 && this.sendScale) g *= this.sendScale(s.zone);
      glide(s.gain.gain, g, t, tc);
      // The slap off the listener's nearest face. Fed from the bus alone, a craft across the Dome
      // slapped off the glass by the listener as loud as one 50 m away, ~20 dB over its direct sound.
      if (s.slap) glide(s.slap.gain, g * slapShare(this.engine.slapPath(s.zone), d), t, tc);
    }
    this.first = false;
  }
}
