/**
 * Reads the airlock (city/gate/airlock.ts) each frame and turns its state changes into sound events.
 * The airlock stays pure logic and knows nothing of sound. Pure: no Web Audio.
 */
import type { Airlock, GateActuator } from '../city/gate/airlock';

export type GateName = 'outer' | 'inner';

export type GateEvent =
  /** Bolts start withdrawing / shooting. */
  | 'unbolt'
  | 'bolt'
  /** Bolts reach their end. */
  | 'unbolted'
  | 'bolted'
  /** The leaf seats on its stop. */
  | 'opened'
  | 'closed'
  /** Valves switch the hoists' direction mid-travel. */
  | 'reverse';

export type PressureEvent = 'valve-open' | 'valve-close';

export interface AirlockSoundEvents {
  gates: { gate: GateName; event: GateEvent }[];
  pressure: PressureEvent | null;
}

type Phase = GateActuator['phase'];

const TRANSITIONS: Partial<Record<Phase, Partial<Record<Phase, GateEvent>>>> = {
  closed: { unbolting: 'unbolt' },
  bolting: { unbolting: 'unbolt', closed: 'bolted' },
  unbolting: { opening: 'unbolted', bolting: 'reverse' },
  opening: { open: 'opened', closing: 'reverse' },
  closing: { bolting: 'closed', opening: 'reverse' },
};

export class AirlockWatcher {
  private readonly phases: Record<GateName, Phase>;
  private pressure: number;
  private flowing = false;

  constructor(lock: Airlock) {
    this.phases = { outer: lock.outer.phase, inner: lock.inner.phase };
    this.pressure = lock.pressure;
  }

  /** Events since the last call. */
  step(lock: Airlock): AirlockSoundEvents {
    const gates: AirlockSoundEvents['gates'] = [];
    for (const gate of ['outer', 'inner'] as const) {
      const now = lock[gate].phase;
      const prev = this.phases[gate];
      if (now !== prev) {
        const event = TRANSITIONS[prev]?.[now];
        if (event) gates.push({ gate, event });
        // Entering 'bolting' (after landing, or turned back while unbolting) starts the bolts' run.
        if (now === 'bolting') gates.push({ gate, event: 'bolt' });
        this.phases[gate] = now;
      }
    }
    // The valves open when the pressure starts to move and shut the moment it arrives (the airlock
    // unbolts the next gate in that same step).
    const moved = lock.pressure !== this.pressure;
    const arrived = lock.pressure === 0 || lock.pressure === 1;
    let pressure: PressureEvent | null = null;
    if (moved && !this.flowing && !arrived) {
      pressure = 'valve-open';
      this.flowing = true;
    } else if (this.flowing && (arrived || !moved)) {
      pressure = 'valve-close';
      this.flowing = false;
    }
    this.pressure = lock.pressure;
    return { gates, pressure };
  }
}
