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
 * Then checkDraw (step 4.4): pick the Wall tool from 3D alone and check the 2D
 * plan comes up; draw a wall across the living room from w-BI to w-CM, which
 * ends the chain by itself, and check both walls it meets were split, the room
 * count went 4 → 5, the 2D plan has a shape per wall, and the new wall's mesh is
 * in the live 3D scene (window.__scene3d); undo and redo it; draw a two-wall
 * chain from the midpoint of w-AB that closes a cupboard (a fifth room); select
 * the drawn wall with the Select tool, read its length in the panel, delete it
 * and undo; a wall under 0.2 m is refused with a message and Finish ends the
 * chain with no history. Wide only (keyboard): a typed length, double-click to
 * finish, and Escape mid-wall leaving history alone. Phones tap with real touch
 * events and use the Undo and Redo buttons.
 * Then checkOpeningSelect (the 4.5 manual failure): in 2D, click the Bedroom 1
 * door where it is DRAWN — 3 px off its visible leaf, read from the SVG — and
 * check the door (not the wall) is selected, OpeningPanel replaces Summary, the
 * door gets the cyanotype treatment, and nothing went into history; click
 * w-BI away from the door and check the wall is selected and the door is not;
 * click the door's opening again; the same for the living room's north window; Escape and
 * a click on empty floor clear everything. No store calls: real clicks, and
 * real touch taps at 390.
 * Then checkOpenings (step 4.5): (A) the Door tool previews and places a door 2.8 m
 * along the horizontal wall w-AB — in the store, drawn in 2D, and a door mesh in the
 * live 3D scene; (B) the Window tool places a window on the vertical wall w-ME,
 * in 2D and 3D; (C) the Select tool picks the door, not the wall behind it (and
 * the wall beside it still picks the wall), the panel shows Door and its swing
 * side, Flip reverses the side in the store, the 2D leaf and the 3D leaf, and
 * one undo brings the original side back; (D) a door at a wall's end is refused
 * with a reason and leaves nothing behind, and a window typed 9 m wide is
 * clamped to the room it has; (E) a 4.4 wall drawn from w-BC to w-KM splits
 * w-BC between its door and window, and each stays on the right piece in the
 * same place; (F) deleting the flipped door leaves its wall, and one undo brings
 * it back, swing side included. At 390 all of it runs with real touch events
 * and the Undo button, and the inspector's Flip and Delete are checked to be on
 * screen and not covered.
 * Then rename a room and check the store; Undo button brings the old
 * name back, Redo button reapplies, Ctrl+Z / Ctrl+Shift+Z do the same from the
 * keyboard; rename the plan; toggle units and check the total area changes by
 * 10.7639; no console errors; no horizontal scroll; nothing visible sticks out
 * past the viewport; then follow the Import menu's "Floor plan image…" link.
 * Then checkMeasure (step 4.6): the Measure tool, with a mouse at 1440 and real
 * touch at 390 — two points give a dimension line and a value in metres, a
 * deliberately sloppy tap snaps to a wall corner, a marker can be dragged, zoom
 * and pan keep the value and the markers anchored to the same plan points,
 * Escape (1440) or Clear (390) cancels, a new measurement replaces the old one,
 * leaving the tool clears it, and through all of it the plan, the undo history
 * and the selection are exactly as before (also while dragging over a wall and
 * tapping on a door). Last, checkAutosave in a fresh browser: edit the plan name,
 * a room name and a wall through the real UI, wait for the save status to say
 * saved (localStorage is only READ, never written, by this test), reload, and check the
 * three edits are back while the selection, the Measure tool and the 2D zoom are not.
 * Last, checkSwingPersists (regression, fresh browser each at 1440 and 390): Flip the
 * Bedroom 1 door in the panel, let the real autosave run, reload, select the door again
 * and check its swing side is the flipped one and nothing else about it changed.
 * E2E_ONLY=swing runs just that. Then checkPushPull (4.7a, wall tops) and
 * checkOpenings3d (4.7b): door and window faces with Push/Pull, the Move tool and
 * selecting openings in 3D, at 1440 (mouse) and 390 (real touch); E2E_ONLY=pushpull
 * runs just those two (and checkWalls3d). Then checkWalls3d (4.7c): Push/Pull on the
 * south wall's outer face (thicker by the label's value, the inner face fixed, read
 * from the store), one undo, Escape (a second finger at 390); Shift-drag on the bedroom
 * partition moves it and the two bedrooms' areas change in opposite directions (1440,
 * read from the panel); the Move tool slides the partition sideways; the Move tool
 * drags the south-east corner on the floor (both walls there follow, the snap marker
 * shows) and one undo restores it; pointing at a hidden wall end hovers the side, never
 * the end (1440); an orbit drag selects nothing; Walk disables both tools.
 * E2E_ONLY=walls runs just checkWalls3d. Screenshots go to /tmp/studio/.
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
import sharp from "sharp";

const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const OUT = "/tmp/studio";
/** Set E2E_CHROMIUM to a Chromium binary when the one Playwright expects is not installed. */
const EXECUTABLE = process.env.E2E_CHROMIUM || undefined;

type Rect = { x: number; y: number; width: number; height: number };
type Pt = { x: number; y: number };
type Wall = { id: string; a: Pt; b: Pt; thickness: number; height: number };
type Store = {
  getState(): {
    plan: { name: string; rooms: { id: string; name: string; wallIds: string[]; floorMaterial: string }[]; walls: Wall[]; openings: Opening[] };
    past: unknown[];
    future: unknown[];
    renameRoom(id: string, name: string): void;
    moveWallEndpoint(wallId: string, end: "a" | "b", to: Pt): void;
    undo(): void;
  };
};
type Selection = { getState(): { selectedId: string | null; openingId: string | null; select(id: string | null): void } };
type Opening = { id: string; wallId: string; kind: "door" | "window"; offset: number; width: number; height: number; sillHeight: number; swing?: "left" | "right" };
type Scene3d = { wallIds(): string[]; openings(): { id: string; kind: string; leafTurn: number | null }[] };
type Measurement = { a: Pt; b: Pt | null } | null;
type Tools = { getState(): { tool: string; measurement: Measurement } };
type Box3d = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
type Studio3d = {
  project(p: { x: number; y: number; z: number }): Pt;
  wallBox(id: string): Box3d | null;
  openingBox(id: string): Box3d | null;
};
type PushPullDebug = {
  tool: string;
  hover: { wallId: string; openingId: string | null; role: string } | null;
  hoverFace: { wallId: string; role: string } | null;
  active: boolean;
  corner: Pt | null;
  exposed: boolean | null;
};
type Win = Window & { __planStore?: Store; __selectionStore?: Selection; __toolStore?: Tools; __scene3d?: Scene3d; __studio3d?: Studio3d; __pushPullDebug?: PushPullDebug };
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

/** Pick a tool in the rail. The Next.js dev badge (dev server only) sits over the
 *  middle of the first button in the phone's bottom bar, so phones tap a tool at
 *  its right end. */
async function chooseTool(page: Page, id: string, touch: boolean) {
  const t = tid(page, `tool-${id}`);
  if (!touch) return t.click();
  const b = (await t.boundingBox())!;
  await t.tap({ position: { x: b.width - 10, y: b.height / 2 } });
}

/**
 * The Wall tool (step 4.4). Leaves the plan, history length aside, as it found
 * it, with the Select tool active. `touch` sends real touch events.
 */
async function checkDraw(page: Page, tag: string, wide: boolean, touch: boolean) {
  const pickTool = (id: string) => chooseTool(page, id, touch);

  // Picking Wall while only 3D shows brings the 2D plan up: Split, or 2D on a phone.
  await tid(page, "view-3d").click();
  await page.waitForSelector("canvas");
  await pickTool("wall");
  await tid(page, "plan-svg").waitFor();
  assert.equal(await tid(page, "tool-wall").getAttribute("aria-pressed"), "true", `${tag}: Wall is the active tool`);
  assert.equal(await tid(page, "tool-select").getAttribute("aria-pressed"), "false", `${tag}: and Select is not`);
  assert.equal(await tid(page, "pane-3d").count(), wide ? 1 : 0, `${tag}: ${wide ? "Split keeps the 3D beside the plan" : "a phone shows the 2D plan alone"}`);
  await tid(page, "draw-bar").waitFor();
  await page.waitForTimeout(600); // the canvas has just been sized and fitted

  const canvas = tid(page, "plan-canvas");
  const drawing = async () => (await canvas.getAttribute("data-drawing")) === "true";
  const past = () => page.evaluate(() => (window as Win).__planStore!.getState().past.length);
  const scene = () => page.evaluate(() => (window as Win).__scene3d?.wallIds() ?? null);
  // Taps a beat apart, so two taps near each other never read as a double-tap.
  const at = async (p: Pt) => {
    const q = await toScreen(page, p);
    if (touch) {
      await page.touchscreen.tap(q.x, q.y);
      await page.waitForTimeout(450);
    } else await page.mouse.click(q.x, q.y);
  };
  const undo = async () => (wide ? page.keyboard.press("Control+z") : tid(page, "undo").click());
  const redo = async () => (wide ? page.keyboard.press("Control+Shift+z") : tid(page, "redo").click());
  /** On a phone the 3D model only shows in the 3D view: switch there to read its meshes, then back. */
  const meshes = async () => {
    if (wide) return scene();
    await tid(page, "view-3d").click();
    await page.waitForSelector("canvas");
    await page.waitForTimeout(500);
    const ids = await scene();
    await tid(page, "view-2d").click();
    await tid(page, "plan-svg").waitFor();
    await page.waitForTimeout(400);
    return ids;
  };

  const original = await plan(page);
  const past0 = await past();
  assert.equal(original.rooms.length, 4, `${tag}: four rooms to start with`);

  // ---- one wall across the living room, T-junction to T-junction
  await at({ x: 4, y: 1.5 }); // on w-BI's body
  assert.equal(await drawing(), true, `${tag}: the first click starts a wall`);
  if (!touch) {
    const half = await toScreen(page, { x: 7, y: 1.5 });
    await page.mouse.move(half.x, half.y, { steps: 3 });
    await tid(page, "draw-ghost").waitFor();
    assert.equal(await tid(page, "draw-ghost").getAttribute("data-valid"), "true", `${tag}: the preview is a valid wall`);
    assert.match(await tid(page, "drag-length").textContent() ?? "", /^3\.00 m$/, `${tag}: with a live length`);
    assert.equal(await past(), past0, `${tag}: the preview is not in the plan's history`);
    await page.screenshot({ path: `${OUT}/studio-${tag}-draw-preview.png` });
  }
  const pic0 = wide ? (await tid(page, "pane-3d").screenshot()).toString("base64") : "";
  await at({ x: 10, y: 1.5 }); // on w-CM's body: the wall joins the plan, so the chain ends
  assert.equal(await drawing(), false, `${tag}: landing on a wall ended the chain`);
  const drawn = await plan(page);
  const added = drawn.walls.filter((w) => !original.walls.some((o) => o.id === w.id));
  assert.equal(added.length, 3, `${tag}: the new wall and one extra piece each of w-BI and w-CM`);
  const across = added.find((w) => w.a.y === 1.5 && w.b.y === 1.5)!;
  assert.deepEqual([across.a, across.b], [{ x: 4, y: 1.5 }, { x: 10, y: 1.5 }], `${tag}: the wall runs exactly between the two T-junctions`);
  assert.deepEqual(drawn.walls.find((w) => w.id === "w-BI")!.b, { x: 4, y: 1.5 }, `${tag}: w-BI was split at the T`);
  assert.equal(drawn.rooms.length, 5, `${tag}: the living room is now two rooms`);
  assert.equal(await past(), past0 + 1, `${tag}: one undo step`);
  assert.equal(await tid(page, "plan-wall").count(), drawn.walls.length, `${tag}: the 2D plan draws every wall`);
  assert.equal(await tid(page, "plan-warnings").count(), 0, `${tag}: nothing left unjoined`);
  assert.ok((await meshes())?.includes(across.id), `${tag}: the 3D scene has a mesh for the new wall`);
  if (wide) {
    await page.waitForTimeout(300);
    assert.notEqual((await tid(page, "pane-3d").screenshot()).toString("base64"), pic0, `${tag}: and the 3D picture changed`);
  }
  await page.screenshot({ path: `${OUT}/studio-${tag}-drawn.png` });

  await undo();
  assert.deepEqual((await plan(page)).walls, original.walls, `${tag}: undo takes the wall and both splits away`);
  assert.equal((await plan(page)).rooms.length, 4, `${tag}: and the fifth room`);
  assert.equal((await meshes())?.includes(across.id), false, `${tag}: and its 3D mesh`);
  await redo();
  assert.deepEqual((await plan(page)).walls, drawn.walls, `${tag}: redo puts it back`);
  await undo();

  // ---- a two-wall chain that closes a cupboard in Bedroom 1
  await at({ x: 2, y: 0 }); // the midpoint of w-AB
  await at({ x: 2, y: 1.5 });
  assert.equal(await drawing(), true, `${tag}: open floor keeps the chain going`);
  assert.equal(await past(), past0 + 1, `${tag}: the first wall is its own undo step`);
  await at({ x: 4, y: 1.5 }); // on w-BI: closes the loop
  assert.equal(await drawing(), false, `${tag}: closing the loop ended the chain`);
  const cupboard = await plan(page);
  assert.equal(cupboard.rooms.length, 5, `${tag}: a fifth room`);
  assert.equal(await page.locator('[data-testid^="room-area-"]').count(), 5, `${tag}: listed with its area in the panel`);
  assert.equal(await past(), past0 + 2, `${tag}: two walls, two undo steps`);
  await page.screenshot({ path: `${OUT}/studio-${tag}-cupboard.png` });

  // ---- the drawn wall is an ordinary wall: Select it, read its length, delete and undo
  const front = cupboard.walls.find((w) => w.a.y === 1.5 && w.b.y === 1.5 && w.a.x === 2)!;
  await pickTool("select");
  if (!wide) {
    await page.getByRole("button", { name: /Plan details/ }).click(); // the phone sheet holds the panel
    await page.waitForTimeout(400);
  }
  const pick = await toScreen(page, mid(front));
  if (touch) await page.touchscreen.tap(pick.x, pick.y);
  else await page.mouse.click(pick.x, pick.y);
  assert.equal(await selectedId(page), front.id, `${tag}: the Select tool picks the drawn wall`);
  assert.match(await tid(page, "wall-length").inputValue(), /^2\.00 m$/, `${tag}: the panel shows its length`);
  await tid(page, "wall-delete").click();
  assert.equal((await plan(page)).rooms.length, 4, `${tag}: deleting it opens the cupboard up again`);
  await undo();
  assert.deepEqual((await plan(page)).walls, cupboard.walls, `${tag}: undo restores it`);
  await page.evaluate(() => (window as Win).__selectionStore!.getState().select(null));
  if (!wide) await page.getByRole("button", { name: /Plan details/ }).click(); // close the sheet
  await undo();
  await undo();
  assert.deepEqual((await plan(page)).walls, original.walls, `${tag}: two undos and the cupboard is gone`);

  // ---- too short: refused with a reason; Finish ends the chain without history
  await pickTool("wall");
  await page.waitForTimeout(400);
  const history = await past();
  await at({ x: 6, y: 3 });
  await at({ x: 6, y: 3.1 });
  assert.match(await tid(page, "drag-message").innerText(), /shorter than 0\.20 m/, `${tag}: a 0.1 m wall is refused, with the reason`);
  assert.equal(await past(), history, `${tag}: and nothing was recorded`);
  await tid(page, "draw-finish").click();
  assert.equal(await drawing(), false, `${tag}: Finish ends the chain`);
  assert.equal(await past(), history, `${tag}: still with no history`);

  if (wide) {
    // ---- a typed length, towards the pointer; double-click finishes
    await at({ x: 6, y: 3 });
    const toward = await toScreen(page, { x: 6, y: 4.2 });
    await page.mouse.move(toward.x, toward.y, { steps: 3 });
    await page.keyboard.type("1.5");
    assert.match(await tid(page, "drag-length").textContent() ?? "", /^1\.5…$/, `${tag}: the typed length shows as it is typed`);
    await page.keyboard.press("Enter");
    const typed = (await plan(page)).walls.find((w) => !original.walls.some((o) => o.id === w.id))!;
    assert.deepEqual([typed.a, typed.b], [{ x: 6, y: 3 }, { x: 6, y: 4.5 }], `${tag}: Enter adds a wall exactly 1.5 m long`);
    assert.equal(await drawing(), true, `${tag}: a free end keeps the chain going`);
    const end = await toScreen(page, typed.b);
    await page.mouse.dblclick(end.x, end.y);
    assert.equal(await drawing(), false, `${tag}: double-click finishes`);
    assert.equal(await tid(page, "plan-warnings").count(), 1, `${tag}: and the panel lists the free-standing wall's open ends`);
    await page.keyboard.press("Control+z");
    assert.deepEqual((await plan(page)).walls, original.walls, `${tag}: one Ctrl+Z removes it`);

    // ---- Escape mid-wall: the preview goes, history stays; Escape again is Select
    const h = await past();
    await at({ x: 6, y: 3 });
    const away = await toScreen(page, { x: 8, y: 3 });
    await page.mouse.move(away.x, away.y, { steps: 3 });
    await page.keyboard.press("Escape");
    assert.equal(await drawing(), false, `${tag}: Escape cancels the wall being drawn`);
    assert.equal(await tid(page, "draw-ghost").count(), 0, `${tag}: and its preview`);
    assert.equal(await past(), h, `${tag}: without touching history`);
    await page.keyboard.press("Escape");
    assert.equal(await tid(page, "tool-select").getAttribute("aria-pressed"), "true", `${tag}: a second Escape goes back to Select`);
  } else {
    await pickTool("select");
  }
  assert.deepEqual((await plan(page)).walls, original.walls, `${tag}: the plan is as it was`);
  console.log(`${tag}: draw walls ok (${touch ? "real touch events" : "mouse and keyboard"}; T-junction wall, cupboard chain, 3D meshes, undo/redo)`);
}

