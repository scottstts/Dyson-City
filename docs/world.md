# World frame, radiometry and the Veil

Code: `src/world/`.

## Units and frame

- **Units.** Sky geometry is in **shell radii**: shell radius = 1, observer at the origin, star centre at (0, 1, 0), star radius `STAR_RADIUS_R` = 0.7073. Local geometry is in metres. Nothing converts between them except the atmosphere's distance LUT axes.
- **The star is fixed.** It is always overhead and always fills the 45° cone about the zenith. Glare, the Veil's cone and the illuminant measurement rely on this.

## The physics that sets the image

| Fact | Consequence |
|---|---|
| Every inward-facing surface has its normal toward the star centre and sees the full 45° cap | Irradiance is π·L̄/2 everywhere. A white panel is only ~1 stop darker than the star; a mirror catching the star is as bright as the star |
| A chord at elevation e passes R·cos e from the centre | A mirror on the shell reflects a view ray at elevation e into another chord at e; it can only show the star through facet tilt when e is near 45°. Lower down, reflections chain around the sphere until they escape through a gap: **the shell darkens away from the star** (solved in `sky/structure/enclosure.ts`) |
| Seeing a sphere from a point on it is a stereographic projection | Geometry carries no absolute scale. Scale comes from detail statistics (countless pieces, never a countable rhythm), the open bands, the media and light |
| Flux at the shell: 3.15×10⁷ W/m² (23,000 suns) | The habitat needs the Veil. The structure is a fictional refractory alloy that absorbs it and runs hot (collectors ~2,600 K): it glows dark bronze, at ~0.6 % of the star (`sky/structure/thermal.ts`). The real limits — melting, radiator area — are set aside: physics is used where it shapes the picture |

## One radiance scale (`radiometry.ts`)

- `STAR_LUMINANCE` (10) is the photosphere's disc-centre luminance; everything uses this scale and only the camera maps it to the screen.
- `STAR_DISC_MEAN_RADIANCE` is the limb-darkened disc mean: the reference the atmosphere, plasma and enclosure tables are integrated with. The star's measured illuminant (`StarState.illuminant`) scales all of them.
- **No ambient term, no lamps.** All light traces to the star, directly or as the heat it puts into the structure: the shell's glow and its hot header lines (see `sky.md`). Nothing passive is brighter than the star; under a source 45° in half-angle, étendue caps concentration at 2×.

## The Veil

The shield roofing the habitable band at 6 km. It is a **spectrally neutral** broadband attenuator: its neutral cut is the camera's exposure, and it tints nothing. It cuts the light a great deal, but what passes is still overwhelming: the star is blinding from the habitat (`render-pipeline.md`).

**Rejected:** an amber hazard filter, both graded by angle and uniform. It turned the star into an orange ball and set it apart from the structure it lights. The star's own ~5,800 K light is white, and everything it lights must share that light.
