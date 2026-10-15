# The West Gate

Code: `src/city/gate/` (`spec.ts` holds every dimension), walls in `src/city/walk.ts`. Design intent is `docs/design.md` §7.3.

## Geometry

- **Leaves** (`leaf.ts`): identical, modelled in the trunnion frame (origin on the axis, z along it) and rotated as one body: skin (r = 16 m, 80 mm), T-ribs in three runs between two I-girders, two radial struts and a brace per side, cast hubs, hoist lugs, and lip keepers for the floor bolts.
  - Struts are narrower (0.42 m) than the girder flanges they bear on (0.5 m): equal widths left their sides flush with the flange edges.
- **Bolts are in the floor**, rising from the bronze sills into the lip keepers. Anything on a jamb within r ≈ 14.7–16.1 m of a trunnion is swept by the leaf's edges.
- **Seals** (black rubber) so a shut leaf passes no light: the lip seal runs 11 mm below the lip into the sill; the side seals run along both edges 4 mm into the jambs' seal tracks at every opening (and 2 mm of arc past the skin's top edge, so no end sits flush with it); the top seals are fixed under the heads, their face an arc 5 mm inside the skin's outer radius, so the skin bears on them as it moves and closes on them. All are declared contacts in `tests/gate.test.ts`.
- **Clearances by radius.** Every fixed part near a leaf is outside its swept annulus (skin and girders, r 14.75–16.0 about the trunnion): the head's west face (its underside is the outer leaf's top seal, at r ≈ 16.03), the hood's shell (r 17.4–18.6), the seal tracks (r 15.86–16.04, 8 mm proud of the jambs), the inner hoist bracket under the vault.
- **Hoists**: barrel 9.6 m from a fixed pivot under the hood or vault (r = 17 m, 100°), rod 10.0 m from the upper strut's lug (r = 8 m). The pivot distance runs 19.0 → 10.8 m over the stroke; the rod stays inside the barrel and never reaches the bracket.
- **Gatehouse** (`gatehouse.ts`): piers (|z| 9–16, x −518 to −470, 31 m, base course and cornice on the end faces only: the glass meets the outer faces), the heads and the segmental vault between them (all butting the piers), the hood (its ends run into the piers and its east end into the west head), the basalt floor 50 mm proud of the platform, sills, bearing housings with bolts, hoist brackets, luminaires on stems, vents, the dial, the glass trims and the apron.
- **The Spinward rails land on the piers** (`GATEHOUSE_RAIL_Y` = 29 m, inside the 31 m pier tops).

## Airlock (`airlock.ts`)

- Each gate: bolts (1 s) → travel (6 s, eased, a slight damped settle) and back; requests reverse it mid-travel.
- A gate opens only when the other is closed and bolted and the chamber's pressure matches its side; the chamber vents or fills (5 s) only while both are sealed.
- A player approaching within 9 m opens a gate (so it stays shut at the spawn and opens as you walk up); one in the chamber is cycled toward the side they did not come from. Turning back (7 m into the chamber, then within 4 m of the entry gate) reverses that. A gate closes 0.8 s after a passing player clears its sweep, 4 s after an idle approach ends, and reverses if the player steps back into its sweep.
- Mist rises with the pressure drop when venting and decays (6 s sealed, 1.6 s once the outer gate opens).
- `tests/airlock.test.ts` walks a player in and out and checks the interlock and timing.

## Sound

See `docs/audio.md`. The sound watches the airlock's phases and pressure; the airlock knows nothing of it. The hydraulics sound from the hoists, the landings from the leaf (into both spaces it divides), the bolts from the sill and the jets from the vents. A shut leaf passes only a low rumble.

## Light in the chamber (`lighting.ts`)

- **Lamps**: six RectAreaLights at the diffusers (each pendant's downlight and uplight, each pier's wall line), applied only to the gate's materials through `lightsNode` (not in the scene's light list, so nothing else pays for them). Radiances 6 / 3 / 5 (scene units) put ~1/35 of outdoor illuminance on the floor and walls: dim, readable once the eye opens up. No shadow maps yet.
  - Three's RectAreaLight lights the side its **local +Z** faces; orientations are set by rotation about x (`tests/airlock.test.ts` checks they face the chamber). Aimed the other way, the chamber was black.
- **Wall lines** stand 45 mm off the piers: the leaves' edges pass 100 mm from the jambs, and the lines stay clear of the vents, dial, housings and seal tracks.
- **Daylight through an open gate**: the closed-form solid angle of the opening rectangle (growing with the lip height) as each point sees it, times a facing term, scales the outdoor capture (outer gate) or the interior capture (inner gate).
- **Which side a point is on**: inside the chamber means between the leaves' skin mid-surfaces (r = 15.96 m about each trunnion, valid at any openness because rotation keeps the radius) or, above the opening, between the heads' faces. Elsewhere the gatehouse takes the interior or outdoor capture by which side of the glass it is on.
- **Mist** (`mist.ts`): a post composite after the glass: fog over the ray's segment through the chamber box, density × drifting wisps, scattering the chamber's ambient radiance (lamps plus daylight through an open gate).

## Walls (`walk.ts`, `player/collision.ts`)

The glass (inside at the sill channel's inner face, outside clear of it), the piers, the vents and dial, the frame's plinths, and each leaf while not fully open (`gate:outer`/`gate:inner` tags). The chamber floor and the apron are walkable surfaces 50 mm and 15 mm up.
