# Sky: star, far structure, media

Code: `src/sky/`, `src/atmosphere/`. Everything above the local geometry is one fullscreen sky shader (`skyNode.ts`); every feature is hundreds of thousands of km away, so there are no meshes.

## Composition

Per view direction:

1. below the horizon: ground (environment capture and the sub-pixel strip beyond the deck mesh);
2. otherwise: the star disc, or the far structure, or open space;
3. the trapped plasma between the observer and what the ray meets (`medium/plasma.ts`);
4. the Veil's transmission at the ray's incidence (`veilNode.ts`, `world/veil.ts`);
5. the local air: in-scatter + transmittance.

## Boot precompute (worker)

In order, because each feeds the next:

1. **Plasma line table** (`medium/plasma.ts`): τ(b, x) and transmittance-weighted in-scatter for every line through the sphere (impact parameter b, coordinate x), lit by the limb-darkened disc and, separately, by a unit isotropic shell. Any segment's single scattering is exact from two lookups.
2. **Enclosure solve** (`structure/enclosure.ts`): see below. It also sets the plasma's shell illumination.
3. **Air** (`atmosphere/precompute.ts`): lit by the enclosure's sky (star + shell) through the Veil.

## Star (`star/starSurface.ts`)

The star is caged. Back-warming from the shell makes it hotter and magnetically more active than the Sun, so its convection and field show strongly.

| Layer | Scale | Character |
|---|---|---|
| Granulation | ~0.25° | Domes with soft dark lanes, time-lapsed (`CONVECTION_TIME_SCALE` 20) |
| Mesoscale clumps | ~1° | Bright warped knots, upflow-skewed (exp response) |
| Pockets | several degrees | Broad cooler downflow regions, deep orange-red |
| Filaments | thin, branching | Ridged, strongly warped, broken; massed along pocket edges and in plage; the "veins" |
| Active regions | — | Spots with filamentary penumbrae, plage, flares |

- **Colour comes from temperature.** Every element's 550 nm intensity becomes a brightness temperature and the other channels follow Planck; limb darkening is per channel. To a daylight camera the star is white.
- **Rejected.** Closed cellular network outlines read as scales; ridged noise at one scale read as water caustics; H-α veins, a hot rim and false colour (earlier builds).

## Media: what lies between the city and the far shell

| Medium | Physical basis | What it looks like |
|---|---|---|
| **Trapped stellar wind** (`medium/plasma.ts`) | Fully ionised H/He at coronal temperatures, ~10¹² e⁻/cm³. Dust cannot exist here (it would sit at ~3,400 K) | The free electrons Thomson-scatter: grey, phase (1 + cos²θ). It has no bound electrons, so no Rayleigh blue and no absorption bands. It glows in the star's own white |
| **Corona** | Hydrostatic, near the star | Optical depth 2 along a grazing line: a continuous glow at the limb, with no ring |
| **Interior fill** (`fillDepth`) | The rest of the trapped wind | Invisible over the 10⁴ km to the nearby band. It lifts and softens structure and gaps 10⁶ km away: this enclosure's aerial perspective, white where Earth's is blue |
| **Habitat air** (`atmosphere/`) | Ordinary Rayleigh + aerosol air, roofed at 6 km | It is lit by the white star and shell, so the lowest degrees and the gaps seen through it go blue: a daylight sky between the structure |

The tables are exact single scattering on (impact parameter, position) lines. The enclosure solve sets the shell light the media scatter, and the air is lit by the enclosure's sky.

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
- **Tracing.** Members are slab ∩ layer, optionally clipped (opening members, posts and braces test both layer intervals). Hubs are cone ∩ layer. Every frame hit carries its slab's size, so surfaces need no per-index tables.
- **Debug.** `?sky=material` colours the layout: panels grey, members orange, hubs red, band blue, space black.

### Plating (`plating.ts`)

The shell is a patchwork with no single countable size: what any engineered surface looks like from orbit.

