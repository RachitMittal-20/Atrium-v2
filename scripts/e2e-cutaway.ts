/**
 * e2e-cutaway.ts — step V.2 in a real browser, at 1440 (mouse) and 390 (touch). Needs `npm run dev`
 * (E2E_URL overrides): it reads the dev-only hooks (__scene3d.cut(), __studio3d.project, __planStore,
 * __selectionStore, __pushPullDebug, __importDebug). Not in npm test.
 *   1. Build plan-chatgpt-flat.pdf on the import screen and open it: Cutaway and Room names are ON by
 *      default (a plan built from an import), the walls carry the 1.2 m cut, a section cap per wall.
 *   2. Room names: one label per room at its label point, inside the pane, at least 10 px text, and never
 *      the element under the pointer (pointer-events none: they cover no hit area).
 *   3. Pixels: oak-floor pixels inside the projected footprint (the hull of the walls' box from the floor
 *      to the tallest wall), Cutaway on against off, with the label plates hidden for the measuring shot only. Thresholds: on at least FLOOR_RATIO_MIN times off, and at
 *      least FLOOR_SHARE_MIN of the hull. Measured before they were set (printed every run): 1440 on 28.0%, off 7.1%
 *      (3.9x); 390 on 27.0%, off 5.8% (4.6x).
 *   4. Picking honours the cut: a click on a wall's clipped-away part (2 m up) never selects that wall,
 *      and a click on its cut section (its centre line at 1.2 m) does. With Cutaway off the 2 m click selects it.
 *   5. Toggling off restores full walls (no cut, no caps, no labels); Top keeps the cut; Walk is always full
 *      height and shows no labels; Push/Pull on a wall's top works with Cutaway on (full height while the tool
 *      is on, the status line says so, one undo step).
 *   6. A tap (390) or click (1440) on an imported model selects it with Cutaway on.
 *   7. The plan in storage is byte-identical before and after toggling (and the save status never moved).
 * Screenshots in /tmp/studio: cutaway-on-1440.png, cutaway-off-1440.png, cutaway-390.png.
 * Run: npx tsx scripts/e2e-cutaway.ts  (E2E_WIDTH=390 runs one size)
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Locator, type Page } from "playwright";
import sharp from "sharp";
import { BASE, afterFrames, step, waitForHook, waitForScene3d, waitUntil, warmRoutes, watchErrors, withSuiteTimeout } from "./e2e-helpers";
import type { Plan } from "../src/types/plan";

const OUT = "/tmp/studio";
const PDF = join(process.cwd(), "tests/fixtures/pdf/plan-chatgpt-flat.pdf");
const CUBE = join(process.cwd(), "tests/fixtures/models/cube.glb");
const EXECUTABLE = process.env.E2E_CHROMIUM || undefined;
const LONG = 120_000;
const STORAGE_KEY = "atrium-v2:plan";
const CUT = 1.2;
const FLOOR_RATIO_MIN = 2; // on / off, oak pixels in the footprint hull
const FLOOR_SHARE_MIN = 0.2; // of the hull's pixels, with Cutaway on

type Pt = { x: number; y: number };
const errors: string[] = [];
const tid = (page: Page, id: string) => page.getByTestId(id);
const cutNow = (page: Page) => page.evaluate("window.__scene3d.cut()") as Promise<{ y: number | null | "mixed"; walls: number; caps: number }>;
const planNow = (page: Page) => page.evaluate("window.__planStore.getState().plan") as Promise<Plan>;
const past = (page: Page) => page.evaluate("window.__planStore.getState().past.length") as Promise<number>;
const project = (page: Page, p: { x: number; y: number; z: number }) => page.evaluate((q) => (window as unknown as { __studio3d: { project(p: unknown): Pt } }).__studio3d.project(q), p);

/** The footprint hull on the page: the walls' box from the floor to the tallest wall, projected. A string: no named inner function may reach the page. */
const HULL = `(() => {
  const plan = window.__planStore.getState().plan;
  const proj = window.__studio3d.project;
  const xs = plan.walls.flatMap((w) => [w.a.x, w.b.x]); const zs = plan.walls.flatMap((w) => [w.a.y, w.b.y]);
  const h = Math.max(0, ...plan.walls.map((w) => w.height));
  const pts = [];
  for (const x of [Math.min(...xs), Math.max(...xs)]) for (const z of [Math.min(...zs), Math.max(...zs)]) for (const y of [0, h]) pts.push(proj({ x, y, z }));
  pts.sort((a, b) => a.x - b.x || a.y - b.y);
  const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = []; for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  const up = []; for (const p of pts.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
})()`;
const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
const inHull = (hull: Pt[], p: Pt) => hull.every((h, i) => cross(h, hull[(i + 1) % hull.length], p) >= 0);
/** Oak floor (#b98e5a, red − blue 95), lit or in shadow. Not: walls, ground, section caps, frames, door leaves (#7d6446,
 *  55) or the hover tint (#e4d3b0, 52). */
