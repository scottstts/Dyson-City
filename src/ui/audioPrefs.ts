/**
 * The player's sound preferences: one volume and a mute, remembered in this browser. The volume
 * scale puts the mix's own level (audio/mix.ts LEVEL.master) at 50%.
 */
export interface AudioPrefs {
  /** 0–1; 0.5 is the mix as authored. */
  volume: number;
  muted: boolean;
}

const STORAGE_KEY = 'dyson.audio.v1';
/** Settings of an earlier build (mouse sensitivity, field of view), no longer settable. */
const RETIRED_KEYS = ['dyson.settings.v1'];
export const DEFAULT_AUDIO_PREFS: Readonly<AudioPrefs> = { volume: 0.5, muted: false };

export function loadAudioPrefs(): AudioPrefs {
  try {
    for (const k of RETIRED_KEYS) localStorage.removeItem(k);
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AudioPrefs>;
      const volume = typeof parsed.volume === 'number' && Number.isFinite(parsed.volume) ? Math.min(1, Math.max(0, parsed.volume)) : DEFAULT_AUDIO_PREFS.volume;
      return { volume, muted: parsed.muted === true };
    }
  } catch {
    // storage unavailable or corrupt: defaults
  }
  return { ...DEFAULT_AUDIO_PREFS };
}

export function saveAudioPrefs(prefs: AudioPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // storage unavailable: the choice lasts this session only
  }
}

/**
 * The gain the preferences put on the mix. Below 50% the taper is squared (25% is −12 dB, so the
 * low half of the slider stays useful); above it rises linearly to +6 dB at 100%, which the
 * output limiter absorbs.
 */
export function prefsGain(prefs: AudioPrefs): number {
  if (prefs.muted) return 0;
  const v = Math.min(1, Math.max(0, prefs.volume));
  return v <= 0.5 ? (2 * v) ** 2 : 1 + 2 * (v - 0.5);
}
