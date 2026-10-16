/**
 * The house bundle (`house.pack`, blender/docs/house.md "Export"): `DCPK`, u32 version, u32 index
 * length, the JSON index, then every entry at a 256-byte-aligned absolute offset. The game reads
 * it from the asset host by HTTP Range requests, one entry at a time, so nothing is fetched before
 * it is needed and nothing is decoded beyond the browser's own image decoding.
 *
 * Fetched entries are kept in the Cache API (keyed by a hash of the index, so a re-export never
 * serves stale bytes), so a second visit loads the house from disk.
 */

/** Where the house bundle lives (never the local assets/ copy). */
export const HOUSE_PACK_URL = 'https://pub-f86f1e8e87f44fa0b55fb73275682731.r2.dev/house.pack';

export interface PackEntry {
  name: string;
  type: 'gltf' | 'bin' | 'image' | 'texture' | 'sh9';
  offset: number;
  length: number;
  [key: string]: unknown;
}

export interface PackPlacement {
  site: [number, number];
  face: [number, number];
}

export interface PackIndex {
  version: number;
  placement: PackPlacement;
  entries: PackEntry[];
}

const CACHE_NAME = 'dyson-house-pack';

async function rangeBytes(url: string, start: number, length: number): Promise<ArrayBuffer> {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${start + length - 1}` } });
  if (res.status !== 206 && res.status !== 200) throw new Error(`house.pack: HTTP ${res.status} for bytes ${start}+${length}`);
  const buf = await res.arrayBuffer();
  // A server that ignores Range answers 200 with the whole file: take the slice.
  if (res.status === 200) {
    if (buf.byteLength < start + length) throw new Error('house.pack: short response');
    return buf.slice(start, start + length);
  }
  if (buf.byteLength !== length) throw new Error(`house.pack: expected ${length} bytes, got ${buf.byteLength}`);
  return buf;
}

/** FNV-1a over the index bytes: the cache version. */
function hash(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export class HousePack {
  readonly index: PackIndex;
  private readonly url: string;
  private readonly byName = new Map<string, PackEntry>();
  private readonly pending = new Map<string, Promise<ArrayBuffer>>();
  private readonly version: string;
  private cache: Cache | null = null;

  private constructor(url: string, index: PackIndex, version: string, cache: Cache | null) {
    this.url = url;
    this.index = index;
    this.version = version;
    this.cache = cache;
    for (const e of index.entries) this.byName.set(e.name, e);
  }

  static async open(url = HOUSE_PACK_URL): Promise<HousePack> {
    const head = new DataView(await rangeBytes(url, 0, 12));
    const magic = String.fromCharCode(head.getUint8(0), head.getUint8(1), head.getUint8(2), head.getUint8(3));
    if (magic !== 'DCPK') throw new Error(`house.pack: bad magic "${magic}"`);
    const version = head.getUint32(4, true);
    if (version !== 1) throw new Error(`house.pack: unsupported version ${version}`);
    const len = head.getUint32(8, true);
    const raw = new Uint8Array(await rangeBytes(url, 12, len));
    const index = JSON.parse(new TextDecoder().decode(raw)) as PackIndex;
    let cache: Cache | null;
    try {
      cache = typeof caches !== 'undefined' ? await caches.open(CACHE_NAME) : null;
    } catch {
      cache = null;
    }
    return new HousePack(url, index, hash(raw), cache);
  }

  entry(name: string): PackEntry {
    const e = this.byName.get(name);
    if (!e) throw new Error(`house.pack: no entry "${name}"`);
    return e;
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  /** The entry's bytes (fetched once; concurrent requests share the fetch). */
  bytes(name: string): Promise<ArrayBuffer> {
    let p = this.pending.get(name);
    if (!p) {
      p = this.load(this.entry(name));
      this.pending.set(name, p);
      // Large entries are handed off (transferred to workers): do not pin them here.
      void p.then(() => this.pending.delete(name), () => this.pending.delete(name));
    }
    return p;
  }

  async text(name: string): Promise<string> {
    return new TextDecoder().decode(await this.bytes(name));
  }

  private async load(e: PackEntry): Promise<ArrayBuffer> {
    const key = `${this.url}?v=${this.version}&entry=${encodeURIComponent(e.name)}`;
    if (this.cache) {
      try {
        const hit = await this.cache.match(key);
        if (hit) {
          const buf = await hit.arrayBuffer();
          if (buf.byteLength === e.length) return buf;
        }
      } catch {
        // a cache miss or a broken cache just means the network
      }
    }
    const buf = await rangeBytes(this.url, e.offset, e.length);
    if (this.cache) {
      const cache = this.cache;
      // Stored in the background; a full disk is not an error.
      void cache.put(key, new Response(buf.slice(0), { headers: { 'Content-Type': 'application/octet-stream' } })).catch(() => undefined);
    }
    return buf;
  }

  /** Drops cached entries of other exports (call once the house has loaded). */
  async pruneCache(): Promise<void> {
    if (!this.cache) return;
    try {
      for (const req of await this.cache.keys()) if (!req.url.includes(`v=${this.version}&`)) await this.cache.delete(req);
    } catch {
      // best effort
    }
  }
}
