/**
 * test-pdf-q4.ts — step Q.4a: four small fixes from a real-file diagnosis, each a general drawing
 * convention proven failing-first on its own SYNTHETIC fixture (scripts/make-pdf-fixtures.ts). The real
 * file that exposed them is used up as a test; no fresh holdout has been read.
 *
 *   1. plan-arrows.pdf        a dimension between FILLED arrowheads runs tip to tip (scale.ts): arrow
 *                             tips first, then ticks or extension lines, then the line's own length.
 *   2. plan-dims-disagree.pdf with fewer than 3 readings the scale is "good" only when they agree within
 *                             1% (scale.ts combineScale); otherwise "check" with a plain reason.
 *   3. plan-t-breaks.pdf      a face break exactly as wide as a wall meeting it at a T is no "gap not
 *                             read" (walls.ts mergeLines); real narrow gaps of other widths still are.
 *   4. plan-flush-jamb.pdf    a jamb flush with the face of a wall meeting at a T is not refused by
 *                             rounding (snap.ts place()).
 *
 * FAILING FIRST (on the code before each fix; docs/HANDOFF.md §31 has the output):
 *   1. both rows "line length", measured between the arrowheads' bases, short by both arrowheads;
 *   2. "good" from two readings 6.2% apart;
 *   3. six 100 mm "gaps" at the six T-junctions listed beside the real 300 and 100 mm ones;
 *   4. the flush window "left out: A window must sit fully inside its wall…", verdict Check.
 * Q4_ONLY=1..4 runs one section.
 * Run: npx tsx scripts/test-pdf-q4.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dimensionRows } from "../src/lib/pdf/dimensions";
import { extractVectorPage } from "../src/lib/pdf/extract";
import { combineScale, pdfScale } from "../src/lib/pdf/scale";
import { planVerdict, verdictText } from "../src/lib/pdf/verdict";
import { readVectorWalls } from "../src/lib/pdf/walls";
import type { PdfSegment, PdfText, VectorPage } from "../src/types/pdf";
import type { Vec2 } from "../src/types/plan";
import { openNode, pdfjs } from "./pdf-node";
import { build, d, DIR, exactOpenings, exactWalls, HALF_MM, page, truth, vectorFrame } from "./test-pdf-conventions";

const only = process.env.Q4_ONLY;
const run = (n: string) => !only || only === n;

/** Synthetic pages. Strokes are 0.01 pt, so at 1 pt = 1 m (section 3) no line is a stroke wall (step S.1). */
let path = 0;
const seg = (x1: number, y1: number, x2: number, y2: number, filled = false): PdfSegment => ({ x1, y1, x2, y2, width: filled ? 0 : 0.01, filled, path, curve: false });
/** A filled triangle tip → two base corners, one path. */
const tri = (tip: Vec2, b1: Vec2, b2: Vec2): PdfSegment[] => {
  path++;
  const out = [seg(tip.x, tip.y, b1.x, b1.y, true), seg(b1.x, b1.y, b2.x, b2.y, true), seg(b2.x, b2.y, tip.x, tip.y, true)];
  path++;
  return out;
};
const line = (x1: number, y1: number, x2: number, y2: number) => [seg(x1, y1, x2, y2)].map((s) => ({ ...s, path: path++ }));
/** "3000 mm", 7 pt high, centred on (cx, y) and sitting on the line (its centre on it). */
const text = (str: string, cx: number, y: number): PdfText => ({ str, x: cx - 14, y: y + 0.35 * 7, rotation: 0, height: 7, width: 28 });
const synthetic = (segments: PdfSegment[], texts: PdfText[]): Pick<VectorPage, "segments" | "texts" | "paper"> => ({ segments, texts, paper: "A4" });

