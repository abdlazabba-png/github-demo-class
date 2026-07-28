// Copies the self-hosted OCR assets (worker script, WASM cores, English
// language data) from node_modules into public/tesseract/ so Vite serves
// them at stable URLs the app and the PWA service worker can reach offline.
// Not committed to git (see .gitignore) — regenerated on every `npm
// install` via the "postinstall" script so it can't drift from whatever
// tesseract.js / tesseract.js-core / @tesseract.js-data/eng versions are
// actually installed.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'public', 'tesseract');
const outLangDir = join(outDir, 'lang-data');

const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm', 'tesseract-core-simd-lstm.wasm'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm', 'tesseract-core-lstm.wasm'],
];

const langFiles = [
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
];

mkdirSync(outDir, { recursive: true });
mkdirSync(outLangDir, { recursive: true });

let copied = 0;
for (const [src, destName] of files) {
  const srcPath = join(root, src);
  if (!existsSync(srcPath)) {
    console.warn(`[copy-ocr-assets] missing ${src} — did tesseract.js/tesseract.js-core install correctly?`);
    continue;
  }
  copyFileSync(srcPath, join(outDir, destName));
  copied += 1;
}
for (const [src, destName] of langFiles) {
  const srcPath = join(root, src);
  if (!existsSync(srcPath)) {
    console.warn(`[copy-ocr-assets] missing ${src} — did @tesseract.js-data/eng install correctly?`);
    continue;
  }
  copyFileSync(srcPath, join(outLangDir, destName));
  copied += 1;
}

console.log(`[copy-ocr-assets] copied ${copied}/${files.length + langFiles.length} OCR asset(s) into public/tesseract/`);
