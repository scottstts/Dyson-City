/**
 * The terminal's narration (docs/terminal.md, docs/terminal-narration.md): the user's recordings
 * T1–T6 in public/speeches/, like the announcements the one kind of sound that ships as a
 * recording. They are fetched and decoded after boot, in the background (boot does not wait for
 * them; the player needs a minute to walk to the terminal), each scaled to a peak of 1. Each one's
 * loudness envelope is kept for the screen's message view.
 */
import { NARRATION, type ClipId } from '../terminal/os/cues';

/** Envelope bins per recording. */
const PEAK_BINS = 360;

export class NarrationClips {
  private readonly buffers = new Map<ClipId, AudioBuffer>();
  private readonly envelopes = new Map<ClipId, Float32Array>();
  private started = false;

  /** Starts loading (once). Failures are logged and leave that recording silent: the screen still works. */
  load(ctx: BaseAudioContext): void {
    if (this.started) return;
    this.started = true;
    for (const id of Object.keys(NARRATION) as ClipId[]) {
      void this.fetch(ctx, id).catch((e: unknown) => console.warn(`[Dyson] narration ${id} could not load`, e));
    }
  }

  get(id: ClipId): AudioBuffer | null {
    return this.buffers.get(id) ?? null;
  }

  /** The recording's loudness over time (0..1), or null until it is loaded. */
  peaks = (id: ClipId): Float32Array | null => this.envelopes.get(id) ?? null;

  private async fetch(ctx: BaseAudioContext, id: ClipId): Promise<void> {
    const url = `${import.meta.env.BASE_URL}speeches/${id}.mp3`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
    const d = buffer.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    if (peak > 0) for (let c = 0; c < buffer.numberOfChannels; c++) {
      const x = buffer.getChannelData(c);
      for (let i = 0; i < x.length; i++) x[i] /= peak;
    }
    // RMS per bin, scaled so the loudest bin is 1.
    const env = new Float32Array(PEAK_BINS);
    const per = Math.max(1, Math.floor(d.length / PEAK_BINS));
    let top = 0;
    for (let b = 0; b < PEAK_BINS; b++) {
      let s = 0;
      for (let i = b * per; i < Math.min(d.length, (b + 1) * per); i++) s += d[i] * d[i];
      env[b] = Math.sqrt(s / per);
      top = Math.max(top, env[b]);
    }
    if (top > 0) for (let b = 0; b < PEAK_BINS; b++) env[b] = Math.min(1, env[b] / top);
    this.buffers.set(id, buffer);
    this.envelopes.set(id, env);
  }
}
