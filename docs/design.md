# Dyson — Design

## 1. Pitch

A quiet first-person walk through **Dyson**, the only city on the inner surface of a Dyson sphere. Dyson is small: a garden city about a kilometre across, with eight refined places. Everywhere else the sphere is bare, undeveloped megastructure.

You stand on what feels like ordinary ground. Overhead, a real star fills the sky, a burning surface 90° across. On every side, the inner face of the sphere rises out of the horizon haze, climbs the sky as a vast pieced-together structure, and disappears into the star's glare. A normal place set inside something incomprehensibly large. There are no people, no objectives and no time of day.

Pillars:

1. **Photoreal, not illustrated.** Every frame should read as a photograph taken by someone standing there: physically motivated light, real atmosphere, a camera-like exposure. It must not read as a stylised picture, a painted ball or a demo scene.
2. **Astronomical scale, felt correctly.** Everything within reach is human-scale and finely detailed. Everything above the horizon is hundreds of thousands of kilometres away and must look it.
3. **Intimate ground, incomprehensible sky.**
4. **Quality over quantity.** A few places, each crafted inside and out.
5. **Physics serves the picture.** Use physics to decide what the image looks like. Bend it freely where it would hurt the look or playability.

## 2. World frame

| Fact | Choice | Consequence in the image |
|---|---|---|
| Star | A Sun-like G2 star, radius **696,000 km** | A blinding white photosphere: countless granules, faculae, spots, flares, prominences at the limb |
| Shell | Inner radius **984,000 km** from the star's centre (288,000 km above its surface) | The star is **90° across**. Its limb sits **45° above the horizon** in every direction |
| Gravity | Spin gravity, **1 g** at the equator (17.5 h rotation). The star's own pull and Coriolis are ignored | Walking and falling feel like Earth |
| Location | The city sits **on the equatorial band, just west of a hub** (the circular joint where a meridian frame crosses the band, as in the logo) | Only there does "down" point straight down. The hub drum rises on the eastern horizon |
| Spin | The shell turns under a star that does not turn with it | The star's surface drifts **east → west at ~0.83° per minute**. This is the only clock |
| Light | **Eternal day.** One fixed lighting setup | Variation comes from star drift, flares and viewpoint |

### Seeing at this scale

The facts below decide most of the image. They are the main corrections to the first two builds.

- **A point on the shell at central angle γ from you appears at elevation γ/2.** The horizon is the shell next to you. The star's limb (45°) is the shell 90° around the sphere. Everything above the horizon is far away:

  | Elevation | Distance to that shell point | Size of 1° there |
  |---|---|---|
  | 1° | 34,000 km | 600 km |
  | 10° | 342,000 km | 6,000 km |
  | 22.5° | 753,000 km | 13,000 km |
  | 45° (limb) | 1,390,000 km | 24,000 km |

- **The ground does not visibly curve upward near the city.** From eye height, the deck crosses eye level about 60 km away, and the whole deck beyond ~5 km compresses into a pixel-thin strip at the horizon. The shell only rises measurably at hundreds of thousands of km. **No surface ever rises steeply near the city.** The concept image is wrong about this: its walls climb right behind the buildings. Its *feel* is right: warm blazing star, vast structure climbing into glare.
- **Anything visible on the far shell is continent-sized.** A readable structural member is thousands to tens of thousands of km wide. The habitable city is invisible from anywhere else on the sphere.
- **Everything outside is lit by the same star.** The far shell receives exactly the light the ground at your feet receives. Brightness differences up there come from material (dark collectors versus bright deck), geometry (faces turned toward or away from the star), occlusion, atmosphere and glare. They never come from "distance darkness".
- **A daylight exposure hides the stars.** Space seen through gaps in the structure is black, veiled by the air in front of it. Stars appear only at very different exposures (a future telescope).
- **Scale must come from content.** Seeing a sphere from a point on it is a stereographic projection, so its silhouettes cannot tell 200 m from 1,000,000 km. What tells it:
  - the local air, which veils the lowest structure;
  - detail with no countable elements at any scale (a regular rhythm a few degrees apart reads as human-scale architecture);
  - depth from structure standing off the shell, and open space behind it;
  - physically consistent light: the same star lights everything, and every inward-facing surface receives the same irradiance.
  The shell must also climb continuously out of the horizon haze. It must never hang over the plain like a canopy.
