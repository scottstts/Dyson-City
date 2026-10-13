/**
 * The star's white-light photosphere, evaluated at a point on its surface, seen from 288,000 km
 * (disc centre) to 696,000 km (limb).
 *
 * The star is caged: the shell reflects part of its light back onto it, and back-warming makes it
 * hotter at the surface and magnetically more active than the Sun (Dyson-feedback models). Its
 * convection therefore shows strongly at every scale, and a dense magnetic network laces it:
 *
 *  - granulation: ~1,300 km cells (≈ 0.25° at disc centre) with bright domes and dark lanes,
 *    evolving (time-lapsed so the gas visibly boils);
 *  - mesogranulation (~6,000 km, ~1°): bright cell interiors and darker downflow boundaries;
 *  - supergranulation (~30,000 km, ~6°), outlined by the magnetic network: bright fibrous
 *    filigree along cell boundaries with dark pores at the junctions; its faculae brighten toward
 *    the limb;
 *  - active regions: plage fields around sunspot groups;
 *  - white-light flares.
 *
 * Colour follows temperature, not a ramp: every element's intensity at 550 nm is converted to a
 * brightness temperature and the other channels follow the Planck function — hot granules and the
 * network run whiter, lanes, pores and spots redder. Limb darkening is per channel.
 *
 * Every layer fades to its mean as its cells approach the pixel footprint, so the disc never
 * aliases, including the strongly foreshortened limb.
 */
import { Fn, float, vec2, vec3, vec4, If, int, length, fwidth, dot, cross, normalize, atan, cos, sin, mix, smoothstep, pow, max, min, abs, exp, clamp, log } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { cellular3, valueNoise3 } from '../../render/tsl/noise';
import { vNoise4, vCellular } from '../../render/tsl/volumeNoise';
import { loop } from '../../render/tsl/helpers';
import { STAR_CENTER_RADIANCE, LIMB_DARKENING_EXPONENT } from '../../world/radiometry';
import type { StarState } from './starState';
import { FLARE_SLOTS } from './starState';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

/** Cells per unit of the star-frame unit sphere. */
export const GRANULE_FREQUENCY = 535;
export const MESO_FREQUENCY = 118;
export const SUPERGRANULE_FREQUENCY = 24;

/** Visibility of cells of a given frequency at this footprint (1 resolved → 0 sub-pixel). */
function fade(footprint: F, freq: number): F {
  return float(1).sub(smoothstep(0.22, 0.6, footprint.mul(freq)));
}

/** Granulation intensity factor (x) and its visibility (y). */
const granulation = Fn(([X, evolution, footprint, mu]: [V3, F, F, F]) => {
  // Granules stay visible down to ~3 px (their dark lanes carry them); finer they fade to the mean.
  const gVisible = float(1).sub(smoothstep(0.3, 0.75, footprint.mul(GRANULE_FREQUENCY))).toVar();
  const intensity = float(1).toVar();
  If(gVisible.greaterThan(0.001), () => {
    const cell = cellular3(X.mul(GRANULE_FREQUENCY), evolution, float(0.18));
    const lane = smoothstep(0.0, 0.28, cell.y.sub(cell.x));
    const dome = float(1).sub(cell.x.mul(cell.x).mul(0.3));
    const lifetime = sin(evolution.mul(0.55).add(cell.z.mul(37.0))).mul(0.08);
    const brightness = cell.z.mul(0.2).add(0.9).add(lifetime);
    const g = mix(float(0.3), float(1.0), lane).mul(dome).mul(brightness);
    // Mean of g ≈ 0.84; contrast fades toward the limb (corrugation, foreshortening).
    const contrast = gVisible.mul(smoothstep(0.0, 0.35, mu).mul(0.7).add(0.3));
    intensity.assign(float(1).add(g.div(0.84).sub(1).mul(contrast)));
  });
  return vec2(intensity, gVisible);
}).setLayout({
  name: 'dyGranulation',
  type: 'vec2',
  inputs: [
    { name: 'X', type: 'vec3' },
    { name: 'evolution', type: 'float' },
    { name: 'footprint', type: 'float' },
    { name: 'mu', type: 'float' },
  ],
});

/**
 * One sunspot: returns vec4(multiplicative rgb, penumbra coverage).
 * c = spot centre (unit), rp = penumbra angular radius, ur = umbra ratio, seed in [0,1).
 */
