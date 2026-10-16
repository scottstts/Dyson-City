/**
 * The house's off-main-thread work: compiling glTF parts (compile.ts: merging, per-vertex probe
 * light, collision extraction) and prefiltering the rooms' reflection captures (reflections.ts),
 * so streaming a floor in never stalls a frame.
 */
import { compilePart, type CompiledPart, type DrawGroup } from './compile';
import { ProbeGrid, type ProbeData } from './probeGrid';
import { prefilterCapture, REFL } from './reflections';
import type { GltfDocument } from './gltf';

export type HouseWorkerRequest =
  | { type: 'init'; probes: ProbeData }
  | { type: 'part'; id: number; part: string; gltf: string; bin: ArrayBuffer }
  | { type: 'reflections'; id: number; captures: ArrayBuffer[] };

export type HouseWorkerReply = { id: number; part: CompiledPart } | { id: number; atlas: ArrayBuffer } | { id: number; error: string };

let grid: ProbeGrid | null = null;

function groupBuffers(g: DrawGroup, out: Transferable[]): void {
  for (const a of [g.position, g.normal, g.uv, g.uv1, g.irradiance, g.indoor, g.index]) if (a) out.push(a.buffer);
}

self.onmessage = (ev: MessageEvent<HouseWorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      grid = new ProbeGrid(msg.probes);
      return;
    }
    if (msg.type === 'part') {
      if (!grid) throw new Error('house worker: probes not initialised');
      const part = compilePart(msg.part, JSON.parse(msg.gltf) as GltfDocument, msg.bin, grid);
      const transfer: Transferable[] = [];
      for (const g of part.groups) groupBuffers(g, transfer);
      for (const d of part.doors) for (const g of d.groups) groupBuffers(g, transfer);
      for (const c of part.collision) transfer.push(c.position.buffer, c.index.buffer);
      transfer.push(part.floors.keys.buffer, part.floors.heights.buffer, part.floors.surfaces.buffer);
      (self as unknown as Worker).postMessage({ id: msg.id, part } satisfies HouseWorkerReply, transfer);
      return;
    }
    const layer = REFL.atlasW * REFL.atlasH;
    const atlas = new Uint32Array(layer * msg.captures.length);
    msg.captures.forEach((c, i) => prefilterCapture(new Uint32Array(c), atlas.subarray(i * layer, (i + 1) * layer)));
    (self as unknown as Worker).postMessage({ id: msg.id, atlas: atlas.buffer } satisfies HouseWorkerReply, [atlas.buffer]);
  } catch (e) {
    (self as unknown as Worker).postMessage({ id: 'id' in msg ? msg.id : -1, error: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e) } satisfies HouseWorkerReply);
  }
};
