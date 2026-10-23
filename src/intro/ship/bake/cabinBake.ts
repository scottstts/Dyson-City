/**
 * The cabin's baked light (docs/intro-ship.md, "Light"), as Blender baked it (blender/ship/bake.py)
 * and tools/ship-bake/pack.ts packed it. Loaded at boot; a stale bake (its geometry fingerprint not
 * the ship's) is a boot error, never a fallback.
 */
import type { CabinCapture } from './spec';

export const CABIN_BAKE_VERSION = 1;
/** On the asset host with the house's bundle (the headless tools pass it through: tools/serveDist.mjs). */
export const CABIN_BAKE_URL = 'https://pub-f86f1e8e87f44fa0b55fb73275682731.r2.dev/ship-cabin.bin';

export type BakeObject = 'cabin' | 'leaf';

/**
 * The layers the game reads: the light sets (bake/spec.ts, pre-summed by the pack: each scene's
 * outside with the lamps and the screens, never dimmed in the film; the open door's), and `ao`, a
 * short-range ambient occlusion for the specular occlusion. The leaf keeps its shut light.
 */
export const CABIN_LIGHT: Record<BakeObject, readonly string[]> = {
  cabin: ['space', 'band', 'door', 'ao'],
  leaf: ['space', 'band', 'ao'],
};

/** The reflection captures' light sets (layers per capture, in this order). */
export const CAPTURE_SETS = ['space', 'band', 'door'] as const;

export interface ObjectBake {
  /** Lightmap atlas size (square), and the light sets in it. */
  atlas: number;
  sets: readonly string[];
  /** Corners of the object's set (bake/cabinMesh.ts order). */
  corners: number;
  /** Per corner: lightmap UV (u16 × 2, 0xffff: none, use the corner's light). */
  uv: Uint16Array;
  /** Per set: per corner RGB9E5 light, and the lightmap (RGB9E5, rows from v = 0). */
  vx: Map<string, Uint32Array>;
  lm: Map<string, Uint32Array>;
}

export interface CabinBake {
  fingerprint: Record<BakeObject, string>;
  objects: Record<BakeObject, ObjectBake>;
  captures: readonly CabinCapture[];
  /** Per light set, the prefiltered reflection captures (house/reflections.ts layout; a layer each). */
  refl: Map<string, Uint32Array>;
}

export function parseCabinBake(buf: ArrayBuffer): CabinBake {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'DCSB') throw new Error(`ship-cabin.bin: bad magic "${magic}"`);
  const version = dv.getUint32(4, true);
  if (version !== CABIN_BAKE_VERSION) throw new Error(`ship-cabin.bin: version ${version}, expected ${CABIN_BAKE_VERSION}`);
  const jl = dv.getUint32(8, true);
  const index = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, jl))) as {
    fingerprint: Record<BakeObject, string>;
    objects: Record<BakeObject, { atlas: number; sets: string[]; corners: number }>;
    captures: CabinCapture[];
    reflSets: string[];
    sections: Record<string, { offset: number; length: number }>;
  };
  const base = 12 + jl + ((4 - ((12 + jl) % 4)) % 4);
  const section = <T>(name: string, Ctor: new (b: ArrayBuffer, o: number, n: number) => T): T => {
    const s = index.sections[name];
    if (!s) throw new Error(`ship-cabin.bin: no section "${name}"`);
    return new Ctor(buf, base + s.offset, s.length);
  };
  const expected = CABIN_LIGHT;
  const objects = {} as Record<BakeObject, ObjectBake>;
  for (const name of ['cabin', 'leaf'] as const) {
    const o = index.objects[name];
    if (!o || o.sets.join() !== expected[name].join()) throw new Error(`ship-cabin.bin: ${name} sets ${o?.sets}, expected ${expected[name]}`);
    const vx = new Map<string, Uint32Array>();
    const lm = new Map<string, Uint32Array>();
    for (const set of o.sets) {
      vx.set(set, section(`vx.${name}.${set}`, Uint32Array));
      lm.set(set, section(`lm.${name}.${set}`, Uint32Array));
    }
    objects[name] = { atlas: o.atlas, sets: o.sets, corners: o.corners, uv: section(`uv.${name}`, Uint16Array), vx, lm };
  }
  const refl = new Map<string, Uint32Array>();
  for (const set of index.reflSets) refl.set(set, section(`refl.${set}`, Uint32Array));
  return { fingerprint: index.fingerprint, objects, captures: index.captures, refl };
}

export async function loadCabinBake(url = CABIN_BAKE_URL): Promise<CabinBake> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ship cabin bake: HTTP ${res.status} for ${url}`);
  return parseCabinBake(await res.arrayBuffer());
}
