/**
 * test-snap-index.ts — step P.1: takeoff points snap to the PDF drawing's own corners, line ends,
 * midpoints and lines (src/lib/pdf/snapIndex.ts, src/lib/takeoff/geometry.ts snapTakeoffPoint,
 * src/store/{takeoffStore,drawingSnapStore}.ts, src/lib/takeoff/rows.ts).
 *
 *   - plan-filled, plan-lines and plan-rotated: every VISIBLE vertex of every wall polygon as drawn
 *     (the filled rectangles in truth.json; plan-lines draws the same ones stroked) is an indexed
 *     corner within 0.01 mm; a vertex buried under another wall's fill (a partition's end inside the
 *     wall it meets) is not a snap point at all on the filled pages (logged in docs/HANDOFF.md, P.1:
 *     it beat a wall's centre-line end in e2e-background), and stays on plan-lines, where it is a
 *     real crossing of stroked lines;
 *   - plan-clutter: the index equals the index of the same page with its 193 hatch lines taken
 *     out (no point exists because of hatching), and every hatch line is counted as skipped;
 *   - a query 3 px from a corner returns exactly that corner (the stored point mapped);
 *   - the priority order with competing candidates: face corner > drawing corner/end > centre-line
 *     end > jamb > wall midpoint > drawing mid > drawing edge > grid;
 *   - tolerance at the boundary, through the store: 14 px for a mouse, 44 px for a finger;
 *     Alt keeps the raw point, Shift's level/plumb point is stored with no drawing kind;
 *   - calibrating by 1.05 moves every snap point by exactly 1.05 about the origin (1e-9);
 *   - a 50k-segment synthetic page answers 1000 queries in under QUERY_BUDGET_MS;
 *   - the 200k point cap and its note; the scanned page, an image and a missing file disable it;
 *   - the basis: a takeoff whose every point snapped to the drawing is "PDF exact" with no wall
 *     anywhere near, and stays so (Rescaled) after a calibration;
 *   - FAILING FIRST: two clicks 3 px off the ends of a printed "3000 mm" dimension (both ends are
 *     drawing corners, where two dimension lines of a chain meet) measure at least 0.5 mm wrong
 *     without the drawing's snaps, and exactly the printed value (0.01 mm) with them.
 * Run: npx tsx scripts/test-snap-index.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { samplePlan } from "../src/data/samplePlan";
import type { OcrResult } from "../src/lib/blueprint/analyse";
import { apply, buildMapping, invert } from "../src/lib/background/mapping";
import { setAssetStoreForTests } from "../src/lib/import/assetCache";
import { memoryAssetStore } from "../src/lib/import/assetStore";
import { analysePdfPage } from "../src/lib/pdf/analysePdf";
import { extractVectorPage } from "../src/lib/pdf/extract";
import { buildPdfPlan } from "../src/lib/pdf/snap";
import { buildSnapIndex, capNote, drawingCandidates, indexForPage, MAX_POINTS, NEEDS_VECTOR, PT_PER_MM, READING_DRAWING, type SnapIndex } from "../src/lib/pdf/snapIndex";
import { rescaledText, scalePlan } from "../src/lib/plan/calibrate";
import { snapTakeoffPoint, snapTargets, type Pt } from "../src/lib/takeoff/geometry";
import { takeoffRow } from "../src/lib/takeoff/rows";
import { keyOf, useDrawingSnapStore } from "../src/store/drawingSnapStore";
import { usePlanStore } from "../src/store/planStore";
import { DRAWING_PX, SNAP_PX, TOUCH_PX, useTakeoffStore, type TakeoffPointer } from "../src/store/takeoffStore";
import type { Affine, Background, Plan, Vec2 } from "../src/types/plan";
import type { PdfSegment } from "../src/types/pdf";
import type { Truth } from "./make-pdf-fixtures";
import { openNode, pdfjs, renderNode } from "./pdf-node";

const DIR = join(__dirname, "../tests/fixtures/pdf");
const truths: Truth[] = JSON.parse(readFileSync(join(DIR, "truth.json"), "utf8"));
const MM_PER_PT = 25.4 / 72;
const QUERY_BUDGET_MS = 50;
const noOcr = async (): Promise<OcrResult> => ({ labels: [], words: [], error: null, rereads: [] });
const dist = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);

async function vectorPage(file: string) {
  const doc = await openNode(new Uint8Array(readFileSync(join(DIR, file))));
  const page = await extractVectorPage(pdfjs, await doc.getPage(1));
  await doc.loadingTask.destroy();
  return page;
}

/** The index's points as [x, y, kind] rows. */
const pointsOf = (i: SnapIndex) => Array.from(i.xs, (x, k) => [x, i.ys[k], i.kinds[k]] as const);

