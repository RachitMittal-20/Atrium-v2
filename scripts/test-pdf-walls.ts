/**
 * test-pdf-walls.ts — step M.1b: exact walls from vector PDFs (src/lib/pdf/walls.ts),
 * the merge with the traced plan (src/lib/pdf/snap.ts), the dimension reader's fixes
 * (src/lib/pdf/scale.ts) and the model-versus-printed check (src/lib/pdf/dimensions.ts),
 * against tests/fixtures/pdf/ and truth.json (scripts/make-pdf-fixtures.ts). pdf.js runs
 * through scripts/pdf-node.ts.
 *
 *   - FAILING FIRST: the M.1a traced plan of plan-filled has at least one wall whose
 *     length is more than 4 mm off the truth (the tracing limit); the snapped plan has
 *     every wall within 0.5 mm;
 *   - plan-filled, plan-lines, plan-rotated, plan-imperial: every wall's centre line
 *     (both ends) and thickness within 0.5 mm of the truth in the page's frame, coverage
 *     100% (by count and by length), validatePlan clean, room areas equal to the
 *     truth's within 1e-6 m², and openings' widths and offsets within 0.5 mm (plan-lines:
 *     the one door the tracing made 1.54 m wide is replaced by the PDF's since step M.1c,
 *     and reported);
 *   - plan-clutter: exactly the 14 real walls, the diagonal wall counted, the table and
 *     the two tag boxes dropped as clutter; and with Chromium's noisy trace of the same
 *     page (tests/fixtures/pdf/clutter-chromium-trace.json, from the browser test) still
 *     exactly the 14, the four rooms and nine openings, the noise left out and reported;
 *   - plan-single-line: the wall drawn as one line is traced (within 4 px), the rest exact,
 *     rooms and validator intact;
 *   - pairing rules on synthetic segments: gap 0.05 and 0.60 pair, 0.04 and 0.61 don't;
 *     60% overlap pairs, 59% doesn't; a filled rectangle is a pair; the widest pair wins
 *     and a glass line inside a wall is a window; an L corner, a T-junction (the host is
 *     split) and a crossing (both split);
 *   - snapping on synthetic plans: 1.5 px snaps; 2.5 px keeps the traced wall with its
 *     reason; an end 5 px past the PDF's wall keeps it too; no traced end ever moves
 *     more than 3 px; a wall from the PDF that adds a validator problem is left out with
 *     its reason;
 *   - dimensions: plan-broken-dims' lines broken around their text are read; the line
 *     that overshoots its ticks is measured between the ticks (exact), not by its length
 *     (10 mm long); the overall line without ticks says "line length";
 *   - OCR: an outlined page with only a title block read by OCR stays "check"; OCR words
 *     at the printed places give "good", every row "read by OCR"; with tesseract's
 *     the language file in public/tesseract/ (O.1: always there) the real OCR reads plan-outlined;
 *   - model versus printed: plan-filled's 11 dimensions are centre to centre and OK to
 *     0.5 mm; a misprint is flagged; traced walls make a row "approximate"; both checks
 *     reach the CSV;
 *   - the plan store marks an edited PDF wall "edited" and keeps its provenance.
 * Run: npx tsx scripts/test-pdf-walls.ts
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildFromAnalysis, type OcrResult } from "../src/lib/blueprint/analyse";
import { buildPlan } from "../src/lib/blueprint/toPlan";
import { analysePdfPage, scanRasterScale } from "../src/lib/pdf/analysePdf";
import { dimensionRows, modelRows, rowsToCsv } from "../src/lib/pdf/dimensions";
import { extractVectorPage } from "../src/lib/pdf/extract";
import { pdfScale } from "../src/lib/pdf/scale";
import { buildPdfPlan, mergeVector } from "../src/lib/pdf/snap";
import { readVectorWalls } from "../src/lib/pdf/walls";
import { wallLength } from "../src/lib/plan/geometry";
import { deriveRooms } from "../src/lib/plan/rooms";
import { validatePlan } from "../src/lib/plan/validate";
import { usePlanStore } from "../src/store/planStore";
import type { BuildReport, OcrWord } from "../src/types/blueprint";
import type { Plan, Vec2, Wall } from "../src/types/plan";
import type { PdfSegment, VectorWalls } from "../src/types/pdf";
import type { Truth } from "./make-pdf-fixtures";
import { openNode, pdfjs, renderNode } from "./pdf-node";

const DIR = join(__dirname, "../tests/fixtures/pdf");
const truths: Truth[] = JSON.parse(readFileSync(join(DIR, "truth.json"), "utf8"));
const truth = (file: string) => truths.find((t) => t.file === file)!;
const HALF_MM = 0.0005;
const d = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.y - q.y);
const noOcr = async (): Promise<OcrResult> => ({ labels: [], words: [], error: null, rereads: [] });

async function read(file: string, ocr = noOcr) {
  const t = truth(file);
  const doc = await openNode(new Uint8Array(readFileSync(join(DIR, file))));
  const out = await analysePdfPage(pdfjs, await doc.getPage(t.planPage), { pageCount: doc.numPages, render: renderNode, ocr });
  await doc.loadingTask.destroy();
  return { ...out, t, scale: { pxPerM: out.analysis.scale.pxPerM!, source: "pdf" as const } };
}

/** The truth wall a plan wall matches (both ends within tol, either way round), or undefined. */
const sameWall = (w: { a: Vec2; b: Vec2 }, walls: Truth["planWalls"], tol: number) =>
  walls.find((t) => (d(w.a, t.a) <= tol && d(w.b, t.b) <= tol) || (d(w.a, t.b) <= tol && d(w.b, t.a) <= tol));