function arrowsSynthetic() {
  // A 300 pt line printed "3000 mm" with the text in a gap; arrowheads 20 pt long at both ends.
  const head = (tipX: number, dir: number) => tri({ x: tipX, y: 100 }, { x: tipX + dir * 20, y: 96 }, { x: tipX + dir * 20, y: 104 });
  const pieces = (x0: number, x1: number) => [...line(x0, 100, 230, 100), ...line(270, 100, x1, 100)];
  // (a) the line stops at the arrowheads' bases: measured tip to tip.
  let s = pdfScale(synthetic([...head(100, 1), ...head(400, -1), ...pieces(120, 380)], [text("3000 mm", 250, 100)]));
  assert.equal(s.matches[0]?.measure, "arrows", "line pieces stopping at the arrowheads' bases: measured between the tips");
  assert.ok(Math.abs(s.matches[0].lengthPt - 300) < 1e-9, `tip to tip: ${s.matches[0].lengthPt} pt`);
  // (b) the line runs tip to tip, the arrowheads over its ends: the same length.
  s = pdfScale(synthetic([...head(100, 1), ...head(400, -1), ...pieces(100, 400)], [text("3000 mm", 250, 100)]));
  assert.ok(s.matches[0]?.measure === "arrows" && Math.abs(s.matches[0].lengthPt - 300) < 1e-9, "a line running tip to tip: between the tips");
  // (c) triangles pointing INWARD at the ends are not arrowheads (a closed-arrow chain's neighbour, a marker).
  s = pdfScale(synthetic([...head(120, -1), ...head(380, 1), ...pieces(120, 380)], [text("3000 mm", 250, 100)]));
  assert.equal(s.matches[0]?.measure, "line", "inward triangles: the line's own length");
  // (d) arrowheads beat ticks: ticks across the line's ends (at the bases) would measure 258 pt; the tips win.
  const ticks = [...line(121, 92, 121, 108), ...line(379, 92, 379, 108)];
  s = pdfScale(synthetic([...head(100, 1), ...head(400, -1), ...pieces(120, 380), ...ticks], [text("3000 mm", 250, 100)]));
  assert.ok(s.matches[0]?.measure === "arrows" && Math.abs(s.matches[0].lengthPt - 300) < 1e-9, "arrow tips before ticks");
  assert.equal(dimensionRows(s.matches, s.mPerPt ?? 0.01)[0].how, "between arrow tips", 'the row says "between arrow tips"');
  console.log("1. synthetic: base-stopped and tip-to-tip lines measured between the tips; inward triangles ignored; arrows before ticks");
}

async function arrows() {
  const t = truth("plan-arrows.pdf");
  const s = pdfScale(await page(t.file));
  for (const m of s.matches) {
    const want = t.dims.find((x) => x.text === m.text)!;
    const shortMm = (want.lengthPt - m.lengthPt) * t.mPerPt * 1000;
    console.log(`   "${m.text}": ${m.measure}, ${m.lengthPt.toFixed(3)} pt (true ${want.lengthPt.toFixed(3)} pt between the tips, ${want.lineLengthPt!.toFixed(3)} pt between the bases): ${shortMm.toFixed(2)} mm short`);
  }
  console.log(`   scale ${s.confidence}, ${s.mPerPt} m/pt against the true ${t.mPerPt} (ratio ${((s.mPerPt ?? 0) / t.mPerPt).toFixed(5)}): ${s.reason}`);
  assert.equal(s.matches.length, 2, "both dimensions found");
  for (const m of s.matches) {
    const want = t.dims.find((x) => x.text === m.text)!;
    assert.equal(m.measure, "arrows", `"${m.text}": measured between the arrow tips`);
    assert.ok(Math.abs(m.lengthPt - want.lengthPt) * t.mPerPt <= 1e-4, `"${m.text}": within 0.1 mm of the true length tip to tip`);
  }
  assert.equal(s.confidence, "good", `scale good (${s.reason})`);
  assert.ok(Math.abs(s.mPerPt! - t.mPerPt) <= 1e-6, "the scale is the true one (truth.json keeps 6 decimals)");
  assert.ok(dimensionRows(s.matches, s.mPerPt!).every((r) => r.how === "between arrow tips" && r.status === "ok"), "both rows OK, between arrow tips");
  const r = await build(t.file);
  exactWalls(t.file, r.b);
  const v = planVerdict(r.b.plan, r.b.coverage);
  assert.equal(v.level, "good", verdictText(v));
  console.log(`1. plan-arrows: both rows between arrow tips within 0.1 mm, scale good and exact; ${r.b.coverage.exact} of ${r.b.plan.walls.length} walls exact; ${verdictText(v)}`);
}

async function disagree() {
  // The rule on its own: fewer than 3 readings must agree within 1% to be good; 3 or more keep the 5% band.
  assert.equal(combineScale([1, 1.009], null, "A4").confidence, "good", "two readings 0.9% apart: good");
  assert.equal(combineScale([1, 1.011], null, "A4").confidence, "check", "two readings 1.1% apart: check");
  assert.equal(combineScale([1, 1.03, 0.97], null, "A4").confidence, "good", "three readings within 5% of their median: good, as before");
  assert.equal(combineScale([1], null, "A4").confidence, "check", "one reading: check, as before");
  const doc = await openNode(new Uint8Array(readFileSync(join(DIR, "plan-dims-disagree.pdf"))));
  const s = pdfScale(await extractVectorPage(pdfjs, await doc.getPage(1)));
  await doc.loadingTask.destroy();
  console.log(`   plan-dims-disagree: ${s.matches.map((m) => `"${m.text}" ${m.lengthPt.toFixed(2)} pt`).join(", ")}; scale ${s.confidence}: ${s.reason}`);
  assert.equal(s.matches.length, 2, "both dimensions found");
  assert.equal(s.confidence, "check", "two readings 6.2% apart: check, not good");
  assert.equal(s.reason, "Two readings disagree by 6.2%: the drawing may not be to scale, or a dimension spans something else. Confirm the scale.");
  console.log(`2. two readings: 0.9% apart good, 1.1% check; plan-dims-disagree "${s.reason}"`);
}

