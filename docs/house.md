# The house in the game

Code: `src/house/`. The asset and its export contract are `blender/docs/house.md`; the estate round it is `docs/estate.md`.

## Loading (`pack.ts`, `assets.ts`, `houseWorker.ts`)

- **From R2, never the local file.** The game reads `house.pack` from the R2 bucket by HTTP Range. Entries are kept in the Cache API under a hash of the index, so a re-export never serves stale bytes, and old caches are pruned once the interiors are in.
  - R2's CORS allows `http://localhost:5173`; the headless tools answer the R2 URL from `assets/house.pack` by request interception (`tools/serveDist.mjs`, `serveHousePack`) rather than adding origins.
- **The exterior at boot, the floors streamed.** The exterior loads in parallel with the atmosphere stage; after the game starts, G, L1 and L2 stream in (nearest first), each compiled before it is shown so it never stalls a frame, then the room reflections. A failure is fatal through the normal error path.
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
- **Lamps.** The bulbs' glass and the shades glow at their bake's luminance (`LAMP_GLOW`). The rooms' light from the lamps comes from the bake.
- **Decided, not yet baked:** the dark rooms (the windowless hall, landing and top hall) get the lamps on at a warm, generous domestic level in the re-bake. The re-bake waits for the estate's approval; it re-captures the game's light with the estate in place (`tools/house-env.mjs`).

## Walking and doors (`player/walkMesh.ts`, `doors.ts`)

- **3D walk mesh.** The house's proxies become floors and walls split by slope; walls are clipped to the body's band (feet + 0.42 to + 1.75 m), so a riser is a step and a wall is a wall. `ground(x, z, yMax)` takes the highest floor under the feet, which gives the storeys.
- **Parts without a COL_ twin collide as their visible mesh** (`compile.ts`, `OWN_COLLISION`): flights of steps (the west porch's), the stair cheeks of every flight, the porches' skirt frames and the stoop's and west porch's stair rails. The export had no proxies for the cheeks and skirts: a walker slipped past a flight's edge at grade into the void under the deck and could not get out. `tests/houseWalk.test.ts` walks every flight from an arc of directions and offsets and fails if the walker ever stands under a deck.
- **Proxies leave cracks** (the porch deck and its top step: 2 cm). The walk mesh gives the sole 3 cm in plan (`docs/player.md`), so a crack is never a hole.
- **Doors** turn or slide on their rigs' local transforms only. E opens or shuts the leaf whose handle the eye aims at (2.1 m reach, 0.22 rad cone); a pair moves together; a prompt shows what E will do (`ui/prompt.ts`).
  - A leaf runs at its pace and brakes to its stop (constant deceleration, its rate following the hand). Each leaf is a moving wall and stops against the walker rather than pass through.
  - `timeToTarget()` runs the leaf's own motion ahead: the sound times the shut's strike by it (`docs/audio.md`).

## Indoors (`culling.ts`, `house.ts`)

- **Outdoors culled to the windows.** Inside, everything outdoors is hidden except what a window or an open outer door frames: each aperture is a frustum from the eye through its bounds, and an object outside every frustum is not drawn. Outdoor probe refreshes pause indoors (nothing outdoors is lit for the eye then but what the windows frame).
- **Interiors only near.** Floors are drawn within 60 m of the house's middle; from further off the windows show the outdoors' reflection over rooms ~7 stops darker.
- The star's glare is off indoors.

## Review

- Viewpoints `porch`, `front`, `parlour`, `hall`, `library`, `dining`, `landing`, `study`, `turret` (`debug/viewpoints.ts`, `inHouse`).
- `tests/housePack.test.ts`: the bundle's structure. `tests/houseWalk.test.ts`: the porch steps and the shut door, the hall through the open door, the west porch steps, the main stair, and what is underfoot along each walk. `tests/houseDoors.test.ts`: the doors' time to rest.
