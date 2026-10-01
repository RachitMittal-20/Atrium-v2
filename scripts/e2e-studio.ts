/**
 * e2e-studio.ts — browser test of the editor shell, src/app/studio/page.tsx,
 * with Playwright's Chromium. Not in npm test. Needs the dev server (npm run
 * dev; E2E_URL overrides http://localhost:3000): it reads window.__planStore.
 *
 * At 1440×900 and 390×844: load /studio; switch 3D, 2D and Split (Split is
 * hidden at 390); in 2D check the SVG plan (see check2d: walls, labels, Fit
 * margin, wheel zoom about the cursor, drag, keyboard, orientation, and the
 * live link to the store through window.__planStore; pinch zoom is NOT covered
 * here, it needs real touch input); then checkSelect: select a wall in 2D and
 * check the selection reaches the 3D scene, drag an end handle 1 m and check
 * every wall joined there moves, the room areas change, the 3D picture changes
 * and one Ctrl+Z puts it all back; drag a wall body; type a length in the panel
 * and compare it with the same drag; cancel a drag with Escape; delete a wall
 * and undo; select a wall by clicking it in the 3D scene. The 390 run does the
 * same with real touch events (Chromium's own touch input, through CDP).
 * Then checkRuns: the two facade cases from the wall-run step — the left half of
 * the north wall dragged 1 m north, and the lower piece of the east wall dragged
 * 0.8 m east. Each one selects the piece, checks the WHOLE straight wall is
 * highlighted in 2D, drags the body, checks every piece of it is still straight
 * in the store, and puts it back with one Ctrl+Z. Mid-drag screenshots too.
 * Then rename a room and check the store; Undo button brings the old
 * name back, Redo button reapplies, Ctrl+Z / Ctrl+Shift+Z do the same from the
 * keyboard; rename the plan; toggle units and check the total area changes by
 * 10.7639; no console errors; no horizontal scroll; nothing visible sticks out
 * past the viewport; then follow the "Import plan" link.
 * Screenshots go to /tmp/studio/.
 *
 * NOT covered: pinch zoom; whether the gilt tint is really painted on the 3D
 * walls (the test reads the selection the 3D material is derived from, and
 * checks the 3D pane's picture changes on an edit and again on the undo, but
 * does not sample pixel colours, and does not compare the pictures for
 * equality: WebGL antialiasing is not byte-identical twice over); Alt-to-unsnap; the arrow-key nudge and its 400 ms undo merge, which
 * scripts/test-edit.ts covers on the pure functions instead.
 * Run: npx tsx scripts/e2e-studio.ts
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright";

const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const OUT = "/tmp/studio";

type Rect = { x: number; y: number; width: number; height: number };
type Pt = { x: number; y: number };
type Wall = { id: string; a: Pt; b: Pt; thickness: number; height: number };
type Store = {
  getState(): {
    plan: { name: string; rooms: { id: string; name: string }[]; walls: Wall[] };
    past: unknown[];
    renameRoom(id: string, name: string): void;
    moveWallEndpoint(wallId: string, end: "a" | "b", to: Pt): void;
    undo(): void;
  };
};
type Selection = { getState(): { selectedId: string | null; select(id: string | null): void } };
type Win = Window & { __planStore?: Store; __selectionStore?: Selection };
const plan = (page: Page) => page.evaluate(() => (window as Win).__planStore!.getState().plan);
const selectedId = (page: Page) => page.evaluate(() => (window as Win).__selectionStore!.getState().selectedId);
const num = async (page: Page, id: string) => parseFloat((await page.getByTestId(id).innerText()).replace(/[^\d.]/g, ""));
const tid = (page: Page, id: string) => page.getByTestId(id);

const errors: string[] = [];

// ---- 2D plan helpers
const box = async (page: Page, testId: string): Promise<Rect> => (await tid(page, testId).boundingBox())!;
/** Union of every wall polygon's on-screen box = the drawn plan. */
const planBox = (page: Page): Promise<Rect> =>
  page.evaluate(() => {
    const rs = [...document.querySelectorAll('[data-testid="plan-wall"]')].map((e) => e.getBoundingClientRect());
    const x0 = Math.min(...rs.map((r) => r.left));
    const y0 = Math.min(...rs.map((r) => r.top));
    return { x: x0, y: y0, width: Math.max(...rs.map((r) => r.right)) - x0, height: Math.max(...rs.map((r) => r.bottom)) - y0 };
  });