/**
 * Doors and windows (step 4.5). Leaves walls and openings as it found them, with
 * the Select tool active. `touch` sends real touch events.
 */
async function checkOpenings(page: Page, tag: string, wide: boolean, touch: boolean) {
  const past = () => page.evaluate(() => (window as Win).__planStore!.getState().past.length);
  const openingSel = () => page.evaluate(() => (window as Win).__selectionStore!.getState().openingId);
  const scene = () => page.evaluate(() => (window as Win).__scene3d?.openings() ?? null);
  const at = async (p: Pt) => {
    const q = await toScreen(page, p);
    if (touch) {
      await page.touchscreen.tap(q.x, q.y);
      await page.waitForTimeout(450); // a beat apart: never a double-tap
    } else await page.mouse.click(q.x, q.y);
  };
  const undo = async () => (wide ? page.keyboard.press("Control+z") : tid(page, "undo").click());
  const sheet = async () => {
    if (wide) return;
    await page.getByRole("button", { name: /Plan details/ }).click(); // the phone sheet holds the panel
    await page.waitForTimeout(450); // opening or closing it resizes the canvas, which refits the plan
  };
  /** The 3D openings, read from the live scene; a phone shows 3D only in the 3D view. */
  const openings3d = async () => {
    if (wide) return scene();
    await tid(page, "view-3d").click();
    await page.waitForSelector("canvas");
    await page.waitForTimeout(500);
    const out = await scene();
    await tid(page, "view-2d").click();
    await tid(page, "plan-svg").waitFor();
    await page.waitForTimeout(450);
    return out;
  };
  const leaf = (id: string) =>
    page.evaluate((id) => {
      const l = document.querySelector(`[data-testid="plan-door"][data-opening="${id}"] [data-testid="door-leaf"]`)!;
      return { y1: +l.getAttribute("y1")!, y2: +l.getAttribute("y2")! };
    }, id);

  const original = await plan(page);
  const past0 = await past();

  // ---- (A) a door on the horizontal wall w-AB A(0,0)–B(4,0)
  await tid(page, "view-3d").click();
  await page.waitForSelector("canvas");
  await chooseTool(page, "door", touch);
  await tid(page, "plan-svg").waitFor();
  await tid(page, "place-bar").waitFor();
  assert.equal(await tid(page, "tool-door").getAttribute("aria-pressed"), "true", `${tag}: Door is the active tool`);
  await page.waitForTimeout(600);
  if (!touch) {
    const hoverAt = await toScreen(page, { x: 2.8, y: 0.03 });
    await page.mouse.move(hoverAt.x, hoverAt.y, { steps: 3 });
    await tid(page, "place-preview").waitFor();
    assert.equal(await tid(page, "place-preview").getAttribute("data-valid"), "true", `${tag}: a valid door preview`);
    assert.equal(await tid(page, "place-preview").getAttribute("data-wall"), "w-AB", `${tag}: on the wall under the pointer`);
    assert.match((await tid(page, "drag-length").textContent()) ?? "", /^Door 0\.90 m$/, `${tag}: with its width`);
    assert.equal(await past(), past0, `${tag}: a preview is not an edit`);
    await page.screenshot({ path: `${OUT}/studio-${tag}-door-preview.png` });
  }
  await at({ x: 2.8, y: 0 });
  const withDoor = await plan(page);
  const door = withDoor.openings.find((o) => !original.openings.some((x) => x.id === o.id))!;
  assert.ok(door, `${tag}: a door was added`);
  assert.deepEqual({ ...door, id: "" }, { id: "", wallId: "w-AB", kind: "door", offset: 2.8, width: 0.9, height: 2.1, sillHeight: 0, swing: "left" }, `${tag}: centred 2.8 m along w-AB (outside the midpoint snap at both zooms), default size, explicit swing`);
  assert.equal(await past(), past0 + 1, `${tag}: one undo step`);
  assert.equal(await page.locator(`[data-testid="plan-door"][data-opening="${door.id}"]`).count(), 1, `${tag}: drawn in 2D`);
  assert.ok((await openings3d())?.some((o) => o.id === door.id && o.kind === "door"), `${tag}: and built in 3D`);

  // ---- (B) a window on the vertical wall w-ME M(10,5)–E(10,8)
  await chooseTool(page, "window", touch);
  await page.waitForTimeout(300);
  await at({ x: 10, y: 6.5 });
  const withWindow = await plan(page);
  const win = withWindow.openings.find((o) => !withDoor.openings.some((x) => x.id === o.id))!;
  assert.ok(win, `${tag}: a window was added`);
  assert.deepEqual([win.wallId, win.kind, win.offset, win.width, win.sillHeight, win.swing], ["w-ME", "window", 1.5, 1.2, 0.9, undefined], `${tag}: on w-ME, 1.5 m from M, no swing`);
  assert.equal(await page.locator(`[data-testid="plan-window"][data-opening="${win.id}"]`).count(), 1, `${tag}: drawn in 2D`);
  assert.ok((await openings3d())?.some((o) => o.id === win.id && o.kind === "window"), `${tag}: and built in 3D`);
  await page.screenshot({ path: `${OUT}/studio-${tag}-placed.png` });

  // ---- (D, first half) a door at a wall's end is refused, with the reason, and leaves nothing
  await chooseTool(page, "door", touch);
  await page.waitForTimeout(300);
  await at({ x: 0.05, y: 0 }); // on w-AB, at its corner with w-HA
  assert.match(await tid(page, "drag-message").innerText(), /end of the wall/, `${tag}: refused at the wall's end, in plain words`);
  assert.deepEqual((await plan(page)).openings, withWindow.openings, `${tag}: no opening was left behind`);
  assert.equal(await past(), past0 + 2, `${tag}: and nothing recorded`);

  // ---- (C) select the door, not the wall; the wall beside it is still the wall's
  await chooseTool(page, "select", touch);
  await sheet();
  await at({ x: 1, y: 0 }); // w-AB, well clear of the door (2.35–3.25) and its swing
  assert.equal(await selectedId(page), "w-AB", `${tag}: the wall beside the door selects the wall`);
  await at({ x: 2.8, y: 0 });
  assert.equal(await openingSel(), door.id, `${tag}: a click on the door selects the door`);
  assert.equal(await selectedId(page), null, `${tag}: not the wall behind it`);
  assert.equal(await tid(page, "plan-opening-selection").count(), 1, `${tag}: outlined as an opening`);
  assert.equal(await tid(page, "plan-selection").count(), 0, `${tag}: with no wall outline`);
  await tid(page, "opening-panel").waitFor();
  assert.equal(await tid(page, "opening-type").innerText(), "Door", `${tag}: the panel says Door`);
  assert.equal(await tid(page, "opening-swing").getAttribute("data-swing"), "left", `${tag}: and shows the swing side`);
  assert.match(await tid(page, "opening-width").inputValue(), /^0\.90 m$/, `${tag}: and the width`);
  assert.match(await tid(page, "opening-offset").inputValue(), /^2\.80 m$/, `${tag}: and the position`);
  if (!wide) {
    // The inspector's buttons are on screen and nothing sits on top of them.
    for (const id of ["opening-flip", "opening-delete"]) {
      await tid(page, id).scrollIntoViewIfNeeded();
      const b = (await tid(page, id).boundingBox())!;
      assert.ok(b.y >= 0 && b.y + b.height <= 844 && b.x >= 0 && b.x + b.width <= 390, `${tag}: ${id} is on screen`);
      const top = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("[data-testid]")?.getAttribute("data-testid"), [b.x + b.width / 2, b.y + b.height / 2]);
      assert.equal(top, id, `${tag}: and not covered (${top})`);
    }
  }
  await page.screenshot({ path: `${OUT}/studio-${tag}-door-selected.png` });
  const leafBefore = await leaf(door.id);
  assert.ok(leafBefore.y2 > leafBefore.y1, `${tag}: a left swing on w-AB (a→b east) opens south, down the screen`);
  const turnBefore = (await openings3d())!.find((o) => o.id === door.id)!.leafTurn!;
  const beforeFlip = await plan(page);
  await tid(page, "opening-flip").click();
  const flipped = (await plan(page)).openings.find((o) => o.id === door.id)!;
  assert.equal(flipped.swing, "right", `${tag}: Flip reversed the swing side`);
  assert.deepEqual({ ...flipped, swing: "left" }, door, `${tag}: and changed nothing else`);
  assert.equal(await tid(page, "opening-swing").getAttribute("data-swing"), "right", `${tag}: the panel follows`);
  const leafAfter = await leaf(door.id);
  assert.ok(leafAfter.y2 < leafAfter.y1, `${tag}: the 2D leaf now opens north`);
  const turnAfter = (await openings3d())!.find((o) => o.id === door.id)!.leafTurn!;
  assert.ok(Math.sign(turnAfter) === -Math.sign(turnBefore) && turnAfter !== 0, `${tag}: the 3D leaf turned the other way (${turnBefore} → ${turnAfter})`);
  await page.screenshot({ path: `${OUT}/studio-${tag}-door-flipped.png` });
  await undo();
  assert.deepEqual((await plan(page)).openings, beforeFlip.openings, `${tag}: one undo puts the original swing back`);
  assert.ok((await leaf(door.id)).y2 > (await leaf(door.id)).y1, `${tag}: in 2D too`);

  // Drag the door along w-AB: it slides, stops at the usable end (3.95 − 0.45 = 3.5 m), and is one undo step.
  const pastDrag = await past();
  const grab = await toScreen(page, { x: 2.8, y: 0 });
  const drop = await toScreen(page, { x: 3.9, y: 0.05 });
  if (touch) await touchDrag(page, grab, drop);
  else {
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(drop.x, drop.y, { steps: 6 });
    await page.mouse.up();
  }
  const dragged = (await plan(page)).openings.find((o) => o.id === door.id)!;
  assert.ok(Math.abs(dragged.offset - 3.5) < 1e-9, `${tag}: dragging the door slid it to the end of its usable span (${dragged.offset})`);
  assert.deepEqual({ ...dragged, offset: 2.8 }, door, `${tag}: on the same wall, nothing else changed`);
  assert.equal(await past(), pastDrag + 1, `${tag}: one undo step for the drag`);
  assert.equal(await openingSel(), door.id, `${tag}: still selected`);
  await undo();
  assert.equal((await plan(page)).openings.find((o) => o.id === door.id)!.offset, 2.8, `${tag}: one undo puts it back`);
  if (wide) {
    await tid(page, "plan-canvas").press("Delete");
    assert.equal((await plan(page)).openings.some((o) => o.id === door.id), false, `${tag}: the Delete key removes the selected door`);
    assert.ok((await plan(page)).walls.some((w) => w.id === "w-AB"), `${tag}: and not its wall`);
    await undo();
    assert.deepEqual((await plan(page)).openings, beforeFlip.openings, `${tag}: undo restores it`);
  }

  // ---- (D, second half) a window typed 9 m wide is clamped to the room it has
  await page.evaluate(() => (window as Win).__selectionStore!.getState().select(null));
  await at({ x: 10, y: 6.5 });
  assert.equal(await openingSel(), win.id, `${tag}: the window selected`);
  assert.equal(await tid(page, "opening-sill").count(), 1, `${tag}: a window shows its sill`);
  assert.equal(await tid(page, "opening-flip").count(), 0, `${tag}: and no Flip`);
  await tid(page, "opening-width").fill("9 m");
  await tid(page, "opening-width").press("Enter");
  const wide9 = (await plan(page)).openings.find((o) => o.id === win.id)!;
  assert.ok(Math.abs(wide9.width - 2.85) < 1e-9, `${tag}: clamped to the 2.85 m w-ME has clear (${wide9.width})`);
  assert.ok(wide9.offset - wide9.width / 2 >= 0 && wide9.offset + wide9.width / 2 <= 3, `${tag}: still inside its 3 m wall`);
  assert.match(await tid(page, "opening-note").innerText(), /fits/, `${tag}: with the reason`);
  await undo();
  assert.equal((await plan(page)).openings.find((o) => o.id === win.id)!.width, 1.2, `${tag}: one undo restores the width`);
  await page.evaluate(() => (window as Win).__selectionStore!.getState().select(null));
  await sheet(); // close it again

  // ---- (E) a 4.4 wall from w-BC to w-KM splits w-BC between its door and its window
  const beforeSplit = await plan(page);
  const centre = (p: Awaited<ReturnType<typeof plan>>, id: string) => {
    const o = p.openings.find((x) => x.id === id)!;
    const w = p.walls.find((x) => x.id === o.wallId)!;
    const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    return { x: w.a.x + ((w.b.x - w.a.x) / len) * o.offset, y: w.a.y + ((w.b.y - w.a.y) / len) * o.offset };
  };
  await chooseTool(page, "wall", touch);
  await page.waitForTimeout(400);
  await at({ x: 8, y: 0 });
  await at({ x: 8, y: 5 });
  const split = await plan(page);
  assert.equal(split.walls.length, beforeSplit.walls.length + 3, `${tag}: the wall went in and split w-BC and w-KM`);
  assert.equal(split.openings.length, beforeSplit.openings.length, `${tag}: no opening lost or duplicated`);
  assert.equal(split.openings.find((o) => o.id === "d-front")!.wallId, "w-BC", `${tag}: the front door stays on w-BC's first piece`);
  const winPiece = split.openings.find((o) => o.id === "win-living-n")!.wallId;
  assert.ok(winPiece !== "w-BC" && split.walls.some((w) => w.id === winPiece), `${tag}: the window moved to the new piece (${winPiece})`);
  for (const id of ["d-front", "win-living-n"]) {
    const [p, q] = [centre(beforeSplit, id), centre(split, id)];
    assert.ok(Math.hypot(p.x - q.x, p.y - q.y) < 1e-6, `${tag}: ${id} did not move`);
  }
  await undo();
  assert.deepEqual((await plan(page)).walls, beforeSplit.walls, `${tag}: one undo takes the wall and both splits away`);
  assert.deepEqual((await plan(page)).openings, beforeSplit.openings, `${tag}: and every opening is where it was`);
  await chooseTool(page, "select", touch);

  // ---- (F) flip the door, delete it: the wall stays; one undo brings it back, swing included
  await sheet();
  await at({ x: 2.8, y: 0 });
  assert.equal(await openingSel(), door.id, `${tag}: the door selected again`);
  await tid(page, "swing-right").click(); // the Left/Right control flips too
  const kept = await plan(page);
  assert.equal(kept.openings.find((o) => o.id === door.id)!.swing, "right", `${tag}: Right picked`);
  await tid(page, "opening-delete").click();
  const gone = await plan(page);
  assert.equal(gone.openings.some((o) => o.id === door.id), false, `${tag}: the door is gone`);
  assert.deepEqual(gone.walls, kept.walls, `${tag}: and its wall stays`);
  assert.deepEqual(gone.openings, kept.openings.filter((o) => o.id !== door.id), `${tag}: no other opening changed`);
  await tid(page, "summary").waitFor();
  await undo();
  assert.deepEqual((await plan(page)).openings, kept.openings, `${tag}: one undo restores it, swing side and all`);
  await sheet(); // close

  // ---- clean up: take back the swing pick, the window and the door
  for (let i = 0; i < 3; i++) await undo();
  assert.deepEqual((await plan(page)).openings, original.openings, `${tag}: openings back as they were`);
  assert.deepEqual((await plan(page)).walls, original.walls, `${tag}: walls too`);
  console.log(`${tag}: doors and windows ok (${touch ? "real touch events" : "mouse and keyboard"}; place, 3D, select, Flip, limits, split, delete/undo)`);
}

