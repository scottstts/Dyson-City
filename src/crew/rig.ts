/**
 * Rigid rigs (docs/crew.md): every robot is a tree of rigid segments, each a few named parts
 * modelled in the robot's rest pose (metres, +y up, +z forward, +x the robot's left). A segment
 * turns about its pivot; its parts are emitted in its own frame (rest axes, origin at the pivot).
 *
 * A machine has no skin to deform: forward kinematics poses each segment and the GPU draws it as an
 * instance. Every robot of a type shares one InstancedMesh per segment, so a type costs one draw
 * per segment and material slot however many there are, and three keeps each instance's previous
 * matrix for motion vectors (TAA sees a walking leg move, not smear).
 */
import { InstancedMesh, Matrix4, Quaternion, Vector3, type Material } from 'three/webgpu';
import { emitParts, type PolyMesh, type Vec3 } from '../geometry/polyMesh';
import { moved } from './kit/shapes';

export interface PartDef {
  name: string;
  mesh: PolyMesh;
}

export interface SegmentDef {
  name: string;
  /** Index of the parent segment (−1: the root, posed by the robot's own matrix). */
  parent: number;
  /** Pivot in the rest pose (model space). */
  pivot: Vec3;
  parts: PartDef[];
}

export interface RigDef {
  name: string;
  segments: SegmentDef[];
}

/** A rig under construction: segments are added parent first, parts to any segment by name. */
export class RigBuilder {
  readonly def: RigDef;
  private readonly index = new Map<string, number>();

  constructor(name: string) {
    this.def = { name, segments: [] };
  }

  segment(name: string, parent: string | null, pivot: Vec3): number {
    if (this.index.has(name)) throw new Error(`duplicate segment ${name}`);
    const p = parent === null ? -1 : this.index.get(parent);
    if (p === undefined) throw new Error(`unknown parent ${parent}`);
    this.def.segments.push({ name, parent: p, pivot: [...pivot] as Vec3, parts: [] });
    this.index.set(name, this.def.segments.length - 1);
    return this.def.segments.length - 1;
  }

  add(segment: string, name: string, mesh: PolyMesh): PolyMesh {
    const i = this.index.get(segment);
    if (i === undefined) throw new Error(`unknown segment ${segment}`);
    const seg = this.def.segments[i];
    if (seg.parts.some((p) => p.name === name)) throw new Error(`duplicate part ${segment}:${name}`);
    seg.parts.push({ name, mesh });
    return mesh;
  }

  has(segment: string): boolean {
    return this.index.has(segment);
  }
}

/** Index of a segment by name. */
export function segmentIndex(rig: RigDef, name: string): number {
  const i = rig.segments.findIndex((s) => s.name === name);
  if (i < 0) throw new Error(`${rig.name}: no segment ${name}`);
  return i;
}

/** Every part, named `rig:segment:part`, placed in the rest pose (model space). */
export function restParts(rig: RigDef): PartDef[] {
  return rig.segments.flatMap((s) => s.parts.map((p) => ({ name: `${rig.name}:${s.name}:${p.name}`, mesh: p.mesh })));
}

/** A pose: each segment's rotation about its pivot (in its parent's frame) and an extra slide. */
export class Pose {
  readonly q: Quaternion[];
  readonly t: Vector3[];

  constructor(n: number) {
    this.q = Array.from({ length: n }, () => new Quaternion());
    this.t = Array.from({ length: n }, () => new Vector3());
  }

  reset(): this {
    for (const q of this.q) q.identity();
    for (const t of this.t) t.set(0, 0, 0);
    return this;
  }
}

const _local = new Matrix4();
const _rot = new Matrix4();

/**
 * Forward kinematics: world matrices of every segment, from the robot's root matrix (its place in
 * the world, origin on the ground between its feet) and a pose. `out` holds one matrix per segment.
 */
