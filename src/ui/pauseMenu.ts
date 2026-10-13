export interface PlayerSettings {
  sensitivity: number;
  fov: number;
}

const STORAGE_KEY = 'dyson.settings.v1';
export const DEFAULT_SETTINGS: Readonly<PlayerSettings> = { sensitivity: 1, fov: 62 };

export function loadSettings(): PlayerSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PlayerSettings>;
      return {
        sensitivity: clampNum(parsed.sensitivity, 0.2, 3, DEFAULT_SETTINGS.sensitivity),
        fov: clampNum(parsed.fov, 45, 90, DEFAULT_SETTINGS.fov),
      };
    }
  } catch {
    // storage unavailable: defaults
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(s: PlayerSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

/** Minimal pause menu: resume, mouse sensitivity, vertical field of view. */
export class PauseMenu {
  readonly root: HTMLDivElement;
  private onResume: (() => void) | null = null;

  constructor(host: HTMLElement, settings: PlayerSettings, onChange: (s: PlayerSettings) => void) {
    this.root = document.createElement('div');
    this.root.className = 'pause is-hidden';
    const card = document.createElement('div');
    card.className = 'pause-card';
    const title = document.createElement('div');
    title.className = 'pause-title';
    title.textContent = 'Paused';
    const resume = document.createElement('button');
    resume.type = 'button';
    resume.className = 'entry-enter';
    resume.textContent = 'Resume';
    resume.addEventListener('click', () => this.onResume?.());
    card.append(
      title,
      this.slider('Mouse sensitivity', 0.2, 3, 0.05, settings.sensitivity, (v) => v.toFixed(2), (v) => {
        settings.sensitivity = v;
        saveSettings(settings);
        onChange(settings);
      }),
      this.slider('Field of view', 45, 90, 1, settings.fov, (v) => `${v.toFixed(0)}°`, (v) => {
        settings.fov = v;
        saveSettings(settings);
        onChange(settings);
      }),
      resume,
    );
    this.root.appendChild(card);
    host.appendChild(this.root);
  }

  show(onResume: () => void): void {
    this.onResume = onResume;
    this.root.classList.remove('is-hidden');
  }

  hide(): void {
    this.root.classList.add('is-hidden');
  }

  private slider(label: string, min: number, max: number, step: number, value: number, fmt: (v: number) => string, set: (v: number) => void): HTMLLabelElement {
    const row = document.createElement('label');
    row.className = 'pause-row';
    const name = document.createElement('span');
    name.textContent = label;
    const out = document.createElement('span');
    out.className = 'pause-value';
    out.textContent = fmt(value);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      out.textContent = fmt(v);
      set(v);
    });
    row.append(name, input, out);
    return row;
  }
}
