# Dyson — Design

## 1. Pitch

A quiet first-person walk through **Dyson**, the only city on the inner surface of a Dyson sphere. Dyson is small: a garden city about a kilometre across with eight refined buildings, set on still water under a glass dome. Everywhere else, the sphere is bare metal. Up close it feels like a calm, beautiful place. Overhead, a star fills the sky. On every side, the empty metal shell climbs upward until it disappears into the star's glare. There are no people, no objectives and no time of day.

Pillars:

1. **Intimate ground, incomprehensible sky.** Everything within reach is human-scale and finely detailed. Everything above the horizon is cosmic.
2. **Quality over quantity.** A few places, each crafted inside and out. No filler buildings, no repeated blocks.
3. **Photoreal calm.** Warm, soft high-dynamic-range light, still water and real materials.
4. **Physics serves the picture.** Plausible enough to explain what the player sees and feels; bent freely for visuals and playability.

## 2. World frame

| Fact | Choice | What the player experiences |
|---|---|---|
| Star | Orange star, always centred at the zenith, **~80° across** | Dominates the sky. Its limb sits ~50° above the horizon in every direction. Warm amber-gold light, boiling granulation, dark spot groups, prominences arching over the limb, occasional flares |
| Gravity | Spin gravity, **1 g**, felt as "down" | Walking, jumping and falling feel like Earth. Coriolis is ignored |
| Location | Dyson sits **on the sphere's equator** | Gravity only points straight down near the equator, so the only city is here. The rest of the sphere is uninhabited bare metal |
| Spin | The shell rotates under a star that does not rotate with it | The star's surface **drifts slowly east→west (~1° per minute)**. Perceptible if you watch; the only clock in a timeless world |
| Light | **Eternal day**, no time of day | One fixed lighting setup, tuned to perfection. Variation comes from star drift, flares and viewpoint |
| The Veil | A transparent geodesic **glass dome ~8 km across, ~2 km high**, enclosing the city, its air and the surrounding water | It passes only a tiny fraction of the starlight, which is why the star can be looked at and its detail seen. A faint lattice is drawn across the sky. The dome's ribs land on a ring foundation, **the Rim** |

Reference scale (for consistency, not simulated): star radius ≈ 500,000 km, shell radius ≈ 780,000 km. Anything on the far shell must be hundreds of km wide to be visible, so far-shell features are continent-sized.

## 3. The sky, from the ground up

1. **Horizon (0–3°).** The dome's Rim and its rib footings ring the horizon across the water. Beyond, the bare metal plain stretches out under light haze from the dome's air.
2. **The climbing shell (3–50°).** The inner surface of the sphere rises on every side as an endless engineered metal landscape:
   - Panel fields with visible seams at many scales.
   - **Meridian ribs**: great structural bands running pole to pole.
   - Equatorial track lines along the spin direction.
   - Tiny amber running lights along the ribs, which give a sense of scale.

   A soft luminous haze, coming from the dome air and scattering in the Veil glass, builds toward the horizon and toward the star.
3. **The Breach (~25° up, toward the north-east).** This is a single unfinished sector of the shell. Its outer panels were never installed, so only the bare structural lattice stands there. Construction gantries are frozen mid-work across it, and deep space shows through the gaps.
   - To the naked eye it is easy to miss: a small dark notch with a fine lattice texture against the bright metal. It sits off both main axes, so you have to look for it.
   - The black gaps look empty because your eyes are adjusted to the bright city.
   - Only the telescope, with its own narrow-field exposure, reveals the starfield beyond. It is the only view of the outside universe in the game.
4. **The polar hubs (~45°, due north and due south).** Each pole sits just under the star's limb. The meridian ribs converge on a vast hub structure there. These are the main landmarks of the far shell.
5. **The Veil lattice.** A very faint geodesic grid across the whole sky. It is more visible against the bright star.
6. **The star limb (~50°).** Bright, reddened at the edge, limb-darkened, with prominence loops and filaments standing off it.
7. **The star disc (50–90°).** Fine granulation, bright plage networks, slowly evolving spot groups, occasional flares. The whole surface drifts westward.

The star should feel *almost too big*: a surface, not a light bulb.

## 4. Dyson — the city

### Site

- **The Garden Deck** is a raised stone platform about **1 km across**, holding the city. Its edge is a balustraded terrace above the water, so there are no invisible walls.
- **The Still** is a calm, shallow reflecting water plane. It surrounds the Deck out to the Rim (~3.5 km) and doubles the star and the climbing shell in its surface.
- **The Mirror Basin** is the city's central water. It opens eastward into the Still.
- **The Colonnade Viaduct** is a white arched viaduct carrying the maglev. It crosses the Basin, then runs out across the Still to the Rim.
- **The landscape between buildings** is terraced gardens, a cypress avenue, canals with footbridges, plazas and water stairs. This is the public realm that joins the places together.