/**
 * Selecting existing doors and windows by clicking what is drawn (regression for
 * the 4.5 manual failure). Every click is at screen coordinates read from the
 * visible SVG symbols or through the canvas camera — never a selection-store
 * call. Leaves nothing selected and the plan untouched.
 */
async function checkOpeningSelect(page: Page, tag: string, wide: boolean, touch: boolean) {
  await tid(page, "view-2d").click();
  await tid(page, "plan-svg").waitFor();
  if (!wide) await page.getByRole("button", { name: /Plan details/ }).click(); // the phone sheet holds the inspector
  await page.waitForTimeout(500); // the canvas refits after the view switch and the sheet

  const sel = () => page.evaluate(() => {
    const s = (window as Win).__selectionStore!.getState();
    return { wall: s.selectedId, opening: s.openingId };
  });
  const past = () => page.evaluate(() => (window as Win).__planStore!.getState().past.length);
  const press = async (q: Pt) => {
    if (touch) await page.touchscreen.tap(q.x, q.y);
    else await page.mouse.click(q.x, q.y);
    await page.waitForTimeout(touch ? 350 : 50);
  };
  const svg = await box(page, "plan-svg");
  /** The visible door leaf's midpoint, nudged 3 px off the line on the side AWAY from the swing:
   *  the exact spot the old hit test missed. */
  const offLeaf = (id: string) =>
    page.evaluate(([id, sx, sy]) => {
      const l = document.querySelector(`[data-testid="plan-door"][data-opening="${id}"] [data-testid="door-leaf"]`)!;
      const [x1, y1, x2, y2] = ["x1", "y1", "x2", "y2"].map((k) => +l.getAttribute(k)!);
      const gap = document.querySelector(`[data-testid="plan-gap"][data-opening="${id}"]`)!.getBoundingClientRect();
      const [mx, my] = [(x1 + x2) / 2 + sx, (y1 + y2) / 2 + sy];
      const len = Math.hypot(x2 - x1, y2 - y1);
      let [nx, ny] = [-(y2 - y1) / len, (x2 - x1) / len];
      const [gx, gy] = [gap.left + gap.width / 2 - mx, gap.top + gap.height / 2 - my];
      if (nx * gx + ny * gy > 0) [nx, ny] = [-nx, -ny]; // point away from the swing, which the gap centre is inside of
      return { x: mx + nx * 3, y: my + ny * 3 };
    }, [id, svg.x, svg.y] as const);
  /** The centre of a drawn element's box on screen. */
  const centreOf = (selector: string) =>
    page.evaluate((selector) => {
      const r = document.querySelector(selector)!.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, selector);
  const panel = async () => ((await tid(page, "opening-panel").count()) ? "opening" : (await tid(page, "wall-panel").count()) ? "wall" : (await tid(page, "summary").count()) ? "summary" : "none");

  const history = await past();
  const plan0 = await plan(page);

  // ---- the Bedroom 1 door, d-bed1, clicked just off its drawn leaf
  await press(await offLeaf("d-bed1"));
  assert.deepEqual(await sel(), { wall: null, opening: "d-bed1" }, `${tag}: clicking the drawn Bedroom 1 door selects the door, not a wall`);
  assert.equal(await panel(), "opening", `${tag}: OpeningPanel replaced the Summary`);
  await tid(page, "opening-panel").waitFor({ state: "visible" });
  assert.equal(await tid(page, "opening-type").innerText(), "Door", `${tag}: it says Door`);
  for (const id of ["opening-width", "opening-offset", "opening-height", "opening-swing", "opening-flip"]) assert.equal(await tid(page, id).count(), 1, `${tag}: and shows ${id}`);
  assert.equal(await tid(page, "opening-sill").count(), 0, `${tag}: a door has no sill field`);
  assert.equal(await tid(page, "plan-opening-selection").getAttribute("data-opening"), "d-bed1", `${tag}: the door is outlined`);
  assert.equal(await tid(page, "selected-door-symbol").count(), 1, `${tag}: its leaf and arc are redrawn selected`);
  assert.equal(await tid(page, "plan-selection").count(), 0, `${tag}: and no wall is outlined`);
  assert.equal(await past(), history, `${tag}: selecting is not an edit: nothing in history`);
  if (wide) await page.screenshot({ path: `${OUT}/studio-${tag}-select-door.png` });
  else {
    await tid(page, "opening-panel").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/studio-${tag}-select-door.png` });
  }

  // ---- w-BI away from the door: the wall, and the door is let go
  await press(await toScreen(page, { x: 4, y: 1 }));
  assert.deepEqual(await sel(), { wall: "w-BI", opening: null }, `${tag}: the wall away from the door selects the wall`);
  assert.equal(await panel(), "wall", `${tag}: the wall panel shows`);
  assert.equal(await tid(page, "plan-opening-selection").count(), 0, `${tag}: and the door outline is gone`);

  // ---- the door again, this time on its opening
  await press(await centreOf('[data-testid="plan-gap"][data-opening="d-bed1"]'));
  assert.deepEqual(await sel(), { wall: null, opening: "d-bed1" }, `${tag}: clicking the door's opening selects it again`);
  assert.equal(await panel(), "opening", `${tag}: and its panel`);

  // ---- the living room's north window, win-living-n on w-BC (x 8.4–9.6). Not a
  // window near a corner: at phone zoom a touch end handle reaches about 1.3 m,
  // so the wall beside it must be further than that from every joint.
  await press(await centreOf('[data-testid="plan-window"][data-opening="win-living-n"]'));
  assert.deepEqual(await sel(), { wall: null, opening: "win-living-n" }, `${tag}: clicking the drawn window selects the window`);
  assert.equal(await tid(page, "opening-type").innerText(), "Window", `${tag}: it says Window`);
  assert.equal(await tid(page, "opening-sill").count(), 1, `${tag}: with a sill`);
  assert.equal(await tid(page, "opening-flip").count(), 0, `${tag}: and no Flip`);
  assert.equal(await tid(page, "selected-window-symbol").count(), 1, `${tag}: its symbol is redrawn selected`);
  if (wide) await page.screenshot({ path: `${OUT}/studio-${tag}-select-window.png` });
  await press(await toScreen(page, { x: 8, y: 0 })); // w-BC, 0.4 m west of the window, 2 m from corner C
  assert.deepEqual(await sel(), { wall: "w-BC", opening: null }, `${tag}: the wall beside the window selects the wall`);
  await press(await centreOf('[data-testid="plan-window"][data-opening="win-living-n"]'));
  assert.deepEqual(await sel(), { wall: null, opening: "win-living-n" }, `${tag}: and the window again`);

  // ---- clearing: empty floor, then Escape
  await press(await toScreen(page, { x: 2, y: 2 })); // the middle of Bedroom 1
  assert.deepEqual(await sel(), { wall: null, opening: null }, `${tag}: a click on empty floor clears both`);
  assert.equal(await panel(), "summary", `${tag}: and the Summary is back`);
  await press(await offLeaf("d-bed1"));
  assert.equal((await sel()).opening, "d-bed1", `${tag}: selected once more`);
  await page.keyboard.press("Escape");
  assert.deepEqual(await sel(), { wall: null, opening: null }, `${tag}: Escape clears it`);

  assert.equal(await past(), history, `${tag}: no selection made a history entry`);
  assert.deepEqual(await plan(page), plan0, `${tag}: and the plan is untouched`);
  if (!wide) await page.getByRole("button", { name: /Plan details/ }).click(); // close the sheet
  console.log(`${tag}: opening selection ok (${touch ? "real touch taps" : "mouse clicks"} on the drawn door and window)`);
}

// ---- the Measure tool and the one-key-to-cancel overlay (step 4.6)

/** A mouse drag, in steps so the page sees real pointer moves. */
async function mouseDrag(page: Page, from: Pt, to: Pt) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 3 });
  await page.mouse.up();
}

/** What the editor holds: the plan, both history stacks and the selection. A measurement must change none of it. */
const editorState = (page: Page) =>
  page.evaluate(() => {
    const s = (window as Win).__planStore!.getState();
    return { plan: JSON.stringify(s.plan), past: s.past.length, future: s.future.length, selected: (window as Win).__selectionStore!.getState().selectedId };
  });

/**
 * Measure at the current viewport. `touch` uses Chromium's own touch input
 * (taps and drags), otherwise the mouse. Leaves the Select tool active, 2D shown.
 */
