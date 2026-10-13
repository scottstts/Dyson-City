# Render pipeline and camera

Code: `src/render/`.

## Pass order

```text
scene MRT (output, packed normal, velocity)
  → GTAO (half res, contact only: faded 25–60 m)
  → aerial perspective on local geometry (explicit camera uniforms; inscatter × star illuminant)
  → TRAA (resolved on x/(1+x) of exposed luminance and expanded after)
  → eye: glare (render/glare.ts) → exposure × daylight white balance → hue-preserving filmic → grade → grain → OETF → dither
```

- **Post camera uniforms.** Post passes need their own `projInv`/`camWorld` uniforms. TSL camera nodes inside a post pass refer to the quad camera.
- **Sky velocity.** The sky writes a rotation-only velocity (it is at infinity), so TRAA does not smear it.

## Glare (`glare.ts`)

Glare is the image convolved with the eye's point-spread function.

- **Eye PSF:** a sharp core plus scatter shaped like the CIE 180 disability-glare function (10/θ³ + 5/θ² + 0.05/θ + 0.00125 per sr), whose integral (~28 %) is the share each source loses to glare. It is a power law with no characteristic angular size, so the limb stays razor-sharp. The veil is ~1 % of the star's luminance 10° outside the limb and ~0.5 % 40° away, so dark metal near the star goes charcoal. Looking into a source this large means being dazzled, not seeing a halo.
- **Rejected:** a lens halo of Gaussian lobes (3.5°/11°/30°) carrying 60 % of every source's light. A glow of fixed size around a clipped disc reads as a lamp in haze, and it veiled the far structure 10–50× brighter than the structure itself. Also rejected: the Spencer et al. tails, which keep the scatter within ~1° and barely dazzle.
- **The star's share is exact.** It comes from a 1D table G(θ) against the angle from the star's centre, integrated at boot and continuous across the limb.
- **Other sources** use three screen-space Gaussians moment-matched to the PSF's annuli, with σ in degrees.

## Exposure and colour (`exposure.ts`, `tsl/toneMap.ts`)

- **Fixed exposure, keyed to the star.** Its disc mean maps to `STAR_KEY` (~3.8 stops over mid-grey). Everything else falls where its radiance puts it, so dark metal stays dark. Metering on the structure lifts dark metal to grey. (Reviewed 2026-10-13: eye adaptation was proposed and declined for now.)
- **Daylight white balance.** The star is neutral.
- **Tone curve:**
  - Linear in log exposure below a knee at display 0.45 (black stays black, mid-grey stays mid-grey).
  - Above it, a long exponential shoulder (C1 at the knee) that approaches white without reaching it. The disc centre (~4.1 stops over mid-grey) sits at ~0.91 and keeps enough slope to show granulation, limb darkening and spots. The path to white makes it read white-hot. An earlier shoulder put the disc at 0.98, where the star was a featureless white ball.
  - Colour runs to white near display white.
  - **Rejected:** AgX's lifted toe (it greyed the dark metal) and ACES/Reinhard shoulders.
- **Grade:** saturation 1.08, no extra contrast.
