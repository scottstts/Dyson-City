import type { FatalDiagnostics } from '../core/fatal';
import { SphereGlyph } from './sphereGlyph';
import { chatterOrder, type ChatterLine } from './chatter';
import { KEY_ART } from './keyArt';

/** How long each overheard line stays up while loading. */
const CHATTER_HOLD_MS = 6500;
/** Its fade (matches .entry-chatter's transition). */
const CHATTER_FADE_MS = 600;

/**
 * The entry screen. Loading is the sphere's frame lighting member by member round its star over a
 * slowly drifting still of the city, with an overheard line low in the corner; ready is the live
 * world behind it and a word to step in. The
 * same surface reports platform-gate refusals and boot/runtime failures (the frame goes dark).
 */
export class EntryScreen {
  readonly root: HTMLDivElement;
  private readonly glyph = new SphereGlyph();
  private readonly chatter: HTMLDivElement;
  private readonly chatterFrom: HTMLDivElement;
  private readonly chatterText: HTMLDivElement;
  private readonly enter: HTMLButtonElement;
  private readonly keys: HTMLDivElement;
  private readonly message: HTMLDivElement;
  private readonly lines = chatterOrder();
  private lineIndex = 0;
  private chatterTimer = 0;
  private onEnter: (() => void) | null = null;

  constructor(host: HTMLElement) {
    this.root = el('div', 'entry');
    const art = el('div', 'entry-art');
    const still = new Image();
    still.decoding = 'async';
    still.src = `${import.meta.env.BASE_URL}keyart/${KEY_ART[Math.floor(Math.random() * KEY_ART.length)]}.jpg`;
    void still
      .decode()
      .then(() => {
        art.style.backgroundImage = `url("${still.src}")`;
        art.classList.add('is-shown');
      })
      .catch(() => {
        // No still: the tinted ground alone.
      });
    const tint = el('div', 'entry-tint');
    const centre = el('div', 'entry-centre');
    const mark = el('div', 'entry-mark');
    mark.textContent = 'DYSON';
    this.enter = el('button', 'entry-enter');
    this.enter.type = 'button';
    this.enter.textContent = 'Enter';
    this.enter.tabIndex = -1;
    centre.append(this.glyph.root, mark, this.enter);

    this.chatter = el('div', 'entry-chatter');
    this.chatterFrom = el('div', 'entry-chatter-from');
    this.chatterText = el('div', 'entry-chatter-text');
    this.chatter.append(this.chatterFrom, this.chatterText);

    this.keys = el('div', 'entry-keys');
    this.keys.append(keyGroup(['W', 'A', 'S', 'D'], 'walk'), keyGroup(['⇧'], 'run'), keyGroup(['E'], 'use'), keyGroup(['esc'], 'pause'));

    this.message = el('div', 'entry-message');
    this.message.hidden = true;

    this.root.append(art, tint, centre, this.chatter, this.keys, this.message);
    // Ready, the whole screen is the way in.
    this.root.addEventListener('click', () => {
      if (this.root.classList.contains('is-ready')) this.onEnter?.();
    });
    host.appendChild(this.root);
    this.showLine(this.lines[0]);
    this.chatterTimer = window.setTimeout(() => this.nextLine(), CHATTER_HOLD_MS);
  }

  setProgress(fraction: number): void {
    this.glyph.setLit(fraction);
  }

  showReady(onEnter: () => void): void {
    this.onEnter = onEnter;
    this.glyph.setLit(1);
    this.stopChatter();
    this.enter.tabIndex = 0;
    this.root.classList.add('is-ready');
  }

  hide(): void {
    this.stopChatter();
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
    this.onEnter = null;
    this.message.hidden = false;
    this.root.classList.remove('is-ready');
    this.root.classList.add('is-error');
    this.show();
  }

  private showLine(line: ChatterLine): void {
    this.chatterFrom.textContent = line.from;
    this.chatterText.textContent = line.text;
  }

  private nextLine(): void {
    this.chatter.classList.add('is-fading');
    this.chatterTimer = window.setTimeout(() => {
      this.lineIndex = (this.lineIndex + 1) % this.lines.length;
      this.showLine(this.lines[this.lineIndex]);
      this.chatter.classList.remove('is-fading');
      this.chatterTimer = window.setTimeout(() => this.nextLine(), CHATTER_HOLD_MS);
    }, CHATTER_FADE_MS);
  }

  private stopChatter(): void {
    window.clearTimeout(this.chatterTimer);
    this.chatterTimer = 0;
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
