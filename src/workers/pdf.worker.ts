/**
 * src/workers/pdf.worker.ts
 *
 * All PDF work, off the main thread (step M.1a): opening the file, page
 * thumbnails, reading a page's vectors and text, rendering it, and the image
 * pipeline's analysis of that render (src/lib/pdf/analysePdf.ts).
 *
 * How pdf.js runs here: this file imports pdf.js's display API (pdfjs-dist)
 * AND its core (pdfjs-dist/build/pdf.worker.mjs), and puts the core on
 * `globalThis.pdfjsWorker` before anything is opened. pdf.js then uses that
 * core in this same thread (its "fake worker") instead of starting a worker of
 * its own, so GlobalWorkerOptions.workerSrc is never set and no worker script
 * is fetched. The bundler (Turbopack / webpack, through
 * `new Worker(new URL("…/pdf.worker.ts", import.meta.url))` in
 * src/app/studio/import/importFile.ts) puts both into this worker's chunk.
 * One side effect of importing the core in a worker: it also wires itself to
 * this worker's own port and posts pdf.js's "ready" handshake ({ sourceName:
 * "worker", action: "ready" }) to the page. It is harmless (that handler
 * ignores our messages, which have no sourceName), and runPdf ignores every
 * message that is not one of ours.
 * Rendering uses OffscreenCanvas (OffscreenCanvasFactory below). The image
 * decoders' WebAssembly (JBIG2 / CCITT, JPEG 2000, ICC) loads from our own
 * /pdfjs/wasm/ (copied from pdfjs-dist/wasm); nothing else is fetched. The
 * other safety options are in src/lib/pdf/open.ts.
 *
 * Protocol (one worker per file; the page terminates it to cancel):
 *   in   { type: "open", bytes }        the file's ArrayBuffer, transferred
 *   out  { type: "pages", count, listed } page sizes in points, at most 30
 *        { type: "thumb", number, blob }  one PNG per listed page (multi-page files only)
 *   in   { type: "page", number }        read that page
 *   out  { type: "progress", stage, fraction }  stage null = reading the PDF page
 *        { type: "done", analysis, pdf }  analysis.pixels' buffer transferred
 *        { type: "error", message, user }  user = a BlueprintError (plain words)
 */
import * as pdfjs from "pdfjs-dist";
import * as core from "pdfjs-dist/build/pdf.worker.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Analysis, Stage } from "@/lib/blueprint/analyse";
import { analysePdfPage } from "@/lib/pdf/analysePdf";
import { MAX_PAGES_LISTED, openPdf } from "@/lib/pdf/open";
import { renderPage, type MakeCanvas } from "@/lib/pdf/render";
import { BlueprintError } from "@/types/blueprint";
import type { PdfInfo } from "@/types/pdf";

(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = core;

export type PdfRequest = { type: "open"; bytes: ArrayBuffer } | { type: "page"; number: number };
export type PdfReply =
  | { type: "pages"; count: number; listed: { number: number; width: number; height: number }[] }
  | { type: "thumb"; number: number; blob: Blob }
  | { type: "progress"; stage: Stage | null; fraction: number }
  | { type: "done"; analysis: Analysis; pdf: PdfInfo }
  | { type: "error"; message: string; user: boolean };

const THUMB_PX = 220; // longer side of a thumbnail

/** pdf.js's scratch canvases (patterns, masks), as OffscreenCanvas: there is no document here. */
class OffscreenCanvasFactory {
  create(width: number, height: number) {
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext("2d", { willReadFrequently: true }) };
  }
  reset(entry: { canvas: OffscreenCanvas }, width: number, height: number) {
    entry.canvas.width = width;
    entry.canvas.height = height;
  }
  destroy(entry: { canvas: OffscreenCanvas | null; context: unknown }) {
    if (entry.canvas) entry.canvas.width = entry.canvas.height = 0;
    entry.canvas = null;
    entry.context = null;
  }
}

const offscreen: MakeCanvas = (w, h) => {
  const canvas = new OffscreenCanvas(w, h);
  return { canvas, context: canvas.getContext("2d", { willReadFrequently: true })! };
};

const post = (msg: PdfReply, transfer: Transferable[] = []) => self.postMessage(msg, { transfer });
let doc: PDFDocumentProxy | null = null;
let thumbsWanted = true;

function fail(err: unknown) {
  const user = err instanceof BlueprintError;
  // The details go to the console, never to the page: a warning for a file the user can fix, an error for a bug.
  (user ? console.warn : console.error)("[pdf.worker]", err);
  post({ type: "error", message: user ? err.message : "", user });
}

async function thumbnails(listed: { number: number; width: number; height: number }[]) {
  for (const p of listed) {
    if (!thumbsWanted || !doc) return; // a page was chosen: stop drawing thumbnails
    try {
      const page = await doc.getPage(p.number);
      const viewport = page.getViewport({ scale: THUMB_PX / Math.max(p.width, p.height) });
      const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: canvas.getContext("2d") as unknown as CanvasRenderingContext2D, viewport }).promise;
      post({ type: "thumb", number: p.number, blob: await canvas.convertToBlob({ type: "image/png" }) });
    } catch (e) {
      console.warn("[pdf.worker] thumbnail", p.number, e); // a missing thumbnail still leaves the page choosable
    }
  }
}

self.onmessage = async (e: MessageEvent<PdfRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === "open") {
      doc = await openPdf(pdfjs, new Uint8Array(msg.bytes), { wasmUrl: new URL("/pdfjs/wasm/", self.location.href).href, CanvasFactory: OffscreenCanvasFactory });
      const listed = [];
      for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES_LISTED); n++) {
        const { width, height } = (await doc.getPage(n)).getViewport({ scale: 1 });
        listed.push({ number: n, width, height });
      }
      post({ type: "pages", count: doc.numPages, listed });
      if (doc.numPages > 1) void thumbnails(listed);
    } else if (msg.type === "page") {
      thumbsWanted = false;
      if (!doc) throw new Error("page requested before open");
      post({ type: "progress", stage: null, fraction: 0 });
      const { analysis, pdf } = await analysePdfPage(pdfjs, await doc.getPage(msg.number), {
        pageCount: doc.numPages,
        render: (page, k, region) => renderPage(page, k, offscreen, region),
        onProgress: (stage, fraction) => post({ type: "progress", stage: stage as Stage, fraction }),
      });
      post({ type: "done", analysis, pdf }, [analysis.pixels.rgba.buffer as ArrayBuffer]);
    }
  } catch (err) {
    fail(err);
  }
};
