# The Dome

Code: `src/city/dome/` (`spec.ts` holds every dimension), the modelling kernel in `src/geometry/`, the audit kit in `tools/geometry-kit/`. Design intent is `docs/design.md` §7.2; the East Lock is `docs/east-lock.md`.

## Construction

- **One reference surface.** S is the glass's outer face (a 2:1 semi-ellipsoid, a = 499.75, c = 250, centred on the platform top). Every member is a section of S swept with a dressed profile, offset outward along S's normal: vertical-plane sections (ribs, rails, ties, collar legs), horizontal circles (the Eave Ring), meridians (drum posts), the collars' arch circles. Below S's equator the surface continues straight down, so members reach their plinths with a continuous normal.
- **A graph of runs cut at nodes** (`frame.ts`). Each run (a band rail, a rib line with its band tie, the Eave Ring, a post, a collar) is cut at every node it meets. Nothing passes through a node: every load path is member → bolted splice → cast arm → node body.
- **Cast nodes** (`nodes.ts`) are turned hubs. A node is a ceramic drum on S's normal with a bevelled crown, a bronze bearing cap and a bolt circle. Its underside (what the city sees through the glass) has a concentric pocket round a bronze bearing boss with its own bolt circle. One straight cast arm (the member's envelope + 80 mm) leaves the drum along each member, and every arm of a node ends on its splice at the same radius.
  - *Rejected:* the first build's bronze parallelogram bosses (user: clumsy, odd-coloured cubes). *Rejected:* a body shaped to the rounded convex hull of its arms, with flared arms. From inside it read as messy geometry: an irregular polygon, an off-centre pocket, arms of different lengths, and flare facets that showed as pale crescents. Symmetry is what makes a hub read as made.
  - Sizing is measured per node. Each arm is traced along its member's real curve in the tangent plane (the collars curve 0.4 m in plan within a node's reach). The drum's radius takes in every point where two arms still touch, plus a 150 mm clearance. The splice radius is the largest that any arm needs: a 1.3 m clear stub, a plate clear of the drum, and plates clear of each other. The acute eave corners (37° between a rib and the ring) make those hubs the largest, ~10 m across.
  - The drum's underside rings are draped onto S (at the rim of a large hub the tangent plane stands 5–10 cm off S); its crown is planar.
  - Arms start just outside the pocket (radius ½ R) and wholly inside the drum, so R ≥ 1.3 × the widest arm half-width + 0.3 m.
- **Splices** (`splice.ts`): a black plate pair, 0.4 m proud of the member's envelope, with the joint between the two plates as a groove round its edge. Bolts run round the margin on both faces, and up the member's side recess on any face that opens onto a member. Runs longer than 50 m get field splices at equal spacing (shop lengths).
- **Girders** (`girder.ts`): full-width bearing and cap flanges, with the web set back 0.3–0.55 m and black linings inlaid in the web-to-flange fillets. Heavy members (rails, collars, eave) also carry a longitudinal stiffener. White transverse stiffener plates sit at panels about one depth long, welded in with snipped corners. Each shop length's stiffeners are one part (one closed plate per component).
  - *Rejected:* a black web. Under the sky's glare the recess read as a void, and the collar legs as ladders.
  - *Rejected:* stiffeners as section steps inside the member's sweep. Four extra rings per stiffener tripled the member triangles (1.2 M).
- **Bolts** (`bolts.ts`): ~50 k bronze hex heads (16 triangles each), drawn as one instanced mesh per 250 m plan tile so off-screen tiles are culled. They are seated 10 mm into their face by construction and are not in the geometry audit.
- **Members bear on the glass** at a 50 mm gasket line, stepping out to 300 mm near the sill (clear of the sill channel the glass stands in) by 9 m up. Under the members, in order: node bodies 20 mm off the glass, arms 35 mm, splice plates 65 mm.
- **The Spinward rails land on gatehouses at both ends**: on the West Gate's piers and on the East Lock's roof. Only the Meridian rails have feet.
- **Feet.** Drum posts, collar legs and the band rails taper to the sill depth (2.55 m) over the lower 40 m, so their outer faces land a 20 mm reveal inside the bottom riser. They stand on plinths whose stepped seats sink 20 mm into the two lower treads and the platform edge. The plinths reach 0.6 m past the member along the sill, so a black base plate is bolted down on either side of it.
- **The eave and the grid.** The ribs at 288 and 384 m meet the Eave Ring (r = 480) at shared nodes; the edge coffers close as triangles and quads. Eave nodes are therefore 16 single and 8 double.
- **Collars** are a semicircle (r = 48 m, centred 42 m up) on vertical legs. *Rejected:* a full ring cut by the ground, whose legs met the sill at ~27°.
- **Member sizes** were raised after the first render read as a wire cage: rails 5 × 8 m, ribs 3.5 × 5 m.
- **Black is the joints** (user direction: high contrast, not a slapped-on texture): splice plates, base plates and the fillet linings. *Superseded:* black binding sleeves every ~18 m, which had no construction behind them.

