/**
 * Texture-backed noise: one trilinear fetch per octave from the boot-time tileable volumes
 * (see noiseVolumes.ts), four channels per fetch. Used for the star's static fields; only the
 * animated granulation keeps exact procedural cellular noise.
 */
import { Data3DTexture, LinearFilter, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three/webgpu';
import { vec3, texture3D } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { CELL_PERIOD, CELL_SIZE, VALUE_PERIOD, VALUE_SIZE } from '../noiseVolumes';

type V3 = Node<'vec3'>;

export interface NoiseVolumes {
  value: Data3DTexture;
  cellular: Data3DTexture;
}

function makeVolume(data: Uint8Array, size: number, name: string): Data3DTexture {
  const tex = new Data3DTexture(data, size, size, size);
  tex.name = name;
  tex.format = RGBAFormat;
  tex.type = UnsignedByteType;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.wrapR = RepeatWrapping;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

export function generateNoiseVolumes(): Promise<NoiseVolumes> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../noiseWorker.ts', import.meta.url), { type: 'module' });
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(`Noise worker failed: ${e.message}`));
    };
    worker.onmessage = (e: MessageEvent<{ ok: true; value: Uint8Array; cellular: Uint8Array; millis: number } | { ok: false; error: string }>) => {
      worker.terminate();
      if (!e.data.ok) {
        reject(new Error(`Noise generation failed: ${e.data.error}`));
        return;
      }
      console.info(`[Dyson] noise volumes ${e.data.millis.toFixed(0)} ms`);
      resolve({ value: makeVolume(e.data.value, VALUE_SIZE, 'noise.value'), cellular: makeVolume(e.data.cellular, CELL_SIZE, 'noise.cellular') });
    };
    worker.postMessage(null);
  });
}

let volumes: NoiseVolumes | null = null;

/** Must be called once before any shader using the functions below is built. */
export function setNoiseVolumes(v: NoiseVolumes): void {
  volumes = v;
}

function need(): NoiseVolumes {
  if (!volumes) throw new Error('Noise volumes requested before generation');
  return volumes;
}

/** Four independent smooth value noises in [0, 1] from one fetch (lattice frequency 1 per unit). */
export function vNoise4(p: V3): Node<'vec4'> {
  return texture3D(need().value, p.div(VALUE_PERIOD)) as unknown as Node<'vec4'>;
}

/** Static Worley noise: vec3(F1, F2, cell id); lattice frequency 1 per unit. */
export function vCellular(p: V3): V3 {
  const s = texture3D(need().cellular, p.div(CELL_PERIOD));
  return vec3(s.x, s.y.mul(1.5), s.z) as unknown as V3;
}

