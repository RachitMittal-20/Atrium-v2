/**
 * e2e-views.ts — a repeatable browser check of step V.1, the bird's-eye Top view and Recenter,
 * with Playwright's Chromium. NOT in npm test: it needs the dev server (npm run dev on port 3000;
 * E2E_URL overrides), because it reads the dev-only hooks (__importDebug.camera() for the orbit
 * camera and its target, __walkDebug for the walk camera and pose, __studio3d.project,
 * __planStore, __selectionStore, __pushPullDebug). The hooks are only READ, except one TEST SETUP
 * line that clears the selection; every action is real input (mouse and keyboard at 1440×900,
 * Chromium's own touch through CDP at 390×844).
 *
 * At each size:
 *   - coverage (step 1 of V.1): every wall's centre line sampled every 0.1 m at five heights and a
 *     6 px grid over the convex hull of the plan's projected box are hit-tested with
 *     document.elementsFromPoint; no control may be the topmost element at any of them, in the
 *     opening (home) view and in the Top view. The walk layout is measured and printed;
 *   - the controls: Orbit, Top, Walk and Recenter are 44 px targets, reachable with Tab in that
 *     order, and do not overlap each other; while walking at 390 none of the group, Exit, Walk
 *     through walls, Recenter, the hint line and the joystick overlap;
 *   - the opening camera IS the home view (homeView of the plan's bounds, within 1e-6 m);
 *   - Top (Enter on the focused button at 1440, a tap at 390): the camera glides (it is not there
 *     at once) and arrives, within 1 mm, at topView (with the 60 px control strip kept clear): above
 *     the tallest wall, looking straight down (within 0.01°), every corner of the plan's box inside
 *     the 3D pane and below the strip; nothing covers the model;
 *   - in Top: Select picks a wall by its top, Push/Pull pulls a wall top (one undo step), Move drags
 *     the corner E by the top of its line, the part that shows from above (both walls follow, one
 *     undo step); Top stays on through all three;
 *   - orbiting from Top (a drag upwards) tilts the camera off straight down and turns Top off;
 *   - Recenter after an orbit drag: back to the home view within 1 mm (position and target), and
 *     still there 10 frames later (no leftover spin); R on the focused 3D view does the same;
 *   - Orbit from Top glides back to the camera from before Top (here the home view), within 1 mm;
 *   - Walk from Top: Recenter (R at 1440, the button at 390) returns the walker to the start pose
 *     after walking away from it (x, y, heading within 1e-9, pitch 0); leaving the walk (Escape,
 *     Exit) restores the Top camera exactly (position within 0.001 mm, direction, fov, near) and
 *     Top is pressed again; Walk then Orbit restores it exactly too, with Orbit pressed;
 *   - prefers-reduced-motion: Recenter lands at once, with no frame in between;
 *   - an empty plan (New plan > Empty plan): home, Top and back, every number finite;
 *   - a model under where the controls used to be (step G.1-fix): cube.glb lifted to 3 m at plan
 *     (2, 2), the e2e-import3d placement; at 390 its top lands right of the camera buttons, inside
 *     the area the disabled "Walk through walls" button covered before G.1-fix, and a tap there
 *     selects it (at 1440 a click does). Before that, at 390, the whole band at the top of the pane
 *     from x 130 (where Orbit | Walk ended before V.1) to Recenter is hit-tested every 4 px: all
 *     canvas, so the camera buttons stacked at the left edge cover none of it.
 * Screenshots: /tmp/studio/views-top-1440.png (Top, sample plan), views-recenter-390.png (after
 * Recenter), views-walk-390.png (the walk layout).
 * Run: npx tsx scripts/e2e-views.ts
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { afterFrames, step, waitForScene3d, waitUntil, warmRoutes, watchErrors, withSuiteTimeout } from "./e2e-helpers";
import { CONTROL_STRIP_PX, homeView, planBounds, topView, type CameraPose } from "../src/lib/view/camera";
import type { Plan } from "../src/types/plan";

const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const OUT = "/tmp/studio";
const EXECUTABLE = process.env.E2E_CHROMIUM || undefined;
const FIX = join(process.cwd(), "tests/fixtures/models");
const POSE_TOL = 1e-3; // m: a glide's landing, position and target
const OLD_GHOST_390 = { x: 136, y: 100, width: 149, height: 44 }; // where the disabled "Walk through walls" button sat at 390 before G.1-fix
const OLD_GROUP_RIGHT_390 = 130; // px: Orbit | Walk ended here at 390 before V.1 (Walk 70–126, then the group's padding and border)

type V3 = [number, number, number];
type Pt = { x: number; y: number };
type Box = { x: number; y: number; width: number; height: number };
type OrbitCam = { position: V3; target: V3; fov: number; aspect: number };
type WalkCam = { position: V3; forward: V3; right: V3; fov: number; near: number };

const errors: string[] = [];
const tid = (page: Page, id: string) => page.getByTestId(id);
const orbitCam = (page: Page) => page.evaluate("window.__importDebug.camera()") as Promise<OrbitCam>;
const walkCam = (page: Page) => page.evaluate("window.__walkDebug.camera()") as Promise<WalkCam>;
const mode = (page: Page) => page.evaluate("window.__walkDebug.mode()") as Promise<string>;
const pose = (page: Page) => page.evaluate("window.__walkDebug.pose()") as Promise<{ x: number; y: number; heading: number; pitch: number; eye: number }>;
const planNow = (page: Page) => page.evaluate("window.__planStore.getState().plan") as Promise<Plan>;
const past = (page: Page) => page.evaluate("window.__planStore.getState().past.length") as Promise<number>;
const project = (page: Page, p: { x: number; y: number; z: number }) => page.evaluate((q) => (window as unknown as { __studio3d: { project(p: unknown): Pt } }).__studio3d.project(q), p);
const gap = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const v3 = (p: { x: number; y: number; z: number }): V3 => [p.x, p.y, p.z];
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const pressed = (page: Page, id: string) => tid(page, id).getAttribute("aria-pressed");
/** The height of the corner E's line: the tallest wall that ends there (w-ME and w-EL). */
const e0Height = (plan: Plan) => Math.max(...plan.walls.filter((w) => w.id === "w-ME" || w.id === "w-EL").map((w) => w.height));

