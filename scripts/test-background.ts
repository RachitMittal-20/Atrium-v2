/**
 * test-background.ts — step M.2c: the imported drawing under the 2D plan, and the Rescaled labels.
 *
 *   - the stored mapping (src/lib/background/mapping.ts buildMapping, the function Build model
 *     calls) puts every wall endpoint the PDF's own lines give (walls.ts, in points) onto the
 *     matching wall endpoint of the truth AND of the built plan within 0.5 mm: plan-filled,
 *     plan-rotated (/Rotate 90) and plan-imperial (1/8" = 1'-0");
 *   - the image route on the sample plan (public/samples/sample-plan.png, a 10 × 8 m house at
 *     100 px/m) upright and turned 3° (deskewed by the pipeline): each house corner, measured from
 *     the image's own pixels (the centre of the dark wall band), maps onto the built plan's corner
 *     within ONE raster pixel (10 mm) — the image pipeline traces walls to about a pixel;
 *   - FAILING FIRST: calibrate plan-filled by 1.05 WITHOUT scaling the mapping and a PDF wall
 *     endpoint no longer lands on its plan wall (about 5% off: 1 − 1/1.05 of its distance from
 *     the origin); with scalePlan's fix the same PDF point maps to the scaled plan point within 1e-9;
 *   - setBackground and clearBackground are one undo step each, with redo, and calibratePlan
 *     carries the mapping in its one step;
 *   - the autosave holds the descriptor (id, kind, page, mapping) and no bytes; an old plan loads
 *     unchanged with no background field; a malformed descriptor is dropped and the plan kept;
 *   - Build model's keepDrawing: the bytes go to the asset store with the I.1a id rule; refused
 *     storage gives the note and no background; a missing asset reads as "missing" (the panel's
 *     "Import it again to see the background"), a present one as "ready";
 *   - the render region: clipped to the page, k device pixels per point, never over 4096 px;
 *   - the Rescaled text for zero, one and two calibrations, from the store, and gone after undo.
 * Run: npx tsx scripts/test-background.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { samplePlan } from "../src/data/samplePlan";
import { analyseBlueprint, buildFromAnalysis, type OcrResult } from "../src/lib/blueprint/analyse";
import { rotatePixels } from "../src/lib/blueprint/deskew";
import { apply, buildMapping } from "../src/lib/background/mapping";
import { DRAWING_NOT_KEPT, keepDrawing } from "../src/lib/background/keep";
import { setAssetStoreForTests } from "../src/lib/import/assetCache";
import { assetIdOf, memoryAssetStore, type AssetStore } from "../src/lib/import/assetStore";
import { parseStoredPlan, serializePlan } from "../src/lib/persist/planStorage";
import { analysePdfPage } from "../src/lib/pdf/analysePdf";
import { buildPdfPlan } from "../src/lib/pdf/snap";
import { rescaledText, scalePlan } from "../src/lib/plan/calibrate";
import { withSwingSides } from "../src/lib/plan/edit";
import { deriveRooms, toStoredRoom } from "../src/lib/plan/rooms";
import { regionFor, MAX_SIDE } from "../src/components/plan2d/BackgroundLayer";
import { useBackgroundStore } from "../src/store/backgroundStore";
import { usePlanStore } from "../src/store/planStore";
import type { Affine, Background, Plan, Vec2 } from "../src/types/plan";
import type { Truth } from "./make-pdf-fixtures";
import { openNode, pdfjs, renderNode } from "./pdf-node";

const DIR = join(__dirname, "../tests/fixtures/pdf");
const truths: Truth[] = JSON.parse(readFileSync(join(DIR, "truth.json"), "utf8"));
const HALF_MM = 0.0005;
const d = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.y - q.y);
const noOcr = async (): Promise<OcrResult> => ({ labels: [], words: [], error: null, rereads: [] });
const ends = (p: Plan) => p.walls.flatMap((w) => [w.a, w.b]);
const nearest = (ps: Vec2[], q: Vec2) => Math.min(...ps.map((p) => d(p, q)));

/** A PDF fixture read, built at its own scale, and the mapping Build model would store. */
async function readPdf(file: string) {
  const t = truths.find((x) => x.file === file)!;
  const doc = await openNode(new Uint8Array(readFileSync(join(DIR, file))));
  const { analysis, pdf } = await analysePdfPage(pdfjs, await doc.getPage(t.planPage), { pageCount: doc.numPages, render: renderNode, ocr: noOcr });
  await doc.loadingTask.destroy();
  const scale = { pxPerM: analysis.scale.pxPerM!, source: "pdf" as const };
  const built = buildPdfPlan(analysis, pdf, scale);
  const mapping = buildMapping(built, analysis, pdf, scale, { width: analysis.pixels.width, height: analysis.pixels.height });
  // The PDF's own walls, in points: walls.ts reads them in page metres at the PDF's scale.
  const vw = pdf.vectorWalls!;
  const pdfEnds = vw.walls.flatMap((w) => [w.a, w.b]).map((p) => ({ x: p.x / vw.mPerPt, y: p.y / vw.mPerPt }));
  return { t, plan: built.plan, mapping, pdfEnds };
}