## Glass

- **No glazing bars** (user direction): each coffer and drum bay is one monolithic pane.
- **Neutral grey tint** (user direction: like sunglasses), `GLASS_TINT` = 0.5. The interior capture takes the same transmission, so the city under the Dome is lit a stop lower. Eye adaptation lifts it back by about half (`render-pipeline.md`): the tint stays visible from inside, the estate still reads as noon. The star seen through it is still clipped. Its analytic glare is scaled by the transmission; its halation is not (it is the sensor's response to the clipped disc), so the disc still has no outline. *Rejected:* a 12 m bar grid, both as geometry (it was ~1.3 M triangles) and drawn in the shader; from inside it read as graph paper over the sky.
- **Composited analytically in post** (`glass.ts`), before aerial perspective and TAA: one ray–ellipsoid test per pixel, a pane per crossing (one from inside, two from outside), each crossing in front of the opaque depth. Each pane gets a hash-tilted normal (1.5 mrad) by its coffer (96 m plan cell) or drum bay (`glazing.ts` bay table).
  - *Rejected:* a transparent glass mesh. It would need sorting, its depth would hide the sky's depth-0 treatment (the star's atmosphere, no aerial perspective on the sky), and the MRT normal/velocity would be overwritten under blending.
  - **Each crossing reflects the eye's side of the pane**: the outdoor sky where the ray enters the Dome, the interior capture where it leaves. The interior lookup is parallax-corrected by tracing the reflected ray to the platform top or S's far side and reading the capture toward that point. *Rejected:* the outdoor sky for every crossing; from inside, near the drum at grazing incidence, the outdoor horizon (bright sky over the dark deck) showed as a dark curve that slid with the eye.
  - Known limit: the glass's own reflections move with the velocity of what lies behind them under TAA; the panes are smooth, so it does not show.
- **The gatehouse opening** is masked in the shader (|z| < 16.48, y < 31.48 on the west side) and covered by bronze trims on the glass (30 mm off the gatehouse; the top trim runs in three pieces between the landing rails). The East Lock's is masked the same way on the east side (`docs/east-lock.md`), and the sill runs in two lengths, north and south, between the two gatehouses.

## Light

- **Two environment captures** (`world.ts`): the open sky (the deck) and the view from the platform centre inside the Dome: the sky ×0.97 with the frame, platform and deck rendered into it (cube far plane 4 km, depth buffer on). Everything under the Dome takes the interior capture.
- **The frame blends both** by which way each face looks relative to S's normal (`materials/ceramic.ts` `domeEnvironment`): outward faces see the sky and the dark deck; inward faces see the pale platform and the city.

## Gates (tests)

`tests/domeFrame.test.ts`:
- Every part is one closed, outward solid (a stiffener set is one solid per plate).
- The assembly (members, nodes, splices, plinths, sill) has no coplanar overlap and no clash beyond the seats declared in `tests/helpers/domeAllow.ts`: a node's arms and caps in its own body, each arm in its own splice only, members in splices and plinths, stiffeners in their member, base plates on their plinth.
- Arms clear the pocket and run a full stub before their splice; every shop length is 4–51 m.

The full assembly overflows the audit's plane-cell map, so it runs in plan tiles (`tests/geometryGate.ts`).

## Cost

~730 k triangles in three materials (one draw call each), plus ~50 k instanced bolts. Built on the main thread at boot in ~1–2 s.