The layout follows a classical cross of axes:

- The **Spinward Axis** runs east–west. It is the Basin's long axis, ending in the viaduct and the open Still.
- The **Meridian Axis** runs north–south, pointing at the polar hubs.

```
                         N  (polar hub, ~45° up)
                                  │
             Observatory          │          Archive
                                  │
  Cypress Walk ─── Zenith Spire ══ MIRROR BASIN ══════ Central Station ═══ viaduct over the Still ═══▶ Rim Gallery
                                  │                                                                  (~3.5 km E)
             Conservatory         │          Thermae
                                  │
                           Canal House
                         S  (polar hub, ~45° up)
```

**First impression:** the player starts on the terrace at the west end of the Mirror Basin, looking east down the water. In view are the viaduct, the open Still beyond, the shell climbing into the sky and the star overhead. This is the concept-image shot.

### Places

Eight places. Every one has a fully detailed exterior **and** interior, and each has a distinct identity.

| # | Place | Exterior | Interior | Why go there |
|---|---|---|---|---|
| 1 | **Central Station** | A vaulted stone-and-glass hall on the viaduct at the Basin's east mouth | Barrel-vaulted concourse with a glazed roof, a platform with a docked pod, benches | Ride the maglev out across the Still to the Rim |
| 2 | **Zenith Spire** | The tallest structure (~180 m): a slender ceramic-and-gold spire with stacked ring balconies, at the Basin's west head | Stone lobby, a glass lift in an open core, and at the top the **Crown**: a lounge ringed by an open-air deck | The best panorama in the game |
| 3 | **Conservatory** | A large ribbed glass dome on a curved stone podium | A botanical interior with lush planting and water rills, plus a raised walkway at canopy height | Starlight filtered through glass and leaves |
| 4 | **Observatory** | A domed stone drum with a rotating slit dome | Instrument hall in brass, gold and dark wood, with the great telescope at the centre | The telescope (§5) |
| 5 | **Archive** | A colonnaded hall with deep porticoes | A tall library hall, with the **Sphere Model** at its centre: a large cutaway model of the Dyson sphere and its star, with a single glowing point marking the city | Understand the scale of where you are |
| 6 | **Thermae** | A low, long bathhouse: stepped stone volumes with oculi in the roof | Still pools under beams of starlight from the oculi, steam, polished stone, a quiet colonnade | The most serene interior: light and water |
| 7 | **Canal House** | A refined residence on a canal: curved terraces, pergola, private mooring | Living spaces, a study, and a roof terrace, furnished as if someone just stepped out | Human intimacy in an empty world |
| 8 | **Rim Gallery** | A long curved gallery built into the Rim, at the foot of the dome ribs, reached only by maglev | The glass wall of the dome itself. Outside: the raw bare-metal shell, close up and endless | The edge of the habitable world |

Tone: pristine, maintained and empty. It should feel serene, not eerie. Unseen automation keeps the lights on and the water clean.

## 5. Interactions

Every interaction uses a single **"Press E to …"** prompt. There are no menus, inventories or multi-step mechanics.

| Interaction | Prompt | Behaviour |
|---|---|---|
| Doors | *Press E to open* | Sliding or pivoting doors animate open |
| Elevators | *Press E to go up / down* | The lift travels with the player inside, and the view is preserved |
| Maglev | *Press E to board* | A seated ride between Central Station and the Rim Gallery (~60–90 s over the Still). Mouse-look stays free. Press E at arrival to step off |
| Telescope | *Press E to use telescope* | A steerable view with mouse aim and scroll zoom. Press E to step back |
| Sphere Model | *Press E to examine* | The camera settles on the model, which slowly turns. Press E to step back |
| Benches | *Press E to sit* | The camera settles into a framed, slow look. Press E to stand |

**The telescope.** The sphere encloses everything and the star fills the centre of the sky, so outer stars can't be seen directly. The one exception is **the Breach** (§3). The telescope looks at what the naked eye cannot resolve:

- **The star's surface:** granulation cells, the fine structure of spot groups, flare ribbons, prominence loops at the limb.
- **The far shell:** the polar hubs, meridian rib junctions, panel-seam patterns hundreds of km wide, running lights, the sheer emptiness of the metal.
- **The Breach:** the unfinished lattice and its frozen gantries. When it is centred and zoomed in, the telescope's exposure adapts, and stars and a faint band of the galaxy appear through the gaps. This is the game's quiet discovery: nothing points to it, and the player has to find it.

