/**
 * The terminal's screen (docs/terminal.md): the OS drawn into a 1920 × 1200 canvas, uploaded as
 * the screen glass's emission. It redraws only when what it shows changes (the OS's version), and
 * while something on it moves, at a rate that motion needs: the boot at 30 Hz, the star's song
 * and the live plan at 20 Hz, a recording's subtitles and progress at 12 Hz, the idle screen at
 * 2 Hz. Nothing is drawn or uploaded while no one is near enough to read it.
 */
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three/webgpu';
import { NARRATION, type ClipId } from './cues';
import { PARTICULARS, SECTIONS, SENDERS, STATUS_CUE_ROWS, STATUS_ROWS, starModes, STAR_MODES, type Item, type StatusRow } from './content';
import { BOOT_TIME, type TerminalOS } from './os';
import { drawPlan } from './plan';
import { feedBeat, statusBeat, type Box } from './briefing';
import { FONT, GRID, INK, SCREEN_H, SCREEN_W } from './theme';

/** What the screen shows live from the world. */
export interface TerminalLive {
  craft: { phase: string; x: number; z: number; visible: boolean };
  /** Openness (0..1) of the East Lock's and the West Gate's two gates. */
  lock: { outer: number; inner: number };
  gate: { outer: number; inner: number };
}

/** A recording's loudness envelope (peaks, 0..1), once its sound is loaded. */
export type Peaks = (clip: ClipId) => Float32Array | null;

/** A briefing's beats crossfade over this long as each line starts (s). */
const BEAT_FADE = 0.35;

const SPEAKER: Record<ClipId, string> = {
  T1: 'RECKONER',
  T2: 'ARCHIVE · NARRATION',
  T3: 'RECKONER',
  T4: 'CLARA HAYES',
  T5: 'SAM',
  T6: 'RECKONER',
};

const CRAFT_STATUS: Record<string, string> = {
  approach: 'APPROACHING',
  hold: 'HOLDING OFF THE LOCK',
  enter: 'IN THE LOCK',
  'wait-in': 'IN THE LOCK',
  inbound: 'INBOUND',
  hover: 'ON THE PAD',
  outbound: 'OUTBOUND',
  'wait-out': 'IN THE LOCK',
  depart: 'DEPARTING',
  gap: 'CLEAR',
};

function lockState(g: { outer: number; inner: number }, outside: string, inside: string): string {
  if (g.outer > 0.98) return `OPEN TO ${outside}`;
  if (g.inner > 0.98) return `OPEN TO ${inside}`;
  if (g.outer < 0.02 && g.inner < 0.02) return 'SEALED';
  return 'CYCLING';
}

