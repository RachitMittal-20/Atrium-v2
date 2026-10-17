/**
 * src/lib/pdf/analysePdf.ts
 *
 * One PDF page to everything the import screen needs: the image pipeline's
 * Analysis (walls, openings, the image shown under the overlay) plus PdfInfo
 * (kind, route, scale, dimension texts, notes).
 *
 * Routes:
 *   - "scanned" page: rendered at 300 dpi (within render.ts's pixel budget) and
 *     sent through analyseBlueprint UNCHANGED, OCR included. Note: "Scanned PDF:
 *     measurements are approximate."
 *   - "vector" and "mixed" pages: the scale comes from the PDF (scale.ts). A
 *     small drawing on a big sheet (its CONTENT BOX, `contentBox`: the extent of
 *     its strokes and text grown by CONTENT_MARGIN_PT, under CROP_BELOW of the
 *     sheet's longer side) has only that box rendered, in whole pixels (step
 *     X.1), so a small plan on a big, mostly empty sheet costs a small raster
 *     and keeps its resolution; any other page renders whole, as before. The
 *     resolution is chosen for what is rendered: TARGET_PX_PER_M pixels per metre of the
 *     found scale (the pipeline's fixtures are drawn at 100 px/m), capped so the
 *     longer side stays under RASTER_MAX_SIDE (so analyseBlueprint never
 *     downscales); with no scale, at that cap. A raster pixel is then
 *     (point − rasterOrigin) × pxPerPt EXACTLY: the box's top-left is a whole
 *     pixel of the full page's raster, so the crop's pixels are the full
 *     render's pixels there, and every point ↔ pixel conversion (the labels and
 *     scale boxes here, snap.ts, the review overlay, the background mapping)
 *     goes through rasterOrigin. analyseBlueprint then runs on that raster
 *     with `straighten: false` (the page's own axes are kept) and, in place of
 *     OCR, the PDF's own text: every text line that is not a dimension, a bare
 *     number, the title-block scale or a level note (step Q.2b: "FFL +0.150",
 *     "LEVEL 1", "+0.000", also stripped from the end of a name's own line)
 *     becomes a room-name label at its centre
 *     × pixels per point, which nameRooms places by position as usual. The
 *     Analysis' scale is then replaced by the PDF's (ScaleEstimate in pixels
 *     per metre: pxPerM = pixels per point / metres per point) and the OCR
 *     scale warnings are dropped (the screen shows the PDF's reason instead).
 *     Walls are traced from the raster, so they are good to about one pixel
 *     (traceMm). Step M.1b: with a scale, the walls are ALSO read exactly from
 *     the PDF's own lines (walls.ts, `vectorWalls`, page metres at the PDF's
 *     scale); the import screen merges the two (snap.ts).
 *   - outlined text (step M.1b): a vector page with meaningful line work but
 *     fewer than 3 text items has its text drawn as shapes. It is rendered at
 *     300 dpi (scanRasterScale) and read by the existing OCR (ocrPlan, or the
 *     injected `ocr`); the words become page text (ocrTexts) and go through the
 *     same scale rules, labelled "ocr", and give the room names.
 *
 * The render is passed in (render.ts `renderPage` with an OffscreenCanvas in
 * the worker, @napi-rs/canvas in the tests). Connects to: extract.ts,
 * scale.ts, blueprint/analyse.ts, src/workers/pdf.worker.ts; tested by
 * scripts/test-pdf.ts.
 */
import type { PDFPageProxy } from "pdfjs-dist";
import { analyseBlueprint, type Analysis, type OcrResult } from "@/lib/blueprint/analyse";
import { ocrPlan } from "@/lib/blueprint/ocr";
import type { PlanLabel } from "@/lib/blueprint/roomLabels";
import type { ScaleEstimate } from "@/lib/blueprint/scale";
import { BlueprintError, type OcrWord, type PixelWall, type PlanPixels } from "@/types/blueprint";
import type { PdfInfo, PdfScale, PdfText, VectorPage } from "@/types/pdf";
import { extractVectorPage, meaningfulLines } from "./extract";
import { PDF_MESSAGES, type PdfJs } from "./open";
import { fullRegion, MAX_EDGE, PIXEL_BUDGET, type PixelRegion } from "./render";
import { parseDimension, parseTitleScale, pdfScale, textLines } from "./scale";
import { readVectorWalls } from "./walls";

