/**
 * e2e-project-file.ts — a repeatable browser check of step E.1 (Save project, Open project) with
 * Playwright's Chromium. NOT in npm test: it needs `npm run dev` on port 3000 (E2E_URL overrides)
 * for the dev-only hook window.__planStore (read, and used once to add a takeoff as test data) and
 * window.__background. Everything else is real input: the real file input and file chooser, a real
 * download saved to disk and read back, mouse clicks at 1440 and taps at 390. No blind waits: each
 * wait is a named condition (scripts/e2e-helpers.ts).
 *
 * At each width (1440×900 mouse, 390×844 touch):
 *   - plan-filled.pdf through the import screen, its scale used, Build model, Open in studio;
 *     a length takeoff is added (beside the PDF's own dimension takeoffs);
 *   - Export > Save project: "Include imported models and the drawing" is ticked, the size is
 *     shown, and a real download "<name>.atrium.json" holds the plan, the takeoff, the background
 *     descriptor, the drawing's bytes under their hash, and no view settings; unticking makes the
 *     size smaller and a second download carries no assets;
 *   - a NEW browser context (empty storage) opens /studio: the sample plan; Import > Open project
 *     with the real file chooser: walls, openings, takeoffs, calibrations and the background
 *     mapping equal the saved plan, the 2D plan renders the drawing again, and ONE Undo brings
 *     the sample back (Redo returns the project);
 *   - with an unsaved edit, Open project asks first: Cancel changes nothing, "Choose a file…" opens;
 *   - a file that is not a project, and one from a newer version, give a plain message and change
 *     nothing;
 *   - the file saved WITHOUT assets, opened in another empty context: the plan is back and the
 *     Drawing section says "Import it again to see the background";
 *   - the dialogs fit the viewport, and at 390 the page is exactly 390 px wide.
 * Screenshots in /tmp/studio/: project-save-<w>.png, project-opened-<w>.png.
 * Run: npx tsx scripts/e2e-project-file.ts
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { BASE, step, waitForHook, waitUntil, warmRoutes, watchErrors, withSuiteTimeout } from "./e2e-helpers";
import type { Plan } from "../src/types/plan";

const OUT = "/tmp/studio";
const DIR = join(process.cwd(), "tests/fixtures/pdf");
const EXECUTABLE = process.env.E2E_CHROMIUM || undefined;
const LONG = 120_000;

type Win = Window & { __planStore?: { getState(): { plan: Plan; past: unknown[]; future: unknown[]; addTakeoff(t: unknown): string; undo(): void } }; __background?: { renderCount: number; pending: boolean; mapping: unknown } };

const errors: string[] = [];
const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
const plan = (page: Page) => page.evaluate(() => (window as Win).__planStore!.getState().plan);
const history = (page: Page) => page.evaluate(() => ({ past: (window as Win).__planStore!.getState().past.length, future: (window as Win).__planStore!.getState().future.length }));
/** What the project must carry. Rooms are derived and included, so the whole plan is compared. */
const same = (a: Plan, b: Plan, what: string) => assert.deepEqual(a, b, what);

async function newPage(browser: Browser, width: number, height: number, touch: boolean) {
  const context: BrowserContext = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await context.newPage();
  watchErrors(page, `${width}`, errors);
  const press = (l: Locator) => (touch ? l.tap() : l.click());
  const hideDevBadge = () => page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  return { context, page, press, hideDevBadge };
}

/** Open a menu in the top bar and press one item (the menus close on outside press and Escape). */
async function menuItem(page: Page, press: (l: Locator) => Promise<void>, menu: string, item: string) {
  await press(tid(page, menu));
  await press(tid(page, item));
}

async function main() {
  await warmRoutes(["/studio/import", "/studio"]);
  mkdirSync(OUT, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), "atrium-project-"));
  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  try {
    for (const [width, height, touch] of [[1440, 900, false], [390, 844, true]] as const) await run(browser, scratch, width, height, touch);
  } finally {
    await browser.close();
  }
  assert.deepEqual(errors, [], `console errors:\n${errors.join("\n")}`);
  console.log("e2e-project-file: OK");
}

