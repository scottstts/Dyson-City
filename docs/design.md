# Dyson — Design

## 1. Pitch

A quiet first-person walk through **Dyson**, the only city on the inner surface of a Dyson sphere. Dyson is small: a garden city a kilometre across under its own glass dome, with seven refined places. Everywhere else the sphere is bare, undeveloped megastructure.

You arrive outside, on the bare deck of the band, facing the Dome. Overhead, a real star fills the sky, a burning surface 90° across. On every side, the inner face of the sphere rises out of the horizon haze, climbs the sky as a vast pieced-together structure, and disappears into the star's glare. A gate opens, and inside is a normal, human-scale place set inside something incomprehensibly large. There are no people, no objectives and no time of day.

Pillars:

1. **Photoreal, not illustrated.** Every frame should read as a photograph taken by someone standing there: physically motivated light, real atmosphere, a camera-like exposure. It must not read as a stylised picture, a painted ball or a demo scene.
2. **Astronomical scale, felt correctly.** Everything within reach is human-scale and finely detailed. Everything above the horizon is hundreds of thousands of kilometres away and must look it.
3. **Intimate ground, incomprehensible sky.** The Dome sits between them: built at human hands' scale, large enough to frame the sky.
4. **Quality over quantity.** A few places, each crafted inside and out.
5. **Physics serves the picture.** Use physics to decide what the image looks like. Bend it freely where it would hurt the look or playability.

## 2. World frame

| Fact | Choice | Consequence in the image |
|---|---|---|
| Star | A Sun-like G2 star, radius **696,000 km** | A blinding white photosphere: countless granules, faculae, spots, flares, prominences at the limb |
| Shell | Inner radius **984,000 km** from the star's centre (288,000 km above its surface) | The star is **90° across**. Its limb sits **45° above the horizon** in every direction |
| Gravity | Spin gravity, **1 g** at the equator (17.5 h rotation). The star's own pull and Coriolis are ignored | Walking and falling feel like Earth |
| Location | The city sits **on the equatorial band**, which at spawn runs through a hub collar 20° to the east (where a meridian frame meets the band, as in the logo) | Only there does "down" point straight down. At spawn the hub collar rises on the eastern horizon |
| Spin | **Only the band turns**, inside a static frame (spines, hub collars, gores) that keeps the stars' orientation. One turn every **2 hours** relative to the frame (a game rate, not the 1 g rate). The star's surface keeps its own drift | The frame and the stars beyond it sweep **east → west at 3° per minute**: they sink toward the eastern horizon and rise out of the western one, and the hub collars travel along the band, passing round the city every 20 minutes. The star's surface drifts ~0.83° per minute |
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
- **Space is lifted to be seen.** A real daylight exposure would show space through the gaps as black. Here the stars, the Milky Way and large nebulae are far brighter than physical, so the sky outside reads through the air and the openings, and its motion shows the band turning (`docs/sky.md`). The telescope still reveals much more.
- **Scale must come from content.** Seeing a sphere from a point on it is a stereographic projection, so its silhouettes cannot tell 200 m from 1,000,000 km. What tells it:
  - the local air, which veils the lowest structure;
  - detail with no countable elements at any scale (a regular rhythm a few degrees apart reads as human-scale architecture);
  - depth from structure standing off the shell, and open space behind it;
  - physically consistent light: the same star lights everything, and every inward-facing surface receives the same irradiance.
  The shell must also climb continuously out of the horizon haze. It must never hang over the plain like a canopy.
- **Everything is first principles.** This view has no real-world reference, so the look is derived from geometry, radiometry and materials, not invented as art. The full reasoning is in `docs/world.md`.

## 3. The Dyson structure

The sphere is the project logo (`public/logo.png`), modelled as drawn: an equatorial band with ring hubs, six meridian spines, big curved gore panels in each sector, open bands beside the band, alternating wide openings and narrow slots between the gores, and polar collars. The band spins inside the rest, so nothing of the frame crosses it: the spines end in hub collars that the band runs through. At spawn the city is 20° west of a hub. The full specification is in `docs/sky.md`.

