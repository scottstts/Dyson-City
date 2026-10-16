/**
 * The estate's ground (docs/estate.md "Ground"): world-space procedural PBR, every detail fading to
 * its mean with the pixel footprint. Surfaces are horizontal; patterns run in plan (x, z).
 *
 *  - Lawn: a fine mown sward. Its stripes are not colour: the mower lays the blades over in
 *    alternate directions, and a blade laid away from the eye shows its sunlit flank while one laid
 *    toward it shows its tip and the shade under it. So the stripes depend on where the eye
 *    stands: they read from the porch (they run on the house's axis) and fade side-on.
 *  - Meadow: the orchard's long grass, coarser and yellower, with seed heads.
 *  - Gravel: golden pea shingle, each stone its own tone, rounded.
 *  - Soil: the beds' dark tilth with crumbs and a little bark mulch.
 *  - Flags: riven York stone in random rectangles.
 *  - Brick: old red paviors in herringbone with mossy joints.
 */
import { MeshPhysicalNodeMaterial, type Node } from 'three/webgpu';
import { float, vec2, vec3, positionWorld, cameraPosition, normalize, fwidth, length, max, min, abs, fract, floor, mix, smoothstep, select, dot, step } from 'three/tsl';
import { hash33, valueNoise3, fbm3, cellular3 } from '../../render/tsl/noise';
import { band, lodFade } from '../../render/tsl/patterns';
import { heightBump } from '../../render/tsl/bump';
import { HOUSE_F } from '../layout';

type F = Node<'float'>;
type V2 = Node<'vec2'>;

const plan = () => positionWorld.xz as unknown as V2;
const footprint = (p: V2) => max(length(fwidth(p)), 1e-5) as F;

/** Mowing stripes: width (m), along the house's axis. */
export const LAWN_STRIPE = 1.2;

/**
 * The lawn's ground. Near the eye, where blades stand on it (grass.ts), it is the shade among the
 * blades' feet: darker, over exactly the distance the blades fade, so blades and ground hand over
 * without a line. `under` is the blades' reach [fade start, fade end] (m).
 */
export function createLawnMaterial(name = 'Estate.lawn', meadow = false, under: [number, number] | null = null): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const p = plan();
  const fp = footprint(p);
  // Sward: blade-scale streaks (1–3 mm) and leaf-scale clumps (2–5 cm), each fading out.
  const blade = valueNoise3(vec3(p.mul(vec2(380, 260)), 1)).sub(0.5).mul(lodFade(fp, 0.004));
  const clump = fbm3(vec3(p.mul(28), 3), 3, fp.mul(28)).sub(0.5).mul(lodFade(fp, 0.04));
  // Patches (a few metres): wear, moisture, clover.
  const patch = fbm3(vec3(p.mul(0.22), 7), 4, fp.mul(0.22)).sub(0.5);
  const dry = smoothstep(0.1, 0.32, fbm3(vec3(p.mul(0.07), 11), 3, fp.mul(0.07)).sub(0.5).add(patch.mul(0.4)));
  // Turf seen from above is its blades, not soil: visible reflectance ~0.1 (green ~0.13, red and blue far less).
  const green = meadow ? vec3(0.075, 0.098, 0.032) : vec3(0.056, 0.1, 0.032);
  const yellow = meadow ? vec3(0.14, 0.128, 0.056) : vec3(0.088, 0.108, 0.044);
  const dark = vec3(0.04, 0.078, 0.028);
  let albedo = mix(mix(green, dark, smoothstep(0, -0.3, patch).mul(0.6)), yellow, dry.mul(meadow ? 0.6 : 0.35));
  albedo = albedo.mul(float(1).add(blade.mul(meadow ? 0.7 : 0.5)).add(clump.mul(0.45)));
  if (meadow) {
    // Seed heads and dry stems catch the light in the long grass.
    const heads = smoothstep(0.72, 0.9, valueNoise3(vec3(p.mul(45), 5))).mul(lodFade(fp, 0.03));
    albedo = mix(albedo, vec3(0.22, 0.19, 0.11), heads.mul(0.5));
  }
  // Stripes (lawn only): blade lean along ±F, alternating; brightness by the eye's horizontal bearing.
  let stripe: F = float(0);
  if (!meadow) {
    const f = vec2(HOUSE_F[0], HOUSE_F[1]);
    const across = dot(p, vec2(-HOUSE_F[1], HOUSE_F[0]));
    const parity = step(0.5, fract(across.div(LAWN_STRIPE * 2))).mul(2).sub(1);
    // Mown edges are soft (a few cm), and the stripe dissolves where a pixel spans it.
    const fr = fract(across.div(LAWN_STRIPE));
    const edge = smoothstep(0, 0.06, min(fr, float(1).sub(fr)).mul(LAWN_STRIPE));
    const toEye = cameraPosition.xz.sub(p);
    const bearing = dot(normalize(toEye), f);
    stripe = parity.mul(bearing).mul(edge).mul(lodFade(fp, LAWN_STRIPE * 4)) as F;
  }
  // Where blades stand, the ground drawn under them is their shaded bases: a little darker, never soil-dark.
  const shadeUnder = under ? float(1).sub(smoothstep(under[0], under[1], length(cameraPosition.xz.sub(p)))).mul(meadow ? 0.22 : 0.12) : float(0);
  mat.colorNode = albedo.mul(float(1).add(stripe.mul(0.13))).mul(float(1).sub(shadeUnder));
  mat.roughnessNode = float(meadow ? 0.86 : 0.78).sub(stripe.mul(0.06)).add(blade.abs().mul(0.1));
  mat.metalnessNode = float(0);
  // Leaves scatter light through: a soft sheen at grazing angles.
  mat.sheenNode = vec3(0.06, 0.09, 0.03);
  mat.sheenRoughnessNode = float(0.6);
  // Gentle: the sward is a surface of blades lying every way, and steep bump slopes (blade noise at
  // 380/m) tip the normals away from the star and blacken the lawn.
  mat.normalNode = heightBump(clump.mul(0.003).add(blade.mul(0.0002)), 1);
  return mat;
}