function tBreaksSynthetic() {
  // 1 pt = 1 m. A 0.2 m host along y 0 to 0.2 whose lower face (y 0.2) breaks for a stem.
  const host = (b0: number, b1: number) => [seg(0, 0, 10, 0), seg(0, 0.2, b0, 0.2), seg(b1, 0.2, 10, 0.2)];
  const stem = (x0: number, x1: number) => [seg(x0, 0.2, x0, 3), seg(x1, 0.2, x1, 3)];
  const gaps = (segments: PdfSegment[]) => (readVectorWalls({ segments }, 1).gaps ?? []).map((g) => Math.round(g.size * 1000));
  assert.deepEqual(gaps([...host(4.95, 5.05), ...stem(4.95, 5.05)]), [], "a 100 mm break where a 100 mm wall meets at a T: not a gap");
  assert.deepEqual(gaps([...host(4.95, 5.05)]), [100], "the same break with no wall meeting it: reported");
  assert.deepEqual(gaps([...host(4.85, 5.15), ...stem(4.95, 5.05)]), [300], "a 300 mm break around a 100 mm stem: reported");
  console.log("3. synthetic: a face break as wide as the T's stem is no gap; with no stem, or a wider break, it is reported");
}

async function tBreaks() {
  const t = truth("plan-t-breaks.pdf");
  const r = await build(t.file);
  const vw = r.pdf.vectorWalls!;
  const mm = (gs: { size: number }[]) => gs.map((g) => Math.round(g.size * 1000)).sort((p, q) => p - q);
  console.log(`   gaps read ${JSON.stringify(mm(vw.gaps ?? []))} mm, reported ${JSON.stringify(mm(r.b.coverage.outOfRangeGaps))} mm; the truth's ${JSON.stringify(t.outOfRangeGaps!.map((g) => Math.round(g * 1000)))} mm`);
  assert.deepEqual(mm(vw.gaps ?? []), [100, 300], "only the two real narrow gaps, none at the six T-junctions");
  assert.deepEqual(mm(r.b.coverage.outOfRangeGaps), [100, 300], "and the review reports only those");
  assert.deepEqual(exactOpenings(t.file, vectorFrame(vw).openings), [], "every opening read exactly");
  exactWalls(t.file, r.b);
  const v = planVerdict(r.b.plan, r.b.coverage);
  assert.equal(v.level, "good", verdictText(v));
  console.log(`3. plan-t-breaks: gaps ${mm(r.b.coverage.outOfRangeGaps).join(" and ")} mm reported, none at a T; ${r.b.coverage.exact} walls and ${r.b.coverage.openings.exact} openings exact; ${verdictText(v)}`);
}

async function flushJamb() {
  const t = truth("plan-flush-jamb.pdf");
  const r = await build(t.file);
  const notes = r.b.coverage.notes.filter((n) => /left out|refused/.test(n));
  console.log(`   refused ${r.b.coverage.refused}; ${notes.join(" | ") || "no opening left out"}`);
  assert.equal(r.b.coverage.refused, 0, "no PDF opening refused");
  assert.equal(r.b.plan.openings.length, t.planOpenings.length, "every opening placed");
  exactWalls(t.file, r.b);
  // Every opening's jambs in the built plan within 0.5 mm of the truth (the plan's origin is the truth's).
  const jambs = r.b.plan.openings.map((o) => {
    const w = r.b.plan.walls.find((x) => x.id === o.wallId)!;
    const L = d(w.a, w.b);
    const at = (s: number) => ({ x: w.a.x + ((w.b.x - w.a.x) / L) * s, y: w.a.y + ((w.b.y - w.a.y) / L) * s });
    return [at(o.offset - o.width / 2), at(o.offset + o.width / 2)];
  });
  for (const to of t.planOpenings) assert.ok(jambs.some(([p, q]) => (d(p, to.a) <= HALF_MM && d(q, to.b) <= HALF_MM) || (d(p, to.b) <= HALF_MM && d(q, to.a) <= HALF_MM)), `${to.id}: placed within 0.5 mm`);
  const v = planVerdict(r.b.plan, r.b.coverage);
  assert.equal(v.level, "good", verdictText(v));
  const flush = t.planOpenings.find((o) => o.id === "win-flush")!;
  console.log(`4. plan-flush-jamb: win-flush (${(d(flush.a, flush.b) * 1000).toFixed(2)} mm) placed flush with w-BI's face; ${r.b.plan.openings.length} of ${t.planOpenings.length} openings; ${verdictText(v)}`);
}

async function main() {
  if (run("1")) {
    arrowsSynthetic();
    await arrows();
  }
  if (run("2")) await disagree();
  if (run("3")) {
    tBreaksSynthetic();
    await tBreaks();
  }
  if (run("4")) await flushJamb();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