const firstWall = (page: Page): Promise<Rect> => page.evaluate(() => document.querySelector('[data-testid="plan-wall"]')!.getBoundingClientRect().toJSON());
const wallPoints = (page: Page) => page.evaluate(() => [...document.querySelectorAll('[data-testid="plan-wall"]')].map((e) => e.getAttribute("points")).join("|"));
const labels = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="plan-room-label"]')].map((e) => {
      const r = e.getBoundingClientRect();
      const [name, area] = [...e.querySelectorAll("text")].map((t) => t.textContent ?? "");
      return { name, area, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    }),
  );
const cam = async (page: Page) => {
  const a = await tid(page, "plan-canvas").evaluate((e) => ({ scale: +e.getAttribute("data-scale")!, tx: +e.getAttribute("data-tx")!, ty: +e.getAttribute("data-ty")! }));
  return a;
};
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const near = (a: number, b: number, eps: number, msg: string) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

/**
 * The 2D view at the current viewport. Leaves the page in 2D, panel closed.
 * `shot` is the screenshot path, taken right after the Fit checks.
 */
async function check2d(page: Page, tag: string, wide: boolean, shot: string) {
  await tid(page, "view-2d").click();
  await tid(page, "plan-svg").waitFor();
  assert.equal(await page.locator("canvas").count(), 0, `${tag}: 2D has no 3D canvas`);
  await page.waitForTimeout(300);
  const state = (await plan(page)) as ReturnType<Store["getState"]>["plan"];

  // one wall shape per wall, 4 room labels with names and areas
  assert.equal(await tid(page, "plan-wall").count(), state.walls.length, `${tag}: one wall shape per wall`);
  const ls = await labels(page);
  assert.equal(ls.length, 4, `${tag}: 4 room labels`);
  for (const r of state.rooms) assert.ok(ls.some((l) => l.name === r.name && /^\d+\.\d m²$/.test(l.area)), `${tag}: label for ${r.name} with an area`);
  assert.ok((await tid(page, "plan-door").count()) > 0 && (await tid(page, "plan-window").count()) > 0, `${tag}: door and window symbols drawn`);

  // Fit: the plan sits inside the canvas with the margin; overlays stay clear of it
  const canvas = await box(page, "plan-canvas");
  const fitted = await planBox(page);
  for (const [side, gap, dim] of [
    ["left", fitted.x - canvas.x, canvas.width],
    ["right", canvas.x + canvas.width - (fitted.x + fitted.width), canvas.width],
    ["top", fitted.y - canvas.y, canvas.height],
    ["bottom", canvas.y + canvas.height - (fitted.y + fitted.height), canvas.height],
  ] as const) assert.ok(gap >= 0.1 * dim - 1.5, `${tag}: ${side} margin ${gap.toFixed(1)} px is under 10% of ${dim}`);
  for (const id of ["plan-fit", "plan-zoom-in", "plan-zoom-out", "plan-scalebar"]) assert.equal(overlaps(await box(page, id), fitted), false, `${tag}: ${id} overlaps the plan`);
  const fitCam = await cam(page);
  await page.screenshot({ path: shot });

  // orientation: bedrooms left, bathroom bottom right (3D looks the same way)
  const [cxMid, cyMid] = [fitted.x + fitted.width / 2, fitted.y + fitted.height / 2];
  const at = (name: string) => ls.find((l) => l.name === name)!;
  assert.ok(at("Bedroom 1").cx < cxMid && at("Bedroom 2").cx < cxMid, `${tag}: bedrooms at the left`);
  assert.ok(at("Bathroom").cx > cxMid && at("Bathroom").cy > cyMid, `${tag}: bathroom at the bottom right`);

  // wheel zoom about a wall corner: that corner must not move
  const corner = await firstWall(page);
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(100);
  const zoomed = await firstWall(page);
  assert.ok((await cam(page)).scale > fitCam.scale * 1.3, `${tag}: wheel up zoomed in`);
  near(zoomed.x, corner.x, 1, `${tag}: point under the cursor, x`);
  near(zoomed.y, corner.y, 1, `${tag}: point under the cursor, y`);

  // drag pans by the drag distance
  const before = await firstWall(page);
  const [sx, sy] = [canvas.x + 24, canvas.y + canvas.height / 2];
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 30, sy + 20, { steps: 4 });
  await page.mouse.move(sx + 60, sy + 40, { steps: 4 });
  await page.mouse.up();
  const dragged = await firstWall(page);
  near(dragged.x - before.x, 60, 1, `${tag}: drag moved the plan right`);
  near(dragged.y - before.y, 40, 1, `${tag}: drag moved the plan down`);

  // Fit restores
  await tid(page, "plan-fit").click();
  const back = await cam(page);
  near(back.scale, fitCam.scale, 0.001, `${tag}: Fit restores the scale`);
  near(back.tx, fitCam.tx, 0.01, `${tag}: Fit restores tx`);
  near(back.ty, fitCam.ty, 0.01, `${tag}: Fit restores ty`);

  // keyboard, with the canvas focused: + zooms, an arrow pans, 0 fits
  await tid(page, "plan-canvas").focus();
  await page.keyboard.press("+");
  assert.ok((await cam(page)).scale > fitCam.scale, `${tag}: + zooms in`);
  await page.keyboard.press("ArrowRight");
  assert.ok((await cam(page)).tx < fitCam.tx * 1.25 - 10, `${tag}: ArrowRight moved the view`);
  await page.keyboard.press("0");
  near((await cam(page)).scale, fitCam.scale, 0.001, `${tag}: 0 fits`);

  // live link to the store: the panel reads the same plan
  if (!wide) await page.getByRole("button", { name: /Plan details/ }).click();
  // Calls a store action by name inside the page (the dev hook exposes the store).
  const call = (method: string, ...args: unknown[]) =>
    page.evaluate(([m, a]) => (((window as Win).__planStore!.getState() as unknown as Record<string, (...x: unknown[]) => void>)[m as string])(...(a as unknown[])), [method, args] as const);
  const areas = () => page.locator('[data-testid^="room-area-"]').allInnerTexts();
  const room = state.rooms[0];

  await call("renameRoom", room.id, "Study");
  assert.ok((await labels(page)).some((l) => l.name === "Study") && !(await labels(page)).some((l) => l.name === room.name), `${tag}: 2D label shows the new name`);
  await call("undo");
  assert.ok((await labels(page)).some((l) => l.name === room.name) && !(await labels(page)).some((l) => l.name === "Study"), `${tag}: undo reverts the 2D label`);

  const [pts0, areas0, labels0] = [await wallPoints(page), await areas(), (await labels(page)).map((l) => l.area).join()];
  await call("moveWallEndpoint", "w-BI", "b", { x: 4, y: 4.6 }); // joint I, 0.6 m south
  assert.notEqual(await wallPoints(page), pts0, `${tag}: 2D walls changed after moving a joint`);
  assert.notDeepEqual(await areas(), areas0, `${tag}: panel areas changed`);
  assert.notEqual((await labels(page)).map((l) => l.area).join(), labels0, `${tag}: 2D label areas changed`);
  await call("undo");
  assert.equal(await wallPoints(page), pts0, `${tag}: undo restores the 2D walls`);
  assert.deepEqual(await areas(), areas0, `${tag}: undo restores the panel areas`);
  if (!wide) await page.getByRole("button", { name: /Plan details/ }).click(); // close the sheet again
  console.log(`${tag}: 2D ok (${state.walls.length} walls, ${ls.length} labels, scale ${fitCam.scale.toFixed(1)} px/m)`);
}

