/**
 * Offline-capture overrides, applied to a separate vite build only (the game's sources are never
 * edited). Each one is an exact source substitution that must match: if a constant is renamed or
 * re-tuned in src/, the build fails instead of silently capturing with the in-game LOD.
 *
 * - The drawing-buffer cap: the capture renders its full resolution (≈7.4 MP) with no upscale.
 * - Level of detail: every distance-driven simplification is lifted or pushed past the frame's
 *   reach. three.js LOD objects (the car, the craft) are pinned to level 0 at runtime by the
 *   capture script instead (it walks the scene for every LOD, so new ones are covered too).
 *
 * Pixel-footprint filtering (lodFade in render/tsl/patterns.ts, the sky's footprint mips) is kept:
 * it is anti-aliasing, not a detail budget, and removing it would add shimmer the game never shows.
 */
export const OVERRIDES = [
  {
    file: 'src/core/viewport.ts',
    find: 'export const MAX_DRAWING_BUFFER_PIXELS = 4_000_000;',
    replace: 'export const MAX_DRAWING_BUFFER_PIXELS = Infinity;',
  },
  {
    // Foliage cards never dissolve with distance.
    file: 'src/estate/plants/materials.ts',
    find: 'export const FOLIAGE_LOD = { start: 70, end: 320, keep: 0.4 } as const;',
    replace: 'export const FOLIAGE_LOD = { start: 1e7, end: 2e7, keep: 1 } as const;',
  },
  {
    // The house's interior parts are drawn from any distance (they show through its windows).
    file: 'src/house/house.ts',
    find: 'const INTERIOR_RANGE = 60;',
    replace: 'const INTERIOR_RANGE = Infinity;',
  },
  {
    // Grass: full density 2× further out, and two more rings so the blades reach the whole estate
    // (448 m lawn, 640 m meadow) from anywhere a shot stands. The ground's own darkening follows
    // grassReach, so it moves out with them. Full density everywhere is unbounded (1/d² rings are
    // how coverage per pixel is held), so this is the furthest a bounded field goes.
    file: 'src/estate/grass.ts',
    find: "export const LAWN_GRASS: GrassSpec = { kind: 'lawn', cell: 0.07, blades: 6, height: 0.045, width: 0.0045, radius: 0.035, lean: 0.75, thin: 3.5, rings: 4 };",
    replace: "export const LAWN_GRASS: GrassSpec = { kind: 'lawn', cell: 0.07, blades: 6, height: 0.045, width: 0.0045, radius: 0.035, lean: 0.75, thin: 7, rings: 6 };",
  },
  {
    file: 'src/estate/grass.ts',
    find: "export const MEADOW_GRASS: GrassSpec = { kind: 'meadow', cell: 0.13, blades: 6, height: 0.24, width: 0.0055, radius: 0.08, lean: 0.55, thin: 5, rings: 4 };",
    replace: "export const MEADOW_GRASS: GrassSpec = { kind: 'meadow', cell: 0.13, blades: 6, height: 0.24, width: 0.0055, radius: 0.08, lean: 0.55, thin: 10, rings: 6 };",
  },
];

/** A vite plugin applying OVERRIDES; it throws on a substitution that no longer matches. */
export function captureOverrides() {
  const pending = new Set(OVERRIDES);
  return {
    name: 'dyson-cinematic-overrides',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0].replaceAll('\\', '/');
      let out = code;
      for (const o of OVERRIDES) {
        if (!file.endsWith(o.file)) continue;
        if (!out.includes(o.find)) throw new Error(`cinematic override no longer matches ${o.file}: ${o.find}`);
        out = out.replace(o.find, o.replace);
        pending.delete(o);
      }
      return out === code ? null : { code: out, map: null };
    },
    buildEnd() {
      if (pending.size) throw new Error(`cinematic overrides never applied: ${[...pending].map((o) => o.file).join(', ')}`);
    },
  };
}
