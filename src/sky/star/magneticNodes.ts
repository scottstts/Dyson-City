/**
 * Shader side of the star's quiescent prominences (magnetic.ts): kinematic plasma, raymarched only
 * inside each prominence's bounds, summed as optically thin glow plus the absorption of its cool,
 * dense material.
 *
 * Every prominence has its own field-aligned coordinates, and its plasma is noise written in those
 * coordinates, so it always looks threaded along the field and moves along it: a thick, lacy body
 * of gas around one arched field line of a buried dipole (r = L·sin²θ), a domain-warped, churning
 * envelope, fibres along the field wound round its axis and draining down its legs, voids and knots.
 *
 * Steps are jittered per pixel and frame (temporal AA integrates them) and every pattern fades to
 * its mean below the pixel footprint. Units: star radii, seconds; radiance relative to the disc
 * mean (× STAR_DISC_MEAN_RADIANCE at the end).
 */
import { float, vec3, vec4, If, abs, atan, dot, length, max, min, normalize, sqrt, smoothstep, exp, cross, pow, select, sin, mix } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { vNoise4 } from '../../render/tsl/volumeNoise';
import { loop } from '../../render/tsl/helpers';
import { STAR_DISC_MEAN_RADIANCE } from '../../world/radiometry';
import { KM, ROPE_SLOTS, type MagneticState } from './magnetic';
import { plasmaColour } from './plasmaColour';
import type { StarState } from './starState';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

const ROPE_STEPS = 16;
/** Drainage down a prominence's legs (star radii/s). */
const DRAIN = 150 * KM;
/** Opacity of cool prominence material (per star radius at unit density). */
const ROPE_KAPPA = 60;

/** Thin bright ridges where a noise channel crosses ½. */
function ridges(n: F, p: number): F {
  return pow(float(1).sub(abs(n.mul(2).sub(1))), p) as unknown as F;
}

const safe = (v: F) => select(abs(v).lessThan(1e-6), select(v.lessThan(0.0), float(-1e-6), float(1e-6)), v) as unknown as F;

interface Frame {
  /** Ray origin and direction in local coordinates (x along the axis, y up, z across). */
  ol: V3;
  dl: V3;
}

function localFrame(o: V3, dir: V3, c: V3, e1: V3): Frame {
  const e3 = normalize(cross(e1, c));
  const rel = o.sub(c);
  return {
    ol: vec3(dot(rel, e1), dot(rel, c), dot(rel, e3)) as unknown as V3,
    dl: vec3(dot(dir, e1), dot(dir, c), dot(dir, e3)) as unknown as V3,
  };
}

/** The ray's interval [t0, t1] inside the local box [lo, hi], clipped to [0, tMax]. */
function boxInterval(f: Frame, lo: V3, hi: V3, tMax: F): { t0: F; t1: F } {
  const inv = vec3(float(1).div(safe(f.dl.x)), float(1).div(safe(f.dl.y)), float(1).div(safe(f.dl.z)));
  const ta = lo.sub(f.ol).mul(inv);
  const tb = hi.sub(f.ol).mul(inv);
  const tn = min(ta, tb);
  const tf = max(ta, tb);
  return {
    t0: max(max(tn.x, tn.y), max(tn.z, 0.0)) as unknown as F,
    t1: min(min(tf.x, tf.y), min(tf.z, tMax)) as unknown as F,
  };
}

/**
 * Emission (rgb, scene radiance) and optical depth (a) of the prominences along a view ray `d`
 * (observer frame) up to tEnd (shell units). `jitter` ∈ [0, 1) per pixel and frame.
 */
