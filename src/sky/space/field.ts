/**
 * The diffuse sky beyond the shell (the Milky Way, its dust, the nebulae of the catalogue) as a
 * radiance field over frame directions. Evaluated once at boot into a cube texture (bake.ts); the
 * point stars are drawn analytically per pixel (stars.ts).
 *
 * The palette is the natural one of deep-sky photographs: ionised hydrogen (Hα with some Hβ) as
 * red-pink, doubly ionised oxygen as teal in the hot cores of emission regions and the filaments of
 * remnants, blue dust-scattered starlight in reflection nebulae, warm unresolved starlight in the
 * galaxy, and dust that dims and reddens what lies behind it.
 */
import { Fn, float, vec2, vec3, dot, abs, exp, max, smoothstep, mix, length, pow, clamp, If, acos, sqrt } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { fbm3 } from '../../render/tsl/noise';
import { GALACTIC_CENTRE, GALACTIC_POLE, NEBULAE, NEBULA_KIND, type Nebula } from './catalogue';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

const HYDROGEN = vec3(1.0, 0.16, 0.27);
const OXYGEN = vec3(0.16, 0.78, 0.86);
const SCATTERED = vec3(0.3, 0.5, 1.0);
const STARLIGHT = vec3(1.0, 0.9, 0.78);
const BULGE = vec3(1.0, 0.8, 0.57);
/** Dust extinction per channel relative to green: dust reddens what it dims. */
const EXTINCTION = vec3(0.72, 1.0, 1.4);

/** The Milky Way's surface brightness in the plane, away from the bulge (scene radiance). */
const GALAXY_BRIGHTNESS = 0.08;

/** Ridged fBm: thin bright crests where the noise crosses its mean (filaments, wisps). */
function ridged(p: V3, octaves: number, fp: F, sharp: number): F {
  return pow(float(1).sub(abs(fbm3(p, octaves, fp).mul(2).sub(1))), sharp);
}

interface Layer {
  /** Light emitted or scattered by the nebula (scene radiance). */
  light: V3;
  /** Optical depth (green) of its dust in front of what lies behind it. */
  tau: F;
}

/**
 * One nebula at direction p (frame coordinates). `uv` is gnomonic, 1 at the bounding radius;
 * `P` the noise domain, one unit per radius.
 */
