/**
 * The terminal's OS (docs/terminal.md): pure state, no rendering and no sound. The screen draws
 * it (screen.ts); the sound watches it (audio/sounds/terminal.ts) as it watches the airlock: a
 * recording "playing since t" is state, and a key's click is an event.
 *
 * Navigation, by the arrow keys:
 *  - level 0, the sections: ↑ ↓ choose one (its contents show beside it); → or Enter goes in.
 *  - level 1, a section's entries: ↑ ↓ choose; → or Enter opens; ← goes back.
 *  - level 2, an open entry (or a section that is one page): its recording plays. Enter stops it,
 *    or plays it again; ↑ ↓ move through a page's rows; ← closes it.
 *
 * Time is the game's: it stops when the game pauses, as the sound does.
 */
import { NARRATION, type ClipId } from './cues';
import { BOOT_CLIP, SECTIONS, STATUS_ROWS, type Item, type Section } from './content';

export type TerminalKey = 'up' | 'down' | 'left' | 'right' | 'enter' | 'back';
export type OsEventKind = 'tick' | 'open' | 'back' | 'stop' | 'deny' | 'wake' | 'sleep';

export interface OsEvent {
  kind: OsEventKind;
  t: number;
}

/** Boot and wake animations (s). */
export const BOOT_TIME = 2.6;
export const WAKE_TIME = 0.5;
/** The boot recording starts this long after the wake. */
const BOOT_CLIP_DELAY = 0.35;

export interface Playback {
  clip: ClipId;
  /** Game time its first sample plays. */
  start: number;
  /** Changes with every start, so a replay of the same clip is a new one. */
  id: number;
}

export class TerminalOS {
  awake = false;
  /** When it last woke, and whether that wake is the session's first (a full boot, with its voice). */
  wokeAt = -Infinity;
  booting = false;
  sleptAt = -Infinity;
  level: 0 | 1 | 2 = 0;
  section = 0;
  /** The chosen entry in each section. */
  readonly items: number[] = SECTIONS.map(() => 0);
  /** The chosen row on a page with rows (Control). */
  row = 0;
  playback: Playback | null = null;
  /** The star's song (Observatory), playing since `start`, or null. */
  song: { start: number; id: number } | null = null;
  /** Events since the sound last drained them. */
  readonly events: OsEvent[] = [];
  /** When each key was last pressed (the keys on the ledge go down). */
  readonly pressed: Record<TerminalKey, number> = { up: -Infinity, down: -Infinity, left: -Infinity, right: -Infinity, enter: -Infinity, back: -Infinity };
  /** Bumped by anything that changes what the screen shows (the screen redraws on it). */
  version = 0;
  private serial = 0;
  private booted = false;
  /** This wake's animation: a full boot on the session's first, a quick wake after. */
  bootLength = BOOT_TIME;

  get current(): Section {
    return SECTIONS[this.section];
  }

  /** The entry open at level 2 (or chosen at level 1). */
  get item(): Item | null {
    const s = this.current;
    if (s.page) return s.page;
    return s.items[this.items[this.section]] ?? null;
  }

  wake(t: number): void {
    if (this.awake) return;
    this.awake = true;
    this.wokeAt = t;
    this.level = 0;
    this.booting = true;
    this.bootLength = this.booted ? WAKE_TIME : BOOT_TIME;
    this.emit('wake', t);
    if (!this.booted) {
      this.booted = true;
      this.play(BOOT_CLIP, t + BOOT_CLIP_DELAY);
    }
    this.version++;
  }

  sleep(t: number): void {
    if (!this.awake) return;
    this.awake = false;
    this.sleptAt = t;
    this.stopAll(t);
    this.level = 0;
    this.booting = false;
    this.emit('sleep', t);
    this.version++;
  }

  /** The OS's clock (game time at its last update): the sound reads it. */
  now = 0;