export function solveFK(rig: RigDef, root: Matrix4, pose: Pose, out: Matrix4[]): Matrix4[] {
  const segs = rig.segments;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const pp = s.parent >= 0 ? segs[s.parent].pivot : ([0, 0, 0] as Vec3);
    const t = pose.t[i];
    _local.makeTranslation(s.pivot[0] - pp[0] + t.x, s.pivot[1] - pp[1] + t.y, s.pivot[2] - pp[2] + t.z);
    _rot.makeRotationFromQuaternion(pose.q[i]);
    _local.multiply(_rot);
    out[i].multiplyMatrices(s.parent >= 0 ? out[s.parent] : root, _local);
  }
  return out;
}

/** The world position of a segment's pivot after FK. */
export function pivotOf(world: Matrix4[], i: number, out: Vector3): Vector3 {
  const e = world[i].elements;
  return out.set(e[12], e[13], e[14]);
}

/** One InstancedMesh per segment for `count` robots of one rig; poses are written per robot. */
export class RigBatch {
  readonly rig: RigDef;
  readonly meshes: (InstancedMesh | null)[];
  readonly count: number;
  readonly triangles: number;

  constructor(rig: RigDef, count: number, materials: Material[], slots: number) {
    this.rig = rig;
    this.count = count;
    let tris = 0;
    this.meshes = rig.segments.map((s) => {
      if (!s.parts.length) return null;
      const local = s.parts.map((p) => moved(p.mesh, [-s.pivot[0], -s.pivot[1], -s.pivot[2]]));
      const geo = emitParts(local, { slots });
      tris += (geo.index!.count / 3) * count;
      const m = new InstancedMesh(geo, materials, count);
      m.name = `Crew.${rig.name}.${s.name}`;
      // Robots spread over the whole Dome: a bounding sphere would always hold some of them.
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      return m;
    });
    this.triangles = tris;
  }

  /** Writes robot k's segment matrices. */
  set(k: number, world: readonly Matrix4[]): void {
    for (let i = 0; i < this.meshes.length; i++) this.meshes[i]?.setMatrixAt(k, world[i]);
  }

  commit(): void {
    for (const m of this.meshes) if (m) m.instanceMatrix.needsUpdate = true;
  }

  setMaterials(materials: Material[]): void {
    for (const m of this.meshes) if (m) m.material = materials;
  }

  get list(): InstancedMesh[] {
    return this.meshes.filter((m): m is InstancedMesh => !!m);
  }
}

/**
 * Two levels of one robot type (rig.ts batches at full detail and at the far level): each frame a
 * robot goes into the near batch within `near` metres of the eye, the far one beyond. Robots fill
 * each batch in their own order, so a robot keeps its slot (and its motion vectors) until one of
 * those before it changes level; each batch draws only the slots it filled.
 */
export class LodBatch {
  readonly near: RigBatch;
  readonly far: RigBatch;
  readonly distance: number;
  private n = 0;
  private f = 0;

  constructor(near: RigBatch, far: RigBatch, distance: number) {
    this.near = near;
    this.far = far;
    this.distance = distance;
  }

  begin(): void {
    this.n = 0;
    this.f = 0;
  }

  put(world: readonly Matrix4[], distance: number): void {
    if (distance < this.distance) this.near.set(this.n++, world);
    else this.far.set(this.f++, world);
  }

  commit(): void {
    for (const m of this.near.list) m.count = this.n;
    for (const m of this.far.list) m.count = this.f;
    this.near.commit();
    this.far.commit();
  }

  get list(): InstancedMesh[] {
    return [...this.near.list, ...this.far.list];
  }

  get triangles(): { near: number; far: number } {
    return { near: this.near.triangles / Math.max(1, this.near.count), far: this.far.triangles / Math.max(1, this.far.count) };
  }

  setMaterials(materials: Material[]): void {
    this.near.setMaterials(materials);
    this.far.setMaterials(materials);
  }
}
