/**
 * e2e-takeoff.ts — a repeatable browser check of the Takeoff tool (step M.2a) with Playwright's
 * Chromium. NOT in npm test: it needs the dev server (npm run dev on port 3000; E2E_URL
 * overrides), because it READS the dev-only window.__planStore and window.__takeoffStore to check
 * values. Hooks are only read, never written: every action is real mouse, keyboard or touch input.
 * Plan points are turned into screen points through the 2D canvas's own camera attributes
 * (data-scale, data-tx, data-ty), as scripts/e2e-studio.ts does.
 *
 * At 1440×900 with a mouse, in Split:
 *   - Takeoff is aria-disabled in 3D only ("Takeoff works in the 2D plan") and works in Split;
 *   - Length: the south wall's two outside face corners, Enter: 10.2 m, equal to the sum of
 *     wallOutline's outside edges within 1e-6; Escape mid-draw leaves history unchanged;
 *   - Area: Bedroom 1's four inner corners, closed on the first: its net area (deriveRooms) within
 *     1e-6 m², and the panel's room row shows the same value rounded; a 1 × 1 m cutout subtracts 1 m²;
 *   - Wall: the partition's left face, centre line and right face, by the pointer's side, equal to
 *     wallOutline's edges and its length within 1e-6, with "Room side: Bedroom 2" on the hover label;
 *   - units: mm and ft-in in the table; a reference that differs is Flagged; an override shows both
 *     values; Delete and Ctrl+Z; reload keeps every takeoff and the units; the CSV downloads and parses;
 *   - Walk switches the tool to Select and disables Takeoff ("Exit Walk to use Takeoff").
 *   - step U.1, two cases the M.2a run did not cover: the mm² area unit (an area row reads
 *     "13,822,500 mm²", whole and grouped, and the room list follows because the unit is the ONE
 *     setting), and the stale marker: a takeoff measured on the partition, the partition dragged
 *     with the real mouse, "Walls have moved since this was measured" shown on the takeoff rows,
 *     "Mark as current" clears that row's marker only.
 * At 390×844 with real touch (Chromium's own touch input): in 2D, a Length with taps, Undo point
 * and Finish; Cancel leaves history unchanged; an Area with taps and Finish; a Wall face through the
 * Left toggle; the page is exactly 390 px wide with the table scrolling inside its own box.
 * Screenshots in /tmp/studio/: takeoff-length-mid-draw-1440.png, takeoff-area-cutout-1440.png,
 * takeoff-panel-flagged-1440.png, takeoff-390.png.
 * Run: npx tsx scripts/e2e-takeoff.ts
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium, type Page } from "playwright";
import { samplePlan } from "../src/data/samplePlan";
import { wallOutline } from "../src/lib/plan/geometry";
import { deriveRooms } from "../src/lib/plan/rooms";
import type { Plan, Takeoff } from "../src/types/plan";

const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const OUT = "/tmp/studio";
const EXECUTABLE = process.env.E2E_CHROMIUM || undefined;
type Pt = { x: number; y: number };
type Win = Window & {
  __planStore?: { getState(): { plan: Plan; past: unknown[] } };
  __takeoffStore?: { getState(): { draft: [number, number][]; mode: string; message: string | null } };
  __toolStore?: { getState(): { tool: string } };
};

const errors: string[] = [];
const tid = (page: Page, id: string) => page.getByTestId(id);
const plan = (page: Page) => page.evaluate(() => (window as Win).__planStore!.getState().plan);
const history = (page: Page) => page.evaluate(() => (window as Win).__planStore!.getState().past.length);
const draft = (page: Page) => page.evaluate(() => (window as Win).__takeoffStore!.getState().draft);
const tool = (page: Page) => page.evaluate(() => (window as Win).__toolStore!.getState().tool);
const near = (a: number, b: number, eps: number, msg: string) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const dist = (p: Pt, q: Pt) => Math.hypot(q.x - p.x, q.y - p.y);
const polyLen = (ps: [number, number][]) => ps.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - ps[i][0], p[1] - ps[i][1]), 0);
const shoelace = (ps: [number, number][]) => Math.abs(ps.reduce((s, p, i) => s + p[0] * ps[(i + 1) % ps.length][1] - ps[(i + 1) % ps.length][0] * p[1], 0)) / 2;
const outline = (id: string) => wallOutline(samplePlan.walls.find((w) => w.id === id)!, samplePlan.walls); // [a-right, b-right, b-left, a-left]

// The truths, from the sample plan through the app's own geometry (not through the tool).
const SOUTH_OUTSIDE = ["w-EL", "w-LF", "w-FG"].reduce((s, id) => s + dist(outline(id)[0], outline(id)[1]), 0); // 10.2 m
const HI = outline("w-HI");
const BED1 = deriveRooms(samplePlan).find((r) => r.name === "Bedroom 1")!;

/** Plan metres → page pixels through the 2D canvas's camera. */
async function toScreen(page: Page, p: Pt): Promise<Pt> {
  const c = await tid(page, "plan-canvas").evaluate((e) => ({ s: +e.getAttribute("data-scale")!, tx: +e.getAttribute("data-tx")!, ty: +e.getAttribute("data-ty")! }));
  const b = (await tid(page, "plan-canvas").boundingBox())!;
  return { x: b.x + p.x * c.s + c.tx, y: b.y + p.y * c.s + c.ty };
}
const scale = async (page: Page) => +(await tid(page, "plan-canvas").getAttribute("data-scale"))!;
const newest = async (page: Page): Promise<Takeoff> => {
  const t = (await plan(page)).takeoffs ?? [];
  return t[t.length - 1];
};

