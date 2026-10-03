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
 *   - press Escape: Walk ends and the orbit camera (position, view direction, fov,
 *     near) is back exactly, the position within 0.001 mm.
 * At 390×844 with real touch (Chromium's own touch input through CDP), the same, with
 * the on-screen joystick pushed up instead of W, and the Exit button instead
 * of Escape (a phone has no Escape key).
 * Screenshots: /tmp/studio/walk-{1440,390}.png, taken mid-walk.
 * Run: npx tsx scripts/e2e-walk.ts
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright";

const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const OUT = "/tmp/studio";
const EXECUTABLE = process.env.E2E_CHROMIUM || undefined;
const CAMERA_RADIUS = 0.2; // src/lib/walk/collision.ts
const HOLD_MS = 10000; // the most it holds forward: it stops sooner, once it is at a wall (a slow software-GL frame rate walks slower than 1.4 m/s)
const AT_WALL = 0.25; // m: a clearance this small means the camera has walked up to a wall

type Vec = [number, number, number];
type WalkDebug = {
  mode(): string;
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
const gap = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

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
  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: touch });
  page.on("pageerror", (e) => errors.push(`${tag} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag} console: ${m.text().slice(0, 200)}`));
  await page.goto(`${BASE}/studio`);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }); // the dev badge swallows phone taps
  await tid(page, "plan-name").waitFor();
  await page.waitForSelector("canvas");
  await page.waitForTimeout(1500); // the scene's first frames and the camera fit
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

  // ---- leave Walk: Escape on a keyboard, the Exit button on a phone; the orbit camera comes back exactly
  if (!touch) {
    await tid(page, "scene-3d").focus();
    await page.keyboard.press("Escape");
  } else await press("walk-exit");
  await page.waitForTimeout(400);
  assert.equal(await mode(page), "orbit", `${tag}: ${touch ? "Exit" : "Escape"} ends Walk`);
  const back = await camera(page);
  const off = gap(back.position, orbit.position);
  assert.ok(off < 1e-6, `${tag}: the orbit camera is back within 0.001 mm (off by ${(off * 1000).toFixed(6)} mm)`);
  assert.ok(gap(back.forward, orbit.forward) < 1e-6, `${tag}: looking the same way`);
  assert.equal(back.fov, orbit.fov, `${tag}: same fov`);
  assert.equal(back.near, orbit.near, `${tag}: same near plane`);
  assert.equal(await tid(page, "tool-move").getAttribute("aria-disabled"), "false", `${tag}: after Walk, Move is enabled again`);
  console.log(`${tag}: ok (${touch ? "joystick" : "W key"}: moved ${moved.toFixed(2)} m, min clearance ${minClear.toFixed(3)} m; orbit camera back within ${(off * 1000).toFixed(6)} mm)`);
  await browser.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  await check(1440, 900, false);
  await check(390, 844, true);
  assert.deepEqual(errors, [], `console errors:\n${errors.join("\n")}`);
  console.log("e2e-walk: ok; screenshots in", OUT);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
