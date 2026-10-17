import { prefsGain, saveAudioPrefs, type AudioPrefs } from './audioPrefs';

/**
 * The pause menu over the frozen frame: one volume line and a mute, both remembered, and the way
 * back in (the button, or a click anywhere off the controls).
 */
export class PauseMenu {
  readonly root: HTMLDivElement;
  private onResume: (() => void) | null = null;
  private readonly prefs: AudioPrefs;
  private readonly onGain: (gain: number) => void;
  private readonly slider: HTMLInputElement;
  private readonly readout: HTMLSpanElement;
  private readonly mute: HTMLButtonElement;

  constructor(host: HTMLElement, prefs: AudioPrefs, onGain: (gain: number) => void) {
    this.prefs = prefs;
    this.onGain = onGain;
    this.root = document.createElement('div');
    this.root.className = 'pause is-hidden';
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.onResume?.();
    });

    const panel = div('pause-panel');
    const title = div('pause-title');
    title.textContent = 'Paused';

    const volume = document.createElement('label');
    volume.className = 'pause-volume';
    const name = document.createElement('span');
    name.className = 'pause-label';
    name.textContent = 'Volume';
    this.readout = document.createElement('span');
    this.readout.className = 'pause-readout';
    this.slider = document.createElement('input');
    this.slider.type = 'range';
    this.slider.className = 'pause-slider';
    this.slider.min = '0';
    this.slider.max = '100';
    this.slider.step = '1';
    this.slider.addEventListener('input', () => {
      this.prefs.volume = Number(this.slider.value) / 100;
      // Moving the volume is wanting sound.
      this.prefs.muted = false;
      this.commit();
    });
    volume.append(name, this.readout, this.slider);

    this.mute = document.createElement('button');
    this.mute.type = 'button';
    this.mute.className = 'pause-mute';
    this.mute.addEventListener('click', () => {
      this.prefs.muted = !this.prefs.muted;
      this.commit();
    });

    const resume = document.createElement('button');
    resume.type = 'button';
    resume.className = 'pause-resume';
    resume.textContent = 'Resume';
    resume.addEventListener('click', () => this.onResume?.());

    panel.append(title, volume, this.mute, resume);
    this.root.appendChild(panel);
    host.appendChild(this.root);
    this.reflect();
  }

  show(onResume: () => void): void {
    this.onResume = onResume;
    this.root.classList.remove('is-hidden');
  }

  hide(): void {
    this.root.classList.add('is-hidden');
  }

  private commit(): void {
    saveAudioPrefs(this.prefs);
    this.reflect();
    this.onGain(prefsGain(this.prefs));
  }

  private reflect(): void {
    const pct = Math.round(this.prefs.volume * 100);
    this.slider.value = String(pct);
    this.slider.style.setProperty('--fill', `${pct}%`);
    this.readout.textContent = String(pct);
    this.mute.textContent = this.prefs.muted ? 'Muted' : 'Mute';
    this.mute.setAttribute('aria-pressed', String(this.prefs.muted));
    this.root.classList.toggle('is-muted', this.prefs.muted);
  }
}

function div(className: string): HTMLDivElement {
  const node = document.createElement('div');
  node.className = className;
  return node;
}
