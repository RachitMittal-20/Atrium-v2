/**
 * pdf-node.ts — pdf.js for the Node scripts (test-pdf.ts, make-pdf-fixtures.ts,
 * e2e-pdf-import.ts): the legacy (Node-compatible) build, its core handed over
 * as `globalThis.pdfjsWorker` so it parses in this thread (as the browser
 * worker does), the image decoders' WebAssembly read from node_modules, and
 * @napi-rs/canvas (pdf.js's optional dependency) for rendering.
 */
import { createCanvas } from "@napi-rs/canvas";
import path from "node:path";
import * as pdfjsLegacy from "pdfjs-dist/legacy/build/pdf.mjs";
import * as core from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { openPdf, type PdfJs } from "../src/lib/pdf/open";
import { renderPage, type MakeCanvas } from "../src/lib/pdf/render";
import type { PDFPageProxy } from "pdfjs-dist";

(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = core;

export const pdfjs = pdfjsLegacy as unknown as PdfJs;
export const WASM_URL = path.join(__dirname, "../node_modules/pdfjs-dist/wasm/");
export const nodeCanvas: MakeCanvas = (w, h) => {
  const canvas = createCanvas(w, h);
  return { canvas, context: canvas.getContext("2d") as unknown as ReturnType<MakeCanvas>["context"] };
};
export const openNode = (bytes: Uint8Array) => openPdf(pdfjs, bytes, { wasmUrl: WASM_URL });
export const renderNode = (page: PDFPageProxy, pxPerPt: number) => renderPage(page, pxPerPt, nodeCanvas);
