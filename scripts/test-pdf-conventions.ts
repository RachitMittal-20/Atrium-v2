/**
 * test-pdf-conventions.ts — step Q.1: general CAD-drawing conventions the vector PDF reader
 * follows, each proven on its own SYNTHETIC fixture (scripts/make-pdf-fixtures.ts, truth.json)
 * that reproduces one class of failure seen on a ChatGPT-generated plan
 * (tests/fixtures/pdf/plan-chatgpt-flat.pdf, scripts/test-pdf-chatgpt.ts). Every section was
 * written first and seen failing on the code before its rule.
 *
 *   1. A stated unit (scale.ts): a general note "ALL DIMENSIONS IN mm" (mm, cm or m) makes bare
 *      numbers on dimension lines real dimensions (plan-bare-mm), including text reading bottom
 *      to top; a feet-and-inches note does not, and with no note they stay in the "Feet or
 *      metres?" route.
 *   2. Dimensions are annotation (scale.ts + walls.ts): the line a dimension labels (its length
 *      agreeing with the page's scale) and its extension lines (perpendicular, ending on the
 *      line's end without crossing it) are never wall faces (plan-dims-close: strings 0.35 m and
 *      0.6 m off the faces, stacked, extension lines starting on the faces, and one across a room
 *      whose ends sit on the faces it measures, which must stay walls).
 *   3. No line runs through a wall (walls.ts): two faces don't pair when a line between them is
 *      itself the face of a wall carrying on past them, further than their own gap
 *      (plan-against-wall: a bath 5 cm off a wall pairs across the wall's inner face and swallowed
 *      the wall). A centre line or a pipe drawn lengthwise through a wall must not cost the wall:
 *      on the fixture (a centre line 0.4 m past both ends) and on synthetic pages with an inner
 *      face shortened at both corners, as a generated plan draws it. KNOWN FAILURES, asserted and
 *      printed: an off-centre line along a whole wall past its ends costs the wall; a centre line
 *      collinear with a window's middle glazing line hides that window.
 *   4. A gap is closed only across the whole wall (walls.ts): a parallel piece stops a door or
 *      window gap being bridged only when it covers the wall's whole thickness; one sharing only a
 *      line drawn inside the opening (glazing) does not (plan-window-board: three glazing lines
 *      in a real gap, an interior window board drawn as one line in front, pairing with them).
 *   5. A swing ends at the strike jamb (walls.ts): M.1b's leaf rule (a straight line up to 1.5 m
 *      with an end on a curve's end) now applies only to curves that are not a recognised arc,
 *      whose leaf openings.ts finds exactly; it threw away the short wall face that begins where a
 *      swing arc ends (plan-strike-jamb: two doors 0.8 m apart, a leaf drawn shut).
 *   6. Small loops are furniture (walls.ts): a closed loop of walls whose inside is under 1 m² or
 *      narrower than 0.6 m loses its walls, except any whose own straight run carries on past the
 *      loop (the room wall a cupboard stands in), then walls left joined only to dropped walls go
 *      too, and the walls are joined again (plan-furniture: a corner cupboard of two thin
 *      partitions). Reported with its size and place.
 *   7. Islands are furniture (walls.ts): a group of walls joined to nothing else and lying inside
 *      the building's outline (sofa, bed, bath, a stroked 0.5 m column) is dropped and reported
 *      with its size and place, as is a lone short piece (the M.1b clutter rule: a filled 0.5 m
 *      column), so nothing is lost silently; the review screen lists them (snap.ts Coverage).
 *   8. A complete PDF reading stands on its own (snap.ts): when the merge kept any traced wall (or
 *      fell back to the tracing) but the PDF's walls alone make a plan with a clean validator, no
 *      free ends and at least one room, that plan is used, and the review says "Walls read entirely
 *      from the PDF; the picture tracing was not used." The tracing of plan-dims-close and
 *      plan-window-board fuses the annotation near the walls into walls 37–262 mm off, which kept
 *      their groups traced. plan-single-line (a wall the PDF draws as one line) still merges.
 *   9. A face bounds a wall on one side only (walls.ts; added in Q.1 beyond the agreed list): where
 *      two pairs use one line as a face from opposite sides over the same stretch, the longer is the
 *      wall and the shorter something standing against it (plan-against-wall: the bath's edges
 *      0.5–0.55 m from the faces of the walls beside it, T-joined to the east wall).
 *
 * Run: npx tsx scripts/test-pdf-conventions.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analysePdfPage } from "../src/lib/pdf/analysePdf";
import { dimensionRows } from "../src/lib/pdf/dimensions";
import { buildPdfPlan } from "../src/lib/pdf/snap";
import { readVectorWalls } from "../src/lib/pdf/walls";
import type { Vec2 } from "../src/types/plan";
import type { PdfSegment } from "../src/types/pdf";
import { extractVectorPage } from "../src/lib/pdf/extract";
import { pdfScale } from "../src/lib/pdf/scale";
import type { VectorPage } from "../src/types/pdf";
import type { Truth } from "./make-pdf-fixtures";
import { openNode, pdfjs, renderNode } from "./pdf-node";

const DIR = join(__dirname, "../tests/fixtures/pdf");
const truths: Truth[] = JSON.parse(readFileSync(join(DIR, "truth.json"), "utf8"));
const truth = (file: string) => truths.find((t) => t.file === file)!;

async function page(file: string): Promise<VectorPage> {
  const doc = await openNode(new Uint8Array(readFileSync(join(DIR, file))));
  const v = await extractVectorPage(pdfjs, await doc.getPage(truth(file).planPage));
  await doc.loadingTask.destroy();
  return v;
}

const HALF_MM = 0.0005;
const d = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.y - q.y);
/** The truth wall a plan wall matches (both ends within tol, either way round), or undefined. */
const sameWall = (w: { a: Vec2; b: Vec2; thickness: number }, walls: Truth["planWalls"], tol = HALF_MM) =>
  walls.find((t) => ((d(w.a, t.a) <= tol && d(w.b, t.b) <= tol) || (d(w.a, t.b) <= tol && d(w.b, t.a) <= tol)) && Math.abs(w.thickness - t.thickness) <= tol);

