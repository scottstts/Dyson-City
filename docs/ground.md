# Ground: the earmarked site

Code: `src/ground/`. Dimensions are in `site.ts`.

- **Geometry.** The platform and deck are revolved profiles (`geometry.ts`) with smooth strips and nosing arcs, never boxes.
  - The deck's inner radius is 2 cm inside the platform's outer edge, so the two never share a coplanar face.
  - The deck mesh ends at 15 km. Beyond that, the sky shader's ground strip takes over with the same mean albedo (`DECK_MEAN_ALBEDO`).
- **Lighting.** Both materials are lit only by the sky PMREM, the scene's environment. There are no punctual lights and no ambient term.
- **Pad (`padMaterial.ts`).**
  - Honed limestone slabs in running bond, with per-slab tone, veins, pores and lippage, and sealed 6 mm joints.
  - Courses every 24 m are offset half a bay from the survey axes, so they never overlap the inlays.
  - Inlays are satin bronze.
  - Normal perturbation must build from `normalWorldGeometry` / `normalViewGeometry`. Reading `normalWorld` inside a `normalNode` is circular and shades the inlays black.
- **Apron variant.** `createPadMaterial({ inlays: 'axis' })` is the same stone with only the Spinward axis inlay (ticked every 10 m), for the West Gate's apron.
- **Pad, sealer.** A clear coat over the honed stone, worn on some slabs and absent in joints and on bronze. It follows each slab's lippage, so the sky's reflection breaks slab by slab.
- **Deck (`deckMaterial.ts`).**
  - Dark glass-ceramic plates (albedo ≈ 0.07) with a polished glazed top (clear coat): the deck mirrors the sky, receivers and the star's glow, broken plate by plate by a few-milliradian set error.
  - Plates are 6×3 m, with 96 m gratings, 768 m trenches, fastener rows and narrow dust drifts. Dust dulls the glaze.
  - Detail fades by footprint to the mean BRDF (`DECK_MEAN_ALBEDO`, shared with the sky shader's distant strip and the atmosphere's ground bounce).
- **AO.** GTAO is faded out between 25 and 60 m, because a pixel there spans more than the AO radius and produced speckle.
