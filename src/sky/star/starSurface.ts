/**
 * The star's white-light photosphere, evaluated at a point on its surface, seen from 288,000 km
 * (disc centre) to 696,000 km (limb).
 *
 * What makes it read as a star 1.4 million km across rather than a glowing ball is scale: in white
 * light the photosphere has no large-scale pattern at all, only countless granules (~1,300 km,
 * 0.26° = ~4.5 px at disc centre, ~620,000 on the visible cap), shrinking and foreshortening toward
 * the limb, which is 2.4× further away than the centre. Everything else is sparse and physical:
 *
 *  - granulation: bright domes with thin dark lanes, ~18 % rms (the caged star convects slightly
 *    harder than the Sun's 14 %), evolving in real time — each granule lives ~8 min and drifts on
 *    its own flows; granules are born, merge and split region by region, never a global pulse;
 *  - mesogranulation: a ±2 % undertone;
 *  - the supergranular network (~30,000 km, 6°): bright magnetic points and faculae along its
 *    lanes, nearly invisible at disc centre and strong toward the limb;
 *  - active regions: plage and faculae around sunspot groups; spots with dark umbrae, filamentary
 *    penumbrae, umbral dots, and the Wilson depression near the limb;
 *  - white-light flares: two ribbons spreading apart at ~30 km/s, with impulsive bursts.
 *
 * Colour follows temperature, not a ramp: every element's intensity at 550 nm is converted to a
 * brightness temperature and the other channels follow the Planck function — hot granules run
 * whiter, lanes, pores and spots redder. Limb darkening is per channel.
 *
 * Every layer fades to its mean as its cells approach the pixel footprint, so the disc never
 * aliases, including the strongly foreshortened limb.
 */
import { Fn, float, vec2, vec3, vec4, If, int, length, fwidth, dot, cross, normalize, atan, cos, sin, mix, smoothstep, pow, max, min, abs, exp, clamp, log, select } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { cellular3, valueNoise3 } from '../../render/tsl/noise';
import { vNoise4, vCellular } from '../../render/tsl/volumeNoise';
import { loop } from '../../render/tsl/helpers';
import { STAR_CENTER_RADIANCE, LIMB_DARKENING_EXPONENT } from '../../world/radiometry';
import type { StarState } from './starState';
import { FLARE_SLOTS, GRANULE_DRIFT_PERIOD, GRANULE_LIFETIME } from './starState';
import { FLARE_BURST_AMPLITUDE, FLARE_BURST_WIDTH } from './features';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

/** Cells per unit of the star-frame unit sphere (1 / 535 rad × 696,000 km ≈ 1,300 km). */
export const GRANULE_FREQUENCY = 535;
export const MESO_FREQUENCY = 118;
export const SUPERGRANULE_FREQUENCY = 24;

/** Granulation pattern constants: lane floor, dome, per-granule spread, and its mean (CPU Monte Carlo). */
const LANE_FLOOR = 0.65;
const DOME = 0.2;
const GRANULE_SPREAD = 0.14;
const GRANULE_MEAN = 0.827;

/** Visibility of cells of a given frequency at this footprint (1 resolved → 0 sub-pixel). */
function fade(footprint: F, freq: number): F {
  return float(1).sub(smoothstep(0.22, 0.6, footprint.mul(freq)));
}

/**
 * Granulation intensity factor (x) and its visibility (y). Two independent cell lattices are
 * blended with a weight that cycles over a granule lifetime with a phase that varies region by
 * region: lanes open and close, granules appear, merge and split, and no two places pulse together.
 */
