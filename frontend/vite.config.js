import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // MediaPipe ships pre-built bundles — exclude from Vite's dep optimizer
    exclude: ['@mediapipe/hands'],
  },
  server: {
    headers: {
      // Allow SharedArrayBuffer for MediaPipe WASM (needed in dev)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
