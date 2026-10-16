/**
 * Grass (docs/estate.md "Grass"): real blades on the lawn and the orchard's meadow, near the eye.
 *
 * Tufts of curved, tapered blades are instanced on world-fixed grids round the camera (each grid
 * moves in whole cells, so blades never swim). Each blade finds its ground class at its foot in
 * the estate's class grid (regions.ts): blades stand only on lawn (or meadow), never on gravel,
 * beds or paths.
 *
 *  - The lawn's mown stripes are physical: in alternate 1.2 m stripes along the house's axis the
 *    blades lean along and against it, so from the porch one stripe shows the blades' lit upper
 *    faces and the next their shaded undersides. The ground beneath (materials/ground.ts) carries
 *    the same stripes as an average, for the distance.
 *  - Distance: nested rings (a clipmap), ring k with cells 2^k times the finest out to
 *    thin·2^(k+1). Beyond `thin` the tufts' density falls as 1/d², so their density on screen
 *    stays the same at every distance: ring k is exactly as dense as that law where it begins, and
 *    thins by a stable per-tuft rank across itself; the survivors spread wider. Neighbouring rings
 *    cross over by rank over a band either side of their boundary, each tuft growing or shrinking
 *    in rather than popping. Coarser rings bend their blades in fewer segments. The last ring fades
 *    out where its blades are about a pixel tall (lawn ~50 m, meadow ~75 m), and the ground
 *    material carries the sward's mean beyond. The first build was one fine grid that ended 12 m
 *    out: a visible ring round the eye.
 *  - Light: as foliage (the image-based light), each blade darker toward its foot (the sward's own
 *    shade), lit through from above when seen from below its leaning face.
 *  - Wind: the tips stir faintly.
 */
import { DataTexture, DoubleSide, Float32BufferAttribute, Group, InstancedBufferGeometry, Mesh, MeshPhysicalNodeMaterial, NearestFilter, RedFormat, Uint32BufferAttribute, UnsignedByteType, type Camera, type Node, type Texture } from 'three/webgpu';
import { float, int, vec2, vec3, vec4, attribute, instanceIndex, uniform, textureLoad, ivec2, cameraPosition, cameraViewMatrix, pmremTexture, sin, cos, floor, fract, mix, clamp, smoothstep, length, min, max, normalize, cross, varying, step, abs, faceDirection } from 'three/tsl';
import { hash33 } from '../render/tsl/noise';
import { waterTime } from './materials/water';
import { GROUND_ORDER, HOUSE_F, TERRACE_Y } from './layout';
import { LAWN_STRIPE } from './materials/ground';
import type { ClassGrid } from './regions';

type V3 = Node<'vec3'>;

export interface GrassSpec {
  kind: 'lawn' | 'meadow';
  /** Cell size of the finest tuft grid (m). */
  cell: number;
  blades: number;
  /** Blade height (m), width at the foot (m), tuft radius (m). */
  height: number;
  width: number;
  radius: number;
  /** Lean from vertical at the tip (rad). */
  lean: number;
  /** Full density within this distance (m); beyond it, 1/d². */
  thin: number;
  /** LOD rings: ring k reaches thin·2^(k+1). */
  rings: number;
}

export const LAWN_GRASS: GrassSpec = { kind: 'lawn', cell: 0.07, blades: 6, height: 0.045, width: 0.0045, radius: 0.035, lean: 0.75, thin: 3.5, rings: 4 };
export const MEADOW_GRASS: GrassSpec = { kind: 'meadow', cell: 0.13, blades: 6, height: 0.24, width: 0.0055, radius: 0.08, lean: 0.55, thin: 5, rings: 4 };

/** Rings cross over within ±BAND of their boundary radius (fraction). */
const BAND = 0.12;

/** The outer radius of the last ring (m). */
export function grassRange(spec: GrassSpec): number {
  return spec.thin * 2 ** spec.rings;
}

/** Where the blades fade out (m from the eye): the ground material darkens over the same range. */
export function grassReach(spec: GrassSpec): [number, number] {
  const reach = grassRange(spec);
  return [reach * 0.78, reach * 0.97];
}