const granulation = Fn(([X, time, footprint, mu]: [V3, F, F, F]) => {
  const gVisible = float(1).sub(smoothstep(0.3, 0.75, footprint.mul(GRANULE_FREQUENCY))).toVar();
  const intensity = float(1).toVar();
  If(gVisible.greaterThan(0.001), () => {
    const p = X.mul(GRANULE_FREQUENCY);
    const drift = time.mul((2 * Math.PI) / GRANULE_DRIFT_PERIOD);
    const a = cellular3(p, drift, float(0.2));
    const b = cellular3(p.add(vec3(17.31, 41.13, 7.77)), drift.mul(1.13).add(2.0), float(0.2));
    const region = valueNoise3(X.mul(GRANULE_FREQUENCY * 0.18)).mul(6.2832);
    const w = sin(time.mul((2 * Math.PI) / GRANULE_LIFETIME).add(region)).mul(0.5).add(0.5).toVar();
    const laneMetric = mix(a.y.sub(a.x), b.y.sub(b.x), w);
    const centre = mix(a.x, b.x, w);
    const id = select(w.lessThan(0.5), a.z, b.z);
    // Lanes are ~250 km (≈0.9 px at disc centre): widen their edge with the footprint so they
    // average rather than alias.
    const laneEdge = max(float(0.22), footprint.mul(GRANULE_FREQUENCY * 0.9));
    const lane = smoothstep(0.0, laneEdge, laneMetric);
    const dome = float(1).sub(centre.mul(centre).mul(DOME));
    const bright = id.mul(GRANULE_SPREAD).add(1 - GRANULE_SPREAD / 2);
    const g = mix(float(LANE_FLOOR), float(1.0), lane).mul(dome).mul(bright);
    // Contrast fades toward the limb (corrugation, foreshortening, the lanes hidden behind domes).
    const contrast = gVisible.mul(smoothstep(0.0, 0.35, mu).mul(0.7).add(0.3));
    intensity.assign(float(1).add(g.div(GRANULE_MEAN).sub(1).mul(contrast)));
  });
  return vec2(intensity, gVisible);
}).setLayout({
  name: 'dyGranulation',
  type: 'vec2',
  inputs: [
    { name: 'X', type: 'vec3' },
    { name: 'time', type: 'float' },
    { name: 'footprint', type: 'float' },
    { name: 'mu', type: 'float' },
  ],
});

/**
 * One sunspot: returns vec4(multiplicative rgb, penumbra coverage).
 * c = spot centre (unit), rp = penumbra angular radius, ur = umbra ratio, seed in [0,1),
 * wilson = umbra-centre offset toward the sub-observer point (the depressed umbra seen obliquely).
 */
const sunspot = Fn(([X, c, rp, ur, seed, footprint, wilson, gVisible]: [V3, V3, F, F, F, F, V3, F]) => {
  const v = X.sub(c);
  const dist = length(v);
  const t1 = normalize(cross(c, vec3(0.0, 0.0, 1.0)));
  const t2 = cross(c, t1);
  const psi = atan(dot(v, t2), dot(v, t1));
  const ring = vec3(cos(psi), sin(psi), seed.mul(13.0));
  const rho = dist.div(rp);
  const edge = valueNoise3(ring.mul(2.2)).sub(0.5).mul(0.26).add(1);
  const uEdge = valueNoise3(ring.mul(3.1).add(7.0)).sub(0.5).mul(0.3).add(1);
  const spotFoot = footprint.div(rp);
  const soft = max(spotFoot.mul(1.5), 0.05);
  const pen = float(1).sub(smoothstep(edge.sub(soft), edge.add(soft), rho));
  const rhoU = length(X.sub(c).sub(wilson)).div(rp);
  const umbraR = ur.mul(uEdge);
  const umb = float(1).sub(smoothstep(umbraR.sub(soft.mul(0.8)), umbraR.add(soft.mul(0.8)), rhoU));
  // Radial penumbral filaments (bright and dark, ~200 km each: bundles resolve near disc centre).
  const fil = valueNoise3(vec3(cos(psi).mul(34.0), sin(psi).mul(34.0), rho.mul(2.6).add(seed.mul(5.0))));
  const filFine = valueNoise3(vec3(cos(psi).mul(90.0), sin(psi).mul(90.0), rho.mul(4.0).add(seed.mul(9.0))));
  const filFade = float(1).sub(smoothstep(0.015, 0.06, spotFoot));
  const penumbra = float(0.76).add(fil.sub(0.5).mul(0.3).add(filFine.sub(0.5).mul(0.16)).mul(filFade));
  const dots = smoothstep(0.82, 0.95, valueNoise3(X.mul(GRANULE_FREQUENCY * 1.3).add(seed.mul(91.0)))).mul(0.12).mul(gVisible);
  const umbra = float(0.16).add(dots);
  const inner = mix(penumbra, umbra, umb);
  return vec4(vec3(mix(float(1), inner, pen)), pen);
}).setLayout({
  name: 'dySunspot',
  type: 'vec4',
  inputs: [
    { name: 'X', type: 'vec3' },
    { name: 'c', type: 'vec3' },
    { name: 'rp', type: 'float' },
    { name: 'ur', type: 'float' },
    { name: 'seed', type: 'float' },
    { name: 'footprint', type: 'float' },
    { name: 'wilson', type: 'vec3' },
    { name: 'gVisible', type: 'float' },
  ],
});