function nebulaLayer(n: Nebula, p: V3, texel: number): Layer {
  const c = vec3(...n.centre);
  const cosd = dot(p, c).max(1e-3);
  const uv = vec2(dot(p, vec3(...n.e1)), dot(p, vec3(...n.e2))).div(cosd.mul(Math.tan(n.radius)));
  const rr = length(uv);
  const fp = float(texel / n.radius);
  const P = p.div(n.radius).add(vec3(n.seed * 1.7, n.seed * 2.3, n.seed * 0.9));
  // A gentle warp only: strong domain warping marbles clouds into swirls.
  const warp = vec3(fbm3(P.mul(1.1), 4, fp.mul(1.1)), fbm3(P.mul(1.1).add(5.2), 4, fp.mul(1.1)), fbm3(P.mul(1.1).add(9.7), 4, fp.mul(1.1))).sub(0.5);
  const Q = P.add(warp.mul(0.55));
  // Extent: large-scale cloud complexes that thin out toward the bounding cap, never a disc.
  const complex = fbm3(P.mul(0.9).add(3.0), 5, fp.mul(0.9));
  const env = smoothstep(0.15, 0.75, complex.add(float(1).sub(rr.mul(rr)).mul(0.55)).sub(0.35)).mul(smoothstep(1.0, 0.55, rr));
  const b = n.brightness;
  switch (n.kind) {
    case NEBULA_KIND.emission: {
      const body = fbm3(Q.mul(2.2), 7, fp.mul(2.2));
      const dens = pow(clamp(body.sub(0.34).mul(2.2), 0, 1), 1.7).mul(env);
      const wisps = ridged(Q.mul(4.0).add(2.0), 5, fp.mul(4.0), 9).mul(env).mul(smoothstep(0.3, 0.6, body));
      const core = smoothstep(0.6, 0.0, rr.add(body.sub(0.5).mul(0.6)));
      // Dark pillars and globules inside, with bright ionisation fronts on their faces.
      const dd = fbm3(Q.mul(2.6).add(7.0), 5, fp.mul(2.6));
      const dust = smoothstep(0.58, 0.76, dd).mul(env).mul(2.2);
      const front = smoothstep(0.5, 0.58, dd).mul(smoothstep(0.66, 0.58, dd)).mul(env).mul(0.8);
      const ha = dens.add(wisps.mul(0.45)).add(env.mul(env).mul(0.08)).add(front.mul(dens.add(0.2)));
      const oiii = dens.mul(0.8).add(wisps.mul(0.3)).mul(core);
      const light = HYDROGEN.mul(ha).add(OXYGEN.mul(oiii).mul(0.9)).mul(b).mul(exp(EXTINCTION.mul(dust).negate()));
      return { light: light as unknown as V3, tau: dust.mul(0.6).add(dens.mul(0.25)) };
    }
    case NEBULA_KIND.reflection: {
      // Streaky dust lit by embedded hot stars: brightest toward them, brown lanes across it.
      const S = vec3(dot(p, vec3(...n.e1)).mul(0.45), dot(p, vec3(...n.e2)).mul(2.2), dot(p, c)).div(n.radius).add(n.seed);
      const dens = pow(clamp(fbm3(S.add(warp.mul(0.8)).mul(2.0), 6, fp.mul(2.0)).sub(0.36).mul(2.4), 0, 1), 1.3).mul(env);
      const lit = exp(rr.mul(rr).div(-0.25)).mul(0.75).add(0.25);
      const lanes = smoothstep(0.55, 0.75, fbm3(Q.mul(3.0).add(4.0), 5, fp.mul(3.0))).mul(env).mul(1.4);
      const light = SCATTERED.mul(dens).mul(lit).mul(b).mul(exp(EXTINCTION.mul(lanes).negate()));
      return { light: light as unknown as V3, tau: lanes.add(dens.mul(0.5)) };
    }
    case NEBULA_KIND.dark: {
      const dens = pow(clamp(fbm3(Q.mul(2.0), 6, fp.mul(2.0)).sub(0.4).mul(3.0), 0, 1), 1.2).mul(env);
      // A faint brown glow: the cloud scatters a little galactic light.
      return { light: vec3(0.5, 0.36, 0.24).mul(dens).mul(0.004) as unknown as V3, tau: dens.mul(b) };
    }
    case NEBULA_KIND.remnant: {
      // A blast shell seen in projection: tangled filaments along a warped rim, oxygen on one side,
      // hydrogen on the other.
      const shellR = fbm3(P.mul(1.2), 4, fp.mul(1.2)).sub(0.5).mul(0.5).add(0.72);
      const thick = fbm3(P.mul(2.1).add(4.0), 3, fp.mul(2.1)).mul(0.1).add(0.02);
      const shell = exp(abs(rr.sub(shellR)).div(thick).negate());
      const fil = ridged(Q.mul(6.0), 5, fp.mul(6.0), 6);
      // Broken into arcs: the blast ploughs into uneven gas.
      const arcs = smoothstep(0.35, 0.62, fbm3(P.mul(0.8).add(8.0), 4, fp.mul(0.8)));
      const lum = shell.mul(fil.mul(1.6).add(0.15)).mul(arcs).mul(smoothstep(1.0, 0.85, rr));
      const side = smoothstep(-0.35, 0.35, uv.x.add(fbm3(P.mul(2.0), 3, fp.mul(2.0)).sub(0.5)));
      return { light: mix(OXYGEN, HYDROGEN, side).mul(lum).mul(b) as unknown as V3, tau: float(0) };
    }
    default: {
      // A large spiral galaxy, steeply inclined: bulge, exponential disc, dust lanes on its near side,
      // pink star-forming knots along its arms.
      const x = uv.x;
      const y = uv.y.div(0.3);
      const ell = length(vec2(x, y));
      const edge = smoothstep(1.0, 0.8, ell);
      const disc = exp(ell.div(-0.2)).mul(edge);
      const bulge = exp(pow(ell.div(0.05), 0.7).negate());
      const ring = fbm3(P.mul(3.0), 4, fp.mul(3.0)).sub(0.5).mul(0.08);
      const lanes = exp(abs(ell.sub(0.42).add(ring)).div(-0.025)).add(exp(abs(ell.sub(0.62).add(ring)).div(-0.03)).mul(0.7));
      const near = smoothstep(-0.05, 0.25, y);
      const tau = lanes.mul(near).mul(1.1).mul(edge);
      const knots = smoothstep(0.72, 0.88, fbm3(P.mul(14.0), 4, fp.mul(14.0))).mul(smoothstep(0.25, 0.4, ell)).mul(edge);
      const light = BULGE.mul(bulge).add(vec3(0.85, 0.88, 1.0).mul(disc).mul(0.45)).add(HYDROGEN.mul(knots).mul(disc).mul(0.6)).mul(b).mul(exp(EXTINCTION.mul(tau).negate()));
      return { light: light as unknown as V3, tau: tau.mul(0.5) };
    }
  }
}