/** An opening's jambs on its wall's centre line. */
function jambs(plan: Plan, id: string): [Vec2, Vec2] {
  const o = plan.openings.find((x) => x.id === id)!;
  const w = plan.walls.find((x) => x.id === o.wallId)!;
  const L = wallLength(w);
  const at = (s: number) => ({ x: w.a.x + ((w.b.x - w.a.x) / L) * s, y: w.a.y + ((w.b.y - w.a.y) / L) * s });
  return [at(o.offset - o.width / 2), at(o.offset + o.width / 2)];
}

/** The truth as a Plan (walls only: rooms come from walls). */
const truthPlan = (t: Truth): Plan => ({
  id: "truth",
  name: "truth",
  units: "m",
  walls: t.planWalls.map((w) => ({ ...w, height: 2.7 })),
  openings: [],
  rooms: [],
  items: [],
  meta: { createdAt: "", updatedAt: "", source: "sample" },
});

// ---------------------------------------------------------------- synthetic pages (1 pt = 1 cm)

const K = 0.01; // metres per point in the synthetic pages
let pathNo = 0;
const seg = (x1: number, y1: number, x2: number, y2: number, o: Partial<PdfSegment> = {}): PdfSegment => ({ x1: x1 / K, y1: y1 / K, x2: x2 / K, y2: y2 / K, width: 0.5, filled: false, path: pathNo++, curve: false, ...o });
/** A wall as two stroked faces (metres): horizontal from x0 to x1 at y, thickness t. */
const hFaces = (x0: number, x1: number, y: number, t: number) => [seg(x0, y - t / 2, x1, y - t / 2), seg(x0, y + t / 2, x1, y + t / 2)];
const vFaces = (y0: number, y1: number, x: number, t: number) => [seg(x - t / 2, y0, x - t / 2, y1), seg(x + t / 2, y0, x + t / 2, y1)];
const walls = (segments: PdfSegment[]) => readVectorWalls({ segments }, K);

