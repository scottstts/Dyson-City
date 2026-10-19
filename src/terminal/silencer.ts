/**
 * The Stand's silencer (docs/terminal.md, docs/audio.md "The field"): like the estate's, a device
 * that takes the field's industrial sound away, here for whoever is up on the Stand, on foot or in
 * the car. The Stand is too small for the estate's fade across a wall in plan, so it fades with
 * height: full at the foot of the ramp or the stair, gone at the deck, eased, so the hum leaves as
 * the player climbs and returns as they come down. The gain then follows over SILENCE_TC, so a
 * short stair never switches it between two footsteps.
 */
import { FIELD_Y } from '../field/layout';
import { STAND, standHeight } from './layout';

/** Time constant (s) the Stand's gain follows its target over. */
export const SILENCE_TC = 0.45;

/** How much of the field's sound reaches someone standing (or driving) at (x, y, z) here: 1 off the Stand, 0 on its deck. */
export function standSilenceTarget(x: number, y: number, z: number): number {
  const h = standHeight(x, z);
  if (h === null || y < h - 0.3) return 1;
  const t = Math.min(Math.max((y - FIELD_Y - 0.03) / (STAND.H - 0.06), 0), 1);
  return 1 - t * t * (3 - 2 * t);
}

/** The gain as it follows its target: one per frame. */
export class StandSilencer {
  gain = 1;
  update(dt: number, x: number, y: number, z: number): number {
    const target = standSilenceTarget(x, y, z);
    this.gain += (target - this.gain) * (dt > 0 ? 1 - Math.exp(-dt / SILENCE_TC) : 0);
    return this.gain;
  }
}
