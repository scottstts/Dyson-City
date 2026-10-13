/**
 * Lighting of the far structure. Every surface on the shell sits in the same enclosure (the star a
 * 45° cap on its normal, the rest of the shell around it), solved once at boot (enclosure.ts):
 *
 *  - specular: the prefiltered enclosure about the reflected direction's elevation — a Gaussian
 *    facet lobe for mirrors (their normal spread: micro-roughness ⊕ unresolved tilts), GGX for rough
 *    finishes. Every tile's mirrors are domed and individually tilted, so no tile shows a sharp image
 *    of the structure: the prefiltered enclosure is exact for them;
 *  - diffuse: the enclosure's irradiance for the face's tilt (horizon-clipped);
 *  - pixels covering many tiles mix the finishes' reflections in the shares of the sample under them
 *    (plating.ts), about the sample's mean normal;
 *  - rogue facets (failed actuators, pointing anywhere) that mirror the star toward the viewer add
 *    point glints;
 *  - the alloy's heat glow is added (thermal.ts);
 *  - reflections of the star carry its flares at their retarded time: the far shell is up to 4.6
 *    light-seconds away, so a flare's impulsive bursts flash in its mirrors seconds after they flash
 *    on the disc (light echoes).
 *
 * Tables are in reference-photosphere units; everything scales by the star's measured illuminant.
 * There is no ambient term.
 */
import { float, vec2, vec3, If, dot, normalize, sqrt, max, min, mix, clamp, asin, acos, exp, texture, length, select, cross, abs, log, cos, sin } from 'three/tsl';
import type { DataTexture, Node } from 'three/webgpu';
import { STAR_CENTER_RADIANCE, LIMB_DARKENING_EXPONENT } from '../../world/radiometry';
import { STAR_RADIUS_R } from '../../world/constants';
import { ENCLOSURE_LUT, MIRROR_MICRO_SIGMA } from './enclosure';
import { COLLECTOR_F0 } from './materials';
import { SHELL_LIGHT_SECONDS } from '../../world/constants';
import { flareBrightening } from '../star/starSurface';
import type { StarState } from '../star/starState';
import { MAT, type StructureHit } from './trace';
import { plasmaSegment } from '../medium/plasmaNodes';
import { FINISHES, type SurfaceSample } from './surfaces';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

export interface ShellLight {
  /** Star's measured disc-mean radiance relative to the reference photosphere (per channel). */
  illuminant: V3;
  pre: DataTexture;
  preMirror: DataTexture;
  irr: DataTexture;
  plasma: DataTexture;
  /** The star's features, for flares seen in reflection (light echoes). */
  star: StarState;
}

const { preWidth: PW, preHeight: PH, irrWidth: IW } = ENCLOSURE_LUT;
const HALF_PI = Math.PI / 2;

/** Effective roughness of a finish whose facets spread by σ (radians): α² ⊕ 2σ². */
export function effectiveRoughness(roughness: F | number, spread: F): F {
  const r: F = typeof roughness === 'number' ? float(roughness) : roughness;
  const a = r.mul(r);
  return sqrt(sqrt(a.mul(a).add(spread.mul(spread).mul(2)))).clamp(0.0, 1.0);
}

/** Prefiltered enclosure radiance about a reflected direction at elevation er (radians). */
export function prefiltered(light: ShellLight, er: F, rough: F): V3 {
  const u = er.add(HALF_PI).div(Math.PI).clamp(0.5 / PW, 1 - 0.5 / PW);
  const v = rough.mul((PH - 1) / PH).add(0.5 / PH);
  return texture(light.pre, vec2(u, v)).rgb as unknown as V3;
}

/** Prefiltered enclosure for a Gaussian-facet mirror of normal spread σ (radians). */
export function prefilteredMirror(light: ShellLight, er: F, sigma: F): V3 {
  const u = er.add(HALF_PI).div(Math.PI).clamp(0.5 / PW, 1 - 0.5 / PW);
  const v = sqrt(sigma.div(ENCLOSURE_LUT.mirrorSigmaMax).clamp(0, 1)).mul((PH - 1) / PH).add(0.5 / PH);
  return texture(light.preMirror, vec2(u, v)).rgb as unknown as V3;
}

/** Irradiance on a face whose normal is tilted by `tilt` (radians) from the radial direction. */
export function irradiance(light: ShellLight, tilt: F): V3 {
  const u = tilt.div(Math.PI).clamp(0, 1).mul((IW - 1) / IW).add(0.5 / IW);
  return texture(light.irr, vec2(u, 0.25)).rgb as unknown as V3;
}

