/** Keyboard + pointer-lock mouse input. Accumulates look deltas between frames. */
export class Input {
  private readonly keys = new Set<string>();
  /** Keys pressed (not auto-repeated) since they were last consumed. */
  private readonly presses = new Set<string>();
  lookX = 0;
  lookY = 0;
  locked = false;
  private readonly element: HTMLElement;
  onLockChange: ((locked: boolean) => void) | null = null;

  constructor(element: HTMLElement) {
    this.element = element;
    window.addEventListener('keydown', (e) => {
      if (!this.locked) return;
      this.keys.add(e.code);
      if (!e.repeat) this.presses.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.element;
      if (!this.locked) {
        this.keys.clear();
        this.presses.clear();
      }
      this.onLockChange?.(this.locked);
    });
  }

  requestLock(): void {
    const req = this.element.requestPointerLock() as unknown as Promise<void> | undefined;
    req?.catch?.(() => {
      // The browser may refuse a lock request too soon after an exit; the pause menu stays up.
    });
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  /** Was the key pressed since the last call (a single action, e.g. opening a door)? */
  consumePress(code: string): boolean {
    const hit = this.presses.has(code);
    this.presses.delete(code);
    return hit;
  }

  consumeLook(): [number, number] {
    const d: [number, number] = [this.lookX, this.lookY];
    this.lookX = 0;
    this.lookY = 0;
    return d;
  }
}
