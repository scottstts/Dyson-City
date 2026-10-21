/**
 * "No detached parts" for the crew's rigs (docs/crew.md, "Geometry"): every closed piece of every
 * part, posed, touches the rest of its robot. The clash audit lets a segment's own parts meet
 * (they are one rigid body), so a piece floating inside one segment (a yoke's plates beside their
 * post) passes it; this finds it.
 *
 * Each part is split into its closed pieces (a `set:` part has several); each piece's surface is
 * sampled into 4 mm voxels; two pieces touch where their voxels coincide or are face neighbours
 * (so within ~4 mm: a bearing's running clearance is contact, a visible gap is not).
 */
import { Matrix4, Vector3 } from 'three';
import { Pose, solveFK, type RigDef } from '../../src/crew/rig';
import type { PolyMesh, Vec3 } from '../../src/geometry/polyMesh';

const VOXEL = 0.004;
const OFF = 2048;
const K = 4096;

/** The closed pieces of a mesh: faces joined by shared (welded) vertices. */
function pieces(m: PolyMesh): number[][] {
  const key = (v: Vec3) => `${Math.round(v[0] * 1e6)},${Math.round(v[1] * 1e6)},${Math.round(v[2] * 1e6)}`;
  const weld = new Map<string, number>();
  const id = m.verts.map((v) => {
    const k = key(v);
    if (!weld.has(k)) weld.set(k, weld.size);
    return weld.get(k)!;
  });
  const parent = Array.from({ length: weld.size }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const f of m.faces) for (let k = 1; k < f.length; k++) parent[find(id[f[k]])] = find(id[f[0]]);
  const groups = new Map<number, number[]>();
  m.faces.forEach((f, i) => {
    const r = find(id[f[0]]);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(i);
  });
  return [...groups.values()];
}

/** The rig's pieces grouped by contact: one group when nothing is detached. */
export function contactGroups(rig: RigDef, pose: Pose = new Pose(rig.segments.length)): string[][] {
  const world = rig.segments.map(() => new Matrix4());
  solveFK(rig, new Matrix4(), pose, world);
  const names: string[] = [];
  const voxels: Set<number>[] = [];
  const p = new Vector3();
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  rig.segments.forEach((s, si) => {
    // Parts are modelled in rest space; a segment's matrix moves its pivot's frame.
    const m = new Matrix4().copy(world[si]).multiply(new Matrix4().makeTranslation(-s.pivot[0], -s.pivot[1], -s.pivot[2]));
    for (const part of s.parts) {
      pieces(part.mesh).forEach((faces, k, all) => {
        const set = new Set<number>();
        for (const fi of faces) {
          const f = part.mesh.faces[fi];
          for (let t = 1; t + 1 < f.length; t++) {
            a.fromArray(part.mesh.verts[f[0]]).applyMatrix4(m);
            b.fromArray(part.mesh.verts[f[t]]).applyMatrix4(m);
            c.fromArray(part.mesh.verts[f[t + 1]]).applyMatrix4(m);
            const n = Math.max(1, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / (VOXEL * 0.5)));
            for (let i = 0; i <= n; i++) {
              for (let j = 0; i + j <= n; j++) {
                const u = i / n;
                const v = j / n;
                p.set(0, 0, 0).addScaledVector(a, 1 - u - v).addScaledVector(b, u).addScaledVector(c, v);
                set.add(Math.floor(p.x / VOXEL) + OFF + (Math.floor(p.y / VOXEL) + OFF) * K + (Math.floor(p.z / VOXEL) + OFF) * K * K);
              }
            }
          }
        }
        names.push(all.length > 1 ? `${s.name}:${part.name}#${k}` : `${s.name}:${part.name}`);
        voxels.push(set);
      });
    }
  });
  const parent = names.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owner = new Map<number, number>();
  const steps = [0, 1, -1, K, -K, K * K, -K * K];
  voxels.forEach((set, n) => {
    for (const v of set) {
      for (const d of steps) {
        const o = owner.get(v + d);
        if (o !== undefined && o !== n) parent[find(n)] = find(o);
      }
    }
    for (const v of set) if (!owner.has(v)) owner.set(v, n);
  });
  const groups = new Map<number, string[]>();
  names.forEach((name, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(name);
  });
  return [...groups.values()].sort((x, y) => y.length - x.length);
}