/** Distance from p to the segment ab. */
function toSegment(p: Vec2, s: { a: Vec2; b: Vec2 }): number {
  const [dx, dy] = [s.b.x - s.a.x, s.b.y - s.a.y];
  const k = Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - s.a.x - dx * k, p.y - s.a.y - dy * k);
}

/** True when walls on tw's centre line, at its thickness, cover it end to end (they may be split). */
function covered(tw: Truth["planWalls"][number], walls: { a: Vec2; b: Vec2; thickness: number }[]): boolean {
  const h = Math.abs(tw.a.y - tw.b.y) < 1e-9;
  const along = (p: Vec2) => (h ? p.x : p.y);
  const across = (p: Vec2) => (h ? p.y : p.x);
  const spans = walls
    .filter((w) => Math.abs(w.thickness - tw.thickness) <= HALF_MM && [w.a, w.b].every((p) => Math.abs(across(p) - across(tw.a)) <= HALF_MM))
    .map((w) => [along(w.a), along(w.b)].sort((p, q) => p - q))
    .sort((p, q) => p[0] - q[0]);
  const [s0, s1] = [along(tw.a), along(tw.b)].sort((p, q) => p - q);
  let reach = s0;
  for (const [a, b] of spans) if (a <= reach + HALF_MM) reach = Math.max(reach, b);
  return reach >= s1 - HALF_MM;
}

/** A VectorWalls reading moved to the truth's frame: walls and openings by the walls' origin. */
function vectorFrame(vw: { walls: { a: Vec2; b: Vec2; thickness: number }[]; openings: { a: Vec2; b: Vec2; kind: string; class?: string; hingeEnd?: "a" | "b"; swingNormal?: Vec2; wallId: string }[] }) {
  const o = { x: Math.min(...vw.walls.flatMap((w) => [w.a.x, w.b.x])), y: Math.min(...vw.walls.flatMap((w) => [w.a.y, w.b.y])) };
  const sh = (p: Vec2) => ({ x: p.x - o.x, y: p.y - o.y });
  return { walls: vw.walls.map((w) => ({ ...w, a: sh(w.a), b: sh(w.b) })), openings: vw.openings.map((op) => ({ ...op, a: sh(op.a), b: sh(op.b) })) };
}

