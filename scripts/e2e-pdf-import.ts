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
 *     studio: the plan store's rooms carry the PDF's names and every wall's length
 *     matches a true wall's within 4 raster pixels (2 per traced end, reported).
 *     plan-lines (walls as double lines) is built and its result printed but NOT
 *     asserted: the image pipeline's hollow mode leaves its living room unclosed;
 *   - 390: plan-filled (built and checked in the studio), the two-page picker by tap,
 *     no sideways page scroll while the dimension table scrolls inside its container;
 *   - both: a copy of plan-filled with one dimension misprinted (4100 mm on a 4 m line,
 *     made in /tmp by make-pdf-fixtures' misprintedPdf) shows that row Flagged; it is
 *     overridden to 4000 mm with a note; the row says Overridden and keeps the measured
 *     value; the downloaded CSV holds both;
 *   - no console errors.
 * Any .pdf in test-plans/ (local only, never committed) is also read at 1440 and one
 * row per file printed: classification, scale status, dimensions read, flagged, time.
 * Screenshots in /tmp/studio/: pdf-review-1440.png, pdf-dimension-check-1440.png,
 * pdf-fit-warning-1440.png, pdf-review-390.png.
 * Run: npx tsx scripts/e2e-pdf-import.ts
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import { samplePlan } from "../src/data/samplePlan";
import { titleCase } from "../src/lib/blueprint/nameRooms";
import { formatFeetInches } from "../src/lib/pdf/dimensions";
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

type Win = Window & {
  __planStore?: { getState(): { plan: { walls: { a: { x: number; y: number }; b: { x: number; y: number } }[]; rooms: { name: string }[] } } };
  __importPdf?: PdfInfo;
};

const errors: string[] = [];
const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
const report: string[] = [];

async function session(browser: Browser, width: number, height: number, touch: boolean) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, acceptDownloads: true });
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

  /** Rooms named from the PDF; every wall length within 4 raster pixels of a true wall's (lengths sorted). */
  const checkPlan = (file: string, plan: Awaited<ReturnType<typeof buildAndOpen>>, t: Truth, pdf: PdfInfo) => {
    assert.deepEqual(plan.rooms.map((r) => r.name).sort(), NAMES, `${file}: room names from the PDF`);
    const len = (w: { a: { x: number; y: number }; b: { x: number; y: number } }) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    const got = plan.walls.map(len).sort((p, q) => p - q);
    const want = t.walls.map(len).sort((p, q) => p - q);
    assert.equal(got.length, want.length, `${file}: ${got.length} walls, want ${want.length}`);
    const tolM = (4 * pdf.traceMm!) / 1000;
    const worst = Math.max(...got.map((g, i) => Math.abs(g - want[i])));
    assert.ok(worst <= tolM, `${file}: worst wall length error ${(worst * 1000).toFixed(1)} mm > ${(tolM * 1000).toFixed(1)} mm`);
    return `rooms ${plan.rooms.map((r) => r.name).join(", ")}; ${got.length} walls, worst length error ${(worst * 1000).toFixed(1)} mm (tolerance 4 px = ${(tolM * 1000).toFixed(1)} mm at ${pdf.traceMm!.toFixed(1)} mm/px)`;
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
  const files = touch ? ["plan-filled.pdf", "plan-two-pages.pdf"] : truths.map((t) => t.file);
  for (const file of files) {
    const t = truths.find((x) => x.file === file)!;
    const t0 = Date.now();
    if (t.pages > 1) {
      await page.goto(`${BASE}/studio/import`);
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
      assert.deepEqual(outside, [], `${file}: no request left the origin`);
      assert.ok(notes.includes("Read from PDF vectors."), `${file}: vector note`);
      assert.match(notes, /Wall positions are traced at about \d+ mm; exact snapping arrives in the next step\./, `${file}: trace note`);
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
        line += `; ${t.dims.length} dimensions, all OK within 0.1 mm of the truth`;
      } else assert.equal(await tid(page, "dimension-check").count(), 0, `${file}: no table without dimensions`);
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
      if (file === "plan-lines.pdf") {
        // Reported, not asserted: double-line walls go through the image pipeline's hollow
        // mode, which does not close every room on this fixture (a known limit; M.1b snaps
        // walls to the PDF's own segments).
        const plan = await buildAndOpen();
        line += `; built (not asserted): ${plan.walls.length} walls, rooms ${plan.rooms.map((r) => r.name).join(", ") || "none"}`;
      } else if (t.expectedScale !== "none" && (!touch || file === "plan-filled.pdf")) line += `; ${checkPlan(file, await buildAndOpen(), t, pdf)}`;
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
    const [download] = await Promise.all([page.waitForEvent("download"), press(tid(page, "dims-csv"))]);
    const csv = readFileSync((await download.path())!, "utf8");
    const csvRow = csv.split("\n").find((l) => l.startsWith("4100 mm"))!;
    assert.ok(csvRow.includes(`,${measured.replace(" mm", "")},`) && csvRow.includes(",Overridden,4000.0,") && csvRow.includes("Misprint on the drawing"), `CSV keeps both: ${csvRow}`);
    assert.equal(csv.trim().split("\n").length, 12, "CSV: a header and 11 rows");
    const line = `${touch ? "390" : "1440"} misprinted: 4100 mm Flagged, overridden to 4000 mm with measured ${measured} kept; CSV "${csvRow}"`;
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
      report.push(`test-plans/${f}: ${err ? `error "${err}"` : `${pdf?.kind}, scale ${pdf?.scale?.confidence ?? "OCR route"}, ${rows} dimensions read, ${flagged} flagged`}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
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