/** The nearest indexed point of `kind` (0 corner) to a point in page points, in mm. */
function nearestMm(i: SnapIndex, p: Vec2, kind: number) {
  let best = Infinity;
  for (let k = 0; k < i.xs.length; k++) if (i.kinds[k] === kind) best = Math.min(best, Math.hypot(i.xs[k] - p.x, i.ys[k] - p.y));
  return best * MM_PER_PT;
}

/**
 * The wall polygons' vertices from the truth (its filled edges come four to a rectangle, in drawing
 * order), split into visible ones and those buried strictly inside ANOTHER wall rectangle (a
 * partition's end drawn on into the wall it meets, under that wall's fill).
 */
function wallVertices(file: string) {
  const edges = truths.find((t) => t.file === file)!.segments.filter((s) => s[5]);
  assert.equal(edges.length % 4, 0, `${file}: the wall fills are rectangles`);
  const rects = Array.from({ length: edges.length / 4 }, (_, i) => edges.slice(i * 4, i * 4 + 4));
  for (const r of rects) assert.ok(r.every((e, k) => Math.hypot(e[2] - r[(k + 1) % 4][0], e[3] - r[(k + 1) % 4][1]) < 1e-6), `${file}: each rectangle closes`);
  const box = (r: (typeof rects)[number]) => ({ x0: Math.min(...r.map((e) => e[0])), x1: Math.max(...r.map((e) => e[0])), y0: Math.min(...r.map((e) => e[1])), y1: Math.max(...r.map((e) => e[1])) });
  const m = 0.05; // pt, as the index's own margin
  const visible: Vec2[] = [];
  const buried: Vec2[] = [];
  rects.forEach((r, i) => {
    for (const e of r) {
      const v = { x: e[0], y: e[1] };
      const under = rects.some((q, j) => {
        if (j === i) return false;
        const b = box(q);
        return v.x > b.x0 + m && v.x < b.x1 - m && v.y > b.y0 + m && v.y < b.y1 - m;
      });
      (under ? buried : visible).push(v);
    }
  });
  return { visible, buried };
}

async function wallCorners() {
  // The wall polygons are the filled rectangles (plan-filled, plan-rotated); plan-lines strokes the same ones.
  for (const [file, truthOf] of [["plan-filled.pdf", "plan-filled.pdf"], ["plan-lines.pdf", "plan-filled.pdf"], ["plan-rotated.pdf", "plan-rotated.pdf"]] as const) {
    const index = buildSnapIndex(await vectorPage(file));
    const { visible, buried } = wallVertices(truthOf);
    assert.ok(visible.length >= 80, `${file}: the truth has the wall polygons (${visible.length} visible vertices)`);
    let worst = 0;
    for (const c of visible) worst = Math.max(worst, nearestMm(index, c, 0));
    assert.ok(worst <= 0.01, `${file}: every visible wall corner is an indexed corner within 0.01 mm (worst ${worst.toFixed(6)} mm)`);
    assert.ok(buried.length >= 4, `${file}: some vertices are buried under another wall's fill (${buried.length})`);
    const nearestAny = (p: Vec2) => Math.min(...[0, 1, 2].map((k) => nearestMm(index, p, k)));
    if (file === "plan-lines.pdf") {
      // Stroked, not filled: nothing covers them, and the lines really do cross there.
      for (const b of buried) assert.ok(nearestAny(b) <= 0.01, `${file}: an unfilled crossing keeps its corner`);
    } else for (const b of buried) assert.ok(nearestAny(b) > 0.01, `${file}: a vertex under another wall's fill is not a snap point (${b.x.toFixed(2)}, ${b.y.toFixed(2)})`);
    console.log(`${file}: ${visible.length} visible wall polygon vertices, each an indexed corner, worst ${worst.toExponential(2)} mm; ${buried.length} under another wall's fill ${file === "plan-lines.pdf" ? "kept (stroked)" : "left out"}; counts ${JSON.stringify(index.counts)}`);
  }
}

