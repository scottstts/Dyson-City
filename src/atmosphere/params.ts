/**
 * Habitat air held against the Girdle by spin gravity under the Veil, which roofs it at 1.2 km: a
 * 0.55 bar, oxygen-enriched mix (breathable, like ~4,500 m on Earth with extra O₂) over a thin, low
 * aerosol layer. The shallow column keeps the sky overhead dark where the shell is open, while long
 * horizontal paths still give the horizon haze. The
 * thinner air keeps the far structure legible through a deeper-blue airlight, while the aerosols
 * give the horizon haze and the forward-scattering aureole around the star's limb. Constant
 * pressure follows cylinders around the spin axis, so the "altitude" that sets density is the
 * depth below the equatorial cylinder of radius R. See docs/sky.md.
 *
 * Units: kilometres and 1/km. Channels: ~680 / 550 / 440 nm, used as linear sRGB R/G/B.
 */

import { DECK_MEAN_ALBEDO } from '../world/radiometry';

export type Vec3 = readonly [number, number, number];

export interface AtmosphereParams {
  readonly rayleighScattering: Vec3;
  readonly rayleighScaleHeight: number;
  readonly mieScattering: Vec3;
  readonly mieExtinction: Vec3;
  readonly mieScaleHeight: number;
  readonly mieG: number;
  readonly ozoneAbsorption: Vec3;
  readonly ozoneCenter: number;
  readonly ozoneHalfWidth: number;
  /** Above this altitude the air is treated as vacuum. */
  readonly top: number;
  /** Eye altitude above the deck used for the sky view (km). */
  readonly eyeAltitude: number;
  readonly groundAlbedo: Vec3;
}

export const ATMOSPHERE: AtmosphereParams = {
  // Earth sea-level Rayleigh coefficients scaled to 0.55 bar.
  rayleighScattering: [3.191e-3, 7.457e-3, 18.205e-3],
  rayleighScaleHeight: 8.0,
  // Engineered, filtered habitat air: aerosol optical depth ≈ 0.015 at 550 nm (very clean), in the
  // lowest kilometre or two. Rayleigh dominates the airlight.
  mieScattering: [0.0115, 0.012, 0.0125],
  mieExtinction: [0.0128, 0.0133, 0.0139],
  mieScaleHeight: 1.2,
  mieG: 0.82,
  // No ozone layer: the Veil is the habitat's UV shield.
  ozoneAbsorption: [0, 0, 0],
  ozoneCenter: 25,
  ozoneHalfWidth: 15,
  // The Veil roofs the habitat: no air above it.
  top: 1.2,
  eyeAltitude: 0.003,
  groundAlbedo: DECK_MEAN_ALBEDO,
};

/** LUT layout, shared by the precompute and the shader-side sampling. */
export const LUT = {
  /** Sky view: u = sqrt(azimuthFromEquator / (π/2)), v = 0.5 + 0.5·sign(e)·sqrt(|e| / (π/2)). */
  skyWidth: 128,
  skyHeight: 384,
  /** Aerial perspective for local geometry: u = sqrt(distance / apMaxDistance), v as above. */
  apWidth: 128,
  apHeight: 256,
  apMaxDistanceKm: 120,
  /** Inscatter source J(h, μ): x = μ (−1..1), y = sqrt(h / top). */
  sourceMu: 64,
  sourceH: 48,
} as const;