// ---- selecting and editing walls (step 4.3)

/** Plan metres → page pixels, through the 2D canvas's own camera attributes. */
async function toScreen(page: Page, p: Pt): Promise<Pt> {
  const c = await cam(page);
  const b = await box(page, "plan-canvas");
  return { x: b.x + p.x * c.scale + c.tx, y: b.y + p.y * c.scale + c.ty };
}
const mid = (w: Wall): Pt => ({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 });
const wallOf = async (page: Page, id: string) => (await plan(page)).walls.find((w) => w.id === id)!;

/** A real touch drag: Chromium's own touch input, dispatched through CDP. */
async function touchDrag(page: Page, from: Pt, to: Pt, hold?: () => Promise<void>) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: "touchStart" | "touchMove" | "touchEnd", p?: Pt) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
  await send("touchStart", from);
  for (let i = 1; i <= 6; i++) await send("touchMove", { x: from.x + ((to.x - from.x) * i) / 6, y: from.y + ((to.y - from.y) * i) / 6 });
  if (hold) await hold();
  await send("touchEnd");
  await cdp.detach();
}

/**
 * Select a wall and edit it. Runs in Split on a wide screen, so the 3D scene
 * stays mounted and its picture can be compared before and after an edit; on a
 * phone the 3D check switches views instead. `touch` sends real touch events.
 */
