/**
 * Builds the game for offline capture: the normal vite build (vite.config.ts) plus the capture
 * overrides (overrides.mjs), into its own directory so the shipping dist is never touched.
 */
import { build } from 'vite';
import path from 'node:path';
import { captureOverrides } from './overrides.mjs';

export const CAPTURE_DIST = path.resolve('tools/out/cinematic-dist');

export async function buildCapture() {
  await build({
    configFile: path.resolve('vite.config.ts'),
    logLevel: 'warn',
    plugins: [captureOverrides()],
    build: { outDir: CAPTURE_DIST, emptyOutDir: true },
  });
  return CAPTURE_DIST;
}
