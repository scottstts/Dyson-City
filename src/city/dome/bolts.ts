/**
 * The frame's fasteners: hex bolt heads and nuts on every splice, base plate and node crown. They
 * are far too many to model per part, so they are collected as placements and drawn as instanced
 * meshes, tiled in plan so off-screen tiles are culled.
 */
import { InstancedMesh, Matrix4, Vector3, type Material } from 'three/webgpu';
import { emitParts, PolyMesh, v3, type Vec3 } from '../../geometry/polyMesh';

/** Hex head: circumradius (across flats ≈ 0.15 m), height, how far the top is drawn in (a chamfer read at range), seat depth. */
export const BOLT = { radius: 0.085, height: 0.095, draw: 0.012, sink: 0.01 } as const;

export interface Bolt {
  /** Point on the seat face the bolt stands on. */
  p: Vec3;
  /** Outward normal of that face (the bolt's axis). */
  axis: Vec3;
  /** A direction in the face (orients the hex). */
  spin: Vec3;
}

/** One bolt head, axis +Y, seated from y = −sink: six drawn-in sides and the top face (16 triangles). */
export function boltMesh(): PolyMesh {
  const m = new PolyMesh(30);
  const { radius: r, height: h, draw, sink } = BOLT;
  const ring = (rr: number, y: number) => Array.from({ length: 6 }, (_, k) => m.vert([rr * Math.cos((k * Math.PI) / 3), y, -rr * Math.sin((k * Math.PI) / 3)]));
  const a = ring(r, -sink);
  const t = ring(r - draw, h);
  for (let k = 0; k < 6; k++) {
    const k1 = (k + 1) % 6;
    m.face([a[k], a[k1], t[k1], t[k]]);
  }
  m.face([...t]);
  return m;
}

/** Instanced bolt meshes, one per plan tile of `tile` metres. */
export function buildBoltMeshes(bolts: readonly Bolt[], material: Material, name: string, tile = 250): InstancedMesh[] {
  const geometry = emitParts([boltMesh()], { slots: 1 });
  const tiles = new Map<string, Bolt[]>();
  for (const b of bolts) {
    const k = `${Math.floor(b.p[0] / tile)}:${Math.floor(b.p[2] / tile)}`;
    let list = tiles.get(k);
    if (!list) tiles.set(k, (list = []));
    list.push(b);
  }
  const out: InstancedMesh[] = [];
  const m = new Matrix4();
  const x = new Vector3();
  const y = new Vector3();
  const z = new Vector3();
  for (const [key, list] of tiles) {
    const mesh = new InstancedMesh(geometry, material, list.length);
    mesh.name = `${name}:${key}`;
    list.forEach((b, i) => {
      const ax = v3.norm(b.axis);
      const sx = v3.norm(v3.sub(b.spin, v3.scale(ax, v3.dot(b.spin, ax))));
      const sz = v3.cross(sx, ax);
      m.makeBasis(x.set(...sx), y.set(...ax), z.set(...sz)).setPosition(b.p[0], b.p[1], b.p[2]);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    out.push(mesh);
  }
  return out;
}

/** Evenly spaced points along a polyline in some 2D frame, about `pitch` apart, corners included. */
export function pitchAlong(path: [number, number][], pitch: number): [number, number][] {
  const out: [number, number][] = [path[0]];
  for (let i = 0; i + 1 < path.length; i++) {
    const [a, b] = [path[i], path[i + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(len / pitch));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}