async function hatching() {
  const page = await vectorPage("plan-clutter.pdf");
  const hatch = page.segments.filter((s) => Math.abs(s.width - 0.18) < 1e-9); // the fixture's hatch pen
  assert.equal(hatch.length, 193, "plan-clutter has its 193 hatch lines");
  const full = buildSnapIndex(page);
  const bare = buildSnapIndex({ segments: page.segments.filter((s) => !hatch.includes(s)) });
  assert.equal(full.counts.hatch, 193, `every hatch line is skipped (${full.counts.hatch})`);
  assert.deepEqual(pointsOf(full), pointsOf(bare), "the index holds exactly the points of the page without its hatching: none comes from a hatch line");
  assert.deepEqual(Array.from(full.segs), Array.from(bare.segs), "and no hatch line is an edge to snap to");
  // The walls that carry the hatching are still there: plan-clutter draws plan-lines' polygons.
  const lines = buildSnapIndex(await vectorPage("plan-lines.pdf"));
  let missing = 0;
  for (const [x, y, k] of pointsOf(lines)) if (k === 0 && nearestMm(full, { x, y }, 0) > 0.01) missing++;
  assert.equal(missing, 0, "every plan-lines corner is still a corner in plan-clutter");
  console.log(`plan-clutter: ${full.counts.hatch} hatch lines skipped, ${full.xs.length} points = the page without hatching; counts ${JSON.stringify(full.counts)}`);
}

// ------------------------------------------------------------------ synthetic helpers

const M_PER_PT = 0.01; // synthetic pages: 1 pt = 1 cm
const SYN: Affine = { a: M_PER_PT, b: 0, c: 0, d: M_PER_PT, e: 0, f: 0 };
/** Segments given in metres, as a 0.5 pt stroked page. */
const seg = (x1: number, y1: number, x2: number, y2: number, width = 0.5): PdfSegment => ({ x1: x1 / M_PER_PT, y1: y1 / M_PER_PT, x2: x2 / M_PER_PT, y2: y2 / M_PER_PT, width, filled: false, path: 0, curve: false });
const synIndex = (segs: PdfSegment[]) => buildSnapIndex({ segments: segs });

