import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// The dashboard entry bundle's OWN, fully independent Vite build — not a
// second entry inside vite.config.js's rollupOptions.input. Deliberately
// two separate build passes rather than one multi-page config: vite-
// plugin-pwa's shipped README doesn't document per-entry scoping for
// multi-page apps, and getting the installability work wrong by
// accidentally injecting a manifest link, a service-worker registration,
// or Tesseract/OCR asset precaching into the dashboard bundle is exactly
// the kind of mistake worth avoiding by construction instead of trusting
// undocumented plugin behavior. No VitePWA plugin here at all — this
// bundle has no offline/install requirement (NEXT_STEPS_WORK_ORDER.md).
export default defineConfig({
  plugins: [react()],
  // Deliberately NOT base: '/dashboard/', even though this bundle IS
  // served from that path — confirmed live, not assumed: setting it made
  // the built HTML request /dashboard/assets/index-*.js, but Vite's build
  // always writes JS/CSS into the flat <outDir>/assets/ folder regardless
  // of which HTML entry emitted them (only the HTML FILE itself
  // reproduces its input-relative path under outDir; the assets/ folder
  // doesn't nest per-entry), so those requests 404'd against the real
  // file at dist/assets/index-*.js. Leaving `base` at its default ('/')
  // makes Vite emit root-relative asset references instead
  // (/assets/index-*.js), which resolve correctly from ANY path,
  // including /dashboard/ — same reasoning already applied to this file's
  // favicon links.
  // No public/ directory of its own — the agent build (which runs first,
  // see package.json's "build" script) already copies public/ (icons,
  // Tesseract/OCR assets this bundle doesn't even use) into dist/; a
  // second copy here would be redundant, not incorrect, but there's no
  // reason to pay for it twice.
  publicDir: false,
  build: {
    // Same outDir as the agent build ('dist', Vite's default) — Vite
    // reproduces this entry's path relative to project root under outDir,
    // so `dashboard/index.html` lands at `dist/dashboard/index.html`
    // without any extra nesting. emptyOutDir: false is the one setting
    // that actually matters here: without it, Vite would wipe the ENTIRE
    // dist/ folder — including the agent bundle this build must run
    // after — before adding its own subfolder. The agent build (which
    // does default to emptying dist/) has to run first for this ordering
    // to be safe; see package.json's "build" script.
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, 'dashboard/index.html'),
    },
  },
});