async function run(browser: Browser, scratch: string, width: number, height: number, touch: boolean) {
  const tag = String(width);
  const dir = join(scratch, tag);
  mkdirSync(dir);

  // ---- build a project from a PDF
  step(`${tag}: plan-filled.pdf into the studio`);
  const a = await newPage(browser, width, height, touch);
  const { page, press } = a;
  await page.goto(`${BASE}/studio/import`);
  await a.hideDevBadge();
  await tid(page, "file-input").setInputFiles(join(DIR, "plan-filled.pdf"));
  await page.waitForSelector("[data-testid=results], [data-testid=error]", { timeout: LONG });
  if (await tid(page, "error").count()) assert.fail(`error "${await tid(page, "error-message").textContent()}"`);
  const use = tid(page, "scale-found").getByRole("button", { name: /^(Use this scale|Confirm this scale)$/ });
  assert.ok(await use.count(), `${tag}: plan-filled.pdf has a scale found in the PDF`);
  await press(use);
  await press(page.getByRole("button", { name: "Build model" }));
  await tid(page, "summary").waitFor({ timeout: LONG });
  await press(page.getByRole("button", { name: "Open in studio" }));
  await page.waitForURL(/\/studio$/);
  await waitForHook(page, "__planStore", "the studio after Open in studio");
  await a.hideDevBadge();
  // A takeoff, added through the store hook (test data; the saving and opening below are real input).
  const w0 = (await plan(page)).walls[0];
  await page.evaluate((w) => (window as Win).__planStore!.getState().addTakeoff({ name: "North run", kind: "length", points: [[w.a.x, w.a.y], [w.b.x, w.b.y]], reference: { value: 4.2, note: "printed" } }), w0);
  const saved = await plan(page);
  assert.ok(saved.walls.length > 4 && saved.background && saved.takeoffs?.some((t) => t.name === "North run"), `${tag}: a built plan with a drawing and our takeoff (the PDF's printed dimensions are takeoffs too: ${saved.takeoffs?.length})`);

  // ---- Save project (with the assets), a real download
  step(`${tag}: Export > Save project`);
  await menuItem(page, press, "export-menu", "save-project");
  await tid(page, "project-dialog").waitFor();
  const box = await tid(page, "project-dialog").boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= height, `${tag}: the Save dialog fits the viewport`);
  const include = tid(page, "project-include-assets");
  assert.ok(await include.isChecked(), `${tag}: the box is ticked by default`);
  assert.match(await page.getByText("Include imported models and the drawing (larger file)").innerText(), /larger file/);
  await waitUntil(page, `${tag}: the size never appeared`, `document.querySelector('[data-testid="project-size"]').dataset.bytes !== ""`);
  const withBytes = Number(await tid(page, "project-size").getAttribute("data-bytes"));
  assert.match(await tid(page, "project-size").innerText(), /File size: about \d/, `${tag}: the size is shown before saving`);
  await page.screenshot({ path: `${OUT}/project-save-${tag}.png` });
  const [download] = await Promise.all([page.waitForEvent("download"), press(tid(page, "project-save"))]);
  assert.match(download.suggestedFilename(), /\.atrium\.json$/, `${tag}: the file is name.atrium.json (${download.suggestedFilename()})`);
  const full = join(dir, "with-assets.atrium.json");
  await download.saveAs(full);
  const file = JSON.parse(readFileSync(full, "utf8"));
  assert.deepEqual(Object.keys(file), ["format", "schema", "savedAt", "plan", "assets"], `${tag}: the file's parts`);
  assert.equal(file.assets.length, 1, `${tag}: one asset, the PDF`);
  assert.equal(file.assets[0].id, saved.background!.assetId, `${tag}: under the id the plan names`);
  assert.ok(Math.abs(readFileSync(full).length - withBytes) / withBytes < 0.02, `${tag}: the size shown (${withBytes}) is within 2% of the file (${readFileSync(full).length})`);
  assert.ok(!/atrium\.(units|labels)|opacity|camera/.test(readFileSync(full, "utf8")), `${tag}: no view settings in the file`);
  await tid(page, "project-dialog").waitFor({ state: "hidden" });

  // ---- again without the assets
  await menuItem(page, press, "export-menu", "save-project");
  await tid(page, "project-dialog").waitFor();
  await waitUntil(page, `${tag}: the size never appeared`, `document.querySelector('[data-testid="project-size"]').dataset.bytes !== ""`);
  await include.uncheck();
  await waitUntil(page, `${tag}: the size did not shrink`, `Number(document.querySelector('[data-testid="project-size"]').dataset.bytes) < ${withBytes}`);
  const [lean] = await Promise.all([page.waitForEvent("download"), press(tid(page, "project-save"))]);
  const leanPath = join(dir, "plan-only.atrium.json");
  await lean.saveAs(leanPath);
  assert.ok(!("assets" in JSON.parse(readFileSync(leanPath, "utf8"))), `${tag}: unticked: no assets in the file`);
  assert.ok(readFileSync(leanPath).length < readFileSync(full).length, `${tag}: and the file is smaller`);
  await a.context.close();

  // ---- a fresh browser (empty storage): open the project
  step(`${tag}: a new browser opens the project`);
  const b = await newPage(browser, width, height, touch);
  const p = b.page;
  await p.goto(`${BASE}/studio`);
  await waitForHook(p, "__planStore", "a fresh studio");
  await b.hideDevBadge();
  const sample = await plan(p);
  assert.ok(!sample.background && !sample.takeoffs, `${tag}: a fresh browser has the sample plan`);
  const before = await history(p);
  await press(tid(p, "import-menu"));
  const [chooser] = await Promise.all([p.waitForEvent("filechooser"), press(tid(p, "open-project"))]); // nothing unsaved: straight to the picker
  await chooser.setFiles(full);
  await p.locator('[data-testid="project-dialog"][data-mode="result"] [data-testid="project-message"][data-ok="true"]').waitFor({ timeout: LONG });
  assert.match(await tid(p, "project-message").innerText(), /Opened with-assets\.atrium\.json/, `${tag}: says what it opened`);
  await press(tid(p, "project-close"));
  const opened = await plan(p);
  same(opened, saved, `${tag}: walls, openings, rooms, takeoffs, calibrations and the background mapping are the saved plan`);
  assert.equal((await history(p)).past, before.past + 1, `${tag}: opening is one undo step`);
  await press(tid(p, "view-2d"));
  await waitUntil(p, `${tag}: the drawing never rendered after opening`, "Boolean(window.__background) && window.__background.renderCount > 0 && !window.__background.pending", LONG);
  assert.deepEqual(await p.evaluate(() => (window as Win).__background!.mapping), saved.background!.mapping, `${tag}: the drawing sits where it was`);
  await p.screenshot({ path: `${OUT}/project-opened-${tag}.png` });
  await press(tid(p, "undo"));
  same(await plan(p), sample, `${tag}: one Undo brings the sample plan back`);
  await press(tid(p, "redo"));
  same(await plan(p), saved, `${tag}: Redo brings the project back`);

  // ---- unsaved changes: ask first
  step(`${tag}: unsaved changes are asked about`);
  await tid(p, "plan-name").fill("Changed after opening");
  await tid(p, "plan-name").press("Enter");
  const edited = await plan(p);
  assert.equal(edited.name, "Changed after opening");
  await press(tid(p, "import-menu"));
  await press(tid(p, "open-project"));
  await tid(p, "project-dialog").waitFor();
  assert.equal(await tid(p, "project-dialog").getAttribute("data-mode"), "confirm", `${tag}: it asks`);
  const cbox = (await tid(p, "project-dialog").boundingBox())!;
  assert.ok(cbox.x >= 0 && cbox.x + cbox.width <= width && cbox.y + cbox.height <= height, `${tag}: the question fits the viewport`);
  await press(tid(p, "project-cancel"));
  await tid(p, "project-dialog").waitFor({ state: "hidden" });
  same(await plan(p), edited, `${tag}: Cancel changes nothing`);
  await press(tid(p, "import-menu"));
  await press(tid(p, "open-project"));
  await tid(p, "project-choose").waitFor();
  const [chooser2] = await Promise.all([p.waitForEvent("filechooser"), press(tid(p, "project-choose"))]);
  await chooser2.setFiles(full);
  await p.locator('[data-testid="project-dialog"][data-mode="result"] [data-testid="project-message"][data-ok="true"]').waitFor({ timeout: LONG });
  await press(tid(p, "project-close"));
  same(await plan(p), saved, `${tag}: after confirming, the project replaces the edited plan`);
  await press(tid(p, "undo"));
  assert.equal((await plan(p)).name, "Changed after opening", `${tag}: and one Undo gives the edited plan back`);

  // ---- files that are not usable change nothing
  step(`${tag}: bad files`);
  const stable = await plan(p);
  const pastNow = (await history(p)).past;
  const bad: [string, string, RegExp][] = [
    ["not-a-project.json", '{"hello":"world"}', /isn't an Atrium project/],
    ["broken.atrium.json", readFileSync(full, "utf8").slice(0, 300), /isn't an Atrium project/],
    ["newer.atrium.json", JSON.stringify({ ...file, schema: file.schema + 1 }), /newer version of Atrium/],
    ["damaged.atrium.json", JSON.stringify({ ...file, plan: { ...file.plan, walls: "none" } }), /damaged/],
  ];
  for (const [name, content, message] of bad) {
    const path = join(dir, name);
    writeFileSync(path, content);
    await press(tid(p, "import-menu"));
    await press(tid(p, "open-project"));
    await tid(p, "project-choose").waitFor(); // the plan is unsaved here (the undo above), so it asks
    const [c] = await Promise.all([p.waitForEvent("filechooser"), press(tid(p, "project-choose"))]);
    await c.setFiles(path);
    await p.locator('[data-testid="project-dialog"][data-mode="result"] [data-testid="project-message"][data-ok="false"]').waitFor({ timeout: LONG });
    assert.match(await tid(p, "project-message").innerText(), message, `${tag}: ${name} says why`);
    await press(tid(p, "project-close"));
    same(await plan(p), stable, `${tag}: ${name} changed nothing`);
    assert.equal((await history(p)).past, pastNow, `${tag}: ${name} added no history`);
  }
  await b.context.close();

  // ---- the file without assets: the plan comes back, the drawing says "import it again"
  step(`${tag}: the file without assets`);
  const c = await newPage(browser, width, height, touch);
  await c.page.goto(`${BASE}/studio`);
  await waitForHook(c.page, "__planStore", "a fresh studio");
  await c.hideDevBadge();
  await press(tid(c.page, "import-menu"));
  const [ch] = await Promise.all([c.page.waitForEvent("filechooser"), press(tid(c.page, "open-project"))]);
  await ch.setFiles(leanPath);
  await c.page.locator('[data-testid="project-dialog"][data-mode="result"] [data-testid="project-message"][data-ok="true"]').waitFor({ timeout: LONG });
  await press(tid(c.page, "project-close"));
  same(await plan(c.page), saved, `${tag}: the plan is back from the file without assets`);
  await press(tid(c.page, "view-2d")); // the Drawing section belongs to the 2D plan's panel
  await c.page.locator('[data-testid="panel-drawing"][data-status="missing"]').waitFor({ state: "attached", timeout: LONG });
  const body = await c.page.evaluate(() => document.body.textContent ?? "");
  assert.match(body, /Import it again to see the background/, `${tag}: the existing "Import it again" state`);
  const widths = await c.page.evaluate(() => ({ inner: innerWidth, doc: document.documentElement.scrollWidth }));
  assert.equal(widths.doc, widths.inner, `${tag}: no horizontal scroll`);
  await c.context.close();
  console.log(`${tag}: saved ${readFileSync(full).length} bytes with the drawing, ${readFileSync(leanPath).length} without; opened exactly, one undo step, bad files refused`);
}

withSuiteTimeout("e2e-project-file", 15 * 60_000, main).catch((e) => {
  console.error(e);
  process.exit(1);
});
