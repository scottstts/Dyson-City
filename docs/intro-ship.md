# Intro: the ship

Code: `src/intro/ship/`. Ship frame: metres, x forward, y up, z to starboard, origin on the ground under the hull's middle with the ship standing on its gear (`spec.ts`).

## Design

- **Black and faceted, unlike the city's gilded ivory.** A slim chined body between two engine nacelles on stub wings, a canted fin on each nacelle; flat panels and flat panes.
- **The target is the user's reference renders** (front and back three-quarter views made from this model): a graphite ship, worn and working, every face broken up by panels, plates, hatches, grilles and stencils, with bronze nozzles. "Too simplified" was rejected twice: substantial, plausible detail inside and out is the bar.

## Construction

- **Hull and nacelles** are convex half-space bodies with every edge chamfered (`geometry/convex.ts`), built as thick shells with apertures (panes, the door, gear bays, lift vents, the intakes, the nozzles' throats). Wings and fins are solids buried in what carries them.
- **Fittings** (`details/`) are modelled in a facet's own frame and carried onto it (`details/mount.ts`). Each stands a centimetre into its host, a declared seat (`parts.ts`), and records its footprint. `tests/introShip.test.ts` checks topology, coplanar overlap, clashes beyond the declared seats, and that every footprint lies wholly on its facet. It caught fittings and plates overhanging the side facets' raked ends, and bands crossing the fan's hub.
- **Detail is split by scale.** Anything a few centimetres or more is geometry: doubler plates with lift handles, the dorsal spine and its fins, radiator and bay louvres, antennas, RCS quads, probes, the docking hatch, ventral strakes, nacelle segment bands, intake frames and vanes, nozzle shrouds, lights. Anything finer is shaded (`skin.ts`): seams, fasteners, access hatches, stencils, grime.

## Skin (`skin.ts`, `materials.ts`)

- **Seams follow the structure.** Transverse joints at the frames' stations (x = const) run unbroken round the body from facet to facet; some bays split again. Longitudinal joints are staggered bay to bay. Panel edges roll into each centimetre-wide joint, which draws the seam under a grazing light.
- **Every panel has its own lay-up** (tone and roughness), so reflections break into a patchwork. Access hatches carry rings of fasteners; fastener rows run along the transverse joints; some panels carry stencilled legends (ochre, white, red) in 5 × 7 letters.
- **Everything is box-filtered to the pixel's footprint.** Below a pixel a seam is its coverage and a fastener or letter its share of the area, so nothing shimmers as the ship flies off.
- **Finish by slot:**
  - upper hull graphite;
  - lower hull (belly, cheeks, chin, nacelle floors) a darker thermal coat;
  - chamfers worn lighter;
  - doubler plates unseamed;
  - titanium fittings;
  - burnt-bronze nozzles.
  - **Rejected:** a near-black satin skin (#0b0b0c). It read as an untextured silhouette.
- Inside, consoles and the dash carry fine screwed-panel seams; the floor a diamond tread; the liners an acoustic perforation.
- **Contact AO sees the smooth surface.** These materials write their geometric normal to the scene pass's normal target (`smoothContact`): GTAO fed the shaded seams' and tread's millimetre normals sampled them at half resolution with its temporal noise, a crawling dark grain over the cockpit's floor.

## Moving parts

- **Door.** A plug leaf: unlatch, out 0.11 m clear of the reveal, then aft along a track in a fairing. Whenever the stair moves, the leaf has slid clear of the stair's width (tested).
- **Stair.** Stowed flat in the floor void, it runs out under the threshold, then swings down about its inboard end. The pitch is solved so the foot pads' outer edge meets the deck (tested): an earlier pitch, solved for a point that is not where the pads touch, left them 7 cm in the air. Its treads stay level (parallel linkage) and its stanchions stand up as it lowers.
- **Gear: articulated trailing-link legs, not poles.** The user rejected a telescoping strut as "just a pole". Each leg (`gear.ts`):
  - a tapered box strut on trunnion pins in the well's walls;
  - a pinned knee carrying a twin-plate trailing arm with a horn;
  - an oleo shock from a strut bracket to the horn, which the ship's weight closes (`COMPRESSION`);
  - a broad ribbed foot on an ankle clevis that stays level;
  - a retraction actuator.
  - Retracting, the doors open, the arm folds in line with the strut and the leg swings aft.
  - Bays and wells are sized from the leg (strut + arm + foot). The body/rod lengths of the shock and the actuator are sized from their reach (`stroke`). `poseLeg` is the one posing function for the ship, the review tool and the tests.
  - The tests check that every folded piece lies inside its well, that both strokes are covered, and that every foot's sole is on the deck at rest. Earlier layouts failed the well test: torque links and an accumulator poked through the skin when stowed.
- **Engines.** Two mains (bells on gimbals under bronze ribbed shrouds, centre plugs, glowing cores) and five lift vents. The jets are the craft's analytic plume (`vehicles/craft/plume.ts`).

## Light

- **The cabin is lit like any interior: baked in Cycles** under the game's light (`docs/intro-cabin-bake.md`): lightmaps and per-corner light per scene, reflection captures, the live outside along reflections that leave through an opening. Image-based light alone lit the cockpit white in scene 1 with the star the hull hides.
  - *Rejected:* a per-vertex bake in the game (visibility through the openings, the lamps unshadowed, one constant for the bounce): the cockpit read flat, the floor under the dash as bright as the open floor.
- **The panes are not geometry.** They are composited analytically in post like the Dome's glass (`canopy.ts`, `glazing.ts`), so the world through a moving ship's windshield keeps its velocity under TAA.
- **The ship's lights** (`lights.ts`) run while the engines do:
  - nav red and green on the nacelles, white at the tail;
  - strobes on the fins' tips, a double flash every 1.4 s;
  - red beacons over the spine and under the belly;
  - landing lights in the chin and on the nose leg while the gear is down and the lifts run.

## Review

- `node tools/ship-shots/shots.mjs [--real] [--t s] ext/az,el[,span,cx,cy,cz] in/x,y,z,yaw,pitch[,fov]` renders the ship alone.
- Plain studio tones show form and joints; `--real` shows the ship's own exterior materials (skin, lights).
- `t > 0` poses the door and stair t s into opening; `t < 0` retracts the gear.
