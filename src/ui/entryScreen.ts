import type { FatalDiagnostics } from '../core/fatal';

/**
 * The entry screen: title, loading progress, Enter. The same surface reports platform-gate
 * refusals and boot/runtime failures.
 */
export class EntryScreen {
  readonly root: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private readonly progress: HTMLDivElement;
  private readonly enter: HTMLButtonElement;
  private readonly message: HTMLDivElement;
  private onEnter: (() => void) | null = null;

  constructor(host: HTMLElement) {
    this.root = el('div', 'entry');
    const card = el('div', 'entry-card');
    const title = el('h1', 'entry-title');
    title.textContent = 'DYSON';
    const sub = el('div', 'entry-sub');
    sub.textContent = 'A city on the inner face of a Dyson sphere';
    this.progress = el('div', 'entry-progress');
    this.bar = el('div', 'entry-progress-bar');
    this.progress.appendChild(this.bar);
    this.status = el('div', 'entry-status');
    this.enter = el('button', 'entry-enter');
    this.enter.type = 'button';
    this.enter.textContent = 'Enter';
    this.enter.hidden = true;
    this.enter.addEventListener('click', () => this.onEnter?.());
    this.message = el('div', 'entry-message');
    this.message.hidden = true;
    card.append(title, sub, this.progress, this.status, this.enter, this.message);
    this.root.appendChild(card);
    host.appendChild(this.root);
  }

  setProgress(fraction: number, label: string): void {
    this.progress.hidden = false;
    this.bar.style.transform = `scaleX(${Math.min(1, Math.max(0, fraction)).toFixed(3)})`;
    this.status.textContent = label;
  }

  showReady(onEnter: () => void): void {
    this.onEnter = onEnter;
    this.progress.hidden = true;
    this.status.textContent = 'Click to enter · WASD to walk · Shift to run · Esc to pause';
    this.enter.hidden = false;
    this.root.classList.add('is-ready');
  }

  hide(): void {
    this.root.classList.add('is-hidden');
  }

  show(): void {
    this.root.classList.remove('is-hidden');
  }

  showUnsupported(reason: string, detail: string): void {
    this.progress.hidden = true;
    this.enter.hidden = true;
    this.status.textContent = '';
    this.message.hidden = false;
    this.message.replaceChildren(textBlock('entry-message-title', 'Unsupported platform'), textBlock('entry-message-body', reason), textBlock('entry-message-detail', detail));
    this.root.classList.add('is-error');
    this.show();
  }

  showError(diag: FatalDiagnostics): void {
    this.progress.hidden = true;
    this.enter.hidden = true;
    this.status.textContent = '';
    const table = el('dl', 'entry-diag');
    for (const [k, v] of diag.details) {
      const dt = el('dt', '');
      dt.textContent = k;
      const dd = el('dd', '');
      dd.textContent = v;
      table.append(dt, dd);
    }
    this.message.hidden = false;
    this.message.replaceChildren(textBlock('entry-message-title', diag.title), textBlock('entry-message-body', diag.message), table);
    this.root.classList.add('is-error');
    this.show();
  }
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
