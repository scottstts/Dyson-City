/**
 * The engines' burn (docs/vehicles.md): a hot, optically thin exhaust jet behind each nozzle.
 *
 * Each jet is drawn as one closed shell that only bounds it; the shell's pixels integrate the jet
 * along the view ray analytically. The jet is a hot gas, emitting and absorbing, whose density is a
 * Gaussian column about its axis widening downstream. Its optical depth along a ray is
 *
 *   τ = κ · n(x) · ∫ exp(−2 r²/ρ²) dl  =  κ · n · exp(−2 d²/ρ²) · ρ √(π/2) / sin θ
 *
 * (d the ray's closest approach to the axis, x the axial station there, ρ the jet's width, θ the
 * angle between the ray and the axis), and its radiance B(T)·(1 − e^−τ): Planck at the gas's
 * temperature on the star's radiance scale (sky/structure/thermal.ts), saturating where the jet is
 * thick (its white-hot core at the exit) and thin and faint at its fringe and downstream. No
 * marching, no sorting of slices: one closed form per pixel, smooth from every side, down the jet's
 * own axis included.
 *
 * Downstream the gas cools and thins. A jet leaving a nozzle into the Dome's 1 bar air is
 * off-design, so it carries a train of shock diamonds about 1.5 exit diameters apart: at each the
 * gas is recompressed and a little hotter, which Planck's steepness turns into a bright knot; they
 * fade downstream. Turbulence is a noise field advected with the exhaust. Length, temperature and
 * density follow the burn; the exit stays cooler than the star's photosphere.
 *
 * Additive, drawn after the opaque scene with no depth write. Under non-normal blending three
 * replaces the other attachments, so the shell writes its own normal (no contact AO) and velocity.
 */
import { AdditiveBlending, BackSide, CylinderGeometry, Group, Matrix4, Mesh, MeshBasicNodeMaterial, Vector3 } from 'three/webgpu';
import { Fn, cameraPosition, dot, exp, float, length, max, min, mix, mrt, normalize, positionWorld, pow, smoothstep, sqrt, uniform, vec3, vec4, velocity, cos, fract } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { EMISSIVITY, glowNode } from '../../sky/structure/thermal';
import { valueNoise3 } from '../../render/tsl/noise';
import { noContactNormal } from '../materials';
import { BELL_LENGTH, CRAFT_ENGINES, type CraftEngine } from './model';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

/** The jet, in exit radii: its full length, its spread to the far end, the shell's margin over ρ. */
export const PLUME = {
  length: 16,
  spread: 1.6,
  margin: 2.4,
  /** Gas temperature at the exit (K): idling and at full burn; the far end is this times `cooled`. */
  exitIdle: 2600,
  exitFull: 5200,
  cooled: 0.55,
  /** Absorption (and so emission) per metre of column at the exit's density (world metres). */
  kappa: 1.1,
  /** Exhaust velocity carrying the turbulence (m/s, world). */
  flow: 90,
  /** Shock diamonds: spacing in exit diameters and the recompression's temperature rise at full burn. */
  diamondSpacing: 1.5,
  diamondHeat: 0.08,
} as const;

/** The exit radius of an engine's jet (the bell's inner lip: the lathe profile's r·0.77). */
export function exitRadius(e: CraftEngine): number {
  return e.r * 0.77;
}

export interface Plumes {
  readonly group: Group;
  /** Per frame (after the ship is posed): the burn (0 idle … 1 full) and the game time. */
  update(burn: number, time: number): void;
}

interface Jet {
  origin: { value: Vector3 };
  axis: { value: Vector3 };
  /** World exit radius and current length. */
  re: { value: number };
  len: { value: number };
  mesh: Mesh;
  engine: CraftEngine;
}