export const TARGET_PX_PER_M = 100;
export const RASTER_MAX_SIDE = 2400; // analyse.ts's default maxSide
export const SCAN_DPI = 300;
/** Room left around the drawing's strokes and text when only its content box is rendered: 10 mm on paper. */
export const CONTENT_MARGIN_PT = (10 / 25.4) * 72;
/** Under this many text items, a page with meaningful line work has its text drawn as outlines. */
export const OUTLINED_TEXT_MAX = 3;
/** An OCR box is the glyphs' height, so the font size is the box over the share of an em they
 *  fill: digits, capitals and tall letters about 0.72, a word of only short letters ("mm") the
 *  x-height, about 0.52. Without this "4000" and "mm" differ in height and never join. */
const OCR_CAP = 0.72;
const OCR_X = 0.52;
const emShare = (word: string) => (/^[acemnorsuvwxz]+$/.test(word) ? OCR_X : OCR_CAP);
const FOOT = 0.3048;

export type RenderPage = (page: PDFPageProxy, pxPerPt: number, region?: PixelRegion) => Promise<PlanPixels>;

type Box = { x0: number; y0: number; x1: number; y1: number };

/**
 * The drawing's content box in page points (step X.1): every stroke (its ends, grown by half its
 * width) and every text item (its four corners, turned by its rotation; the height above the
 * baseline, the margin covers descenders), grown by `margin` and clipped to the page. Pictures
 * are left out: a vector page reads its line work, and a mixed page's picture is ignored. Null
 * when the page has neither strokes nor text.
 */
export function contentBox(page: Pick<VectorPage, "width" | "height" | "segments" | "texts">, margin = CONTENT_MARGIN_PT): Box | null {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  const add = (x: number, y: number, r = 0) => {
    x0 = Math.min(x0, x - r);
    y0 = Math.min(y0, y - r);
    x1 = Math.max(x1, x + r);
    y1 = Math.max(y1, y + r);
  };
  for (const g of page.segments) {
    add(g.x1, g.y1, g.width / 2);
    add(g.x2, g.y2, g.width / 2);
  }
  for (const t of page.texts) {
    const a = (t.rotation * Math.PI) / 180;
    const [ux, uy] = [Math.cos(a), Math.sin(a)]; // along the baseline
    const [vx, vy] = [uy, -ux]; // up from the baseline (y points down)
    for (const [s, h] of [[0, 0], [t.width, 0], [0, t.height], [t.width, t.height]]) add(t.x + ux * s + vx * h, t.y + uy * s + vy * h);
  }
  if (x0 > x1) return null;
  return { x0: Math.max(0, x0 - margin), y0: Math.max(0, y0 - margin), x1: Math.min(page.width, x1 + margin), y1: Math.min(page.height, y1 + margin) };
}

/** A drawing whose content box spans less than this share of the sheet's longer side is
 *  rendered alone (step X.1). Anything bigger renders the whole page, exactly as before. */
export const CROP_BELOW = 0.5;

/**
 * What to render of a vector page (header): a small drawing on a big sheet (its content box under
 * CROP_BELOW of the sheet's longer side) renders only that box, at the found scale's
 * TARGET_PX_PER_M under the side cap, as whole pixels of the full page's raster at that scale (the
 * cap leaves 3 px for rounding the box out to whole pixels, so no side reaches RASTER_MAX_SIDE).
 * Every other page renders whole, as before step X.1: on an A4 plan the box is most of the sheet
 * and a crop would only trade the tracing that every fixture's results were read from for a
 * slightly finer one.
 */
export function vectorRaster(page: Pick<VectorPage, "width" | "height" | "segments" | "texts">, mPerPt: number | null): { pxPerPt: number; region: PixelRegion } {
  const content = contentBox(page);
  const box = content && Math.max(content.x1 - content.x0, content.y1 - content.y0) < CROP_BELOW * Math.max(page.width, page.height) ? content : null;
  if (!box) {
    // The whole page, exactly as before step X.1 (its side never reaches the cap: ceil of at most 2399).
    const k = Math.min(mPerPt ? TARGET_PX_PER_M * mPerPt : Infinity, (RASTER_MAX_SIDE - 1) / Math.max(page.width, page.height));
    return { pxPerPt: k, region: fullRegion(page, k) };
  }
  const fit = (RASTER_MAX_SIDE - 3) / Math.max(box.x1 - box.x0, box.y1 - box.y0);
  const k = Math.min(mPerPt ? TARGET_PX_PER_M * mPerPt : fit, fit);
  const full = fullRegion(page, k);
  const [left, top] = [Math.max(0, Math.floor(box.x0 * k)), Math.max(0, Math.floor(box.y0 * k))];
  const [right, bottom] = [Math.min(full.width, Math.ceil(box.x1 * k)), Math.min(full.height, Math.ceil(box.y1 * k))];
  return { pxPerPt: k, region: { left, top, width: right - left, height: bottom - top } };
}

