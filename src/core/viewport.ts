/**
 * Drawing-buffer policy. The 4,000,000-pixel budget is a hard cap: the DPR may fall below 1 on
 * very large CSS viewports. Never floor the result to 1.
 */

export const MAX_DRAWING_BUFFER_PIXELS = 4_000_000;
export const MAX_DPR = 1.7;

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
}

export function computeViewport(cssWidth: number, cssHeight: number, devicePixelRatio: number, renderScale = 1): ViewportSize {
  const width = Math.max(1, cssWidth);
  const height = Math.max(1, cssHeight);
  const base = Math.min(devicePixelRatio, MAX_DPR, Math.sqrt(MAX_DRAWING_BUFFER_PIXELS / (width * height)));
  const dpr = base * renderScale;
  return { width, height, dpr: Number.isFinite(dpr) && dpr > 0 ? dpr : 1 };
}

/**
 * Coalesces resize events into one animation-frame commit and ignores transient 0×0 viewports.
 */
export class ResizeCoalescer {
  private pending = 0;
  private readonly onResize = (): void => this.schedule();
  private readonly commit: (size: ViewportSize) => void;

  constructor(commit: (size: ViewportSize) => void) {
    this.commit = commit;
  }

  attach(): void {
    window.addEventListener('resize', this.onResize);
  }

  detach(): void {
    window.removeEventListener('resize', this.onResize);
    if (this.pending) cancelAnimationFrame(this.pending);
    this.pending = 0;
  }

  /** Apply the current viewport immediately (used once at boot). Returns false for a 0×0 viewport. */
  commitNow(): boolean {
    if (window.innerWidth === 0 || window.innerHeight === 0) return false;
    this.commit(computeViewport(window.innerWidth, window.innerHeight, window.devicePixelRatio));
    return true;
  }

  private schedule(): void {
    if (this.pending) return;
    this.pending = requestAnimationFrame(() => {
      this.pending = 0;
      this.commitNow();
    });
  }
}
