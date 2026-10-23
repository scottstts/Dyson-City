import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { PolyMesh } from '../src/geometry/polyMesh';
import { buildShipParts } from '../src/intro/ship/ship';
import { buildDoorLeaf } from '../src/intro/ship/door';
import { cabinFaces, cornerCount, fingerprint, firstCorner } from '../src/intro/ship/bake/cabinMesh';
import { CABIN_LIGHT, parseCabinBake } from '../src/intro/ship/bake/cabinBake';
import { isCabinSlot } from '../src/intro/ship/slots';

const cabin = cabinFaces(buildShipParts().list.map((p) => p.mesh));
const leaf = buildDoorLeaf();

/** The same meshes with every face's loop started one corner on. */
function rotated(meshes: PolyMesh[]): PolyMesh[] {
  return meshes.map((m) => {
    const out = new PolyMesh(m.crease);
    out.verts = m.verts;
    m.faces.forEach((f, i) => out.face([...f.slice(1), f[0]], m.faceMat[i], [...m.uvs[i].slice(1), m.uvs[i][0]]));
    return out;
  });
}

describe('the ship cabin bake', () => {
  it('numbers corners from a canonical first corner, wherever a loop starts', () => {
    // Chrome and Node start some of the convex kernel's loops at different corners (a last-bit
    // difference at ±π): the bake's corner order and fingerprint must not depend on it.
    const r = rotated(cabin);
    expect(fingerprint(r)).toBe(fingerprint(cabin));
    cabin.forEach((m, mi) =>
      m.faces.forEach((f, fi) => {
        const a = f[firstCorner(m, fi)];
        const b = r[mi].faces[fi][firstCorner(r[mi], fi)];
        expect(b).toBe(a);
      }),
    );
  });

  const file = 'assets/ship-cabin.bin';
  it.skipIf(!fs.existsSync(file))('matches the ship it was baked on (assets/ship-cabin.bin)', () => {
    const b = fs.readFileSync(file);
    const bake = parseCabinBake(new Uint8Array(b).buffer);
    expect(bake.fingerprint.cabin).toBe(fingerprint(cabin, isCabinSlot));
    expect(bake.fingerprint.leaf).toBe(fingerprint(leaf, isCabinSlot));
    expect(bake.objects.cabin.corners).toBe(cornerCount(cabin, isCabinSlot));
    expect(bake.objects.leaf.corners).toBe(cornerCount(leaf, isCabinSlot));
    for (const o of ['cabin', 'leaf'] as const) {
      const ob = bake.objects[o];
      expect(ob.sets).toEqual(CABIN_LIGHT[o]);
      for (const s of ob.sets) {
        expect(ob.lm.get(s)!.length).toBe(ob.atlas * ob.atlas);
        expect(ob.vx.get(s)!.length).toBe(ob.corners);
      }
      // Every lightmap UV inside the atlas.
      for (let i = 0; i < ob.uv.length; i++) if (ob.uv[i] !== 0xffff) expect(ob.uv[i]).toBeLessThanOrEqual(0xfffe);
    }
  });
});