/** Raster pixels per point for a whole page read as a picture (a scan, or outlined text for OCR):
 *  300 dpi, held to render.ts's pixel budget and edge cap (step X.1; before it, 40 megapixels). */
export const scanRasterScale = (page: Pick<VectorPage, "width" | "height">) =>
  Math.min(SCAN_DPI / 72, Math.sqrt(PIXEL_BUDGET / (page.width * page.height)) * 0.999, (MAX_EDGE - 1) / Math.max(page.width, page.height));

/** OCR words (pixels of a raster at pxPerPt) as page text in points. A word read
 *  from the turned copy reads bottom to top: rotation -90, its baseline on the
 *  box's right, its height the box's width. */
export function ocrTexts(words: OcrWord[], pxPerPt: number): PdfText[] {
  return words
    .filter((w) => w.text.trim())
    .map((w) => {
      const [x0, y0, x1, y1] = [w.box.x0 / pxPerPt, w.box.y0 / pxPerPt, w.box.x1 / pxPerPt, w.box.y1 / pxPerPt];
      const em = emShare(w.text);
      return w.vertical
        ? { str: w.text, x: x1, y: y1, rotation: -90, height: (x1 - x0) / em, width: y1 - y0 }
        : { str: w.text, x: x0, y: y1, rotation: 0, height: (y1 - y0) / em, width: x1 - x0 };
    });
}

const ZERO = { x: 0, y: 0 };

/** Step Q.2b: a floor-level word (FFL, SSL, FL, LEVEL, LVL; dotted or not) and a signed level (+0.150, -20, ±0.000). */
const LEVEL_WORD = String.raw`(?:F\.?F\.?L|S\.?S\.?L|F\.?L|LEVEL|LVL)\b\.?`;
const SIGNED = String.raw`[+\-±−]\s*\d+(?:[.,]\d+)?`;
/** A whole line that is a level note: "FFL +0.150", "FL", "LEVEL 1", "+0.000". */
const LEVEL_LINE = new RegExp(`^(?:${LEVEL_WORD}.*|${SIGNED})$`, "i");
/** A level note at the end of a name's own line: "Bathroom FL -0.020", "Living +0.150", "Hall FFL". */
const LEVEL_TAIL = new RegExp(`\\s+(?:(?:${LEVEL_WORD}\\s*:?\\s*)?${SIGNED}|(?:F\\.?F\\.?L|S\\.?S\\.?L|F\\.?L)\\b\\.?)$`, "i");

/** Step Q.2b: a text line without its level note ("" when it is only one): a level is never part of a room name. */
export function withoutLevel(text: string): string {
  return LEVEL_LINE.test(text.trim()) ? "" : text.replace(LEVEL_TAIL, "").trim();
}

/** Room-name labels from the page's text, in raster pixels (header); `origin` is the raster's top-left in points.
 *  Step Q.2b: level notes are left out of them (`withoutLevel`). */
export function pdfLabels(page: Pick<VectorPage, "texts">, pxPerPt: number, origin = ZERO): PlanLabel[] {
  return textLines(page.texts)
    .map((l) => ({ ...l, text: withoutLevel(l.text) }))
    .filter((l) => l.text && !parseTitleScale(l.text) && parseDimension(l.text) === null && !/^\d+(?:\.\d+)?$/.test(l.text))
    .map((l) => ({ text: l.text, x: (l.centre.x - origin.x) * pxPerPt, y: (l.centre.y - origin.y) * pxPerPt, confidence: 100 }));
}