/** Half-extent of every ring's grid (cells): its outer radius plus the crossover band and a cell's snap. */
export function ringHalf(spec: GrassSpec): number {
  return Math.ceil((2 * spec.thin * (1 + BAND)) / spec.cell) + 2;
}

/**
 * Ring k's share at distance d, as density relative to the finest grid (the shader's `kept` times
 * the ring's own density, without the per-tuft rank): the rings' shares sum to the 1/d² law.
 */
export function ringDensity(spec: GrassSpec, k: number, d: number): number {
  const rho = Math.min(1, (spec.thin / Math.max(d, 1e-3)) ** 2);
  const base = 4 ** -k;
  const ss = (a: number, b: number, x: number) => {
    const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
    return t * t * (3 - 2 * t);
  };
  const inner = spec.thin * 2 ** k;
  const outer = spec.thin * 2 ** (k + 1);
  const fadeIn = k === 0 ? 1 : ss(inner * (1 - BAND), inner * (1 + BAND), d);
  const fadeOut = k === spec.rings - 1 ? 1 : 1 - ss(outer * (1 - BAND), outer * (1 + BAND), d);
  return Math.min(rho / base, 1) * fadeIn * fadeOut * base;
}

/** Blade segments by ring: the curve coarsens where a blade is a few pixels tall. */
const RING_SEGMENTS = [3, 2, 2, 1];

/** One tuft's blades: per vertex (t along the blade, side ±1) and per blade (offset x, z, height scale, phase). */
function tuftGeometry(spec: GrassSpec, segments: number): InstancedBufferGeometry {
  const ts: number[] = [];
  const blade: number[] = [];
  const index: number[] = [];
  const pos: number[] = [];
  let seed = spec.kind === 'lawn' ? 7 : 19;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let b = 0; b < spec.blades; b++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * spec.radius;
    const ox = Math.cos(a) * d;
    const oz = Math.sin(a) * d;
    const hs = 0.65 + rnd() * 0.6;
    const ph = rnd() * 6.283;
    const base = ts.length / 2;
    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      for (const side of s === segments ? [0] : [-1, 1]) {
        ts.push(t, side);
        blade.push(ox, oz, hs, ph);
        pos.push(0, 0, 0);
      }
    }
    for (let s = 0; s < segments - 1; s++) {
      const a0 = base + s * 2;
      index.push(a0, a0 + 1, a0 + 3, a0, a0 + 3, a0 + 2);
    }
    const last = base + (segments - 1) * 2;
    index.push(last, last + 1, last + 2);
  }
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('tside', new Float32BufferAttribute(ts, 2));
  g.setAttribute('blade', new Float32BufferAttribute(blade, 4));
  g.setIndex(new Uint32BufferAttribute(index, 1));
  const k = ringHalf(spec) * 2;
  g.instanceCount = k * k;
  return g;
}

export interface GrassField {
  /** One mesh per ring. */
  object: Group;
  /** The outdoors' environment (the light through the blades from above). */
  setEnvironment(env: Texture): void;
  /** Re-centres the rings' grids on the camera (whole cells). */
  update(camera: Camera): void;
}