- **Everything is first principles.** This view has no real-world reference, so the look is derived from geometry, radiometry and materials, not invented as art. The full reasoning is in `docs/world.md`.

## 3. The Dyson structure

The sphere is the project logo (`public/logo.png`), modelled as drawn: an equatorial band with ring hubs, six meridian spines, big curved gore panels in each sector, open bands beside the band, alternating wide openings and narrow slots between the gores, and polar collars. The city is on the band, 20° west of a hub. The full specification is in `docs/sky.md`.

The shell is a fictional refractory alloy: dark, warm metal that mirrors the enclosure and glows faintly with the heat it collects. Its hottest coolant channels run as thin orange-gold lines along panel borders, girders and hub rims: the logo's lines. Details are in `docs/sky.md`.

**Nothing has random holes, missing modules, slivers or wireframe lattices.**

## 4. Media and the Veil

- **Air band.** Spin gravity holds air against the Girdle; the Veil roofs it at 1.2 km. It is clean air, 0.55 bar.
  - It hazes the horizon and veils the lowest structure.
  - Its short column overhead leaves the open bands dark.
- **The cavity is clear.** Dust and molecules cannot exist at ~4,000 K, neutral gas falls onto the star, and a plasma dense enough to see would outshine the star. Crispness is the right message a million km away. A faint white plasma fill adds a subtle aerial perspective that grows with distance.
- **The Veil.** It is required: unshielded, the habitat would sit at ~4,850 K. It is a spectrally neutral attenuator, so the star's light stays white. Details are in `docs/world.md`.

## 5. The star

The star must look like a real star seen from 288,000 km: a surface of hot, moving gas, not a light bulb, and *almost uncomfortably* big.

- **Activity.** It is caged and more active than the Sun. Granulation at its true size carries it (~620,000 granules on the visible disc), with faculae toward the limb, spot groups, flares, and prominences standing off the limb.
- **Colour.** It comes from temperature (Planck) and per-channel limb darkening. To the eye and camera it is white-hot, with its texture just held, and its glare veils everything near it.
- **Motion.** Everything runs in real time: the surface drifts ~0.8°/min with the shell's spin, granules live ~8 min, prominences stream and erupt at their true speeds. Fast motion would make it a small object. Flares echo in the far shell's mirrors seconds later.
- **It is the brightest thing in the frame** and dazzles its surroundings through the eye's glare, with a razor-sharp limb and no halo.

## 6. The site (earmarked land)

The city has not been built yet in the world phase. What exists is the land earmarked for it:

- **The Girdle deck**: bare structural metal plating to the horizon, with a plate, bay and sector hierarchy.
- **The Garden Deck footprint**: on the equatorial band, just west of the hub. A raised, 1 km foundation platform of pale engineered stone. Its stepped perimeter rises 1.2 m above the deck. Survey axes are inlaid in bronze:
  - the Spinward axis runs east–west;
  - the Meridian axis runs north–south.
  A bronze datum disc marks the centre.
- Nothing else stands on it. It is a finished, vacant site, ready for the city.

The **first-impression shot** is from the platform near its east edge, looking east. The deck plain runs to the horizon haze. The Girdle ribbon rises into the sky toward the east hub, frames arc overhead, and the star fills the top of the view.

## 7. Dyson — the city (next phase)

### Site

