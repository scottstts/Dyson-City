/**
 * What lies between the eye and the picture during the intro (docs/intro-film.md): the eyelids and
 * the blur of waking, the fades to black between scenes, and the one hint the screen shows (Enter
 * skips, Space pauses). DOM layers over the canvas: compositor work, nothing in the render pipeline, and gone
 * when the intro ends.
 *
 * Waking (scene 1): black with the cabin's hum, then heavy lids lift partway, fall, lift again with
 * the world out of focus, a slow blink, and the eyes open and focus. Ordinary blinks are not shown:
 * nobody sees their own.
 */
import type { Timeline } from './timeline';
import { exposureFade } from './timeline';

/** The lids' openness (0 shut … 1 open) over the wake-up, seconds after the eyes first open. */
const WAKE_LIDS: readonly [number, number][] = [
  [0, 0],
  [0.45, 0.32],
  [0.75, 0.3],
  [0.98, 0.02],
  [1.4, 0.0],
  [1.85, 0.62],
  [2.6, 0.7],
  [2.72, 0.05],
  [2.9, 0.86],
  [3.6, 0.92],
  [3.68, 0.1],
  [3.84, 1],
];
/** Out of focus as they open (CSS px of blur at the canvas), sharp by the end of the wake. */
const WAKE_BLUR: readonly [number, number][] = [
  [0, 9],
  [1.85, 7],
  [2.9, 3.5],
  [3.9, 0.6],
  [4.6, 0],
];

function track(keys: readonly [number, number][], t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      const u = (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * u * u * (3 - 2 * u);
    }
  }
  return keys[keys.length - 1][1];
}

export class IntroOverlay {
  private readonly root: HTMLDivElement;
  private readonly veil: HTMLDivElement;
  private readonly lidTop: HTMLDivElement;
  private readonly lidBottom: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly pauseWord: HTMLSpanElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly tl: Timeline;
  private blur = -1;

  constructor(host: HTMLElement, canvas: HTMLCanvasElement, tl: Timeline) {
    this.canvas = canvas;
    this.tl = tl;
    this.root = div('intro-overlay');
    this.lidTop = div('intro-lid intro-lid-top');
    this.lidBottom = div('intro-lid intro-lid-bottom');
    this.veil = div('intro-veil');
    this.hint = div('intro-hint');
    const key = (cap: string, word: string): HTMLSpanElement => {
      const k = document.createElement('span');
      k.className = 'key-cap';
      k.textContent = cap;
      const w = document.createElement('span');
      w.className = 'intro-hint-word';
      w.textContent = word;
      this.hint.append(k, w);
      return w;
    };
    key('Enter', 'skip');
    this.pauseWord = key('Space', 'pause');
    this.root.append(this.lidTop, this.lidBottom, this.veil, this.hint);
    this.root.hidden = true;
    host.appendChild(this.root);
  }

  show(): void {
    this.root.hidden = false;
    // The keys stay in the corner, quiet, for as long as the intro runs.
    this.hint.classList.add('is-shown');
  }

  /** The hint's keys shown or not (the review mode has its own readout), and the pause key's word. */
  setHint(shown: boolean): void {
    this.hint.hidden = !shown;
  }

  setPaused(paused: boolean): void {
    this.pauseWord.textContent = paused ? 'play' : 'pause';
  }

  /** Review (intro/review.ts): the lids, the fades and the blur taken off, to see under them. */
  enabled = true;

  /** Sets the layers for intro time t. */
  update(t: number): void {
    const s1 = this.tl.scene1;
    const since = t - s1.wake;
    const on = this.enabled;
    const open = !on ? 1 : t < s1.wake ? 0 : t < s1.end ? track(WAKE_LIDS, since) : 1;
    // Shut, the lids' opaque parts meet at the middle; their soft edges are part of their height.
    const cover = (1 - open) * 68;
    this.lidTop.style.transform = `translateY(${(cover - 62).toFixed(2)}vh)`;
    this.lidBottom.style.transform = `translateY(${(62 - cover).toFixed(2)}vh)`;
    // Shut eyes see nothing at all, whatever the lids' soft edges let through.
    const shut = open <= 0.001 ? 1 : 0;
    this.veil.style.opacity = on ? Math.max(1 - exposureFade(this.tl, t), shut).toFixed(3) : '0';
    const blur = !on ? 0 : t < s1.wake ? 9 : t < s1.end ? track(WAKE_BLUR, since) : 0;
    const rounded = Math.round(blur * 4) / 4;
    if (rounded !== this.blur) {
      this.blur = rounded;
      this.canvas.style.filter = rounded > 0 ? `blur(${rounded}px)` : '';
    }
  }

  hide(): void {
    this.root.hidden = true;
    this.canvas.style.filter = '';
    this.blur = -1;
  }

  dispose(): void {
    this.hide();
    this.root.remove();
  }
}

function div(className: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = className;
  return d;
}
