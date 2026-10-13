import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    // Pre-bundle every three entry point up front so lazily discovered addons never invalidate
    // the dependency cache mid-session.
    include: [
      'three',
      'three/webgpu',
      'three/tsl',
      'three/addons/tsl/display/GTAONode.js',
      'three/addons/tsl/display/TRAANode.js',
      'three/addons/tsl/display/BloomNode.js',
      'three/addons/tsl/display/GaussianBlurNode.js',
    ],
  },
  build: {
    target: 'es2023',
    chunkSizeWarningLimit: 2000,
  },
});