- **The Garden Deck** is the 1 km platform above (§6). Its edge becomes a balustraded terrace above water, so there are no invisible walls.
- **The Still** is a calm, shallow reflecting water plane. It surrounds the Deck out to the Rim (~3.5 km).
- **The Mirror Basin** is the city's central water. It opens eastward into the Still.
- **The Colonnade Viaduct** carries the maglev across the Basin and out over the Still to the Rim.
- **The landscape between buildings** is terraced gardens, a cypress avenue, canals with footbridges, plazas and water stairs.

The layout is a classical cross of axes:

- The **Spinward axis** runs east–west. It points at the two equatorial hubs.
- The **Meridian axis** runs north–south. It points at the poles on the star's limb.

```
                         N  (pole, on the star's limb)
                                  │
             Observatory          │          Archive
                                  │
  Cypress Walk ─── Zenith Spire ══ MIRROR BASIN ══════ Central Station ═══ viaduct over the Still ═══▶ Rim Gallery
                                  │                                                                  (~3.5 km E)
             Conservatory         │          Thermae
                                  │
                           Canal House
                         S
```

### Places

Eight places. Each has a fully detailed exterior **and** interior, and each has a distinct identity.

| # | Place | Exterior | Interior | Why go there |
|---|---|---|---|---|
| 1 | **Central Station** | Vaulted stone-and-glass hall on the viaduct at the Basin's east mouth | Barrel-vaulted concourse with glazed roof, platform with a docked pod, benches | Ride the maglev out to the Rim |
| 2 | **Zenith Spire** | The tallest structure (~180 m): slender ceramic-and-gold spire with stacked ring balconies | Stone lobby, glass lift in an open core, the **Crown** lounge and open deck at the top | The best panorama |
| 3 | **Conservatory** | Large ribbed glass dome on a curved stone podium | Botanical interior with water rills and a canopy walkway | Starlight filtered through glass and leaves |
| 4 | **Observatory** | Domed stone drum with a rotating slit dome | Brass, gold and dark-wood instrument hall around the great telescope | The telescope (§8) |
| 5 | **Archive** | Colonnaded hall with deep porticoes | Tall library hall around the **Sphere Model**: a cutaway model of the sphere and its star, with one glowing point for the city | Understand the scale of where you are |
| 6 | **Thermae** | Low, long bathhouse with roof oculi | Still pools under beams of starlight, steam, polished stone | Light and water |
| 7 | **Canal House** | Refined residence on a canal: terraces, pergola, mooring | Living spaces, study, roof terrace, as if someone just stepped out | Human intimacy in an empty world |
| 8 | **Rim Gallery** | Long curved gallery at the Rim, at the Veil's footing, reached by maglev | The Veil's glass wall, with the bare deck plain beyond | The edge of the habitable world |

Tone: pristine, maintained, empty. Serene, not eerie.

## 8. Interactions

A single **"Press E to …"** prompt. No menus, inventories or multi-step mechanics.

| Interaction | Prompt | Behaviour |
|---|---|---|
| Doors | *Press E to open* | Sliding or pivoting doors animate open |
| Elevators | *Press E to go up / down* | The lift travels with the player inside |
| Maglev | *Press E to board* | Seated ride between Central Station and the Rim Gallery. Mouse-look stays free |
| Telescope | *Press E to use telescope* | Steerable view: mouse aim, scroll zoom, its own exposure |
| Sphere Model | *Press E to examine* | The camera settles on the slowly turning model |
| Benches | *Press E to sit* | Framed, slow look |

**The telescope** resolves what the eye cannot:

- granulation, spot fine structure, flare ribbons, prominences;
- the far structure's plates, lights and hubs.

Its exposure adapts to its narrow field. When it points through a gap in the structure, the stars and a faint band of the galaxy appear. This is the game's quiet discovery.

**Movement:** WASD + mouse look, sprint, jump, crouch. Grounded and slightly unhurried.

## 9. Visual style

### The world

The style is photoreal megastructure: engineering at a scale beyond comprehension, rendered with physical light. The look is derived, not painted.

