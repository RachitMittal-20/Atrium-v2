/**
 * e2e-pdf-watchdog.ts — step W.1 in a real browser: a runaway while the review is built can't
 * freeze the import screen. Needs `npm run dev` on port 3000 from THIS checkout (the switch below
 * is development only). Not in `npm test`. No blind sleeps: every wait is a named condition.
 *
 * 1440 (mouse), plan-filled.pdf, with the TEST-ONLY runaway switch on (`window.__reviewRunaway`,
 * set before the page's own script runs): the review worker (src/workers/review.worker.ts) loops
 * forever. Meanwhile:
 *   - a heartbeat (a 100 ms setInterval in the page, reported to this script through
 *     exposeBinding) keeps arriving: the longest gap must stay under 1 s. If it stops for 3 s the
 *     suite fails at once with "the page's heartbeat stopped": the main thread is frozen. That is
 *     what the pre-W.1 code did, where buildPdfPlan ran inside the page's render;
 *   - halfway, a page.evaluate round trip answers;
 *   - 60 s after the review worker started (59.5–70 s), the page says, in plain words, "This
 *     drawing took too long to read. Try a smaller page or export a simpler PDF.", with a
 *     "Start again" button; the review worker has been closed (terminated);
 *   - "Start again" goes back to the drop zone; with the switch off the same file then reads and
 *     reaches the review screen with its verdict, so starting again really works.
 * No console errors. Run: npx tsx scripts/e2e-pdf-watchdog.ts
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { chromium, type Worker } from "playwright";
import { BASE, step, warmRoutes, watchErrors, withSuiteTimeout } from "./e2e-helpers";

const FILE = join(process.cwd(), "tests/fixtures/pdf/plan-filled.pdf");
const EXECUTABLE = process.env.E2E_CHROMIUM || undefined;
const TOO_LONG = "This drawing took too long to read. Try a smaller page or export a simpler PDF.";
const BEAT_MS = 100;
const FROZEN_MS = 3_000; // no heartbeat for this long: the main thread is frozen
const errors: string[] = [];

async function main() {
  await warmRoutes(["/studio/import"]);
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    watchErrors(page, "1440", errors);
    await page.addInitScript({ content: "window.__reviewRunaway = true;" });

    // The heartbeat: the page calls __beat every BEAT_MS; this side watches the gaps.
    let last = 0;
    let maxGap = 0;
    let beats = 0;
    await page.exposeBinding("__beat", () => {
      const now = Date.now();
      if (last) maxGap = Math.max(maxGap, now - last);
      last = now;
      beats++;
    });
    let frozen: (e: Error) => void = () => {};
    const stopped = new Promise<never>((_, reject) => (frozen = reject));
    stopped.catch(() => {});
    const monitor = setInterval(() => {
      if (last && Date.now() - last > FROZEN_MS) frozen(new Error(`the page's heartbeat stopped for ${((Date.now() - last) / 1000).toFixed(1)} s during step "${stepName}": its main thread is frozen`));
    }, 250);
    let stepName = "";
    const at = (name: string) => step((stepName = name));

    // The review worker, by its script URL: when it starts and whether it was closed.
    let reviewStarted = 0;
    let reviewClosed: Promise<void> | null = null;
    page.on("worker", (w: Worker) => {
      if (!/review[._]worker/.test(w.url()) || reviewClosed) return;
      reviewStarted = Date.now();
      reviewClosed = new Promise((resolve) => w.on("close", () => resolve()));
    });

    at("open the import screen and start the heartbeat");
    await page.goto(`${BASE}/studio/import`);
    await page.evaluate(`setInterval(() => window.__beat(), ${BEAT_MS})`);
    await page.locator("[data-testid=drop-zone]").waitFor();

    at("upload plan-filled.pdf with the runaway switch on");
    await page.locator("[data-testid=file-input]").setInputFiles(FILE);
    const message = page.locator("[data-testid=error-message]");
    const halfway = (async () => {
      // Once the review worker is running, ask the page something halfway through the wait.
      await Promise.race([page.waitForEvent("worker", { predicate: (w) => /review[._]worker/.test(w.url()), timeout: 120_000 }), stopped]);
      const t = Date.now();
      await Promise.race([page.waitForFunction(`Date.now() - ${t} > 30000`, undefined, { timeout: 60_000, polling: 500 }), stopped]);
      const asked = Date.now();
      assert.equal(await Promise.race([page.evaluate("1 + 1"), stopped]), 2);
      return Date.now() - asked;
    })();
    halfway.catch(() => {});
    at("wait for the watchdog's message while the worker loops");
    await Promise.race([message.waitFor({ timeout: 150_000 }), stopped]);
    const shownAt = Date.now();
    const roundTrip = await Promise.race([halfway, stopped]);
    assert.equal((await message.innerText()).trim(), TOO_LONG, "the watchdog's message, in plain words");
    assert.ok(reviewStarted > 0, "the review ran in its own worker");
    const waited = (shownAt - reviewStarted) / 1000;
    assert.ok(waited >= 59.5 && waited <= 70, `the message came ${waited.toFixed(1)} s after the review worker started (60 s watchdog)`);
    assert.ok(maxGap < 1000, `the heartbeat kept going: its longest gap was ${maxGap} ms`);
    assert.ok(roundTrip < 1000, `a page.evaluate halfway answered in ${roundTrip} ms`);
    const closed = await Promise.race([reviewClosed!.then(() => true), new Promise<false>((r) => setTimeout(() => r(false), 5_000))]);
    assert.ok(closed, "the runaway worker was terminated (its close event within 5 s of the message)");
    console.log(`  watchdog: message after ${waited.toFixed(1)} s; ${beats} heartbeats, longest gap ${maxGap} ms; evaluate halfway ${roundTrip} ms; worker terminated`);

    at("Start again, then read the same file with the switch off");
    await page.getByRole("button", { name: "Start again" }).click();
    await page.locator("[data-testid=drop-zone]").waitFor();
    await page.evaluate("window.__reviewRunaway = false");
    await page.locator("[data-testid=file-input]").setInputFiles(FILE);
    await Promise.race([page.locator("[data-testid=plan-verdict]").waitFor({ timeout: 120_000 }), stopped]);
    assert.equal(await page.locator("[data-testid=plan-verdict]").getAttribute("data-level"), "good", "plan-filled reads as before once started again");
    assert.ok(maxGap < 1000, `the heartbeat kept going: its longest gap was ${maxGap} ms`);
    clearInterval(monitor);
  } finally {
    await browser.close();
  }
  assert.deepEqual(errors, [], "no console or page errors");
  console.log("e2e-pdf-watchdog: OK");
}

withSuiteTimeout("e2e-pdf-watchdog", 300_000, main).catch((e) => {
  console.error(e);
  process.exit(1);
});