/** Radiance of a structure surface seen at elevation eps (the shell's covered-part mean). */
export function structureRadiance(light: ShellLight, eps: F): V3 {
  const u = eps.div(HALF_PI).clamp(0, 1).mul((IW - 1) / IW).add(0.5 / IW);
  return texture(light.irr, vec2(u, 0.75)).rgb as unknown as V3;
}

/** Karis' analytic approximation of the split-sum environment BRDF. */
export function envBRDFApprox(f0: V3, roughness: F, nov: F): V3 {
  const r = vec3(roughness.mul(-1).add(1), roughness.mul(-0.0275).add(0.0425), roughness.mul(-0.572).add(1.04));
  const rw = roughness.mul(0.022).add(-0.04);
  const a004 = min(r.x.mul(r.x), exp(nov.mul(-9.28).mul(Math.LN2))).mul(r.x).add(r.y);
  const ax = a004.mul(-1.04).add(r.z);
  const ay = a004.mul(1.04).add(rw);
  return f0.mul(ax).add(ay);
}

/**
 * Radiance leaving a far-structure surface toward the observer (before the plasma and air in
 * front of it), in scene units.
 */
/** Radiance of the limb-darkened star seen from `pos` (observer frame) along `dir`; 0 off the disc. */
function starRadianceToward(pos: V3, dir: V3): V3 {
  const toC = vec3(0, 1, 0).sub(pos);
  const dist = max(length(toC), STAR_RADIUS_R * 1.0001);
  const sinA = float(STAR_RADIUS_R).div(dist);
  const c = dot(dir, toC.div(dist));
  const sinPsi = sqrt(max(float(1).sub(c.mul(c)), 0.0));
  const mu = sqrt(max(float(1).sub(sinPsi.div(sinA).pow(2)), 0.0));
  const onDisc = select(c.greaterThan(sqrt(float(1).sub(sinA.mul(sinA)))), float(1), float(0));
  return vec3(...STAR_CENTER_RADIANCE).mul(vec3(mu).pow(vec3(...LIMB_DARKENING_EXPONENT))).mul(onDisc) as unknown as V3;
}

/**
 * What a reflection ray from `pos` along `r` meets: the star, a structure surface (at the
 * enclosure's covered-shell radiance for the elevation it is seen at), or open space — with the
 * plasma along the way. Mirror tiles are not mean reflectors: each shows its own piece of the real
 * enclosure, gaps (dark) and all.
 */
function tracedReflection(pos: V3, r: V3, light: ShellLight, trace: (o: V3, d: V3) => StructureHit): V3 {
  const oc = pos.sub(vec3(0, 1, 0));
  const b = dot(oc, r);
  const cS = dot(oc, oc).sub(STAR_RADIUS_R * STAR_RADIUS_R);
  const discS = b.mul(b).sub(cS);
  const tStar = select(discS.greaterThan(0.0).and(b.negate().sub(sqrt(max(discS, 0.0))).greaterThan(0.0)), b.negate().sub(sqrt(max(discS, 0.0))), float(1e9));
  const out = vec3(0).toVar();
  const tEnd = float(0).toVar();
  If(tStar.lessThan(1e8), () => {
    // Light echo: the reflected starlight left the star earlier than the direct light now arriving
    // by (path via the reflector − direct path) / c.
    const hitP = pos.add(r.mul(tStar));
    const X = light.star.rotation.mul(normalize(hitP.sub(vec3(0, 1, 0))));
    const delay = tStar.add(length(pos)).sub(length(hitP)).mul(SHELL_LIGHT_SECONDS);
    const flare = min(flareBrightening(light.star, X, (light.star.time as unknown as F).sub(delay)), 3.0);
    out.assign(starRadianceToward(pos, r).mul(flare.mul(0.8).add(1)));
    tEnd.assign(tStar);
  }).Else(() => {
    const hit = trace(pos, r);
    const exitT = b.negate().add(sqrt(max(b.mul(b).sub(dot(oc, oc).sub(1)), 0.0)));
    tEnd.assign(min(hit.t, exitT));
    If(hit.mat.notEqual(MAT.space).and(hit.mat.notEqual(MAT.none)), () => {
      const hp = pos.add(r.mul(hit.t));
      const upHit = normalize(vec3(0, 1, 0).sub(hp));
      out.assign(structureRadiance(light, asin(clamp(dot(r.negate(), upHit), -1, 1)).abs()));
    });
  });
  const seg = plasmaSegment(light.plasma, oc, r, float(0), tEnd);
  return out.mul(seg.T).add(seg.S) as unknown as V3;
}