async function checkSelect(page: Page, tag: string, wide: boolean, touch: boolean) {
  if (wide) {
    await tid(page, "view-split").click();
    await page.waitForSelector("canvas");
    await tid(page, "plan-svg").waitFor();
    await page.waitForTimeout(600);
  }
  if (!wide) {
    await page.getByRole("button", { name: /Plan details/ }).click(); // the phone sheet holds the panel
    await page.waitForTimeout(400); // opening it shrinks the canvas, which refits the plan
  }
  const areas = () => page.locator('[data-testid^="room-area-"]').allInnerTexts();
  const pane3d = async () => (wide ? (await tid(page, "pane-3d").screenshot()).toString("base64") : "");
  const tap = async (p: Pt) => (touch ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y));

  // ---- select the interior wall H(0,4)–I(4,4) by clicking its middle
  const target = await wallOf(page, "w-HI");
  await tap(await toScreen(page, mid(target)));
  assert.equal(await selectedId(page), "w-HI", `${tag}: clicking a wall selects it`);
  assert.equal(await tid(page, "plan-canvas").getAttribute("data-selected"), "w-HI", `${tag}: the 2D plan knows it`);
  assert.equal(await tid(page, "plan-selection").count(), 1, `${tag}: a gilt outline is drawn`);
  assert.equal(await tid(page, "wall-handle").count(), 2, `${tag}: a handle at each end`);
  // The 3D walls take their tint from this same selection store, so both views agree.
  await tid(page, "wall-panel").waitFor();
  assert.equal(await tid(page, "summary").count(), 0, `${tag}: the wall panel replaced the summary`);
  assert.match(await tid(page, "wall-length").inputValue(), /^4\.00 m$/, `${tag}: the panel shows the wall's length`);
  assert.equal(await tid(page, "wall-rooms").innerText(), "Bedroom 1, Bedroom 2", `${tag}: and the rooms it bounds`);
  await page.screenshot({ path: `${OUT}/studio-${tag}-wall-panel.png` });

  // ---- drag the b handle (joint I) 1 m south: every wall joined there follows
  const before = await plan(page);
  const areas0 = await areas();
  const pic0 = await pane3d();
  const handle = await toScreen(page, target.b);
  const handleTo = await toScreen(page, { x: target.b.x, y: target.b.y + 1 }); // 1 m south, in plan metres
  const held = async () => {
    await tid(page, "snap-marker").waitFor();
    await tid(page, "drag-length").waitFor();
    await page.screenshot({ path: `${OUT}/studio-${tag}-middrag.png` });
  };
  if (touch) {
    await touchDrag(page, handle, handleTo, held);
  } else {
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(handle.x, (handle.y + handleTo.y) / 2, { steps: 3 });
    await page.mouse.move(handleTo.x, handleTo.y, { steps: 5 });
    await held();
    await page.mouse.up();
  }
  assert.equal(await selectedId(page), "w-HI", `${tag}: grabbing a shared joint keeps the selected wall`);
  const joint = (await wallOf(page, "w-HI")).b;
  near(joint.y - target.b.y, 1, 0.12, `${tag}: joint I moved about 1 m south`);
  for (const [id, end] of [["w-BI", "b"], ["w-IF", "a"]] as const) {
    const w = await wallOf(page, id);
    assert.deepEqual(w[end], joint, `${tag}: ${id} moved with the joint`);
  }
  assert.notDeepEqual(await areas(), areas0, `${tag}: the room areas changed`);
  const picDragged = wide ? await pane3d() : "";
  if (wide) assert.notEqual(picDragged, pic0, `${tag}: the 3D walls changed`);
  assert.equal((await plan(page)).walls.length, before.walls.length, `${tag}: no wall was added or lost`);

  // one Ctrl+Z puts the whole drag back
  await page.keyboard.press("Control+z");
  assert.deepEqual((await plan(page)).walls, before.walls, `${tag}: one Ctrl+Z restores every wall`);
  assert.deepEqual(await areas(), areas0, `${tag}: and the room areas`);
  if (wide) {
    await page.waitForTimeout(300);
    // The 3D picture is compared for change, not for equality: the shared hover
    // tint and WebGL antialiasing make it not quite byte-identical twice over.
    assert.notEqual(await pane3d(), picDragged, `${tag}: and the 3D picture followed the undo`);
  }

  // ---- drag the wall's body: it slides sideways, the walls at its ends stretch
  const body = await toScreen(page, mid(target));
  const to = await toScreen(page, { x: mid(target).x, y: mid(target).y + 1 });
  if (touch) await touchDrag(page, body, to);
  else {
    await page.mouse.move(body.x, body.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
  }
  const slid = await wallOf(page, "w-HI");
  near(slid.a.y - target.a.y, 1, 0.12, `${tag}: the wall body slid about 1 m south at a`);
  near(slid.b.y - target.b.y, 1, 0.12, `${tag}: and at b`);
  near(slid.a.y, slid.b.y, 1e-6, `${tag}: it kept its direction`);
  const len = (w: Wall) => Math.hypot(w.a.x - w.b.x, w.a.y - w.b.y);
  assert.ok(len(await wallOf(page, "w-GH")) < 3.5, `${tag}: w-GH shrank`);
  assert.ok(len(await wallOf(page, "w-HA")) > 4.5, `${tag}: w-HA stretched`);
  await page.keyboard.press("Control+z");
  assert.deepEqual((await plan(page)).walls, before.walls, `${tag}: one Ctrl+Z restores the body drag`);

  // ---- a typed length lands in the same place as dragging the b handle there
  await tap(await toScreen(page, mid(await wallOf(page, "w-BI")))); // B(4,0)–I(4,4), vertical
  assert.equal(await selectedId(page), "w-BI", `${tag}: w-BI selected`);
  await tid(page, "wall-length").fill("4.6 m");
  await tid(page, "wall-length").press("Enter");
  const typed = await wallOf(page, "w-BI");
  near(len(typed), 4.6, 0.011, `${tag}: the typed length took`);
  await page.keyboard.press("Control+z");
  // The same move by hand: drag the b handle to where 4.6 m puts it.
  const bHandle = await toScreen(page, (await wallOf(page, "w-BI")).b);
  const dragged = await toScreen(page, typed.b);
  if (touch) await touchDrag(page, bHandle, dragged);
  else {
    await page.mouse.move(bHandle.x, bHandle.y);
    await page.mouse.down();
    await page.mouse.move(dragged.x, dragged.y, { steps: 5 });
    await page.mouse.up();
  }
  assert.deepEqual((await wallOf(page, "w-BI")).b, typed.b, `${tag}: dragging the handle there gives the same wall`);
  await page.keyboard.press("Control+z");

  // ---- Escape mid-drag restores the plan and leaves nothing in history
  const history = await page.evaluate(() => (window as Win).__planStore!.getState().past.length);
  const h2 = await toScreen(page, (await wallOf(page, "w-HI")).b);
  const h2To = await toScreen(page, { x: target.b.x + 0.8, y: target.b.y + 0.8 });
  await page.mouse.move(h2.x, h2.y);
  await page.mouse.down();
  await page.mouse.move(h2To.x, h2To.y, { steps: 5 });
  assert.notDeepEqual((await plan(page)).walls, before.walls, `${tag}: the drag is live before Escape`);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.deepEqual((await plan(page)).walls, before.walls, `${tag}: Escape restored the plan exactly`);
  assert.equal(await page.evaluate(() => (window as Win).__planStore!.getState().past.length), history, `${tag}: and left history alone`);
  assert.equal(await tid(page, "redo").isDisabled(), true, `${tag}: with nothing to redo`);

  // ---- delete a wall and undo: the panel button, then the keyboard
  await tap(await toScreen(page, mid(await wallOf(page, "w-HI"))));
  await tid(page, "wall-delete").click();
  assert.equal((await plan(page)).walls.some((w) => w.id === "w-HI"), false, `${tag}: Delete removed the wall`);
  assert.equal(await selectedId(page), null, `${tag}: and cleared the selection`);
  await tid(page, "summary").waitFor();
  await page.keyboard.press("Control+z");
  assert.deepEqual((await plan(page)).walls, before.walls, `${tag}: undo restored it`);
  await tap(await toScreen(page, mid(await wallOf(page, "w-HI"))));
  await tid(page, "plan-canvas").press("Delete");
  assert.equal((await plan(page)).walls.some((w) => w.id === "w-HI"), false, `${tag}: the Delete key removes it too`);
  await page.keyboard.press("Control+z");
  assert.deepEqual((await plan(page)).walls, before.walls, `${tag}: undo restored it again`);

  // ---- clicking a wall in the 3D scene moves the 2D selection
  await page.evaluate(() => (window as Win).__selectionStore!.getState().select(null));
  if (!wide) {
    await page.getByRole("button", { name: /Plan details/ }).click(); // close the sheet
    await tid(page, "view-3d").click();
    await page.waitForSelector("canvas");
    await page.waitForTimeout(800);
  }
  const scene = await box(page, "pane-3d");
  let hit: string | null = null;
  // Walk a grid over the scene until a click lands on a wall: where the walls
  // are on screen depends on the fitted camera, so the test looks for one.
  for (let row = 2; row < 8 && !hit; row++) {
    for (let col = 2; col < 10 && !hit; col++) {
      await tap({ x: scene.x + (scene.width * col) / 11, y: scene.y + (scene.height * row) / 10 });
      hit = await selectedId(page);
    }
  }
  assert.ok(hit, `${tag}: a click in the 3D scene selected a wall`);
  if (!wide) {
    await tid(page, "view-2d").click();
    await tid(page, "plan-svg").waitFor();
  }
  assert.equal(await tid(page, "plan-canvas").getAttribute("data-selected"), hit, `${tag}: the 2D plan follows the 3D selection (${hit})`);

  // back to a clean slate for the rest of the run
  await page.keyboard.press("Escape");
  assert.equal(await selectedId(page), null, `${tag}: Escape clears the selection`);
  if (!wide) await page.getByRole("button", { name: /Plan details/ }).click();
  await tid(page, "summary").waitFor();
  if (!wide) await page.getByRole("button", { name: /Plan details/ }).click();
  console.log(`${tag}: select and edit ok (${touch ? "real touch events" : "mouse"}; 3D pick hit ${hit})`);
}

