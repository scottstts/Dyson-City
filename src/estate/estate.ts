/**
 * The estate (city_plan §4; docs/estate.md): the terrace round the house, built at boot from the
 * plan (layout.ts → build.ts). Static parts are emitted by material slot into one mesh per group;
 * repeated elements (balusters, piers) are instanced. The walker gets one walk mesh.
 */
import { BufferGeometry, Float32BufferAttribute, Group, InstancedMesh, Mesh, Uint32BufferAttribute, type Material, type Matrix4 } from 'three/webgpu';
import { emitParts } from '../geometry/polyMesh';
import type { WalkMesh } from '../player/walkMesh';
import { estateGeometry, estateWalk } from './build';
import { classGrid } from './regions';
import { createGrass, grassRange, grassReach, LAWN_GRASS, MEADOW_GRASS } from './grass';
import { ESTATE_BOUNDS, ORCHARD } from './layout';
import type { Camera } from 'three/webgpu';
import { createEstateMaterials, ESTATE_SLOTS, type EstateLook } from './materials/materials';
import { createBrickPathMaterial, createFlagMaterial, createGravelMaterial, createLawnMaterial, createSoilMaterial } from './materials/ground';
import { createHedgeMaterial } from './materials/foliage';
import { createLeafAtlas } from './plants/atlas';
import { createBarkMaterial, createFoliageMaterial } from './plants/materials';
import { SPECIES } from './plants/species';
import type { CardGeometry } from './plants/shrub';
import type { Texture } from 'three/webgpu';
import { createDarkGlassMaterial, createLilyMaterial, createPadMaterial, createPaneMaterials, createWaterMaterial, waterTime } from './materials/water';
import type { GroundClass } from './layout';
import type { Part } from '../field/kit/parts';
import type { GroundSurface } from '../city/walk';
import type { Crown } from './plants/plants';
import { estateSurface } from './surface';

export interface Estate {
  readonly group: Group;
  readonly walk: WalkMesh;
  /** Everything static as plain meshes (the star-shade raster; instanced repeats merged). */
  readonly occluders: readonly Mesh[];
  /** Named parts by group (audits). */
  readonly parts: Record<string, Part[]>;
  setLook(look: EstateLook): void;
  /** Copies of the statics for an environment capture (materials lit by the capture's own environment). */
  captureCopies(): Mesh[];
  update(gameTime: number): void;
  /** Meshes the house's indoor culling may hide (not the grass, which the estate hides itself). */
  readonly outdoorMeshes: Mesh[];
  /** Per frame, after the camera moves: the grass follows it. */
  view(camera: Camera, indoors: boolean): void;
  /** What is underfoot on the terrace (null off it). */
  surfaceAt(x: number, z: number, y: number): GroundSurface | null;
  /** The trees' crowns (leaf rustle). */
  readonly crowns: readonly Crown[];
}

function groundMaterial(cls: GroundClass, look: EstateLook = {}): Material {
  let m;
  switch (cls) {
    case 'lawn':
      m = createLawnMaterial('Estate.lawn', false, grassReach(LAWN_GRASS));
      break;
    case 'meadow':
      m = createLawnMaterial('Estate.meadow', true, grassReach(MEADOW_GRASS));
      break;
    case 'soil':
      m = createSoilMaterial();
      break;
    case 'flag':
      m = createFlagMaterial();
      break;
    case 'brick':
      m = createBrickPathMaterial();
      break;
    default:
      m = createGravelMaterial(`Estate.${cls}`);
  }
  if (look.env) m.envNode = look.env;
  if (look.shade) m.aoNode = look.shade();
  return m;
}