/** Coverage: the topmost element at every wall sample and every footprint grid point, when it is not the canvas.
 *  A string, not a function: no named inner function may reach the page (CLAUDE.md, step F.1). */
const COVER = `(() => {
  const plan = window.__planStore.getState().plan;
  const proj = window.__studio3d.project;
  const canvas = document.querySelector('[data-testid="scene-3d"] canvas');
  const r = canvas.getBoundingClientRect();
  const inside = (p) => p.x >= r.left && p.x < r.right && p.y >= r.top && p.y < r.bottom;
  const name = (el) => { const t = el.closest('[data-testid]'); return t ? t.getAttribute('data-testid') : el.tagName.toLowerCase(); };
  const hits = {}; const foot = {}; let nHit = 0; let nFoot = 0;
  const note = (bag, p) => { const top = document.elementsFromPoint(p.x, p.y)[0]; if (!top || top === canvas) return; const k = name(top); bag[k] = (bag[k] || 0) + 1; };
  for (const w of plan.walls) {
    const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    for (let s = 0; s <= L + 1e-9; s += 0.1) for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const t = L === 0 ? 0 : s / L;
      const p = proj({ x: w.a.x + (w.b.x - w.a.x) * t, y: w.height * f, z: w.a.y + (w.b.y - w.a.y) * t });
      if (!inside(p)) continue; nHit++; note(hits, p);
    }
  }
  const xs = plan.walls.flatMap((w) => [w.a.x, w.b.x]); const zs = plan.walls.flatMap((w) => [w.a.y, w.b.y]);
  const h = Math.max(0, ...plan.walls.map((w) => w.height));
  const pts = [];
  for (const x of [Math.min(...xs), Math.max(...xs)]) for (const z of [Math.min(...zs), Math.max(...zs)]) for (const y of [0, h]) pts.push(proj({ x, y, z }));
  pts.sort((a, b) => a.x - b.x || a.y - b.y);
  const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = []; for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  const up = []; for (const p of pts.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  const hull = lo.slice(0, -1).concat(up.slice(0, -1));
  const x0 = Math.min(...hull.map((p) => p.x)), x1 = Math.max(...hull.map((p) => p.x)), y0 = Math.min(...hull.map((p) => p.y)), y1 = Math.max(...hull.map((p) => p.y));
  for (let y = y0; y <= y1; y += 6) for (let x = x0; x <= x1; x += 6) {
    let inHull = true;
    for (let i = 0; i < hull.length; i++) if (cr(hull[i], hull[(i + 1) % hull.length], { x, y }) < 0) { inHull = false; break; }
    const p = { x, y };
    if (!inHull || !inside(p)) continue; nFoot++; note(foot, p);
  }
  return { nHit, hits, nFoot, foot, hull: [Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)] };
})()`;
type Cover = { nHit: number; hits: Record<string, number>; nFoot: number; foot: Record<string, number>; hull: number[] };

