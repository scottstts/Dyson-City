/// <reference lib="webworker" />
import { generateCellularVolume, generateValueVolume } from './noiseVolumes';

self.onmessage = () => {
  try {
    const t0 = performance.now();
    const value = generateValueVolume();
    const cellular = generateCellularVolume();
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ ok: true, value, cellular, millis: performance.now() - t0 }, [value.buffer, cellular.buffer]);
  } catch (error) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