async function open(width: number, height: number, touch: boolean) {
  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, acceptDownloads: true });
  const page = await context.newPage();
  const tag = `${width}`;
  page.on("pageerror", (e) => errors.push(`${tag} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag} console: ${m.text().slice(0, 200)}`));
  await page.goto(`${BASE}/studio`);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }); // the dev badge swallows phone taps
  await tid(page, "plan-name").waitFor();
  return { browser, page };
}

/** Takeoff is disabled while only 3D shows, with the reason in its tooltip. */
async function disabledIn3d(page: Page, tag: string) {
  await tid(page, "view-3d").click();
  await page.waitForTimeout(200);
  assert.equal(await tid(page, "tool-takeoff").getAttribute("aria-disabled"), "true", `${tag}: disabled in 3D only`);
  assert.equal(await tid(page, "tip-takeoff").or(page.locator("#tip-takeoff")).first().textContent(), "Takeoff works in the 2D plan", `${tag}: the tooltip says why`);
  await tid(page, "tool-takeoff").click({ force: true });
  assert.notEqual(await tool(page), "takeoff", `${tag}: a click does nothing`);
}

async function desktop() {
  const tag = "1440";
  const { browser, page } = await open(1440, 900, false);
  const press = (k: string) => page.keyboard.press(k);
  const click = async (p: Pt) => page.mouse.click(p.x, p.y);
  const at = async (x: number, y: number) => toScreen(page, { x, y });

  await disabledIn3d(page, tag);
  await tid(page, "view-split").click();
  await tid(page, "plan-svg").waitFor();
  await page.waitForTimeout(600);
  await tid(page, "tool-takeoff").click();
  assert.equal(await tid(page, "tool-takeoff").getAttribute("aria-pressed"), "true", `${tag}: Takeoff chosen from the rail`);
  assert.equal(await tool(page), "takeoff");
  console.log(`${tag}: Takeoff disabled in 3D only, chosen in Split (${(await scale(page)).toFixed(1)} px/m)`);

  // ---- Length: the south wall's outside face, corner to corner
  const h0 = await history(page);
  await click(await at(-0.1, 8.1));
  const end = await at(10.1, 8.1);
  await page.mouse.move(end.x - 60, end.y - 30, { steps: 4 });
  await tid(page, "takeoff-live").waitFor();
  assert.match(await tid(page, "takeoff-live").textContent() ?? "", /^Total .* · last /, `${tag}: a live running total and last segment`);
  await page.mouse.move(end.x, end.y, { steps: 4 });
  assert.equal(await tid(page, "takeoff-snap").getAttribute("data-snap"), "corner", `${tag}: it snaps to the face corner`);
  await page.screenshot({ path: `${OUT}/takeoff-length-mid-draw-1440.png` });
  await click(end);
  await press("Enter");
  const len = await newest(page);
  assert.equal(len.name, "Length 1");
  near(polyLen(len.points), SOUTH_OUTSIDE, 1e-6, `${tag}: Length = the outside face from wallOutline`);
  assert.equal(await history(page), h0 + 1, `${tag}: one undo step`);
  console.log(`${tag}: Length 1 = ${polyLen(len.points).toFixed(6)} m (truth ${SOUTH_OUTSIDE.toFixed(6)})`);

  // ---- Escape mid-draw: history unchanged
  const h1 = await history(page);
  await click(await at(2.5, 6));
  await click(await at(3, 6.5));
  assert.equal((await draft(page)).length, 2);
  await press("Escape");
  assert.deepEqual(await draft(page), [], `${tag}: Escape drops the draft`);
  assert.equal(await history(page), h1, `${tag}: and leaves history unchanged`);
  assert.equal(await tool(page), "takeoff", `${tag}: the first Escape keeps the tool`);

  // ---- Area: Bedroom 1's inner corners, closed by clicking the first
  await tid(page, "takeoff-mode-area").click();
  const corners: [number, number][] = [[0.1, 0.1], [3.95, 0.1], [3.95, 3.95], [0.1, 3.95]];
  for (const [x, y] of corners) await click(await at(x, y));
  await click(await at(0.1, 0.1));
  const area = await newest(page);
  assert.equal(area.name, "Area 1");
  near(shoelace(area.points), BED1.area, 1e-6, `${tag}: Area = Bedroom 1's net area`);
  const roomRow = await page.locator('[data-testid^="room-area-"]').allInnerTexts();
  assert.ok(roomRow.includes(`${BED1.area.toFixed(1)} m²`), `${tag}: the panel lists Bedroom 1 as ${BED1.area.toFixed(1)} m² (${roomRow.join(", ")})`);
  // a 1 × 1 m cutout on the 5 cm grid, away from every wall
  await tid(page, "takeoff-add-cutout").click();
  for (const [x, y] of [[1, 1], [2, 1], [2, 2], [1, 2]]) await click(await at(x, y));
  await click(await at(1, 1));
  const cut = (await plan(page)).takeoffs!.find((t) => t.id === area.id)!;
  assert.equal(cut.cutouts?.length, 1, `${tag}: the cutout is attached`);
  near(shoelace(cut.points) - shoelace(cut.cutouts![0]), BED1.area - 1, 1e-6, `${tag}: and subtracts 1 m²`);
  await page.mouse.move(10, 10);
  await page.screenshot({ path: `${OUT}/takeoff-area-cutout-1440.png` });
  console.log(`${tag}: Area 1 = ${shoelace(area.points).toFixed(6)} m² (Bedroom 1 ${BED1.area}), with the cutout ${(shoelace(cut.points) - 1).toFixed(6)} m²`);

  // ---- Wall: the partition's left face, centre line and right face, by the pointer's side
  await tid(page, "takeoff-mode-wall").click();
  const s = await scale(page);
  const mid = await at(2, 4);
  const truth = { left: dist(HI[3], HI[2]), centre: 4, right: dist(HI[0], HI[1]) };
  for (const [side, dy] of [["left", 6], ["centre", 0], ["right", -6]] as const) {
    // H → I points east, so its left is south: down the screen. 6 px is past the centre band (3 px) and within the pick band.
    await page.mouse.move(mid.x, mid.y + dy, { steps: 3 });
    await tid(page, "takeoff-wall-hover").waitFor();
    assert.equal(await tid(page, "takeoff-wall-hover").getAttribute("data-side"), side, `${tag}: ${dy} px picks the ${side}`);
    if (side === "left") assert.match(await tid(page, "takeoff-wall-label").textContent() ?? "", /Room side: Bedroom 2/, `${tag}: the room on that side`);
    await page.mouse.click(mid.x, mid.y + dy);
    const t = await newest(page);
    near(polyLen(t.points), truth[side], 1e-6, `${tag}: the partition's ${side} = wallOutline's`);
    assert.match(t.name, new RegExp(side === "centre" ? "centre line$" : `${side} face$`));
  }
  console.log(`${tag}: partition faces ${truth.left} / ${truth.centre} / ${truth.right} m at ${s.toFixed(1)} px/m`);

  // ---- units and the table
  const row = (id: string) => page.locator(`[data-testid="takeoff-row"][data-takeoff="${id}"]`);
  await tid(page, "takeoff-unit-mm").click();
  assert.equal(await row(len.id).getByTestId("takeoff-measured").innerText(), "10200 mm", `${tag}: mm`);
  await tid(page, "takeoff-unit-ftin").click();
  assert.equal(await row(len.id).getByTestId("takeoff-measured").innerText(), `33'-5 9/16"`, `${tag}: ft-in`); // 10.2 / 0.0254 = 401.575" → 6425/16 = 33' 5 9/16"
  await tid(page, "takeoff-unit-mm").click();
  await tid(page, "takeoff-unit-sqft").click();
  assert.match(await row(area.id).getByTestId("takeoff-measured").innerText(), /^148\.\d{3} sq ft$/, `${tag}: sq ft`); // 13.8225 m² × 10.764 = 148.78
  // step U.1: mm², whole square millimetres, grouped by thousands; the room list is a view of the same setting
  await tid(page, "takeoff-unit-mm2").click();
  assert.equal(await row(area.id).getByTestId("takeoff-measured").innerText(), `${Math.round((shoelace(area.points) - 1) * 1e6).toLocaleString("en-US")} mm²`, `${tag}: mm²`);
  assert.equal(await row(area.id).getByTestId("takeoff-measured").innerText(), "13,822,500 mm²", `${tag}: Bedroom 1 less the 1 m² cutout, in mm²`);
  assert.ok((await page.locator('[data-testid^="room-area-"]').allInnerTexts()).every((t) => /^[\d,]+ mm²$/.test(t)), `${tag}: the room list shows mm² too (one setting)`);
  assert.match(await tid(page, "takeoff-total-area").innerText(), /mm² measured · .* mm² effective/, `${tag}: and the totals`);
  await tid(page, "takeoff-unit-m2").click();
  // a reference that differs by 50 mm (more than max(2 mm, 0.2% = 20.3 mm)): Flagged
  const ref = row(len.id).getByTestId("takeoff-ref");
  await ref.click();
  await ref.fill("10150");
  await press("Enter");
  assert.equal(await row(len.id).getByTestId("takeoff-status").innerText(), "Flagged", `${tag}: Flagged`);
  assert.equal(await row(len.id).getByTestId("takeoff-diff").innerText(), "+50 mm");
  const ov = row(len.id).getByTestId("takeoff-override");
  await ov.click();
  await ov.fill("10180");
  await press("Enter");
  assert.equal(await row(len.id).getByTestId("takeoff-overridden").innerText(), "Overridden: 10180 mm, measured 10200 mm", `${tag}: both values show`);
  assert.equal(await row(len.id).getByTestId("takeoff-status").innerText(), "Flagged", `${tag}: the override does not hide the flag`);
  const stored = (await plan(page)).takeoffs!.find((t) => t.id === len.id)!;
  near(stored.reference!.value, 10.15, 1e-12, "reference stored in metres");
  near(stored.override!.value, 10.18, 1e-12, "override stored in metres");
  assert.match(await tid(page, "takeoff-total-length").innerText(), /measured · .* effective/);
  await row(len.id).scrollIntoViewIfNeeded();
  await tid(page, "takeoff-table-wrap").evaluate((wrap) => {
    const cell = wrap.querySelector('[data-testid="takeoff-diff"]') as HTMLElement; // Difference, Status and the override in view
    wrap.scrollLeft = cell.offsetLeft - 4;
  });
  await page.screenshot({ path: `${OUT}/takeoff-panel-flagged-1440.png` });

  // ---- delete, then Ctrl+Z restores it
  const before = await plan(page);
  await row(len.id).getByTestId("takeoff-delete").click();
  assert.equal(await row(len.id).count(), 0, `${tag}: deleted`);
  await page.locator("body").click({ position: { x: 700, y: 10 } });
  await press("Control+z");
  assert.deepEqual((await plan(page)).takeoffs, before.takeoffs, `${tag}: Ctrl+Z restores it exactly`);

  // ---- the CSV
  const [download] = await Promise.all([page.waitForEvent("download"), tid(page, "takeoff-csv").click()]);
  assert.equal(download.suggestedFilename(), "two-bedroom-house-takeoffs.csv");
  const csv = readFileSync((await download.path())!, "utf8").trim().split(/\r\n/);
  assert.equal(csv[0], "name,kind,basis,measured (mm | m²),reference (mm | m²),difference (mm | m²),status,override (mm | m²),override note,effective (mm | m²),stale");
  assert.equal(csv.length, 1 + (await plan(page)).takeoffs!.length, `${tag}: one line per takeoff`);
  assert.equal(csv[1], "Length 1,length,Drawn,10200,10150,50.0,Flagged,10180,,10180,no", `${tag}: measured, override and effective in their own columns`);
  console.log(`${tag}: CSV ${csv.length - 1} rows: ${csv[1]}`);

  // ---- reload: everything persists (the autosave writes after 800 ms of quiet)
  await page.waitForFunction(() => document.querySelector('[data-testid="save-status"]')?.getAttribute("data-state") === "saved");
  const saved = (await plan(page)).takeoffs;
  await page.reload();
  await tid(page, "plan-name").waitFor();
  assert.deepEqual((await plan(page)).takeoffs, saved, `${tag}: every takeoff survives a reload`);
  assert.equal(await tid(page, "takeoff-unit-mm").getAttribute("aria-pressed"), "true", `${tag}: and the length unit`);

  // ---- walk: switches to Select and disables Takeoff
  await tid(page, "view-split").click();
  await page.waitForSelector("canvas");
  await page.waitForTimeout(800);
  await press("k");
  assert.equal(await tool(page), "takeoff", `${tag}: K picks Takeoff`);
  await tid(page, "camera-walk").click();
  await page.waitForTimeout(400);
  assert.equal(await tool(page), "select", `${tag}: entering Walk switches the tool to Select`);
  assert.equal(await tid(page, "tool-takeoff").getAttribute("aria-disabled"), "true", `${tag}: disabled while walking`);
  assert.equal(await page.locator("#tip-takeoff").textContent(), "Exit Walk to use Takeoff");
  await tid(page, "walk-exit").click();
  await page.waitForTimeout(300);
  await tid(page, "view-3d").click();
  assert.equal(await tid(page, "tool-takeoff").getAttribute("aria-disabled"), "true");
  console.log(`${tag}: delete + Ctrl+Z, CSV, reload, K, Walk and 3D only: ok`);

  // ---- step U.1: the stale marker. Measure the partition, then move it with the real mouse.
  await tid(page, "view-split").click();
  await tid(page, "plan-svg").waitFor();
  await page.waitForTimeout(600);
  await tid(page, "tool-takeoff").click();
  await tid(page, "takeoff-mode-wall").click();
  await tid(page, "takeoff-side-centre").click();
  const mid2 = await at(2, 4);
  await click(mid2);
  const measured = await newest(page);
  assert.match(measured.name, /centre line$/, `${tag}: the partition's centre line measured`);
  const stale = page.locator('[data-testid="takeoff-stale"]');
  assert.equal(await stale.count(), 0, `${tag}: nothing is stale yet`);
  await tid(page, "tool-select").click();
  const hBefore = await history(page);
  await page.mouse.move(mid2.x, mid2.y);
  await page.mouse.down();
  await page.mouse.move(mid2.x, mid2.y + 0.15 * (await scale(page)), { steps: 4 });
  await page.mouse.move(mid2.x, mid2.y + 0.3 * (await scale(page)), { steps: 4 });
  await page.mouse.up();
  assert.ok((await history(page)) > hBefore, `${tag}: the wall really moved (one undo step more)`);
  const moved = (await plan(page)).walls.find((w) => w.id === "w-HI")!;
  near(moved.a.y, 4.3, 0.05, `${tag}: the partition is about 0.3 m south`);
  await tid(page, "takeoff-toggle").evaluate((b) => b.getAttribute("aria-expanded") === "false" && (b as HTMLElement).click());
  const rowOf = (id: string) => page.locator(`[data-testid="takeoff-row"][data-takeoff="${id}"]`);
  await rowOf(measured.id).scrollIntoViewIfNeeded();
  assert.equal(await rowOf(measured.id).getByTestId("takeoff-stale").count(), 1, `${tag}: the measured takeoff is marked`);
  assert.equal((await rowOf(measured.id).getByTestId("takeoff-stale").innerText()).split("\n")[0], "Walls have moved since this was measured", `${tag}: with the words`);
  const staleBefore = await stale.count();
  await page.screenshot({ path: `${OUT}/takeoff-stale-1440.png` });
  await rowOf(measured.id).getByTestId("takeoff-mark-current").click();
  assert.equal(await rowOf(measured.id).getByTestId("takeoff-stale").count(), 0, `${tag}: Mark as current clears that row`);
  assert.equal(await stale.count(), staleBefore - 1, `${tag}: and only that row (${staleBefore} → ${await stale.count()})`);
  const now = (await plan(page)).takeoffs!.find((t) => t.id === measured.id)!;
  assert.deepEqual(now.points, measured.points, `${tag}: the points did not move (absolute)`);
  assert.notEqual(now.wallsHash, measured.wallsHash, `${tag}: only its walls hash was updated`);
  console.log(`${tag}: stale marker: the partition dragged 0.3 m, ${staleBefore} rows marked, Mark as current cleared the measured one`);
  await browser.close();
}

