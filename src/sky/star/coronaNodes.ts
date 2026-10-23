/**
 * Shader side of the star's diffuse atmosphere (corona.ts): the corona's column from the 1D table,
 * shaped by its structure, and the chromosphere's spicule fringe at the limb.
 *
 * Coronal structures follow the field, which is nearly radial, so in the sky they are rays
 * streaming out from the limb: they are keyed on position angle around the star (the direction of
 * the sight line's closest point, projected onto the plane of the sky), turned into the star's frame
 * so they turn with it. Keying them on the closest point's full 3D direction instead smears them
 * into smoke: that point swings toward the observer as the line moves away from the limb.
 *  - Fine rays everywhere (~1°), streamers that narrow with height over the activity belts, polar
 *    plumes inside dimmer coronal holes, and slow outflowing density blobs in the streamers
 *    (~300 km/s).
 */
import { float, vec3, vec2, abs, dot, length, max, min, normalize, smoothstep, sqrt, texture, exp, mix, select, pow } from 'three/tsl';
import type { DataTexture, Node } from 'three/webgpu';
import { vNoise4 } from '../../render/tsl/volumeNoise';
import { STAR_DISC_MEAN_RADIANCE } from '../../world/radiometry';
import { CHROMOSPHERE, CORONA_SAMPLES, OBSERVER_RADIUS } from './corona';
import { plasmaColour } from './plasmaColour';
import type { StarState } from './starState';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

/** Coronal colour: scattered photosphere light (the disc mean's chromaticity). */
const DISC_MEAN = vec3(...STAR_DISC_MEAN_RADIANCE);
/** Spicules rise at ~250 km/s (the energetic star's; star radii per second). */
const SPICULE_SPEED = 250 / 696_000;
/** Outflow speed in the streamers (star radii per second): ~300 km/s. */
const OUTFLOW = 300 / 696_000;

/** Same mapping as corona.ts coronaTableU, in TSL. */
function tableU(b: F): F {
  const x = b.sub(1);
  const side = select(x.lessThan(0.0), float(1), float(OBSERVER_RADIUS - 1));
  const s = sqrt(min(abs(x).div(side), 1.0)).mul(select(x.lessThan(0.0), float(-1), float(1)));
  const u = s.mul(0.5).add(0.5);
  return u.mul((CORONA_SAMPLES - 1) / CORONA_SAMPLES).add(0.5 / CORONA_SAMPLES) as unknown as F;
}

/**
 * The diffuse atmosphere's radiance along a view ray `d` (observer frame), in front of the
 * photosphere or the shell. `pixelAngle`: angular pixel size (radians).
 */
export function coronaEmission(star: StarState, table: DataTexture, d: V3, pixelAngle: F): V3 {
  // The observer is at (0, −ro, 0) from the star centre (star radii); the plane of the sky is across y.
  return coronaAlong(star, table, vec3(0, -OBSERVER_RADIUS, 0) as unknown as V3, d, vec3(0, 1, 0) as unknown as V3, pixelAngle);
}

/**
 * The same along a ray from anywhere `o` (star radii, relative to the star centre, observer-frame
 * axes) whose line crosses the cavity shell to shell (or down to the photosphere): the intro's view
 * from outside the sphere, through an opening. `axis` is the eye–star axis; the plane of the sky
 * is across it.
 */
