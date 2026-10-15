/**
 * src/workers/background.worker.ts
 *
 * Renders the imported PDF page that sits under the 2D plan (step M.2c), off the main thread.
 * pdf.js runs here exactly as in src/workers/pdf.worker.ts: its core is put on
 * `globalThis.pdfjsWorker`, so it parses in this thread and never fetches a worker script, and
 * the file is opened with the same safety options (src/lib/pdf/open.ts). Only the image
 * decoders' WebAssembly is fetched, from our own /pdfjs/wasm/. Nothing else, and the file never
 * leaves the browser.
 *
 * Protocol (one worker per drawing; the page terminates it when the drawing goes):
 *   in   { type: "open", bytes, page }   the PDF's bytes (transferred) and the page to show
 *   out  { type: "opened", width, height }  that page's size in points (viewport, /Rotate applied)
 *   in   { type: "render", id, x, y, width, height, k }
 *        the page region from (x, y) points, `width` × `height` device pixels, at k device px per point
 *   out  { type: "rendered", id, bitmap }  an ImageBitmap (transferred) of exactly that region
 *        { type: "error", message }
 * A new render cancels the one in flight (pdf.js RenderTask.cancel); a cancelled render posts
 * nothing, and the page ignores any reply whose id is not its latest request.
 *
 * Step P.1, the drawing's snap index (src/store/drawingSnapStore.ts starts its own instance of this
 * worker for it, and terminates it after the reply):
 *   in   { type: "index", bytes, page }  the PDF's bytes (transferred) and the page
 *   out  { type: "index", index, ms }    src/lib/pdf/snapIndex.ts's index (buffers transferred),
 *        built from the page's VectorPage (extract.ts) here, never on the main thread; index is
 *        null when the page is a scanned picture. ms: how long reading and building took.
 */
import * as pdfjs from "pdfjs-dist";
import * as core from "pdfjs-dist/build/pdf.worker.mjs";
import type { PDFPageProxy, RenderTask } from "pdfjs-dist";
import { extractVectorPage } from "@/lib/pdf/extract";
import { openPdf } from "@/lib/pdf/open";
import { indexForPage, transferables, type SnapIndex } from "@/lib/pdf/snapIndex";

(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = core;

export type BackgroundRequest =
  | { type: "open"; bytes: ArrayBuffer; page: number }
  | { type: "render"; id: number; x: number; y: number; width: number; height: number; k: number }
  | { type: "index"; bytes: ArrayBuffer; page: number };
export type BackgroundReply =
  | { type: "opened"; width: number; height: number }
  | { type: "rendered"; id: number; bitmap: ImageBitmap }
  | { type: "index"; index: SnapIndex | null; ms: number }
  | { type: "error"; message: string };

/** pdf.js's scratch canvases, as OffscreenCanvas: there is no document here (as in pdf.worker.ts). */
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

const post = (msg: BackgroundReply, transfer: Transferable[] = []) => self.postMessage(msg, { transfer });
let page: PDFPageProxy | null = null;
let running: RenderTask | null = null;

self.onmessage = async (e: MessageEvent<BackgroundRequest>) => {
  const msg = e.data;
  if (!msg || typeof msg !== "object" || "sourceName" in msg) return; // pdf.js's own handshake, not ours
  try {
    if (msg.type === "open") {
      const doc = await openPdf(pdfjs, new Uint8Array(msg.bytes), { wasmUrl: new URL("/pdfjs/wasm/", self.location.href).href, CanvasFactory: OffscreenCanvasFactory });
      page = await doc.getPage(Math.min(Math.max(1, msg.page), doc.numPages));
      const { width, height } = page.getViewport({ scale: 1 });
      post({ type: "opened", width, height });
    } else if (msg.type === "index") {
      const t0 = performance.now();
      const doc = await openPdf(pdfjs, new Uint8Array(msg.bytes), { wasmUrl: new URL("/pdfjs/wasm/", self.location.href).href, CanvasFactory: OffscreenCanvasFactory });
      const vector = await extractVectorPage(pdfjs, await doc.getPage(Math.min(Math.max(1, msg.page), doc.numPages)));
      const index = indexForPage(vector);
      post({ type: "index", index, ms: performance.now() - t0 }, index ? transferables(index) : []);
    } else if (msg.type === "render") {
      if (!page) return;
      running?.cancel(); // stale: the camera moved on
      // The viewport at k px per point, shifted so the region's top-left is the canvas's (0, 0).
      const viewport = page.getViewport({ scale: msg.k, offsetX: -msg.x * msg.k, offsetY: -msg.y * msg.k });
      const canvas = new OffscreenCanvas(msg.width, msg.height);
      const context = canvas.getContext("2d")!;
      const task = page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context as unknown as CanvasRenderingContext2D, viewport });
      running = task;
      try {
        await task.promise;
      } catch (err) {
        if ((err as { name?: string })?.name === "RenderingCancelledException") return; // replaced by a newer render
        throw err;
      } finally {
        if (running === task) running = null;
      }
      const bitmap = canvas.transferToImageBitmap();
      post({ type: "rendered", id: msg.id, bitmap }, [bitmap]);
    }
  } catch (err) {
    console.warn("[background.worker]", err); // details to the console only
    post({ type: "error", message: "The drawing couldn't be shown." });
  }
};
