/**
 * e2e-calibrate.ts — a repeatable browser check of step M.2b with Playwright's Chromium:
 * recalibrating the plan's scale in the studio, the PDF's printed dimensions carried in as
 * takeoffs, and the phantom traced openings dropped on a vector page. NOT in npm test: it needs
 * the dev server (npm run dev on port 3000; E2E_URL overrides) for the dev-only hooks
 * window.__planStore and window.__calibrateStore, which are only READ — every action is real
 * mouse, keyboard or touch input, and plan metres become screen points through the 2D canvas's
 * own camera attributes (data-scale, data-tx, data-ty), as the other e2e scripts do.
 *
 * At 1440×900 with a mouse, through the real file input:
 *   - plan-filled.pdf is read, the scale used and the model built: the summary says how many
 *     printed dimensions it carried, and in the studio the Takeoff panel's "From PDF" group
 *     holds one row per dimension, every one OK and "PDF exact";
 *   - Set scale from the panel brings the 2D plan up; two REAL clicks on the two ends of the
 *     longest wall place the points (snapped to the plan's own geometry), the dialog says how
 *     far apart they are, a true distance 2% longer gives "Factor 1.0200 (+2.00%). Plan … becomes
 *     …" with no large-change warning, and Apply scales every wall by exactly that factor
 *     (checked against the stored plan within 1e-6 m) in ONE undo step;
 *   - the From PDF rows are all Flagged afterwards — the printed numbers against the new scale —
 *     and Ctrl+Z puts every wall, every takeoff and every status back, consuming one step and
 *     no more;
 *   - Escape after the first point leaves the plan and its history exactly as they were;
 *   - the dialog traps focus: it opens focused on its field and Tab stays inside it.
 * At 390×844 with real touch, in a browser whose saved unit is feet and inches:
 *   - plan-filled.pdf again; the From PDF group is in the Plan details sheet; Set scale from the
 *     link beside the scale bar, two taps, a true distance typed as 34'0" and Apply: the stored
 *     factor is that length over the measured span (1e-9), and the page is exactly 390 px wide.
 * At 1440 with millimetres saved as the unit, plan-gaps.pdf: the plan holds the PDF's 7 openings and not the tracing's phantom
 * 0.30 m door, and the review screen says so ("1 traced opening dropped because the PDF draws
 * solid wall there (sizes: 300 mm)").
 * Any .pdf in test-plans/ (local only, never committed) is also read, one row printed per file.
 * Screenshots in /tmp/studio/: takeoff-from-pdf-1440.png, calibrate-dialog-1440.png,
 * takeoff-from-pdf-flagged-1440.png, calibrate-390.png, calibrate-gaps-1440.png.
 * Run: npx tsx scripts/e2e-calibrate.ts
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import { step, waitForHook, warmRoutes, watchErrors, withSuiteTimeout } from "./e2e-helpers";
import { parseTypedLength } from "../src/lib/units/typed";
import type { Opening, Plan, Wall } from "../src/types/plan";

const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const OUT = "/tmp/studio";
const DIR = join(process.cwd(), "tests/fixtures/pdf");
const EXECUTABLE = process.env.E2E_CHROMIUM || undefined;
const LONG = 240_000;

type Pt = { x: number; y: number };
type Win = Window & {
  __planStore?: { getState(): { plan: Plan; past: unknown[]; future: unknown[] } };
  __calibrateStore?: { getState(): { picking: boolean; asking: boolean; points: [number, number][] } };
};

const errors: string[] = [];
const report: string[] = [];
const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
const plan = (page: Page) => page.evaluate(() => (window as Win).__planStore!.getState().plan);
const history = (page: Page) => page.evaluate(() => (window as Win).__planStore!.getState().past.length);
const picked = (page: Page) => page.evaluate(() => (window as Win).__calibrateStore!.getState().points);
const near = (a: number, b: number, eps: number, msg: string) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (allowed ${eps})`);
const len = (w: Wall) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
/** The longest wall along the plan's SOUTHERN edge: the tool's hint bar sits over the top of the
 *  drawing (left-2 right-14 top-2), so points aimed at a northern wall would hit the bar, not the plan. */
const southWall = (p: Plan) => [...p.walls].sort((a, b) => (b.a.y + b.b.y) / 2 - (a.a.y + a.b.y) / 2 || len(b) - len(a)).filter((w) => len(w) >= 3)[0];

