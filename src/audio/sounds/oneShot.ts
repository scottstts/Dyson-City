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

/** Picks one of `n` variants, never the same twice in a row. */
export class VariantPicker {
  private last = -1;
  private readonly random: () => number;
  constructor(random: () => number) {
    this.random = random;
  }
  pick(n: number): number {
    if (n <= 1) return 0;
    let i: number;
    if (this.last < 0 || this.last >= n) i = Math.floor(this.random() * n);
    else {
      i = Math.floor(this.random() * (n - 1));
      if (i >= this.last) i++;
    }
    this.last = i;
    return i;
  }
}
