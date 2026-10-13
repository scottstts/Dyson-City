# Render pipeline and camera

Code: `src/render/`.

## Pass order

```text
scene MRT (output, packed normal, velocity)
  → GTAO (half res, contact only: faded 25–60 m)
  → aerial perspective on local geometry (explicit camera uniforms; inscatter × star illuminant)
  → TRAA (resolved on x/(1+x) of exposed luminance and expanded after: sub-pixel lines brighter than the star otherwise flicker)
  → eye: glare (render/glare.ts) → exposure × daylight white balance → hue-preserving filmic → grade → grain → OETF → dither
```

- **Post camera uniforms.** Post passes need their own `projInv`/`camWorld` uniforms. TSL camera nodes inside a post pass refer to the quad camera.
- **Sky velocity.** The sky writes a rotation-only velocity (it is at infinity), so TRAA does not smear it.

## Glare (`glare.ts`)

Glare is the image convolved with the camera's point-spread function.

- **Camera PSF** (`LENS`): a sharp core plus a lens halo carrying 60% of every source's light (Gaussians of 3.5°, 11° and 30°). It is set large on purpose, so the star's light floods the frame. **Rejected:** the eye's 1/θ² PSF tail, which veils the entire frame evenly.

The PSF is energy-normalised over the sphere, and tests check conservation.

- **The star's share is exact.** It comes from a 1D table G(θ) against the angle from the star's centre, integrated at boot. It is continuous across the limb, with no ring.
- **Other sources** use three screen-space Gaussians moment-matched to the PSF's annuli. Their σ is in degrees, so it follows pixels per degree.
- **Rejected:** a masked analytic veil (it made a ring), and threshold bloom.

## Exposure and colour (`exposure.ts`, `tsl/toneMap.ts`)

- **Fixed exposure, keyed to the star.** Its disc mean maps to `STAR_KEY` (~3.8 stops over mid-grey). Everything else falls where its radiance puts it, so black metal stays black. Metering on the structure lifts black metal to grey.
- **Daylight white balance.** The star is neutral.
- **Tone curve:**
  - Linear in log exposure below a knee (black stays black, mid-grey stays mid-grey).
  - An exponential shoulder to white at +4.5 EV, which takes the star to white with a trace of texture.
  - Colour runs to white near display white.
  - **Rejected:** AgX's lifted toe (it greyed the black metal) and ACES/Reinhard shoulders.
- **Grade:** saturation 1.08, no extra contrast.
