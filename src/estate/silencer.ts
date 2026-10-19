/**
 * The estate's silencer (docs/estate.md, docs/audio.md "The field"): a device installed in the
 * estate that takes the field's industrial sound away for anyone within its walls, the house
 * included. Its reach is the terrace's outer wall face in plan (the gateway's ramp and steps lie
 * inside it). The machines fade out over the walk across the wall, not in a step: from full a few
 * metres outside it (FADE.outside) to nothing a few metres in (FADE.inside), eased.
 * *Rejected:* a hard cut at the wall face, which switched the field off between two footsteps.
 */
import { polygon } from './sdf2';
import { ESTATE_BOUNDS, TERRACE_OUTLINE } from './layout';

/** Metres outside the wall face where the field is still at full, and inside where it is gone. */
export const FADE = { outside: 4, inside: 10 } as const;

const terrace = polygon(TERRACE_OUTLINE);
const [X0, Z0, X1, Z1] = ESTATE_BOUNDS;
const M = FADE.outside;

/** Signed distance (m) in plan to the terrace's outer wall face: negative within the estate. */
export function estateDistance(x: number, z: number): number {
  return terrace.sdf(x, z);
}

/** How much of the field's sound reaches a listener at (x, z): 1 outside the estate, 0 well within it. */
export function fieldGain(x: number, z: number): number {
  if (x < X0 - M || x > X1 + M || z < Z0 - M || z > Z1 + M) return 1;
  const d = terrace.sdf(x, z);
  const t = Math.min(Math.max((d + FADE.inside) / (FADE.inside + FADE.outside), 0), 1);
  return t * t * (3 - 2 * t);
}
