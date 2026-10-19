/**
 * The announcements (docs/audio.md, "Announcements"): the user's spoken recordings in
 * public/speeches/, the one kind of sound that ships as a recording. They are fetched and decoded
 * at boot (at the context's rate) and each is scaled to a peak of 1, so `LEVEL.speech` is the peak
 * at the loudspeaker, as every other level is the level at its source.
 */
import type { AirlockCue } from '../city/gate/airlock';
import { CHIME } from './synth/chime';

export const SPEECHES = ['enter-dome', 'pressurization', 'depressurization', 'exit', 'enter-estate', 'enter-compound', 'drive', 'aircraft-perimeter'] as const;
export type Speech = (typeof SPEECHES)[number];
export type SpeechClips = Record<Speech, AudioBuffer>;

/** Announcements the chime (synth/chime.ts) comes before: all but the chamber's. */
export function chimed(speech: Speech): boolean {
  return speech !== 'pressurization' && speech !== 'depressurization';
}

/** Seconds from an announcement's start (its chime, if it has one) to the end of its speech. */
export function speechLength(speech: Speech, clip: { duration: number }): number {
  return (chimed(speech) ? CHIME.lead : 0) + clip.duration;
}

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

/** The airlock waits out each announcement (city/gate/airlock.ts): their lengths (s), chimes included. */
export function airlockAnnouncements(clips: Record<Speech, { duration: number }>): Record<AirlockCue, number> {
  const out = {} as Record<AirlockCue, number>;
  for (const cue of Object.keys(AIRLOCK_SPEECH) as AirlockCue[]) out[cue] = speechLength(AIRLOCK_SPEECH[cue], clips[AIRLOCK_SPEECH[cue]]);
  return out;
}
