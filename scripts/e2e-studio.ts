/**
 * e2e-studio.ts — browser test of the editor shell, src/app/studio/page.tsx,
 * with Playwright's Chromium. Not in npm test. Needs the dev server (npm run
 * dev; E2E_URL overrides http://localhost:3000): it reads window.__planStore.
 *
 * At 1440×900 and 390×844: load /studio; switch 3D, 2D and Split (Split is
 * hidden at 390); in 2D check the SVG plan (see check2d: walls, labels, Fit
 * margin, wheel zoom about the cursor, drag, keyboard, orientation, and the
 * live link to the store through window.__planStore; pinch zoom is NOT covered
 * here, it needs real touch input); rename a room and check the store; Undo button brings the old
 * name back, Redo button reapplies, Ctrl+Z / Ctrl+Shift+Z do the same from the
 * keyboard; rename the plan; toggle units and check the total area changes by
 * 10.7639; no console errors; no horizontal scroll; nothing visible sticks out
 * past the viewport; then follow the "Import plan" link.
 * Screenshots go to /tmp/studio/.
 * Run: npx tsx scripts/e2e-studio.ts
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright";

const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const OUT = "/tmp/studio";

type Rect = { x: number; y: number; width: number; height: number };
type Store = {
  getState(): {
    plan: { name: string; rooms: { id: string; name: string }[]; walls: { id: string }[] };
    renameRoom(id: string, name: string): void;
    moveWallEndpoint(wallId: string, end: "a" | "b", to: { x: number; y: number }): void;
    undo(): void;
  };
};
type Win = Window & { __planStore?: Store };
const plan = (page: Page) => page.evaluate(() => (window as Win).__planStore!.getState().plan);
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

async function run(width: number, height: number) {
  const tag = String(width);
  const wide = width >= 768;
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width, height } });
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
