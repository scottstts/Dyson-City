/**
 * The star's active layer: arcades of coronal loops rooted in the photosphere all over the star,
 * rising from the face of the disc and arching over the limb where they stand near it.
 *
 * The surface is divided into cells (latitude bands, longitudes per band scaled to keep the cells
 * square, ~0.1 rad ≈ 70,000 km); a few cells — more in the activity belts — hold an arcade of true
 * size (15,000–60,000 km across), with clear quiet surface between.
 *
 * Every loop is a real 3D field line — a buried dipole's line r = L·sin²θ, stretched in height,
 * sheared across the arcade and warped so no two are alike — drawn as a soft glowing tube: the
 * distance between the view ray and the curve (as strand and hair renderers do). So loops project
 * correctly from any angle: thin bright arcs over the disc seen from above, arches rising from just
 * inside the limb beside it. A view ray visits the cells along its path through the layer.
 *
 * The loops are gas, not wire: each strand is broken into knots and gaps that siphon along it at
 * ~200 km/s and flicker as heating comes and goes in tens of seconds; its width varies; a soft halo
 * of unresolved plasma surrounds it; its footpoints burn brightest. Now and then an arcade flares:
 * its footpoints flash and its loops run hot, inner loops first.
 *
 * Units: star radii, seconds; radiance relative to the disc mean (× STAR_DISC_MEAN_RADIANCE).
 */
import { float, vec2, vec3, If, atan, asin, cos, sin, dot, max, min, floor, exp, pow, sqrt, smoothstep, mix, select, cross, normalize, clamp, fract, length } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { vNoise4 } from '../../render/tsl/volumeNoise';
import { hash33 } from '../../render/tsl/noise';
import { loop } from '../../render/tsl/helpers';
import { STAR_DISC_MEAN_RADIANCE } from '../../world/radiometry';
import { plasmaColour } from './plasmaColour';
import type { StarState } from './starState';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

/** Cell size (radians of heliographic latitude) and the layer's height (star radii). */
const CELL = 0.1;
const LAYER = 0.11;
/**
 * Points along the ray at which the cell under it is looked up: at most half a cell apart over the
 * longest path through the layer (~0.8 star radii, grazing the limb). Sparser probes skip cells, and
 * the loops a ray misses that way are cut off along the cell walls. Repeats are skipped.
 */
const PROBES = 20;
/** Loops per arcade and straight segments per loop. */
const LOOPS = 7;
const SEGMENTS = 10;
/** Tube radius of a loop strand (star radii): ~1,100 km. */
const STRAND = 0.0016;
/** Siphon flow along loops (star radii/s): ~200 km/s on the energetic star. */
const SIPHON = 200 / 696_000;
const FLARE_PERIOD = 2700;
const FLARE_RISE = 60;
const FLARE_DECAY = 300;
/** Peak brightness of the brightest strands, relative to the disc mean. */
const LOOP_BRIGHTNESS = 2.0;

/** Cell (band, index) of a star-frame direction, and its centre direction. */
function cellOf(p: V3): { id: Node<'vec2'>; centre: V3 } {
  const lat = asin(clamp(p.z, -1.0, 1.0));
  const lon = atan(p.y, p.x);
  const band = floor(lat.div(CELL));
  const latc = band.add(0.5).mul(CELL);
  const count = max(floor(cos(latc).mul((2 * Math.PI) / CELL)), 1.0);
  const idx = floor(lon.div(2 * Math.PI).add(0.5).mul(count));
  const lonc = idx.add(0.5).div(count).sub(0.5).mul(2 * Math.PI);
  return {
    id: vec2(band, idx) as unknown as Node<'vec2'>,
    centre: vec3(cos(latc).mul(cos(lonc)), cos(latc).mul(sin(lonc)), sin(latc)) as unknown as V3,
  };
}

/**
 * Emission of the active layer along a view ray (star frame: origin `o` relative to the star
 * centre, unit `dir`; star radii) up to tMax.
 */