- A blinding white star whose glare floods the frame; its texture is just visible.
- A patchwork of warm metal tiles reflecting real pieces of the enclosure and glowing faintly with heat: gaps dark, the star blazing in the tiles near the limb.
- Distance shown by content, light and motion (`docs/scale.md`): blue habitat air in front of everything, a crisp cavity behind it.

### The city: Solar Neoclassical

Classical proportion, colonnades, domes and spires, built with futuristic precision. Calm, luminous and warm. No grime, no cyberpunk.

- Every edge resolved: bevels, chamfers, coursing, seams, mullions, copings.
- Interiors are equally considered.

| Material | Use |
|---|---|
| Honed pale limestone/travertine | Podiums, terraces, the Garden Deck |
| White ceramic composite | Façades, drums, spires |
| Brushed champagne-gold / anodized bronze | Rings, finials, mullions, railings, survey inlays |
| Low-iron glass, faint gold coating | Domes, curtain walls, pods, the Veil |
| Dark polished basalt | Accent bands, water edges, steps |
| Warm dark wood, leather, fabric | Interiors |
| Water | Still mirrors, canals, fountains, pools |

**Vegetation:** Italian cypress, stone pine, olive, clipped boxwood, lawn, lavender, flowering shrubs, vines, water lilies.

### Lighting mood

The key light is a 90° area source straight overhead. It produces:

- very soft, short shadows and strong contact occlusion;
- bright warm bounce;
- strong sheen on glossy surfaces;
- the star reflected in water and glass.

Interiors are daylit through openings and feel cooler and calmer.

## 10. UI / HUD

- **In play:** nothing on screen. Looking at an interactable shows a small dot and the prompt.
- **Place titles:** fade in briefly on entering.
- **Entry screen:** title, loading progress, "Enter". It shows platform-gate and boot/GPU errors.
- **Pause:** resume, mouse sensitivity, FOV.
- **Typography:** one refined sans-serif, generous letter-spacing, translucent panels.

## 11. Platform

- **Chromium-based desktop browsers only**, gated before engine code loads. The gate requires:
  - a Chromium brand;
  - a non-mobile device;
  - WebGPU.
- Unsupported platforms get a clear styled message and never boot.

## 12. Rendering scope

Implementation notes live in the system docs (`docs/world.md`, `docs/sky.md`, `docs/ground.md`, `docs/render-pipeline.md`, `docs/runtime.md`).

- **Physically based radiometry.** One radiance scale for the star, the far structure, the atmosphere and local materials. Exposure is a camera, never a fix for wrong ratios.
- **Star:**
  - procedural white-light photosphere at real scales;
  - flares;
  - footprint-filtered detail.
- **Far structure:** analytic ray-traced megastructure in the sky shader; light transport from a boot-time enclosure solve; plating sampled per pixel at its level of detail.
- **Media:** thin-plasma line integrals and the Veil-roofed air, both precomputed at boot.
- **Atmosphere:** custom single + multiple scattering for the concave band geometry. Precomputed at boot because the observer and star are fixed. One model owns sky haze, aerial perspective on local geometry, and the aureole.
- **Local scene:**
  - image-based lighting from the rendered sky;
  - GTAO contact occlusion;
  - temporal anti-aliasing.
- **Camera:**
  - fixed exposure keyed to the star (the light never changes);
  - the eye's glare from its point-spread function: exact for the star, screen-space for everything else;
  - daylight white balance (the Veil supplies the warm cast);
  - hue-preserving filmic tone map (overexposed colour runs toward yellow and white, never pastel) and grade;
  - subtle lens response.

**Performance stance:** no hard frame-rate target while building, but no known performance pitfalls.

## 13. Out of scope

- NPCs, dialogue, quests, inventory, combat.
- Time of day, weather, seasons.
- Leaving the habitable band. The far structure is only seen, never walked.
- Non-Chromium browsers and mobile.