/** Every PDF wall endpoint mapped: the worst distance to a truth endpoint and to a built-plan endpoint. */
function landing(mapping: Affine, pdfEnds: Vec2[], truthEnds: Vec2[], planEnds: Vec2[]) {
  let truthWorst = 0;
  let planWorst = 0;
  for (const pt of pdfEnds) {
    const m = apply(mapping, pt);
    truthWorst = Math.max(truthWorst, nearest(truthEnds, m));
    planWorst = Math.max(planWorst, nearest(planEnds, m));
  }
  return { truthWorst, planWorst };
}

async function pdfMappings() {
  for (const file of ["plan-filled.pdf", "plan-rotated.pdf", "plan-imperial.pdf"]) {
    const { t, plan, mapping, pdfEnds } = await readPdf(file);
    assert.ok(pdfEnds.length >= 2 * t.planWalls.length, `${file}: the PDF gives at least as many wall ends as the truth has (${pdfEnds.length})`);
    const truthEnds = t.planWalls.flatMap((w) => [w.a, w.b]);
    const { truthWorst, planWorst } = landing(mapping, pdfEnds, truthEnds, ends(plan));
    assert.ok(truthWorst <= HALF_MM, `${file}: every PDF wall end lands on a true wall end within 0.5 mm (worst ${(truthWorst * 1000).toFixed(4)} mm)`);
    assert.ok(planWorst <= HALF_MM, `${file}: and on a wall end of the built plan within 0.5 mm (worst ${(planWorst * 1000).toFixed(4)} mm)`);
    console.log(`${file}: ${pdfEnds.length} PDF wall ends mapped; worst ${(truthWorst * 1000).toFixed(4)} mm from the truth, ${(planWorst * 1000).toFixed(4)} mm from the plan (mapping a ${mapping.a.toFixed(6)}, d ${mapping.d.toFixed(6)})`);
  }
}

/** Centres of the dark runs along a row or a column of an image (continuous pixels, a pixel's centre at index + 0.5). */
function darkRuns(px: { width: number; height: number; rgba: Uint8ClampedArray }, along: "row" | "col", at: number): number[] {
  const n = along === "row" ? px.width : px.height;
  const dark = (i: number) => px.rgba[((along === "row" ? at * px.width + i : i * px.width + at) * 4) as number] < 128;
  const out: number[] = [];
  for (let i = 0, s = -1; i <= n; i++) {
    if (i < n && dark(i) && s < 0) s = i;
    else if ((i === n || !dark(i)) && s >= 0) {
      if (i - s >= 8) out.push((s + i) / 2); // a wall band (≥ 8 px), not a dimension line or a glazing line
      s = -1;
    }
  }
  return out;
}

