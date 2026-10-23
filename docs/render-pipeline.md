# Render pipeline and camera

Code: `src/render/`.

## Pass order

```text
scene MRT (output, packed normal, velocity)
  → GTAO (half res, contact only: faded 25–60 m; weighted per pixel by the normal target's alpha)
  → sky: the star's atmosphere (sky/star/atmosphere.ts): rgb emission over exp(−τ) of what is behind
  → composites, farthest first: the Dome's glass (city/dome/glass.ts), the gate chamber's mist (city/gate/mist.ts)
  → geometry: aerial perspective over the result (explicit camera uniforms; inscatter × star illuminant)
  → TRAA (resolved on x/(1+x) of exposed luminance and expanded after)
  → glare: eye scatter + camera bloom (glare.ts, glarePass.ts) → exposure × D65 white balance
  → lens vignette → film look (black point, high contrast) → hue-preserving filmic → halation of the clipped disc (screen blend) → grade → grain → OETF → dither
```

- **The band switch** (`CameraSettings.band`, 1 in play). Off the band (the intro's first scene, `docs/intro-space.md`) the aerial perspective, the sky overlay and the band's composites are skipped (`If`), and the sky is the scene's own. `localComposites` (the intro's canopy) run either way. Off the band the glare's veil is the eye's scatter and clipped pixels halate (`clipAt` into the disc mask), since there is no analytic star share there.
- **Contact AO weight.** The scene pass's normal target carries in alpha how much GTAO darkens a pixel (`sceneMrt.ts`): 1 by default, 0 on the house's and the intro cabin's lightmaps (their bake holds the occlusion) and on glass. Glass is drawn with custom blending, under which three replaces the other attachments instead of blending them: a constant written there zeroed the normals behind every pane, and GTAO blacked out whatever the glass showed. Panes write their own normal (weight 0) and velocity.
- **Post camera uniforms.** Post passes need their own `projInv`/`camWorld` uniforms. TSL camera nodes inside a post pass refer to the quad camera.
- **Sky velocity.** The sky is at infinity, so camera rotation alone moves it. What a pixel shows can also move on its own: the frame turns about the spin axis (through the sphere's centre, not the observer), carrying its structure and the stars. The sky shader reports what it hit (`radianceMotion`: band-fixed, frame structure at distance t, or the sky at infinity), and the velocity undoes the frame's last step for it, so TRAA does not soften the occlusion edges and fine detail that carry the motion. The motion is tiny per frame (~0.015 px at a 60° field) but TRAA's history accumulates it.
- **The star's atmosphere is its own pass.** Folded into the sky shader, it pushed the structure trace's register pressure up and slowed the whole sky by several milliseconds (costs were non-additive: removing either half restored the frame). It needs nothing from that trace: every sight line ends at the photosphere or the shell, and the atmosphere lies inside the shell.

## Glare (`glare.ts`, `glarePass.ts`)

The star must engulf the frame: a white blaze whose glare floods the structure beside it, while the lower sky and the ground keep their contrast.

- **Eye scatter:** the CIE 180 disability-glare shape (10/θ³ + 5/θ² + 0.05/θ + 0.00125 per sr), ~28 % of every source, linear.
- **Camera bloom:** Gaussians of 1°/3°/8°/20° carrying ~46 % of the radiance **above a threshold** (0.15 of the star's disc mean): the star, its glints and its mirror images bloom; ordinary sunlit surfaces stay crisp.
  - Beside the star the veil is ~12 % of the disc mean 1° out, ~6 % at 5°, ~3 % at 10°, ~0.5 % at the horizon.
  - **Rejected:** a 35° lobe, and blooming every source linearly. Both spread an even veil over the frame that lifts every shadow: it reads as fog or a dirty lens, not blinding light.
- **The star's share is exact:** a 1D table against the angle from the star's centre (eye + thresholded bloom over the limb-darkened disc). Over the disc, the bloom's loss is taken from the smooth disc, not per pixel.
- **Only where the star is seen.** The smooth disc replaces sky pixels only (depth 0): geometry in the star's direction (a vault, a frame member, a lamp) keeps its own radiance and feeds the screen-space blur like any source. The star's table is scaled by `starVisibility`, the share of the disc the eye sees from where it stands (city/visibility.ts: 1 in the open, ~0.85 under the Dome, 0 under a roof, fading over the last few metres as the eye walks under it: the gate's vault and the house's roofs are marched like the frame). The table (and the smooth disc the bloom's loss is taken from) is also scaled by `starTransmission`, the glass in between (the Dome's tint, 0.5); halation is not.
- **Other sources:** chained screen-space blurs (each stage adds the σ still missing, in quadrature, so every stage downsamples an already-smooth input; blurring the sharp image straight to a few texels aliased into flicker), from a half-resolution source (bloom input at quarter resolution).

## Halation (`glarePass.ts`)

Energy-conserving glare cannot hide the limb: just outside it, at most half the kernel sees the (limb-darkened) disc, so the glare tops out near 20 % of the disc and the clipped disc keeps a hard outline. A photographed sun loses its outline through the sensor's response to saturation, so the clipped disc spills white past its edge after the tone curve: full white at the limb, ~0.3 five degrees out, a faint tail over ~20° (`HALATION`). The star has no edge you can point to.

- **A spread of the disc on the sensor.** Halation is the visible disc's pixels (sky pixels on the disc) blurred in the image plane by two Gaussians at quarter resolution. With the star out of frame there is none, and under a roof none.
  - **Rejected:** halation keyed to the angle from the star. Its far tail reached across the frame looking level, as display white after the tone curve: ~6 % over the estate's darks, the sky, the trees and the topiary, all lifted to one flat warm grey. The estate read as an overcast day.

## Exposure and colour (`exposure.ts`, `adaptation.ts`, `tsl/toneMap.ts`)

- **Eye adaptation** (`adaptation.ts`): a multiplier on the star-keyed exposure, floor 1 (views facing the star stay on its key), ceiling 2048 (+11 stops). It adapts fully over the first two stops of darkness and 0.8 of each stop beyond, as an eye's adaptation is incomplete: a day room ~8 stops under the sunlit garden reads ~1.2 stops under it, a lamp-lit hall ~11 stops under it ~1.8; the windows blow out.
  - **Rejected:** full adaptation capped at 64 (+6 stops). Lamp-lit halls and the rooms away from windows read black. A 64 × 36 centre-weighted log-luminance meter of the post-TAA scene is read back asynchronously every 4 frames; target = clamp(0.3 / log-average).
  - **The reference is a sunlit view's average (0.3).** Under the Dome's tint the estate meters ~0.18 (pale ground, a dark sky) and opens ~0.7 stop, so up-facing pale stone and gravel read near white, as noon ground does. At 0.12 the eye never opened under the Dome and the estate sat ~0.5 stop under a photographer's key: midtones dull, nothing bright. Opens with τ = 1.4 s, clamps down with τ = 0.3 s. Disabled when `?ev` fixes the exposure.
  - **At the terminal** the eye is held at ×6 (`adaptation.limit`, `docs/terminal.md`): the screen divides the eye's adaptation out, and with a free eye that loop ran to the ceiling.
  - The meter stores ln L offset and scaled into [0, 1]: the material's output is clamped on the way into the target, and raw negative logs read back as 0 (adaptation then never moved).

- **The star is blinding.** The Veil cuts the light a great deal, but what passes is still overwhelming. Looking toward the star you see brightness swallowing everything: no surface texture, no silhouette. The disc mean maps to `STAR_KEY` (~4.6 stops over mid-grey), so the disc clips to white and sunlit stone facing it burns near white. Its surface (granulation, spots, activity) exists at true scale but is lost in the blaze.
  - **Rejected:** local adaptation that held the disc's texture and limb gradient visible. It read as a lamp or as a stone ball (grey mottles on off-white), not as blinding light.
- **D65 white balance**, as a camera set to daylight. The 5,772 K star renders hot cream-white, and everything it lights shares that one warm cast. **Rejected:** balancing on the star itself, which made the world neutral grey-white, like an overcast day.
- **Tone curve:** linear in log exposure below a knee at display 0.45 (black stays black, mid-grey stays mid-grey), then a long exponential shoulder toward white; colour runs to white near display white. **Rejected:** AgX's lifted toe (it greyed the dark metal) and ACES/Reinhard shoulders.
- **Grade:** saturation 1.08. Contrast is the film look's alone.

## Film look (`tsl/look.ts`)

A lightweight compositing layer in the final camera pass (no extra passes), on exposed radiance before the tone curve, as a film look sits before the display transform.

- **Black point (flare compensation).** The star's glare veil lifts the frame near it. The starry gaps beside the star exposed at ~0.11, under a stop below mid-grey; the darkest pixel was ~37 % grey and nothing was black, so a contrast look alone barely changed the frame. A smooth floor (soft knee) is taken off each channel and the rest rescaled about a bright pivot (0.45): darks go deep, mid-grey drops ~0.5 stop, highlights keep their place. It is a grading choice: scene radiance is untouched.
  - **The floor is the veil the pixel carries:** the star's analytic share there, exposed, capped at 0.075 (reached beside the star). Looking level under the Dome it is ~0.01; indoors 0.
  - **Rejected:** a fixed 0.075 everywhere. Sunlit foliage, lawn and shaded walls in the estate expose at 0.03–0.09; the floor squashed them to near-equal values (flat grey-black, their colour gone).
  - Diagnostics: `?view=veil` shows the light the glare adds by origin (R the star's analytic share, G the eye's scatter of the image, B the camera's bloom; exposed ×4).
  - **Per channel, not on luminance.** Flare is added light, so taking it off each channel gives back the colour under it. On luminance it darkened a nebula behind the neutral veil into grey.
  - **Rejected:** rescaling about mid-grey. It pushed highlights up nearly a stop and burnt the stone.
  - Space was brightened 1.5× with it (`docs/sky.md`), or the nebulae's outer clouds sank into the new blacks.
- **High contrast** (in the manner of Blender Filmic's "High Contrast"). A log-exposure S-curve about mid-grey on luminance (hue preserved): gain 1.35 below mid-grey, easing to 1.18 above, where the tone curve's shoulder already compresses.
- **Lens vignette.** Very light: 15 % of the natural cos⁴ falloff, ~0.2 stop in the corners at the default 62° field, none at narrow fields.
