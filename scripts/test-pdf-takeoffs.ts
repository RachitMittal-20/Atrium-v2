/**
 * test-pdf-takeoffs.ts — step M.2b: the PDF's printed dimensions carried into the plan as
 * takeoffs with source "pdf" (src/lib/pdf/takeoffs.ts), and what a recalibration does to them.
 * Reads tests/fixtures/pdf/ through scripts/pdf-node.ts, as the other PDF tests do.
 *
 *   - plan-filled: one row per printed dimension (11), every one a length with source "pdf",
 *     reference = the printed value with the printed text as its note, and every status OK —
 *     the rows measure the built model and the model agrees with the drawing;
 *   - the basis says where each row stands: "PDF exact" on walls read from the PDF, and
 *     "Traced approximate" (so the panel says "approximate") on plan-single-line's traced wall;
 *   - a misprinted dimension (4100 mm on a 4 m line) arrives Flagged, and an override typed on
 *     the review screen is carried with its note and kept BESIDE the measured value;
 *   - a calibration of 1.01 turns every row Flagged (the printed numbers no longer match the
 *     new scale) and calibrating back by 1/1.01 restores every OK;
 *   - the CSV's last column is the source ("pdf" for these rows);
 *   - the autosave round trip keeps every field, and its size is reported;
 *   - a plan written before M.2b (no source, no calibrations) loads unchanged.
 * Run: npx tsx scripts/test-pdf-takeoffs.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analysePdfPage } from "../src/lib/pdf/analysePdf";
import { modelRows, type Overrides } from "../src/lib/pdf/dimensions";
import { buildPdfPlan } from "../src/lib/pdf/snap";
import { approximateIndexes, MAX_PDF_TAKEOFFS, pdfTakeoffs } from "../src/lib/pdf/takeoffs";
import { parseStoredPlan, serializePlan } from "../src/lib/persist/planStorage";
import { scalePlan } from "../src/lib/plan/calibrate";
import { tableCells, takeoffRow, toCsv, wallsHash } from "../src/lib/takeoff/rows";
import { usePlanStore } from "../src/store/planStore";
import type { Plan, Takeoff } from "../src/types/plan";
import { misprintedPdf, type Truth } from "./make-pdf-fixtures";
import { openNode, pdfjs, renderNode } from "./pdf-node";

const DIR = join(process.cwd(), "tests/fixtures/pdf");
const truths: Truth[] = JSON.parse(readFileSync(join(DIR, "truth.json"), "utf8"));
const noOcr = async () => ({ words: [], lines: [], confidence: 0 });

/** The built plan for a fixture, with the PDF's dimensions carried in as the import screen does. */
async function build(file: string, bytes?: Uint8Array, overrides: Overrides = {}) {
  const t = truths.find((x) => x.file === file)!;
  const doc = await openNode(bytes ?? new Uint8Array(readFileSync(join(DIR, file))));
  const out = await analysePdfPage(pdfjs, await doc.getPage(t.planPage), { pageCount: doc.numPages, render: renderNode, ocr: noOcr as never });
  await doc.loadingTask.destroy();
  const scale = { pxPerM: out.analysis.scale.pxPerM!, source: "pdf" as const };
  const b = buildPdfPlan(out.analysis, out.pdf, scale);
  const c = b.coverage;
  const matches = out.pdf.scale!.matches;
  const hash = wallsHash(b.plan.walls);
  const toPlan = (x: number, y: number) => ({ x: x * c.mPerPt - c.origin.x, y: y * c.mPerPt - c.origin.y });
  const approximate = approximateIndexes(modelRows(matches, b.plan, toPlan, (3 * c.traceMm) / 1000));
  const takeoffs: Takeoff[] = pdfTakeoffs(matches, toPlan, overrides, approximate).map((k, i) => ({ ...k, id: `tp-${i + 1}`, wallsHash: hash }));
  return { plan: { ...b.plan, takeoffs } as Plan, matches, mPerPt: c.mPerPt, t };
}

const rowsOf = (plan: Plan) => (plan.takeoffs ?? []).map((k) => takeoffRow(plan, k));

