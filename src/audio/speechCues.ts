/**
 * When the announcements outside the West Gate's airlock are made (docs/audio.md,
 * "Announcements"). Pure: the listener's place, the car and the craft in; the announcements due
 * this frame out. The airlock times its own (city/gate/airlock.ts).
 *
 *  - enter-estate: on crossing the terrace's outer wall face inward;
 *  - enter-compound: on crossing the main portal's threshold eastward, between its pylons;
 *  - drive: as the player takes the car;
 *  - aircraft-perimeter: while the craft is over the pad's circle (the pad and its white apron, to
 *    the ring road) and the listener is on it too: at once, then every PAD_REPEAT while both hold.
 *    When either stops, the one playing plays out and no other begins.
 *
 * Each crossing re-arms only once the listener is back out by a margin, so standing on a line
 * never repeats it.
 */
import { CORDON, CORDON_PLAN, RING_ROAD } from '../field/layout';
import { estateDistance } from '../estate/silencer';
import type { Speech } from './loadSpeech';

/** How far back out (m) a listener must go before a crossing announces again. */
const REARM = 3;
/** Interval (s) of the craft's announcement while it and the listener are over the pad. */
export const PAD_REPEAT = 5.5;
/** The pad's circle in plan: the pad and its white apron, out to the ring road under the Halo. */
export const PAD_AREA_R = RING_ROAD.r0;

const portalS = CORDON_PLAN.pylons[CORDON_PLAN.portal.south];
/** The main portal's clear half-width between its pylons' faces, along the front (z). */
export const PORTAL_HALF = portalS.z - portalS.ht;

export interface CueInput {
  x: number;
  z: number;
  driven: boolean;
  /** The craft's plan position, or null while it is not here (between visits). */
  craft: { x: number; z: number } | null;
}

/** Whether a plan point is over the pad's circle. */
export function overPad(x: number, z: number): boolean {
  return Math.hypot(x, z) < PAD_AREA_R;
}

export class SpeechCues {
  private estateArmed = false;
  private portalArmed = false;
  private driven = false;
  private craftT = -1;
  private first = true;
  private readonly due: Speech[] = [];

  /** The announcements due this frame (the returned array is reused). */
  update(dt: number, s: CueInput): readonly Speech[] {
    const due = this.due;
    due.length = 0;
    const estate = estateDistance(s.x, s.z);
    if (this.first) {
      // Wherever the game starts, nothing is announced until it is crossed.
      this.first = false;
      this.driven = s.driven;
    }

    if (estate > REARM) this.estateArmed = true;
    else if (estate < 0 && this.estateArmed) {
      this.estateArmed = false;
      due.push('enter-estate');
    }

    if (s.x < CORDON.frontX - REARM) this.portalArmed = true;
    else if (s.x > CORDON.frontX && this.portalArmed) {
      this.portalArmed = false;
      if (Math.abs(s.z) < PORTAL_HALF) due.push('enter-compound');
    }

    if (s.driven && !this.driven) due.push('drive');
    this.driven = s.driven;

    // The craft and the listener both over the pad: at once, then every PAD_REPEAT while they stay.
    if (s.craft && overPad(s.craft.x, s.craft.z) && overPad(s.x, s.z)) {
      const t = this.craftT;
      this.craftT = t < 0 ? 0 : t + dt;
      if (t < 0 || Math.floor(this.craftT / PAD_REPEAT) > Math.floor(t / PAD_REPEAT)) due.push('aircraft-perimeter');
    } else this.craftT = -1;
    return due;
  }
}