async function imageMapping() {
  const { data, info } = await sharp("public/samples/sample-plan.png").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const upright = { width: info.width, height: info.height, rgba: new Uint8ClampedArray(data) };
  // The truth, from the image itself: the exterior wall bands' centres. Row 600 crosses the west
  // and east walls; column 150 the north and south walls (clear of windows and doors there).
  const xs = darkRuns(upright, "row", 600);
  const ys = darkRuns(upright, "col", 150);
  const [x0, x1, y0, y1] = [xs[0], xs[xs.length - 1], ys[0], ys[ys.length - 1]];
  assert.ok(Math.abs(x1 - x0 - 1000) <= 1 && Math.abs(y1 - y0 - 800) <= 1, `the sample house is 1000 × 800 px centre to centre (${x1 - x0} × ${y1 - y0})`);
  const corners = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  const TOL = 0.01; // one raster pixel at 100 px/m: the image pipeline traces to about a pixel
  for (const deg of [0, 3]) {
    const input = deg ? rotatePixels(upright, deg) : upright;
    // rotatePixels' forward map (the inverse of its sampling), to carry the truth into the turned image.
    const [cos, sin] = [Math.cos((deg * Math.PI) / 180), -Math.sin((deg * Math.PI) / 180)];
    const turned = (p: Vec2) => {
      const [sx, sy] = [p.x - upright.width / 2, p.y - upright.height / 2];
      return { x: cos * sx - sin * sy + input.width / 2, y: sin * sx + cos * sy + input.height / 2 };
    };
    const analysis = await analyseBlueprint(input, { ocr: noOcr });
    const scale = { pxPerM: 100, source: "manual" as const };
    const built = buildFromAnalysis(analysis, scale);
    const mapping = buildMapping(built, analysis, undefined, scale, { width: input.width, height: input.height });
    let worst = 0;
    for (const c of corners) worst = Math.max(worst, nearest(ends(built.plan), apply(mapping, deg ? turned(c) : c)));
    assert.ok(worst <= TOL, `sample plan turned ${deg}°: every house corner maps onto the plan's corner within 1 px (worst ${(worst * 1000).toFixed(2)} mm)`);
    console.log(`sample-plan.png turned ${deg}° (deskew found ${analysis.angleDeg}°): 4 corners from the image's own wall bands map within ${(worst * 1000).toFixed(2)} mm of the plan's corners (allowed ${TOL * 1000} mm = 1 px)`);
  }
}