async function main() {
  // ---------------------------------------------------------------- plan-filled: every row carried and OK
  const { plan, matches, t } = await build("plan-filled.pdf");
  assert.equal(plan.takeoffs!.length, t.dims.length, `one takeoff per printed dimension (${t.dims.length})`);
  assert.equal(plan.takeoffs!.length, matches.length, "and one per matched dimension");
  assert.ok(plan.takeoffs!.every((k) => k.source === "pdf" && k.kind === "length" && k.points.length === 2), "each one a length from the PDF with two points");
  for (const k of plan.takeoffs!) {
    const m = matches.find((x) => x.text === k.reference!.note)!;
    assert.ok(m, `${k.name}: its reference note is the text as printed`);
    assert.equal(k.reference!.value, m.metres, `${k.name}: the reference is the printed value`);
  }
  const rows = rowsOf(plan);
  const flagged = rows.filter((r) => r.status === "flagged");
  assert.deepEqual(flagged.map((r) => `${r.takeoff.name} ${(r.difference! * 1000).toFixed(1)} mm`), [], "every row OK");
  const worst = Math.max(...rows.map((r) => Math.abs(r.difference!)));
  assert.ok(rows.every((r) => r.basis === "PDF exact"), `every row stands on walls read from the PDF (${[...new Set(rows.map((r) => r.basis))].join(", ")})`);
  console.log(`plan-filled: ${rows.length} printed dimensions carried, all OK (worst ${(worst * 1000).toFixed(3)} mm), basis "PDF exact"`);

  // ---------------------------------------------------------------- a traced wall makes its row approximate
  {
    const single = await build("plan-single-line.pdf");
    const kinds = new Set(rowsOf(single.plan).map((r) => r.basis));
    assert.ok(kinds.has("Traced approximate"), `a row across the traced wall says approximate (bases: ${[...kinds].join(", ")})`);
    console.log(`plan-single-line: bases ${[...kinds].join(", ")} — the rows on the traced wall are approximate`);
  }

  // ---------------------------------------------------------------- a misprint, and an override beside the measured value
  {
    const bytes = await misprintedPdf();
    const over: Overrides = {};
    const first = await build("plan-filled.pdf", bytes);
    const bad = rowsOf(first.plan).find((r) => r.status === "flagged");
    assert.ok(bad, "the misprinted dimension arrives Flagged");
    assert.ok(Math.abs(bad.difference!) > 0.05, `by about 100 mm (${(bad.difference! * 1000).toFixed(1)} mm)`);
    // The same row overridden on the review screen, with a note, as the import page passes them.
    const i = first.matches.findIndex((m) => m.text === bad.takeoff.reference!.note);
    over[i] = { valueM: bad.measured!, note: "measured on site" };
    const again = await build("plan-filled.pdf", bytes, over);
    const row = rowsOf(again.plan).find((r) => r.takeoff.reference!.note === bad.takeoff.reference!.note)!;
    assert.equal(row.takeoff.override!.value, bad.measured, "the override is carried over");
    assert.equal(row.takeoff.override!.note, "measured on site", "with its note");
    assert.equal(row.status, "flagged", "and it does NOT replace the measured value: the status still compares that");
    assert.equal(row.effective, row.takeoff.override!.value, "the effective value is the override");
    assert.ok(Math.abs(row.measured! - bad.measured!) < 1e-9, "the measured value is kept beside it");
    console.log(`misprint: "${bad.takeoff.name}" Flagged by ${(bad.difference! * 1000).toFixed(1)} mm; the override is kept beside the measured value and the status still flags`);
  }

  // ---------------------------------------------------------------- a calibration flags every row, and back again
  {
    const f = 1.01;
    const up = scalePlan(plan, f);
    const upRows = rowsOf(up);
    assert.ok(
      upRows.every((r) => r.status === "flagged"),
      `a 1% recalibration flags every row (${upRows.filter((r) => r.status === "flagged").length}/${upRows.length})`,
    );
    for (const r of upRows) {
      const was = rows.find((x) => x.takeoff.id === r.takeoff.id)!;
      assert.ok(Math.abs(r.measured! - was.measured! * f) < 1e-9, `${r.takeoff.name}: measured × f`);
      assert.equal(r.takeoff.reference!.value, was.takeoff.reference!.value, `${r.takeoff.name}: the printed value is untouched`);
    }
    const back = rowsOf(scalePlan(up, 1 / f));
    assert.ok(back.every((r) => r.status === "ok"), "calibrating back restores every OK");
    console.log(`calibration: ×${f} flags all ${upRows.length} rows (the printed values are untouched); ×${(1 / f).toFixed(6)} restores every OK`);
  }

  // ---------------------------------------------------------------- the CSV's source column
  {
    const cells = tableCells(rows, { length: "mm", area: "m2" });
    assert.equal(cells[0][cells[0].length - 1], "source", "the last column is the source");
    assert.ok(cells.slice(1).every((r) => r[r.length - 1] === "pdf"), "every carried row says pdf");
    assert.ok(toCsv(cells).includes(",pdf\r\n"), "and so does the CSV text");
    console.log(`CSV: ${cells[0].length} columns, the last "source", every carried row "pdf"`);
  }

  // ---------------------------------------------------------------- the autosave round trip, and its size
  {
    const text = serializePlan(plan, new Date("2026-10-13T00:00:00.000Z"));
    const back = parseStoredPlan(text)!;
    assert.ok(back, "the plan round-trips");
    assert.deepEqual(back.takeoffs, plan.takeoffs, "every carried takeoff survives, source and all");
    const bare = serializePlan({ ...plan, takeoffs: [] }, new Date("2026-10-13T00:00:00.000Z"));
    console.log(`autosave: ${(text.length / 1024).toFixed(1)} kB with ${plan.takeoffs!.length} PDF rows, ${(bare.length / 1024).toFixed(1)} kB without (${((text.length - bare.length) / plan.takeoffs!.length).toFixed(0)} bytes a row); cap ${MAX_PDF_TAKEOFFS} rows`);
  }

  // ---------------------------------------------------------------- an old plan loads unchanged
  {
    const old = JSON.parse(serializePlan(plan));
    for (const k of old.plan.takeoffs) delete k.source;
    delete old.plan.calibrations;
    const loaded = parseStoredPlan(JSON.stringify(old))!;
    assert.ok(loaded.takeoffs!.every((k) => k.source === undefined), "a plan from before M.2b has no sources");
    assert.equal(loaded.calibrations, undefined, "and no calibrations");
    assert.equal(rowsOf(loaded).every((r) => r.basis === "Free points"), true, "and its rows read as hand-measured ones, on no wall");
    usePlanStore.getState().loadPlan(loaded);
    assert.equal(usePlanStore.getState().plan.takeoffs!.length, plan.takeoffs!.length, "the store loads it");
    console.log("old plan: no source, no calibrations, loads unchanged");
  }

  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