export function createGravelMaterial(name = 'Estate.gravel'): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const p = plan();
  const fp = footprint(p);
  // Two layers of rounded stones (10–16 mm) at different scales; the higher stone at a point is the
  // one seen, so they overlap and pack like real shingle instead of tiling like crazy paving.
  const near = lodFade(fp, 0.012);
  const c1 = cellular3(vec3(p.mul(1 / 0.013), 0), float(0), float(0));
  const c2 = cellular3(vec3(p.mul(1 / 0.0095).add(17.3), 1), float(0), float(0));
  const dome = (d: F) => float(1).sub(d.mul(d).mul(1.7)).max(0).sqrt();
  const h1 = dome(c1.x);
  const h2 = dome(c2.x).mul(0.9);
  const first = h1.greaterThan(h2);
  const height = max(h1, h2);
  const id = select(first, c1.z, c2.z.add(0.5).fract());
  const h = hash33(vec3(id.mul(997), 3, 1));
  // Shingle: buff and honey flint-gravel, some cream, grey and brown, a little white quartz.
  let stone = mix(vec3(0.33, 0.29, 0.22), vec3(0.39, 0.32, 0.22), h.x);
  stone = mix(stone, vec3(0.47, 0.44, 0.37), step(0.62, h.y));
  stone = mix(stone, vec3(0.22, 0.21, 0.2), step(0.8, h.z));
  stone = mix(stone, vec3(0.19, 0.13, 0.085), step(0.9, h.x).mul(step(h.y, 0.5)));
  stone = mix(stone, vec3(0.55, 0.53, 0.5), step(0.965, h.y));
  stone = stone.mul(float(0.82).add(h.z.mul(0.3)));
  // Crevices between stones are deep and dark.
  const cavity = smoothstep(0.0, 0.45, height);
  const close = stone.mul(mix(float(0.22), float(1), cavity));
  // Beyond the stones: a fine speckle (the stones' mean variance), then the mean.
  const speckle = valueNoise3(vec3(p.mul(70), 4)).sub(0.5).mul(lodFade(fp, 0.05));
  const mean = vec3(0.3, 0.265, 0.205).mul(float(1).add(speckle.mul(0.5)));
  const ruts = fbm3(vec3(p.mul(0.6), 2), 3, fp.mul(0.6)).sub(0.5);
  mat.colorNode = mix(mean, close, near).mul(float(1).add(ruts.mul(0.1)));
  mat.roughnessNode = float(0.8).add(h.y.mul(0.1)).add(float(1).sub(cavity).mul(near).mul(0.1));
  mat.metalnessNode = float(0);
  mat.normalNode = heightBump(height.mul(near).mul(0.006).add(speckle.mul(0.0008)), 1);
  return mat;
}

export function createSoilMaterial(name = 'Estate.soil'): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const p = plan();
  const fp = footprint(p);
  const crumbs = cellular3(vec3(p.mul(70), 0), float(0), float(0));
  const near = lodFade(fp, 0.02);
  const clod = fbm3(vec3(p.mul(9), 4), 3, fp.mul(9)).sub(0.5);
  const mulch = smoothstep(0.55, 0.75, fbm3(vec3(p.mul(1.4), 8), 3, fp.mul(1.4)));
  const bark = cellular3(vec3(p.mul(vec2(22, 38)), 2), float(0), float(0));
  const chip = smoothstep(0.3, 0.12, bark.x).mul(mulch).mul(near);
  const soil = vec3(0.075, 0.055, 0.04).mul(float(1).add(clod.mul(0.5)).add(crumbs.z.sub(0.5).mul(0.35).mul(near)));
  mat.colorNode = mix(soil, vec3(0.16, 0.09, 0.05).mul(float(0.8).add(bark.z.mul(0.4))), chip);
  mat.roughnessNode = float(0.93).sub(chip.mul(0.1));
  mat.metalnessNode = float(0);
  const crumbH = float(1).sub(crumbs.x.mul(1.4)).max(0).mul(near);
  mat.normalNode = heightBump(crumbH.mul(0.004).add(clod.mul(0.012)).add(chip.mul(0.003)), 1);
  return mat;
}

