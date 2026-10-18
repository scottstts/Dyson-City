# Cinematic capture

Code: `tools/cinematic/` (dev only; nothing in `src/`). `node tools/cinematic/cinematic.mjs` renders the shot list (`shots.mjs`) to ProRes 4444 clips in `~/Downloads/clips/`. `--preview` writes first, middle and last stills per shot for framing. `--only a,b` picks shots, and `--no-build` reuses the last capture build.

## Offline, but the game's image

- **The game's compositing, unchanged.** Each frame goes through the real `Game.renderFrame`: the final pipeline, TAA, eye adaptation, live game time. Two loop steps are taken per captured frame, as the game runs at 60 Hz for 30 fps footage. Each shot first settles 3 s at its opening pose (exposure and TAA history), then pre-rolls 0.75 s along its move, so frame 0 looks the way it would in play, already moving.
- **Overrides happen at build time, in a separate build** (`overrides.mjs`, a vite transform into `tools/out/cinematic-dist`). The shipping build never sees them. Each one is an exact substitution: if a constant is renamed or re-tuned, the build fails rather than quietly capturing with in-game values. `tests/cinematicOverrides.test.ts` checks that each one still matches its source.
  - The 4 MP drawing-buffer cap is lifted, so 3443×2160 renders natively, not upscaled.
  - LOD is off: foliage cards never thin out, the house interior draws from any range, and every three.js `LOD` (car, craft) is pinned to level 0 at runtime.
  - Grass cannot have full density everywhere, because its 1/d² rings are what keep coverage per pixel bounded. Instead, full density reaches 2× further out and two extra rings carry the blades across the whole estate.
  - Pixel-footprint filtering (`lodFade`, the sky's footprint mips) stays. It is anti-aliasing, not a detail budget.
- **ProRes 4444**, because 3443 is odd and 4:2:0/4:2:2 codecs need an even width. Frames are lossless PNG from the canvas (sRGB), tagged BT.709 primaries and matrix with the sRGB transfer.

## Framing rules learned

- **Camera ceiling ~500 m**, about 2× the Dome's crown (user direction). The shots never travel across the sphere.
- **Keep the horizon out of high shots.** From a few hundred metres up, the deck's far edge shows as a flat white band at the horizon. Normal play never sees it, because the eye stays at ground level. High shots look down steeply enough that the top of the frame sits about 10° below the horizon. The shell shot looks up steeply enough that the bottom of the frame sits about 5° above it.
- **Keep the star's 45° cone at the frame's edge.** A tilt up past ~25° elevation near the zenith fills the frame with glare. The shell shot keeps the blaze as a band along the top.
- **The craft's clip runs in real time.** A shot's `craft: { phase, at }` runs the visit forward, so it is that far into a leg at frame 0. The hover lasts 6 s (the turn takes 4 s of it), so 5 s at the pad covers the last of the descent and most of the turn, but not the lift-off. The user preferred real time to any time-scaling. The approach alone (inbound 5–10 s, from the same camera) reads better than the turn: the craft grows from the lock toward the lens, and the clip ends before it settles.
- **Cinematic, not a model demo** (user direction for the craft): an elevated camera a little above the subject, tilted only a few degrees down, set slightly off the world's axes, looking down the craft's own line (the corridor to the East Lock), so the world fills the background and the craft moves toward or away from the lens. A steep three-quarter view from overhead isolates the subject against the paving, and reads as a turntable.
- **Paths are linear in time**, cut mid-move, so a clip neither starts nor stops on screen. Zoom is linear in tan(fov/2), the image's scale.