/** Boxes of the pane's controls that are shown (page px). */
async function boxes(page: Page, ids: string[]) {
  const out: Record<string, Box> = {};
  for (const id of ids) {
    const l = tid(page, id);
    if ((await l.count()) === 0) continue;
    const b = await l.first().boundingBox();
    if (b) out[id] = b;
  }
  return out;
}
const fmt = (b: Record<string, Box>) => Object.entries(b).map(([k, v]) => `${k} ${v.x.toFixed(0)},${v.y.toFixed(0)} ${v.width.toFixed(0)}×${v.height.toFixed(0)}`).join("; ");

async function checkCover(page: Page, tag: string, what: string) {
  const c = (await page.evaluate(COVER)) as Cover;
  assert.ok(c.nHit > 1000 && c.nFoot > 500, `${tag} ${what}: the plan is on screen (${c.nHit} wall samples, ${c.nFoot} footprint points)`);
  assert.deepEqual(c.hits, {}, `${tag} ${what}: no control covers a wall (${JSON.stringify(c.hits)})`);
  assert.deepEqual(c.foot, {}, `${tag} ${what}: no control covers the plan's footprint (${JSON.stringify(c.foot)})`);
  console.log(`${tag} ${what}: ${c.nHit} wall samples and ${c.nFoot} footprint points (hull ${c.hull.join(",")}), none covered`);
}

/** Where the camera should land for `kind`, from the plan and the pane as they are now. */
async function expected(page: Page, kind: "home" | "top"): Promise<CameraPose> {
  const c = await orbitCam(page);
  const b = planBounds((await planNow(page)).walls);
  const h = (await tid(page, "scene-3d").boundingBox())!.height; // the canvas fills its host
  return kind === "top" ? topView(b, c.aspect, c.fov, CONTROL_STRIP_PX / h) : homeView(b, c.aspect, c.fov);
}

/** Waits until the orbit camera and its target are within `tol` of `want`, then checks they stay there for 10 frames. */
async function arrive(page: Page, want: CameraPose, what: string, tol = POSE_TOL) {
  const [p, t] = [v3(want.position), v3(want.target)];
  await waitUntil(
    page,
    `${what}: the camera never reached ${JSON.stringify(p)} looking at ${JSON.stringify(t)}`,
    `(() => { const c = window.__importDebug.camera(); const p = c.position, t = c.target;
      return Math.hypot(p[0] - ${p[0]}, p[1] - ${p[1]}, p[2] - ${p[2]}) < ${tol} && Math.hypot(t[0] - ${t[0]}, t[1] - ${t[1]}, t[2] - ${t[2]}) < ${tol}; })()`,
    5000,
  );
  await afterFrames(page, 10);
  const c = await orbitCam(page);
  assert.ok(gap(c.position, p) < tol && gap(c.target, t) < tol, `${what}: still there 10 frames later (off by ${(gap(c.position, p) * 1000).toFixed(3)} mm, target ${(gap(c.target, t) * 1000).toFixed(3)} mm)`);
  assert.ok([...c.position, ...c.target].every(Number.isFinite), `${what}: every number finite`);
  return { off: gap(c.position, p), offTarget: gap(c.target, t) };
}

