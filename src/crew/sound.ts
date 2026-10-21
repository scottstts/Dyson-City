/**
 * What the crew's sound reads (docs/crew.md, "Sound"; audio/sounds/crew.ts plays it). The crew knows
 * nothing of sound; it exposes its state, refreshed every frame:
 *
 *  - loops: every continuous source, where it is and how hard it works: a drone's rotors, a Dray's
 *    drive and its probe's actuator, a Linewalker's drive, a Rigger's boom actuators, the estate's
 *    mower and trimmer;
 *  - events: this frame's footfalls (the Hands' feet, the Riggers' pads) and the Drays' latches.
 *
 * Whether a source is the estate's (its three Hands) decides which side of the estate's silencer
 * it is heard on: the field's crew falls silent within the estate's walls, as the field's machines do.
 */
import type { HandAgent } from './agents/hand';
import { LinewalkerAgent, type DrayAgent, type RiggerAgent } from './agents/machines';
import type { DroneAgent } from './agents/drone';
import { DRAY } from './models/dray';
import { TRIMMER } from './models/props';

export type CrewLoopKind = 'spotter' | 'ferry' | 'dray' | 'probe' | 'linewalker' | 'boom' | 'mower' | 'trimmer';

export interface CrewLoop {
  readonly kind: CrewLoopKind;
  readonly estate: boolean;
  x: number;
  y: number;
  z: number;
  /** How hard it works (0 off … 1 full load). */
  work: number;
  /** Its motors' speed (0 … 1 of their top). */
  speed: number;
}

export type CrewEventKind = 'hand' | 'rigger' | 'latch';

export interface CrewEvent {
  kind: CrewEventKind;
  estate: boolean;
  x: number;
  y: number;
  z: number;
  /** 0 … ~1.2 */
  force: number;
}

/** The Dray's top speed (m/s, agents/machines.ts) and its drive's idle (energised, standing). */
const DRAY_TOP = 1.6;
const DRAY_IDLE = 0.12;

export class CrewSound {
  readonly loops: CrewLoop[] = [];
  /** This frame's events (\`count\` of the pool). */
  readonly events: CrewEvent[] = [];
  count = 0;
  private readonly update: (() => void)[] = [];

  constructor(hands: readonly HandAgent[], riggers: readonly RiggerAgent[], drays: readonly DrayAgent[], linewalkers: readonly LinewalkerAgent[], drones: readonly DroneAgent[]) {
    const loop = (kind: CrewLoopKind, estate: boolean, fill: (l: CrewLoop) => void) => {
      const l: CrewLoop = { kind, estate, x: 0, y: 0, z: 0, work: 0, speed: 0 };
      this.loops.push(l);
      this.update.push(() => fill(l));
    };
    for (const h of hands) {
      const estate = h.job.kind === 'mow' || h.job.kind === 'hedge' || h.job.kind === 'garden';
      h.motion.onStep = (x, y, z, force) => this.push('hand', estate, x, y, z, force);
      if (h.mower) {
        loop('mower', true, (l) => {
          const e = h.mower!.elements;
          l.x = e[12];
          l.y = e[13] + 0.25;
          l.z = e[14];
          l.work = h.mowing ? 1 : 0;
          l.speed = Math.min(1, h.follow.root.speed / 0.65);
        });
      }
      if (h.trimmer) {
        loop('trimmer', true, (l) => {
          // At the blades' middle, along the shaft from the rear grip.
          const e = h.trimmer!.elements;
          const k = TRIMMER.front * 0.5 + 0.25;
          l.x = e[12] + e[8] * k;
          l.y = e[13] + e[9] * k;
          l.z = e[14] + e[10] * k;
          l.work = h.cutting ? 1 : 0;
          l.speed = l.work;
        });
      }
    }
    for (const g of riggers) {
      g.motion.onStep = (x, y, z, force) => this.push('rigger', false, x, y, z, force);
      loop('boom', false, (l) => {
        const e = g.motion.world[0].elements;
        l.x = e[12];
        // (At the boom's drums on the back.)
        l.y = e[13] + 0.4;
        l.z = e[14];
        l.work = g.motion.boomWork;
        l.speed = g.motion.boomWork;
      });
    }
    for (const d of drays) {
      let docks = d.docks;
      loop('dray', false, (l) => {
        const r = d.follow.root;
        l.x = r.x;
        l.y = d.root.elements[13] + DRAY.wheel.r;
        l.z = r.z;
        const v = Math.min(1, Math.abs(r.speed) / DRAY_TOP);
        l.speed = v;
        l.work = DRAY_IDLE + (1 - DRAY_IDLE) * Math.pow(v, 0.8);
        if (d.docks !== docks) {
          docks = d.docks;
          const s = Math.sin(r.heading);
          const c = Math.cos(r.heading);
          this.push('latch', false, r.x + s * DRAY.probe.z, l.y - 0.2, r.z + c * DRAY.probe.z, 1);
        }
      });
      loop('probe', false, (l) => {
        const r = d.follow.root;
        const s = Math.sin(r.heading);
        const c = Math.cos(r.heading);
        l.x = r.x + s * DRAY.probe.z;
        l.y = d.root.elements[13] + DRAY.probe.y + 0.4;
        l.z = r.z + c * DRAY.probe.z;
        l.work = d.probing ? 1 : 0;
        l.speed = l.work;
      });
    }
    for (const w of linewalkers) {
      loop('linewalker', false, (l) => {
        const e = w.world[0].elements;
        l.x = e[12];
        l.y = e[13];
        l.z = e[14];
        const v = Math.min(1, w.speed / LinewalkerAgent.VMAX);
        l.speed = v;
        l.work = v > 0.01 ? 0.2 + 0.8 * v : 0;
      });
    }
    for (const d of drones) {
      loop(d.sortie.kind, false, (l) => {
        l.x = d.pos.x;
        l.y = d.pos.y;
        l.z = d.pos.z;
        l.work = d.thrust;
        l.speed = d.thrust;
      });
    }
  }

  /** The start of a frame: last frame's events are gone (the sound read them). */
  begin(): void {
    this.count = 0;
  }

  /** The end of a frame: every loop's state. */
  refresh(): void {
    for (const f of this.update) f();
  }

  private push(kind: CrewEventKind, estate: boolean, x: number, y: number, z: number, force: number): void {
    if (this.count === this.events.length) this.events.push({ kind, estate, x, y, z, force });
    const e = this.events[this.count++];
    e.kind = kind;
    e.estate = estate;
    e.x = x;
    e.y = y;
    e.z = z;
    e.force = force;
  }
}
