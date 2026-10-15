/**
 * test-pdf-budget.ts — step X.1: the page reader never makes a raster over the pixel budget and
 * never builds unbounded arrays, and a small plan on a big sheet keeps its resolution and its
 * exact mapping. pdf.js runs through scripts/pdf-node.ts; fixtures from scripts/make-pdf-fixtures.ts.
 *
 *   - contentBox: the extent of strokes (grown by half their width) and text (turned with it),
 *     plus the margin, clipped to the page; null with neither;
 *   - the pixel budget (render.ts, 4096² px and 4096 px a side): every raster scale the reader
 *     uses (a scan or outlined text at 300 dpi, a vector page whole or cropped) stays inside it on
 *     A4 to A0, either way up; renderPage itself refuses a bigger one with the plain message.
 *     FAILING FIRST: before X.1 a scanned A0 page was rendered at 40 MP (7521 × 5320 px);
 *   - plan-small-on-big.pdf (plan-filled at 1:100 on an empty A0 sheet): read within the budget,
 *     only its content box rendered, at the 100 px/m target (before X.1: 20 px/m, the whole
 *     sheet squeezed under 2400 px); every wall from the PDF within 0.5 mm of the truth, every
 *     traced opening snapped to the PDF's (which needs the crop's offset right), the rooms named
 *     from the PDF's text (which needs the labels' offset right), the review overlay's pixels on
 *     the traced walls, and the background mapping of a traced build exact through the crop;
 *   - every vector fixture with a scale: every wall read from the PDF within 0.5 mm of a true
 *     centre line (the crop must not move any of them);
 *   - caps with plain messages: a page of 500,001 path segments; 100 curve commands that
 *     flatten into over 500,000 pieces; too many text items.
 * Run: npx tsx scripts/test-pdf-budget.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { buildFromAnalysis, type OcrResult } from "../src/lib/blueprint/analyse";
import { titleCase } from "../src/lib/blueprint/nameRooms";
import { apply, buildMapping } from "../src/lib/background/mapping";
import { analysePdfPage, CONTENT_MARGIN_PT, contentBox, scanRasterScale, TARGET_PX_PER_M, vectorRaster } from "../src/lib/pdf/analysePdf";
import { extractVectorPage, MAX_PATH_OPS, MAX_SEGMENTS, tooManyOps, tooManySegments, tooManyTexts } from "../src/lib/pdf/extract";
import { fullRegion, MAX_EDGE, overBudget, PIXEL_BUDGET, renderPage, tooBigToRender, type PixelRegion } from "../src/lib/pdf/render";
import { buildPdfPlan, planToPixels } from "../src/lib/pdf/snap";
import { BlueprintError, type PlanPixels } from "../src/types/blueprint";
import type { PdfSegment, PdfText } from "../src/types/pdf";
import type { Vec2 } from "../src/types/plan";
import type { Truth } from "./make-pdf-fixtures";
import { nodeCanvas, openNode, pdfjs } from "./pdf-node";

const DIR = join(__dirname, "../tests/fixtures/pdf");
const truths: Truth[] = JSON.parse(readFileSync(join(DIR, "truth.json"), "utf8"));
const truth = (file: string) => truths.find((t) => t.file === file)!;
const HALF_MM = 0.0005;
const noOcr = async (): Promise<OcrResult> => ({ labels: [], words: [], error: null, rereads: [] });
const PAPERS: [string, number, number][] = [["A4", 595.28, 841.89], ["A3", 841.89, 1190.55], ["A1", 1683.78, 2383.94], ["A0", 2383.94, 3370.39], ["Letter", 612, 792]];

async function plainError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof BlueprintError, `a plain BlueprintError, not ${e}`);
    return e.message;
  }
  assert.fail("expected a BlueprintError");
}

/** Reads a fixture's plan page, recording every raster the reader asks for. */
async function read(file: string) {
  const t = truth(file);
  const doc = await openNode(new Uint8Array(readFileSync(join(DIR, file))));
  const rasters: { width: number; height: number; k: number; region?: PixelRegion }[] = [];
  const render = async (page: Parameters<typeof renderPage>[0], k: number, region?: PixelRegion): Promise<PlanPixels> => {
    const px = await renderPage(page, k, nodeCanvas, region);
    rasters.push({ width: px.width, height: px.height, k, region });
    return px;
  };
  const out = await analysePdfPage(pdfjs, await doc.getPage(t.planPage), { pageCount: doc.numPages, render, ocr: noOcr });
  await doc.loadingTask.destroy();
  return { ...out, t, rasters };
}

