# Shadows under a 90° star

Not built yet: nothing in the world phase needs it. This records what the city phase must do, and why.

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
- **Small or thin occluders** (people, columns, posts, benches, cypresses, the platform's steps) block almost nothing: soft contact darkening within about a metre, which contact AO already gives.
- **Broad, low roofs are the exception** and form real shade: stoas, porticoes, deep doorways, broad tree canopies (stone pines). Even these stay fairly bright, filled by bounce.
- **The Dome dims everything evenly.** Its members are hundreds of metres up, so their penumbrae are far wider than they are: together with the glass they take ~12 % uniformly and never cast bars. Its glass counts as transmittance, not as an occluder.
- **Rejected:** shadow maps of the star, and any outdoor shadow with an outline. A directional map models one direction and draws crisp shapes this star cannot produce.

### How: one baked field, one texture read

The star never moves (the band's spin does not move it, `docs/sky.md`) and the city is static, so outdoor star visibility is computed once at boot and costs nothing per frame.

- **Occluder height field.** The static city rasterised top-down into a plan map at ~0.25–0.5 m texels: per texel, the bottom and top of whatever stands there. Two values, not one, so roofs on columns (stoas, porticoes, canopies) shade the ground beneath them instead of filling it in.
- **Star visibility.** A worker integrates, for each texel, the share of the 45° cap whose rays clear the height field, marching a few directions over the cap. The result is a one-channel ground map. Building surfaces take the same visibility per vertex, from the same field at their own height.
- **Runtime:** one texture read in outdoor materials, multiplying the star's share of the image-based light only, never the air's or the bounce's. Tiles exist only where something stands; open ground is fully visible and stores nothing.
- **Fine contact** stays with GTAO.

## Indoors: ordinary shadows

Inside, light arrives through openings and from lamps, so shadows look as they do in any lit room: shaped by windows, oculi, skylights and lamps, with the softness each source gives. Exceptions are designed per place (`docs/design.md` §7.8):

- rooms behind large glazing behave like outdoors, with dim, soft shadows;
- deep light wells (Thermae) and the Archive's oculus act as narrow sources: sharp-edged pools and visible beams.

How:

- **Static interiors are baked**: star visibility through openings (exact soft shadows), sky, bounce and lamps.
- **Moving parts**: the doors, the gate leaves, the Crown Car, the Engine House's rotors, the Sphere Model.
  - **In daylight:** horizon-based visibility from GTAO. Cap visibility in a slice is the part of the 45° cap above that slice's horizon: exact and nearly free. It also corrects today's uniform-hemisphere AO, which darkens for blocked low-sky directions that carry little of the star's light.
  - **Under lamps:** real-time shadow maps, but only for the few lamps that light a moving part.

## Order of work

Nothing changes until buildings exist. The open site's only occluders are the platform's steps, which contact AO covers.
