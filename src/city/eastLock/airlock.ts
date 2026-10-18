/**
 * The East Lock's airlock (docs/east-lock.md): the craft drives it. Pure logic, like the West
 * Gate's (city/gate/airlock.ts), from the same actuators at craft speed: two gates that never stand
 * open together, a chamber vented to the band's 0.55 bar or filled to the city's 1 bar between them.
 *
 * The craft asks for a side: `request('outer')` shuts the inner gate, vents the chamber and opens
 * the outer; `request('inner')` shuts the outer, fills and opens the inner; `request('closed')`
 * shuts both. A gate never shuts on the craft: the craft only asks once it is clear of the sweep.
 */
import { GateActuator, type GateTiming } from '../gate/airlock';

/** The lock's run times (s): a fast real cycle, so a craft's visit stays brief. */
export const LOCK_TIMING: GateTiming & { cycle: number } = { bolts: 0.5, travel: 3.2, settle: 0.5, cycle: 2.5 };

export type LockSide = 'outer' | 'inner' | 'closed';

export class CraftAirlock {
  readonly outer = new GateActuator(LOCK_TIMING);
  readonly inner = new GateActuator(LOCK_TIMING);
  /** Chamber pressure: 0 vented to the band, 1 the city's. */
  pressure = 1;
  private target: LockSide = 'closed';
  /** Review override (?lock): the airlock holds that pose and ignores the craft. */
  private held = false;

  get bar(): number {
    const p = this.pressure;
    return 0.55 + 0.45 * p * p * (3 - 2 * p);
  }

  /** Holds a review pose (both gates may stand open: a pose, not a cycle). */
  hold(outer: boolean, inner: boolean): void {
    this.held = true;
    this.outer.set(outer);
    this.inner.set(inner);
  }

  request(side: LockSide): void {
    this.target = side;
  }

  /** The requested gate stands fully open. */
  isOpen(side: 'outer' | 'inner'): boolean {
    return this[side].isOpen;
  }

  update(dt: number): void {
    if (this.held) return;
    const t = this.target;
    const want = t === 'closed' ? null : t;
    const other = want === 'outer' ? this.inner : want === 'inner' ? this.outer : null;
    const mine = want ? this[want] : null;
    if (!want) {
      this.outer.request(false);
      this.inner.request(false);
    } else {
      other!.request(false);
      if (other!.isClosedAndBolted) {
        // Equalise with the side about to open, then open it.
        const goal = want === 'outer' ? 0 : 1;
        const sealed = this.outer.isClosedAndBolted && this.inner.isClosedAndBolted;
        if (this.pressure !== goal && sealed) {
          const step = dt / LOCK_TIMING.cycle;
          this.pressure = goal > this.pressure ? Math.min(goal, this.pressure + step) : Math.max(goal, this.pressure - step);
        }
        if (this.pressure === goal) mine!.request(true);
      }
    }
    this.outer.update(dt);
    this.inner.update(dt);
  }
}
