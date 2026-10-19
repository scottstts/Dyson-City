/**
 * The West Gate terminal's sound (docs/audio.md, "The terminal"): everything it says comes from its
 * speaker, the grille in its pedestal, through one emitter like any other source (delay, spreading,
 * air, the city's reverberation, HRTF). It watches the OS (terminal/os/os.ts):
 *
 *  - a recording "playing since t" starts at that moment of game time (late, from where it should
 *    be, if it was still loading), and fades out in 60 ms when stopped or replaced;
 *  - each OS event (a key's tick, opening, going back, waking) plays its tone (synth/terminal.ts);
 *  - the star's song (Observatory) is Alpha Centauri A's p modes sped up 10⁵ times, made as the
 *    star makes them: each mode a damped resonator (a bandpass ~0.12 Hz wide: the modes' 1.2 µHz
 *    linewidths, sped up) driven by noise (the convection that excites them), on a low rumble of
 *    granulation. Built when it starts, released when it stops.
 */
import { Emitter } from '../emitter';
import type { AudioEngine, ListenerState } from '../engine';
import { DOME_SEND, LEVEL } from '../mix';
import { synthTerminalSounds } from '../synth/terminal';
import type { NarrationClips } from '../loadNarration';
import type { OsEventKind, TerminalOS } from '../../terminal/os/os';
import { starModes, STAR_MODES } from '../../terminal/os/content';

export interface AudioTerminal {
  readonly os: TerminalOS;
  readonly clips: NarrationClips;
  /** The speaker's place and the way it faces (world). */
  readonly speaker: readonly [number, number, number];
  readonly axis: readonly [number, number, number];
  /** Game time now: the OS's clock. */
  time(): number;
}

interface Voice {
  id: number;
  source: AudioBufferSourceNode | null;
  gain: GainNode | null;
}

const FADE = 0.06;

export class TerminalSounds {
  private readonly engine: AudioEngine;
  private readonly term: AudioTerminal;
  private readonly emitter: Emitter;
  private readonly tones: Record<OsEventKind, AudioBuffer>;
  private voice: Voice = { id: -1, source: null, gain: null };
  private song: { id: number; nodes: AudioNode[]; source: AudioBufferSourceNode; out: GainNode } | null = null;

  constructor(engine: AudioEngine, term: AudioTerminal) {
    this.engine = engine;
    this.term = term;
    this.emitter = new Emitter(engine, {
      name: 'terminal',
      zones: 'located',
      refDistance: 0.3,
      send: DOME_SEND,
      directivity: { axis: [...term.axis] as [number, number, number], rear: 0.4, rearCutoff: 2200 },
    });
    this.emitter.setPosition(...term.speaker);
    const sr = engine.ctx.sampleRate;
    const raw = synthTerminalSounds(sr);
    this.tones = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, engine.buffer(v)])) as Record<OsEventKind, AudioBuffer>;
  }

  /** Per frame, before the engine's update. `t` is the context's clock. */
  update(t: number, _l: ListenerState): void {
    const os = this.term.os;
    const now = this.term.time();
    // Events: the OS's clicks and tones, at once.
    for (const e of os.events) this.tone(e.kind, t);
    os.events.length = 0;
    // The recording.
    const p = os.playback;
    if (!p) {
      if (this.voice.id !== -1) this.stopVoice(t);
    } else if (p.id !== this.voice.id || !this.voice.source) {
      if (p.id !== this.voice.id && this.voice.source) this.stopVoice(t);
      const buffer = this.term.clips.get(p.clip);
      this.voice.id = p.id;
      if (buffer) {
        const delay = p.start - now;
        const offset = Math.max(0, -delay);
        if (offset < buffer.duration) {
          const src = new AudioBufferSourceNode(this.engine.ctx, { buffer });
          const g = new GainNode(this.engine.ctx, { gain: LEVEL.terminal.voice });
          src.connect(g).connect(this.emitter.input);
          src.onended = () => g.disconnect();
          src.start(t + Math.max(0, delay), offset);
          this.voice.source = src;
          this.voice.gain = g;
        }
      }
    }
    // The star's song.
    const s = os.song;
    if (!s && this.song) this.stopSong(t);
    else if (s && (!this.song || this.song.id !== s.id)) {
      if (this.song) this.stopSong(t);
      this.startSong(s.id, t + Math.max(0, s.start - now));
    }
  }

  private tone(kind: OsEventKind, t: number): void {
    const src = new AudioBufferSourceNode(this.engine.ctx, { buffer: this.tones[kind] });
    const g = new GainNode(this.engine.ctx, { gain: LEVEL.terminal.ui * (kind === 'tick' ? 0.8 : 1) });
    src.connect(g).connect(this.emitter.input);
    src.onended = () => g.disconnect();
    src.start(t);
  }

  private stopVoice(t: number): void {
    const v = this.voice;
    if (v.source && v.gain) {
      v.gain.gain.setValueAtTime(v.gain.gain.value, t);
      v.gain.gain.linearRampToValueAtTime(0, t + FADE);
      try {
        v.source.stop(t + FADE + 0.01);
      } catch {
        // Already stopped.
      }
    }
    this.voice = { id: -1, source: null, gain: null };
  }

  private startSong(id: number, at: number): void {
    const ctx = this.engine.ctx;
    const sr = ctx.sampleRate;
    const source = new AudioBufferSourceNode(ctx, { buffer: this.engine.noise, loop: true });
    const out = new GainNode(ctx, { gain: 0 });
    const nodes: AudioNode[] = [];
    const modes = starModes();
    const bw = STAR_MODES.linewidth * 1e-6 * STAR_MODES.speed;
    // Each resonator passes a band π/2 · bw wide of the drive's power: scale the sum to unit RMS.
    let power = 0;
    for (const m of modes) power += m.amp * m.amp * ((Math.PI / 2) * bw * 2) / sr;
    const norm = 1 / Math.sqrt(Math.max(power, 1e-12));
    for (const m of modes) {
      const f = m.nu * 1e-6 * STAR_MODES.speed;
      const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: f, Q: f / bw });
      const g = new GainNode(ctx, { gain: m.amp * norm * 0.9 });
      source.connect(bp).connect(g).connect(out);
      nodes.push(bp, g);
    }
    // Granulation: the surface's own churning, a low rumble under the modes.
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 90, Q: 0.7 });
    const lg = new GainNode(ctx, { gain: 0.35 });
    source.connect(lp).connect(lg).connect(out);
    nodes.push(lp, lg);
    out.connect(this.emitter.input);
    out.gain.setValueAtTime(0, at);
    out.gain.linearRampToValueAtTime(LEVEL.terminal.song, at + 2.5);
    source.start(at, Math.random() * this.engine.noise.duration);
    this.song = { id, nodes, source, out };
  }

  private stopSong(t: number): void {
    const s = this.song;
    if (!s) return;
    s.out.gain.cancelScheduledValues(t);
    s.out.gain.setValueAtTime(s.out.gain.value, t);
    s.out.gain.linearRampToValueAtTime(0, t + 0.6);
    s.source.stop(t + 0.65);
    s.source.onended = () => {
      for (const n of s.nodes) n.disconnect();
      s.out.disconnect();
    };
    this.song = null;
  }
}
