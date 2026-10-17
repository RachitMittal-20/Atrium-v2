/**
 * test-pdf-verdict.ts — step H.1: the review screen must never describe a broken reading as "exact".
 * A real run said "52 of 52 walls read exactly from the PDF (100%)" beside 38 free wall ends, 17
 * detached groups, 23 gaps not read, 12 windows rejected and a model whose one room was made of
 * disconnected blocks. `planVerdict` (src/lib/pdf/verdict.ts) judges the BUILT plan: Good, Check or
 * Not usable, with its reasons. Checked here:
 *   1. The rules at their boundaries, on the sample plan with walls added (so every number is exact).
 *   2. plan-strips.pdf, six disconnected wall strips: Not usable, in both the build the review shows
 *      and the PDF's-walls-alone build (rule 8b, every wall "exact" and 12 free ends), whose old line
 *      read "6 of 6 walls read exactly from the PDF (100% of wall length)". FAILING FIRST: written
 *      before verdict.ts existed.
 *   3. The wording: the exactness line says "match lines in the PDF", never "exactly", and carries the
 *      verdict whenever it is not Good.
 *   4. Every fixture's verdict, recorded below. None may be Not usable unless it has no closed room.
 * Run: npx tsx scripts/test-pdf-verdict.ts
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { coverageCaveat, coverageLine } from "../src/app/studio/import/PdfPanels";
import { samplePlan } from "../src/data/samplePlan";
import { buildPlan } from "../src/lib/blueprint/toPlan";
import { analysePdfPage } from "../src/lib/pdf/analysePdf";
import { buildPdfPlan, mergeVector } from "../src/lib/pdf/snap";
import { RULES, planVerdict, verdictText, type Verdict } from "../src/lib/pdf/verdict";
import { wallLength } from "../src/lib/plan/geometry";
import { deriveRooms } from "../src/lib/plan/rooms";
import type { Plan, Wall } from "../src/types/plan";
import { openNode, pdfjs, renderNode } from "./pdf-node";
import { DIR, truth } from "./test-pdf-conventions";

const none = { detached: [], conflicts: [], refused: 0 };
const total = (ws: Wall[]) => ws.reduce((s, w) => s + wallLength(w), 0);
const wallAt = (id: string, a: [number, number], b: [number, number]): Wall => ({ id, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness: 0.1, height: 2.7 });
const withWalls = (...extra: Wall[]): Plan => ({ ...samplePlan, walls: [...samplePlan.walls, ...extra] });
/** `n` nibs: short walls from the sample's corner A (0, 0), each with a free far end (the near end is shared). */
const nibs = (n: number) => Array.from({ length: n }, (_, i) => wallAt(`nib${i}`, [0, 0], [-0.5, -0.3 - 0.1 * i]));
/** A wall nowhere near the building, `len` metres long. */
const island = (len: number) => wallAt("island", [100, 100], [100 + len, 100]);

