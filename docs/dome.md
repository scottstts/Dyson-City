# The Dome

Code: `src/city/dome/` (`spec.ts` holds every dimension), the modelling kernel in `src/geometry/`, the audit kit in `tools/geometry-kit/`. Design intent is `docs/design.md` §7.2.

## Construction

- **One reference surface.** S is the glass's outer face (a 2:1 semi-ellipsoid, a = 499.75, c = 250, centred on the platform top). Every member is a section of S swept with a dressed profile, offset outward along S's normal: vertical-plane sections (ribs, rails, ties, collar legs), horizontal circles (the Eave Ring), meridians (drum posts), the collars' arch circles. Below S's equator the surface continues straight down, so members reach their plinths with a continuous normal.
- **Junctions are cast nodes** (`nodes.ts`). A node is a bronze parallelogram in S's tangent plane with sides parallel to the two members it joins, proud of them on every side. A continuous member passes through it; an ending member is trimmed on a plane parallel to the other member, 350 mm clear of it, and ends hidden inside. Nothing else meets.
  - The clearance is that large because members are deep (up to 8 m) and curved: at full depth the tilt of S's normal and the arch's curvature move faces by more than 150 mm across a junction.
  - Where two ribs leave one eave node together (the 288/384 corners), their trims step out until their sections are disjoint, and the node grows to cover it.
- **Members bear on the glass** at a 50 mm gasket line, stepping out to 300 mm near the sill (clear of the sill channel the glass stands in) by 9 m up. Nodes sit 30 mm below the members, still clear of the glass.
- **Feet.** Drum posts, collar legs and the band rails taper to the sill depth (2.55 m) over the lower 40 m, so their outer faces land a 20 mm reveal inside the bottom riser, and stand on plinths whose stepped seats sink 20 mm into the two lower treads and the platform edge.
- **The eave and the grid.** The ribs at 288 and 384 m meet the Eave Ring (r = 480) at shared nodes; the edge coffers close as triangles and quads. Eave nodes are therefore 16 single and 8 double.
- **Collars** are a semicircle (r = 48 m, centred 42 m up) on vertical legs. *Rejected:* a full ring cut by the ground, whose legs met the sill at ~27°.
- **Member sizes** were raised after the first render read as a wire cage: rails 5 × 8 m, ribs 3.5 × 5 m.
- **Black bindings** (user direction: high contrast, not a slapped-on texture). Linings: every edge inside a member's shadow groove is the black glaze slot; heavy members (rails, collars, eave) carry a second, lower groove. Collars: `buildBindings` sleeves each member with a bevelled black band (0.9 m, 7 cm proud, 3 cm under its glass face). A pair flanks every joint, clear of the node by its full extent + 0.7 m (a node the member ends in counts from that end), and the gaps between are split at ~18 m. Bindings are declared sleeves (`binding:`/`member:`) in the audit.

## Glass

- **No glazing bars** (user direction): each coffer and drum bay is one monolithic pane.
- **Neutral grey tint** (user direction: like sunglasses), `GLASS_TINT` = 0.5. The interior capture takes the same transmission, so the city under the Dome is lit a stop lower; eye adaptation does not lift it (the floor is 1), so the tint stays visible from inside. The star seen through it is still clipped. Its analytic glare is scaled by the transmission; its halation is not (it is the sensor's response to the clipped disc), so the disc still has no outline. *Rejected:* a 12 m bar grid, both as geometry (it was ~1.3 M triangles) and drawn in the shader; from inside it read as graph paper over the sky.
- **Composited analytically in post** (`glass.ts`), before aerial perspective and TAA: one ray–ellipsoid test per pixel, a pane per crossing (one from inside, two from outside), each crossing in front of the opaque depth. Each pane gets a hash-tilted normal (1.5 mrad) by its coffer (96 m plan cell) or drum bay (`glazing.ts` bay table).
  - *Rejected:* a transparent glass mesh. It would need sorting, its depth would hide the sky's depth-0 treatment (the star's atmosphere, no aerial perspective on the sky), and the MRT normal/velocity would be overwritten under blending.
  - **Each crossing reflects the eye's side of the pane**: the outdoor sky where the ray enters the Dome, the interior capture where it leaves. The interior lookup is parallax-corrected by tracing the reflected ray to the platform top or S's far side and reading the capture toward that point. *Rejected:* the outdoor sky for every crossing; from inside, near the drum at grazing incidence, the outdoor horizon (bright sky over the dark deck) showed as a dark curve that slid with the eye.
  - Known limit: the glass's own reflections move with the velocity of what lies behind them under TAA; the panes are smooth, so it does not show.
- **The gatehouse opening** is masked in the shader (|z| < 16.48, y < 31.48 on the west side) and covered by bronze trims on the glass (30 mm off the gatehouse; the top trim runs in three pieces between the landing rails).

## Light

- **Two environment captures** (`world.ts`): the open sky (the deck) and the view from the platform centre inside the Dome: the sky ×0.97 with the frame, platform and deck rendered into it (cube far plane 4 km, depth buffer on). Everything under the Dome takes the interior capture.
- **The frame blends both** by which way each face looks relative to S's normal (`materials/ceramic.ts` `domeEnvironment`): outward faces see the sky and the dark deck; inward faces see the pale city.

## Gates (tests)

`tests/domeFrame.test.ts`: every part is one closed outward solid; the assembly (frame, nodes, plinths, sill) has no coplanar overlap and no clash except node/member and plinth/member seats. The full assembly overflows the audit's plane-cell map, so it runs in plan tiles (`tests/geometryGate.ts`).

## Cost

~390 k triangles, two materials, one draw call per material; built on the main thread at boot in ~1–2 s.
