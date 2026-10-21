/**
 * e2e-feedback.ts — a repeatable browser check of step D.1 (first public link) with Playwright's Chromium.
 * NOT in npm test: it needs `npm run dev` on port 3000 (E2E_URL overrides) for window.__planStore, which it
 * reads, and sets to a broken plan ONCE, to make a real page throw. Everything else is real input. No blind
 * waits: each wait is a named condition (scripts/e2e-helpers.ts).
 *
 * At each width (1440x900 mouse, 390x844 touch):
 *   - the landing footer and the import header both link to /limits; the page says in plain words what reads
 *     well, what does not, that heights are defaults, the verdict, that files never leave the browser, and
 *     that the reader was tested on synthetic drawings and a few real plans;
 *   - the import page's idle screen shows "Try a sample plan, or drop a vector PDF or image." and still has
 *     the sample button, and no Report button until there is something to report;
 *   - plan-filled.pdf: "Report a problem" shows exactly the text it will copy (verdict, counts, scale status,
 *     PDF kind, browser, screen, the typed note) and none of the file's name; Copy puts that exact text on the
 *     real clipboard; Download saves it as atrium-report.txt, byte for byte the same;
 *   - the studio's top bar has the same button, with the plan's counts and none of its names;
 *   - a real render error in /studio shows "Something went wrong in this page. Your plan is saved in this
 *     browser. Reload to continue." and Reload brings the studio back;
 *   - an unknown URL shows the not-found page with its status 404;
 *   - dialogs fit the viewport and, at 390, no page is wider than 390 px.
 * Screenshots in /tmp/studio/: feedback-<page>-<w>.png.
 * Run: npx tsx scripts/e2e-feedback.ts
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import { BASE, step, waitForHook, waitUntil, warmRoutes, watchErrors, withSuiteTimeout } from "./e2e-helpers";
import type { Plan } from "../src/types/plan";

const OUT = "/tmp/studio";
const DIR = join(process.cwd(), "tests/fixtures/pdf");
const EXECUTABLE = process.env.E2E_CHROMIUM || undefined;
const LONG = 120_000;
const FILE = "plan-filled.pdf";

type Win = Window & { __planStore?: { getState(): { plan: Plan }; setState(s: unknown): void } };

const errors: string[] = [];
const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
const noSideways = async (page: Page, width: number, what: string) => assert.ok((await page.evaluate<number>("document.documentElement.scrollWidth")) <= width, `${what}: the page is wider than ${width} px`);

async function main() {
  await warmRoutes(["/", "/limits", "/studio/import", "/studio"]);
  mkdirSync(OUT, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), "atrium-feedback-"));
  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  try {
    for (const [width, height, touch] of [[1440, 900, false], [390, 844, true]] as const) await run(browser, scratch, width, height, touch);
  } finally {
    await browser.close();
  }
  assert.deepEqual(errors, [], `console errors:\n${errors.join("\n")}`);
  console.log("e2e-feedback: OK");
}

/** Opens the Report dialog from `button`, checks it fits, and returns the text it shows. */
async function openReport(page: Page, press: (l: Locator) => Promise<void>, width: number, height: number, tag: string, shot: string): Promise<string> {
  await press(tid(page, "report-problem"));
  await tid(page, "report-dialog").waitFor();
  const box = await tid(page, "report-dialog").boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= height, `${tag}: the report dialog fits the viewport`);
  await page.screenshot({ path: `${OUT}/feedback-${shot}-${width}.png` });
  return tid(page, "report-text").inputValue();
}

/** Copy and Download must carry exactly the text on screen. */
async function copyAndDownload(page: Page, press: (l: Locator) => Promise<void>, dir: string, tag: string) {
  const shown = await tid(page, "report-text").inputValue();
  await press(tid(page, "report-copy"));
  await waitUntil(page, `${tag}: "Copied" never showed`, `document.querySelector('[data-testid="report-status"]').textContent.includes("Copied")`);
  assert.equal(await page.evaluate("navigator.clipboard.readText()"), shown, `${tag}: the clipboard holds exactly the text on screen`);
  const [download] = await Promise.all([page.waitForEvent("download"), press(tid(page, "report-download"))]);
  assert.equal(download.suggestedFilename(), "atrium-report.txt", `${tag}: the download's name`);
  const file = join(dir, `${tag.replace(/\W+/g, "-")}.txt`);
  await download.saveAs(file);
  assert.equal(readFileSync(file, "utf8"), shown, `${tag}: the downloaded file is exactly the text on screen`);
}

