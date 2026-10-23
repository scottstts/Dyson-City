/**
 * What moves on the intro's ship at a moment of the film (docs/intro-film.md): the gear and the
 * engines from the flight (flight.ts), the door and the stair in scene 3. Pure, so the film, its
 * sound and the review tools all read the same state.
 */
import { SCENE3, type Timeline } from './timeline';
import type { ShipPose } from './flight';
import type { ShipState } from './ship/ship';
import { DOOR_TIME } from './ship/door';
import { STAIR_TIME } from './ship/stair';

export function shipStateAt(tl: Timeline, t: number, space: boolean, p: ShipPose, out: ShipState): ShipState {
  const s3 = tl.scene3;
  out.gear = space ? 0 : p.gear;
  out.compression = space ? 0 : p.compression;
  // Far out the mains hold a cruise burn; nothing else runs.
  out.main = space ? 0.12 : p.main;
  out.lift = space ? 0 : p.lift;
  const clamp = (x: number, m: number) => Math.min(Math.max(x, 0), m);
  // Opening runs forward; closing runs the same motion backward.
  out.door = t < s3.doorClose ? clamp(t - s3.doorOpen, DOOR_TIME) : DOOR_TIME - clamp(((t - s3.doorClose) * DOOR_TIME) / SCENE3.doorClose, DOOR_TIME);
  out.stair = t < s3.stairIn ? clamp(t - s3.stairOut, STAIR_TIME) : STAIR_TIME - clamp(((t - s3.stairIn) * STAIR_TIME) / SCENE3.stairIn, STAIR_TIME);
  return out;
}
