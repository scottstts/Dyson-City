/**
 * The intro's review mode (`?introReview`, local hosts only; docs/intro-film.md): the intro alone,
 * over and over, without reloading the game. It never hands over to play: at its end, and on
 * Enter, it starts again. The film can be held and scrubbed, its scenes jumped to, and the lids
 * and fades taken off to see what is under them. A small readout shows where the film is.
 *
 *   Space        hold / run
 *   ← →          5 s back / on (held: 1 s)
 *   , .          one frame (1/30 s) back / on, and hold
 *   1 2 3        the start of scene 1, 2, 3
 *   R, Enter     from the start
 *   O            the lids and fades off / on
 */
import type { Input } from '../player/input';
import type { Intro } from './intro';
import { sceneAt } from './timeline';

const KEYS = 'Space hold · ←→ 5 s (held 1 s) · ,. frame · 1 2 3 scene · R restart · O lids';

export class IntroReview {
  private readonly intro: Intro;
  private readonly root: HTMLDivElement;
  private readonly readout: HTMLDivElement;
  private shown = '';

  constructor(intro: Intro, host: HTMLElement) {
    this.intro = intro;
    this.root = document.createElement('div');
    this.root.className = 'intro-review';
    this.readout = document.createElement('div');
    this.readout.className = 'intro-review-time';
    const keys = document.createElement('div');
    keys.className = 'intro-review-keys';
    keys.textContent = KEYS;
    this.root.append(this.readout, keys);
    host.appendChild(this.root);
    intro.setHint(false);
  }

  /** Per frame, before the intro advances: the keys. */
  update(input: Input): void {
    const it = this.intro;
    const tl = it.timeline;
    const t = it.clock;
    const held = it.held;
    if (input.consumePress('Space')) it.seek(t, !held);
    const step = held ? 1 : 5;
    if (input.consumePress('ArrowLeft')) it.seek(t - step, held);
    if (input.consumePress('ArrowRight')) it.seek(t + step, held);
    if (input.consumePress('Comma')) it.seek(t - 1 / 30, true);
    if (input.consumePress('Period')) it.seek(t + 1 / 30, true);
    const starts = [tl.scene1.start, tl.scene2.start, tl.scene3.start];
    starts.forEach((s, i) => {
      if (input.consumePress(`Digit${i + 1}`)) it.seek(s, held);
    });
    if (input.consumePress('KeyR') || input.consumePress('Enter') || input.consumePress('NumpadEnter')) it.seek(0, false);
    if (input.consumePress('KeyO')) it.setOverlay(!it.overlayOn);
  }

  /** The film reached its end: again from the start. */
  loop(): void {
    this.intro.seek(0, false);
  }

  /** Per frame, after the intro: the readout (written only when it changes). */
  show(): void {
    const it = this.intro;
    const t = it.clock;
    const text = `INTRO ${t.toFixed(1).padStart(5)} / ${it.timeline.end.toFixed(1)} s · scene ${sceneAt(it.timeline, t)}${it.held ? ' · held' : ''}${it.overlayOn ? '' : ' · lids off'}`;
    if (text !== this.shown) {
      this.readout.textContent = text;
      this.shown = text;
    }
  }
}
