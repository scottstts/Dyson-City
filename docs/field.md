# The Field

Code: `src/field/`. Intent is `docs/city_plan.md` §5–§7; the plan drawing (`city_plan_site.png`) is generated from this code by `tools/site-plan/sitePlan.mjs`.

## Layout: one walled compound

The user rejected the first layout: it read as facilities scattered on an empty lot. The field is now planned as one industrial compound. It has boundaries, zoning and a deliberate use of height.

- **One source of truth:** `layout.ts` holds every position, footprint, road, viaduct line, trench, precinct and the Cordon's plan.
  - The builders, the paving, the walls, the sound, the tests and the site-plan tool all read it.
  - The plan tool bundles `tools/site-plan/planData.ts`, which calls the builders' own layout functions, so the drawing cannot drift from the build.
- **The ground repeats the Dome.** Avenues (20 m) run under its rib lines at x, z = ±192, two coffers out. With the Axis Road (west) and the Meridian (north–south), they cut the compound into blocks.
  - The ring road runs under the Halo; a perimeter road runs inside the Cordon.
  - There are no spurs: every hero stands in a block and is reached from the avenues.
- **The Cordon** (`cordon.ts`) walls the compound: an arcaded wall-gallery 13.7 m high, walkable on top, at r 440.
  - Pylons stand where the avenues and the Meridian end. Those gates are bridged by the gallery deck.
  - The craft gate, where the corridor leaves, is open to the sky. Nothing stands on the corridor's ground, and craft fly over at a few tens of metres.
  - The west front has the main portal on the Axis Road: a satin-gold arch between the two tallest pylons. It ends at a pylon where the estate's own wall will meet it.
  - Arches are split: each pier's haunches stop 0.9 m short of its neighbour's, so each arch opens at the crown in a slot to the soffit. Every bay is a whole arch; half piers are engaged in the pylons.
- **Precincts** are the blocks between the roads. Each has a zone: craft, instruments, power, cryogen, science, works or heat.
  - Each zone has its own flush stone (`paving.ts`), inside a bronze border 1.4 m in from the block's edge. Roads and trenches cut through it.
  - Each precinct holds its hero, and secondary plant fills the rest.
- **Viaducts** (`network.ts`):
  - A square main at ±208 runs just outside the avenues' ring of blocks.
  - Trunks along the Axis Road and the Meridian swoop down to it from the Halo's height.
  - Valve pavilions under the main draw from it into each precinct.
- **Levels:**
  - ground plant;
  - the Cordon's deck and the viaducts (10–16 m);
  - the Halo (~20 m);
  - tower rings (40–110 m);
  - towers and spires to the Dome's limit.
- **Clearances are tested, not assumed** (`tests/fieldZones.test.ts`):
  - every vertex stays 30 m under the glass at its own plan radius;
  - nothing in the craft corridor rises over 20 m;
  - nothing stands on the estate's terrace.

## Secondary plant

The user chose a dense working plant: 40–55 % of each precinct built (`plant/`).

- **Lots** (`plant/lots.ts`, pure data) are packed on a 1 m raster.
  - Scanning rows from each precinct's corner nearest the core, every free cell takes the largest building from the zone's menu that fits there. It must clear the keep-outs and keep a 6–10 m gap from what is already placed.
  - Anchored at the scan corner, buildings line up in rows, and the gaps between them become the lanes.
  - Along the craft corridor, the first row is hangars whose doors face it.
- **Keep-outs are declared from the layout, not measured from hero geometry.**
  - These are the heroes' footprints with a working margin, the core, roads, trenches, viaducts, pavilions, the corridor, the estate and the compound's edge.
  - The cross-zone audit is what catches a margin that is too small.
- **Height caps:** the glass less its 30 m clearance, 8 m within 60 m of the estate (the house looks over it), and 18 m beside the corridor.
  - Stacks and vents respect the lot's cap.
- **Zone menus:**

  | Zone | Plant |
  | --- | --- |
  | Craft | Halls, stores, compressor houses |
  | Instruments | Labs (some with a gold observatory dome), halls |
  | Power | Switchyards (transformers, bushings, gantries), turbine halls |
  | Cryogen | Compressor drums with stacks, tank farms in bunds, Horton spheres |
  | Science | Stepped labs |
  | Works | Sawtooth stores, halls, tank farms |
  | Heat | Cold-plant halls with roof fan decks |

- **Each precinct's trim is its zone's metal** (`zoneTrim`): roofs and tanks in bronze, alloy, satin or foil. Walls are ceramic everywhere, so each precinct reads as one works.
- **Builders** (`plant/buildings.ts`):
  - Bodies are profile sweeps, with their clerestory bands, eaves, parapets and roofs cut into the section. Gable rims are bevelled by an inset end section.
  - Fittings are seated and declared per lot (`lotAllow`). These are frame ribs, doors, vents, stacks and ducts, ladders, headers, bushings and fan decks.
- **Probes:** each zone's plant is one mesh, lit by its hero's probe. It costs no extra capture.

## Design language

The user's reference (a soaring metallic city) is borrowed for its language, not copied: forms that taper and soar, halo rings round them, members that flow in long curves, supports that branch, gold leading with chrome and white ceramic in support. Every form keeps a working purpose and is built at its true size.

