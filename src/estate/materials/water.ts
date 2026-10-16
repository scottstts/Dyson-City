/**
 * Still water, lily pads and flowers, and the estate's glass (docs/estate.md "Pond", "Glass").
 *
 * The pool is deep and dark: its water is a near-black mirror (water's F0 ≈ 0.02) whose faint
 * ripples (the Dome's slow air) break the reflections of the hedges and the sky. Glass is a thin
 * pane: the glasshouse's panes multiply what is behind by their transmittance and add their
 * Fresnel reflection (order-independent between panes); the carriage house's windows show an
 * unlit interior, so they are opaque dark glass.
 */
import { AddEquation, CustomBlending, DoubleSide, MeshBasicNodeMaterial, MeshPhysicalNodeMaterial, OneFactor, SrcColorFactor, ZeroFactor, type Node } from 'three/webgpu';
import { float, vec2, vec3, vec4, uniform, positionWorld, positionLocal, cameraPosition, normalize, dot, pow, clamp, mrt, mix, fwidth, length, max, normalWorldGeometry, smoothstep } from 'three/tsl';
import { fbm3, valueNoise3 } from '../../render/tsl/noise';
import { lodFade } from '../../render/tsl/patterns';
import { heightBump } from '../../render/tsl/bump';

type F = Node<'float'>;

/** Game time for the water's drift (estate.update sets it). */
export const waterTime = uniform(0);

export function createWaterMaterial(name = 'Estate.water'): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const p = positionWorld.xz;
  const fp = max(length(fwidth(p)), 1e-5) as F;
  const t = waterTime;
  // Two drifting ripple fields at a few centimetres, a few millimetres high.
  const a = fbm3(vec3(p.mul(2.2).add(vec2(t.mul(0.05), t.mul(0.03))), t.mul(0.07)), 3, fp.mul(2.2));
  const b = valueNoise3(vec3(p.mul(7).sub(vec2(t.mul(0.09), 0)), t.mul(0.2))).mul(lodFade(fp, 0.05));
  mat.colorNode = vec3(0.006, 0.01, 0.009);
  mat.roughnessNode = float(0.035);
  mat.metalnessNode = float(0);
  mat.iorNode = float(1.333);
  mat.normalNode = heightBump(a.mul(0.0025).add(b.mul(0.0008)), 1);
  return mat;
}

export function createPadMaterial(name = 'Estate.lilypad'): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const p = positionWorld.xz;
  const fp = max(length(fwidth(p)), 1e-5) as F;
  const veins = valueNoise3(vec3(p.mul(60), 2)).sub(0.5).mul(lodFade(fp, 0.01));
  const tone = fbm3(vec3(p.mul(4), 5), 3, fp.mul(4)).sub(0.5);
  const top = normalWorldGeometry.y.greaterThan(0.5);
  mat.colorNode = top.select(vec3(0.03, 0.07, 0.018).mul(float(1).add(tone.mul(0.5)).add(veins.mul(0.2))), vec3(0.12, 0.03, 0.03));
  mat.roughnessNode = float(0.32).add(veins.abs().mul(0.2));
  mat.metalnessNode = float(0);
  mat.sheenNode = vec3(0.03, 0.05, 0.02);
  return mat;
}

export function createLilyMaterial(name = 'Estate.lily'): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  // Pale pink petals, flushing deeper toward the base; the stamens' yellow at the heart.
  const r = length(positionLocal.xz);
  const heart = smoothstep(0.03, 0.012, r);
  const flush = smoothstep(0.09, 0.02, r);
  mat.colorNode = mix(mix(vec3(0.78, 0.62, 0.66), vec3(0.62, 0.32, 0.4), flush.mul(0.6)), vec3(0.62, 0.45, 0.04), heart);
  mat.roughnessNode = float(0.55);
  mat.metalnessNode = float(0);
  mat.sheenNode = vec3(0.2, 0.12, 0.14);
  mat.side = DoubleSide;
  return mat;
}

/** Glasshouse glass: the transmittance pass and the reflection pass (draw the first, then the second). */
export function createPaneMaterials(name = 'Estate.glass'): { transmit: MeshBasicNodeMaterial; reflect: MeshPhysicalNodeMaterial } {
  const n = normalWorldGeometry;
  const v = normalize(cameraPosition.sub(positionWorld));
  const c = clamp(dot(n, v).abs(), 0, 1);
  const F = float(0.04).add(float(0.96).mul(pow(float(1).sub(c), 5)));
  // Old horticultural glass: a faint green, a little dirt toward the bottom of each pane.
  const dirt = fbm3(positionWorld.mul(3.1), 3, float(0.01)).mul(0.12);
  const T = vec3(0.9, 0.94, 0.91).mul(float(1).sub(F)).mul(float(1).sub(dirt));
  const transmit = new MeshBasicNodeMaterial();
  transmit.name = `${name}.transmit`;
  transmit.lights = false;
  transmit.transparent = true;
  transmit.depthWrite = false;
  transmit.side = DoubleSide;
  transmit.blending = CustomBlending;
  transmit.blendEquation = AddEquation;
  transmit.blendSrc = ZeroFactor;
  transmit.blendDst = SrcColorFactor;
  transmit.blendSrcAlpha = ZeroFactor;
  transmit.blendDstAlpha = OneFactor;
  transmit.outputNode = vec4(T, 1);
  transmit.mrtNode = mrt({ normal: vec4(1), velocity: vec4(1) });
  // The reflection: specular only (black body), added over.
  const reflect = new MeshPhysicalNodeMaterial();
  reflect.name = `${name}.reflect`;
  reflect.colorNode = vec3(0);
  reflect.roughnessNode = float(0.03);
  reflect.metalnessNode = float(0);
  reflect.transparent = true;
  reflect.depthWrite = false;
  reflect.side = DoubleSide;
  reflect.blending = CustomBlending;
  reflect.blendEquation = AddEquation;
  reflect.blendSrc = OneFactor;
  reflect.blendDst = OneFactor;
  reflect.blendSrcAlpha = ZeroFactor;
  reflect.blendDstAlpha = OneFactor;
  reflect.mrtNode = mrt({ normal: vec4(0), velocity: vec4(0) });
  return { transmit, reflect };
}

/** Windows onto an unlit interior: opaque dark glass. */
export function createDarkGlassMaterial(name = 'Estate.darkglass'): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  mat.colorNode = vec3(0.012, 0.013, 0.014);
  mat.roughnessNode = float(0.04);
  mat.metalnessNode = float(0);
  mat.side = DoubleSide;
  return mat;
}
