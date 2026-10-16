/**
 * The interaction prompt: a small key cap and a word, low in the middle of the screen, shown only
 * while something can be used (a door's handle within reach under the eye). Minimal by design:
 * it fades in and out, and says nothing else.
 */
export class InteractionPrompt {
  private readonly root: HTMLDivElement;
  private readonly word: HTMLSpanElement;
  private shown: string | null = null;

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'prompt';
    const key = document.createElement('span');
    key.className = 'prompt-key';
    key.textContent = 'E';
    this.word = document.createElement('span');
    this.word.className = 'prompt-word';
    this.root.append(key, this.word);
    host.appendChild(this.root);
  }

  /** Shows the action (e.g. "Open"), or hides the prompt with null. */
  set(action: string | null): void {
    if (action === this.shown) return;
    this.shown = action;
    if (action) this.word.textContent = action;
    this.root.classList.toggle('is-shown', action !== null);
  }
}
