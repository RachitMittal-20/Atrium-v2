# OCR files served from /tesseract/

Atrium reads text on floor plans in the browser. These files are copied unchanged so no request ever leaves the site (guarded by `scripts/test-ocr-assets.ts`).

| File | What it is | Source and version | Licence |
| --- | --- | --- | --- |
| `worker.min.js` | tesseract.js worker script | `tesseract.js@5.1.1`, `dist/worker.min.js` | Apache-2.0 (bundles MIT and BSD-3-Clause parts: buffer, ieee754, regenerator-runtime, zlib.js) |
| `tesseract-core-simd-lstm.wasm.js` | OCR engine (WebAssembly inside), SIMD browsers | `tesseract.js-core@5.1.1` | Apache-2.0 (Tesseract, Leptonica and Emscripten parts under their own permissive licences) |
| `tesseract-core-lstm.wasm.js` | The same engine for browsers without WebAssembly SIMD | `tesseract.js-core@5.1.1` | Apache-2.0 |
| `eng.traineddata.gz` | English language data (LSTM, `best_int`) | `@tesseract.js-data/eng@1.0.0`, `4.0.0_best_int/eng.traineddata.gz` | Apache-2.0 (from tesseract-ocr/tessdata_best) |

Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0 (full text in `node_modules/tesseract.js-core/LICENSE`).

To update: copy the same files from the new package versions and keep this table in step.
