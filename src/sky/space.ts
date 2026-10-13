/**
 * The universe outside, seen only through gaps in the structure. Radiances are physically scaled
 * against the star: at any daylight exposure the stars and the galactic band are far below
 * visibility (as in every real daylight photograph of space). They exist for narrow-field,
 * long-exposure views such as the future telescope.
 */
import { float, vec3, floor, normalize, length, exp, max, dot, abs, smoothstep, pow } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { hash33, fbm3 } from '../render/tsl/noise';

type V3 = Node<'vec3'>;
type F = Node<'float'>;

/** Brightest field stars, in scene radiance units integrated over a pixel. Daylight sky ≈ 0.5. */
const STAR_PEAK = 2.0e-4;
const GALAXY = 1.2e-5;
const CELLS = 220;

export function spaceRadiance(d: V3, pixelAngle: F): V3 {
  const p = d.mul(CELLS);
  const cell = floor(p);
  const h = hash33(cell);
  const pos = cell.add(h.mul(0.8).add(0.1));
  const offset = length(p.sub(pos)).div(CELLS);
  const isStar = h.x.lessThan(0.08);
  // Magnitude-like distribution: a few bright, many faint.
  const brightness = pow(h.y, 7.0).mul(STAR_PEAK).mul(isStar.select(float(1), float(0)));
  const sigma = max(pixelAngle.mul(0.7), 1e-5);
  const psf = exp(offset.mul(offset).div(sigma.mul(sigma)).negate());
  const tint = vec3(1.0, 0.92, 0.84).add(vec3(-0.15, 0.0, 0.25).mul(h.z));
  const stars = tint.mul(brightness).mul(psf);
  // Galactic band about a tilted great circle.
  const galPole = normalize(vec3(0.42, 0.31, -0.85));
  const band = exp(abs(dot(d, galPole)).div(0.12).negate());
  const dust = smoothstep(0.35, 0.7, fbm3(d.mul(9.0), 4, pixelAngle.mul(9.0)));
  const galaxy = vec3(0.9, 0.85, 0.8).mul(band.mul(dust.mul(0.6).add(0.4)).mul(GALAXY));
  return stars.add(galaxy);
}