| Level | Behaviour |
|---|---|
| **Divisions** | An irregular quadtree from ~19° down to ~2.4°. Its leaves are flat facets with set errors |
| **Tiles** | A second irregular quadtree inside each facet: a power-law spread of sizes. Each tile has its own finish, set error (25% heliostat with larger tilts) and a shallow dome |
| **Mirrors** | Well aligned within a tile (~0.2°) and always sub-pixel. A rare few are rogue (failed actuators) and glint at the star's radiance |

- **Regions.** Collector regions (mirror, heliostat-dense, cell-glass, PV) follow a three-octave field evaluated at division centres, so their borders are ragged and division-aligned.
- **Ageing.** Regional ageing varies tone at continental scales.
- **Resolved tiles trace their reflection.** The ray is jittered within the lobe each frame and TAA integrates it. Each tile shows its own piece of the real enclosure: gaps dark, structure grey, the star blazing.
- **Unresolved tiles are sampled, not averaged.** Their mean tilt deviates by σ/√N and their finish mix varies binomially per world-anchored cell at the pixel's level of detail.

### Materials (`surfaces.ts`, `enclosure.ts`)

The shell is **black glossy metal**: a collector that absorbs what it harvests, finished polished.

| Part | Material |
|---|---|
| Plating (`BLACK_CHROME`) | F0 ≈ 0.13, rising toward 1 at grazing incidence (Fresnel). Diffuse residue 0.3%. It is dark except where it mirrors something bright: the star near the limb (individual tiles blaze), the corona, receivers |
| Girders, hubs, walls (`BLACK_STEEL`) | F0 ≈ 0.16, slightly less polished |
| Cell glass | Near-black, F0 0.04 |

**Rejected:**
- Bright aluminium mirrors and white ceramic: they read as grey CG and fought the user's material target.
- Any meaningful diffuse share: a 1% albedo under a 90° star is already mid-dark grey.

**Receivers.** These are continuous luminous lines hundreds to thousands of km long, whose strength drifts with the fields feeding them. They are never rows of lamp-like dots, which would act as a human-scale ruler.
- **Brightness:** about 12× the star's disc mean.
- **Where:** girder edges, hub rims and panel rims.

**Girders** are sectioned at two irregular scales: steel, mirror and dark radiator sections, with section joints and, in some sections, cross-girders. Their side faces are a patchwork of panels with gallery decks whose heights change between sections.

### Shading (`shading.ts`, `enclosure.ts`)

**Enclosure solve.** Every point of the inner face sees the same enclosure: the star cap on its normal, and chords around it at elevation ε, each meeting shell that is itself seen at ε. So L_shell(ε) satisfies a 1D fixed-point equation.
- **Inputs:** area-weighted surface classes (open area reflects nothing), with the plasma along each chord.
- **Lobes:** mirrors use Gaussian facet lobes of their normal spread; GGX's long tail is wrong under a star 90° across.

**Outputs:**

| Output | Use |
|---|---|
| Prefiltered environment by reflected elevation (GGX and Gaussian-mirror tables) | Specular light of every finish |
| Irradiance by face tilt (horizon-clipped) | Diffuse light |
| Shell mean radiance | Lights the plasma; the camera meters on it |
| Sky by zenith angle | Lights the air |

**At runtime:**
- Each pixel's finish reads the prefiltered table about its reflected direction.
- Pixels covering many tiles mix the finishes in their sampled shares, about the sample's mean normal.
- Receivers add their emission.

**Rejected.**
- Blending rough reflections to one mean wall radiance (the old "integrating sphere" average): it flattened everything.
- Traced sharp reflections: domed tiles of tilted mirrors never show a sharp image, so the prefiltered enclosure is exact for them.

## Local air (`atmosphere/`)

- **Composition:** 0.55 bar, very clean (aerosol optical depth ≈ 0.015), no ozone (the Veil is the UV shield).
- **Roofed at 6 km by the Veil:** the column overhead is short, so open space seen through the gaps stays dark, while long horizontal paths still haze the horizon.
- **Lit by the Veil-filtered enclosure sky**, so its LUTs already carry the right colour and the shader multiplies only by the star's illuminant.

## Environment capture

`environment.ts` captures a PMREM of the sky at eye height once at boot. It is the local scene's only light.
