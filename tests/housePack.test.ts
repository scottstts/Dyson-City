import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

/**
 * The house bundle exported from Blender (blender/build/export.py; format in blender/docs/house.md).
 * Checks its structure: header, index, entry ranges and alignment, glTF parts resolving every buffer
 * and image to an entry, RGB9E5 texture sizes, the probe grid, and the door rig data the engine drives.
 * Skipped when the pack has not been exported.
 */
const PACK = new URL('../assets/house.pack', import.meta.url);
const has = fs.existsSync(PACK);

interface Entry {
  name: string;
  type: string;
  offset: number;
  length: number;
  [k: string]: unknown;
}

function read() {
  const buf = fs.readFileSync(PACK);
  const magic = buf.toString('ascii', 0, 4);
  const version = buf.readUInt32LE(4);
  const len = buf.readUInt32LE(8);
  const index = JSON.parse(buf.toString('utf8', 12, 12 + len)) as { entries: Entry[]; placement: unknown; lamps?: Record<string, { radiance: number[] }> };
  const slice = (e: Entry) => buf.subarray(e.offset, e.offset + e.length);
  return { buf, magic, version, len, index, slice };
}

describe.skipIf(!has)('house pack', () => {
  const { buf, magic, version, len, index, slice } = has ? read() : ({} as ReturnType<typeof read>);
  const byName = new Map((index?.entries ?? []).map((e) => [e.name, e]));

  it('has the header, an index and aligned, non-overlapping entries inside the file', () => {
    expect(magic).toBe('DCPK');
    expect(version).toBe(1);
    const sorted = [...index.entries].sort((a, b) => a.offset - b.offset);
    expect(sorted[0].offset).toBeGreaterThanOrEqual(12 + len);
    let end = 0;
    for (const e of sorted) {
      expect(e.offset % 256).toBe(0);
      expect(e.offset).toBeGreaterThanOrEqual(end);
      end = e.offset + e.length;
    }
    expect(end).toBeLessThanOrEqual(buf.length);
    expect(index.placement).toBeTruthy();
  });

  it('holds four glTF parts whose buffers and images all resolve to entries', () => {
    const parts = index.entries.filter((e) => e.type === 'gltf');
    expect(parts.map((p) => p.part).sort()).toEqual(['G', 'L1', 'L2', 'exterior']);
    for (const p of parts) {
      const doc = JSON.parse(slice(p).toString('utf8'));
      for (const b of doc.buffers) {
        const e = byName.get(b.uri);
        expect(e, b.uri).toBeTruthy();
        expect(e!.length).toBe(b.byteLength);
      }
      for (const im of doc.images ?? []) expect(byName.get(im.uri), im.uri).toBeTruthy();
    }
  });

  it('stores lightmaps and reflection captures as RGB9E5 of the stated size', () => {
    const tex = index.entries.filter((e) => e.type === 'texture');
    expect(tex.filter((t) => t.name.startsWith('LM_')).map((t) => t.name).sort()).toEqual(['LM_G', 'LM_L1', 'LM_L2']);
    for (const t of tex) {
      expect(t.format).toBe('rgb9e5ufloat');
      expect(t.length).toBe((t.width as number) * (t.height as number) * 4);
    }
    // decoded values are finite, non-negative radiance with some light in every lightmap
    for (const name of ['LM_G', 'LM_L1', 'LM_L2']) {
      const d = slice(byName.get(name)!);
      let lit = 0;
      for (let i = 0; i < d.length; i += 4 * 997) {
        const v = d.readUInt32LE(i);
        const e = (v >>> 27) - 15 - 9;
        const r = (v & 511) * 2 ** e;
        if (r > 1e-3) lit++;
      }
      expect(lit).toBeGreaterThan(10);
    }
  });

  it('gives the lit lamps\' shades and glass a glow from their flux, dim beside daylight (white sunlit ≈ 2)', () => {
    const { index } = read();
    expect(Object.keys(index.lamps ?? {}).sort()).toEqual(['lamp_glass', 'lampshade']);
    for (const [name, g] of Object.entries(index.lamps!)) {
      expect(g.radiance, name).toHaveLength(3);
      // a lit shade or bowl is a few hundred cd/m², ~0.01–0.1 on the game's scale; warm (red over blue)
      expect(Math.max(...g.radiance), name).toBeGreaterThan(0.005);
      expect(Math.max(...g.radiance), name).toBeLessThan(0.3);
      expect(g.radiance[0], name).toBeGreaterThan(g.radiance[2]);
    }
  });

  it('carries the SH probe grid with one entry per point', () => {
    const p = byName.get('probes')!;
    expect(p.length).toBe((p.count as number) * 9 * 3 * 4);
    expect((p.points as unknown[]).length).toBe(p.count);
  });

  it('gives every door leaf a rig parent and the data to open and shut it', () => {
    for (const part of index.entries.filter((e) => e.type === 'gltf')) {
      const doc = JSON.parse(slice(part).toString('utf8'));
      const parentOf = new Map<number, number>();
      doc.nodes.forEach((n: { children?: number[] }, i: number) => n.children?.forEach((c) => parentOf.set(c, i)));
      doc.nodes.forEach((n: { name: string; extras?: Record<string, unknown> }, i: number) => {
        const x = n.extras;
        if (!x || (x.kind !== 'hinge' && x.kind !== 'slide')) return;
        const parent = doc.nodes[parentOf.get(i)!];
        expect(parent?.name, n.name).toMatch(/^DoorRig_/);
        expect(Array.isArray(x.handle)).toBe(true);
        if (x.kind === 'hinge') {
          expect(typeof x.open_max).toBe('number');
          expect(Math.abs(x.open_angle as number)).toBeLessThanOrEqual(Math.abs(x.open_max as number) + 1e-6);
        } else {
          expect(typeof x.travel).toBe('number');
        }
      });
    }
  });
});
