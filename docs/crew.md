# The crew

Code: `src/crew/`. The robots that run the compound and keep the garden.

## What they are

- **Robots, not NPCs** (the user's ruling). They work; they never speak, follow, ask or need the player. The city stays empty of people (`city_plan.md` §1).
- **Where:** only inside the Dome. Three Hands keep the estate; every other robot works the field. Nothing works outside the glass.
- **Never on the main roads**, so driving stays unencumbered: the ring roads, the Axis Road and the avenues are out of bounds to every ground robot, with a 1.4 m margin. Drones take the work that a ground robot would have to cross a road for, or would block a lane doing.
- **The types and counts** (as built):
  - **Hand** (23): the humanoid, 1.78 m. 16 on precinct beats (lot fronts, pavilion doors, racks, tank posts, hero rings), 4 on decks (the Cordon's two decks, the galleries of the Stills and the Reckoner), 3 in the estate (mower, hedger, gardener).
  - **Rigger** (6): a four-legged works robot with a telescoping boom, reaching up to racks and louvres.
  - **Dray** (6): a low flatbed carrying a dewar. It parks over bronze sockets in its precinct's lanes and drops a coupling probe into them.
  - **Linewalker** (16): a pipe crawler on the square main's supply line, one per stretch.
  - **Spotter** (12): a small ducted drone with a camera gimbal, inspecting the heroes, towers and holds.
  - **Ferry** (4): a larger ducted drone shuttling between landing pads in neighbouring precincts.
- **Fixtures:** each Spotter's cradle (a fluted post), each Ferry's pad (a low drum) and each Dray's sockets are part of the world. Cradles and pads join the walker's and the car's walls and the star-shade's raster.

## Geometry

- **Every degree of freedom is a real actuator.** The user rejected ball joints as "lazy modeling". Each axis is a finned motor drum on one link and a bolted bronze flange or yoke on the next. Joints with several axes are gimbals whose axes cross at the joint's centre. Knees and elbows are bosses in a clevis.
- **Every piece is joined to its robot.** A yoke's plates meet a bridge or crown. A hinge's boss rides on a web (a tongue thinner than the clevis's gap) down into its limb. The palm hangs on a web from its flex drum. The head stands on a turned neck. The Rigger's hips sit in pods out of the hull's flank, and axles span the running gaps to wheels and rollers.
  - **Why this needs its own audit:** the clash audit lets a segment's own parts meet (they are one rigid body), so a piece floating inside one segment passes it. The first build had yoke plates beside their posts, the head 4 cm over its neck, forearms and shins below their joints, and a valve handwheel with no spokes.
  - `tests/helpers/crewConnect.ts` voxelises every piece at 4 mm and requires one connected assembly. A bearing's running clearance (≤ ~3 mm) counts as contact; a visible gap does not.
- **Rigs:** rigid segments modelled in the rest pose; forward kinematics. Each type is one `InstancedMesh` per segment and level, so one draw per segment and material slot for the whole type. Three keeps each instance's previous matrix, so motion vectors are correct.
- **LOD:** two levels. Full detail within 30 m (Hands, Linewalkers, Spotters) or 55 m (Riggers, Drays, Ferries). Beyond that a 0.3 tessellation level: drums lose their fins, flanges their bolts, panels their seams. Per robot, near/far: Hand 66k/17k triangles, Rigger 54k/10k, Dray 36k/7k.

## Motion

- **The Hand's gait** (`motion/biped.ts`):
  - Phase-driven stepping. Planted feet never slide; the body's facing is held within reach of its feet.
  - Each foot lands where the root will be along the arc it is turning on, set square to its heading at mid-stance. A straight-line guess put the inside foot under the body in turns and broke the hip's roll range.
  - The swing starts from the heel rise the foot last stood with. Read after the phase wrapped, the rise was zero: every toe-off snapped the foot flat, and the ankle dropped 6 cm for a frame.
  - A foot turned off the body's heading pivots on its ball, so its heel barely rises.
- **Routes** (`agents/follow.ts`): the root rides its polyline and slows into a bend, more the sharper the bend. Its turn rate falls with speed, to 60 % at 1 m/s, because a gait turns only so far each step. At 0.6 rad/s and walking pace the trailing foot ended 0.6 rad off the body's heading.
- **Joint limits** (`HAND_LIMITS`): checked per actuator through real jobs, not only scripted walks (`tests/crewSim.test.ts`). The roll ranges are mechanical: an inward hip roll past 0.2 rad brings the knees together.
- **Props:**
  - **Slate:** rides on the left palm.
  - **Mower:** squared to the body's facing, not the route's heading, so a turn on the spot does not twist the wrists. Grip is overhand, fingers tilted 0.45 rad down over the bar so the wrists stay near neutral.
  - **Hedge trimmer:** the rear grip goes at the hip away from the hedge and the hedge-side hand on the forward grip, so neither arm crosses the body. It cuts diagonally ahead (1.4 m along the face); aimed straight at the face, the forward arm folded at the shoulder. Between runs it is carried one-handed by the rear grip.
- **Rigger:** a wave gait, one leg at a time. Its boom aims, slides out to stand half a metre off the work, and stows before it walks on.
- **Dray:** drives routes rounded to its turning circle, with all-wheel steer from the curvature.
- **Drones:**
  - Minimum-jerk legs between stations; attitude follows acceleration; a slow hover drift at stations.
  - The pad's Spotters launch only when the craft will not come in before they are home (`CraftFlight.untilInside`, a lower bound that counts the lock's waits as none).

## Plans

- **Ground:** one 0.5 m occupancy raster of the field at body height, shared with the walker's walls (rasterised once).
  - An out mask on top of it: roads plus margin, the craft corridor, the core, the estate and beyond the Cordon.
  - A* with clearance (Hand 0.5 m, Rigger 1.25 m, Dray 1.45 m), string-pulled.
  - Fixtures are marked in before the ground routes are planned.
- **Air:** a height map from the star-shade's raster.
  - A leg is clear if it passes 4 m over structure within 5 m and stays 15 m under the glass.
  - Nothing flies over the estate, or along the craft corridor except the pad's Spotters.
- **Estate:** its walk mesh and class grid. The mower's stripes follow the lawn's stripe parity; the hedger walks 0.95 m off the yew faces; the gardener visits the kitchen beds and the orchard.

## Sharing the world

- A robot holds for whatever is ahead of it (the player, the car, another robot); held for 3.5 s, it routes round. Ground robots within 30 m of the player are moving outlines in the walker's and the car's walls (`CollisionWorld.setDynamic`).
- The 12 robots nearest the eye cast their soft noon shade on the ground (the vehicles' shade model, `vehicles/shade.ts`), multiplied into the platform's and the estate's ground.
- Light:
  - **Environment:** the field's central probe, parallax-corrected, over the compound; the estate's probe on its terrace.
  - **Ambient occlusion:** the star-shade's AO.
  - **Materials:** noise in object space, so moving parts do not swim.

## Sound

`docs/audio.md`, "The crew". The crew exposes state (`crew/sound.ts`: each loop's place and load, this frame's footfalls and latches); `audio/sounds/crew.ts` plays it.

## Review

- `?crew=<type>[:i[:s]]` runs the crew s seconds on and stands the walker facing robot i. Types: `hand`, `rigger`, `dray`, `linewalker`, `spotter`, `ferry`, `mower`, `hedger`, `gardener`.
  - The default is 20 s, or 0 s for drones, so they are seen at rest on their cradles and pads.
  - Under `?time` the crew holds still. It is posed once when built: agents pose as they step, so a held crew never stepped stood at the origin.
  - A robot up high (a deck, the supply line, a drone in flight) is framed from far enough back to stay under the star. Looking up into it blows the frame out.
- `node tools/crew-shots/shots.mjs model[:pose[@t]][/az,el[,focus,span]] …` renders a model alone in seconds (headless WebGPU) to `tools/out/crew/`.

## Tests

- `crewModels`: per rig, topology, one connected assembly, and no coplanar overlap or clash at rest.
- `crewHand`: a scripted walk, turn, crouch and slate walk. Checks limits, hinges on their axes, soles above the ground, no sliding, and no clashes.
- `crewMachines`: the Rigger walking, turning and reaching; the Dray at full lock with its probe down; the Linewalker's head and the Spotter's gimbal through their ranges; the mower rolling. No clashes in any of them.
- `crewPlan`: the counts; ground routes off the roads and clear of the plant.
- `crewSim`: two minutes of the whole crew on the real world. Ground robots stay in bounds, every Hand's joints stay in range, drones never enter structure, the sound events arrive, and the frame cost stays low.
- `crewFixtures`: fixtures stand on open paving, off the roads and apart, and are clean solids.
- `crewSound`: the walkers' metal and the drone's loop.

## Cost

- Boot: ~1.6 s on the main thread (plans, rigs, both LOD levels).
- Per frame: ~0.27 ms for the whole crew in Node: agents, FK, batch writes, outlines and shade.
- No per-frame allocation in the agents, the gaits, the outlines or the shade selection.
