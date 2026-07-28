import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // Never cache the (future) sync API — only the app shell. Same
        // reasoning as usd-frontline's service-worker.js: caching live
        // submission/result endpoints would serve stale data.
        navigateFallbackDenylist: [/^\/api\//],
        // Defaults only cover a handful of extensions and cap files at
        // 2MiB — too small for the self-hosted OCR assets (WASM core +
        // gzipped traineddata), which is the whole point of bundling them:
        // capture (including OCR pre-fill) must work with zero network.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,wasm,gz}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
      },
      manifest: {
        name: 'Election Result Verification Platform',
        short_name: 'ResultTracker',
        start_url: '/',
        display: 'standalone',
        background_color: '#0b1220',
        theme_color: '#0b1220',
        icons: [],
      },
    }),
  ],
});
