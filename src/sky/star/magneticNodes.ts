/**
 * Shader side of the star's prominences, eruptions and jets (magnetic.ts; the loops along the limb
 * are limbLoops.ts): kinematic plasma, raymarched only
 * inside each structure's bounds, summed as optically thin glow (plus the absorption of cool,
 * dense prominence material).
 *
 * Every structure has its own field-aligned coordinates, and its plasma is noise written in those
 * coordinates, so it always looks threaded along the field and moves along it:
 *
 *  - Rope (prominence): a thick, lacy body of gas around one arched field line of a buried dipole
 *    (r = L·sin²θ): a domain-warped, churning envelope, fibres along the field wound round its
 *    axis and draining down its legs, voids and knots. Erupting, its apex lifts (the feet stay
 *    anchored), it swells and unwinds, and a gauzy CME front runs ahead.
 *  - Jet: a column of ballistic parcels launched up open field. A point in the column is labelled
 *    by the launch time of the parcel there, and the noise is written in that label, so the gas is
 *    carried with the parcels; turbulence grows with parcel age, so the column widens, curls and
 *    breaks up like a flamethrower's, cooling from white-gold to deep orange, then falls back.
 *
 * Steps are jittered per pixel and frame (temporal AA integrates them) and every pattern fades to
 * its mean below the pixel footprint. Units: star radii, seconds; radiance relative to the disc
 * mean (× STAR_DISC_MEAN_RADIANCE at the end).
 */
import { float, vec3, vec4, If, abs, atan, dot, length, max, min, normalize, sqrt, smoothstep, exp, cross, pow, select, sin, mix, clamp } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { vNoise4 } from '../../render/tsl/volumeNoise';
import { loop } from '../../render/tsl/helpers';
import { STAR_DISC_MEAN_RADIANCE } from '../../world/radiometry';
import { CME_FRONT_LEAD, ERUPTION_ACCELERATION, ERUPTION_DURATION, JET_SLOTS, KM, ROPE_SLOTS, type MagneticState } from './magnetic';
import { plasmaColour } from './plasmaColour';
import type { StarState } from './starState';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

const ROPE_STEPS = 16;
const JET_STEPS = 14;
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
 * Emission (rgb, scene radiance) and optical depth (a) of the magnetic structures along a view ray
 * `d` (observer frame) up to tEnd (shell units). `jitter` ∈ [0, 1) per pixel and frame.
 */