/** Builds the jets as children of the ship's group (ref coordinates; the group carries the scale). */
export function createPlumes(scale: number): Plumes {
  const group = new Group();
  group.name = 'Craft.plumes';
  const burnU = uniform(0);
  const timeU = uniform(0);
  const jets: Jet[] = CRAFT_ENGINES.map((e, i) => {
    const re = exitRadius(e);
    const L = PLUME.length * re;
    const r0 = re * PLUME.margin;
    const r1 = re * (1 + PLUME.spread) * PLUME.margin;
    const g = new CylinderGeometry(r1, r0, L, 40, 1, false);
    // Cylinder along +y, centred: start it at the bell's exit, along +z (the exhaust's way).
    const z0 = e.z + BELL_LENGTH - 0.06;
    g.applyMatrix4(new Matrix4().makeTranslation(0, L / 2, 0));
    g.applyMatrix4(new Matrix4().makeRotationX(Math.PI / 2));
    g.applyMatrix4(new Matrix4().makeTranslation(e.x, e.y, z0));
    const origin = uniform(new Vector3());
    const axis = uniform(new Vector3(0, 0, 1));
    const reU = uniform(re * scale);
    const lenU = uniform(L * scale);
    const mat = new MeshBasicNodeMaterial();
    mat.name = `Craft.plume${i}`;
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = AdditiveBlending;
    // Back faces: the shell is drawn once per pixel whether the eye is outside it or inside it.
    mat.side = BackSide;
    mat.fog = false;
    mat.outputNode = vec4(jetRadiance(origin as unknown as V3, axis as unknown as V3, reU as unknown as F, lenU as unknown as F, burnU as unknown as F, timeU as unknown as F, float(L * scale)), 1);
    mat.mrtNode = mrt({ normal: noContactNormal(), velocity });
    const mesh = new Mesh(g, mat);
    mesh.name = `Craft.plume${i}`;
    mesh.frustumCulled = true;
    mesh.renderOrder = 10;
    group.add(mesh);
    return { origin: origin as unknown as { value: Vector3 }, axis: axis as unknown as { value: Vector3 }, re: reU as unknown as { value: number }, len: lenU as unknown as { value: number }, mesh, engine: e };
  });
  const tmp = new Vector3();
  return {
    group,
    update(burn, time) {
      (burnU as unknown as { value: number }).value = burn;
      (timeU as unknown as { value: number }).value = time;
      group.updateWorldMatrix(true, false);
      const m = group.matrixWorld;
      for (const j of jets) {
        const e = j.engine;
        j.origin.value.set(e.x, e.y, e.z + BELL_LENGTH - 0.06).applyMatrix4(m);
        tmp.set(0, 0, 1).transformDirection(m);
        j.axis.value.copy(tmp);
        j.len.value = PLUME.length * exitRadius(e) * scale * mix01(0.22, 1, burn);
        // No burn, no jet: skip its pixels entirely.
        j.mesh.visible = burn > 0.01;
      }
    },
  };
}

function mix01(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

/** The jet's radiance along the view ray through a shell pixel (see the module note). */
export function jetRadiance(origin: V3, axis: V3, re: F, len: F, burn: F, time: F, shellLen: F): V3 {
  return Fn(() => {
    const v = normalize(positionWorld.sub(cameraPosition));
    const w0 = cameraPosition.sub(origin);
    const b = dot(v, axis);
    const dd = dot(v, w0);
    const e = dot(axis, w0);
    const denom = max(float(1).sub(b.mul(b)), 1e-4);
    const tc = b.mul(e).sub(dd).div(denom).max(0);
    const sc = e.sub(b.mul(dd)).div(denom);
    const closest = w0.add(v.mul(tc)).sub(axis.mul(sc));
    const dist = length(closest);
    const x = sc.div(len);
    const xs = sc.div(shellLen);
    const rho = re.mul(float(1).add(xs.clamp(0, 1).mul(PLUME.spread)));
    const sinT = sqrt(denom).max(0.22);
    const column = exp(dist.mul(dist).div(rho.mul(rho)).mul(-2)).mul(rho).mul(Math.sqrt(Math.PI / 2)).div(sinT);
    // Downstream: thinning and cooling, gone by the jet's end; nothing upstream of the exit.
    const inside = smoothstep(-0.02, 0.03, x).mul(float(1).sub(smoothstep(0.55, 1, x)));
    const density = exp(x.clamp(0, 1).mul(-1.6)).mul(inside);
    // Shock diamonds: knots ~1.5 exit diameters apart, sharp, fading downstream; stronger at full burn.
    const knot = sc.div(re.mul(2 * PLUME.diamondSpacing));
    const diamond = pow(cos(fract(knot).sub(0.5).mul(Math.PI)).max(0), 10)
      .mul(exp(x.clamp(0, 1).mul(-4.5)))
      .mul(smoothstep(0.25, 0.8, knot))
      .mul(burn.mul(PLUME.diamondHeat));
    const exitT = mix(float(PLUME.exitIdle), float(PLUME.exitFull), burn);
    const T = exitT.mul(mix(float(1), float(PLUME.cooled), pow(x.clamp(0, 1), 0.8))).mul(float(1).add(diamond));
    // Turbulence advected with the flow, finer near the exit where the shear layer is thin.
    const q = closest.add(axis.mul(sc.sub(time.mul(PLUME.flow))));
    const turb = valueNoise3(q.div(re.mul(1.1)))
      .mul(0.6)
      .add(valueNoise3(q.div(re.mul(0.45))).mul(0.4))
      .sub(0.5);
    const flicker = float(1).add(turb.mul(mix(float(0.35), float(0.7), smoothstep(0, 0.6, x))));
    const tau = column.mul(density).mul(flicker.max(0)).mul(PLUME.kappa);
    // glowNode carries the alloy's emissivity; the gas's own is (1 − e^−τ).
    const glow = glowNode(T).div(EMISSIVITY).mul(float(1).sub(exp(tau.negate())));
    // Very near the camera the jet thins away rather than filling the lens.
    const near = smoothstep(0.5, 3, tc);
    return min(glow.mul(near), vec3(60));
  })() as unknown as V3;
}

/** The jets' parameters at a burn, for tests. */
export function plumeLength(e: CraftEngine, scale: number, burn: number): number {
  return PLUME.length * exitRadius(e) * scale * mix01(0.22, 1, burn);
}
