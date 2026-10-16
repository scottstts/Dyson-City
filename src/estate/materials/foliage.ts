/**
 * Clipped foliage (docs/estate.md "Hedges"): yew and box seen as a mass of small leaves. The shears
 * leave a surface of leaf tips over deep pockets of shade; this is carried by two scales of
 * cellular structure (sprigs, and the pockets between them), the pockets darkening the albedo and
 * the tips catching the light. Up-facing surfaces carry the fresh, paler growth. A soft sheen
 * stands in for light scattered through the outer leaves.
 */
import { MeshPhysicalNodeMaterial, type Node } from 'three/webgpu';
import { float, vec3, positionWorld, normalWorldGeometry, fwidth, length, max, mix, smoothstep } from 'three/tsl';
import { cellular3, fbm3, valueNoise3 } from '../../render/tsl/noise';
import { lodFade } from '../../render/tsl/patterns';
import { heightBump } from '../../render/tsl/bump';

type F = Node<'float'>;

export function createHedgeMaterial(kind: 'yew' | 'box', name = `Estate.hedge.${kind}`): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const wp = positionWorld;
  const fp = max(length(fwidth(wp)), 1e-5) as F;
  const leafScale = kind === 'yew' ? 34 : 46;
  const sprig = cellular3(wp.mul(leafScale), float(0), float(0));
  const pocket = cellular3(wp.mul(leafScale / 5).add(9.1), float(0), float(0));
  const nearLeaf = lodFade(fp, 1.6 / leafScale);
  const nearPocket = lodFade(fp, 6 / leafScale);
  // Tips (1) to the shade between sprigs (0).
  const tip = smoothstep(0.75, 0.15, sprig.x).mul(nearLeaf).add(float(1).sub(nearLeaf).mul(0.55));
  const open = smoothstep(0.9, 0.35, pocket.x).mul(nearPocket).add(float(1).sub(nearPocket).mul(0.6));
  const depth = tip.mul(0.55).add(open.mul(0.45));
  const fresh = smoothstep(0.4, 0.9, normalWorldGeometry.y).mul(smoothstep(0.45, 0.8, fbm3(wp.mul(1.3), 3, fp.mul(1.3))));
  // Yew is dark, but it is a green, not a hole: albedo ~0.06 at its tips, more on new growth.
  const base = kind === 'yew' ? vec3(0.05, 0.085, 0.032) : vec3(0.07, 0.11, 0.035);
  const young = kind === 'yew' ? vec3(0.11, 0.15, 0.05) : vec3(0.13, 0.17, 0.05);
  const variation = valueNoise3(wp.mul(0.7)).sub(0.5);
  const leaf = mix(base, young, fresh.mul(0.7)).mul(float(1).add(variation.mul(0.25))).mul(float(1).add(sprig.z.sub(0.5).mul(0.3).mul(nearLeaf)));
  mat.colorNode = leaf.mul(mix(float(0.45), float(1.25), depth));
  mat.roughnessNode = float(0.62).add(float(1).sub(tip).mul(0.25));
  mat.metalnessNode = float(0);
  mat.sheenNode = mix(vec3(0.02, 0.035, 0.01), vec3(0.04, 0.06, 0.015), fresh);
  mat.sheenRoughnessNode = float(0.5);
  mat.normalNode = heightBump(depth.mul(0.03), 1);
  return mat;
}
