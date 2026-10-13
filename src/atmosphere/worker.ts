/// <reference lib="webworker" />
import { computeAtmosphere } from './precompute';
import { ATMOSPHERE, LUT } from './params';
import { splitScatterTransmittance, toHalfArray } from './halfFloat';
import { computeStarGlareTable } from '../render/glare';
import { STAR_ANGULAR_RADIUS } from '../world/constants';
import { computePlasmaLut } from '../sky/medium/plasma';
import { solveEnclosure, sampleSky } from '../sky/structure/enclosure';

/** Boot precompute: local air, star glare, the interior plasma and the shell's light transport. */
export interface AtmosphereWorkerResult {
  skyLocal: { scatter: Uint16Array; transmittance: Uint16Array };
  /** Star glare table (render/glare.ts), RGBA float. */
  starGlare: Float32Array;
  aerial: { scatter: Uint16Array; transmittance: Uint16Array };
  groundIrradiance: [number, number, number];
  skyIrradiance: [number, number, number];
  /** Plasma line integrals (sky/medium/plasma.ts), RGBA half: Ĩ, τ. */
  plasma: Uint16Array;
  /** Enclosure tables (sky/structure/enclosure.ts), RGBA half. */
  enclosurePre: Uint16Array;
  enclosurePreMirror: Uint16Array;
  enclosureIrr: Uint16Array;
  shellMean: [number, number, number];
  millis: number;
}

self.onmessage = () => {
  try {
    const t0 = performance.now();
    const enclosure = solveEnclosure(computePlasmaLut());
    // The air is lit by the whole sky over the habitat: the star and the shell.
    const luts = computeAtmosphere(ATMOSPHERE, (cosTheta, out) => sampleSky(enclosure.sky, Math.acos(cosTheta), out));
    const skyTexels = LUT.skyWidth * LUT.skyHeight;
    const apTexels = LUT.apWidth * LUT.apHeight;
    const result: AtmosphereWorkerResult = {
      skyLocal: splitScatterTransmittance(luts.skyLocal, skyTexels),
      starGlare: computeStarGlareTable((STAR_ANGULAR_RADIUS * 180) / Math.PI),
      aerial: splitScatterTransmittance(luts.aerial, apTexels),
      groundIrradiance: luts.groundIrradiance,
      skyIrradiance: luts.skyIrradiance,
      plasma: toHalfArray(enclosure.plasma),
      enclosurePre: toHalfArray(enclosure.pre),
      enclosurePreMirror: toHalfArray(enclosure.preMirror),
      enclosureIrr: toHalfArray(enclosure.irr),
      shellMean: enclosure.shellMean,
      millis: performance.now() - t0,
    };
    const transfer = [result.skyLocal, result.aerial]
      .flatMap((p) => [p.scatter.buffer, p.transmittance.buffer])
      .concat([result.starGlare.buffer, result.plasma.buffer, result.enclosurePre.buffer, result.enclosurePreMirror.buffer, result.enclosureIrr.buffer]);
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ ok: true, result }, transfer);
  } catch (error) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
  }
};
