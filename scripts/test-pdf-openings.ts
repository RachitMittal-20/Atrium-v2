/**
 * test-pdf-openings.ts — step M.1c: doors, windows and door swings read from a vector
 * PDF's own lines (src/lib/pdf/openings.ts, used by walls.ts), merged with the traced
 * plan (src/lib/pdf/snap.ts), against tests/fixtures/pdf/ and truth.json
 * (scripts/make-pdf-fixtures.ts) and synthetic pages (1 pt = 1 cm). pdf.js runs
 * through scripts/pdf-node.ts.
 *
 *   - FAILING FIRST (seen failing before the code existed): plan-lines' door that the
 *     tracing made 1.54 m wide was kept traced by M.1b ("opening d-bed1 (900.0 mm) is
 *     within 0.5 mm in the built plan" failed); now every opening is within 0.5 mm.
 *     And the swing sign, one door checked by hand against the EXISTING convention
 *     ('left' !== 'right' before the derivation existed);
 *   - arc fitting: an exact quarter; 79° and 101° rejected (80.5° and 99.5° pass); a
 *     noisy arc (±0.5% of r) accepted, a noisier one (±2%) not an arc at all; radius
 *     0.49 and 1.51 m rejected, 0.51 and 1.49 accepted; no leaf, or a leaf 3% too long,
 *     rejected; polyline arcs found like Bézier ones;
 *   - the swing for all four combinations (hinge at the a or b jamb, leaf to either
 *     side), checked against doorSwing, and at the plan level on plan-doors (the
 *     plan's hinge on the PDF's jamb, the leaf on the PDF's side, walls turned round);
 *   - classification: door, double door, sliding, window (two lines in a gap, and the
 *     faces-plus-glass style), unclassified; an arc whose centre is 0.15 m off the
 *     jamb, or whose radius doesn't fit, is not used, with why; 0.44 m gaps close,
 *     0.46 m ones are openings;
 *   - every vector fixture with a scale: every opening's jambs (so its width and
 *     offset) within 0.5 mm of the truth and of the right kind, read from the PDF
 *     (plan-single-line's bathroom door sits on the wall that stays traced there: its
 *     width is within 0.5 mm, its place within 4 px, the traced wall's accuracy),
 *     validatePlan clean, the four rooms named, their areas equal to the truth's
 *     (1e-6 m²) where every wall is read from the PDF;
 *   - plan-doors: the classes counted (6 doors, 4 windows, 1 unclassified), the four
 *     decoys not used with their reasons, the model check's two opening widths;
 *   - the merge: within 3 px snaps, overlapping farther out is replaced (noted), 3 px
 *     beside it is replaced, 4 px beside it stays traced (listed), a missed one is
 *     added, a PDF opening openingProblem refuses is left out and the traced kept;
 *   - the store: an opening from a PDF says edited after a change, typing a height
 *     clears "default height", undo restores both. (Persistence: test-persist.ts.)
 * Run: npx tsx scripts/test-pdf-openings.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildFromAnalysis, type OcrResult } from "../src/lib/blueprint/analyse";
import { analysePdfPage } from "../src/lib/pdf/analysePdf";
import { modelRows } from "../src/lib/pdf/dimensions";
import { ARC_RULES, findArcs, fitCircle, type Seg } from "../src/lib/pdf/openings";
import { buildPdfPlan, mergeVector } from "../src/lib/pdf/snap";
import { readVectorWalls } from "../src/lib/pdf/walls";
import { doorSwing } from "../src/lib/plan2d/openings";
import { wallLength } from "../src/lib/plan/geometry";
import { deriveRooms } from "../src/lib/plan/rooms";
import { validatePlan } from "../src/lib/plan/validate";
import { usePlanStore } from "../src/store/planStore";
import type { BuildReport } from "../src/types/blueprint";
import type { Opening, Plan, Vec2, Wall } from "../src/types/plan";
import type { PdfSegment, VectorWalls } from "../src/types/pdf";
import type { Truth } from "./make-pdf-fixtures";
import { openNode, pdfjs, renderNode } from "./pdf-node";

const DIR = join(__dirname, "../tests/fixtures/pdf");
const truths: Truth[] = JSON.parse(readFileSync(join(DIR, "truth.json"), "utf8"));
const truth = (file: string) => truths.find((t) => t.file === file)!;
const HALF_MM = 0.0005;
const d = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.y - q.y);
const noOcr = async (): Promise<OcrResult> => ({ labels: [], words: [], error: null, rereads: [] });

async function read(file: string) {
  const t = truth(file);
  const doc = await openNode(new Uint8Array(readFileSync(join(DIR, file))));
  const out = await analysePdfPage(pdfjs, await doc.getPage(t.planPage), { pageCount: doc.numPages, render: renderNode, ocr: noOcr });
  await doc.loadingTask.destroy();
  return { ...out, t, scale: { pxPerM: out.analysis.scale.pxPerM!, source: "pdf" as const } };
}

function jambs(plan: Plan, id: string): [Vec2, Vec2] {
  const o = plan.openings.find((x) => x.id === id)!;
  const w = plan.walls.find((x) => x.id === o.wallId)!;
  const L = wallLength(w);
  const at = (s: number) => ({ x: w.a.x + ((w.b.x - w.a.x) / L) * s, y: w.a.y + ((w.b.y - w.a.y) / L) * s });
  return [at(o.offset - o.width / 2), at(o.offset + o.width / 2)];
}
/** The built opening at a true opening's place (both jambs within tol, either way round). */
const atPlace = (plan: Plan, to: Truth["planOpenings"][number], tol = HALF_MM) =>
  plan.openings.find((o) => {
    const [p, q] = jambs(plan, o.id);
    return (d(p, to.a) <= tol && d(q, to.b) <= tol) || (d(p, to.b) <= tol && d(q, to.a) <= tol);
  });

