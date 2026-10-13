/**
 * The coronal gas domain: the plane of the sky around the star's limb, unwrapped into a polar grid
 * (x: position angle round the limb, y: height above it, star radii).
 *
 * From anywhere on the shell the star stands at the zenith and its whole limb is above the horizon,
 * so the grid runs all the way round. A sight line's place in it is its impact parameter (closest
 * approach to the star's centre) and position angle, the same coordinates the corona is tabled in.
 * Sight lines graze the observer's horizon at an impact parameter of one shell radius (a height of
 * 1/STAR_RADIUS_R − 1 ≈ 0.41 star radii), but the plumes stay far lower: the grid ends at GAS_TOP,
 * and gas dissipates over its upper part (solver.ts) so nothing is cut off in the sky.
 *
 * Cells are square at the limb and widen with height (by up to 1.25×); the solver's operators carry
 * the polar metric, so plumes keep their shape as they rise.
 */
import { STAR_RADIUS_R } from '../../../world/constants';

/** Cells round the limb. */
export const GAS_NX = 2560;
/** Cell size at the limb (star radii, ≈ 1,710 km): one cell of position angle. */
export const GAS_CELL = (2 * Math.PI) / GAS_NX;
/** Highest height above the limb any sight line reaches (star radii). */
export const GAS_VISIBLE_HEIGHT = 1 / STAR_RADIUS_R - 1;
/** Top of the grid (star radii): well above the highest plumes. */
export const GAS_TOP = 0.25;
/** Cells up from the limb. */
export const GAS_NY = Math.ceil(GAS_TOP / GAS_CELL);
/** Height of the grid (star radii). */
export const GAS_HEIGHT = GAS_NY * GAS_CELL;
/** Gas dissipates over this upper share of the grid, faster toward the top. */
export const GAS_FADE_SHARE = 0.3;

/** Fixed solver step (s) and the most steps one frame may take before the gas drops time. */
export const GAS_STEP = 1 / 30;
export const GAS_MAX_STEPS = 3;
/** Pressure iterations per step (even: the ping-pong ends in the buffer it started from). */
export const GAS_JACOBI = 14;
/** Simulated before the first frame, so the gas is already billowing at reveal (s). */
export const GAS_PREROLL = 20;
