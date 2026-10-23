# Intro: the sphere from outside

Code: `src/intro/space/`. Scene 1 shows the sphere from 2.35 shell radii out (latitude 30°, longitude 50°: `SCENE1_VIEW`), framed so the star blazes through a slot between the shell's parts.

- **The game's own shaders, met from outside.** The user's bar: the sun and the sphere must match or exceed the game's. A bright ball was rejected. Past the outer skin every pixel is the game's shader:
  - the photosphere (`createStarSurface`), its corona and chromosphere, loop arcades and prominences, and the cavity's plasma;
  - the far structure through openings, traced from any origin inside the shell (`traceStructure`, `shadeStructure`).
- **Generalised, not forked.** `coronaAlong` and `magneticPlasmaFrom` take any viewpoint. The game's `coronaEmission` and `magneticPlasma` are now thin wrappers with identical output. The erupting gas is a fluid in the city's plane of the sky, so it is not drawn from out here.
- **The outer skin** is black radiator plating laid out by the same collection network as the collectors behind it (districts, basins, channels). Its channels and edge headers glow with the heat they carry out: the logo's gold lines.
- **Fewer stars than the game's.** The game lifts its point stars far above physical so they read through the band's air; out here, beside a blazing star, an eye sees only the brightest few. The stars are dimmed to a tenth (`OUTSIDE_STARS`), so all but the brightest fall under the black point; the nebulae keep their lift. *Rejected:* the game's starfield as it is: dense, bright and artificial next to the star.
- **Physics bent for the picture:**
  - the outside is not the white-hot radiator the flux demands;
  - Alpha Centauri B is far brighter than its real share, so the faces turned to it read.
- **The pipeline's band switch** (`docs/render-pipeline.md`): off the band, aerial perspective, the sky overlay and the band's composites are skipped. The off-band glare uses the eye's scatter for its veil, and clipped pixels halate (`clipAt`).
