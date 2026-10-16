/**
 * The estate's masonry (docs/estate.md "Masonry"): honey sandstone ashlar for the retaining walls
 * and the kitchen garden's piers; cream limestone for everything dressed (the balustrade, copings,
 * piers, kerbs, steps, urns). World-space procedural PBR on metric UVs (sweeps: u along the run in
 * metres), every detail fading with the pixel footprint.
 *
 * Worn by use, not grimy: a little darkening and green at the foot of walls where rain splash
 * would sit, faint runs under copings, lichen spots on up-facing stone.
 */
import { MeshPhysicalNodeMaterial, type Node } from 'three/webgpu';
import { float, vec2, vec3, uv, positionWorld, normalWorldGeometry, fwidth, length, max, min, fract, floor, mix, smoothstep, select } from 'three/tsl';
import { hash33, valueNoise3, fbm3, cellular3 } from '../../render/tsl/noise';
import { band, lodFade } from '../../render/tsl/patterns';
import { heightBump } from '../../render/tsl/bump';
import { PAD_HEIGHT } from '../../ground/site';

type F = Node<'float'>;
type V2 = Node<'vec2'>;

/** Course height of the walls' ashlar (m). */
export const ASHLAR_COURSE = 0.34;

/** Plan-or-elevation coordinates: (along the run, height) on walls; plan on tops. */
function faceCoords(): { p: V2; top: F } {
  const n = normalWorldGeometry;
  const top = smoothstep(0.6, 0.8, n.y);
  const along = uv().x;
  const p = select(top.greaterThan(0.5), positionWorld.xz, vec2(along, positionWorld.y)) as unknown as V2;
  return { p, top: top as F };
}

/** Weathering: splash at the foot of walls, runs under copings, lichen on tops. */
function weather(p: V2, top: F, fp: F): { dark: F; green: F } {
  const y = positionWorld.y;
  const splash = float(1).sub(smoothstep(PAD_HEIGHT, PAD_HEIGHT + 0.45, y)).mul(float(1).sub(top));
  const runs = fbm3(vec3(p.x.mul(6), y.mul(0.35), 3), 3, fp.mul(6)).sub(0.5);
  const lichen = smoothstep(0.62, 0.78, fbm3(vec3(positionWorld.xz.mul(4), y.mul(4)), 4, fp.mul(4))).mul(lodFade(fp, 0.05));
  return { dark: splash.mul(0.35).add(runs.mul(0.12).mul(float(1).sub(top))), green: splash.mul(0.4).add(lichen.mul(top).mul(0.5)) as F };
}

export function createAshlarMaterial(name = 'Estate.sandstone'): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const { p, top } = faceCoords();
  const fp = max(length(fwidth(p)), 1e-5) as F;
  // Courses (by height) of blocks 0.7–1.3 m long, each course's joints staggered.
  const course = floor(p.y.div(ASHLAR_COURSE));
  const hc = hash33(vec3(course, 3, 9));
  const len = float(0.7).add(hc.x.mul(0.6));
  const xx = p.x.add(hc.y.mul(5));
  const block = floor(xx.div(len));
  const lx = fract(xx.div(len)).mul(len);
  const ly = fract(p.y.div(ASHLAR_COURSE)).mul(ASHLAR_COURSE);
  const dist = select(top.greaterThan(0.5), float(1), min(min(lx, len.sub(lx)), min(ly, float(ASHLAR_COURSE).sub(ly))));
  const id = vec3(block, course, 1);
  const h = mix(vec3(0.5), hash33(id), lodFade(fp, 0.3));
  const joint = band(dist, 0.0045, fp);
  // Tooled face: fine horizontal droving and a slightly pitched (cushioned) block.
  const droving = valueNoise3(vec3(p.x.mul(90), p.y.mul(9), h.x.mul(13))).sub(0.5).mul(lodFade(fp, 0.006));
  const cushion = smoothstep(0, 0.05, dist).mul(lodFade(fp, 0.05));
  const bed = fbm3(vec3(p.mul(vec2(1.5, 10)), h.z.mul(5)), 3, fp.mul(4)).sub(0.5);
  const w = weather(p, top, fp);
  // Blocks from one quarry: close in tone; the bedding and the tooling carry the texture.
  const stone = mix(vec3(0.4, 0.31, 0.2), vec3(0.44, 0.34, 0.215), h.x).mul(float(0.95).add(h.y.mul(0.08)).add(bed.mul(0.14)).add(droving.mul(0.1)));
  const weathered = mix(stone.mul(float(1).sub(w.dark)), vec3(0.08, 0.1, 0.05), w.green.clamp(0, 0.6));
  // Lime mortar, a little paler than the stone, slightly recessed.
  mat.colorNode = mix(weathered, vec3(0.42, 0.38, 0.31), joint.mul(0.8));
  mat.roughnessNode = float(0.84).add(joint.mul(0.08)).add(droving.mul(0.05));
  mat.metalnessNode = float(0);
  mat.normalNode = heightBump(cushion.mul(0.006).add(droving.mul(0.0008)).sub(joint.mul(0.006)), 1);
  return mat;
}

export function createLimestoneMaterial(name = 'Estate.limestone'): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const { p, top } = faceCoords();
  const fp = max(length(fwidth(p)), 1e-5) as F;
  // Dressed lengths: a joint every 0.9–1.5 m along a run (rails, copings, kerbs).
  const seg = floor(p.x.div(1.2));
  const hs = hash33(vec3(seg, 7, 2));
  const along = fract(p.x.div(1.2)).mul(1.2);
  const joint = select(top.greaterThan(0.5), float(0), band(min(along, float(1.2).sub(along)), 0.0025, fp));
  const h = mix(vec3(0.5), hs, lodFade(fp, 0.3));
  const pores = cellular3(vec3(positionWorld.mul(55)), float(0), float(0));
  const pore = smoothstep(0.14, 0.05, pores.x).mul(select(pores.z.lessThan(0.25), float(1), float(0))).mul(lodFade(fp, 0.01));
  const shell = valueNoise3(vec3(positionWorld.mul(160))).sub(0.5).mul(lodFade(fp, 0.006));
  const cloud = fbm3(vec3(positionWorld.mul(2.5)), 3, fp.mul(2.5)).sub(0.5);
  const w = weather(p, top, fp);
  const stone = vec3(0.6, 0.55, 0.46).mul(float(0.94).add(h.x.mul(0.08)).add(cloud.mul(0.08)).add(shell.mul(0.05)).sub(pore.mul(0.2)));
  const weathered = mix(stone.mul(float(1).sub(w.dark.mul(0.8))), vec3(0.1, 0.12, 0.07), w.green.clamp(0, 0.5));
  mat.colorNode = weathered.mul(float(1).sub(joint.mul(0.4)));
  mat.roughnessNode = float(0.72).add(pore.mul(0.2)).add(cloud.mul(0.06));
  mat.metalnessNode = float(0);
  mat.normalNode = heightBump(shell.mul(0.0005).sub(pore.mul(0.0006)).sub(joint.mul(0.002)), 1);
  return mat;
}