function clock(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/** The Origin story's beats: the index of the line that says each (cues.ts T2). */
const STORY = (() => {
  const cues = NARRATION.T2.cues;
  const at = (words: string) => {
    const i = cues.findIndex((q) => q.text.includes(words));
    if (i < 0) throw new Error(`T2 has no line with "${words}"`);
    return i;
  };
  return { launch: at('2061'), fell: at('fell toward'), rock: at('found rock'), years: at('40 years'), met: at('plates met'), closed: at('sphere closed'), city: at('On the inside'), you: at('where you come in') };
})();

export class TerminalScreen {
  readonly canvas: HTMLCanvasElement;
  readonly texture: CanvasTexture;
  /** The screen's brightness (0 off … 1 awake): the material's emission follows it. */
  power = 0.4;
  private readonly ctx: CanvasRenderingContext2D;
  private drawnVersion = -1;
  private drawnAt = -Infinity;
  private readonly portraits = new Map<string, HTMLImageElement>();
  private readonly modes = starModes();
  /** Each mode's slowly varying excitation (the screen's own; the sound has its own noise). */
  private readonly excite: Float32Array;
  private excitedAt = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = SCREEN_W;
    this.canvas.height = SCREEN_H;
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.minFilter = LinearMipmapLinearFilter;
    this.texture.magFilter = LinearFilter;
    this.texture.anisotropy = 8;
    this.excite = new Float32Array(this.modes.length).map(() => 0.6 + Math.random() * 0.4);
  }

  /** Starts fetching the senders' portraits (once someone comes near). */
  preload(): void {
    for (const s of Object.values(SENDERS)) {
      if (this.portraits.has(s.image)) continue;
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        this.drawnVersion = -1;
      };
      img.src = `${import.meta.env.BASE_URL}${s.image}`;
      this.portraits.set(s.image, img);
    }
  }

  /** Per frame: redraws and uploads if it must. `near`: someone is close enough to read it. */
  update(os: TerminalOS, live: TerminalLive, t: number, near: boolean, peaks: Peaks): void {
    // Brightness: up on waking, down on sleeping, a dim standby glow otherwise.
    const target = os.awake ? 1 : 0.42;
    const sinceSleep = t - os.sleptAt;
    this.power = os.awake ? Math.min(1, 0.42 + (t - os.wokeAt) * 2.2) : Math.max(target, 1 - sinceSleep * 1.2);
    if (!near) return;
    const rate = this.rate(os, t);
    const due = os.version !== this.drawnVersion || (rate > 0 && t - this.drawnAt >= 1 / rate) || t < this.drawnAt;
    if (!due) return;
    this.drawnVersion = os.version;
    this.drawnAt = t;
    this.draw(os, live, t, peaks);
    this.texture.needsUpdate = true;
  }

  /** How often the screen must redraw now (Hz), or 0 for only on change. */
  private rate(os: TerminalOS, t: number): number {
    if (!os.awake) return t - os.sleptAt < 1.2 ? 20 : 2;
    if (os.booting) return 30;
    const s = os.current.id;
    // A briefing or the story playing: its diagrams move with the words.
    if (os.level === 2 && os.playback && (s === 'observatory' || s === 'control' || s === 'archive')) return 24;
    if (os.level === 2 && (s === 'observatory' || s === 'control')) return 20;
    if (os.playback) return 12;
    return 1;
  }

  // --- drawing ---------------------------------------------------------------------------------

  private text(s: string, x: number, y: number, font: string, color: string, spacing = 0, align: CanvasTextAlign = 'left'): number {
    const c = this.ctx;
    c.font = font;
    c.fillStyle = color;
    c.letterSpacing = `${spacing}px`;
    c.textAlign = align;
    c.fillText(s, x, y);
    const w = c.measureText(s).width;
    c.letterSpacing = '0px';
    c.textAlign = 'left';
    return w;
  }

  /** Wraps text to a width; returns the lines. */
  private wrap(s: string, font: string, width: number): string[] {
    const c = this.ctx;
    c.font = font;
    const words = s.split(' ');
    const out: string[] = [];
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (c.measureText(next).width > width && line) {
        out.push(line);
        line = w;
      } else line = next;
    }
    if (line) out.push(line);
    return out;
  }

  private rule(x0: number, y: number, x1: number, color: string = INK.rule): void {
    const c = this.ctx;
    c.fillStyle = color;
    c.fillRect(x0, y, x1 - x0, 1.5);
  }

  private draw(os: TerminalOS, live: TerminalLive, t: number, peaks: Peaks): void {
    const c = this.ctx;
    // The glass's black, lifted a touch in the middle (the backlight's falloff).
    const g = c.createRadialGradient(SCREEN_W / 2, SCREEN_H / 2, 100, SCREEN_W / 2, SCREEN_H / 2, SCREEN_W * 0.7);
    g.addColorStop(0, INK.bgLift);
    g.addColorStop(1, INK.bg);
    c.fillStyle = g;
    c.fillRect(0, 0, SCREEN_W, SCREEN_H);
    if (!os.awake) {
      this.idle(t);
      return;
    }
    if (os.booting) {
      this.boot(os, t);
      return;
    }
    // A short wake: everything fades in.
    const fade = Math.min(1, (t - os.wokeAt) / 0.5);
    c.globalAlpha = fade;
    this.header(live, t);
    this.nav(os);
    this.content(os, live, t, peaks);
    this.footer(os, t);
    c.globalAlpha = 1;
  }

  /** The sphere glyph: the band, the latitude rings, the turning gores. */
  private glyph(cx: number, cy: number, r: number, t: number, alpha = 1): void {
    const c = this.ctx;
    c.save();
    c.globalAlpha *= alpha;
    c.strokeStyle = INK.ink;
    c.lineWidth = Math.max(1.5, r / 22);
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.stroke();
    // Meridians turning slowly (the band's spin).
    c.lineWidth = Math.max(1, r / 40);
    c.strokeStyle = INK.dim;
    for (let i = 0; i < 6; i++) {
      const ph = ((i / 6) * Math.PI + t * 0.15) % Math.PI;
      const k = Math.cos(ph);
      c.beginPath();
      c.ellipse(cx, cy, Math.abs(k) * r, r, 0, 0, Math.PI * 2);
      c.stroke();
    }
    // The band, and two latitude rings bounding the open bands.
    c.strokeStyle = INK.amber;
    c.lineWidth = Math.max(1.5, r / 26);
    c.beginPath();
    c.ellipse(cx, cy, r, r * 0.22, 0, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = INK.faint;
    for (const lat of [-0.42, 0.42]) {
      const y = cy + lat * r;
      const rr = Math.sqrt(1 - lat * lat) * r;
      c.beginPath();
      c.ellipse(cx, y, rr, rr * 0.22, 0, 0, Math.PI * 2);
      c.stroke();
    }
    // The star.
    const sg = c.createRadialGradient(cx, cy, 0, cx, cy, r * 0.62);
    sg.addColorStop(0, 'rgba(255, 246, 228, 0.95)');
    sg.addColorStop(0.55, 'rgba(255, 214, 160, 0.55)');
    sg.addColorStop(1, 'rgba(255, 184, 104, 0)');
    c.fillStyle = sg;
    c.beginPath();
    c.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  private idle(t: number): void {
    const cx = SCREEN_W / 2;
    this.glyph(cx, 470, 170, t, 0.9);
    this.text('RECKONER', cx, 770, `700 46px ${FONT.sans}`, INK.ink, 18, 'center');
    this.text('WEST GATE TERMINAL', cx, 830, `500 26px ${FONT.sans}`, INK.dim, 9, 'center');
    const pulse = 0.35 + 0.25 * Math.sin(t * 1.4);
    this.text('STANDING BY', cx, 940, `600 22px ${FONT.mono}`, `rgba(255, 184, 104, ${pulse.toFixed(3)})`, 8, 'center');
    this.text('NOON', cx, 990, `500 20px ${FONT.mono}`, INK.faint, 6, 'center');
  }

  private boot(os: TerminalOS, t: number): void {
    const u = (t - os.wokeAt) / os.bootLength;
    if (os.bootLength < BOOT_TIME) {
      // A quick wake: the standby screen, then the frame.
      this.idle(t);
      return;
    }
    const cx = 520;
    this.glyph(cx, 560, 210, t, Math.min(1, u * 2.5));
    const lines: [string, string][] = [
      ['RECKONER COMPUTATION', 'WEST GATE TERMINAL 04'],
      ['LINK', 'RECKONER · 3 TOWERS · CRYOGEN-COOLED'],
      ['BEAM', 'SOL · 4.37 LY · CARRIER LOCKED'],
      ['RESONATOR', 'FEED LIVE'],
      ['COMPOUND', '7 PRECINCTS NOMINAL'],
      ['EAST LOCK', 'CYCLING ON SCHEDULE'],
      ['GUARDIAN', 'PRESENT'],
    ];
    const shown = Math.floor(u * (lines.length + 1.5));
    lines.forEach(([k, v], i) => {
      if (i >= shown) return;
      const y = 330 + i * 72;
      this.text(k, 900, y, `600 24px ${FONT.mono}`, i === 0 ? INK.amber : INK.dim, 5);
      this.text(v, 1250, y, `500 24px ${FONT.mono}`, i === 0 ? INK.ink : INK.ok, 3);
      if (i > 0) this.text('· · · · · ·', 1110, y, `500 24px ${FONT.mono}`, INK.ghost);
    });
    const bar = Math.min(1, u * 1.1);
    this.rule(900, 880, 1760, INK.ghost);
    this.ctx.fillStyle = INK.amber;
    this.ctx.fillRect(900, 879, 860 * bar, 3);
  }

  private header(live: TerminalLive, t: number): void {
    const y = 86;
    this.glyph(GRID.m + 26, y - 9, 26, t);
    let x = GRID.m + 74;
    x += this.text('RECKONER', x, y, `700 30px ${FONT.sans}`, INK.ink, 9);
    this.text('WEST GATE TERMINAL', x + 26, y, `500 21px ${FONT.sans}`, INK.dim, 5);
    // Right: noon, the craft, the beam.
    let r = SCREEN_W - GRID.m;
    const beam = 0.55 + 0.45 * Math.sin(t * 2.2);
    const c = this.ctx;
    c.fillStyle = `rgba(186, 214, 160, ${beam.toFixed(3)})`;
    c.beginPath();
    c.arc(r - 8, y - 8, 8, 0, Math.PI * 2);
    c.fill();
    r -= 30;
    this.text('BEAM', r, y, `600 21px ${FONT.mono}`, INK.dim, 4, 'right');
    r -= 140;
    const craft = CRAFT_STATUS[live.craft.phase] ?? 'CLEAR';
    this.text(`CRAFT · ${craft}`, r, y, `600 21px ${FONT.mono}`, live.craft.visible ? INK.ink : INK.dim, 4, 'right');
    r -= 470;
    this.text('NOON', r, y, `600 21px ${FONT.mono}`, INK.dim, 4, 'right');
    this.rule(GRID.m, GRID.headerRule, SCREEN_W - GRID.m);
  }

  private nav(os: TerminalOS): void {
    const c = this.ctx;
    SECTIONS.forEach((s, i) => {
      const y = GRID.navY + i * GRID.navRow;
      const sel = i === os.section;
      const inside = sel && os.level > 0;
      if (sel) {
        c.fillStyle = inside ? INK.amberGhost : 'rgba(255, 236, 200, 0.05)';
        c.fillRect(GRID.navX - 24, y - 6, GRID.navW + 24, GRID.navRow - 18);
        c.fillStyle = INK.amber;
        c.fillRect(GRID.navX - 24, y - 6, 5, GRID.navRow - 18);
      }
      this.text(`0${i + 1}`, GRID.navX, y + 30, `600 18px ${FONT.mono}`, sel ? INK.amber : INK.faint, 3);
      this.text(s.title.toUpperCase(), GRID.navX + 56, y + 40, `600 38px ${FONT.sans}`, sel ? INK.ink : INK.dim, 6);
      this.text(s.sub, GRID.navX + 56, y + 78, `400 21px ${FONT.sans}`, sel ? INK.dim : INK.faint, 1);
      if (s.id === 'comms') {
        c.fillStyle = INK.amber;
        c.beginPath();
        c.arc(GRID.navX + GRID.navW - 30, y + 30, 6, 0, Math.PI * 2);
        c.fill();
      }
    });
    c.fillStyle = INK.rule;
    c.fillRect(GRID.divX, GRID.contentY, 1.5, GRID.contentH - 16);
  }

  private footer(os: TerminalOS, t: number): void {
    this.rule(GRID.m, GRID.footerRule, SCREEN_W - GRID.m);
    // Keys, under the navigation.
    const hints = os.level === 2 ? ['↑ ↓  ROWS', '⏎  PLAY · STOP', '←  BACK', 'E  LEAVE'] : os.level === 1 ? ['↑ ↓  SELECT', '→  OPEN', '←  BACK', 'E  LEAVE'] : ['↑ ↓  SELECT', '→  OPEN', 'E  LEAVE'];
    hints.forEach((h, i) => this.text(h, GRID.m + (i % 2) * 240, GRID.footerY + 20 + Math.floor(i / 2) * 40, `600 18px ${FONT.mono}`, INK.faint, 2));
    const sub = os.subtitle(t);
    const p = os.progress(t);
    if (p) {
      const x0 = GRID.contentX;
      const x1 = SCREEN_W - GRID.m;
      this.text(SPEAKER[os.playback!.clip], x0, GRID.footerY + 2, `600 17px ${FONT.mono}`, INK.amberDim, 4);
      this.text(`${clock(p.at)} / ${clock(p.length)}`, x1, GRID.footerY + 2, `500 17px ${FONT.mono}`, INK.faint, 2, 'right');
      const y = 1172;
      this.rule(x0, y, x1, INK.ghost);
      this.ctx.fillStyle = INK.amber;
      this.ctx.fillRect(x0, y - 0.5, (x1 - x0) * Math.min(1, p.at / p.length), 2.5);
      if (sub) {
        const font = `italic 400 36px ${FONT.serif}`;
        const lines = this.wrap(sub.text, font, x1 - x0);
        lines.slice(0, 2).forEach((l, i) => this.text(l, x0, GRID.footerY + 46 + i * 40, font, INK.ink));
      }
    }
  }

  private content(os: TerminalOS, live: TerminalLive, t: number, peaks: Peaks): void {
    const s = os.current;
    const X = GRID.contentX;
    const Y = GRID.contentY;
    // The section's title line.
    const open = os.level === 2 ? os.item : null;
    const crumb = open && !s.page ? `${s.title.toUpperCase()}  /  ${open.title.toUpperCase()}` : s.title.toUpperCase();
    this.text(crumb, X, Y + 22, `600 19px ${FONT.mono}`, INK.amberDim, 5);
    switch (s.id) {
      case 'archive':
        if (os.level < 2) this.list(s.items, os.items[os.section], os.level === 1);
        else if (open?.kind === 'story') this.story(os, t);
        else if (open?.kind === 'particulars') this.particulars();
        else this.planPage(live, t);
        break;
      case 'comms':
        if (os.level < 2) this.inbox(s.items, os.items[os.section], os.level === 1);
        else if (open) this.message(open, os, t, peaks);
        break;
      case 'control':
        this.status(os, live, t, os.level === 2);
        break;
      case 'observatory':
        this.feed(os, t, os.level === 2);
        break;
    }
  }

  /**
   * Draws a briefing's beats for a recording playing now: the current line's beat at its progress,
   * crossfading over BEAT_FADE from the last. Returns false when that recording is not playing.
   */
  private briefing(os: TerminalOS, t: number, clip: ClipId, draw: (i: number, p: number) => void): boolean {
    const pb = os.playback;
    if (!pb || pb.clip !== clip) return false;
    const at = t - pb.start;
    const cues = NARRATION[clip].cues;
    let i = 0;
    for (let k = 0; k < cues.length; k++) if (at >= cues[k].t0 - 0.1) i = k;
    const q = cues[i];
    const p = Math.max(0, Math.min(1, (at - q.t0) / Math.max(0.3, q.t1 - q.t0)));
    const f = Math.max(0, Math.min(1, (at - (q.t0 - 0.1)) / BEAT_FADE));
    const c = this.ctx;
    if (f < 1 && i > 0) {
      c.save();
      c.globalAlpha *= 1 - f;
      draw(i - 1, 1);
      c.restore();
    }
    c.save();
    c.globalAlpha *= i === 0 ? 1 : f;
    draw(i, p);
    c.restore();
    return true;
  }

  // --- pages -----------------------------------------------------------------------------------

  private speakerIcon(x: number, y: number, color: string): void {
    const c = this.ctx;
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(x, y - 5);
    c.lineTo(x + 6, y - 5);
    c.lineTo(x + 13, y - 11);
    c.lineTo(x + 13, y + 11);
    c.lineTo(x + 6, y + 5);
    c.lineTo(x, y + 5);
    c.closePath();
    c.fill();
    c.strokeStyle = color;
    c.lineWidth = 2;
    for (const r of [8, 14]) {
      c.beginPath();
      c.arc(x + 13, y, r, -0.7, 0.7);
      c.stroke();
    }
  }

  private list(items: Item[], chosen: number, active: boolean): void {
    const X = GRID.contentX;
    const c = this.ctx;
    items.forEach((it, i) => {
      const y = GRID.contentY + 80 + i * 150;
      const sel = i === chosen;
      if (sel && active) {
        c.fillStyle = 'rgba(255, 236, 200, 0.05)';
        c.fillRect(X - 20, y - 10, GRID.contentW + 20, 128);
        c.fillStyle = INK.amber;
        c.fillRect(X - 20, y - 10, 4, 128);
      }
      const ink = !active || sel ? INK.ink : INK.dim;
      this.text(it.title, X + 10, y + 50, `500 44px ${FONT.sans}`, ink, 1);
      this.text(it.sub, X + 10, y + 92, `400 24px ${FONT.sans}`, INK.dim, 0.5);
      const right = SCREEN_W - GRID.m - 10;
      if (it.clip) {
        this.text(clock(NARRATION[it.clip].duration), right, y + 54, `500 22px ${FONT.mono}`, INK.dim, 2, 'right');
        this.speakerIcon(right - 120, y + 46, sel && active ? INK.amber : INK.faint);
      } else this.text(it.kind === 'plan' ? 'PLAN' : 'DOCUMENT', right, y + 54, `600 20px ${FONT.mono}`, INK.faint, 4, 'right');
      this.rule(X, y + 134, SCREEN_W - GRID.m, INK.ghost);
    });
  }

  /** A portrait cropped to a face-centred window (aspect w:h), or a dark plate while it loads. */
  private portrait(id: string, x: number, y: number, w: number, h: number, zoom: number, round: boolean): void {
    const c = this.ctx;
    const s = SENDERS[id];
    const img = s ? this.portraits.get(s.image) : undefined;
    c.save();
    c.beginPath();
    if (round) c.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2);
    else c.rect(x, y, w, h);
    c.clip();
    c.fillStyle = '#1a1612';
    c.fillRect(x, y, w, h);
    if (img && img.complete && img.naturalWidth > 0) {
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      // Source window: the face at the window's centre (upper third for a tall frame).
      const sh = ih / zoom;
      const sw = (sh * w) / h;
      const fx = s.face[0] * iw;
      const fy = s.face[1] * ih;
      const sx = Math.max(0, Math.min(iw - sw, fx - sw / 2));
      const sy = Math.max(0, Math.min(ih - sh, fy - sh * (round ? 0.5 : 0.36)));
      c.drawImage(img, sx, sy, sw, sh, x, y, w, h);
      // The screen's own grade: a little contrast and warmth, so a photograph sits in the panel.
      c.fillStyle = 'rgba(30, 18, 6, 0.12)';
      c.fillRect(x, y, w, h);
    }
    c.restore();
  }

  private inbox(items: Item[], chosen: number, active: boolean): void {
    const X = GRID.contentX;
    const c = this.ctx;
    items.forEach((it, i) => {
      const y = GRID.contentY + 80 + i * 170;
      const sel = i === chosen;
      if (sel && active) {
        c.fillStyle = 'rgba(255, 236, 200, 0.05)';
        c.fillRect(X - 20, y - 10, GRID.contentW + 20, 150);
        c.fillStyle = INK.amber;
        c.fillRect(X - 20, y - 10, 4, 150);
      }
      this.portrait(it.id, X + 10, y + 6, 118, 118, 3.2, true);
      c.strokeStyle = sel && active ? INK.amber : INK.rule;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(X + 69, y + 65, 61, 0, Math.PI * 2);
      c.stroke();
      const ink = !active || sel ? INK.ink : INK.dim;
      this.text(it.title, X + 160, y + 56, `500 42px ${FONT.sans}`, ink, 0.5);
      this.text(it.sub, X + 160, y + 96, `400 24px ${FONT.sans}`, INK.dim, 0.5);
      const right = SCREEN_W - GRID.m - 10;
      this.text(`IN TRANSIT ${SENDERS[it.id].transit.toUpperCase()}`, right, y + 50, `600 18px ${FONT.mono}`, INK.faint, 3, 'right');
      this.text(clock(NARRATION[it.clip!].duration), right, y + 94, `500 22px ${FONT.mono}`, INK.dim, 2, 'right');
      this.speakerIcon(right - 120, y + 86, sel && active ? INK.amber : INK.faint);
      this.rule(X, y + 156, SCREEN_W - GRID.m, INK.ghost);
    });
  }

  private message(it: Item, os: TerminalOS, t: number, peaks: Peaks): void {
    const X = GRID.contentX;
    const top = GRID.contentY + 60;
    const pw = 440;
    const ph = 586;
    this.portrait(it.id, X, top, pw, ph, 1.75, false);
    const c = this.ctx;
    c.strokeStyle = 'rgba(214, 172, 118, 0.55)';
    c.lineWidth = 2;
    c.strokeRect(X, top, pw, ph);
    this.text(it.title.toUpperCase(), X, top + ph + 52, `600 30px ${FONT.sans}`, INK.ink, 5);
    this.text(it.sub, X, top + ph + 90, `400 22px ${FONT.sans}`, INK.dim, 0.5);
    // Header fields.
    const RX = X + pw + 64;
    const R1 = SCREEN_W - GRID.m;
    const sender = SENDERS[it.id];
    const fields: [string, string][] = [
      ['FROM', it.title],
      ['ROUTE', sender.route],
      ['IN TRANSIT', sender.transit],
      ['RECEIVED', 'Beam relay · West Gate'],
    ];
    fields.forEach(([k, v], i) => {
      const y = top + 26 + i * 50;
      this.text(k, RX, y, `600 17px ${FONT.mono}`, INK.faint, 4);
      this.text(v, RX + 220, y, `400 26px ${FONT.sans}`, INK.ink, 0.3);
    });
    // The recording: its loudness over time, the playhead.
    const clip = it.clip!;
    const len = NARRATION[clip].duration;
    const pk = peaks(clip);
    const wy = top + 270;
    const wh = 100;
    const at = os.playback?.clip === clip ? Math.max(0, t - os.playback.start) : -1;
    const n = 180;
    const bw = (R1 - RX) / n;
    for (let i = 0; i < n; i++) {
      let a: number;
      if (pk) a = pk[Math.floor((i / n) * pk.length)];
      else {
        // Until the sound is loaded: the speech's own spans from the cues.
        const tt = (i / n) * len;
        a = NARRATION[clip].cues.some((q) => tt >= q.t0 && tt <= q.t1) ? 0.35 + 0.3 * Math.abs(Math.sin(i * 1.7)) : 0.03;
      }
      const played = at >= 0 && (i / n) * len <= at;
      c.fillStyle = played ? INK.amber : INK.faint;
      const hh = Math.max(2, a * wh);
      c.fillRect(RX + i * bw, wy + wh / 2 - hh / 2, Math.max(1, bw - 2), hh);
    }
    if (at >= 0) {
      c.fillStyle = INK.ink;
      c.fillRect(RX + (R1 - RX) * Math.min(1, at / len), wy - 8, 2, wh + 16);
    }
    // The transcript, line by line as it is spoken, in its own clipped box above the footer: the
    // newest line kept in view (the lines before it scroll up and out), so it never runs off the
    // bottom or onto the footer's rule.
    const cues = NARRATION[clip].cues;
    const font = `400 31px ${FONT.serif}`;
    const playing = at >= 0;
    const boxTop = wy + wh + 40;
    const bottom = GRID.footerRule - 34;
    const shown = playing ? cues.filter((q) => at >= q.t0 - 0.05) : cues;
    const blocks = shown.map((q) => this.wrap(q.text, font, R1 - RX));
    const height = blocks.reduce((h, bl) => h + bl.length * 42 + 8, 0);
    // Playing, the latest line sits at the box's foot once the lines overflow; stopped, from the top.
    const offset = playing ? Math.max(0, height - (bottom - boxTop)) : 0;
    c.save();
    c.beginPath();
    c.rect(RX - 10, boxTop, R1 - RX + 20, bottom - boxTop);
    c.clip();
    let y = boxTop + 32 - offset;
    blocks.forEach((bl, i) => {
      const q = shown[i];
      const current = playing && at <= q.t1 + 0.6 && at >= q.t0 - 0.05;
      for (const l of bl) {
        this.text(l, RX, y, font, current ? INK.ink : INK.dim);
        y += 42;
      }
      y += 8;
    });
    c.restore();
    // A soft fade where the lines leave the box at its top.
    if (offset > 0) {
      const g = c.createLinearGradient(0, boxTop, 0, boxTop + 46);
      g.addColorStop(0, INK.bg);
      g.addColorStop(1, 'rgba(11, 10, 8, 0)');
      c.fillStyle = g;
      c.fillRect(RX - 10, boxTop, R1 - RX + 20, 46);
    }
    if (!playing) this.text('⏎  PLAY', R1, wy - 24, `600 20px ${FONT.mono}`, INK.amberDim, 4, 'right');
  }

  /** Archive · Origin: the story's diagram and its transcript. */
  private story(os: TerminalOS, t: number): void {
    const X = GRID.contentX;
    const c = this.ctx;
    const playing = os.playback?.clip === 'T2';
    const at = playing ? Math.max(0, t - os.playback!.start) : Infinity;
    const cues = NARRATION.T2.cues;
    const cue = playing ? cues.findIndex((_, i) => at < (cues[i + 1]?.t0 ?? Infinity)) : cues.length - 1;
    // Diagram: Sol far left, the seeds crossing, the star, its plates closing into a shell.
    const cx = X + 340;
    const cy = GRID.contentY + 400;
    const shellR = 230;
    const phase = (k: number) => (playing ? (at - cues[k].t0) / Math.max(0.5, (cues[k + 1]?.t0 ?? cues[k].t1 + 1) - cues[k].t0) : 1);
    const after = (k: number) => !playing || cue > k || (cue === k && phase(k) >= 1);
    // The story's beats, found by what is said (the lines may be re-cut; the words stay).
    const S = STORY;
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    // Sol and the seeds' line.
    const solX = X + 30;
    c.fillStyle = INK.dim;
    c.beginPath();
    c.arc(solX, cy, 6, 0, Math.PI * 2);
    c.fill();
    this.text('SOL', solX - 6, cy + 34, `600 16px ${FONT.mono}`, INK.faint, 3);
    if (cue >= S.launch || !playing) {
      c.setLineDash([3, 8]);
      c.strokeStyle = INK.ghost;
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(solX + 10, cy);
      c.lineTo(cx - shellR - 10, cy);
      c.stroke();
      c.setLineDash([]);
    }
    // Seeds in flight (cues 1–4).
    if (playing && cue >= S.launch && cue < S.rock) {
      const u = clamp01((at - cues[S.launch].t0) / (cues[S.rock].t0 - cues[S.launch].t0));
      for (let i = 0; i < 9; i++) {
        const lag = i * 0.035;
        const p = clamp01((u - lag) / (1 - 0.3));
        const x = solX + 10 + (cx - 120 - solX) * p;
        const y = cy + (i - 4) * 5 * (1 - p);
        c.fillStyle = i === 3 && p > 0.6 ? INK.faint : INK.amber;
        c.beginPath();
        c.arc(x, y, 3, 0, Math.PI * 2);
        c.fill();
      }
    }
    // The star.
    const sg = c.createRadialGradient(cx, cy, 0, cx, cy, 110);
    sg.addColorStop(0, 'rgba(255, 248, 232, 1)');
    sg.addColorStop(0.5, 'rgba(255, 214, 160, 0.8)');
    sg.addColorStop(1, 'rgba(255, 184, 104, 0)');
    c.fillStyle = sg;
    c.beginPath();
    c.arc(cx, cy, 110, 0, Math.PI * 2);
    c.fill();
    // Foundries at work (cues 5–7): sparks round the star.
    if (playing && cue >= S.rock && cue < S.closed) {
      for (let i = 0; i < 24; i++) {
        const a = i * 2.39996 + at * 0.4;
        const r = shellR + Math.sin(i * 7.1 + at * 3) * 18;
        c.fillStyle = `rgba(255, 184, 104, ${(0.3 + 0.5 * Math.abs(Math.sin(at * 5 + i))).toFixed(3)})`;
        c.fillRect(cx + Math.cos(a) * r - 1.5, cy + Math.sin(a) * r - 1.5, 3, 3);
      }
    }
    // Plates laid down from "For 40 years" until they meet, the shell closed after.
    const plates = 48;
    const laid = !playing || after(S.met) ? plates : cue < S.years ? 0 : Math.floor(plates * clamp01((at - cues[S.years].t0) / (cues[S.met].t1 - cues[S.years].t0)));
    c.strokeStyle = INK.bronze;
    c.lineWidth = 16;
    for (let i = 0; i < laid; i++) {
      const k = (i * 29) % plates;
      const a0 = (k / plates) * Math.PI * 2;
      c.beginPath();
      c.arc(cx, cy, shellR, a0 + 0.012, a0 + (Math.PI * 2) / plates - 0.012);
      c.stroke();
    }
    if (after(S.met)) {
      c.strokeStyle = INK.ink;
      c.lineWidth = 1.5;
      for (const r of [shellR - 8, shellR + 8]) {
        c.beginPath();
        c.arc(cx, cy, r, 0, Math.PI * 2);
        c.stroke();
      }
      this.text('2,000,000 KM', cx, cy + shellR + 60, `600 18px ${FONT.mono}`, INK.faint, 4, 'center');
    }
    // The city: one pocket of air on the inside.
    if (!playing || cue >= S.city) {
      const a = Math.PI * 0.5;
      const px = cx + Math.cos(a) * (shellR - 14);
      const py = cy + Math.sin(a) * (shellR - 14);
      c.strokeStyle = INK.amber;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(px, py, 8, Math.PI, 0);
      c.stroke();
      if (!playing || cue >= S.you) {
        const k = 0.5 + 0.5 * Math.sin(t * 3);
        c.strokeStyle = `rgba(255, 184, 104, ${(0.6 - 0.45 * k).toFixed(3)})`;
        c.beginPath();
        c.arc(px, py, 14 + 14 * k, 0, Math.PI * 2);
        c.stroke();
        this.text('YOU', px - 34, py + 8, `600 18px ${FONT.mono}`, INK.amber, 4, 'right');
      }
    }
    this.storyOverlay(cue, playing ? Math.max(0, Math.min(1, (at - cues[cue].t0) / Math.max(0.3, cues[cue].t1 - cues[cue].t0))) : 1, playing, t, cx, cy, shellR);
    // Timeline: 2061, 2083, 2127.
    const ty = GRID.contentY + 760;
    const tx0 = X + 20;
    const tx1 = X + 640;
    const yr = (y: number) => tx0 + ((y - 2050) / (2140 - 2050)) * (tx1 - tx0);
    this.rule(tx0, ty, tx1, INK.faint);
    for (const [y, label] of [[2061, 'LAUNCH'], [2083, 'ARRIVAL'], [2127, 'CLOSED']] as const) {
      const x = yr(y);
      this.ctx.fillStyle = INK.dim;
      this.ctx.fillRect(x - 1, ty - 10, 2, 20);
      this.text(String(y), x, ty + 40, `600 20px ${FONT.mono}`, INK.dim, 2, 'center');
      this.text(label, x, ty - 24, `600 14px ${FONT.mono}`, INK.faint, 3, 'center');
    }
    let year = 2127;
    if (playing) {
      if (cue < S.launch) year = 2050 + 11 * clamp01(at / cues[S.launch].t0);
      else if (cue < S.fell) year = 2061;
      else if (cue < S.rock) year = 2061 + 22 * clamp01((at - cues[S.fell].t0) / (cues[S.rock].t0 - cues[S.fell].t0));
      else if (cue < S.closed) year = 2083 + 44 * clamp01((at - cues[S.rock].t0) / (cues[S.closed].t0 - cues[S.rock].t0));
    }
    c.fillStyle = INK.amber;
    c.beginPath();
    c.moveTo(yr(year), ty - 4);
    c.lineTo(yr(year) - 8, ty - 18);
    c.lineTo(yr(year) + 8, ty - 18);
    c.closePath();
    c.fill();
    // Transcript, the spoken line bright, scrolled to keep it in view.
    const RX = X + 740;
    const RW = SCREEN_W - GRID.m - RX;
    const font = `400 30px ${FONT.serif}`;
    const blocks = cues.map((q) => this.wrap(q.text, font, RW));
    const heights = blocks.map((b) => b.length * 40 + 12);
    const top = GRID.contentY + 70;
    const bottom = GRID.contentY + GRID.contentH - 20;
    let offset = 0;
    if (playing && cue > 0) {
      const before = heights.slice(0, cue).reduce((a, b) => a + b, 0);
      offset = Math.max(0, before - (bottom - top) * 0.35);
    }
    c.save();
    c.beginPath();
    c.rect(RX - 10, top - 10, RW + 20, bottom - top + 10);
    c.clip();
    let y = top + 30 - offset;
    blocks.forEach((b, i) => {
      const color = !playing ? INK.dim : i === cue && at <= cues[i].t1 + 0.6 ? INK.ink : i < cue || (i === cue && at > cues[i].t1 + 0.6) ? INK.faint : INK.ghost;
      for (const l of b) {
        this.text(l, RX, y, font, color);
        y += 40;
      }
      y += 12;
    });
    c.restore();
    if (!playing) this.text('⏎  PLAY', RX, bottom + 4, `600 20px ${FONT.mono}`, INK.amberDim, 4);
  }

/**
   * The story's captions and insets, line by line (found by their words): a caption typed under
   * the title; the seed's parts; the years in flight and of the building counted; the shell's
   * diameter dimensioned; the roof lit; the city in a zoomed inset.
   */
  private storyOverlay(cue: number, p: number, playing: boolean, t: number, cx: number, cy: number, shellR: number): void {
    const c = this.ctx;
    const X = GRID.contentX;
    const cues = NARRATION.T2.cues;
    const has = (w: string) => playing && cues[cue]?.text.includes(w);
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    let caption = '';
    if (has('small enough')) caption = 'A SEED';
    else if (has('2061')) caption = 'LAUNCH · SOL · 2061';
    else if (has('forge and a memory')) caption = 'SAIL · FORGE · MEMORY';
    else if (has('fell toward')) caption = `IN FLIGHT AT 0.2 c · ${Math.round(22 * clamp01(p * 1.1))} OF 22 YEARS`;
    else if (has('found rock')) caption = 'ARRIVAL · ALPHA CENTAURI · 2083';
    else if (has('tools out of')) caption = 'FORGES · FOUNDRIES · FOUNDRIES FOR FOUNDRIES';
    else if (has('built to stop')) caption = 'SELF-REPLICATING';
    else if (has('40 years')) caption = `TAKING THE SYSTEM APART · ${Math.round(40 * clamp01(p))} OF 40 YEARS`;
    else if (has('plates met')) caption = 'PLATES LAID · THE SHELL MEETS ITSELF';
    else if (has('sphere closed')) caption = 'CLOSED · 2127';
    else if (has('2 million')) caption = '2,000,000 KM ACROSS';
    else if (has('roof')) caption = 'A STAR WITH A ROOF';
    else if (has('On the inside')) caption = 'ONE POCKET OF AIR';
    else if (has('golden machines')) caption = 'THE FIELD · THE ROAD · THE HOUSE';
    else if (has('live there')) caption = 'ONE VACANCY';
    else if (has('where you come in')) caption = 'GUARDIAN';
    if (caption) {
      const n = Math.ceil(caption.length * clamp01(p * 3));
      this.text(caption.slice(0, n), X, GRID.contentY + 80, `600 20px ${FONT.mono}`, INK.amber, 4);
    }
    // The seed: a sail, a forge, a memory.
    if (has('forge and a memory') || has('small enough')) {
      const a = clamp01(p * 2.5);
      c.save();
      c.globalAlpha *= a;
      const sx = X + 470;
      const sy = GRID.contentY + 150;
      c.strokeStyle = INK.ink;
      c.lineWidth = 1.5;
      c.strokeRect(sx, sy, 110, 110);
      c.beginPath();
      for (const [ox, oy] of [[0, 0], [110, 0], [0, 110], [110, 110]]) {
        c.moveTo(sx + ox, sy + oy);
        c.lineTo(sx + 55, sy + 190);
      }
      c.stroke();
      c.fillStyle = INK.bronze;
      c.fillRect(sx + 43, sy + 186, 24, 18);
      c.fillStyle = INK.amber;
      c.beginPath();
      c.arc(sx + 55, sy + 222, 6, 0, Math.PI * 2);
      c.fill();
      if (has('forge and a memory')) {
        this.text('SAIL', sx + 124, sy + 60, `600 15px ${FONT.mono}`, INK.dim, 3);
        this.text('FORGE', sx + 80, sy + 200, `600 15px ${FONT.mono}`, INK.dim, 3);
        this.text('MEMORY', sx + 72, sy + 228, `600 15px ${FONT.mono}`, INK.dim, 3);
      }
      c.restore();
    }
    // The shell's diameter, dimensioned.
    if (has('2 million')) {
      const u = clamp01(p * 2);
      const y = cy - shellR - 40;
      c.strokeStyle = INK.amber;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(cx - shellR * u, y);
      c.lineTo(cx + shellR * u, y);
      for (const sgn of [-1, 1]) {
        c.moveTo(cx + sgn * shellR * u, y);
        c.lineTo(cx + sgn * (shellR * u - 12), y - 7);
        c.moveTo(cx + sgn * shellR * u, y);
        c.lineTo(cx + sgn * (shellR * u - 12), y + 7);
        c.moveTo(cx + sgn * shellR, y - 14);
        c.lineTo(cx + sgn * shellR, y + 14);
      }
      c.stroke();
    }
    // The roof: the whole shell lit round the star.
    if (has('roof')) {
      c.strokeStyle = `rgba(255, 184, 104, ${(0.35 * clamp01(p * 2) * (0.8 + 0.2 * Math.sin(t * 4))).toFixed(3)})`;
      c.lineWidth = 26;
      c.beginPath();
      c.arc(cx, cy, shellR, 0, Math.PI * 2);
      c.stroke();
    }
    // The city: a zoomed inset from its place on the shell, from "On the inside" to the end.
    const from = cues.findIndex((q) => q.text.includes('On the inside'));
    if (!playing || cue >= from) {
      const u = playing && cue === from ? clamp01(p * 2) : 1;
      const px = cx;
      const py = cy + shellR - 14;
      const ix = X + 600;
      const iy = cy + 170;
      const ir = 92 * u;
      c.strokeStyle = INK.amberDim;
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(px + 10, py + 4);
      c.lineTo(ix - ir * 0.7, iy - ir * 0.7);
      c.stroke();
      if (ir > 4) {
        c.save();
        c.beginPath();
        c.arc(ix, iy, ir, 0, Math.PI * 2);
        c.fillStyle = INK.bg;
        c.fill();
        c.clip();
        drawPlan(c, ix - ir * 1.05, iy - ir * 1.05, ir * 2.1, ir * 2.1, t, null, [], false);
        c.restore();
        c.strokeStyle = INK.amber;
        c.lineWidth = 2;
        c.beginPath();
        c.arc(ix, iy, ir, 0, Math.PI * 2);
        c.stroke();
        this.text('DYSON CITY', ix, iy + ir + 30, `600 15px ${FONT.mono}`, INK.dim, 3, 'center');
      }
    }
  }

  /** Archive · The Shell: its particulars, and the sphere drawn to scale about the eye. */
  private particulars(): void {
    const X = GRID.contentX;
    PARTICULARS.forEach(([k, v], i) => {
      const y = GRID.contentY + 100 + i * 70;
      this.text(k.toUpperCase(), X, y, `600 17px ${FONT.mono}`, INK.faint, 3);
      this.text(v, X + 300, y + 2, `400 28px ${FONT.sans}`, INK.ink, 0.3);
      this.rule(X, y + 26, X + 820, INK.ghost);
    });
    // The section: shell radius 1, the star's radius 0.707, the eye on the shell under it.
    const c = this.ctx;
    const cx = X + 1050;
    const cy = GRID.contentY + 400;
    const R = 220;
    c.strokeStyle = INK.bronze;
    c.lineWidth = 6;
    for (let i = 0; i < 12; i++) {
      const a0 = (i / 12) * Math.PI * 2 + 0.05;
      c.beginPath();
      c.arc(cx, cy, R, a0, a0 + (Math.PI * 2) / 12 - 0.1);
      c.stroke();
    }
    const sg = c.createRadialGradient(cx, cy, 0, cx, cy, R * 0.7073);
    sg.addColorStop(0, 'rgba(255, 248, 232, 0.95)');
    sg.addColorStop(1, 'rgba(255, 196, 130, 0.5)');
    c.fillStyle = sg;
    c.beginPath();
    c.arc(cx, cy, R * 0.7073, 0, Math.PI * 2);
    c.fill();
    // The eye at the bottom of the shell: the star fills the 90° cone over it.
    const ey = cy + R;
    c.strokeStyle = INK.amberDim;
    c.lineWidth = 1.5;
    const half = Math.PI / 4;
    for (const s of [-1, 1]) {
      c.beginPath();
      c.moveTo(cx, ey);
      c.lineTo(cx + s * Math.sin(half) * R * 1.2, ey - Math.cos(half) * R * 1.2);
      c.stroke();
    }
    c.fillStyle = INK.amber;
    c.beginPath();
    c.arc(cx, ey, 6, 0, Math.PI * 2);
    c.fill();
    this.text('90° OF SKY', cx + Math.sin(half) * R * 1.2 + 10, ey - Math.cos(half) * R * 1.2 - 10, `600 16px ${FONT.mono}`, INK.amber, 3);
    this.text('YOU', cx, ey + 40, `600 16px ${FONT.mono}`, INK.amber, 3, 'center');
    this.text('TO SCALE', cx, cy - R - 40, `600 15px ${FONT.mono}`, INK.faint, 4, 'center');
  }

  private planPage(live: TerminalLive, t: number): void {
    const s = GRID.contentH - 70;
    drawPlan(this.ctx, GRID.contentX + (GRID.contentW - s) / 2, GRID.contentY + 50, s, s, t, { craft: live.craft });
  }

  /** Control: the status rows (and on the open page the live plan beside them). */
  private status(os: TerminalOS, live: TerminalLive, t: number, open: boolean): void {
    const c = this.ctx;
    const X = GRID.contentX;
    const planW = open ? 560 : 0;
    const box: Box = { x: X, y: GRID.contentY + 90, w: planW - 30, h: planW - 70 };
    if (open && !this.briefing(os, t, 'T3', (i, p) => statusBeat(c, i, p, t, box))) drawPlan(c, X - 10, GRID.contentY + 70, planW, planW, t, { craft: live.craft }, this.heroesFor(os, t));
    const RX = X + (open ? planW + 40 : 0);
    const R1 = SCREEN_W - GRID.m;
    const lit = new Set<StatusRow>();
    const sub = os.subtitle(t);
    if (open && sub?.clip === 'T3') for (const r of STATUS_CUE_ROWS[sub.index] ?? []) lit.add(r);
    else if (open && !os.playback) lit.add(STATUS_ROWS[os.row].id);
    const craft = CRAFT_STATUS[live.craft.phase] ?? 'CLEAR';
    const values: Record<StatusRow, [string, string]> = {
      precincts: ['NOMINAL', '7 of 7'],
      veil: ['NORMAL LOAD', '38 %'],
      spin: ['STEADY', '3.0° / min'],
      gyre: ['AGREES', 'Δ 0.000°'],
      hold: ['FULL', '100 %'],
      craft: ['ON SCHEDULE', craft],
      lock: [lockState(live.lock, 'THE BAND', 'THE CITY'), 'East Collar'],
      gate: [lockState(live.gate, 'THE BAND', 'THE CITY'), 'Gate Court'],
      faults: ['NONE', '0 · 0'],
      kettle: ['KETTLE ON', 'requester —'],
    };
    const rowH = open ? 76 : 70;
    STATUS_ROWS.forEach((r, i) => {
      const y = GRID.contentY + 80 + i * rowH;
      if (lit.has(r.id)) {
        c.fillStyle = INK.amberGhost;
        c.fillRect(RX - 16, y - 4, R1 - RX + 16, rowH - 10);
        c.fillStyle = INK.amber;
        c.fillRect(RX - 16, y - 4, 4, rowH - 10);
      }
      const [v, d] = values[r.id];
      this.text(r.label.toUpperCase(), RX, y + 38, `600 17px ${FONT.mono}`, lit.has(r.id) ? INK.ink : INK.faint, 3);
      const vx = RX + (open ? 250 : 380);
      const good = r.id !== 'kettle';
      c.fillStyle = good ? INK.ok : INK.amber;
      c.beginPath();
      c.arc(vx - 22, y + 31, 6, 0, Math.PI * 2);
      c.fill();
      this.text(v, vx, y + 40, `500 ${open ? 25 : 28}px ${FONT.sans}`, INK.ink, 1);
      // Beside the plan the row is too narrow for a bar: the figure says it.
      if (!open && (r.id === 'veil' || r.id === 'hold')) {
        const bx = R1 - 260;
        this.rule(bx, y + 32, R1 - 90, INK.ghost);
        c.fillStyle = INK.bronze;
        c.fillRect(bx, y + 30, (R1 - 90 - bx) * (r.id === 'veil' ? 0.38 : 1), 5);
        this.text(d, R1, y + 40, `500 20px ${FONT.mono}`, INK.dim, 1, 'right');
      } else this.text(d, R1, y + 40, `500 ${open ? 16 : 20}px ${FONT.mono}`, INK.dim, 1, 'right');
    });
  }

  private heroesFor(os: TerminalOS, t: number): string[] {
    const sub = os.subtitle(t);
    const rows = sub?.clip === 'T3' ? (STATUS_CUE_ROWS[sub.index] ?? []) : os.playback ? [] : [STATUS_ROWS[os.row].id];
    const out: string[] = [];
    for (const r of rows) {
      if (r === 'gyre' || r === 'spin') out.push('GYRE');
      if (r === 'hold') out.push('COLD HOLD');
      if (r === 'craft') out.push('MAST');
    }
    return out;
  }

  /** Observatory: the star's oscillation spectrum, the signal itself, the readouts. */
  private feed(os: TerminalOS, t: number, open: boolean): void {
    const c = this.ctx;
    const X = GRID.contentX;
    const R1 = SCREEN_W - GRID.m;
    const box: Box = { x: X, y: GRID.contentY + 60, w: R1 - X, h: GRID.contentH - 120 };
    if (open && this.briefing(os, t, 'T6', (i, p) => feedBeat(c, i, p, t, box))) return;
    const song = open && os.song && t >= os.song.start;
    // Excitation: each mode's amplitude wanders (stochastic driving, damped).
    if (song) {
      const dt = Math.min(0.2, Math.max(0, t - this.excitedAt));
      for (let i = 0; i < this.excite.length; i++) this.excite[i] = Math.max(0.15, Math.min(1.3, this.excite[i] + (Math.random() - 0.5) * dt * 2.4 - (this.excite[i] - 0.7) * dt * 0.8));
    }
    this.excitedAt = t;
    // Spectrum.
    const top = GRID.contentY + 80;
    const h = 330;
    const nu0 = 1600;
    const nu1 = 3200;
    const fx = (nu: number) => X + ((nu - nu0) / (nu1 - nu0)) * (R1 - X);
    this.rule(X, top + h, R1, INK.faint);
    for (let nu = 1800; nu <= 3000; nu += 200) {
      const x = fx(nu);
      c.fillStyle = INK.ghost;
      c.fillRect(x, top, 1, h);
      this.text(String(nu), x, top + h + 34, `500 17px ${FONT.mono}`, INK.faint, 1, 'center');
      this.text(`${Math.round(nu / 10)} Hz`, x, top - 14, `500 15px ${FONT.mono}`, INK.ghost, 1, 'center');
    }
    this.text('µHz', R1, top + h + 34, `600 15px ${FONT.mono}`, INK.faint, 2, 'right');
    // Noise floor (granulation), then the modes.
    c.strokeStyle = 'rgba(255, 236, 200, 0.22)';
    c.lineWidth = 1.5;
    c.beginPath();
    for (let i = 0; i <= 200; i++) {
      const nu = nu0 + ((nu1 - nu0) * i) / 200;
      const y = top + h - 14 - 10 * Math.exp(-(nu - nu0) / 900) - (song ? 4 * Math.sin(i * 1.3 + t * 7) * Math.sin(i * 0.37) : 0);
      if (i === 0) c.moveTo(fx(nu), y);
      else c.lineTo(fx(nu), y);
    }
    c.stroke();
    this.modes.forEach((m, i) => {
      const a = m.amp * (song ? this.excite[i] : 0.7);
      const x = fx(m.nu);
      const hh = a * (h - 40);
      c.fillStyle = m.l === 0 ? INK.amber : m.l === 1 ? INK.bronze : 'rgba(255, 214, 160, 0.75)';
      c.fillRect(x - 2, top + h - hh, 4, hh);
    });
    // The large separation, bracketed between two radial modes near νmax.
    const n0 = Math.round(STAR_MODES.numax / STAR_MODES.dnu - STAR_MODES.epsilon);
    const a = STAR_MODES.dnu * (n0 + STAR_MODES.epsilon);
    const b = a + STAR_MODES.dnu;
    const by = top + 30;
    c.strokeStyle = INK.dim;
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(fx(a), by + 10);
    c.lineTo(fx(a), by);
    c.lineTo(fx(b), by);
    c.lineTo(fx(b), by + 10);
    c.stroke();
    this.text(`Δν ${STAR_MODES.dnu} µHz`, (fx(a) + fx(b)) / 2, by - 12, `600 16px ${FONT.mono}`, INK.dim, 2, 'center');
    // The signal itself: a fifth of a second of what is heard, in its own band.
    const sy = top + h + 170;
    const sh = 70;
    this.text('SIGNAL · 0.2 s', X, sy - sh - 6, `600 15px ${FONT.mono}`, INK.faint, 3);
    this.rule(X, sy, R1, INK.ghost);
    c.save();
    c.beginPath();
    c.rect(X, sy - sh, R1 - X, 2 * sh);
    c.clip();
    c.strokeStyle = song ? INK.ink : INK.faint;
    c.lineWidth = 2;
    c.beginPath();
    const span = 0.2;
    let norm = 0;
    this.modes.forEach((m, k) => (norm += m.amp * (song ? this.excite[k] : 0.7)));
    for (let i = 0; i <= 600; i++) {
      const tau = (song ? t : 0) + (i / 600) * span;
      let v = 0;
      this.modes.forEach((m, k) => {
        v += m.amp * (song ? this.excite[k] : 0.7) * Math.sin(2 * Math.PI * (m.nu * 1e-6 * STAR_MODES.speed) * tau + k * 2.1);
      });
      const y = sy - (v / Math.max(norm, 1e-6)) * sh * 1.6;
      const x = X + ((R1 - X) * i) / 600;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
    c.restore();
    // Readouts.
    const ry = sy + sh + 70;
    const reads: [string, string][] = [
      ['νMAX', `${STAR_MODES.numax} µHz`],
      ['SURFACE ACTIVITY', 'NORMAL'],
      ['FLARE FORECAST', 'NONE'],
      ['PLAYBACK', '× 100 000'],
    ];
    reads.forEach(([k, v], i) => {
      const x = X + i * ((R1 - X) / 4);
      this.text(k, x, ry, `600 16px ${FONT.mono}`, INK.faint, 3);
      this.text(v, x, ry + 44, `500 30px ${FONT.sans}`, i === 3 && song ? INK.amber : INK.ink, 0.5);
    });
    if (open && !os.playback && !os.song) this.text('⏎  LISTEN', X, GRID.contentY + GRID.contentH - 4, `600 20px ${FONT.mono}`, INK.amberDim, 4);
  }
}
