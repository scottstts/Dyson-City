/**
 * The estate's trees rustling in the breeze (docs/audio.md "The estate"). Each
 * rustle comes from a crown: two voices go to the crowns nearest the listener (within reach), each
 * spreading 1/d beyond its crown's radius. A voice whose tree is no longer among the nearest fades
 * out before it moves to the tree that is. There is no estate-wide bed.
 */
import { Emitter } from '../emitter';
import type { AudioEngine, ListenerState } from '../engine';
import { LEVEL } from '../mix';
import { rng } from '../dsp';

export interface AudioCrown {
  readonly centre: readonly [number, number, number];
  readonly radius: number;
}

const VOICES = 2;
/** Beyond this from a crown's edge (m) its rustle is below the Dome's quiet. */
const REACH = 60;
const FADE = 0.4;

interface Voice {
  emitter: Emitter;
  level: GainNode;
  tree: number;
  /** Context time from which the voice may move to another tree. */
  freeAt: number;
}

export class EstateSounds {
  private readonly crowns: readonly AudioCrown[];
  private readonly voices: Voice[] = [];
  private readonly near: number[] = [];

  constructor(engine: AudioEngine, crowns: readonly AudioCrown[]) {
    this.crowns = crowns;
    const r = rng(0x7aee);
    const buffer = engine.buffer(engine.bank.rustle);
    for (let i = 0; i < VOICES; i++) {
      // A crown is a broad source: equal-power panning is enough, and keeps the HRTF voices for points.
      const emitter = new Emitter(engine, { name: `estate.rustle.${i}`, zones: ['city'], refDistance: 4, simplePanning: true });
      const level = new GainNode(engine.ctx, { gain: 0 });
      level.connect(emitter.input);
      // Each voice runs its own loop from its own point, a hair off speed: two trees never in step.
      const src = new AudioBufferSourceNode(engine.ctx, { buffer, loop: true, playbackRate: 0.96 + 0.08 * r() });
      src.connect(level);
      src.start(0, r() * buffer.duration);
      this.voices.push({ emitter, level, tree: -1, freeAt: 0 });
    }
  }

  update(t: number, l: ListenerState): void {
    // The nearest crowns within reach, nearest first.
    this.near.length = 0;
    const dist = (i: number) => {
      const c = this.crowns[i];
      return Math.hypot(c.centre[0] - l.x, c.centre[1] - l.y, c.centre[2] - l.z) - c.radius;
    };
    for (let i = 0; i < this.crowns.length; i++) {
      if (dist(i) > REACH) continue;
      this.near.push(i);
    }
    this.near.sort((a, b) => dist(a) - dist(b));
    this.near.length = Math.min(this.near.length, VOICES);
    // Voices keep their trees while those stay near; the others fade, then take the trees left.
    for (const v of this.voices) {
      if (v.tree >= 0 && !this.near.includes(v.tree)) {
        v.level.gain.setTargetAtTime(0, t, FADE / 4);
        v.tree = -1;
        v.freeAt = t + FADE;
      }
    }
    for (const tree of this.near) {
      if (this.voices.some((v) => v.tree === tree)) continue;
      const v = this.voices.find((x) => x.tree < 0 && t >= x.freeAt);
      if (!v) break;
      const c = this.crowns[tree];
      v.tree = tree;
      v.emitter.setPosition(c.centre[0], c.centre[1], c.centre[2]);
      v.emitter.setRefDistance(c.radius);
      v.level.gain.setTargetAtTime(LEVEL.rustle, t, FADE / 3);
    }
  }
}