function priority() {
  // One 0.5 m thick wall from (0, 0) to (4, 0) with a 1 m window centred at 2: its face corners are 0.25 m off its ends.
  const plan: Pick<Plan, "walls" | "openings"> = {
    walls: [{ id: "w", a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, thickness: 0.5, height: 2.7 }],
    openings: [{ id: "o", wallId: "w", kind: "window", offset: 2, width: 1, height: 1.2, sillHeight: 0.9 }],
  };
  const T = snapTargets(plan);
  const face = T.find((t) => t.kind === "corner")!.point;
  const tol = 0.12; // the walls' tolerance, metres
  const dtol = 0.14; // the drawing's
  const snap = (at: Pt, segs: PdfSegment[]) => snapTakeoffPoint(plan, at, tol, { drawing: { index: synIndex(segs), mapping: SYN, tolerance: dtol } }).value!;
  // An L of two lines meeting at c: a drawing corner.
  const L = (c: Pt) => [seg(c[0], c[1], c[0] + 0.5, c[1]), seg(c[0], c[1], c[0], c[1] + 0.5)];

  // face corner beats a nearer drawing corner
  let r = snap([face[0] + 0.1, face[1]], L([face[0] + 0.12, face[1]]));
  assert.equal(r.kind, "corner", "a wall's face corner beats a nearer drawing corner");
  // a drawing corner beats a nearer centre-line end
  r = snap([0.01, 0], L([0.09, 0.02]));
  assert.equal(r.kind, "drawing-corner", "a drawing corner beats a nearer centre-line end");
  assert.ok(dist(r.point, [0.09, 0.02]) < 1e-12, "at its own point");
  // a drawing line END is in the same tier: the nearer of a corner and an end wins
  r = snap([1, 1], [...L([1.1, 1]), seg(0.97, 1.02, 0.97, 1.6)]);
  assert.equal(r.kind, "drawing-end", "an end nearer than a corner wins in their shared tier");
  // a jamb beats a nearer drawing midpoint
  const jamb = T.find((t) => t.kind === "jamb")!.point;
  r = snap([jamb[0], jamb[1] + 0.02], [seg(jamb[0] - 0.3, jamb[1] + 0.025, jamb[0] + 0.3, jamb[1] + 0.025)]);
  assert.equal(r.kind, "jamb", "a jamb beats a nearer drawing midpoint");
  // a wall midpoint beats a nearer drawing midpoint (no jamb near: the window sits at 1.5–2.5, the midpoint at 2… use a plan without it)
  const plain = { walls: plan.walls, openings: [] };
  r = snapTakeoffPoint(plain, [2, 0.03], tol, { drawing: { index: synIndex([seg(1.7, 0.035, 2.3, 0.035)]), mapping: SYN, tolerance: dtol } }).value!;
  assert.equal(r.kind, "midpoint", "a wall midpoint beats a nearer drawing midpoint");
  // a drawing midpoint beats a nearer point on a drawing line (away from the wall): the vertical line
  // passes 0.01 m from the pointer, its ends and middle out of reach; the horizontal one's middle is 0.05 m off
  r = snap([1, 3], [seg(0.7, 3.05, 1.3, 3.05), seg(1.01, 2, 1.01, 4.5)]);
  assert.equal(r.kind, "drawing-mid", "a drawing midpoint beats a nearer drawing line");
  // a drawing line beats the grid
  r = snap([1.013, 3.02], [seg(0, 3, 3, 3)]);
  assert.equal(r.kind, "drawing-edge", "a drawing line beats the grid");
  assert.ok(Math.abs(r.point[1] - 3) < 1e-12 && Math.abs(r.point[0] - 1.013) < 1e-12, "at the nearest point on the line");
  // nothing in reach: the grid
  r = snap([1.013, 3.5], [seg(0, 3, 3, 3)]);
  assert.equal(r.kind, "grid", "nothing in reach: the grid");
  console.log("priority: face corner > drawing corner/end (nearest) > centre-line end > jamb > wall midpoint > drawing mid > drawing edge > grid");
}

/** A plan with no walls and this background, loaded; the drawing's index marked ready for it. */
function loadWithDrawing(index: SnapIndex, mapping: Affine): Background {
  const bg: Background = { assetId: "test-drawing", kind: "pdf", page: 1, mapping };
  usePlanStore.getState().loadPlan({ ...samplePlan, walls: [], openings: [], rooms: [], items: [], takeoffs: undefined, background: bg });
  useDrawingSnapStore.setState({ key: keyOf(bg), status: "ready", index, note: null, ms: 1 });
  useTakeoffStore.getState().setMode("length");
  return bg;
}