/** Distance from a plan point to the nearest true centre line, in the truth's frame (origin `o`). */
const toTrueLine = (t: Truth, p: Vec2, o: Vec2) =>
  Math.min(
    ...t.planWalls.map((tw) => {
      const L = Math.hypot(tw.b.x - tw.a.x, tw.b.y - tw.a.y);
      const q = { x: p.x - o.x, y: p.y - o.y };
      const k = Math.max(0, Math.min(L, ((q.x - tw.a.x) * (tw.b.x - tw.a.x) + (q.y - tw.a.y) * (tw.b.y - tw.a.y)) / L));
      return Math.hypot(q.x - tw.a.x - ((tw.b.x - tw.a.x) / L) * k, q.y - tw.a.y - ((tw.b.y - tw.a.y) / L) * k);
    }),
  );

/** One page whose content stream is `content`, as bytes. */
async function rawPage(content: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([595.28, 841.89]);
  page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.stream(content)));
  return doc.save({ useObjectStreams: false });
}

async function main() {
  // ------------------------------------------------------------ contentBox
  {
    const seg = (x1: number, y1: number, x2: number, y2: number, width = 0): PdfSegment => ({ x1, y1, x2, y2, width, filled: false, path: 0, curve: false });
    const text = (x: number, y: number, rotation: number, width = 40, height = 10): PdfText => ({ str: "Hall", x, y, rotation, width, height });
    const page = { width: 1000, height: 800 };
    const m = CONTENT_MARGIN_PT;
    assert.equal(contentBox({ ...page, segments: [], texts: [] }), null, "nothing drawn: no box");
    assert.deepEqual(contentBox({ ...page, segments: [seg(300, 200, 500, 200, 4)], texts: [] }, 0), { x0: 298, y0: 198, x1: 502, y1: 202 }, "a stroke grows by half its width");
    // Text at (600, 400) reading left to right reaches 40 along and 10 up (y down: to 390).
    assert.deepEqual(contentBox({ ...page, segments: [], texts: [text(600, 400, 0)] }, 0), { x0: 600, y0: 390, x1: 640, y1: 400 }, "text: baseline start, width along, height up");
    // Turned -90° (reading bottom to top): along is -y, up is -x.
    const up = contentBox({ ...page, segments: [], texts: [text(600, 400, -90)] }, 0)!;
    assert.deepEqual([up.x0, up.y0, up.x1, up.y1].map((v) => +v.toFixed(9)), [590, 360, 600, 400], "text turned -90°");
    assert.deepEqual(contentBox({ ...page, segments: [seg(300, 200, 500, 300)], texts: [text(600, 400, 0)] }), { x0: 300 - m, y0: 200 - m, x1: 640 + m, y1: 400 + m }, "both, plus the 10 mm margin");
    assert.deepEqual(contentBox({ ...page, segments: [seg(5, 5, 995, 795)], texts: [] }), { x0: 0, y0: 0, x1: 1000, y1: 800 }, "clipped to the page");
    console.log(`contentBox: strokes and turned text, margin ${m.toFixed(2)} pt (10 mm), clipped to the page`);
  }

  // ------------------------------------------------------------ the pixel budget on every paper size
  {
    assert.equal(PIXEL_BUDGET, 4096 * 4096);
    assert.ok(!overBudget(4096, 4096) && overBudget(4097, 10) && overBudget(4096, 4097) && overBudget(3000, 6000), "the budget: 4096 a side and 4096² in all");
    // Before X.1 a page read as a picture (a scan, or outlined text for OCR) was rendered at 300 dpi up to 40 MP.
    const before = (w: number, h: number) => Math.min(300 / 72, Math.sqrt(40_000_000 / (w * h)));
    const a0 = fullRegion({ width: 3370.39, height: 2383.94 }, before(3370.39, 2383.94));
    assert.ok(overBudget(a0.width, a0.height), "failing first, the old rule: a scanned A0 page was over the budget");
    console.log(`failing first: before X.1 a scanned A0 page rendered at ${a0.width} × ${a0.height} px = ${((a0.width * a0.height) / 1e6).toFixed(1)} MP (budget ${(PIXEL_BUDGET / 1e6).toFixed(1)} MP, ${MAX_EDGE} a side)`);
    const rows: string[] = [];
    for (const [name, s, l] of PAPERS)
      for (const [w, h] of [[s, l], [l, s]]) {
        const scan = fullRegion({ width: w, height: h }, scanRasterScale({ width: w, height: h }));
        assert.ok(!overBudget(scan.width, scan.height), `${name} ${w}×${h}: scan ${scan.width}×${scan.height} within the budget`);
        // A vector page at 1:100 drawn edge to edge, and a small drawing in the middle of the sheet.
        const full = vectorRaster({ width: w, height: h, segments: [{ x1: 1, y1: 1, x2: w - 1, y2: h - 1, width: 0, filled: false, path: 0, curve: false }], texts: [] }, 0.03528);
        const small = vectorRaster({ width: w, height: h, segments: [{ x1: w / 2 - 100, y1: h / 2 - 150, x2: w / 2 + 100, y2: h / 2 + 150, width: 0, filled: false, path: 0, curve: false }], texts: [] }, 0.03528);
        for (const r of [full, small]) assert.ok(!overBudget(r.region.width, r.region.height) && Math.max(r.region.width, r.region.height) < 2400, `${name}: vector raster ${r.region.width}×${r.region.height} under 2400 a side`);
        rows.push(`${name} ${Math.round(w)}×${Math.round(h)}: scan ${scan.width}×${scan.height}`);
      }
    console.log(`budget: every paper either way up within it (${rows.filter((_, i) => i % 2 === 0).join("; ")})`);
    const doc = await openNode(new Uint8Array(readFileSync(join(DIR, "plan-small-on-big.pdf"))));
    const page = await doc.getPage(1);
    const big = fullRegion(page.getViewport({ scale: 1 }), 3.5);
    assert.equal(await plainError(renderPage(page, 3.5, nodeCanvas)), tooBigToRender(big.width, big.height), "renderPage refuses an A0 sheet at 3.5 px/pt, before any canvas");
    console.log(`renderPage refuses ${big.width} × ${big.height} px: "${tooBigToRender(big.width, big.height)}"`);
    await doc.loadingTask.destroy();
  }

  // ------------------------------------------------------------ plan-small-on-big.pdf
  {
    const file = "plan-small-on-big.pdf";
    const { analysis, pdf, t, rasters, vector } = await read(file);
    assert.equal(vector.paper, "A0", "an A0 sheet");
    assert.ok(rasters.length > 0 && rasters.every((r) => !overBudget(r.width, r.height)), `every raster within the budget (${rasters.map((r) => `${r.width}×${r.height}`).join(", ")})`);
    const [r] = rasters;
    assert.ok(r.region && pdf.rasterOrigin && pdf.rasterOrigin.x > 1000 && pdf.rasterOrigin.y > 500, `only the content box is rendered, from (${pdf.rasterOrigin?.x.toFixed(0)}, ${pdf.rasterOrigin?.y.toFixed(0)}) pt`);
    assert.deepEqual(pdf.rasterSize, { width: analysis.pixels.width, height: analysis.pixels.height }, "the raster read is the one rendered");
    const pxPerM = analysis.scale.pxPerM!;
    // Before X.1 the whole sheet was squeezed under 2400 px: 0.712 px/pt, 20 px/m, 50 mm a pixel.
    assert.ok(pxPerM > 0.95 * TARGET_PX_PER_M, `traced at the target resolution: ${pxPerM.toFixed(1)} px/m (whole sheet: ${((2399 / 3370.39) * (1 / pdf.scale!.mPerPt!)).toFixed(1)})`);
    const scale = { pxPerM, source: "pdf" as const };
    const b = buildPdfPlan(analysis, pdf, scale);
    const vec = b.plan.walls.filter((w) => w.provenance === "vector");
    assert.equal(vec.length, t.planWalls.length, `${file}: every wall read from the PDF (${vec.length} of ${b.plan.walls.length})`);
    const o = { x: Math.min(...vec.flatMap((w) => [w.a.x, w.b.x])), y: Math.min(...vec.flatMap((w) => [w.a.y, w.b.y])) };
    const worst = Math.max(...b.plan.walls.flatMap((w) => [toTrueLine(t, w.a, o), toTrueLine(t, w.b, o)]));
    assert.ok(worst <= HALF_MM, `${file}: every wall end within 0.5 mm of the truth (worst ${(worst * 1000).toFixed(3)} mm)`);
    // The traced openings are found in raster pixels: they snap to the PDF's only if the crop's offset is right.
    assert.equal(b.coverage.openings.snapped, t.planOpenings.length, `${file}: every traced opening snapped to the PDF's (${JSON.stringify(b.coverage.openings)})`);
    // The room names are text positions turned into raster pixels: right only with the offset.
    assert.deepEqual(b.plan.rooms.map((x) => x.name).sort(), t.rooms.map(titleCase).sort(), `${file}: rooms named from the PDF's text`);
    // The overlay draws plan metres onto the raster: every wall end lands on a traced wall end within 3 px.
    const px = planToPixels(b.coverage, pxPerM, pdf.rasterOrigin);
    const tracedEnds = analysis.walls.flatMap((w) => [w.a, w.b]);
    const overlayWorst = Math.max(...vec.flatMap((w) => [w.a, w.b]).map((p) => Math.min(...tracedEnds.map((q) => Math.hypot(px(p).x - q.x, px(p).y - q.y)))));
    assert.ok(overlayWorst <= 3, `the review overlay puts the PDF's walls on the traced ones (worst ${overlayWorst.toFixed(2)} px)`);
    // A traced-only build's background mapping (the image pipeline's chain) goes through the crop too.
    const traced = buildFromAnalysis(analysis, scale);
    const m = buildMapping(traced, analysis, pdf, scale, { width: analysis.pixels.width, height: analysis.pixels.height });
    const ends = traced.plan.walls.flatMap((w) => [w.a, w.b]);
    const mapWorst = Math.max(
      ...pdf.vectorWalls!.walls.flatMap((w) => [w.a, w.b]).map((p) => {
        const q = apply(m, { x: p.x / pdf.vectorWalls!.mPerPt, y: p.y / pdf.vectorWalls!.mPerPt });
        return Math.min(...ends.map((e) => Math.hypot(e.x - q.x, e.y - q.y)));
      }),
    );
    assert.ok(mapWorst <= 2 / pxPerM, `background mapping of a traced build: the PDF's wall ends land on the traced plan's within 2 px (worst ${(mapWorst * 1000).toFixed(1)} mm)`);
    console.log(
      `${file}: A0, rendered ${r.width} × ${r.height} px (${((r.width * r.height) / 1e6).toFixed(1)} MP) from (${pdf.rasterOrigin!.x.toFixed(1)}, ${pdf.rasterOrigin!.y.toFixed(1)}) pt at ${pxPerM.toFixed(1)} px/m; ${vec.length}/${b.plan.walls.length} walls exact, worst ${(worst * 1000).toFixed(3)} mm; ${b.coverage.openings.snapped} openings snapped; rooms ${b.plan.rooms.map((x) => x.name).join(", ")}; overlay within ${overlayWorst.toFixed(2)} px; traced mapping within ${(mapWorst * 1000).toFixed(1)} mm`,
    );
  }

  // ------------------------------------------------------------ every vector fixture: walls from the PDF within 0.5 mm
  {
    const rows: string[] = [];
    for (const t of truths.filter((x) => x.kind === "vector")) {
      const { analysis, pdf, rasters } = await read(t.file);
      assert.ok(rasters.every((r) => !overBudget(r.width, r.height)), `${t.file}: within the budget`);
      if (!pdf.vectorWalls) {
        rows.push(`${t.file}: no scale without OCR, traced only`);
        continue;
      }
      const vec = buildPdfPlan(analysis, pdf, { pxPerM: analysis.scale.pxPerM!, source: "pdf" }).plan.walls.filter((w) => w.provenance === "vector");
      const o = { x: Math.min(...vec.flatMap((w) => [w.a.x, w.b.x])), y: Math.min(...vec.flatMap((w) => [w.a.y, w.b.y])) };
      const worst = Math.max(...vec.flatMap((w) => [toTrueLine(t, w.a, o), toTrueLine(t, w.b, o)]));
      assert.ok(vec.length > 0 && worst <= HALF_MM, `${t.file}: every wall from the PDF within 0.5 mm (worst ${(worst * 1000).toFixed(3)} mm)`);
      rows.push(`${t.file}: ${vec.length} walls, worst ${(worst * 1000).toFixed(3)} mm, ${pdf.rasterOrigin && (pdf.rasterOrigin.x || pdf.rasterOrigin.y) ? "cropped" : "whole page"}`);
    }
    console.log(`every vector fixture:\n  ${rows.join("\n  ")}`);
  }

  // ------------------------------------------------------------ caps with plain messages
  {
    // 500,001 straight segments in one path: 500,002 path commands, over the cap.
    const n = MAX_SEGMENTS + 1;
    const parts = ["0.1 w 10 10 m"];
    for (let i = 0; i < n; i++) parts.push(`${10 + (i % 500)} ${10 + Math.floor(i / 500) * 0.5} l`);
    parts.push("S");
    const t0 = Date.now();
    const doc = await openNode(await rawPage(parts.join("\n")));
    assert.equal(await plainError(extractVectorPage(pdfjs, await doc.getPage(1))), tooManyOps(MAX_PATH_OPS), `${n} path segments: refused`);
    await doc.loadingTask.destroy();
    console.log(`caps: a page of ${n.toLocaleString("en-GB")} path segments refused in ${((Date.now() - t0) / 1000).toFixed(1)} s: "${tooManyOps(MAX_PATH_OPS)}"`);

    // 100 curve commands, each with a second difference of about 2.8 million pt: about 6,500 flattened pieces each.
    const curves = ["0.1 w"];
    for (let i = 0; i < 100; i++) curves.push(`0 ${i} m 2000000 ${i} 2000000 ${i + 2000000} 0 ${i + 2000000} c S`);
    const cdoc = await openNode(await rawPage(curves.join("\n")));
    assert.equal(await plainError(extractVectorPage(pdfjs, await cdoc.getPage(1))), tooManySegments(MAX_SEGMENTS), "100 curves flattening past the segment cap: refused");
    await cdoc.loadingTask.destroy();
    console.log(`caps: 100 curve commands flattening past ${MAX_SEGMENTS.toLocaleString("en-GB")} pieces refused: "${tooManySegments(MAX_SEGMENTS)}"`);

    // Text items: 60 on a page, with the cap at 50.
    const words = await PDFDocument.create({ updateMetadata: false });
    const wpage = words.addPage([595.28, 841.89]);
    const font = await words.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < 60; i++) wpage.drawText(`Room ${i}`, { x: 50, y: 50 + i * 10, size: 8, font });
    const tdoc = await openNode(await words.save({ useObjectStreams: false }));
    assert.equal(await plainError(extractVectorPage(pdfjs, await tdoc.getPage(1), { maxTexts: 50 })), tooManyTexts(50), "too many text items: refused");
    assert.equal((await extractVectorPage(pdfjs, await tdoc.getPage(1), { maxTexts: 60 })).texts.length, 60, "and at the cap, read");
    await tdoc.loadingTask.destroy();
    console.log(`caps: 60 text items over a cap of 50 refused: "${tooManyTexts(50)}"`);
  }
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
