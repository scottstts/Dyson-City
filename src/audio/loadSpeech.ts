/**
 * The announcements (docs/audio.md, "Announcements"): the user's spoken recordings in
 * public/speeches/, the one kind of sound that ships as a recording. They are fetched and decoded
 * at boot (at the context's rate) and each is scaled to a peak of 1, so `LEVEL.speech` is the peak
 * at the loudspeaker, as every other level is the level at its source.
 */
import type { AirlockCue } from '../city/gate/airlock';

export const SPEECHES = ['enter-dome', 'pressurization', 'depressurization', 'exit', 'enter-estate', 'enter-compound', 'drive', 'aircraft-perimeter'] as const;
export type Speech = (typeof SPEECHES)[number];
export type SpeechClips = Record<Speech, AudioBuffer>;

/** Which recording the West Gate's airlock announces each step with. */
export const AIRLOCK_SPEECH: Record<AirlockCue, Speech> = {
  enter: 'enter-dome',
  pressurize: 'pressurization',
  depressurize: 'depressurization',
  exit: 'exit',
};

async function load(ctx: BaseAudioContext, name: Speech): Promise<AudioBuffer> {
  const url = `${import.meta.env.BASE_URL}speeches/${name}.mp3`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Announcement ${url}: HTTP ${res.status}`);
  const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) for (const v of buffer.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] /= peak;
  }
  return buffer;
}

export async function loadSpeech(ctx: BaseAudioContext): Promise<SpeechClips> {
  const buffers = await Promise.all(SPEECHES.map((name) => load(ctx, name)));
  return Object.fromEntries(SPEECHES.map((name, i) => [name, buffers[i]])) as SpeechClips;
}

/** The airlock waits out each announcement (city/gate/airlock.ts): their lengths (s). */
export function airlockAnnouncements(clips: SpeechClips): Record<AirlockCue, number> {
  const out = {} as Record<AirlockCue, number>;
  for (const cue of Object.keys(AIRLOCK_SPEECH) as AirlockCue[]) out[cue] = clips[AIRLOCK_SPEECH[cue]].duration;
  return out;
}