export function coronaAlong(star: StarState, table: DataTexture, o: V3, d: V3, axis: V3, pixelAngle: F): V3 {
  const time = star.time as unknown as F;
  const tc = dot(o, d).negate();
  const P = o.add(d.mul(tc));
  const b = length(P).toVar();
  const onDisc = b.lessThan(1.0);
  // On the disc the structure is sampled where the line meets the photosphere.
  const tHit = tc.sub(sqrt(max(float(1).sub(b.mul(b)), 0.0)));
  const surf = o.add(d.mul(tHit));
  // Position angle: the closest point (on the disc, the photosphere hit) projected onto the plane
  // of the sky.
  const near = select(onDisc, surf, P);
  const X = star.rotation.mul(normalize(near.sub(axis.mul(dot(near, axis))))).toVar();
  const h = max(b.sub(1.0), 0.0).toVar();
  // Pixel size at the tangent point, in star radii.
  const pix = pixelAngle.mul(max(tc, 0.3));

  const column = texture(table, vec2(tableU(b), 0.5)).r;

  // --- Corona structure -------------------------------------------------------------------------
  const nA = vNoise4(X.mul(2.6)).toVar();
  const nB = vNoise4(X.mul(9.0).add(vec3(3.1, 7.7, 1.3))).toVar();
  // Streamers narrow with height (helmets): the threshold rises above the base.
  const streamerField = nA.x.mul(0.7).add(nB.y.mul(0.3));
  const streamers = smoothstep(h.mul(0.35).add(0.48), h.mul(0.25).add(0.68), streamerField);
  // Outflowing blobs along the streamers.
  const blobs = vNoise4(vec3(X.xy.mul(14.0), h.div(0.05).sub(time.mul(OUTFLOW / 0.05)))).z;
  const streamerTerm = streamers.mul(blobs.mul(0.6).add(0.7));
  // Fine radial rays (~1°): direction-only, so they are radial.
  // Gentle (±~20 %): the corona is a glow with rays in it, not a fringe of streaks.
  const rays = vNoise4(X.mul(55.0)).w.mul(0.3).add(vNoise4(X.mul(140.0)).x.mul(0.15)).add(0.77);
  const rayFade = float(1).sub(smoothstep(0.004, 0.012, pix));
  const rayTerm = mix(float(1.0), rays, rayFade);
  // Coronal holes at the poles of the star's frame, threaded by plumes.
  const polar = smoothstep(0.62, 0.85, abs(X.z));
  const plumes = pow(vNoise4(X.mul(80.0).add(vec3(5.0))).y, 3.0).mul(3.0);
  const hole = mix(float(1), plumes.mul(0.6).add(0.25), polar);
  // Near the base the corona is more uniform; structure grows with height.
  const lift = smoothstep(0.0, 0.08, h);
  const structure = mix(float(0.9), float(0.35).add(streamerTerm.mul(1.8)).mul(rayTerm).mul(hole), lift.mul(0.75).add(0.25));
  const corona = DISC_MEAN.mul(column.mul(structure));

  // --- Chromosphere: a burning fringe -----------------------------------------------------------
  // The limb seen edge-on through the chromosphere: a bright base layer and, above it, tongues of
  // spicules licking up — a fire shader in (position angle, height): noise advected upward at the
  // spicules' speed, domain-warped sideways, and thresholded by height so the tongues thin out and
  // die as they rise. Hot at the base (gold to white-gold), cooling to orange at the tips.
  const H = CHROMOSPHERE.scaleHeight;
  const Hf = CHROMOSPHERE.flameHeight;
  const rise = time.mul(SPICULE_SPEED / Hf * 0.5);
  // Tongues cluster: in places they reach several times higher than elsewhere.
  const reach = vNoise4(X.mul(45.0).add(vec3(7.0, 2.0, time.mul(8e-3)))).y;
  const hn = h.div(mix(float(0.35), float(1.8), pow(reach, 1.5)).mul(Hf));
  const warp = vNoise4(vec3(X.xy.mul(160.0), hn.mul(0.6).sub(rise.mul(0.5)))).xyz.sub(0.5);
  const Xw = X.add(warp.mul(1.4 / 380));
  const flame = vNoise4(vec3(Xw.xy.mul(380.0).add(Xw.z.mul(170.0)), hn.mul(0.9).sub(rise))).toVar();
  const spFade = float(1).sub(smoothstep(0.0015, 0.005, pix));
  const tongueField = mix(float(0.5), flame.x.mul(0.75).add(flame.y.mul(0.25)), spFade);
  const tongues = smoothstep(hn.mul(0.5).add(0.1), hn.mul(0.5).add(0.55), tongueField).mul(exp(hn.mul(-0.9)));
  const base = exp(h.div(-H));
  const offLimb = base.mul(1.3).add(tongues.mul(0.9));
  // On the disc: the layer seen obliquely, edge-on only in the last few hundred km of the limb.
  const mu = sqrt(max(float(1).sub(b.mul(b)), 0.0));
  const onLimb = min(float(Math.sqrt(H / (2 * Math.PI))).div(max(mu, 1e-3)), 1.0).mul(0.6);
  const ci = select(onDisc, onLimb, offLimb);
  const chromo = plasmaColour(ci.mul(1.4)).mul(ci.mul(CHROMOSPHERE.radiance * STAR_DISC_MEAN_RADIANCE[1]));

  return corona.add(chromo) as unknown as V3;
}
