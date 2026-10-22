/// <reference lib="webworker" />
import { generateCellularVolume, generateValueVolume } from './noiseVolumes';

self.onmessage = () => {
  try {
    const value = generateValueVolume();
    const cellular = generateCellularVolume();
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ ok: true, value, cellular }, [value.buffer, cellular.buffer]);
  } catch (error) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
