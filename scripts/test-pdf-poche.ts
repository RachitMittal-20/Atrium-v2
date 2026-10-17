/**
 * test-pdf-poche.ts — step Q.2: more general CAD-drawing conventions the vector PDF reader follows,
 * each proven on its own SYNTHETIC fixture (scripts/make-pdf-fixtures.ts, truth.json) that
 * reproduces one class of failure seen on a ChatGPT-generated plan drawn in poche
 * (tests/fixtures/pdf/plan-chatgpt-poche.pdf, scripts/test-pdf-chatgpt-poche.ts). That plan was
 * used to FIND these classes; it is never what proves them (the holdout rule, CLAUDE.md). Every
 * section was written first and seen failing on the code before its rule.
 *
 *   1. A fill in the paper's colour is a mask, not ink (extract.ts): a generated plan knocks each
 *      window out of its poche with a white rectangle a little bigger than the gap. It paints
 *      paper, so it is never a segment, and so never a wall (plan-poche-mask).
 *   2. Dashed lines are never wall faces or opening lines (extract.ts, walls.ts): a dash-dot line is a
 *      centre line, a hidden or overhead line or a setting-out line; a wall's cut face is drawn
 *      continuous. A centre line paired with a finish line 80 mm off it made a thin "wall" beside the
 *      real one, and rule 6 dropped both as a sliver loop; one through a sliding door's gap made it
 *      unclassified; one along a window's middle glazing line joined it into one long face, losing
 *      the window (plan-centre-lines).
 *   3. A dimension's text sits at the middle of its own line (scale.ts): when two drawn lines on
 *      one line pass beside a text equally near, the one centred on it is the line it labels. A
 *      short string drawn over a longer one on the same line was measured as the longer one, and
 *      that one wrong row made the dimensions disagree, so the scale fell to the title block and no
 *      dimension was left out of the walls as annotation (plan-dims-chain).
 *   3b. One wrong dimension does not cost the scale (scale.ts, the OUTLIER rule as agreed): when at
 *      least 5 readings agree within 5% and exactly one more does not, and that one is under 20% of
 *      all the readings, the scale is the agreeing group's and "good", and the wrong one is a
 *      flagged row. Fewer than 5 agreeing, or two outliers, change nothing (plan-dims-one-wrong:
 *      one string printed 5200 mm on a 4 m line).
 *   4. A clip path hides what lies outside it (extract.ts): a generated plan hatches its poche with
 *      long 45° lines and clips them to each wall piece. Unclipped, they ran 1.5 m out across the
 *      rooms and were counted as diagonal walls; clipped, each is only its visible part inside the
 *      piece (plan-poche-hatch).
 *   4b. Hatching is not a diagonal wall at a corner either (walls.ts countDiagonal): where two hatched
 *      poche pieces meet, a hatch line in one pairs with one in the other across the corner, and that
 *      pair's middle lies in the room; it is hatching when each of its two lines lies inside a wall.
 *      Shown on a synthetic L of 0.3 m poche (the 0.2 m walls of the fixtures make pieces too short).
 *   5. Rule 3 (no line runs through a wall) also sees a filled wall's edges (walls.ts): a poche wall's
 *      faces are its fill's edges, not stroked lines, so a finish line on one side of a poche wall
 *      paired with a line on the other, straddling the wall, and a wall meeting it there was moved
 *      onto that phantom's centre line (plan-finish-line).
 *   6. A sheet holds more than the building (walls.ts rule 7b): a group joined to nothing in the
 *      building and wholly outside it is dropped only on evidence, title-block words inside it or
 *      the sheet's border beside it (plan-title-block: a title block ruled into 0.53 m rows read as
 *      13 walls, and the build fell back to tracing), and kept without it (plan-outbuilding: a
 *      detached 4 × 3 m shed). Either way it is reported with its footprint and why.
 *   7. A window's own lines are never a wall (walls.ts): lines lying within a bridged opening's span
 *      with one of them inside the wall's thickness belong to the window. A sill line 35 mm inside
 *      the room paired with the outer glazing line as a 0.16 m "wall", reported as furniture (or,
 *      with a wall meeting it, joined to the plan) (plan-window-sill).
 *   8. A wall closes a gap only by passing through it (walls.ts): a perpendicular wall blocks the
 *      bridge across a door or window gap only when it crosses the wall's whole thickness; one that
 *      ends inside the band (a partition drawn into the middle of a window) does not. The wall is
 *      then read whole, the partition joins it, and the opening it cuts is NOT read and is reported
 *      by name ("Window 1 (1.20 m) conflicts with a wall ending inside it; not read"), never
 *      silently. Before, the wall broke at the window with free ends and the partition ended on the
 *      window's sill-and-glass pair (plan-stem-in-window).
 *   9. A filled rectangle is a wall at any angle (walls.ts): a poche wall drawn at 45° is a pair as it
 *      stands, like an axis-aligned one, and joins the walls it meets (its ends to their centre lines,
 *      their free ends to its centre line, T-junctions split). Before, it was only counted, the wall
 *      before it ended free and the two rooms it divides were one (plan-poche-diagonal).
 *   10. Rule 8b, a PDF reading with a real free end (snap.ts): when rule 8 fails only because the
 *      drawing itself leaves a wall end free (a nib or wing wall, a wall stopping short), the PDF's
 *      walls alone are still used if that plan keeps EVERY PDF wall, has strictly fewer validator
 *      problems than the merged plan and no fewer rooms; the review says how many free ends remain.
 *      plan-free-end (plan-filled with a 1 m nib) traces well, so its merge TIES the PDF alone (one
 *      problem each) and stands, as the rule says; with its tracing made poor (three walls 6 px off their
 *      line and 30 px short, the class Q.1 met: a tracing fused and broken by annotation) the merge has
 *      more problems, and the
 *      PDF's walls alone are used with the nib's free end reported. plan-single-line, whose merge is
 *      clean, still merges (test-pdf-conventions.ts section 8).
 *   10b. The merge choice (step Q.2b, snap.ts pdfAloneWins): between the merged plan and the PDF's walls
 *      alone, more PDF walls kept wins, then fewer validator problems, then more rooms; a full tie
 *      keeps the merge. A wall is kept when it is in the plan or its traced version stands in for it,
 *      so a merge whose rounds DROPPED walls (4 of 16, clean) no longer beats a complete reading with
 *      one real free end, and a plan keeping under 70% never beats one keeping all.
 *   11. A level note is never a room name (step Q.2b, analysePdf.ts pdfLabels): "FFL +0.150", "SSL",
 *      "FL", "LEVEL 1" and bare signed decimals ("+0.000") printed beside a room name are not part of
 *      it, alone on their line or at the end of the name's own line (plan-levels). Before, the
 *      ChatGPT poche plan named a room "Corridor / Living / Ffl +0.150".
 *
 * Shares its helpers with scripts/test-pdf-conventions.ts.
 * Run: npx tsx scripts/test-pdf-poche.ts
 */
