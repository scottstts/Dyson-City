/**
 * Point stars, drawn analytically so they stay sharp at any field of view and move smoothly as the
 * sky turns. Two lattices of cells on the sky (bright stars ~0.6° apart at most, faint ones ~0.25°),
 * each cell holding at most one star, more often near the galactic plane. Cells are laid on the six
 * faces of a cube, warped to equal angles (u = atan(a)·4/π), so every star sits on the sky sphere
 * and cells are near-equal in solid angle. Each star carries a flux,
 * drawn from the Euclidean count law N(>F) ∝ F^−3/2 (a few bright, many faint), spread over a
 * Gaussian of 0.7 px so a pixel receives the flux it covers; and a colour from its blackbody
 * temperature (pale blue-white to orange-red, desaturated as stars look).
 *
 * Fluxes are scene radiance × steradians, scaled (like the nebulae) far above physical so the stars
 * read through the air at a daylight exposure. The brightest just cross the camera's bloom
 * threshold; none approaches the star's radiance.
 */
import { float, vec2, vec3, floor, length, exp, max, dot, abs, pow, select, mix, smoothstep, atan, tan, normalize } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { hash33 } from '../../render/tsl/noise';
import { GALACTIC_POLE } from './catalogue';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

/** Reference pixel angle (rad): a 60° vertical field over 1080 px. Fluxes are set against it. */
const REF_PIXEL = (60 * Math.PI) / 180 / 1080;
const REF_PSF_AREA = 2 * Math.PI * (0.7 * REF_PIXEL) ** 2;

interface StarLayer {
  /** Cells across each cube face (spacing 90°/cells). */
  cells: number;
  /** Chance a cell holds a star, off and on the galactic plane. */
  chance: [number, number];
  /** Peak pixel radiance at the reference pixel of the faintest and brightest stars. */
  peak: [number, number];
  seed: number;
}

const LAYERS: StarLayer[] = [
  { cells: 150, chance: [0.12, 0.3], peak: [0.12, 3.0], seed: 0 },
  { cells: 360, chance: [0.18, 0.55], peak: [0.035, 0.35], seed: 1 },
];

/** Linear RGB of a blackbody at temperature T (K), normalised to unit luminance. */
function blackbody(T: F): V3 {
  // Wavelengths in µm (c2 = 14,388 µm·K) keep λ^−5 well inside float range.
  const planck = (lambda: number) => float(1).div(exp(float(14388 / lambda).div(T)).sub(1)).mul(lambda ** -5);
  const rgb = vec3(planck(0.61), planck(0.55), planck(0.465));
  return rgb.div(dot(rgb, vec3(0.2126, 0.7152, 0.0722))) as unknown as V3;
}

/** The cube face of d: its id (0–5), the in-face coordinates (a, b) and the major-axis sign. */
interface Face {
  id: F;
  ab: Node<'vec2'>;
  sign: F;
  /** Rebuilds a unit direction on this face from in-face coordinates. */
  dir: (ab: Node<'vec2'>) => V3;
}

function cubeFace(d: V3): Face {
  const ad = abs(d);
  const isX = ad.x.greaterThanEqual(ad.y).and(ad.x.greaterThanEqual(ad.z));
  const isY = isX.not().and(ad.y.greaterThanEqual(ad.z));
  const major = select(isX, d.x, select(isY, d.y, d.z));
  const sign = select(major.greaterThanEqual(0.0), float(1), float(-1));
  const am = abs(major);
  const ab = select(isX, vec2(d.y, d.z), select(isY, vec2(d.x, d.z), vec2(d.x, d.y))).div(am);
  const axis = select(isX, float(0), select(isY, float(2), float(4)));
  const id = axis.add(select(sign.greaterThan(0.0), float(0), float(1)));
  const dir = (q: Node<'vec2'>) => normalize(select(isX, vec3(sign, q.x, q.y), select(isY, vec3(q.x, sign, q.y), vec3(q.x, q.y, sign)))) as unknown as V3;
  return { id, ab: ab as unknown as Node<'vec2'>, sign, dir };
}

function layer(d: V3, face: Face, sigma: F, galactic: F, L: StarLayer): V3 {
  // Equal-angle cells on the face.
  const u = vec2(atan(face.ab.x), atan(face.ab.y)).mul(4 / Math.PI).add(1).mul(L.cells / 2);
  const cell = floor(u);
  const key = vec3(cell, face.id.add(L.seed * 8));
  const h = hash33(key);
  const h2 = hash33(key.add(vec3(0, 0, 104729)));
  // Kept off the cell walls so a star's PSF is not cut where the next cell begins.
  const at = cell.add(h.xy.mul(0.5).add(0.25)).div(L.cells / 2).sub(1).mul(Math.PI / 4);
  const offset = length(d.sub(face.dir(vec2(tan(at.x), tan(at.y)))));
  const chance = mix(float(L.chance[0]), float(L.chance[1]), galactic);
  const present = select(h2.x.lessThan(chance), float(1), float(0));
  // Peak radiance at the reference pixel: F ∝ u^(−2/3), capped at the brightest.
  const ratio = L.peak[1] / L.peak[0];
  const peakRef = float(L.peak[0]).mul(pow(h2.y.mul(1 - ratio ** -1.5).add(ratio ** -1.5), -2 / 3));
  const flux = peakRef.mul(REF_PSF_AREA);
  const psf = exp(offset.mul(offset).div(sigma.mul(sigma).mul(2)).negate()).div(sigma.mul(sigma).mul(2 * Math.PI));
  // Spectral classes as stars are seen: mostly F–K, some hot blue-white, some cool orange-red.
  const T = mix(float(3200), float(5600), smoothstep(0.0, 0.35, h2.z)).add(mix(float(0), float(17000), pow(smoothstep(0.55, 1.0, h2.z), 2.0)));
  const tint = mix(vec3(1), blackbody(T), 0.75);
  return tint.mul(flux.mul(psf).mul(present)) as unknown as V3;
}

/** Point-star radiance toward frame direction d over a pixel of angular size pixelAngle. */
export function starRadiance(d: V3, pixelAngle: F): V3 {
  const sigma = max(pixelAngle.mul(0.7), 2e-6);
  const galactic = exp(abs(dot(d, vec3(...GALACTIC_POLE))).div(-0.15));
  const face = cubeFace(d);
  let sum: V3 = vec3(0) as unknown as V3;
  for (const L of LAYERS) sum = sum.add(layer(d, face, sigma, galactic, L)) as unknown as V3;
  return sum;
}
