/**
 * src/lib/pdf/analysePdf.ts
 *
 * One PDF page to everything the import screen needs: the image pipeline's
 * Analysis (walls, openings, the image shown under the overlay) plus PdfInfo
 * (kind, route, scale, dimension texts, notes).
 *
 * Routes:
 *   - "scanned" page: rendered at 300 dpi (at most 40 megapixels) and sent
 *     through analyseBlueprint UNCHANGED, OCR included. Note: "Scanned PDF:
 *     measurements are approximate."
 *   - "vector" and "mixed" pages: the scale comes from the PDF (scale.ts). The
 *     page is rendered at TARGET_PX_PER_M pixels per metre of the found scale
 *     (the pipeline's fixtures are drawn at 100 px/m), capped so the longer
 *     side stays under RASTER_MAX_SIDE (so analyseBlueprint never downscales);
 *     with no scale, at that cap. analyseBlueprint then runs on that raster
 *     with `straighten: false` (the page's own axes are kept) and, in place of
 *     OCR, the PDF's own text: every text line that is not a dimension, a bare
 *     number or the title-block scale becomes a room-name label at its centre
 *     × pixels per point, which nameRooms places by position as usual. The
 *     Analysis' scale is then replaced by the PDF's (ScaleEstimate in pixels
 *     per metre: pxPerM = pixels per point / metres per point) and the OCR
 *     scale warnings are dropped (the screen shows the PDF's reason instead).
 *     Walls are traced from the raster, so they are good to about one pixel
 *     (traceMm); piece M.1b snaps them to the PDF's own segments.
 *
 * The render is passed in (render.ts `renderPage` with an OffscreenCanvas in
 * the worker, @napi-rs/canvas in the tests). Connects to: extract.ts,
 * scale.ts, blueprint/analyse.ts, src/workers/pdf.worker.ts; tested by
 * scripts/test-pdf.ts.
 */
import type { PDFPageProxy } from "pdfjs-dist";
import { analyseBlueprint, type Analysis, type OcrResult } from "@/lib/blueprint/analyse";
import type { PlanLabel } from "@/lib/blueprint/roomLabels";
import type { ScaleEstimate } from "@/lib/blueprint/scale";
import { BlueprintError, type PixelWall, type PlanPixels } from "@/types/blueprint";
import type { PdfInfo, PdfScale, VectorPage } from "@/types/pdf";
import { extractVectorPage } from "./extract";
import { PDF_MESSAGES, type PdfJs } from "./open";
import { parseDimension, parseTitleScale, pdfScale, textLines } from "./scale";

export const TARGET_PX_PER_M = 100;
export const RASTER_MAX_SIDE = 2400; // analyse.ts's default maxSide
export const SCAN_DPI = 300;
export const MAX_RASTER_PX = 40_000_000;
const FOOT = 0.3048;

export type RenderPage = (page: PDFPageProxy, pxPerPt: number) => Promise<PlanPixels>;

/** Raster pixels per point for a vector page: the found scale at TARGET_PX_PER_M, under the side cap. */
export function vectorRasterScale(page: Pick<VectorPage, "width" | "height">, mPerPt: number | null): number {
  const fit = (RASTER_MAX_SIDE - 1) / Math.max(page.width, page.height);
  return Math.min(mPerPt ? TARGET_PX_PER_M * mPerPt : fit, fit);
}

/** Raster pixels per point for a scanned page: 300 dpi, at most MAX_RASTER_PX pixels. */
export const scanRasterScale = (page: Pick<VectorPage, "width" | "height">) => Math.min(SCAN_DPI / 72, Math.sqrt(MAX_RASTER_PX / (page.width * page.height)));

/** Room-name labels from the page's text, in raster pixels (header). */
export function pdfLabels(page: VectorPage, pxPerPt: number): PlanLabel[] {
  return textLines(page.texts)
    .filter((l) => !parseTitleScale(l.text) && parseDimension(l.text) === null && !/^\d+(?:\.\d+)?$/.test(l.text))
    .map((l) => ({ text: l.text, x: l.centre.x * pxPerPt, y: l.centre.y * pxPerPt, confidence: 100 }));
}

