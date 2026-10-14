/**
 * The West Gate's airlock logic (docs/gate.md): two gates that never stand open together, a
 * chamber that vents to the band's 0.55 bar or fills to the city's 1 bar between them, and mist
 * when it vents (the humid garden air cools as it expands).
 *
 * Automatic, no prompt: a gate opens for a player approaching it, once the other gate is shut and
 * bolted and the chamber's pressure matches its side; a player who walks into the chamber is cycled
 * through; a gate closes behind the player once they are clear of its sweep, and never sweeps
 * through them (a closing gate reverses if they step back into it).
 *
 * Pure logic (no rendering): the scene reads the gates' openness, bolts, pressure and mist.
 */
import { GATE } from './spec';

/** Seconds: bolts withdraw/shoot, a leaf travels, the chamber fills or vents. */
export const TIMING = { bolts: 1.0, travel: 6.0, settle: 0.6, cycle: 5.0, idleClose: 4.0, passClose: 0.8 } as const;
/** Distance (m) within which an approaching player opens a gate. */
export const APPROACH = 9;

type Phase = 'closed' | 'unbolting' | 'opening' | 'open' | 'closing' | 'bolting';

function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/** One sector gate: bolts, then the leaf. Requests may reverse it mid-travel. */
export class GateActuator {
  phase: Phase = 'closed';
  /** Leaf travel 0..1 (linear in time; `openness` is eased). */
  private travel = 0;
  /** Bolts: 1 = shot (engaged), 0 = withdrawn. */
  bolts = 1;
  /** Seconds since the leaf reached the open stop (for the settle). */
  private settleT = 1e9;

  get openness(): number {
    // A slight damped settle on the open stop.
    const settle = this.phase === 'open' && this.settleT < TIMING.settle ? 0.004 * Math.exp(-this.settleT * 7) * Math.sin(this.settleT * 26) : 0;
    return Math.min(Math.max(ease(this.travel) + settle, 0), 1.002);
  }

  get isClosedAndBolted(): boolean {
    return this.phase === 'closed' && this.bolts >= 1;
  }

  get isOpen(): boolean {
    return this.phase === 'open';
  }

  /** True while any part of the leaf is not on its closed stop. */
  get isMoving(): boolean {
    return this.phase !== 'closed' && this.phase !== 'open';
  }

  /** Puts the gate straight onto a stop (review override). */
  set(open: boolean): void {
    this.phase = open ? 'open' : 'closed';
    this.travel = open ? 1 : 0;
    this.bolts = open ? 0 : 1;
    this.settleT = 1e9;
  }

  request(open: boolean): void {
    if (open) {
      if (this.phase === 'closed' || this.phase === 'bolting') this.phase = 'unbolting';
      else if (this.phase === 'closing') this.phase = 'opening';
    } else if (this.phase === 'open' || this.phase === 'opening') this.phase = 'closing';
    else if (this.phase === 'unbolting') this.phase = 'bolting';
  }

  update(dt: number): void {
    switch (this.phase) {
      case 'unbolting':
        this.bolts = Math.max(0, this.bolts - dt / TIMING.bolts);
        if (this.bolts === 0) this.phase = 'opening';
        break;
      case 'opening':
        this.travel = Math.min(1, this.travel + dt / TIMING.travel);
        if (this.travel === 1) {
          this.phase = 'open';
          this.settleT = 0;
        }
        break;
      case 'open':
        this.settleT += dt;
        break;
      case 'closing':
        this.travel = Math.max(0, this.travel - dt / TIMING.travel);
        if (this.travel === 0) this.phase = 'bolting';
        break;
      case 'bolting':
        this.bolts = Math.min(1, this.bolts + dt / TIMING.bolts);
        if (this.bolts === 1) this.phase = 'closed';
        break;
      default:
        break;
    }
  }
}

export interface PlayerPos {
  x: number;
  z: number;
}

export class Airlock {
  readonly outer = new GateActuator();
  readonly inner = new GateActuator();
  /** Chamber pressure as a fraction: 0 = vented to the band (0.55 bar), 1 = the city's 1 bar. */
  pressure = 0;
  /** Mist density in the chamber, 0..1. */
  mist = 0;
  /** Review override: hold a state instead of following the player. */
  private held: 'closed' | 'outer' | 'inner' | null = null;

  hold(state: 'closed' | 'outer' | 'inner' | null): void {
    this.held = state;
    if (!state) return;
    this.outer.set(state === 'outer');
    this.inner.set(state === 'inner');
    this.pressure = state === 'inner' ? 1 : 0;
    this.mist = 0;
  }
  /** Which way a player in the chamber is going: 'in' (to the city) or 'out' (to the band). */
  private heading: 'in' | 'out' = 'in';
  private farFromEntry = false;
  private idleOuter = 0;
  private idleInner = 0;

