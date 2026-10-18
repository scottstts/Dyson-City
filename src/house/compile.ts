/**
 * Compiles one glTF part of the house into what the engine draws and walks (pure; runs in the part
 * worker, tests call it directly):
 *
 *  - Static meshes are merged per (material, lighting kind) into a few large draws in the house
 *    frame. Lighting kinds:
 *     - `lightmap`: the static architecture, shaded albedo × lightmap (UV1);
 *     - `probe`: everything else indoors, its diffuse light from the SH probe grid baked per vertex
 *       (white-Lambertian outgoing radiance, the lightmaps' unit), so merged draws keep the light
 *       of each object's own room;
 *     - `exterior`: outdoors, lit like everything outdoors (the image-based light);
 *     - `mixed`: exterior meshes with faces turned indoors (windows, the outer doors' frames): a
 *       per-vertex indoor weight picks the baked light for the faces looking into a room.
 *  - Door leaves stay separate (the engine drives their local transform).
 *  - Collision proxies and lamp/sound empties are extracted and never drawn.
 *
 * Positions and normals stay in glTF axes (Y up, front +Z); the bake data is in Blender's frame
 * (x, −z, y), converted where it is read.
 */
import { readAccessor, normalMatrix, visitNodes, compose, type GltfDocument, type Mat4 } from './gltf';
import { ProbeGrid, shDiffuse } from './probeGrid';
import { rasteriseFloors, type FloorCells } from './floors';

export type LightKind = 'lightmap' | 'probe' | 'exterior' | 'mixed';

export interface DrawGroup {
  material: number;
  kind: LightKind;
  /** Lightmap entry (LM_G…) for `lightmap` groups. */
  lightmap: string | null;
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array | null;
  uv1: Float32Array | null;
  /** Baked diffuse light (white-Lambertian radiance, RGB) for `probe` and `mixed`. */
  irradiance: Float32Array | null;
  /** 1 on faces looking into a room (`mixed` only). */
  indoor: Float32Array | null;
  index: Uint32Array;
  /** Object names merged into this group (diagnostics). */
  names: string[];
}

export interface DoorLeaf {
  name: string;
  /** Rig (shut pose) to house frame, column-major. */
  rig: number[];
  /** Leaf's exported local translation and rotation (the open pose it was exported in). */
  translation: [number, number, number];
  rotation: [number, number, number, number];
  kind: 'hinge' | 'slide';
  /** Hinge: rest angle and limit (rad, signed); slide: rest offset and travel (m, signed). */
  rest: number;
  limit: number;
  handle: [number, number, number];
  /** Draw groups in the leaf's own frame. */
  groups: DrawGroup[];
  /** Collision box in the leaf's own frame (min, max). */
  box: [number, number, number, number, number, number] | null;
  /** SH at the leaf's middle (house frame), for its diffuse light wherever it swings. */
  sh: Float32Array;
  /** An outer door (part of the exterior). */
  exterior: boolean;
}

export type CollisionKind = 'trimesh' | 'box' | 'ramp';

export interface CollisionMesh {
  name: string;
  kind: CollisionKind;
  /** Triangles (house frame), indexed. */
  position: Float32Array;
  index: Uint32Array;
}

export interface Marker {
  name: string;
  kind: 'lamp' | 'sound';
  position: [number, number, number];
  extras: Record<string, unknown>;
}

/** An opening in the house's envelope (a window or an outer door's frame), house frame (glTF axes). */
export interface Aperture {
  name: string;
  min: [number, number, number];
  max: [number, number, number];
  /** Horizontal unit direction out of the house through it. */
  outward: [number, number];
}

export interface CompiledPart {
  part: string;
  groups: DrawGroup[];
  apertures: Aperture[];
  doors: DoorLeaf[];
  collision: CollisionMesh[];
  markers: Marker[];
  /** What is underfoot (floors.ts). */
  floors: FloorCells;
  /**
   * Drawn meshes with neither a collision proxy (COL_ twin, or a box on a door leaf) nor a reason for
   * none (`collision_none`, decided by geometry in blender/build/collision.py). Must be empty.
   */
  unaccounted: string[];
  stats: { meshes: number; triangles: number; vertices: number; ms: number };
}

