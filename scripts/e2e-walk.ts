/**
 * e2e-walk.ts — a repeatable browser check of the walkthrough (step 5.1 controls), with
 * Playwright's Chromium. NOT in npm test: it needs the dev server (npm run dev on port
 * 3000; E2E_URL overrides), because it reads the dev-only hooks window.__walkDebug and
 * window.__pushPullDebug. The hooks are only READ: every action is real input.
 *
 * At 1440×900 with a mouse and a real keyboard:
 *   - choose the Move tool, then enter Walk: the tool goes back to Select, and Push/Pull
 *     and Move are aria-disabled with the tooltip "Exit Walk to use …";
 *   - hold W until the camera has walked up to a wall and pushed into it for 0.5 s (at
 *     most 10 s): the clearance at the camera (its distance to the nearest wall) is
 *     sampled every 100 ms, must get under 0.25 m (it really reached a wall) and must
 *     never drop below the camera radius (0.2 m);
 *   - step G.1, "Walk through walls": the toggle is disabled before Walk; with the
 *     camera stopped at that wall, G turns it on (aria-pressed, the status line), W
 *     carries the camera into the wall and out the other side, S backs it into the wall
 *     again; G turns it off there, and the camera is put on a clear point (clearance >=
 *     the radius, under 2 m away) with the notice. From here on the browser prefers
 *     reduced motion (a real media setting, no hook), so a released key stops the
 *     camera on the next frame instead of gliding out of a 0.1 m wall;
 *   - press Escape: Walk ends and the orbit camera (position, view direction, fov,
 *     near) is back exactly, the position within 0.001 mm; entering Walk again, the
 *     toggle is off, and Escape again restores the orbit camera as exactly.
 * At 390×844 with real touch (Chromium's own touch input through CDP), the same, with
 * the on-screen joystick pushed up instead of W (and gently down instead of S), taps
 * on the toggle instead of G (which must be at least 44 px and overlap neither the
 * joystick nor Exit), and the Exit button instead of Escape (a phone has no Escape key).
 * Screenshots: /tmp/studio/walk-{1440,390}.png, taken mid-walk; walk-ghost-on-1440.png
 * and walk-ghost-390.png, taken with the toggle on and the camera inside the wall.
 * Run: npx tsx scripts/e2e-walk.ts
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright";
import { step, waitForScene3d, warmRoutes, watchErrors, withSuiteTimeout } from "./e2e-helpers";

const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const OUT = "/tmp/studio";
const EXECUTABLE = process.env.E2E_CHROMIUM || undefined;
const CAMERA_RADIUS = 0.2; // src/lib/walk/collision.ts
const HOLD_MS = 10000; // the most it holds forward: it stops sooner, once it is at a wall (a slow software-GL frame rate walks slower than 1.4 m/s)
const AT_WALL = 0.25; // m: a clearance this small means the camera has walked up to a wall

type Vec = [number, number, number];
type WalkDebug = {
  mode(): string;
  ghost(): boolean;
  pose(): { x: number; y: number; heading: number; pitch: number; eye: number };
  camera(): { position: Vec; forward: Vec; right: Vec; fov: number; near: number };
  clearance(): number;
};
type Win = Window & { __walkDebug?: WalkDebug; __pushPullDebug?: { tool: string } };

const errors: string[] = [];
const tid = (page: Page, id: string) => page.getByTestId(id);
const camera = (page: Page) => page.evaluate(() => (window as Win).__walkDebug!.camera());
const mode = (page: Page) => page.evaluate(() => (window as Win).__walkDebug!.mode());
const pose = (page: Page) => page.evaluate(() => (window as Win).__walkDebug!.pose());
const clearance = (page: Page) => page.evaluate(() => (window as Win).__walkDebug!.clearance());
const ghost = (page: Page) => page.evaluate(() => (window as Win).__walkDebug!.ghost());
const gap = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const MOVED_NOTICE = "A wall moved onto you, so we moved you."; // src/store/viewStore.ts
const GHOST_STATUS = "Walls are ignored. Turn this off to be stopped by walls.";
type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Hold a movement until the page-side condition (a string, evaluated every frame) holds; at most 10 s. */
async function holdUntil(page: Page, hold: () => Promise<void>, release: () => Promise<void>, condition: string, what: string) {
  await hold();
  try {
    await page.waitForFunction(condition, null, { polling: "raf", timeout: 10000 });
  } catch {
    throw new Error(`${what}: not reached within 10 s (clearance ${(await clearance(page)).toFixed(3)} m)`);
  } finally {
    await release();
  }
  await page.waitForTimeout(200); // reduced motion: the next frame stops it; this only lets the last pose publish
}