/**
 * The two facade cases of the wall-run step: dragging one piece of a wall that
 * detection split at a T-junction must move the whole straight wall, not tilt its
 * neighbour. Leaves the plan as it found it. `touch` sends real touch events.
 */
async function checkRuns(page: Page, tag: string, wide: boolean, touch: boolean) {
  if (wide) {
    await tid(page, "view-split").click();
  } else {
    await tid(page, "view-2d").click();
    await page.getByRole("button", { name: /Plan details/ }).click(); // the phone sheet holds the panel
  }
  await tid(page, "plan-svg").waitFor();
  await page.waitForTimeout(500); // opening the sheet shrinks the canvas, which refits the plan
  const tap = async (p: Pt) => (touch ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y));
  /** A piece's a→b heading in degrees, from the store, and the turn between two. */
  const heading = (w: Wall) => (Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x) * 180) / Math.PI;
  const turn = (a: number, b: number) => {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  };
  const DIR_EPS_DEG = 0.01; // every piece of the run must stay this straight

  const cases = [
    // [name, the piece to grab, its run, the metres to drag it, the degrees every piece must keep]
    ["north wall, left half 1 m north", "w-AB", ["w-AB", "w-BC"], { x: 0, y: -1 }, 0],
    ["east wall, lower piece 0.8 m east", "w-ME", ["w-CM", "w-ME"], { x: 0.8, y: 0 }, 90],
  ] as const;

  for (const [name, id, expected, delta, deg] of cases) {
    const before = await plan(page);
    const piece = await wallOf(page, id);
    await tap(await toScreen(page, mid(piece)));
    assert.equal(await selectedId(page), id, `${tag}: clicking ${id} selects that piece`);

    // the whole straight wall is highlighted: the canvas names the run, and the
    // lighter outline is drawn for every piece except the selected one
    const run = (await tid(page, "plan-canvas").getAttribute("data-run"))!.split(" ");
    assert.deepEqual(run, [...expected], `${tag}: the 2D plan highlights the whole wall (${name})`);
    const outlined = await page.evaluate(() => [...document.querySelectorAll('[data-testid="plan-run"] polygon')].map((e) => e.getAttribute("data-wall")));
    assert.deepEqual(outlined, expected.filter((w) => w !== id), `${tag}: the other pieces are outlined (${name})`);
    assert.match(await tid(page, "wall-run").innerText(), /^Part of a straight wall of 2 pieces, /, `${tag}: and the panel says so (${name})`);

    // drag the body by `delta` metres
    const from = await toScreen(page, mid(piece));
    const to = await toScreen(page, { x: mid(piece).x + delta.x, y: mid(piece).y + delta.y });
    const held = async () => {
      await tid(page, "drag-length").waitFor();
      await page.screenshot({ path: `${OUT}/studio-${tag}-run-${id}-middrag.png` });
    };
    if (touch) await touchDrag(page, from, to, held);
    else {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
      await page.mouse.move(to.x, to.y, { steps: 4 });
      await held();
      await page.mouse.up();
    }

    // every piece of the run slid together and none of them tilted
    const after = await plan(page);
    const moved = Math.abs(delta.x) + Math.abs(delta.y);
    for (const wid of expected) {
      const w = after.walls.find((x) => x.id === wid)!;
      // A heading and its opposite are the same line, so measure the turn to both.
      const off = Math.min(turn(heading(w), deg), turn(heading(w), deg + 180));
      assert.ok(off <= DIR_EPS_DEG, `${tag}: ${wid} stayed straight at ${deg}° (${heading(w).toFixed(4)}°) after ${name}`);
      const was = before.walls.find((x) => x.id === wid)!;
      for (const end of ["a", "b"] as const) {
        near(Math.hypot(w[end].x - was[end].x, w[end].y - was[end].y), moved, 0.12, `${tag}: ${wid}.${end} slid about ${moved} m (${name})`);
      }
    }
    assert.equal(after.walls.length, before.walls.length, `${tag}: no wall was added or lost (${name})`);

    // one Ctrl+Z puts the whole run drag back
    await page.keyboard.press("Control+z");
    assert.deepEqual((await plan(page)).walls, before.walls, `${tag}: one Ctrl+Z restores the run drag (${name})`);
    await page.evaluate(() => (window as Win).__selectionStore!.getState().select(null));
  }
  if (!wide) await page.getByRole("button", { name: /Plan details/ }).click(); // close the sheet again
  console.log(`${tag}: wall runs ok (both facade cases, ${touch ? "real touch events" : "mouse"})`);
}