interface GroupBuilder {
  material: number;
  kind: LightKind;
  lightmap: string | null;
  pos: number[];
  nrm: number[];
  uv: number[];
  uv1: number[];
  irr: number[];
  indoor: number[];
  idx: number[];
  names: string[];
  hasUv: boolean;
  hasUv1: boolean;
}

const tmpSH = new Float32Array(27);
const tmpE: [number, number, number] = [0, 0, 0];
const tmpE2: [number, number, number] = [0, 0, 0];

/** Exterior meshes with faces turned into a room: windows, the outer doors and their frames. */
const FACING_INDOORS = /^(Win_|Door_)/;

export function compilePart(part: string, doc: GltfDocument, bin: ArrayBuffer, grid: ProbeGrid): CompiledPart {
  const t0 = performance.now();
  const exteriorPart = part === 'exterior';
  const groups = new Map<string, GroupBuilder>();
  const doors: DoorLeaf[] = [];
  const collision: CollisionMesh[] = [];
  const markers: Marker[] = [];
  const apertures = new Map<string, Aperture>();
  // Every node inside a door leaf's subtree is handled with its leaf.
  const doorOwned = new Set<number>();
  const names = new Set(doc.nodes.map((n) => n.name ?? ''));
  const unaccounted: string[] = [];
  const parentOf = new Map<number, number>();
  doc.nodes.forEach((n, i) => n.children?.forEach((c) => parentOf.set(c, i)));
  let meshes = 0;

  const group = (map: Map<string, GroupBuilder>, material: number, kind: LightKind, lightmap: string | null): GroupBuilder => {
    const key = `${material}|${kind}|${lightmap ?? ''}`;
    let g = map.get(key);
    if (!g) {
      g = { material, kind, lightmap, pos: [], nrm: [], uv: [], uv1: [], irr: [], indoor: [], idx: [], names: [], hasUv: false, hasUv1: false };
      map.set(key, g);
    }
    return g;
  };

  /** Appends one mesh's primitives (transformed by `m`) to groups; `lightAt` maps to the house frame for the bake. */
  const appendMesh = (map: Map<string, GroupBuilder>, meshIndex: number, name: string, m: Mat4, extras: Record<string, unknown> | undefined, toHouse: Mat4, forceKind?: LightKind) => {
    meshes++;
    const nm = normalMatrix(m);
    const hm = normalMatrix(toHouse);
    for (const prim of doc.meshes[meshIndex].primitives) {
      if (prim.mode !== undefined && prim.mode !== 4) continue;
      const mat = prim.material ?? 0;
      const lightmap = typeof extras?.lightmap === 'string' ? (extras.lightmap as string) : null;
      const doubleSided = !!doc.materials[mat]?.doubleSided;
      const P = readAccessor(doc, bin, prim.attributes.POSITION) as Float32Array;
      const N = prim.attributes.NORMAL !== undefined ? (readAccessor(doc, bin, prim.attributes.NORMAL) as Float32Array) : null;
      const UV = prim.attributes.TEXCOORD_0 !== undefined ? (readAccessor(doc, bin, prim.attributes.TEXCOORD_0) as Float32Array) : null;
      const UV1 = prim.attributes.TEXCOORD_1 !== undefined ? (readAccessor(doc, bin, prim.attributes.TEXCOORD_1) as Float32Array) : null;
      const I = prim.indices !== undefined ? (readAccessor(doc, bin, prim.indices) as Uint32Array) : null;
      const count = P.length / 3;
      // Indoor weights first: an exterior mesh with any face turned into a room becomes `mixed`.
      let kind: LightKind = forceKind ?? (lightmap && UV1 ? 'lightmap' : exteriorPart ? 'exterior' : 'probe');
      const indoor = new Float32Array(count);
      const hx = new Float32Array(count * 3);
      const hn = new Float32Array(count * 3);
      for (let v = 0; v < count; v++) {
        const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
        hx[v * 3] = toHouse[0] * x + toHouse[4] * y + toHouse[8] * z + toHouse[12];
        hx[v * 3 + 1] = toHouse[1] * x + toHouse[5] * y + toHouse[9] * z + toHouse[13];
        hx[v * 3 + 2] = toHouse[2] * x + toHouse[6] * y + toHouse[10] * z + toHouse[14];
        if (N) {
          const a = N[v * 3], b = N[v * 3 + 1], c = N[v * 3 + 2];
          let qx = hm[0] * a + hm[1] * b + hm[2] * c;
          let qy = hm[3] * a + hm[4] * b + hm[5] * c;
          let qz = hm[6] * a + hm[7] * b + hm[8] * c;
          const l = Math.hypot(qx, qy, qz) || 1;
          qx /= l; qy /= l; qz /= l;
          hn[v * 3] = qx; hn[v * 3 + 1] = qy; hn[v * 3 + 2] = qz;
        } else {
          hn[v * 3 + 1] = 1;
        }
      }
      if (kind === 'exterior' && FACING_INDOORS.test(name)) {
        // Windows and the outer doors: a face looks indoors when it lies on the room's side of the
        // opening's mid-plane (through the mesh's middle, square to the way into its room).
        let cx = 0, cy = 0, cz = 0;
        for (let v = 0; v < count; v++) {
          cx += hx[v * 3];
          cy += hx[v * 3 + 1];
          cz += hx[v * 3 + 2];
        }
        cx /= count;
        cy /= count;
        cz /= count;
        // The nearest room's capture point (Blender frame) in glTF axes: the horizontal way in.
        const r = grid.nearestCapture(cx, -cz, cy);
        let dx = r[0] - cx;
        let dz = -r[1] - cz;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l;
        dz /= l;
        let any = false;
        for (let v = 0; v < count; v++) {
          const s = (hx[v * 3] + hn[v * 3] * 0.05 - cx) * dx + (hx[v * 3 + 2] + hn[v * 3 + 2] * 0.05 - cz) * dz;
          if (s > 0) {
            indoor[v] = 1;
            any = true;
          }
        }
        if (any) kind = 'mixed';
        // The opening it fills, for culling the outdoors from inside.
        let ap = apertures.get(name);
        if (!ap) apertures.set(name, (ap = { name, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], outward: [-dx, -dz] }));
        for (let v = 0; v < count; v++) {
          for (let k = 0; k < 3; k++) {
            ap.min[k] = Math.min(ap.min[k], hx[v * 3 + k]);
            ap.max[k] = Math.max(ap.max[k], hx[v * 3 + k]);
          }
        }
      }
      const g = group(map, mat, kind, kind === 'lightmap' ? lightmap : null);
      const base = g.pos.length / 3;
      g.names.push(name);
      for (let v = 0; v < count; v++) {
        const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
        g.pos.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
        if (N) {
          const a = N[v * 3], b = N[v * 3 + 1], c = N[v * 3 + 2];
          const qx = nm[0] * a + nm[1] * b + nm[2] * c;
          const qy = nm[3] * a + nm[4] * b + nm[5] * c;
          const qz = nm[6] * a + nm[7] * b + nm[8] * c;
          const l = Math.hypot(qx, qy, qz) || 1;
          g.nrm.push(qx / l, qy / l, qz / l);
        } else g.nrm.push(0, 1, 0);
        if (UV) {
          g.uv.push(UV[v * 2], UV[v * 2 + 1]);
          g.hasUv = true;
        } else g.uv.push(0, 0);
        if (kind === 'lightmap') {
          g.uv1.push(UV1![v * 2], UV1![v * 2 + 1]);
          g.hasUv1 = true;
        }
        if (kind === 'probe' || kind === 'mixed') {
          if (kind === 'mixed') g.indoor.push(indoor[v]);
          if (kind === 'mixed' && !indoor[v]) {
            g.irr.push(0, 0, 0);
            continue;
          }
          // Blender frame of the house: (x, −z, y).
          const px = hx[v * 3], py = -hx[v * 3 + 2], pz = hx[v * 3 + 1];
          const nx = hn[v * 3], ny = -hn[v * 3 + 2], nz = hn[v * 3 + 1];
          const room = grid.roomAt(px + nx * 0.1, py + ny * 0.1, pz + nz * 0.1);
          grid.shAt(px, py, pz, room, tmpSH);
          shDiffuse(tmpSH, nx, ny, nz, tmpE);
          if (doubleSided) {
            // Thin double-sided things (sheers, leaves) take light from both faces.
            shDiffuse(tmpSH, -nx, -ny, -nz, tmpE2);
            g.irr.push((tmpE[0] + tmpE2[0]) / 2, (tmpE[1] + tmpE2[1]) / 2, (tmpE[2] + tmpE2[2]) / 2);
          } else g.irr.push(tmpE[0], tmpE[1], tmpE[2]);
        }
      }
      if (I) for (let k = 0; k < I.length; k++) g.idx.push(I[k] + base);
      else for (let k = 0; k < count; k++) g.idx.push(k + base);
    }
  };

  const finish = (map: Map<string, GroupBuilder>): DrawGroup[] =>
    [...map.values()].map((g) => ({
      material: g.material,
      kind: g.kind,
      lightmap: g.lightmap,
      position: Float32Array.from(g.pos),
      normal: Float32Array.from(g.nrm),
      uv: g.hasUv ? Float32Array.from(g.uv) : null,
      uv1: g.hasUv1 ? Float32Array.from(g.uv1) : null,
      irradiance: g.kind === 'probe' || g.kind === 'mixed' ? Float32Array.from(g.irr) : null,
      indoor: g.kind === 'mixed' ? Float32Array.from(g.indoor) : null,
      index: Uint32Array.from(g.idx),
      names: g.names,
    }));

  const collisionOf = (meshIndex: number, name: string, kind: CollisionKind, m: Mat4): CollisionMesh => {
    const pos: number[] = [];
    const idx: number[] = [];
    for (const prim of doc.meshes[meshIndex].primitives) {
      const P = readAccessor(doc, bin, prim.attributes.POSITION) as Float32Array;
      const I = prim.indices !== undefined ? (readAccessor(doc, bin, prim.indices) as Uint32Array) : null;
      const base = pos.length / 3;
      for (let v = 0; v < P.length / 3; v++) {
        const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
        pos.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
      }
      if (I) for (const k of I) idx.push(k + base);
      else for (let k = 0; k < P.length / 3; k++) idx.push(k + base);
    }
    return { name, kind, position: Float32Array.from(pos), index: Uint32Array.from(idx) };
  };

  visitNodes(doc, ({ index, node, world, parent }) => {
    if (doorOwned.has(index)) {
      for (const c of node.children ?? []) doorOwned.add(c);
      return;
    }
    const name = node.name ?? `node${index}`;
    const x = node.extras;
    if (x && typeof x.collision === 'string') {
      collision.push(collisionOf(node.mesh!, name, x.collision as CollisionKind, world));
      return;
    }
    if (x && (x.kind === 'hinge' || x.kind === 'slide')) {
      for (const c of node.children ?? []) doorOwned.add(c);
      doors.push(compileDoor(index, name, world, parent));
      return;
    }
    if (name.startsWith('Lamp_') || name.startsWith('Sound_')) {
      markers.push({ name, kind: name.startsWith('Lamp_') ? 'lamp' : 'sound', position: [world[12], world[13], world[14]], extras: x ?? {} });
    }
    if (node.mesh !== undefined) {
      appendMesh(groups, node.mesh, name, world, x, world);
      if (!names.has(`COL_${name}`) && typeof x?.collision_none !== 'string') unaccounted.push(name);
    }
  });

  function compileDoor(index: number, name: string, world: Mat4, parent: number): DoorLeaf {
    const node = doc.nodes[index];
    const x = node.extras!;
    const parentWorld = world.slice() as Mat4;
    // Rig-to-house = world × local⁻¹: rebuild from the parent chain instead (the rig is the leaf's parent).
    const rig = rigWorld(parent);
    const local = new Map<string, GroupBuilder>();
    const ident = compose();
    // The leaf's own mesh in its own frame, lit (bake lookups) where it hangs now.
    if (node.mesh !== undefined) appendMesh(local, node.mesh, name, ident, x, parentWorld, exteriorPart ? 'exterior' : 'probe');
    let box: DoorLeaf['box'] = null;
    for (const c of node.children ?? []) {
      const cn = doc.nodes[c];
      if (cn.extras?.collision && cn.mesh !== undefined) {
        const cm = collisionOf(cn.mesh, cn.name ?? '', 'box', compose(cn.translation, cn.rotation, cn.scale));
        const b: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        for (let v = 0; v < cm.position.length / 3; v++) {
          for (let k = 0; k < 3; k++) {
            b[k] = Math.min(b[k], cm.position[v * 3 + k]);
            b[k + 3] = Math.max(b[k + 3], cm.position[v * 3 + k]);
          }
        }
        box = b;
      } else if (cn.mesh !== undefined) {
        appendMesh(local, cn.mesh, cn.name ?? name, compose(cn.translation, cn.rotation, cn.scale), cn.extras, parentWorld, exteriorPart ? 'exterior' : 'probe');
      }
    }
    if (!box && typeof x.collision_none !== 'string') unaccounted.push(name);
    // Light at the leaf's middle (either side's room may contribute: room −1).
    const cx = parentWorld[12], cy = parentWorld[13], cz = parentWorld[14];
    const sh = grid.shAt(cx, -cz, cy + 1.0, -1, new Float32Array(27));
    const kind = x.kind as 'hinge' | 'slide';
    const handle = (x.handle as number[] | undefined) ?? [0, 0, 1];
    return {
      name,
      rig: Array.from(rig),
      translation: (node.translation ?? [0, 0, 0]) as [number, number, number],
      rotation: (node.rotation ?? [0, 0, 0, 1]) as [number, number, number, number],
      kind,
      rest: Number(kind === 'hinge' ? x.open_angle ?? 0 : x.open_offset ?? 0),
      limit: Number(kind === 'hinge' ? x.open_max ?? 0 : x.travel ?? 0),
      // Blender leaf frame (x, y, z up) to glTF (x, z, −y).
      handle: [handle[0], handle[2], -handle[1]],
      groups: finish(local),
      box,
      sh,
      exterior: exteriorPart,
    };
  }

  function rigWorld(i: number): Mat4 {
    const chain: number[] = [];
    for (let k = i; k >= 0; k = parentOf.get(k) ?? -1) chain.push(k);
    let m = compose();
    for (let k = chain.length - 1; k >= 0; k--) {
      const n = doc.nodes[chain[k]];
      const l = n.matrix ? Float64Array.from(n.matrix) : compose(n.translation, n.rotation, n.scale);
      m = mul(m, l);
    }
    return m;
  }

  const out = finish(groups);
  let triangles = 0;
  let vertices = 0;
  for (const g of out) {
    triangles += g.index.length / 3;
    vertices += g.position.length / 3;
  }
  const floors = rasteriseFloors(out, (i) => doc.materials[i]?.name ?? '');
  return { part, groups: out, apertures: [...apertures.values()], doors, collision, markers, floors, unaccounted, stats: { meshes, triangles, vertices, ms: performance.now() - t0 } };
}

function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