const oak = (r: number, g: number, b: number) => r - b > 60 && r > 70 && g > b;

/** Oak pixels inside the footprint hull, and the hull's pixel count, from a screenshot of the 3D pane. */
async function floorPixels(page: Page, shot?: string) {
  const pane = (await tid(page, "scene-3d").boundingBox())!;
  const hull = (await page.evaluate(HULL)) as Pt[];
  if (!(await page.evaluate("matchMedia('(any-pointer: coarse)').matches"))) {
    // off the model: a hovered wall is tinted. Through the middle of the pane first: after the picking step's click a
    // hover was seen to outlive one move off the canvas (not diagnosed; the next pass over the canvas clears it).
    await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
    await page.mouse.move(pane.x + pane.width - 4, pane.y + pane.height - 4);
    await waitUntil(page, "a wall stayed hovered", "window.__selectionStore.getState().hoveredId === null");
    await afterFrames(page, 2);
  }
  if (shot) await page.screenshot({ path: shot, clip: pane }); // the picture as the user sees it, labels included
  // the measure is of the floors themselves: the label plates (TEST SETUP: hidden for this one screenshot) cover a large
  // share of a small model at 390 and would count against Cutaway
  await page.evaluate("document.querySelector('[data-testid=room-labels-3d]')?.style.setProperty('display', 'none')");
  const png = await page.screenshot({ clip: pane });
  await page.evaluate("document.querySelector('[data-testid=room-labels-3d]')?.style.removeProperty('display')");
  const dpr = (await page.evaluate("window.devicePixelRatio")) as number;
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let inside = 0;
  let floor = 0;
  for (let y = 0; y < info.height; y += 2)
    for (let x = 0; x < info.width; x += 2) {
      if (!inHull(hull, { x: pane.x + x / dpr, y: pane.y + y / dpr })) continue;
      inside++;
      const i = (y * info.width + x) * info.channels;
      if (oak(data[i], data[i + 1], data[i + 2])) floor++;
    }
  return { inside, floor, share: floor / Math.max(1, inside) };
}

