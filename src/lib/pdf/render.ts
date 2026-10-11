/**
 * src/lib/pdf/render.ts
 *
 * Renders a PDF page to PlanPixels at a given number of pixels per point
 * (pixel = viewport point × pxPerPt, the coordinates of src/types/pdf.ts).
 * The canvas comes from the caller: an OffscreenCanvas in the browser worker
 * (src/workers/pdf.worker.ts), @napi-rs/canvas in the Node tests. pdf.js
 * paints a white background first.
 */
import type { PDFPageProxy } from "pdfjs-dist";
import type { PlanPixels } from "@/types/blueprint";

/** Any 2D canvas with getImageData (OffscreenCanvas, @napi-rs/canvas). */
export type MakeCanvas = (width: number, height: number) => { canvas: unknown; context: { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } } };

export async function renderPage(page: PDFPageProxy, pxPerPt: number, make: MakeCanvas): Promise<PlanPixels> {
  const viewport = page.getViewport({ scale: pxPerPt });
  const width = Math.ceil(viewport.width - 1e-6);
  const height = Math.ceil(viewport.height - 1e-6);
  const { canvas, context } = make(width, height);
  await page.render({ canvas: canvas as HTMLCanvasElement, canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise;
  return { width, height, rgba: context.getImageData(0, 0, width, height).data };
}
