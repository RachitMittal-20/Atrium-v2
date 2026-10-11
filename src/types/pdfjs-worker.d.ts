/**
 * src/types/pdfjs-worker.d.ts — pdf.js ships no types for its core ("worker")
 * bundles. src/workers/pdf.worker.ts and scripts/pdf-node.ts import them only
 * to hand WorkerMessageHandler to pdf.js as `globalThis.pdfjsWorker`, so pdf.js
 * parses in the same thread instead of starting a worker of its own.
 */
declare module "pdfjs-dist/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