const truthPlan = (t: Truth): Plan => ({ id: "truth", name: "truth", units: "m", walls: t.planWalls.map((w) => ({ ...w, height: 2.7 })), openings: [], rooms: [], items: [], meta: { createdAt: "", updatedAt: "", source: "sample" } });

// ---------------------------------------------------------------- synthetic pages (1 pt = 1 cm)

const K = 0.01;
let pathNo = 0;
const seg = (x1: number, y1: number, x2: number, y2: number, o: Partial<PdfSegment> = {}): PdfSegment => ({ x1: x1 / K, y1: y1 / K, x2: x2 / K, y2: y2 / K, width: 0.5, filled: false, path: pathNo++, curve: false, ...o });
/** An arc about c from angle a0 through sweep (radians, page axes, y down), n pieces in one path:
 *  Bézier-like curve pieces, or a polyline's straight ones. `noise` moves each point radially by up to ±noise × r. */
function arc(c: Vec2, r: number, a0: number, sweep: number, o: { n?: number; poly?: boolean; noise?: number } = {}): PdfSegment[] {
  const n = o.n ?? 24;
  const path = pathNo++;
  const jitter = (i: number) => (o.noise ? 1 + o.noise * Math.sin(12.9898 * (i + 1) * 78.233) : 1); // deterministic, within ±noise
  const p = (i: number) => ({ x: c.x + r * jitter(i) * Math.cos(a0 + (sweep * i) / n), y: c.y + r * jitter(i) * Math.sin(a0 + (sweep * i) / n) });
  return Array.from({ length: n }, (_, i) => seg(p(i).x, p(i).y, p(i + 1).x, p(i + 1).y, { curve: !o.poly, path }));
}
const DEG = Math.PI / 180;
const toM = (s: PdfSegment): Seg => ({ x1: s.x1 * K, y1: s.y1 * K, x2: s.x2 * K, y2: s.y2 * K, curve: s.curve });

/** A 4 m wall along y = 1 (0.2 m thick) with a gap [g0, g1], plus whatever is drawn in it. */
const wallWithGap = (g0: number, g1: number, extra: PdfSegment[] = []) => [seg(0, 0.9, g0, 0.9), seg(0, 1.1, g0, 1.1), seg(g1, 0.9, 4, 0.9), seg(g1, 1.1, 4, 1.1), ...extra];
/** A swing: hinge at x = h on the centre line, leaf to y = 1 + dir·r ("south" dir = +1, page y down), arc to x = to. */
function swing(h: number, to: number, dir: 1 | -1, o: { r?: number; sweepDeg?: number; leaf?: number; poly?: boolean; noise?: number; shift?: number } = {}): PdfSegment[] {
  const r = o.r ?? Math.abs(to - h);
  const c = { x: h + (o.shift ?? 0), y: 1 };
  const tipA = dir * 90 * DEG; // the leaf's angle (page axes): south +90°, north -90°
  const endA = to > h ? 0 : Math.PI; // towards the far jamb
  let sw = endA - tipA;
  sw -= 2 * Math.PI * Math.round(sw / (2 * Math.PI));
  if (o.sweepDeg) sw = Math.sign(sw) * o.sweepDeg * DEG;
  const leaf = o.leaf ?? r;
  return [seg(c.x, c.y, c.x, c.y + dir * leaf), ...arc(c, r, tipA, sw, { poly: o.poly, noise: o.noise })];
}
const one = (segs: PdfSegment[]) => readVectorWalls({ segments: segs }, K);

