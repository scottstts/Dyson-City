# Intro: the ship's cabin light

Code: `src/intro/ship/bake/` (what is baked, the file), `src/intro/ship/cabinLight.ts` (shading), `blender/ship/bake.py` (Cycles), `tools/ship-bake/` (export, capture, pack, compare). The ship stays procedural at runtime: the bake supplies only per-corner data, lightmaps and reflection captures for the geometry the game builds.

## Workflow

1. `node tools/run-ts.mjs tools/ship-bake/export.ts`: the cabin, the door leaf and the outside as polygons, the materials, the openings, the capture boxes (`blender/bake/ship/scene.*`).
2. `node tools/ship-bake/env.mjs --dist <vite build>`: the outside light at the pilot's eye in each scene, in the ship's frame (`env_space.hdr`, `env_band.hdr`).
3. `Blender -b --factory-startup --python blender/ship/bake.py -- all` (~50 min on an M5; `trial --samples 64`: the same in ~2 min). It checkpoints into `bake/ship/raw/`; create `bake/ship/STOP` to stop after the current chunk, and the same call resumes. `-- uvs` charts and packs only.
4. `node tools/run-ts.mjs tools/ship-bake/pack.ts`: `assets/ship-cabin.bin`, uploaded to R2 under the same name (beside `house.pack`).
5. `node tools/ship-bake/compare.mjs --dist <build> --scene band|space|door x,y,z,yaw,pitch …`: the game beside Cycles path-tracing the same cabin under the same light, from the same cameras.

Any change to the cabin's geometry makes the bake stale. The game refuses it at boot, and `tests/shipCabinBake.test.ts` fails, until it is re-run from step 1.

## Light sets

- **One bake per light source; the game sums them.** The sets are:
  - interior (the lamps and the screens);
  - space (scene 1's outside through the panes);
  - band (the band's outside at the landing);
  - door (the band's outside through the open door alone, the panes black, the leaf slid open), scaled by the share of the door uncovered.
- **Scenes 2 and 3 share the landed light.** The outside on the approach barely changes overall. Nothing of the outside's shape is baked into a reflection, so a moving world never shows a stuck one.
- **The pack sums interior into each scene's set:** the lamps and screens are never dimmed in the film. If they ever are, ship the interior set apart again.
- **The leaf keeps its shut light.** Slid open, its inner face lies in the fairing's track, out of sight (its open bake was black).
- **The star is baked, not drawn live.** On the band it is a 45°-radius disc overhead, so its light through the windshield is soft and moves little as the ship banks. *Rejected:* a live direct-star term with a cabin shadow map, proposed for a point-like star.

## What is baked where

- **Lightmaps for faces with room for their light; the light at each corner for the rest** (fittings, knobs, the trims' slivers).
  - Charts grow over neighbouring faces by exact unfolding, within 50° of their seed and never overlapping, so a chamfer joins the panels either side (no sliver, no seam).
  - A chart narrower than 4 texels is corner-lit instead.
  - The atlas is a power of two (2048² for the cabin); the texel is the finest that still fits (~1.6 cm).
- **Faces nothing can see stay out of the atlas.** That means faces the cabin's air never sees (rays from a grid through the capture boxes), such as the hull's skin round the engine bay, and faces pressed against another surface. *Rejected:* the pressed test alone: the enclosed engine bay charted 24 m of hull skin.
- **While baking, the surface being baked shades as white diffuse** (its camera ray); every bounce and every light sees the real finish. A DIFFUSE bake measures light through the diffuse response, and the metal rib frames baked black.
- **A short-range AO (0.35 m)** for the specular occlusion.
- **Corner order is canonical:** each face from its lowest corner on a 0.1 mm grid offset by 0.3 of a step.
  - Chrome and Node start some of the convex kernel's loops at different corners (a last-bit difference at ±π).
  - Designed dimensions fall on the grid's half-steps.
  - The bake's per-corner data and the fingerprint use that order.

## Shading

- **Diffuse:** the scene's set (a uniform picks the layer) plus the door's × its open share, as white-Lambertian radiance (`albedo × light`).
- **Glossy:** along a lobe that leaves through a pane or the open door, the live outside; otherwise the cabin's box-projected capture (cockpit and cabin boxes).
  - The opening's share is the lobe's cone (half-width ~ roughness²) against the opening's rounded outline. It is no more than the opening's area over the cone's footprint. *Rejected:* the mirror ray's hit alone, which printed the windows' hard outlines on rough floors and walls.
  - The captures render the outside black for camera rays, so nothing static of the outside is ever reflected.
- **Specular occlusion from the AO** (Lagarde's fit). *Rejected:* the house's ratio of baked diffuse to the capture's roughest level. Here the bake holds the star through the windshield and the capture none of the outside, so the ratio printed the sunlit patches into every reflection and blacked out the metal frames.
- **No contact AO over a lightmap;** corner-lit fittings keep it (`sceneMrt.ts` weight).
- **The canopy's inner faces reflect the cabin's capture.**
- **Each object's sets are the layers of one texture, as are the captures.** A fragment stage has 16 sampled textures, and separate textures went over.

## Validation

- Against Cycles in scenes 1, 2 (landed) and 3 (door open), levels, gradients, metal and the light through the openings match.
- The floor shows a stronger sheen than the reference. Its tread lowers the roughness by 0.05–0.12 and tilts the normals, and the reference has no normal maps.

## Delivery

`ship-cabin.bin` (~74 MB: three 2048² RGB9E5 lightmap layers and AO for the cabin, the leaf's, corner light, six captures) is read from R2 only, in one fetch at boot. A failure is fatal.

- R2's CORS admits the dev server's origin. The headless tools fetch the file from R2 in Node and hand it to the page (`tools/serveDist.mjs`, `serveAssetHost`): R2 only, never the local export.
- `tests/shipCabinBake.test.ts` checks the local export (what is uploaded) against the geometry. A re-bake must be uploaded too.
