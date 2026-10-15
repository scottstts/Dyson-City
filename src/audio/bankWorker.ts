/// <reference lib="webworker" />
import { bankBuffers, buildAudioBank } from './bank';

self.onmessage = (e: MessageEvent<{ sampleRate: number }>) => {
  try {
    const t0 = performance.now();
    const bank = buildAudioBank(e.data.sampleRate);
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ ok: true, bank, millis: performance.now() - t0 }, bankBuffers(bank));
  } catch (error) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