const tracedOf = (walls: Wall[], openings: Opening[] = []) => {
  const plan: Plan = { id: "t", name: "t", units: "m", walls, openings, rooms: [], items: [], meta: { createdAt: "", updatedAt: "", source: "blueprint" } };
  const report: BuildReport = { scale: { pxPerM: 100, source: "pdf" }, origin: { x: 0, y: 0 }, wideOpenings: [], droppedPairs: [], unbridged: [], removedWalls: [], thickness: [], adjusted: [], freeEnds: [], problems: validatePlan(plan) };
  return { plan, report };
};

async function main() {
  // ------------------------------------------------------------ FAILING FIRST 1: plan-lines' 1.54 m door
  {
    const { analysis, pdf, t, scale } = await read("plan-lines.pdf");
    // M.1b's result for this door is the traced one (snapping it would have moved a jamb 647 mm).
    const traced = buildFromAnalysis(analysis, scale).plan;
    const wide = traced.openings.find((o) => Math.abs(o.width - 1.54) < 0.01);
    assert.ok(wide, `M.1b: the traced door is 1.54 m wide (${traced.openings.map((o) => o.width.toFixed(3)).join(", ")})`);
    const { plan, coverage } = buildPdfPlan(analysis, pdf, scale);
    for (const to of t.planOpenings) assert.ok(atPlace(plan, to), `plan-lines: opening ${to.id} (${(d(to.a, to.b) * 1000).toFixed(1)} mm) is within 0.5 mm in the built plan`);
    const door = atPlace(plan, t.planOpenings.find((o) => o.id === "d-bed1")!)!;
    assert.ok(Math.abs(door.width - 0.9) <= HALF_MM && door.provenance === "vector", "the 1.54 m door is now the PDF's 0.9 m one");
    console.log(`failing first: plan-lines traced door ${wide.width.toFixed(3)} m (M.1b kept it); M.1c ${door.width.toFixed(4)} m, ${coverage.openings.exact}/${coverage.openings.total} openings exact`);
  }

  // ------------------------------------------------------------ FAILING FIRST 2: the swing sign, by hand
  // A wall along y = 1 m from x = 0 to 4 (page metres, y DOWN), 0.2 m thick; a 0.9 m gap from x = 1.5
  // to 2.4; the hinge at (1.5, 1.0), the jamb nearer the wall's a end (a = the smaller x); the leaf
  // drawn to (1.5, 0.1), i.e. NORTH (up the page), and the arc from its tip to (2.4, 1.0). By hand:
  // a→b is (1, 0); the plan's "left" is the (-dy, dx) side = (0, 1), SOUTH (down the page, because y
  // points down). The leaf is north, so the stored swing must be "right".
  {
    const v = one(wallWithGap(1.5, 2.4, swing(1.5, 2.4, -1)));
    assert.equal(v.walls.length, 1, "one wall");
    assert.equal(v.openings.length, 1, "one door");
    const [o, w] = [v.openings[0], v.walls[0]];
    assert.ok(w.a.x < w.b.x, "a is the west end");
    assert.equal(o.swing, "right", "the leaf opens north, the (dy, -dx) side of a→b: right");
    const drawn = doorSwing(w, { offset: o.offset, width: o.width, swing: o.swing });
    assert.ok(d(drawn.leafEnd, { x: 1.5, y: 0.1 }) < 1e-6, "and the 2D plan draws the leaf where the PDF has it");
    console.log(`failing first: the hand-checked door is "${o.swing}" and doorSwing draws its leaf tip at (${drawn.leafEnd.x.toFixed(3)}, ${drawn.leafEnd.y.toFixed(3)})`);
  }

  // ------------------------------------------------------------ arc fitting
  {
    const quarter = arc({ x: 2, y: 3 }, 0.9, 0, Math.PI / 2).map(toM);
    const pts = [{ x: quarter[0].x1, y: quarter[0].y1 }, ...quarter.map((s) => ({ x: s.x2, y: s.y2 }))];
    const f = fitCircle(pts)!;
    assert.ok(d(f.c, { x: 2, y: 3 }) < 1e-9 && Math.abs(f.r - 0.9) < 1e-9 && f.residual < 1e-9, `exact quarter: centre and radius exact (${JSON.stringify(f)})`);
    const why = (segs: PdfSegment[]) => findArcs(segs.map(toM)).map((a) => a.why);
    // On their own (no wall): a swing arc with its leaf, hinge at (1, 1), leaf north.
    const free = (o: Parameters<typeof swing>[3]) => why(swing(1, 1 + (o?.r ?? 0.9), -1, o));
    assert.deepEqual(free({}), [null], "exact quarter with a leaf: a swing arc");
    assert.match(String(free({ sweepDeg: 79 })[0]), /sweep 79°, outside 80–100°/, "79° rejected");
    assert.match(String(free({ sweepDeg: 101 })[0]), /sweep 101°/, "101° rejected");
    assert.deepEqual([free({ sweepDeg: 80.5 })[0], free({ sweepDeg: 99.5 })[0]], [null, null], "80.5° and 99.5° pass");
    assert.deepEqual(free({ noise: 0.005 }), [null], "a noisy arc (±0.5% of r, RMS about 0.35%) is accepted");
    assert.deepEqual(free({ noise: 0.02 }), [], "a noisier one (±2%) is not an arc at all");
    assert.match(String(free({ r: 0.49 })[0]), /radius 0.49 m, outside 0.5–1.5 m/, "0.49 m rejected");
    assert.match(String(free({ r: 1.51 })[0]), /radius 1.51 m/, "1.51 m rejected");
    assert.deepEqual([free({ r: 0.51 })[0], free({ r: 1.49 })[0]], [null, null], "0.51 and 1.49 m pass");
    assert.match(String(why(arc({ x: 1, y: 1 }, 0.9, -Math.PI / 2, Math.PI / 2))[0]), /no leaf/, "no leaf: rejected");
    assert.match(String(free({ leaf: 0.9 * 1.03 })[0]), /no leaf/, "a leaf 3% too long is no leaf");
    assert.deepEqual(free({ leaf: 0.9 * 1.015 }), [null], "1.5% too long is still the leaf");
    assert.deepEqual(free({ poly: true }), [null], "a polyline arc (straight pieces) is found like a Bézier one");
    assert.equal(ARC_RULES.residual, 0.005, "the fit residual limit is 0.5% of the radius");
    console.log("arcs: exact quarter; 79°/101° rejected, 80.5°/99.5° pass; ±0.5% noise accepted, ±2% not an arc; radius 0.49/1.51 rejected, 0.51/1.49 pass; leaf required (3% too long fails); polylines too");
  }

  // ------------------------------------------------------------ the swing: all four combinations
  {
    for (const poly of [false, true])
      for (const hinge of ["a", "b"] as const)
        for (const dir of [1, -1] as const) {
          const [h, to] = hinge === "a" ? [1.5, 2.4] : [2.4, 1.5];
          const v = one(wallWithGap(1.5, 2.4, swing(h, to, dir, { poly })));
          const [o, w] = [v.openings[0], v.walls[0]];
          const want = dir === 1 ? "left" : "right"; // south = the (-dy, dx) side of a west-to-east wall
          assert.equal(o.class, "door", `${hinge}/${dir}: a door`);
          assert.equal(o.swing, want, `hinge ${hinge}, leaf ${dir === 1 ? "south" : "north"}${poly ? " (polyline)" : ""}: ${want}`);
          assert.equal(o.hingeEnd, hinge, `hinge ${hinge}: hingeEnd`);
          assert.ok(d(o.hinge!, { x: h, y: 1 }) < 1e-9, "the hinge is that jamb on the centre line");
          assert.ok(o.swingNormal!.y === dir && o.swingNormal!.x === 0, "swingNormal points to the leaf's side");
          if (hinge === "a") assert.ok(d(doorSwing(w, { offset: o.offset, width: o.width, swing: o.swing }).leafEnd, { x: h, y: 1 + dir * 0.9 }) < 1e-6, "doorSwing draws the PDF's leaf");
        }
    console.log("swing: hinge a/b × leaf either side, Bézier and polyline: the side by the existing convention, the hinge jamb recorded");
  }

  // ------------------------------------------------------------ classification
  {
    const kind = (segs: PdfSegment[]) => {
      const v = one(segs);
      return { v, o: v.openings[0] };
    };
    const dbl = kind(wallWithGap(1.2, 2.8, [...swing(1.2, 2.0, 1), ...swing(2.8, 2.0, 1)]));
    assert.ok(dbl.o.class === "double" && dbl.o.kind === "door" && dbl.o.swing === "left" && Math.abs(dbl.o.width - 1.6) < 1e-9 && dbl.v.arcs!.used === 2, `double door: one door, two arcs (${JSON.stringify(dbl.o)})`);
    // Sliding: two 0.04 m panels, 55% of the gap each, staggered across the wall.
    const panel = (x0: number, x1: number, y0: number, y1: number) => [seg(x0, y0, x1, y0), seg(x1, y0, x1, y1), seg(x1, y1, x0, y1), seg(x0, y1, x0, y0)];
    const sl = kind(wallWithGap(1.2, 2.8, [...panel(1.2, 2.08, 0.94, 0.98), ...panel(1.92, 2.8, 1.02, 1.06)]));
    assert.ok(sl.o.class === "sliding" && sl.o.kind === "door" && sl.o.swing === "left" && sl.v.walls.length === 1, `sliding: a door, swing left (${JSON.stringify(sl.o)}, ${sl.v.walls.length} walls)`);
    const w2 = kind(wallWithGap(1.2, 2.4, [seg(1.2, 0.95, 2.4, 0.95), seg(1.2, 1.05, 2.4, 1.05)]));
    assert.ok(w2.o.class === "window" && w2.o.kind === "window" && w2.o.swing === undefined && w2.v.walls.length === 1, `two glazing lines in a gap: a window, the wall bridged (${w2.v.walls.length} walls)`);
    const w3 = kind([seg(0, 0.9, 4, 0.9), seg(0, 1.1, 4, 1.1), seg(1.2, 1, 2.4, 1)]);
    assert.ok(w3.o.class === "window" && Math.abs(w3.o.width - 1.2) < 1e-9, "faces carried across and a glass line: a window");
    const gap = kind(wallWithGap(1.5, 2.5));
    assert.ok(gap.o.class === "unclassified" && gap.o.kind === "door" && gap.o.swing === "left", "a bare gap: unclassified, kept as a door, swing left");
    const off = kind(wallWithGap(1.5, 2.4, swing(1.5, 2.4, 1, { shift: 0.15, r: 0.9 })));
    assert.equal(off.o.class, "unclassified", "an arc centred 0.15 m from the jamb is no swing for it");
    assert.match(off.v.arcs!.notUsed[0].why, /its centre is not at a door or window jamb/, "and is reported");
    const near = kind(wallWithGap(1.5, 2.4, swing(1.5, 2.4, 1, { shift: 0.09, r: 0.9 })));
    assert.equal(near.o.class, "door", "0.09 m from the jamb (within 0.1 m) is");
    const mismatch = kind(wallWithGap(1.5, 2.7, swing(1.5, 2.4, 1)));
    assert.equal(mismatch.o.class, "unclassified", "a 0.9 m arc at a 1.2 m gap's jamb is not its swing");
    assert.match(mismatch.v.arcs!.notUsed[0].why, /radius 0.90 m doesn't match the 1.20 m opening/, "reported");
    assert.equal(one(wallWithGap(1.5, 1.94)).openings.length, 0, "a 0.44 m gap is solid wall");
    assert.equal(one(wallWithGap(1.5, 1.96)).walls.length, 1, "(one wall)");
    assert.equal(one(wallWithGap(1.5, 1.96)).openings.length, 1, "a 0.46 m gap is an opening");
    console.log("classification: door, double, sliding, window (two lines in a gap; faces and glass), unclassified; off-jamb and mismatched arcs not used, with why; 0.44 m closes, 0.46 m opens");
  }

  // ------------------------------------------------------------ every vector fixture: exact openings
  const files = ["plan-filled.pdf", "plan-lines.pdf", "plan-fit.pdf", "plan-rotated.pdf", "plan-imperial.pdf", "plan-two-pages.pdf", "plan-clutter.pdf", "plan-broken-dims.pdf", "plan-single-line.pdf", "plan-no-dims.pdf", "plan-doors.pdf"];
  for (const file of files) {
    const { analysis, pdf, t, scale } = await read(file);
    const b = buildPdfPlan(analysis, pdf, scale);
    const { plan, coverage: c } = b;
    const px = 1 / scale.pxPerM;
    for (const to of t.planOpenings) {
      // On a wall that stays traced (plan-single-line's w-KL) the PDF's width is exact but its place is the traced wall's, within 4 px.
      const loose = atPlace(plan, to, 4 * px);
      const onTraced = loose && plan.walls.find((w) => w.id === loose.wallId)!.provenance === "traced";
      const o = onTraced ? loose : atPlace(plan, to);
      assert.ok(o, `${file}: ${to.id} within 0.5 mm (${plan.openings.map((x) => `${x.id} ${x.width}`).join(", ")})`);
      if (onTraced) {
        assert.ok(Math.abs(o.width - d(to.a, to.b)) <= HALF_MM, `${file}: ${to.id} on a traced wall: its width within 0.5 mm`);
        console.log(`${file}: ${to.id} sits on traced wall ${o.wallId}: width exact, place within 4 px (${(Math.max(...jambs(plan, o.id).map((p) => Math.min(d(p, to.a), d(p, to.b)))) * 1000).toFixed(1)} mm)`);
        continue;
      }
      assert.equal(o.kind, to.kind, `${file}: ${to.id} is a ${to.kind}`);
      assert.equal(o.provenance, "vector", `${file}: ${to.id} read from the PDF`);
      assert.ok(o.defaultHeight, `${file}: ${to.id} has default heights`);
      const w = plan.walls.find((x) => x.id === o.wallId)!;
      if (to.hinge) {
        // The plan's own drawing of the door: hinge on the PDF's jamb, leaf on the PDF's side.
        const s = doorSwing(w, o);
        assert.ok(d(s.hinge, to.hinge) <= HALF_MM, `${file}: ${to.id} hangs on the PDF's jamb (${(d(s.hinge, to.hinge) * 1000).toFixed(2)} mm)`);
        assert.ok((s.leafEnd.x - s.hinge.x) * to.side!.x + (s.leafEnd.y - s.hinge.y) * to.side!.y > 0.5 * o.width, `${file}: ${to.id} opens to the PDF's side`);
      } else if (to.side) {
        const s = doorSwing(w, o);
        assert.ok((s.leafEnd.x - s.hinge.x) * to.side.x + (s.leafEnd.y - s.hinge.y) * to.side.y > 0, `${file}: ${to.id} (double) opens to the PDF's side`);
      }
    }
    assert.equal(plan.openings.length, t.planOpenings.length, `${file}: exactly the true openings`);
    assert.equal(c.openings.exact, t.planOpenings.length, `${file}: all read exactly`);
    assert.deepEqual(validatePlan(plan), [], `${file}: validatePlan clean`);
    const areas = (p: Plan) => deriveRooms(p).map((r) => r.area).sort((x, y) => x - y);
    const [got, want] = [areas(plan), areas(truthPlan(t))];
    // With a traced wall (plan-single-line) room areas are the tracing's, as in M.1b; every other fixture's are exact.
    const exactWalls = plan.walls.every((w) => w.provenance === "vector");
    assert.ok(got.length === want.length && (!exactWalls || got.every((a, i) => Math.abs(a - want[i]) <= 1e-6)), `${file}: rooms unchanged (${got.join(", ")} vs ${want.join(", ")})`);
    assert.deepEqual(plan.rooms.map((r) => r.name).sort(), ["Bathroom", "Bedroom 1", "Bedroom 2", "Living Room"], `${file}: the four rooms, named`);
    const unclassified = t.planOpenings.filter((o) => o.class === "unclassified").length;
    assert.equal(c.openings.unclassified, unclassified, `${file}: ${unclassified} unclassified`);
    assert.equal(c.openings.doors, t.planOpenings.filter((o) => o.kind === "door").length - unclassified, `${file}: doors`);
    assert.equal(c.openings.windows, t.planOpenings.filter((o) => o.kind === "window").length, `${file}: windows`);
    assert.equal(c.openings.arcsNotUsed, t.decoyArcs ?? 0, `${file}: ${t.decoyArcs ?? 0} arcs not used`);
    const onTracedWalls = plan.openings.filter((o) => plan.walls.find((w) => w.id === o.wallId)!.provenance === "traced").length;
    console.log(`${file}: ${c.openings.exact}/${c.openings.total} openings read exactly, ${c.openings.exact - onTracedWalls} within 0.5 mm${onTracedWalls ? ` and ${onTracedWalls} on a traced wall (width exact)` : ""} (doors ${c.openings.doors}, windows ${c.openings.windows}, unclassified ${c.openings.unclassified}; snapped ${c.openings.snapped}, replaced ${c.openings.replaced}, added ${c.openings.added}), swings as drawn, ${c.openings.arcsNotUsed} arcs not used, validator clean, rooms unchanged`);

    if (file === "plan-doors.pdf") {
      // The four decoys, each for its own reason; the gap's leafless quarter circle sits on its jamb.
      const whys = c.unusedArcs.map((a) => a.why).sort();
      assert.deepEqual(whys, ["no leaf (a line from its centre to its end)", "radius 0.25 m, outside 0.5–1.5 m", "radius 0.35 m, outside 0.5–1.5 m", "radius 1.80 m, outside 0.5–1.5 m"], `decoys: ${JSON.stringify(whys)}`);
      const gap = atPlace(plan, t.planOpenings.find((o) => o.id === "gap-bed2")!)!;
      assert.ok(c.unclassifiedOpenings.some((u) => u.id === gap.id) && gap.swing === "left", "the bare gap is unclassified (its leafless arc never made it a door), swing left");
      const sl = atPlace(plan, t.planOpenings.find((o) => o.id === "sl-living")!)!;
      assert.ok(sl.kind === "door" && !c.unclassifiedOpenings.some((u) => u.id === sl.id), "the sliding door is a door, not unclassified");
      // Walls turned round: d-bed1 and d-bath hang on the b jamb in the sample; their plan walls now start there.
      assert.ok(!c.notes.some((n) => /hangs on the jamb nearer its wall's end/.test(n)), "no door left hanging on its wall's b jamb");
      // Model versus printed: the two printed opening widths.
      const toPlan = (x: number, y: number) => ({ x: x * c.mPerPt - c.origin.x, y: y * c.mPerPt - c.origin.y });
      const rows = modelRows(pdf.scale!.matches, plan, toPlan, (3 * c.traceMm) / 1000).filter((r) => r.spans === "opening width");
      assert.deepEqual(rows.map((r) => r.text).sort(), ["1000 mm", "1200 mm"], `model check: the two opening widths (${rows.map((r) => r.text)})`);
      assert.ok(rows.every((r) => r.status === "ok" && Math.abs(r.diffMm) <= 0.5 && !r.approximate), `opening width rows OK to 0.5 mm: ${rows.map((r) => r.diffMm.toFixed(3))}`);
      // A traced opening's jamb makes a row approximate.
      const tracedPlan = { ...plan, openings: plan.openings.map((o) => ({ ...o, provenance: "traced" as const })) };
      assert.ok(modelRows(pdf.scale!.matches, tracedPlan, toPlan, (3 * c.traceMm) / 1000).filter((r) => r.spans === "opening width").every((r) => r.approximate), "on traced openings the rows are approximate");
      console.log(`plan-doors: decoys ${whys.join("; ")}; model check opening widths ${rows.map((r) => `${r.text} ${r.diffMm.toFixed(3)} mm`).join(", ")}`);
    }
  }

  // ------------------------------------------------------------ the merge and the 3-pixel limit (1 px = 1 cm)
  {
    const PX = 0.01;
    const sq: Wall[] = [
      { id: "n", a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, thickness: 0.2, height: 2.7 },
      { id: "e", a: { x: 4, y: 0 }, b: { x: 4, y: 4 }, thickness: 0.2, height: 2.7 },
      { id: "s", a: { x: 0, y: 4 }, b: { x: 4, y: 4 }, thickness: 0.2, height: 2.7 },
      { id: "w", a: { x: 0, y: 0 }, b: { x: 0, y: 4 }, thickness: 0.2, height: 2.7 },
    ];
    const vec = (ops: VectorWalls["openings"]): VectorWalls => ({ mPerPt: 0.01, walls: sq.map((w) => ({ ...w, id: `v-${w.id}`, provenance: "vector" })), openings: ops, skipped: { diagonal: 0, curved: 0 }, dropped: { short: 0, clutter: 0, inside: 0, openingsCut: 0 }, clutter: [] });
    const vDoor = (id: string, wallId: string, s0: number, s1: number, along: (s: number) => Vec2): VectorWalls["openings"][number] => ({ id, wallId, kind: "door", class: "door", offset: (s0 + s1) / 2, width: s1 - s0, swing: "right", swingNormal: { x: 0, y: -1 }, a: along(s0), b: along(s1) });
    const north = (s: number) => ({ x: s, y: 0 });
    const tDoor = (id: string, wallId: string, s0: number, s1: number): Opening => ({ id, wallId, kind: "door", offset: (s0 + s1) / 2, width: s1 - s0, height: 2.1, sillHeight: 0, swing: "left" });
    const merge = (traced: Opening[], ops: VectorWalls["openings"]) => mergeVector(tracedOf(sq.map((w) => ({ ...w })), traced), vec(ops), { pxPerM: 100, pxPerPt: 1, labels: [], forceTraced: [] });
    const V = [vDoor("vo1", "v-n", 1, 1.9, north)];
    // Within 3 px: snapped (the PDF's jambs, kind and swing).
    const a = merge([tDoor("o1", "n", 1 + 2.9 * PX, 1.9 - 2.9 * PX)], V);
    assert.ok(a.coverage.openings.snapped === 1 && a.plan.openings[0].width === 0.9 && a.plan.openings[0].swing === "right" && a.plan.openings[0].provenance === "vector", `2.9 px: snapped to the PDF's (${JSON.stringify(a.plan.openings)})`);
    // Overlapping, a jamb farther out: replaced, noted.
    const b = merge([tDoor("o1", "n", 1, 1.9 + 5 * PX)], V);
    assert.ok(b.coverage.openings.replaced === 1 && b.plan.openings.length === 1 && b.plan.openings[0].width === 0.9, "a jamb 5 px out: replaced by the PDF's");
    assert.ok(b.coverage.notes.some((n) => /Traced opening o1 \(0.95 m\) replaced by vo1 read from the PDF \(0.90 m\): the traced jambs were up to 50 mm out, more than 3 px/.test(n)), `noted: ${b.coverage.notes}`);
    // Beside it: 3 px away still counts as at its place; 4 px away is another opening, kept traced and listed.
    const c3 = merge([tDoor("o1", "n", 1.9 + 3 * PX, 2.6)], V);
    assert.ok(c3.coverage.openings.replaced === 1 && c3.coverage.openings.traced === 0, "3 px beside the PDF's opening: replaced");
    const c4 = merge([tDoor("o1", "n", 1.9 + 4 * PX, 2.6)], V);
    assert.ok(c4.coverage.openings.traced === 1 && c4.coverage.openings.exact === 1 && c4.plan.openings.find((o) => o.id === "o1")!.provenance === "traced", "4 px beside it: a traced opening of its own");
    assert.match(c4.coverage.tracedOpenings[0].reason, /no opening in the PDF within 3 px/, "listed with why");
    // Missed by the tracing: added.
    const e = merge([], V);
    assert.ok(e.coverage.openings.added === 1 && e.plan.openings[0].provenance === "vector", "missed by the tracing: added");
    // A PDF opening refused by openingProblem (into the corner, outside the usable span): left out, the traced one kept.
    const corner = [vDoor("vo2", "v-n", 0, 0.9, north)];
    const f = merge([tDoor("o2", "n", 0.15, 1.0)], corner);
    assert.ok(f.plan.openings.length === 1 && f.plan.openings[0].id === "o2" && f.plan.openings[0].provenance === "traced", `the refused PDF opening is left out and the traced one kept (${JSON.stringify(f.plan.openings)})`);
    assert.ok(f.coverage.notes.some((n) => /Opening vo2 from the PDF left out: A door must sit fully inside its wall, clear of the walls at its ends\. The traced opening o2 is kept instead\./.test(n)), `with why: ${f.coverage.notes}`);
    for (const m of [a, b, c3, c4, e, f]) assert.deepEqual(validatePlan(m.plan), [], "every merge: validator clean");
    console.log("merge: 2.9 px snaps; a jamb 5 px out is replaced (noted); 3 px beside replaced, 4 px beside stays traced (listed); missed ones added; a refused PDF opening gives way to the traced one");
  }

  // ------------------------------------------------------------ the store: edited and default height
  {
    const { analysis, pdf, scale } = await read("plan-doors.pdf");
    const st = () => usePlanStore.getState();
    st().loadPlan(buildPdfPlan(analysis, pdf, scale).plan);
    const o = st().plan.openings.find((x) => x.kind === "window")!;
    assert.ok(o.provenance === "vector" && !o.edited && o.defaultHeight, "loaded: read from the PDF, default height");
    st().updateOpening(o.id, { width: o.width - 0.1 });
    let now = st().plan.openings.find((x) => x.id === o.id)!;
    assert.ok(now.edited && now.defaultHeight && now.provenance === "vector", "a width change: edited, still default height, provenance kept");
    st().updateOpening(o.id, { height: 1.4 });
    now = st().plan.openings.find((x) => x.id === o.id)!;
    assert.ok(!now.defaultHeight, "a typed height: no longer the default");
    st().undo();
    st().undo();
    now = st().plan.openings.find((x) => x.id === o.id)!;
    assert.ok(!now.edited && now.defaultHeight, "undo restores both marks");
    assert.ok(st().plan.openings.filter((x) => x.id !== o.id).every((x) => !x.edited), "only that opening");
    console.log("store: an opening from a PDF says edited after a change, a typed height clears default height, undo restores both");
  }
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