export function activeLayer(star: StarState, o: V3, dir: V3, tMax: F, pixelAngle: F): V3 {
  const out = vec3(0).toVar();
  const time = star.time as unknown as F;
  const ro = 1 + LAYER;
  const od = dot(o, dir);
  const b2 = dot(o, o).sub(od.mul(od));
  If(b2.lessThan(ro * ro), () => {
    const half = sqrt(float(ro * ro).sub(b2));
    const tIn = max(od.negate().sub(half), 0.0).toVar();
    // On the disc the ray ends at the photosphere; off it, where it leaves the layer.
    const tSurf = od.negate().sub(sqrt(max(float(1).sub(b2), 0.0)));
    const tOut = min(select(b2.lessThan(1.0), tSurf, od.negate().add(half)), tMax).toVar();
    If(tOut.greaterThan(tIn), () => {
      const prev = vec2(-1e5, -1e5).toVar();
      const span = tOut.sub(tIn).div(PROBES);
      loop('alP', PROBES, (pi) => {
        const tp = tIn.add(pi.toFloat().add(0.5).mul(span));
        const cell = cellOf(normalize(o.add(dir.mul(tp))));
        If(cell.id.x.notEqual(prev.x).or(cell.id.y.notEqual(prev.y)), () => {
          prev.assign(cell.id);
          const hc = hash33(vec3(cell.id, 17.0));
          const hd = hash33(vec3(cell.id, 29.0));
          // Arcades are sparse, more common in the activity belts.
          const lat = asin(clamp(cell.centre.z, -1.0, 1.0)).abs();
          const belt = smoothstep(0.12, 0.25, lat).mul(float(1).sub(smoothstep(0.55, 0.75, lat)));
          If(hc.x.lessThan(belt.mul(0.22).add(0.06)), () => {
            // Size (true scale: 15,000–60,000 km across), height stretch, orientation, offset.
            const a = float(CELL).mul(pow(hc.y, 1.8).mul(0.6).add(0.2)).toVar();
            const k = hc.z.mul(0.8).add(0.9);
            const psi = hd.x.mul(Math.PI);
            const east = normalize(cross(vec3(0.0, 0.0, 1.0), cell.centre));
            const north = cross(cell.centre, east);
            const e1 = east.mul(cos(psi)).add(north.mul(sin(psi)));
            // Arcade and glow stay clear of the cell walls.
            const room = max(float(CELL * 0.5).sub(a.mul(0.45)).sub(STRAND * 12), 0.0);
            const c = normalize(cell.centre.add(e1.mul(hd.y.sub(0.5).mul(2).mul(room))).add(cross(cell.centre, e1).mul(hd.z.sub(0.5).mul(2).mul(room)))).toVar();
            const e3 = normalize(cross(e1, c)).toVar();
            const D = a.mul(0.32);
            const hw = a.mul(hd.x.mul(0.4).add(0.25));
            const seed = hc.x.mul(97.0).add(hc.y.mul(13.0));
            // Cheap reject: the ray must pass near the arcade.
            const hub = c.mul(a.mul(k).mul(0.3).add(1.0));
            const rel = hub.sub(o);
            const along = dot(rel, dir);
            const miss = length(rel.sub(dir.mul(along)));
            If(miss.lessThan(a.mul(k.mul(0.5).add(0.6)).add(hw)), () => {
              // Flares on the cell's own cycle (a few cells only).
              const fAge = fract(time.div(FLARE_PERIOD).add(hd.z.mul(5.7))).mul(FLARE_PERIOD);
              const rise = clamp(fAge.div(FLARE_RISE), 0.0, 1.0);
              const flare = select(fAge.lessThan(FLARE_RISE), rise.mul(rise), exp(fAge.sub(FLARE_RISE).div(-FLARE_DECAY))).mul(select(hc.z.greaterThan(0.7), float(1), float(0))).toVar();
              loop('alL', LOOPS, (li) => {
                const hi = hash33(vec3(cell.id, li.toFloat().add(50.0)));
                const hj = hash33(vec3(cell.id, li.toFloat().add(80.0)));
                If(hi.x.greaterThan(0.2), () => {
                  // This loop's field line: label, place across the arcade, shear, warp, width.
                  const L = mix(a.mul(0.45), a, pow(hi.y, 0.7)).toVar();
                  const z0 = hi.z.sub(0.5).mul(2.0).mul(hw);
                  const inner = float(1).sub(L.div(a));
                  const phi = hd.x.sub(0.5).mul(1.4).mul(inner.mul(1.5).add(0.3));
                  const cphi = cos(phi);
                  const sphi = sin(phi);
                  const amp = a.mul(0.06).mul(hj.x.add(0.3));
                  const p1 = hj.y.mul(6.283);
                  const p2 = hj.z.mul(6.283);
                  const theta0 = asin(pow(D.div(L), 1.0 / 3.0));
                  const best = float(1e9).toVar();
                  const bestU = float(0).toVar();
                  const bestT = float(0).toVar();
                  const bestSide = float(0).toVar();
                  const prevP = vec3(0).toVar();
                  // Glow reaches a little past where the ray meets the photosphere; it is faded there,
                  // not cut (a cut leaves straight-edged shelves at the footpoints).
                  const reach = float(STRAND * 14);
                  loop('alG', SEGMENTS + 1, (gi) => {
                    const u = gi.toFloat().div(SEGMENTS);
                    const th = mix(theta0, float(Math.PI).sub(theta0), u);
                    const sn = sin(th);
                    const r = L.mul(sn).mul(sn);
                    const X = r.mul(cos(th)).add(amp.mul(sin(th.mul(3.0).add(p1))));
                    const Y = r.mul(sn).sub(D).mul(k).add(amp.mul(0.6).mul(sin(th.mul(5.0).add(p2))).mul(sn));
                    const P = c.mul(max(Y, 0.0).add(1.0)).add(e1.mul(X.mul(cphi))).add(e3.mul(z0.add(X.mul(sphi)))).toVar();
                    If(gi.greaterThan(0), () => {
                      // Closest approach between the view ray and the segment prevP → P.
                      const v = P.sub(prevP);
                      const w0 = prevP.sub(o);
                      const bb = dot(dir, v);
                      const cc = max(dot(v, v), 1e-12);
                      const dd = dot(dir, w0);
                      const ee = dot(v, w0);
                      const den = max(cc.sub(bb.mul(bb)), 1e-12);
                      const s = clamp(bb.mul(dd).sub(ee).div(den), 0.0, 1.0);
                      const t = dd.add(bb.mul(s));
                      const q = w0.add(v.mul(s)).sub(dir.mul(t));
                      const d2 = dot(q, q);
                      If(d2.lessThan(best).and(t.greaterThan(0.0)).and(t.lessThan(tOut.add(reach))), () => {
                        best.assign(d2);
                        bestU.assign(gi.toFloat().sub(1.0).add(s).div(SEGMENTS));
                        bestT.assign(t);
                        // Signed offset across the strand (in the plane of the sky): stripes the bundle.
                        bestSide.assign(dot(q, normalize(cross(dir, v))));
                      });
                    });
                    prevP.assign(P);
                  });
                  // A soft tube, widened (energy kept) where it is thinner than a pixel.
                  const w = float(STRAND).mul(hj.x.mul(1.4).add(0.8)).mul(a.div(CELL).mul(0.6).add(0.6));
                  const wEff = max(w, pixelAngle.mul(bestT).mul(0.7));
                  const dist = sqrt(best);
                  If(dist.lessThan(wEff.mul(12.0)), () => {
                    // A bundle of fine threads, not a wire: striped across, the stripes drifting along.
                    const strands = vNoise4(vec3(bestSide.div(w).mul(1.6), bestU.mul(3.0).add(seed), li.toFloat().mul(2.3).add(time.div(50.0))));
                    const bundle = pow(strands.x, 1.5).mul(1.6).add(0.15);
                    const profile = exp(dist.div(wEff).pow(2.0).negate()).mul(w.div(wEff));
                    const vis = float(1).sub(smoothstep(0.4, 1.2, pixelAngle.mul(bestT).div(w)));
                    const core = profile.mul(mix(float(0.75), bundle, vis));
                    const halo = exp(dist.div(wEff.mul(4.0)).pow(2.0).negate()).mul(0.12);
                    // Gas along the strand: broken knots and gaps, siphoning and flickering.
                    const flow = time.mul(SIPHON).div(L);
                    const g = vNoise4(vec3(bestU.mul(7.0).sub(flow.mul(2.2)), li.toFloat().mul(3.7).add(seed), time.div(35.0)));
                    const gas = smoothstep(0.22, 0.7, g.x).mul(g.y.mul(1.1).add(0.35));
                    const own = pow(hi.y.mul(0.5).add(hj.z.mul(0.5)), 1.5).mul(1.4).add(0.25);
                    const ends = pow(float(1).sub(sin(bestU.mul(Math.PI))), 4.0);
                    const foot = ends.mul(2.0).add(1.0);
                    // A flare runs the inner loops hot first, and flashes the footpoints.
                    const hot = flare.mul(smoothstep(0.0, 0.4, inner.add(flare.mul(0.5)).sub(0.2))).mul(3.0);
                    const flash = flare.mul(ends).mul(5.0);
                    // Footpoints sit in glowing masses of hot gas.
                    const moss = exp(dist.div(wEff.mul(7.0)).pow(2.0).negate()).mul(ends).mul(0.5);
                    const depthFade = smoothstep(tOut.add(reach), tOut, bestT);
                    const i = depthFade.mul(core.mul(gas).mul(own).mul(hot.add(1)).add(halo.mul(own)).add(moss.mul(own)).mul(foot).add(core.mul(flash))).mul(LOOP_BRIGHTNESS);
                    out.addAssign(plasmaColour(i).mul(i));
                  });
                });
              });
            });
          });
        });
      });
    });
  });
  return out.mul(STAR_DISC_MEAN_RADIANCE[1]) as unknown as V3;
}