/** Plan metres → page pixels through the 2D canvas's camera. */
async function toScreen(page: Page, p: Pt): Promise<Pt> {
  const c = await tid(page, "plan-canvas").evaluate((e) => ({ s: +e.getAttribute("data-scale")!, tx: +e.getAttribute("data-tx")!, ty: +e.getAttribute("data-ty")! }));
  const b = (await tid(page, "plan-canvas").boundingBox())!;
  return { x: b.x + p.x * c.s + c.tx, y: b.y + p.y * c.s + c.ty };
}

async function session(browser: Browser, width: number, height: number, touch: boolean, unit?: string) {
  step(`${width} calibrate`);
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, acceptDownloads: true });
  if (unit) await context.addInitScript(`window.localStorage.setItem("atrium.units", ${JSON.stringify(JSON.stringify({ length: unit, area: "m2" }))})`);
  const page = await context.newPage();
  const tag = `${width}`;
  watchErrors(page, tag, errors);
  const press = (l: Locator) => (touch ? l.tap() : l.click());
  const tap = async (p: Pt) => (touch ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y));

  /** The dev badge sits bottom left, over the 2D plan's scale bar: it would swallow phone taps. */
  const hideDevBadge = () => page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  /** The file through the real input, up to the review screen. */
  const upload = async (path: string) => {
    await page.goto(`${BASE}/studio/import`);
    await hideDevBadge();
    await tid(page, "file-input").setInputFiles(path);
    await page.waitForSelector("[data-testid=results], [data-testid=error]", { timeout: LONG });
    if (await tid(page, "error").count()) assert.fail(`${path}: error "${await tid(page, "error-message").textContent()}"`);
  };
  /** Use the found scale, build, and go into the studio. */
  const buildAndOpen = async () => {
    await press(tid(page, "scale-found").getByRole("button", { name: /^(Use this scale|Confirm this scale)$/ }));
    await press(page.getByRole("button", { name: "Build model" }));
    await tid(page, "summary").waitFor();
    const carried = (await tid(page, "summary-takeoffs").innerText()).trim();
    await press(page.getByRole("button", { name: "Open in studio" }));
    await page.waitForURL(/\/studio$/);
    await page.waitForFunction(() => Boolean((window as Win).__planStore));
    await tid(page, "plan-name").waitFor();
    await hideDevBadge();
    return carried;
  };
  /** The Plan details sheet is collapsed on a phone. */
  const sheet = () => page.getByRole("button", { name: /Plan details/ });
  const openPanel = async () => {
    if ((await sheet().count()) && (await sheet().isVisible()) && !(await tid(page, "takeoff-panel").isVisible())) await press(sheet());
    await tid(page, "takeoff-panel").waitFor();
  };
  /** And it halves the 2D pane while it is open, so it is shut before any picking on a phone. */
  const closePanel = async () => {
    if ((await sheet().count()) && (await sheet().isVisible()) && (await tid(page, "takeoff-panel").isVisible())) await press(sheet());
  };

  return { page, tag, press, tap, upload, buildAndOpen, openPanel, closePanel, hideDevBadge, close: () => context.close() };
}

/** The "From PDF" group: how many rows and how many Flagged, from the group's own heading. */
async function pdfGroup(page: Page) {
  const b = tid(page, "takeoff-pdf-toggle");
  await b.waitFor();
  return { count: Number(await b.getAttribute("data-count")), flagged: Number(await b.getAttribute("data-flagged")), text: (await b.innerText()).trim() };
}