/** Instanced geometry as one merged mesh (the star-shade raster sees every instance). */
function merged(geo: BufferGeometry, matrices: Matrix4[]): BufferGeometry {
  const src = geo.getAttribute('position').array as Float32Array;
  const idx = geo.getIndex()!.array as Uint32Array;
  const pos = new Float32Array(src.length * matrices.length);
  const out = new Uint32Array(idx.length * matrices.length);
  matrices.forEach((m, k) => {
    const e = m.elements;
    for (let i = 0; i < src.length; i += 3) {
      const x = src[i], y = src[i + 1], z = src[i + 2];
      const o = k * src.length + i;
      pos[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
      pos[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      pos[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    }
    for (let i = 0; i < idx.length; i++) out[k * idx.length + i] = idx[i] + (k * src.length) / 3;
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(new Uint32BufferAttribute(out, 1));
  return g;
}

export function buildEstate(): Estate {
  const t0 = performance.now();
  const group = new Group();
  group.name = 'Estate';
  const geo = estateGeometry();
  const tGeo = performance.now();
  const walk = estateWalk(geo);
  const occluders: Mesh[] = [];
  const looks: ((look: EstateLook) => void)[] = [];
  const copies: (() => Mesh)[] = [];

  // Ground: the star-shade's floor (lighting/starShade.ts floorMap), not an occluder.
  for (const gm of geo.ground) {
    const mesh = new Mesh(gm.geometry, groundMaterial(gm.cls));
    mesh.name = `Estate.ground.${gm.cls}`;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    looks.push((look) => (mesh.material = groundMaterial(gm.cls, look)));
    copies.push(() => new Mesh(gm.geometry, groundMaterial(gm.cls)));
  }
  // Materials by group: the slot set, or a group's own (hedges, pads, flowers).
  const materialsFor = (name: string, look: EstateLook = {}): Material | Material[] => {
    const own = (m: Material) => {
      const n = m as unknown as { envNode: unknown; aoNode: unknown };
      if (look.env) n.envNode = look.env;
      if (look.shade) n.aoNode = look.shade();
      return m;
    };
    if (name === 'hedge-yew') return own(createHedgeMaterial('yew'));
    if (name === 'hedge-box') return own(createHedgeMaterial('box'));
    if (name === 'lily-pads') return own(createPadMaterial());
    if (name === 'lilies') return own(createLilyMaterial());
    return createEstateMaterials(name, look);
  };
  const slotsOf = (name: string) => (name.startsWith('hedge-') ? 1 : ESTATE_SLOTS);
  for (const [name, list] of Object.entries(geo.parts)) {
    if (!list.length) continue;
    const g = emitParts(list.map((p) => p.mesh), { slots: slotsOf(name) });
    const mesh = new Mesh(g, materialsFor(name));
    mesh.name = `Estate.${name}`;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    occluders.push(mesh);
    looks.push((look) => (mesh.material = materialsFor(name, look)));
    copies.push(() => new Mesh(g, materialsFor(name)));
  }
  // Water and glass.
  const water = new Mesh(emitParts([geo.surfaces.water], { slots: 1 }), createWaterMaterial());
  water.name = 'Estate.water';
  water.matrixAutoUpdate = false;
  group.add(water);
  looks.push((look) => {
    const m = createWaterMaterial();
    if (look.env) m.envNode = look.env;
    water.material = m;
  });
  const glassGeo = emitParts([geo.surfaces.glass], { slots: 1 });
  const panes = createPaneMaterials();
  const transmit = new Mesh(glassGeo, panes.transmit);
  transmit.name = 'Estate.glasshouse.glass';
  transmit.renderOrder = 1;
  const reflect = new Mesh(glassGeo, panes.reflect);
  reflect.name = 'Estate.glasshouse.glass.reflect';
  reflect.renderOrder = 2;
  for (const m of [transmit, reflect]) {
    m.matrixAutoUpdate = false;
    group.add(m);
  }
  looks.push((look) => {
    if (look.env) (reflect.material as unknown as { envNode: unknown }).envNode = look.env;
  });
  const dark = new Mesh(emitParts([geo.surfaces.darkGlass], { slots: 1 }), createDarkGlassMaterial());
  dark.name = 'Estate.carriage.windows';
  dark.matrixAutoUpdate = false;
  group.add(dark);
  looks.push((look) => {
    const m = createDarkGlassMaterial();
    if (look.env) m.envNode = look.env;
    dark.material = m;
  });
  // Planting: one card mesh for every leaf, one wood mesh per species.
  const atlas = createLeafAtlas();
  const cards = (c: CardGeometry) => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(c.position, 3));
    g.setAttribute('normal', new Float32BufferAttribute(c.normal, 3));
    g.setAttribute('uv', new Float32BufferAttribute(c.uv, 2));
    g.setAttribute('root', new Float32BufferAttribute(c.root, 3));
    g.setAttribute('shade', new Float32BufferAttribute(c.shade, 1));
    g.setIndex(new Uint32BufferAttribute(c.index, 1));
    g.computeBoundingSphere();
    return g;
  };
  let envTexture: Texture | null = null;
  const foliage = new Mesh(cards(geo.planting.foliage), createFoliageMaterial(atlas, envTexture));
  foliage.name = 'Estate.foliage';
  foliage.matrixAutoUpdate = false;
  group.add(foliage);
  looks.push((look) => {
    envTexture = look.envTexture ?? envTexture;
    const m = createFoliageMaterial(atlas, envTexture);
    if (look.env) m.envNode = look.env;
    foliage.material = m;
  });
  const canopy = new Mesh(cards(geo.planting.canopy));
  canopy.name = 'Estate.canopy.raster';
  canopy.matrixAutoUpdate = false;
  occluders.push(canopy);
  for (const [species, w] of Object.entries(geo.planting.wood)) {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(w.position, 3));
    g.setAttribute('normal', new Float32BufferAttribute(w.normal, 3));
    g.setAttribute('uv', new Float32BufferAttribute(w.uv, 2));
    g.setIndex(new Uint32BufferAttribute(w.index, 1));
    g.computeBoundingSphere();
    const b = SPECIES[species].bark;
    const mesh = new Mesh(g, createBarkMaterial(b.colour, b.fissure, `Estate.bark.${species}`));
    mesh.name = `Estate.wood.${species}`;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    occluders.push(mesh);
    looks.push((look) => {
      const m = createBarkMaterial(b.colour, b.fissure, `Estate.bark.${species}`);
      if (look.env) m.envNode = look.env;
      mesh.material = m;
    });
  }
  for (const [name, inst] of Object.entries(geo.instances)) {
    if (!inst.matrices.length) continue;
    const g = emitParts([inst.mesh], { slots: name === 'lily-pads' || name === 'lilies' ? 1 : ESTATE_SLOTS });
    const mesh = new InstancedMesh(g, materialsFor(name), inst.matrices.length);
    inst.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.name = `Estate.${name}`;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    looks.push((look) => (mesh.material = materialsFor(name, look)));
    if (name === 'lily-pads' || name === 'lilies') continue;
    const raster = new Mesh(merged(g, inst.matrices));
    raster.name = `Estate.${name}.raster`;
    raster.matrixAutoUpdate = false;
    occluders.push(raster);
  }
  // Grass: blades on the lawn and the meadow near the eye.
  const grid = classGrid();
  const lawnGrass = createGrass(LAWN_GRASS, grid);
  const meadowGrass = createGrass(MEADOW_GRASS, grid);
  for (const g of [lawnGrass, meadowGrass]) group.add(g.object);
  looks.push((look) => {
    if (look.envTexture) for (const g of [lawnGrass, meadowGrass]) g.setEnvironment(look.envTexture);
  });
  const near = (cx: number, cz: number, b: [number, number, number, number], m: number) => cx > b[0] - m && cx < b[2] + m && cz > b[1] - m && cz < b[3] + m;
  console.info(`[Dyson] estate: geometry ${(tGeo - t0).toFixed(0)} ms, total ${(performance.now() - t0).toFixed(0)} ms, walk ${JSON.stringify(walk.counts)}`);
  return {
    group,
    walk,
    occluders,
    outdoorMeshes: group.children.filter((c): c is Mesh => (c as Mesh).isMesh),
    parts: geo.parts,
    surfaceAt: estateSurface(grid),
    crowns: geo.planting.crowns,
    setLook(look) {
      for (const f of looks) f(look);
    },
    captureCopies: () =>
      copies.map((c) => {
        const m = c();
        m.matrixAutoUpdate = false;
        return m;
      }),
    update(t) {
      waterTime.value = t;
    },
    view(camera, indoors) {
      const { x, z } = camera.position;
      // Blades only where they can be seen: on (or beside) the estate, out of doors.
      lawnGrass.object.visible = !indoors && near(x, z, ESTATE_BOUNDS, grassRange(LAWN_GRASS));
      meadowGrass.object.visible = !indoors && near(x, z, [ORCHARD.x0, ORCHARD.z0, ORCHARD.x1, ORCHARD.z1], grassRange(MEADOW_GRASS));
      if (lawnGrass.object.visible) lawnGrass.update(camera);
      if (meadowGrass.object.visible) meadowGrass.update(camera);
    },
  };
}
