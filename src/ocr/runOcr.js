import { createWorker } from 'tesseract.js';

// All assets are self-hosted under public/tesseract/ (worker script, WASM
// core, and eng.traineddata.gz) specifically so this never reaches out to
// a CDN — OCR has to run during offline capture, same as everything else
// in the capture flow. See CLAUDE.md: "on-device OCR ... always shown to
// the agent for manual confirmation before submission."
// Must be a fully-qualified absolute URL, not root-relative. Tesseract's
// worker is instantiated from a blob: URL internally, and importScripts()
// inside a blob-sourced worker rejects root-relative paths ("/tesseract/…")
// even though they resolve fine everywhere else on the page — this was
// verified failing in-browser with "Failed to execute 'importScripts' ...
// URL '/tesseract/worker.min.js' is invalid" before switching to this.
const ASSET_BASE = new URL(`${import.meta.env.BASE_URL}tesseract`, window.location.origin).toString();
const LSTM_ONLY = 1; // matches the *-lstm core variants bundled below (no legacy engine)
const CORE_PATHS = [
  `${ASSET_BASE}/tesseract-core-simd-lstm.wasm.js`, // fast path, needs WASM SIMD
  `${ASSET_BASE}/tesseract-core-lstm.wasm.js`, // fallback for browsers without SIMD
];

let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      let lastError;
      for (const corePath of CORE_PATHS) {
        try {
          return await createWorker('eng', LSTM_ONLY, {
            workerPath: `${ASSET_BASE}/worker.min.js`,
            corePath,
            langPath: `${ASSET_BASE}/lang-data`,
            gzip: true,
            logger: () => {},
          });
        } catch (err) {
          lastError = err;
        }
      }
      workerPromise = null; // let a later call retry instead of caching a permanent failure
      throw lastError;
    })();
  }
  return workerPromise;
}

// Tesseract gives us raw text/words, not "which number belongs to which
// party" — that needs template-aware layout parsing this PoC doesn't
// attempt. So this returns the raw numeric tokens it found (for the agent
// to eyeball against the sheet) plus a *positional* guess at party votes,
// which is only offered when the count of detected numbers exactly matches
// the party count. Either way this is advisory: CLAUDE.md requires the
// agent to confirm every figure manually, and the caller must never treat
// this as ground truth.
export async function runOcr(imageSource, parties) {
  const worker = await getWorker();
  const { data } = await worker.recognize(imageSource);

  const numbers = (data.words || [])
    .filter((w) => /^\d{1,4}$/.test(w.text.trim()))
    .sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0)
    .map((w) => ({ value: Number(w.text.trim()), confidence: w.confidence }));

  let suggestedVotes = null;
  if (parties && numbers.length === parties.length) {
    suggestedVotes = Object.fromEntries(parties.map((party, i) => [party, numbers[i].value]));
  }

  return {
    rawText: data.text,
    confidence: data.confidence,
    numbers,
    suggestedVotes,
  };
}