async function desktop(browser: Browser) {
  const s = await session(browser, 1440, 900, false);
  const { page, tag, press, tap } = s;

  // ---------------------------------------------------------------- the PDF's dimensions carried in
  await s.upload(join(DIR, "plan-filled.pdf"));
  const carried = await s.buildAndOpen();
  assert.match(carried, /^11 printed dimensions carried into the studio as takeoffs/, `${tag}: the summary says what it carried ("${carried}")`);
  await s.openPanel();
  const before = await pdfGroup(page);
  assert.equal(before.count, 11, `${tag}: one From PDF row per printed dimension`);
  assert.equal(before.flagged, 0, `${tag}: none of them flagged — the model agrees with the drawing`);
  const pdfRows = page.locator('[data-testid="takeoff-row"][data-source="pdf"]');
  assert.equal(await pdfRows.count(), 11, `${tag}: and the rows are in the table`);
  for (let i = 0; i < 11; i++) assert.equal(await pdfRows.nth(i).getAttribute("data-status"), "ok", `${tag}: row ${i} OK`);
  const bases = await pdfRows.locator('[data-testid="takeoff-basis"]').allInnerTexts();
  assert.deepEqual([...new Set(bases.map((b) => b.trim()))], ["PDF exact"], `${tag}: every row stands on walls read from the PDF`);
  await tid(page, "takeoff-pdf").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/takeoff-from-pdf-1440.png` });
  console.log(`${tag}: "${before.text}" — ${bases.length} rows, all OK, basis PDF exact`);

  // ---------------------------------------------------------------- Escape after one point changes nothing
  const plan0 = await plan(page);
  const history0 = await history(page);
  const longest = southWall(plan0);
  await press(tid(page, "takeoff-set-scale")); // from the panel: this also brings the 2D plan up
  await tid(page, "plan-svg").waitFor();
  await page.waitForTimeout(400);
  assert.equal(await tid(page, "calibrate-hint").innerText(), "Set scale: click or tap the first point", `${tag}: the 2D plan asks for the first point`);
  await tap(await toScreen(page, longest.a));
  assert.equal((await picked(page)).length, 1, `${tag}: one point placed by a real click`);
  await tid(page, "plan-canvas").press("Escape");
  assert.equal(await page.evaluate(() => (window as Win).__calibrateStore!.getState().picking), false, `${tag}: Escape gives up the flow`);
  assert.equal(await history(page), history0, `${tag}: and leaves history exactly as it was`);
  assert.deepEqual(await plan(page), plan0, `${tag}: and the plan untouched`);
  console.log(`${tag}: Escape after the first point leaves the plan and its ${history0} history steps alone`);

  // ---------------------------------------------------------------- two real clicks, the preview, Apply
  await press(tid(page, "plan-set-scale")); // the link beside the scale bar
  await tap(await toScreen(page, longest.a));
  await tap(await toScreen(page, longest.b));
  await tid(page, "calibrate-dialog").waitFor();
  const points = await picked(page);
  assert.equal(points.length, 2, `${tag}: both points placed`);
  // They snapped onto the plan's own geometry at the wall's ends (a face corner or the end itself).
  for (const [i, end] of [longest.a, longest.b].entries()) assert.ok(Math.hypot(points[i][0] - end.x, points[i][1] - end.y) < 0.3, `${tag}: point ${i} snapped at the wall's end`);
  const measured = Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]);
  near(Number(await tid(page, "calibrate-measured").getAttribute("data-metres")), measured, 1e-6, `${tag}: the dialog says what it measured`);
  // Focus is in the dialog and Tab stays there.
  const inside = () => page.evaluate(() => Boolean(document.activeElement?.closest("[data-testid=calibrate-dialog]")));
  assert.ok(await inside(), `${tag}: the dialog opens with its field focused`);
  for (let i = 0; i < 6; i++) await page.keyboard.press("Tab");
  assert.ok(await inside(), `${tag}: Tab cannot leave it`);
  await tid(page, "calibrate-input").focus();

  const want = measured * 1.02;
  await page.keyboard.type(`${want.toFixed(6)} m`); // real typing, not fill()
  const preview = (await tid(page, "calibrate-preview").innerText()).trim();
  assert.match(preview, /^Factor 1\.0200 \(\+2\.00%\)\. Plan [\d.]+ × [\d.]+ m becomes [\d.]+ × [\d.]+ m\. Walls, openings and takeoffs scale; heights and imported models do not\.$/, `${tag}: the preview reads "${preview}"`);
  assert.equal(await tid(page, "calibrate-warning").count(), 0, `${tag}: 2% is not a large change`);
  await page.screenshot({ path: `${OUT}/calibrate-dialog-1440.png` });
  await press(tid(page, "calibrate-apply"));
  await page.waitForFunction(() => Boolean((window as Win).__planStore!.getState().plan.calibrations));

  const factor = want / measured;
  const after = await plan(page);
  assert.equal(after.calibrations!.length, 1, `${tag}: one calibration recorded`);
  near(after.calibrations![0].factor, factor, 1e-12, `${tag}: with the factor`);
  let worst = 0;
  for (const w of plan0.walls) {
    const now = after.walls.find((x) => x.id === w.id)!;
    worst = Math.max(worst, Math.abs(len(now) - len(w) * factor));
    near(len(now), len(w) * factor, 1e-6, `${tag}: wall ${w.id} is its old length × ${factor.toFixed(6)}`);
    assert.equal(now.height, w.height, `${tag}: wall ${w.id} keeps its height`);
  }
  const sameSills = (a: Opening[], b: Opening[]) => a.every((o, i) => o.height === b[i].height && o.sillHeight === b[i].sillHeight);
  assert.ok(sameSills(after.openings, plan0.openings), `${tag}: every opening keeps its height and sill`);
  assert.equal(await history(page), history0 + 1, `${tag}: one undo step`);
  const flaggedNow = await pdfGroup(page);
  assert.equal(flaggedNow.flagged, 11, `${tag}: every From PDF row is Flagged at the new scale ("${flaggedNow.text}")`);
  await tid(page, "takeoff-pdf").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/takeoff-from-pdf-flagged-1440.png` });
  console.log(`${tag}: two real clicks ${measured.toFixed(4)} m apart, typed ${want.toFixed(4)} m → factor ${factor.toFixed(6)}; every wall scaled (worst ${(worst * 1e6).toFixed(3)} µm), heights kept, all 11 PDF rows Flagged`);

  // ---------------------------------------------------------------- Ctrl+Z: one step, everything back
  await tid(page, "plan-canvas").click({ position: { x: 5, y: 5 } }); // focus the page, not a field
  await page.keyboard.press("Control+z");
  await page.waitForFunction(() => !(window as Win).__planStore!.getState().plan.calibrations);
  const undone = await plan(page);
  assert.deepEqual(undone.walls, plan0.walls, `${tag}: Ctrl+Z restores every wall exactly`);
  assert.deepEqual(undone.openings, plan0.openings, `${tag}: and every opening`);
  assert.deepEqual(undone.takeoffs, plan0.takeoffs, `${tag}: and every takeoff`);
  assert.equal(await history(page), history0, `${tag}: one step consumed, not two`);
  const back = await pdfGroup(page);
  assert.equal(back.flagged, 0, `${tag}: and the rows are OK again`);
  // A second Ctrl+Z has nothing of ours left to take (history was already at its floor).
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(200);
  assert.deepEqual((await plan(page)).walls, plan0.walls, `${tag}: a second Ctrl+Z does not undo part of the calibration`);
  console.log(`${tag}: Ctrl+Z restores walls, openings and takeoffs and consumes exactly one step; a second one takes nothing of it`);

  await s.close();
}

async function phone(browser: Browser) {
  const s = await session(browser, 390, 844, true, "ftin");
  const { page, tag, press, tap } = s;
  await s.upload(join(DIR, "plan-filled.pdf"));
  await s.buildAndOpen();
  await s.openPanel();
  const group = await pdfGroup(page);
  assert.equal(group.count, 11, `${tag}: the From PDF group is in the sheet`);
  assert.equal(group.flagged, 0, `${tag}: all OK`);

  // Set scale from the link beside the 2D scale bar, by tap. The sheet is shut first: open, it
  // leaves the 2D pane 208 px tall, where a finger's 44 px snap reach covers over 2 m of plan.
  await s.closePanel();
  await press(tid(page, "view-2d"));
  await tid(page, "plan-svg").waitFor();
  await page.waitForTimeout(400);
  await press(tid(page, "plan-set-scale"));
  const p0 = await plan(page);
  const longest = southWall(p0);
  await tap(await toScreen(page, longest.a));
  await tap(await toScreen(page, longest.b));
  await tid(page, "calibrate-dialog").waitFor();
  const points = await picked(page);
  const measured = Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]);
  // Feet and inches, in a browser whose saved unit is ft-in: the existing parser reads it.
  const typed = `13'6"`; // about the span the two taps measure, so the plan only shifts a little
  await tid(page, "calibrate-input").tap();
  await page.keyboard.type(typed);
  const preview = (await tid(page, "calibrate-preview").innerText()).trim();
  assert.match(preview, /^Factor [\d.]+ \([+−][\d.]+%\)\. Plan .+ becomes .+ Walls, openings and takeoffs scale; heights and imported models do not\.$/, `${tag}: the preview reads "${preview}"`);
  await page.screenshot({ path: `${OUT}/calibrate-390.png` });
  await press(tid(page, "calibrate-apply"));
  await page.waitForFunction(() => Boolean((window as Win).__planStore!.getState().plan.calibrations));
  const factor = parseTypedLength(typed)! / measured;
  near((await plan(page)).calibrations![0].factor, factor, 1e-9, `${tag}: the stored factor is ${typed} over the measured span`);

  const widths = await page.evaluate(() => ({ inner: innerWidth, doc: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.equal(widths.inner, 390, `${tag}: viewport`);
  assert.equal(widths.doc, 390, `${tag}: the page is exactly 390 px wide`);
  assert.equal(widths.body, 390, `${tag}: and so is the body`);
  console.log(`${tag}: From PDF group by touch, two taps ${measured.toFixed(3)} m apart, ${typed} typed → factor ${factor.toFixed(6)} (1e-9); page ${widths.doc} px`);
  await s.close();
}

/** plan-gaps: the phantom traced opening is dropped and said so (step M.2b, item 1). */
async function gaps(browser: Browser) {
  const s = await session(browser, 1440, 900, false, "mm"); // the sentence quotes the size: read it in mm
  const { page, tag, press } = s;
  await s.upload(join(DIR, "plan-gaps.pdf"));
  await press(tid(page, "scale-found").getByRole("button", { name: /^(Use this scale|Confirm this scale)$/ }));
  const line = (await tid(page, "coverage-openings-line").innerText()).trim();
  assert.match(line, /^7 of 7 openings read exactly/, `${tag}: the review screen reads 7 of 7 ("${line}")`);
  const dropped = (await tid(page, "coverage-dropped-line").innerText()).trim();
  assert.match(dropped, /^1 traced opening dropped because the PDF draws solid wall there \(sizes: 300 mm\)\./, `${tag}: and says what it dropped ("${dropped}")`);
  assert.equal(await tid(page, "coverage-dropped-line").getAttribute("data-dropped"), "1", `${tag}: one, in the data too`);
  await tid(page, "coverage").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/calibrate-gaps-1440.png`, fullPage: true });
  await press(page.getByRole("button", { name: "Build model" }));
  await tid(page, "summary").waitFor();
  await press(page.getByRole("button", { name: "Open in studio" }));
  await page.waitForURL(/\/studio$/);
  await page.waitForFunction(() => Boolean((window as Win).__planStore));
  const p = await plan(page);
  assert.equal(p.openings.length, 7, `${tag}: the plan holds 7 openings, not 8`);
  assert.equal(p.openings.filter((o) => o.provenance === "traced").length, 0, `${tag}: none of them traced`);
  console.log(`${tag}: plan-gaps "${line}" / "${dropped}"; the studio's plan has ${p.openings.length} openings, none traced`);
  await s.close();
}

/** Any local .pdf in test-plans/ (never committed): one row each. */
async function localPlans(browser: Browser) {
  const dir = join(process.cwd(), "test-plans");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf")) : [];
  if (!files.length) {
    console.log("test-plans/: no .pdf files, so no real CAD PDF was read in this run");
    return;
  }
  const s = await session(browser, 1440, 900, false);
  for (const f of files) {
    const t0 = Date.now();
    try {
      await s.upload(join(dir, f));
      const use = tid(s.page, "scale-found").getByRole("button", { name: /^(Use this scale|Confirm this scale)$/ });
      if (!(await use.count())) {
        report.push(`${f}: no scale found, so nothing was built`);
        continue;
      }
      await use.click();
      const coverage = (await tid(s.page, "coverage-line").innerText()).trim();
      const openings = (await tid(s.page, "coverage-openings-line").innerText()).trim();
      const droppedEl = tid(s.page, "coverage-dropped-line");
      const dropped = (await droppedEl.count()) ? await droppedEl.getAttribute("data-dropped") : "0";
      const carried = await s.buildAndOpen();
      const p = await plan(s.page);
      const rows = (p.takeoffs ?? []).filter((k) => k.source === "pdf");
      const flagged = await pdfGroup(s.page).then((g) => g.flagged).catch(() => 0);
      report.push(`${f}: ${coverage} | ${openings} | dropped ${dropped} | ${carried} | ${rows.length} rows, ${flagged} flagged | ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    } catch (e) {
      report.push(`${f}: FAILED after ${((Date.now() - t0) / 1000).toFixed(1)} s — ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
    }
  }
  await s.close();
}

async function main() {
  await warmRoutes(["/studio/import", "/studio"]);
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  try {
    await desktop(browser);
    await phone(browser);
    await gaps(browser);
    await localPlans(browser);
  } finally {
    await browser.close();
  }
  if (report.length) console.log(`\ntest-plans/:\n${report.join("\n")}`);
  assert.deepEqual(errors, [], `console errors:\n${errors.join("\n")}`);
  console.log("e2e-calibrate: OK");
}

withSuiteTimeout("e2e-calibrate", 15 * 60_000, main).catch((e) => {
  console.error(e);
  process.exit(1);
});
