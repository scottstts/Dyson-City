/**
 * The announcements' voices (docs/audio.md, "Announcements"). Each is a loudspeaker in the world,
 * played through a pooled emitter like any other source: delayed, spread, dulled by the air,
 * through the paths between the spaces, into the reverberation of the space it is in, and placed
 * at the ears by HRTF. Where it sounds from:
 *
 *  - the gate's PA, on the head over the outer gate, facing the band (enter-dome, exit);
 *  - the chamber's speaker, high on its middle (pressurization, depressurization);
 *  - the main portal's arch (enter-compound);
 *  - the car's cabin, moving with it (drive);
 *  - beside the listener, moving with them (enter-estate, aircraft-perimeter): a speaker an arm's
 *    length off ahead and to the right where it began, so turning the head still places it.
 *
 * Two voices: a recording already playing is not started again, and a third announcement takes
 * the voice that would finish first.
 */
import { Emitter, type Directivity } from '../emitter';
import type { AudioEngine, ListenerState } from '../engine';
import { DOME_SEND, LEVEL } from '../mix';
import { playInto } from './oneShot';
import type { Speech, SpeechClips } from '../loadSpeech';
import { GATE } from '../../city/gate/spec';
import { FIELD_Y, CORDON } from '../../field/layout';
import { PORTAL_ARCH } from '../../field/cordon';
import { PAD_HEIGHT } from '../../ground/site';

type Vec = [number, number, number];

/** Where an announcement sounds from. */
type Anchor = 'gate' | 'chamber' | 'portal' | 'car' | 'near';

const ANCHOR: Record<Speech, Anchor> = {
  'enter-dome': 'gate',
  exit: 'gate',
  pressurization: 'chamber',
  depressurization: 'chamber',
  'enter-compound': 'portal',
  drive: 'car',
  'enter-estate': 'near',
  'aircraft-perimeter': 'near',
};

/** A loudspeaker's size (m): its level is the level here. */
const REF: Record<Anchor, number> = { gate: 2, chamber: 1.5, portal: 2, car: 1, near: 0.5 };
/** The gate's PA horns face the band: quieter and duller behind. */
const GATE_HORN: Directivity = { axis: [-1, 0, 0], rear: 0.35, rearCutoff: 1800 };
/** Under the Dome they feed its reverberation without its lift, as the craft does (mix.ts). */
const SEND: Record<Anchor, number> = { gate: 1, chamber: 1, portal: DOME_SEND, car: DOME_SEND, near: DOME_SEND };

/** Fixed places: just west of the outer lip, over the opening; the chamber's middle; the portal's arch below its crown. */
const GATE_PA: Vec = [GATE.outerLipX - 0.6, GATE.clearTop + 1.2, 0];
const CHAMBER_PA: Vec = [(GATE.outerLipX + GATE.innerLipX) / 2, 12, 0];
const PORTAL_PA: Vec = [CORDON.frontX, FIELD_Y + PORTAL_ARCH.spring, 0];
/** The cabin's height over the pad, and the listener's speaker: distance, bearing right of ahead, below the ears. */
const CABIN_Y = PAD_HEIGHT + 0.9;
const NEAR = { d: 1.2, bearing: 0.6, drop: 0.25 } as const;

/** What the voices follow. */
export interface SpeechTargets {
  car: { readonly state: { x: number; z: number } } | null;
}

interface Voice {
  emitter: Emitter;
  speech: Speech | null;
  src: AudioBufferSourceNode | null;
  end: number;
  /** For 'near': the speaker's offset from the ears, set when it begins. */
  offset: Vec;
}

export class SpeechSounds {
  private readonly voices: Voice[];
  private readonly clips: SpeechClips;
  private readonly targets: SpeechTargets;

  constructor(engine: AudioEngine, clips: SpeechClips, targets: SpeechTargets) {
    this.clips = clips;
    this.targets = targets;
    this.voices = [0, 1].map((i) => ({
      emitter: new Emitter(engine, { name: `speech-${i}`, zones: 'located', refDistance: 1 }),
      speech: null,
      src: null,
      end: 0,
      offset: [0, 0, 0],
    }));
  }

  play(speech: Speech, t: number, l: ListenerState): void {
    if (this.voices.some((v) => v.speech === speech && v.end > t)) return;
    const voice = this.voices.reduce((a, b) => (a.end <= b.end ? a : b));
    voice.src?.stop(t);
    const anchor = ANCHOR[speech];
    const buffer = this.clips[speech];
    voice.speech = speech;
    voice.end = t + buffer.duration;
    voice.emitter.setRefDistance(REF[anchor]);
    voice.emitter.revoice(SEND[anchor], anchor === 'gate' ? GATE_HORN : undefined);
    if (anchor === 'near') {
      // Ahead of the head in plan, turned to the right (+right is forward × up).
      const fx = l.forward[0];
      const fz = l.forward[2];
      const n = Math.hypot(fx, fz) || 1;
      const c = Math.cos(NEAR.bearing);
      const s = Math.sin(NEAR.bearing);
      voice.offset[0] = NEAR.d * ((fx / n) * c - (fz / n) * s);
      voice.offset[1] = -NEAR.drop;
      voice.offset[2] = NEAR.d * ((fz / n) * c + (fx / n) * s);
    }
    this.place(voice, l);
    voice.src = playInto(voice.emitter, buffer, t, LEVEL.speech[anchor]);
  }

  /** Per frame, before the engine's update: the moving speakers follow the car and the listener. */
  update(t: number, l: ListenerState): void {
    for (const v of this.voices) {
      if (!v.speech) continue;
      if (v.end + 2.5 < t) {
        // Done (with the propagation delay's tail): free for the next.
        v.speech = null;
        v.src = null;
        continue;
      }
      this.place(v, l);
    }
  }

  private place(v: Voice, l: ListenerState): void {
    const e = v.emitter;
    switch (ANCHOR[v.speech!]) {
      case 'gate':
        e.setPosition(...GATE_PA);
        break;
      case 'chamber':
        e.setPosition(...CHAMBER_PA);
        break;
      case 'portal':
        e.setPosition(...PORTAL_PA);
        break;
      case 'car': {
        const car = this.targets.car;
        if (car) e.setPosition(car.state.x, CABIN_Y, car.state.z);
        break;
      }
      case 'near':
        e.setPosition(l.x + v.offset[0], l.y + v.offset[1], l.z + v.offset[2]);
        break;
    }
  }
}