/** The class grid as a texture: 1 where the ground class is `cls`. */
function maskTexture(grid: ClassGrid, cls: number): DataTexture {
  const data = new Uint8Array(grid.nx * grid.nz);
  for (let i = 0; i < data.length; i++) data[i] = grid.cls[i] === cls ? 255 : 0;
  const t = new DataTexture(data, grid.nx, grid.nz, RedFormat, UnsignedByteType);
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** Bound before the outdoor capture exists (its translucency is off until then). */
const envPlaceholder = new DataTexture(new Uint8Array(4), 1, 1);

export function createGrass(spec: GrassSpec, grid: ClassGrid): GrassField {
  const envOn = uniform(0);
  const mask = maskTexture(grid, GROUND_ORDER.indexOf(spec.kind));
  const object = new Group();
  object.name = `Estate.grass.${spec.kind}`;
  const rings = Array.from({ length: spec.rings }, (_, k) => createRing(spec, grid, mask, envOn, k));
  for (const r of rings) object.add(r.mesh);
  return {
    object,
    setEnvironment(env) {
      for (const r of rings) r.sky.value = env;
      envOn.value = 1;
    },
    update(camera) {
      for (const r of rings) r.centre.value.set(Math.floor(camera.position.x / r.cell), Math.floor(camera.position.z / r.cell));
    },
  };
}

interface Ring {
  mesh: Mesh;
  cell: number;
  centre: { value: { set(x: number, y: number): void } };
  sky: { value: Texture };
}

/** Ring k of the field: its grid (cells 2^k the finest), its share of the tufts, its blades. */
function createRing(spec: GrassSpec, grid: ClassGrid, mask: DataTexture, envOn: Node<'float'>, k: number): Ring {
  const cellSize = spec.cell * 2 ** k;
  const half = ringHalf(spec);
  const geo = tuftGeometry(spec, RING_SEGMENTS[Math.min(k, RING_SEGMENTS.length - 1)]);
  const centre = uniform(vec2(0, 0)) as unknown as Node<'vec2'> & { value: { set(x: number, y: number): void } };
  const K = half * 2;
  const i = int(instanceIndex);
  const gx = i.mod(K);
  const gz = i.div(K);
  const cellXZ = vec2(float(gx).sub(half), float(gz).sub(half)).add(centre);
  const h = hash33(vec3(cellXZ, (spec.kind === 'lawn' ? 3 : 5) + 11 * k));
  const root = cellXZ.add(h.xy.mul(0.9).add(0.05)).mul(cellSize);
  const onGrass = (xz: Node<'vec2'>) => {
    // Its ground class: the nearest node of the class grid.
    const node = ivec2(int(floor(xz.x.sub(grid.x0).div(grid.step).add(0.5))), int(floor(xz.y.sub(grid.z0).div(grid.step).add(0.5))));
    const inGrid = step(0, float(node.x)).mul(step(0, float(node.y))).mul(step(float(node.x), float(grid.nx - 1))).mul(step(float(node.y), float(grid.nz - 1)));
    return step(0.5, textureLoad(mask, node).r.mul(inGrid));
  };
  // Distance: the density the 1/d² law asks for here (relative to the finest grid), this ring's share of it.
  const d = length(cameraPosition.xz.sub(root));
  const rho = min(float(1), float(spec.thin).div(max(d, 1e-3)).pow(2));
  const base = 4 ** -k;
  const inner = spec.thin * 2 ** k;
  const outer = spec.thin * 2 ** (k + 1);
  const fadeIn = k === 0 ? float(1) : smoothstep(inner * (1 - BAND), inner * (1 + BAND), d);
  const fadeOut = k === spec.rings - 1 ? float(1) : float(1).sub(smoothstep(outer * (1 - BAND), outer * (1 + BAND), d));
  const kept = min(rho.div(base), 1).mul(fadeIn).mul(fadeOut);
  // By rank, each tuft growing in over a little of the rank rather than popping.
  const here = smoothstep(h.z, h.z.add(0.08), kept);
  // The tufts' density on this ring's grid sets how far their blades spread.
  const spread = float(1).div(min(rho, base).sqrt());
  const [fadeA, fadeB] = grassReach(spec);
  const fade = float(1).sub(smoothstep(fadeA, fadeB, d));
  // The blade: its foot in the tuft (turned with the tuft), its lean, its curve.
  const tside = attribute('tside', 'vec2');
  const bl = attribute('blade', 'vec4');
  const yaw = h.x.mul(6.283);
  const c = cos(yaw);
  const s = sin(yaw);
  const foot = vec2(bl.x.mul(c).sub(bl.y.mul(s)), bl.x.mul(s).add(bl.y.mul(c))).mul(spread);
  // Only on the lawn (or meadow) where the blade itself stands: a spread tuft at a path's edge keeps off the gravel.
  const present = here.mul(onGrass(root.add(foot)));
  let leanDir: Node<'vec2'>;
  if (spec.kind === 'lawn') {
    // Mown stripes: blades lean along ±F by the stripe they stand in, give or take.
    const f = vec2(HOUSE_F[0], HOUSE_F[1]);
    const across = root.x.mul(-HOUSE_F[1]).add(root.y.mul(HOUSE_F[0]));
    const parity = step(0.5, fract(across.div(LAWN_STRIPE * 2))).mul(2).sub(1);
    const jitter = bl.w.sub(3.14).mul(0.18);
    const fj = vec2(f.x.mul(cos(jitter)).sub(f.y.mul(sin(jitter))), f.x.mul(sin(jitter)).add(f.y.mul(cos(jitter))));
    leanDir = fj.mul(parity);
  } else {
    leanDir = vec2(cos(bl.w), sin(bl.w));
  }
  const t = tside.x;
  const H = float(spec.height).mul(bl.z).mul(fade).mul(present);
  const wind = sin(waterTime.mul(1.3).add(root.x.mul(1.7)).add(root.y.mul(1.1)).add(bl.w)).mul(0.12).mul(t.mul(t));
  const bend = float(spec.lean).mul(t).add(wind);
  const up = vec3(0, 1, 0);
  const lean3 = vec3(leanDir.x, 0, leanDir.y);
  const along = up.mul(cos(bend)).add(lean3.mul(sin(bend)));
  // The point on the blade: its foot plus the integral of the bending axis (approximated by a parabola).
  const centreLine = vec3(root.x.add(foot.x), float(TERRACE_Y + 0.015), root.y.add(foot.y)).add(up.mul(H.mul(t))).add(lean3.mul(H.mul(t.mul(t)).mul(float(spec.lean).mul(0.6).add(abs(wind)))));
  const acrossDir = normalize(cross(lean3.add(vec3(0.001, 0, 0)), up));
  const width = float(spec.width).mul(float(1).sub(t).pow(0.7)).mul(present).mul(fade.mul(0.5).add(0.5)).mul(spread.sqrt());
  const p = centreLine.add(acrossDir.mul(tside.y.mul(width)));
  const mat = new MeshPhysicalNodeMaterial();
  mat.name = `Estate.grass.${spec.kind}.${k}`;
  mat.side = DoubleSide;
  mat.positionNode = p;
  // Normal: a sward scatters light among its blades, so a blade shades much more like the lawn's
  // surface than like its own steep face: the face (across × along) leans the sky's way. Carried to
  // the fragment in world space, handed to three in view space; the side seen keeps facing up.
  const face = cross(acrossDir, along);
  const nW = varying(face, 'vGrassFace') as unknown as V3;
  const seen = nW.mul(faceDirection);
  const nUp = normalize(seen.mul(0.38).add(vec3(0, 0.62, 0)));
  mat.normalNode = normalize(cameraViewMatrix.mul(vec4(nUp, 0)).xyz);
  const shade = varying(mix(float(0.55), float(1), t.pow(0.8)), 'vGrassShade');
  const tint = varying(h.y, 'vGrassTint');
  const baseColour = spec.kind === 'lawn' ? vec3(0.052, 0.095, 0.03) : vec3(0.072, 0.098, 0.032);
  const tip = spec.kind === 'lawn' ? vec3(0.072, 0.118, 0.04) : vec3(0.13, 0.138, 0.06);
  const colour = mix(baseColour, tip, varying(t, 'vGrassT')).mul(mix(float(0.85), float(1.15), tint));
  mat.colorNode = colour;
  // A blade's wax glints only a little at grazing; together with the sheen and the light through it, a
  // blade must stay within a stop or so of the sward around it, or the lawn reads as specks on dark.
  mat.roughnessNode = float(0.72);
  mat.metalnessNode = float(0);
  mat.aoNode = shade;
  mat.sheenNode = colour.mul(0.25);
  // Lit through from above (as the foliage): the environment is bound once the outdoors is captured.
  const sky = pmremTexture(envPlaceholder, vec3(0, 1, 0), float(1)) as unknown as V3 & { value: Texture };
  const under = clamp(seen.y.negate().add(0.35), 0, 1);
  mat.emissiveNode = colour.mul(vec3(1.05, 1.1, 0.7)).mul(0.1).mul(sky).mul(under).mul(shade).mul(envOn);
  const mesh = new Mesh(geo, mat);
  mesh.name = `Estate.grass.${spec.kind}.${k}`;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return { mesh, cell: cellSize, centre, sky };
}
