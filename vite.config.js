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
        name: 'VerifiVote',
        short_name: 'VerifiVote',
        start_url: '/',
        display: 'standalone',
        background_color: '#FFFFFF',
        theme_color: '#1F3864',
        // From VerifiVote_Logo_Pack.zip's README.md — 'any' entries
        // for standard home-screen icons, 'maskable' entries so Android
        // adaptive icons don't clip the shield/checkmark under the OS's
        // own circle/rounded/squircle mask.
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    watch: {
      // `npx ampx sandbox` writes/renames files rapidly under .amplify/
      // during deploys; on Windows, Vite's watcher holding a handle on
      // those files causes CDK's build-then-rename step to fail with
      // EPERM. Confirmed live: stopping the dev server was what fixed a
      // reproducible deploy failure here. Excluding the folder lets both
      // run at the same time without the dev server needing to be
      // stopped for every redeploy.
      ignored: ['**/.amplify/**'],
    },
  },
});