function toleranceAndKeys() {
  assert.equal(DRAWING_PX, 14, "a mouse reaches the drawing's points within 14 px");
  assert.equal(TOUCH_PX, 44, "a finger within 44 px");
  assert.equal(SNAP_PX, 12, "the walls' own snap stays 12 px");
  const c: Pt = [5, 5];
  loadWithDrawing(synIndex([seg(5, 5, 6, 5), seg(5, 5, 5, 6)]), SYN);
  const px = 0.01; // metres per screen pixel
  const st = useTakeoffStore.getState();
  const at = (dx: number, touch = false, alt = false, shift = false): TakeoffPointer => ({ at: [c[0] - dx, c[1]], px, touch, alt, shift });
  for (const [touch, reach] of [[false, 14], [true, 44]] as const) {
    st.pointer(at(reach * px - 1e-9, touch));
    assert.equal(useTakeoffStore.getState().hover?.kind, "drawing-corner", `${touch ? "finger" : "mouse"}: just inside ${reach} px snaps to the corner`);
    assert.deepEqual(useTakeoffStore.getState().hover?.point, c, "exactly onto it");
    st.pointer(at(reach * px + 1e-6, touch));
    assert.equal(useTakeoffStore.getState().hover?.kind, "grid", `${touch ? "finger" : "mouse"}: just outside ${reach} px does not`);
  }
  // Alt: the raw point and no drawing kind; with a click 3 px away.
  st.click(at(3 * px, false, true));
  assert.deepEqual(useTakeoffStore.getState().draft[0], [c[0] - 3 * px, c[1]], "Alt keeps the raw point");
  assert.deepEqual(useTakeoffStore.getState().draftSnaps, [null], "and records no drawing snap");
  st.cancel();
  // A query 3 px from the corner returns exactly the corner (the stored point mapped, no rounding).
  st.click(at(3 * px));
  assert.deepEqual(useTakeoffStore.getState().draft[0], c, "3 px off the corner lands exactly on it");
  assert.deepEqual(useTakeoffStore.getState().draftSnaps, ["corner"], "recorded as a drawing corner");
  // Shift keeps one coordinate of the previous point: snapped, but no longer the drawing's point.
  st.click({ at: [5.97, 5.04], px, touch: false, alt: false, shift: true });
  assert.deepEqual(useTakeoffStore.getState().draftSnaps, ["corner", null], "a Shift-held point stores no drawing kind");
  st.cancel();
  console.log("tolerance: 14 px (mouse) and 44 px (finger) at the boundary; Alt raw; Shift unmarked; 3 px off a corner lands exactly on it");
}

// ------------------------------------------------------------------ the real fixture

async function readPdfPlan(file: string) {
  const t = truths.find((x) => x.file === file)!;
  const doc = await openNode(new Uint8Array(readFileSync(join(DIR, file))));
  const page = await doc.getPage(t.planPage);
  const vector = await extractVectorPage(pdfjs, page);
  const { analysis, pdf } = await analysePdfPage(pdfjs, page, { pageCount: doc.numPages, render: renderNode, ocr: noOcr });
  await doc.loadingTask.destroy();
  const scale = { pxPerM: analysis.scale.pxPerM!, source: "pdf" as const };
  const built = buildPdfPlan(analysis, pdf, scale);
  const mapping = buildMapping(built, analysis, pdf, scale, { width: analysis.pixels.width, height: analysis.pixels.height });
  return { plan: built.plan, mapping, index: buildSnapIndex(vector), matches: pdf.scale!.matches };
}