async function run(width: number, height: number) {
  const tag = String(width);
  const wide = width >= 768;
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: !wide }); // the phone run uses real touch events
  page.on("pageerror", (e) => errors.push(`${tag} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag} console: ${m.text().slice(0, 200)}`));
  await page.goto(`${BASE}/studio`);
  await tid(page, "plan-name").waitFor();
  await page.waitForSelector("canvas");

  await page.waitForTimeout(800); // first frame
  await page.screenshot({ path: `${OUT}/studio-${tag}-initial.png` });
  const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth);
  assert.ok(await noSideScroll(), `${tag}: no horizontal scroll on load`);

  // ---- views
  await check2d(page, tag, wide, `${OUT}/studio-${tag}-2d.png`);
  await checkSelect(page, tag, wide, !wide);
  await checkRuns(page, tag, wide, !wide);
  if (wide) {
    await tid(page, "view-split").click();
    await page.waitForSelector("canvas");
    await tid(page, "plan-svg").waitFor();
    assert.equal(await tid(page, "plan-wall").count(), (await plan(page)).walls.length, `${tag}: split shows the 2D plan too`);
    const [a, b] = await Promise.all([tid(page, "pane-3d").boundingBox(), tid(page, "pane-2d").boundingBox()]);
    assert.ok(a!.x < b!.x && Math.abs(a!.y - b!.y) < 2, `${tag}: split is side by side`);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/studio-${tag}-split.png` });
  } else {
    assert.equal(await tid(page, "view-split").isVisible(), false, `${tag}: Split hidden on a phone`);
  }
  await tid(page, "view-3d").click();
  await page.waitForSelector("canvas");
  assert.equal(await tid(page, "plan-svg").count(), 0, `${tag}: 3D view has no 2D plan`);

  // ---- rooms: open the phone sheet first
  if (!wide) await page.getByRole("button", { name: /Plan details/ }).click();
  const before = (await plan(page)).rooms.map((r) => r.name);
  const first = before[0];
  const input = tid(page, "room-name-0");
  assert.equal(await input.inputValue(), first);
  await input.fill("Study");
  await input.press("Enter");
  assert.ok((await plan(page)).rooms.some((r) => r.name === "Study"), `${tag}: store has the new room name`);
  assert.equal(await tid(page, "undo").isDisabled(), false);
  await tid(page, "undo").click();
  assert.deepEqual((await plan(page)).rooms.map((r) => r.name), before, `${tag}: Undo button restores the room name`);
  assert.equal(await tid(page, "room-name-0").inputValue(), first, `${tag}: input shows the old name`);
  assert.equal(await tid(page, "undo").isDisabled(), true, `${tag}: Undo disabled when history is empty`);
  await tid(page, "redo").click();
  assert.ok((await plan(page)).rooms.some((r) => r.name === "Study"), `${tag}: Redo button reapplies`);
  await page.keyboard.press("Control+z");
  assert.deepEqual((await plan(page)).rooms.map((r) => r.name), before, `${tag}: Ctrl+Z undoes`);
  await page.keyboard.press("Control+Shift+z");
  assert.ok((await plan(page)).rooms.some((r) => r.name === "Study"), `${tag}: Ctrl+Shift+Z redoes`);
  // An empty name is dropped and the old one comes back.
  await tid(page, "room-name-0").fill("   ");
  await tid(page, "room-name-0").press("Enter");
  assert.equal(await tid(page, "room-name-0").inputValue(), "Study", `${tag}: blank room name rejected`);

  // ---- plan name
  const oldName = (await plan(page)).name;
  await tid(page, "plan-name").fill("  Flat on Elm Street ");
  await tid(page, "plan-name").press("Enter");
  assert.equal((await plan(page)).name, "Flat on Elm Street", `${tag}: plan renamed and trimmed`);
  await tid(page, "undo").click();
  assert.equal((await plan(page)).name, oldName, `${tag}: plan rename undone`);
  await tid(page, "redo").click();

  // ---- units
  const m2 = await num(page, "total-area");
  assert.match(await tid(page, "total-area").innerText(), /m²/);
  await tid(page, "units-sqft").click();
  assert.match(await tid(page, "total-area").innerText(), /sq ft/);
  const sqft = await num(page, "total-area");
  assert.ok(Math.abs(sqft / m2 - 10.7639) < 0.02, `${tag}: ${sqft} sq ft vs ${m2} m² (ratio ${(sqft / m2).toFixed(4)})`);
  await tid(page, "units-m2").click();
  assert.equal(await num(page, "total-area"), m2);

  // ---- menus
  await tid(page, "export-menu").click();
  const items = await page.getByRole("button", { name: /Coming soon/ }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-disabled")));
  assert.deepEqual(items, ["true", "true", "true", "true", "true"], `${tag}: five disabled export items`);
  await page.screenshot({ path: `${OUT}/studio-${tag}-export.png` });
  await page.keyboard.press("Escape");
  await tid(page, "view-options").click();
  await tid(page, "show-ceilings").check();
  await tid(page, "show-ceilings").uncheck();
  await page.keyboard.press("Escape");

  // ---- layout
  assert.ok(await noSideScroll(), `${tag}: no horizontal scroll at the end`);
  const cut = await page.evaluate(() =>
    [...document.querySelectorAll("header *, nav *, aside *, main *")]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        const s = getComputedStyle(e);
        return r.width > 0 && s.visibility !== "hidden" && (r.right > innerWidth + 1 || r.left < -1 || r.bottom > innerHeight + 1);
      })
      .map((e) => `${e.tagName.toLowerCase()} "${(e.textContent ?? "").trim().slice(0, 30)}"`),
  );
  console.log(`${tag}: elements outside the viewport: ${cut.length ? cut.join("; ") : "none"}`);
  await page.screenshot({ path: `${OUT}/studio-${tag}.png` });

  // ---- keyboard: every control gets a visible focus ring
  await page.locator("body").click({ position: { x: 2, y: 2 } });
  const stops = new Set<string>();
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    const ring = await page.evaluate(() => {
      const e = document.activeElement as HTMLElement | null;
      return e && e !== document.body && !e.tagName.startsWith("NEXTJS") ? `${e.tagName}:${e.getAttribute("data-testid") ?? e.textContent?.slice(0, 12)}|${getComputedStyle(e).outlineStyle}|${getComputedStyle(e).outlineWidth}` : "";
    });
    if (ring) stops.add(ring);
  }
  const noRing = [...stops].filter((s) => s.includes("|none|"));
  assert.equal(noRing.length, 0, `${tag}: focused without a ring: ${noRing.join(", ")}`);
  console.log(`${tag}: ${stops.size} tab stops, all with a focus ring`);

  // ---- import link
  await tid(page, "import-link").click();
  await page.waitForURL("**/studio/import");
  console.log(`${tag}: Import plan link goes to ${new URL(page.url()).pathname}`);
  await browser.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  await run(1440, 900);
  await run(390, 844);
  assert.deepEqual(errors, [], `console errors:\n${errors.join("\n")}`);
  console.log("e2e-studio: ok; screenshots in", OUT);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