The shell is a fictional refractory alloy: dark, warm metal that mirrors the enclosure and glows faintly with the heat it collects. Its hottest coolant channels run as thin orange-gold lines along panel borders, girders and hub rims: the logo's lines. Details are in `docs/sky.md`.

**Nothing has random holes, missing modules, slivers or wireframe lattices.**

## 4. Media and the Veil

- **Air band.** Spin gravity holds air against the Girdle; the Veil roofs it at 1.2 km. It is clean, dry, oxygen-enriched working air at 0.55 bar: breathable, but thin.
  - It hazes the horizon and veils the lowest structure.
  - Its short column overhead leaves the open bands dark.
- **The cavity is clear.** Dust and molecules cannot exist at ~4,000 K, neutral gas falls onto the star, and a plasma dense enough to see would outshine the star. Crispness is the right message a million km away. A faint white plasma fill adds a subtle aerial perspective that grows with distance.
- **The Veil.** It is required: unshielded, the habitat would sit at ~4,850 K. It is a spectrally neutral attenuator, so the star's light stays white. Details are in `docs/world.md`.

## 5. The star

The star is blinding. Even through the Veil, looking toward it you see brightness swallowing everything: pure white-hot light with no silhouette you can point to and almost no surface texture, its glare engulfing the structure beside it. The world further from it emerges from the blaze.

- **What it is underneath.** A real, caged, more-active-than-the-Sun star at true scale: granulation (~620,000 granules on the visible disc), faculae, spot groups, flares; a corona, a burning chromospheric fringe, loop arcades rooted all over its surface, prominences, and gas bursts erupting off the limb. In the normal view almost all of it is lost in the blaze; the telescope, with its own exposure, reveals it.
- **Colour.** Temperature (Planck) and per-channel limb darkening; a 5,772 K body under a daylight camera reads hot cream-white. The atmosphere's plasma runs orange to gold to white-gold.
- **Motion.** Real time, never time-lapsed: the surface drifts ~0.8°/min with the shell's spin; the energetic star's flows run at hundreds to a few thousand km/s. The gas bursts alone are time-lapsed, so they visibly billow. Flares echo in the far shell's mirrors seconds later.

## 6. The site (built in the world phase)

- **The Girdle deck**: bare structural metal plating to the horizon, with a plate, bay and sector hierarchy. Fine dust lies in drifts along its gratings (`docs/ground.md`).
- **The Garden Deck**: on the equatorial band, just west of the hub. A raised, 1 km foundation platform of pale engineered stone. Its perimeter descends to the deck in three 0.4 m steps (outer edge at r = 502.4 m). Survey axes are inlaid in bronze:
  - the Spinward axis runs east–west;
  - the Meridian axis runs north–south.
  A bronze datum disc marks the centre. Darker border courses run every 24 m, half a bay off the axes.
- The city phase builds everything in §7 on this platform. The deck outside stays bare.

## 7. Dyson — the city

### 7.1 Concept

- **The Dome holds the city's air.** The band's air is a working atmosphere: 0.55 bar, dry, oxygen-enriched and dusty at deck level, breathable for a walk but not for living. The city keeps Earth-normal air under a pressurised glass dome: **1 bar**, still, mild and humid enough for gardens and open water, and free of the deck's dust. That is why the city is pristine, why it is enclosed at all, and why its only way in is an airlock. The Engine House makes that air from the band's, through the South Collar. The Veil stays as it is: it shields the whole band; the Dome only encloses the city.
- **The Dome is glass first.** From inside it must nearly vanish: the whole sky, the star and the far structure seen through it, with the frame as a sparse, clean drawing across it.
- **One city, one hand.** The Dome speaks the megastructure's language (twin-rail bands, ring collars: the logo's grammar) at city scale. Inside, Solar Neoclassical (§9) at human scale.
- **A cross of axes, a garden plan.** The survey axes become the plan: the **Spinward axis** is walked (gate to Archive), the **Meridian axis** is water (Engine House to North Station). They cross at the datum under the Dome's crown. The four quadrants between them hold gardens, water and the places.
- **The Dome dominates.** Nothing inside rises above ~40 m. Buildings stay human-scale; the Dome is the only large made thing, and beyond it, the sky.
- **Tone:** pristine, maintained, empty. Serene, not eerie.