async function checkMeasure(page: Page, tag: string, wide: boolean, touch: boolean) {
  await tid(page, "view-2d").click();
  await tid(page, "plan-svg").waitFor();
  await tid(page, "plan-fit").click();
  await page.waitForTimeout(200);
  const tap = async (p: Pt) => (touch ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y));
  const drag = async (a: Pt, b: Pt) => (touch ? touchDrag(page, a, b) : mouseDrag(page, a, b));
  const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth);
  const overlay = async () => {
    const g = tid(page, "measure-overlay");
    if ((await g.count()) === 0) return null;
    const pt = (v: string | null): Pt | null => (v ? { x: +v.split(",")[0], y: +v.split(",")[1] } : null);
    return { a: pt(await g.getAttribute("data-a"))!, b: pt(await g.getAttribute("data-b")), metres: parseFloat((await g.getAttribute("data-metres")) || "NaN") };
  };
  const value = async () => ((await tid(page, "measure-value").count()) ? ((await tid(page, "measure-value").textContent()) ?? "").trim() : null);
  const centre = async (id: string): Promise<Pt> => {
    const b = await box(page, id);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  /** A page pixel back to plan metres through the canvas's own camera. */
  const toWorld = async (p: Pt): Promise<Pt> => {
    const c = await cam(page);
    const b = await box(page, "plan-canvas");
    return { x: (p.x - b.x - c.tx) / c.scale, y: (p.y - b.y - c.ty) / c.scale };
  };
  const dist = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.y - q.y);
  const start = await editorState(page);

  // ---- choosing the tool
  assert.equal(await tid(page, "tool-select").getAttribute("aria-pressed"), "true", `${tag}: Select is the active tool at first`);
  if (touch) await tid(page, "tool-measure").tap();
  else await tid(page, "tool-measure").click();
  assert.equal(await tid(page, "tool-measure").getAttribute("aria-pressed"), "true", `${tag}: Measure is now pressed`);
  assert.equal(await tid(page, "tool-select").getAttribute("aria-pressed"), "false", `${tag}: and Select is not`);
  assert.equal(await tid(page, "plan-canvas").getAttribute("data-tool"), "measure", `${tag}: the canvas knows`);
  assert.match(await tid(page, "measure-hint").innerText(), /first point/, `${tag}: a hint says what to do`);
  assert.equal(await tid(page, "measure-overlay").count(), 0, `${tag}: nothing is measured yet`);

  // ---- two points about 4 m apart, in open floor (no wall end or middle within reach)
  const A = { x: 5.5, y: 1.5 };
  const B = { x: 9.5, y: 1.5 };
  const [pa, pb] = [await toScreen(page, A), await toScreen(page, B)];
  await tap(pa);
  assert.equal(await tid(page, "measure-point-a").count(), 1, `${tag}: the first point is marked`);
  assert.equal(await tid(page, "measure-line").count(), 0, `${tag}: no line yet`);
  assert.match(await tid(page, "measure-hint").innerText(), /second point/, `${tag}: the hint asks for the second point`);
  await tap(pb);
  assert.equal(await tid(page, "measure-line").count(), 1, `${tag}: a dimension line appears`);
  assert.equal(await tid(page, "measure-point-b").count(), 1, `${tag}: with a marker at each end`);
  const first = (await overlay())!;
  assert.match((await value())!, /^\d+\.\d\d m$/, `${tag}: the value is in metres to the centimetre (${await value()})`);
  near(first.metres, 4, 0.04, `${tag}: about 4 m apart`);
  near(first.metres, dist(pa, pb) / (await cam(page)).scale, 1e-3, `${tag}: and exactly the pixel distance over the scale`);
  near(parseFloat((await value())!), first.metres, 0.006, `${tag}: the label shows that distance`);
  for (const [w, p] of [[first.a, pa], [first.b!, pb]] as const) near(dist(w, await toWorld(p)), 0, 0.01, `${tag}: a marker sits where it was clicked`);
  // the line really runs between the markers, and the label is whole and clear of the line
  const line = await box(page, "measure-line");
  const [ca, cb] = [await centre("measure-point-a"), await centre("measure-point-b")];
  near(line.width, Math.abs(cb.x - ca.x), 1.5, `${tag}: the line spans the two markers`);
  const label = await box(page, "measure-label");
  const canvas = await box(page, "plan-canvas");
  assert.ok(label.x >= canvas.x && label.y >= canvas.y && label.x + label.width <= canvas.x + canvas.width && label.y + label.height <= canvas.y + canvas.height, `${tag}: the value is not clipped`);
  assert.ok(!overlaps(label, { x: line.x, y: line.y - 1, width: line.width, height: line.height + 2 }), `${tag}: and does not sit on the line`);
  assert.equal(await tid(page, "plan-wall").count(), (await plan(page)).walls.length, `${tag}: the line is not a wall: still one wall shape per wall`);

  // ---- zoom and pan: same value, markers on the same plan points
  const valueBefore = await value();
  const fitCam = await cam(page);
  if (touch) {
    await tid(page, "plan-zoom-in").click(); // one step keeps both markers on a 390 px screen
  } else {
    const m = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
    await page.mouse.move(m.x, m.y);
    await page.mouse.wheel(0, -300);
  }
  await page.waitForTimeout(150);
  const zoomed = await cam(page);
  assert.ok(zoomed.scale > fitCam.scale * 1.2, `${tag}: the plan zoomed in (${fitCam.scale.toFixed(1)} → ${zoomed.scale.toFixed(1)} px/m)`);
  // a pan: dragging the plan (in Measure a wall under the finger is not hit, so this pans wherever it starts);
  // on a phone it goes left, to keep both markers on a 390 px screen
  const emptyFrom = { x: canvas.x + (touch ? canvas.width * 0.75 : 20), y: canvas.y + canvas.height * 0.7 };
  await drag(emptyFrom, { x: emptyFrom.x + (touch ? -60 : 30), y: emptyFrom.y - 25 });
  const panned = await cam(page);
  assert.ok(Math.abs(panned.tx - zoomed.tx) > 20, `${tag}: the plan panned`);
  const after = (await overlay())!;
  assert.deepEqual([after.a, after.b], [first.a, first.b], `${tag}: a pan or zoom never moves the measured points`);
  assert.equal(await value(), valueBefore, `${tag}: the value is the same after zoom and pan`);
  near(after.metres, first.metres, 1e-9, `${tag}: and so is the world distance`);
  for (const [id, w] of [["measure-point-a", first.a], ["measure-point-b", first.b!]] as const) {
    const want = await toScreen(page, w);
    const got = await centre(id);
    near(got.x, want.x, 1.2, `${tag}: ${id} stays on its plan point, x`);
    near(got.y, want.y, 1.2, `${tag}: ${id} stays on its plan point, y`);
  }
  near((await box(page, "measure-line")).width, (first.metres * panned.scale) , 3, `${tag}: and the line is ${first.metres.toFixed(2)} m at the new scale`);
  await page.screenshot({ path: `${OUT}/studio-${tag}-measure.png` });

  // ---- a sloppy tap still lands on a wall corner; a marker can be dragged
  await page.keyboard.press("Escape");
  await tid(page, "plan-fit").click();
  await page.waitForTimeout(100);
  const slop = touch ? { x: 12, y: 10 } : { x: 6, y: 5 }; // off the corner by less than the snap reach
  const cA = await toScreen(page, { x: 0, y: 0 });
  const cB = await toScreen(page, { x: 4, y: 0 });
  await tap({ x: cA.x + slop.x, y: cA.y + slop.y });
  await tap({ x: cB.x - slop.x, y: cB.y + slop.y });
  const snapped = (await overlay())!;
  assert.deepEqual([snapped.a, snapped.b], [{ x: 0, y: 0 }, { x: 4, y: 0 }], `${tag}: two imprecise taps snapped to the corners`);
  assert.equal(await value(), "4.00 m", `${tag}: so the value is exact`);
  const bAt = await centre("measure-point-b");
  const grab = { x: bAt.x + 8, y: bAt.y + 6 }; // off-centre, inside the marker's reach
  const to = { x: grab.x - 30, y: grab.y + 45 };
  await drag(grab, to);
  const moved = (await overlay())!;
  assert.deepEqual(moved.a, { x: 0, y: 0 }, `${tag}: dragging marker b leaves a alone`);
  // The marker moves by the drag's distance: it does not jump to the finger.
  const want = { x: snapped.b!.x + (to.x - grab.x) / (await cam(page)).scale, y: snapped.b!.y + (to.y - grab.y) / (await cam(page)).scale };
  assert.ok(dist(moved.b!, want) < 0.03, `${tag}: and b moves by the drag distance (${moved.b!.x.toFixed(2)}, ${moved.b!.y.toFixed(2)} vs ${want.x.toFixed(2)}, ${want.y.toFixed(2)})`);
  near(moved.metres, dist(moved.a, moved.b!), 1e-3, `${tag}: with the value updated (${await value()})`);

  // ---- a diagonal, then a vertical, each replacing the one before
  // (the vertical starts 0.5 m from the diagonal's first marker: a tap near a marker that
  // does not drag it is still a tap, so it starts a new measurement)
  await tap(await toScreen(page, { x: 5.5, y: 1.5 }));
  assert.equal(await tid(page, "measure-line").count(), 0, `${tag}: a tap after a finished measurement starts a new one`);
  await tap(await toScreen(page, { x: 8.5, y: 3.5 }));
  const diag = (await overlay())!;
  near(diag.metres, Math.sqrt(13), 0.04, `${tag}: diagonal ${Math.sqrt(13).toFixed(2)} m (${await value()})`);
  await tap(await toScreen(page, { x: 5.5, y: 1 }));
  await tap(await toScreen(page, { x: 5.5, y: 4 }));
  const vert = (await overlay())!;
  near(vert.metres, 3, 0.04, `${tag}: vertical 3 m (${await value()})`);
  assert.equal(await tid(page, "measure-overlay").count(), 1, `${tag}: only one measurement at a time`);

  // ---- cancel: Escape on a keyboard, the Clear button on a phone
  if (touch) {
    await tid(page, "measure-clear").tap();
  } else {
    await page.keyboard.press("Escape");
  }
  assert.equal(await tid(page, "measure-overlay").count(), 0, `${tag}: ${touch ? "Clear" : "Escape"} removes the measurement`);
  assert.equal(await tid(page, "tool-measure").getAttribute("aria-pressed"), "true", `${tag}: and the tool stays on`);
  assert.match(await tid(page, "measure-hint").innerText(), /first point/, `${tag}: ready for the next one`);
  if (!touch) {
    // Escape with the focus somewhere else on the page still cancels
    await tap(await toScreen(page, { x: 5.5, y: 1.5 }));
    await tid(page, "tool-measure").focus();
    await page.keyboard.press("Escape");
    assert.equal(await tid(page, "measure-overlay").count(), 0, `${tag}: Escape works from the tool rail too`);
    // Nothing left to cancel: a second Escape goes back to Select, like the Wall, Door and Window tools.
    await tid(page, "plan-canvas").focus();
    await page.keyboard.press("Escape");
    assert.equal(await tid(page, "tool-select").getAttribute("aria-pressed"), "true", `${tag}: a second Escape goes back to Select`);
    await tid(page, "tool-measure").click();
    assert.equal(await tid(page, "tool-measure").getAttribute("aria-pressed"), "true", `${tag}: and Measure can be picked again`);
  }

  // ---- measuring edits nothing: not by dragging over a wall, not by tapping a door
  const wall = await wallOf(page, "w-HI");
  const wm = await toScreen(page, mid(wall));
  await drag(wm, { x: wm.x, y: wm.y + 40 });
  assert.equal(await tid(page, "plan-selection").count(), 0, `${tag}: a drag over a wall selects nothing in Measure`);
  assert.equal(await tid(page, "wall-handle").count(), 0, `${tag}: and shows no handles`);
  await tid(page, "plan-fit").click();
  await page.waitForTimeout(100);
  await tap(await toScreen(page, { x: 7, y: 0 })); // the front door d-front, on w-BC
  assert.equal((await overlay())!.a.y, 0, `${tag}: a tap on a door only places a point`);
  await tid(page, "measure-clear").click();
  assert.deepEqual(await editorState(page), start, `${tag}: plan, undo history, redo history and selection are exactly as before`);
  assert.equal(await tid(page, "wall-panel").count(), 0, `${tag}: no wall panel opened`);

  // ---- undo has nothing to do with a measurement
  await tap(await toScreen(page, A));
  await tap(await toScreen(page, B));
  await page.keyboard.press("Control+z");
  assert.ok(await overlay(), `${tag}: Ctrl+Z leaves the measurement alone`);
  assert.deepEqual(await editorState(page), start, `${tag}: and the history is still as it was`);

  // ---- leaving the tool clears the measurement, and Select works as before
  if (touch) await tid(page, "tool-select").tap();
  else await tid(page, "tool-select").click();
  assert.equal(await tid(page, "measure-overlay").count(), 0, `${tag}: switching to Select clears the measurement`);
  assert.equal(await tid(page, "measure-hint").count(), 0, `${tag}: and the hint`);
  assert.equal(await tid(page, "plan-canvas").getAttribute("data-tool"), "select");
  await tap(await toScreen(page, mid(wall)));
  assert.equal(await selectedId(page), "w-HI", `${tag}: clicking a wall selects it again`);
  await page.keyboard.press("Escape");
  assert.equal(await selectedId(page), null);
  assert.deepEqual(await editorState(page), start, `${tag}: still nothing changed in the plan or history`);
  assert.ok(await noSideScroll(), `${tag}: no horizontal scroll with Measure in use`);
  console.log(`${tag}: measure ok (${touch ? "real touch events" : "mouse"}; 4.00 m line, diagonal ${diag.metres.toFixed(2)} m)`);
}

// ---- autosave and restore (step 4.6)

/**
 * A fresh browser (empty localStorage). Edits the plan name, a room name and a
 * wall with the real UI, waits for the on-screen save status to say "saved",
 * reloads, and checks the edits are back. Nothing is written to storage or
 * pushed through a store API by this test: localStorage is only READ, to see that
 * nothing is saved before an edit and something is after it. Reloads twice, so
 * selection (while Select is active) and the Measure tool (with a point placed) are
 * each checked to be forgotten, along with the 2D zoom and the undo history.
 */
async function checkAutosave() {
  const tag = "1440 autosave";
  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => errors.push(`${tag} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag} console: ${m.text().slice(0, 200)}`));
  const stored = () => page.evaluate(() => localStorage.getItem("atrium-v2:plan")); // read only
  const status = () => tid(page, "save-status").getAttribute("data-state");
  const open = async () => {
    await page.waitForSelector("canvas");
    await tid(page, "plan-name").waitFor();
    await page.waitForTimeout(500);
  };

  await page.goto(`${BASE}/studio`);
  await open();
  assert.equal(await stored(), null, `${tag}: nothing is saved right after mounting the editor`);
  await page.waitForTimeout(1500); // well past the 800 ms debounce: a write caused by mounting alone would have landed by now
  assert.equal(await stored(), null, `${tag}: and still nothing after the debounce: mounting the editor does not create a save`);
  assert.equal(await status(), "idle", `${tag}: and the status is quiet`);
  assert.equal((await plan(page)).name, "Two-bedroom house", `${tag}: the sample plan is what loads when nothing is saved`);

  // ---- three real edits: the plan name, a room name, a wall
  await tid(page, "plan-name").fill("Flat on Elm Street");
  await tid(page, "plan-name").press("Enter");
  assert.equal(await status(), "pending", `${tag}: an edit makes the save pending`);
  assert.equal(await stored(), null, `${tag}: and nothing is written inline: saving waits out a short delay`);
  const roomId = (await plan(page)).rooms[0].id;
  await tid(page, "room-name-0").fill("Study");
  await tid(page, "room-name-0").press("Enter");
  await tid(page, "view-2d").click();
  await tid(page, "plan-svg").waitFor();
  await page.waitForTimeout(300);
  const fitCam = await cam(page);
  const target = await wallOf(page, "w-HI");
  const from = await toScreen(page, mid(target));
  await mouseDrag(page, from, await toScreen(page, { x: mid(target).x, y: mid(target).y + 1 })); // slide the wall 1 m south
  assert.equal(await selectedId(page), "w-HI", `${tag}: the dragged wall is selected`);
  const edited = await plan(page);
  const wall = edited.walls.find((w) => w.id === "w-HI")!;
  near(wall.a.y, target.a.y + 1, 0.12, `${tag}: the wall really moved`);
  assert.equal(await status(), "pending", `${tag}: the drag leaves a save pending`);
  await page.waitForSelector('[data-testid="save-status"][data-state="saved"]', { timeout: 6000 });
  const raw = JSON.parse((await stored())!);
  assert.equal(raw.schema, 1, `${tag}: the save carries a schema marker`);
  assert.deepEqual(Object.keys(raw).sort(), ["plan", "savedAt", "schema"], `${tag}: and holds only the plan`);
  assert.equal(raw.plan.name, "Flat on Elm Street");
  // The write itself, read straight from the browser's storage: it holds the room name and the moved wall
  // (this is the proof that the app wrote the edits; the test never writes storage).
  assert.equal(raw.plan.rooms.find((r: { id: string }) => r.id === roomId).name, "Study", `${tag}: the stored plan has the new room name`);
  assert.deepEqual(raw.plan.walls, edited.walls, `${tag}: and the edited walls, exactly`);
  assert.deepEqual(raw.plan.openings, edited.openings, `${tag}: and the openings`);

  // temporary state to leave behind: a selected wall (still selected), a zoomed 2D camera
  await page.mouse.move(from.x, from.y);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(100);
  assert.ok((await cam(page)).scale > fitCam.scale * 1.2, `${tag}: the 2D view is zoomed`);
  assert.equal(await selectedId(page), "w-HI");

  // ---- reload 1
  await page.reload();
  await open();
  assert.equal(await tid(page, "plan-name").inputValue(), "Flat on Elm Street", `${tag}: the plan name is restored`);
  assert.equal(await tid(page, "room-name-0").inputValue(), "Study", `${tag}: the room name is restored`);
  const back = await plan(page);
  assert.equal(back.rooms.find((r) => r.id === roomId)!.name, "Study");
  assert.deepEqual(back.walls, edited.walls, `${tag}: the moved wall, and every other wall, is restored exactly`);
  assert.deepEqual(back.openings, edited.openings, `${tag}: openings too`);
  assert.deepEqual(back.rooms, edited.rooms, `${tag}: and the rooms with their names`);
  assert.equal(await tid(page, "undo").isDisabled(), true, `${tag}: undo history starts empty after a reload`);
  assert.equal(await tid(page, "redo").isDisabled(), true, `${tag}: and so does redo`);
  const hist = await editorState(page);
  assert.deepEqual([hist.past, hist.future], [0, 0], `${tag}: both history stacks are empty (restoring and autosaving added no entries)`);
  assert.equal(await status(), "idle", `${tag}: restoring did not write anything back`);
  assert.equal(await selectedId(page), null, `${tag}: the wall selection is not restored`);
  assert.equal(await tid(page, "tool-select").getAttribute("aria-pressed"), "true", `${tag}: Select is the tool`);
  await tid(page, "view-2d").click();
  await tid(page, "plan-svg").waitFor();
  await page.waitForTimeout(300);
  assert.equal(await tid(page, "plan-canvas").getAttribute("data-selected"), "", `${tag}: and the 2D plan shows no selection`);
  assert.equal(await tid(page, "plan-selection").count(), 0);
  const camBack = await cam(page);
  near(camBack.scale, fitCam.scale, 0.001, `${tag}: the 2D zoom is not restored: the plan is fitted again`);
  near(camBack.tx, fitCam.tx, 0.01, `${tag}: nor is the 2D pan (x)`);
  near(camBack.ty, fitCam.ty, 0.01, `${tag}: nor (y)`);
  assert.ok((await labels(page)).some((l) => l.name === "Study"), `${tag}: the restored name is on the 2D plan`);
  assert.equal(await tid(page, "plan-wall").count(), back.walls.length);
  await page.screenshot({ path: `${OUT}/studio-1440-reload.png` });

  // ---- reload 2: the Measure tool and a placed point are forgotten too
  await tid(page, "tool-measure").click();
  await page.mouse.click(...(Object.values(await toScreen(page, { x: 5.5, y: 1.5 })) as [number, number]));
  assert.equal(await tid(page, "measure-point-a").count(), 1, `${tag}: a measurement point is placed`);
  assert.equal(await tid(page, "tool-measure").getAttribute("aria-pressed"), "true");
  assert.equal(await status(), "idle", `${tag}: measuring does not trigger a save`);
  await page.waitForTimeout(1200); // longer than the save delay
  assert.equal(await status(), "idle", `${tag}: not even after the delay`);
  await page.reload();
  await open();
  assert.equal(await tid(page, "plan-name").inputValue(), "Flat on Elm Street", `${tag}: the plan is still restored after a second reload`);
  assert.equal(await tid(page, "tool-measure").getAttribute("aria-pressed"), "false", `${tag}: the Measure tool is not restored`);
  assert.equal(await tid(page, "tool-select").getAttribute("aria-pressed"), "true", `${tag}: Select is the tool again`);
  await tid(page, "view-2d").click();
  await tid(page, "plan-svg").waitFor();
  assert.equal(await tid(page, "measure-overlay").count(), 0, `${tag}: the measurement is gone`);
  assert.deepEqual((await plan(page)).walls, edited.walls, `${tag}: walls are still the edited ones`);
  console.log(`${tag}: ok (plan name, room name and moved wall restored; selection, tool, measurement and zoom not)`);
  await browser.close();
}

// ---- a flipped door keeps its swing side through the real autosave and reload (regression)

/**
 * Opening.swing (step 4.5) is user data that the autosave reader (step 4.6) had
 * to learn to keep: before that fix a flipped door came back "left" after every
 * reload. Fresh browser; at 1440 in Split, selecting the door in the RIGHT 2D pane
 * (a phone has no Split, so at 390 it is the 2D view and real touch taps). Select the
 * Bedroom 1 door, press Flip in the panel, wait out the real 800 ms autosave, RELOAD, select the
 * same door again and check the panel and the plan carry the flipped side and nothing else
 * about the door changed. Nothing is written to storage or flipped through a store
 * call by this test: localStorage and the store are only READ.
 */
