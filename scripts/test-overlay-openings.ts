/**
 * test-overlay-openings.ts — step R.3: the review overlay's door and window bars must agree with the
 * built model. For plan-chatgpt-flat.pdf and plan-filled.pdf every bar lies along its wall (angle within
 * 0.01°), is as long as the opening is wide (1 mm) and as thick as its wall (1 mm).
 *
 * Written failing first: `violations` run on the OLD source (the tracing's analysis.openings, which is
 * what PlanViewer drew) finds tilted, over-long and over-thick boxes on plan-chatgpt-flat; that
 * control stays in the test so the bug cannot come back unnoticed. Then the same checks on openingBars.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analysePdfPage } from "../src/lib/pdf/analysePdf";
import { drawnFromPlan, openingBars, type OpeningBar } from "../src/lib/pdf/overlay";
import { buildPdfPlan, planToPixels } from "../src/lib/pdf/snap";
import type { Plan } from "../src/types/plan";
import { openNode, pdfjs, renderNode } from "./pdf-node";

const DIR = join(__dirname, "../tests/fixtures/pdf");
const MM = 0.001;

/** Bars that break the three rules against the plan's openings, matched by wall (bars) in plan order. */
export function violations(bars: { a: { x: number; y: number }; b: { x: number; y: number }; thickness: number }[], plan: Plan, pxPerM: number, px: (p: { x: number; y: number }) => { x: number; y: number }) {
  const out: string[] = [];
  if (bars.length !== plan.openings.length) out.push(`${bars.length} bars for ${plan.openings.length} openings`);
  plan.openings.forEach((o, i) => {
    const bar = bars[i];
    const w = plan.walls.find((x) => x.id === o.wallId)!;
    if (!bar) return;
    const wa = px(w.a);
    const wb = px(w.b);
    let d = Math.abs(Math.atan2(bar.b.y - bar.a.y, bar.b.x - bar.a.x) - Math.atan2(wb.y - wa.y, wb.x - wa.x)) * (180 / Math.PI);
    d = d % 180;
    d = Math.min(d, 180 - d);
    const len = Math.hypot(bar.b.x - bar.a.x, bar.b.y - bar.a.y) / pxPerM;
    if (d > 0.01) out.push(`${o.id}: ${d.toFixed(2)}° off its wall`);
    if (Math.abs(len - o.width) > MM) out.push(`${o.id}: ${(len * 1000).toFixed(0)} mm long, opening is ${(o.width * 1000).toFixed(0)} mm`);
    if (Math.abs(bar.thickness / pxPerM - w.thickness) > MM) out.push(`${o.id}: ${((bar.thickness / pxPerM) * 1000).toFixed(0)} mm thick, wall is ${(w.thickness * 1000).toFixed(0)} mm`);
  });
  return out;
}

async function main() {
  for (const file of ["plan-chatgpt-flat.pdf", "plan-filled.pdf"]) {
    const doc = await openNode(new Uint8Array(readFileSync(join(DIR, file))));
    const r = await analysePdfPage(pdfjs, await doc.getPage(1), { pageCount: 1, render: renderNode, ocr: async () => ({ labels: [], words: [], error: null, rereads: [] }) });
    await doc.loadingTask.destroy();
    const pxPerM = r.analysis.scale.pxPerM!;
    const b = buildPdfPlan(r.analysis, r.pdf, { pxPerM, source: "pdf" });
    const px = planToPixels(b.coverage, pxPerM, r.pdf.rasterOrigin);
    assert.ok(drawnFromPlan(b.coverage), `${file}: nothing in the build is traced, so the overlay draws the plan's openings`);

    // The control: what the overlay drew before R.3 (the tracing's openings), matched to the plan's by position.
    const old = r.analysis.openings.map((o) => ({ a: o.a, b: o.b, thickness: o.wallThicknessPx * 1.2 }));
    const oldBad = violations(old, b.plan, pxPerM, px);
    if (file === "plan-chatgpt-flat.pdf") assert.ok(oldBad.length > 0, "control: the tracing's boxes break the rules on plan-chatgpt-flat");

    const bars: OpeningBar[] = openingBars(b.plan, pxPerM, px);
    const bad = violations(bars, b.plan, pxPerM, px);
    assert.deepEqual(bad, [], `${file}: every overlay box matches its opening and wall:\n  ${bad.join("\n  ")}`);
    assert.equal(bars.length, b.plan.openings.length, `${file}: one box per opening`);
    console.log(`${file}: ${bars.length} boxes, all along their walls, widths and thicknesses within 1 mm (the tracing's ${old.length} boxes: ${oldBad.length} violations)`);
  }

  // A merge that kept a traced wall keeps today's behaviour: the traced openings are drawn.
  {
    const doc = await openNode(new Uint8Array(readFileSync(join(DIR, "plan-traced-wall.pdf"))));
    const r = await analysePdfPage(pdfjs, await doc.getPage(1), { pageCount: 1, render: renderNode, ocr: async () => ({ labels: [], words: [], error: null, rereads: [] }) });
    await doc.loadingTask.destroy();
    const c = buildPdfPlan(r.analysis, r.pdf, { pxPerM: r.analysis.scale.pxPerM!, source: "pdf" }).coverage;
    assert.ok(!drawnFromPlan(c), "plan-traced-wall keeps a traced wall: the overlay still draws the tracing");
  }
  console.log("test-overlay-openings: ok");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
