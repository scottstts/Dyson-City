# The house in the game

Code: `src/house/`. The asset and its export contract are `blender/docs/house.md`; the estate round it is `docs/estate.md`.

## Loading (`pack.ts`, `assets.ts`, `houseWorker.ts`)

- **From R2, never the local file.** The game reads `house.pack` from the R2 bucket by HTTP Range. Entries are kept in the Cache API under a hash of the index, so a re-export never serves stale bytes, and old caches are pruned once the interiors are in.
  - R2's CORS allows `http://localhost:5173`; the headless tools answer the R2 URL from `assets/house.pack` by request interception (`tools/serveDist.mjs`, `serveHousePack`) rather than adding origins.
- **Everything at boot.** The exterior loads in parallel with the atmosphere stage; the floors (G, L1, L2) and the room reflections are built in the boot's `interiors` stage. A failure is fatal through the normal error path.
  - **Rejected:** streaming the floors in after the game started. Building and compiling them mid-play stalled frames, and the house froze the game the first time it came into view.
- **Every pipeline compiled while loading** (`game.ts warmAll`): one frame through the real pipeline with every object shown and none culled, so what is out of the spawn view, beyond a range or indoors has its pipelines and textures before play. `renderer.compileAsync` was not enough: it builds for the canvas, not the scene pass's MRT targets, and skips whatever the camera's frustum culls. `tools/cold-compile.mjs` boots headless, looks all round from the estate's viewpoints and through every floor of the house, and fails if any shader program or pipeline is created after loading.
- **A worker compiles each part** with a minimal glTF reader (three's loader was not used: it allocates per mesh and decodes on the main thread):
  - static meshes merged per (material, lighting kind) into a few draws;
  - per-vertex SH light for probe-lit meshes;
  - collision proxies, door rigs, apertures (window and outer-door bounds), markers;
  - the floors underfoot (`floors.ts`, for footsteps);
  - the rooms' reflection captures prefiltered (GGX, rgb9e5 atlas).

## Light (`bakedLight.ts`, `materials.ts`)

- **Lighting kinds:** `lightmap` (architecture), `probe` (furniture, doors: per-vertex SH), `exterior` (lit like everything outdoors, by the estate's probe), `mixed` (windows and outer doors: faces into a room are baked, faces out are lit outdoors).
  - A face of a mixed mesh is indoor by the window's mid-plane, and only Win_/Door_ meshes are mixed. A probe or room-box test misread the siding and mansard as indoor.
- **Specular indoors** comes from the room captures: per fragment the nearest room box, box-projected, through `EnvironmentBRDF`.
- **Glass** is a thin pane in two passes: a multiply (the tint) and an additive reflection. Neither writes the normal or velocity attachments.
- **Eye adaptation reaches 64× (+6 EV)** indoors (`render/adaptation.ts`). The bake keeps rooms physically dim; this range decides how they read.
- **Lamps.** Every room has one; the hall, landing and top hall two pendants each. They are lit at a warm, generous domestic level (about twice a real lamp of each kind, `blender/build/rooms.py LUMENS`). The shades and the bowls' glass glow at the radiance the bake computed from the same flux (the pack index's `lamps` table): what glows is what lit the room.
  - **Rejected:** a fixed glow per material. It was ~20× brighter than the light those lamps gave the bake, so the bowls blazed over dark ceilings.
- **The eye adapts partly to interiors** (`render/adaptation.ts`): fully over the first two stops under the sunlit garden, 0.8 of each stop beyond, up to +11 EV. A day room reads ~1.2 stops under the garden, a lamp-lit hall ~1.8: dim but legible; windows blow out.
  - **Rejected:** full adaptation capped at +6 EV. Lamp-lit spaces, ~11 stops under the garden, read black.
- **No screen-space AO over the lightmaps:** they hold the architecture's occlusion already (the scene pass's AO weight, `render/sceneMrt.ts`). Probe-lit furniture and doors keep it for contact.

