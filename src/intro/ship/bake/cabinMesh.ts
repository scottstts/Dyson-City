/**
 * What the cabin's bake covers (docs/intro-ship.md, "Light"), shared by the game and the bake's
 * export (tools/ship-bake/export.ts), so both walk the same corners in the same order.
 *
 *  - The cabin set: the cabin-slot faces of every fixed part (parts order, faces in order).
 *  - The leaf set: the door leaf's cabin-slot faces (its inner cap), baked shut.
 *
 * A set's corners are numbered in that order (part by part, face by face, corner by corner), each
 * face's from its canonical first corner (`firstCorner`); the bake stores per-corner values in it. Its fingerprint (positions to 0.1 mm, face sizes, slots)
 * ties a bake to the geometry it was baked on: the game refuses a stale bake. The 0.1 mm grid is
 * offset by 0.3 of a step: designed dimensions fall on its half-steps (a 2.5 mm bevel), where a last
 * bit of difference between two engines' trigonometry (Node, Chrome) flipped the rounding.
 */
import { PolyMesh } from '../../../geometry/polyMesh';
import { isCabinSlot } from '../slots';

/** The faces of a part in the slots `keep` admits (vertices shared; unused ones are not emitted). */
export function slotsOf(m: PolyMesh, keep: (slot: number) => boolean): PolyMesh {
  const out = new PolyMesh(m.crease);
  out.verts = m.verts;
  m.faces.forEach((f, i) => {
    if (keep(m.faceMat[i])) out.face(f, m.faceMat[i], m.uvs[i]);
  });
  return out;
}

/** The cabin-slot faces of each mesh, without the meshes that have none. */
export function cabinFaces(meshes: readonly PolyMesh[]): PolyMesh[] {
  return meshes.map((m) => slotsOf(m, isCabinSlot)).filter((m) => m.faces.length > 0);
}

/** Corner count of a set of meshes (only its faces in `keep`). */
export function cornerCount(meshes: readonly PolyMesh[], keep: (slot: number) => boolean = () => true): number {
  let n = 0;
  for (const m of meshes) m.faces.forEach((f, i) => (n += keep(m.faceMat[i]) ? f.length : 0));
  return n;
}

/** A position on the fingerprint's grid (0.1 mm, offset: module doc). */
const q = (c: number) => Math.round(c * 1e4 + 0.3) | 0;

/**
 * A face's canonical first corner: the one lowest on the grid (x, then y, then z). Its loop's own
 * start is not stable across engines: the convex kernel orders a loop by angle, and a corner at
 * ±π lands first in one engine and last in another (Chrome and Node differ in a last bit).
 */
export function firstCorner(m: PolyMesh, face: number): number {
  const f = m.faces[face];
  let best = 0;
  for (let c = 1; c < f.length; c++) {
    const a = m.verts[f[c]];
    const b = m.verts[f[best]];
    for (let i = 0; i < 3; i++) {
      const d = q(a[i]) - q(b[i]);
      if (d < 0) best = c;
      if (d !== 0) break;
    }
  }
  return best;
}

/** FNV-1a over the set's faces in `keep`: quantized corner positions, face sizes and slots. */
export function fingerprint(meshes: readonly PolyMesh[], keep: (slot: number) => boolean = () => true): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  const mix = (v: number) => {
    a = Math.imul(a ^ (v & 0xffff), 0x01000193) >>> 0;
    a = Math.imul(a ^ (v >>> 16), 0x01000193) >>> 0;
    b = Math.imul(b ^ (v & 0xffff), 0x5bd1e995) >>> 0;
    b = (Math.imul(b ^ (v >>> 16), 0x5bd1e995) ^ (b >>> 13)) >>> 0;
  };
  for (const m of meshes) {
    m.faces.forEach((f, i) => {
      if (!keep(m.faceMat[i])) return;
      mix(f.length);
      mix(m.faceMat[i]);
      const s = firstCorner(m, i);
      for (let c = 0; c < f.length; c++) for (const x of m.verts[f[(s + c) % f.length]]) mix(q(x));
    });
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