**Other ambient motion (no NPCs):** driverless pods on the viaduct, fountains, rippling canals, swaying trees and drifting star features.

**Movement:** WASD + mouse look, sprint, jump, crouch. Grounded and slightly unhurried. Solid collision with walkable stairs and ramps.

## 6. Visual style: Solar Neoclassical

Classical proportion, colonnades, domes and spires, built with futuristic materials and precision. Calm, luminous and warm. No grime, no cyberpunk.

**Architecture**
- Curved, terraced massing: drums, ring balconies, stepped podiums, shallow domes, barrel vaults.
- Slender vertical accents: spires with rings and finials.
- Colonnades and arcades: thin columns, deep shadow reveals, arched viaducts.
- Every edge resolved: bevels, chamfers, stone coursing, panel seams, mullion profiles, drip edges, plinths, copings.
- Interiors are equally considered: coffered or ribbed ceilings, inlaid floors, built-in joinery, light coves, real furniture.

**Material palette**

| Material | Use |
|---|---|
| Honed pale limestone/travertine (warm white, subtle veining) | Podiums, terraces, balustrades, interior floors |
| White ceramic composite panels | Façades, drums, spire bodies |
| Brushed champagne-gold / anodized bronze | Rings, finials, mullions, railings, fittings |
| Low-iron glass with a faint gold coating | Domes, curtain walls, maglev pods |
| Dark polished basalt | Accent bands, water edges, steps |
| Warm dark wood, leather, fabric | Interiors: joinery, furniture |
| Water | Still mirror surfaces, rippled canals, fountains, rills, pools |
| Bare shell metal (outside the Veil) | Brushed titanium-grey panels with seam networks and service hardware: cold and industrial against the warm city |

**Vegetation:** Italian cypress, stone pine, olive, clipped boxwood, lawn, lavender, flowering magenta/coral shrubs, vines on pergolas, water lilies. Well kept, gently swaying.

**Lighting mood**
- Exterior:
  - Warm amber-gold light from straight overhead, from a huge area source.
  - Very soft, short shadows, with contact shadowing under overhangs.
  - Bright warm bounce light, and a blue-gold high skylight.
  - Strong star reflections in water and glass.
- Interiors: daylit through oculi, domes and glazing, with warm artificial accent light. They should feel distinctly cooler and calmer than outside.

## 7. UI / HUD

- **In play:** nothing on screen. Looking at an interactable shows a small centred dot and the "Press E to …" prompt beneath it.
- **Place titles:** when entering a place, its name fades in briefly, once per visit.
- **Entry screen:** title, "Enter", loading progress. This same screen shows platform-gate and boot/GPU errors.
- **Pause menu:** resume, settings (mouse sensitivity, FOV, audio volume).
- **Typography:** one refined sans-serif, generous letter-spacing, translucent light panels.

## 8. Platform

- **Chromium-based desktop browsers only** (Chrome, Edge, and other Chromium browsers), gated from day one.
- The entry screen checks the platform before any engine code loads:
  - Chromium brand
  - not a mobile device
  - WebGPU available
- Unsupported platforms get a clear, styled message and never attempt to boot. This includes Firefox and Safari, even where they support WebGPU.

## 9. Rendering scope

Implementation details go in separate docs. The image must deliver:

- **Star:** an emissive procedural surface with multi-scale convection, spots, plage, limb darkening, prominences and flares. Bright, but its detail stays readable after tone mapping.
- **Far shell:** a procedural metal surface on the sphere (panels, ribs, polar hubs, running lights), with haze and glare by elevation. It needs enough detail to hold up under telescope zoom.
- **The Breach:** a cutout region of the far shell showing open lattice and gantries over a starfield. The starfield is invisible at city exposure and appears only through the telescope's own exposure.
- **Veil:** a geodesic glass dome with a rib lattice, subtle Fresnel, and a faint glow where it crosses the star.
- **City:** soft area-light shadows, ambient occlusion for contact grounding, mirror-still and rippled water, glass, interiors daylit through openings, bloom, auto-exposure and grading.
- **Seam:** the Rim and the haze over the Still hide the transition from the local scene to the far-shell rendering.

**Performance stance:** there is no hard frame-rate target while building. It needs to be playable on the dev machine, and dedicated optimization passes come later. Even so, no known performance pitfalls should be introduced along the way.

## 10. Out of scope

- NPCs, dialogue, quests, inventory, combat.
- Time of day, weather, seasons.
- Leaving the Veil. The bare shell is only seen, never walked.
- Non-Chromium browsers and mobile.
