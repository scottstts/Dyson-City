# Sky: star, far structure, media

Code: `src/sky/`, `src/atmosphere/`. Everything above the local geometry is one fullscreen sky shader (`skyNode.ts`); every feature is hundreds of thousands of km away, so there are no meshes. The acceptance test for everything here is `docs/scale.md`.

## Composition

Per view direction:

1. below the horizon: ground (environment capture and the sub-pixel strip beyond the deck mesh);
2. otherwise: the star disc, or the far structure (traced, with relief for primary rays), or open space;
3. prominences standing off the limb (`star/prominenceNodes.ts`);
4. the thin interior plasma between the observer and what the ray meets (`medium/plasma.ts`);
5. the local air: in-scatter + transmittance.

## Boot precompute (worker)

In order, because each feeds the next:

1. **Plasma line table** (`medium/plasma.ts`): τ(b, x) and transmittance-weighted in-scatter for every line through the sphere, lit by the limb-darkened disc and, separately, by a unit isotropic shell.
2. **Enclosure solve** (`structure/enclosure.ts`): see below. It also sets the plasma's shell illumination.
3. **Air** (`atmosphere/precompute.ts`): lit by the enclosure's sky (star + shell).

## Star (`star/`)

What makes the star read as a 1.4-million-km body rather than a ~200 m glowing ball is scale, so the white-light photosphere carries no pattern that is not physically there:

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

### Prominences (`star/prominences.ts`, `star/prominenceNodes.ts`)

A deliberate departure from broadband physics: in white light prominences are far too faint beside the photosphere. They are drawn because eclipse imagery makes them read as the real Sun's living edge, and because their size and slowness carry scale. Everything else is kept true:

- Size 40,000–140,000 km (≈3–11° at the limb), hedgerow sheets of near-vertical threads and loop arcades.
- They rotate with the star and rise over the limb from behind it; the eight nearest the limb occupy GPU slots.
- Threads stream at ~20 km/s; eruptions climb to ~350 km/s over 40 min (a few degrees per minute) about every 2.5–5 h per prominence.
- Salmon-pink (Hα, Hβ, He D3), up to ~12 % of the disc mean, optically thin: brighter seen edge-on, capped.

## Media: what lies between the city and the far shell

Physics bounds the cavity tightly, and that sets the look:

| Candidate | Why it is (not) there |
|---|---|
| Dust, water, molecules | The cavity runs 3,600–4,400 K: grains sublimate, molecules dissociate |
| Neutral gas | Scale height ~150 km at 5,000 K: it falls onto the star (it is the chromosphere) |
| Coronal plasma (1–3 MK) | The only thing that can fill the cavity, but a density that visibly veils the far shell would radiate more power than the star emits |

So the cavity is effectively clear, and crispness is the right message for structure a million km away. **The thin fill** (`fillDepth` 0.01, Thomson, white) is kept as a subtle, deliberate aerial perspective that grows with distance. **Rejected:** a dense corona (optical depth ~1 along a line grazing the star). Its glow hugging the limb, together with the old lens halo, made the star read as a lamp in fog. A/B renders showed the limb sharpen and the far structure gain contrast without it.

**Habitat air** (`atmosphere/`): ordinary Rayleigh + aerosol air under the Veil at 1.2 km. It veils everything in front of it blue, so the structure reads as beyond the sky (the daytime-Moon effect).

## Far structure (`structure/`)

### Layout (`layout.ts`, `trace.ts`)

The project logo (`public/logo.png`), modelled as drawn. **Rejected:** a net of frames with a panel filling every cell; that is not the logo.

| Part | Specification |
|---|---|
| Equatorial band | ±3.5°, the habitable Girdle, with twin edge rails |
| Spines and hubs | Six meridian spines 60° apart, pole to pole. Each has a ring hub (with a crown) where it crosses the band |
| Open bands | Space shows between the band and the panels, from 3.5° to 12° latitude. Only short posts and diagonal braces cross it, from each wide opening's panel corners down to the band |
| Gore panels | One per 60° sector and hemisphere, from 12° to 62° latitude |
| Gaps between gores | They alternate. Around every other hub there is a wide opening (±17° longitude), crossed by latitude members at ±27° and ±50°. At the other spines there is a narrow slot (±2.2°) |
| Poles | A collar at ±70°. The polar cap inside it is open, with the spines meeting a polar hub |
| City | On the band, 20° west of a hub with a wide opening: looking east is the logo's front face |

- **About 43% of the sphere is open** (`tools/coverage.mjs`, which mirrors the layout and feeds the enclosure's area shares).
- **Tracing.** Members are slab ∩ layer, optionally clipped. Hubs are cone ∩ layer. Every frame hit carries its slab's size, so surfaces need no per-index tables.
- **Debug.** `?sky=material` colours the layout: panels grey, members orange, hubs red, band blue, space black.

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
| The band (the Veil's top) | A true mirror; it does not glow |

- **Heat is the detail.** Visible glow is steep in temperature (5 % hotter is 1.6× brighter), so a temperature map does the work. Tiles run hot in the middle and cool at their seams, coolant warms across each facet, and regional loads vary. Bay floors near rib walls run cooler, and offline tiles are dark. Unresolved, it blends to the sample's mean, including glow's convexity in temperature.
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

## Environment capture

`environment.ts` captures a PMREM of the sky at eye height once at boot. It is the local scene's only light.