### 7.2 The Dome

**Form.** A 2:1 semi-ellipsoid of revolution on the platform's rim: 1,005 m across, **251 m** high at the crown. It is a pressure vessel, and this is the standard pressure-vessel head. It lands **vertical**: its base meets the step straight down, so the pressure's uplift goes straight down through the sill into anchors in the deck, and nothing pushes outward. That is why it needs no buttresses and can stand exactly on the stair. The Eave Ring takes the hoop load where the head turns down into the drum.

| Height | 0 m | 24 m | 74 m | 162 m | 232 m | 251 m |
|---|---|---|---|---|---|---|
| Radius | 502.4 m | 500 m | 480 m | 384 m | 192 m | 0 |

**Coupling with the rim.** The frame's outer faces land on the **lowest step, a 20 mm reveal inside its riser** (r = 502.4 m): the riser continues straight up into the Dome. Every foot (drum posts, collar legs, band rails) stands on a dressed plinth seated across the two lower treads; the glass is set back to the platform's top edge (r ≈ 500 m) in a bronze sill channel, so between posts the stepped rim stays visible from outside, as a colonnade stands on a stepped base. Inside, the paving runs flat to the glass.

**Structure: bands, coffers and collars.** Few, heavy members, in a clear hierarchy. Nothing radiates from the crown and nothing is triangulated. **The frame stands entirely outside the glass:** the pressure presses the glass outward against the members' inner faces (a 50 mm gasket line), so from inside the glass is one clean surface with the frame beyond it. Members meet at cast bronze nodes.