export function magneticPlasma(star: StarState, mag: MagneticState, d: V3, tEnd: F, pixelAngle: F, starRadius: number, jitter: F): Node<'vec4'> {
  const out = vec3(0).toVar();
  const tau = float(0).toVar();
  const toC = vec3(0, 1, 0);
  const b = length(toC.sub(d.mul(dot(d, toC)))).div(starRadius);
  // Only rays passing within ~0.45 star radii of the limb can meet a structure.
  If(b.greaterThan(0.75).and(b.lessThan(1.5)), () => {
    const time = star.time as unknown as F;
    const R = star.rotation;
    const o = R.mul(vec3(0, -1, 0)).div(starRadius).toVar();
    const dir = R.mul(d).toVar();
    const tMax = tEnd.div(starRadius).toVar();

    // --- Prominences: twisted flux ropes, and their eruptions -------------------------------------
    loop('ropeK', ROPE_SLOTS, (k) => {
      const v0 = mag.ropes.slots.at(k.mul(4)).toVar();
      const v1 = mag.ropes.slots.at(k.mul(4).add(1)).toVar();
      const v2 = mag.ropes.slots.at(k.mul(4).add(2)).toVar();
      const v3 = mag.ropes.slots.at(k.mul(4).add(3)).toVar();
      const B = v2.y;
      If(B.greaterThan(0.0).and(v3.x.greaterThan(0.01)), () => {
        const f = localFrame(o, dir, v0.xyz, v1.xyz);
        const D = v0.w;
        const La = v1.w;
        const seed = v2.z;
        const age = v2.w;
        const erupting = age.greaterThanEqual(0.0);
        const lift = select(erupting, age.mul(age).mul(ERUPTION_ACCELERATION * 0.5), float(0)).toVar();
        const fade = select(erupting, exp(age.div(ERUPTION_DURATION * -0.45)), v3.x).toVar();
        const swell = lift.div(La).mul(1.2).add(1).toVar();
        const w = v2.x.mul(swell).toVar();
        const twist = select(erupting, float(1).sub(age.div(ERUPTION_DURATION)).mul(0.8).add(0.2), float(1));
        const top = La.sub(D).add(lift).mul(swell);
        const xr = La.mul(0.42).mul(swell).add(w.mul(2));
        const box = boxInterval(f, vec3(xr.negate(), -0.004, w.mul(2).negate()), vec3(xr, top.add(w.mul(2)), w.mul(2)), tMax);
        If(box.t1.greaterThan(box.t0), () => {
          const dt = box.t1.sub(box.t0).div(ROPE_STEPS).toVar();
          const acc = vec3(0).toVar();
          const depth = float(0).toVar();
          loop('ropeS', ROPE_STEPS, (j) => {
            const t = box.t0.add(j.toFloat().add(jitter).mul(dt));
            const P = f.ol.add(f.dl.mul(t));
            // The apex lifts and the whole rope swells; the feet stay anchored.
            const Y0 = P.y.add(D);
            const s0 = Y0.div(max(sqrt(P.x.mul(P.x).add(Y0.mul(Y0))), 1e-5));
            const x = P.x.div(swell);
            const Y = P.y.sub(lift.mul(s0.mul(s0))).div(swell).add(D);
            const r = sqrt(x.mul(x).add(Y.mul(Y)));
            const theta = atan(Y, x);
            const sn = sin(theta);
            const u = r.sub(La.mul(sn).mul(sn)).mul(swell);
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
              // Fibres along the field, wound round the axis (unwinding as it erupts) and draining
              // down both legs: noise long along θ, fine across the rope.
              const ang = th.mul(2.5).mul(twist);
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
              const dens = body.mul(fibres.add(0.1)).mul(voids).mul(knots).mul(legs).mul(fade);
              // Cool, dense plasma: it glows orange-gold and absorbs.
              acc.addAssign(plasmaColour(dens).mul(dens));
              depth.addAssign(dens);
            });
          });
          out.addAssign(acc.mul(dt.div(w)).mul(B).mul(4.0));
          tau.addAssign(depth.mul(dt).mul(ROPE_KAPPA));
        });

        // CME front: a thin, bright, filamentary shell expanding ahead of the erupting rope.
        If(erupting, () => {
          const Rf = La.add(lift.mul(CME_FRONT_LEAD)).mul(1.1).toVar();
          const cf = vec3(0, Rf.mul(0.5).sub(D), 0);
          const rel = f.ol.sub(cf);
          const tca = dot(rel, f.dl).negate();
          const p2 = dot(rel, rel).sub(tca.mul(tca));
          If(tca.greaterThan(0.0).and(tca.lessThan(tMax)).and(p2.lessThan(Rf.mul(Rf))), () => {
            const delta = Rf.mul(0.3);
            const ri = Rf.sub(delta);
            const col = sqrt(max(Rf.mul(Rf).sub(p2), 0.0)).sub(sqrt(max(ri.mul(ri).sub(p2), 0.0))).mul(2);
            const peak = sqrt(Rf.mul(Rf).sub(ri.mul(ri))).mul(2);
            // Height of the closest point above the curved photosphere (a cut on the local plane shows as
            // a straight edge across the disc).
            const yc = length(o.add(dir.mul(tca))).sub(1.0);
            const dirF = normalize(f.ol.add(f.dl.mul(tca)).sub(cf));
            // Gauzy: a thick shell broken into filaments, brightest along its leading edge.
            const fn = vNoise4(dirF.mul(9.0).add(vec3(seed, age.div(120.0), 0.0)));
            const fil = ridges(fn.x, 3).mul(1.3).add(ridges(fn.y, 5).mul(0.6)).mul(smoothstep(0.25, 0.6, fn.z));
            const strength = col.div(peak).mul(fil).mul(smoothstep(0.0, 0.08, yc)).mul(fade).mul(La.div(Rf)).mul(0.35);
            out.addAssign(vec3(1.0, 0.93, 0.82).mul(strength).mul(B));
          });
        });
      });
    });

    // --- Jets and surges ---------------------------------------------------------------------------
    loop('jetK', JET_SLOTS, (k) => {
      const v0 = mag.jets.slots.at(k.mul(4)).toVar();
      const v1 = mag.jets.slots.at(k.mul(4).add(1)).toVar();
      const v2 = mag.jets.slots.at(k.mul(4).add(2)).toVar();
      const v3 = mag.jets.slots.at(k.mul(4).add(3)).toVar();
      const B = v2.w;
      If(B.greaterThan(0.0), () => {
        const site = v0.xyz;
        const w0 = v0.w;
        const a = v1.xyz;
        const v = v1.w;
        const g = v2.x;
        const age = v2.y;
        const seed = v2.z;
        const spread = v3.x;
        // Parcels launched continuously for tOn seconds, each ballistic: the column runs from the
        // last parcel (bottom) to the first (top).
        const tOn = v.div(g).mul(0.45);
        const hAt = (tt: F) => max(v.mul(tt).sub(g.mul(0.5).mul(tt).mul(tt)), 0.0);
        const H = hAt(age).toVar();
        const Bt = hAt(max(age.sub(tOn), 0.0)).toVar();
        const hMax = v.mul(v).div(g.mul(2));
        // Bounds hold the widest gas: width up to 2× with age, plus its swirl (≤ 0.7 of the width).
        const wMax = w0.add(hMax.mul(spread)).mul(3.6);
        // Ray against the column's bounding cylinder, clipped to the column's length.
        const rel = o.sub(site);
        const ra = dot(rel, a);
        const da = dot(dir, a);
        const q0 = rel.sub(a.mul(ra));
        const qd = dir.sub(a.mul(da));
        const A2 = max(dot(qd, qd), 1e-8);
        const B2 = dot(q0, qd);
        const disc = B2.mul(B2).sub(A2.mul(dot(q0, q0).sub(wMax.mul(wMax))));
        If(disc.greaterThan(0.0).and(H.greaterThan(Bt)), () => {
          const sq = sqrt(disc);
          const tc0 = B2.negate().sub(sq).div(A2);
          const tc1 = B2.negate().add(sq).div(A2);
          const sLo = Bt.sub(wMax);
          const sHi = H.add(wMax);
          const tsa = sLo.sub(ra).div(safe(da));
          const tsb = sHi.sub(ra).div(safe(da));
          const t0 = max(max(tc0, min(tsa, tsb)), 0.0).toVar();
          const t1 = min(min(tc1, max(tsa, tsb)), tMax).toVar();
          If(t1.greaterThan(t0), () => {
            const dt = t1.sub(t0).div(JET_STEPS).toVar();
            const acc = vec3(0).toVar();
            const e1 = normalize(cross(a, vec3(0.0, 0.0, 1.0)));
            const e2 = cross(a, e1);
            loop('jetS', JET_STEPS, (j) => {
              const t = t0.add(j.toFloat().add(jitter).mul(dt));
              const P = rel.add(dir.mul(t));
              const s = dot(P, a);
              const qv = P.sub(a.mul(s));
              // Which parcel is here: the column is ordered by launch time, top first.
              const qn = clamp(s.sub(Bt).div(max(H.sub(Bt), 1e-5)), 0.0, 1.0);
              const tLaunch = min(age, tOn).mul(float(1).sub(qn));
              const pAge = age.sub(tLaunch);
              // Turbulence grows with the parcel's age: the column widens, curls and breaks up.
              const width = w0.add(max(s, 0.0).mul(spread)).mul(min(pAge.div(120.0).add(1), 2.0));
              const wob = vNoise4(vec3(tLaunch.div(20.0), seed, pAge.div(45.0)));
              const swirl = e1.mul(wob.x.sub(0.5)).add(e2.mul(wob.y.sub(0.5))).mul(width).mul(min(pAge.div(50.0), 1.4));
              const qs = qv.sub(swirl);
              const rr = length(qs).div(width);
              // Gas carried with the parcels: noise in launch time and in the cross-section.
              const ang = atan(dot(qs, e2), dot(qs, e1));
              const gas = vNoise4(vec3(tLaunch.div(5.0), sin(ang).mul(1.2).add(seed), rr.mul(1.8)));
              const breakup = smoothstep(pAge.div(260.0), pAge.div(260.0).add(0.45), gas.x.mul(0.7).add(gas.y.mul(0.3)));
              const body = smoothstep(1.0, 0.2, rr.add(gas.z.sub(0.5).mul(0.6)));
              // Streaks along the flow: long in launch time, fine across.
              const streak = ridges(vNoise4(vec3(tLaunch.div(18.0), sin(ang).mul(3.0).add(seed), rr.mul(3.5))).x, 4);
              const inside = smoothstep(Bt.sub(w0), Bt, s).mul(smoothstep(H.add(width.mul(0.5)), H.sub(width.mul(0.3)), s));
              const thin = w0.div(width).pow(1.2);
              // Hot at launch, cooling as each parcel ages; a flash at the footpoint at ignition.
              const heat = exp(pAge.div(-70.0)).mul(3.0).add(0.45);
              const flash = exp(age.div(-25.0)).mul(exp(max(s, 0.0).div(w0.mul(-2.0)))).mul(3.0);
              const i = body.mul(inside).mul(breakup.mul(streak.mul(1.2).add(0.4)).mul(thin).mul(heat).add(flash));
              acc.addAssign(plasmaColour(i).mul(i));
            });
            out.addAssign(acc.mul(dt.div(w0.mul(2.0))).mul(B).mul(2.5));
          });
        });
      });
    });
  });
  return vec4(out.mul(STAR_DISC_MEAN_RADIANCE[1]), tau) as unknown as Node<'vec4'>;
}
