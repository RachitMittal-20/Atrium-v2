/**
 * src/lib/pdf/open.ts
 *
 * Opens a PDF with pdf.js, configured safely, and turns every way that can
 * fail into a plain message (BlueprintError), never a stack trace.
 *
 * pdf.js is passed in (`PdfJs`), not imported here: the browser worker
 * (src/workers/pdf.worker.ts) passes the modern build and the Node tests the
 * legacy one. Neither starts a second worker: both set `globalThis.pdfjsWorker`
 * to pdf.js's own core first, so pdf.js parses in the calling thread (inside
 * our worker in the browser) and never loads a workerSrc URL.
 *
 * Safety (SAFE_OPTIONS): no eval (isEvalSupported false), no font faces (fonts
 * are never installed as FontFace; glyphs are drawn as paths, or by the
 * canvas's own font when the PDF does not embed them), no system fonts, no
 * XFA forms, no scripting (pdf.js only runs scripts through its separate
 * sandbox, which is never loaded), and no URLs for CMaps or standard fonts, so
 * nothing is fetched for them. The only fetch pdf.js may make is its image
 * decoders' WebAssembly (JBIG2, CCITT, JPEG 2000, ICC), from `wasmUrl`: our own
 * /pdfjs/wasm/ in the browser, node_modules in the tests.
 *
 * Limits: 50 MB, and at most 30 pages listed by the page picker.
 * Connects to: src/lib/pdf/extract.ts, analysePdf.ts, the worker, scripts/test-pdf.ts.
 */
import type { PDFDocumentProxy } from "pdfjs-dist";
import { BlueprintError } from "@/types/blueprint";

export type PdfJs = typeof import("pdfjs-dist");

export const MAX_PDF_BYTES = 50 * 1024 * 1024;
export const MAX_PAGES_LISTED = 30;

export const PDF_MESSAGES = {
  empty: "This PDF is empty, so there is no plan to read.",
  noPages: "This PDF has no pages, so there is no plan to read.",
  blank: "This page is blank: it has no lines, text or pictures. Choose another page, or another PDF.",
  password: "This PDF is password-protected. Open it, save or print it as a new PDF without a password, and try again.",
  damaged: "This PDF is damaged and can't be read. Save it again from the program that made it, then try again.",
  tooBig: (bytes: number) => `That PDF is ${(bytes / 1024 / 1024).toFixed(0)} MB. The limit is 50 MB, so export just the plan page and try again.`,
};

const SAFE_OPTIONS = {
  isEvalSupported: false,
  disableFontFace: true,
  useSystemFonts: false,
  enableXfa: false,
  verbosity: 0, // errors only; warnings about missing fonts are expected
};

export async function openPdf(pdfjs: PdfJs, bytes: Uint8Array, opts: { wasmUrl?: string; CanvasFactory?: unknown } = {}): Promise<PDFDocumentProxy> {
  if (bytes.length === 0) throw new BlueprintError(PDF_MESSAGES.empty);
  if (bytes.length > MAX_PDF_BYTES) throw new BlueprintError(PDF_MESSAGES.tooBig(bytes.length));
  let doc: PDFDocumentProxy;
  try {
    doc = await pdfjs.getDocument({
      data: bytes.slice(), // pdf.js transfers (detaches) the buffer it is given
      ...SAFE_OPTIONS,
      ...(opts.wasmUrl ? { wasmUrl: opts.wasmUrl } : { useWasm: false }),
      ...(opts.CanvasFactory ? { CanvasFactory: opts.CanvasFactory as never } : {}),
    }).promise;
  } catch (e) {
    const name = (e as { name?: string })?.name;
    const message = String((e as { message?: string })?.message ?? "");
    console.warn("[pdf] open failed", e); // the details go to the console only
    if (name === "PasswordException") throw new BlueprintError(PDF_MESSAGES.password);
    if (/empty/i.test(message)) throw new BlueprintError(PDF_MESSAGES.empty);
    throw new BlueprintError(PDF_MESSAGES.damaged);
  }
  // pdf.js shows a PDF whose /Pages is empty as one blank page; analysePdf.ts
  // refuses a blank page with PDF_MESSAGES.blank.
  if (doc.numPages === 0) {
    await doc.loadingTask.destroy();
    throw new BlueprintError(PDF_MESSAGES.noPages);
  }
  return doc;
}