async function main() {
  // ------------------------------------------------------------ FAILING FIRST: traced versus snapped on plan-filled
  {
    const { analysis, pdf, t, scale } = await read("plan-filled.pdf");
    const traced = buildFromAnalysis(analysis, scale).plan;
    const lengthErr = (plan: Plan) =>
      t.planWalls.map((tw) => {
        // The plan wall nearest this true wall (by midpoint); the frames differ by under a pixel.
        const mid = (w: { a: Vec2; b: Vec2 }) => ({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 });
        const near = [...plan.walls].sort((p, q) => d(mid(p), mid(tw)) - d(mid(q), mid(tw)))[0];
        return Math.abs(wallLength(near) - wallLength(tw));
      });
    const before = Math.max(...lengthErr(traced));
    assert.ok(before > 0.004, `the traced plan has a wall more than 4 mm off: worst ${(before * 1000).toFixed(1)} mm`);
    const after = Math.max(...lengthErr(buildPdfPlan(analysis, pdf, scale).plan));
    assert.ok(after <= HALF_MM, `the snapped plan has every wall within 0.5 mm: worst ${(after * 1000).toFixed(3)} mm`);
    console.log(`failing first: plan-filled traced worst length error ${(before * 1000).toFixed(1)} mm (> 4 mm); snapped ${(after * 1000).toFixed(4)} mm`);
  }

  // ------------------------------------------------------------ exact on the clean fixtures
  for (const file of ["plan-filled.pdf", "plan-lines.pdf", "plan-rotated.pdf", "plan-imperial.pdf"]) {
    const { analysis, pdf, t, scale } = await read(file);
    const { plan, coverage: c } = buildPdfPlan(analysis, pdf, scale);
    assert.equal(plan.walls.length, t.planWalls.length, `${file}: ${plan.walls.length} walls`);
    for (const w of plan.walls) {
      const tw = sameWall(w, t.planWalls, HALF_MM);
      assert.ok(tw, `${file}: wall ${w.id} ${JSON.stringify(w.a)} → ${JSON.stringify(w.b)} is on a true centre line within 0.5 mm`);
      assert.ok(Math.abs(w.thickness - tw.thickness) <= HALF_MM, `${file}: wall ${w.id} thickness ${w.thickness} vs ${tw.thickness}`);
      assert.equal(w.provenance, "vector", `${file}: ${w.id} read from the PDF`);
    }
    assert.equal(c.exact, c.walls, `${file}: coverage ${c.exact} of ${c.walls}`);
    assert.ok(Math.abs(c.exactLengthM - c.lengthM) < 1e-9, `${file}: all wall length exact`);
    assert.deepEqual(validatePlan(plan), [], `${file}: validatePlan clean`);
    const areas = (p: Plan) => deriveRooms(p).map((r) => r.area).sort((x, y) => x - y);
    const [got, want] = [areas(plan), areas(truthPlan(t))];
    assert.equal(got.length, want.length, `${file}: ${got.length} rooms, want ${want.length}`);
    got.forEach((a, i) => assert.ok(Math.abs(a - want[i]) <= 1e-6, `${file}: room area ${a} vs ${want[i]} (${Math.abs(a - want[i]).toExponential(1)} m²)`));
    // Openings: each true one at its place within 0.5 mm (jambs on the centre line, so width and offset are too).
    let exact = 0;
    for (const to of t.planOpenings) {
      const hit = plan.openings.find((o) => {
        const [p, q] = jambs(plan, o.id);
        return o.kind === to.kind && ((d(p, to.a) <= HALF_MM && d(q, to.b) <= HALF_MM) || (d(p, to.b) <= HALF_MM && d(q, to.a) <= HALF_MM));
      });
      if (hit) exact++;
    }
    if (file === "plan-lines.pdf") {
      // The tracing made one door 1.54 m wide (a jamb absorbed into the T at I). Step M.1c: the PDF's openings are
      // primary, so the PDF's door replaces it (scripts/test-pdf-openings.ts shows it before and after), reported.
      assert.equal(exact, t.planOpenings.length, `${file}: every opening exact, the 1.54 m traced door replaced`);
      assert.equal(c.openings.traced, 0, `${file}: no opening traced`);
      assert.ok(c.notes.some((n) => /replaced by vo\d+ read from the PDF \(0\.90 m\): the traced jambs were up to \d+ mm out, more than 3 px/.test(n)), `${file}: and reported`);
    } else {
      assert.equal(exact, t.planOpenings.length, `${file}: every opening within 0.5 mm (${exact} of ${t.planOpenings.length})`);
      assert.equal(c.openings.snapped, t.planOpenings.length, `${file}: every traced opening snapped`);
    }
    console.log(`${file}: ${c.exact}/${c.walls} walls exact (${((100 * c.exactLengthM) / c.lengthM).toFixed(0)}% of length), ${got.length} rooms equal to 1e-6 m², openings ${exact}/${t.planOpenings.length} exact (snapped ${c.openings.snapped}, traced ${c.openings.traced}, added ${c.openings.added}), validator clean`);
  }

  // ------------------------------------------------------------ plan-clutter
  {
    const t = truth("plan-clutter.pdf");
    const doc = await openNode(new Uint8Array(readFileSync(join(DIR, t.file))));
    const vp = await extractVectorPage(pdfjs, await doc.getPage(1));
    const s = pdfScale(vp);
    const v = readVectorWalls(vp, s.mPerPt!);
    const o = { x: Math.min(...v.walls.flatMap((w) => [w.a.x, w.b.x])), y: Math.min(...v.walls.flatMap((w) => [w.a.y, w.b.y])) };
    const shifted = v.walls.map((w) => ({ a: { x: w.a.x - o.x, y: w.a.y - o.y }, b: { x: w.b.x - o.x, y: w.b.y - o.y } }));
    assert.equal(v.walls.length, t.planWalls.length, `clutter: ${v.walls.length} walls, want exactly the ${t.planWalls.length} real ones`);
    assert.ok(shifted.every((w) => sameWall(w, t.planWalls, HALF_MM)), "clutter: every wall read is a real wall");
    assert.equal(v.skipped.diagonal, t.diagonal, `clutter: the diagonal wall is counted (${v.skipped.diagonal})`);
    assert.equal(v.dropped.clutter, 3, `clutter: the table and the two tag boxes are dropped as clutter (${v.dropped.clutter})`);
    await doc.loadingTask.destroy();
    const { analysis, pdf, scale } = await read(t.file);
    const b = buildPdfPlan(analysis, pdf, scale);
    const vec = b.plan.walls.filter((w) => w.provenance === "vector");
    assert.equal(vec.length, t.planWalls.length, "clutter: the built plan has the 14 real walls from the PDF");
    assert.ok(vec.every((w) => sameWall(w, t.planWalls, HALF_MM)), "clutter: exact");
    assert.equal(b.coverage.skipped.diagonal, 1, "clutter: the report counts the diagonal wall");
    assert.deepEqual(validatePlan(b.plan).filter((p) => !b.report.problems.includes(p)), [], "clutter: no new problems");
    // Chromium's raster of the same page traces mostly noise (hatching and letters as walls, the bottom
    // wall's face line as a thin wall 8 px off): the PDF's walls still win, and the noise is left out.
    const cr = JSON.parse(readFileSync(join(DIR, "clutter-chromium-trace.json"), "utf8"));
    const crScale = { pxPerM: cr.analysis.pxPerM, source: "pdf" as const };
    const crTraced = buildPlan({ ...cr.analysis, imageSize: { width: 1, height: 1 }, name: "x" }, crScale);
    const crb = mergeVector(crTraced, cr.pdf.vectorWalls, { pxPerM: crScale.pxPerM, pxPerPt: cr.pdf.pxPerPt, labels: cr.analysis.labels, forceTraced: [] });
    assert.ok(crTraced.plan.walls.length > 50, `the Chromium trace is noise: ${crTraced.plan.walls.length} traced walls`);
    assert.ok(crb.coverage.exact === 14 && crb.coverage.walls === 14, `Chromium trace: 14 of ${crb.coverage.walls} walls exact`);
    assert.ok(crb.plan.walls.every((w) => sameWall(w, t.planWalls, HALF_MM)), "Chromium trace: exactly the real walls");
    assert.deepEqual(validatePlan(crb.plan), [], "Chromium trace: validator clean");
    assert.deepEqual(crb.plan.rooms.map((r) => r.name).sort(), ["Bathroom", "Bedroom 1", "Bedroom 2", "Living Room"], "Chromium trace: the four rooms, named");
    assert.equal(crb.plan.openings.length, 9, "Chromium trace: the nine openings, from the PDF");
    assert.ok(crb.coverage.notes.some((n) => n.includes("a face line of wall")) && crb.coverage.notes.some((n) => n.includes("not joined to any wall read from the PDF")), "the face line and the loose noise are reported");
    console.log(
      `plan-clutter.pdf: ${v.walls.length} real walls read, 1 diagonal counted, ${v.dropped.clutter} clutter pairs dropped (${v.dropped.inside} inside wider pairs, ${v.dropped.short} short); built: ${vec.length} exact, ${b.coverage.traced} traced (${b.coverage.tracedWalls.map((w) => w.reason).join("; ") || "none"}), ${b.plan.rooms.length} rooms`,
    );
  }

  // ------------------------------------------------------------ plan-single-line: a wall only the tracing can see
  {
    const { analysis, pdf, t, scale } = await read("plan-single-line.pdf");
    assert.equal(pdf.vectorWalls!.walls.length, 12, "single line: the PDF's faces give 12 walls (w-KM is one line, so the east wall is not split at M)");
    const b = buildPdfPlan(analysis, pdf, scale);
    const c = b.coverage;
    const px = 1 / scale.pxPerM;
    assert.ok(c.traced >= 1 && c.exact + c.traced === t.planWalls.length, `single line: ${c.exact} exact + ${c.traced} traced`);
    const km = t.planWalls.find((w) => w.id === "w-KM")!;
    assert.ok(c.tracedWalls.some((w) => sameWall(w, [km], 4 * px)), "single line: w-KM is traced, within 4 px of the truth");
    // A PDF wall a traced one meets is split at that (traced) joint, so: every end on a true centre line within 0.5 mm.
    const toLine = (p: Vec2) =>
      Math.min(
        ...t.planWalls.map((w) => {
          const L = d(w.a, w.b);
          const k = Math.max(0, Math.min(L, ((p.x - w.a.x) * (w.b.x - w.a.x) + (p.y - w.a.y) * (w.b.y - w.a.y)) / L));
          return d(p, { x: w.a.x + ((w.b.x - w.a.x) / L) * k, y: w.a.y + ((w.b.y - w.a.y) / L) * k });
        }),
      );
    assert.ok(b.plan.walls.filter((w) => w.provenance === "vector").every((w) => toLine(w.a) <= HALF_MM && toLine(w.b) <= HALF_MM), "single line: the walls from the PDF lie on true centre lines");
    assert.ok(b.plan.walls.filter((w) => w.provenance === "traced").every((w) => sameWall(w, t.planWalls, 4 * px)), "single line: the traced walls within 4 px");
    assert.deepEqual(validatePlan(b.plan), [], "single line: validator clean");
    assert.deepEqual(b.plan.rooms.map((r) => r.name).sort(), ["Bathroom", "Bedroom 1", "Bedroom 2", "Living Room"], "single line: the four rooms");
    console.log(`plan-single-line.pdf: ${c.exact} exact, ${c.traced} traced (${c.tracedWalls.map((w) => `${w.id}: ${w.reason}`).join("; ")}); notes: ${c.notes.join(" | ")}`);
  }

  // ------------------------------------------------------------ pairing rules
  {
    for (const [gap, n] of [[0.05, 1], [0.6, 1], [0.04, 0], [0.61, 0]] as const) {
      const r = walls(hFaces(0, 5, 1, gap));
      assert.equal(r.walls.length, n, `gap ${gap}: ${n} wall`);
      if (n) assert.ok(Math.abs(r.walls[0].thickness - gap) < 1e-9 && Math.abs(r.walls[0].a.y - 1) < 1e-9, `gap ${gap}: thickness is the gap, centre midway`);
    }
    // Overlap: a 5 m and a 3 m face; 60% of the shorter (1.8 m) pairs, 59% (1.77 m) doesn't.
    for (const [ov, n] of [[1.8, 1], [1.77, 0]] as const) {
      const r = walls([seg(0, 0, 5, 0), seg(5 - ov, 0.2, 5 - ov + 3, 0.2)]);
      assert.equal(r.walls.length, n, `overlap ${ov} m of 3 m: ${n} wall`);
      if (n) assert.ok(Math.abs(wallLength(r.walls[0]) - ov) < 1e-9, "the piece spans the overlap");
    }
    // A filled rectangle is a pair as it stands (even with a stroke line on one face).
    const rect = (x0: number, y0: number, x1: number, y1: number) => {
      const path = pathNo++;
      return [seg(x0, y0, x1, y0, { filled: true, path, width: 0 }), seg(x1, y0, x1, y1, { filled: true, path, width: 0 }), seg(x1, y1, x0, y1, { filled: true, path, width: 0 }), seg(x0, y1, x0, y0, { filled: true, path, width: 0 })];
    };
    const r1 = walls(rect(0, 0, 4, 0.25));
    assert.equal(r1.walls.length, 1, "filled rectangle: one wall");
    assert.ok(Math.abs(r1.walls[0].thickness - 0.25) < 1e-9 && Math.abs(r1.walls[0].a.y - 0.125) < 1e-9, "filled rectangle: its short side is the thickness");
    // Widest wins: frame lines at ±0.1 and a 1.2 m glass line at 0 on a 5 m wall give one 0.2 m wall with a window.
    const r2 = walls([...hFaces(0, 5, 0, 0.2), seg(2, 0, 3.2, 0)]);
    assert.equal(r2.walls.length, 1, "glass line: still one wall");
    assert.ok(Math.abs(r2.walls[0].thickness - 0.2) < 1e-9, "the widest pair wins");
    assert.equal(r2.openings.length, 1, "the glass line inside the wall is a window");
    assert.ok(r2.openings[0].kind === "window" && Math.abs(r2.openings[0].width - 1.2) < 1e-9 && Math.abs(r2.openings[0].offset - 2.6) < 1e-9, "window over the glass line's span");
    // A door: two pieces on one line 0.9 m apart are one wall with a door in the gap.
    const r3 = walls([...hFaces(0, 2, 0, 0.2), ...hFaces(2.9, 5, 0, 0.2)]);
    assert.equal(r3.walls.length, 1, "door gap: bridged into one wall");
    assert.ok(r3.openings[0].kind === "door" && Math.abs(r3.openings[0].width - 0.9) < 1e-9 && Math.abs(r3.openings[0].offset - 2.45) < 1e-9, "door: exact gap");
    // Clutter: a lone 1.2 m pair is dropped; a lone 1.6 m pair is kept.
    assert.equal(walls(hFaces(0, 1.2, 0, 0.5)).walls.length, 0, "lone 1.2 m pair: clutter");
    assert.equal(walls(hFaces(0, 1.6, 0, 0.5)).walls.length, 1, "lone 1.6 m pair: a wall");
    assert.equal(walls(hFaces(0, 0.39, 0, 0.1)).dropped.short + walls(hFaces(0, 0.39, 0, 0.1)).walls.length, 1, "a 0.39 m pair is short");
    console.log("pairing: gap 0.05/0.60 pair, 0.04/0.61 don't; 60% overlap pairs, 59% doesn't; filled rectangles; widest wins; glass line = window; door gaps; clutter");

    // Joints: an L (faces stopping at the inner corner), a T (stem stopping at the host's face) and a crossing.
    const L = walls([...hFaces(0.1, 5, 0, 0.2), seg(-0.1, -0.1, 5, -0.1), ...vFaces(0.1, 4, 0, 0.2), seg(-0.1, -0.1, -0.1, 4)]);
    assert.equal(L.walls.length, 2, "L: two walls");
    assert.ok(L.walls.every((w) => d(w.a, { x: 0, y: 0 }) < 1e-9), `L: both start at the centre-line corner: ${JSON.stringify(L.walls.map((w) => w.a))}`);
    const T = walls([...hFaces(0, 6, 0, 0.2), ...vFaces(0.1, 3, 2.5, 0.1)]);
    assert.equal(T.walls.length, 3, `T: the host is split at the stem (${T.walls.length} walls)`);
    assert.ok(T.walls.filter((w) => w.a.y === 0 && w.b.y === 0).some((w) => w.b.x === 2.5) && T.walls.some((w) => w.a.x === 2.5 && w.a.y === 0 && w.b.y === 3), "T: the joint is an end of all three walls");
    const X = walls([...hFaces(0, 6, 2, 0.2), ...vFaces(0, 4, 3, 0.2)]);
    assert.equal(X.walls.length, 4, "crossing: both walls split");
    assert.equal(X.walls.filter((w) => d(w.a, { x: 3, y: 2 }) < 1e-9 || d(w.b, { x: 3, y: 2 }) < 1e-9).length, 4, "crossing: all four meet at the crossing");
    console.log("joints: L to the centre-line corner, T splits the host, a crossing splits both");
  }

  // ------------------------------------------------------------ snapping on synthetic plans (1 px = 1 cm)
  {
    const PX = 0.01;
    const square = (dy = 0, extra: Wall[] = []): Wall[] => [
      { id: "n", a: { x: 0, y: dy }, b: { x: 4, y: dy }, thickness: 0.2, height: 2.7 },
      { id: "e", a: { x: 4, y: 0 }, b: { x: 4, y: 4 }, thickness: 0.2, height: 2.7 },
      { id: "s", a: { x: 0, y: 4 }, b: { x: 4, y: 4 }, thickness: 0.2, height: 2.7 },
      { id: "w", a: { x: 0, y: 0 }, b: { x: 0, y: 4 }, thickness: 0.2, height: 2.7 },
      ...extra,
    ];
    const vector = (ws: Wall[]): VectorWalls => ({ mPerPt: 0.01, walls: ws.map((w) => ({ ...w, id: `v-${w.id}`, provenance: "vector" })), openings: [], skipped: { diagonal: 0, curved: 0 }, dropped: { short: 0, clutter: 0, inside: 0, openingsCut: 0 }, clutter: [] });
    const tracedOf = (ws: Wall[]) => {
      const plan: Plan = { id: "t", name: "t", units: "m", walls: ws, openings: [], rooms: [], items: [], meta: { createdAt: "", updatedAt: "", source: "blueprint" } };
      const report: BuildReport = { scale: { pxPerM: 100, source: "pdf" }, origin: { x: 0, y: 0 }, wideOpenings: [], droppedPairs: [], unbridged: [], removedWalls: [], thickness: [], adjusted: [], freeEnds: [], problems: validatePlan(plan) };
      return { plan, report };
    };
    // The north wall traced dy pixels off the PDF's line; the joints stay where they are.
    const tracedSquare = (dyPx: number) => {
      const ws = square();
      const n = ws[0];
      n.a = { x: 0, y: dyPx * PX };
      n.b = { x: 4, y: dyPx * PX };
      return ws;
    };
    const merge = (traced: Wall[], vec: Wall[]) => mergeVector(tracedOf(traced), vector(vec), { pxPerM: 100, pxPerPt: 1, labels: [], forceTraced: [] });
    const a = merge(tracedSquare(1.5), square());
    assert.equal(a.coverage.exact, 4, "1.5 px: every wall snaps");
    const b = merge(tracedSquare(2.5), square());
    assert.equal(b.coverage.traced, 1, "2.5 px: the north wall stays traced");
    assert.match(b.coverage.tracedWalls[0].reason, /the PDF's line is 25 mm away, more than 2 px/, "with its reason");
    assert.deepEqual(validatePlan(b.plan), [], "2.5 px: its ends join the PDF's corners (within 3 px), so the plan is clean");
    // An end 5 px past the PDF's wall: snapping would move it 5 px.
    const long = square();
    long[0] = { ...long[0], b: { x: 4.05, y: 0 } };
    const c = merge(long, square());
    assert.ok(c.coverage.tracedWalls.some((w) => /snapping would move an end 50 mm, more than 3 px/.test(w.reason)), `an end 5 px out stays traced: ${JSON.stringify(c.coverage.tracedWalls.map((w) => w.reason))}`);
    // No traced end moves more than 3 px: every traced end lies within 3 px of the final plan's walls.
    for (const [m, traced] of [[a, tracedSquare(1.5)], [b, tracedSquare(2.5)], [c, long]] as const) {
      const ends = traced.flatMap((w) => [w.a, w.b]);
      const toLine = (p: Vec2, w: Wall) => {
        const L = wallLength(w);
        const t = Math.max(0, Math.min(L, ((p.x - w.a.x) * (w.b.x - w.a.x) + (p.y - w.a.y) * (w.b.y - w.a.y)) / L));
        return d(p, { x: w.a.x + ((w.b.x - w.a.x) / L) * t, y: w.a.y + ((w.b.y - w.a.y) / L) * t });
      };
      const moved = Math.max(...ends.map((p) => Math.min(...m.plan.walls.map((w) => toLine({ x: p.x - m.coverage.origin.x, y: p.y - m.coverage.origin.y }, w)))));
      assert.ok(moved <= 3 * PX + 1e-9, `no end moves more than 3 px: ${(moved / PX).toFixed(2)} px`);
    }
    // A wall in the PDF the tracing lacks, with a free end: it would add a validator problem, so it is left out with the reason.
    const stub: Wall = { id: "stub", a: { x: 2, y: 1 }, b: { x: 2, y: 3 }, thickness: 0.1, height: 2.7 };
    const e = merge(square(), [...square(), stub]);
    assert.ok(!e.plan.walls.some((w) => w.id === "v-stub"), "the stub with a free end is left out");
    assert.ok(e.coverage.notes.some((n) => /Wall v-stub from the PDF was not used .*isn't shared with any other wall/.test(n)), `with its reason: ${e.coverage.notes.join(" | ")}`);
    assert.deepEqual(validatePlan(e.plan), [], "and the plan stays clean");
    console.log(`snapping: 1.5 px snaps, 2.5 px kept traced ("${b.coverage.tracedWalls[0].reason}"), 5 px end kept traced, never more than 3 px; a stub that breaks the validator is left out`);
  }

  // ------------------------------------------------------------ dimensions: broken lines, ticks, overshoot
  {
    const t = truth("plan-broken-dims.pdf");
    const doc = await openNode(new Uint8Array(readFileSync(join(DIR, t.file))));
    const vp = await extractVectorPage(pdfjs, await doc.getPage(1));
    const s = pdfScale(vp);
    assert.equal(s.rejected.length, 0, `broken dims: every text found its line (${JSON.stringify(s.rejected)})`);
    assert.equal(s.matches.length, t.dims.length, "broken dims: one match per dimension");
    assert.equal(s.confidence, "good", "broken dims: scale good");
    for (const m of s.matches) {
      const want = t.dims.find((x) => x.text === m.text && Math.abs(x.lengthPt - m.lengthPt) < 0.01);
      assert.ok(want, `broken dims: "${m.text}" measured ${m.lengthPt.toFixed(3)} pt, the true ${t.dims.filter((x) => x.text === m.text).map((x) => x.lengthPt.toFixed(3))}`);
      assert.equal(m.measure, want.measure, `"${m.text}": ${m.measure}`);
    }
    const over = t.dims.find((x) => x.lineLengthPt! - x.lengthPt > 0.1)!;
    const lineOf = (x: (typeof s.matches)[number]) => Math.hypot(x.line.x2 - x.line.x1, x.line.y2 - x.line.y1);
    const m = s.matches.find((x) => x.text === over.text && Math.abs(lineOf(x) - over.lineLengthPt!) < 0.01);
    assert.ok(m && m.measure === "ticks", "the overshooting line (drawn 10 mm long) is found, measured between its ticks");
    const lineLen = lineOf(m);
    const rows = dimensionRows(s.matches, s.mPerPt!);
    const row = rows[s.matches.indexOf(m)];
    assert.ok(row.status === "ok" && Math.abs(row.diffMm) < 0.1, `between the ticks it is exact (${row.diffMm.toFixed(3)} mm)`);
    assert.ok(Math.abs((lineLen * s.mPerPt! - m.metres) * 1000 - 10) < 0.1, "by its line length it would be 10 mm over (flagged)");
    assert.equal(row.how, "between ticks");
    assert.equal(rows.find((r) => r.text === "10000 mm")!.how, "line length", "the overall line has no ticks: line length");
    // The M.1a fixtures' extension lines count as ticks; nothing changes in their lengths.
    const filled = pdfScale(await extractVectorPage(pdfjs, await (await openNode(new Uint8Array(readFileSync(join(DIR, "plan-filled.pdf"))))).getPage(1)));
    assert.ok(filled.matches.every((x) => x.measure === "ticks" && x.source === "pdf"), "plan-filled: measured between its extension lines");
    console.log(`broken dims: ${s.matches.length} lines broken around their text read; "${over.text}" overshoots its ticks by 5 mm each end and is measured between them (${row.diffMm.toFixed(3)} mm), the overall line by its length`);
    await doc.loadingTask.destroy();
  }

  // ------------------------------------------------------------ OCR on an outlined page
  {
    const t = truth("plan-outlined.pdf");
    const doc = await openNode(new Uint8Array(readFileSync(join(DIR, t.file))));
    const page = await doc.getPage(1);
    const k = scanRasterScale(await extractVectorPage(pdfjs, page));
    // Words where plan-filled prints its texts, as OCR would box them (glyph box = 0.72 of the font size).
    const box = (x: { str: string; x: number; y: number; rotation: number; height: number; width: number }): OcrWord =>
      x.rotation === 0
        ? { text: x.str, confidence: 95, box: { x0: x.x * k, y0: (x.y - 0.72 * x.height) * k, x1: (x.x + x.width) * k, y1: x.y * k } }
        : { text: x.str, confidence: 95, vertical: true, box: { x0: (x.x - 0.72 * x.height) * k, y0: (x.y - x.width) * k, x1: x.x * k, y1: x.y * k } };
    const printed = truth("plan-filled.pdf").texts;
    const ocrOf = (words: OcrWord[]) => async (): Promise<OcrResult> => ({ labels: [], words, error: null, rereads: [] });
    const titleOnly = await analysePdfPage(pdfjs, page, { pageCount: 1, render: renderNode, ocr: ocrOf(printed.filter((x) => x.str === "SCALE 1:100").map(box)) });
    assert.ok(titleOnly.pdf.ocrText, "outlined: read by OCR");
    assert.equal(titleOnly.pdf.scale!.confidence, "check", "OCR with only the title block: check, never good");
    const all = await analysePdfPage(pdfjs, page, { pageCount: 1, render: renderNode, ocr: ocrOf(printed.map(box)) });
    const s = all.pdf.scale!;
    assert.equal(s.confidence, "good", `OCR at the printed places: good (${s.reason})`);
    assert.equal(s.matches.length, t.dims.length, "every dimension matched");
    assert.ok(s.matches.every((x) => x.source === "ocr"), "every match is labelled OCR");
    assert.ok(dimensionRows(s.matches, s.mPerPt!).every((r) => r.how === "between ticks, read by OCR" && r.status === "ok"), "every row says read by OCR, and is OK");
    assert.ok(all.pdf.notes.some((n) => n.startsWith("The text on this page is drawn as shapes, so it was read by OCR")), "the PDF panel says so");
    const b = buildPdfPlan(all.analysis, all.pdf, { pxPerM: all.analysis.scale.pxPerM!, source: "pdf" });
    assert.equal(b.coverage.exact, t.planWalls.length, "outlined: the walls are still read exactly");
    console.log(`outlined (OCR words placed where the text is printed): title block alone ${titleOnly.pdf.scale!.confidence}; all words ${s.confidence}, ${s.matches.length} rows "read by OCR", ${b.coverage.exact}/${b.coverage.walls} walls exact`);
    if (existsSync(join(__dirname, "../public/tesseract/eng.traineddata.gz"))) {
      const t0 = Date.now();
      const real = await analysePdfPage(pdfjs, page, { pageCount: 1, render: renderNode });
      const rs = real.pdf.scale!;
      assert.ok(real.pdf.ocrText && rs.matches.length === t.dims.length && rs.matches.every((x) => x.source === "ocr"), `real OCR: ${rs.matches.length} of ${t.dims.length} dimensions read`);
      assert.equal(rs.confidence, "good", `real OCR: ${rs.reason}`);
      const rb = buildPdfPlan(real.analysis, real.pdf, { pxPerM: real.analysis.scale.pxPerM!, source: "pdf" });
      console.log(`outlined, real tesseract: ${rs.matches.length}/${t.dims.length} dimensions read by OCR, scale ${rs.confidence}; rooms ${rb.plan.rooms.map((r) => r.name).join(", ")}; ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    } else console.log("outlined, real tesseract: skipped (public/tesseract/eng.traineddata.gz is missing)");
    await doc.loadingTask.destroy();
  }

  // ------------------------------------------------------------ model versus printed
  {
    const { analysis, pdf, scale } = await read("plan-filled.pdf");
    const b = buildPdfPlan(analysis, pdf, scale);
    const toPlan = (x: number, y: number) => ({ x: x * b.coverage.mPerPt - b.coverage.origin.x, y: y * b.coverage.mPerPt - b.coverage.origin.y });
    const tol = (3 * b.coverage.traceMm) / 1000;
    const rows = modelRows(pdf.scale!.matches, b.plan, toPlan, tol);
    assert.equal(rows.length, pdf.scale!.matches.length, "every printed dimension lands on the model");
    assert.ok(rows.every((r) => r.spans === "centre to centre" && r.status === "ok" && Math.abs(r.diffMm) <= 0.5 && !r.approximate), `centre to centre, OK to 0.5 mm: ${rows.map((r) => `${r.spans} ${r.diffMm.toFixed(3)}`).join("; ")}`);
    // A misprint is flagged in the model check too, and an override keeps the model's value.
    const wrong = pdf.scale!.matches.map((m, i) => (i === 0 ? { ...m, text: "4100 mm", metres: 4.1 } : m));
    const flagged = modelRows(wrong, b.plan, toPlan, tol);
    assert.equal(flagged[0].status, "flagged", "a misprint is flagged against the model");
    const over = modelRows(wrong, b.plan, toPlan, tol, { 0: { valueM: 4, note: "Drafting error" } });
    assert.ok(over[0].status === "overridden" && over[0].measuredM === flagged[0].measuredM, "an override keeps the model's length beside it");
    // Traced walls make a row approximate.
    const tracedB = buildPdfPlan(analysis, pdf, scale, { forceTraced: pdf.vectorWalls!.walls.map((w) => w.id) });
    assert.ok(tracedB.coverage.exact === 0 && tracedB.plan.walls.every((w) => w.provenance === "traced"), "all forced back to traced");
    const approx = modelRows(pdf.scale!.matches, tracedB.plan, (x, y) => ({ x: x * tracedB.coverage.mPerPt - tracedB.coverage.origin.x, y: y * tracedB.coverage.mPerPt - tracedB.coverage.origin.y }), tol);
    assert.ok(approx.length > 0 && approx.every((r) => r.approximate), "rows on traced walls say approximate");
    // Inside faces: a dimension from one wall's inside face to the opposite wall's.
    const inside = modelRows([{ ...pdf.scale!.matches[0], ends: { x1: (0.1 + b.coverage.origin.x) / b.coverage.mPerPt, y1: 0, x2: (3.95 + b.coverage.origin.x) / b.coverage.mPerPt, y2: 0 }, metres: 3.85 }], b.plan, toPlan, tol);
    assert.ok(inside[0]?.spans === "inside faces" && Math.abs(inside[0].diffMm) < 0.5, `inside faces: ${JSON.stringify(inside[0]?.spans)} ${inside[0]?.diffMm}`);
    const csv = rowsToCsv(dimensionRows(pdf.scale!.matches, pdf.scale!.mPerPt!), over);
    assert.ok(csv.includes("\nmodel versus printed\n") && csv.includes(",centre to centre,no,Overridden,4000.0,Drafting error"), "both checks reach the CSV");
    console.log(`model versus printed: ${rows.length} rows centre to centre, worst ${Math.max(...rows.map((r) => Math.abs(r.diffMm))).toFixed(4)} mm; misprint flagged; traced rows approximate; inside faces; CSV has both`);
  }

  // ------------------------------------------------------------ the store keeps provenance and marks edits
  {
    const { analysis, pdf, scale } = await read("plan-filled.pdf");
    const { plan } = buildPdfPlan(analysis, pdf, scale);
    const st = () => usePlanStore.getState();
    st().loadPlan(plan);
    const w = st().plan.walls[0];
    assert.ok(w.provenance === "vector" && !w.edited, "loaded: read from the PDF, not edited");
    st().updateWall(w.id, { height: 3 });
    const after = st().plan.walls.find((x) => x.id === w.id)!;
    assert.ok(after.provenance === "vector" && after.edited === true, "edited: provenance kept, marked edited");
    assert.ok(st().plan.walls.filter((x) => x.id !== w.id).every((x) => !x.edited), "only that wall");
    st().undo();
    assert.ok(!st().plan.walls[0].edited, "undo takes the mark away with the edit");
    console.log("store: an edited PDF wall keeps its provenance and says edited; undo clears it");
  }
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
