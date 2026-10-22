import { DataTexture, DataUtils, RGBAFormat, HalfFloatType, LinearFilter, ClampToEdgeWrapping, Vector3 } from 'three/webgpu';
import { STAR_GLARE_SAMPLES } from '../render/glare';
import { Fn, float, vec2, texture, uniform, sqrt, abs, atan, asin, sign, PI, max } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { LUT } from './params';
import { PLASMA_LUT } from '../sky/medium/plasma';
import { ENCLOSURE_LUT } from '../sky/structure/enclosure';
import { CORONA_SAMPLES } from '../sky/star/corona';
import type { AtmosphereWorkerResult } from './worker';

export interface AtmosphereTextures {
  skyLocalS: DataTexture;
  skyLocalT: DataTexture;
  /** Star glare against the angle from the star's centre (render/glare.ts). */
  starGlare: DataTexture;
  /** Coronal column against the sight line's impact parameter (sky/star/corona.ts). */
  corona: DataTexture;
  aerialS: DataTexture;
  aerialT: DataTexture;
  groundIrradiance: Vector3;
  skyIrradiance: Vector3;
  /** Interior plasma line integrals (sky/medium/plasma.ts). */
  plasma: DataTexture;
  /** Shell light transport (sky/structure/enclosure.ts). */
  enclosurePre: DataTexture;
  enclosurePreMirror: DataTexture;
  enclosureIrr: DataTexture;
  shellMean: Vector3;
}

function makeTexture(data: Uint16Array, width: number, height: number, name: string): DataTexture {
  const tex = new DataTexture(data, width, height, RGBAFormat, HalfFloatType);
  tex.name = name;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** 32-bit float textures are not filterable in WebGPU without an optional feature: store half floats. */
function makeFloatTexture(data: Float32Array, width: number, height: number, name: string): DataTexture {
  const half = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) half[i] = DataUtils.toHalfFloat(data[i]);
  const tex = new DataTexture(half, width, height, RGBAFormat, HalfFloatType);
  tex.name = name;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Runs the boot precompute (air, star glare, corona, plasma, shell transport) in a worker so boot keeps the UI responsive. */
export function computeAtmosphereTextures(): Promise<AtmosphereTextures> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(`Atmosphere worker failed: ${e.message}`));
    };
    worker.onmessage = (e: MessageEvent<{ ok: true; result: AtmosphereWorkerResult } | { ok: false; error: string }>) => {
      worker.terminate();
      if (!e.data.ok) {
        reject(new Error(`Atmosphere precompute failed: ${e.data.error}`));
        return;
      }
      const r = e.data.result;
      resolve({
        skyLocalS: makeTexture(r.skyLocal.scatter, LUT.skyWidth, LUT.skyHeight, 'atmo.skyLocal.S'),
        skyLocalT: makeTexture(r.skyLocal.transmittance, LUT.skyWidth, LUT.skyHeight, 'atmo.skyLocal.T'),
        starGlare: makeFloatTexture(r.starGlare, STAR_GLARE_SAMPLES, 1, 'glare.star'),
        corona: makeFloatTexture(r.corona, CORONA_SAMPLES, 1, 'star.corona'),
        aerialS: makeTexture(r.aerial.scatter, LUT.apWidth, LUT.apHeight, 'atmo.aerial.S'),
        aerialT: makeTexture(r.aerial.transmittance, LUT.apWidth, LUT.apHeight, 'atmo.aerial.T'),
        groundIrradiance: new Vector3(...r.groundIrradiance),
        skyIrradiance: new Vector3(...r.skyIrradiance),
        plasma: makeTexture(r.plasma, PLASMA_LUT.width, PLASMA_LUT.height, 'plasma.lines'),
        enclosurePre: makeTexture(r.enclosurePre, ENCLOSURE_LUT.preWidth, ENCLOSURE_LUT.preHeight, 'enclosure.pre'),
        enclosurePreMirror: makeTexture(r.enclosurePreMirror, ENCLOSURE_LUT.preWidth, ENCLOSURE_LUT.preHeight, 'enclosure.preMirror'),
        enclosureIrr: makeTexture(r.enclosureIrr, ENCLOSURE_LUT.irrWidth, ENCLOSURE_LUT.irrRows, 'enclosure.irradiance'),
        shellMean: new Vector3(...r.shellMean),
      });
    };
    worker.postMessage(null);
  });
}

/** LUT v coordinate for a view elevation (mirrors precompute.vFromElevation). */
export const elevationToV = Fn(([dirY]: [Node<'float'>]) => {
  const e = asin(dirY.clamp(-1, 1));
  return float(0.5).add(sign(e).mul(sqrt(abs(e).div(PI.mul(0.5)).min(1))).mul(0.5));
});

/** Sky-view LUT coordinates for a local-frame direction (quadrant-symmetric azimuth). */
export const skyLutUV = Fn(([dir]: [Node<'vec3'>]) => {
  const az = atan(abs(dir.z), max(abs(dir.x), 1e-7));
  const u = sqrt(az.div(PI.mul(0.5)).clamp(0, 1));
  return vec2(u, elevationToV(dir.y));
});

/** Aerial-perspective LUT coordinates for a view elevation and a distance in metres. */
export const aerialLutUV = Fn(([dirY, distanceM]: [Node<'float'>, Node<'float'>]) => {
  const u = sqrt(distanceM.div(LUT.apMaxDistanceKm * 1000).clamp(0, 1));
  return vec2(u, elevationToV(dirY));
});

export interface AtmosphereNodes {
  readonly tex: AtmosphereTextures;
  /** Uniform: horizontal irradiance on the deck from the attenuated star. */
  readonly groundIrradiance: Node<'vec3'>;
  /** Uniform: horizontal irradiance on the deck from scattered skylight. */
  readonly skyIrradiance: Node<'vec3'>;
}

export function createAtmosphereNodes(tex: AtmosphereTextures): AtmosphereNodes {
  return { tex, groundIrradiance: uniform(tex.groundIrradiance), skyIrradiance: uniform(tex.skyIrradiance) };
}

/** Samples (scatter, transmittance) from a LUT texture pair. */
export function sampleLut(sTex: DataTexture, tTex: DataTexture, uv: Node<'vec2'>): { S: Node<'vec3'>; T: Node<'vec3'> } {
  return { S: texture(sTex, uv).rgb, T: texture(tTex, uv).rgb };
}