/** Flare ribbon pair (0..1 shape) for one flare slot. */
const flareRibbons = Fn(([X, c, axis, radius, age, slotSeed]: [V3, V3, V3, F, F, F]) => {
  const perp = cross(c, axis);
  const v = X.sub(c);
  const along = dot(v, axis).div(radius);
  const across = dot(v, perp).div(radius);
  // Ribbons spread apart at ~30 km/s as reconnection climbs the arcade.
  const sep = float(0.1).add(age.mul(0.0008));
  const x = abs(along).sub(sep).div(0.03);
  const ribbon = exp(x.mul(x).negate());
  const length01 = float(1).sub(smoothstep(0.35, 0.6, abs(across)));
  const knots = valueNoise3(vec3(across.mul(14), along.mul(4), slotSeed)).mul(0.9).add(0.3);
  return ribbon.mul(length01).mul(knots);
}).setLayout({
  name: 'dyFlareRibbons',
  type: 'float',
  inputs: [
    { name: 'X', type: 'vec3' },
    { name: 'c', type: 'vec3' },
    { name: 'axis', type: 'vec3' },
    { name: 'radius', type: 'float' },
    { name: 'age', type: 'float' },
    { name: 'slotSeed', type: 'float' },
  ],
});

/**
 * Brightness temperature → per-channel intensity: the 550 nm intensity factor I (relative to the
 * quiet photosphere at T0 = 5,772 K) becomes a temperature, and the 650/450 nm channels follow
 * the Planck function. Returns the rgb intensity factors.
 */
const X0 = 0.014388 / (550e-9 * 5772);
const planckColour = Fn(([I]: [F]) => {
  const i = max(I, 0.02);
  // e^{x} − 1 = (e^{x0} − 1)/I  →  x = c2/(λT) at 550 nm.
  const x = log(float(Math.exp(X0) - 1).div(i).add(1));
  const xr = x.mul(550 / 650);
  const xb = x.mul(550 / 450);
  const r = float(Math.exp(X0 * (550 / 650)) - 1).div(exp(xr).sub(1));
  const b = float(Math.exp(X0 * (550 / 450)) - 1).div(exp(xb).sub(1));
  return vec3(r, i, b);
}).setLayout({ name: 'dyPlanckColour', type: 'vec3', inputs: [{ name: 'I', type: 'float' }] });

/**
 * Brightening of the flare ribbons at star-frame point X, at time `t` (s, star time). The direct
 * view evaluates it now; reflections in the far shell evaluate it at their retarded time, so the
 * impulsive bursts arrive there seconds later (light echoes).
 */
export function flareBrightening(state: StarState, X: V3, t: F): F {
  const total = float(0).toVar();
  for (let k = 0; k < FLARE_SLOTS; k++) {
    const a = state.flares.at(int(k * 3)).toVar();
    const b = state.flares.at(int(k * 3 + 1)).toVar();
    If(b.z.greaterThan(0.5), () => {
      const bursts = state.flares.at(int(k * 3 + 2));
      const dt = t.sub(a.w);
      const rise = b.x;
      const x = clamp(dt.div(rise), 0, 1);
      const env = select(dt.lessThan(0.0), float(0), select(dt.lessThan(rise), x.mul(x).mul(x.mul(-2).add(3)), exp(dt.sub(rise).div(b.y).negate())));
      const burst = (i: number, tb: F) => {
        const u = t.sub(tb).div(FLARE_BURST_WIDTH);
        return exp(u.mul(u).negate()).mul(FLARE_BURST_AMPLITUDE[i]);
      };
      const spikes = burst(0, bursts.x).add(burst(1, bursts.y)).add(burst(2, bursts.z)).add(burst(3, bursts.w));
      const level = a.y.mul(env).mul(spikes.add(1));
      If(level.greaterThan(0.002), () => {
        const ri = int(a.x);
        const ra = state.regionA.at(ri).toVar();
        const rb = state.regionB.at(ri).toVar();
        const axis = normalize(rb.xyz.add(cross(ra.xyz, rb.xyz).mul(a.z)));
        total.addAssign(flareRibbons(X, ra.xyz, axis, ra.w, max(dt, 0.0), a.x).mul(level));
      });
    });
  }
  return total;
}