export function magneticPlasma(star: StarState, mag: MagneticState, d: V3, tEnd: F, pixelAngle: F, starRadius: number, jitter: F): Node<'vec4'> {
  const out = vec3(0).toVar();
  const tau = float(0).toVar();
  const toC = vec3(0, 1, 0);
  const b = length(toC.sub(d.mul(dot(d, toC)))).div(starRadius);
  // Only rays passing within ~0.45 star radii of the limb can meet a prominence.
  If(b.greaterThan(0.75).and(b.lessThan(1.5)), () => {
    const time = star.time as unknown as F;
    const R = star.rotation;
    const o = R.mul(vec3(0, -1, 0)).div(starRadius).toVar();
    const dir = R.mul(d).toVar();
    const tMax = tEnd.div(starRadius).toVar();

    loop('ropeK', ROPE_SLOTS, (k) => {
      const v0 = mag.ropes.at(k.mul(3)).toVar();
      const v1 = mag.ropes.at(k.mul(3).add(1)).toVar();
      const v2 = mag.ropes.at(k.mul(3).add(2)).toVar();
      const B = v2.y;
      If(B.greaterThan(0.0), () => {
        const f = localFrame(o, dir, v0.xyz, v1.xyz);
        const D = v0.w;
        const La = v1.w;
        const w = v2.x;
        const seed = v2.z;
        const top = La.sub(D);
        const xr = La.mul(0.42).add(w.mul(2));
        const box = boxInterval(f, vec3(xr.negate(), -0.004, w.mul(2).negate()), vec3(xr, top.add(w.mul(2)), w.mul(2)), tMax);
        If(box.t1.greaterThan(box.t0), () => {
          const dt = box.t1.sub(box.t0).div(ROPE_STEPS).toVar();
          const acc = vec3(0).toVar();
          const depth = float(0).toVar();
          loop('ropeS', ROPE_STEPS, (j) => {
            const t = box.t0.add(j.toFloat().add(jitter).mul(dt));
            const P = f.ol.add(f.dl.mul(t));
            const Y = P.y.add(D);
            const r = sqrt(P.x.mul(P.x).add(Y.mul(Y)));
            const theta = atan(Y, P.x);
            const sn = sin(theta);
            const u = r.sub(La.mul(sn).mul(sn));
            const vz = P.z;
            const d0 = sqrt(u.mul(u).add(vz.mul(vz)));
            If(d0.lessThan(w.mul(1.9)).and(P.y.greaterThan(-0.002)), () => {
              // A thick, lacy body of gas, not a tube: its envelope is domain-warped and churns.
              const warp = vNoise4(vec3(theta.mul(3.0), u.div(w).mul(0.8), vz.div(w).mul(0.8).add(seed).add(time.div(110.0)))).xyz.sub(0.5);
              const uw = u.add(warp.x.mul(w).mul(0.7));
              const vw = vz.add(warp.y.mul(w).mul(0.7));
              const th = theta.add(warp.z.mul(0.12));
              const dn = sqrt(uw.mul(uw).add(vw.mul(vw))).div(w);
              const body = smoothstep(1.05, 0.3, dn);
              // Fibres along the field, wound round the axis and draining down both legs: noise
              // long along θ, fine across the rope.
              const ang = th.mul(2.5);
              const cu = uw.mul(sin(ang.add(Math.PI / 2))).sub(vw.mul(sin(ang))).div(w);
              const cv = uw.mul(sin(ang)).add(vw.mul(sin(ang.add(Math.PI / 2)))).div(w);
              const drain = time.mul(DRAIN).div(La).mul(select(th.lessThan(Math.PI / 2), float(-1), float(1)));
              const fib = vNoise4(vec3(cu.mul(6.0), cv.mul(6.0), th.mul(1.4).add(drain).add(seed)));
              const vis = float(1).sub(smoothstep(0.03, 0.12, pixelAngle.mul(t).div(w)));
              const fibres = mix(float(0.4), ridges(fib.x, 3).mul(1.4).add(ridges(fib.y, 6).mul(0.6)), vis);
              // Voids and knots: the body is lace, not a solid.
              const lace = vNoise4(vec3(cu.mul(2.0), cv.mul(2.0), th.mul(5.0).add(time.div(140.0)).add(seed.add(13.0))));
              const voids = smoothstep(0.28, 0.6, lace.x);
              const knots = smoothstep(0.55, 0.85, lace.y).mul(1.6).add(0.6);
              const legs = exp(P.y.div(-0.02)).mul(0.8).add(1);
              const dens = body.mul(fibres.add(0.1)).mul(voids).mul(knots).mul(legs);
              // Cool, dense plasma: it glows orange-gold and absorbs.
              acc.addAssign(plasmaColour(dens).mul(dens));
              depth.addAssign(dens);
            });
          });
          out.addAssign(acc.mul(dt.div(w)).mul(B).mul(4.0));
          tau.addAssign(depth.mul(dt).mul(ROPE_KAPPA));
        });
      });
    });
  });
  return vec4(out.mul(STAR_DISC_MEAN_RADIANCE[1]), tau) as unknown as Node<'vec4'>;
}
