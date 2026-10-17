import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_AUDIO_PREFS, loadAudioPrefs, prefsGain, saveAudioPrefs } from '../src/ui/audioPrefs';
import { CHATTER, chatterOrder } from '../src/ui/chatter';
import { fromView, members } from '../src/ui/sphereFrame';
import { KEY_ART } from '../src/ui/keyArt';
import { surfaceAt } from '../tools/sphereArt';
import fs from 'node:fs';

class MemoryStorage {
  private readonly map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  has(k: string): boolean {
    return this.map.has(k);
  }
}

describe('audio preferences', () => {
  let store: MemoryStorage;
  beforeEach(() => {
    store = new MemoryStorage();
    (globalThis as { localStorage?: unknown }).localStorage = store;
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('defaults to 50% and unmuted, which is the mix as authored', () => {
    expect(loadAudioPrefs()).toEqual({ volume: 0.5, muted: false });
    expect(prefsGain(DEFAULT_AUDIO_PREFS)).toBe(1);
  });

  it('remembers volume and mute', () => {
    saveAudioPrefs({ volume: 0.3, muted: true });
    expect(loadAudioPrefs()).toEqual({ volume: 0.3, muted: true });
  });

  it('clamps and repairs stored values', () => {
    store.setItem('dyson.audio.v1', JSON.stringify({ volume: 7, muted: 'yes' }));
    expect(loadAudioPrefs()).toEqual({ volume: 1, muted: false });
    store.setItem('dyson.audio.v1', '{not json');
    expect(loadAudioPrefs()).toEqual(DEFAULT_AUDIO_PREFS);
  });

  it('drops the retired sensitivity/fov settings', () => {
    store.setItem('dyson.settings.v1', JSON.stringify({ sensitivity: 2, fov: 80 }));
    loadAudioPrefs();
    expect(store.has('dyson.settings.v1')).toBe(false);
  });

  it('falls back to defaults without storage', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(loadAudioPrefs()).toEqual(DEFAULT_AUDIO_PREFS);
    expect(() => saveAudioPrefs({ volume: 0.2, muted: false })).not.toThrow();
  });

  it('maps volume to a continuous, monotonic gain: silent at 0, +6 dB at 100%, 0 when muted', () => {
    expect(prefsGain({ volume: 0, muted: false })).toBe(0);
    expect(prefsGain({ volume: 1, muted: false })).toBeCloseTo(2);
    expect(20 * Math.log10(prefsGain({ volume: 0.25, muted: false }))).toBeCloseTo(-12.04, 1);
    expect(prefsGain({ volume: 0.8, muted: true })).toBe(0);
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const g = prefsGain({ volume: i / 100, muted: false });
      expect(g).toBeGreaterThan(prev);
      prev = g;
    }
    expect(prefsGain({ volume: 0.5 + 1e-9, muted: false })).toBeCloseTo(1, 6);
  });
});

describe('loading chatter', () => {
  it('is short: one line each, no explanations', () => {
    for (const line of CHATTER) {
      expect(line.text.length).toBeLessThanOrEqual(64);
      expect(line.from.length).toBeLessThanOrEqual(20);
      expect(line.text).not.toMatch(/dyson sphere/i);
    }
  });

  it('has no repeats, and a shuffle shows every line once', () => {
    expect(new Set(CHATTER.map((l) => l.text)).size).toBe(CHATTER.length);
    let seed = 7;
    const order = chatterOrder(() => ((seed = (seed * 16807) % 2147483647) / 2147483647));
    expect(order).toHaveLength(CHATTER.length);
    expect(new Set(order)).toEqual(new Set(CHATTER));
  });
});

describe('loading glyph', () => {
  const shellOf = (name: string) => (name === 'band' ? 'band' : name.startsWith('collar') ? 'collar' : 'frame');

  it('draws every coolant line on the structure the illustration renders under it', () => {
    for (const m of members()) {
      const shell = shellOf(m.name);
      for (const run of m.runs) {
        for (const p of run.points) {
          const q = fromView(p);
          const r = Math.hypot(q[0], q[1], q[2]);
          const lat = (Math.asin(q[1] / r) * 180) / Math.PI;
          const lon = (Math.atan2(q[0], q[2]) * 180) / Math.PI;
          expect(surfaceAt(shell, lat, lon), `${m.name} at ${lat.toFixed(2)}, ${lon.toFixed(2)}`).not.toBeNull();
        }
      }
    }
  });

  it('keeps the band and its collars, six spines, two rings and two polar collars in lighting order', () => {
    const names = members().map((m) => m.name.split(' ')[0]);
    expect(names).toEqual(['band', ...Array(6).fill('collar'), ...Array(6).fill('spine'), 'ring', 'ring', 'polar', 'polar']);
  });

  it('ships the illustration and key art within budget', () => {
    for (const layer of ['front', 'back', 'glow']) expect(fs.readFileSync(`public/glyph/${layer}.webp`).length).toBeLessThan(200 * 1024);
    for (const name of KEY_ART) expect(fs.readFileSync(`public/keyart/${name}.jpg`).length).toBeLessThan(500 * 1024);
  });
});
