/**
 * e2e-pdf-import.ts — browser test of reading floor-plan PDFs on the import screen
 * (step M.1a), with Playwright's Chromium. NOT in npm test: it needs the dev server
 * (npm run dev on port 3000; E2E_URL overrides) for the dev-only hooks
 * window.__planStore and window.__importPdf, and the scanned fixture's OCR fetches
 * tesseract's language data from its CDN on the first run.
 *
 * Every file goes through the REAL file input. At 1440×900 (mouse) and 390×844
 * (real touch: hasTouch, every press a tap):
 *   - 1440, each fixture in tests/fixtures/pdf/: the page picker for the two-page file
 *     (both pages listed with thumbnails, page 2 chosen); the badge (Vector / Scanned
 *     PDF); for vector pages the scale status and its reason, the plan-fit warning
 *     word for word, and the dimension table (one row per printed dimension, each
 *     printed value with its measured value within 0.1 mm of the truth, all OK); the
 *     units switch to feet and inches; for the scanned page the raster route's note
 *     and whatever scale OCR found (printed, not asserted); no request leaves the
 *     origin while a vector PDF is read; then Use / Confirm, Build model, Open in
 *     studio, checked as in the M.1b list below (M.1a's 4-pixel length tolerance and
 *     its unasserted plan-lines are gone: walls now come from the PDF's lines);
 *   - 390: plan-filled (built and checked in the studio), the two-page picker by tap,
 *     no sideways page scroll while the dimension table scrolls inside its container;
 *   - both: a copy of plan-filled with one dimension misprinted (4100 mm on a 4 m line,
 *     made in /tmp by make-pdf-fixtures' misprintedPdf) shows that row Flagged; it is
 *     overridden to 4000 mm with a note; the row says Overridden and keeps the measured
 *     value; the downloaded CSV holds both;
 *   - no console errors.
 * Step M.1b (walls read exactly from the PDF's lines):
 *   - every vector fixture with a scale: the coverage line ("N of M walls read exactly
 *     from the PDF (X% of wall length); K walls are traced approximately (about Y mm)")
 *     with one dashed overlay line per traced wall; the "Model versus printed" table
 *     (one row per dimension landing on the model, each OK, its "between" text); built
 *     and opened in the studio, every wall read from the PDF matches a true wall within
 *     1 mm (both ends, in the page's frame) and the rooms carry the PDF's names (the
 *     outlined page's names come from OCR and are printed, not asserted); a wall's
 *     panel says "Read from PDF", a traced one "Traced, approximate", and after an edit
 *     "Edited";
 *   - plan-single-line: the wall drawn as one line is traced, dashed on the overlay and
 *     listed; its panel says "Traced, approximate"; traced walls within 4 raster px;
 *   - at 390 the new fixtures (plan-clutter, plan-broken-dims, plan-outlined, plan-single-line) and
 *     plan-filled go through the same checks by touch, and the PDF and scale panels sit
 *     above the dimension tables;
 *   - plan-outlined's text is read by OCR, which downloads tesseract's language data
 *     from its CDN: the only requests leaving the origin for that file (the PDF never does);
 *   - the misprinted copy: the model table flags it too, one flagged model row is
 *     overridden, and the CSV holds both tables.
 * Step M.1c (doors, windows and swings from the PDF's lines), plan-doors.pdf at 1440 and
 * 390 (real touch), through the real file input:
 *   - the openings line ("11 of 11 openings read exactly (doors 6, windows 4, unclassified
 *     1); 0 traced approximately; 4 arcs not used"), the default-height line, no traced
 *     opening boxed and one unclassified one boxed on the overlay, as wide as the bare gap;
 *     the model table's two printed opening widths say "opening width" and are OK;
 *   - built and opened in the studio: every opening's jambs (so its width and offset)
 *     within 1 mm of the truth in the page's frame, its kind, provenance "vector", and for
 *     every door the plan's own swing geometry (doorSwing) hanging on the PDF's jamb and
 *     opening to the PDF's side; an opening's panel says "Read from PDF · Default height";
 *   - 1440 only: in 3D, every door's rendered frame-and-leaf box reaches out of the wall on
 *     the PDF's side and not the other (the leaf stands open about 17° towards its swing).
 * Step M.1d (the hinge jamb, thin-rectangle leaves and out-of-range gaps), plan-doors-rect.pdf
 * at 1440 and 390 and plan-gaps.pdf at 1440:
 *   - plan-doors-rect: every leaf drawn as a thin closed rectangle, Bézier arcs on some doors and
 *     polyline arcs on others, and TWO doors on the north wall hinged at opposite jambs opening to
 *     opposite sides. The same openings line and overlay boxes as plan-doors; built and opened,
 *     every opening's width, offset, swing and hinge read from the store against the truth within
 *     1 mm, and no wall turned round; in 3D each door's leaf PIVOTS on its own jamb (the leaf
 *     group's world position, from __scene3d.openings()); then the panel's "Hinge side" control is
 *     clicked for real, the 3D leaf moves to the other jamb and mirrors its turn, and Ctrl+Z puts
 *     both back with the swing side untouched;
 *   - plan-gaps: the coverage sentence "N gaps outside 450 mm to 4000 mm were not read as openings
 *     (sizes: …)" against the truth, with one highlighted box per gap on the overlay. Its 4.60 m
 *     gap is deliberately not bridged, so the generic every-wall-exact checks are skipped for it.
 * Any .pdf in test-plans/ (local only, never committed) is also read at 1440 and one
 * row per file printed: classification, walls total, exact and traced, openings exact,
 * traced and unclassified, arcs not used, and (step M.1d) how many doors are hinged at each
 * jamb once it is built, the out-of-range gaps with their sizes, dimensions read, flagged in
 * each table, time.
 * Screenshots in /tmp/studio/: pdf-review-1440.png, pdf-dimension-check-1440.png,
 * pdf-fit-warning-1440.png, pdf-review-390.png, pdf-coverage-1440.png,
 * pdf-model-check-1440.png, pdf-clutter-1440.png, pdf-traced-1440.png, and (M.1c)
 * pdf-openings-1440.png, pdf-openings-3d-1440.png, pdf-openings-390.png, and (M.1d)
 * pdf-hinges-1440.png, pdf-hinges-3d-1440.png, pdf-gaps-1440.png, pdf-hinges-390.png.
 * Run: npx tsx scripts/e2e-pdf-import.ts
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import { samplePlan } from "../src/data/samplePlan";
import { titleCase } from "../src/lib/blueprint/nameRooms";
import { formatFeetInches } from "../src/lib/pdf/dimensions";
import { doorSwing } from "../src/lib/plan2d/openings";
import type { Opening } from "../src/types/plan";
import type { PdfInfo } from "../src/types/pdf";
import { misprintedPdf, type Truth } from "./make-pdf-fixtures";

const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const OUT = "/tmp/studio";
const TMP = "/tmp/atrium-pdf";
const DIR = join(process.cwd(), "tests/fixtures/pdf");
const LONG = 240_000; // the scanned page's OCR downloads language data on first use
const truths: Truth[] = JSON.parse(readFileSync(join(DIR, "truth.json"), "utf8"));
const KIND = { vector: "Vector PDF", scanned: "Scanned PDF", mixed: "Mixed PDF" } as const;
const NAMES = samplePlan.rooms.map((r) => titleCase(r.name)).sort();

type PlanWall = { id: string; a: { x: number; y: number }; b: { x: number; y: number }; thickness: number; provenance?: "vector" | "traced"; edited?: true };
type Box3d = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
type Win = Window & {
  __planStore?: { getState(): { plan: { walls: PlanWall[]; openings: Opening[]; rooms: { name: string }[] }; updateWall(id: string, c: object): void } };
  __selectionStore?: { getState(): { select(id: string | null): void; selectOpening(id: string | null): void } };
  __importPdf?: PdfInfo;
  __studio3d?: { openingBox(id: string): Box3d | null };
  /** Development only (PlanModel): the door leaves as rendered — where each one pivots (step M.1d). */
  __scene3d?: { openings(): { id: string; kind: string; leafTurn: number | null; leafPivot: { x: number; y: number; z: number } | null; leafBox: Box3d | null }[] };
};
const COVERAGE = /^(\d+) of (\d+) walls read exactly from the PDF \((\d+)% of wall length\); (\d+) walls? (?:is|are) traced approximately \(about (\d+) mm\)\.$/;
/** Fixtures checked at 390 by touch (besides the two-page picker). */
const PHONE = ["plan-filled.pdf", "plan-clutter.pdf", "plan-broken-dims.pdf", "plan-outlined.pdf", "plan-single-line.pdf", "plan-doors.pdf", "plan-doors-rect.pdf", "plan-gaps.pdf"];
/** Fixtures whose openings and door hinges are checked in full (step M.1c, M.1d). */
const DOOR_FILES = ["plan-doors.pdf", "plan-doors-rect.pdf"];
/** The out-of-range-gap fixture (step M.1d): checked for its gap report, not for exact walls. */
const GAP_FILE = "plan-gaps.pdf";
const GAPS = /(\d+) gaps? outside ([\d'".\- \/a-z]+) to ([\d'".\- \/a-z]+) (?:was|were) not read as openings \(sizes: ([^)]+)\)\./;
const OPENINGS = /^(\d+) of (\d+) openings read exactly \(doors (\d+), windows (\d+), unclassified (\d+)\); (\d+) traced approximately; (\d+) arcs? not used\.$/;

const errors: string[] = [];
const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
const report: string[] = [];

async function session(browser: Browser, width: number, height: number, touch: boolean) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, acceptDownloads: true });
  // Step U.1: the dimension tables follow the ONE units setting, whose default is metres. These checks read
  // millimetres to 0.1 mm, so this browser starts with the setting a user who works in mm would have saved.
  await context.addInitScript(() => window.localStorage.setItem("atrium.units", JSON.stringify({ length: "mm", area: "m2" })));
  const page = await context.newPage();
  const tag = `${width}`;
  page.on("pageerror", (e) => errors.push(`${tag} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag} console: ${m.text().slice(0, 200)}`));
  let outside: string[] = [];
  page.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith(BASE) && !u.startsWith("blob:") && !u.startsWith("data:")) outside.push(u);
  });
  const press = (l: Locator) => (touch ? l.tap() : l.click());

  /** Uploads one file through the real input; picks `pick` if the page picker shows. */
  const upload = async (path: string, pick?: number) => {
    await page.goto(`${BASE}/studio/import`);
    outside = [];
    await tid(page, "file-input").setInputFiles(path);
    if (pick) {
      await tid(page, "page-picker").waitFor({ timeout: 60_000 });
      await press(tid(page, `page-${pick}`));
    }
    await page.waitForSelector("[data-testid=results], [data-testid=error]", { timeout: LONG });
    if (await tid(page, "error").count()) assert.fail(`${path}: error "${await tid(page, "error-message").textContent()}"`);
  };

  /** Use / Confirm the found scale, build, open in the studio; returns the stored plan. */
  const buildAndOpen = async () => {
    await press(tid(page, "scale-found").getByRole("button", { name: /^(Use this scale|Confirm this scale)$/ }));
    await press(page.getByRole("button", { name: "Build model" }));
    await tid(page, "summary").waitFor();
    await press(page.getByRole("button", { name: "Open in studio" }));
    await page.waitForURL(/\/studio$/);
    await page.waitForFunction(() => Boolean((window as Win).__planStore));
    return page.evaluate(() => (window as Win).__planStore!.getState().plan);
  };

  /** Every wall read from the PDF on a true wall within 1 mm (both ends, page frame), rooms named from the PDF. */
  const checkPlan = (file: string, plan: Awaited<ReturnType<typeof buildAndOpen>>, t: Truth) => {
    const vec = plan.walls.filter((w) => w.provenance === "vector");
    // The page frame's origin is the true walls' top-left; a traced extra above or left of them would move the plan's.
    const o = { x: Math.min(...vec.flatMap((w) => [w.a.x, w.b.x])), y: Math.min(...vec.flatMap((w) => [w.a.y, w.b.y])) };
    const d = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - o.x - q.x, p.y - o.y - q.y);
    let worst = 0;
    // Where a traced wall meets a PDF wall, the PDF wall is split at that traced joint: then each end must lie on a true centre line.
    const toLine = (p: { x: number; y: number }) =>
      Math.min(
        ...t.planWalls.map((tw) => {
          const L = Math.hypot(tw.b.x - tw.a.x, tw.b.y - tw.a.y);
          const q = { x: p.x - o.x, y: p.y - o.y };
          const k = Math.max(0, Math.min(L, ((q.x - tw.a.x) * (tw.b.x - tw.a.x) + (q.y - tw.a.y) * (tw.b.y - tw.a.y)) / L));
          return Math.hypot(q.x - tw.a.x - ((tw.b.x - tw.a.x) / L) * k, q.y - tw.a.y - ((tw.b.y - tw.a.y) / L) * k);
        }),
      );
    for (const w of vec) {
      const err = t.tracedWalls ? Math.max(toLine(w.a), toLine(w.b)) : Math.min(...t.planWalls.map((tw) => Math.min(Math.max(d(w.a, tw.a), d(w.b, tw.b)), Math.max(d(w.a, tw.b), d(w.b, tw.a)))));
      worst = Math.max(worst, err);
      assert.ok(err <= 0.001, `${file}: wall ${w.id} from the PDF is ${(err * 1000).toFixed(2)} mm from a true wall`);
    }
    const tracedOnes = plan.walls.filter((w) => w.provenance === "traced");
    if (t.tracedWalls) {
      // Traced walls: about a pixel out; allow 4 raster pixels (the M.1a tolerance).
      for (const w of tracedOnes) {
        const err = Math.min(...t.planWalls.map((tw) => Math.min(Math.max(d(w.a, tw.a), d(w.b, tw.b)), Math.max(d(w.a, tw.b), d(w.b, tw.a)))));
        assert.ok(err <= 0.05, `${file}: traced wall ${w.id} ${(err * 1000).toFixed(1)} mm from a true wall`);
      }
      assert.equal(vec.length + tracedOnes.length, t.planWalls.length, `${file}: ${vec.length} from the PDF + ${tracedOnes.length} traced`);
    } else assert.equal(vec.length, t.planWalls.length, `${file}: ${vec.length} walls from the PDF, want ${t.planWalls.length}`);
    const names = plan.rooms.map((r) => r.name).sort();
    if (file !== "plan-outlined.pdf") assert.deepEqual(names, NAMES, `${file}: room names from the PDF`);
    return `in the studio ${vec.length}/${plan.walls.length} walls from the PDF, worst end ${(worst * 1000).toFixed(3)} mm (1 mm allowed); rooms ${names.join(", ")}`;
  };

  /** The coverage line and the dashed traced walls on the overlay; returns [exact, walls, traced]. */
  const checkCoverage = async (file: string, t: Truth) => {
    const text = (await tid(page, "coverage-line").innerText()).trim();
    const m = text.match(COVERAGE);
    assert.ok(m, `${file}: coverage line "${text}"`);
    const [exact, walls, pct, traced] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    if (t.tracedWalls) assert.ok(traced >= t.tracedWalls.length && exact + traced === t.planWalls.length, `${file}: ${exact} exact and ${traced} traced (${t.tracedWalls} can only be traced)`);
    else assert.equal(exact, t.planWalls.length, `${file}: every real wall read exactly`);
    assert.equal(traced, walls - exact, `${file}: the rest traced`);
    if (!traced) assert.equal(pct, 100, `${file}: 100% of the length`);
    assert.equal(await page.locator("[data-testid=plan-viewer] [data-traced]").count(), traced, `${file}: one dashed line per traced wall on the overlay`);
    if (traced) assert.equal(await tid(page, "coverage-traced").locator("li").count(), traced, `${file}: and listed`);
    const skipped = await tid(page, "coverage-skipped").innerText();
    if (t.diagonal) assert.ok(skipped.startsWith(`${t.diagonal} diagonal wall`), `${file}: the diagonal wall counted: ${skipped}`);
    return { exact, walls, traced, text, openings: await tid(page, "coverage-openings").innerText() };
  };

  /** The model table: one row per dimension, all OK, centre to centre on these fixtures. */
  const checkModel = async (file: string, t: Truth) => {
    const rows = tid(page, "model-row");
    assert.equal(await rows.count(), t.dims.length, `${file}: every dimension lands on the model`);
    let approximate = 0;
    for (let i = 0; i < t.dims.length; i++) {
      // A row landing on a traced wall is approximate and may be flagged; every other row is OK.
      const approx = (await rows.nth(i).getAttribute("data-approximate")) === "true";
      approximate += Number(approx);
      if (!approx) assert.equal(await rows.nth(i).getAttribute("data-status"), "ok", `${file}: model row ${i} OK`);
      // plan-doors (M.1c) also prints two opening widths, measured between the opening's jambs.
      const printed = await rows.nth(i).getAttribute("data-printed");
      const spans = t.dims.find((x) => x.text === printed)?.spans ?? "centre to centre";
      assert.equal((await rows.nth(i).locator("[data-testid=model-spans]").innerText()).trim(), spans, `${file}: model row ${i} ${spans}`);
    }
    if (t.tracedWalls) assert.ok(approximate > 0, `${file}: rows on the traced wall say approximate`);
    else assert.equal(approximate, 0, `${file}: no approximate rows`);
    return approximate;
  };

  /** A wall's panel says where it came from, and "Edited" after a change (then undone). */
  const checkPanel = async (plan: Awaited<ReturnType<typeof buildAndOpen>>) => {
    const say: string[] = [];
    for (const w of [plan.walls.find((x) => x.provenance === "vector"), plan.walls.find((x) => x.provenance === "traced")]) {
      if (!w) continue;
      await page.evaluate((id) => (window as Win).__selectionStore!.getState().select(id), w.id);
      if (touch && !(await tid(page, "wall-panel").isVisible())) await press(page.getByRole("button", { name: /Plan details/ }));
      await tid(page, "wall-provenance").waitFor();
      const text = (await tid(page, "wall-provenance").innerText()).trim();
      assert.equal(text, w.provenance === "vector" ? "Read from PDF" : "Traced, approximate", `wall ${w.id}: provenance text`);
      say.push(`${w.id} "${text}"`);
    }
    const id = plan.walls.find((x) => x.provenance === "vector")!.id;
    await page.evaluate((i) => (window as Win).__selectionStore!.getState().select(i), id);
    await page.evaluate((i) => (window as Win).__planStore!.getState().updateWall(i, { height: 3 }), id);
    await page.waitForFunction(() => document.querySelector("[data-testid=wall-provenance]")?.textContent?.trim() === "Edited");
    const after = await page.evaluate((i) => (window as Win).__planStore!.getState().plan.walls.find((w) => w.id === i), id);
    assert.ok(after?.provenance === "vector" && after.edited === true, "edited: provenance kept, marked edited");
    say.push(`${id} after a height change "Edited"`);
    return say.join(", ");
  };

  /** Step M.1c, plan-doors on the review screen: the openings line, the default heights, the boxes on the overlay. */
  const checkDoorsReview = async (file: string, t: Truth) => {
    const name = file.replace(".pdf", "");
    const text = (await tid(page, "coverage-openings-line").innerText()).trim();
    const m = text.match(OPENINGS);
    assert.ok(m, `${name}: openings line "${text}"`);
    const unclassified = t.planOpenings.filter((o) => o.class === "unclassified");
    const want = [t.planOpenings.length, t.planOpenings.length, t.planOpenings.filter((o) => o.kind === "door").length - unclassified.length, t.planOpenings.filter((o) => o.kind === "window").length, unclassified.length, 0, t.decoyArcs];
    assert.deepEqual(m.slice(1).map(Number), want, `${name}: openings line numbers (${text})`);
    assert.ok((await tid(page, "coverage-heights").innerText()).includes("default height"), `${name}: the default heights are said`);
    assert.equal(await page.locator("[data-opening-mark=traced]").count(), 0, `${name}: no traced opening boxed`);
    const boxes = page.locator("[data-opening-mark=unclassified]");
    assert.equal(await boxes.count(), unclassified.length, `${name}: the unclassified opening boxed on the overlay`);
    // Its box is as long as the bare gap is wide, in raster pixels.
    const pdf = (await page.evaluate(() => (window as Win).__importPdf))!;
    const pxPerM = pdf.pxPerPt / pdf.scale!.mPerPt!;
    const len = await boxes.first().evaluate((l) => Math.hypot(Number(l.getAttribute("x2")) - Number(l.getAttribute("x1")), Number(l.getAttribute("y2")) - Number(l.getAttribute("y1"))));
    const gapM = Math.hypot(unclassified[0].b.x - unclassified[0].a.x, unclassified[0].b.y - unclassified[0].a.y);
    assert.ok(Math.abs(len - gapM * pxPerM) < 1, `${name}: the box is the gap (${len.toFixed(1)} px, want ${(gapM * pxPerM).toFixed(1)})`);
    assert.ok((await tid(page, "coverage-unclassified").innerText()).includes("Opening type not drawn; assumed door"), `${name}: listed as an assumed door`);
    await tid(page, "coverage").scrollIntoViewIfNeeded();
    // plan-doors keeps M.1c's screenshot names; plan-doors-rect takes M.1d's "hinges" ones.
    await page.screenshot({ path: `${OUT}/${file === "plan-doors-rect.pdf" ? "pdf-hinges" : "pdf-openings"}-${touch ? 390 : 1440}.png`, fullPage: true });
    return `"${text}", the unclassified gap boxed (${len.toFixed(1)} px), no traced boxes`;
  };

  /** Step M.1d, plan-gaps on the review screen: the out-of-range sentence and the highlight. */
  const checkGapsReview = async (t: Truth) => {
    const want = [...t.outOfRangeGaps!].sort((a, b) => a - b);
    const line = tid(page, "coverage-gaps-line");
    await line.waitFor();
    const text = (await line.innerText()).trim();
    const m = text.match(GAPS);
    assert.ok(m, `plan-gaps: the out-of-range sentence "${text}"`);
    assert.equal(Number(m[1]), want.length, `plan-gaps: ${want.length} gaps said (${text})`);
    assert.deepEqual([m[2], m[3]], ["450 mm", "4000 mm"], `plan-gaps: the range as printed (${m[2]} to ${m[3]})`);
    // The sizes, in the mm this browser is set to, and in the order the panel lists them.
    const said = m[4].split(", ").map((s) => Number(s.replace(/[^\d.]/g, "")) / 1000);
    assert.deepEqual([...said].sort((a, b) => a - b).map((v) => +v.toFixed(3)), want.map((v) => +v.toFixed(3)), `plan-gaps: the sizes (${m[4]})`);
    // data-sizes carries them unrounded, so the check does not depend on the displayed unit.
    const attr = (await line.getAttribute("data-sizes"))!.split(" ").map(Number);
    assert.deepEqual([...attr].sort((a, b) => a - b).map((v) => +v.toFixed(3)), want.map((v) => +v.toFixed(3)), "plan-gaps: data-sizes agrees");
    // Highlighted on the overlay: one box per gap, each as long as the gap is wide.
    const boxes = page.locator("[data-opening-mark=gap]");
    assert.equal(await boxes.count(), want.length, "plan-gaps: every gap highlighted on the overlay");
    const pdf = (await page.evaluate(() => (window as Win).__importPdf))!;
    const pxPerM = pdf.pxPerPt / pdf.scale!.mPerPt!;
    const lens = await boxes.evaluateAll((ls) => ls.map((l) => Math.hypot(Number(l.getAttribute("x2")) - Number(l.getAttribute("x1")), Number(l.getAttribute("y2")) - Number(l.getAttribute("y1")))));
    assert.deepEqual(
      [...lens].sort((a, b) => a - b).map((v) => +(v / pxPerM).toFixed(2)),
      want.map((v) => +v.toFixed(2)),
      `plan-gaps: each box is its gap (${lens.map((v) => (v / pxPerM).toFixed(2)).join(", ")} m)`,
    );
    // And the layer's own toggle says how many.
    assert.ok((await page.locator("label", { hasText: "Gaps not read" }).innerText()).includes(String(want.length)), "plan-gaps: the overlay layer is listed with its count");
    await tid(page, "coverage").scrollIntoViewIfNeeded();
    if (!touch) await page.screenshot({ path: `${OUT}/pdf-gaps-1440.png`, fullPage: true });
    return `"${text}", ${want.length} boxed on the overlay`;
  };

  /** Step M.1c, plan-doors in the studio: every opening against the truth, a panel, and (1440) the 3D leaves. */
  const checkDoorsStudio = async (file: string, plan: Awaited<ReturnType<typeof buildAndOpen>>, t: Truth) => {
    const name = file.replace(".pdf", "");
    const vec = plan.walls.filter((w) => w.provenance === "vector");
    const o = { x: Math.min(...vec.flatMap((w) => [w.a.x, w.b.x])), y: Math.min(...vec.flatMap((w) => [w.a.y, w.b.y])) }; // the page frame's origin
    const P = (p: { x: number; y: number }) => ({ x: p.x - o.x, y: p.y - o.y });
    const dd = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);
    let worst = 0;
    const found: { id: string; to: Truth["planOpenings"][number]; op: Opening }[] = [];
    for (const to of t.planOpenings) {
      const hit = plan.openings
        .map((op) => {
          const w = plan.walls.find((x) => x.id === op.wallId)!;
          const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
          const at = (s: number) => P({ x: w.a.x + ((w.b.x - w.a.x) / L) * s, y: w.a.y + ((w.b.y - w.a.y) / L) * s });
          const [p, q] = [at(op.offset - op.width / 2), at(op.offset + op.width / 2)];
          return { op, w, err: Math.min(Math.max(dd(p, to.a), dd(q, to.b)), Math.max(dd(p, to.b), dd(q, to.a))) };
        })
        .sort((x, y) => x.err - y.err)[0];
      assert.ok(hit && hit.err <= 0.001, `${name}: ${to.id} within 1 mm (${hit ? (hit.err * 1000).toFixed(3) : "none"} mm)`);
      worst = Math.max(worst, hit.err);
      const { op, w } = hit;
      assert.equal(op.kind, to.kind, `${name}: ${to.id} is a ${to.kind}`);
      assert.ok(Math.abs(op.width - Math.hypot(to.b.x - to.a.x, to.b.y - to.a.y)) <= 0.001, `${name}: ${to.id} width`);
      assert.ok(op.provenance === "vector" && op.defaultHeight === true, `${name}: ${to.id} read from the PDF, default height`);
      // Step M.1d: the centre's distance from the wall's a end, read straight from the store.
      const alongTo = (q: { x: number; y: number }) => ((q.x + o.x - w.a.x) * (w.b.x - w.a.x) + (q.y + o.y - w.a.y) * (w.b.y - w.a.y)) / Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
      const wantOffset = (alongTo(to.a) + alongTo(to.b)) / 2;
      assert.ok(Math.abs(op.offset - wantOffset) <= 0.001, `${name}: ${to.id} offset within 1 mm (${op.offset.toFixed(4)} vs ${wantOffset.toFixed(4)})`);
      if (to.side) {
        const sw = doorSwing({ a: P(w.a), b: P(w.b) }, op);
        if (to.hinge) assert.ok(dd(sw.hinge, to.hinge) <= 0.001, `${name}: ${to.id} hangs on the PDF's jamb (${(dd(sw.hinge, to.hinge) * 1000).toFixed(3)} mm)`);
        assert.ok((sw.leafEnd.x - sw.hinge.x) * to.side.x + (sw.leafEnd.y - sw.hinge.y) * to.side.y > 0, `${name}: ${to.id} (${op.swing}) opens to the PDF's side`);
        // Step M.1d: the hinge jamb is stored, not worked around by turning the wall round.
        if (to.hingeEnd) assert.equal(op.hinge ?? "a", to.hingeEnd, `${name}: ${to.id} is stored hinged at the ${to.hingeEnd} jamb`);
      }
      found.push({ id: op.id, to, op });
    }
    assert.equal(plan.openings.length, t.planOpenings.length, `${name}: exactly the drawn openings`);
    // Step M.1d: every wall read from the PDF still runs the way walls.ts read it (a = the smaller
    // coordinate). M.1c reversed a wall whose doors hung on its b jamb; nothing does now.
    for (const w of vec) assert.ok(w.a.x < w.b.x - 1e-9 || (Math.abs(w.a.x - w.b.x) < 1e-9 && w.a.y < w.b.y - 1e-9), `${name}: wall ${w.id} was not turned round`);
    // An opening's panel says where it came from. Pick a door hinged at its wall's b jamb when the
    // fixture has one (both of these do), so the hinge control is exercised on the interesting case.
    const door = found.find((f) => f.to.hingeEnd === "b") ?? found.find((f) => f.op.kind === "door")!;
    await page.evaluate((id) => (window as Win).__selectionStore!.getState().selectOpening(id), door.id);
    if (touch && !(await tid(page, "opening-panel").isVisible())) await press(page.getByRole("button", { name: /Plan details/ }));
    await tid(page, "opening-provenance").waitFor();
    const said = (await tid(page, "opening-provenance").innerText()).trim();
    assert.equal(said, "Read from PDF · Default height", `${name}: the opening panel's provenance`);
    let leaves = "";
    if (!touch) {
      // 3D: each door's frame and leaf (open about 17° towards its swing) reach out of the wall on the PDF's side only.
      await press(tid(page, "view-3d"));
      await page.waitForFunction(() => Boolean((window as Win).__studio3d));
      await page.waitForTimeout(800);
      const out: string[] = [];
      for (const f of found.filter((x) => x.to.side && x.op.kind === "door")) {
        const box = await page.evaluate((id) => (window as Win).__studio3d!.openingBox(id), f.id);
        assert.ok(box, `${name}: ${f.to.id} drawn in 3D`);
        const w = plan.walls.find((x) => x.id === f.op.wallId)!;
        const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
        const c = { x: w.a.x + ((w.b.x - w.a.x) / L) * f.op.offset, y: w.a.y + ((w.b.y - w.a.y) / L) * f.op.offset };
        // World x = plan x, world z = plan y; the box's corners along the PDF's side of the wall.
        const along = [box.minX, box.maxX].flatMap((x) => [box.minZ, box.maxZ].map((z) => (x - c.x) * f.to.side!.x + (z - c.y) * f.to.side!.y));
        const [far, back] = [Math.max(...along), -Math.min(...along)];
        assert.ok(far > w.thickness / 2 + 0.1 && far > back + 0.1, `${name}: ${f.to.id}'s 3D leaf stands out on the PDF's side (${far.toFixed(3)} m there, ${back.toFixed(3)} m behind)`);
        out.push(`${f.to.id} ${far.toFixed(2)}/${back.toFixed(2)} m`);
      }
      // Step M.1d: each leaf PIVOTS on its own jamb. __scene3d.openings() gives the leaf group's
      // world position, which is the hinge; compare it with the jamb the PDF drew it on.
      const leafs = await page.evaluate(() => (window as Win).__scene3d!.openings());
      const pivots: string[] = [];
      for (const f of found.filter((x) => x.op.kind === "door" && x.to.hinge)) {
        const got = leafs.find((l) => l.id === f.id);
        assert.ok(got?.leafPivot, `${name}: ${f.to.id}'s 3D leaf is in the scene with a pivot`);
        const w = plan.walls.find((x) => x.id === f.op.wallId)!;
        // World (x, z) = plan (x, y). The jamb the leaf must pivot on, in the page frame:
        const pivotPlan = P({ x: got!.leafPivot!.x, y: got!.leafPivot!.z });
        const [jA, jB] = (() => {
          const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
          const at = (s: number) => P({ x: w.a.x + ((w.b.x - w.a.x) / L) * s, y: w.a.y + ((w.b.y - w.a.y) / L) * s });
          return [at(f.op.offset - f.op.width / 2), at(f.op.offset + f.op.width / 2)];
        })();
        const wantJamb = (f.op.hinge ?? "a") === "a" ? jA : jB;
        const otherJamb = (f.op.hinge ?? "a") === "a" ? jB : jA;
        // The pivot sits a frame member (0.05 m) inside the gap, so allow that much and no more.
        assert.ok(dd(pivotPlan, wantJamb) <= 0.06, `${name}: ${f.to.id}'s 3D leaf pivots on its ${f.op.hinge ?? "a"} jamb (${(dd(pivotPlan, wantJamb) * 1000).toFixed(0)} mm from it, ${(dd(pivotPlan, otherJamb) * 1000).toFixed(0)} mm from the other)`);
        assert.ok(dd(pivotPlan, wantJamb) < dd(pivotPlan, otherJamb), `${name}: ${f.to.id} pivots nearer that jamb than the other`);
        assert.ok(dd(pivotPlan, f.to.hinge!) <= 0.06, `${name}: and that is the jamb the PDF drew it on`);
        pivots.push(`${f.to.id} ${f.op.hinge ?? "a"} (${(dd(pivotPlan, f.to.hinge!) * 1000).toFixed(0)} mm)`);
      }
      await page.screenshot({ path: `${OUT}/${file === "plan-doors-rect.pdf" ? "pdf-hinges-3d-1440" : "pdf-openings-3d-1440"}.png` });
      leaves = `; 3D leaves out on the PDF's side (front/behind): ${out.join(", ")}; pivots on their own jamb: ${pivots.join(", ")}`;
      // ---- the panel's hinge control, with a real click, and Ctrl+Z (step M.1d)
      if (file === "plan-doors-rect.pdf") leaves += `; ${await checkHingeFlip(door.id, door.op.hinge ?? "a")}`;
    }
    return `${found.length} openings within 1 mm (worst ${(worst * 1000).toFixed(3)} mm), every door on the PDF's jamb and side; panel "${said}"${leaves}`;
  };

  /**
   * Step M.1d: flip a door's hinge in the OpeningPanel with a real click, and check the rendered 3D
   * leaf really moves to the other jamb and Ctrl+Z puts it back. Run with the 3D view showing.
   */
  const checkHingeFlip = async (id: string, from: "a" | "b") => {
    const to = from === "a" ? "b" : "a";
    const pivotOf = async () => {
      const got = (await page.evaluate(() => (window as Win).__scene3d!.openings())).find((l) => l.id === id);
      assert.ok(got?.leafPivot, "the leaf is in the scene");
      return { p: got!.leafPivot!, turn: got!.leafTurn! };
    };
    await page.evaluate((x) => (window as Win).__selectionStore!.getState().selectOpening(x), id);
    const control = tid(page, "opening-hinge");
    await control.waitFor();
    assert.equal(await control.getAttribute("data-hinge"), from, `the hinge control shows ${from}`);
    assert.equal(await tid(page, `hinge-${from}`).getAttribute("aria-pressed"), "true", "the current jamb is pressed");
    const before = await pivotOf();
    await press(tid(page, `hinge-${to}`)); // a real click on the other jamb
    await page.waitForTimeout(250);
    assert.equal(await control.getAttribute("data-hinge"), to, `the control now shows ${to}`);
    const after = await pivotOf();
    const moved = Math.hypot(after.p.x - before.p.x, after.p.z - before.p.z);
    assert.ok(moved > 0.5, `the 3D leaf moved to the other jamb (${moved.toFixed(3)} m along the wall)`);
    assert.ok(Math.abs(after.turn + before.turn) < 1e-6, `and mirrored its turn (${before.turn.toFixed(3)} → ${after.turn.toFixed(3)} rad)`);
    const swing = await page.evaluate((x) => (window as Win).__planStore!.getState().plan.openings.find((op) => op.id === x)!.swing, id);
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(250);
    assert.equal(await control.getAttribute("data-hinge"), from, "Ctrl+Z puts the hinge back");
    const back = await pivotOf();
    assert.ok(Math.hypot(back.p.x - before.p.x, back.p.z - before.p.z) < 1e-6, "and the 3D leaf with it");
    assert.equal(back.turn, before.turn, "turn restored exactly");
    const swingBack = await page.evaluate((x) => (window as Win).__planStore!.getState().plan.openings.find((op) => op.id === x)!.swing, id);
    assert.equal(swingBack, swing, "the swing side was never touched by either");
    return `hinge ${from} → ${to} by a real click moved the 3D leaf ${moved.toFixed(2)} m and mirrored its turn; Ctrl+Z restored both`;
  };

  /** The dimension table against the truth: values within 0.1 mm, all OK. */
  const checkTable = async (file: string, t: Truth) => {
    const rows = tid(page, "dim-row");
    assert.equal(await rows.count(), t.dims.length, `${file}: one row per dimension`);
    for (let i = 0; i < t.dims.length; i++) {
      const row = rows.nth(i);
      const printed = (await row.getAttribute("data-printed"))!;
      const d = t.dims.find((x) => x.text === printed);
      assert.ok(d, `${file}: row "${printed}" is a printed dimension`);
      assert.equal(await row.getAttribute("data-status"), "ok", `${file}: "${printed}" OK`);
      const measured = await row.locator("[data-testid=dim-measured]").textContent();
      const mm = Number(measured!.replace(/[^\d.]/g, ""));
      assert.ok(Math.abs(mm - d.metres * 1000) <= 0.1, `${file}: "${printed}" measured ${measured}`);
    }
  };

  // ---------------------------------------------------------------- every fixture (1440), or the phone's subset
  const files = touch ? [...PHONE, "plan-two-pages.pdf"] : truths.map((t) => t.file);
  for (const file of files) {
    const t = truths.find((x) => x.file === file)!;
    const t0 = Date.now();
    if (t.pages > 1) {
      await page.goto(`${BASE}/studio/import`);
      outside = []; // as upload() does; a file before this one (plan-outlined's OCR) may have fetched
      await tid(page, "file-input").setInputFiles(join(DIR, file));
      await tid(page, "page-picker").waitFor({ timeout: 60_000 });
      assert.equal(await page.locator("[data-testid^=page-]:not([data-testid=page-picker])").count(), t.pages, `${file}: every page listed`);
      await page.locator(`[data-testid=page-1] img`).waitFor({ timeout: 30_000 });
      assert.ok(await page.locator(`[data-testid=page-1] img`).evaluate((img: HTMLImageElement) => img.naturalWidth > 0), `${file}: page 1 thumbnail drawn`);
      await press(tid(page, `page-${t.planPage}`));
      await page.waitForSelector("[data-testid=results], [data-testid=error]", { timeout: LONG });
    } else await upload(join(DIR, file));
    const ms = Date.now() - t0;

    assert.equal((await tid(page, "pdf-badge").textContent())?.trim(), KIND[t.kind], `${file}: badge`);
    const pdf = (await page.evaluate(() => (window as Win).__importPdf))!;
    assert.equal(pdf.pageNumber, t.planPage, `${file}: page ${t.planPage} read`);
    const notes = await tid(page, "pdf-notes").innerText();
    let line = `${touch ? "390" : "1440"} ${file}: ${KIND[t.kind]}`;
    if (t.kind === "scanned") {
      assert.ok(notes.includes("Scanned PDF: measurements are approximate."), `${file}: raster note`);
      assert.equal(pdf.route, "raster");
      const found = await tid(page, "scale-found").count();
      line += `; raster route at 300 dpi; OCR scale: ${found ? (await tid(page, "suggested-scale").textContent()) + " px/m" : "none"} (${await page.locator("[data-testid=scale-found] p, [data-testid=scale-none]").first().innerText()})`;
    } else {
      // An outlined page's text is read by OCR, which fetches tesseract's language data from its CDN; nothing else leaves.
      if (file === "plan-outlined.pdf") assert.ok(outside.every((u) => /jsdelivr|tesseract|unpkg/.test(u)), `${file}: only OCR's language data left the origin: ${outside.join(", ")}`);
      else assert.deepEqual(outside, [], `${file}: no request left the origin`);
      assert.ok(notes.includes("Read from PDF vectors."), `${file}: vector note`);
      // M.1b replaced M.1a's "Wall positions are traced at about N mm; exact snapping arrives in the next step."
      assert.match(notes, /Walls are read exactly from the PDF's lines; any the lines don't explain are traced at about \d+ mm\./, `${file}: trace note`);
      if (file === "plan-outlined.pdf") assert.ok(notes.includes("so it was read by OCR"), `${file}: the OCR note`);
      const status = await tid(page, "pdf-scale-status").getAttribute("data-confidence");
      assert.equal(status, t.expectedScale, `${file}: scale status`);
      const reason = await tid(page, "pdf-scale-reason").innerText();
      assert.ok(reason.length > 10, `${file}: a reason`);
      if (t.mismatchRatio)
        assert.equal(
          (await tid(page, "pdf-mismatch").innerText()).trim(),
          `The title block says 1:100, but the printed dimensions measure 1:${t.mismatchRatio}, so the page was probably scaled to fit when printed. Using the dimensions.`,
          `${file}: mismatch warning`,
        );
      else assert.equal(await tid(page, "pdf-mismatch").count(), 0, `${file}: no mismatch`);
      line += `; scale ${status} ("${reason}")`;
      if (t.dims.length) {
        await checkTable(file, t);
        const hows = [...new Set(await page.locator("[data-testid=dim-how]").allInnerTexts())].join(" / ");
        line += `; ${t.dims.length} dimensions, all OK within 0.1 mm of the truth (${hows})`;
        if (file === "plan-outlined.pdf") assert.ok(hows.split(" / ").every((h) => h.endsWith("read by OCR")), `${file}: every row read by OCR`);
        if (file === "plan-broken-dims.pdf") assert.ok(hows.includes("between ticks") && hows.includes("line length"), `${file}: ticks and a line length`);
      } else assert.equal(await tid(page, "dimension-check").count(), 0, `${file}: no table without dimensions`);
      // plan-gaps (step M.1d) is the out-of-range-gap fixture: its 4.60 m gap is deliberately NOT
      // bridged, so that wall is two pieces with free ends, the living room does not close, and the
      // generic "every wall exact / four rooms / every dimension lands on the model" checks do not
      // apply to it. Its own check is the gap report.
      if (file === GAP_FILE) {
        line += `; ${await checkGapsReview(t)}`;
        report.push(`${line}; ${(ms / 1000).toFixed(1)} s`);
        console.log(report[report.length - 1]);
        continue;
      }
      const cov = await checkCoverage(file, t);
      line += `; "${cov.text}" ${cov.openings}`;
      if (DOOR_FILES.includes(file)) line += `; ${await checkDoorsReview(file, t)}`;
      if (t.dims.length) {
        const approx = await checkModel(file, t);
        line += `; model check ${t.dims.length} rows ${t.dims.some((x) => x.spans) ? "centre to centre and opening widths" : "centre to centre"}, ${approx ? `${approx} approximate (on traced walls), the rest OK` : "all OK"}`;
      }
      if (!touch && file === "plan-filled.pdf") {
        await tid(page, "coverage").scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${OUT}/pdf-coverage-1440.png`, fullPage: true });
        await tid(page, "model-check").screenshot({ path: `${OUT}/pdf-model-check-1440.png` });
      }
      if (!touch && file === "plan-clutter.pdf") await page.screenshot({ path: `${OUT}/pdf-clutter-1440.png`, fullPage: true });
      if (!touch && file === "plan-single-line.pdf") await page.screenshot({ path: `${OUT}/pdf-traced-1440.png`, fullPage: true });
      if (touch) {
        // Phone order: the PDF and scale panels above the dimension tables.
        const y = async (id: string) => (await tid(page, id).boundingBox())!.y;
        const tables = await y("dimension-check");
        assert.ok((await y("pdf-panel")) < tables && (await y("scale-panel")) < tables && (await y("coverage")) < tables, `${file}: 390 panels above the tables`);
        const widths = await page.evaluate(() => [window.innerWidth, document.documentElement.scrollWidth]);
        assert.deepEqual(widths, [390, 390], `${file}: 390 no sideways page scroll (${widths})`);
      }
      if (file === "plan-filled.pdf" && !touch) {
        await page.screenshot({ path: `${OUT}/pdf-review-1440.png`, fullPage: true });
        await press(tid(page, "units-ftin"));
        const row = page.locator(`[data-testid=dim-row][data-printed="4000 mm"]`).first();
        assert.equal((await row.locator("[data-testid=dim-measured]").textContent())?.trim(), formatFeetInches(4), "ft-in: 4000 mm reads 13' 1 1/2\"");
        await press(tid(page, "units-mm"));
      }
      if (file === "plan-fit.pdf") await page.screenshot({ path: `${OUT}/pdf-fit-warning-1440.png`, fullPage: true });
      if (file === "plan-filled.pdf" && touch) {
        // innerWidth too: with isMobile, an overflowing page widens the layout viewport itself (the
        // table's sr-only header label once made it 577 px), so scrollWidth <= innerWidth alone passes.
        const widths = await page.evaluate(() => [window.innerWidth, document.documentElement.scrollWidth]);
        assert.deepEqual(widths, [390, 390], `390: no sideways page scroll (layout viewport and page width ${widths})`);
        assert.ok(await tid(page, "dims-scroll").evaluate((el) => el.scrollWidth > el.clientWidth), "390: the table scrolls inside its own container");
        await page.screenshot({ path: `${OUT}/pdf-review-390.png`, fullPage: true });
      }
      if (t.expectedScale !== "none" && (!touch || PHONE.includes(file))) {
        const plan = await buildAndOpen();
        line += `; ${checkPlan(file, plan, t)}`;
        line += `; panel: ${await checkPanel(plan)}`;
        if (DOOR_FILES.includes(file)) line += `; ${await checkDoorsStudio(file, plan, t)}`;
      }
    }
    report.push(`${line}; ${(ms / 1000).toFixed(1)} s`);
    console.log(report[report.length - 1]);
  }

  // ---------------------------------------------------------------- a misprinted dimension, overridden, and the CSV
  {
    const path = join(TMP, "plan-misprinted.pdf");
    await upload(path);
    const row = page.locator(`[data-testid=dim-row][data-printed="4100 mm"]`);
    assert.equal(await row.getAttribute("data-status"), "flagged", "4100 mm is flagged");
    assert.equal(await page.locator(`[data-testid=dim-row][data-status=flagged]`).count(), 1, "only that row");
    const measured = (await row.locator("[data-testid=dim-measured]").textContent())!.trim();
    await press(row.locator("[data-testid=dim-override]"));
    await tid(page, "override-value").fill("4000 mm");
    await tid(page, "override-note").fill("Misprint on the drawing, 4 m on site");
    await press(tid(page, "override-save"));
    assert.equal(await row.getAttribute("data-status"), "overridden", "Overridden");
    assert.equal((await row.locator("[data-testid=dim-status]").textContent())?.trim(), "Overridden");
    assert.equal((await row.locator("[data-testid=dim-measured]").textContent())!.trim(), measured, "the measured value is kept in its column");
    const note = await tid(page, "dim-override-note").innerText();
    assert.ok(note.includes("4000.0 mm") && note.includes(`measured ${measured} is kept`) && note.includes("Misprint on the drawing"), `override note: ${note}`);
    if (!touch) await tid(page, "dimension-check").screenshot({ path: `${OUT}/pdf-dimension-check-1440.png` });
    // The model check flags it too; override that row there.
    const mrow = page.locator(`[data-testid=model-row][data-printed="4100 mm"]`);
    assert.equal(await mrow.getAttribute("data-status"), "flagged", "model check: 4100 mm is flagged against the model");
    const model = (await mrow.locator("[data-testid=model-measured]").textContent())!.trim();
    await press(mrow.locator("[data-testid=model-override]"));
    await tid(page, "model-override-value").fill("4 m");
    await tid(page, "model-override-note").fill("Site measure agrees with the model");
    await press(tid(page, "model-override-save"));
    assert.equal(await mrow.getAttribute("data-status"), "overridden", "model check: Overridden");
    assert.equal((await mrow.locator("[data-testid=model-measured]").textContent())!.trim(), model, "model check: the model's value is kept");
    const [download] = await Promise.all([page.waitForEvent("download"), press(tid(page, "dims-csv"))]);
    const csv = readFileSync((await download.path())!, "utf8");
    const csvRow = csv.split("\n").find((l) => l.startsWith("4100 mm"))!;
    assert.ok(csvRow.includes(`,${measured.replace(" mm", "")},`) && csvRow.includes(",Overridden,4000.0,") && csvRow.includes("Misprint on the drawing"), `CSV keeps both: ${csvRow}`);
    // M.1b: the CSV holds both checks, so it is no longer just a header and 11 rows.
    const [first, second] = csv.trim().split("\n\n");
    assert.equal(first.split("\n").length, 12, "CSV: the dimension check, a header and 11 rows");
    assert.ok(second.startsWith("model versus printed\n") && second.split("\n").length === 13, "CSV: then the model check, a title, a header and 11 rows");
    const modelRow = second.split("\n").find((l) => l.startsWith("4100 mm"))!;
    assert.ok(modelRow.includes(",centre to centre,no,Overridden,4000.0,Site measure agrees with the model"), `CSV: the model override: ${modelRow}`);
    const line = `${touch ? "390" : "1440"} misprinted: 4100 mm Flagged, overridden to 4000 mm with measured ${measured} kept; model check flagged and overridden with the model's ${model} kept; CSV "${csvRow}" / "${modelRow}"`;
    report.push(line);
    console.log(line);
  }

  // ---------------------------------------------------------------- local real PDFs (never committed)
  if (!touch) {
    const local = existsSync("test-plans") ? readdirSync("test-plans").filter((f) => f.toLowerCase().endsWith(".pdf")) : [];
    if (!local.length) report.push("test-plans/: no .pdf files, nothing extra to read");
    for (const f of local) {
      const t0 = Date.now();
      await page.goto(`${BASE}/studio/import`);
      await tid(page, "file-input").setInputFiles(join("test-plans", f));
      await page.waitForSelector("[data-testid=page-picker], [data-testid=results], [data-testid=error]", { timeout: LONG });
      if (await tid(page, "page-picker").count()) {
        await press(tid(page, "page-1"));
        await page.waitForSelector("[data-testid=results], [data-testid=error]", { timeout: LONG });
      }
      const err = (await tid(page, "error").count()) ? await tid(page, "error-message").textContent() : null;
      const pdf = await page.evaluate(() => (window as Win).__importPdf);
      const rows = await tid(page, "dim-row").count();
      const flagged = await page.locator(`[data-testid=dim-row][data-status=flagged]`).count();
      const flagged2 = await page.locator(`[data-testid=model-row][data-status=flagged]`).count();
      const cov = (await tid(page, "coverage-line").count()) ? tid(page, "coverage-line") : null;
      const walls = cov ? `walls ${await cov.getAttribute("data-walls")}, exact ${await cov.getAttribute("data-exact")}, traced ${await cov.getAttribute("data-traced")}` : "walls traced (no coverage)";
      const ol = (await tid(page, "coverage-openings-line").count()) ? tid(page, "coverage-openings-line") : null;
      const openings = ol
        ? `openings exact ${await ol.getAttribute("data-exact")} of ${await ol.getAttribute("data-total")}, traced ${await ol.getAttribute("data-traced")}, unclassified ${await ol.getAttribute("data-unclassified")}, arcs not used ${await ol.getAttribute("data-arcs")}`
        : "openings traced (no coverage)";
      // Step M.1d: the gap sentence's own counts, and how the doors are hinged once it is built.
      const gl = (await tid(page, "coverage-gaps-line").count()) ? tid(page, "coverage-gaps-line") : null;
      const gaps = gl ? `out-of-range gaps ${await gl.getAttribute("data-gaps")} (${(await gl.getAttribute("data-sizes"))!.split(" ").map((v) => `${(Number(v) * 1000).toFixed(0)} mm`).join(", ")})` : "out-of-range gaps 0";
      // Build it (the same path as the fixtures) and count how the doors are hinged. A real CAD
      // plan may well refuse to build; the row then says so instead of failing the whole run.
      let hinges = "not built";
      if (!err && (await tid(page, "scale-found").count())) {
        try {
          const built = await buildAndOpen();
          const doors = built.openings.filter((o) => o.kind === "door");
          hinges = `hinge a ${doors.filter((o) => (o.hinge ?? "a") === "a").length}, hinge b ${doors.filter((o) => o.hinge === "b").length}`;
        } catch (e) {
          hinges = `not built (${String(e).slice(0, 80)})`;
        }
      }
      report.push(`test-plans/${f}: ${err ? `error "${err}"` : `${pdf?.kind}, ${walls}, ${openings}, ${hinges}, ${gaps}, ${rows} dimensions read, ${flagged} flagged in the first table, ${flagged2} in the second`}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      console.log(report[report.length - 1]);
    }
  }
  await context.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(TMP, { recursive: true });
  writeFileSync(join(TMP, "plan-misprinted.pdf"), await misprintedPdf());
  const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM || undefined });
  try {
    await session(browser, 1440, 900, false);
    await session(browser, 390, 844, true);
  } finally {
    await browser.close();
  }
  assert.deepEqual(errors, [], `console errors:\n${errors.join("\n")}`);
  console.log("\n" + report.join("\n"));
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
