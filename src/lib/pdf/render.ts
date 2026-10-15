/**
 * src/lib/pdf/render.ts
 *
 * Renders a PDF page, or a whole-pixel region of it, to PlanPixels at a given
 * number of pixels per point (pixel = (viewport point − the region's top-left)
 * × pxPerPt, the coordinates of src/types/pdf.ts). The canvas comes from the
 * caller: an OffscreenCanvas in the browser worker (src/workers/pdf.worker.ts),
 * @napi-rs/canvas in the Node tests. pdf.js paints a white background first.
 *
 * The pixel budget (step X.1): no raster the page reader makes may be over
 * MAX_EDGE pixels on a side or PIXEL_BUDGET pixels in all. A canvas that big
 * holds 4 bytes a pixel twice (the canvas and its getImageData copy), and a
 * worker that runs out of memory takes the whole tab with it, with no error.
 * The callers size their renders under it (analysePdf.ts); renderPage refuses
 * anything over it with a plain message as the last guard, before allocating.
 *
 * Connects to: analysePdf.ts, src/workers/pdf.worker.ts, src/workers/background.worker.ts
 * (the same budget), scripts/pdf-node.ts.
 */
import type { PDFPageProxy } from "pdfjs-dist";
import { BlueprintError, type PlanPixels } from "@/types/blueprint";

/** Longest side of any raster or canvas, px (the background's render cap since M.2c). */
export const MAX_EDGE = 4096;
/** Most pixels in any raster or canvas: 4096², about 16.8 megapixels (67 MB of RGBA). */
export const PIXEL_BUDGET = MAX_EDGE * MAX_EDGE;

export const overBudget = (width: number, height: number) => width > MAX_EDGE || height > MAX_EDGE || width * height > PIXEL_BUDGET;

export const tooBigToRender = (width: number, height: number) =>
  `Reading this page would need a ${width} × ${height} pixel picture, more than the ${(PIXEL_BUDGET / 1e6).toFixed(1)} megapixels (and ${MAX_EDGE} pixels a side) the browser can safely hold. Export just the floor plan, or a smaller sheet, and try again.`;

/** A region of the full page's raster at some pxPerPt, in whole pixels: left, top, width, height. */
export interface PixelRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Any 2D canvas with getImageData (OffscreenCanvas, @napi-rs/canvas). */
export type MakeCanvas = (width: number, height: number) => { canvas: unknown; context: { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } } };

/** The whole page's raster size at pxPerPt (as before step X.1: ceil, less a hair for float noise). */
export function fullRegion(page: { width: number; height: number }, pxPerPt: number): PixelRegion {
  return { left: 0, top: 0, width: Math.ceil(page.width * pxPerPt - 1e-6), height: Math.ceil(page.height * pxPerPt - 1e-6) };
}

export async function renderPage(page: PDFPageProxy, pxPerPt: number, make: MakeCanvas, region?: PixelRegion): Promise<PlanPixels> {
  // Whole pixels, so a region's pixels are exactly the full render's pixels there.
  const { left, top, width, height } = region ?? fullRegion(page.getViewport({ scale: 1 }), pxPerPt);
  if (overBudget(width, height)) throw new BlueprintError(tooBigToRender(width, height));
  const viewport = page.getViewport({ scale: pxPerPt, offsetX: -left, offsetY: -top });
  const { canvas, context } = make(width, height);
  await page.render({ canvas: canvas as HTMLCanvasElement, canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise;
  return { width, height, rgba: context.getImageData(0, 0, width, height).data };
}
