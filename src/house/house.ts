/**
 * The house in the game (city_plan §4, §9 step 2; blender/docs/house.md "Integration"): one root at
 * HOUSE_SITE on the terrace, its front (glTF +Z) turned toward the datum. The exterior and then the
 * three floors are built during loading (each floor compiled in the house worker), so the boot's
 * warm-up compiles every pipeline they draw with: nothing of the house compiles in play.
 *
 * Light: the exterior is lit like everything outdoors; indoors everything is baked (bakedLight.ts).
 * Interiors are only drawn near the house; from further off its windows and outer doors show their
 * rooms from the rooms' captures (BakedLight.interiorView), so they look the same either side of the
 * range. Walking: the house's collision proxies become 3D walls
 * and floors (player/walkMesh.ts); the leaves are moving walls (doors.ts).
 */
import { BufferAttribute, BufferGeometry, Group, Matrix4, Mesh, Vector3, type Material, type MeshPhysicalNodeMaterial, type Object3D, type Camera, type Texture } from 'three/webgpu';
import { attribute } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { HouseAssets, LoadedPart, PartName } from './assets';
import type { DrawGroup, CollisionMesh, Marker } from './compile';
import { BakedLight, rgb9e5Texture } from './bakedLight';
import { applyLook, buildMaterial, type HouseLook, type MaterialContext } from './materials';
import { HouseDoor, HouseDoors } from './doors';
import { HouseFloors, indoorSurface } from './floors';
import type { GroundSurface } from '../city/walk';
import { IndoorCulling } from './culling';
import { roomOf } from './rooms';
import { WalkMesh } from '../player/walkMesh';
import { HOUSE_GRADE } from '../estate/levels';

/** Interiors are drawn within this distance of the house's middle (m). */
const INTERIOR_RANGE = 60;

const HOUSE_POINT = new Vector3();

/** A sound the house's export places (a Sound_ marker): what it is, its gain, where (world). */
export interface HouseSound {
  name: string;
  clip: string;
  gain: number;
  position: [number, number, number];
}

export interface HouseOptions {
  look: HouseLook;
}

interface PartBuild {
  name: PartName;
  group: Group;
  meshes: Mesh[];
}

export class House {
  readonly root = new Group();
  readonly baked: BakedLight;
  readonly walk = new WalkMesh();
  readonly doors: HouseDoors;
  /** The outdoors seen from inside: only what the windows frame (culling.ts). */
  readonly culling = new IndoorCulling();
  readonly markers: Marker[] = [];
  /** The Sound_ markers in the world, as their floors arrive (docs/audio.md "The house"). */
  readonly sounds: HouseSound[] = [];
  /** What is underfoot indoors and on the porches (floors.ts). */
  readonly floors = new HouseFloors();
  /** The exterior's static meshes (captures, the star-shade raster, culling). */
  readonly exteriorMeshes: Mesh[] = [];
  /** Middle of the house (world), for interior streaming and culling. */
  readonly centre = new Vector3();
  private readonly assets: HouseAssets;
  private readonly opts: HouseOptions;
  private readonly parts = new Map<PartName, PartBuild>();
  private readonly lookMaterials: { mat: MeshPhysicalNodeMaterial; mixed: boolean }[] = [];
  private readonly glassEnvs: { value: Texture | null }[] = [];

  private constructor(assets: HouseAssets, opts: HouseOptions) {
    this.assets = assets;
    this.opts = opts;
    this.baked = new BakedLight(assets.rooms);
    this.doors = new HouseDoors(this.walk);
    const { site, face } = assets.pack.index.placement;
    this.root.name = 'House';
    this.root.position.set(site[0], HOUSE_GRADE, site[1]);
    this.root.rotation.y = Math.atan2(face[0], face[1]);
    this.root.updateMatrixWorld(true);
    (this.baked.worldToHouse.value as Matrix4).copy(this.root.matrixWorld).invert();
    // The plan's middle (house frame: x −1.7, z −5.6 between the wings and front to back).
    this.centre.set(-1.7, 4, -5.6).applyMatrix4(this.root.matrixWorld);
  }

  /** Builds the exterior (boot). */
  static async create(assets: HouseAssets, opts: HouseOptions): Promise<House> {
    const house = new House(assets, opts);
    const ext = await house.buildPart(assets.exterior);
    house.root.add(ext.group);
    for (const m of ext.meshes) if (!m.material || !(m.material as Material).transparent) house.exteriorMeshes.push(m);
    return house;
  }

