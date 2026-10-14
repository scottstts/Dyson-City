# Render pipeline and camera

Code: `src/render/`.

## Pass order

```text
scene MRT (output, packed normal, velocity)
  → GTAO (half res, contact only: faded 25–60 m)
  → geometry: aerial perspective (explicit camera uniforms; inscatter × star illuminant)
    sky: the star's atmosphere (sky/star/atmosphere.ts): rgb emission over exp(−τ) of what is behind
  → TRAA (resolved on x/(1+x) of exposed luminance and expanded after)
  → glare: eye scatter + camera bloom (glare.ts, glarePass.ts) → exposure × D65 white balance
  → lens vignette → film look (black point, high contrast) → hue-preserving filmic → halation of the clipped disc (screen blend) → grade → grain → OETF → dither
```

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
- **Other sources:** chained screen-space blurs (each stage adds the σ still missing, in quadrature, so every stage downsamples an already-smooth input; blurring the sharp image straight to a few texels aliased into flicker), from a half-resolution source (bloom input at quarter resolution).

## Halation (`glarePass.ts`)

Energy-conserving glare cannot hide the limb: just outside it, at most half the kernel sees the (limb-darkened) disc, so the glare tops out near 20 % of the disc and the clipped disc keeps a hard outline. A photographed sun loses its outline through the sensor's response to saturation, so the clipped disc spills white past its edge after the tone curve: near full white for ~5°, a fainter spill over ~16° (`HALATION`). The star has no edge you can point to.

## Exposure and colour (`exposure.ts`, `tsl/toneMap.ts`)

- **The star is blinding.** The Veil cuts the light a great deal, but what passes is still overwhelming. Looking toward the star you see brightness swallowing everything: no surface texture, no silhouette. The disc mean maps to `STAR_KEY` (~4.6 stops over mid-grey), so the disc clips to white and sunlit stone facing it burns near white. Its surface (granulation, spots, activity) is there for the telescope, with its own exposure.
  - **Rejected:** local adaptation that held the disc's texture and limb gradient visible. It read as a lamp or as a stone ball (grey mottles on off-white), not as blinding light.
- **D65 white balance**, as a camera set to daylight. The 5,772 K star renders hot cream-white, and everything it lights shares that one warm cast. **Rejected:** balancing on the star itself, which made the world neutral grey-white, like an overcast day.
- **Tone curve:** linear in log exposure below a knee at display 0.45 (black stays black, mid-grey stays mid-grey), then a long exponential shoulder toward white; colour runs to white near display white. **Rejected:** AgX's lifted toe (it greyed the dark metal) and ACES/Reinhard shoulders.
- **Grade:** saturation 1.08. Contrast is the film look's alone.

## Film look (`tsl/look.ts`)

A lightweight compositing layer in the final camera pass (no extra passes), on exposed radiance before the tone curve, as a film look sits before the display transform.

- **Black point (flare compensation).** The star's glare veil and the air lift the whole frame. The starry gaps exposed at ~0.11, under a stop below mid-grey; the darkest pixel was ~37 % grey and nothing was black, so a contrast look alone barely changed the frame. A smooth floor (0.075, soft knee) is taken off each channel and the rest rescaled about a bright pivot (0.45): darks go deep, mid-grey drops ~0.5 stop, highlights keep their place. It is a grading choice: scene radiance is untouched.
  - **Per channel, not on luminance.** Flare is added light, so taking it off each channel gives back the colour under it. On luminance it darkened a nebula behind the neutral veil into grey.
  - **Rejected:** rescaling about mid-grey. It pushed highlights up nearly a stop and burnt the stone.
  - Space was brightened 1.5× with it (`docs/sky.md`), or the nebulae's outer clouds sank into the new blacks.
- **High contrast** (in the manner of Blender Filmic's "High Contrast"). A log-exposure S-curve about mid-grey on luminance (hue preserved): gain 1.35 below mid-grey, easing to 1.18 above, where the tone curve's shoulder already compresses.
- **Lens vignette.** Very light: 15 % of the natural cos⁴ falloff, ~0.2 stop in the corners at the default 62° field, none at telescope fields.
