/**
 * The estate's building materials beyond stone (docs/estate.md "Materials"): red brick in Flemish
 * bond (the kitchen garden's walls, the glasshouse's dwarf wall), slate in courses (the carriage
 * house), and painted clapboard in the house's pale blue. Metric UVs from the sweeps and boxes:
 * u along a run, v around; walls use world height for courses.
 */
import { MeshPhysicalNodeMaterial, type Node } from 'three/webgpu';
import { float, vec2, vec3, uv, positionWorld, normalWorldGeometry, fwidth, length, max, min, fract, floor, mix, smoothstep, select, abs, step } from 'three/tsl';
import { hash33, valueNoise3, fbm3 } from '../../render/tsl/noise';
import { band, lodFade } from '../../render/tsl/patterns';
import { heightBump } from '../../render/tsl/bump';
import { PAD_HEIGHT } from '../../ground/site';

type F = Node<'float'>;
type V2 = Node<'vec2'>;

/** (along, height) on vertical faces, plan on horizontal ones. */
function wallCoords(): { p: V2; top: F } {
  const top = smoothstep(0.6, 0.8, abs(normalWorldGeometry.y)) as F;
  // Along the face: the larger horizontal extent of the position, so boxes without run UVs still course.
  const along = select(abs(normalWorldGeometry.x).greaterThan(abs(normalWorldGeometry.z)), positionWorld.z, positionWorld.x);
  const p = select(top.greaterThan(0.5), positionWorld.xz, vec2(along, positionWorld.y)) as unknown as V2;
  return { p, top };
}

export function createBrickWallMaterial(name = 'Estate.brickwall'): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const { p, top } = wallCoords();
  const fp = max(length(fwidth(p)), 1e-5) as F;
  // Flemish bond: each course alternates stretchers (215 mm) and headers (102.5 mm), courses 75 mm.
  const course = floor(p.y.div(0.075));
  const unit = 0.3275;
  const shift = fract(course.mul(0.5)).mul(unit);
  const xx = p.x.add(shift);
  const cell = floor(xx.div(unit));
  const lx = fract(xx.div(unit)).mul(unit);
  const isHeader = step(0.2225, lx);
  const bx = select(isHeader.greaterThan(0.5), lx.sub(0.2225), lx);
  const bw = select(isHeader.greaterThan(0.5), float(0.105), float(0.2225));
  const ly = fract(p.y.div(0.075)).mul(0.075);
  const dist = select(top.greaterThan(0.5), float(1), min(min(bx, bw.sub(bx)), min(ly, float(0.075).sub(ly))));
  const id = vec3(cell, course, isHeader);
  const h = mix(vec3(0.5), hash33(id), lodFade(fp, 0.12));
  const joint = band(dist, 0.005, fp);
  const fire = fbm3(vec3(p.mul(25), h.x.mul(7)), 3, fp.mul(25)).sub(0.5).mul(lodFade(fp, 0.04));
  // Old reds, headers burnt darker (as in Flemish bond's chequer).
  const red = mix(vec3(0.27, 0.1, 0.055), vec3(0.36, 0.15, 0.08), h.x).mul(float(0.82).add(h.y.mul(0.3)).add(fire.mul(0.35)));
  const brick = mix(red, red.mul(vec3(0.6, 0.55, 0.6)), isHeader.mul(0.55));
  const splash = float(1).sub(smoothstep(PAD_HEIGHT + 1.6, PAD_HEIGHT + 2.1, positionWorld.y)).mul(0.25);
  const mortar = vec3(0.38, 0.35, 0.3);
  mat.colorNode = mix(brick.mul(float(1).sub(splash)), mortar, joint.mul(0.85));
  mat.roughnessNode = float(0.86).add(joint.mul(0.06));
  mat.metalnessNode = float(0);
  mat.normalNode = heightBump(fire.mul(0.0015).sub(joint.mul(0.004)), 1);
  return mat;
}

export function createSlateMaterial(name = 'Estate.slate'): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  // Courses run along the roof (u, the sweep's arc length) at 200 mm exposure up the slope (world y).
  const st = vec2(uv().x, positionWorld.y.mul(1.414));
  const fp = max(length(fwidth(st)), 1e-5) as F;
  const course = floor(st.y.div(0.2));
  const w = float(0.3);
  const xx = st.x.add(fract(course.mul(0.5)).mul(w));
  const cell = floor(xx.div(w));
  const lx = fract(xx.div(w)).mul(w);
  const ly = fract(st.y.div(0.2)).mul(0.2);
  const h = mix(vec3(0.5), hash33(vec3(cell, course, 3)), lodFade(fp, 0.15));
  const edge = band(min(lx, w.sub(lx)), 0.003, fp).mul(0.7);
  // The lower edge of each course casts a thin shadow line on the course below.
  const butt = smoothstep(0.012, 0.0, ly).mul(lodFade(fp, 0.02));
  const riven = valueNoise3(vec3(st.mul(vec2(40, 60)), h.x.mul(9))).sub(0.5).mul(lodFade(fp, 0.008));
  const slate = vec3(0.055, 0.06, 0.07).mul(float(0.85).add(h.x.mul(0.3)).add(riven.mul(0.2)));
  mat.colorNode = slate.mul(float(1).sub(edge.mul(0.5)).sub(butt.mul(0.6)));
  mat.roughnessNode = float(0.5).add(h.y.mul(0.15)).add(riven.mul(0.1));
  mat.metalnessNode = float(0);
  mat.normalNode = heightBump(ly.mul(0.04).mul(lodFade(fp, 0.05)).add(riven.mul(0.001)), 1);
  return mat;
}

/** Painted clapboard (the house's pale blue): 120 mm exposure, each board's lower edge proud. */
export function createClapboardMaterial(name = 'Estate.clapboard'): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const y = positionWorld.y;
  const fp = max(length(fwidth(y)), 1e-5) as F;
  const lap = fract(y.div(0.12));
  const near = lodFade(fp, 0.02);
  // Height profile across a board: thick at its foot, feathered at its top (a tapered siding board).
  const profile = float(1).sub(lap).mul(0.012).mul(near);
  const shadow = smoothstep(0.0, 0.08, lap).mul(near).add(float(1).sub(near).mul(0.9));
  const grain = valueNoise3(positionWorld.mul(vec3(4, 60, 4))).sub(0.5).mul(lodFade(fp, 0.01));
  const paint = vec3(0.33, 0.43, 0.57).mul(float(0.97).add(grain.mul(0.05)));
  mat.colorNode = paint.mul(mix(float(0.55), float(1), shadow));
  mat.roughnessNode = float(0.45).add(grain.mul(0.1));
  mat.metalnessNode = float(0);
  mat.normalNode = heightBump(profile, 1);
  return mat;
}