  private context(part: LoadedPart): MaterialContext {
    return { glassEnvs: this.glassEnvs, doc: part.doc, textures: this.assets.textures, baked: this.baked, look: this.opts.look, lightmaps: this.baked.lightmaps, lamps: this.assets.pack.index.lamps ?? {} };
  }

  private async buildPart(part: LoadedPart): Promise<PartBuild> {
    const ctx = this.context(part);
    const group = new Group();
    group.name = `House.${part.name}`;
    this.root.add(group);
    group.updateMatrixWorld(true);
    const meshes: Mesh[] = [];
    // Lightmaps this part uses.
    for (const g of part.compiled.groups) {
      if (g.kind === 'lightmap' && g.lightmap && !this.baked.lightmaps.has(g.lightmap)) {
        const e = this.assets.pack.entry(g.lightmap);
        this.baked.lightmaps.set(g.lightmap, rgb9e5Texture(new Uint32Array(await this.assets.pack.bytes(g.lightmap)), Number(e.width), Number(e.height)));
      }
    }
    const cache = new Map<string, Promise<Awaited<ReturnType<typeof buildMaterial>>>>();
    const material = (g: DrawGroup, sh: Float32Array | null) => {
      if (sh) return buildMaterial(ctx, g.material, g.kind, g.lightmap, sh);
      const key = `${g.material}|${g.kind}|${g.lightmap ?? ''}`;
      let p = cache.get(key);
      if (!p) cache.set(key, (p = buildMaterial(ctx, g.material, g.kind, g.lightmap)));
      return p;
    };
    const emit = async (g: DrawGroup, parent: Object3D, sh: Float32Array | null, name: string) => {
      const geo = geometry(g);
      const built = await material(g, sh);
      const mesh = new Mesh(geo, built.material);
      mesh.name = `${name}.${ctx.doc.materials[g.material]?.name ?? g.material}`;
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
      meshes.push(mesh);
      this.track(built.material, g.kind);
      if (built.reflect) {
        // Glass: the transmittance first, its reflection over it.
        mesh.renderOrder = 1;
        const r = new Mesh(geo, built.reflect);
        r.name = `${mesh.name}.reflect`;
        r.matrixAutoUpdate = false;
        r.renderOrder = 2;
        parent.add(r);
        meshes.push(r);
      }
    };
    for (const g of part.compiled.groups) await emit(g, group, null, group.name);
    for (const d of part.compiled.doors) {
      const rig = new Group();
      rig.name = `DoorRig.${d.name}`;
      rig.matrix.fromArray(d.rig);
      rig.matrixAutoUpdate = false;
      const leaf = new Group();
      leaf.name = d.name;
      rig.add(leaf);
      group.add(rig);
      for (const g of d.groups) await emit(g, leaf, d.sh, d.name);
      rig.updateMatrixWorld(true);
      this.doors.add(new HouseDoor({ name: d.name, kind: d.kind, rest: d.rest, limit: d.limit, translation: d.translation, handle: d.handle, box: d.box, exterior: part.name === 'exterior' }, leaf));
    }
    group.updateMatrixWorld(true);
    this.addCollision(part.compiled.collision);
    this.markers.push(...part.compiled.markers);
    for (const m of part.compiled.markers) {
      if (m.kind !== 'sound' || typeof m.extras.clip !== 'string') continue;
      const p = new Vector3(...m.position).applyMatrix4(this.root.matrixWorld);
      this.sounds.push({ name: m.name, clip: m.extras.clip, gain: typeof m.extras.gain === 'number' ? m.extras.gain : 1, position: [p.x, p.y, p.z] });
    }
    this.floors.add(part.compiled.floors);
    this.culling.add(part.compiled.apertures, this.root.matrixWorld);
    const build = { name: part.name, group, meshes };
    this.parts.set(part.name, build);
    return build;
  }

  private track(mat: Material, kind: DrawGroup['kind']): void {
    if ((kind === 'exterior' || kind === 'mixed') && (mat as MeshPhysicalNodeMaterial).isMeshPhysicalNodeMaterial) this.lookMaterials.push({ mat: mat as MeshPhysicalNodeMaterial, mixed: kind === 'mixed' });
  }

  private addCollision(list: CollisionMesh[]): void {
    const m = this.root.matrixWorld;
    const v = new Vector3();
    for (const c of list) {
      const world = new Float32Array(c.position.length);
      for (let i = 0; i < c.position.length; i += 3) {
        v.set(c.position[i], c.position[i + 1], c.position[i + 2]).applyMatrix4(m);
        world[i] = v.x;
        world[i + 1] = v.y;
        world[i + 2] = v.z;
      }
      this.walk.add(world, c.index);
    }
  }

