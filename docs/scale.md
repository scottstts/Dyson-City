# Scale: the acceptance test

The standing test for every sky render is whether the star reads as a 1.4-million-km sun or a ~200 m glowing ball, and whether the structure reads as a million km away or a few hundred metres. Seeing a sphere from a point on it is a stereographic projection, so silhouettes cannot carry scale. Scale comes from content, light and motion. Physics is the tool for getting these right; it is used where it makes the picture more real and set aside where it only constrains.

## What reads as small (never ship)

| Signature | Why it reads small |
|---|---|
| A glow of fixed angular size around a bright disc | A lamp in haze |
| A clipped, featureless disc | A lit ball; there is nothing to count |
| A few large swirls or blobs across the disc | Few countable features means a small object |
| Fast surface motion (time-lapse) | The miniature effect: a pot, not a star |
| Thin luminous lines of constant pixel width, or dashed | LED strips, lane markings |
| A regular rhythm a few degrees apart (bricks, rings, ladders) | Human-scale architecture |
| Smooth flat surfaces at grazing angles | Plastic; a painted ceiling |

## What carries scale

- **Countless parts at every distance.** About 620,000 granules on the disc, and plating tiles at a power-law spread of sizes. Detail per pixel grows with distance and never smooths out.
- **Perspective.** The disc's texture shrinks and foreshortens toward the limb (centre 288,000 km, limb 696,000 km). The shell is seen at a grazing angle equal to its elevation, so relief and occlusion show in the lower sky.
- **Physical angular speeds.** The surface drifts 0.8°/min, prominence threads stream ~0.1°/min, and eruptions climb a few degrees per minute.
- **Light that takes time.** Flares echo in the far mirrors 3–6 s after they flash on the disc.
- **Media in the right places.** Blue habitat air in front of everything (the structure is beyond the sky). The cavity is crisp, with only a faint white fill.
- **A sharp limb** with eye glare that has no characteristic size.
- **Brightness ordering.** Nothing passive outshines the star, so nothing saturates into neon.

## Tools

- `node tools/render.mjs [--query ...] spot…`: fixed views. Use `ev=` below the default and `fov=`/`look=` to inspect the star's texture and the structure at telescope zoom.
- `node tools/flicker.mjs --wobble 3 --steady spot…`: temporal stability under camera motion (see `docs/runtime.md`).
