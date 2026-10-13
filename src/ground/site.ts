/**
 * The earmarked city site: the Garden Deck foundation platform on the Girdle deck.
 * Single source of truth for its dimensions (metres, local frame, centre at the origin).
 */
import { SHELL_RADIUS_M } from '../world/constants';

export const SITE = {
  /** Radius of the platform's top surface edge (the city is ~1 km across). */
  padRadius: 500,
  /** Three equal steps down to the deck. */
  stepCount: 3,
  stepRise: 0.4,
  stepTread: 1.2,
  /** Arris radius on every step nosing. */
  nosingRadius: 0.015,
  /** How far the bottom riser continues below the deck surface (hidden; avoids a crack). */
  riserSink: 0.05,
  /** Deck mesh extent. Beyond ~5 km the deck is a sub-pixel strip at the horizon. */
  deckOuterRadius: 15_000,
  /** Walkable bound for the player (soft). */
  walkRadius: 6_000,
  /** Survey inlays (bronze), widths in metres. */
  axisInlayWidth: 0.16,
  boundaryInlayRadius: 488,
  boundaryInlayWidth: 0.2,
} as const;

export const PAD_HEIGHT = SITE.stepCount * SITE.stepRise;
export const PAD_OUTER_RADIUS = SITE.padRadius + (SITE.stepCount - 1) * SITE.stepTread;

/** Concave deck height at horizontal distance r from the centre (y = r²/2R). */
export function deckHeight(r: number): number {
  return (r * r) / (2 * SHELL_RADIUS_M);
}

/**
 * Walkable surface height at (x, z). The pad top and treads are flat; the deck follows the shell.
 * Treads: step k (0 = top) spans r ∈ [padRadius + (k−1)·tread, padRadius + k·tread).
 */
export function groundHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  if (r <= SITE.padRadius) return PAD_HEIGHT;
  const k = Math.ceil((r - SITE.padRadius) / SITE.stepTread);
  if (k < SITE.stepCount) return PAD_HEIGHT - k * SITE.stepRise;
  return deckHeight(r);
}