/** Random-rectangle flag layout: courses of varying height, flags of varying length. */
function flags(p: V2): { dist: F; id: Node<'vec3'> } {
  const course = floor(p.y.div(0.6));
  const hc = hash33(vec3(course, 17, 3));
  // Course heights 0.45–0.75 m: shift the course boundaries by the hash (stays monotone).
  const y0 = course.mul(0.6).add(hc.x.sub(0.5).mul(0.15));
  const yy = p.y.sub(y0);
  const len = float(0.55).add(hc.y.mul(0.5));
  const xx = p.x.add(hc.z.mul(7));
  const col = floor(xx.div(len));
  const lx = fract(xx.div(len)).mul(len);
  const dx = min(lx, len.sub(lx));
  const dy = min(abs(yy), abs(yy.sub(0.6)));
  return { dist: min(dx, dy), id: vec3(col, course, 5) };
}

export function createFlagMaterial(name = 'Estate.flags'): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const p = plan();
  const fp = footprint(p);
  const f = flags(p);
  const h = mix(vec3(0.5), hash33(f.id), lodFade(fp, 0.4));
  const joint = band(f.dist, 0.005, fp);
  const riven = fbm3(vec3(p.mul(6), h.x.mul(31)), 4, fp.mul(6)).sub(0.5);
  const grain = valueNoise3(vec3(p.mul(150), 2)).sub(0.5).mul(lodFade(fp, 0.008));
  const stone = mix(vec3(0.36, 0.32, 0.26), vec3(0.42, 0.38, 0.3), h.y).mul(float(0.88).add(h.x.mul(0.2)).add(riven.mul(0.15)).add(grain.mul(0.08)));
  // Moss in the joints and a darker weathered edge.
  const moss = vec3(0.05, 0.075, 0.03);
  const edge = band(f.dist, 0.03, fp).mul(0.3);
  mat.colorNode = mix(stone.mul(float(1).sub(edge)), moss, joint.mul(0.85));
  mat.roughnessNode = float(0.8).add(riven.mul(0.1)).add(joint.mul(0.12));
  mat.metalnessNode = float(0);
  mat.normalNode = heightBump(riven.mul(0.004).sub(joint.mul(0.004)).add(grain.mul(0.0006)), 1);
  return mat;
}

export function createBrickPathMaterial(name = 'Estate.brick'): MeshPhysicalNodeMaterial {
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = name;
  const p = plan();
  const fp = footprint(p);
  // Herringbone of 215 × 102.5 mm paviors at 45°.
  const L = 0.215;
  const Wd = 0.1075;
  const r = vec2(p.x.add(p.y), p.y.sub(p.x)).mul(Math.SQRT1_2);
  const row = floor(r.y.div(Wd));
  const along = r.x.add(row.mul(Wd));
  const cell = floor(along.div(L * 2));
  const local = fract(along.div(L * 2)).mul(L * 2);
  const vertical = step(L, local);
  // Alternate bricks turn 90°: in that half the long side runs along y.
  const lx = select(vertical.greaterThan(0.5), local.sub(L), local);
  const ly = fract(r.y.div(Wd)).mul(Wd);
  const dx = min(lx, float(L).sub(lx));
  const dy = min(ly, float(Wd).sub(ly));
  const dist = min(dx, dy);
  const id = vec3(cell, row, vertical);
  const h = mix(vec3(0.5), hash33(id), lodFade(fp, 0.15));
  const joint = band(dist, 0.004, fp);
  const fire = fbm3(vec3(p.mul(30), h.x.mul(9)), 3, fp.mul(30)).sub(0.5).mul(lodFade(fp, 0.03));
  const brick = mix(vec3(0.3, 0.12, 0.065), vec3(0.4, 0.19, 0.1), h.x).mul(float(0.8).add(h.y.mul(0.35)).add(fire.mul(0.3)));
  const moss = vec3(0.045, 0.07, 0.028);
  mat.colorNode = mix(brick, moss, joint.mul(0.8));
  mat.roughnessNode = float(0.86).add(joint.mul(0.08));
  mat.metalnessNode = float(0);
  mat.normalNode = heightBump(fire.mul(0.002).sub(joint.mul(0.005)), 1);
  return mat;
}
