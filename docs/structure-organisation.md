# Structure organisation: what the visible divisions are

Code: `src/sky/structure/` — `districts.ts` (collectors), `courses.ts` (the band), `relief.ts`, `plating.ts`, `reflected.ts`; the edge cross-section in `trace.ts` (`PANEL_EDGE`). Layout, materials and light are in `sky.md`; the acceptance test is `scale.md`.

**Status: experiment.** This pass exists to judge whether it sells the scale. It may be kept, changed or removed.

## The principle

At this scale a visible division must read as an engineered region holding more construction than the eye can resolve, never as one panel of a building. Sizes: the band is 120,000 km wide, a gore panel ~700,000 km, a district 10,000–40,000 km, an assembly 1,000–4,000 km.

- **The perspective trap.** On the shell, viewing distance d = 2R sin e and surface distance s = 2Re, so equal lengths along the surface take roughly equal elevation angles. The shell gives none of a road's endlessly shrinking tiles, and an even rhythm along it reads as a ladder. Nothing here repeats at a spacing, and joints are staggered.
- **Nothing large is flat.** A flat frame tilts by half its size at its edges. The old plating's 19° divisions tilted ~9°: whole regions shaded as single panes of glass and flashed as bright rectangles near the star. Divisions now follow the shell's curve; only assemblies under `flatMax` (≤ 0.17° tilt) are flat. Large regions differ by set error, finish and heat, not by facet gradients.

## Collectors (`districts.ts`)

One network sets the seams, the relief, the finishes and the heat:

perimeter header → manifolds → branches → districts → assemblies → tiles.

- **Guillotine cuts.** Each cut runs across its cell, so every channel ends on a larger one (T-junctions, never crossings) and branches visibly join manifolds. Channels are sized by the cell they drain: wide, deep and hot for manifolds, narrow and shallow for branches.
- **Two stages.** The first three cuts (the manifolds) follow meridians and parallels, as the panel edges do. Inside each ~300,000 km basin the network is turned by the basin's own angle (30 % of basins are not turned), so districts have distinct orientations.
  - *Rejected:* one orientation everywhere. The long cuts along parallels face the view, and the panels read as ruled paper.
- **Districts drain** into their largest bounding channel; the perimeter header outranks every channel. Assemblies are laid in strips along that flow. The coolant warms toward the drain. Each district is polished, satin or striped (strips alternating), with odds set by its basin's character.
- **Test:** with tile variation suppressed, a panel must still show its organisation.

## The band (`courses.ts`)

- **Circumferential courses** of irregular width, with none on the city's own line. A centre line pointing at the viewer reads as a road.
- **Sections** are cut per course at jittered lengths, so transverse joints never line up across the band.
- **Boundaries are finish changes:** pane packing, coating, haze and setting precision change at section and course boundaries. Physical joints are narrow.
  - *Rejected:* broad dark mullions (paving slabs); visible seams between courses (a multi-lane road); a strong section patchwork (paving again).
- **Haze carries the patchwork.** A precision mirror mostly images more of itself, so tone differences barely show in reflection. A hazed section also scatters a little starlight at wide angles: its diffuse albedo, 0.3–1.1 %. The mean (0.57 %) is the enclosure solve's veil albedo, and `tests/structureDetail.test.ts` keeps them equal.
- **Panes** vary about their section only where they are resolved.

## Relief and edges

- **Relief** cuts only the first `reliefLevels` of the network as channels, with inlet sumps where a branch meets a larger channel and shallow field steps. The finer branches are shading only.
- **Lit far walls.** Under a star 90° across, a channel's far wall faces the viewer and catches the star. At grazing angles a channel therefore shows as a lit line with its floor hidden by the near lip. This is physical; walls are kept dark and matte so the lines stay subtle.
- **Cost.** The march runs in the entry point's cell throughout. Channels are symmetric about their lines, so the shared boundary channel stays right past the cell's edge. Where the march clears every channel, the hit is closed-form.
  - *Rejected:* a descent per march sample. Its register pressure cost ~4 ms at 1080p across the whole sky shader.
  - This pass costs ~1 ms at 1080p overall.
- **Panel edges** (`PANEL_EDGE`) are layered:
  - a thin collector-facing layer;
  - a recessed distribution layer set back under it, dark, with warm pipe runs;
  - a deep structural backing.
  - Full-depth connections fill the recess where a manifold meets the perimeter. Everything stays inside the outline over a continuous backing. Primary rays only; reflections see a plain edge.

## Filtering and reflections

- **Per-axis footprints** (`plating.ts`). A pixel's footprint is ~1/sin e longer along the view than across it (6:1 at 10°). Statistic cells follow that shape, and N is the footprint's area. Detail resolved across the view survives where it is lost along it, and unresolved assemblies join the sample (σ/√M).
- **Reflections see regions** (`reflected.ts`): see `sky.md`, Shading.

## Motion

- **Sky velocity** follows the frame's turn (`render-pipeline.md`), so TRAA does not soften occlusion edges that move with the frame.
- **Deferred:** making light echoes legible, i.e. a flare followed by a spatially related response in the reflective regions. Today only resolved, traced mirrors carry echoes; the unresolved mixture does not.