async function run(browser: Browser, scratch: string, width: number, height: number, touch: boolean) {
  const tag = String(width);
  const dir = join(scratch, tag);
  mkdirSync(dir);
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1, acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  watchErrors(page, tag, errors);
  const press = (l: Locator) => (touch ? l.tap() : l.click());
  const hideDevBadge = () => page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

  // ---- /limits, reached from both places
  step(`${tag}: the landing footer links to /limits`);
  await page.goto(`${BASE}/`);
  const footer = tid(page, "limits-link");
  assert.equal(await footer.getAttribute("href"), "/limits", `${tag}: the footer link`);
  await footer.evaluate((el) => (el as HTMLElement).click()); // the footer sits below a pinned scroll section, so click it where it is
  await page.waitForURL(/\/limits$/);
  step(`${tag}: /limits says what it must`);
  await hideDevBadge();
  const text = await page.locator("main").innerText();
  for (const must of [/What reads well/i, /Vector PDFs with printed dimensions/, /Clean images/, /Scans and photos with no dimensions/, /Diagonal and curved walls/, /not drawn clearly/, /Heights are defaults/, /only as exact as the drawing/, /Not usable/, /never leave your browser/, /synthetic drawings and a few real plans, not on a wide range of real CAD files/]) assert.match(text, must, `${tag}: /limits is missing ${must}`);
  assert.equal(await page.title(), "Limits | Atrium", `${tag}: the page title`);
  await noSideways(page, width, "/limits");
  await page.screenshot({ path: `${OUT}/feedback-limits-${width}.png`, fullPage: true });

  step(`${tag}: the import header links to /limits and the idle screen has the hint`);
  await page.goto(`${BASE}/studio/import`);
  await hideDevBadge();
  await tid(page, "first-run-hint").waitFor();
  assert.equal((await tid(page, "first-run-hint").innerText()).trim(), "Try a sample plan, or drop a vector PDF or image.");
  assert.ok(await page.getByRole("button", { name: "Try a sample plan" }).isVisible(), `${tag}: the sample button is still there`);
  assert.equal(await tid(page, "report-problem").count(), 0, `${tag}: nothing to report on the idle screen`);
  assert.equal(await page.title(), "Import a floor plan | Atrium");
  await noSideways(page, width, "import (idle)");
  await page.screenshot({ path: `${OUT}/feedback-import-idle-${width}.png` });
  await press(tid(page, "limits-link"));
  await page.waitForURL(/\/limits$/);

  // ---- Report a problem on the import review
  step(`${tag}: ${FILE} to the review`);
  await page.goto(`${BASE}/studio/import`);
  await hideDevBadge();
  await tid(page, "file-input").setInputFiles(join(DIR, FILE));
  await page.waitForSelector("[data-testid=results][data-review=ready], [data-testid=error]", { timeout: LONG });
  if (await tid(page, "error").count()) assert.fail(`error "${await tid(page, "error-message").textContent()}"`);
  step(`${tag}: Report a problem on the review`);
  const report = await openReport(page, press, width, height, `${tag} import`, "report-import");
  for (const must of [/^Atrium problem report/, /App version: \S+/, /Where: import review/, /Verdict: (Good|Check|Not usable): /, /Counts: \d+ walls, \d+ doors, \d+ windows, \d+ rooms/, /Scale: none chosen yet; the reading's own check: (good|check|none)/, /PDF: vector page/, /Browser: Mozilla/, new RegExp(`Screen: \\d+ x \\d+ at \\d+(\\.\\d+)?x, window ${width} x \\d+`), /Note: \(none\)/, /not sent anywhere/]) assert.match(report, must, `${tag}: the report is missing ${must}:\n${report}`);
  assert.ok(!report.includes("plan-filled") && !report.includes(FILE), `${tag}: the file's name is in the report`);
  assert.ok(!/\d+\.\d{2,}/.test(report.replace(/Mozilla[^\n]*/, "")), `${tag}: a long decimal (a coordinate?) is in the report:\n${report}`);
  await tid(page, "report-note").fill("The kitchen door is on the wrong wall.");
  await waitUntil(page, `${tag}: the note never reached the report`, `document.querySelector('[data-testid="report-text"]').value.includes("Note: The kitchen door is on the wrong wall.")`);
  await copyAndDownload(page, press, dir, `${tag} import report`);
  await page.keyboard.press("Escape");
  await tid(page, "report-dialog").waitFor({ state: "hidden" });
  await noSideways(page, width, "import review");

  // ---- the studio
  step(`${tag}: the studio's Report a problem`);
  await page.goto(`${BASE}/studio`);
  await waitForHook(page, "__planStore", "the studio");
  await hideDevBadge();
  const sample = await page.evaluate(() => (window as Win).__planStore!.getState().plan);
  const studio = await openReport(page, press, width, height, `${tag} studio`, "report-studio");
  for (const must of [/Where: studio/, /Verdict: /, new RegExp(`Counts: ${sample.walls.length} walls`), /Browser: Mozilla/]) assert.match(studio, must, `${tag}: the studio report is missing ${must}:\n${studio}`);
  for (const name of [sample.name, ...sample.rooms.map((r) => r.name)]) assert.ok(!studio.includes(name), `${tag}: "${name}" is in the studio report`);
  await copyAndDownload(page, press, dir, `${tag} studio report`);
  await press(tid(page, "report-close"));
  await tid(page, "report-dialog").waitFor({ state: "hidden" });

  // ---- a real render error
  step(`${tag}: a thrown render error shows the plain screen`);
  const before = errors.length;
  // A wall with no ends: the stores accept it, the 2D and 3D views read wall.a.x while rendering and throw.
  await page.evaluate(() => {
    const store = (window as Win).__planStore!;
    store.setState({ plan: { ...store.getState().plan, walls: [{ id: "broken" }] } });
  });
  await tid(page, "error-boundary").waitFor({ timeout: 15_000 });
  assert.equal((await tid(page, "error-boundary").innerText()).replace(/\s+/g, " "), "Something went wrong Something went wrong in this page. Your plan is saved in this browser. Reload to continue. Reload", `${tag}: the screen's words`);
  assert.ok(errors.length > before, `${tag}: the error went to the console`);
  errors.length = before; // the break was on purpose; everything before and after it must stay clean
  await page.screenshot({ path: `${OUT}/feedback-error-${width}.png` });
  await noSideways(page, width, "error screen");
  await Promise.all([page.waitForLoadState("load"), press(tid(page, "error-reload"))]);
  await waitForHook(page, "__planStore", "the studio after Reload");
  await tid(page, "plan-name").waitFor();
  assert.equal(await tid(page, "error-boundary").count(), 0, `${tag}: Reload brought the studio back`);
  assert.equal(errors.length, before, `${tag}: no new errors after Reload`);

  // ---- not found
  step(`${tag}: an unknown URL`);
  const at = errors.length;
  const res = await page.goto(`${BASE}/no-such-page`);
  assert.equal(res?.status(), 404, `${tag}: the status`);
  await tid(page, "not-found").waitFor();
  assert.match(await page.locator("main").innerText(), /This page doesn't exist/);
  await noSideways(page, width, "not found");
  // Chromium logs "Failed to load resource ... 404" for the page's own status; that one line is the expected one.
  assert.deepEqual(errors.slice(at), [`${tag} console: Failed to load resource: the server responded with a status of 404 (Not Found)`].slice(0, errors.length - at), `${tag}: only the 404 itself was logged`);
  errors.length = at;
  await context.close();
}

withSuiteTimeout("e2e-feedback", 600_000, main).catch((e) => {
  console.error(e);
  process.exit(1);
});