async function calibration() {
  const { plan, mapping, pdfEnds } = await readPdf("plan-filled.pdf");
  const withBg: Plan = { ...plan, background: { assetId: "0123456789abcdef", kind: "pdf", page: 1, mapping } };
  const f = 1.05;
  const scaled = scalePlan(withBg, f);

  // FAILING FIRST: the old mapping on the scaled plan. The drawing would stay put while the walls grow.
  const stale = { ...scaled, background: withBg.background };
  const off = landing(stale.background!.mapping, pdfEnds, ends(scaled), ends(scaled));
  const far = pdfEnds.map((pt) => apply(mapping, pt)).sort((p, q) => d(q, { x: 0, y: 0 }) - d(p, { x: 0, y: 0 }))[0];
  const drift = d(far, { x: far.x * f, y: far.y * f }) / d({ x: far.x * f, y: far.y * f }, { x: 0, y: 0 }); // where it lands vs where its wall went
  assert.ok(off.planWorst > 0.2, `without scaling the mapping, a PDF wall end misses its plan wall end (worst ${(off.planWorst * 1000).toFixed(1)} mm)`);
  assert.ok(Math.abs(drift - (1 - 1 / f)) < 1e-9, `by 1 − 1/1.05 = 4.76% of its distance from the origin (${(drift * 100).toFixed(2)}%)`);
  console.log(`failing first: calibrated ×${f} with the mapping NOT scaled, the farthest PDF wall end is ${(drift * 100).toFixed(2)}% off its plan point (worst wall end ${(off.planWorst * 1000).toFixed(1)} mm away)`);

  // The fix: scalePlan scales the mapping about the same origin.
  let worst = 0;
  for (const pt of pdfEnds) {
    const before = apply(mapping, pt);
    worst = Math.max(worst, d(apply(scaled.background!.mapping, pt), { x: before.x * f, y: before.y * f }));
  }
  assert.ok(worst <= 1e-9, `with the fix the same PDF point maps to the scaled plan point within 1e-9 (worst ${worst.toExponential(2)} m)`);
  const fixed = landing(scaled.background!.mapping, pdfEnds, ends(scaled), ends(scaled));
  assert.ok(fixed.planWorst <= HALF_MM * f, `and every PDF wall end still lands on its scaled plan wall end (worst ${(fixed.planWorst * 1000).toFixed(4)} mm)`);
  // About another origin too, as scalePlan allows.
  const o = { x: 3, y: -2 };
  const aboutO = scalePlan(withBg, f, o);
  const p0 = apply(mapping, pdfEnds[0]);
  assert.ok(d(apply(aboutO.background!.mapping, pdfEnds[0]), { x: o.x + (p0.x - o.x) * f, y: o.y + (p0.y - o.y) * f }) <= 1e-9, "about another origin as well");
  assert.equal(scalePlan(plan, f).background, undefined, "a plan without a drawing gains none");
  console.log(`with the fix: every PDF point maps to its scaled plan point within ${worst.toExponential(1)} m; wall ends within ${(fixed.planWorst * 1000).toFixed(4)} mm`);
  return withBg;
}

/** The sample plan as the store would hold it. */
function sample(): Plan {
  const plan: Plan = { ...samplePlan, openings: withSwingSides(samplePlan.openings.map((o) => ({ ...o }))) };
  return { ...plan, rooms: deriveRooms(plan).map(toStoredRoom) };
}

const BG: Background = { assetId: "0123456789abcdef", kind: "pdf", page: 1, mapping: { a: 0.035278, b: 0, c: 0, d: 0.035278, e: -5.1, f: -7.2 } };

function store(pdfPlan: Plan) {
  const s = () => usePlanStore.getState();
  s().loadPlan(sample());
  const p0 = s().plan;
  s().setBackground(BG);
  assert.deepEqual(s().plan.background, BG, "setBackground stores the descriptor");
  assert.equal(s().past.length, 1, "setBackground is one undo step");
  s().undo();
  assert.equal(s().plan.background, undefined, "undo removes it");
  assert.deepEqual(s().plan, p0, "and leaves the plan exactly as it was");
  s().redo();
  assert.deepEqual(s().plan.background, BG, "redo puts it back");
  s().clearBackground();
  assert.equal(s().plan.background, undefined, "clearBackground removes it");
  assert.equal(s().past.length, 2, "clearBackground is one undo step");
  s().undo();
  assert.deepEqual(s().plan.background, BG, "undo brings it back");
  s().redo();
  assert.equal(s().plan.background, undefined, "redo removes it again");

  // calibratePlan carries the mapping in its ONE step; undo restores it exactly.
  s().loadPlan(pdfPlan);
  const before = s().plan.background!;
  assert.equal(s().calibratePlan(1.02), null, "the calibration is accepted");
  assert.equal(s().past.length, 1, "calibratePlan is still one undo step");
  assert.ok(Math.abs(s().plan.background!.mapping.a - before.mapping.a * 1.02) < 1e-15, "and the mapping is scaled in it");
  s().undo();
  assert.deepEqual(s().plan.background, before, "undo puts the mapping back exactly");
  console.log("store: setBackground and clearBackground are one undo step each with redo; calibratePlan scales the mapping in its one step");
}

