/**
 * What is underfoot on the estate (footsteps, docs/audio.md "The estate"), from the ground's class
 * grid (regions.ts): the lawns and the orchard's meadow are grass, the drive, the walks and the
 * gateway's ramp are gravel, the flags and the kitchen garden's brick paths are stone, and so are
 * the walls, steps and copings the walker can stand on (the grid's void). Off the terrace (below
 * it, or beyond the grid) the estate says nothing.
 */
import type { GroundSurface } from '../city/walk';
import { GROUND_ORDER, TERRACE_Y, type GroundClass } from './layout';
import type { ClassGrid } from './regions';

const BY_CLASS: Record<GroundClass, GroundSurface> = {
  void: 'stone',
  water: 'stone',
  soil: 'grass',
  flag: 'stone',
  brick: 'stone',
  ramp: 'gravel',
  gravel: 'gravel',
  meadow: 'grass',
  lawn: 'grass',
};
const SURFACES = GROUND_ORDER.map((c) => BY_CLASS[c]);

/** Feet lower than this under the terrace are on the platform, 1.6 m down (only the ramp descends to it). */
const BELOW = 0.8;
const RAMP = GROUND_ORDER.indexOf('ramp');

export function estateSurface(grid: ClassGrid): (x: number, z: number, y: number) => GroundSurface | null {
  return (x, z, y) => {
    const i = Math.round((x - grid.x0) / grid.step);
    const k = Math.round((z - grid.z0) / grid.step);
    if (i < 0 || k < 0 || i >= grid.nx || k >= grid.nz) return null;
    const c = grid.cls[k * grid.nx + i];
    if (c === 255 || (c !== RAMP && y < TERRACE_Y - BELOW)) return null;
    return SURFACES[c];
  };
}
