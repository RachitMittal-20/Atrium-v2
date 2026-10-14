/**
 * src/lib/blueprint/ocrAssets.ts
 *
 * Where tesseract.js finds its files. Everything is served from /tesseract/ in
 * public/ (browser) or read from public/tesseract/ (Node tests), so OCR never
 * touches a CDN. tesseract.js's own defaults point at jsdelivr, which is
 * why these options are always passed (O.1).
 * Connects to: ocr.ts (createWorker options, load-failure diagnosis),
 * public/tesseract/ (the files), scripts/test-ocr-assets.ts (guard).
 */

/** Public URL folder of the OCR files. Guard test: no other tesseract path is allowed. */
export const OCR_DIR = "/tesseract";

/** Every file the config can ask for, relative to OCR_DIR. The browser picks the core by SIMD support. */
export const OCR_FILES = {
  worker: "worker.min.js",
  coreSimd: "tesseract-core-simd-lstm.wasm.js",
  core: "tesseract-core-lstm.wasm.js",
  lang: "eng.traineddata.gz",
} as const;

/** The OCR files could not be loaded (missing or blocked); `file` says which. */
export class OcrLoadError extends Error {
  constructor(public file: string) {
    super(`The OCR files could not be loaded (${file}).`);
  }
}

/** Options for createWorker. In a worker or page the URLs are absolute (the blob wrapper that
 *  starts tesseract's worker can't resolve a relative one); under Node they are plain paths. */
export function ocrOptions(): { workerPath?: string; corePath: string; langPath: string; cacheMethod: string } {
  // Node has no `location`; there tesseract uses its own worker and bundled core, only the language data is local.
  if (typeof location === "undefined") {
    const dir = `${process.cwd()}/public${OCR_DIR}`;
    return { corePath: dir, langPath: dir, cacheMethod: "none" };
  }
  const base = `${location.origin}${OCR_DIR}`;
  return { workerPath: base + "/" + OCR_FILES.worker, corePath: base, langPath: base, cacheMethod: "none" };
}

let allThere = false;

/** Names the first OCR file the server doesn't answer for, or null when all are there. Run BEFORE tesseract
 *  starts: a file that fails inside its nested worker is an uncaught error event, which bubbles up to the page
 *  as "couldn't start the reader", so the page checks first and says which file. Browser only (Node reads
 *  from disk); a clean result is remembered for the session. */
export async function missingOcrFile(): Promise<string | null> {
  if (allThere || typeof location === "undefined" || typeof fetch === "undefined") return null;
  for (const file of Object.values(OCR_FILES)) {
    try {
      const res = await fetch(`${OCR_DIR}/${file}`, { method: "HEAD" });
      if (!res.ok) return file;
    } catch {
      return file; // network failure or blocked
    }
  }
  allThere = true;
  return null;
}