const sunspot = Fn(([X, c, rp, ur, seed, footprint, evolution, gVisible]: [V3, V3, F, F, F, F, F, F]) => {
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
  const umbraR = ur.mul(uEdge);
  const umb = float(1).sub(smoothstep(umbraR.sub(soft.mul(0.8)), umbraR.add(soft.mul(0.8)), rho));
  // Radial penumbral filaments.
  const fil = valueNoise3(vec3(cos(psi).mul(26.0), sin(psi).mul(26.0), rho.mul(2.6).add(seed.mul(5.0)).add(evolution.mul(0.01))));
  const filFade = float(1).sub(smoothstep(0.02, 0.08, spotFoot));
  const penumbra = float(0.68).add(fil.sub(0.5).mul(0.34).mul(filFade));
  const dots = smoothstep(0.82, 0.95, valueNoise3(X.mul(GRANULE_FREQUENCY * 1.3).add(seed.mul(91.0)))).mul(0.1).mul(gVisible);
  const umbra = float(0.22).add(dots);
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
    { name: 'evolution', type: 'float' },
    { name: 'gVisible', type: 'float' },
  ],
});

/** Flare ribbon pair brightness for one active flare slot. */
const flareRibbons = Fn(([X, c, axis, radius, age, slotSeed]: [V3, V3, V3, F, F, F]) => {
  const perp = cross(c, axis);
  const v = X.sub(c);
  const along = dot(v, axis).div(radius);
  const across = dot(v, perp).div(radius);
  const sep = float(0.12).add(age.mul(0.0008));
  const x = abs(along).sub(sep).div(0.035);
  const ribbon = exp(x.mul(x).negate());
  const length01 = float(1).sub(smoothstep(0.35, 0.6, abs(across)));
  const knots = valueNoise3(vec3(across.mul(14), along.mul(4), slotSeed)).mul(0.8).add(0.4);
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

/** fBm of the noise volume (vec3 out, centred on 0), footprint-faded per octave. */
function fbm3v(p: V3, freq: number, footprint: F, octaves = 3): V3 {
  let sum: V3 = vec3(0) as unknown as V3;
  let amp = 0.5;
  let f = freq;
  for (let o = 0; o < octaves; o++) {
    const n = vNoise4(p.mul(f).add(vec3(o * 7.1, o * 3.3, o * 5.9))).xyz.sub(0.5);
    sum = sum.add(n.mul(amp).mul(fade(footprint, f))) as unknown as V3;
    amp *= 0.5;
    f *= 2.07;
  }
  return sum;
}

/**
 * Mesoscale convection (an intensity factor), from the noise volumes.
 *
 * The caged star's surface layers are strongly turbulent: rising hot plasma is sheared and folded
 * by the flows around it into tongues and sheets, and cooler gas sinks between them. A double
 * domain warp (the field advected by itself, twice) reproduces that folding: broad cool pockets,
 * bright hot tongues, and thin bright filaments wherever the flow compresses the hot gas. The
 * temperature contrast is a few hundred kelvin; brightness follows it exponentially (Planck at
 * 550 nm), skewed toward bright hot crests.
 *
 * Rejected: closed cell outlines (read as scales), single-scale ridged noise (read as caustics).
 */
function convection(X: V3, footprint: F, time: F, mu: F): { factor: F; pores: F; heat: F; network: F } {
  const t = time.mul(0.0012);
  const q = X.add(vec3(t, t.mul(-0.6), t.mul(0.8)));
  const w1 = fbm3v(q, 6.0, footprint);
  const w2 = fbm3v(q.add(w1.mul(0.55)).add(vec3(t.mul(-1.3), 0, t)), 9.0, footprint);
  const f = fbm3v(q.add(w2.mul(0.5)), 13.0, footprint, 5).x.mul(2.2).add(0.5).clamp(0, 1);
  // Compression of the flow (how strongly the warp folds here) brightens thin sheets.
  const shear = length(w2).mul(3.0).clamp(0, 1);
  const crest = pow(smoothstep(0.55, 0.95, f), 2.0).mul(shear.mul(0.8).add(0.4));
  // Divided by its disc mean (≈ 1.04): the texture redistributes the star's light, it adds none.
  const factor = exp(f.sub(0.5).mul(1.1)).mul(float(1).add(crest.mul(0.1))).div(1.04);
  // Pores: small dark knots in the coolest gas.
  const pores = smoothstep(0.78, 0.92, vNoise4(X.mul(260.0).add(w2.mul(4.0))).w).mul(smoothstep(0.35, 0.15, f)).mul(fade(footprint, 260)).mul(smoothstep(0.05, 0.3, mu));
  // Faculae: hot magnetic flux in clouds of bright points, clustered where the flow gathers it.
  // Seen best obliquely, they mottle the near-limb disc (where granulation is foreshortened below a
  // pixel) with countless small features. Never a connected web: that reads as caustics.
  const patch = smoothstep(0.5, 0.78, vNoise4(X.mul(22.0).add(w1.mul(1.5))).y.mul(0.6).add(vNoise4(X.mul(57.0).add(w2.mul(1.2))).z.mul(0.4)));
  const points = smoothstep(0.55, 0.9, vNoise4(X.mul(420.0).add(w2.mul(3.0))).x);
  const network = patch.mul(mix(float(0.35), points.mul(1.6), fade(footprint, 420)));
  void vCellular;
  return { factor, pores, heat: f, network };
}

export function createStarSurface(state: StarState) {
  const centerRadiance = vec3(...STAR_CENTER_RADIANCE);
  const limbExp = vec3(...LIMB_DARKENING_EXPONENT);

  /**
   * @param nWorld unit surface normal of the star at the hit point (observer frame)
   * @param mu     cos of the angle between that normal and the direction to the observer
   * Returns vec4(rgb radiance, active-region mask for diagnostics).
   */
  return (nWorld: V3, mu: F): Node<'vec4'> => {
    const X = state.rotation.mul(nWorld).toVar();
    const footprint = length(fwidth(X)).max(1e-7).toVar();

    const gran = granulation(X, state.evolution, footprint, mu).toVar();
    const intensity = gran.x.toVar();
    const gVisible = gran.y;
    const conv = convection(X, footprint, state.time as unknown as F, mu);
    intensity.mulAssign(conv.factor);

    // --- Active regions: plage -------------------------------------------------------------------
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
    // Faculae: magnetic flux is hot, brightest seen obliquely — the network everywhere, plage in
    // active regions.
    const oblique = pow(float(1).sub(mu), 1.2).mul(smoothstep(0.0, 0.05, mu));
    intensity.mulAssign(float(1).add(conv.network.mul(oblique.mul(1.6).add(0.25))).add(plageMask.mul(oblique.mul(0.5).add(0.15))));
    intensity.mulAssign(float(1).sub(conv.pores.mul(0.5)));

    // --- Sunspots ------------------------------------------------------------------------------
    const spot = float(1).toVar();
    const granuleSuppress = float(0).toVar();
    loop('si', state.spotCount, (i) => {
      const sa = state.spotA.at(i).toVar();
      If(length(X.sub(sa.xyz)).lessThan(sa.w.mul(1.45)), () => {
        const sb = state.spotB.at(i).toVar();
        const s = sunspot(X, sa.xyz, sa.w, sb.x, sb.y, footprint, state.evolution, gVisible).toVar();
        spot.mulAssign(s.x);
        granuleSuppress.assign(max(granuleSuppress, s.w));
      });
    });
    intensity.assign(mix(intensity, float(1), granuleSuppress.mul(0.85)).mul(spot));

    // --- Flares --------------------------------------------------------------------------------
    const flare = float(0).toVar();
    for (let k = 0; k < FLARE_SLOTS; k++) {
      const f = state.flares.at(int(k)).toVar();
      If(f.y.greaterThan(0.001), () => {
        const ri = int(f.x);
        const ra = state.regionA.at(ri).toVar();
        const rb = state.regionB.at(ri).toVar();
        const axis = normalize(rb.xyz.add(cross(ra.xyz, rb.xyz).mul(f.z)));
        flare.addAssign(flareRibbons(X, ra.xyz, axis, ra.w, f.w, f.x).mul(f.y));
      });
    }
    intensity.mulAssign(float(1).add(flare.mul(0.35)));

    // --- Compose -------------------------------------------------------------------------------
    const limb = pow(vec3(max(mu, 0.0)), limbExp);
    const disc = planckColour(intensity).mul(limb).mul(centerRadiance);
    return vec4(disc, plageMask.add(min(flare, 1))) as unknown as Node<'vec4'>;
  };
}
