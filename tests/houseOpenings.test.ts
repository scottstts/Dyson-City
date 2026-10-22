import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openingPlane, isIndoor } from '../src/house/openings';
import { readAccessor, visitNodes, type GltfDocument } from '../src/house/gltf';

/**
 * Which faces of a window or an outer door look into a room (src/house/openings.ts): the plane is
 * the wall's, whatever the room behind it. The old plane (through each primitive's centroid, square to
 * the way to the room's capture point, up to 44° off the wall) cut casings and the front door's
 * leaves in half and lit their outer faces with the room's light.
 */

/** A window block: `w` wide along the wall, `d` deep across it (wall from −d/2 to +d/2, room at +),
 *  with an exterior casing standing 6 cm proud. Rotated by `a` about the vertical. */
function windowMesh(a: number): { pos: Float32Array; casing: number[] } {
  const pts: number[][] = [];
  const casing: number[] = [];
  const box = (x0: number, x1: number, d0: number, d1: number, tag: boolean) => {
    for (const x of [x0, x1]) for (const d of [d0, d1]) for (const y of [0, 2]) {
      if (tag) casing.push(pts.length);
      pts.push([x, y, d]);
    }
  };
  box(-0.6, 0.6, -0.15, 0.15, false);      // frame through the wall
  box(-0.8, 0.8, -0.21, -0.15, true);      // exterior casing (outdoors)
  box(-0.75, 0.75, 0.15, 0.17, false);     // interior casing
  const c = Math.cos(a), s = Math.sin(a);
  // glTF x/z: along the wall (c, s), into the room (−s, c)
  const pos = new Float32Array(pts.flatMap(([x, y, d]) => [x * c - d * s, y, x * s + d * c]));
  return { pos, casing };
}

describe('opening plane', () => {
  it('is the wall plane even when the room lies far off its axis', () => {
    for (const a of [0, 0.3, Math.PI / 4, 2.2]) {
      const { pos, casing } = windowMesh(a);
      const inward = [-Math.sin(a), Math.cos(a)];
      // The room's capture 3 m in and 2.5 m along the wall (40° off the normal).
      const rx = 3 * inward[0] + 2.5 * Math.cos(a);
      const rz = 3 * inward[1] + 2.5 * Math.sin(a);
      const p = openingPlane(pos, rx, rz);
      expect(p.dx * inward[0] + p.dz * inward[1]).toBeGreaterThan(Math.cos((0.5 * Math.PI) / 180));
      // The exterior casing's outer face (normal outward) is outdoors at every vertex.
      for (const v of casing) {
        expect(isIndoor(p, pos[v * 3], pos[v * 3 + 2], -inward[0], -inward[1])).toBe(0);
      }
      // The interior casing's room face is indoors.
      const n = pos.length / 3;
      for (let v = n - 8; v < n; v++) {
        const s = (pos[v * 3] - p.cx) * inward[0] + (pos[v * 3 + 2] - p.cz) * inward[1];
        if (s > 0.16) expect(isIndoor(p, pos[v * 3], pos[v * 3 + 2], inward[0], inward[1])).toBe(1);
      }
    }
  });
});

const PACK = new URL('../assets/house.pack', import.meta.url);

describe.skipIf(!fs.existsSync(PACK))('the house pack', () => {
  it("gives every window and outer door its wall's plane", () => {
    const buf = fs.readFileSync(PACK);
    const len = buf.readUInt32LE(8);
    const index = JSON.parse(buf.toString('utf8', 12, 12 + len)) as { entries: { name: string; offset: number; length: number; position?: number[] }[] };
    const slice = (n: string) => {
      const e = index.entries.find((x) => x.name === n)!;
      return buf.buffer.slice(buf.byteOffset + e.offset, buf.byteOffset + e.offset + e.length) as ArrayBuffer;
    };
    const doc = JSON.parse(new TextDecoder().decode(slice('house_exterior.gltf'))) as GltfDocument;
    const bin = slice('house_exterior.bin');
    // Room middles (glTF x, z): the side of the wall the room is on.
    const rooms = index.entries.filter((e) => e.name.startsWith('refl_')).map((e) => [e.position![0], -e.position![1]]);
    let checked = 0;
    const worst: string[] = [];
    visitNodes(doc, ({ node, world }) => {
      if (node.mesh === undefined || !/^(Win_|Door_)/.test(node.name ?? '') || node.extras?.collision) return;
      const P: number[] = [];
      const tris: number[] = [];
      for (const prim of doc.meshes[node.mesh].primitives) {
        const A = readAccessor(doc, bin, prim.attributes.POSITION) as Float32Array;
        const I = readAccessor(doc, bin, prim.indices!) as Uint32Array;
        const base = P.length / 3;
        for (let v = 0; v < A.length; v += 3) {
          const x = A[v], y = A[v + 1], z = A[v + 2];
          P.push(world[0] * x + world[4] * y + world[8] * z + world[12], world[1] * x + world[5] * y + world[9] * z + world[13], world[2] * x + world[6] * y + world[10] * z + world[14]);
        }
        for (const i of I) tris.push(i + base);
      }
      const pos = Float32Array.from(P);
      // The wall's axis from the faces themselves: area-weighted orientation of the vertical faces
      // (the glass, the leaves, the casings' faces), independent of the vertices' spread.
      let sxx = 0, sxz = 0, szz = 0;
      let cx = 0, cz = 0;
      for (let t = 0; t < tris.length; t += 3) {
        const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]].map((i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const nx = u[1] * w[2] - u[2] * w[1], ny = u[2] * w[0] - u[0] * w[2], nz = u[0] * w[1] - u[1] * w[0];
        const area2 = Math.hypot(nx, ny, nz);
        if (area2 < 1e-12 || Math.abs(ny) / area2 > 0.3) continue;
        const h = Math.hypot(nx, nz);
        sxx += (nx * nx) / h;
        sxz += (nx * nz) / h;
        szz += (nz * nz) / h;
      }
      const tr = sxx + szz, det = sxx * szz - sxz * sxz;
      const lmax = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
      let ax = Math.abs(sxz) > 1e-12 ? lmax - szz : sxx > szz ? 1 : 0;
      let az = Math.abs(sxz) > 1e-12 ? sxz : sxx > szz ? 0 : 1;
      const l = Math.hypot(ax, az);
      ax /= l;
      az /= l;
      for (let v = 0; v < pos.length; v += 3) {
        cx += pos[v];
        cz += pos[v + 2];
      }
      cx /= pos.length / 3;
      cz /= pos.length / 3;
      const room = rooms.reduce((best, r) => (Math.hypot(r[0] - cx, r[1] - cz) < Math.hypot(best[0] - cx, best[1] - cz) ? r : best));
      const p = openingPlane(pos, room[0], room[1]);
      const deg = (Math.acos(Math.min(1, Math.abs(p.dx * ax + p.dz * az))) * 180) / Math.PI;
      if (deg > 3) worst.push(`${node.name}: ${deg.toFixed(1)}°`);
      checked++;
    });
    expect(checked).toBeGreaterThanOrEqual(51);   // every exterior opening, leaves and frames apart
    expect(worst).toEqual([]);
  });
});
