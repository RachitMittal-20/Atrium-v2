/**
 * test-pdf.ts — step M.1a, reading floor-plan PDFs (src/lib/pdf/), against the
 * fixtures in tests/fixtures/pdf/ and their truth.json (scripts/make-pdf-fixtures.ts).
 * pdf.js runs through its Node-compatible legacy build (scripts/pdf-node.ts), in
 * this thread, rendering with @napi-rs/canvas.
 *
 *   - FIRST (written before the rule, and seen failing): the title block alone
 *     never makes the scale "good";
 *   - segment extraction: every straight segment the generator drew is found
 *     within 0.01 pt (both ends, after the fixture's matrix and /Rotate), with its
 *     stroke width and fill flag, and every other segment is a flattened door arc
 *     (ends on the circle within 0.01 pt, middle within 0.05 pt + 0.01);
 *   - text items: string, baseline start, reading angle and height (not width: for a
 *     font the PDF does not embed, pdf.js measures with its own metrics table);
 *   - classification of every fixture (and the cover page of plan-two-pages);
 *   - scale: "good" and within 0.1% of the truth on filled, lines, rotated,
 *     imperial and two-pages; plan-fit uses the dimensions, reports the 1:115
 *     title-block mismatch and is within 0.1%; plan-no-dims is "check" from the
 *     title block alone; the scanned fixture has no vector scale;
 *   - dimension check: every row OK with differences under 1 mm on the clean
 *     fixtures; a dimension printed wrong (4100 mm on a 4 m line, injected into
 *     plan-filled's text) is flagged, an override keeps the measured value beside
 *     the typed one, and both reach the CSV; feet-and-inch formatting;
 *   - limits and damaged files: over 50 MB, too many path commands, encrypted,
 *     garbage, cut short, empty, no pages (a blank page): each a BlueprintError with the plain message;
 *   - routes: the scanned fixture is rendered at 300 dpi and goes through the
 *     image pipeline (raster route, its note); plan-filled and plan-rotated build
 *     plans whose rooms carry the PDF's names (the sample's, title-cased by
 *     nameRooms) and whose total wall length is the truth's within the raster's
 *     tolerance.
 * Run: npx tsx scripts/test-pdf.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { buildFromAnalysis, type OcrResult } from "../src/lib/blueprint/analyse";
import { titleCase } from "../src/lib/blueprint/nameRooms";
import { analysePdfPage } from "../src/lib/pdf/analysePdf";
import { dimensionRows, formatFeetInches, formatMm, rowsToCsv } from "../src/lib/pdf/dimensions";
import { extractVectorPage, FLATTEN_PT, tooManyOps } from "../src/lib/pdf/extract";
import { MAX_PDF_BYTES, PDF_MESSAGES } from "../src/lib/pdf/open";
import { combineScale, parseDimension, parseTitleScale, pdfScale } from "../src/lib/pdf/scale";
import { wallLength } from "../src/lib/plan/geometry";
import { samplePlan } from "../src/data/samplePlan";
import { BlueprintError } from "../src/types/blueprint";
import type { Truth } from "./make-pdf-fixtures";
import { openNode, pdfjs, renderNode } from "./pdf-node";

const DIR = join(__dirname, "../tests/fixtures/pdf");
const truths: Truth[] = JSON.parse(readFileSync(join(DIR, "truth.json"), "utf8"));
const truth = (file: string) => truths.find((t) => t.file === file)!;
const bytes = (file: string) => new Uint8Array(readFileSync(join(DIR, file)));
const open = (file: string) => openNode(bytes(file));
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/** The BlueprintError message a promise rejects with (fails on anything else). */
async function plainError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof BlueprintError, `expected a BlueprintError, got ${e}`);
    assert.ok(!/\n\s+at |Error:/.test(e.message), `plain message, no stack: ${e.message}`);
    return e.message;
  }
  assert.fail("expected a refusal");
}