async function failingFirstAndCalibration() {
  const { plan, mapping, index, matches } = await readPdfPlan("plan-filled.pdf");
  const isCorner = (p: Vec2) => nearestMm(index, p, 0) < 1e-9;
  // A printed dimension whose two ends are both drawing corners (inner ends of a dimension chain).
  const dim = matches.find((m) => m.text === "3000 mm" && Math.abs(m.ends.y1 - m.ends.y2) < 1e-6 && isCorner({ x: m.ends.x1, y: m.ends.y1 }) && isCorner({ x: m.ends.x2, y: m.ends.y2 }))!;
  assert.ok(dim, "plan-filled has a horizontal 3000 mm dimension between two drawing corners");
  const ends = [apply(mapping, { x: dim.ends.x1, y: dim.ends.y1 }), apply(mapping, { x: dim.ends.x2, y: dim.ends.y2 })].sort((p, q) => p.x - q.x);
  const bg = loadWithDrawing(index, mapping);
  usePlanStore.getState().loadPlan({ ...plan, background: bg });
  const px = 1 / 80; // 80 px per metre
  const off = 3 * px;
  const clicks: TakeoffPointer[] = [
    { at: [ends[0].x - off, ends[0].y], px, touch: false, alt: false, shift: false },
    { at: [ends[1].x + off, ends[1].y], px, touch: false, alt: false, shift: false },
  ];
  const measureTwo = () => {
    const st = useTakeoffStore.getState();
    st.cancel();
    for (const c of clicks) st.click(c);
    const d = useTakeoffStore.getState().draft;
    return { d, value: dist(d[0], d[1]), snaps: useTakeoffStore.getState().draftSnaps };
  };
  // Without the drawing's snaps (the step before P.1): the walls are 0.9 m away, so both clicks land on the grid.
  useDrawingSnapStore.setState({ key: null, status: "none", index: null });
  const before = measureTwo();
  const errBefore = Math.abs(before.value - dim.metres) * 1000;
  assert.ok(errBefore >= 0.5, `FAILING FIRST: without drawing snaps, two clicks 3 px off the dimension's corners measure ${before.value.toFixed(4)} m against the printed ${dim.metres} m, ${errBefore.toFixed(2)} mm wrong (at least 0.5 mm)`);
  // With them: exactly the PDF's corners, and exactly the printed value.
  useDrawingSnapStore.setState({ key: keyOf(bg), status: "ready", index });
  const after = measureTwo();
  const errAfter = Math.abs(after.value - dim.metres) * 1000;
  assert.ok(errAfter <= 0.01, `with drawing snaps the same clicks measure the printed ${dim.metres} m within 0.01 mm (${errAfter.toExponential(2)} mm)`);
  assert.ok(dist(after.d[0], [ends[0].x, ends[0].y]) < 1e-12 && dist(after.d[1], [ends[1].x, ends[1].y]) < 1e-12, "on the PDF's corners exactly");
  assert.deepEqual(after.snaps, ["corner", "corner"], "both recorded as drawing corners");
  console.log(`FAILING FIRST: "${dim.text}" by two clicks 3 px off its ends: ${(before.value * 1000).toFixed(3)} mm without drawing snaps (${errBefore.toFixed(2)} mm wrong), ${(after.value * 1000).toFixed(6)} mm with them`);

  // The basis: every point on the drawing, nowhere near a wall, is "PDF exact".
  useTakeoffStore.getState().finish();
  const t = usePlanStore.getState().plan.takeoffs!.at(-1)!;
  assert.deepEqual(t.drawingSnaps, ["corner", "corner"], "the takeoff stores the snap kind per point");
  assert.equal(takeoffRow(usePlanStore.getState().plan, t).basis, "PDF exact", "its basis is PDF exact, away from any wall");
  const free = { ...t, id: "free", drawingSnaps: ["corner", null] as ("corner" | null)[] };
  assert.equal(takeoffRow(usePlanStore.getState().plan, free).basis, "Free points", "one point off the drawing: judged by the walls as before");

  // Calibration by 1.05 about the origin: every snap point moves by exactly 1.05 (1e-9).
  const f = 1.05;
  const scaled = scalePlan(usePlanStore.getState().plan, f);
  let worst = 0;
  for (const [x, y] of pointsOf(index)) {
    const p0 = apply(mapping, { x, y });
    const p1 = apply(scaled.background!.mapping, { x, y });
    worst = Math.max(worst, Math.hypot(p1.x - f * p0.x, p1.y - f * p0.y));
  }
  assert.ok(worst <= 1e-9, `calibrating by 1.05 moves every one of ${index.xs.length} snap points by exactly 1.05 about the origin (worst ${worst.toExponential(2)} m)`);
  // ... and a query answers with the moved point, and the scaled takeoff is still on the drawing.
  const q = drawingCandidates(index, scaled.background!.mapping, { x: f * ends[0].x + 0.01, y: f * ends[0].y }, 0.05).point!;
  assert.ok(Math.hypot(q.point[0] - f * ends[0].x, q.point[1] - f * ends[0].y) <= 1e-9, "a query after it returns the moved corner");
  const st = scaled.takeoffs!.at(-1)!;
  assert.deepEqual(st.drawingSnaps, ["corner", "corner"], "the snap kinds survive the calibration");
  assert.ok(Math.abs(dist(st.points[0], st.points[1]) - f * dist(t.points[0], t.points[1])) <= 1e-9, "the takeoff scales with it");
  assert.equal(takeoffRow({ ...scaled, calibrations: [{ factor: f }] }, st).basis, "PDF exact", "and is still PDF exact");
  assert.equal(rescaledText([{ factor: f }]), "Rescaled x1.0500", "which the panel labels Rescaled");
  console.log(`calibration x1.05: ${index.xs.length} snap points moved by exactly 1.05 (worst ${worst.toExponential(2)} m)`);
}

