# Shadows under a 90° star

The outdoor field is built for the Field (see Status). This records what the city must do, and why.

## What the source allows

The star fills a 45° cone about the zenith; nearly all direct light comes from it. A point is shaded only where an occluder enters that cone as seen from it.

| Consequence | Rule of thumb |
|---|---|
| Reach | An occluder only shades ground within about its own height (the cone's edge is at 45°) |
| Penumbra | About twice the height of the edge casting it, so there is never a crisp outline |
| Umbra | Only where the occluder covers the whole cap. A disc of radius R at height h has an umbra of radius R − h, which exists only when R > h |

## Outdoors: dim, short, at the foot

Outdoors (in the city under the Dome, and on the deck) a building does not cast a shadow shape. It darkens the ground at its own foot, softly and only a little.

- **A wall blocks at most half the cap**, right at its base, because it can only hide the half of the sky on its side. The share of the star's light it blocks, at distance d from a long wall of height H:

  | d / H | 0 | 0.1 | 0.2 | 0.3 | 0.5 | 0.7 | 1 |
  |---|---|---|---|---|---|---|---|
  | Star light blocked | 50 % | 42 % | 34 % | 27 % | 15 % | 6 % | 0 |

- **Only the star's share is lost.** Bounce from the pale stone and the sky still arrive, so even at the base the ground loses under a stop. The visible part is a soft band within about a third of the building's height; a 12 m pavilion darkens a strip ~4 m wide, fading to nothing.
- **Small or thin occluders** (posts, pipes, legs, thin trees, the platform's steps) block almost nothing: soft contact darkening within about a metre, which contact AO already gives.
- **Broad, low roofs are the exception** and form real shade: the house's porch, deep doorways, broad tree canopies, the Halo and the gantries over the Field. Even these stay fairly bright, filled by bounce.
- **The Dome dims everything evenly.** Its members are hundreds of metres up, so their penumbrae are far wider than they are: together with the glass they take ~12 % uniformly and never cast bars. Its glass counts as transmittance, not as an occluder.
- **Rejected:** shadow maps of the star, and any outdoor shadow with an outline. A directional map models one direction and draws crisp shapes this star cannot produce.

### How: one baked field, one texture read

The star never moves (the band's spin does not move it, `docs/sky.md`) and the city is static, so outdoor star visibility is computed once at boot and costs nothing per frame.

- **Occluder height field.** The static city rasterised top-down into a plan map at ~0.25–0.5 m texels: per texel, the bottom and top of whatever stands there. Two values, not one, so anything raised on legs (porch roofs, the Halo, gantries, tanks on legs) shades the ground beneath it instead of filling it in.
- **Star visibility.** A worker integrates, for each texel, the share of the 45° cap whose rays clear the height field, marching a few directions over the cap. The result is a one-channel ground map. Building surfaces take the same visibility per vertex, from the same field at their own height.
- **Runtime:** one texture read in outdoor materials, multiplying the star's share of the image-based light only, never the air's or the bounce's. Tiles exist only where something stands; open ground is fully visible and stores nothing.
- **Fine contact** stays with GTAO.

## Indoors: ordinary shadows

Inside, light arrives through openings and from lamps, so shadows look as they do in any lit room: shaped by windows, oculi, skylights and lamps, with the softness each source gives. Rooms behind large glazing behave like outdoors, with dim, soft shadows. The house interior is baked in Blender against the game's own light (`docs/city_plan.md` §9).

How:

- **Static interiors are baked**: star visibility through openings (exact soft shadows), sky, bounce and lamps.
- **Moving parts**: the doors, the gate leaves, the Field's moving machines, the car and the craft.
  - **In daylight:** horizon-based visibility from GTAO. Cap visibility in a slice is the part of the 45° cap above that slice's horizon: exact and nearly free. It also corrects today's uniform-hemisphere AO, which darkens for blocked low-sky directions that carry little of the star's light.
  - **Under lamps:** real-time shadow maps, but only for the few lamps that light a moving part.

## Status

- **Built:**
  - the Dome's even dimming (its frame is in the interior environment capture);
  - the West Gate chamber's light (lamps without shadow maps, daylight through the openings by solid angle, `docs/gate.md`);
  - the star's glare scaled by its visibility at the eye;
  - the outdoor star-visibility field for the Field's structures and the estate (`src/lighting/starShade.ts`, `docs/field.md`, `docs/estate.md`).
    - It applies near each texel's floor (the platform, or the estate's terrace 1.6 m up) and fades out within ~8 m above it; higher surfaces keep contact AO only.
    - A face samples visibility 0.7 m ahead along its normal (a wall's or hedge's side is not shaded by its own footprint). A face on top of an occluder at least 0.4 m tall sees the whole cap; lower occluders (kerbs) never shade the cap.
    - The West Gate's gatehouse and the Dome's plinths are not yet in the occluder map.
  - the house's interior light, baked (`docs/house.md`).
- **Not built yet:**
  - visibility on raised surfaces (per vertex, as above);
  - lamp shadow maps for the gate's moving leaves.