export function shadeSurface(d: V3, pos: V3, s: SurfaceSample, light: ShellLight, trace: (o: V3, dir: V3) => StructureHit, noise: V2): V3 {
  const up = normalize(vec3(0, 1, 0).sub(pos));
  const v = d.negate();

  // The pixel's own finish.
  const n = s.normal;
  const nov = max(dot(n, v), 1e-3);
  const rough = effectiveRoughness(s.roughness, s.spread);
  const r = normalize(d.sub(n.mul(dot(d, n).mul(2))));
  const er = asin(clamp(dot(r, up), -1, 1));
  // Mirrors: Gaussian facet lobe of their micro-roughness ⊕ unresolved tilt; others: GGX.
  const sigma = sqrt(s.spread.mul(s.spread).add(MIRROR_MICRO_SIGMA * MIRROR_MICRO_SIGMA));
  const env = mix(prefiltered(light, er, rough), prefilteredMirror(light, er, sigma), s.mirror).toVar();
  // Resolved mirror tiles: trace their reflection, jittered within the lobe each frame (temporal
  // AA integrates the blur), so each tile shows its own piece of the enclosure.
  const sharpW = s.mirror.mul(s.mix.oneMinus());
  If(sharpW.greaterThan(0.01), () => {
    const t1 = normalize(cross(r, select(abs(r.y).lessThan(0.9), vec3(0, 1, 0), vec3(1, 0, 0))));
    const t2 = cross(r, t1);
    const rad = sqrt(log(max(float(1).sub(noise.x), 1e-6)).mul(-2.0));
    const ang = noise.y.mul(Math.PI * 2);
    const rj = normalize(r.add(t1.mul(cos(ang).mul(rad).mul(sigma))).add(t2.mul(sin(ang).mul(rad).mul(sigma))));
    If(dot(rj, s.normal).greaterThan(0.0), () => {
      env.assign(mix(env, tracedReflection(pos.add(n.mul(2e-5)), rj, light, trace), sharpW));
    });
  });
  const own = envBRDFApprox(s.f0, mix(rough, float(0.08), s.mirror), nov).mul(env).add(s.albedo.mul(irradiance(light, acos(clamp(dot(n, up), -1, 1)))).mul(s.occlusion).div(Math.PI));

  // Unresolved tiles: their finishes' reflections in area shares, about the module facet.
  const col = own.toVar();
  If(s.mix.greaterThan(0.001), () => {
    const nm = s.mixNormal;
    const novm = max(dot(nm, v), 1e-3);
    const rm = normalize(d.sub(nm.mul(dot(d, nm).mul(2))));
    const erm = asin(clamp(dot(rm, up), -1, 1));
    const irr = irradiance(light, acos(clamp(dot(nm, up), -1, 1)));
    const acc = vec3(0).toVar();
    FINISHES.forEach((f, i) => {
      const w = [s.mixWeights.x, s.mixWeights.y, s.mixWeights.z, s.mixWeights.w][i];
      If(w.greaterThan(0.001), () => {
        const spread = sqrt(s.mixSpread.mul(s.mixSpread).add(s.mixKeep.mul(s.mixKeep).mul(f.tilt * f.tilt)));
        const rf = effectiveRoughness(f.roughness, spread);
        const lpre = f.mirror ? prefilteredMirror(light, erm, sqrt(spread.mul(spread).add(MIRROR_MICRO_SIGMA * MIRROR_MICRO_SIGMA))) : prefiltered(light, erm, rf);
        const spec = envBRDFApprox(vec3(...f.f0), f.mirror ? float(0.08) : rf, novm).mul(lpre);
        acc.addAssign(spec.add(vec3(...f.albedo).mul(irr).div(Math.PI)).mul(w));
      });
    });
    col.assign(mix(own, acc, s.mix));
  });

  // Rogue mirrors that mirror the star toward the viewer: point glints at the star's radiance.
  If(s.rogueWeight.greaterThan(0.0), () => {
    const nr = s.rogueNormal;
    const rr = normalize(d.sub(nr.mul(dot(d, nr).mul(2))));
    const toC = vec3(0, 1, 0).sub(pos);
    const dist = length(toC);
    const sinA = float(STAR_RADIUS_R).div(dist);
    const c = dot(rr, toC.div(dist));
    const sinPsi = sqrt(max(float(1).sub(c.mul(c)), 0.0));
    const mu = sqrt(max(float(1).sub(sinPsi.div(sinA).pow(2)), 0.0));
    const onDisc = select(c.greaterThan(sqrt(float(1).sub(sinA.mul(sinA)))).and(dot(rr, nr).greaterThan(0.0)), float(1), float(0));
    const star = vec3(...STAR_CENTER_RADIANCE).mul(vec3(mu).pow(vec3(...LIMB_DARKENING_EXPONENT)));
    col.addAssign(star.mul(vec3(...COLLECTOR_F0)).mul(onDisc).mul(s.rogueWeight));
  });
  return col.add(s.emission).mul(light.illuminant) as unknown as V3;
}