## Walking and doors (`player/walkMesh.ts`, `doors.ts`)

- **3D walk mesh.** The house's proxies become floors and walls split by slope; walls are clipped to the body's band (feet + 0.42 to + 1.75 m), so a riser is a step and a wall is a wall. `ground(x, z, yMax)` takes the highest floor under the feet, which gives the storeys.
- **Every drawn mesh is accounted for:** a proxy, or a geometric reason for none (`blender/build/collision.py`). `compile.ts` lists any drawn mesh with neither (`unaccounted`).
  - **Rejected:** an allow-list of names that collide. Whatever it forgot let the walker through: the stair cheeks and porch skirts (into the void under a deck), then the west porch's roof, the balcony's floor.
- **The collision proves itself against what is drawn** (`tests/houseCollision.test.ts`). A flood fill finds everywhere the walker can get to from the garden, by the controller's own step, jump and body, with the doors open. It fails if any visible geometry is inside the body anywhere, or if any visible surface the walker could step or jump onto has no floor under it. `tests/houseWalk.test.ts` walks every flight from an arc of directions and offsets and fails if the walker ever stands under a deck.
- **Proxies leave cracks** (the porch deck and its top step: 2 cm). The walk mesh gives the sole 3 cm in plan (`docs/player.md`), so a crack is never a hole.
- **Doors** turn or slide on their rigs' local transforms only. E opens or shuts the door the player stands at: the nearest leaf whose handle is within 1.8 m of the feet in plan, on their storey, and within 60° of their heading (the view's pitch ignored); once offered it stays until they step or turn clearly away (2.3 m, 80°), so the prompt holds steady. A pair moves together; a prompt shows what E will do (`ui/prompt.ts`).
  - *Rejected:* the handle within 0.22 rad of the line of sight from the eye. Up close the handle is ~0.7 m below the eye, so the prompt showed only in a narrow band of distances.
  - A leaf runs at its pace and brakes to its stop (constant deceleration, its rate following the hand). Each leaf is a moving wall and stops against the walker rather than pass through.
  - `timeToTarget()` runs the leaf's own motion ahead: the sound times the shut's strike by it (`docs/audio.md`).

## Indoors (`culling.ts`, `house.ts`)

- **Outdoors culled to the windows.** Inside, everything outdoors is hidden except what a window or an open outer door frames: each aperture is a frustum from the eye through its bounds, and an object outside every frustum is not drawn. Outdoor probe refreshes pause indoors (nothing outdoors is lit for the eye then but what the windows frame).
- **Interiors only near.** Floors are drawn within 60 m of the house's middle; from further off the windows show the outdoors' reflection over rooms ~7 stops darker.
- **The star's glare fades as the eye walks in**, under the porch roof and through the door, as it does into the gate's chamber: the house's exterior is a 0.25 m occluder map (lowest and highest surface per texel, clipped to what stands 2.9 m over grade: one interval from the porch's deck to its roof put the eye on the porch inside a solid) that the star's visibility marches (`city/visibility.ts`); indoors it is nil. The share the camera takes is eased over 0.4 s (`game.ts STAR_EASE`), so a quick step or turn never pops it; the exposure then opens over ~1.4 s, as in the airlock. *Rejected:* switching the glare off when the eye entered a room: the frame dropped a step darker at the threshold before the eye began to open.

## Review

- Viewpoints `porch`, `front`, `parlour`, `hall`, `library`, `dining`, `landing`, `study`, `turret` (`debug/viewpoints.ts`, `inHouse`).
- `tests/housePack.test.ts`: the bundle's structure. `tests/houseWalk.test.ts`: the porch steps and the shut door, the hall through the open door, the west porch steps, the main stair, and what is underfoot along each walk. `tests/houseCollision.test.ts`: every mesh accounted for, and the collision against what is drawn everywhere the walker can reach. `tests/houseDoors.test.ts`: the doors' time to rest.
