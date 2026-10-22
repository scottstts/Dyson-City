import type { FatalDiagnostics } from '../core/fatal';
import { SphereGlyph } from './sphereGlyph';
import { chatterOrder } from './chatter';
import { KEY_ART } from './keyArt';

/** A new overheard line every 5 s while loading, the stills' cadence. */
const CHATTER_TURN_MS = 5000;
/** Each line's fade in and out. */
const CHATTER_FADE_MS = 600;

/**
 * The entry screen. Loading is the city's stills in turn, each slowly closing in, and low in the
 * corner the sphere, its frame lighting member by member round its star as its band
 * turns, beside an overheard line; ready is the live world behind it, the name and a word to step in. The
 * same surface reports platform-gate refusals and boot/runtime failures (the frame goes dark).
 */
export class EntryScreen {
  readonly root: HTMLDivElement;
  private readonly glyph = new SphereGlyph();
  private readonly enter: HTMLButtonElement;
  private readonly keys: HTMLDivElement;
  private readonly message: HTMLDivElement;
  /** The overheard lines' turns, one opacity animation each. */
  private readonly chatter: Animation[] = [];
  private onEnter: (() => void) | null = null;

  constructor(host: HTMLElement) {
    this.root = el('div', 'entry');
    // The stills take turns (style.css .entry-still), starting from a different one each visit; the
    // cycle starts once the first is decoded, and a still that is not yet in shows the tinted ground.
    const art = el('div', 'entry-art');
    const first = Math.floor(Math.random() * KEY_ART.length);
    KEY_ART.forEach((_, i) => {
      const name = KEY_ART[(first + i) % KEY_ART.length];
      const layer = el('div', 'entry-still');
      art.appendChild(layer);
      const still = new Image();
      still.decoding = 'async';
      still.src = `${import.meta.env.BASE_URL}keyart/${name}.webp`;
      void still
        .decode()
        .then(() => {
          layer.style.backgroundImage = `url("${still.src}")`;
          if (i === 0) art.classList.add('is-shown');
        })
        .catch(() => {
          // No still: the tinted ground in its turn.
        });
    });
    const tint = el('div', 'entry-tint');
    const centre = el('div', 'entry-centre');
    const mark = el('div', 'entry-mark');
    mark.textContent = 'DYSON';
    this.enter = el('button', 'entry-enter');
    this.enter.type = 'button';
    this.enter.textContent = 'Enter';
    this.enter.tabIndex = -1;
    centre.append(mark, this.enter);

    // The sphere leads the overheard line, low in the corner.
    const corner = el('div', 'entry-corner');
    const chatter = el('div', 'entry-chatter');
    // Every line is in place, stacked, and takes its turn by opacity alone: a compositor animation
    // keeps the 5 s cadence while boot blocks the main thread, where timers would fire late.
    const lines = chatterOrder();
    const cycle = lines.length * CHATTER_TURN_MS;
    const turn: Keyframe[] = [
      { offset: 0, opacity: 0 },
      { offset: CHATTER_FADE_MS / cycle, opacity: 1 },
      { offset: (CHATTER_TURN_MS - CHATTER_FADE_MS) / cycle, opacity: 1 },
      { offset: CHATTER_TURN_MS / cycle, opacity: 0 },
      { offset: 1, opacity: 0 },
    ];
    lines.forEach((line, i) => {
      const node = el('div', 'entry-chatter-line');
      node.append(textBlock('entry-chatter-from', line.from), textBlock('entry-chatter-text', line.text));
      chatter.appendChild(node);
      // The first line is up from the start.
      if (typeof node.animate === 'function') this.chatter.push(node.animate(turn, { duration: cycle, iterations: Infinity, delay: i * CHATTER_TURN_MS - CHATTER_FADE_MS, fill: 'both' }));
      else if (i === 0) node.style.opacity = '1';
    });
    corner.append(this.glyph.root, chatter);

    this.keys = el('div', 'entry-keys');
    this.keys.append(keyGroup(['W', 'A', 'S', 'D'], 'walk'), keyGroup(['⇧'], 'run'), keyGroup(['E'], 'use'), keyGroup(['esc'], 'pause'));

    this.message = el('div', 'entry-message');
    this.message.hidden = true;

    this.root.append(art, tint, centre, corner, this.keys, this.message);
    // Ready, the whole screen is the way in.
    this.root.addEventListener('click', () => {
      if (this.root.classList.contains('is-ready')) this.onEnter?.();
    });
    host.appendChild(this.root);
  }

  setProgress(fraction: number): void {
    this.glyph.setLit(fraction);
  }

  showReady(onEnter: () => void): void {
    this.onEnter = onEnter;
    this.glyph.setLit(1);
    // The line holds as the corner fades.
    for (const a of this.chatter) a.pause();
    this.enter.tabIndex = 0;
    this.root.classList.add('is-ready');
  }

  hide(): void {
    this.stopChatter();
    this.glyph.stop();
    this.root.classList.add('is-hidden');
  }

  show(): void {
    this.root.classList.remove('is-hidden');
  }

  showUnsupported(reason: string, detail: string): void {
    this.message.replaceChildren(textBlock('entry-message-title', 'This browser can’t reach Dyson'), textBlock('entry-message-body', reason), textBlock('entry-message-detail', detail));
    this.fail();
  }

  showError(diag: FatalDiagnostics): void {
    const table = el('dl', 'entry-diag');
    for (const [k, v] of diag.details) {
      const dt = el('dt', '');
      dt.textContent = k;
      const dd = el('dd', '');
      dd.textContent = v;
      table.append(dt, dd);
    }
    this.message.replaceChildren(textBlock('entry-message-title', diag.title), textBlock('entry-message-body', diag.message), table);
    this.fail();
  }

  private fail(): void {
    this.stopChatter();
    this.glyph.stop();
    this.onEnter = null;
    this.message.hidden = false;
    this.root.classList.remove('is-ready');
    this.root.classList.add('is-error');
    this.show();
  }

  private stopChatter(): void {
    for (const a of this.chatter) a.cancel();
  }
}

function keyGroup(caps: string[], word: string): HTMLDivElement {
  const group = el('div', 'entry-key-group');
  for (const c of caps) {
    const cap = el('span', 'key-cap');
    cap.textContent = c;
    group.appendChild(cap);
  }
  const label = el('span', 'entry-key-word');
  label.textContent = word;
  group.appendChild(label);
  return group;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function textBlock(className: string, text: string): HTMLDivElement {
  const node = el('div', className);
  node.textContent = text;
  return node;
}