function boundaries() {
  const level = (v: Verdict) => v.level;
  // The sample plan is the reference "Good": one building, closed rooms, nothing free.
  const sample = planVerdict(samplePlan, none);
  assert.equal(sample.level, "good", `the sample plan: ${verdictText(sample)}`);
  assert.equal(sample.facts.pieces, 1);
  assert.ok(sample.facts.rooms >= 1 && sample.facts.freeEnds === 0);

  // Free ends: at most 2 is Good, 3 to 10 is Check, over 10 is Not usable.
  assert.deepEqual([0, 1, 2, 3, 10, 11].map((n) => level(planVerdict(withWalls(...nibs(n)), none))), ["good", "good", "good", "check", "check", "unusable"], "free ends 0, 1, 2 | 3, 10 | 11");
  assert.equal(planVerdict(withWalls(...nibs(11)), none).facts.freeEnds, 11);

  // The largest connected group's share of wall length: under 70% is Not usable, 70% and over is Check.
  const L = total(samplePlan.walls);
  const share = (s: number) => planVerdict(withWalls(island((L * (1 - s)) / s)), none); // the island makes the building s of the total
  assert.ok(Math.abs(share(0.7).facts.share - 0.7) < 1e-9);
  assert.equal(share(0.71).level, "check", "71% in the largest group: Check, in two pieces");
  assert.equal(share(0.71).facts.pieces, 2);
  assert.equal(share(0.69).level, "unusable", "69% in the largest group: Not usable");
  assert.equal(share(0.9999).level, "check", "a tiny island is a Check");

  // No closed room is Not usable, whatever else is true.
  const lone: Plan = { ...samplePlan, walls: [wallAt("only", [0, 0], [5, 0])], openings: [] };
  const v0 = planVerdict(lone, none);
  assert.equal(v0.level, "unusable");
  assert.equal(v0.facts.rooms, 0);
  assert.match(verdictText(v0), /no closed room/, verdictText(v0));

  // Openings the PDF drew and the plan lacks, and kept detached groups, are a Check; a detached
  // group left out on evidence (a title block) is not a reason at all.
  const conflict = { kind: "window" as const, a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, width: 1, thickness: 0.2, why: "a wall ending inside it" };
  assert.equal(planVerdict(samplePlan, { ...none, conflicts: [conflict] }).level, "check");
  assert.equal(planVerdict(samplePlan, { ...none, refused: 1 }).level, "check");
  assert.equal(planVerdict(samplePlan, { ...none, refused: 1, conflicts: [conflict, conflict] }).facts.rejected, 3, "refused and conflicts are added");
  const det = (dropped: boolean) => ({ walls: 4, min: { x: 0, y: 0 }, max: { x: 1, y: 1 }, size: { w: 1, d: 1 }, dropped, why: "x" });
  assert.equal(planVerdict(samplePlan, { ...none, detached: [det(true)] }).level, "good", "a group left out on evidence changes nothing");
  assert.equal(planVerdict(samplePlan, { ...none, detached: [det(false)] }).level, "check", "a kept detached group is a Check");

  // The text names every reason, in plain words.
  const bad = planVerdict(withWalls(...nibs(12), island(L)), none);
  assert.equal(bad.level, "unusable");
  assert.match(verdictText(bad), /^Not usable: the walls form 2 separate pieces \(the largest holds 55% of the wall length\) and 14 free wall ends\.$/, verdictText(bad));
  assert.match(verdictText(sample), /^Good: /);
  assert.equal(RULES.minLargestShare, 0.7);
  console.log("1. rules: free ends 2|3 and 10|11, share 70%, no room, rejected openings and kept detached groups, and the wording");
}

/** analysePdfPage + buildPdfPlan as the import page does; also the PDF's walls alone (rule 8b's keepAll). */
async function buildAny(file: string) {
  const doc = await openNode(new Uint8Array(readFileSync(join(DIR, file))));
  const planPage = truth(file)?.planPage ?? 1;
  const out = await analysePdfPage(pdfjs, await doc.getPage(planPage), { pageCount: doc.numPages, render: renderNode, ocr: async () => ({ labels: [], words: [], error: null, rereads: [] }) });
  await doc.loadingTask.destroy();
  if (!out.pdf.vectorWalls || !out.analysis.scale.pxPerM) return { out, built: null };
  const scale = { pxPerM: out.analysis.scale.pxPerM, source: "pdf" as const };
  return { out, scale, built: buildPdfPlan(out.analysis, out.pdf, scale) };
}

async function strips() {
  const file = "plan-strips.pdf";
  const { out, scale, built } = await buildAny(file);
  assert.ok(built && scale, `${file} builds`);
  const v = planVerdict(built.plan, built.coverage);
  assert.equal(v.level, "unusable", `${file}: ${verdictText(v)}`);
  assert.equal(v.facts.rooms, 0);
  assert.ok(v.facts.pieces >= 2 && v.facts.freeEnds > RULES.maxFreeEndsUsable, `${file}: ${JSON.stringify(v.facts)}`);
  assert.match(verdictText(v), /^Not usable: the walls form \d+ separate pieces/, verdictText(v));

  // The PDF's walls alone, as rule 8b builds them: every wall "exact", 100% of the length.
  const { analysis, pdf } = out;
  const traced = buildPlan({ walls: analysis.walls, openings: analysis.openings, unpaired: analysis.unpaired, imageSize: analysis.pixels, name: "x" }, scale);
  const alone = mergeVector({ plan: { ...traced.plan, walls: [], openings: [] }, report: { ...traced.report, problems: [] } }, pdf.vectorWalls!, { pxPerM: scale.pxPerM, pxPerPt: pdf.pxPerPt, rasterOrigin: pdf.rasterOrigin, labels: analysis.labels, forceTraced: [], keepAll: true });
  const c = alone.coverage;
  assert.ok(c.exact === c.walls && c.walls === 6 && c.traced === 0, `${file} alone: ${c.exact} of ${c.walls} exact`);
  const va = planVerdict(alone.plan, c);
  assert.equal(va.level, "unusable", `${file} alone: ${verdictText(va)}`);
  assert.equal(va.facts.pieces, 6, "six strips, six pieces");
  assert.equal(deriveRooms(alone.plan).length, 0);
  assert.equal(va.facts.freeEnds, 12);
  assert.equal(verdictText(va), "Not usable: the walls form 6 separate pieces (the largest holds 17% of the wall length), 12 free wall ends and no closed room.");

  // The wording: never "exactly", and never alone when the verdict is not Good.
  const line = coverageLine(c);
  assert.equal(line, "6 walls match lines in the PDF (100% of wall length); 0 walls are traced approximately (about 12 mm).");
  assert.ok(!/exact/i.test(line), line);
  assert.match(coverageCaveat(va), /Not usable/, "the caveat carries the verdict");
  const good = planVerdict(samplePlan, none);
  assert.equal(coverageCaveat(good), "", "a Good verdict adds nothing");
  assert.match(coverageCaveat(planVerdict(samplePlan, { ...none, refused: 1 })), /Check/);
  console.log(`2. ${file}: ${verdictText(v)} | PDF walls alone: ${verdictText(va)}`);
}

