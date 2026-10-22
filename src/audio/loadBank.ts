/** Synthesises the audio bank in a worker (bank.ts), so the main thread stays free during boot. */
import type { AudioBank } from './bank';

export function loadAudioBank(sampleRate: number): Promise<AudioBank> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./bankWorker.ts', import.meta.url), { type: 'module' });
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(`Audio worker failed: ${e.message}`));
    };
    worker.onmessage = (e: MessageEvent<{ ok: true; bank: AudioBank } | { ok: false; error: string }>) => {
      worker.terminate();
      if (!e.data.ok) {
        reject(new Error(`Audio synthesis failed: ${e.data.error}`));
        return;
      }
      resolve(e.data.bank);
    };
    worker.postMessage({ sampleRate });
  });
}