/** The Milky Way: unresolved starlight in clumped star clouds, the bulge, dust lanes, hydrogen knots. */
function milkyWay(p: V3, texel: number): { light: V3; tau: F } {
  const G = vec3(...GALACTIC_POLE);
  const C = vec3(...GALACTIC_CENTRE);
  const b = dot(p, G);
  const fromCentre = acos(dot(p, C).clamp(-1, 1));
  // Across the plane: a thin disc over a thicker one; along it, brighter toward the centre.
  const disc = exp(abs(b).div(-0.07)).mul(0.75).add(exp(abs(b).div(-0.22)).mul(0.25));
  const along = exp(fromCentre.mul(fromCentre).div(-2 * 1.3 * 1.3)).mul(0.6).add(0.4);
  const fp = float(texel);
  const clouds = fbm3(p.mul(7.0).add(3.0), 6, fp.mul(7.0));
  const grain = fbm3(p.mul(150.0), 3, fp.mul(150.0));
  const starClouds = pow(clouds.mul(1.6), 2.2).mul(grain.mul(0.5).add(0.75));
  // The bulge: an ellipse about the centre, flattened toward the plane.
  const lat = b;
  const lon = sqrt(max(fromCentre.mul(fromCentre).sub(lat.mul(lat)), 0.0));
  const bulge = exp(lon.mul(lon).div(-2 * 0.2 * 0.2).add(lat.mul(lat).div(-2 * 0.12 * 0.12)));
  const light = STARLIGHT.mul(disc.mul(along).mul(starClouds.mul(1.2).add(0.3))).add(BULGE.mul(bulge).mul(1.6));
  // Dust: a wavy lane down the plane, filamentary, and patchy clouds in the thin disc.
  const laneB = b.sub(fbm3(p.mul(2.5).add(11.0), 3, fp.mul(2.5)).sub(0.5).mul(0.06));
  const lane = exp(abs(laneB).div(-0.025));
  const filaments = smoothstep(0.32, 0.72, ridged(p.mul(9.0).add(vec3(clouds.mul(1.5))), 5, fp.mul(9.0), 2));
  const patches = smoothstep(0.5, 0.75, fbm3(p.mul(5.0).add(23.0), 5, fp.mul(5.0))).mul(exp(abs(b).div(-0.05)));
  const tau = lane.mul(filaments).mul(2.4).add(patches.mul(1.2));
  // Hydrogen knots strung along the plane.
  const knots = smoothstep(0.7, 0.88, fbm3(p.mul(18.0).add(9.0), 4, fp.mul(18.0))).mul(exp(abs(b).div(-0.05)));
  const total = light.mul(GALAXY_BRIGHTNESS).add(HYDROGEN.mul(knots).mul(0.05));
  return { light: total as unknown as V3, tau };
}

/** Diffuse sky radiance toward frame direction p (unit); `texel` is the bake's texel angle. */
export function spaceField(texel: number): (p: V3) => V3 {
  return Fn(([p]: [V3]) => {
    const front = float(0).toVar();
    const lights = vec3(0).toVar();
    const behind = float(0).toVar();
    for (const n of NEBULAE) {
      If(dot(p, vec3(...n.centre)).greaterThan(Math.cos(n.radius * 1.05)), () => {
        const l = nebulaLayer(n, p, texel);
        if (n.kind === NEBULA_KIND.dark) {
          front.addAssign(l.tau);
          lights.addAssign(l.light);
        } else {
          lights.addAssign(l.light);
          behind.addAssign(l.tau);
        }
      });
    }
    const mw = milkyWay(p, texel);
    // Dark clouds dim everything; each nebula's own dust dims the galaxy behind it.
    const galaxy = mw.light.mul(exp(EXTINCTION.mul(mw.tau.add(behind)).negate()));
    return galaxy.add(lights).mul(exp(EXTINCTION.mul(front).negate()));
  }) as unknown as (p: V3) => V3;
}