/** Every true opening read from the PDF: kind, class, both jambs within 0.5 mm, and a door's hinge jamb and side. */
function exactOpenings(file: string, ops: ReturnType<typeof vectorFrame>["openings"]): string[] {
  const t = truth(file);
  const wrong: string[] = [];
  for (const to of t.planOpenings) {
    const op = ops.find((x) => (d(x.a, to.a) <= HALF_MM && d(x.b, to.b) <= HALF_MM) || (d(x.a, to.b) <= HALF_MM && d(x.b, to.a) <= HALF_MM));
    if (!op) wrong.push(`${to.id}: not read`);
    else if (op.kind !== to.kind || (to.class && op.class !== to.class)) wrong.push(`${to.id}: ${op.kind}/${op.class}, not ${to.kind}/${to.class}`);
    else if (to.hingeEnd && op.hingeEnd !== to.hingeEnd) wrong.push(`${to.id}: hinge ${op.hingeEnd}, not ${to.hingeEnd}`);
    else if (to.side && (!op.swingNormal || op.swingNormal.x * to.side.x + op.swingNormal.y * to.side.y < 0.99)) wrong.push(`${to.id}: opens to the wrong side`);
  }
  return wrong;
}

/** Walls in page metres moved to the truth's frame (origin at their centre lines' top-left). */
function toTruthFrame<W extends { a: Vec2; b: Vec2 }>(walls: W[]): W[] {
  const o = { x: Math.min(...walls.flatMap((w) => [w.a.x, w.b.x])), y: Math.min(...walls.flatMap((w) => [w.a.y, w.b.y])) };
  return walls.map((w) => ({ ...w, a: { x: w.a.x - o.x, y: w.a.y - o.y }, b: { x: w.b.x - o.x, y: w.b.y - o.y } }));
}

/** Analyse and build a fixture as the import page does (no OCR: the PDF's own text). */
async function build(file: string) {
  const doc = await openNode(new Uint8Array(readFileSync(join(DIR, file))));
  const out = await analysePdfPage(pdfjs, await doc.getPage(truth(file).planPage), { pageCount: doc.numPages, render: renderNode, ocr: async () => ({ labels: [], words: [], error: null, rereads: [] }) });
  await doc.loadingTask.destroy();
  return { ...out, b: buildPdfPlan(out.analysis, out.pdf, { pxPerM: out.analysis.scale.pxPerM!, source: "pdf" }) };
}

/** Every wall built is a true wall, every true wall is built, all read from the PDF. */
function exactWalls(file: string, b: Awaited<ReturnType<typeof build>>["b"]) {
  const t = truth(file);
  const wrong = b.plan.walls.filter((w) => !sameWall(w, t.planWalls));
  assert.deepEqual(wrong.map((w) => `${w.id} ${w.provenance} (${w.a.x.toFixed(3)}, ${w.a.y.toFixed(3)})-(${w.b.x.toFixed(3)}, ${w.b.y.toFixed(3)}) t ${w.thickness}`), [], `${file}: every wall built is a true wall`);
  const missing = t.planWalls.filter((tw) => !b.plan.walls.some((w) => sameWall(w, [tw])));
  assert.deepEqual(missing.map((w) => w.id), [], `${file}: every true wall is built`);
  assert.ok(b.coverage.exact === t.planWalls.length && b.coverage.traced === 0, `${file}: ${b.coverage.exact} of ${b.coverage.walls} exact`);
}

