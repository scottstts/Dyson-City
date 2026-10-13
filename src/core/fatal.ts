/**
 * One place that turns any boot or runtime failure into a stopped loop plus the entry screen's
 * error panel. Never leave a frozen loader or a black canvas.
 */

export type BootStage =
  | 'gate'
  | 'import'
  | 'renderer'
  | 'atmosphere'
  | 'world'
  | 'environment'
  | 'compile'
  | 'warmup'
  | 'first-frame'
  | 'running';

export interface FatalDiagnostics {
  readonly stage: BootStage;
  readonly title: string;
  readonly message: string;
  readonly details: ReadonlyArray<[string, string]>;
}

type FatalSink = (diag: FatalDiagnostics) => void;
type StopHook = () => void;

class FatalReporter {
  stage: BootStage = 'gate';
  private sink: FatalSink | null = null;
  private stopHooks: StopHook[] = [];
  private extra = new Map<string, string>();
  private fired = false;

  setSink(sink: FatalSink): void {
    this.sink = sink;
  }

  onStop(hook: StopHook): void {
    this.stopHooks.push(hook);
  }

  setDetail(key: string, value: string): void {
    this.extra.set(key, value);
  }

  get hasFired(): boolean {
    return this.fired;
  }

  report(title: string, error: unknown): void {
    if (this.fired) return;
    this.fired = true;
    for (const hook of this.stopHooks) {
      try {
        hook();
      } catch {
        // stopping is best-effort; the error UI must still appear
      }
    }
    const message = describeError(error);
    const details: Array<[string, string]> = [
      ['Stage', this.stage],
      ['Viewport', `${window.innerWidth}×${window.innerHeight} CSS px`],
      ['Device pixel ratio', String(window.devicePixelRatio)],
      ['Platform', navigator.userAgent],
      ...this.extra.entries(),
    ];
    console.error(`[Dyson] ${title} (stage: ${this.stage})`, error);
    this.sink?.({ stage: this.stage, title, message, details });
  }
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export const fatal = new FatalReporter();