async function checkSwingPersists(width: number, height: number, touch: boolean) {
  const tag = `${width} swing`;
  const doorId = "d-bed1";
  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: touch });
  page.on("pageerror", (e) => errors.push(`${tag} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag} console: ${m.text().slice(0, 200)}`));
  const press = async (q: Pt) => {
    if (touch) await page.touchscreen.tap(q.x, q.y);
    else await page.mouse.click(q.x, q.y);
    await page.waitForTimeout(touch ? 350 : 50);
  };
  const doorOf = async () => (await plan(page)).openings.find((o) => o.id === doorId)!;
  const stored = () => page.evaluate(() => localStorage.getItem("atrium-v2:plan")); // read only
  /** Load /studio and bring up the 2D plan: Split (door picked in its right pane) on a wide screen, the 2D view on a phone. */
  const openPlan = async () => {
    await page.goto(`${BASE}/studio`);
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }); // the dev badge swallows phone taps
    await tid(page, "plan-name").waitFor();
    await page.waitForSelector("canvas");
    if (touch) {
      await tid(page, "view-2d").click();
      await tid(page, "plan-svg").waitFor();
      await page.getByRole("button", { name: /Plan details/ }).click(); // the phone sheet holds the inspector
    } else {
      await tid(page, "view-split").click();
      await tid(page, "plan-svg").waitFor();
    }
    await page.waitForTimeout(700); // the canvas refits after the view switch
  };
  /** Click the door's opening in the 2D plan, and say which pane it was in. */
  const selectDoor = async () => {
    const c = await page.evaluate((id) => {
      const r = document.querySelector(`[data-testid="plan-gap"][data-opening="${id}"]`)!.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, doorId);
    if (!touch) {
      const [p2d, p3d] = [await box(page, "pane-2d"), await box(page, "pane-3d")];
      assert.ok(c.x >= p2d.x && c.x <= p2d.x + p2d.width && c.x > p3d.x + p3d.width - 1, `${tag}: the door is picked in the right-hand 2D pane`);
    }
    await press(c);
    await tid(page, "opening-panel").waitFor({ state: "visible" });
    assert.equal(await tid(page, "opening-type").innerText(), "Door", `${tag}: the panel is the door's`);
    assert.equal(await page.evaluate(() => (window as Win).__selectionStore!.getState().openingId), doorId, `${tag}: and it is ${doorId}`);
  };

  await openPlan();
  assert.equal(await stored(), null, `${tag}: nothing is saved yet in this fresh browser`);
  const original = await doorOf();
  assert.ok(original.swing === "left" || original.swing === "right", `${tag}: the sample door has a swing side`);
  const flippedSide = original.swing === "left" ? "right" : "left";

  // ---- select the door and flip it through the panel
  await selectDoor();
  assert.equal(await tid(page, "opening-swing").getAttribute("data-swing"), original.swing, `${tag}: the panel shows the initial swing (${original.swing})`);
  if (touch) {
    await tid(page, "opening-flip").scrollIntoViewIfNeeded();
    await tid(page, "opening-flip").tap();
  } else await tid(page, "opening-flip").click();
  assert.equal(await tid(page, "opening-swing").getAttribute("data-swing"), flippedSide, `${tag}: Flip changed the swing in the panel`);
  const flipped = await doorOf();
  assert.equal(flipped.swing, flippedSide, `${tag}: and in the plan`);
  assert.equal(await stored(), null, `${tag}: nothing is written inline: the save waits out its delay`);
  assert.equal(await tid(page, "save-status").getAttribute("data-state"), "pending", `${tag}: the save is pending`);

  // ---- the real autosave: wait for it, then read what it stored
  await page.waitForSelector('[data-testid="save-status"][data-state="saved"]', { timeout: 6000 });
  const inStorage = JSON.parse((await stored())!).plan.openings.find((o: Opening) => o.id === doorId);
  assert.equal(inStorage.swing, flippedSide, `${tag}: the autosaved plan in the browser's storage holds the flipped swing`);

  // ---- reload; the marker proves this is a new page, not the same JS context
  await page.evaluate(() => ((window as unknown as { __beforeReload?: number }).__beforeReload = 1));
  await openPlan(); // goto the same URL again: a full reload, then Split / 2D / the sheet
  assert.equal(await page.evaluate(() => (window as unknown as { __beforeReload?: number }).__beforeReload), undefined, `${tag}: the page really reloaded`);
  assert.equal(await tid(page, "undo").isDisabled(), true, `${tag}: with no undo history to supply the swing: it can only come from storage`);
  assert.equal(await page.evaluate(() => (window as Win).__selectionStore!.getState().openingId), null, `${tag}: and the door is not selected after the reload`);

  // ---- select the same door again, through the UI
  await selectDoor();
  assert.equal(await tid(page, "opening-panel").isVisible(), true, `${tag}: OpeningPanel is visible`);
  const after = await doorOf();
  assert.equal(after.swing, flippedSide, `${tag}: the reloaded door has the flipped swing (${flippedSide})`);
  assert.notEqual(after.swing, original.swing, `${tag}: not the original (${original.swing})`);
  assert.equal(await tid(page, "opening-swing").getAttribute("data-swing"), flippedSide, `${tag}: and the panel says so`);
  assert.deepEqual({ ...after, swing: original.swing }, original, `${tag}: wall (${original.wallId}), width, position and size are unchanged`);
  assert.equal(after.wallId, original.wallId);
  assert.equal(after.width, original.width);
  assert.equal(after.offset, original.offset);
  console.log(`${tag}: flipped door keeps its swing through autosave and reload (${original.swing} → ${flippedSide}; ${touch ? "real touch taps, 2D view" : "mouse, Split view, right pane"})`);
  await browser.close();
}

// ---- 3D Push/Pull (step 4.7a)

/**
 * The 3D Push/Pull tool on the wall top, with the mouse at 1440 and real touch at 390.
 * A fresh browser. The dev-only hooks are used ONLY to find where to point (a world
 * point's place on the page) and to read what is hovered and the real mesh's height;
 * every action is a real pointer or touch event: click the rail button, hover, press,
 * drag, release, click-move-click, type, Alt, Escape, a second finger, Ctrl+Z.
 * Wall tops are checked on the south wall (w-FG, w-LF, w-EL: one straight wall of three
 * pieces), pointing at the middle of w-LF. Highlights are checked by looking for
 * light-blue pixels in a real screenshot.
 */