// ------------------------------------------------------------------ speed, cap, disabled

/** Deterministic pseudo-random numbers (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** n segments in a square of `side` points, 3–30 pt long, random directions and strokes. */
function randomPage(n: number, side: number, seed: number): PdfSegment[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, path) => {
    const x = r() * side;
    const y = r() * side;
    const a = r() * Math.PI * 2;
    const l = 3 + r() * 27;
    return { x1: x, y1: y, x2: x + Math.cos(a) * l, y2: y + Math.sin(a) * l, width: 0.25 + r() * 0.5, filled: false, path, curve: false };
  });
}

function speed() {
  const segs = randomPage(50_000, 2384, 7); // an A1 sheet's long side, 50k lines
  const t0 = performance.now();
  const index = buildSnapIndex({ segments: segs });
  const built = performance.now() - t0;
  const map: Affine = { a: 0.0352778, b: 0, c: 0, d: 0.0352778, e: -3, f: -2 }; // 1:100
  const r = rng(11);
  const qs = Array.from({ length: 1000 }, () => ({ x: r() * 2384 * 0.0352778 - 3, y: r() * 2384 * 0.0352778 - 2 }));
  const tol = 14 / 80; // 14 px at 80 px per metre
  let found = 0;
  const t1 = performance.now();
  for (const q of qs) {
    const c = drawingCandidates(index, map, q, tol);
    if (c.point || c.mid || c.edge) found++;
  }
  const ms = performance.now() - t1;
  assert.ok(ms < QUERY_BUDGET_MS, `1000 queries on a 50k-segment page take under ${QUERY_BUDGET_MS} ms (${ms.toFixed(1)} ms)`);
  assert.ok(found > 500, `most queries find something on so busy a page (${found})`);
  // The answers are the brute-force answers.
  const naive = (q: Vec2) => {
    let best = Infinity;
    for (let k = 0; k < index.xs.length; k++) if (index.kinds[k] !== 2) best = Math.min(best, Math.hypot(apply(map, { x: index.xs[k], y: index.ys[k] }).x - q.x, apply(map, { x: index.xs[k], y: index.ys[k] }).y - q.y));
    return best <= tol ? best : null;
  };
  for (const q of qs.slice(0, 50)) {
    const want = naive(q);
    const got = drawingCandidates(index, map, q, tol).point?.d ?? null;
    assert.ok(want === null ? got === null : Math.abs(got! - want) < 1e-12, "the grid finds the same nearest corner or end as a scan of every point");
  }
  console.log(`speed: 50k segments indexed in ${built.toFixed(0)} ms (${index.xs.length} points, ${index.counts.kept} lines kept); 1000 queries in ${ms.toFixed(1)} ms (budget ${QUERY_BUDGET_MS} ms), ${found} with a hit`);
}

function cap() {
  // 70k separate lines on a 15 pt lattice: 140k ends and 70k midpoints, over the 200k cap.
  const r = rng(3);
  const segs: PdfSegment[] = [];
  for (let k = 0; k < 70_000; k++) {
    const x = (k % 280) * 15;
    const y = Math.floor(k / 280) * 15;
    const a = r() * Math.PI;
    segs.push({ x1: x, y1: y, x2: x + Math.cos(a) * 6, y2: y + Math.sin(a) * 6, width: 0.3 + r() * 0.4, filled: false, path: k, curve: false });
  }
  const index = buildSnapIndex({ segments: segs });
  assert.equal(index.counts.kept, 70_000, "every lattice line is kept (none short, thin, dense or hatching)");
  assert.equal(index.xs.length, MAX_POINTS, "at most 200,000 points are kept");
  assert.equal(index.counts.capped, 10_000, "and the rest are counted");
  assert.equal(index.counts.ends, 140_000, "ends before midpoints");
  assert.equal(index.counts.mids, 60_000, "midpoints fill what is left");
  assert.equal(index.note, capNote(210_000), "the note says so");
  assert.equal(index.note, "This drawing has 210,000 snap points; only the first 200,000 are used (corners and ends first).");
  console.log(`cap: 210,000 candidate points → ${index.xs.length}; note "${index.note}"`);
}