/**
 * The verdict recorded for every fixture. "-" is a page with no vector walls or no scale in THIS Node harness
 * (nothing to judge): plan-outlined needs OCR for its text, plan-scanned is a picture. Check: plan-outbuilding
 * (a separate 4 × 3 m shed, two pieces), plan-stem-in-window (an opening a wall ends inside, not read) and
 * plan-chatgpt-poche (free ends and opening conflicts, its known discrepancies). Not usable: only plan-strips.
 */
const EXPECTED: Record<string, string> = {
  "plan-against-wall.pdf": "good",
  "plan-bare-mm.pdf": "good",
  "plan-broken-dims.pdf": "good",
  "plan-centre-lines.pdf": "good",
  "plan-chatgpt-flat.pdf": "good",
  "plan-chatgpt-poche.pdf": "check",
  "plan-clutter.pdf": "good",
  "plan-dims-chain.pdf": "good",
  "plan-dims-close.pdf": "good",
  "plan-dims-one-wrong.pdf": "good",
  "plan-doors-rect.pdf": "good",
  "plan-doors.pdf": "good",
  "plan-filled.pdf": "good",
  "plan-finish-line.pdf": "good",
  "plan-fit.pdf": "good",
  "plan-free-end.pdf": "good",
  "plan-furniture.pdf": "good",
  "plan-gaps.pdf": "good",
  "plan-imperial.pdf": "good",
  "plan-levels.pdf": "good",
  "plan-lines.pdf": "good",
  "plan-no-dims.pdf": "good",
  "plan-outbuilding.pdf": "check",
  "plan-outlined.pdf": "-",
  "plan-poche-diagonal.pdf": "good",
  "plan-poche-hatch.pdf": "good",
  "plan-poche-mask.pdf": "good",
  "plan-rotated.pdf": "good",
  "plan-scanned.pdf": "-",
  "plan-single-line.pdf": "good",
  "plan-small-on-big.pdf": "good",
  "plan-stem-in-window.pdf": "check",
  "plan-strike-jamb.pdf": "good",
  "plan-strips.pdf": "unusable",
  "plan-title-block.pdf": "good",
  "plan-two-pages.pdf": "good",
  "plan-window-board.pdf": "good",
  "plan-window-sill.pdf": "good",
};

async function fixtures() {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".pdf")).sort();
  const got: Record<string, string> = {};
  for (const f of files) {
    const { built } = await buildAny(f);
    if (!built) {
      got[f] = "-";
      continue;
    }
    const v = planVerdict(built.plan, built.coverage);
    got[f] = v.level;
    if (v.level === "unusable" && f !== "plan-strips.pdf") assert.equal(v.facts.rooms, 0, `${f}: Not usable only if it has no closed room (${verdictText(v)})`);
    console.log(`   ${f}: ${verdictText(v)}`);
  }
  if (process.env.PRINT_VERDICTS) console.log(JSON.stringify(got, null, 1));
  assert.deepEqual(got, EXPECTED, "every fixture's recorded verdict");
  console.log(`4. ${files.length} fixtures: ${Object.values(got).filter((x) => x === "good").length} Good, ${Object.values(got).filter((x) => x === "check").length} Check, ${Object.values(got).filter((x) => x === "unusable").length} Not usable, ${Object.values(got).filter((x) => x === "-").length} with nothing to judge`);
}

async function main() {
  boundaries();
  await strips();
  await fixtures();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