async function checkPushPull(width: number, height: number, touch: boolean) {
  const tag = `${width} push/pull`;
  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: touch });
  page.on("pageerror", (e) => errors.push(`${tag} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag} console: ${m.text().slice(0, 200)}`));
  await page.goto(`${BASE}/studio`);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }); // the dev badge swallows phone taps
  await tid(page, "plan-name").waitFor();
  await page.waitForSelector("canvas");
  await page.waitForTimeout(1500); // the scene's first frames and the camera fit

  const RUN = ["w-FG", "w-LF", "w-EL"]; // the south wall: three pieces of one straight wall
  const MID = { x: 5.5, y: 2.7, z: 8 }; // the middle of w-LF's top
  const proj = (p: { x: number; y: number; z: number }) => page.evaluate((q) => (window as Win).__studio3d!.project(q), p);
  const heights = async () => {
    const walls = (await plan(page)).walls;
    return Object.fromEntries(walls.map((w) => [w.id, w.height])) as Record<string, number>;
  };
  const past = () => page.evaluate(() => (window as Win).__planStore!.getState().past.length);
  const hoverFace = () => page.evaluate(() => (window as Win).__pushPullDebug!.hoverFace);
  const active = () => page.evaluate(() => (window as Win).__pushPullDebug!.active);
  const meshTop = async (id: string) => (await page.evaluate((i) => (window as Win).__studio3d!.wallBox(i), id))!.maxY;
  const readLabel = async () => {
    const d = (await tid(page, "pushpull-distance").innerText()).trim();
    const h = (await tid(page, "pushpull-height").innerText()).trim();
    return { distance: parseFloat(d.replace("+", "")), height: parseFloat(h.replace("Height", "")), scope: (await tid(page, "pushpull-scope").innerText()).trim(), text: await tid(page, "pushpull-label").innerText() };
  };
  /** Light-blue pixels (the highlight) in a real screenshot of a small square around `c`. */
  const bluePixels = async (c: Pt) => {
    const r = 18;
    const clip = { x: Math.max(0, c.x - r), y: Math.max(0, c.y - r), width: 2 * r, height: 2 * r };
    const { data, info } = await sharp(await page.screenshot({ clip })).raw().toBuffer({ resolveWithObject: true });
    let n = 0;
    for (let i = 0; i < data.length; i += info.channels) if (data[i + 2] - data[i] > 45 && data[i + 2] > 170) n++;
    return n;
  };
  const tap = async (p: Pt) => {
    if (touch) await page.touchscreen.tap(p.x, p.y);
    else await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(touch ? 300 : 120);
  };
  const undo = async () => {
    if (touch) await tid(page, "undo").tap();
    else await page.keyboard.press("Control+z");
    await page.waitForTimeout(100);
  };
  const same = (a: Record<string, number>, b: Record<string, number>, msg: string) => assert.deepEqual(a, b, msg);
  const grow = (h: Record<string, number>, ids: string[], d: number) => ({ ...h, ...Object.fromEntries(ids.map((i) => [i, +(h[i] + d).toFixed(2)])) });

  // ---- choose the tool in the rail
  assert.equal(await tid(page, "tool-pushpull").getAttribute("aria-disabled"), "false", `${tag}: Push/Pull is enabled in the 3D view`);
  if (touch) await tid(page, "tool-pushpull").tap();
  else await tid(page, "tool-pushpull").click();
  assert.equal(await tid(page, "tool-pushpull").getAttribute("aria-pressed"), "true", `${tag}: the Push/Pull button is pressed`);
  assert.equal(await tid(page, "tool-select").getAttribute("aria-pressed"), "false", `${tag}: and Select is not`);
  assert.equal((await tid(page, "pushpull-status").innerText()).trim(), "Click a face to push or pull it. Type a distance and press Enter.", `${tag}: the status line says what to do`);
  assert.equal(await tid(page, "plan-wall").count(), 0, `${tag}: the 2D pane is not showing`);

  const base = await heights();
  const top = await proj(MID);
  assert.ok(top.x > 0 && top.x < width && top.y > 0 && top.y < height, `${tag}: the wall top is on screen at (${top.x.toFixed(0)}, ${top.y.toFixed(0)})`);
  // a finger is aimed 10 px past the thin strip, on empty floor beyond the wall, to show the 44 px target works; a mouse is exact
  const aim = touch ? { x: top.x, y: top.y - 10 } : top;

  // ---- hover (mouse): the debug hook says the role, a highlight is painted, the selection store is left alone
  if (!touch) {
    const calm = await bluePixels(top);
    await page.mouse.move(top.x, top.y);
    await page.waitForTimeout(250);
    assert.deepEqual(await hoverFace(), { wallId: "w-LF", role: "top" }, `${tag}: hovering the south wall top says role top`);
    assert.match(await tid(page, "pushpull-label").innerText(), /Wall top/, `${tag}: the label names it`);
    const lit = await bluePixels(top);
    assert.ok(lit > calm + 30, `${tag}: a light-blue highlight is painted on the face (${calm} → ${lit} blue pixels)`);
    assert.equal(await selectedId(page), null, `${tag}: hovering selected nothing`);
    assert.equal(await page.evaluate(() => (window as Win).__selectionStore!.getState().openingId), null);
    await page.screenshot({ path: `${OUT}/pushpull-hover-1440.png` });

    // a side face: highlighted, and (since 4.7c wired it) the label names it; checkWalls3d pulls it
    const side = await proj({ x: 5.5, y: 1.2, z: 8.1 });
    await page.mouse.move(side.x, side.y);
    await page.waitForTimeout(250);
    const f = await hoverFace();
    assert.ok(f && /^side/.test(f.role), `${tag}: hovering the wall's side face says ${f?.role}`);
    assert.match(await tid(page, "pushpull-label").innerText(), /Wall side/, `${tag}: and the label says Wall side`);
    assert.ok((await bluePixels(side)) > 30, `${tag}: the side face is highlighted too`);
    await page.mouse.move(top.x, top.y);
    await page.waitForTimeout(150);
  }

  // ---- press-drag up: the whole straight wall grows by the label's value, in the store and in the 3D mesh
  const meshBefore = await meshTop("w-LF");
  const drag1 = { x: aim.x, y: aim.y - 80 };
  let mid = { distance: 0, height: 0, scope: "", text: "" };
  const holdMid = async () => {
    await page.waitForTimeout(150);
    mid = await readLabel();
    assert.equal(await active(), true, `${tag}: a pull is active mid-drag`);
    await page.screenshot({ path: `${OUT}/pushpull-mid-drag-${width}.png` });
  };
  if (touch) await touchDrag(page, aim, drag1, holdMid);
  else {
    await page.mouse.move(aim.x, aim.y);
    await page.mouse.down();
    await page.mouse.move(aim.x, aim.y - 40, { steps: 5 });
    await page.mouse.move(drag1.x, drag1.y, { steps: 5 });
    await holdMid();
    await page.mouse.up();
  }
  await page.waitForTimeout(150);
  assert.ok(mid.distance > 0.3, `${tag}: pulling up grew the wall (label ${mid.distance} m)`);
  assert.equal(mid.scope, "Wall of 3 pieces", `${tag}: the label says Wall of 3 pieces`);
  near(mid.height, base["w-LF"] + mid.distance, 0.006, `${tag}: "Height" is the old height plus the distance`);
  const after1 = await heights();
  same(after1, grow(base, RUN, mid.distance), `${tag}: every piece of the straight wall grew by the label's value, nothing else changed`);
  for (const id of RUN) near(await meshTop(id), after1[id], 0.002, `${tag}: the 3D mesh of ${id} is that tall (world box)`);
  near(await meshTop("w-LF"), meshBefore + mid.distance, 0.002, `${tag}: and rose by the same amount`);
  assert.equal(await active(), false, `${tag}: releasing ended the pull`);
  assert.equal(await past(), 1, `${tag}: the whole drag is one history entry`);
  assert.equal(await selectedId(page), null, `${tag}: and selected nothing`);

  // ---- one undo restores every piece (Ctrl+Z, or the Undo button on a phone), and redo brings it back
  await undo();
  same(await heights(), base, `${tag}: one undo restores every height`);
  near(await meshTop("w-LF"), meshBefore, 0.002, `${tag}: and the 3D mesh`);
  assert.equal(await past(), 0);
  if (touch) await tid(page, "redo").tap();
  else await page.keyboard.press("Control+Shift+z");
  same(await heights(), after1, `${tag}: redo brings the pull back`);
  await undo();

  // ---- Escape (or a second finger) mid-drag cancels, with history unchanged
  const pastBefore = await past();
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    const pts = (...ps: Pt[]) => ps.map((p, i) => ({ x: p.x, y: p.y, id: i }));
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(aim) });
    for (let i = 1; i <= 5; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts({ x: aim.x, y: aim.y - 12 * i }) });
    assert.equal(await active(), true, `${tag}: a pull is active before the second finger`);
    assert.notDeepEqual(await heights(), base, `${tag}: and live in the plan`);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts({ x: aim.x, y: aim.y - 60 }, { x: aim.x - 90, y: aim.y - 130 }) }); // a second finger, away from the pointer's label and its 123 button
    await page.waitForTimeout(150);
    assert.equal(await active(), false, `${tag}: a second finger cancels the pull`);
    same(await heights(), base, `${tag}: and restores the heights`);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(aim.x, aim.y);
    await page.mouse.down();
    await page.mouse.move(aim.x, aim.y - 60, { steps: 5 });
    assert.equal(await active(), true, `${tag}: a pull is active before Escape`);
    assert.notDeepEqual(await heights(), base, `${tag}: and live in the plan`);
    await page.keyboard.press("Escape");
    assert.equal(await active(), false, `${tag}: Escape cancels the pull`);
    same(await heights(), base, `${tag}: and restores the heights`);
    await page.mouse.up();
  }
  assert.equal(await past(), pastBefore, `${tag}: and the history length is unchanged`);
  same(await heights(), base, `${tag}: still the original heights after the release`);
  await page.waitForTimeout(200);

  // ---- click-move-click: a click arms the pull, the pointer moves it, the next click commits
  await tap(aim);
  assert.equal(await active(), true, `${tag}: a click on the face arms a pull`);
  same(await heights(), base, `${tag}: with nothing changed yet`);
  assert.equal(await past(), pastBefore, `${tag}: and no history`);
  const second = { x: aim.x, y: aim.y - 60 };
  if (!touch) {
    await page.mouse.move(aim.x, aim.y - 30, { steps: 4 });
    await page.mouse.move(second.x, second.y, { steps: 4 });
    await page.waitForTimeout(100);
    const live = await readLabel();
    assert.ok(live.distance > 0.2, `${tag}: moving the pointer pulls (label ${live.distance} m)`);
    same(await heights(), grow(base, RUN, live.distance), `${tag}: live in the plan`);
    assert.equal(await past(), pastBefore + 1, `${tag}: as one history entry`);
    await page.mouse.click(second.x, second.y);
  } else {
    await tap(second); // on a phone the second tap is where the pointer is
  }
  await page.waitForTimeout(150);
  assert.equal(await active(), false, `${tag}: the second click ends it`);
  const afterClicks = await heights();
  assert.ok(afterClicks["w-LF"] > base["w-LF"] + 0.2, `${tag}: and the wall stays pulled (${afterClicks["w-LF"]})`);
  for (const id of RUN) assert.equal(afterClicks[id], afterClicks["w-LF"], `${tag}: ${id} is as tall as the rest of its wall`);
  assert.equal(await past(), pastBefore + 1, `${tag}: click-move-click is one undo step`);
  await undo();
  same(await heights(), base, `${tag}: and one undo undoes it`);

  // ---- type a distance: 0.3 then Enter makes it exactly 0.3 m taller. The pointer is ignored while typing.
  await tap(aim);
  assert.equal(await active(), true, `${tag}: a click arms the pull again`);
  if (touch) {
    await tid(page, "pushpull-123").waitFor();
    await tid(page, "pushpull-123").tap(); // phones have no keyboard to type into the canvas: the 123 button opens a field
    await tid(page, "pushpull-input").waitFor();
    await page.keyboard.type("0.3");
  } else {
    await page.keyboard.type("0.3"); // the 3D canvas has focus after the click
  }
  assert.match(await tid(page, "pushpull-typed").innerText(), /0\.3/, `${tag}: the typed text shows in the label`);
  assert.equal((await readLabel()).distance, 0.3, `${tag}: and previews +0.30 m`);
  await page.screenshot({ path: `${OUT}/pushpull-typed-${width}.png` });
  if (!touch) {
    await page.mouse.move(aim.x, aim.y - 100, { steps: 5 }); // the mouse keeps moving…
    await page.waitForTimeout(100);
    assert.equal((await readLabel()).distance, 0.3, `${tag}: …and is ignored while a number is typed`);
  }
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  assert.equal(await active(), false, `${tag}: Enter finishes`);
  same(await heights(), grow(base, RUN, 0.3), `${tag}: every piece is exactly 0.3 m taller (${base["w-LF"]} → ${(base["w-LF"] + 0.3).toFixed(2)})`);
  assert.equal(await past(), 1, `${tag}: one undo step`);
  await undo();
  same(await heights(), base, `${tag}: undone`);

  if (!touch) {
    // a negative distance, typed
    await tap(aim);
    await page.keyboard.type("-0.4");
    await page.keyboard.press("Enter");
    same(await heights(), grow(base, RUN, -0.4), `${tag}: typing -0.4 pushes the wall down 0.4 m`);
    await undo();

    // ---- Alt: only the picked piece
    await page.keyboard.down("Alt");
    await page.mouse.move(aim.x, aim.y);
    await page.mouse.down();
    await page.mouse.move(aim.x, aim.y - 40, { steps: 4 });
    await page.mouse.move(aim.x, aim.y - 80, { steps: 4 });
    await page.waitForTimeout(100);
    const alt = await readLabel();
    assert.equal(alt.scope, "This piece only", `${tag}: with Alt held the label says This piece only`);
    await page.mouse.up();
    await page.keyboard.up("Alt");
    const afterAlt = await heights();
    same(afterAlt, { ...base, "w-LF": +(base["w-LF"] + alt.distance).toFixed(2) }, `${tag}: Alt pulled w-LF alone (${alt.distance} m); its neighbours did not move`);
    await undo();
    same(await heights(), base, `${tag}: undone`);

    // pressing a face that can't be pulled does nothing but orbit: no pull, no history (last, because it moves the camera).
    // Until 4.7c this was a wall side ("Not yet"); 4.7c wired every visible wall face, so it is now the front door's
    // bottom, the one face that refuses ("A door stays on the floor").
    const doorFoot = await proj({ x: 7, y: 0, z: 0.1 }); // d-front's bottom, on w-BC's face towards the camera
    await page.mouse.move(doorFoot.x, doorFoot.y);
    await page.waitForTimeout(250);
    assert.deepEqual(await page.evaluate(() => (window as Win).__pushPullDebug!.hover), { wallId: "w-BC", openingId: "d-front", role: "sill" }, `${tag}: the pointer is on the door's bottom`);
    await page.mouse.down();
    await page.mouse.move(doorFoot.x, doorFoot.y - 40, { steps: 4 });
    assert.equal(await active(), false, `${tag}: a press on a face that can't be pulled starts no pull`);
    await page.mouse.up();
    assert.equal(await past(), 0, `${tag}: and records nothing`);

    // ---- an ordinary orbit drag from empty space still orbits, and starts no pull
    const marker = { x: 0, y: 0, z: 0 }; // a point away from the orbit's pivot (the plan's centre), which would not move
    const spot = await proj({ x: 6, y: 0, z: -2.5 }); // bare ground north of the house
    const pane = await box(page, "scene-3d");
    assert.ok(spot.x > pane.x + 20 && spot.x < pane.x + pane.width - 160 && spot.y > pane.y + 20 && spot.y < pane.y + pane.height - 20, `${tag}: the empty-ground spot (${spot.x.toFixed(0)}, ${spot.y.toFixed(0)}) is inside the 3D pane`);
    await page.mouse.move(spot.x, spot.y);
    await page.waitForTimeout(150);
    assert.equal(await hoverFace(), null, `${tag}: and over no wall`);
    const before = await proj(marker);
    await page.mouse.down();
    await page.mouse.move(spot.x + 120, spot.y - 20, { steps: 8 });
    assert.equal(await active(), false, `${tag}: a drag from empty space starts no pull`);
    await page.mouse.up();
    const moved = await proj(marker);
    assert.ok(Math.hypot(moved.x - before.x, moved.y - before.y) > 20, `${tag}: it orbited the camera (the floor moved ${Math.hypot(moved.x - before.x, moved.y - before.y).toFixed(0)} px on screen)`);
    assert.equal(await past(), 0, `${tag}: and recorded nothing`);
  }

  assert.deepEqual(await page.evaluate(() => (window as Win).__selectionStore!.getState().selectedId), null, `${tag}: nothing was ever selected`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${tag}: no horizontal scroll`);
  const railBox = await box(page, "tool-pushpull");
  assert.ok(railBox.x >= 0 && railBox.x + railBox.width <= width + 1, `${tag}: the Push/Pull button is inside the screen`);

  if (!touch) {
    // ---- P picks the tool; in the 2D-only view the button is disabled with a tooltip, and the tool steps back to Select
    await tid(page, "tool-select").click();
    await page.getByTestId("scene-3d").focus();
    await page.keyboard.press("p");
    assert.equal(await tid(page, "tool-pushpull").getAttribute("aria-pressed"), "true", `${tag}: the P key picks Push/Pull`);
    await tid(page, "view-2d").click();
    assert.equal(await tid(page, "tool-pushpull").getAttribute("aria-disabled"), "true", `${tag}: in the 2D-only view the button is disabled`);
    assert.equal(await tid(page, "tool-pushpull").getAttribute("aria-pressed"), "false", `${tag}: and the tool went back to Select`);
    assert.equal((await page.locator("#tip-pushpull").textContent())?.trim(), "Push/Pull works in the 3D view", `${tag}: with the tooltip that says why`);
    await page.keyboard.press("p");
    assert.equal(await tid(page, "tool-pushpull").getAttribute("aria-pressed"), "false", `${tag}: P does nothing in 2D`);
    await tid(page, "view-split").click();
    assert.equal(await tid(page, "tool-pushpull").getAttribute("aria-disabled"), "false", `${tag}: Split has a 3D pane: enabled again`);
    await tid(page, "tool-pushpull").click();
    assert.equal(await tid(page, "plan-svg").count(), 1, `${tag}: choosing Push/Pull in Split leaves the 2D pane showing`);
    // while walking the tool is inert
    await tid(page, "view-3d").click();
    await tid(page, "camera-walk").click();
    await page.waitForTimeout(400);
    assert.equal(await tid(page, "pushpull-overlay").count(), 0, `${tag}: in Walk the Push/Pull overlay is gone`);
    await page.mouse.move(top.x, top.y);
    assert.equal(await hoverFace(), null, `${tag}: and nothing is hovered`);
    await tid(page, "walk-exit").click();
  }
  console.log(`${tag}: ok (${touch ? "real touch events, a finger 10 px off the strip, second finger, 123 field" : "mouse, hover highlight by pixels, drag, Escape, click-move-click, typing, Alt, orbit"})`);
  await browser.close();
}

// ---- 3D door and window faces, the Move tool, 3D opening selection (step 4.7b)

/**
 * Door and window faces with Push/Pull, the Move tool, and selecting a door or window
 * in 3D, with the mouse at 1440 and real touch at 390. A fresh browser. The dev-only
 * hooks are used ONLY to find where to point (a world point's place on the page), to
 * read what is hovered and to read the real meshes; every action is a real pointer,
 * touch or key event.
 * The window is win-bath on the south wall w-EL, which runs east to west (E(10,8) to
 * L(7,8)): from the default camera its RIGHT jamb is the east one, at x 8.8, which is
 * jambA (the edge nearer the wall's a end), and its left jamb (x 8.2) is jambB. The
 * door is d-front on the north wall w-BC (x 6.5–7.5), 0.9 m short of win-living-n.
 * 1440: hover the right jamb (debug role, the blue edge line in pixels), drag it out
 * about 60 px (width grows by the label's value, the other edge stays, the frame mesh
 * matches, the window becomes the selection), Ctrl+Z, Escape mid-drag, typed 0.2 then
 * Enter, the top pulled past the wall (clamped, reason shown), the sill pulled down
 * (head stays), a door's bottom (refused with its reason); Move: a wall says why not,
 * the door slides along its wall about 80 px and stops at the window with the reason;
 * Select in Split: a click on the window selects it in the panel and the 2D pane, a
 * 40 px orbit drag selects nothing; Walk: both 3D tools disabled and the tool back
 * to Select. 390 (real touch): the jamb drag, a Move, a Select tap, a touch orbit
 * drag, and Walk.
 */
async function checkOpenings3d(width: number, height: number, touch: boolean) {
  const tag = `${width} openings 3D`;
  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: touch });
  page.on("pageerror", (e) => errors.push(`${tag} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag} console: ${m.text().slice(0, 200)}`));
  await page.goto(`${BASE}/studio`);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }); // the dev badge swallows phone taps
  await tid(page, "plan-name").waitFor();
  await page.waitForSelector("canvas");
  await page.waitForTimeout(1500); // the scene's first frames and the camera fit

  const W3 = { x: 0, y: 0, z: 0 };
  type P3 = typeof W3;
  const proj = (p: P3) => page.evaluate((q) => (window as Win).__studio3d!.project(q), p);
  const op = async (id: string) => (await plan(page)).openings.find((o) => o.id === id)!;
  const past = () => page.evaluate(() => (window as Win).__planStore!.getState().past.length);
  const debug = () => page.evaluate(() => { const d = (window as Win).__pushPullDebug!; return { tool: d.tool, hover: d.hover, active: d.active }; });
  const meshBox = async (id: string) => (await page.evaluate((i) => (window as Win).__studio3d!.openingBox(i), id))!;
  const openingSel = () => page.evaluate(() => (window as Win).__selectionStore!.getState().openingId);
  const text = async (id: string) => ((await tid(page, `pushpull-${id}`).count()) ? (await tid(page, `pushpull-${id}`).innerText()).trim() : "");
  const unit = (a: Pt, b: Pt) => { const n = Math.hypot(b.x - a.x, b.y - a.y); return { x: (b.x - a.x) / n, y: (b.y - a.y) / n }; };
  const along = (p: Pt, u: Pt, px: number) => ({ x: p.x + u.x * px, y: p.y + u.y * px });
  const hoverAt = async (p: Pt) => {
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(250);
  };
  /** A press-drag-release: the mouse in steps, or Chromium's own touch input. */
  const drag = async (from: Pt, to: Pt, hold?: () => Promise<void>) => {
    if (touch) return touchDrag(page, from, to, hold);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
    await page.mouse.move(to.x, to.y, { steps: 5 });
    if (hold) await hold();
    await page.mouse.up();
  };
  const tap = async (p: Pt) => {
    if (touch) await page.touchscreen.tap(p.x, p.y);
    else await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(touch ? 300 : 150);
  };
  const press = async (id: string) => {
    if (touch) await tid(page, id).tap();
    else await tid(page, id).click();
    await page.waitForTimeout(150);
  };
  const undo = async () => {
    if (touch) await tid(page, "undo").tap();
    else await page.keyboard.press("Control+z");
    await page.waitForTimeout(150);
  };
  /** Light-blue pixels (the tool's highlight colour) in a real screenshot of a small square around `c`. */
  const bluePx = async (c: Pt) => {
    const r = 18;
    const clip = { x: Math.max(0, c.x - r), y: Math.max(0, c.y - r), width: 2 * r, height: 2 * r };
    const { data, info } = await sharp(await page.screenshot({ clip })).raw().toBuffer({ resolveWithObject: true });
    let n = 0;
    for (let i = 0; i < data.length; i += info.channels) if (data[i + 2] - data[i] > 45 && data[i + 2] > 170) n++;
    return n;
  };
  const inPane = async (p: Pt, what: string) => {
    const pane = await box(page, "scene-3d");
    assert.ok(p.x > pane.x + 4 && p.x < pane.x + pane.width - 4 && p.y > pane.y + 4 && p.y < pane.y + pane.height - 4, `${tag}: ${what} is inside the 3D pane at (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`);
  };

  const WIN = "win-bath"; // on w-EL, south face at z = 8.1
  const win0 = await op(WIN);
  const fixedB = (o: Opening) => o.offset + o.width / 2; // jambB's place along the wall: it must not move when jambA is pulled
  const right = await proj({ x: 8.8, y: 1.5, z: 8.1 }); // jambA, the east side, half-way up
  const left = await proj({ x: 8.2, y: 1.5, z: 8.1 }); // jambB
  const outward = unit(left, right); // along the wall on screen, away from the window's middle past its right side
  await inPane(right, "the window's right jamb");

  // ---- Push/Pull on the window's right jamb
  await press("tool-pushpull");
  assert.equal(await tid(page, "tool-pushpull").getAttribute("aria-pressed"), "true", `${tag}: Push/Pull chosen`);
  if (!touch) {
    const calm = await bluePx(right);
    await hoverAt(right);
    assert.deepEqual((await debug()).hover, { wallId: "w-EL", openingId: WIN, role: "jambA" }, `${tag}: hovering the window's right jamb resolves to jambA (w-EL runs east to west, so the east side is its A side)`);
    assert.equal((await debug()).tool, "pushpull");
    assert.equal(await tid(page, "pushpull-edge").count(), 1, `${tag}: the edge line is drawn`);
    const lit = await bluePx(right);
    assert.ok(lit > calm + 20, `${tag}: and it is visible: ${calm} → ${lit} light-blue pixels round the jamb`);
    assert.equal(await text("face"), "Opening side", `${tag}: the label names it`);
    assert.equal(await openingSel(), null, `${tag}: hovering selected nothing`);
    await page.screenshot({ path: `${OUT}/pushpull-jamb-hover-1440.png` });
  }

  // press-drag outward: the window grows by the label's value, its left side stays, the frame mesh follows
  let mid = { distance: 0, value: "", fixed: "" };
  const pullOut = along(right, outward, touch ? 40 : 60);
  await drag(right, pullOut, async () => {
    await page.waitForTimeout(150);
    assert.equal((await debug()).active, true, `${tag}: a pull is active mid-drag`);
    mid = { distance: parseFloat((await text("distance")).replace("+", "")), value: await text("value"), fixed: await text("fixed") };
    await page.screenshot({ path: `${OUT}/pushpull-jamb-mid-drag-${width}.png` });
  });
  await page.waitForTimeout(200);
  const w1 = await op(WIN);
  assert.ok(mid.distance > 0.1, `${tag}: dragging the right jamb outward pulled it out (label ${mid.distance} m)`);
  near(w1.width, win0.width + mid.distance, 1e-6, `${tag}: the width grew by exactly the label's value`);
  assert.equal(mid.value, `Width ${w1.width.toFixed(2)} m`, `${tag}: the label stated the resulting width`);
  assert.equal(mid.fixed, "Fixed: the side nearer the wall's end", `${tag}: and which side stays`);
  near(fixedB(w1), fixedB(win0), 1e-9, `${tag}: the left (fixed) side did not move`);
  const m1 = await meshBox(WIN);
  near(m1.maxX - m1.minX, w1.width, 0.002, `${tag}: the 3D frame is that wide`);
  near(m1.minX, 10 - fixedB(win0), 0.002, `${tag}: and its left side is still at x ${(10 - fixedB(win0)).toFixed(2)}`);
  assert.equal(await past(), 1, `${tag}: the whole drag is one history entry`);
  assert.equal(await openingSel(), WIN, `${tag}: and the window is now selected, so the panel shows its numbers`);
  if (!touch) near(parseFloat(await tid(page, "opening-width").inputValue()), w1.width, 1e-9, `${tag}: the OpeningPanel shows the new width`);

  // one undo restores it
  await undo();
  assert.deepEqual(await op(WIN), win0, `${tag}: one undo restores the window exactly`);
  near((await meshBox(WIN)).maxX - (await meshBox(WIN)).minX, win0.width, 0.002, `${tag}: and its frame`);
  assert.equal(await past(), 0);

  if (!touch) {
    // ---- Escape mid-drag: history unchanged
    await page.mouse.move(right.x, right.y);
    await page.mouse.down();
    await page.mouse.move(along(right, outward, 45).x, along(right, outward, 45).y, { steps: 5 });
    assert.equal((await debug()).active, true, `${tag}: a pull is active before Escape`);
    assert.notEqual((await op(WIN)).width, win0.width, `${tag}: and live in the plan`);
    await page.keyboard.press("Escape");
    assert.equal((await debug()).active, false, `${tag}: Escape cancels the pull`);
    await page.mouse.up();
    assert.deepEqual(await op(WIN), win0, `${tag}: the window is as it was`);
    assert.equal(await past(), 0, `${tag}: and history is unchanged`);

    // ---- typed 0.2, then Enter: exactly 0.2 m wider, the left side still fixed
    await page.mouse.click(right.x, right.y); // a click arms the pull and gives the 3D pane the keyboard
    assert.equal((await debug()).active, true, `${tag}: a click on the jamb arms a pull`);
    await page.keyboard.type("0.2");
    assert.match(await text("typed"), /0\.2/);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
    const typed = await op(WIN);
    near(typed.width, win0.width + 0.2, 1e-9, `${tag}: typed 0.2 widened it by exactly 0.2 m`);
    near(fixedB(typed), fixedB(win0), 1e-9, `${tag}: with the left side fixed`);
    assert.equal(await past(), 1, `${tag}: one undo step`);
    await undo();
    assert.deepEqual(await op(WIN), win0);

    // ---- the top pulled up past the wall: clamped, and the label says why
    const head = await proj({ x: 8.5, y: 2.1, z: 8.1 });
    await hoverAt(head);
    assert.equal((await debug()).hover?.role, "head", `${tag}: the window's top edge resolves to head`);
    let headNote = "";
    await drag(head, { x: head.x, y: head.y - 160 }, async () => {
      await page.waitForTimeout(150);
      headNote = await text("note");
      assert.ok(await tid(page, "pushpull-note").isVisible(), `${tag}: the reason is visible on screen`);
      assert.equal(await text("value"), "Height 1.80 m", `${tag}: the label says the clamped height`);
    });
    assert.equal(headNote, "Wall is 2.70 m high", `${tag}: pulling the top past the wall says why it stopped`);
    const tall = await op(WIN);
    assert.deepEqual([tall.sillHeight, tall.height], [0.9, 1.8], `${tag}: the top stopped at the wall's top; the sill stayed`);
    await undo();

    // ---- the sill pulled down: the sill lowers, the head stays
    const sill = await proj({ x: 8.5, y: 0.9, z: 8.1 });
    await hoverAt(sill);
    assert.equal((await debug()).hover?.role, "sill", `${tag}: the window's bottom edge resolves to sill`);
    let sillValue = "";
    await drag(sill, { x: sill.x, y: sill.y + 40 }, async () => {
      await page.waitForTimeout(150);
      sillValue = await text("value");
    });
    const low = await op(WIN);
    assert.ok(low.sillHeight < win0.sillHeight - 0.1, `${tag}: pulling the sill down lowered it (${win0.sillHeight} → ${low.sillHeight})`);
    near(low.sillHeight + low.height, win0.sillHeight + win0.height, 1e-9, `${tag}: and the head stayed at ${win0.sillHeight + win0.height} m`);
    assert.equal(sillValue, `Sill ${low.sillHeight.toFixed(2)} m`, `${tag}: the label said the sill height`);
    await undo();
    assert.deepEqual(await op(WIN), win0);

    // ---- a door's bottom: it says why, and a click on it changes nothing (a click, so the camera is not orbited)
    const doorBottom = await proj({ x: 7, y: 0, z: 0.1 });
    await hoverAt(doorBottom);
    assert.deepEqual((await debug()).hover, { wallId: "w-BC", openingId: "d-front", role: "sill" }, `${tag}: a door's bottom edge is found`);
    assert.equal(await text("message"), "A door stays on the floor", `${tag}: and says "A door stays on the floor"`);
    await page.mouse.click(doorBottom.x, doorBottom.y);
    assert.equal((await debug()).active, false, `${tag}: pressing it starts no pull`);
    assert.equal(await past(), 0, `${tag}: and records nothing`);
  }

  // ---- Move: a door slides along its wall and stops at the window next to it
  const DOOR = "d-front";
  const door0 = await op(DOOR);
  await press("tool-move");
  assert.equal(await tid(page, "tool-move").getAttribute("aria-pressed"), "true", `${tag}: Move chosen`);
  assert.equal((await debug()).tool, "move");
  const doorTop = await proj({ x: 7, y: 2.07, z: 0.1 }); // the door frame's head, half-way along
  const wallDir = unit(await proj({ x: 6.5, y: 1, z: 0.1 }), await proj({ x: 7.5, y: 1, z: 0.1 })); // w-BC's a → b on screen
  await inPane(doorTop, "the front door");
  if (!touch) {
    await hoverAt(await proj({ x: 5.5, y: 2.7, z: 8 })); // the south wall's top (4.7c: its side face now moves the wall)
    assert.equal(await text("message"), "Pull the top with Push/Pull", `${tag}: Move over a wall top says why not`);
    assert.equal((await debug()).hover?.openingId, null);
    const calm = await bluePx(doorTop);
    await hoverAt(doorTop);
    assert.equal((await debug()).hover?.openingId, DOOR, `${tag}: Move hovers the door`);
    assert.equal(await text("face"), "Move this door");
    assert.ok((await bluePx(doorTop)) > calm + 20, `${tag}: and highlights it`);
  }
  let moveMid = { value: "", note: "", distance: 0 };
  await drag(doorTop, along(doorTop, wallDir, 80), async () => {
    await page.waitForTimeout(150);
    moveMid = { value: await text("value"), note: await text("note"), distance: parseFloat((await text("distance")).replace("+", "")) };
    if (!touch) await page.screenshot({ path: `${OUT}/move-door-mid-drag-1440.png` });
  });
  const door1 = await op(DOOR);
  const window1 = await op("win-living-n");
  assert.equal(door1.width, door0.width, `${tag}: moving does not resize`);
  assert.equal(door1.wallId, door0.wallId, `${tag}: and the door stays on its wall`);
  near(door1.offset - door0.offset, moveMid.distance, 1e-6, `${tag}: it moved by the label's distance (${moveMid.distance} m)`);
  assert.equal(moveMid.value, `Centre ${door1.offset.toFixed(2)} m from the wall start`, `${tag}: the label said where its centre is`);
  if (!touch) {
    near(door1.offset + door1.width / 2, window1.offset - window1.width / 2, 1e-9, `${tag}: about 80 px along the wall it stopped against the window`);
    assert.match(moveMid.note, /window next to it/, `${tag}: and said why ("${moveMid.note}")`);
  } else {
    assert.ok(door1.offset > door0.offset, `${tag}: a touch drag along the wall moved it towards the wall's end`);
  }
  assert.equal(await past(), 1, `${tag}: one history entry`);
  assert.equal(await openingSel(), DOOR, `${tag}: and the moved door is selected`);
  await undo();
  assert.deepEqual(await op(DOOR), door0, `${tag}: one undo puts it back`);

  // ---- Select in 3D: a click on the window selects it, in the panel and (Split) in the 2D pane
  await press("tool-select");
  if (!touch) {
    await tid(page, "view-split").click();
    await tid(page, "plan-svg").waitFor();
    await page.waitForTimeout(800); // the 3D camera refits to the narrower pane
  }
  await tap(await proj({ x: 8.5, y: 0, z: 9 })); // empty ground south of the house: clears whatever the tools selected
  assert.equal(await openingSel(), null, `${tag}: a click on empty ground clears the selection`);
  const glass = await proj({ x: 8.5, y: 1.5, z: 8 });
  await inPane(glass, "the window's glass");
  await tap(glass);
  assert.equal(await openingSel(), WIN, `${tag}: a click on the window in 3D selects it`);
  assert.equal(await selectedId(page), null, `${tag}: not the wall it sits in`);
  if (!touch) {
    assert.ok(await tid(page, "opening-panel").isVisible(), `${tag}: the OpeningPanel shows it`);
    assert.equal(await tid(page, "opening-type").innerText(), "Window");
    assert.equal(await tid(page, "plan-opening-selection").getAttribute("data-opening"), WIN, `${tag}: and the 2D pane selects it too`);
    await page.keyboard.press("Escape");
  } else {
    await page.getByRole("button", { name: /Plan details/ }).click();
    assert.ok(await tid(page, "opening-panel").isVisible(), `${tag}: the OpeningPanel shows it`);
    await page.getByRole("button", { name: /Plan details/ }).click();
    await tap(await proj({ x: 8.5, y: 0, z: 9 }));
  }
  assert.equal(await openingSel(), null, `${tag}: ${touch ? "a tap on empty ground" : "Escape"} clears it`);
  // an orbit drag that starts on the window and moves 40 px selects nothing
  await drag(glass, { x: glass.x + 40, y: glass.y });
  await page.waitForTimeout(200);
  assert.equal(await openingSel(), null, `${tag}: a 40 px orbit drag from the window selected no opening`);
  assert.equal(await selectedId(page), null, `${tag}: and no wall`);

  // ---- Walk: the 3D tools are disabled and the tool goes back to Select
  if (!touch) await tid(page, "view-3d").click();
  await press("tool-move");
  assert.equal(await tid(page, "tool-move").getAttribute("aria-pressed"), "true");
  await press("camera-walk");
  await page.waitForTimeout(400);
  assert.equal(await tid(page, "tool-select").getAttribute("aria-pressed"), "true", `${tag}: entering Walk switched the tool to Select`);
  for (const t of ["move", "pushpull"]) assert.equal(await tid(page, `tool-${t}`).getAttribute("aria-disabled"), "true", `${tag}: ${t} is disabled while walking`);
  assert.equal((await page.locator("#tip-move").textContent())?.trim(), "Exit Walk to use Move", `${tag}: with a tooltip that says why`);
  if (touch) await tid(page, "tool-move").tap({ force: true }); // a real tap on the disabled button: Playwright would otherwise refuse it
  else await tid(page, "tool-move").click({ force: true });
  assert.equal(await tid(page, "tool-move").getAttribute("aria-pressed"), "false", `${tag}: and choosing it does nothing`);
  if (!touch) {
    await page.keyboard.press("v");
    assert.equal(await tid(page, "tool-move").getAttribute("aria-pressed"), "false", `${tag}: nor does V`);
  }
  await press("walk-exit");
  assert.equal(await tid(page, "tool-move").getAttribute("aria-disabled"), "false", `${tag}: after Walk, Move is enabled again`);
  if (!touch) {
    await page.getByTestId("scene-3d").focus();
    await page.keyboard.press("v");
    assert.equal(await tid(page, "tool-move").getAttribute("aria-pressed"), "true", `${tag}: V picks Move`);
  }
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${tag}: no horizontal scroll`);
  const rail = await box(page, "tool-move");
  assert.ok(rail.x >= 0 && rail.x + rail.width <= width + 1, `${tag}: the Move button is inside the screen`);
  console.log(`${tag}: ok (${touch ? "real touch: jamb drag, Move, Select tap, touch orbit, Walk" : "mouse: jamb hover/drag/undo/Escape/typed, head clamp, sill, door bottom, Move to the neighbour, Select in Split, orbit, Walk"})`);
  await browser.close();
}

/**
 * Step 4.7c in the browser: wall side faces with Push/Pull (thickness, Shift = move), the Move tool on a wall
 * side and on a corner, hidden ends, orbit, Walk. Hooks only say where to point and what is hovered; every action
 * is real mouse, keyboard or touch input. Not covered here: typing a distance for a wall face (store tests only),
 * a free wall end (the sample has none; store tests only), Alt, click-move-click on a wall face, Shift at 390
 * (a phone has no Shift key), and a real phone.
 */
async function checkWalls3d(width: number, height: number, touch: boolean) {
  const tag = `${width} walls 3D`;
  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: touch });
  page.on("pageerror", (e) => errors.push(`${tag} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag} console: ${m.text().slice(0, 200)}`));
  await page.goto(`${BASE}/studio`);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }); // the dev badge swallows phone taps
  await tid(page, "plan-name").waitFor();
  await page.waitForSelector("canvas");
  await page.waitForTimeout(1500); // the scene's first frames and the camera fit

  type P3 = { x: number; y: number; z: number };
  const proj = (p: P3) => page.evaluate((q) => (window as Win).__studio3d!.project(q), p);
  const past = () => page.evaluate(() => (window as Win).__planStore!.getState().past.length);
  const debug = () => page.evaluate(() => { const d = (window as Win).__pushPullDebug!; return { tool: d.tool, hover: d.hover, active: d.active, corner: d.corner, exposed: d.exposed }; });
  const walls = async () => (await plan(page)).walls;
  const wallById = async (id: string) => (await walls()).find((w) => w.id === id)!;
  const text = async (id: string) => ((await tid(page, `pushpull-${id}`).count()) ? (await tid(page, `pushpull-${id}`).innerText()).trim() : "");
  const metres = (t: string) => parseFloat(t.replace(/[^\d.-]/g, ""));
  const unit = (a: Pt, b: Pt) => { const n = Math.hypot(b.x - a.x, b.y - a.y); return { x: (b.x - a.x) / n, y: (b.y - a.y) / n }; };
  const along = (p: Pt, u: Pt, px: number) => ({ x: p.x + u.x * px, y: p.y + u.y * px });
  const hoverAt = async (p: Pt) => {
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(250);
  };
  const drag = async (from: Pt, to: Pt, hold?: () => Promise<void>) => {
    if (touch) return touchDrag(page, from, to, hold);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
    await page.mouse.move(to.x, to.y, { steps: 5 });
    if (hold) await hold();
    await page.mouse.up();
    await page.waitForTimeout(150);
  };
  const press = async (id: string) => {
    if (touch) await tid(page, id).tap();
    else await tid(page, id).click();
    await page.waitForTimeout(150);
  };
  const undo = async () => {
    if (touch) await tid(page, "undo").tap();
    else await page.keyboard.press("Control+z");
    await page.waitForTimeout(150);
  };
  const inPane = async (p: Pt, what: string) => {
    const pane = await box(page, "scene-3d");
    assert.ok(p.x > pane.x + 4 && p.x < pane.x + pane.width - 4 && p.y > pane.y + 4 && p.y < pane.y + pane.height - 4, `${tag}: ${what} is inside the 3D pane at (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`);
  };
  /** Room name → the area the panel shows (m², one decimal). */
  const roomAreas = () =>
    page.evaluate(() => {
      const out: Record<string, number> = {};
      document.querySelectorAll('[data-testid^="room-area-"]').forEach((el) => {
        const i = el.getAttribute("data-testid")!.slice("room-area-".length);
        const nameEl = document.querySelector(`[data-testid="room-name-${i}"]`) as HTMLInputElement | null;
        const name = (nameEl?.value || nameEl?.textContent || "").trim();
        out[name] = parseFloat((el.textContent ?? "").replace(/[^\d.]/g, ""));
      });
      return out;
    });
  const base = await walls();
  const RUN = ["w-FG", "w-LF", "w-EL"]; // the south wall: three pieces of one straight wall, all running west (a → b is -x)

  // ---- Push/Pull on the south wall's OUTER face, dragged 40 px outward: thicker by the label's value, inner face fixed
  await press("tool-pushpull");
  const outer = await proj({ x: 5.5, y: 1.2, z: 8.1 }); // w-LF's south face, half-way up
  const outward = unit(outer, await proj({ x: 5.5, y: 1.2, z: 9.1 })); // +z (south) on screen
  await inPane(outer, "the south wall's outer face");
  if (!touch) {
    await hoverAt(outer);
    const d = await debug();
    assert.deepEqual(d.hover, { wallId: "w-LF", openingId: null, role: "sideRight" }, `${tag}: the outer face is w-LF's right side (w-LF runs west)`);
    assert.equal(d.exposed, true, `${tag}: and it is exposed`);
    assert.equal(await text("face"), "Wall side");
  }
  let mid = { distance: 0, value: "" };
  await drag(outer, along(outer, outward, 40), async () => {
    await page.waitForTimeout(150);
    mid = { distance: metres(await text("distance")), value: await text("value") };
    assert.equal((await debug()).active, true, `${tag}: a pull is active mid-drag`);
    if (!touch) await page.screenshot({ path: `${OUT}/wall-thickness-mid-drag-1440.png` });
  });
  assert.ok(mid.distance >= 0.05, `${tag}: pulling outward made it thicker (label +${mid.distance} m)`);
  const t1 = 0.2 + mid.distance;
  assert.equal(mid.value, `Thickness ${t1.toFixed(2)} m (opposite face fixed)`, `${tag}: the label says the new thickness`);
  for (const id of RUN) {
    const w = await wallById(id);
    near(w.thickness, t1, 1e-9, `${tag}: ${id} is thicker by the label's distance`);
    near(w.a.y - w.thickness / 2, 7.9, 1e-9, `${tag}: ${id}'s inner (north) face is still at y = 7.90`);
    near(w.a.y + w.thickness / 2, 8.1 + mid.distance, 1e-9, `${tag}: ${id}'s outer face moved out by the distance`);
  }
  // the real 3D mesh too: w-LF sits between two T-junctions (square ends), so its box spans exactly its two faces
  const mesh = (await page.evaluate(() => (window as Win).__studio3d!.wallBox("w-LF")))!;
  near(mesh.minZ, 7.9, 1e-4, `${tag}: the mesh's inner face is still at z = 7.90`);
  near(mesh.maxZ, 8.1 + mid.distance, 1e-4, `${tag}: the mesh's outer face moved out by the distance`);
  assert.equal(await past(), 1, `${tag}: the whole drag is one history entry`);
  await undo();
  assert.deepEqual(await walls(), base, `${tag}: one ${touch ? "Undo" : "Ctrl+Z"} restores every wall`);

  // ---- Escape (a second finger on a phone) mid-drag: nothing changes, history as it was
  const pastBefore = await past();
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    const pts = (...ps: Pt[]) => ps.map((p, i) => ({ x: p.x, y: p.y, id: i }));
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(outer) });
    for (let i = 1; i <= 5; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(along(outer, outward, 8 * i)) });
    assert.equal((await debug()).active, true, `${tag}: a pull is active before the second finger`);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(along(outer, outward, 40), { x: outer.x - 90, y: outer.y - 120 }) });
    await page.waitForTimeout(150);
    assert.equal((await debug()).active, false, `${tag}: a second finger cancels the pull`);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(outer.x, outer.y);
    await page.mouse.down();
    await page.mouse.move(...(Object.values(along(outer, outward, 40)) as [number, number]), { steps: 5 });
    assert.equal((await debug()).active, true, `${tag}: a pull is active before Escape`);
    assert.notDeepEqual(await walls(), base, `${tag}: and live in the plan`);
    await page.keyboard.press("Escape");
    assert.equal((await debug()).active, false, `${tag}: Escape cancels the pull`);
    await page.mouse.up();
  }
  await page.waitForTimeout(150);
  assert.deepEqual(await walls(), base, `${tag}: the walls are as they were`);
  assert.equal(await past(), pastBefore, `${tag}: and the history length is unchanged`);

  // ---- Shift-drag the partition between the bedrooms (1440: a phone has no Shift key): it MOVES, and the rooms change oppositely
  const part = await proj({ x: 2, y: 1.5, z: 4.05 }); // w-HI's south face (its left side: H → I runs east), in Bedroom 2
  const south = unit(part, await proj({ x: 2, y: 1.5, z: 5.05 }));
  await inPane(part, "the bedroom partition's south face");
  if (!touch) {
    await hoverAt(part);
    assert.deepEqual((await debug()).hover, { wallId: "w-HI", openingId: null, role: "sideLeft" }, `${tag}: the pointer is on the partition's south face`);
    const areas0 = await roomAreas();
    await page.keyboard.down("Shift");
    let moved = { distance: 0, value: "" };
    await drag(part, along(part, south, 40), async () => {
      await page.waitForTimeout(150);
      moved = { distance: metres(await text("distance")), value: await text("value") };
    });
    await page.keyboard.up("Shift");
    assert.equal(moved.value, `Wall moves ${moved.distance.toFixed(2)} m`, `${tag}: Shift: the label says the wall moves`);
    const hi = await wallById("w-HI");
    assert.equal(hi.thickness, 0.1, `${tag}: Shift keeps the thickness`);
    near(hi.a.y, 4 + moved.distance, 1e-9, `${tag}: the partition moved south by the label's distance`);
    const areas1 = await roomAreas();
    const d1 = areas1["Bedroom 1"] - areas0["Bedroom 1"];
    const d2 = areas1["Bedroom 2"] - areas0["Bedroom 2"];
    assert.ok(d1 > 0 && d2 < 0, `${tag}: Bedroom 1 grew (${d1.toFixed(1)}) and Bedroom 2 shrank (${d2.toFixed(1)}) in the panel`);
    near(d1, moved.distance * 3.85, 0.1, `${tag}: by about the distance × the 3.85 m face`);
    near(d2, -moved.distance * 3.85, 0.1, `${tag}: and the same the other way`);
    assert.equal(await past(), 1, `${tag}: one history entry`);
    await undo();
    assert.deepEqual(await walls(), base, `${tag}: one Ctrl+Z restores it`);
  }

  // ---- the Move tool on a wall face slides the whole straight wall sideways, thickness unchanged: the south wall's
  // outer face (three pieces). Not the partition: at 390 it is about 22 px tall and inside the 44 px finger band of the
  // bedroom windows' edges, and an opening edge rightly beats a wall face.
  await press("tool-move");
  if (!touch) {
    await hoverAt(outer);
    assert.deepEqual((await debug()).hover, { wallId: "w-LF", openingId: null, role: "sideRight" }, `${tag}: Move hovers the south wall's face`);
    assert.equal(await text("face"), "Move this wall sideways");
  }
  let slid = { distance: 0, value: "" };
  await drag(outer, along(outer, outward, 40), async () => {
    await page.waitForTimeout(150);
    slid = { distance: metres(await text("distance")), value: await text("value") };
    if (touch) await page.screenshot({ path: `${OUT}/wall-move-mid-drag-390.png` });
  });
  assert.ok(slid.distance >= 0.05, `${tag}: Move slid the south wall ${slid.distance} m`);
  assert.equal(slid.value, `Wall moves ${slid.distance.toFixed(2)} m`);
  for (const id of RUN) {
    const w = await wallById(id);
    assert.equal(w.thickness, 0.2, `${tag}: ${id}: Move keeps the thickness`);
    near(w.a.y, 8 + slid.distance, 1e-9, `${tag}: ${id} moved south by the label's distance`);
    near(w.b.y, w.a.y, 1e-9, `${tag}: ${id} is still straight`);
  }
  near((await wallById("w-GH")).a.y, 8 + slid.distance, 1e-9, `${tag}: the west wall stretched to meet it`);
  assert.equal(await past(), 1);
  await undo();
  assert.deepEqual(await walls(), base, `${tag}: one undo restores it`);

  // ---- the Move tool on the south-east corner E(10, 8): dragged on the floor, both walls there follow, the snap marker shows
  const corner = await proj({ x: 10, y: 1.35, z: 8 }); // E's vertical line, half-way up
  const target = await proj({ x: 10.5, y: 1.35, z: 8.5 }); // 0.5 m east and 0.5 m south on the same horizontal plane
  await inPane(corner, "the south-east corner");
  if (!touch) {
    await hoverAt(corner);
    assert.deepEqual((await debug()).corner, { x: 10, y: 8 }, `${tag}: the pointer is on the corner E`);
    assert.equal(await text("face"), "Corner: drag it on the floor");
    assert.equal(await tid(page, "pushpull-marker").count(), 1, `${tag}: the corner's marker is drawn`);
  }
  let cornerMid = { snap: "", lengths: "", marker: 0 };
  await drag(corner, target, async () => {
    await page.waitForTimeout(200);
    cornerMid = { snap: await text("snap"), lengths: await text("lengths"), marker: await tid(page, "pushpull-marker").count() };
    assert.deepEqual((await debug()).corner, { x: 10, y: 8 }, `${tag}: the corner being dragged`);
    if (!touch) await page.screenshot({ path: `${OUT}/corner-drag-mid-drag-1440.png` });
  });
  assert.match(cornerMid.snap, /^Snap/, `${tag}: the label says how it snapped ("${cornerMid.snap}")`);
  assert.match(cornerMid.lengths, /^Walls here: \d+\.\d\d m · \d+\.\d\d m$/, `${tag}: and both walls' lengths ("${cornerMid.lengths}")`);
  assert.equal(cornerMid.marker, 1, `${tag}: the snap marker is visible mid-drag`);
  const me = await wallById("w-ME");
  const el = await wallById("w-EL");
  assert.deepEqual(me.b, el.a, `${tag}: w-ME and w-EL still meet`);
  near(me.b.x, 10.5, touch ? 0.15 : 0.06, `${tag}: the corner went about 0.5 m east (${me.b.x})`);
  near(me.b.y, 8.5, touch ? 0.15 : 0.06, `${tag}: and about 0.5 m south (${me.b.y})`);
  assert.deepEqual(me.a, base.find((w) => w.id === "w-ME")!.a, `${tag}: w-ME's other end stayed`);
  assert.deepEqual(el.b, base.find((w) => w.id === "w-EL")!.b, `${tag}: w-EL's other end stayed`);
  assert.equal(await past(), 1, `${tag}: one history entry`);
  await undo();
  assert.deepEqual(await walls(), base, `${tag}: one ${touch ? "Undo" : "Ctrl+Z"} restores the corner`);

  // ---- a hidden wall end does nothing: the seam at L(7, 8) where w-LF and w-EL meet. Their end caps there are inside
  // the wall; pointing at the seam on the outer face hovers that face (exposed) with Push/Pull, never an end. With Move
  // the seam is on the corner L's line, and a corner beats a face, so it is the corner: still never the end.
  if (!touch) {
    const seam = await proj({ x: 7, y: 1.35, z: 8.1 });
    await press("tool-pushpull");
    await hoverAt(seam);
    let d = await debug();
    assert.ok(d.hover && !/^end/.test(d.hover.role), `${tag}: Push/Pull at the seam hovers ${d.hover?.role}, not a wall end`);
    assert.equal(d.exposed, true, `${tag}: and it is exposed`);
    await press("tool-move");
    await hoverAt(seam);
    d = await debug();
    assert.equal(d.hover, null, `${tag}: Move at the seam hovers no face`);
    assert.deepEqual(d.corner, { x: 7, y: 8 }, `${tag}: it is on the corner L instead`);
  }

  // ---- an orbit drag (Select tool) from a wall selects nothing
  await press("tool-select");
  await drag(outer, { x: outer.x + 40, y: outer.y });
  await page.waitForTimeout(200);
  assert.equal(await selectedId(page), null, `${tag}: a 40 px orbit drag from a wall selected no wall`);
  assert.equal(await page.evaluate(() => (window as Win).__selectionStore!.getState().openingId), null, `${tag}: and no opening`);
  assert.deepEqual(await walls(), base, `${tag}: and changed nothing`);

  // ---- Walk still disables both tools
  await press("tool-move");
  await press("camera-walk");
  await page.waitForTimeout(400);
  assert.equal(await tid(page, "tool-select").getAttribute("aria-pressed"), "true", `${tag}: entering Walk switched the tool to Select`);
  for (const t of ["move", "pushpull"]) assert.equal(await tid(page, `tool-${t}`).getAttribute("aria-disabled"), "true", `${tag}: ${t} is disabled while walking`);
  await press("walk-exit");
  console.log(`${tag}: ok (${touch ? "real touch: thickness drag, second-finger cancel, Move wall, corner drag, orbit, Walk" : "mouse: thickness drag/undo/Escape, Shift move with room areas, Move wall, corner drag, hidden seam, orbit, Walk"})`);
  await browser.close();
}

