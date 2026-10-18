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
 *     plan's hinge on the PDF's jamb and the leaf on the PDF's side). Step M.1d: the
 *     jamb is STORED (Opening.hinge) and no wall is turned round to suit a door, so
 *     every wall in the plan still runs the way walls.ts read it;
 *   - classification: door, double door, sliding, window (two lines in a gap, and the
 *     faces-plus-glass style), unclassified; an arc whose centre is 0.15 m off the
 *     jamb, or whose radius doesn't fit, is not used, with why; 0.44 m gaps close,
 *     0.46 m ones are openings;
 *   - every vector fixture with a scale: every opening's jambs (so its width and
 *     offset) within 0.5 mm of the truth and of the right kind, read from the PDF
 *     (plan-traced-wall's bathroom door sits on the wall that stays traced there: its
 *     width is within 0.5 mm, its place within 4 px, the traced wall's accuracy),
 *     validatePlan clean, the four rooms named, their areas equal to the truth's
 *     (1e-6 m²) where every wall is read from the PDF;
 *   - plan-doors: the classes counted (6 doors, 4 windows, 1 unclassified), the four
 *     decoys not used with their reasons, the model check's two opening widths;
 *   - the merge: within 3 px snaps, overlapping farther out is replaced (noted), 3 px
 *     beside it is replaced, 4 px beside it stays traced (listed), a missed one is
 *     added, a PDF opening openingProblem refuses is left out and the traced kept;
 *   - step M.1d: a leaf drawn as a thin closed RECTANGLE is a leaf when it comes with a
 *     valid arc (Bézier or polyline, either jamb, either side) and never pairs as a wall;
 *     a rectangle with no arc leaves the gap unclassified; 20–100 mm thick only;
 *   - step M.1d: collinear gaps outside 0.45–4 m are reported with their sizes (0.30 m
 *     closed as wall, 4.60 m unbridged), synthetically and on plan-gaps.pdf against its
 *     truth; step M.2b: the 0.30 m door the tracing read there is DROPPED as a phantom
 *     (the PDF's wall runs unbroken across it) and reported, so plan-gaps' plan holds the
 *     PDF's 7 openings and nothing else, where M.1d kept 8; plan-doors-rect.pdf's two doors on ONE wall, hinged at opposite jambs and
 *     opening to opposite sides, both exact;
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
/** A closed rectangle as four segments in ONE path, the way a stroked CAD rectangle arrives. */
const rect4 = (pts: [number, number][]): PdfSegment[] => {
  const path = pathNo++;
  return pts.map((q, i) => seg(q[0], q[1], pts[(i + 1) % pts.length][0], pts[(i + 1) % pts.length][1], { path }));
};
/** A leaf drawn as a thin closed rectangle (step M.1d): hinge at x = h on the centre line
 *  y = 1, tip r along the wall's `dir` side, `lt` metres across (0.06 m pairs as a wall if
 *  openings.ts fails to keep it out of the faces). */
const rectLeaf = (h: number, r: number, dir: 1 | -1, lt = 0.06) =>
  rect4([
    [h - lt / 2, 1],
    [h + lt / 2, 1],
    [h + lt / 2, 1 + dir * r],
    [h - lt / 2, 1 + dir * r],
  ]);
const DEG = Math.PI / 180;
const toM = (s: PdfSegment): Seg => ({ x1: s.x1 * K, y1: s.y1 * K, x2: s.x2 * K, y2: s.y2 * K, curve: s.curve, path: s.path }); // path too: a rectangle leaf is found by path (step M.1d)

/** A 4 m wall along y = 1 (0.2 m thick) with a gap [g0, g1], plus whatever is drawn in it. */
const wallWithGap = (g0: number, g1: number, extra: PdfSegment[] = []) => [seg(0, 0.9, g0, 0.9), seg(0, 1.1, g0, 1.1), seg(g1, 0.9, 4, 0.9), seg(g1, 1.1, 4, 1.1), ...extra];
/** A swing: hinge at x = h on the centre line, leaf to y = 1 + dir·r ("south" dir = +1, page y down), arc to x = to. */
function swing(h: number, to: number, dir: 1 | -1, o: { r?: number; sweepDeg?: number; leaf?: number; poly?: boolean; noise?: number; shift?: number; rect?: boolean | number } = {}): PdfSegment[] {
  const r = o.r ?? Math.abs(to - h);
  const c = { x: h + (o.shift ?? 0), y: 1 };
  const tipA = dir * 90 * DEG; // the leaf's angle (page axes): south +90°, north -90°
  const endA = to > h ? 0 : Math.PI; // towards the far jamb
  let sw = endA - tipA;
  sw -= 2 * Math.PI * Math.round(sw / (2 * Math.PI));
  if (o.sweepDeg) sw = Math.sign(sw) * o.sweepDeg * DEG;
  const leaf = o.leaf ?? r;
  // Step M.1d: the leaf as a thin closed rectangle (optionally of a given thickness) instead of one line.
  const drawn = o.rect ? rectLeaf(c.x, leaf, dir, typeof o.rect === "number" ? o.rect : 0.06) : [seg(c.x, c.y, c.x, c.y + dir * leaf)];
  return [...drawn, ...arc(c, r, tipA, sw, { poly: o.poly, noise: o.noise })];
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

  // ------------------------------------------------------------ thin-rectangle leaves (step M.1d)
  {
    const kind = (segs: PdfSegment[]) => one(segs);
    // A leaf drawn as a thin closed rectangle, with a valid swing arc: a door, hinge and side as drawn.
    for (const poly of [false, true])
      for (const dir of [1, -1] as const) {
        const v = kind(wallWithGap(1.5, 2.4, swing(1.5, 2.4, dir, { poly, rect: true })));
        const [o] = v.openings;
        assert.equal(v.walls.length, 1, `rect leaf (${poly ? "polyline" : "Bézier"} arc, ${dir === 1 ? "south" : "north"}): still ONE wall — all four sides of the rectangle are kept out of the faces`);
        assert.ok(o && o.class === "door" && o.kind === "door", `rect leaf: a door (${JSON.stringify(o)})`);
        assert.equal(o.swing, dir === 1 ? "left" : "right", "rect leaf: the side the rectangle lies on");
        assert.equal(o.hingeEnd, "a", "rect leaf: the jamb its short end sits on");
      }
    // Hinged at the b jamb too.
    assert.equal(kind(wallWithGap(1.5, 2.4, swing(2.4, 1.5, 1, { rect: true }))).openings[0].hingeEnd, "b", "a rect leaf on the b jamb");
    // A rectangle with NO arc is not a door by itself: the gap stays unclassified, and it is no wall.
    const bare = kind([...wallWithGap(1.5, 2.4), ...rectLeaf(1.5, 0.9, 1)]);
    assert.equal(bare.openings.length, 1, "a rectangle with no arc: still one opening");
    assert.equal(bare.openings[0].class, "unclassified", "…and it is unclassified, not a door read from a leaf");
    assert.equal(bare.openings[0].swing, "left", "kept as a door with LEGACY_SWING, as any undrawn gap is");
    // A rectangle outside the rules is not a leaf: too thick, too short, or not at the hinge.
    const why = (segs: PdfSegment[]) => findArcs(segs.map(toM)).map((a) => a.why);
    const withRect = (o: { rect?: boolean | number; leaf?: number; shift?: number }) => why(swing(1, 1.9, -1, { r: 0.9, rect: true, ...o }));
    assert.deepEqual(withRect({}), [null], "a 60 mm rectangle leaf is a leaf");
    assert.deepEqual(withRect({ rect: 0.02 }), [null], "20 mm, the thinnest allowed, is too");
    assert.deepEqual(withRect({ rect: 0.1 }), [null], "and 100 mm, the thickest");
    assert.match(String(withRect({ rect: 0.12 })[0]), /no leaf/, "120 mm is not a leaf");
    // Thinner than 20 mm is not a RECTANGLE leaf, but one of its long sides then passes the plain
    // LINE-leaf test (its ends are within 2% of the radius of the centre and the arc's end), so the
    // door is still found. Only that one side is kept out of the faces; the other is 15 mm away,
    // closer than the 50 mm walls.ts pairs at, so it cannot become a wall either.
    assert.deepEqual(withRect({ rect: 0.015 }), [null], "15 mm: not a rectangle leaf, but a side of it reads as a line leaf");
    assert.match(String(withRect({ rect: true, leaf: 0.9 * 1.03 })[0]), /no leaf/, "a rectangle 3% too long is not a leaf");
    assert.deepEqual(ARC_RULES.rectLeaf, [0.02, 0.1], "the rectangle leaf's thickness range");
    console.log("rect leaves: accepted with a Bézier or polyline arc, on either jamb and either side, and never paired as a wall; a rectangle with no arc leaves the gap unclassified; 20–100 mm only, length = radius ±2%");
  }

  // ------------------------------------------------------------ gaps outside 0.45–4 m are reported (step M.1d)
  {
    const sizes = (v: VectorWalls) => (v.gaps ?? []).map((g) => +g.size.toFixed(4));
    // Narrow: closed as solid wall, as before, but now reported.
    const narrow = one(wallWithGap(1.5, 1.8));
    assert.equal(narrow.walls.length, 1, "a 0.30 m gap still closes as one wall");
    assert.equal(narrow.openings.length, 0, "…and is not an opening");
    assert.deepEqual(sizes(narrow), [0.3], "…and is reported with its size");
    // Exactly at the limits: 0.45 m is an opening, so nothing is reported; 0.44 m is reported.
    assert.deepEqual(sizes(one(wallWithGap(1.5, 1.96))), [], "a 0.46 m gap is an opening, so there is nothing to report");
    assert.deepEqual(sizes(one(wallWithGap(1.5, 1.94))), [0.44], "0.44 m is reported");
    // Wide: over 4 m, nothing bridges it, so the wall ends there; reported with its size.
    const wide = one([seg(0, 0.9, 1.5, 0.9), seg(0, 1.1, 1.5, 1.1), seg(6.1, 0.9, 8, 0.9), seg(6.1, 1.1, 8, 1.1)]);
    assert.equal(wide.walls.length, 2, "a 4.6 m gap leaves two walls, unbridged");
    assert.equal(wide.openings.length, 0, "…and no opening");
    assert.deepEqual(sizes(wide), [4.6], "…and is reported with its size");
    // An overlap is not a gap, and neither is a break another wall crosses.
    assert.deepEqual(sizes(one([seg(0, 0.9, 2.5, 0.9), seg(0, 1.1, 2.5, 1.1), seg(2, 0.9, 4, 0.9), seg(2, 1.1, 4, 1.1)])), [], "overlapping pieces are not a gap");
    console.log("gaps: 0.30 m closes as wall and 4.60 m stays unbridged, both reported with their sizes; 0.46 m is an opening (nothing reported); overlaps are not gaps");
  }

  // ------------------------------------------------------------ every vector fixture: exact openings
  const files = ["plan-filled.pdf", "plan-lines.pdf", "plan-fit.pdf", "plan-rotated.pdf", "plan-imperial.pdf", "plan-two-pages.pdf", "plan-clutter.pdf", "plan-broken-dims.pdf", "plan-single-line.pdf", "plan-traced-wall.pdf", "plan-no-dims.pdf", "plan-doors.pdf", "plan-doors-rect.pdf"];
  for (const file of files) {
    const { analysis, pdf, t, scale } = await read(file);
    const b = buildPdfPlan(analysis, pdf, scale);
    const { plan, coverage: c } = b;
    const px = 1 / scale.pxPerM;
    for (const to of t.planOpenings) {
      // On a wall that stays traced (plan-traced-wall's w-KL) the PDF's width is exact but its place is the traced wall's, within 4 px.
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
        // Step M.1d: and it is STORED as that jamb, rather than the wall being turned round to suit it.
        assert.equal(o.hinge ?? "a", to.hingeEnd, `${file}: ${to.id} is stored hinged at the ${to.hingeEnd} jamb`);
      } else if (to.side) {
        const s = doorSwing(w, o);
        assert.ok((s.leafEnd.x - s.hinge.x) * to.side.x + (s.leafEnd.y - s.hinge.y) * to.side.y > 0, `${file}: ${to.id} (double) opens to the PDF's side`);
      }
    }
    assert.equal(plan.openings.length, t.planOpenings.length, `${file}: exactly the true openings`);
    // Step M.1d: no wall is ever turned round to suit a door, so every wall in the plan still runs
    // the way the PDF reading gave it. walls.ts always makes a the end with the SMALLER coordinate
    // (asserted on its own output just below), so that one test catches any reversal. The truth's
    // planWalls keep the sample's own a→b, which for half the walls is the other way round by
    // design, so they say nothing about direction and are not compared here.
    const forward = (w: { a: Vec2; b: Vec2 }) => w.a.x < w.b.x - 1e-9 || (Math.abs(w.a.x - w.b.x) < 1e-9 && w.a.y < w.b.y - 1e-9);
    assert.ok(pdf.vectorWalls!.walls.every(forward), `${file}: the PDF reading itself runs every wall from its smaller coordinate`);
    for (const w of plan.walls.filter((x) => x.provenance === "vector")) assert.ok(forward(w), `${file}: wall ${w.id} still runs the PDF's way (no turn-round)`);
    assert.equal(c.openings.exact, t.planOpenings.length, `${file}: all read exactly`);
    assert.deepEqual(validatePlan(plan), [], `${file}: validatePlan clean`);
    const areas = (p: Plan) => deriveRooms(p).map((r) => r.area).sort((x, y) => x - y);
    const [got, want] = [areas(plan), areas(truthPlan(t))];
    // With a traced wall (plan-traced-wall) room areas are the tracing's, as in M.1b; every other fixture's are exact.
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
      // Step M.1d: d-bed1 and d-bath are drawn hinged on the jamb nearer their wall's b end. M.1c
      // turned those walls round to suit them; now the wall keeps its direction and the door carries
      // hinge "b", so nothing is mirrored and there is no note about it.
      for (const id of ["d-bed1", "d-bath"]) {
        const to = t.planOpenings.find((x) => x.id === id)!;
        assert.equal(to.hingeEnd, "b", `${id} is drawn on the b jamb`);
        assert.equal(atPlace(plan, to)!.hinge, "b", `${id} is stored hinged at b, not mirrored`);
      }
      assert.ok(!c.notes.some((n) => /hangs on the jamb nearer/.test(n)), "no door had to be mirrored, so nothing is noted");
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

    if (file === "plan-doors-rect.pdf") {
      // Step M.1d. Every leaf is a thin rectangle; some arcs are Béziers and some polylines; the
      // north wall carries TWO doors, one hinged at each jamb and opening to opposite sides.
      const whys = c.unusedArcs.map((a) => a.why).sort();
      assert.deepEqual(whys, ["no leaf (a line from its centre to its end)", "radius 0.25 m, outside 0.5–1.5 m", "radius 0.35 m, outside 0.5–1.5 m", "radius 1.80 m, outside 0.5–1.5 m"], `rect fixture: the same four decoys rejected (${JSON.stringify(whys)})`);
      assert.equal(pdf.vectorWalls!.arcs!.used, 7, "seven swing arcs used: five single doors and the double door's two");
      const pair = ["dr-a", "dr-b"].map((id) => {
        const to = t.planOpenings.find((x) => x.id === id)!;
        const o = atPlace(plan, to)!;
        assert.ok(o, `${id} is in the plan within 0.5 mm`);
        return { to, o };
      });
      assert.equal(pair[0].o.wallId, pair[1].o.wallId, "both doors are on the SAME wall (the north wall was never split or turned round)");
      const w = plan.walls.find((x) => x.id === pair[0].o.wallId)!;
      for (const { to, o } of pair) {
        assert.ok(Math.abs(o.width - d(to.a, to.b)) <= HALF_MM, `${to.id}: width within 0.5 mm (${(Math.abs(o.width - d(to.a, to.b)) * 1000).toFixed(3)} mm)`);
        // The offset is the centre from the wall's a end: check it against the truth's own jambs.
        const wantOffset = Math.min(...[to.a, to.b].map((q) => (q.x - w.a.x) * (w.b.x - w.a.x) + (q.y - w.a.y) * (w.b.y - w.a.y))) / wallLength(w) + d(to.a, to.b) / 2;
        assert.ok(Math.abs(o.offset - wantOffset) <= HALF_MM, `${to.id}: offset within 0.5 mm (${o.offset.toFixed(4)} vs ${wantOffset.toFixed(4)})`);
        assert.equal(o.hinge ?? "a", to.hingeEnd, `${to.id}: hinged at the ${to.hingeEnd} jamb, as drawn`);
        const s = doorSwing(w, o);
        assert.ok(d(s.hinge, to.hinge!) <= HALF_MM, `${to.id}: the drawn leaf pivots on that jamb`);
        assert.ok((s.leafEnd.x - s.hinge.x) * to.side!.x + (s.leafEnd.y - s.hinge.y) * to.side!.y > 0.5 * o.width, `${to.id}: and opens to the PDF's side`);
      }
      assert.notEqual(pair[0].o.hinge ?? "a", pair[1].o.hinge ?? "a", "the two doors hang on opposite jambs");
      assert.notEqual(pair[0].o.swing, pair[1].o.swing, "and open to opposite sides");
      assert.ok(!c.notes.some((n) => /hangs on the jamb nearer/.test(n)), "and nothing had to be mirrored or noted");
      console.log(`plan-doors-rect: rectangle leaves read; ${pair.map(({ to, o }) => `${to.id} hinge ${o.hinge ?? "a"}/${o.swing} ${o.width.toFixed(4)} m at ${o.offset.toFixed(4)} m`).join(", ")} both on wall ${w.id}; decoys ${whys.length} rejected`);
    }
  }

  // ------------------------------------------------------------ plan-gaps: the gap report against the truth (step M.1d)
  {
    const { analysis, pdf, t, scale } = await read("plan-gaps.pdf");
    const b = buildPdfPlan(analysis, pdf, scale);
    const sizes = (xs: number[]) => xs.map((v) => +v.toFixed(3)).sort((p, q) => p - q);
    assert.deepEqual(sizes(pdf.vectorWalls!.gaps!.map((g) => g.size)), sizes(t.outOfRangeGaps!), `plan-gaps: walls.ts reports exactly the drawn out-of-range gaps (${JSON.stringify(t.outOfRangeGaps)})`);
    assert.deepEqual(sizes(b.coverage.outOfRangeGaps.map((g) => g.size)), sizes(t.outOfRangeGaps!), "plan-gaps: and so does the coverage report, at the scale in use");
    assert.equal(b.coverage.outOfRangeGaps.length, 2, "plan-gaps: two of them");
    // Neither is an opening: the openings read are exactly the drawn ones.
    for (const to of t.planOpenings) assert.ok(atPlace(b.plan, to, 4 / scale.pxPerM), `plan-gaps: ${to.id} is in the plan`);
    assert.equal(b.coverage.openings.exact, t.planOpenings.length, `plan-gaps: ${t.planOpenings.length} openings read exactly, and neither gap among them`);
    // The narrow gap closed as wall: no wall end sits in it.
    const narrow = b.coverage.outOfRangeGaps.find((g) => g.size < 0.45)!;
    const wide = b.coverage.outOfRangeGaps.find((g) => g.size > 4)!;
    assert.ok(narrow && wide, "one narrow and one wide");
    const mid = (g: { a: Vec2; b: Vec2 }) => ({ x: (g.a.x + g.b.x) / 2, y: (g.a.y + g.b.y) / 2 });
    const covered = (q: Vec2) =>
      b.plan.walls.some((w) => {
        const L = wallLength(w);
        const along = ((q.x - w.a.x) * (w.b.x - w.a.x) + (q.y - w.a.y) * (w.b.y - w.a.y)) / L;
        const off = Math.abs((q.x - w.a.x) * -(w.b.y - w.a.y) + (q.y - w.a.y) * (w.b.x - w.a.x)) / L;
        return along > 0 && along < L && off <= w.thickness / 2 + 1e-6;
      });
    assert.ok(covered(mid(narrow)), "the 0.30 m gap is closed as solid wall (a wall runs through it)");
    assert.ok(!covered(mid(wide)), "the 4.60 m gap is not bridged (no wall runs through it)");
    // The image tracing does read the narrow gap as a 0.3 m door. Step M.2b drops it: the PDF's
    // wall runs unbroken across it, so it is a phantom of the raster, and the plan holds the
    // PDF's openings and nothing else. (M.1d kept it, so the total was one more than the truth's.)
    assert.equal(b.coverage.openings.total, t.planOpenings.length, "the tracing's own 0.30 m door is dropped, not kept");
    assert.equal(b.coverage.openings.traced, 0, "…so nothing is traced");
    assert.equal(b.coverage.droppedOpenings.length, 1, "it is reported as dropped");
    assert.ok(Math.abs(b.coverage.droppedOpenings[0].size - 0.3) < 0.01, `with its size (${b.coverage.droppedOpenings[0].size.toFixed(3)} m)`);
    console.log(`plan-gaps: gaps ${b.coverage.outOfRangeGaps.map((g) => g.size.toFixed(2)).join(", ")} m reported and matching the truth; the narrow one closed as wall, the wide one unbridged; ${b.coverage.openings.exact}/${b.coverage.openings.total} openings exact; ${b.coverage.droppedOpenings.length} phantom traced opening dropped (${(b.coverage.droppedOpenings[0].size * 1000).toFixed(0)} mm)`);
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
