/**
 * e2e-import.ts — browser test of the upload and review screen,
 * src/app/studio/import/page.tsx, with Playwright's Chromium.
 *
 * Not in npm test. It needs the dev server running (npm run dev; E2E_URL
 * overrides http://localhost:3000) and, on the first run, the network: the
 * browser's tesseract.js fetches its worker and English language data from
 * the jsdelivr CDN.
 *
 *   a. /studio/import at 1440×900 and 390×844: the drop zone shows and the
 *      page has no horizontal scroll.
 *   b. Upload 03 through the file input: suggested scale about 99.9 px/m, the
 *      overlay draws 4 doors and 4 windows; Use, Build model, Open in studio;
 *      the plan store holds 13 walls, 8 openings and 4 rooms named Bedroom 1,
 *      Bedroom 2, Living and Bath / Kitchen. The browser's OCR words for 03
 *      are compared with a Node run of analyseBlueprint on the same image.
 *   c. 02 has no printed scale: "Set the scale yourself", click two points
 *      1000 px apart along the top wall, type 10 m; it builds 4 rooms.
 *   d. "Try a sample plan" reaches the results view.
 *   e. A PDF and a text file get their plain-words messages.
 *   f. Cancel during analysis returns to the drop zone and no results appear.
 * Screenshots of the results view at both sizes go to /tmp/import/.
 *
 * Reads the page's development-only hooks: window.__planStore (planStore.ts)
 * and window.__importAnalysis (page.tsx).
 * Run: npx tsx scripts/e2e-import.ts
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "playwright";
import sharp from "sharp";
import { analyseBlueprint } from "../src/lib/blueprint/analyse";

const URL_ = (process.env.E2E_URL ?? "http://localhost:3000") + "/studio/import";
const OUT = "/tmp/import";
const F03 = "tests/fixtures/03_with_dimensions.png";
const F02 = "tests/fixtures/02_thick_exterior_thin_interior.png";
const LONG = 240_000; // first OCR run downloads the language data

type Win = Window & {
  __planStore?: { getState(): { plan: { walls: unknown[]; openings: unknown[]; rooms: { name: string }[] } } };
  __importAnalysis?: { words: { text: string }[] };
};

const errors: string[] = [];
function watch(page: Page, tag: string) {
  page.on("pageerror", (e) => errors.push(`${tag} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag} console: ${m.text().slice(0, 200)}`));
}

const results = (page: Page) => page.waitForSelector("[data-testid=results]", { timeout: LONG });
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}`, fullPage: true });

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const open = async (width: number, height: number, tag: string) => {
    const page = await browser.newPage({ viewport: { width, height } });
    watch(page, tag);
    await page.goto(URL_);
    await page.waitForSelector("[data-testid=drop-zone]");
    return page;
  };

  // ---------------------------------------------------------------- a, b at 1440
  const big = await open(1440, 900, "1440");
  assert.ok(await noSideScroll(big), "a: no horizontal scroll at 1440");
  let t0 = Date.now();
  await big.setInputFiles("[data-testid=file-input]", F03);
  await results(big);
  console.log(`b: 03 analysed in the browser in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const suggested = Number(await big.getByTestId("suggested-scale").innerText());
  assert.ok(Math.abs(suggested - 99.9) < 0.5, `b: suggested scale ${suggested}, want about 99.9`);
  const doors = await big.locator("[data-layer=doors] line").count();
  const windows = await big.locator("[data-layer=windows] line").count();
  assert.equal(doors, 4, "b: 4 doors drawn");
  assert.equal(windows, 4, "b: 4 windows drawn");
  console.log(`b: suggested ${suggested} px/m, overlay ${doors} doors, ${windows} windows`);
  const browserWords = await big.evaluate(() => ((window as Win).__importAnalysis?.words ?? []).map((w) => w.text));
  await big.getByRole("button", { name: "Use this scale" }).click();
  await big.getByRole("button", { name: "Build model" }).click();
  await big.getByTestId("summary").waitFor();
  await shot(big, "results-1440.png");
  console.log(`b: summary "${await big.getByTestId("summary-counts").innerText()}"`);
  await big.getByRole("button", { name: "Open in studio" }).click();
  await big.waitForURL("**/studio");
  const stored = await big.evaluate(() => {
    const { plan } = (window as Win).__planStore!.getState();
    return { walls: plan.walls.length, openings: plan.openings.length, rooms: plan.rooms.map((r) => r.name).sort() };
  });
  console.log(`b: plan store ${stored.walls} walls, ${stored.openings} openings, rooms ${stored.rooms.join(", ")}`);
  assert.equal(stored.walls, 13, "b: 13 walls");
  assert.equal(stored.openings, 8, "b: 8 openings");
  assert.deepEqual(stored.rooms, ["Bath / Kitchen", "Bedroom 1", "Bedroom 2", "Living"], "b: room names");

  // Browser OCR versus Node OCR on 03.
  const { data, info } = await sharp(F03).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const nodeWords = (await analyseBlueprint({ width: info.width, height: info.height, rgba: data })).words.map((w) => w.text);
  const same = JSON.stringify(nodeWords) === JSON.stringify(browserWords);
  console.log(`b: OCR words ${same ? "identical" : "DIFFER"} (browser ${browserWords.length}, node ${nodeWords.length})`);
  if (!same) console.log(`   browser: ${JSON.stringify(browserWords)}\n   node:    ${JSON.stringify(nodeWords)}`);

  // ---------------------------------------------------------------- c: 02, scale set by hand
  await big.goto(URL_);
  await big.setInputFiles("[data-testid=file-input]", F02);
  await results(big);
  await big.getByTestId("scale-none").waitFor();
  await big.getByRole("button", { name: "Set the scale yourself" }).click();
  // The top wall: the horizontal wall lines with the smallest y; start at its left end.
  const top = await big.evaluate(() => {
    const ls = [...document.querySelectorAll("line[data-wall]")].map((l) => ["x1", "y1", "x2", "y2"].map((k) => Number(l.getAttribute(k))));
    const hs = ls.filter(([x1, y1, x2, y2]) => Math.abs(y2 - y1) < Math.abs(x2 - x1));
    const y = Math.min(...hs.map((h) => (h[1] + h[3]) / 2));
    const row = hs.filter((h) => Math.abs((h[1] + h[3]) / 2 - y) < 2);
    return { x: Math.min(...row.flatMap((h) => [h[0], h[2]])), y };
  });
  /** Image pixel → page coordinates, through the overlay's live transform. */
  const toScreen = (x: number, y: number) =>
    big.evaluate(([x, y]) => {
      const g = document.querySelector<SVGGElement>("[data-testid=plan-content]")!;
      const p = new DOMPoint(x, y).matrixTransform(g.getScreenCTM()!);
      return { x: p.x, y: p.y };
    }, [x, y] as const);
  for (const x of [top.x, top.x + 1000]) {
    const s = await toScreen(x, top.y);
    await big.mouse.click(s.x, s.y);
  }
  await big.getByTestId("manual-length").fill("10 m");
  const manual = await big.getByTestId("manual-result").innerText();
  console.log(`c: 02 top wall at y ${top.y.toFixed(1)} from x ${top.x.toFixed(1)}; "${manual}"`);
  assert.match(manual, /100\.\d px\/m/, "c: about 100 px/m");
  await big.getByRole("button", { name: "Use this scale" }).click();
  await big.getByRole("button", { name: "Build model" }).click();
  const counts02 = await big.getByTestId("summary-counts").innerText();
  console.log(`c: summary "${counts02}"`);
  assert.match(counts02, /\b4 rooms\b/, "c: 4 rooms");

  // ---------------------------------------------------------------- d: sample
  await big.goto(URL_);
  await big.getByRole("button", { name: "Try a sample plan" }).click();
  await results(big);
  console.log(`d: sample plan analysed, suggested ${await big.getByTestId("suggested-scale").innerText()} px/m`);

  // ---------------------------------------------------------------- e: PDF and text
  writeFileSync(`${OUT}/plan.pdf`, "%PDF-1.4\n%fake\n");
  writeFileSync(`${OUT}/notes.txt`, "not a plan\n");
  for (const [file, want] of [
    [`${OUT}/plan.pdf`, "PDFs aren't supported yet. Export the page as an image and upload that."],
    [`${OUT}/notes.txt`, "That file isn't an image we can read. Upload a PNG, JPEG or WebP picture of your plan."],
  ]) {
    await big.goto(URL_);
    await big.setInputFiles("[data-testid=file-input]", file);
    const msg = await big.getByTestId("error-message").innerText();
    assert.equal(msg, want, `e: message for ${file}`);
    await big.getByRole("button", { name: "Try another file" }).click();
    await big.getByTestId("drop-zone").waitFor();
    console.log(`e: ${file.split("/").pop()} → "${msg}"`);
  }

  // ---------------------------------------------------------------- f: cancel
  await big.goto(URL_);
  await big.setInputFiles("[data-testid=file-input]", F03);
  await big.getByTestId("progress").waitFor();
  await big.getByText("Reading text").waitFor();
  await big.getByRole("button", { name: "Cancel" }).click();
  await big.getByTestId("drop-zone").waitFor();
  await big.waitForTimeout(8000); // the worker would have finished by now had it not been stopped
  assert.equal(await big.getByTestId("results").count(), 0, "f: no results after cancel");
  console.log("f: cancelled during reading text; back at the drop zone, no results after 8 s");

  // ---------------------------------------------------------------- a, results at 390
  const small = await open(390, 844, "390");
  assert.ok(await noSideScroll(small), "a: no horizontal scroll at 390 (upload)");
  t0 = Date.now();
  await small.setInputFiles("[data-testid=file-input]", F03);
  await results(small);
  await small.getByRole("button", { name: "Use this scale" }).click();
  await small.getByRole("button", { name: "Build model" }).click();
  await small.getByTestId("summary").waitFor();
  const scroll390 = await noSideScroll(small);
  await shot(small, "results-390.png");
  await small.screenshot({ path: `${OUT}/results-390-viewport.png` });
  console.log(`a: 390 results in ${((Date.now() - t0) / 1000).toFixed(1)} s, no horizontal scroll: ${scroll390}`);
  assert.ok(scroll390, "a: no horizontal scroll at 390 (results)");

  await browser.close();
  if (errors.length) console.log(`page errors:\n  ${errors.join("\n  ")}`);
  console.log(`screenshots in ${OUT}/\nOK`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
