# Shadows under a 90° star

Not built yet: nothing in the world phase needs it. This records what the city phase must do, and why.

## What the source allows

The star fills a 45° cone about the zenith; nearly all direct light comes from it. A point is shaded only where an occluder enters that cone as seen from it.

| Consequence | Rule of thumb |
|---|---|
| Reach | An occluder only shades ground within about its own height (the cone's edge is at 45°) |
| Penumbra | About twice the height of the edge casting it, so there is never a crisp outline |
| Umbra | Only where the occluder covers the whole cap. A disc of radius R at height h has an umbra of radius R − h, which exists only when R > h |

- **Small or thin occluders** (people, posts, benches, the platform's 1.2 m steps) never form an umbra. They give soft contact darkening within about a metre: what contact AO already gives.
- **Broad, low occluders** form real shadows: canopies, arcades, domes, deep doorways, narrow streets between tall buildings, interiors daylit through openings. Even these are fairly bright, filled by bounce from the pale stone and by the air.

## Decisions

- **No shadow maps or punctual-light shadows.** A directional shadow map models one direction and draws crisp outlines this star cannot produce.
- **Static geometry: bake star-cap visibility.** The star is fixed overhead (the band's spin does not move it, `docs/sky.md`) and the city is static. So the share of the cap each point sees is computed once, at build or boot, and stored with the geometry: exact soft shadows at no per-frame cost. It multiplies the star's share of the image-based light, not the air's or the bounce's.
- **Moving parts and fine contact: horizon-based, at runtime.** GTAO already finds each pixel's horizon per slice. Cap visibility in a slice is the part of the 45° cap above that horizon: exact, and nearly free. It also corrects today's uniform-hemisphere AO, which darkens for blocked low-sky directions that carry little of the star's light. Moving parts are doors, lifts and the maglev pod.
- **Until buildings exist, nothing changes.** The open site's only occluders are the platform's steps, which contact AO covers.
