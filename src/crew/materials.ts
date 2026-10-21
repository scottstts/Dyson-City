/**
 * The crew's materials (docs/crew.md), one per slot, shared by every robot. The robots are of the
 * Dome's hand: a warm-white ceramic composite shell, glazed black at every joint and seam, satin
 * bronze fittings, graphite steel and chrome in the mechanisms; black glass for visors and lenses,
 * rubber where they meet the ground, gold foil on the drones' sensor heads.
 *
 * Robots move, so every pattern is in the part's own coordinates (positionGeometry): a world-space
 * pattern would swim across a walking limb. All detail fades to its mean by pixel footprint.
 *
 * Light: image-based only, as everywhere. The environment is the field's central probe, or on the
 * estate's terrace the estate's own (a robot in the garden reflects the garden); the AO term is
 * the star-shade where the robot stands (lighting/starShade.ts), which fades out 8 m over its floor.
 */
import { MeshPhysicalNodeMaterial, type Material, type Node } from 'three/webgpu';
import { abs, clamp, float, fwidth, length, max, mix, normalView, positionGeometry, smoothstep, vec3 } from 'three/tsl';
import { cellular3, fbm3, hash33, valueNoise3 } from '../render/tsl/noise';
import { lodFade } from '../render/tsl/patterns';

type F = Node<'float'>;

export const CREW_SLOT = {
  shell: 0,
  black: 1,
  graphite: 2,
  chrome: 3,
  bronze: 4,
  visor: 5,
  rubber: 6,
  foil: 7,
  gold: 8,
} as const;
export const CREW_SLOTS = 9;

/** Shell body colour (linear): a cleaner, slightly brighter white than the Dome's honed ceramic. */
export const SHELL_ALBEDO = vec3(0.7, 0.68, 0.64);

const p = positionGeometry;
const footprint = (scale: number): F => max(length(fwidth(p)), 1e-6).mul(scale) as F;

function shellMaterial(name: string): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const fp = footprint(1);
  // A cast composite under a satin glaze: faint cloud in tone, finer drift in the glaze's sheen.
  const cloud = fbm3(p.mul(6), 3, fp.mul(6)).sub(0.5);
  const grain = valueNoise3(p.mul(220)).sub(0.5).mul(lodFade(fp, 0.004));
  mat.colorNode = SHELL_ALBEDO.mul(float(1).add(cloud.mul(0.035)).add(grain.mul(0.02)));
  mat.roughnessNode = float(0.42).add(cloud.mul(0.06)).add(grain.mul(0.05));
  mat.metalnessNode = float(0);
  mat.clearcoatNode = float(0.35);
  mat.clearcoatRoughnessNode = float(0.16).add(cloud.mul(0.05));
  return mat;
}

function blackMaterial(name: string): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const fp = footprint(1);
  const cloud = fbm3(p.mul(5), 3, fp.mul(5)).sub(0.5);
  mat.colorNode = vec3(0.028, 0.027, 0.026).mul(float(1).add(cloud.mul(0.15)));
  mat.roughnessNode = float(0.45);
  mat.metalnessNode = float(0);
  mat.clearcoatNode = float(1);
  mat.clearcoatRoughnessNode = float(0.08).add(cloud.mul(0.04));
  return mat;
}

function metalMaterial(name: string, f0: Node<'vec3'>, rough: number, drift = 0.06): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const fp = footprint(1);
  const d = fbm3(p.mul(9), 3, fp.mul(9)).sub(0.5);
  const fine = valueNoise3(p.mul(400)).sub(0.5).mul(lodFade(fp, 0.002));
  mat.colorNode = f0.mul(float(0.96).add(d.mul(drift)));
  mat.metalnessNode = float(1);
  mat.roughnessNode = float(rough).add(d.mul(0.06)).add(fine.mul(0.04));
  return mat;
}