/** The PDF's scale as the image pipeline's ScaleEstimate, in pixels per metre of the raster. */
export function toScaleEstimate(s: PdfScale, pxPerPt: number, walls: PixelWall[]): ScaleEstimate {
  const px = (mPerPt: number) => pxPerPt / mPerPt;
  let unitless: ScaleEstimate["unitless"] = null;
  if (s.unitless && walls.length) {
    const pxPerUnit = pxPerPt / s.unitless.unitsPerPt;
    const xs = walls.flatMap((w) => [w.a.x, w.b.x]);
    const ys = walls.flatMap((w) => [w.a.y, w.b.y]);
    const implied = (pxPerM: number) => ({ pxPerM, width: (Math.max(...xs) - Math.min(...xs)) / pxPerM, depth: (Math.max(...ys) - Math.min(...ys)) / pxPerM });
    unitless = {
      pxPerUnit,
      n: s.unitless.n,
      spreadPct: s.unitless.spreadPct,
      confidence: s.unitless.confidence,
      ifFeet: implied(pxPerUnit / FOOT),
      ifMetres: implied(pxPerUnit),
      ifMillimetres: implied(pxPerUnit * 1000),
    };
  }
  return {
    pxPerM: s.mPerPt ? px(s.mPerPt) : null,
    confidence: s.confidence,
    samples: s.matches
      .filter((m) => m.counted)
      .map((m) => ({ source: "dimension" as const, text: m.text, pxPerM: px(m.metres / m.lengthPt), box: { x0: m.box.x0 * pxPerPt, y0: m.box.y0 * pxPerPt, x1: m.box.x1 * pxPerPt, y1: m.box.y1 * pxPerPt } })),
    spreadPct: s.dimensions.spreadPct,
    reason: s.reason,
    rejected: s.rejected,
    unparsed: [],
    unitless,
    rooms: [],
    dimensions: [],
  };
}

export async function analysePdfPage(
  pdfjs: PdfJs,
  page: PDFPageProxy,
  opts: { pageCount: number; render: RenderPage; onProgress?: (stage: string, fraction: number) => void; ocr?: (p: PlanPixels) => Promise<OcrResult>; maxPathOps?: number },
): Promise<{ analysis: Analysis; pdf: PdfInfo; vector: VectorPage }> {
  const vector = await extractVectorPage(pdfjs, page, { maxPathOps: opts.maxPathOps });
  if (!vector.segments.length && !vector.texts.length && !vector.images.length) throw new BlueprintError(PDF_MESSAGES.blank);
  const base = { pageNumber: page.pageNumber, pageCount: opts.pageCount, kind: vector.kind, paper: vector.paper };

  if (vector.kind === "scanned") {
    const pxPerPt = scanRasterScale(vector);
    const analysis = await analyseBlueprint(await opts.render(page, pxPerPt), { onProgress: opts.onProgress, ocr: opts.ocr });
    return { analysis, vector, pdf: { ...base, route: "raster", pxPerPt, scale: null, traceMm: null, notes: ["Scanned PDF: measurements are approximate."] } };
  }

  const scale = pdfScale(vector);
  const pxPerPt = vectorRasterScale(vector, scale.mPerPt);
  const labels = pdfLabels(vector, pxPerPt);
  const fromPdf = async (): Promise<OcrResult> => ({ labels, words: [], error: null, rereads: [] });
  const analysis = await analyseBlueprint(await opts.render(page, pxPerPt), { onProgress: opts.onProgress, ocr: fromPdf, straighten: false, maxSide: RASTER_MAX_SIDE });
  analysis.scale = toScaleEstimate(scale, pxPerPt, analysis.walls);
  analysis.warnings = analysis.warnings.filter((w) => w.code !== "no-scale" && w.code !== "check-scale");

  const traceMm = scale.mPerPt ? (scale.mPerPt / pxPerPt) * 1000 : null; // one raster pixel
  const notes = [
    "Read from PDF vectors.",
    ...(vector.kind === "mixed" ? ["This page mixes a picture with line work. It was read as vector line work; the picture was ignored."] : []),
    traceMm
      ? `Wall positions are traced at about ${Math.round(traceMm)} mm; exact snapping arrives in the next step.`
      : "Wall positions are traced from a picture of the page; exact snapping arrives in the next step.",
  ];
  return { analysis, vector, pdf: { ...base, route: "vector", pxPerPt, scale, traceMm, notes } };
}