async function disabled() {
  assert.equal(indexForPage(await vectorPage("plan-scanned.pdf")), null, "a scanned page gives no index");
  assert.ok(indexForPage(await vectorPage("plan-filled.pdf")), "a vector page does");
  const st = useDrawingSnapStore.getState();
  // No background: nothing to say.
  usePlanStore.getState().loadPlan({ ...samplePlan, background: undefined });
  st.ensure(undefined);
  assert.equal(useDrawingSnapStore.getState().status, "none");
  assert.equal(useDrawingSnapStore.getState().note, null);
  // An image background.
  const image: Background = { assetId: "img", kind: "image", mapping: SYN };
  usePlanStore.getState().loadPlan({ ...samplePlan, background: image });
  st.ensure(image);
  assert.equal(useDrawingSnapStore.getState().status, "disabled", "an image background disables drawing snaps");
  assert.equal(useDrawingSnapStore.getState().note, NEEDS_VECTOR);
  assert.equal(NEEDS_VECTOR, "Drawing snapping needs a vector PDF");
  // A PDF whose bytes are not stored: "loading" at once (clicks go on with the walls' snaps), then disabled.
  setAssetStoreForTests(memoryAssetStore());
  const gone: Background = { assetId: "not-stored", kind: "pdf", page: 1, mapping: SYN };
  usePlanStore.getState().loadPlan({ ...samplePlan, background: gone });
  st.ensure(gone);
  assert.equal(useDrawingSnapStore.getState().status, "loading");
  assert.equal(useDrawingSnapStore.getState().note, READING_DRAWING);
  assert.equal(READING_DRAWING, "Reading drawing for snapping…");
  const st2 = useTakeoffStore.getState();
  st2.setMode("length");
  st2.click({ at: [1.23, 4.56], px: 0.01, touch: false, alt: false, shift: false });
  assert.equal(useTakeoffStore.getState().draft.length, 1, "a click while it loads is not blocked: it uses the walls' snaps and the grid");
  st2.cancel();
  await new Promise<void>((resolve) => {
    const stop = useDrawingSnapStore.subscribe((s) => s.status !== "loading" && (stop(), resolve()));
  });
  assert.equal(useDrawingSnapStore.getState().status, "disabled", "a missing file disables drawing snaps");
  assert.equal(useDrawingSnapStore.getState().note, NEEDS_VECTOR);
  // Clearing the background releases the index.
  const ready = loadWithDrawing(synIndex([seg(0, 0, 1, 0)]), SYN);
  assert.equal(useDrawingSnapStore.getState().key, keyOf(ready));
  usePlanStore.getState().clearBackground();
  assert.equal(useDrawingSnapStore.getState().index, null, "clearing the background releases the index");
  assert.equal(useDrawingSnapStore.getState().status, "none");
  console.log("disabled: a scanned page, an image and a missing file give the note; clicks are never blocked; clearing releases it");
}

/** The inverse mapping round-trips, so queries in plan metres reach the right points. */
function mappingSanity() {
  const m: Affine = { a: 0.03, b: 0.004, c: -0.004, d: 0.03, e: 1, f: 2 };
  const p = { x: 123.4, y: 567.8 };
  const back = apply(invert(m), apply(m, p));
  assert.ok(Math.hypot(back.x - p.x, back.y - p.y) < 1e-9);
  const index = synIndex([seg(0, 0, 1, 0), seg(0, 0, 0, 1)]);
  const rotated = drawingCandidates(index, m, apply(m, { x: 0.5, y: 0.3 }), 0.5).point;
  assert.ok(rotated && Math.hypot(rotated.point[0] - m.e, rotated.point[1] - m.f) < 1e-12, "a turned mapping finds the corner at its mapped place");
  assert.ok(Math.abs(PT_PER_MM - 72 / 25.4) < 1e-12);
}

async function main() {
  await wallCorners();
  await hatching();
  mappingSanity();
  priority();
  toleranceAndKeys();
  await failingFirstAndCalibration();
  speed();
  cap();
  await disabled();
  console.log("test-snap-index: all passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