/** Black glass (visors, lenses): a near-black body under a hard, polished face. */
function visorMaterial(name: string): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  mat.colorNode = vec3(0.012, 0.012, 0.013);
  mat.roughnessNode = float(0.12);
  mat.metalnessNode = float(0);
  mat.clearcoatNode = float(1);
  mat.clearcoatRoughnessNode = float(0.02);
  mat.iorNode = float(1.52);
  return mat;
}

function rubberMaterial(name: string): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const fp = footprint(1);
  const g = valueNoise3(p.mul(300)).sub(0.5).mul(lodFade(fp, 0.003));
  mat.colorNode = vec3(0.035, 0.034, 0.033).mul(float(1).add(g.mul(0.3)));
  mat.roughnessNode = float(0.82).add(g.mul(0.1));
  mat.metalnessNode = float(0);
  return mat;
}

/** Gold foil on the sensor heads: crinkled film (cells of ~2 cm and ~6 mm), each cell its own tilt. */
function foilMaterial(name: string): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const fp = footprint(1);
  const c1 = cellular3(p.mul(45), float(0), float(0));
  const c2 = cellular3(p.mul(160).add(7), float(0), float(0));
  const f1 = lodFade(fp, 0.02);
  const f2 = lodFade(fp, 0.006);
  const r1 = hash33(vec3(c1.z.mul(9187), 3, 11)).sub(0.5);
  const r2 = hash33(vec3(c2.z.mul(7411), 5, 13)).sub(0.5);
  const crease = smoothstep(0.06, 0.0, c1.y.sub(c1.x)).mul(f1);
  // Each cell's film tilts at random: a random tilt needs no particular frame (view space serves).
  mat.normalNode = normalView.add(r1.mul(0.16).mul(f1).add(r2.mul(0.08).mul(f2))).normalize();
  const tone = float(0.93).add(r1.x.mul(0.1).mul(f1)).add(r2.y.mul(0.06).mul(f2));
  mat.colorNode = vec3(0.95, 0.72, 0.36).mul(tone).mul(float(1).add(crease.mul(0.2)));
  mat.roughnessNode = clamp(float(0.3).add(abs(r2.z).mul(0.14)).add(float(1).sub(f1).mul(0.12)), 0.2, 0.7);
  mat.metalnessNode = float(1);
  return mat;
}

export interface CrewLook {
  /** Environment for every slot (the probes' blend by place), or none (scene.environment). */
  env?: Node;
  /** The star-shade where the robot stands: the AO term. */
  ao?: () => F;
}

/** One material per slot. */
export function createCrewMaterials(look: CrewLook = {}): Material[] {
  const mats: MeshPhysicalNodeMaterial[] = [];
  mats[CREW_SLOT.shell] = shellMaterial('Crew.shell');
  mats[CREW_SLOT.black] = blackMaterial('Crew.black');
  mats[CREW_SLOT.graphite] = metalMaterial('Crew.graphite', vec3(0.34, 0.33, 0.32), 0.34);
  mats[CREW_SLOT.chrome] = metalMaterial('Crew.chrome', vec3(0.72, 0.72, 0.7), 0.1, 0.02);
  mats[CREW_SLOT.bronze] = metalMaterial('Crew.bronze', vec3(0.8, 0.62, 0.42), 0.3);
  mats[CREW_SLOT.visor] = visorMaterial('Crew.visor');
  mats[CREW_SLOT.rubber] = rubberMaterial('Crew.rubber');
  mats[CREW_SLOT.foil] = foilMaterial('Crew.foil');
  mats[CREW_SLOT.gold] = metalMaterial('Crew.gold', vec3(1.0, 0.77, 0.34), 0.32);
  for (const m of mats) {
    if (look.env) m.envNode = look.env;
    if (look.ao) m.aoNode = look.ao();
  }
  return mats;
}

/** Mixes two environments by a weight node (the estate's probe on its terrace, the field's elsewhere). */
export function blendEnv(a: Node, b: Node, w: F): Node {
  return mix(a as unknown as Node<'vec3'>, b as unknown as Node<'vec3'>, w) as unknown as Node;
}