async function run(width: number, height: number) {
  const tag = String(width);
  const wide = width >= 768;
  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: !wide }); // the phone run uses real touch events
  page.on("pageerror", (e) => errors.push(`${tag} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag} console: ${m.text().slice(0, 200)}`));
  if (process.env.E2E_DEBUG) page.on("response", (r) => r.status() >= 400 && console.log(`${tag}: HTTP ${r.status()} ${r.url()}`));
  await page.goto(`${BASE}/studio`);
  // Next's dev badge sits bottom left, over the phone tool bar's first button, and swallows taps there.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
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
  await checkDraw(page, tag, wide, !wide);
  await checkOpeningSelect(page, tag, wide, !wide);
  await checkOpenings(page, tag, wide, !wide);
  await checkMeasure(page, tag, wide, !wide);
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

  // ---- import link (inside the Import menu since step I.1)
  await tid(page, "import-menu").click();
  await tid(page, "import-link").click();
  await page.waitForURL("**/studio/import");
  console.log(`${tag}: Import plan link goes to ${new URL(page.url()).pathname}`);
  await browser.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (process.env.E2E_ONLY === "swing") {
    // just the flipped-door persistence regression (fast: handy when working on the autosave reader)
    await checkSwingPersists(1440, 900, false);
    await checkSwingPersists(390, 844, true);
    assert.deepEqual(errors, [], `console errors:\n${errors.join("\n")}`);
    console.log("e2e-studio (swing only): ok");
    return;
  }
  if (process.env.E2E_ONLY === "walls") {
    // just the 4.7c wall faces, wall moves and corners
    await checkWalls3d(1440, 900, false);
    await checkWalls3d(390, 844, true);
    assert.deepEqual(errors, [], `console errors:\n${errors.join("\n")}`);
    console.log("e2e-studio (walls only): ok");
    return;
  }
  if (process.env.E2E_ONLY === "pushpull") {
    // just the 3D Push/Pull checks (fast: handy when working on the tool)
    await checkPushPull(1440, 900, false);
    await checkPushPull(390, 844, true);
    await checkOpenings3d(1440, 900, false);
    await checkOpenings3d(390, 844, true);
    await checkWalls3d(1440, 900, false);
    await checkWalls3d(390, 844, true);
    assert.deepEqual(errors, [], `console errors:\n${errors.join("\n")}`);
    console.log("e2e-studio (push/pull only): ok");
    return;
  }
  await run(1440, 900);
  await run(390, 844);
  await checkAutosave();
  await checkSwingPersists(1440, 900, false);
  await checkSwingPersists(390, 844, true);
  await checkPushPull(1440, 900, false);
  await checkPushPull(390, 844, true);
  await checkOpenings3d(1440, 900, false);
  await checkOpenings3d(390, 844, true);
  await checkWalls3d(1440, 900, false);
  await checkWalls3d(390, 844, true);
  assert.deepEqual(errors, [], `console errors:\n${errors.join("\n")}`);
  console.log("e2e-studio: ok; screenshots in", OUT);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
