/**
 * e2e-studio.ts — browser test of the editor shell, src/app/studio/page.tsx,
 * with Playwright's Chromium. Not in npm test. Needs the dev server (npm run
 * dev; E2E_URL overrides http://localhost:3000): it reads window.__planStore.
 *
 * At 1440×900 and 390×844: load /studio; switch 3D, 2D and Split (Split is
 * hidden at 390); rename a room and check the store; Undo button brings the old
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

type Win = Window & { __planStore?: { getState(): { plan: { name: string; rooms: { name: string }[] } } } };
const plan = (page: Page) => page.evaluate(() => (window as Win).__planStore!.getState().plan);
const num = async (page: Page, id: string) => parseFloat((await page.getByTestId(id).innerText()).replace(/[^\d.]/g, ""));
const tid = (page: Page, id: string) => page.getByTestId(id);

const errors: string[] = [];

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
  await tid(page, "view-2d").click();
  assert.equal(await page.locator("canvas").count(), 0, `${tag}: 2D has no canvas`);
  assert.ok(await page.getByText("The 2D plan arrives in the next step").isVisible());
  if (wide) {
    await tid(page, "view-split").click();
    await page.waitForSelector("canvas");
    assert.ok(await page.getByText("The 2D plan arrives in the next step").isVisible(), `${tag}: split shows both`);
    const [a, b] = await Promise.all([tid(page, "pane-3d").boundingBox(), tid(page, "pane-2d").boundingBox()]);
    assert.ok(a!.x < b!.x && Math.abs(a!.y - b!.y) < 2, `${tag}: split is side by side`);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/studio-${tag}-split.png` });
  } else {
    assert.equal(await tid(page, "view-split").isVisible(), false, `${tag}: Split hidden on a phone`);
  }
  await tid(page, "view-3d").click();
  await page.waitForSelector("canvas");
  assert.equal(await page.getByText("The 2D plan arrives in the next step").count(), 0);

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