async function phone() {
  const tag = "390";
  const { browser, page } = await open(390, 844, true);
  const tap = async (p: Pt) => page.touchscreen.tap(p.x, p.y);
  const at = (x: number, y: number) => toScreen(page, { x, y });
  await disabledIn3d(page, tag);
  await tid(page, "view-2d").tap();
  await tid(page, "plan-svg").waitFor();
  await tid(page, "tool-takeoff").tap();
  assert.equal(await tool(page), "takeoff", `${tag}: chosen by tap`);
  await page.waitForTimeout(300);

  // ---- Length with taps; Undo point and Finish buttons
  const h0 = await history(page);
  await tap(await at(-0.1, 8.1));
  await tap(await at(10.1, 8.1));
  await tap(await at(5, 6));
  assert.equal((await draft(page)).length, 3);
  await tid(page, "takeoff-undo-point").tap();
  assert.equal((await draft(page)).length, 2, `${tag}: Undo point`);
  await tid(page, "takeoff-finish").tap();
  near(polyLen((await newest(page)).points), SOUTH_OUTSIDE, 1e-6, `${tag}: Length by touch`);
  assert.equal(await history(page), h0 + 1);
  // Cancel: history unchanged
  await tap(await at(2.5, 6));
  await tap(await at(3, 6.5));
  await tid(page, "takeoff-cancel").tap();
  assert.deepEqual(await draft(page), [], `${tag}: Cancel drops the draft`);
  assert.equal(await history(page), h0 + 1, `${tag}: and leaves history unchanged`);

  // ---- Area with taps and Finish
  await tid(page, "takeoff-mode-area").tap();
  for (const [x, y] of [[0.1, 0.1], [3.95, 0.1], [3.95, 3.95], [0.1, 3.95]]) await tap(await at(x, y));
  await tid(page, "takeoff-finish").tap();
  near(shoelace((await newest(page)).points), BED1.area, 1e-6, `${tag}: Area by touch`);

  // ---- Wall: the Left toggle, then a tap on the partition (a finger can't aim at one face of a 10 cm wall)
  await tid(page, "takeoff-mode-wall").tap();
  await tid(page, "takeoff-side-left").tap();
  await tap(await at(2, 4));
  const w = await newest(page);
  near(polyLen(w.points), dist(HI[3], HI[2]), 1e-6, `${tag}: the partition's left face by touch`);
  assert.match(w.name, /left face$/);

  // ---- the panel: the table scrolls inside its box, the page is exactly 390 wide
  await page.getByRole("button", { name: /Plan details/ }).tap();
  await tid(page, "takeoff-table").waitFor();
  await tid(page, "takeoff-table-wrap").scrollIntoViewIfNeeded();
  const widths = await page.evaluate(() => ({
    inner: innerWidth,
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    wrap: (document.querySelector('[data-testid="takeoff-table-wrap"]') as HTMLElement).clientWidth,
    table: (document.querySelector('[data-testid="takeoff-table"]') as HTMLElement).scrollWidth,
  }));
  assert.equal(widths.inner, 390, `${tag}: viewport`);
  assert.equal(widths.doc, 390, `${tag}: the page is exactly 390 px wide`);
  assert.equal(widths.body, 390, `${tag}: and so is the body`);
  assert.ok(widths.table > widths.wrap, `${tag}: the table (${widths.table}) scrolls inside its ${widths.wrap} px box`);
  await page.screenshot({ path: `${OUT}/takeoff-390.png` });
  console.log(`${tag}: Length, Undo point, Finish, Cancel, Area, Wall (Left toggle) by touch; page ${widths.doc} px, table ${widths.table} px in a ${widths.wrap} px box`);
  await browser.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  await desktop();
  await phone();
  assert.deepEqual(errors, [], `console errors:\n${errors.join("\n")}`);
  console.log("e2e-takeoff: OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
