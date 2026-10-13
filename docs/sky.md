# Sky: star, far structure, media

Code: `src/sky/`, `src/atmosphere/`. Everything above the local geometry is one fullscreen sky shader (`skyNode.ts`); every feature is hundreds of thousands of km away, so there are no meshes. The acceptance test for everything here is `docs/scale.md`.

## Composition

Per view direction:

1. below the horizon: ground (environment capture and the sub-pixel strip beyond the deck mesh);
2. otherwise: the star disc, or the far structure (traced, with relief for primary rays), or open space (`space/`);
3. the thin interior plasma between the observer and what the ray meets (`medium/plasma.ts`);
4. the local air: in-scatter + transmittance.

The star's own atmosphere is composited onto sky pixels in a separate post pass (`star/atmosphere.ts`; see `render-pipeline.md`).

## Boot precompute (worker)

In order, because each feeds the next:

0. **Corona table** (`star/corona.ts`): the coronal column against the sight line's impact parameter.
1. **Plasma line table** (`medium/plasma.ts`): τ(b, x) and transmittance-weighted in-scatter for every line through the sphere, lit by the limb-darkened disc and, separately, by a unit isotropic shell.
2. **Enclosure solve** (`structure/enclosure.ts`): see below. It also sets the plasma's shell illumination.
3. **Air** (`atmosphere/precompute.ts`): lit by the enclosure's sky (star + shell).

## Star (`star/`)

**In the normal view the star is blinding**: its disc clips to white and its outline dissolves into halation (`render-pipeline.md`). Almost nothing below is visible there; it lights the world, shows in the far shell's mirrors, and is what the telescope, with its own exposure, will reveal. Only large, bright activity well clear of the glare (the hot cores of gas bursts) registers as warm shapes in the blaze.

The white-light photosphere carries no pattern that is not physically there, at true scale:

| Layer | Scale at disc centre | Character |
|---|---|---|
| Granulation | 1,300 km = 0.26° ≈ 4.5 px at 1080p; ~620,000 on the visible cap | Bright domes, thin dark lanes, ~18 % rms (slightly above the Sun's 14 % for the caged star). Two cell lattices blended region by region so granules form, merge and split; real time, ~8 min lifetimes |
| Mesogranulation | ~1° | ±2 % undertone |
| Supergranular network | 30,000 km ≈ 6° | Patchy clouds of bright points along the lanes; nearly invisible at disc centre, faculae toward the limb |
| Active regions | spots 3–8°, groups up to ~30° | Umbra 0.16, filamentary penumbra, umbral dots, Wilson depression near the limb; plage and faculae |
| Flares | ribbons 10⁴–10⁵ km | Ribbon pairs spreading ~30 km/s with impulsive bursts of a few seconds |

- **Perspective does the rest.** The disc centre is 288,000 km away and the limb 696,000 km; the visible cap is so foreshortened that its outer half (heliocentric 20°–45°) crowds into the outer 9° of the disc. Granules shrink and compress toward the limb by themselves.
- **Everything runs in real time.** The surface drifts 0.8°/min (one granule every 19 s). An earlier build time-lapsed convection 20×: a surface that boils like a pot is the miniature effect and reads as small.
- **Flares are scheduled in regions facing the observer** (`features.ts`): a game choice, so one appears every few minutes (one starts 24 s after spawn). Their bursts drive the light echoes.
- **Colour comes from temperature.** Every element's 550 nm intensity becomes a brightness temperature and the other channels follow Planck; limb darkening is per channel.
- **Rejected.** Domain-warped "convection" marbling (~15 swirls across the disc, a lava-lamp ball); closed cellular network outlines (scales); ridged noise at one scale (caustics); H-α veins, a hot rim and false colour; a continuous pink chromosphere ring (reads as the rejected hot rim).

### Atmosphere and activity

All of this is far brighter than the real Sun's (whose atmosphere is invisible beside its disc in white light): the star needs a living atmosphere. Shapes follow space-telescope images of the Sun (fibrous, looping, rooted in the surface); scales are true. It is kinematic plasma, not a simulation: closed-form magnetic shapes filled with noise advected along them, summed as optically thin glow.

| Part | Code | Character |
|---|---|---|
| Corona | `corona.ts`, `coronaNodes.ts` | Thomson-scattered photosphere light, white. Baumbach–Allen density × dilution, integrated along each sight line (a 1D table: every line runs shell to shell or down to the photosphere). Gentle radial rays, streamers narrowing with height, polar plumes, outflowing blobs |
| Chromosphere | `coronaNodes.ts` | A burning fringe at the limb: a fire shader in (position angle, height), tongues of spicules advected up at ~250 km/s and thresholded by height, clustered |
| Loop arcades | `activeLayer.ts` | On the whole visible surface: sparse arcades 15,000–60,000 km across in sky cells (more in the activity belts). Every loop is a 3D field line of a buried dipole (r = L·sin²θ), warped, drawn as a soft tube by ray–curve distance; a bundle of threads, broken into flickering knots siphoning at ~200 km/s, bright gassy footpoints; occasional flares |
| Prominences | `magnetic.ts`, `magneticNodes.ts` | Quiescent: thick, lacy bodies of cool gas around one arched field line, raymarched: warped envelope, twisted fibres, voids, draining legs; they absorb what lies behind them |
| Gas bursts | `gas/` | A 2D fluid over the plane of the sky round the limb: vents erupt hot gas that billows, rolls, cools from white to gold and tears into wisps. Time-lapsed on purpose. See `star-gas.md` |

- **Real time, energetic star.** Nothing is time-lapsed (that is the miniature effect) except the gas bursts, a deliberate exception (`star-gas.md`); the caged star's flows run at the Sun's fast end, so activity visibly moves at 700,000 km. Small-scale gas evolves in tens of seconds.
- **Colour:** a hot-plasma ramp (`plasmaColour.ts`): deep orange in faint plasma, gold, white-gold in the brightest. The corona keeps the star's white.
- **Rejected:**
  - flat sheets of near-vertical threads hanging off the limb (they read as aurora curtains);
  - hydrogen pink-magenta for the star's plasma (that belongs to aurora, which is omitted: it would not be visible in this light);
  - thin rope tubes and perfect nested arcs (handles, rainbows); a 2D loop belt drawn round the rim (activity must grow from the surface); planar loop sheets (bars seen from above);
  - corona structure keyed to the closest point's 3D direction (smears into smoke; it must be keyed to position angle);
  - a mottled "chromospheric fire" over the disc (grey mottles read as stone).
- **Placement bugs to remember:** cells are probed at most half a cell apart along the ray, and the layer clears the tallest loops; otherwise loops are cut along cell walls or the layer's ceiling. Anything masked near the limb must use height above the curved photosphere: a cut on a local plane shows as a straight edge across the disc.

## Media: what lies between the city and the far shell

Physics bounds the cavity tightly, and that sets the look:

| Candidate | Why it is (not) there |
|---|---|
| Dust, water, molecules | The cavity runs 3,600–4,400 K: grains sublimate, molecules dissociate |
| Neutral gas | Scale height ~150 km at 5,000 K: it falls onto the star (it is the chromosphere) |
| Coronal plasma (1–3 MK) | The only thing that can fill the cavity, but a density that visibly veils the far shell would radiate more power than the star emits |

So the cavity is effectively clear, and crispness is the right message for structure a million km away. **The thin fill** (`fillDepth` 0.01, Thomson, white) is kept as a subtle, deliberate aerial perspective that grows with distance. **Rejected:** a dense corona (optical depth ~1 along a line grazing the star). Its glow hugging the limb, together with the old lens halo, made the star read as a lamp in fog. A/B renders showed the limb sharpen and the far structure gain contrast without it. (The star's own corona, `star/corona.ts`, is separate: steep, structured, part of its atmosphere.)

**Habitat air** (`atmosphere/`): ordinary Rayleigh + aerosol air under the Veil at 1.2 km. It veils everything in front of it blue, so the structure reads as beyond the sky (the daytime-Moon effect).

## Far structure (`structure/`)

### Layout (`layout.ts`, `trace.ts`)

The project logo (`public/logo.png`), modelled as drawn. **Rejected:** a net of frames with a panel filling every cell; that is not the logo.

| Part | Specification |
|---|---|
| Equatorial band | ±3.5°, the habitable Girdle, with twin edge rails |
| Spines and hubs | Six meridian spines 60° apart, from each pole to 6° from the equator, where they end buried in a **hub collar**: a ring (5°–7° about the crossing point) cut open over the band, its cut faces flush against the band's rails. The band runs through it |
| Open bands | Space shows between the band and the panels, from 3.5° to 12° latitude. Only short posts and diagonal braces cross it, from each wide opening's panel corners down to the band's rails (brace feet 9° from the hub meridian, clear of the collar), mitred flush to the rail face |
| Gore panels | One per 60° sector and hemisphere, from 12° to 62° latitude |
| Gaps between gores | They alternate. Around every other hub there is a wide opening (±17° longitude), crossed by latitude members at ±27° and ±50°. At the other spines there is a narrow slot (±2.2°) |
| Poles | A collar at ±70°. The polar cap inside it is open, with the spines meeting a polar hub |
| City | On the band, 20° west of a hub with a wide opening: looking east is the logo's front face |

- **About 43% of the sphere is open** (`tools/coverage.mjs`, which mirrors the layout and feeds the enclosure's area shares).
- **Tracing.** Members are slab ∩ layer, optionally clipped. Hubs are cone ∩ layer. Every frame hit carries its slab's size, so surfaces need no per-index tables.
  - Parts that end across the city's path as the frame turns (spines, collars, posts, braces) are exact convex pieces: half-spaces and cones, entered through a real face. **Rejected:** clipping a slab by testing only its entry point. The cut end faces did not exist, and a member vanished whenever the city passed through its plane.
  - The equator and the band-crossing hubs of the old layout are gone. Nothing of the frame may cross |lat| < 3.5°, or it would sweep through the city.

### The band spins (`spin.ts`)

Only the band turns: the Girdle, its edge rails and the city, inside a static frame that keeps the stars' orientation. One turn per 2 h relative to the frame. That is a game rate: the 1 g rate (17.5 h) moves the sky ~6 px per minute, which nobody notices. Gravity stays 1 g, and the star's surface keeps its physical drift.

- **Coordinates.** The observer rides the band, so the sky shader works in band coordinates. `traceStructure` rotates rays into frame coordinates about the spin axis and returns normals in band coordinates. The band's own parts are symmetric about that axis, so they trace there too. Surfaces lay out each part in its own coordinates (band and rails in band coordinates, everything else in frame coordinates), so detail stays on the part.
- **Direction.** The band carries the city east, so the frame and the stars sink toward the eastern horizon and rise out of the western one. The hub collars pass round the city every 20 minutes, their two arcs rising ~18° over the north and south horizons. Through the openings, the stars slide relative to the opening edges (parallax between the frame and infinity).
- **Walls facing the city.** As members sweep close, their walls face the observer. Rounded top edges are matte and tilt at most ~16°; a polished edge mirrored the overhead star into a thin white line along every wall.
- **Wrap.** Longitude cuts (atan at ±180°) that were behind the star now come into view; the relief march wraps longitude about its cell.

### Relief (`relief.ts`)

The shell is seen at a grazing angle equal to its elevation, so the lower sky shows the panels nearly edge-on, where flat shading reads as plastic. A height field is ray-marched inside the panel layer for primary rays: primary ribs on the module lattice, lower secondary ribs on an irregular per-module quadtree, each bay at its own depth (≈1,500 km). It fades to flat where the ribs fall below a pixel.

- **Rejected:** a regular quarter-module sub-grid, which reads as a tiled roof (a countable, human-scale rhythm).
- **Rib walls are dressed and matte** (tilt held under ~20°). Sheer polished walls mirror the star into thin bright slits that read as lit windows and crawl in motion.

### Plating (`plating.ts`)

The shell is a patchwork with no single countable size.

| Level | Behaviour |
|---|---|
| **Divisions** | An irregular quadtree from ~19° down to ~2.4°. Its leaves are flat facets with set errors |
| **Tiles** | A second irregular quadtree inside each facet: a power-law spread of sizes, each with its own finish, set error and shallow dome |
| **Facets** | Always sub-pixel; a rare few are rogue (failed actuators) and glint |

Resolved tiles trace their reflection (jittered within the lobe, integrated by TAA). Unresolved tiles are sampled, not averaged: their mean tilt deviates by σ/√N and their finish mix varies binomially per world-anchored cell.

### Materials and heat (`materials.ts`, `thermal.ts`, `surfaces.ts`)

The shell is one **fictional refractory alloy**. Physics is used where it shapes the picture and ignored where it only constrains: the alloy does not melt, and the heat goes to radiators outside, out of view.

| Part | Look |
|---|---|
| Collector plating | Warm polished metal, F0 ≈ 0.2 (slightly warm), polished and satin tiles, ~3 % offline. Glows dark bronze at ~2,600 K (~0.6 % of the star) |
| Structure (frames, hubs, rails) | The same alloy, a little brighter and rougher, running cooler (~2,350 K): it reads dark |
| Headers | The hottest coolant (~3,450 K, ~6 % of the star): continuous orange-gold lines along panel borders, both edges of every girder and the hub rims. These are the logo's lines |
| The band (the Veil's top) | A true mirror of precisely set panes (~0.1–0.2°); it does not glow |

- **Heat is the detail.** Visible glow is steep in temperature (5 % hotter is 1.6× brighter), so a temperature map does the work. Tiles run hot in the middle and cool at their seams, coolant warms across each facet, and regional loads vary. Bay floors near rib walls run cooler, and offline tiles are dark. Unresolved, it blends to the sample's mean, including glow's convexity in temperature.
- **The band is a precision mirror.** With the collectors' 1–2° pane set errors, panes near the rails reflected off the band, out through the gap beside it, into black space: a mosaic of dark rectangles. Now only its true mirror image remains: being concave, the band's outer strips reflect the open band further along, stepped by the panes.
- **Reflections give the metal** and brighten the shell toward the star. Near the limb the tiles mirror the star into the mosaic.
- **Nothing on the structure emits above the star** (`tests/thermal.test.ts`). The removed receivers were lines at 12–24× the star's radiance, 0.2–3 px wide. They saturated at any coverage into constant-width neon, read as LED strips and lane dashes, and crawled under camera motion. Their glare pumped with them. They were also impossible: under a source 45° in half-angle, étendue caps concentration at 2×.
- **Rejected:** black chrome (F0 0.13). It made every reflection chain die, so the shell was a uniform dark that the glare veil flattened to grey. Also rejected: bright aluminium mirrors and white ceramic (grey CG), and any meaningful diffuse share.

### Shading (`shading.ts`, `enclosure.ts`)

**Enclosure solve.** Every point of the inner face sees the same enclosure: the star cap on its normal, and chords around it at elevation ε, each meeting shell that is itself seen at ε. So L_shell(ε) satisfies a 1D fixed-point equation, with each class's thermal glow added.

| Output | Use |
|---|---|
| Prefiltered environment by reflected elevation (GGX and Gaussian-mirror tables) | Specular light of every finish |
| Irradiance by face tilt (horizon-clipped) | Diffuse light (× relief occlusion) |
| Shell mean radiance | Lights the plasma |
| Sky by zenith angle | Lights the air |

**Light echoes.** A traced reflection that meets the star evaluates the star's flares at its retarded time. The extra path through the reflector, divided by c, is 3–6 s for tiles near the limb (`SHELL_LIGHT_SECONDS` = 3.28 s per shell radius). A flare's impulsive bursts flash on the disc and then, seconds later, in the far shell's mirrors.

## Space (`space/`)

The stars, the Milky Way and nebulae, in frame coordinates. Their brightness is a deliberate departure from radiometry: at a daylight exposure a real sky beyond the shell is black. They are lifted until they read through the air in front of the openings (the veil there is ~0.07 scene radiance) and over the film look's black point (`docs/render-pipeline.md`), because the moving sky is the cue that the band turns.

- **Where the city can look** (`catalogue.ts`). Through the open bands, from declination ~15° (low in the east and west) to the poles (low over the north and south horizons, mostly hidden behind the rails); through the wide openings, at |dec| ≈ 55°. The equator is always behind the band. So the galactic plane passes within 12° of both poles, and the showpieces sit at |dec| 20°–70°, spread in right ascension. Two emission nebulae are placed for the first-impression view, one in the gap either side of the band.
- **The system sits in a star-forming complex.** Showpiece nebulae are 7°–20° across: emission regions (Hα red-pink, OIII teal cores, dust pillars with bright fronts), reflection nebulae (blue), blast remnants (filamentary arcs), dark clouds, one inclined spiral galaxy. The palette is that of deep-sky photographs. **Rejected:** strong domain warping (marbled, lava-lamp clouds) and a bounding outline that read as a pink disc.
- **Diffuse sky: baked** (`field.ts`, `bake.ts`). A 1024² half-float cube rendered once at boot and sampled with an explicit footprint LOD. Per pixel, its noise would cost more than the rest of a space pixel and add register pressure to the structure trace. A texel is ~0.09°, finer than any structure seen through the air, but the future telescope will need a sharper bake.
- **Point stars: analytic** (`stars.ts`). Two lattices of equal-angle cube-face cells, at most one star per cell, denser near the galactic plane. Fluxes follow N(>F) ∝ F^−3/2 and are spread over a 0.7 px Gaussian, so a star's flux is conserved at any field of view. Colours come from blackbody temperature. The brightest just cross the bloom threshold.
- **In mirrors.** A traced reflection that escapes through a gap shows the baked backdrop, without the point stars (the lobe jitter would smear them). It stays dark wherever the sky beyond is dark.
- **Debug.** `?sky=space` shows the sky beyond the shell alone, in every direction.
- **Debug.** `?sky=material` colours the layout: panels grey, members orange, hubs red, band blue, space black.

## Environment capture

`environment.ts` captures a PMREM of the sky at eye height. It is the local scene's only light. The glazed deck mirrors the turning frame and stars, so the capture is refreshed whenever the frame has turned 0.1° (every 2 s):
- **One cube face per frame**, then the prefilter one face of one level per step (`render/pmremSlices.ts`), in place: ~28 steps of at most ~1.5 ms each.
- **Rejected:** the one-call `fromCubemap`. Its ~9 ms GGX convolution was a visible hitch every 2 s.
- The slicer drives PMREMGenerator internals (three 0.186.1) and fails boot if they change. WebGPURenderer applies a target's scissor only under the renderer's own scissor test.
- The capture renders through a CubeCamera. **Rejected:** `PMREMGenerator.fromScene`, which in this three version mirrored the environment east–west.
