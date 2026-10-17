/**
 * Foliage and bark (docs/estate.md "Planting").
 *
 * Foliage: every leaf card (trees and shrubs) in one material on the leaf atlas.
 *  - Lit like everything outdoors (image-based light). The card's crown-depth shade is its ambient
 *    occlusion: inner and lower leaves see less of the star.
 *  - Its normal is the rounded crown normal from the geometry, on both faces (a card's own face
 *    normal would light each sprig as a flat plane).
 *  - Translucency: a leaf seen from below is lit through by the sky above it: a leaf transmits about
 *    as much as it reflects (~0.1–0.2 in the green, yellowed). Under a star fixed overhead the
 *    undersides of canopies glow; a leaf's upper face shows only a little of it (LEAF_TRANSMISSION).
 *  - Wind: the Dome's air circulates faintly; each card turns a little about its root (rooted, so a
 *    sprig never leaves its twig).
 *  - Distance: no impostors and no swaps. Each card has a stable rank; with distance the lowest
 *    ranks dissolve out (beyond 70 m, to 40 % kept by 320 m) while the survivors grow about their
 *    roots to keep the crown's coverage, so a canopy thins card by card and keeps its silhouette.
 *
 * Bark: ridged and fissured along the wood (u around in 35 cm wraps, v along in 60 cm units).
 */
import { DoubleSide, MeshPhysicalNodeMaterial, type Node, type Texture } from 'three/webgpu';
import { float, vec3, attribute, positionLocal, cameraPosition, texture, uv, normalViewGeometry, faceDirection, normalWorldGeometry, mix, max, sin, clamp, smoothstep, floor, length, fwidth, positionWorld, abs, pmremTexture } from 'three/tsl';
import { hash33, valueNoise3, fbm3 } from '../../render/tsl/noise';
import { lodFade } from '../../render/tsl/patterns';
import { heightBump } from '../../render/tsl/bump';
import { waterTime } from '../materials/water';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

/**
 * Light through a leaf relative to its albedo (a leaf transmits about what it reflects), and the
 * share seen on a face turned up toward the light (most of what passes leaves the far face).
 */
export const LEAF_TRANSMISSION = { gain: 1.0, upper: 0.15 } as const;

/** Ranks: cards dissolve from 70 m and keep 40 % at 320 m. */
export const FOLIAGE_LOD = { start: 70, end: 320, keep: 0.4 } as const;

export function createFoliageMaterial(atlas: Texture, env: Texture | null, name = 'Estate.foliage'): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  mat.side = DoubleSide;
  const root = attribute('root', 'vec3') as unknown as V3;
  const shade = attribute('shade', 'float') as unknown as F;
  // A stable random per card (its root is unique to it).
  const h = hash33(floor(root.mul(97)));
  // Distance thinning (vertex): the kept fraction and each card's growth to hold coverage.
  const dist = length(cameraPosition.sub(root));
  const kept = clamp(float(1).sub(dist.sub(FOLIAGE_LOD.start).div(FOLIAGE_LOD.end - FOLIAGE_LOD.start).mul(1 - FOLIAGE_LOD.keep)), FOLIAGE_LOD.keep, 1);
  const grow = float(1).div(kept.sqrt());
  // Wind: a slow turn and a little flutter about the root, larger at the card's tip.
  const t = waterTime;
  const phase = h.x.mul(6.283);
  const sway = sin(t.mul(0.55).add(phase)).mul(0.6).add(sin(t.mul(1.7).add(phase.mul(2.3))).mul(0.3));
  const rel = positionLocal.sub(root);
  const reach = length(rel);
  const wind = vec3(sway.mul(0.03), sway.mul(0.008), sin(t.mul(0.43).add(phase.mul(1.7))).mul(0.02)).mul(reach);
  mat.positionNode = root.add(rel.mul(grow)).add(wind);
  // Fragment: alpha test, and dissolve by rank (a card is in or out: no partial transparency).
  const tex = texture(atlas, uv());
  const rank = h.y;
  const keep = rank.lessThan(kept).select(float(1), float(0));
  mat.alphaTestNode = float(0.5);
  mat.opacityNode = tex.a.mul(keep);
  mat.transparent = false;
  const tint = mix(vec3(0.92, 0.95, 0.9), vec3(1.08, 1.04, 0.96), h.z);
  const albedo = tex.rgb.mul(tint);
  mat.colorNode = albedo;
  mat.roughnessNode = float(0.62);
  mat.metalnessNode = float(0);
  mat.normalNode = normalViewGeometry;
  mat.aoNode = shade;
  mat.sheenNode = albedo.mul(0.4);
  mat.sheenRoughnessNode = float(0.55);
  // Translucency: the side of a card seen from below passes the light from above it.
  if (env) {
    const above = pmremTexture(env, vec3(0, 1, 0), float(1)) as unknown as V3;
    const seenFace = normalWorldGeometry.mul(faceDirection);
    const below = clamp(seenFace.y.negate(), 0, 1);
    const facing = below.mul(1 - LEAF_TRANSMISSION.upper).add(LEAF_TRANSMISSION.upper);
    mat.emissiveNode = albedo.mul(vec3(1.05, 1.1, 0.7)).mul(LEAF_TRANSMISSION.gain).mul(above).mul(facing).mul(shade);
  }
  return mat;
}

export function createBarkMaterial(colour: [number, number, number], fissure: number, name = 'Estate.bark'): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const st = uv();
  const fp = max(length(fwidth(st)), 1e-5) as F;
  // Ridges along the wood: noise stretched along v, sharpened into plates and fissures.
  const n = fbm3(vec3(st.x.mul(3.2), st.y.mul(0.55), 1), 4, fp.mul(3));
  const ridge = float(1).sub(abs(n.sub(0.5)).mul(2)).pow(1.6);
  const plates = smoothstep(0.25, 0.75, ridge).mul(fissure).add(float(1 - fissure).mul(0.6));
  const fine = valueNoise3(vec3(st.mul(30), 3)).sub(0.5).mul(lodFade(fp, 0.05));
  const lichen = smoothstep(0.62, 0.8, fbm3(positionWorld.mul(1.7), 3, fp)).mul(0.4);
  const bark = vec3(...colour).mul(mix(float(0.55), float(1.15), plates)).mul(float(1).add(fine.mul(0.2)));
  mat.colorNode = mix(bark, vec3(0.16, 0.18, 0.1), lichen);
  mat.roughnessNode = float(0.88);
  mat.metalnessNode = float(0);
  mat.normalNode = heightBump(plates.mul(0.012).mul(fissure).add(fine.mul(0.002)), 1);
  return mat;
}