async function run(width: number, height: number) {
  const touch = width < 640;
  const tag = String(width);
  step(`${tag} views`);
  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: touch });
  watchErrors(page, tag, errors);
  await page.goto(`${BASE}/studio`);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }); // the dev badge swallows phone taps
  await tid(page, "plan-name").waitFor();
  await waitForScene3d(page, "the studio has just been opened");

  const press = async (id: string) => {
    if (touch) await tid(page, id).tap();
    else await tid(page, id).click();
  };
  const at = async (p: Pt) => (touch ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y));
  /** A real drag: the mouse, or one finger through CDP. */
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
  const undo = async () => {
    if (touch) await tid(page, "undo").tap();
    else await page.keyboard.press("Control+z");
  };
  const pane = (await tid(page, "scene-3d").boundingBox())!;
  /** An orbit drag on empty ground in the lower part of the pane (the Select tool orbits on a drag from anywhere). */
  const orbitDrag = (dx: number, dy: number) => {
    const from = { x: pane.x + pane.width * 0.7, y: pane.y + pane.height * 0.8 };
    return drag(from, { x: from.x + dx, y: from.y + dy });
  };

  // ---- 1. coverage and the controls, in the opening view
  step(`${tag}: coverage and controls`);
  await checkCover(page, tag, "home view");
  const ids = ["camera-orbit", "camera-top", "camera-walk", "camera-recenter"];
  const b0 = await boxes(page, ids);
  console.log(`${tag} orbit controls: ${fmt(b0)}`);
  for (const id of ids) assert.ok(b0[id] && b0[id].width >= 44 && b0[id].height >= 44, `${tag}: ${id} is a 44 px target (${JSON.stringify(b0[id])})`);
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) assert.ok(!overlaps(b0[ids[i]], b0[ids[j]]), `${tag}: ${ids[i]} and ${ids[j]} do not overlap`);
  // keyboard: Tab goes Orbit → Top → Walk → Recenter (the disabled Walk through walls is skipped)
  await tid(page, "camera-orbit").focus();
  const order: string[] = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Tab");
    order.push((await page.evaluate("document.activeElement && document.activeElement.getAttribute('data-testid')")) as string);
  }
  assert.deepEqual(order, ["camera-top", "camera-walk", "camera-recenter"], `${tag}: the controls are reachable with Tab, in order`);
  assert.equal(await pressed(page, "camera-orbit"), "true");
  assert.equal(await pressed(page, "camera-top"), "false");
  assert.equal(await tid(page, "camera-recenter").getAttribute("aria-keyshortcuts"), "R");
  if (touch) {
    // The band at the top of the pane right of where Orbit | Walk ended before V.1, up to Recenter, takes no taps: a model
    // there (e2e-import3d's lifted cube, which a small orbit moves about in it) is picked, as it was before Top was added.
    const rc = b0["camera-recenter"];
    const hit = (await page.evaluate(`(() => { const c = document.querySelector('[data-testid="scene-3d"] canvas'); const out = [];
      for (let y = ${pane.y + 8}; y <= ${pane.y + 52}; y += 4) for (let x = ${OLD_GROUP_RIGHT_390}; x < ${rc.x - 4}; x += 4) {
        const e = document.elementsFromPoint(x, y)[0]; if (e !== c) out.push(x + ',' + y + ' ' + (e ? (e.getAttribute('data-testid') || e.tagName) : 'none')); }
      return out; })()`)) as string[];
    assert.deepEqual(hit, [], `${tag}: nothing takes taps in the band right of where the controls used to end (x ${OLD_GROUP_RIGHT_390} to ${(rc.x - 4).toFixed(0)})`);
    console.log(`${tag}: the band x ${OLD_GROUP_RIGHT_390}–${(rc.x - 4).toFixed(0)}, y ${(pane.y + 8).toFixed(0)}–${(pane.y + 52).toFixed(0)} is all canvas`);
  }
  if (await tid(page, "studio-hint-dismiss").count()) await press("studio-hint-dismiss"); // the first-run hint; it was part of the coverage check above

  const home0 = await expected(page, "home");
  const opening = await orbitCam(page);
  assert.ok(gap(opening.position, v3(home0.position)) < 1e-6 && gap(opening.target, v3(home0.target)) < 1e-6, `${tag}: the opening camera is the home view (off by ${gap(opening.position, v3(home0.position))} m)`);

  // ---- 2. Top
  step(`${tag}: Top`);
  const top = await expected(page, "top");
  if (touch) await tid(page, "camera-top").tap();
  else {
    await tid(page, "camera-top").focus();
    await page.keyboard.press("Enter");
  }
  const right = await orbitCam(page);
  assert.ok(gap(right.position, v3(top.position)) > 0.5, `${tag}: Top glides (the camera is not there at once: ${gap(right.position, v3(top.position)).toFixed(2)} m away)`);
  const topLanding = await arrive(page, top, `${tag} Top`);
  assert.equal(await pressed(page, "camera-top"), "true", `${tag}: Top is pressed`);
  assert.equal(await pressed(page, "camera-orbit"), "false");
  {
    const w = await walkCam(page);
    const tilt = (Math.acos(Math.min(1, -w.forward[1])) * 180) / Math.PI;
    assert.ok(tilt < 0.01, `${tag}: Top looks straight down (${tilt.toExponential(2)}° off)`);
    const plan = await planNow(page);
    const b = planBounds(plan.walls);
    assert.ok(w.position[1] > b.height, `${tag}: from above the tallest wall (${w.position[1].toFixed(2)} m)`);
    assert.ok(w.position[0] >= b.x0 && w.position[0] <= b.x1 && w.position[2] >= b.z0 && w.position[2] <= b.z1, `${tag}: over the plan`);
    for (const x of [b.x0, b.x1])
      for (const z of [b.z0, b.z1])
        for (const y of [0, b.height]) {
          const p = await project(page, { x, y, z });
          assert.ok(p.x >= pane.x && p.x <= pane.x + pane.width && p.y >= pane.y + CONTROL_STRIP_PX - 0.5 && p.y <= pane.y + pane.height, `${tag}: the plan's corner (${x}, ${y}, ${z}) is inside the 3D pane, below the control strip, in Top (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`);
        }
  }
  await checkCover(page, tag, "Top view");
  if (!touch) await page.screenshot({ path: `${OUT}/views-top-1440.png` });

  // ---- 3. the tools in Top: Select, Push/Pull, Move
  step(`${tag}: tools in Top`);
  const plan0 = await planNow(page);
  // w-AB has no door or window: near w-BC's front door a finger's 44 px reach grabs the door's jamb edge first (step 4.7b)
  const ab = plan0.walls.find((w) => w.id === "w-AB")!;
  const abTop = await project(page, { x: (ab.a.x + ab.b.x) / 2, y: ab.height, z: (ab.a.y + ab.b.y) / 2 });
  await press("tool-select");
  await at(abTop);
  await waitUntil(page, `${tag}: a ${touch ? "tap" : "click"} on w-AB's top in Top did not select it`, "window.__selectionStore.getState().selectedId === 'w-AB'");
  await page.evaluate("window.__selectionStore.getState().select(null)"); // TEST SETUP: unselect before the tools
  const past0 = await past(page);
  await press("tool-pushpull");
  if (!touch) {
    await page.mouse.move(abTop.x, abTop.y);
    await waitUntil(page, `${tag}: Push/Pull did not hover w-AB's top in Top`, "(() => { const h = window.__pushPullDebug.hover; return !!h && h.wallId === 'w-AB' && h.role === 'top'; })()");
  }
  await drag(abTop, { x: abTop.x, y: abTop.y - 60 });
  const pulled = (await planNow(page)).walls.find((w) => w.id === "w-AB")!;
  assert.ok(Math.abs(pulled.height - ab.height) >= 0.05, `${tag}: Push/Pull changed w-AB's height in Top (${ab.height} → ${pulled.height})`);
  assert.equal(await past(page), past0 + 1, `${tag}: one undo step`);
  await undo();
  await waitUntil(page, `${tag}: undo did not put w-AB's height back`, `window.__planStore.getState().plan.walls.find((w) => w.id === 'w-AB').height === ${ab.height}`);
  await press("tool-move");
  const e0 = plan0.walls.find((w) => w.id === "w-ME")!.b;
  // From above, the corner's vertical line runs out from the middle of the screen and only its top end shows over the
  // walls (the rest is inside them): aim there, and drag on the plane through it.
  const corner = await project(page, { x: e0.x, y: e0Height(plan0), z: e0.y });
  const cornerTo = await project(page, { x: e0.x + 0.5, y: e0Height(plan0), z: e0.y + 0.5 });
  if (!touch) {
    await page.mouse.move(corner.x, corner.y);
    await waitUntil(page, `${tag}: Move did not find the corner E in Top`, `(() => { const c = window.__pushPullDebug.corner; return !!c && c.x === ${e0.x} && c.y === ${e0.y}; })()`);
  }
  await drag(corner, cornerTo);
  const me = (await planNow(page)).walls.find((w) => w.id === "w-ME")!;
  const el = (await planNow(page)).walls.find((w) => w.id === "w-EL")!;
  assert.deepEqual(me.b, el.a, `${tag}: w-ME and w-EL still meet`);
  assert.ok(Math.abs(me.b.x - (e0.x + 0.5)) < 0.15 && Math.abs(me.b.y - (e0.y + 0.5)) < 0.15, `${tag}: Move dragged the corner E about 0.5 m east and south in Top (${JSON.stringify(me.b)})`);
  assert.equal(await past(page), past0 + 1, `${tag}: one undo step`);
  await undo();
  await waitUntil(page, `${tag}: undo did not put the corner back`, `JSON.stringify(window.__planStore.getState().plan.walls.find((w) => w.id === 'w-ME').b) === '${JSON.stringify(e0)}'`);
  await press("tool-select");
  assert.equal(await pressed(page, "camera-top"), "true", `${tag}: Top is still on after the tools`);
  const afterTools = await orbitCam(page);
  assert.ok(gap(afterTools.position, v3(top.position)) < POSE_TOL, `${tag}: and the camera has not moved`);

  // ---- 4. orbiting from Top leaves it
  step(`${tag}: orbit from Top`);
  await orbitDrag(0, -80);
  await waitUntil(page, `${tag}: an orbit drag upwards did not leave Top`, "document.querySelector('[data-testid=camera-orbit]').getAttribute('aria-pressed') === 'true'");
  assert.equal(await pressed(page, "camera-top"), "false");
  const tilted = await walkCam(page);
  const tiltDeg = (Math.acos(Math.min(1, -tilted.forward[1])) * 180) / Math.PI;
  assert.ok(tiltDeg > 0.5, `${tag}: the camera tilted off straight down (${tiltDeg.toFixed(1)}°)`);

  // ---- 5. Recenter after an orbit drag; R does the same
  step(`${tag}: Recenter`);
  await orbitDrag(120, 30);
  const dragged = await orbitCam(page);
  const home = await expected(page, "home");
  assert.ok(gap(dragged.position, v3(home.position)) > 0.5, `${tag}: the drag moved the camera off the home view`);
  await press("camera-recenter");
  const rec = await arrive(page, home, `${tag} Recenter (button)`);
  if (touch) await page.screenshot({ path: `${OUT}/views-recenter-390.png` });
  await orbitDrag(-100, -20);
  assert.ok(gap((await orbitCam(page)).position, v3(home.position)) > 0.5, `${tag}: dragged away again`);
  await tid(page, "scene-3d").focus();
  await page.keyboard.press("r");
  const recR = await arrive(page, home, `${tag} Recenter (R)`);

  // ---- 6. Orbit from Top goes back to the camera from before Top (the home view here)
  step(`${tag}: Top, then Orbit`);
  await press("camera-top");
  await arrive(page, top, `${tag} Top again`);
  await press("camera-orbit");
  await arrive(page, home, `${tag} Orbit from Top: back to the camera from before`);
  assert.equal(await pressed(page, "camera-orbit"), "true");

  // ---- 7. Walk from Top: Recenter returns to the start pose; leaving restores the Top camera exactly
  step(`${tag}: Walk from Top`);
  await press("camera-top");
  await arrive(page, top, `${tag} Top before Walk`);
  await page.emulateMedia({ reducedMotion: "reduce" }); // a released key stops the walker on the next frame
  const before = await walkCam(page);
  await press("camera-walk");
  await waitUntil(page, `${tag}: Walk did not start`, "window.__walkDebug.mode() === 'walk'");
  assert.equal(await pressed(page, "camera-walk"), "true");
  assert.equal(await pressed(page, "camera-top"), "false", `${tag}: Top is not pressed while walking`);
  const start = await pose(page);
  if (!touch) {
    await tid(page, "scene-3d").focus();
    await page.keyboard.down("w");
    await waitUntil(page, `${tag}: W did not walk 0.3 m`, `(() => { const p = window.__walkDebug.pose(); return Math.hypot(p.x - ${start.x}, p.y - ${start.y}) > 0.3; })()`, 10000);
    await page.keyboard.up("w");
  } else {
    const stick = (await tid(page, "walk-joystick").boundingBox())!;
    const c = { x: stick.x + stick.width / 2, y: stick.y + stick.height / 2 };
    const walkBoxes = await boxes(page, ["camera-orbit", "camera-top", "camera-walk", "walk-exit", "walk-ghost", "camera-recenter", "walk-joystick", "walk-hud"]);
    console.log(`${tag} walk controls: ${fmt(walkBoxes)}`);
    const keys = Object.keys(walkBoxes);
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) assert.ok(!overlaps(walkBoxes[keys[i]], walkBoxes[keys[j]]), `${tag} walking: ${keys[i]} and ${keys[j]} do not overlap`);
    for (const id of ["walk-exit", "walk-ghost", "camera-recenter"]) assert.ok(walkBoxes[id].width >= 44 && walkBoxes[id].height >= 44, `${tag} walking: ${id} is a 44 px target`);
    await page.screenshot({ path: `${OUT}/views-walk-390.png` });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [c] });
    for (let i = 1; i <= 4; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: c.x, y: c.y - 10 * i }] });
    await waitUntil(page, `${tag}: the joystick did not walk 0.3 m`, `(() => { const p = window.__walkDebug.pose(); return Math.hypot(p.x - ${start.x}, p.y - ${start.y}) > 0.3; })()`, 10000);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  }
  await afterFrames(page, 3);
  const away = await pose(page);
  assert.ok(Math.hypot(away.x - start.x, away.y - start.y) > 0.3, `${tag}: walked away from the start`);
  if (touch) await press("camera-recenter");
  else {
    await tid(page, "scene-3d").focus();
    await page.keyboard.press("r");
  }
  await afterFrames(page, 3);
  const back = await pose(page);
  assert.ok(Math.abs(back.x - start.x) < 1e-9 && Math.abs(back.y - start.y) < 1e-9 && Math.abs(back.heading - start.heading) < 1e-9 && back.pitch === 0, `${tag}: Recenter (${touch ? "button" : "R"}) put the walker back on the start pose (${JSON.stringify(back)} vs ${JSON.stringify(start)})`);
  assert.equal(await mode(page), "walk", `${tag}: still walking`);
  if (touch) await press("walk-exit");
  else {
    await tid(page, "scene-3d").focus();
    await page.keyboard.press("Escape");
  }
  await waitUntil(page, `${tag}: leaving the walk did not return to orbit`, "window.__walkDebug.mode() === 'orbit'");
  await afterFrames(page, 5);
  const restored = await walkCam(page);
  const offWalk = gap(restored.position, before.position);
  assert.ok(offWalk < 1e-6, `${tag}: the Top camera is back within 0.001 mm (off by ${(offWalk * 1000).toFixed(6)} mm)`);
  assert.ok(gap(restored.forward, before.forward) < 1e-6, `${tag}: looking the same way`);
  assert.equal(restored.fov, before.fov);
  assert.equal(restored.near, before.near);
  assert.equal(await pressed(page, "camera-top"), "true", `${tag}: and Top is pressed again`);
  // Walk, then the Orbit button: the same exact restore, and Orbit is what is pressed
  await press("camera-walk");
  await waitUntil(page, `${tag}: Walk did not start again`, "window.__walkDebug.mode() === 'walk'");
  await press("camera-orbit");
  await waitUntil(page, `${tag}: Orbit did not end the walk`, "window.__walkDebug.mode() === 'orbit'");
  await afterFrames(page, 5);
  const restored2 = await walkCam(page);
  const offWalk2 = gap(restored2.position, before.position);
  assert.ok(offWalk2 < 1e-6, `${tag}: Orbit while walking restores the camera within 0.001 mm too (off by ${(offWalk2 * 1000).toFixed(6)} mm)`);
  assert.equal(await pressed(page, "camera-orbit"), "true");
  assert.equal(await pressed(page, "camera-top"), "false");

  // ---- 8. reduced motion: Recenter lands at once
  step(`${tag}: reduced motion`);
  await orbitDrag(90, 0);
  await press("camera-recenter");
  const instant = await orbitCam(page); // read with no frame in between
  assert.ok(gap(instant.position, v3(home.position)) < POSE_TOL && gap(instant.target, v3(home.target)) < POSE_TOL, `${tag}: under reduced motion Recenter lands at once (off by ${(gap(instant.position, v3(home.position)) * 1000).toFixed(3)} mm)`);
  await page.emulateMedia({ reducedMotion: "no-preference" });

  // ---- 9. an empty plan: home, Top and back, every number finite
  step(`${tag}: empty plan`);
  await press("import-menu");
  await press("new-plan");
  await tid(page, "project-dialog").waitFor();
  await press("new-plan-empty");
  await tid(page, "empty-plan").waitFor();
  await waitForScene3d(page, "the empty plan was opened");
  const emptyHome = await expected(page, "home");
  await arrive(page, emptyHome, `${tag} empty plan's opening view`);
  await press("camera-top");
  await arrive(page, await expected(page, "top"), `${tag} empty plan's Top`);
  await press("camera-recenter");
  await arrive(page, await expected(page, "top"), `${tag} empty plan's Recenter in Top`);
  await press("camera-orbit");
  await arrive(page, emptyHome, `${tag} empty plan: Orbit from Top`);

  // ---- 10. a model under where the controls used to be (e2e-import3d's placement) is still picked
  step(`${tag}: a model beside the controls`);
  await press("import-menu");
  await press("new-plan");
  await press("new-plan-sample");
  await tid(page, "project-dialog").waitFor({ state: "hidden" });
  await waitForScene3d(page, "the sample plan was opened again");
  await tid(page, "import-model-input").setInputFiles(join(FIX, "cube.glb"));
  await page.waitForSelector('[data-testid="import-dialog"][data-kind="review"]', { timeout: 20000 });
  await press("import-confirm");
  await page.waitForSelector('[data-testid="import-dialog"][data-kind="closed"]', { state: "attached", timeout: 15000 });
  await waitUntil(page, `${tag}: the cube was not added`, "window.__planStore.getState().plan.items.length === 1");
  const cube = (await planNow(page)).items[0].id;
  if (touch) {
    const sheet = page.locator('[aria-controls="plan-details"]');
    if ((await sheet.getAttribute("aria-expanded")) === "false") await sheet.tap();
  }
  for (const [id, value] of [["item-x", "2"], ["item-y", "2"], ["item-height", "3"]]) {
    const f = tid(page, id);
    await (touch ? f.tap() : f.click());
    await f.fill(value);
    await f.press("Enter");
  }
  await waitUntil(page, `${tag}: the cube did not move to (2, 2) at 3 m`, "(() => { const p = window.__planStore.getState().plan.items[0].position; return p.x === 2 && p.z === 2 && p.y === 3; })()");
  // the details sheet stays open, as in e2e-import3d (its typing helper opens it and leaves it)
  await press("camera-recenter");
  await arrive(page, await expected(page, "home"), `${tag} home before the model tap`);
  await afterFrames(page, 3);
  const cubeTop = await project(page, { x: 2, y: 3.75, z: 2 });
  const cams = Object.values(await boxes(page, ["camera-orbit", "camera-top", "camera-walk"]));
  if (touch) {
    assert.ok(cams.every((b) => cubeTop.x > b.x + b.width), `${tag}: the cube's top (${cubeTop.x.toFixed(0)}, ${cubeTop.y.toFixed(0)}) is right of the camera buttons`);
    assert.ok(overlaps({ x: cubeTop.x, y: cubeTop.y, width: 1, height: 1 }, OLD_GHOST_390), `${tag}: inside where the disabled Walk through walls button used to be`);
  }
  const topEl = (await page.evaluate(`(() => { const e = document.elementsFromPoint(${cubeTop.x}, ${cubeTop.y})[0]; return e ? e.tagName : null; })()`)) as string;
  assert.equal(topEl, "CANVAS", `${tag}: nothing covers the model there`);
  await page.evaluate("window.__selectionStore.getState().select(null)"); // TEST SETUP: start unselected
  await at(cubeTop);
  await waitUntil(page, `${tag}: a ${touch ? "tap" : "click"} on the model beside the controls did not select it`, `window.__selectionStore.getState().itemId === '${cube}'`);

  console.log(
    `${tag}: ok (Top landed ${(topLanding.off * 1000).toFixed(4)} mm off; Recenter ${(rec.off * 1000).toFixed(4)} mm, R ${(recR.off * 1000).toFixed(4)} mm; ` +
      `walk restore ${(offWalk * 1000).toFixed(6)} mm and ${(offWalk2 * 1000).toFixed(6)} mm; model tap at ${cubeTop.x.toFixed(0)},${cubeTop.y.toFixed(0)})`,
  );
  await browser.close();
}

withSuiteTimeout("e2e-views", 15 * 60_000, async () => {
  mkdirSync(OUT, { recursive: true });
  await warmRoutes(["/studio"]);
  for (const [w, h] of [
    [1440, 900],
    [390, 844],
  ]) {
    if (process.env.E2E_WIDTH && process.env.E2E_WIDTH !== String(w)) continue; // E2E_WIDTH=390 runs one size while debugging
    await run(w, h);
  }
  assert.deepEqual(errors, [], `console errors:\n${errors.join("\n")}`);
  console.log("e2e-views: ok; screenshots in", OUT);
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
