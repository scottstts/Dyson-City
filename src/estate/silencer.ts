/**
 * The estate's silencer (docs/estate.md, docs/audio.md "The field"): a device installed in the
 * estate that cuts off the field's industrial sound for anyone within its walls, the house
 * included. Its reach is the terrace's outer wall face in plan; the gateway's ramp and steps lie
 * inside it, so the machines go quiet as you pass the piers and come back the moment you step out.
 */
import { inside } from './sdf2';
import { ESTATE_BOUNDS, TERRACE_OUTLINE } from './layout';

const [X0, Z0, X1, Z1] = ESTATE_BOUNDS;

export function estateSilenced(x: number, z: number): boolean {
  if (x < X0 || x > X1 || z < Z0 || z > Z1) return false;
  return inside(TERRACE_OUTLINE, x, z);
}