import assert from "node:assert/strict";
import { dimensionRows } from "../src/lib/pdf/dimensions";
import { readVectorWalls } from "../src/lib/pdf/walls";
import type { PdfSegment } from "../src/types/pdf";
import { combineScale, parseTitleScale, pdfScale } from "../src/lib/pdf/scale";
import { buildPdfPlan, conflictText, pdfAloneWins } from "../src/lib/pdf/snap";
import { deriveRooms } from "../src/lib/plan/rooms";
import { validatePlan } from "../src/lib/plan/validate";
import { build, exactOpenings, exactWalls, page, sameWall, toTruthFrame, truth, vectorFrame } from "./test-pdf-conventions";

async function main() {
  // ------------------------------------------------------------ 1. a paper-coloured fill is a mask
  {
    const file = "plan-poche-mask.pdf";
    const t = truth(file);
    const v = await page(file);
    const filled = v.segments.filter((s) => s.filled).length;
    assert.equal(filled, t.segments.filter((s) => s[5]).length, `${file}: only the poche's edges are filled segments, no mask's (${filled})`);
    const r = await build(file);
    const vw = r.pdf.vectorWalls!;
    assert.deepEqual(toTruthFrame(vw.walls).filter((w) => !sameWall(w, t.planWalls)).map((w) => `${w.id} t ${w.thickness.toFixed(3)}`), [], `${file}: no wall read from a mask`);
    assert.deepEqual(exactOpenings(file, vectorFrame(vw).openings), [], `${file}: every opening read exactly, the windows behind their masks included`);
    exactWalls(file, r.b);
    console.log(`1. masks: ${file} ${t.planWalls.length}/${t.planWalls.length} walls and ${t.planOpenings.length}/${t.planOpenings.length} openings exact, no wall from the ${t.planOpenings.filter((o) => o.kind === "window").length} window masks`);
  }
  // ------------------------------------------------------------ 2. dashed lines are not faces
  {
    const file = "plan-centre-lines.pdf";
    const t = truth(file);
    const v = await page(file);
    const dashed = v.segments.filter((x) => x.dashed).length;
    assert.equal(dashed, t.planWalls.length, `${file}: one dashed centre line per wall is marked dashed (${dashed})`);
    const r = await build(file);
    const vw = r.pdf.vectorWalls!;
    assert.deepEqual(toTruthFrame(vw.walls).filter((w) => !sameWall(w, t.planWalls)).map((w) => `${w.id} t ${w.thickness.toFixed(3)}`), [], `${file}: no wall read from a centre line`);
    assert.deepEqual(exactOpenings(file, vectorFrame(vw).openings), [], `${file}: every opening read exactly (the sliding door sliding, the windows behind their centre lines)`);
    exactWalls(file, r.b);
    console.log(`2. centre lines: ${file} ${t.planWalls.length}/${t.planWalls.length} walls and ${t.planOpenings.length}/${t.planOpenings.length} openings exact with ${dashed} dash-dot centre lines and a finish line beside w-HI`);
  }
  // ------------------------------------------------------------ 3. a dimension's text is centred on its line
  {
    const file = "plan-dims-chain.pdf";
    const t = truth(file);
    const s = pdfScale(await page(file));
    const rows = dimensionRows(s.matches, s.mPerPt!);
    const short = rows.find((x) => x.text === "1500 mm");
    assert.ok(short && short.status === "ok" && Math.abs(short.measuredM - 1.5) < 1e-4, `${file}: the 1500 mm string is measured on its own line (${JSON.stringify(short)})`);
    assert.ok(rows.length === t.dims.length && rows.every((x) => x.status === "ok"), `${file}: all ${t.dims.length} rows OK`);
    assert.equal(s.confidence, "good", `${file}: the scale is good (${s.reason})`);
    assert.ok(Math.abs(s.mPerPt! / t.mPerPt - 1) < 1e-5, `${file}: the true scale`);
    console.log(`3. centred text: ${file} the 1500 mm string over the 4000 mm one measured ${short!.measuredM.toFixed(4)} m; ${rows.length}/${t.dims.length} rows OK, scale ${s.confidence}`);
  }
  // ------------------------------------------------------------ 3b. one wrong dimension is an outlier
  {
    const file = "plan-dims-one-wrong.pdf";
    const t = truth(file);
    const s = pdfScale(await page(file));
    assert.equal(s.confidence, "good", `${file}: the scale is good (${s.reason})`);
    assert.ok(Math.abs(s.mPerPt! / t.mPerPt - 1) < 1e-5, `${file}: the agreeing group's scale, the true one (${s.mPerPt} vs ${t.mPerPt})`);
    const rows = dimensionRows(s.matches, s.mPerPt!);
    const bad = rows.filter((x) => x.status !== "ok");
    assert.deepEqual(bad.map((x) => x.text), ["5200 mm"], `${file}: exactly the wrong one is flagged`);
    assert.match(s.reason, /10 of 11 printed dimensions agree within 5%/, `${file}: the reason says so (${s.reason})`);
    // The boundaries, on samples (metres per point): 5 agreeing and one off is good; 4 agreeing and
    // one off is not; two off is not; one off among exactly 5 readings (20%) is not.
    const title = parseTitleScale("SCALE 1:100");
    const ok = Array(5).fill(0.0352778);
    assert.equal(combineScale([...ok, 0.05], title, "A4").confidence, "good", "5 agree, 1 outlier (1 of 6): good");
    assert.ok(Math.abs(combineScale([...ok, 0.05], null, "A4").mPerPt! - 0.0352778) < 1e-9, "5 agree, 1 outlier: the group's scale");
    assert.notEqual(combineScale([...ok.slice(1), 0.05], title, "A4").confidence, "good", "4 agree, 1 outlier (1 of 5 = 20%): not good");
    assert.notEqual(combineScale([...ok, 0.05, 0.06], title, "A4").confidence, "good", "5 agree, 2 outliers: not good");
    assert.equal(combineScale([...ok, 0.05], null, "A4").confidence, "good", "5 agree, 1 outlier, no title block: good");
    console.log(`3b. one outlier: ${file} scale ${s.confidence} from 10 of 11 dimensions, "5200 mm" flagged; 4 agreeing or 2 outliers stay as before`);
  }
  // ------------------------------------------------------------ 4. a clip path hides what lies outside it
  {
    const file = "plan-poche-hatch.pdf";
    const t = truth(file);
    const v = await page(file);
    const hatch = v.segments.filter((x) => Math.abs(x.width - 0.1) < 1e-6);
    const want = t.segments.filter((x) => Math.abs(x[4] - 0.1) < 1e-6);
    const near = (a: number, b: number) => Math.abs(a - b) <= 0.01;
    const unmatched = hatch.filter((x) => !want.some(([x1, y1, x2, y2]) => (near(x.x1, x1) && near(x.y1, y1) && near(x.x2, x2) && near(x.y2, y2)) || (near(x.x1, x2) && near(x.y1, y2) && near(x.x2, x1) && near(x.y2, y1))));
    assert.ok(hatch.length === want.length && unmatched.length === 0, `${file}: every hatch line is only its visible part inside its wall piece (${hatch.length} read, ${want.length} drawn, ${unmatched.length} not clipped)`);
    const r = await build(file);
    assert.equal(r.pdf.vectorWalls!.skipped.diagonal, 0, `${file}: no hatch line counted as a diagonal wall`);
    exactWalls(file, r.b);
    assert.deepEqual(exactOpenings(file, vectorFrame(r.pdf.vectorWalls!).openings), [], `${file}: every opening read exactly`);
    console.log(`4. clip paths: ${file} ${hatch.length} hatch lines clipped to their wall pieces, 0 counted as diagonal walls; ${t.planWalls.length}/${t.planWalls.length} walls exact`);
  }
  // ------------------------------------------------------------ 4b. hatching at a corner (synthetic, 1 pt = 1 cm)
  {
    const K = 0.01;
    let path = 0;
    const segs: PdfSegment[] = [];
    const box = (x0: number, y0: number, x1: number, y1: number) => {
      const p = path++;
      for (const [a, b, c, d] of [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]]) segs.push({ x1: a / K, y1: b / K, x2: c / K, y2: d / K, width: 0, filled: true, path: p, curve: false });
    };
    // 45° hatch 0.04 m apart, already clipped to the box, as extract.ts delivers it.
    const hatch = (x0: number, y0: number, x1: number, y1: number) => {
      for (let c = y0 - x1 + 0.02; c < y1 - x0; c += 0.04 * Math.SQRT2) {
        const [lo, hi] = [Math.max(x0, y0 - c), Math.min(x1, y1 - c)];
        if (hi > lo) segs.push({ x1: lo / K, y1: (lo + c) / K, x2: hi / K, y2: (hi + c) / K, width: 0.1, filled: false, path: path++, curve: false });
      }
    };
    // An L of 0.3 m poche: 6 m along y = 0, 4 m along x = 0, overlapping at the corner, both hatched.
    box(0, 0, 6, 0.3);
    box(0, 0, 0.3, 4);
    hatch(0, 0, 6, 0.3);
    hatch(0, 0, 0.3, 4);
    const vw = readVectorWalls({ segments: segs }, K);
    assert.equal(vw.walls.length, 2, `hatched L: its two walls (${vw.walls.length})`);
    assert.equal(vw.skipped.diagonal, 0, `hatched L: no hatch pair across the corner counted as a diagonal wall (${vw.skipped.diagonal})`);
    console.log(`4b. hatching at a corner: a hatched L of 0.3 m poche reads 2 walls and 0 diagonal walls`);
  }

  // ------------------------------------------------------------ 5. rule 3 sees a filled wall's edges
  {
    const file = "plan-finish-line.pdf";
    const t = truth(file);
    const r = await build(file);
    const vw = r.pdf.vectorWalls!;
    assert.deepEqual(toTruthFrame(vw.walls).filter((w) => !sameWall(w, t.planWalls)).map((w) => `${w.id} t ${w.thickness.toFixed(3)}`), [], `${file}: no wall straddles the poche wall, and w-HI still ends on it`);
    assert.deepEqual(exactOpenings(file, vectorFrame(vw).openings), [], `${file}: every opening read exactly`);
    exactWalls(file, r.b);
    console.log(`5. filled edges in rule 3: ${file} ${t.planWalls.length}/${t.planWalls.length} walls exact, no wall across the finish line and the shelf`);
  }
  // ------------------------------------------------------------ 6. title blocks dropped on evidence, outbuildings kept
  {
    const file = "plan-title-block.pdf";
    const t = truth(file);
    const r = await build(file);
    const vw = r.pdf.vectorWalls!;
    assert.deepEqual(toTruthFrame(vw.walls).filter((w) => !sameWall(w, t.planWalls)).map((w) => `${w.id} t ${w.thickness.toFixed(3)}`), [], `${file}: no wall read from the title block's rows`);
    const tb = r.b.coverage.detached;
    assert.ok(tb.length >= 1 && tb.every((x) => x.dropped && /title-block text inside it/.test(x.why)), `${file}: the title block is reported as dropped, on its text (${JSON.stringify(tb)})`);
    // Its footprint as read: the title block's 230 × 100 pt frame, plus the pair its right edge makes
    // with the sheet border 15.28 pt beyond it (the frame at x 560 pt, the border at 575.28 pt).
    const [w, h, toBorder] = [230 * t.mPerPt, 100 * t.mPerPt, (595.28 - 20 - 560) * t.mPerPt];
    assert.ok(tb.some((x) => x.size.w >= w - 1e-6 && x.size.w <= w + toBorder + 1e-4 && Math.abs(x.size.d - h) < 1e-4), `${file}: its footprint covers the title block and stops at the border (${tb.map((x) => `${x.size.w.toFixed(3)} × ${x.size.d.toFixed(3)}`)}; frame ${w.toFixed(3)} × ${h.toFixed(3)} m)`);
    exactWalls(file, r.b);
  }
  {
    const file = "plan-outbuilding.pdf";
    const t = truth(file);
    const r = await build(file);
    const vw = toTruthFrame(r.pdf.vectorWalls!.walls);
    // The truth lists the shed's four walls (shed-n, -s, -w, -e) beside the house's.
    assert.deepEqual(t.planWalls.filter((tw) => tw.id.startsWith("shed-") && !vw.some((w) => sameWall(w, [tw]))).map((w) => w.id), [], `${file}: the shed's four walls are read and kept`);
    assert.deepEqual(t.planWalls.filter((tw) => !vw.some((w) => sameWall(w, [tw]))).map((w) => w.id), [], `${file}: the house is read whole`);
    const d = r.b.coverage.detached;
    assert.equal(d.length, 1, `${file}: one detached group reported (${JSON.stringify(d)})`);
    assert.ok(!d[0].dropped && /kept as a separate building/.test(d[0].why), `${file}: the shed is reported as KEPT, not silently lost or dropped (${d[0].why})`);
    assert.ok(Math.abs(d[0].size.w - 4.2) < 1e-4 && Math.abs(d[0].size.d - 3.2) < 1e-4, `${file}: reported 4.20 × 3.20 m over its faces (${d[0].size.w.toFixed(4)} × ${d[0].size.d.toFixed(4)})`);
    assert.ok(r.b.plan.walls.filter((w) => w.provenance === "vector").length === t.planWalls.length && r.b.coverage.traced === 0, `${file}: house and shed both built from the PDF (${r.b.coverage.exact} of ${r.b.coverage.walls})`);
    console.log(`6. detached groups: plan-title-block's title block dropped on its text and reported; plan-outbuilding's ${d[0].size.w.toFixed(2)} × ${d[0].size.d.toFixed(2)} m shed kept and reported`);
  }
  // ------------------------------------------------------------ 7. a window's own lines are never a wall
  {
    const file = "plan-window-sill.pdf";
    const t = truth(file);
    const r = await build(file);
    const vw = r.pdf.vectorWalls!;
    assert.deepEqual((vw.furniture ?? []).map((f) => `${f.kind} ${(f.box.x1 - f.box.x0).toFixed(2)} × ${(f.box.y1 - f.box.y0).toFixed(2)}`), [], `${file}: no window's lines reported as furniture`);
    assert.deepEqual(exactOpenings(file, vectorFrame(vw).openings), [], `${file}: every window still read from its glazing lines`);
    exactWalls(file, r.b);
    console.log(`7. window lines: ${file} ${t.planOpenings.filter((o) => o.kind === "window").length} windows with sill lines read, none of their lines a wall or furniture`);
  }
  // ------------------------------------------------------------ 8. a wall ending inside a window
  {
    const file = "plan-stem-in-window.pdf";
    const t = truth(file);
    const r = await build(file);
    const vw = r.pdf.vectorWalls!;
    assert.deepEqual(toTruthFrame(vw.walls).filter((w) => !sameWall(w, t.planWalls)).map((w) => `${w.id} t ${w.thickness.toFixed(3)}`), [], `${file}: every wall read is a true wall (the west wall whole, split at the partition)`);
    assert.deepEqual(exactOpenings(file, vectorFrame(vw).openings), ["win-bed1: not read"], `${file}: only the window the partition ends in is not read`);
    const c = r.b.coverage.conflicts;
    assert.ok(c.length === 1 && c[0].kind === "window" && Math.abs(c[0].width - 1.2) < 1e-4, `${file}: that window is reported (${JSON.stringify(c)})`);
    // Step Q.2b (as stated, this line now also counts the traced window removed at the same place).
    assert.equal(conflictText(c[0], 0, "m"), "Window 1 (1.20 m) conflicts with a wall ending inside it; not read. 1 traced opening at the same place was removed too.", `${file}: by name, in plain words`);
    assert.equal(r.b.coverage.openings.traced, 0, `${file}: the tracing's window there is not kept (${JSON.stringify(r.b.coverage.tracedOpenings)})`);
    exactWalls(file, r.b);
    console.log(`8. wall ending in a window: ${file} ${t.planWalls.length}/${t.planWalls.length} walls exact; "${conflictText(c[0], 0, "m")}"`);
  }
  // ------------------------------------------------------------ 9. a filled rectangle is a wall at any angle
  {
    const file = "plan-poche-diagonal.pdf";
    const t = truth(file);
    const r = await build(file);
    const vw = r.pdf.vectorWalls!;
    const got = toTruthFrame(vw.walls);
    assert.deepEqual(got.filter((w) => !sameWall(w, t.planWalls)).map((w) => `${w.id} (${w.a.x.toFixed(3)}, ${w.a.y.toFixed(3)})-(${w.b.x.toFixed(3)}, ${w.b.y.toFixed(3)}) t ${w.thickness.toFixed(3)}`), [], `${file}: every wall read is a true wall`);
    assert.deepEqual(t.planWalls.filter((tw) => !got.some((w) => sameWall(w, [tw]))).map((w) => w.id), [], `${file}: every true wall read, the 45° one included`);
    assert.equal(vw.skipped.diagonal, 0, `${file}: nothing left counted as a diagonal wall`);
    exactWalls(file, r.b);
    const rooms = r.b.plan.rooms.length;
    assert.equal(rooms, 5, `${file}: bedroom 2 is divided in two (${r.b.plan.rooms.map((x) => x.name).join(", ")})`);
    console.log(`9. diagonal poche: ${file} ${t.planWalls.length}/${t.planWalls.length} walls exact, the 45° wall joined at both ends; ${rooms} rooms`);
  }
  // ------------------------------------------------------------ 10. rule 8b: a PDF reading with a real free end
  {
    const file = "plan-free-end.pdf";
    const t = truth(file);
    const r = await build(file);
    // As traced, the merge ties with the PDF alone (the nib's free end, traced, is its one problem too):
    // rule 8b needs STRICTLY fewer problems, so the merge stands (15 walls exact, the nib traced).
    assert.ok(!r.b.coverage.pdfOnly && r.b.coverage.traced === 1, `${file}: a tie keeps the merge (${r.b.coverage.exact} exact, ${r.b.coverage.traced} traced)`);
    // A poor tracing, as annotation or hatching makes one (step Q.1's class: walls fused tens of mm off
    // and broken): the three longest traced walls lie 6 px off their line (too far to snap, so their
    // groups stay traced) and stop 30 px short, so the tracing has free ends the drawing does not.
    const walls = [...r.analysis.walls].sort((p, q) => Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y) - Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y));
    const short = new Set(walls.slice(0, 3));
    const poor = {
      ...r.analysis,
      walls: r.analysis.walls.map((w) => {
        if (!short.has(w)) return w;
        const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
        const [u, n] = [{ x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L }, { x: (-(w.b.y - w.a.y) / L) * 6, y: ((w.b.x - w.a.x) / L) * 6 }];
        return { ...w, a: { x: w.a.x + n.x, y: w.a.y + n.y }, b: { x: w.b.x + n.x - u.x * 30, y: w.b.y + n.y - u.y * 30 } };
      }),
    };
    const b = buildPdfPlan(poor, r.pdf, { pxPerM: r.analysis.scale.pxPerM!, source: "pdf" });
    exactWalls(file, b);
    const c = b.coverage;
    assert.ok(c.pdfOnly, `${file}, poor tracing: the PDF's walls alone were used`);
    assert.equal(c.freeEnds.length, 1, `${file}, poor tracing: one free end remains, the nib's (${JSON.stringify(c.freeEnds)})`);
    const nib = b.plan.walls.find((w) => Math.abs(w.thickness - 0.1) < 1e-9 && Math.abs(w.a.x - w.b.x) < 1e-9 && Math.abs(Math.abs(w.b.y - w.a.y) - 1.1) < 1e-4);
    assert.ok(nib && [nib.a, nib.b].some((p) => Math.hypot(p.x - c.freeEnds[0].x, p.y - c.freeEnds[0].y) < 1e-6), `${file}, poor tracing: the free end is the nib's far end`);
    assert.equal(c.openings.exact, t.planOpenings.length, `${file}, poor tracing: every opening from the PDF`);
    console.log(`10. rule 8b: ${file} as traced the merge ties and stands (${r.b.coverage.exact} exact, 1 traced); with a poor tracing ${c.exact}/${c.walls} walls from the PDF alone, ${c.freeEnds.length} free end left (the nib's), ${c.openings.exact}/${t.planOpenings.length} openings`);

    // 10b (step Q.2b): the merge choice compares PDF walls kept, then validator problems, then rooms.
    // The complete PDF reading above (every wall, one real free end) against a merge whose validator
    // rounds dropped 12 of the 16 walls and so came out clean.
    const alone = { kept: b.kept, problems: validatePlan(b.plan).length, rooms: deriveRooms(b.plan).length };
    assert.deepEqual(alone, { kept: 16, problems: 1, rooms: 4 }, `${file}: the complete PDF reading keeps all 16 walls with 1 problem (its free end)`);
    assert.equal(r.b.kept, 16, `${file}: as traced the merge keeps all 16 (the nib by its traced version), so it still ties`);
    assert.ok(pdfAloneWins({ kept: 4, problems: 0, rooms: 1 }, alone), `${file}: a merge keeping 4 of 16 walls with 0 problems loses to the complete reading with 1 free end`);
    assert.ok(pdfAloneWins({ kept: 11, problems: 0, rooms: 4 }, alone), `${file}: so does one keeping 11 of 16 (under 70%), with as many rooms`);
    assert.ok(!pdfAloneWins({ kept: 16, problems: 1, rooms: 4 }, alone), `${file}: a full tie keeps the merge`);
    assert.ok(pdfAloneWins({ kept: 16, problems: 2, rooms: 5 }, alone), `${file}: with as many walls kept, fewer problems win before rooms`);
    assert.ok(pdfAloneWins({ kept: 16, problems: 1, rooms: 3 }, alone), `${file}: and with as many problems, more rooms`);
    console.log(`10b. merge choice: walls kept, then problems, then rooms; 4 of 16 with 0 problems loses to 16 of 16 with 1 free end`);
  }
  // ------------------------------------------------------------ 11. level notes are never room names
  {
    const file = "plan-levels.pdf";
    const r = await build(file);
    const base = await build("plan-filled.pdf");
    const names = (b: typeof r.b) => b.plan.rooms.map((x) => x.name).sort();
    assert.deepEqual(names(r.b), names(base.b), `${file}: the room names are plan-filled's, no level note in any of them`);
    assert.deepEqual(names(r.b), ["Bathroom", "Bedroom 1", "Bedroom 2", "Living Room"], `${file}: the four names`);
    exactWalls(file, r.b);
    console.log(`11. level notes: ${file} rooms ${names(r.b).join(", ")} with FFL +0.150, +0.000, LEVEL 1, SSL +0.100 and "Bathroom FL -0.020" printed beside them`);
  }
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