async function run(width: number, height: number) {
  const touch = width < 640;
  const tag = String(width);
  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: touch });
  watchErrors(page, tag, errors);
  const press = async (l: Locator) => (touch ? l.tap() : l.click());
  const at = async (p: Pt) => (touch ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y));
  const drag = async (from: Pt, to: Pt) => {
    if (!touch) {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
      await page.mouse.up();
      return;
    }
    const cdp = await page.context().newCDPSession(page);
    const send = (type: "touchStart" | "touchMove" | "touchEnd", p?: Pt) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
    await send("touchStart", from);
    for (let i = 1; i <= 8; i++) await send("touchMove", { x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8 });
    await send("touchEnd");
    await cdp.detach();
  };
  /** The View menu's toggle, opened and closed again so the popover never covers the pane. */
  const toggle = async (id: "view-cutaway" | "view-room-names") => {
    await press(tid(page, "view-options"));
    const was = await tid(page, id).getAttribute("aria-pressed");
    await press(tid(page, id));
    assert.equal(await tid(page, id).getAttribute("aria-pressed"), was === "true" ? "false" : "true", `${tag}: ${id} toggles (aria-pressed)`);
    await page.keyboard.press("Escape");
    await tid(page, id).waitFor({ state: "detached" });
  };
  const pressedIn = async (id: string) => {
    await press(tid(page, "view-options"));
    const v = await tid(page, id).getAttribute("aria-pressed");
    await page.keyboard.press("Escape");
    await tid(page, id).waitFor({ state: "detached" });
    return v;
  };

  // ---- 1. build the PDF and open it
  step(`${tag}: build plan-chatgpt-flat.pdf`);
  await page.goto(`${BASE}/studio/import`);
  await tid(page, "file-input").setInputFiles(PDF);
  await page.waitForSelector("[data-testid=results], [data-testid=error]", { timeout: LONG });
  assert.equal(await tid(page, "error").count(), 0, `${tag}: the PDF reads`);
  await press(tid(page, "scale-found").getByRole("button", { name: /^(Use this scale|Confirm this scale)$/ }));
  await press(page.getByRole("button", { name: "Build model" }));
  await tid(page, "summary").waitFor({ timeout: LONG });
  await press(page.getByRole("button", { name: "Open in studio" }));
  await page.waitForURL(/\/studio$/);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }); // the dev badge swallows phone taps
  await waitForHook(page, "__planStore", "the studio had just opened");
  await waitForScene3d(page, "the studio had just opened on the imported plan");
  const plan = await planNow(page);
  assert.equal(plan.walls.length, 16, `${tag}: the 16 walls of plan-chatgpt-flat`);
  const rooms = plan.rooms.length;

  step(`${tag}: defaults`);
  assert.equal(await pressedIn("view-cutaway"), "true", `${tag}: Cutaway is on by default for an imported plan`);
  assert.equal(await pressedIn("view-room-names"), "true", `${tag}: Room names follow it`);
  await waitUntil(page, `${tag}: the walls never carried the cut`, `window.__scene3d.cut().y === ${CUT}`);
  const c0 = await cutNow(page);
  assert.deepEqual(c0, { y: CUT, walls: 16, caps: 16 }, `${tag}: every wall cut, one section cap each`);
  const stored0 = (await page.evaluate(`localStorage.getItem("${STORAGE_KEY}")`)) as string;
  assert.ok(stored0 && stored0.includes('"walls"'), `${tag}: the plan is in storage`);
  assert.ok(!stored0.includes("cutaway") && !stored0.includes("roomNames"), `${tag}: the stored plan never mentions the view setting`);

  // ---- 2. room names
  step(`${tag}: room names`);
  await waitUntil(page, `${tag}: no room labels`, `document.querySelectorAll('[data-testid=room-label-3d]').length === ${rooms}`);
  const pane = (await tid(page, "scene-3d").boundingBox())!;
  const labels = (await page.evaluate(`[...document.querySelectorAll('[data-testid=room-label-3d]')].map((e) => { const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { text: e.innerText, x: r.x, y: r.y, w: r.width, h: r.height, font: parseFloat(getComputedStyle(e.firstElementChild).fontSize), top: top ? (top.closest('[data-testid=room-label-3d]') ? 'label' : top.tagName) : null }; })`)) as { text: string; x: number; y: number; w: number; h: number; font: number; top: string | null }[];
  for (const l of labels) {
    assert.ok(l.x >= pane.x && l.y >= pane.y && l.x + l.w <= pane.x + pane.width && l.y + l.h <= pane.y + pane.height, `${tag}: label "${l.text}" inside the pane`);
    assert.ok(l.font >= 10, `${tag}: label "${l.text}" readable (${l.font} px)`);
    assert.notEqual(l.top, "label", `${tag}: label "${l.text}" takes no pointer events (the element under it is ${l.top})`);
    assert.match(l.text, /m²/, `${tag}: label "${l.text}" has the area in the units setting`);
  }
  for (const r of plan.rooms) assert.ok(labels.some((l) => l.text.startsWith(r.name)), `${tag}: a label names ${r.name}`);
  console.log(`${tag}: ${labels.length} labels: ${labels.map((l) => `${l.text.replace(/\n/g, " ")} @${l.x.toFixed(0)},${l.y.toFixed(0)}`).join("; ")}`);

  // ---- 3. pixels, on
  step(`${tag}: floor pixels`);
  await afterFrames(page, 4);
  const on = await floorPixels(page, touch ? `${OUT}/cutaway-390.png` : `${OUT}/cutaway-on-1440.png`);

  // ---- 4. picking honours the cut: the wall nearest the camera's side, with no opening
  step(`${tag}: picking`);
  const bare = plan.walls.filter((w) => !plan.openings.some((o) => o.wallId === w.id));
  const wall = bare.sort((p, q) => Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y) - Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y))[0];
  const mid = { x: (wall.a.x + wall.b.x) / 2, z: (wall.a.y + wall.b.y) / 2 };
  const high = await project(page, { x: mid.x, y: 2, z: mid.z });
  const section = await project(page, { x: mid.x, y: CUT, z: mid.z });
  await page.evaluate("window.__selectionStore.getState().select(null)"); // TEST SETUP: start unselected
  await at(high);
  await afterFrames(page, 2);
  const highPick = (await page.evaluate("window.__selectionStore.getState().selectedId")) as string | null;
  assert.notEqual(highPick, wall.id, `${tag}: a ${touch ? "tap" : "click"} 2 m up ${wall.id}, cut away, does not select it`);
  await at(section);
  await waitUntil(page, `${tag}: a ${touch ? "tap" : "click"} on ${wall.id}'s cut section did not select it`, `window.__selectionStore.getState().selectedId === '${wall.id}'`);
  await page.evaluate("window.__selectionStore.getState().select(null)");

  // ---- 5a. off: full walls, no labels, fewer floor pixels, the 2 m click selects the wall again
  step(`${tag}: Cutaway off`);
  await toggle("view-cutaway");
  await waitUntil(page, `${tag}: the cut did not go`, "window.__scene3d.cut().y === null");
  assert.deepEqual(await cutNow(page), { y: null, walls: 16, caps: 0 }, `${tag}: full walls, no caps`);
  await waitUntil(page, `${tag}: labels stayed with Cutaway off`, "document.querySelectorAll('[data-testid=room-label-3d]').length === 0");
  await afterFrames(page, 4);
  const off = await floorPixels(page, touch ? undefined : `${OUT}/cutaway-off-1440.png`);
  console.log(`${tag}: oak pixels in the footprint hull (every 2nd device px): on ${on.floor} of ${on.inside} (${(on.share * 100).toFixed(1)}%), off ${off.floor} of ${off.inside} (${(off.share * 100).toFixed(1)}%), ratio ${(on.floor / Math.max(1, off.floor)).toFixed(2)}`);
  assert.ok(on.floor >= FLOOR_RATIO_MIN * off.floor, `${tag}: Cutaway shows at least ${FLOOR_RATIO_MIN}x the floor (${on.floor} vs ${off.floor})`);
  assert.ok(on.share >= FLOOR_SHARE_MIN, `${tag}: with Cutaway at least ${FLOOR_SHARE_MIN * 100}% of the footprint is floor (${(on.share * 100).toFixed(1)}%)`);
  await at(high);
  await waitUntil(page, `${tag}: with Cutaway off, a ${touch ? "tap" : "click"} 2 m up ${wall.id} did not select it`, `window.__selectionStore.getState().selectedId === '${wall.id}'`);
  await page.evaluate("window.__selectionStore.getState().select(null)");
  await toggle("view-cutaway");
  await waitUntil(page, `${tag}: the cut did not come back`, `window.__scene3d.cut().y === ${CUT}`);

  // ---- 5b. Top keeps the cut and the labels
  step(`${tag}: Top`);
  await press(tid(page, "camera-top"));
  await waitUntil(page, `${tag}: Top not pressed`, "document.querySelector('[data-testid=camera-top]').getAttribute('aria-pressed') === 'true'");
  assert.equal((await cutNow(page)).y, CUT, `${tag}: Top keeps the cut`);
  assert.equal(await tid(page, "room-label-3d").count(), rooms, `${tag}: and the labels`);
  await press(tid(page, "camera-orbit"));

  // ---- 5c. Walk: full height, no labels; the cut back on exit
  step(`${tag}: Walk`);
  await press(tid(page, "camera-walk"));
  await waitUntil(page, `${tag}: walking kept the cut`, "window.__scene3d.cut().y === null");
  assert.equal(await tid(page, "room-label-3d").count(), 0, `${tag}: no labels in Walk`);
  await press(tid(page, "walk-exit"));
  await waitUntil(page, `${tag}: the cut did not come back after the walk`, `window.__scene3d.cut().y === ${CUT}`);

  // ---- 5d. Push/Pull a wall's top with Cutaway on
  step(`${tag}: Push/Pull`);
  await press(tid(page, "tool-pushpull"));
  await waitUntil(page, `${tag}: Push/Pull kept the cut`, "window.__scene3d.cut().y === null");
  assert.match(await tid(page, "pushpull-status").innerText(), /Cutaway is paused: walls show full height while this tool is on\./, `${tag}: the status line says the cut is paused`);
  const top = await project(page, { x: mid.x, y: wall.height, z: mid.z });
  const past0 = await past(page);
  if (!touch) {
    await page.mouse.move(top.x, top.y);
    await waitUntil(page, `${tag}: Push/Pull did not hover ${wall.id}'s top`, `(() => { const h = window.__pushPullDebug.hover; return !!h && h.wallId === '${wall.id}' && h.role === 'top'; })()`);
  }
  await drag(top, { x: top.x, y: top.y - 60 });
  const pulled = (await planNow(page)).walls.find((w) => w.id === wall.id)!;
  assert.ok(Math.abs(pulled.height - wall.height) >= 0.05, `${tag}: Push/Pull changed ${wall.id}'s height (${wall.height} → ${pulled.height})`);
  assert.equal(await past(page), past0 + 1, `${tag}: one undo step`);
  await press(tid(page, "undo"));
  await waitUntil(page, `${tag}: undo did not put the height back`, `window.__planStore.getState().plan.walls.find((w) => w.id === '${wall.id}').height === ${wall.height}`);
  await press(tid(page, "tool-select"));
  await waitUntil(page, `${tag}: the cut did not come back with Select`, `window.__scene3d.cut().y === ${CUT}`);

  // ---- 7 (before the model import changes the plan). Storage is byte-identical across toggles; the save never ran.
  step(`${tag}: storage`);
  await waitUntil(page, `${tag}: the undo was never saved`, `document.querySelector('[data-testid=save-status]').getAttribute('data-state') !== 'pending'`, 10_000);
  const stored1 = (await page.evaluate(`localStorage.getItem("${STORAGE_KEY}")`)) as string;
  for (const id of ["view-cutaway", "view-room-names", "view-cutaway", "view-room-names"] as const) await toggle(id);
  await page.waitForTimeout(1500); // proving the 800 ms autosave debounce does NOT fire (CLAUDE.md F.1 allows this wait)
  const stored2 = (await page.evaluate(`localStorage.getItem("${STORAGE_KEY}")`)) as string;
  assert.equal(stored2, stored1, `${tag}: the stored plan is byte-identical after toggling Cutaway and Room names`);
  assert.equal(JSON.parse(stored2).plan.walls.length, 16);

  // ---- 6. an imported model is still selected by a tap or click
  step(`${tag}: model`);
  await tid(page, "import-model-input").setInputFiles(CUBE);
  await page.waitForSelector('[data-testid="import-dialog"][data-kind="review"]', { timeout: 15000 });
  await press(tid(page, "import-confirm"));
  await page.waitForSelector('[data-testid="import-dialog"][data-kind="closed"]', { state: "attached", timeout: 15000 });
  await waitUntil(page, `${tag}: the model never arrived`, "window.__planStore.getState().plan.items.length === 1");
  const cube = (await planNow(page)).items[0];
  await waitUntil(page, `${tag}: the model never drew`, `!!window.__importDebug.worldBox('${cube.id}')`);
  await waitUntil(page, `${tag}: the camera kept gliding to the model`, "!window.__importDebug.camera().gliding"); // Show in view runs once after an import if the model is not in view
  await afterFrames(page, 2);
  const box = (await page.evaluate(`window.__importDebug.worldBox('${cube.id}')`)) as { min: number[]; max: number[] };
  const cubeTop = await project(page, { x: (box.min[0] + box.max[0]) / 2, y: box.max[1], z: (box.min[2] + box.max[2]) / 2 });
  assert.equal((await cutNow(page)).y, CUT, `${tag}: the cut is on while the model is tapped`);
  await page.evaluate("window.__selectionStore.getState().select(null)"); // TEST SETUP: start unselected
  await at(cubeTop);
  await waitUntil(page, `${tag}: a ${touch ? "tap" : "click"} on the model with Cutaway on did not select it`, `window.__selectionStore.getState().itemId === '${cube.id}'`);
  console.log(`${tag}: ok (picked ${wall.id}: 2 m up gave ${highPick ?? "nothing"}; model at ${cubeTop.x.toFixed(0)},${cubeTop.y.toFixed(0)})`);
  await browser.close();
}

withSuiteTimeout("e2e-cutaway", 15 * 60_000, async () => {
  mkdirSync(OUT, { recursive: true });
  await warmRoutes(["/studio", "/studio/import"]);
  for (const [w, h] of [
    [1440, 900],
    [390, 844],
  ]) {
    if (process.env.E2E_WIDTH && process.env.E2E_WIDTH !== String(w)) continue;
    await run(w, h);
  }
  assert.deepEqual(errors, [], `console errors:\n${errors.join("\n")}`);
  console.log("e2e-cutaway: ok; screenshots in", OUT);
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
