/**
 * Fetching and compiling the house's parts (no GPU work): the pack's index, the probe grid, and
 * each glTF part compiled in the house worker. The exterior is needed at boot (it stands in every
 * view of the estate and in the field's reflections); the floors and the rooms' reflections are
 * prepared right after it, in the background while the world is built (docs/house.md "Loading").
 */
import { HousePack, type PackEntry } from './pack';
import { HouseTextures } from './textures';
import type { CompiledPart } from './compile';
import type { GltfDocument } from './gltf';
import type { ProbeData, RoomBox } from './probeGrid';
import type { HouseWorkerReply, HouseWorkerRequest } from './houseWorker';

export const PART_NAMES = ['exterior', 'G', 'L1', 'L2'] as const;
export type PartName = (typeof PART_NAMES)[number];
/** The floors, in the order they are compiled and built. */
const FLOOR_NAMES = ['G', 'L1', 'L2'] as const satisfies readonly PartName[];

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

/** The floors and the rooms' prefiltered reflections, under way (each promise settles once). */
export interface HouseInteriors {
  /** Ground floor first: build them in this order. */
  readonly floors: readonly Promise<LoadedPart>[];
  readonly reflections: Promise<Uint32Array>;
}

export interface HouseAssets {
  readonly pack: HousePack;
  readonly textures: HouseTextures;
  readonly worker: HouseWorkerClient;
  readonly probes: ProbeData;
  readonly rooms: RoomBox[];
  /** The exterior, compiled (boot). */
  readonly exterior: LoadedPart;
  /** The floors and reflections, started as soon as the exterior is compiled. */
  readonly interiors: HouseInteriors;
}

interface FetchedPart {
  name: PartName;
  text: string;
  doc: GltfDocument;
  bin: ArrayBuffer;
  images: Promise<void>;
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

  const fetchPart = async (name: PartName): Promise<FetchedPart> => {
    const text = await pack.text(`house_${name}.gltf`);
    const doc = JSON.parse(text) as GltfDocument;
    // Images decode in parallel with the compile.
    const images = textures.preload((doc.images ?? []).map((i) => i.uri));
    return { name, text, doc, bin: await pack.bytes(doc.buffers[0].uri), images };
  };
  const compileFetched = async (f: FetchedPart): Promise<LoadedPart> => {
    const compiled = await worker.part(f.name, f.text, f.bin);
    await f.images;
    return { name: f.name, doc: f.doc, compiled };
  };
  const exterior = await compileFetched(await fetchPart('exterior'));
  console.info(`[Dyson] house exterior: ${exterior.compiled.stats.triangles} tris, compile ${exterior.compiled.stats.ms.toFixed(0)} ms, total ${(performance.now() - t0).toFixed(0)} ms`);
  return { pack, textures, worker, probes, rooms, exterior, interiors: prepareInteriors(fetchPart, compileFetched, rooms, pack, worker) };
}

/**
 * Starts the floors and reflections behind the exterior. Fetches run one entry ahead of the
 * worker (which compiles in message order), so at most two floors' raw buffers are alive at once:
 * the floor compiling and the one fetched behind it. Rejections are observed here and surface when
 * House.loadInteriors awaits them (the boot's 'interiors' stage).
 */
function prepareInteriors(
  fetchPart: (name: PartName) => Promise<FetchedPart>,
  compileFetched: (f: FetchedPart) => Promise<LoadedPart>,
  rooms: readonly RoomBox[],
  pack: HousePack,
  worker: HouseWorkerClient,
): HouseInteriors {
  const floors: Promise<LoadedPart>[] = [];
  let fetched: Promise<unknown> = Promise.resolve();
  for (const name of FLOOR_NAMES) {
    const gate = Promise.all([fetched, floors[floors.length - 2]]);
    const f = gate.then(() => fetchPart(name));
    fetched = f;
    floors.push(f.then(compileFetched));
  }
  const reflections = Promise.all([fetched, floors[floors.length - 2]])
    .then(() => Promise.all(rooms.map((r) => pack.bytes(`refl_${r.name}`))))
    .then((captures) => worker.reflections(captures));
  for (const p of [...floors, reflections]) p.catch(() => undefined);
  return { floors, reflections };
}

export type { PackEntry };
