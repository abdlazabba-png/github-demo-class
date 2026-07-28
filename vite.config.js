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
