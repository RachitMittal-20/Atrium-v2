/**
 * test-import-warnings.ts — step R.2: the picture-tracing warnings (hollow walls, low confidence)
 * belong to the tracing, so the review screen shows them only when the tracing result is used.
 * A vector read whose walls came entirely from the PDF (Coverage.pdfOnly) shows neither; a merged
 * vector read that kept traced walls, and an image, still do. Also pins the "Choose a scale first"
 * replacement text in the import page. Written failing first (no src/lib/pdf/warnings.ts, old text).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analysePdfPage } from "../src/lib/pdf/analysePdf";
import { buildPdfPlan } from "../src/lib/pdf/snap";
import { shownWarnings } from "../src/lib/pdf/warnings";
import type { AnalysisWarning } from "../src/lib/blueprint/analyse";
import { openNode, pdfjs, renderNode } from "./pdf-node";

const DIR = join(__dirname, "../tests/fixtures/pdf");
const w = (code: AnalysisWarning["code"]): AnalysisWarning => ({ code, message: code });
const all = [w("rotated"), w("hollow-mode"), w("low-confidence"), w("no-scale"), w("check-scale"), w("ocr-failed")];
const codes = (xs: AnalysisWarning[]) => xs.map((x) => x.code);

async function build(file: string) {
  const doc = await openNode(new Uint8Array(readFileSync(join(DIR, file))));
  const r = await analysePdfPage(pdfjs, await doc.getPage(1), { pageCount: 1, render: renderNode, ocr: async () => ({ labels: [], words: [], error: null, rereads: [] }) });
  await doc.loadingTask.destroy();
  return buildPdfPlan(r.analysis, r.pdf, { pxPerM: r.analysis.scale.pxPerM!, source: "pdf" }).coverage;
}

async function main() {
  const pdfOnly = await build("plan-chatgpt-flat.pdf");
  assert.ok(pdfOnly.pdfOnly, "plan-chatgpt-flat is read entirely from the PDF");
  assert.deepEqual(codes(shownWarnings(all, pdfOnly)), ["rotated", "no-scale", "check-scale", "ocr-failed"], "vector-only: no hollow or low-confidence note");

  const merged = await build("plan-traced-wall.pdf");
  assert.ok(!merged.pdfOnly && merged.traced >= 1, "plan-traced-wall keeps a traced wall");
  assert.deepEqual(codes(shownWarnings(all, merged)), codes(all), "a tracing-based vector read still shows every warning");

  assert.deepEqual(codes(shownWarnings(all, undefined)), codes(all), "an image (no coverage) still shows every warning");

  const page = readFileSync(join(__dirname, "../src/app/studio/import/page.tsx"), "utf8");
  assert.ok(page.includes("Press Use this scale (or set it yourself) to continue."), "new scale hint");
  assert.ok(!page.includes("Choose a scale first."), "old scale hint gone");
  assert.ok(page.includes("shownWarnings("), "the page filters its warnings through shownWarnings");
  console.log("test-import-warnings: ok");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