  /** Sets how the outdoors lights the exterior (the estate's probe, the star-shade). */
  setLook(look: HouseLook): void {
    Object.assign(this.opts.look, look);
    if (look.envTexture) for (const e of this.glassEnvs) e.value = look.envTexture;
    for (const { mat, mixed } of this.lookMaterials) applyLook(mat, this.opts.look, mixed ? (attribute('indoor', 'float') as unknown as Node<'float'>) : null);
  }

  /**
   * Copies of the exterior for an environment capture (the Dome's interior, the field's probes):
   * the same geometry with materials lit by the capture's own environment.
   */
  captureCopies(): Object3D[] {
    this.root.updateMatrixWorld(true);
    return this.exteriorMeshes.map((m) => {
      const mat = (m.material as Material).clone();
      if ((mat as MeshPhysicalNodeMaterial).isMeshPhysicalNodeMaterial) {
        (mat as MeshPhysicalNodeMaterial).envNode = null;
        (mat as MeshPhysicalNodeMaterial).aoNode = null;
      }
      const c = new Mesh(m.geometry, mat);
      c.name = `capture:${m.name}`;
      c.matrixAutoUpdate = false;
      c.matrix.copy(m.matrixWorld);
      c.matrixWorld.copy(m.matrixWorld);
      return c;
    });
  }

  /**
   * Builds the floors (ground floor first) and installs the rooms' reflections, all prepared since
   * the exterior compiled. Called during loading, before the warm-up: their pipelines compile there
   * with everything else (app/game.ts warmAll).
   */
  async loadInteriors(): Promise<void> {
    // Prepared in the background since the exterior compiled (assets.ts); built here in order.
    const { floors, reflections } = this.assets.interiors;
    for (const prepared of floors) {
      const part = await prepared;
      await this.buildPart(part);
    }
    this.baked.setAtlas(await reflections);
    void this.assets.pack.pruneCache();
  }

  /** A world point in the house's frame (glTF axes). */
  private toHouse(x: number, y: number, z: number): Vector3 {
    return HOUSE_POINT.set(x, y, z).applyMatrix4(this.baked.worldToHouse.value as Matrix4);
  }

  /** Is a world point inside the house's walls (a room's box)? */
  inside(wx: number, wy: number, wz: number): boolean {
    return this.roomAt(wx, wy, wz) !== null;
  }

  /** The room a world point is in (rooms.ts), or null outside the house's rooms. */
  roomAt(wx: number, wy: number, wz: number): string | null {
    const h = this.toHouse(wx, wy, wz);
    // House frame (glTF) → Blender: (x, −z, y).
    return roomOf(this.assets.rooms, h.x, -h.z, h.y);
  }

  /** What is underfoot at a world point on the house's floors, porches and steps (null off them). */
  surfaceAt(x: number, y: number, z: number): GroundSurface | null {
    const h = this.toHouse(x, y, z);
    const s = this.floors.at(h.x, h.y, h.z);
    return s === 'stone' ? indoorSurface(s, roomOf(this.assets.rooms, h.x, -h.z, h.y) !== null) : s;
  }

  update(dt: number, camera: Camera, feet: Vector3, use: boolean): void {
    const near = camera.position.distanceTo(this.centre) < INTERIOR_RANGE;
    for (const [name, p] of this.parts) if (name !== 'exterior') p.group.visible = near;
    this.baked.interiorsDrawn.value = near ? 1 : 0;
    this.doors.update(dt, camera, feet, use);
  }
}

/**
 * The worker's arrays are adopted, not copied (BufferAttribute, not Float32BufferAttribute): each
 * is its own transferred buffer, owned by this geometry alone and never written afterwards.
 */
function geometry(g: DrawGroup): BufferGeometry {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(g.position, 3));
  geo.setAttribute('normal', new BufferAttribute(g.normal, 3));
  if (g.uv) geo.setAttribute('uv', new BufferAttribute(g.uv, 2));
  if (g.uv1) geo.setAttribute('uv1', new BufferAttribute(g.uv1, 2));
  if (g.irradiance) geo.setAttribute('bakedLight', new BufferAttribute(g.irradiance, 3));
  if (g.indoor) geo.setAttribute('indoor', new BufferAttribute(g.indoor, 1));
  geo.setIndex(new BufferAttribute(g.index, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}
