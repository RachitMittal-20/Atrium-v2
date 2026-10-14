/**
 * e2e-offline-ocr.ts — step O.1's browser test that OCR is fully self-hosted ("works offline" holds only
 * while this passes). NOT in npm test. Needs `npm run dev` (E2E_URL overrides http://localhost:3000).
 *
 * At 1440 and 390, in two phases per size:
 *   A. every request to a host other than localhost is aborted (context.route) and counted;
 *   B. a browser started with --host-resolver-rules that resolves nothing but localhost, so no other host can
 *      be reached at all, from the page or from any worker. (context.setOffline(true) was tried first: it also
 *      cuts localhost, so the app's own lazy chunks and the OCR files fail to load and nothing can be tested.
 *      A route that re-served localhost stopped React hydrating.)
 * Each phase imports an image (tests/fixtures/03_with_dimensions.png) and plan-outlined.pdf, and checks OCR
 * still worked: no "ocr-failed" warning, the image's scale about 99.9 px/m and its four room names, and the
 * PDF's eleven dimension rows each "read by OCR" with scale "good", rooms from OCR. Asserts zero blocked
 * non-local attempts (a request made, in A; a request failed, in B). Saves a screenshot to /tmp/offline-ocr/ only when a session fails.
 * Run: npx tsx scripts/e2e-offline-ocr.ts
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import { BASE, step, waitForHook, warmRoutes, watchErrors, withSuiteTimeout } from "./e2e-helpers";

const OUT = "/tmp/offline-ocr";
const IMAGE = "tests/fixtures/03_with_dimensions.png";
const PDF = "tests/fixtures/pdf/plan-outlined.pdf";
const LONG = 240_000;
const errors: string[] = [];
const report: string[] = [];
type Win = Window & { __planStore?: { getState(): { plan: { rooms: { name: string }[] } } }; __importAnalysis?: { warnings: { code: string }[] } };

const isLocal = (u: string) => u.startsWith(BASE) || u.startsWith("blob:") || u.startsWith("data:") || u.startsWith("about:");

async function session(browser: Browser, width: number, height: number, phase: "A" | "B") {
  const tag = `${width} ${phase}`;
  step(`${tag}: start`);
  const touch = width < 600;
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  const blocked: string[] = [];
  // Phase A and B: nothing but localhost may leave. An attempt is counted, then aborted.
  // Phase A counts them at the page's network layer (context.route). Phase B's browser cannot resolve any
  // other host at all (see main), and every failed non-local request is counted by "requestfailed" below,
  // which also sees requests made from inside workers (OCR runs in a worker nested in a worker).
  if (phase === "A")
    await context.route((url) => !isLocal(url.href), (route) => {
      blocked.push(route.request().url());
      return route.abort();
    });
  const page = await context.newPage();
  watchErrors(page, tag, errors);
  page.on("requestfailed", (r) => {
    if (!isLocal(r.url())) blocked.push(`failed: ${r.url()}`);
  });
  const tid = (id: string) => page.locator(`[data-testid="${id}"]`);
  const press = (l: ReturnType<Page["locator"]>) => (touch ? l.tap() : l.click());
  try {
    const open = async (file: string) => {
      await page.goto(`${BASE}/studio/import`);
      await tid("file-input").setInputFiles(file);
      await page.waitForSelector("[data-testid=results], [data-testid=error]", { timeout: LONG });
      if (await tid("error").count()) assert.fail(`${file}: error "${await tid("error-message").textContent()}"`);
    };
    const build = async () => {
      await press(tid("scale-found").getByRole("button", { name: /^(Use this scale|Confirm this scale)$/ }));
      await press(page.getByRole("button", { name: "Build model" }));
      await tid("summary").waitFor();
    };
    const roomNames = async () => {
      await press(page.getByRole("button", { name: "Open in studio" }));
      await page.waitForURL(/\/studio$/);
      await waitForHook(page, "__planStore", "Open in studio had just been pressed");
      return (await page.evaluate(() => (window as Win).__planStore!.getState().plan.rooms.map((r) => r.name))).sort();
    };

    // ---- image
    step(`${tag}: image import`);
    await open(IMAGE);
    const warnings = await page.evaluate(() => (window as Win).__importAnalysis!.warnings.map((w) => w.code));
    assert.ok(!warnings.includes("ocr-failed"), `${tag}: image OCR failed (${warnings})`);
    const scale = Number(await tid("suggested-scale").innerText());
    assert.ok(Math.abs(scale - 99.9) < 0.5, `${tag}: image scale ${scale}, want about 99.9`);
    await build();
    const imageRooms = await roomNames();
    assert.deepEqual(imageRooms, ["Bath / Kitchen", "Bedroom 1", "Bedroom 2", "Living"], `${tag}: image room names`);

    // ---- PDF (its text is outlined, so every dimension and room name comes from OCR)
    step(`${tag}: plan-outlined.pdf import`);
    await open(PDF);
    const w2 = await page.evaluate(() => (window as Win).__importAnalysis!.warnings.map((w) => w.code));
    assert.ok(!w2.includes("ocr-failed"), `${tag}: PDF OCR failed (${w2})`);
    assert.equal(await tid("pdf-scale-status").getAttribute("data-confidence"), "good", `${tag}: PDF scale status`);
    const hows = await page.locator("[data-testid=dim-how]").allInnerTexts();
    assert.equal(hows.length, 11, `${tag}: eleven dimension rows`);
    assert.ok(hows.every((h) => h.endsWith("read by OCR")), `${tag}: every row read by OCR (${[...new Set(hows)]})`);
    await build();
    const pdfRooms = await roomNames();
    for (const n of ["Bedroom 1", "Bedroom 2", "Bathroom"]) assert.ok(pdfRooms.includes(n), `${tag}: PDF room "${n}" read by OCR (${pdfRooms})`);

    assert.deepEqual(blocked, [], `${tag}: blocked non-local requests`);
    report.push(`${tag}: image ${scale} px/m, rooms ${imageRooms.join(", ")}; PDF 11/11 dimensions read by OCR, rooms ${pdfRooms.join(", ")}; 0 blocked requests`);
  } catch (e) {
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}/fail-${width}-${phase}.png` }).catch(() => {});
    console.error(`${tag}: failed; blocked so far: ${JSON.stringify(blocked)}`);
    throw e;
  } finally {
    await context.close();
  }
}

async function main() {
  await warmRoutes(["/studio/import", "/studio"]);
  const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM || undefined });
  try {
    for (const [w, h] of [[1440, 900], [390, 844]] as const) await session(browser, w, h, "A");
  } finally {
    await browser.close();
  }
  const offline = await chromium.launch({
    executablePath: process.env.E2E_CHROMIUM || undefined,
    args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"],
  });
  try {
    // Control: the rule really cuts the internet (else a pass would prove nothing).
    const probe = await (await offline.newContext()).newPage();
    await probe.goto(`${BASE}/studio/import`);
    assert.equal(await probe.evaluate(() => fetch("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js").then(() => "reached", () => "unreachable")), "unreachable", "control: the CDN is unreachable");
    for (const [w, h] of [[1440, 900], [390, 844]] as const) await session(offline, w, h, "B");
  } finally {
    await offline.close();
  }
  assert.deepEqual(errors, [], `console errors:\n${errors.join("\n")}`);
  console.log("\n" + report.join("\n"));
  console.log("OK");
}

withSuiteTimeout("e2e-offline-ocr", 25 * 60_000, main).catch((e) => {
  console.error(e);
  process.exit(1);
});
