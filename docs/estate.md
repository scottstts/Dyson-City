# The estate

Code: `src/estate/`. The plan's intent is `docs/city_plan.md` §4; the house itself is `docs/house.md`.

## Plan (`layout.ts`, `sdf2.ts`, `regions.ts`)

- **The plan is data plus signed distance fields.** `layout.ts` holds every dimension (the terrace's outline, the gateway, forecourt, drive, walks, pond garden, kitchen garden, orchard, carriage house). Shapes combine by union, intersection and smooth union (fillets where gravel meets gravel, so no sharp concave fold reaches the kerbs).
- **Ground classes by priority:** void > water > soil > flag > brick > ramp > gravel > meadow > lawn. Each point belongs to the first class that claims it, so outlines never overlap. Every class is clipped to the terrace except the ramp, which runs out through the gateway.
  - Void is ground that is not ground: the house, the steps, the cutting, the cheeks, the carriage house, the kitchen walls (minus their gate openings), the glasshouse.
- **Contouring** samples the fields on a 0.1 m grid finely only near outlines (a distance field is 1-Lipschitz, so a coarse cell far from its outline cannot contain it): 6.5 s became 0.9 s. Loops are simplified (RDP) and nested.
- The class grid is kept: the grass's mask and the footsteps' surface (`surface.ts`).

## Ground and masonry

- **The terrace is flat** at the pad + 1.6 m (`levels.ts`), the house's grade.
- **Kerbs and edgings** follow region outlines. They skip edges against walls and the house (where they would fold), lose near-duplicate points and spikes, bridge small gaps and trim their ends, so neighbouring runs never overlap.
- **Masonry is swept profiles** with mitred joints (`kit.ts`): the retaining wall, plinths, rails, copings, kerbs.
- **Balustrades:** balusters and piers instanced. A pier at a corner turns to the bisector, and balusters keep clear of it.
- **Lathe parts** (balusters, urns, finials) are built about the up axis (`upright`). Built about z they lay on their sides.
- **Gateway:** the ramp in a cutting between retaining walls, a flight of steps either side (top tread at the head), cheek walls in the void, urns on the gate piers.
  - The flights reserve the void each on its own side of the ramp: one void box across the whole gateway outranked the ramp and took its foot, so the ramp began 4.6 m inside the wall line, 0.37 m over the pad (`tests/estate.test.ts` holds the ramp to the wall line).
- **Hedges** are swept sections with noise displacement, openings cut where walks pass.
- **Buildings:** the kitchen garden's Flemish bond walls with buttress piers; the glasshouse (dwarf walls, members, panes); the carriage house (layered doors); benches and a sundial.
- **Every part is audited** (`tests/estate.test.ts`): closed outward solids, no coplanar overlap, no clash beyond declared seats (`tests/helpers/estateAllow.ts`).

## Planting (`plants/`)

- **Trees grow** from per-species tables (cedar, copper beech, lime, oak, apple): branches from a queue, leaves as crossed sprig cards on a painted atlas.
  - The atlas's mips preserve coverage (alpha rescaled per level) and fill transparent texels with the mean colour, so a distant crown neither thins out nor fringes dark.
  - Leaf cards carry a rounded normal (blended toward the crown's outside) and a crown-depth shade (as AO): the crown shades as a volume.
  - Translucency (light through the leaves from the sky above) and card wind. A leaf transmits about what it reflects (`LEAF_TRANSMISSION`); a face turned up toward the light shows 15 % of it. At 0.3 × albedo (a tenth of that) the canopies' undersides read as dark masses under a star overhead.
- **No impostors, no "ball far, leaves near".** Distance thins cards by a fixed rank per card, continuously (from 70 m to 320 m, keeping 0.4), and the survivors grow to keep the crown's coverage. A crown is leaves at every distance and nothing swaps.
- **Beds:** shrubs, perennials and vegetables only in soil regions (kerbed beds); the walker is fenced out of them. Clipped yews as topiary.
- The delphinium border is a mix of mid blue, mauve and pale spires. A single saturated violet read as a painted block.

## Grass (`grass.ts`)

- **Blades on camera-snapped world grids**, masked by the class grid at each blade's foot: a mown lawn (finest cell 0.07 m, 4.5 cm blades) and the orchard's meadow (0.13 m, 24 cm).
- **Rings, not one grid.** The first build was one fine grid ending 12 m out, and its edge read as a ring round the eye. Now four nested rings (cells ×2 and radius ×2 each, a clipmap) carry the blades to ~55 m (lawn) and ~80 m (meadow), where a blade is about a pixel tall and the ground's mean takes over.
  - Beyond `thin` (3.5 m, 5 m) the tufts' density falls as 1/d²: the same density on screen at every distance. Each ring begins exactly as dense as the law and thins across itself by a fixed per-tuft rank (survivors spread wider); neighbours cross over by rank within ±12 % of their boundary, so the sum never steps (`tests/estate.test.ts`). Tufts grow and shrink in across a little of the rank instead of popping.
  - Coarser rings bend their blades in fewer segments (3, 2, 2, 1).
  - Cost: ~10 M vertices a frame for both fields, about a third more than the 12 m grid, most of it tufts discarded by rank. A GPU-compacted visible list (indirect draw) is the next step if this shows in the frame time.
- **The ground is the turf.** Seen from above, a sward is its blades, so the lawn's ground reflects ~0.1 (green ~0.13, red and blue far less), not soil. Under the blades it is only a little darker. Its bump is gentle: blade-scale bump at 380/m tipped the normals off the star and blackened the lawn.
- **A blade shades like the sward** (its normal leans the sky's way), and its sheen, wax glint and translucency are kept small. Brighter, the lawn read as bright specks on dark ground.
- **Mown stripes** come from the blades' lean, alternating by stripe, brightness by the eye's bearing.

## Light

- **The estate's reflection probe** (`probe.ts`) is one cube capture 5 m over the forecourt's island, looked up with parallax correction by the estate's materials and the house's exterior.
  - It must stand in open air. It first stood 0.9 m inside the house, saw the shell from within, and lit the whole estate ~10× too dark. `tests/estate.test.ts` keeps it clear of the house and above everything near it.
- **The star-shade** (`lighting/starShade.ts`, `docs/shadows.md`):
  - each texel marches from its own floor (the terrace, or the platform below), so a raised garden is shaded by what stands round it;
  - a face samples visibility a little ahead along its normal, so a hedge's side is not shaded by its own footprint;
  - a face on top of its own occluder sees the whole cap, but only for occluders of real height (≥ 0.4 m). Counting kerbs, ground inside any kerb's 1 m texel was freed, and paths showed texel blocks.

## The crew

Three Hands keep the garden (`docs/crew.md`): one mows the lawn's stripes, one trims the yew hedges, one tends the kitchen garden and the orchard. They walk the walk mesh's open ground; no drone flies over the estate.

## Sound

Footsteps by surface (grass, gravel, stone) and the house's sounds (the trees are silent): `docs/audio.md`, "The estate" and "The house". The garden's Hands, their mower and trimmer are heard on the estate's side of its silencer: "The crew".

## Review

Viewpoints `gateway`, `balustrade`, `forecourt`, `approach`, `pond`, `kitchen`, `carriage`, `back`.