/** Sample the clearance every 100 ms while forward is held, until the camera has been at a wall for half a second
 *  (it keeps pushing into it) or `ms` is up; returns the smallest clearance seen. */
async function minClearanceDuring(page: Page, ms: number): Promise<number> {
  let min = Infinity;
  let atWall = 0;
  for (let t = 0; t < ms && atWall < 500; t += 100) {
    const c = await clearance(page);
    min = Math.min(min, c);
    if (c < AT_WALL) atWall += 100;
    await page.waitForTimeout(100);
  }
  return Math.min(min, await clearance(page));
}

async function check(width: number, height: number, touch: boolean) {
  const tag = `${width} walk`;
  step(tag);
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
    await page.waitForTimeout(200);
  };

  // ---- a 3D tool first, so entering Walk has something to switch off
  await press("tool-move");
  assert.equal(await tid(page, "tool-move").getAttribute("aria-pressed"), "true", `${tag}: Move chosen before walking`);
  assert.equal(await mode(page), "orbit");
  const orbit = await camera(page);
  assert.equal(await tid(page, "walk-ghost").isDisabled(), true, `${tag}: Walk through walls is disabled before Walk`);

  // ---- enter Walk
  await press("camera-walk");
  await page.waitForTimeout(400);
  assert.equal(await mode(page), "walk", `${tag}: walking`);
  assert.equal(await tid(page, "tool-select").getAttribute("aria-pressed"), "true", `${tag}: entering Walk switched the tool to Select`);
  assert.equal(await page.evaluate(() => (window as Win).__pushPullDebug!.tool), "select");
  for (const [t, label] of [["pushpull", "Push/Pull"], ["move", "Move"]]) {
    assert.equal(await tid(page, `tool-${t}`).getAttribute("aria-disabled"), "true", `${tag}: ${label} is disabled while walking`);
    assert.equal((await page.locator(`#tip-${t}`).textContent())?.trim(), `Exit Walk to use ${label}`, `${tag}: with a tooltip that says why`);
  }
  const walkCam = await camera(page);
  assert.equal(walkCam.fov, 70, `${tag}: the walk camera's fov`);
  const start = await pose(page);
  const startClear = await clearance(page);
  assert.ok(startClear >= CAMERA_RADIUS, `${tag}: the start pose is clear (${startClear.toFixed(3)} m)`);

  // ---- move forward: W held on the keyboard, or the joystick pushed up with a finger
  let minClear: number;
  if (!touch) {
    await tid(page, "scene-3d").focus(); // keys are read only while the 3D host has focus (entering Walk focuses it too)
    await page.keyboard.down("w");
    minClear = await minClearanceDuring(page, HOLD_MS);
    await page.screenshot({ path: `${OUT}/walk-${width}.png` });
    await page.keyboard.up("w");
  } else {
    const stick = (await tid(page, "walk-joystick").boundingBox())!;
    const c = { x: stick.x + stick.width / 2, y: stick.y + stick.height / 2 };
    const cdp = await page.context().newCDPSession(page);
    const touchAt = (type: "touchStart" | "touchMove", y: number) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: [{ x: c.x, y }] });
    await touchAt("touchStart", c.y);
    for (let i = 1; i <= 4; i++) await touchAt("touchMove", c.y - 10 * i); // 40 px up: full forward on a 96 px base
    minClear = await minClearanceDuring(page, HOLD_MS);
    await page.screenshot({ path: `${OUT}/walk-${width}.png` });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  }
  await page.waitForTimeout(300); // velocity smoothing settles
  const end = await pose(page);
  const moved = Math.hypot(end.x - start.x, end.y - start.y);
  assert.ok(moved > 0.5, `${tag}: the camera moved forward ${moved.toFixed(2)} m`);
  const forward = (end.x - start.x) * Math.cos(start.heading) + (end.y - start.y) * Math.sin(start.heading);
  assert.ok(forward > 0.4, `${tag}: and mostly along its heading (${forward.toFixed(2)} m)`);
  const camNow = await camera(page);
  assert.ok(gap(camNow.position, walkCam.position) > 0.4, `${tag}: the rendered camera itself moved`);
  assert.ok(minClear < AT_WALL, `${tag}: it walked up to a wall (min clearance ${minClear.toFixed(3)} m), so the next check means something`);
  assert.ok(minClear >= CAMERA_RADIUS - 1e-6, `${tag}: the clearance never dropped below the camera radius (min ${minClear.toFixed(3)} m)`);

  // ---- step G.1: walk through walls, then turn it off inside one
  step(`${tag}: walk through walls`);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const toggle = tid(page, "walk-ghost");
  const cdp = touch ? await page.context().newCDPSession(page) : null;
  const stick = (await tid(page, "walk-joystick").boundingBox().catch(() => null)) ?? { x: 0, y: 0, width: 0, height: 0 };
  const sc = { x: stick.x + stick.width / 2, y: stick.y + stick.height / 2 };
  /** Forward (+1) or back (-1) by W / S, or the joystick pushed `dy` px from its centre (negative is forward). */
  const mover = (dir: 1 | -1) => ({
    hold: async () => {
      if (!touch) return page.keyboard.down(dir > 0 ? "w" : "s");
      await cdp!.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: sc.x, y: sc.y }] });
      const dy = dir > 0 ? -40 : 14; // back: a gentle push, slow enough to stop inside a 0.1 m wall
      for (let i = 1; i <= 4; i++) await cdp!.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: sc.x, y: sc.y + (dy * i) / 4 }] });
    },
    release: async () => {
      if (!touch) return page.keyboard.up(dir > 0 ? "w" : "s");
      await cdp!.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    },
  });
  const flip = async () => {
    if (touch) await toggle.tap();
    else {
      await tid(page, "scene-3d").focus();
      await page.keyboard.press("g");
    }
  };
  if (touch) {
    const t = (await toggle.boundingBox())!;
    assert.ok(t.height >= 44 && t.width >= 44, `${tag}: the toggle is a 44 px target (${t.width.toFixed(0)} × ${t.height.toFixed(0)})`);
    assert.ok(!overlaps(t, stick), `${tag}: the toggle does not overlap the joystick`);
    assert.ok(!overlaps(t, (await tid(page, "walk-exit").boundingBox())!), `${tag}: the toggle does not overlap Exit`);
  }
  assert.equal(await toggle.isDisabled(), false, `${tag}: the toggle is enabled while walking`);
  assert.equal(await toggle.getAttribute("aria-pressed"), "false", `${tag}: and off`);
  const atWall = await pose(page);
  await flip();
  assert.equal(await ghost(page), true, `${tag}: ${touch ? "a tap" : "G"} turns Walk through walls on`);
  assert.equal(await toggle.getAttribute("aria-pressed"), "true", `${tag}: aria-pressed says so`);
  assert.equal((await tid(page, "walk-ghost-status").textContent())?.trim(), GHOST_STATUS, `${tag}: with the status line`);

  // Forward: into the wall the camera was stopped by (clearance below 0) and out the far side (clearance back over 0.25 m).
  const fwd = mover(1);
  await page.evaluate("window.__ghostSeenInside = false");
  await holdUntil(page, fwd.hold, fwd.release, "(() => { const c = window.__walkDebug.clearance(); if (c < 0) window.__ghostSeenInside = true; return window.__ghostSeenInside && c > 0.25; })()", `${tag}: through the wall`);
  const through = await pose(page);
  const passed = (through.x - atWall.x) * Math.cos(atWall.heading) + (through.y - atWall.y) * Math.sin(atWall.heading);
  assert.ok(passed > 0.3, `${tag}: the camera went on past where the wall stopped it (${passed.toFixed(2)} m)`);
  assert.ok((await clearance(page)) >= CAMERA_RADIUS, `${tag}: and stands clear on the other side`);

  // Back: into the same wall again, and stop there.
  const back_ = mover(-1);
  await holdUntil(page, back_.hold, back_.release, "window.__walkDebug.clearance() < 0", `${tag}: back into the wall`);
  const inside = await clearance(page);
  assert.ok(inside < CAMERA_RADIUS - 0.001, `${tag}: stopped where a wall covers the camera (clearance ${inside.toFixed(3)} m)`);
  await page.screenshot({ path: `${OUT}/${touch ? "walk-ghost-390" : "walk-ghost-on-1440"}.png` });
  const before = await pose(page);

  // Off, inside the wall: put on the nearest clear point, with the notice.
  await flip();
  assert.equal(await ghost(page), false, `${tag}: turned off`);
  assert.equal(await toggle.getAttribute("aria-pressed"), "false");
  assert.equal(await tid(page, "walk-ghost-status").count(), 0, `${tag}: the status line is gone`);
  await page.waitForTimeout(200);
  const rescued = await pose(page);
  const jump = Math.hypot(rescued.x - before.x, rescued.y - before.y);
  const clear = await clearance(page);
  assert.ok(clear >= CAMERA_RADIUS - 1e-6, `${tag}: the camera is on a clear point (clearance ${clear.toFixed(4)} m)`);
  assert.ok(jump > 0 && jump <= 2, `${tag}: moved ${jump.toFixed(3)} m to get there`);
  assert.equal(rescued.eye, before.eye, `${tag}: the eye height is unchanged`);
  assert.equal((await tid(page, "walk-notice").textContent())?.trim(), MOVED_NOTICE, `${tag}: with the notice`);
  if (cdp) await cdp.detach();

  // ---- leave Walk: Escape on a keyboard, the Exit button on a phone; the orbit camera comes back exactly
  const leave = async (when: string) => {
    if (!touch) {
      await tid(page, "scene-3d").focus();
      await page.keyboard.press("Escape");
    } else await press("walk-exit");
    await page.waitForTimeout(400);
    assert.equal(await mode(page), "orbit", `${tag}: ${touch ? "Exit" : "Escape"} ends Walk${when}`);
    const back = await camera(page);
    const off = gap(back.position, orbit.position);
    assert.ok(off < 1e-6, `${tag}: the orbit camera is back within 0.001 mm${when} (off by ${(off * 1000).toFixed(6)} mm)`);
    assert.ok(gap(back.forward, orbit.forward) < 1e-6, `${tag}: looking the same way`);
    assert.equal(back.fov, orbit.fov, `${tag}: same fov`);
    assert.equal(back.near, orbit.near, `${tag}: same near plane`);
    assert.equal(await tid(page, "tool-move").getAttribute("aria-disabled"), "false", `${tag}: after Walk, Move is enabled again`);
    assert.equal(await toggle.isDisabled(), true, `${tag}: the toggle is disabled outside Walk`);
    return off;
  };
  const off = await leave("");
  await press("camera-walk");
  await page.waitForTimeout(400);
  assert.equal(await mode(page), "walk", `${tag}: walking again`);
  assert.equal(await ghost(page), false, `${tag}: the next walk starts with Walk through walls off`);
  assert.equal(await toggle.getAttribute("aria-pressed"), "false");
  const off2 = await leave(" the second time");
  console.log(
    `${tag}: ok (${touch ? "joystick" : "W key"}: moved ${moved.toFixed(2)} m, min clearance ${minClear.toFixed(3)} m; ` +
      `ghost: ${passed.toFixed(2)} m past the wall, stopped inside it at clearance ${inside.toFixed(3)} m, put ${jump.toFixed(3)} m away at ${clear.toFixed(3)} m; ` +
      `orbit camera back within ${(off * 1000).toFixed(6)} mm, then ${(off2 * 1000).toFixed(6)} mm)`,
  );
  await browser.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  await warmRoutes(["/studio"]);
  await check(1440, 900, false);
  await check(390, 844, true);
  assert.deepEqual(errors, [], `console errors:\n${errors.join("\n")}`);
  console.log("e2e-walk: ok; screenshots in", OUT);
}
withSuiteTimeout("e2e-walk", 15 * 60_000, main).catch((e) => {
  console.error(e);
  process.exit(1);
});