function persistence() {
  const withBg: Plan = { ...sample(), background: BG };
  const raw = serializePlan(withBg);
  const stored = JSON.parse(raw).plan.background;
  assert.deepEqual(stored, BG, "the autosave holds the descriptor: id, kind, page and mapping");
  assert.deepEqual(Object.keys(stored).sort(), ["assetId", "kind", "mapping", "page"], "and nothing else");
  assert.deepEqual(parseStoredPlan(raw)!.background, BG, "it round-trips");
  const old = serializePlan(sample());
  assert.ok(!old.includes("background"), "a plan without a drawing stores no background");
  const back = parseStoredPlan(old)!;
  assert.ok(!("background" in back), "an old plan loads with no background field");
  const image = parseStoredPlan(serializePlan({ ...sample(), background: { assetId: BG.assetId, kind: "image", mapping: BG.mapping } }))!;
  assert.deepEqual(image.background, { assetId: BG.assetId, kind: "image", mapping: BG.mapping }, "an image's drawing round-trips without a page");
  for (const [what, mutate] of [
    ["an asset id that isn't 16 hex characters", (b: Record<string, unknown>) => (b.assetId = "nope")],
    ["an unknown kind", (b: Record<string, unknown>) => (b.kind = "dwg")],
    ["a PDF without a page", (b: Record<string, unknown>) => delete b.page],
    ["a mapping with a NaN", (b: Record<string, unknown>) => ((b.mapping as Record<string, unknown>).e = "x")],
    ["a mapping that squashes the drawing flat", (b: Record<string, unknown>) => (b.mapping = { a: 1, b: 2, c: 2, d: 4, e: 0, f: 0 })],
  ] as const) {
    const env = JSON.parse(raw);
    mutate(env.plan.background);
    const got = parseStoredPlan(JSON.stringify(env));
    assert.ok(got, `${what}: the plan still loads`);
    assert.ok(!("background" in got), `${what}: the drawing is dropped`);
  }
  console.log(`autosave: the descriptor only (${JSON.stringify(stored).length} bytes); old plans load unchanged; a malformed descriptor is dropped and the plan kept`);
}

async function keeping() {
  const mem = memoryAssetStore();
  const bytes = new Uint8Array(200_000).map((_, i) => (i * 7) % 251);
  const { plan, note } = await keepDrawing(sample(), { name: "plan.pdf", bytes, kind: "pdf", page: 2 }, BG.mapping, mem);
  assert.equal(note, null, "stored: no note");
  assert.equal(plan.background!.assetId, await assetIdOf([{ name: "plan.pdf", bytes }]), "the asset id is the I.1a SHA-256 rule");
  assert.equal(plan.background!.page, 2, "the page is kept");
  assert.equal((await mem.get(plan.background!.assetId))!.files[0].bytes.length, bytes.length, "the bytes are in the asset store");
  const raw = serializePlan(plan);
  assert.ok(raw.length < serializePlan(sample()).length + 400, `and only the descriptor reaches the autosave (${raw.length - serializePlan(sample()).length} bytes more for a ${bytes.length}-byte file)`);
  const refusing: AssetStore = { ...mem, put: () => Promise.reject(new Error("QuotaExceededError")) };
  const refused = await keepDrawing(sample(), { name: "plan.pdf", bytes, kind: "pdf", page: 1 }, BG.mapping, refusing);
  assert.equal(refused.note, DRAWING_NOT_KEPT, "storage refused: the note");
  assert.equal(refused.note, "The drawing could not be kept for the background.", "in those words");
  assert.ok(!("background" in refused.plan), "and the plan has no background");
  assert.deepEqual(refused.plan, sample(), "and is otherwise the same plan");

  // The studio's view of it: present → ready, absent → missing (the panel's "Import it again").
  setAssetStoreForTests(mem);
  await useBackgroundStore.getState().load(plan.background!.assetId);
  assert.equal(useBackgroundStore.getState().asset?.status, "ready", "a stored drawing reads as ready");
  await useBackgroundStore.getState().load("fedcba9876543210");
  assert.equal(useBackgroundStore.getState().asset?.status, "missing", "a missing one as missing");
  assert.equal(useBackgroundStore.getState().asset?.bytes, null, "with no bytes, so nothing is drawn");
  const broken: AssetStore = { ...mem, get: () => Promise.reject(new Error("storage gone")) };
  setAssetStoreForTests(broken);
  await useBackgroundStore.getState().load("0011223344556677");
  assert.equal(useBackgroundStore.getState().asset?.status, "missing", "storage that throws reads as missing too, never a crash");
  assert.equal(useBackgroundStore.getState().visible, true, "shown by default");
  assert.equal(useBackgroundStore.getState().opacity, 0.5, "at 50%");
  console.log("keepDrawing: stored with the I.1a id, refused storage gives the note and no background; the studio reads ready / missing");
}