/** The PDF's scale as the image pipeline's ScaleEstimate, in pixels per metre of the raster whose top-left is `origin` (points). */
export function toScaleEstimate(s: PdfScale, pxPerPt: number, walls: PixelWall[], origin = ZERO): ScaleEstimate {
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
      .map((m) => ({ source: "dimension" as const, text: m.text, pxPerM: px(m.metres / m.lengthPt), box: { x0: (m.box.x0 - origin.x) * pxPerPt, y0: (m.box.y0 - origin.y) * pxPerPt, x1: (m.box.x1 - origin.x) * pxPerPt, y1: (m.box.y1 - origin.y) * pxPerPt } })),
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
  opts: {
    pageCount: number;
    render: RenderPage;
    onProgress?: (stage: string, fraction: number) => void;
    ocr?: (p: PlanPixels) => Promise<OcrResult>;
    maxPathOps?: number;
  },
): Promise<{ analysis: Analysis; pdf: PdfInfo; vector: VectorPage }> {
  const vector = await extractVectorPage(pdfjs, page, { maxPathOps: opts.maxPathOps });
  if (!vector.segments.length && !vector.texts.length && !vector.images.length) throw new BlueprintError(PDF_MESSAGES.blank);
  const base = { pageNumber: page.pageNumber, pageCount: opts.pageCount, kind: vector.kind, paper: vector.paper, pageSize: { width: vector.width, height: vector.height } };

  if (vector.kind === "scanned") {
    const pxPerPt = scanRasterScale(vector);
    const analysis = await analyseBlueprint(await opts.render(page, pxPerPt), { onProgress: opts.onProgress, ocr: opts.ocr });
    return { analysis, vector, pdf: { ...base, route: "raster", pxPerPt, scale: null, traceMm: null, notes: ["Scanned PDF: measurements are approximate."], vectorWalls: null, ocrText: false } };
  }

  // Outlined text (step M.1b): meaningful line work but almost no text items. The page is
  // read by OCR at 300 dpi for its dimensions and room names; the same scale rules apply.
  const outlined = meaningfulLines(vector) && vector.texts.length < OUTLINED_TEXT_MAX;
  let texts = vector.texts;
  let ocrError: string | null = null; // why OCR could not run (a missing OCR file is named), said in the notes
  if (outlined) {
    const k = scanRasterScale(vector);
    const ocr = await (opts.ocr ?? ((p: PlanPixels) => ocrPlan(p, [])))(await opts.render(page, k));
    texts = ocrTexts(ocr.words, k);
    ocrError = ocr.error;
  }
  const scale = pdfScale({ ...vector, texts }, outlined ? "ocr" : "pdf");
  // Only the drawing's content box, at the scale's resolution (header, step X.1).
  const { pxPerPt, region } = vectorRaster({ ...vector, texts }, scale.mPerPt);
  const rasterOrigin = { x: region.left / pxPerPt, y: region.top / pxPerPt };
  const labels = pdfLabels({ texts }, pxPerPt, rasterOrigin);
  const fromPdf = async (): Promise<OcrResult> => ({ labels, words: [], error: null, rereads: [] });
  const analysis = await analyseBlueprint(await opts.render(page, pxPerPt, region), { onProgress: opts.onProgress, ocr: fromPdf, straighten: false, maxSide: RASTER_MAX_SIDE });
  analysis.scale = toScaleEstimate(scale, pxPerPt, analysis.walls, rasterOrigin);
  analysis.warnings = analysis.warnings.filter((w) => w.code !== "no-scale" && w.code !== "check-scale");

  // Walls from the PDF's own lines need a scale to read thicknesses in metres.
  const vectorWalls = scale.mPerPt ? readVectorWalls(vector, scale.mPerPt, { annotation: scale.annotation }) : null;
  const traceMm = scale.mPerPt ? (scale.mPerPt / pxPerPt) * 1000 : null; // one raster pixel
  const notes = [
    "Read from PDF vectors.",
    ...(vector.kind === "mixed" ? ["This page mixes a picture with line work. It was read as vector line work; the picture was ignored."] : []),
    ...(outlined && ocrError ? [`The text on this page is drawn as shapes and could not be read. ${ocrError}.`] : []),
    ...(outlined && !ocrError ? ["The text on this page is drawn as shapes, so it was read by OCR. Check the dimensions marked \"read by OCR\"."] : []),
    vectorWalls
      ? `Walls are read exactly from the PDF's lines; any the lines don't explain are traced at about ${Math.round(traceMm!)} mm.`
      : "Without a scale the PDF's lines can't be read as walls, so walls are traced from a picture of the page.",
  ];
  const rasterSize = { width: region.width, height: region.height };
  return { analysis, vector, pdf: { ...base, route: "vector", pxPerPt, rasterOrigin, rasterSize, scale, traceMm, notes, vectorWalls, ocrText: outlined } };
}