  /** Chamber pressure in bar. */
  get bar(): number {
    return 0.55 + 0.45 * ease(this.pressure);
  }

  static inChamber(p: PlayerPos): boolean {
    return p.x > GATE.outerLipX && p.x < GATE.innerLipX && Math.abs(p.z) < GATE.passageHalf;
  }

  /** Inside the footprint a leaf sweeps (it must not close on a player there). */
  static inSweep(p: PlayerPos, lipX: number): boolean {
    return Math.abs(p.z) < GATE.passageHalf && p.x > lipX - 1.2 && p.x < lipX + 3.4;
  }

  update(dt: number, p: PlayerPos): void {
    if (this.held) return;
    const inChamber = Airlock.inChamber(p);
    const outerSweep = Airlock.inSweep(p, GATE.outerLipX);
    const innerSweep = Airlock.inSweep(p, GATE.innerLipX);
    const nearOuter = !inChamber && p.x <= GATE.outerLipX && Math.hypot(p.x - GATE.outerLipX, p.z) < APPROACH;
    const nearInner = !inChamber && p.x >= GATE.innerLipX && Math.hypot(p.x - GATE.innerLipX, p.z) < APPROACH;

    if (!inChamber) {
      // Arriving from one side sets where a player in the chamber is headed.
      if (nearOuter) this.heading = 'in';
      if (nearInner) this.heading = 'out';
      this.farFromEntry = false;
    } else {
      // Turning back: well into the chamber, then back close to the gate they came through.
      const entryLip = this.heading === 'in' ? GATE.outerLipX : GATE.innerLipX;
      const d = Math.abs(p.x - entryLip);
      if (d > 7) this.farFromEntry = true;
      if (this.farFromEntry && d < 4) {
        this.heading = this.heading === 'in' ? 'out' : 'in';
        this.farFromEntry = false;
      }
    }

    const wantOuter = outerSweep || nearOuter || (inChamber && this.heading === 'out');
    const wantInner = !wantOuter && (innerSweep || nearInner || (inChamber && this.heading === 'in'));

    // Close what is not wanted, once nobody is in its sweep (soon if the player is passing
    // through, after a pause otherwise).
    const closeDelay = inChamber ? TIMING.passClose : TIMING.idleClose;
    this.idleOuter = !wantOuter && !outerSweep && this.outer.phase !== 'closed' ? this.idleOuter + dt : 0;
    this.idleInner = !wantInner && !innerSweep && this.inner.phase !== 'closed' ? this.idleInner + dt : 0;
    if (this.idleOuter > closeDelay || (wantInner && !outerSweep && !this.outer.isClosedAndBolted)) this.outer.request(false);
    if (this.idleInner > closeDelay || (wantOuter && !innerSweep && !this.inner.isClosedAndBolted)) this.inner.request(false);
    // A gate closing on a player reverses.
    if (outerSweep && (this.outer.phase === 'closing' || this.outer.phase === 'bolting') && this.inner.isClosedAndBolted) this.outer.request(true);
    if (innerSweep && (this.inner.phase === 'closing' || this.inner.phase === 'bolting') && this.outer.isClosedAndBolted) this.inner.request(true);

    // Cycle the chamber, then open the wanted gate.
    const sealed = this.outer.isClosedAndBolted && this.inner.isClosedAndBolted;
    const prev = this.pressure;
    if (wantOuter && this.inner.isClosedAndBolted) {
      if (this.pressure > 0 && sealed) this.pressure = Math.max(0, this.pressure - dt / TIMING.cycle);
      if (this.pressure === 0) this.outer.request(true);
    } else if (wantInner && this.outer.isClosedAndBolted) {
      if (this.pressure < 1 && sealed) this.pressure = Math.min(1, this.pressure + dt / TIMING.cycle);
      if (this.pressure === 1) this.inner.request(true);
    }

    // Venting cools the humid air below its dew point: mist forms in proportion to the pressure
    // drop and clears once the outer gate opens onto the dry deck.
    const drop = Math.max(0, prev - this.pressure);
    this.mist = Math.min(1, this.mist + drop * 2.2);
    const clear = this.outer.openness > 0.05 ? 1.6 : 6.0;
    this.mist *= Math.exp(-dt / clear);

    this.outer.update(dt);
    this.inner.update(dt);
  }
}