- **Mega-towers** (`kit/tower.ts`, `heroes/towers.ts`). The user asked for some genuinely big, tall buildings, as tall as the Dome allows where they stand, not miniature spires.
  - Three clusters, each a bundle of lobed, ribbed towers converging on its tallest, on a round podium, ringed by great halo rings on spokes:
    - **the Stills** (cryogen distillation), 185 m;
    - **the Reckoner** (computation), 177 m;
    - **the Converter** (power), 156 m.
  - Heights are solved per tower against the glass. Satellites lean in as far as stays 1.5 m clear of the central tower at every height.
  - Black glazed slit windows run between the ribs, so a tower reads as inhabited structure at its size. One ring per cluster carries a gallery walk with rails: the human-scale cue.
- **Spires** (`kit/spire.ts`): the smaller vertical language. The Mast, and the radiator forest flanking the cold plant (heat-rejection spires: deep flutes are the fins, the rings are coolant headers).
  - Buttress fins are thin blades that leave the ground almost flat and rise steeply into the core (roots).
  - *Rejected:* thick fins with a straight flank. They read as white tents.
- **The Halo** (`halo.ts`) stands on sculpted superellipse arches straddling the ring road, the ring main on tapered stems branching from each arch's back.
  - *Rejected:* rectilinear portal frames (legs and a beam), which read as an industrial pipe bridge.
  - The road keeps at least 8 m clear under every arch.
- **Viaducts** (`network.ts`) replace pipe racks: a lens-section spine swooping from the Halo's height down toward the far end, on Y-piers, the lines riding its back to a domed valve pavilion. Power runs in the flush trenches.

## Materials and light

- **Gold's finish follows the face** (`materials/gold.ts`): polished on vertical and curved faces, satin facing the star (an up-facing mirror is as bright as the star).
  - Under a 45° source satin does not dim a face much: its lobe still lies inside the cap. Up-facing satin and foil are therefore rough (0.5; foil 0.3–0.75), and the foil's facet tilt is modest.
  - *Rejected:* glossy foil. The Halo's lines read as glowing lava tubes.
- **Tall gold is brushed, not polished.** A polished vertical face mirrors the horizon and the sky through the Dome, which here is dark, so polished towers read near-black. Brushing spreads the lobe up into the star's cap and the towers read as gold.
- **The Resonator is the one flawless mirror** (`mirror` slot). The Gyre's rotor is a mirror too; the Dome's coffer grid reflected in it is correct.
- **Reflections** (`probes.ts`, `render/parallaxEnv.ts`): one cube capture per zone at 256², taken where the zone stands. It is looked up with parallax correction against a sphere about the capture point, closed below by the platform, so the pale ground in a gold flank sits on the ground.
  - Captures hold the sky, the Dome's frame, the platform and the field's statics (lit by the interior capture), but no moving parts.
  - Refresh is one probe at a time, a face per frame, every 1° of frame turn.
  - All probes share the interior capture's sky material and one prefilter generator. *Rejected:* a sky mesh per probe. Each recompiled the sky shader and boot took 73 s more.
- **Basalt roads are satin-polished, not mirrors.** Without screen-space reflections a mirror floor cannot show the legs standing on it, and showed the environment's drum posts as streaks.
- **Glow:** the Loom's slit and hot ribbon use Planck radiance on the star's scale (`glowNode`, 3300 K at the slit, cooling along u), a few percent of the star.

## Star-shade

`src/lighting/starShade.ts`, following `docs/shadows.md`:

- A top-down 1 m plan map of the lowest and highest surface over each texel, rasterised from the field's meshes (~90 ms).
- A GPU compute pass integrating 24 cap directions per texel.
- Materials read it as an AO term on the star's share of the light (0.42 for vertical faces up to 0.82 for up-facing ones). It applies at the ground and fades out over 8 m above it: object surfaces higher up keep only GTAO.

## Motion

- **The Gyre:** the outer gimbal turns at the frame's rate (the rotor holds still against the stars); the inner gimbals trim by a few degrees over minutes.
- **The Loom:** the carriage rides on the rails (two-hour traverse); the ribbon runs level from the slit onto the spool's crown, and the spool turns at the draw speed.
  - The carriage rides on top of the rails because a level ribbon must meet the coil tangentially, at its crown.
- **The Mast:** the dish heads slew while scanning.
- **The Cold Hold:** relief stacks lift at random, about one somewhere every 20 s, and vent for 3–9 s (`vents.ts`). The vapour (`vapour.ts`) is a post composite of up to three bounded plumes, like the gate chamber's mist.

## Walls and ground

- `walk.ts` slices the field at body height (0.05–1.9 m) into a 0.5 m occupancy grid and turns its boundary into wall segments (~11 k).
- Roads are basalt underfoot (footsteps).
- Podiums and plinths are walls, not walkable.

## Cost

- About 22 zone meshes plus movers (heroes, the network, the Cordon, the plant by zone): one draw per material slot per zone.
- Boot: the field ~1 s, walls ~0.1 s, star-shade ~0.1 s, probes ~6 s headless.

## Tests

- `fieldHalo`, `fieldZones`: topology, coplanar overlap and clashes per zone and across the whole field. Movers are audited at two times.
- `fieldCordon`: the Cordon's topology and seats; the corridor, the Axis Road and the gates stay open on the ground.
- `fieldPlant`: lots stay off keep-outs and apart; every zone's plant is clean, under the glass and off the estate.
- `fieldWalk`: walls.
- Declared seats live in `tests/helpers/fieldAllow.ts`.
- `solids`: the kernel's new operations.
