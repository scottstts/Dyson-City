/**
 * Shader side of the prominences (prominences.ts). Each prominence lives in the vertical plane
 * through the star's centre that contains its footprint, so a view ray meets it once: the hit's
 * position along the footprint and height above the surface index a 2D emission field.
 *
 *  - Hedgerow sheets: a ragged arched envelope filled with near-vertical threads (~2,000 km), the
 *    threads streaming slowly downward.
 *  - Loop arcades: nested arches of threads, the plasma draining along them.
 *
 * Emission is optically thin, so it grows with the path through the sheet (capped where the sheet
 * is seen edge-on). Footprint-filtered: unresolved threads fade to their mean.
 */
import { float, vec3, If, abs, atan, dot, length, max, min, normalize, sqrt, smoothstep, exp, cross, pow, select } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { valueNoise3 } from '../../render/tsl/noise';
import { loop } from '../../render/tsl/helpers';
import { STAR_DISC_MEAN_RADIANCE } from '../../world/radiometry';
import { ERUPTION_ACCELERATION, ERUPTION_DURATION, PROMINENCE_SLOTS, type ProminenceState } from './prominences';
import type { StarState } from './starState';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

/** Peak emission relative to the star's disc mean, and its colour (Hα, Hβ and He D3 lines). */
const PROMINENCE_RADIANCE = 0.12;
const PROMINENCE_CHROMA = [1.0, 0.34, 0.4] as const;
/** Thread streaming speed (star radii per second): ~20 km/s. */
const FLOW = 20 / 696_000;

/**
 * Emission of the prominences along a ray (shell units, observer frame: observer at the origin,
 * star centre at (0, 1, 0)) up to distance tEnd. `pixelAngle` is the angular pixel size.
 */
export function prominenceEmission(star: StarState, prom: ProminenceState, d: V3, tEnd: F, pixelAngle: F, starRadius: number): V3 {
  const out = vec3(0).toVar();
  // Only rays that pass within ~0.45 star radii of the limb can meet a prominence.
  const toC = vec3(0, 1, 0);
  const tc = dot(d, toC);
  const b = length(toC.sub(d.mul(tc))).div(starRadius);
  If(b.greaterThan(0.8).and(b.lessThan(1.45)), () => {
    const time = star.time as unknown as F;
    const R = star.rotation;
    // Ray in the star frame, in star radii: origin O − C = (0, −1, 0).
    const o = R.mul(vec3(0, -1, 0)).div(starRadius).toVar();
    const dir = R.mul(d).toVar();
    const tMax = tEnd.div(starRadius);
    loop('pk', PROMINENCE_SLOTS, (k) => {
      const s0 = prom.slots.at(k.mul(3)).toVar();
      const s1 = prom.slots.at(k.mul(3).add(1)).toVar();
      const s2 = prom.slots.at(k.mul(3).add(2)).toVar();
      If(s2.w.greaterThan(0.5), () => {
        const c = s0.xyz;
        const axis = s1.xyz;
        const n = normalize(cross(c, axis));
        const dn = dot(dir, n);
        const t = dot(o, n).negate().div(select(abs(dn).lessThan(1e-5), float(1e-5), dn));
        If(t.greaterThan(0.0).and(t.lessThan(tMax)), () => {
          const P = o.add(dir.mul(t));
          const r = length(P);
          const Pn = P.div(r);
          // Position along the footprint (−1..1) and height above the photosphere (star radii).
          const u = atan(dot(Pn, axis), dot(Pn, c)).div(s0.w);
          const age = s2.z;
          const erupting = age.greaterThanEqual(0.0);
          const lift = select(erupting, age.mul(age).mul(ERUPTION_ACCELERATION * 0.5), float(0));
          const swell = select(erupting, age.div(1200).add(1), float(1));
          const fadeOut = select(erupting, exp(age.div(ERUPTION_DURATION * 0.45).negate()), float(1));
          // Reforms over the first part of each cycle after an eruption.
          const h = r.sub(1).sub(lift);
          const H = s1.w.mul(swell);
          const seed = s2.x;
          // Pixel size at the hit, in star radii (t is in star radii).
          const sizeOfPixel = pixelAngle.mul(t);
          If(abs(u).lessThan(1.15).and(h.greaterThan(-0.002)).and(h.lessThan(H.mul(1.3))), () => {
            const hn = h.div(H);
            const thread = (scale: number, along: F, across: F) => valueNoise3(vec3(across.div(scale), along, seed));
            const resolvedThreads = float(1).sub(smoothstep(0.002, 0.008, sizeOfPixel));
            const density = float(0).toVar();
            If(s2.y.lessThan(0.5), () => {
              // Hedgerow: ragged arched top, near-vertical threads streaming down.
              const top = sqrt(max(float(1).sub(u.mul(u)), 0.0)).mul(valueNoise3(vec3(u.mul(4.0), seed, 1.0)).mul(0.45).add(0.55));
              const env = smoothstep(0.0, 0.12, top.sub(hn)).mul(smoothstep(-0.02, 0.06, hn)).mul(float(1).sub(smoothstep(0.85, 1.12, abs(u))));
              const across = u.mul(s0.w);
              const fine = thread(0.003, h.div(0.03).add(time.mul(FLOW / 0.03)), across);
              const coarse = thread(0.012, h.div(0.08).add(time.mul(FLOW / 0.08)), across);
              const t3 = pow(fine.mul(0.6).add(coarse.mul(0.4)), 2.2).mul(2.4);
              density.assign(env.mul(mixF(float(0.55), t3, resolvedThreads)).mul(hn.mul(-0.4).add(1)));
            }).Else(() => {
              // Loop arcade: nested arches; threads run along the loops and drain down both legs.
              const rho = sqrt(u.mul(u).add(hn.mul(hn).mul(0.9)));
              const along = atan(hn, u);
              const band = smoothstep(0.35, 0.55, rho).mul(float(1).sub(smoothstep(0.85, 1.05, rho))).mul(smoothstep(-0.02, 0.04, hn));
              const fine = thread(0.004, along.mul(3.0).add(time.mul(FLOW / 0.02)), rho.mul(s0.w));
              // Threads are broken into knots and gaps along the loops; the apex drains first.
              const breaks = smoothstep(0.35, 0.75, valueNoise3(vec3(along.mul(7.0).add(time.mul(FLOW / 0.01)), rho.mul(9.0), seed.add(3.0))));
              const legs = float(1).sub(smoothstep(0.55, 1.0, hn.div(max(rho, 0.05))).mul(0.6));
              const t3 = pow(fine, 2.0).mul(2.6).mul(breaks);
              density.assign(band.mul(legs).mul(mixF(float(0.3), t3, resolvedThreads)).mul(0.8));
            });
            // Optically thin sheet: emission grows with the slant path, capped edge-on.
            const path = min(float(1).div(max(abs(dn), 0.05)), 4.0).mul(0.5);
            out.addAssign(vec3(...PROMINENCE_CHROMA).mul(density.mul(path).mul(fadeOut)));
          });
        });
      });
    });
  });
  return out.mul(STAR_DISC_MEAN_RADIANCE[1] * PROMINENCE_RADIANCE) as unknown as V3;
}

function mixF(a: F, b: F, t: F): F {
  return a.add(b.sub(a).mul(t)) as unknown as F;
}