function region() {
  const mapping = { a: 0.035278, b: 0, c: 0, d: 0.035278, e: -2, f: -3 }; // 1:100 on A4
  const page = { width: 595.28, height: 841.89 };
  const view = { scale: 60, tx: 100, ty: 80 };
  const r = regionFor(view, { width: 800, height: 600 }, mapping, page, 2)!;
  assert.ok(Math.abs(r.k - 60 * 0.035278 * 2) < 1e-12, "k = the camera's CSS px per point × devicePixelRatio");
  assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width / r.k <= page.width + 1 / r.k && r.y + r.height / r.k <= page.height + 1 / r.k, "inside the page");
  const big = regionFor({ scale: 500, tx: 0, ty: 0 }, { width: 3000, height: 2000 }, mapping, page, 3)!;
  assert.ok(Math.max(big.width, big.height) <= MAX_SIDE, `never over ${MAX_SIDE} px (${big.width} × ${big.height})`);
  assert.equal(regionFor({ scale: 60, tx: 5000, ty: 5000 }, { width: 800, height: 600 }, mapping, page, 1), null, "nothing to render when the page is off screen");
  console.log(`render region: ${r.width} × ${r.height} px at k ${r.k.toFixed(3)}; a huge one capped at ${Math.max(big.width, big.height)} px`);
}

function rescaled(pdfPlan: Plan) {
  assert.equal(rescaledText(undefined), null, "no calibrations: no label");
  assert.equal(rescaledText([]), null, "an empty list: no label");
  assert.equal(rescaledText([{ factor: 1.0234 }]), "Rescaled x1.0234", "one calibration");
  assert.equal(rescaledText([{ factor: 1.02 }, { factor: 1.0033 }]), "Rescaled x1.0234", "two: the product, 1.02 × 1.0033 = 1.023366");
  const s = () => usePlanStore.getState();
  s().loadPlan(pdfPlan);
  assert.equal(rescaledText(s().plan.calibrations), null, "a freshly built plan says nothing");
  s().calibratePlan(1.02);
  assert.equal(rescaledText(s().plan.calibrations), "Rescaled x1.0200", "after one Set scale");
  s().calibratePlan(1.0033);
  assert.equal(rescaledText(s().plan.calibrations), "Rescaled x1.0234", "after two in a row");
  s().undo();
  assert.equal(rescaledText(s().plan.calibrations), "Rescaled x1.0200", "undo the second: back to the first");
  s().undo();
  assert.equal(rescaledText(s().plan.calibrations), null, "undo both: the label disappears");
  console.log("Rescaled: none → no label, ×1.02 → \"Rescaled x1.0200\", then ×1.0033 → \"Rescaled x1.0234\", undo → gone");
}

async function main() {
  await pdfMappings();
  await imageMapping();
  const pdfPlan = await calibration();
  store(pdfPlan);
  persistence();
  await keeping();
  region();
  rescaled(pdfPlan);
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
