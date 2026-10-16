/**
 * Fetching and compiling the house's parts (no GPU work): the pack's index, the probe grid, and
 * each glTF part compiled in the house worker. The exterior is needed at boot (it stands in every
 * view of the estate and in the field's reflections); the floors stream in afterwards.
 */
import { HousePack, type PackEntry } from './pack';
import { HouseTextures } from './textures';
import type { CompiledPart } from './compile';
import type { GltfDocument } from './gltf';
import type { ProbeData, RoomBox } from './probeGrid';
import type { HouseWorkerReply, HouseWorkerRequest } from './houseWorker';

export const PART_NAMES = ['exterior', 'G', 'L1', 'L2'] as const;
export type PartName = (typeof PART_NAMES)[number];

export interface LoadedPart {
  name: PartName;
  doc: GltfDocument;
  compiled: CompiledPart;
}

export class HouseWorkerClient {
  private readonly worker: Worker;
  private next = 1;
  private readonly waiting = new Map<number, { resolve: (r: HouseWorkerReply) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker = new Worker(new URL('./houseWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<HouseWorkerReply>) => {
      const w = this.waiting.get(ev.data.id);
      if (!w) return;
      this.waiting.delete(ev.data.id);
      if ('error' in ev.data) w.reject(new Error(`house worker: ${ev.data.error}`));
      else w.resolve(ev.data);
    };
    this.worker.onerror = (e) => {
      const err = new Error(`house worker failed: ${e.message}`);
      for (const w of this.waiting.values()) w.reject(err);
      this.waiting.clear();
    };
  }

  init(probes: ProbeData): void {
    this.worker.postMessage({ type: 'init', probes } satisfies HouseWorkerRequest);
  }

  private call(msg: HouseWorkerRequest & { id: number }, transfer: Transferable[]): Promise<HouseWorkerReply> {
    return new Promise((resolve, reject) => {
      this.waiting.set(msg.id, { resolve, reject });
      this.worker.postMessage(msg, transfer);
    });
  }

  async part(part: string, gltf: string, bin: ArrayBuffer): Promise<CompiledPart> {
    const r = await this.call({ type: 'part', id: this.next++, part, gltf, bin }, [bin]);
    if (!('part' in r)) throw new Error('house worker: bad reply');
    return r.part;
  }

  async reflections(captures: ArrayBuffer[]): Promise<Uint32Array> {
    const r = await this.call({ type: 'reflections', id: this.next++, captures }, captures);
    if (!('atlas' in r)) throw new Error('house worker: bad reply');
    return new Uint32Array(r.atlas);
  }

  dispose(): void {
    this.worker.terminate();
  }
}

export interface HouseAssets {
  readonly pack: HousePack;
  readonly textures: HouseTextures;
  readonly worker: HouseWorkerClient;
  readonly probes: ProbeData;
  readonly rooms: RoomBox[];
  /** The exterior, compiled (boot). */
  readonly exterior: LoadedPart;
  /** Compiles a floor (fetches its glTF, buffer and images). */
  loadPart(name: PartName): Promise<LoadedPart>;
}

/** Opens the pack and compiles the exterior: the boot-time half of the house. */
export async function loadHouseAssets(): Promise<HouseAssets> {
  const t0 = performance.now();
  const pack = await HousePack.open();
  const textures = new HouseTextures(pack);
  const worker = new HouseWorkerClient();
  const probeEntry = pack.entry('probes');
  const rooms: RoomBox[] = pack.index.entries
    .filter((e) => e.name.startsWith('refl_'))
    .map((e) => ({ name: String(e.room), level: Number(e.level), box: e.box as RoomBox['box'], position: e.position as RoomBox['position'] }));
  const probes: ProbeData = {
    coefficients: new Float32Array(await pack.bytes('probes')),
    points: probeEntry.points as ProbeData['points'],
    rooms: probeEntry.rooms as string[],
    boxes: rooms,
  };
  worker.init(probes);

  const loadPart = async (name: PartName): Promise<LoadedPart> => {
    const gltfName = `house_${name}.gltf`;
    const text = await pack.text(gltfName);
    const doc = JSON.parse(text) as GltfDocument;
    const binName = doc.buffers[0].uri;
    // Images decode in parallel with the compile.
    const images = textures.preload((doc.images ?? []).map((i) => i.uri));
    const compiled = await worker.part(name, text, await pack.bytes(binName));
    await images;
    return { name, doc, compiled };
  };
  const exterior = await loadPart('exterior');
  console.info(`[Dyson] house exterior: ${exterior.compiled.stats.triangles} tris, compile ${exterior.compiled.stats.ms.toFixed(0)} ms, total ${(performance.now() - t0).toFixed(0)} ms`);
  return { pack, textures, worker, probes, rooms, exterior, loadPart };
}

export type { PackEntry };
