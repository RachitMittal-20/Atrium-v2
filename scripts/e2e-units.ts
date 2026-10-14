/**
 * e2e-units.ts — browser check of the ONE units setting (step U.1), with Playwright's Chromium.
 * NOT in npm test: it needs the dev server (npm run dev on port 3000; E2E_URL overrides) for the
 * dev-only window.__planStore, which is only READ. Every action is real mouse, keyboard or touch
 * input: the TopBar Units menu, the Takeoff tool, selecting walls and a window by clicking them,
 * dragging a wall's end handle, typing into the panel's fields.
 *
 * At 1440×900 (mouse, Split) and 390×844 (real touch events, 2D with the details sheet open), for
 * each of mm / mm², ft-in / sq ft and m / m² chosen in the Units menu:
 *   - the Summary's total and every room row carry the area unit, and the note about rounding;
 *   - the 2D plan's scale bar says a nice length in the unit (500 mm, 2 m, 5'-0");
 *   - the wall panel's length, thickness and height fields, the opening panel's width, height,
 *     sill and offset, a live drag label, and a Length and an Area takeoff row all carry the right
 *     unit, and no text in those containers carries a DIFFERENT length or area unit;
 *   - the ft-in setting: typing 13'6 into a wall's length field makes it 4.1148 m long (to the 1 cm the length edit rounds to), a bare 9 into its
 *     height 2.7432 m (feet); mm: a bare number is mm;
 *   - a field focused and left, or its own text typed again, adds no undo step and leaves the stored
 *     value untouched (2.7184 m shown as 2718 mm stays 2.7184);
 *   - the menu is a real radio group: reachable by Tab, the arrow keys move within a group; the
 *     choice persists through a reload, and the Summary's switch, the takeoff switches and the
 *     import review tables are views of the same setting;
 *   - at 390 the menu opens inside the viewport and the page is exactly 390 px wide.
 * Screenshots in /tmp/studio/: units-mm-1440.png, units-ftin-1440.png, units-menu-390.png.
 * Run: npx tsx scripts/e2e-units.ts
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright";
import { step, waitForHook, warmRoutes, watchErrors, withSuiteTimeout } from "./e2e-helpers";
import { samplePlan } from "../src/data/samplePlan";
import type { Plan } from "../src/types/plan";

const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const OUT = "/tmp/studio";
const EXECUTABLE = process.env.E2E_CHROMIUM || undefined;
type Pt = { x: number; y: number };
type Win = Window & { __planStore?: { getState(): { plan: Plan; past: unknown[] } } };

const errors: string[] = [];
const report: string[] = [];
const tid = (page: Page, id: string) => page.getByTestId(id);
const plan = (page: Page) => page.evaluate(() => (window as Win).__planStore!.getState().plan);
const history = (page: Page) => page.evaluate(() => (window as Win).__planStore!.getState().past.length);
const near = (a: number, b: number, eps: number, msg: string) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

interface Setting {
  name: string;
  length: "mm" | "m" | "ftin";
  area: "mm2" | "m2" | "sqft";
  /** What one length and one area read like, and the scale bar. */
  len: RegExp;
  areaRe: RegExp;
  bar: RegExp;
  /** Text in these containers that belongs to ANOTHER unit. */
  foreign: RegExp[];
}
const SETTINGS: Setting[] = [
  { name: "mm / mm²", length: "mm", area: "mm2", len: /^-?\d+ mm$/, areaRe: /^[\d,]+ mm²$/, bar: /^\d+ mm$/, foreign: [/\d ?m(?![m²a-z])/i, /(?<!m)m²/, /\bsq ?ft\b/, /\d'/, /\d"/] },
  { name: "ft-in / sq ft", length: "ftin", area: "sqft", len: /^(\d+'-)?\d+( \d+\/\d+)?"$/, areaRe: /^\d+\.\d sq ft$/, bar: /^(\d+'-0"|\d+")$/, foreign: [/\d ?mm/, /\d ?m(?![m²a-z])/i, /m²/] },
  { name: "m / m²", length: "m", area: "m2", len: /^-?\d+\.\d\d m$/, areaRe: /^\d+\.\d m²$/, bar: /^[\d.]+ m$/, foreign: [/\d ?mm/, /mm²/, /\bsq ?ft\b/, /\d'/, /\d"/, /\d ft/] },
];

/** Plan metres → page pixels through the 2D canvas's camera attributes. */
async function toScreen(page: Page, p: Pt): Promise<Pt> {
  const c = await tid(page, "plan-canvas").evaluate((e) => ({ s: +e.getAttribute("data-scale")!, tx: +e.getAttribute("data-tx")!, ty: +e.getAttribute("data-ty")! }));
  const b = (await tid(page, "plan-canvas").boundingBox())!;
  return { x: b.x + p.x * c.s + c.tx, y: b.y + p.y * c.s + c.ty };
}
const scale = async (page: Page) => +(await tid(page, "plan-canvas").getAttribute("data-scale"))!;

/** A real touch drag with a callback while the finger is down (Chromium's touch input over CDP). */
async function touchDrag(page: Page, from: Pt, to: Pt, hold: () => Promise<void>) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: "touchStart" | "touchMove" | "touchEnd", p?: Pt) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
  await send("touchStart", from);
  for (let i = 1; i <= 6; i++) await send("touchMove", { x: from.x + ((to.x - from.x) * i) / 6, y: from.y + ((to.y - from.y) * i) / 6 });
  await hold();
  await send("touchEnd");
  await cdp.detach();
}

/** Visible text of a container plus the values of its inputs. */
const textOf = (page: Page, id: string) =>
  tid(page, id)
    .first()
    .evaluate((e) => `${(e as HTMLElement).innerText}\n${[...e.querySelectorAll("input")].map((i) => (i as HTMLInputElement).value).join("\n")}`);

async function run(width: number, height: number, touch: boolean) {
  step(`${width} units`);
  const tag = String(width);
  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, acceptDownloads: true });
  const page = await context.newPage();
  watchErrors(page, tag, errors);
  const press = (l: ReturnType<typeof tid>) => (touch ? l.tap() : l.click());
  const tap = (p: Pt) => (touch ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y));
  await page.goto(`${BASE}/studio`);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await tid(page, "plan-name").waitFor();
  assert.equal(await page.evaluate(() => window.localStorage.getItem("atrium.units")), null, `${tag}: a new user has nothing saved`);

  // ---- the layout: 2D plan with the panel (Split on a desktop; the sheet open on a phone)
  await press(tid(page, touch ? "view-2d" : "view-split"));
  await tid(page, "plan-svg").waitFor();
  await page.waitForTimeout(600);

  // ---- two takeoffs through the real Takeoff tool (a Length on the south face, an Area on Bedroom 1),
  // made first: on a phone the plan is biggest while the details sheet is closed
  const at = (x: number, y: number) => toScreen(page, { x, y });
  await press(tid(page, "tool-takeoff"));
  await tap(await at(-0.1, 8.1));
  await tap(await at(10.1, 8.1));
  if (touch) await press(tid(page, "takeoff-finish"));
  else await page.keyboard.press("Enter");
  await press(tid(page, "takeoff-mode-area"));
  for (const [x, y] of [[0.1, 0.1], [3.95, 0.1], [3.95, 3.95], [0.1, 3.95]]) await tap(await at(x, y));
  if (touch) await press(tid(page, "takeoff-finish"));
  else await tap(await at(0.1, 0.1));
  assert.equal(((await plan(page)).takeoffs ?? []).length, 2, `${tag}: a Length and an Area takeoff`);
  await press(tid(page, "tool-select"));
  if (touch) await page.getByRole("button", { name: /Plan details/ }).tap(); // the sheet holds the panels
  await page.waitForTimeout(600);

  // ---- the default is metres and m²
  assert.match(await tid(page, "total-area").innerText(), /^74\.7 m²$/, `${tag}: new users see metres and m²`);
  assert.equal(await tid(page, "units-m2").getAttribute("aria-pressed"), "true", `${tag}: the Summary's switch shows m²`);

  // ---- the Units menu is reachable and keyboard-operable
  const menu = async () => {
    if ((await tid(page, "topbar-length-mm").count()) === 0) await press(tid(page, "units-menu"));
    await tid(page, "topbar-length-mm").waitFor();
  };
  const choose = async (s: Setting) => {
    await menu();
    await press(tid(page, `topbar-length-${s.length}`));
    await press(tid(page, `topbar-area-${s.area}`));
    await page.keyboard.press("Escape");
    assert.equal(await tid(page, "topbar-length-mm").count(), 0, `${tag}: Escape closes the menu`);
    await page.waitForTimeout(150);
  };
  await menu();
  const mb = (await page.locator('[data-testid="units-menu"] + div').boundingBox())!;
  assert.ok(mb.x >= 0 && mb.x + mb.width <= width + 0.5 && mb.y >= 0 && mb.y + mb.height <= height, `${tag}: the menu sits inside the viewport (${JSON.stringify(mb)})`);
  assert.equal(await tid(page, "topbar-length-m").isChecked(), true, `${tag}: Length radio shows m`);
  assert.equal(await tid(page, "topbar-area-m2").isChecked(), true, `${tag}: Area radio shows m²`);
  if (touch) {
    const w = await page.evaluate(() => [innerWidth, document.documentElement.scrollWidth, document.body.scrollWidth]);
    assert.deepEqual(w, [390, 390, 390], `${tag}: with the menu open the page is exactly 390 px wide (${w})`);
    await page.screenshot({ path: `${OUT}/units-menu-390.png` });
  } else {
    // Keyboard: focus the checked Length radio, the arrow keys move within the group and change the setting.
    await tid(page, "topbar-length-m").focus();
    await page.keyboard.press("ArrowLeft");
    assert.equal(await tid(page, "topbar-length-mm").isChecked(), true, `${tag}: ArrowLeft in the Length group chooses mm`);
    assert.match(await tid(page, "total-area").innerText(), /m²$/, `${tag}: the area did not follow the length (independent)`);
    await page.keyboard.press("ArrowRight");
    assert.equal(await tid(page, "topbar-length-m").isChecked(), true, `${tag}: ArrowRight goes back to m`);
  }
  await page.keyboard.press("Escape");

  // ---- each setting
  const reads: string[] = [];
  for (const s of SETTINGS) {
    await choose(s);
    const none = (container: string, text: string) => {
      for (const re of s.foreign) assert.ok(!re.test(text), `${tag} ${s.name}: ${container} has text of another unit (${re}): ${JSON.stringify(text.slice(0, 300))}`);
    };
    // Summary and room list (nothing selected)
    await page.keyboard.press("Escape");
    await tid(page, "total-area").waitFor();
    assert.match((await tid(page, "total-area").innerText()).trim(), s.areaRe, `${tag} ${s.name}: the total`);
    const rows = await page.locator('[data-testid^="room-area-"]').allInnerTexts();
    assert.equal(rows.length, 4, `${tag} ${s.name}: four rooms`);
    for (const r of rows) assert.match(r.trim(), s.areaRe, `${tag} ${s.name}: room row`);
    assert.equal((await tid(page, "rooms-note").innerText()).trim(), "Rows are rounded; the total is summed from exact values.", `${tag}: the rounding note`);
    assert.equal(await tid(page, `units-${s.area}`).getAttribute("aria-pressed"), "true", `${tag} ${s.name}: the Summary's switch follows the menu`);
    await page.locator('[data-testid="summary"]').first().scrollIntoViewIfNeeded();
    none("the Summary", await textOf(page, "summary"));
    none("the room list", rows.join("\n"));
    // the 2D labels and the scale bar
    const labels = await page.locator('[data-testid="plan-room-label"] text:nth-child(2)').allTextContents();
    for (const l of labels) assert.match(l.trim(), s.areaRe, `${tag} ${s.name}: a 2D room label`);
    const bar = ((await tid(page, "plan-scalebar").textContent()) ?? "").trim();
    assert.match(bar, s.bar, `${tag} ${s.name}: scale bar "${bar}"`);

    // the wall panel: the partition's middle
    await tap(await at(2, 4));
    await tid(page, "wall-panel").waitFor();
    const wallVals = await Promise.all(["wall-length", "wall-thickness", "wall-height"].map((id) => tid(page, id).inputValue()));
    for (const v of wallVals) assert.match(v, s.len, `${tag} ${s.name}: a wall field "${v}"`);
    none("the wall panel", await textOf(page, "wall-panel"));
    // a live drag label: the b end of the partition, 0.5 m south, while it is held
    const hBefore = await history(page);
    const handle = await at(4, 4);
    const to = await at(4, 4.5);
    let label = "";
    const held = async () => {
      await tid(page, "drag-length").waitFor();
      label = ((await tid(page, "drag-length").textContent()) ?? "").trim();
    };
    if (touch) await touchDrag(page, handle, to, held);
    else {
      await page.mouse.move(handle.x, handle.y);
      await page.mouse.down();
      await page.mouse.move(handle.x, (handle.y + to.y) / 2, { steps: 3 });
      await page.mouse.move(to.x, to.y, { steps: 4 });
      await held();
      await page.mouse.up();
    }
    assert.match(label, s.len, `${tag} ${s.name}: live drag label "${label}"`);
    none("the drag label", label);
    assert.ok((await history(page)) > hBefore, `${tag} ${s.name}: the drag was real`);
    await press(tid(page, "undo"));
    assert.equal(await history(page), hBefore, `${tag} ${s.name}: undone`);
    // the opening panel: the living-room window on the north wall (clicked where its gap is)
    await tap(await at(9, 0));
    await tid(page, "opening-panel").waitFor();
    const opVals = await Promise.all(["opening-width", "opening-height", "opening-sill", "opening-offset"].map((id) => tid(page, id).inputValue()));
    for (const v of opVals) assert.match(v, s.len, `${tag} ${s.name}: an opening field "${v}"`);
    none("the opening panel", await textOf(page, "opening-panel"));
    // the takeoff table
    await tid(page, "takeoff-table").waitFor();
    const meas = await page.locator('[data-testid="takeoff-measured"]').allInnerTexts();
    assert.match(meas[0].trim(), s.length === "ftin" ? /^\d+'-\d+( \d+\/\d+)?"$/ : s.length === "mm" ? /^\d+ mm$/ : /^\d+\.\d{3} m$/, `${tag} ${s.name}: the Length row "${meas[0]}"`);
    assert.match(meas[1].trim(), s.area === "sqft" ? /^\d+\.\d{3} sq ft$/ : s.area === "mm2" ? /^[\d,]+ mm²$/ : /^\d+\.\d{3} m²$/, `${tag} ${s.name}: the Area row "${meas[1]}"`);
    none("the takeoff table", await tid(page, "takeoff-table").innerText());
    if (!touch && s.length !== "m") await page.screenshot({ path: `${OUT}/units-${s.length === "mm" ? "mm" : "ftin"}-1440.png` });
    reads.push(`${s.name}: room ${rows[0]}, wall "${wallVals[0]}", opening "${opVals[0]}", drag "${label}", bar "${bar}", takeoff "${meas[0].trim()}" / "${meas[1].trim()}"`);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  }
  console.log(`${tag}:\n  ${reads.join("\n  ")}`);

  // ---- typing: ft-in (13'6, a bare 9 = feet), mm (a bare number is mm)
  await choose(SETTINGS[1]);
  await tap(await at(2, 4));
  await tid(page, "wall-panel").waitFor();
  const h0 = await history(page);
  await tid(page, "wall-length").fill(`13'6`);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  const wHI = (p: Plan) => p.walls.find((w) => w.id === "w-HI")!;
  const lenOf = (w: { a: Pt; b: Pt }) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
  near(lenOf(wHI(await plan(page))), 4.1148, 0.005, `${tag}: 13'6 in ft-in is 4.1148 m (the wall's end lands on the 1 cm the length edit has always used: 4.11)`);
  await tid(page, "wall-height").fill("9");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  near(wHI(await plan(page)).height, 2.7432, 1e-9, `${tag}: a bare 9 in ft-in is 9 feet: 2.7432 m`);
  assert.equal(await history(page), h0 + 2, `${tag}: each is one undo step`);
  await press(tid(page, "undo"));
  await press(tid(page, "undo"));
  assert.equal(await history(page), h0, `${tag}: undone`);
  await choose(SETTINGS[0]);
  await tap(await at(2, 4));
  await tid(page, "wall-panel").waitFor();
  await tid(page, "wall-height").fill("2718.4");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  near(wHI(await plan(page)).height, 2.7184, 1e-12, `${tag}: a bare 2718.4 in mm is 2.7184 m`);
  assert.equal(await tid(page, "wall-height").inputValue(), "2718 mm", `${tag}: shown rounded`);

  // ---- focus and blur without a change: no undo step, the stored value does not drift (2.7184 is shown as 2718 mm)
  const h1 = await history(page);
  await tid(page, "wall-height").focus();
  await tid(page, "wall-thickness").focus();
  await tid(page, "wall-length").focus();
  await page.locator("body").click({ position: { x: 2, y: 2 } });
  assert.equal(await history(page), h1, `${tag}: focus and blur on three fields added no undo step`);
  await tid(page, "wall-height").focus();
  await page.keyboard.type("");
  await page.keyboard.press("Enter"); // Enter blurs: still unchanged
  assert.equal(await history(page), h1, `${tag}: Enter on an untouched field adds none`);
  await tid(page, "wall-height").fill("2718 mm"); // its own displayed text typed again
  await page.keyboard.press("Enter");
  assert.equal(await history(page), h1, `${tag}: retyping the text it shows adds none`);
  near(wHI(await plan(page)).height, 2.7184, 1e-12, `${tag}: and the stored 2.7184 m did not drift to the rounded 2.718 m`);
  await tid(page, "wall-height").fill("2.7184 m"); // the same value typed another way
  await page.keyboard.press("Enter");
  assert.equal(await history(page), h1, `${tag}: the same value typed another way adds none`);
  console.log(`${tag}: ft-in 13'6 → 4.1148 m and a bare 9 → 2.7432 m; mm bare number; focus/blur, Enter and retyping add no undo step and 2.7184 m stays 2.7184 m`);

  // ---- persistence: the choice survives a reload, and the other switches are views of it
  await choose(SETTINGS[0]);
  assert.deepEqual(JSON.parse((await page.evaluate(() => window.localStorage.getItem("atrium.units")))!), { length: "mm", area: "mm2" }, `${tag}: saved under atrium.units`);
  await page.waitForFunction(() => document.querySelector('[data-testid="save-status"]')?.getAttribute("data-state") === "saved");
  await page.reload();
  await tid(page, "plan-name").waitFor();
  if (touch) await page.getByRole("button", { name: /Plan details/ }).tap(); // a reload closes the sheet again
  assert.match((await tid(page, "total-area").innerText()).trim(), /^[\d,]+ mm²$/, `${tag}: after a reload the Summary is still in mm²`);
  await menu();
  assert.equal(await tid(page, "topbar-length-mm").isChecked(), true, `${tag}: and the menu says mm`);
  await page.keyboard.press("Escape");
  await press(tid(page, "units-sqft")); // the Summary's switch
  assert.equal((await page.evaluate(() => JSON.parse(window.localStorage.getItem("atrium.units")!))).area, "sqft", `${tag}: the Summary's switch writes the same setting`);
  await menu();
  assert.equal(await tid(page, "topbar-area-sqft").isChecked(), true, `${tag}: and the menu follows it`);
  await page.keyboard.press("Escape");
  if (!(await tid(page, "takeoff-unit-m").count())) await press(tid(page, "takeoff-toggle"));
  await press(tid(page, "takeoff-unit-ftin")); // the Takeoff switch
  await menu();
  assert.equal(await tid(page, "topbar-length-ftin").isChecked(), true, `${tag}: the takeoff switch is the same setting too`);
  await page.keyboard.press("Escape");
  report.push(`${tag}: ${SETTINGS.map((s) => s.name).join(", ")}; typing, focus/blur, persistence and the three switches checked${touch ? "; menu inside the viewport, page exactly 390 px wide" : ""}`);
  await browser.close();
}

async function main() {
  await warmRoutes(["/studio"]);
  mkdirSync(OUT, { recursive: true });
  assert.equal(samplePlan.rooms.length, 4);
  await run(1440, 900, false);
  await run(390, 844, true);
  assert.deepEqual(errors, [], `console errors:\n${errors.join("\n")}`);
  console.log("\n" + report.join("\n"));
  console.log("OK");
}

withSuiteTimeout("e2e-units", 15 * 60_000, main).catch((e) => {
  console.error(e);
  process.exit(1);
});
