/**
 * Where and when the coronal gas erupts: vents spaced round the limb, each venting a little gas all
 * the time and erupting in a pulse once per cycle; after a few cycles a vent moves to a new site in
 * its sector, so the limb never shows the same plumes for long.
 *
 * The motion is deliberately fast: plumes rise ~0.05 star radii per second (tens of thousands of
 * km/s), a whole eruption billows and rolls in under half a minute. This is the one time-lapsed
 * part of the star (a design choice: the gas must be seen to flow).
 *
 * A pure function of time, so any moment can be evaluated (pre-roll, fixed-time renders, tests).
 * Units: star radii, seconds; angles in radians of position angle round the limb.
 */
import { mulberry32 } from '../features';

export const VENT_COUNT = 14;
/** Cycles a vent erupts from one site before it moves. */
export const VENT_SITE_CYCLES = 3;
/** Share of a vent's flow that never stops, and its eruption pulse (s). */
export const VENT_BASE = 0.12;
export const VENT_PULSE_RISE = 1.2;
export const VENT_PULSE_FADE: readonly [number, number] = [5.5, 9.5];
/** Height of the vents above the limb (star radii): in the chromosphere, just clear of the edge. */
export const VENT_HEIGHT = 0.0021;

export interface Vent {
  /** Position angle (rad, −π..π). */
  angle: number;
  /** Launch velocity (along the limb, outward; star radii/s) and source radius (star radii). */
  vx: number;
  vy: number;
  radius: number;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Cycle period (s) and phase offset (s) of vent i: fixed for the vent's life. */
export function ventCycle(i: number, seed = 1739): { period: number; offset: number } {
  const rnd = mulberry32(seed + i * 977);
  return { period: 16 + rnd() * 12, offset: rnd() * 60 };
}

/** Vent i's site during its m-th tenure. */
export function ventSite(i: number, m: number, seed = 1739): Vent {
  const rnd = mulberry32(seed * 13 + i * 7919 + m * 104729);
  const angle = ((i + 0.5 + (rnd() - 0.5) * 0.8) / VENT_COUNT) * 2 * Math.PI - Math.PI;
  const side = rnd() < 0.5 ? -1 : 1;
  return {
    angle: Math.atan2(Math.sin(angle), Math.cos(angle)),
    vx: side * (0.0109 + rnd() * 0.0104),
    vy: 0.0377 + rnd() * 0.0247,
    radius: 0.0056 + rnd() * 0.0048,
  };
}

/** Eruption strength of a vent at phase φ (s) into its cycle: the steady base plus the pulse. */
export function ventPulse(phase: number): number {
  return smooth(0, VENT_PULSE_RISE, phase) * (1 - smooth(VENT_PULSE_FADE[0], VENT_PULSE_FADE[1], phase)) * (1 - VENT_BASE) + VENT_BASE;
}

/** Vent i at time t: its current site and strength (0..1). */
export function ventAt(i: number, t: number, seed = 1739): Vent & { strength: number } {
  const { period, offset } = ventCycle(i, seed);
  const local = t + offset;
  const cycle = Math.floor(local / period);
  const phase = local - cycle * period;
  const site = ventSite(i, Math.floor(cycle / VENT_SITE_CYCLES), seed);
  return { ...site, strength: ventPulse(phase) };
}