async function main() {
  // ------------------------------------------------------------ 1. a stated unit makes bare numbers dimensions
  {
    const t = truth("plan-bare-mm.pdf");
    const v = await page(t.file);
    const s = pdfScale(v);
    assert.equal(s.matches.length, t.dims.length, `bare mm: every bare number is a dimension row (${s.matches.length} of ${t.dims.length})`);
    assert.equal(s.confidence, "good", `bare mm: the scale is good (${s.reason})`);
    assert.ok(Math.abs(s.mPerPt! - t.mPerPt) / t.mPerPt < 1e-5, `bare mm: the scale is the true one (${s.mPerPt} vs ${t.mPerPt})`);
    assert.ok(dimensionRows(s.matches, s.mPerPt!).every((r) => r.status === "ok"), "bare mm: every row OK");
    const rotated = s.matches.filter((m) => Math.abs(m.line.x2 - m.line.x1) < 1e-6).length;
    assert.ok(rotated >= 5, `bare mm: the vertical dimensions, printed reading bottom to top, are read too (${rotated})`);
    assert.ok(s.matches.every((m) => Math.abs(m.metres - Number(m.text) / 1000) < 1e-12), "bare mm: each value is the number in millimetres");
    assert.equal(s.unitless, null, "bare mm: no Feet or metres? question");
    assert.match(s.reason, /read in mm, as the drawing's note "ALL DIMENSIONS IN mm" says/, `bare mm: the reason says where the unit came from (${s.reason})`);

    const withNote = (note: string | null, f = (x: string) => x) => ({
      ...v,
      texts: v.texts.flatMap((x) => (x.str === "ALL DIMENSIONS IN mm" ? (note ? [{ ...x, str: note }] : []) : [{ ...x, str: /^\d+$/.test(x.str) ? f(x.str) : x.str }])),
    });
    // The same numbers in centimetres, under a centimetre note: the same scale.
    const cm = pdfScale(withNote("DIMENSIONS ARE IN CENTIMETRES", (x) => String(Number(x) / 10)));
    assert.equal(cm.matches.length, t.dims.length, "cm note: every bare number a row");
    assert.ok(Math.abs(cm.mPerPt! - t.mPerPt) / t.mPerPt < 1e-5 && cm.confidence === "good", "cm note: the same, true scale");
    // A feet-and-inches note is not a unit for bare numbers: they stay in the Feet or metres? route.
    const ftin = pdfScale(withNote("ALL DIMENSIONS IN FEET AND INCHES"));
    assert.equal(ftin.matches.length, 0, "feet-and-inches note: bare numbers are NOT rows");
    assert.ok(ftin.unitless && ftin.unitless.n === t.dims.length, "feet-and-inches note: they go to the Feet or metres? question");
    assert.equal(ftin.confidence, "check", "feet-and-inches note: the title block alone, check");
    // No note at all: unchanged since M.1a.
    const none = pdfScale(withNote(null));
    assert.equal(none.matches.length, 0, "no note: bare numbers are NOT rows");
    assert.ok(none.unitless && none.unitless.n === t.dims.length, "no note: Feet or metres? question");
    // Two notes that disagree say nothing.
    const both = pdfScale({ ...v, texts: [...v.texts, { ...v.texts.find((x) => x.str === "ALL DIMENSIONS IN mm")!, str: "UNITS: m", y: 30 }] });
    assert.equal(both.matches.length, 0, "two notes that disagree: bare numbers are NOT rows");
    console.log(`1. stated unit: plan-bare-mm ${s.matches.length}/${t.dims.length} bare numbers read as mm (${rotated} reading bottom to top), scale ${s.confidence}; cm note the same; a feet-and-inches note, no note or two disagreeing notes leave them in the Feet or metres? route`);
  }

  // ------------------------------------------------------------ 2. dimension lines and extension lines are not wall faces
  {
    const file = "plan-dims-close.pdf";
    const t = truth(file);
    const r = await build(file);
    const vw = r.pdf.vectorWalls!;
    const phantoms = toTruthFrame(vw.walls).filter((w) => !sameWall(w, t.planWalls));
    assert.deepEqual(phantoms.map((w) => `${w.id} t ${w.thickness.toFixed(3)}`), [], `${file}: no wall read from a dimension or extension line`);
    const shifted = toTruthFrame(vw.walls);
    assert.deepEqual(t.planWalls.filter((tw) => !shifted.some((w) => sameWall(w, [tw]))).map((w) => w.id), [], `${file}: every true wall is read, the faces the living-room string ends on included`);
    assert.ok(r.pdf.scale!.annotation!.length >= 5 * 3, `${file}: the 5 dimension lines and their extension lines are annotation (${r.pdf.scale!.annotation!.length})`);
    assert.ok(r.pdf.scale!.confidence === "good" && dimensionRows(r.pdf.scale!.matches, r.pdf.scale!.mPerPt!).length === t.dims.length, `${file}: all ${t.dims.length} dimensions still read`);
    console.log(`2. dimensions are annotation: ${file} ${vw.walls.length} walls read from the PDF, exactly the ${t.planWalls.length} true ones (strings 0.35 and 0.6 m off the faces, stacked extension lines, a face-to-face string across the living room); ${r.pdf.scale!.annotation!.length} segments left out as annotation. Built: ${r.b.coverage.exact}/${r.b.coverage.walls} (the tracing of this page is poor; rule 8)`);
  }

  // ------------------------------------------------------------ 3. no line runs through a wall
  {
    const file = "plan-against-wall.pdf";
    const t = truth(file);
    const r = await build(file);
    const vw = toTruthFrame(r.pdf.vectorWalls!.walls);
    assert.deepEqual(t.planWalls.filter((tw) => !covered(tw, vw)).map((w) => w.id), [], `${file}: every true wall's line is read, at its thickness, end to end (the bath swallowed none, the centre line split none)`);
    // No wall read from the PDF straddles a true wall's face: its band overlaps no true wall's band.
    const band = (w: { a: Vec2; b: Vec2; thickness: number }) => {
      const h = Math.abs(w.a.y - w.b.y) < 1e-9;
      const c = h ? w.a.y : w.a.x;
      const [s0, s1] = (h ? [w.a.x, w.b.x] : [w.a.y, w.b.y]).sort((p, q) => p - q);
      return { h, c0: c - w.thickness / 2, c1: c + w.thickness / 2, s0, s1 };
    };
    const onTrueLine = (w: { a: Vec2; b: Vec2; thickness: number }) => t.planWalls.some((tw) => covered({ ...w, id: "" }, [tw]));
    const straddle = vw.filter((w) => !onTrueLine(w)).filter((w) => t.planWalls.some((tw) => {
      const [p, q] = [band(w), band(tw)];
      return p.h === q.h && Math.min(p.c1, q.c1) - Math.max(p.c0, q.c0) > 0.001 && Math.min(p.s1, q.s1) - Math.max(p.s0, q.s0) > 0.001;
    }));
    assert.deepEqual(straddle.map((w) => `t ${w.thickness.toFixed(3)}`), [], `${file}: no wall read across a true wall's face`);
    const rest = vw.filter((w) => !onTrueLine(w));
    // Known failure (reported, not hidden): the centre line through the west wall is collinear with
    // the middle glazing line of that wall's two windows; the faces join into one 8.8 m line, which
    // is no longer read as glass, so both windows on that wall are lost (the wall itself is kept).
    const westWindows = t.planOpenings.filter((x) => x.wallId === "w-HA" || x.wallId === "w-GH");
    const ops = vectorFrame(r.pdf.vectorWalls!).openings;
    const lostWindows = westWindows.filter((x) => !ops.some((op) => (d(op.a, x.a) <= HALF_MM && d(op.b, x.b) <= HALF_MM) || (d(op.a, x.b) <= HALF_MM && d(op.b, x.a) <= HALF_MM)));
    assert.equal(lostWindows.length, 2, `${file}: the known failure is as documented (${lostWindows.length} west windows lost)`);
    assert.equal(exactOpenings(file, ops).length, 2, `${file}: and nothing else is lost`);

    // Synthetic pages (1 pt = 1 cm): a centre line or a pipe lengthwise in a wall never costs it.
    const K = 0.01;
    let path = 0;
    const seg = (x1: number, y1: number, x2: number, y2: number): PdfSegment => ({ x1: x1 / K, y1: y1 / K, x2: x2 / K, y2: y2 / K, width: 0.25, filled: false, path: path++, curve: false });
    // An L corner drawn as a generated plan draws it: each outer face to the corner, each inner face
    // stopping one thickness short (0.25 m walls), 6 m and 4 m long.
    const L = [seg(0, 0, 6, 0), seg(0.25, 0.25, 6, 0.25), seg(0, 0, 0, 4), seg(0.25, 0.25, 0.25, 4)];
    const cases: [string, PdfSegment[]][] = [
      ["a centre line 0.4 m past both ends of the 6 m wall", [seg(-0.4, 0.125, 6.4, 0.125)]],
      ["a centre line through the corner, along both walls", [seg(-0.4, 0.125, 6.4, 0.125), seg(0.125, -0.4, 0.125, 4.4)]],
      ["a pipe inside the wall from 2 m to 3 m", [seg(2, 0.1, 3, 0.1)]],
      ["a pipe from inside the wall out 1 m past its end", [seg(4, 0.1, 7, 0.1)]],
    ];
    // Known failure (reported, not hidden): an OFF-centre line along the whole wall and past both
    // ends is read as the face of another wall, so the pair across it is refused and the wall is lost.
    const offCentre = readVectorWalls({ segments: [...L, seg(-0.4, 0.06, 6.4, 0.06)] }, K).walls;
    const lostOff = !offCentre.some((w) => d(w.a, { x: 0.125, y: 0.125 }) < 1e-6 && d(w.b, { x: 6, y: 0.125 }) < 1e-6 && Math.abs(w.thickness - 0.25) < 1e-6);
    const outcomes: string[] = [];
    for (const [what, extra] of cases) {
      const got = readVectorWalls({ segments: [...L, ...extra] }, K).walls;
      const has = (x0: number, y0: number, x1: number, y1: number) => got.some((w) => d(w.a, { x: x0, y: y0 }) < 1e-6 && d(w.b, { x: x1, y: y1 }) < 1e-6 && Math.abs(w.thickness - 0.25) < 1e-6);
      assert.ok(has(0.125, 0.125, 6, 0.125) && has(0.125, 0.125, 0.125, 4), `${what}: both walls of the L read, 0.25 m thick, to the corner (${JSON.stringify(got.map((w) => [w.a, w.b, w.thickness]))})`);
      outcomes.push(what);
    }
    console.log(`3. no line through a wall: ${file} every true wall read, none straddled (${rest.length} pieces of the bath left on the room side, for rule 7); the L corner keeps both walls with ${outcomes.join("; ")}`);
    console.log(`   KNOWN FAILURE: on ${file} the centre line through the west wall joins the middle glazing line of its two windows into one 8.8 m line, so those ${lostWindows.length} windows are not read (the wall is)`);
    console.log(`   ${lostOff ? "KNOWN FAILURE" : "also passes"}: an off-centre line (6 cm from the outer face) along the whole 6 m wall and 0.4 m past both ends ${lostOff ? "costs that wall (rule 3 reads it as another wall's face)" : "keeps the wall"}`);
  }

  // ------------------------------------------------------------ 4. a gap is closed only across the whole wall
  {
    const file = "plan-window-board.pdf";
    const t = truth(file);
    const r = await build(file);
    const v = vectorFrame(r.pdf.vectorWalls!);
    assert.deepEqual(t.planWalls.filter((tw) => !covered(tw, v.walls)).map((w) => w.id), [], `${file}: every true wall's line is read, the north wall bridged across its window`);
    assert.deepEqual(exactOpenings(file, v.openings), [], `${file}: every opening read exactly, the north window from its glazing lines`);
    console.log(`4. gap closed only across the whole wall: ${file} the north window's gap bridged past the window board's pair; ${t.planOpenings.length}/${t.planOpenings.length} openings exact`);
  }

  // ------------------------------------------------------------ 5. a swing ends at the strike jamb
  {
    const file = "plan-strike-jamb.pdf";
    const t = truth(file);
    const r = await build(file);
    const v = vectorFrame(r.pdf.vectorWalls!);
    assert.deepEqual(t.planWalls.filter((tw) => !covered(tw, v.walls)).map((w) => w.id), [], `${file}: every true wall's line is read (the short faces beyond the strike jambs kept)`);
    assert.deepEqual(exactOpenings(file, v.openings), [], `${file}: every opening read exactly, doors hinged and opening as drawn`);
    assert.equal(r.pdf.vectorWalls!.arcs!.notUsed.length, 0, `${file}: every swing arc used (${JSON.stringify(r.pdf.vectorWalls!.arcs!.notUsed.map((a) => a.why))})`);
    console.log(`5. strike jamb: ${file} every wall's line read; ${t.planOpenings.length}/${t.planOpenings.length} openings exact (two doors 0.8 m apart, a leaf drawn shut), every arc used`);
  }

  // ------------------------------------------------------------ 6. small loops are furniture
  {
    const file = "plan-furniture.pdf";
    const t = truth(file);
    const vw = (await build(file)).pdf.vectorWalls!;
    const v = vectorFrame(vw);
    const inCupboard = (p: Vec2) => p.x > 0.15 && p.x < 0.8 && p.y > 0.15 && p.y < 0.65;
    const mid = (w: { a: Vec2; b: Vec2 }) => ({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 });
    assert.deepEqual(v.walls.filter((w) => inCupboard(mid(w))).map((w) => `(${w.a.x.toFixed(3)}, ${w.a.y.toFixed(3)})-(${w.b.x.toFixed(3)}, ${w.b.y.toFixed(3)})`), [], `${file}: the cupboard's partitions are not walls`);
    for (const id of ["w-AB", "w-HA"]) assert.ok(v.walls.some((w) => sameWall(w, t.planWalls.filter((x) => x.id === id))), `${file}: ${id}, which the cupboard stands against, is read whole`);
    const o = { x: Math.min(...vw.walls.flatMap((w) => [w.a.x, w.b.x])), y: Math.min(...vw.walls.flatMap((w) => [w.a.y, w.b.y])) };
    const loops = (vw.furniture ?? []).filter((f) => f.kind === "loop").map((f) => ({ ...f, c: { x: (f.box.x0 + f.box.x1) / 2 - o.x, y: (f.box.y0 + f.box.y1) / 2 - o.y } }));
    assert.ok(loops.some((f) => inCupboard(f.c)), `${file}: the cupboard is reported as a small loop (${JSON.stringify(loops)})`);
    console.log(`6. small loops: ${file} the corner cupboard (${loops.length} loop) dropped and reported; w-AB and w-HA read whole`);
  }

  // ------------------------------------------------------------ 7. islands are furniture, reported
  {
    for (const file of ["plan-furniture.pdf", "plan-against-wall.pdf", "plan-window-board.pdf"]) {
      const t = truth(file);
      const v = vectorFrame((await build(file)).pdf.vectorWalls!);
      assert.deepEqual(v.walls.filter((w) => !sameWall(w, t.planWalls)).map((w) => `(${w.a.x.toFixed(3)}, ${w.a.y.toFixed(3)})-(${w.b.x.toFixed(3)}, ${w.b.y.toFixed(3)}) t ${w.thickness.toFixed(3)}`), [], `${file}: every wall read from the PDF is a true wall`);
      assert.deepEqual(t.planWalls.filter((tw) => !v.walls.some((w) => sameWall(w, [tw]))).map((w) => w.id), [], `${file}: every true wall read whole`);
    }
    const file = "plan-furniture.pdf";
    const r = await build(file);
    const vw = r.pdf.vectorWalls!;
    const o = { x: Math.min(...vw.walls.flatMap((w) => [w.a.x, w.b.x])), y: Math.min(...vw.walls.flatMap((w) => [w.a.y, w.b.y])) };
    const rep = (vw.furniture ?? []).map((f) => ({ kind: f.kind, walls: f.walls, w: f.box.x1 - f.box.x0, h: f.box.y1 - f.box.y0, c: { x: (f.box.x0 + f.box.x1) / 2 - o.x, y: (f.box.y0 + f.box.y1) / 2 - o.y } }));
    const inBox = (c: Vec2, x0: number, y0: number, x1: number, y1: number) => c.x > x0 && c.x < x1 && c.y > y0 && c.y < y1;
    // A free-standing sofa or bath is a small closed loop as well as an island: rule 6 takes it first.
    const objects: [string, string[], number, number, number, number][] = [
      ["sofa", ["loop", "island"], 5.0, 3.4, 7.0, 4.25],
      ["bed", ["island"], 0.8, 4.6, 2.4, 6.6],
      ["bath", ["loop", "island"], 7.5, 6.2, 9.2, 6.95],
      ["stroked column", ["island"], 8.0, 2.5, 8.5, 3.0],
      ["filled column", ["small"], 5.5, 1.5, 6.0, 2.0],
    ];
    for (const [name, kinds, x0, y0, x1, y1] of objects) assert.ok(rep.some((f) => kinds.includes(f.kind) && inBox(f.c, x0, y0, x1, y1)), `${file}: the ${name} is reported as ${kinds.join(" or ")} (${JSON.stringify(rep)})`);
    for (const [cx, cy] of [[8.25, 2.75], [5.75, 1.75]]) {
      const col = rep.find((f) => Math.abs(f.c.x - cx) < 0.001 && Math.abs(f.c.y - cy) < 0.001);
      assert.ok(col && Math.abs(col.w - 0.5) < 0.001 && Math.abs(col.h - 0.5) < 0.001, `${file}: the 0.5 m column at (${cx}, ${cy}) is reported 0.50 × 0.50 m at its place, not lost (${JSON.stringify(col)})`);
    }
    // The same report reaches the review screen's coverage, in plan metres.
    const cov = r.b.coverage.furniture;
    assert.equal(cov.length, rep.length, `${file}: every dropped group is in the review's report`);
    assert.ok(cov.filter((f) => Math.abs(f.size.w - 0.5) < 0.001 && Math.abs(f.size.d - 0.5) < 0.001).length >= 2, `${file}: both columns 0.50 × 0.50 m in the review's report`);
    // Furniture against a wall, on synthetic pages (1 pt = 1 cm): a closed 6 × 4 m room of 0.2 m walls and a
    // 2 × 0.4 m counter. Its back on the north wall's inner face: rule 9 drops the pair of that face and the
    // counter's front. End-on against the east wall: its two long edges pair, the pair's end joins the wall,
    // and it stays as a stub with a free end — a KNOWN FAILURE, asserted as it is.
    const K = 0.01;
    let path = 1000;
    const seg = (x1: number, y1: number, x2: number, y2: number): PdfSegment => ({ x1: x1 / K, y1: y1 / K, x2: x2 / K, y2: y2 / K, width: 0.25, filled: false, path: path++, curve: false });
    const room = [seg(-0.1, -0.1, 6.1, -0.1), seg(0.1, 0.1, 5.9, 0.1), seg(-0.1, 4.1, 6.1, 4.1), seg(0.1, 3.9, 5.9, 3.9), seg(-0.1, -0.1, -0.1, 4.1), seg(0.1, 0.1, 0.1, 3.9), seg(6.1, -0.1, 6.1, 4.1), seg(5.9, 0.1, 5.9, 3.9)];
    const box = (x0: number, y0: number, x1: number, y1: number) => [seg(x0, y0, x1, y0), seg(x1, y0, x1, y1), seg(x1, y1, x0, y1), seg(x0, y1, x0, y0)];
    const back = readVectorWalls({ segments: [...room, ...box(1, 0.1, 3, 0.5)] }, K).walls;
    assert.equal(back.length, 4, `a counter backed onto a wall face: only the room's four walls (${back.length})`);
    const endOn = readVectorWalls({ segments: [...room, ...box(3.9, 1.5, 5.9, 1.9)] }, K).walls;
    const stub = endOn.filter((w) => Math.abs(w.thickness - 0.4) < 1e-6);
    assert.equal(stub.length, 1, `KNOWN FAILURE as documented: a counter end-on against a wall reads as one 0.4 m stub (${JSON.stringify(endOn.map((w) => [w.a, w.b, w.thickness]))})`);
    console.log(`   furniture against a wall: backed onto a wall face, dropped (rule 9); KNOWN FAILURE: end-on against a wall, read as a ${stub[0].thickness.toFixed(2)} m stub wall with a free end`);
    console.log(`7. islands: plan-furniture, plan-against-wall and plan-window-board read exactly their true walls; reported: ${rep.map((f) => `${f.kind} ${f.w.toFixed(2)} × ${f.h.toFixed(2)} m at (${f.c.x.toFixed(2)}, ${f.c.y.toFixed(2)})`).join("; ")}`);
  }

  // ------------------------------------------------------------ 8. a complete PDF reading stands on its own
  {
    const rows: string[] = [];
    for (const file of ["plan-dims-close.pdf", "plan-window-board.pdf"]) {
      const t = truth(file);
      const r = await build(file);
      exactWalls(file, r.b);
      assert.ok(r.b.coverage.pdfOnly, `${file}: the PDF's walls alone were used`);
      assert.equal(r.b.coverage.openings.exact, t.planOpenings.length, `${file}: every opening from the PDF (${r.b.coverage.openings.exact} of ${t.planOpenings.length})`);
      rows.push(`${file} ${r.b.coverage.exact}/${r.b.coverage.walls} walls exact, ${r.b.coverage.openings.exact}/${t.planOpenings.length} openings, rooms ${r.b.plan.rooms.map((x) => x.name).join(", ")}`);
    }
    const single = await build("plan-single-line.pdf");
    assert.ok(!single.b.coverage.pdfOnly && single.b.coverage.traced >= 1, "plan-single-line: the wall the PDF draws as one line is traced, merged as before");
    console.log(`8. PDF reading on its own: ${rows.join("; ")}; plan-single-line merged as before (${single.b.coverage.exact} exact, ${single.b.coverage.traced} traced)`);
  }

  // ------------------------------------------------------------ 9. a face bounds a wall on one side only
  {
    const file = "plan-against-wall.pdf";
    const t = truth(file);
    const v = vectorFrame((await build(file)).pdf.vectorWalls!);
    const onTrueLine = (w: { a: Vec2; b: Vec2; thickness: number }) => t.planWalls.some((tw) => covered({ ...w, id: "" }, [tw]));
    const touches = (w: { a: Vec2; b: Vec2 }, o: { a: Vec2; b: Vec2 }) => [w.a, w.b].some((p) => toSegment(p, o) < 0.01) || [o.a, o.b].some((p) => toSegment(p, w) < 0.01);
    const attached = v.walls.filter((w) => !onTrueLine(w) && t.planWalls.some((tw) => touches(w, tw)));
    assert.deepEqual(attached.map((w) => `(${w.a.x.toFixed(3)}, ${w.a.y.toFixed(3)})-(${w.b.x.toFixed(3)}, ${w.b.y.toFixed(3)}) t ${w.thickness.toFixed(3)}`), [], `${file}: no piece of the bath is joined to a true wall`);
    assert.deepEqual(t.planWalls.filter((tw) => !covered(tw, v.walls)).map((w) => w.id), [], `${file}: every true wall's line is still read`);
    console.log(`9. one-sided faces: ${file} no piece of the bath joined to a wall (${v.walls.filter((w) => !onTrueLine(w)).length} pieces of it left anywhere)`);
  }
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