export function createStarSurface(state: StarState) {
  const centerRadiance = vec3(...STAR_CENTER_RADIANCE);
  const limbExp = vec3(...LIMB_DARKENING_EXPONENT);
  const time = state.time as unknown as F;

  /**
   * @param nWorld unit surface normal of the star at the hit point (observer frame)
   * @param mu     cos of the angle between that normal and the direction to the observer
   * Returns vec4(rgb radiance, active-region mask for diagnostics).
   */
  return (nWorld: V3, mu: F): Node<'vec4'> => {
    const X = state.rotation.mul(nWorld).toVar();
    const footprint = length(fwidth(X)).max(1e-7).toVar();
    const oblique = pow(float(1).sub(mu), 1.2).mul(smoothstep(0.0, 0.05, mu)).toVar();

    const gran = granulation(X, time, footprint, mu).toVar();
    const intensity = gran.x.toVar();
    const gVisible = gran.y;

    // --- Mesogranulation: a faint undertone ---------------------------------------------------
    const meso = vNoise4(X.mul(MESO_FREQUENCY)).x.sub(0.5).mul(0.04).mul(fade(footprint, MESO_FREQUENCY));
    intensity.mulAssign(float(1).add(meso));

    // --- Supergranular network: bright points and faculae along its lanes --------------------
    // Never a connected web (that reads as scales): flux gathers in clouds of bright points along
    // parts of the lanes, so the network is broken into patches.
    const sg = vCellular(X.mul(SUPERGRANULE_FREQUENCY).add(vNoise4(X.mul(60.0)).xyz.sub(0.5).mul(0.35)));
    const network = float(1).sub(smoothstep(0.0, 0.22, sg.y.sub(sg.x)));
    const patches = smoothstep(0.42, 0.75, vNoise4(X.mul(70.0)).w);
    const points = smoothstep(0.5, 0.85, vNoise4(X.mul(380.0)).y).mul(fade(footprint, 380)).add(float(0.3).mul(float(1).sub(fade(footprint, 380))));
    intensity.mulAssign(float(1).add(network.mul(patches).mul(points).mul(oblique.mul(0.3).add(0.015))));

    // --- Active regions: plage and faculae ---------------------------------------------------
    const plage = float(0).toVar();
    loop('ri', state.regionCount, (i) => {
      const ra = state.regionA.at(i).toVar();
      const d = length(X.sub(ra.xyz));
      If(d.lessThan(ra.w.mul(1.8)), () => {
        const envelope = float(1).sub(smoothstep(ra.w.mul(0.35), ra.w.mul(1.8), d));
        plage.addAssign(envelope.mul(state.regionB.at(i).w));
      });
    });
    const plageMask = clamp(plage, 0, 1).toVar();
    const facular = vNoise4(X.mul(140.0)).z.mul(0.6).add(0.4);
    intensity.mulAssign(float(1).add(plageMask.mul(facular).mul(oblique.mul(0.5).add(0.04))));

    // Pores: small dark knots where the network gathers flux in active regions.
    const pores = smoothstep(0.8, 0.93, vNoise4(X.mul(260.0)).w).mul(network).mul(plageMask).mul(fade(footprint, 260)).mul(smoothstep(0.05, 0.3, mu));
    intensity.mulAssign(float(1).sub(pores.mul(0.5)));

    // --- Sunspots ------------------------------------------------------------------------------
    const spot = float(1).toVar();
    const granuleSuppress = float(0).toVar();
    const sub = state.subObserver as unknown as V3;
    loop('si', state.spotCount, (i) => {
      const sa = state.spotA.at(i).toVar();
      If(length(X.sub(sa.xyz)).lessThan(sa.w.mul(1.45)), () => {
        const sb = state.spotB.at(i).toVar();
        // Wilson depression: the umbra floor lies ~1,000 km down, so seen obliquely the umbra shifts
        // toward the disc centre and the centre-side penumbra narrows.
        const toward = sub.sub(sa.xyz.mul(dot(sub, sa.xyz)));
        const wilson = toward.mul(sa.w.mul(0.18));
        const s = sunspot(X, sa.xyz, sa.w, sb.x, sb.y, footprint, wilson, gVisible).toVar();
        spot.mulAssign(s.x);
        granuleSuppress.assign(max(granuleSuppress, s.w));
      });
    });
    intensity.assign(mix(intensity, float(1), granuleSuppress.mul(0.85)).mul(spot));

    // --- Flares --------------------------------------------------------------------------------
    intensity.mulAssign(float(1).add(min(flareBrightening(state, X, time), 3.0).mul(0.8)));

    // --- Compose -------------------------------------------------------------------------------
    const limb = pow(vec3(max(mu, 0.0)), limbExp);
    const disc = planckColour(intensity).mul(limb).mul(centerRadiance);
    return vec4(disc, plageMask) as unknown as Node<'vec4'>;
  };
}
