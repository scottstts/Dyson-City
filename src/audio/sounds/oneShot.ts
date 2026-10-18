/** Plays sample buffers into emitters, with the small variation every real repeat has. */
import type { Emitter } from '../emitter';

/**
 * Starts `buffer` at time t (from `offset` seconds into it) into `emitter` with a gain and a
 * playback-rate factor. The source and its gain disconnect themselves when done.
 */
export function playInto(emitter: Emitter, buffer: AudioBuffer, t: number, gain: number, rate = 1, offset = 0): AudioBufferSourceNode {
  const ctx = emitter.input.context;
  const src = new AudioBufferSourceNode(ctx, { buffer, playbackRate: rate });
  const g = new GainNode(ctx, { gain });
  src.connect(g).connect(emitter.input);
  src.onended = () => g.disconnect();
  src.start(t, offset);
  return src;
}

/**
 * Picks one of `n` variants, never one of the last `memory` picks (at most n − 1 of them). Memory 1
 * never plays the same twice in a row; a longer one keeps a run of steps from settling into a cycle.
 */
export class VariantPicker {
  private readonly recent: number[] = [];
  private readonly random: () => number;
  private readonly memory: number;
  constructor(random: () => number, memory = 1) {
    this.random = random;
    this.memory = memory;
  }
  pick(n: number): number {
    if (n <= 1) return 0;
    const recent = this.recent.filter((v) => v < n).slice(-Math.min(this.memory, n - 1));
    let i = Math.floor(this.random() * (n - recent.length));
    // The i-th variant not among the recent ones.
    for (const v of [...recent].sort((p, q) => p - q)) if (i >= v) i++;
    this.recent.push(i);
    if (this.recent.length > this.memory) this.recent.shift();
    return i;
  }
}
