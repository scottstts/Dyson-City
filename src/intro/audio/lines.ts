/**
 * The intro's dialogue (docs/intro-audio.md): the user's nine recordings in public/intro-audio/,
 * played as they are, like the announcements (audio/loadSpeech.ts): fetched and decoded at boot,
 * each scaled to a peak of 1 so its level is set where it plays. Some are MP3, some WAV.
 */
import { LINES } from '../timeline';

const FILES = ['Intro_dialogue-1.mp3', 'Intro_dialogue-2.wav', 'Intro_dialogue-3.mp3', 'Intro_dialogue-4.wav', 'Intro_dialogue-5.mp3', 'Intro_dialogue-6.mp3', 'Intro_dialogue-7.wav', 'Intro_dialogue-8.mp3', 'Intro_dialogue-9.wav'] as const;

async function load(ctx: BaseAudioContext, file: string): Promise<AudioBuffer> {
  const url = `${import.meta.env.BASE_URL}intro-audio/${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Intro line ${url}: HTTP ${res.status}`);
  const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) for (const v of buffer.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] /= peak;
  }
  return buffer;
}

export async function loadIntroLines(ctx: BaseAudioContext): Promise<AudioBuffer[]> {
  if (FILES.length !== LINES) throw new Error('intro: line files out of step with the script');
  return Promise.all(FILES.map((f) => load(ctx, f)));
}
