/**
 * e2e-browsers.ts — step A.1: a small smoke suite in Playwright's WebKit (Safari's engine) and Firefox. NOT in npm test and
 * NOT in CI: the browsers have to be installed (`npx playwright install webkit firefox`), and see docs/PERFORMANCE.md for how
 * reliably it ran. It uses no dev-only hook, so it works against a production server as well as the dev one:
 *   npm run build && npx next start -p 3100, then E2E_URL=http://localhost:3100 npx tsx scripts/e2e-browsers.ts
 * Per browser it checks that: the landing page loads and settles in 3D or static mode (the mode is printed; headless WebKit and
 * Firefox often have no WebGL, which is the static mode's job); /limits loads; the import page loads and shows its hint; the
 * sample plan is read, its scale accepted, the model built and the studio opens on it; a vector PDF is imported and reviewed;
 * the studio switches to the 2D plan; and no console error or page error occurred. BROWSERS=webkit (or firefox) runs one.
 * Not a test of behaviour beyond that: the Chromium suites (e2e-*.ts) are where behaviour is checked.
 * Run: npx tsx scripts/e2e-browsers.ts
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { firefox, webkit, type BrowserType, type Page } from "playwright";
import { BASE, step, waitUntil, warmRoutes, watchErrors, withSuiteTimeout } from "./e2e-helpers";

const PDF = join(process.cwd(), "tests/fixtures/pdf/plan-filled.pdf");
const ENGINES: [string, BrowserType][] = [["webkit", webkit], ["firefox", firefox]];
const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);

async function smoke(name: string, type: BrowserType): Promise<string[]> {
  const errors: string[] = [];
  step(`${name}: launching the browser`);
  const browser = await type.launch();
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    watchErrors(page, name, errors);

    step(`${name}: landing`);
    await page.goto(`${BASE}/`);
    await page.waitForSelector("[data-testid=blueprint-scene]:not([data-mode=pending])", { timeout: 30_000 });
    console.log(`${name}: landing mode ${await tid(page, "blueprint-scene").getAttribute("data-mode")}`);

    step(`${name}: limits`);
    await page.goto(`${BASE}/limits`);
    await page.getByRole("heading", { level: 1 }).waitFor();

    step(`${name}: import page and the sample plan`);
    await page.goto(`${BASE}/studio/import`);
    await tid(page, "first-run-hint").waitFor();
    await page.getByRole("button", { name: "Try a sample plan" }).click();
    await page.getByRole("button", { name: "Use this scale" }).waitFor({ timeout: 120_000 });
    await page.getByRole("button", { name: "Use this scale" }).click();
    await page.getByRole("button", { name: "Build model" }).click();
    await page.getByRole("button", { name: "Open in studio" }).click();
    await page.waitForURL(/\/studio$/);
    await tid(page, "plan-name").waitFor();
    await tid(page, "total-area").waitFor();

    step(`${name}: studio views`);
    await tid(page, "view-2d").click();
    await tid(page, "plan-canvas").waitFor();
    await waitUntil(page, `${name}: the 2D plan drew no walls`, `document.querySelectorAll('[data-testid="plan-wall"]').length > 0`);

    step(`${name}: a vector PDF`);
    await page.goto(`${BASE}/studio/import`);
    await tid(page, "file-input").setInputFiles(PDF);
    await page.waitForSelector("[data-testid=results][data-review=ready], [data-testid=error]", { timeout: 120_000 });
    assert.equal(await tid(page, "error").count(), 0, `${name}: plan-filled.pdf failed to import`);
    await tid(page, "plan-verdict").waitFor();
  } finally {
    await browser.close();
  }
  return errors;
}

async function main() {
  await warmRoutes(["/", "/limits", "/studio", "/studio/import"]);
  const only = process.env.BROWSERS?.split(",");
  let failed = 0;
  for (const [name, type] of ENGINES) {
    if (only && !only.includes(name)) continue;
    try {
      const errors = await smoke(name, type);
      if (errors.length) {
        failed++;
        console.error(`${name}: FAILED with console errors:\n${errors.join("\n")}`);
      } else console.log(`${name}: OK`);
    } catch (e) {
      failed++;
      console.error(`${name}: FAILED at step "${(await import("./e2e-helpers")).currentStep()}": ${(e as Error).message.split("\n")[0]}`);
    }
  }
  assert.equal(failed, 0, `${failed} browser(s) failed`);
  console.log("e2e-browsers: OK");
}

withSuiteTimeout("e2e-browsers", 600_000, main).catch((e) => {
  console.error(e);
  process.exit(1);
});