| Part | What it is |
|---|---|
| **Axis Bands** | Two bands over the survey axes, the heaviest members: twin rails 24 m apart (over the pad's first border courses), glazed between, crossing at the crown. Each runs down the Dome through a collar to the sill (at the west, onto the gatehouse's piers). The logo's band with its twin edge rails |
| **Coffer ribs** | Ribs parallel to the axes every 96 m (four pad bays), in vertical planes, forming a two-way grid of coffers in each quadrant. Ribs end on the band rails, with a cross-tie spanning the band at each junction (the logo's posts across the open bands). Nothing crosses a band |
| **Eave Ring** | The hoop at 74 m (r = 480 m). The ribs at 288 m and 384 m meet it at shared nodes (288² + 384² = 480²), so the edge coffers close as clean triangles and quads with an arc side, never clipped slivers |
| **Drum** | Below the eave, 24 posts carry the rib nodes down to the sill, glazed between |
| **Collars** | A 96 m round arch at each cardinal point standing in the drum: a semicircle (radius 48 m, crown at 90 m) on two vertical legs down to the sill, the ring cut open at the bottom (as the logo's hub collars are cut open over the band). The band passes through it; the Eave Ring frames into its flanks. West: the Gate. North: the Crown Car. East: the Archive's window. South: the Engine House's air intakes |
| **Crown** | The crossing of the two bands at 251 m: a lantern hung beneath it, a telescope turret above it, and a ring balcony outside (§7.6) |

- **Mostly transparent.** About **90 % of the Dome is clear glass**; from anywhere in the city the frame covers roughly a tenth of the sky. Members are sized to read as solid but no larger: band rails 5 m wide × 8 m deep, ribs 3.5 × 5 m, collars 6 × 8 m, the Eave Ring 4.5 × 7 m, drum posts 4 m wide.
- **Glazing: no bars.** Each coffer (and each drum bay between verticals) is **one monolithic curved pane** of transparent ceramic, pressed against the frame: the glass itself carries no pattern. Anti-reflection coated (faint reflections from inside) and **tinted neutral grey like sunglasses, ~50 % transmission**: from outside the Dome reads dark (two passes, ~25 %); from inside the city is a stop darker, the star still clips white, and its glare and bloom are halved. Each pane is set a milliradian or two off its neighbours, so reflections seen from outside break pane by pane (as the deck's plates do).
  - *Rejected:* a 12 m grid of glazing bars. From inside it read as graph paper over the whole sky.
- **Materials.** The frame is honed warm-white ceramic composite (albedo ~0.6) dressed like stone: arrises and block joints. It is bound in **glazed black ceramic** for contrast: black linings inlaid in every member's shadow groove (two on the bands, collars and Eave Ring), and black **binding collars**, real sleeves 7 cm proud of the member, a pair flanking every joint and more spaced ~18 m between. Nodes and the sill are satin bronze. In the blaze every face toward the star washes out near white, as intended; the frame reads by its modelling, edges and silhouette, not its colour. The glass is spectrally neutral, never tinted: a tint would split the light into a warm inside and a white outside, for the same reason the amber Veil was rejected (`docs/world.md`).
- **From outside.** On the plain it is the only made thing. Tops facing the star burn near white; vertical faces receive under a fifth of the light a horizontal one does (the star is overhead), so the drum models strongly; undersides see only the dark deck. The shoulders mirror the star, broken pane by pane: the Dome's brightest feature.
- **From inside.** The entire sky through clear glass: the star, the far structure climbing out of the haze on every side, the open bands and the stars. The frame is a sparse drawing over it: bars near the zenith dissolve into the glare, those lower down stand out lit by bounce from the pale city. The frame and the stars turn slowly past the fixed ribs: the coffers are a reference grid that makes the band's spin legible.
- **Light inside.** The frame and glass take ~10–15 % of the star's light, about a quarter stop. Bounce from pale stone makes the city brighter in its shadows than the dark deck outside.
- **Rejected:**
  - ribs radiating from the crown with concentric rings, and triangulated geodesic or cable nets: both read as webs;
  - a shallow cap: it meets the step at an angle and pushes outward, needing buttresses or a thrust ring outside the step;
  - a full hemisphere (500 m): it walls off half the sky from the arrival point;
  - opaque gores with openings (the logo taken literally): the city would sit in shade and lose the sky;
  - a frame inside the glass: the pressure would pull the glass off it, and from inside the glass would read as a second, reflective layer over the structure;
  - coloured (amber, gold) glass: it would split the light into a warm inside and a white outside. The tint is neutral grey.

### 7.3 The West Gate

The only way in or out, on the Spinward axis, facing west along the band. It is an **airlock**: an outer gate, a chamber and an inner gate, which never stand open together.

- **The gatehouse** passes through the Dome's skin inside the West Collar: two massive piers (7 m thick, 31 m tall) running 48 m from the trunnion piers outside to the Gate Court inside, the outer gate's hood slung between them outside, the chamber's vault between them inside. The Spinward Band descends through the collar and lands on the piers; the glass stops on a bronze trim round the gatehouse.
- **Both gates are sector gates**, as on a dam spillway: a curved leaf 18 m wide and 14 m tall (radius 16 m) on two radial arm frames that pivot on bronze trunnions. Each leaf's convex face meets the higher pressure it holds back, so the load runs down the arms into the trunnions. Opening, a leaf lifts and rotates up about its trunnions, sweeping along its own circle, so it needs almost no clearance.
  - **Outer gate:** it holds the chamber's 1 bar against the band, so its skin faces the chamber and its arms, trunnions and hoists stand **outside, between the trunnion piers**: the mechanism faces you on arrival. It lifts up under the hood.
  - **Inner gate:** it holds the city's 1 bar against the vented chamber, so its smooth convex skin faces the Gate Court and its arms are in the chamber. It lifts up into the chamber vault.
- **Mechanism, all visible:** floor bolts rising from each bronze sill into keepers on the leaf's lip, side-seal tracks on the jambs, paired telescoping hydraulic hoists, trunnion hubs ~3 m across in bolted bearing housings. Dark steel, chrome and bronze. (Jamb bolts are impossible: the leaf's edges sweep the jambs.)
- **The chamber** is a sealed vault 26 m long between the leaves, on a basalt floor: equalising vents in its walls, two long pendant luminaires under the vault (downlight and uplight), slim wall luminaires along both piers, and a large brass pressure dial (0.5–1.05 bar), the only gauge you need.
- **Sealed shut.** Black rubber seals close every edge of a shut leaf: a lip seal bearing into the bronze sill, side seals running in the jambs' seal tracks, and a fixed top seal under each head that the skin bears on.
- **The threshold is the stair.** The platform's three steps run through the outer opening up to the chamber floor.
- **Behaviour (automatic, no prompt).** Going in:
  1. Approaching within ~9 m, the outer gate opens (bolts ~1 s, lift ~6 s). If the chamber is at city pressure, it vents first.
  2. Once the player is in the chamber and clear of the leaf's sweep, the outer gate closes (~6 s).
  3. The chamber fills to 1 bar (~5 s): a rising rush from the vents, the dial's needle climbing.
  4. The inner gate opens onto the city.

  Going out runs in reverse. **Venting cools the chamber's humid garden air by expansion, so it fills with a brief mist** that clears as the outer gate opens onto the dry deck. Going in, there is none. A gate never sweeps through the player; walking back before a gate closes reopens it.
- **Outside**, a pale stone apron (a 15 mm slab on the deck, arrised) carries the Spinward axis inlay out from the threshold between and in front of the piers.

### 7.4 Arrival

- **Spawn:** on the apron ~30 m in front of the West Gate's piers, facing the closed gate, the view pitched a little up: the whole gatehouse front with the collar arches either side. The gate opens as you walk up to it (within ~9 m).
- **Why west:** the gate faces anti-spinward, so the arrival view looks east, the established first-impression direction. The plan (§7.5) is laid out from the gate: the Spinward axis is the processional route from it.
- **The reveal:** walk to the gate; it opens onto the Spinward axis: the Gate Court, the avenue, the Mirror Basin and the Archive's portico ~750 m away, under the coffered sky with the Spinward Band running overhead along the axis.

### 7.5 City plan

```
                                     N
                           North Collar · North Station
                                     │  ← Crown Car up the Meridian Band
                                     │
           The Parterres        Meridian Canal          The Grove
                                     │
  West Gate ═ Gate Court ═ Spinward Avenue ═ ( Datum · Mirror Basin ) ═ Avenue ═ Archive ═ East Collar
                                     │
        Canal Quarter ── branch canal┤                  Thermae
          · Canal House              │
                                 Water Stair
                           Engine House · South Collar
                                     S
                    (the Ring Walk follows the Dome's drum all round)
```

- **The ground is the platform.** Avenues and plazas show its limestone paving, border courses and bronze inlays. The datum stays at the centre. The Spinward inlay runs the length of the avenue; the Meridian inlay continues on the canal floor, seen through clear water.
- **Water is recessed into the platform** with real openings (the platform's mesh is rebuilt with them), never a sheet laid on the paving.
- **Planting** grows in built beds and terraces with stone copings.
- **Still air.** The climate plant circulates the Dome's air slowly; leaves stir gently, water stays a mirror.
- **Clearances.** The Ring Walk keeps buildings ~30 m clear of the drum; no building rises above ~40 m.

### 7.6 Places

Seven places. Each has a fully detailed exterior **and** interior and a distinct identity.

| # | Place | Where | Exterior | Interior | Why go there |
|---|---|---|---|---|---|
| 1 | **West Gate** | West Collar | The collar front and the outer gate's arms and trunnions (§7.3) | The airlock chamber: the inner gate's arms, the vents, the pressure dial | The way in and out, and the first view down the axis |
| 2 | **North Station** | North Collar | Station hall at the collar's foot; the cars' track descends the Meridian Band through the collar into it | Concourse and platform, a car waiting | The Crown Car |
| 3 | **The Crown** | The apex, 251 m | Lantern and telescope turret at the crossing of the bands | A glazed gallery ring looking straight down into the city, round an instrument room of brass, gold and dark wood. A small airlock up to the **Crown Walk**, a ring balcony outside on top of the Dome | The telescope, and the only unobstructed panorama of the band |
| 4 | **Archive** | East end of the Spinward axis | Colonnaded hall with a deep portico closing the axis vista | Tall library hall; the **Sphere Model** in the apse, in front of the East Collar's window, where the real band climbs toward the real hub | Understand where you are |
| 5 | **Thermae** | South-east quadrant | Low, long bathhouse under a deep coffered roof | Still pools, steam, polished stone, beams of starlight through deep oculi | Light and water |
| 6 | **Canal House** | Canal Quarter, south-west | Refined residence on a canal: terraces, pergola, mooring | Living spaces, study, roof terrace, as if someone just stepped out | Human intimacy in an empty world |
| 7 | **Engine House** | South Collar | Machine hall behind the collar's louvred intakes; the Water Stair falls from its header tank | Filter galleries, slow compressor rotors, humidifiers, pumps and the header tank: the machinery that turns the band's thin air into the city's, and keeps its water moving | The city alive, without people |

- **The Crown Car.** Two counterbalanced cars, one on each rail of the Meridian Band, so one always waits at each end. The track turns from vertical at the drum to horizontal at the crown (~600 m). Each glazed cabin hangs in a ring that keeps its floor level. A ride takes ~40 s.
- **The Crown** is the city's panorama and its observatory in one: the highest point and the telescope's home. The turret sits outside the pressure, its slit open to the band's air, so the telescope looks out through no glass; its light comes down a coudé path through a small pressure window to the eyepiece in the instrument room. On the Crown Walk, at band pressure, the Dome falls away on every side, the band runs to both horizons, and the star stands overhead.
- **The Sphere Model** is a bronze armillary of the logo's frame. Its band turns at the true rate, so it is also the city's clock: it shows where the hubs are. Its star is a crystal sphere under the hall's oculus, refracting the real star's light: it blazes with it. A gold pin, far larger than scale, marks the city.
- **The Thermae's oculi are deep light wells.** Under a 90° star a shallow opening throws a soft pool, not a beam. A deep well passes only the part of the cap near its axis, so it throws a narrow cone that shows in the steam.
- **The Canal Quarter** is a short street of houses on a branch canal, with footbridges. Only Canal House opens; the others are complete exteriors.

### 7.7 Public spaces

| Space | Character |
|---|---|
| **Gate Court** | Colonnaded forecourt beyond the inner gate; the axis opens ahead |
| **Spinward Avenue** | Cypress avenue between twin stoas: the city's broad shade. The Spinward Band runs overhead along it |
| **Datum Court & Mirror Basin** | The datum on a round court ringed by still water, bridged on the axes. Directly overhead, 251 m up, the bands cross at the Crown |
| **Meridian Canal & Water Stair** | Still canal on the axis from the Water Stair below the Engine House to a basin before the North Station |
| **The Parterres** (north-west) | Terraced parterres stepping up from the avenue: clipped box, lavender, fountains, water stairs |
| **The Grove** (north-east) | Stone pine and olive on lawn, a small tempietto with a bench framing the Crown |
| **Ring Walk** | Promenade along the inside of the drum, 3 km round, along the platform's bronze boundary ring: the bare plain outside, through glass |

### 7.8 Interior light

Each interior's exposure to the star is designed, not left to chance. Some rooms are glazed to soak up the blaze; others are deliberately dim, lit by deep openings, bounce and lamps, so stepping in is a real change of light. The eye adapts (§12), but only so far: a dim room still reads dim, and its windows blow out.

| Place | Light | How |
|---|---|---|
| Gate chamber | Dim, enclosed | A sealed vault lit by lamps. The gates open onto blazing light at both ends: the strongest exposure swing in the game, and the reveal of the city overexposed for a moment |
| North Station | Bright | A glazed hall inside the North Collar's glass, the car shaft rising through it |
| Crown gallery | Blazing | A glass ring hung under the crossing, open to the star overhead and the city below |
| Crown instrument room | Dim | Shaded lamps on brass and dark wood; the eyepiece; the airlock stair a bright slot of daylight |
| Archive | Dim hall, two blazes | Reading hall under high clerestories, lamps at the desks. Two blinding things at its end: the crystal star under the oculus and the East Collar's window behind it |
| Thermae | Dark, with beams | Narrow cones from deep light wells through steam onto still water; light bounced up from the pools; corners near dark |
| Canal House | Bright, soaked in light | Glass walls onto the terraces and canal: the living rooms take in the whole outside. The study is the exception: small, wood-lined, lamp-lit |
| Engine House | Half-light | A tall clerestory band over the machine floor, working lamps over each machine, highlights running along polished metal |

- **Lamps are real light sources** in the one radiance scale, at the star's colour temperature (~5,000 K) so interiors keep the single warm cast. Outdoors they would be invisible in the blaze, so the city has no outdoor lamps.

## 8. Interactions

A single **"Press E to …"** prompt. No menus, inventories or multi-step mechanics.

| Interaction | Prompt | Behaviour |
|---|---|---|
| West Gate | none | The airlock cycles automatically as you approach and pass through (§7.3) |
| Doors | *Press E to open* | Sliding or pivoting doors animate open. The Crown Walk's small airlock cycles in a few seconds on the same prompt |
| Crown Car | *Press E to ride up / down* | Seated ride between the North Station and the Crown. Mouse-look stays free |
| Telescope | *Press E to use telescope* | In the Crown. Steerable view: mouse aim, scroll zoom, its own exposure |
| Sphere Model | *Press E to examine* | The camera settles on the slowly turning model |
| Benches | *Press E to sit* | Framed, slow look |

**The telescope** resolves what the eye cannot:

- granulation, spot fine structure, flare ribbons, prominences;
- the far structure's plates, lights and hubs.

Its exposure adapts to its narrow field. Through a gap in the structure it resolves the nebulae's filaments and dust, faint stars and the galaxy's star clouds beyond what the eye sees.

**Movement:** WASD + mouse look, sprint (Shift), jump, crouch. Grounded and slightly unhurried; the view moves as a walking or running person's head does (`docs/player.md`). You can walk out through the gate onto the band and round the Dome.

## 9. Visual style

### The world

The style is photoreal megastructure: engineering at a scale beyond comprehension, rendered with physical light. The look is derived, not painted.

- A blinding white star whose glare floods the frame and dissolves its own outline.
- A patchwork of warm metal tiles reflecting real pieces of the enclosure and glowing faintly with heat, the star blazing in the tiles near the limb; through the gaps, a starry sky with nebulae, turning slowly past the band.
- Distance shown by content, light and motion (`docs/scale.md`): blue habitat air in front of everything, a crisp cavity behind it.

### The city: Solar Neoclassical

Classical proportion, colonnades, domes and porticoes, built with futuristic precision. Calm, luminous and warm. No grime, no cyberpunk.

- Every edge resolved: bevels, chamfers, coursing, seams, mullions, copings.
- Interiors are equally considered.

| Material | Use |
|---|---|
| Honed pale limestone/travertine | Podiums, terraces, the Garden Deck |
| White ceramic composite | Façades, the Dome's frame |
| Brushed champagne-gold / satin bronze | Rings, nodes, mullions, railings, survey inlays, the Dome's glazing bars |
| Dark bronze, machined steel | The West Gate and the city's machinery |
| Neutral low-iron glass | The Dome, curtain walls, the Crown Car's cabins |
| Dark polished basalt | Accent bands, water edges, steps |
| Warm dark wood, leather, fabric, brass | Interiors |
| Water | Basins, canals, fountains, pools |

**Vegetation:** Italian cypress, stone pine, olive, clipped boxwood, lawn, lavender, flowering shrubs, vines, water lilies.

### Lighting mood

The key light is a 90° area source straight overhead, seen through the Dome's coffers. It produces:

- very soft, short shadows and strong contact occlusion;
- bright warm bounce from the pale stone;
- strong sheen on glossy surfaces;
- the star reflected in water and glass, crossed by the Dome's frame.

Outdoor shadows are very dim and short: a soft darkening at the foot of each building, never a cast shape (`docs/shadows.md`). Interiors are where shadows look ordinary, each lit by its own design (§7.8).

## 10. UI / HUD

- **In play:** nothing on screen. Looking at an interactable shows a small dot and the prompt.
- **Place titles:** fade in briefly on entering a place or a named public space.
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

Implementation notes live in the system docs (`docs/world.md`, `docs/sky.md`, `docs/ground.md`, `docs/player.md`, `docs/shadows.md`, `docs/render-pipeline.md`, `docs/runtime.md`, `docs/dome.md`, `docs/gate.md`).

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
  - exposure keyed to the star (the outdoor light never changes; interiors adapt, below);
  - glare: the eye's scatter and a strong camera bloom above a threshold (exact for the star, screen-space for everything else), and halation that spills the clipped disc past its outline;
  - daylight (D65) white balance: the star's own light carries one warm cast;
  - a film look: a black point that takes the glare veil off, a high-contrast curve and a very light lens vignette;
  - hue-preserving filmic tone map (overexposed colour runs toward yellow and white, never pastel) and grade;
  - subtle lens response.

### What the city adds

- **Shadows** (`docs/shadows.md`): outdoors, a cheap baked field of how much of the star each point sees, giving the dim, short darkening at the feet of buildings; indoors, ordinary shadows from openings and lamps. *Not built yet* (see shadows.md for what exists).
- **The star's exact glare follows what the eye sees of it** (built): scaled by the star's visibility at the eye (less under the Dome, none under a roof), and the disc replaces only sky pixels.
- **Eye adaptation** (built). A metered, global exposure: a weighted average of scene luminance, never local.
  - **Floor:** pinned at the star key, so outdoors and under the Dome nothing changes.
  - **Ceiling:** about +4 stops, so dim rooms stay dim.
  - **Speed:** asymmetric, as an eye. Going in it opens over ~4 s; going out it clamps down in ~1 s after a moment of overexposure.
- **Bounce light.** The pale city lights the Dome's underside, the stoas and every interior. Indirect light (star, sky and lamps) is to be baked for the static city; the environment capture inside the Dome includes the Dome (built).
- **The Dome's glass** (built) is one thin neutral layer composited analytically in post over the sky and the scene behind it.
- **Local reflections** for water and glass (the Mirror Basin, the canals, the Dome seen in the glazed deck), with the environment capture as fallback.
- **Altitude.** The Crown is 0.26 km up a 1.2 km air column: the sky and aerial perspective tables need the eye's altitude.

**Performance stance:** no hard frame-rate target while building, but no known performance pitfalls. Repeated elements (trees, balusters, posts) are instanced; the Dome is a few merged meshes; baked light costs nothing per frame.

## 13. Out of scope

- NPCs, dialogue, quests, inventory, combat.
- Time of day, weather, seasons.
- Leaving the habitable band. The far structure is only seen, never walked.
- Building on the band outside the Dome: no roads, outbuildings or transit there. The only transport is the Crown Car.
- Non-Chromium browsers and mobile.