  update(t: number): void {
    this.now = t;
    if (this.booting && t >= this.wokeAt + this.bootLength) {
      this.booting = false;
      this.version++;
    }
    const p = this.playback;
    if (p && t >= p.start + NARRATION[p.clip].duration) {
      this.playback = null;
      this.version++;
      // The feed's recording leads into the star's own sound.
      if (this.level === 2 && this.current.id === 'observatory' && p.clip === this.current.page?.clip) this.song = { start: p.start + NARRATION[p.clip].duration + 0.4, id: ++this.serial };
    }
  }

  key(k: TerminalKey, t: number): void {
    if (!this.awake) return;
    this.pressed[k] = t;
    this.version++;
    if (this.booting) {
      // Any key during the boot finishes it (the voice plays on).
      this.booting = false;
      this.emit('tick', t);
      return;
    }
    const s = this.current;
    switch (k) {
      case 'up':
      case 'down': {
        const d = k === 'up' ? -1 : 1;
        if (this.level === 0) this.move(() => (this.section = clamp(this.section + d, SECTIONS.length)), this.section, t, () => this.section);
        else if (this.level === 1) this.move(() => (this.items[this.section] = clamp(this.items[this.section] + d, s.items.length)), this.items[this.section], t, () => this.items[this.section]);
        else if (s.id === 'control') this.move(() => (this.row = clamp(this.row + d, STATUS_ROWS.length)), this.row, t, () => this.row);
        else this.emit('deny', t);
        break;
      }
      case 'right':
      case 'enter': {
        if (this.level === 0) {
          if (s.page) this.open(s.page, t);
          else {
            this.level = 1;
            this.emit('open', t);
          }
        } else if (this.level === 1) {
          const it = this.item;
          if (it) this.open(it, t);
        } else if (k === 'enter') {
          // Enter on an open entry: stop what plays, or play it again.
          if (this.playback || this.song) {
            this.stopAll(t);
            this.emit('stop', t);
          } else if (this.item?.clip) {
            this.play(this.item.clip, t + 0.25);
            this.emit('open', t);
          } else this.emit('deny', t);
        } else this.emit('deny', t);
        break;
      }
      case 'left':
      case 'back': {
        if (this.level === 2) {
          this.stopAll(t);
          this.level = s.page ? 0 : 1;
          this.emit('back', t);
        } else if (this.level === 1) {
          this.level = 0;
          this.emit('back', t);
        } else this.emit('deny', t);
        break;
      }
    }
  }

  /** Current subtitle (and its speaker's clip), or null. */
  subtitle(t: number): { clip: ClipId; text: string; index: number } | null {
    const p = this.playback;
    if (!p) return null;
    const local = t - p.start;
    const cues = NARRATION[p.clip].cues;
    for (let i = cues.length - 1; i >= 0; i--) {
      if (local >= cues[i].t0 - 0.05) return local <= cues[i].t1 + 0.6 ? { clip: p.clip, text: cues[i].text, index: i } : null;
    }
    return null;
  }

  /** Seconds into the playing recording, and its length. */
  progress(t: number): { at: number; length: number } | null {
    const p = this.playback;
    if (!p) return null;
    return { at: Math.max(0, t - p.start), length: NARRATION[p.clip].duration };
  }

  private open(item: Item, t: number): void {
    this.level = 2;
    this.row = 0;
    this.stopAll(t);
    if (item.clip) this.play(item.clip, t + 0.3);
    this.emit('open', t);
  }

  private play(clip: ClipId, start: number): void {
    this.playback = { clip, start, id: ++this.serial };
    this.version++;
  }

  private stopAll(_t: number): void {
    if (this.playback || this.song) this.version++;
    this.playback = null;
    this.song = null;
  }

  private move(apply: () => void, before: number, t: number, after: () => number): void {
    apply();
    this.emit(after() === before ? 'deny' : 'tick', t);
  }

  private emit(kind: OsEventKind, t: number): void {
    this.events.push({ kind, t });
    if (this.events.length > 32) this.events.shift();
  }
}

function clamp(i: number, n: number): number {
  return Math.max(0, Math.min(n - 1, i));
}
