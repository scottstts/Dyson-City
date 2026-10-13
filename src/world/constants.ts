/**
 * Physical frame of the world. Single source of truth for scale.
 *
 * Local frame (render units = metres): origin on the deck at the city centre, +Y up (toward the
 * star), +X east (spinward), +Z south, so -Z is north. The sphere centre — and the star centre — is
 * at (0, SHELL_RADIUS_M, 0). The spin axis runs north–south (parallel to Z) through the centre.
 *
 * Sky shaders work in units of the shell radius (R = 1) with the observer at the origin, so the
 * centre is (0, 1, 0). That keeps every far-field quantity well inside float32 precision.
 */

export const KM = 1000;

/** Sun-like G2 star. */
export const STAR_RADIUS_KM = 696_000;
/** Inner radius of the shell, measured from the star's centre. */
export const SHELL_RADIUS_KM = 984_000;
export const SHELL_RADIUS_M = SHELL_RADIUS_KM * KM;

/** Star radius in shell units, and the star's angular radius seen from anywhere on the shell. */
export const STAR_RADIUS_R = STAR_RADIUS_KM / SHELL_RADIUS_KM;
export const STAR_ANGULAR_RADIUS = Math.asin(STAR_RADIUS_R);

/** Spin gravity at the equator. The star's own pull is ignored (design: physics serves the picture). */
export const GRAVITY = 9.81;
export const SPIN_RATE = Math.sqrt(GRAVITY / SHELL_RADIUS_M); // rad/s
/** The star's own rotation (25.4 d sidereal), about the same axis. Relative rotation is what we see. */
export const STAR_ROTATION_RATE = (2 * Math.PI) / (25.4 * 86400);
export const RELATIVE_ROTATION_RATE = SPIN_RATE - STAR_ROTATION_RATE;

/** Observer eye height above the deck/pad surface (metres). */
export const EYE_HEIGHT = 1.7;

/** Angle on the sky of a shell point at central angle γ: elevation = γ / 2. */
export function shellElevationForCentralAngle(gamma: number): number {
  return gamma / 2;
}

/** Distance (km) from the observer to the shell point seen at elevation e. */
export function shellDistanceKm(elevation: number): number {
  return 2 * SHELL_RADIUS_KM * Math.sin(elevation);
}

/** Apparent drift rate of the star's surface at disc centre (radians of sky per second). */
export function starDriftRate(): number {
  return (RELATIVE_ROTATION_RATE * STAR_RADIUS_KM) / (SHELL_RADIUS_KM - STAR_RADIUS_KM);
}
