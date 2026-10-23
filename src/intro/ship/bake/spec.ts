/**
 * The cabin bake's layout (docs/intro-ship.md, "Light"): what is baked and where the reflection
 * captures stand. Shared by the game and the bake's export (tools/ship-bake/export.ts), which hands
 * it to Blender (blender/ship/bake.py).
 */
import { convexFaces } from '../../../geometry/convex';
import type { Vec3 } from '../../../geometry/polyMesh';
import { INNER } from '../cabin/kit';
import { CABIN } from '../cabin/cabin';
import { EYE, FLOOR_Y } from '../spec';

/**
 * The light sets, each its own bake (light adds, so the game sums them):
 *  - interior: the lamps and the screens (never dimmed in the film: one set);
 *  - space: scene 1's sky through the panes, the door shut;
 *  - band: the band's sky through the panes at the landing (scenes 2 and 3), the door shut;
 *  - door: the band's sky through the open door alone (the panes black), × how far it is open.
 *
 * The door leaf keeps its shut light (no door set): slid open, its inner face lies in the fairing's
 * track, out of sight.
 */
export const CABIN_SETS = ['interior', 'space', 'band', 'door'] as const;
export type CabinSet = (typeof CABIN_SETS)[number];
export const LEAF_SETS = ['interior', 'space', 'band'] as const;

export const CABIN_BAKE = {
  /** Lightmap texel (m): ~2 cm; the light inside varies over decimetres (soft lamps, a 45° star). */
  texel: 0.02,
  /** Pack margin between charts (texels). */
  margin: 3,
  /** A chart narrower than this (texels) is too small to hold its light: its corners are baked instead. */
  minChart: 4,
} as const;

export interface CabinCapture {
  name: string;
  /** The capture point and the room's box (ship frame), for box-projected reflections. */
  position: Vec3;
  min: Vec3;
  max: Vec3;
}

/** The inner skin's bounds over an x span, from the floor up. */
function box(x0: number, x1: number): { min: Vec3; max: Vec3 } {
  const pts = convexFaces(INNER).flatMap((f) => f.loop);
  const zs = pts.map((p) => p[2]);
  const ys = pts.map((p) => p[1]);
  return { min: [x0, FLOOR_Y, Math.min(...zs)], max: [x1, Math.max(...ys), Math.max(...zs)] };
}

const ARCH = CABIN.frames[2];
const NOSE = Math.max(...convexFaces(INNER).flatMap((f) => f.loop.map((p) => p[0])));

/** The cabin aft of the cockpit's arch, and the cockpit (its capture at the pilot's eye). */
export const CABIN_CAPTURES: readonly CabinCapture[] = [
  { name: 'cabin', position: [(CABIN.aft + ARCH) / 2, FLOOR_Y + 1.25, 0], ...box(CABIN.aft, ARCH) },
  { name: 'cockpit', position: [EYE[0], EYE[1], EYE[2]], ...box(ARCH, NOSE) },
];