async function main() {
  // ------------------------------------------------------------ the title block alone never makes "good"
  // Written first, before the rule existed (it failed then: the title block alone gave "good").
  {
    const title = parseTitleScale("SCALE 1:100");
    assert.ok(title, "1:100 parsed");
    const alone = combineScale([], title, "A4");
    assert.equal(alone.confidence, "check", "title block alone: check, never good");
    assert.ok(alone.mPerPt !== null && Math.abs(alone.mPerPt - (100 * 25.4) / 72 / 1000) < 1e-12, "title block alone: its value is offered");
    // Nor with one dimension, or dimensions that disagree.
    assert.equal(combineScale([0.0352], title, "A4").confidence, "check", "one dimension + title block: check");
    assert.equal(combineScale([0.03, 0.05], title, "A4").confidence, "check", "disagreeing dimensions + title block: check");
    assert.equal(combineScale([0.03, 0.05], null, "A4").confidence, "none", "disagreeing dimensions alone: none");
    assert.equal(combineScale([], null, "A4").confidence, "none", "nothing: none");
    console.log(`title block alone: ${alone.confidence}, "${alone.reason}"`);
  }

  // ------------------------------------------------------------ parsers
  {
    const FT = 0.3048;
    const cases: [string, number | null][] = [["3800 mm", 3.8], ["3.8 m", 3.8], ["380 cm", 3.8], [`12'-6"`, 12.5 * FT], [`12' 6"`, 12.5 * FT], ["12 ft 6 in", 12.5 * FT], ["3800", null], ["Bedroom 1", null]];
    for (const [s, want] of cases) {
      const got = parseDimension(s);
      assert.ok(want === null ? got === null : got !== null && near(got, want, 1e-9), `parseDimension(${s}) = ${got}`);
    }
    assert.equal(parseTitleScale("SCALE 1:50")?.ratio, 50);
    assert.equal(parseTitleScale(`SCALE 1/8" = 1'-0"`)?.ratio, 96);
    assert.equal(parseTitleScale(`1/4" = 1'-0"`)?.ratio, 48);
    assert.equal(parseTitleScale("Bedroom 1"), null);
    console.log("parsers: dimensions, 1:N and 1/8\" = 1'-0\"");
  }

  // ------------------------------------------------------------ extraction, text, classification, scale, dimension check
  const vectorFiles = ["plan-filled.pdf", "plan-lines.pdf", "plan-fit.pdf", "plan-rotated.pdf", "plan-imperial.pdf", "plan-two-pages.pdf", "plan-no-dims.pdf"];
  for (const file of [...vectorFiles, "plan-scanned.pdf"]) {
    const t = truth(file);
    const doc = await open(file);
    assert.equal(doc.numPages, t.pages, `${file}: pages`);
    const vp = await extractVectorPage(pdfjs, await doc.getPage(t.planPage));
    assert.equal(vp.kind, t.kind, `${file}: classified ${vp.kind}`);
    assert.ok(near(vp.width, t.viewport.width, 0.01) && near(vp.height, t.viewport.height, 0.01), `${file}: viewport size`);
    assert.equal(vp.rotate, t.rotate, `${file}: /Rotate`);

    // Every straight segment drawn is found within 0.01 pt.
    const left = new Set(vp.segments.map((_, i) => i));
    for (const [x1, y1, x2, y2, w, filled] of t.segments) {
      const hit = [...left].find((i) => {
        const s = vp.segments[i];
        const same = near(s.x1, x1, 0.01) && near(s.y1, y1, 0.01) && near(s.x2, x2, 0.01) && near(s.y2, y2, 0.01);
        const flipped = near(s.x1, x2, 0.01) && near(s.y1, y2, 0.01) && near(s.x2, x1, 0.01) && near(s.y2, y1, 0.01);
        return (same || flipped) && near(s.width, w, 0.01) && s.filled === filled;
      });
      assert.ok(hit !== undefined, `${file}: segment ${[x1, y1, x2, y2].map((v) => v.toFixed(2))} w ${w} filled ${filled} not found`);
      left.delete(hit);
    }
    // Everything else is a flattened door arc.
    for (const i of left) {
      const s = vp.segments[i];
      const on = t.arcs.some((a) => {
        const r = (x: number, y: number) => Math.hypot(x - a.cx, y - a.cy);
        return near(r(s.x1, s.y1), a.r, 0.01) && near(r(s.x2, s.y2), a.r, 0.01) && near(r((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2), a.r, FLATTEN_PT + 0.01);
      });
      assert.ok(on, `${file}: stray segment ${JSON.stringify(s)}`);
    }
    if (t.arcs.length) assert.ok(left.size >= t.arcs.length, `${file}: arcs flattened into pieces`);

    // Text items.
    assert.equal(vp.texts.length, t.texts.length, `${file}: text items`);
    for (const tt of t.texts) {
      const got = vp.texts.find((x) => x.str === tt.str && near(x.x, tt.x, 0.01) && near(x.y, tt.y, 0.01));
      assert.ok(got, `${file}: text "${tt.str}" at ${tt.x.toFixed(2)}, ${tt.y.toFixed(2)}`);
      assert.ok(near(got.rotation, tt.rotation, 0.01), `${file}: "${tt.str}" rotation ${got.rotation}, want ${tt.rotation}`);
      assert.ok(near(got.height, tt.height, 0.01), `${file}: "${tt.str}" height ${got.height}, want ${tt.height}`);
    }

    // Scale.
    const s = pdfScale(vp);
    const err = s.mPerPt === null ? Infinity : (Math.abs(s.mPerPt - t.mPerPt) / t.mPerPt) * 100;
    if (t.kind === "scanned") {
      assert.equal(s.confidence, "none", `${file}: no vector scale`);
    } else {
      assert.equal(s.confidence, t.expectedScale, `${file}: scale ${s.confidence} (${s.reason})`);
      assert.ok(err <= 0.1, `${file}: scale ${s.mPerPt} vs truth ${t.mPerPt}: ${err.toFixed(4)}% off`);
    }
    if (t.mismatchRatio) {
      assert.equal(s.mismatch, `The title block says 1:100, but the printed dimensions measure 1:${t.mismatchRatio}, so the page was probably scaled to fit when printed. Using the dimensions.`, `${file}: mismatch message`);
    } else assert.equal(s.mismatch, null, `${file}: no mismatch`);
    if (file === "plan-no-dims.pdf") assert.equal(s.mPerPt, s.title?.mPerPt, "no dims: the title block's value");

    // Dimension check: the matched texts are the printed ones, every row OK under 1 mm.
    assert.deepEqual(s.matches.map((m) => m.text).sort(), t.dims.map((d) => d.text).sort(), `${file}: dimension texts`);
    for (const m of s.matches) {
      const d = t.dims.find((x) => x.text === m.text && near(x.lengthPt, m.lengthPt, 0.01));
      assert.ok(d && near(m.metres, d.metres, 1e-9), `${file}: "${m.text}" matched to its own line (${m.lengthPt.toFixed(3)} pt)`);
    }
    if (s.mPerPt) {
      const rows = dimensionRows(s.matches, s.mPerPt);
      assert.ok(rows.every((r) => r.status === "ok" && Math.abs(r.diffMm) < 1), `${file}: every row OK under 1 mm: ${rows.map((r) => r.diffMm.toFixed(2))}`);
    }
    console.log(
      `${file}: ${vp.kind}, ${vp.segments.length} segments (${t.segments.length} straight + ${left.size} arc pieces), ${vp.texts.length} texts; scale ${s.confidence} ${s.mPerPt?.toFixed(6) ?? "-"} m/pt (${err === Infinity ? "-" : err.toFixed(4) + "%"} off), ${s.matches.length} dimensions${s.mismatch ? `; "${s.mismatch}"` : ""}`,
    );
    await doc.loadingTask.destroy();
  }

  // The cover page of the two-page file has a little text and a border: vector, no scale.
  {
    const doc = await open("plan-two-pages.pdf");
    const cover = await extractVectorPage(pdfjs, await doc.getPage(1));
    assert.equal(cover.kind, "vector", "cover page: vector (little on it)");
    assert.equal(pdfScale(cover).confidence, "none", "cover page: no scale");
    await doc.loadingTask.destroy();
  }

  // ------------------------------------------------------------ a dimension printed wrong, and an override
  {
    const doc = await open("plan-filled.pdf");
    const vp = await extractVectorPage(pdfjs, await doc.getPage(1));
    const wrong = vp.texts.findIndex((x) => x.str === "4000 mm" && x.rotation === 0);
    vp.texts[wrong] = { ...vp.texts[wrong], str: "4100 mm" }; // injected: a 4 m line labelled 4100 mm
    const s = pdfScale(vp);
    assert.equal(s.confidence, "good", "one wrong label among 11 still agrees within 5%");
    const rows = dimensionRows(s.matches, s.mPerPt!);
    const i = rows.findIndex((r) => r.text === "4100 mm");
    assert.equal(rows[i].status, "flagged", "the wrong dimension is flagged");
    assert.ok(near(rows[i].diffMm, -100, 3), `about -100 mm off: ${rows[i].diffMm}`);
    assert.equal(rows.filter((r) => r.status === "flagged").length, 1, "only that row");
    const over = dimensionRows(s.matches, s.mPerPt!, { [i]: { valueM: 4.0, note: "Drafting error, 4 m on site" } });
    assert.equal(over[i].status, "overridden", "overridden");
    assert.equal(over[i].measuredM, rows[i].measuredM, "the measured value is kept");
    assert.equal(over[i].printedM, 4.1, "the printed value is kept");
    assert.deepEqual(over[i].override, { valueM: 4.0, note: "Drafting error, 4 m on site" }, "the typed value and note are kept beside it");
    const csv = rowsToCsv(over);
    const line = csv.split("\n").find((l) => l.startsWith("4100 mm"))!;
    assert.ok(line.endsWith(`,Overridden,4000.0,"Drafting error, 4 m on site"`), `CSV keeps both: ${line}`);
    assert.ok(line.includes(`,${(rows[i].measuredM * 1000).toFixed(1)},`), "CSV has the measured value");
    assert.ok(rowsToCsv([{ ...over[0], text: `12'-6"` }]).includes(`\n"12'-6""",`), "CSV quotes inch marks");
    console.log(`injected 4100 mm: flagged (${rows[i].diffMm.toFixed(1)} mm), overridden to 4000 mm with the measured ${formatMm(rows[i].measuredM)} kept`);
    await doc.loadingTask.destroy();
  }
  assert.equal(formatFeetInches(12.5 * 0.3048), `12' 6"`);
  assert.equal(formatFeetInches(0.0254 / 16), `1/16"`);
  assert.equal(formatFeetInches(3.0 * 0.0254 + (3 / 16) * 0.0254), `3 3/16"`);
  assert.equal(formatFeetInches(-0.0254 / 8, true), `−1/8"`);
  assert.equal(formatFeetInches(0), `0"`);
  console.log("feet and inches to 1/16\"");

  // ------------------------------------------------------------ limits and broken files
  assert.equal(await plainError(openNode(new Uint8Array(MAX_PDF_BYTES + 1))), PDF_MESSAGES.tooBig(MAX_PDF_BYTES + 1), "over 50 MB");
  assert.equal(await plainError(openNode(new Uint8Array(0))), PDF_MESSAGES.empty, "empty file");
  assert.equal(await plainError(openNode(new TextEncoder().encode("%PDF-1.7\nthis is not really a pdf\n%%EOF"))), PDF_MESSAGES.damaged, "garbage");
  assert.equal(await plainError(openNode(bytes("plan-filled.pdf").slice(0, 400))), PDF_MESSAGES.damaged, "cut short");
  assert.equal(await plainError(openNode(encryptedPdf())), PDF_MESSAGES.password, "encrypted");
  {
    // pdf.js shows an empty page tree as one blank page, which is refused when read.
    const none = await openNode(await (await PDFDocument.create()).save());
    assert.equal(await plainError(analysePdfPage(pdfjs, await none.getPage(1), { pageCount: 1, render: renderNode })), PDF_MESSAGES.blank, "no pages: a blank page");
    await none.loadingTask.destroy();
  }
  {
    const doc = await open("plan-filled.pdf");
    assert.equal(await plainError(extractVectorPage(pdfjs, await doc.getPage(1), { maxPathOps: 100 })), tooManyOps(100), "too many path commands");
    await doc.loadingTask.destroy();
  }
  console.log("limits: 50 MB, path commands; empty, damaged, cut short, encrypted, no pages: plain messages");

  // ------------------------------------------------------------ routes and room names
  {
    const doc = await open("plan-scanned.pdf");
    const noOcr = async (): Promise<OcrResult> => ({ labels: [], words: [], error: null, rereads: [] }); // tesseract is not run offline
    const { analysis, pdf } = await analysePdfPage(pdfjs, await doc.getPage(1), { pageCount: 1, render: renderNode, ocr: noOcr });
    assert.equal(pdf.route, "raster", "scanned: raster route");
    assert.equal(pdf.pxPerPt, 300 / 72, "scanned: 300 dpi");
    assert.deepEqual(pdf.notes, ["Scanned PDF: measurements are approximate."]);
    assert.ok(analysis.imageScale < 1, "scanned: the 300 dpi page is larger than the pipeline's 2400 px, so it is downscaled as any image");
    console.log(`plan-scanned.pdf: raster route at 300 dpi, ${analysis.walls.length} wall pieces, ${analysis.openings.length} openings, scale ${analysis.scale.confidence} (no OCR offline)`);
    await doc.loadingTask.destroy();
  }
  const sampleNames = samplePlan.rooms.map((r) => titleCase(r.name)).sort();
  const sampleTotal = samplePlan.walls.reduce((s, w) => s + wallLength(w), 0);
  for (const file of ["plan-filled.pdf", "plan-rotated.pdf"]) {
    const doc = await open(file);
    const { analysis, pdf } = await analysePdfPage(pdfjs, await doc.getPage(1), { pageCount: 1, render: renderNode });
    assert.equal(pdf.route, "vector");
    // M.1b replaced M.1a's "exact snapping arrives in the next step" with the line below.
    assert.ok(pdf.traceMm !== null && pdf.notes.includes(`Walls are read exactly from the PDF's lines; any the lines don't explain are traced at about ${Math.round(pdf.traceMm)} mm.`), "trace note");
    assert.equal(analysis.angleDeg, 0, "vector pages are not straightened");
    assert.equal(analysis.imageScale, 1, "the raster is never downscaled");
    const { plan } = buildFromAnalysis(analysis, { pxPerM: analysis.scale.pxPerM!, source: "pdf" });
    assert.deepEqual(plan.rooms.map((r) => r.name).sort(), sampleNames, `${file}: room names from the PDF text`);
    const total = plan.walls.reduce((s, w) => s + wallLength(w), 0);
    // Each wall end is traced to about a pixel; allow two pixels per wall end.
    const tol = (plan.walls.length * 2 * 2 * pdf.traceMm!) / 1000;
    assert.ok(near(total, sampleTotal, tol), `${file}: total wall length ${total.toFixed(3)} m vs ${sampleTotal} m ±${tol.toFixed(3)}`);
    console.log(`${file}: rooms ${plan.rooms.map((r) => r.name).join(", ")}; ${plan.walls.length} walls, ${total.toFixed(2)} m (truth ${sampleTotal} m); traced at about ${pdf.traceMm!.toFixed(1)} mm`);
    await doc.loadingTask.destroy();
  }
  console.log("OK");
}

/** A tiny PDF whose /Encrypt dictionary needs a user password (its /U matches no empty password). */
function encryptedPdf(): Uint8Array {
  const hex = (n: number, seed: number) => Array.from({ length: n }, (_, i) => ((i * 37 + seed) & 255).toString(16).padStart(2, "0")).join("");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>",
    `<< /Filter /Standard /V 1 /R 2 /O <${hex(32, 1)}> /U <${hex(32, 2)}> /P -4 >>`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Encrypt 4 0 R /ID [<${hex(16, 3)}> <${hex(16, 3)}>] >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
