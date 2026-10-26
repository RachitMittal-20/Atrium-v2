/**
 * e2e-newplan.ts — a repeatable browser check of step N.1 (New plan, the first-run hint, the empty
 * state) with Playwright's Chromium. NOT in npm test: it needs `npm run dev` on port 3000 (E2E_URL
 * overrides) for the dev-only hooks window.__planStore and window.__toolStore, used to make test data
 * and to read state. Everything else is real input: clicks at 1440, taps at 390, the keyboard for
 * Ctrl+Z and Tab. No blind waits: each wait is a named condition (scripts/e2e-helpers.ts).
 *
 * At each width (1440×900 mouse, 390×844 touch), in a fresh browser context:
 *   - arrive with an autosaved, edited plan: edit through the hook, wait for the "Saved" status, reload;
 *     the edited plan is back and the hint is NOT shown (it is not the sample);
 *   - Import > New plan… asks (it says there are unsaved changes and offers Save first), "Start from the
 *     sample plan" shows the shipped sample, the hint shows, and Ctrl+Z brings the edited plan back
 *     (one undo step); the autosave in localStorage follows both;
 *   - the hint: shown once; the page does not move when it goes (the panes' boxes are identical with
 *     and without it, and at 390 the page is exactly 390 px wide); it fits the viewport; its button is
 *     44 px high and Tab reaches it; Enter dismisses it; a reload and a New plan > sample do not bring it back;
 *   - New plan > Empty plan: the empty-state card with "Import a floor plan" (a link to /studio/import)
 *     and "Draw a wall" (picks the Wall tool and the card steps aside); the Rooms and Takeoff panels
 *     have their one-line empty states; no console errors with an empty plan in 3D and 2D;
 *   - Cancel in the New plan dialog changes nothing.
 * Screenshots in /tmp/studio/: newplan-menu-1440.png, hint-390.png, empty-state-1440.png (and the same
 * for the other width).
 * Run: npx tsx scripts/e2e-newplan.ts
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import { BASE, step, waitForHook, waitForScene3d, waitUntil, warmRoutes, watchErrors, withSuiteTimeout } from "./e2e-helpers";
import { samplePlan } from "../src/data/samplePlan";
import type { Plan } from "../src/types/plan";

const OUT = "/tmp/studio";
const EXECUTABLE = process.env.E2E_CHROMIUM || undefined;
const HINT_KEY = "atrium.studioHint";

type Win = Window & {
  __planStore?: { getState(): { plan: Plan; past: unknown[]; renamePlan(n: string): void; updateWall(id: string, c: object): void } };
  __toolStore?: { getState(): { tool: string } };
};

const errors: string[] = [];
const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
const plan = (page: Page) => page.evaluate(() => (window as Win).__planStore!.getState().plan);
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("atrium-v2:plan") ?? "null")?.plan ?? null);
const box = async (l: Locator) => (await l.boundingBox())!;

async function main() {
  await warmRoutes(["/studio"]);
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  try {
    for (const [width, height, touch] of [[1440, 900, false], [390, 844, true]] as const) await run(browser, width, height, touch);
  } finally {
    await browser.close();
  }
  assert.deepEqual(errors, [], `console errors:\n${errors.join("\n")}`);
  console.log("e2e-newplan: OK");
}

async function run(browser: Browser, width: number, height: number, touch: boolean) {
  const tag = String(width);
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  const page = await context.newPage();
  watchErrors(page, tag, errors);
  const press = (l: Locator) => (touch ? l.tap() : l.click());
  const hideDevBadge = () => page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  const menuItem = async (menu: string, item: string) => {
    await press(tid(page, menu));
    await press(tid(page, item));
  };
  const open = async (what: string) => {
    await page.goto(`${BASE}/studio`);
    await waitForHook(page, "__planStore", what);
    await hideDevBadge();
  };
  const saved = (what: string) => waitUntil(page, `${tag}: ${what} never reached "Saved"`, `document.querySelector('[data-testid="save-status"]')?.dataset.state === "saved"`);

  // ---- arrive with an autosaved, edited plan
  step(`${tag}: an autosaved, edited plan`);
  await open("the studio, first visit");
  assert.ok(await tid(page, "studio-hint").isVisible(), `${tag}: a first visit shows the hint (the untouched sample)`);
  await page.evaluate(() => {
    const st = (window as Win).__planStore!.getState();
    st.renamePlan("My flat");
    st.updateWall("w-AB", { thickness: 0.3 });
  });
  await saved("the edit");
  assert.equal((await stored(page)).name, "My flat", `${tag}: the autosave holds the edited plan`);
  await page.reload();
  await waitForHook(page, "__planStore", "the studio after reload");
  await hideDevBadge();
  const edited = await plan(page);
  assert.equal(edited.name, "My flat", `${tag}: the edited plan is back after a reload`);
  assert.equal(await tid(page, "studio-hint").count(), 0, `${tag}: an edited plan does not show the hint`);
  assert.equal(await tid(page, "empty-plan").count(), 0, `${tag}: and not the empty state`);

  // ---- Cancel changes nothing
  step(`${tag}: Cancel`);
  await menuItem("import-menu", "new-plan");
  await tid(page, "project-dialog").waitFor();
  await press(tid(page, "project-cancel"));
  await tid(page, "project-dialog").waitFor({ state: "hidden" });
  assert.deepEqual(await plan(page), edited, `${tag}: Cancel leaves the plan alone`);

  // ---- New plan > sample, then Ctrl+Z
  step(`${tag}: New plan`);
  await press(tid(page, "import-menu"));
  await tid(page, "new-plan").waitFor();
  if (width === 1440) await page.screenshot({ path: `${OUT}/newplan-menu-1440.png` });
  await press(tid(page, "new-plan"));
  await tid(page, "project-dialog").waitFor();
  const dlg = await box(tid(page, "project-dialog"));
  assert.ok(dlg.x >= 0 && dlg.x + dlg.width <= width && dlg.y >= 0 && dlg.y + dlg.height <= height, `${tag}: the dialog fits the viewport`);
  assert.equal(await tid(page, "new-plan-text").getAttribute("data-dirty"), "true", `${tag}: the restored plan counts as unsaved, so the dialog warns`);
  assert.match(await tid(page, "new-plan-text").innerText(), /aren't saved to a project file[\s\S]*undo/, `${tag}: it says why and that it can be undone`);
  assert.ok(await tid(page, "project-save-first").isVisible(), `${tag}: and offers Save first`);
  const pastBefore = await page.evaluate(() => (window as Win).__planStore!.getState().past.length);
  await press(tid(page, "new-plan-sample"));
  await tid(page, "project-dialog").waitFor({ state: "hidden" });
  const sample = await plan(page);
  assert.equal(sample.name, samplePlan.name, `${tag}: the sample plan`);
  assert.equal(sample.walls.length, samplePlan.walls.length, `${tag}: with all its walls`);
  assert.equal(await page.evaluate(() => (window as Win).__planStore!.getState().past.length), pastBefore + 1, `${tag}: one undo step`);
  await tid(page, "studio-hint").waitFor();
  await saved("New plan");
  assert.equal((await stored(page)).name, samplePlan.name, `${tag}: the autosave holds the new plan`);

  await page.keyboard.press("Control+z");
  await waitUntil(page, `${tag}: Ctrl+Z did not bring the old plan back`, `window.__planStore.getState().plan.name === "My flat"`);
  assert.deepEqual(await plan(page), edited, `${tag}: Ctrl+Z brings the edited plan back exactly`);
  assert.equal(await tid(page, "studio-hint").count(), 0, `${tag}: and the hint goes with it`);
  await saved("Undo");
  assert.equal((await stored(page)).name, "My flat", `${tag}: the autosave follows the undo`);

  // ---- the hint: shown once, moves nothing, reachable by keyboard
  step(`${tag}: the hint`);
  await menuItem("import-menu", "new-plan");
  await press(tid(page, "new-plan-sample"));
  const hint = tid(page, "studio-hint");
  await hint.waitFor();
  await waitForScene3d(page, `${tag}: the sample plan after New plan`); // the panes remount: draw the model before measuring or screenshotting
  const hb = await box(hint);
  assert.ok(hb.x >= 0 && hb.x + hb.width <= width && hb.y >= 0 && hb.y + hb.height <= height, `${tag}: the hint fits the viewport (${JSON.stringify(hb)})`);
  assert.match(await hint.innerText(), /^Drag a wall to move it\. Press P to push or pull a face, K for takeoff, Walk to look around\./, `${tag}: its words`);
  const button = tid(page, "studio-hint-dismiss");
  assert.ok((await box(button)).height >= 44 - 0.5, `${tag}: the button is 44 px high`);
  const panes = async () => ({ main: await box(page.locator("main")), p3: await box(tid(page, "pane-3d")), panel: await box(page.locator('aside[aria-label="Plan details"]')) });
  const withHint = await panes();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `${tag}: no sideways scroll with the hint`);
  if (width === 390) await page.screenshot({ path: `${OUT}/hint-390.png` });
  // Tab reaches the button (the page has a modest number of stops before it), and Enter dismisses.
  await page.locator("body").click({ position: { x: 1, y: 1 } }).catch(() => {}); // start from the page, not a field
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  let reached = false;
  for (let i = 0; i < 80 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid === "studio-hint-dismiss");
  }
  assert.ok(reached, `${tag}: Tab reaches "Got it"`);
  await page.keyboard.press("Enter");
  await hint.waitFor({ state: "detached" });
  assert.deepEqual(await panes(), withHint, `${tag}: nothing moved when the hint went`);
  assert.equal(await page.evaluate((k) => localStorage.getItem(k), HINT_KEY), JSON.stringify({ dismissed: true }), `${tag}: remembered in its own localStorage key`);
  assert.ok(!JSON.stringify(await stored(page)).includes("dismiss"), `${tag}: not in the plan`);
  await page.reload();
  await waitForHook(page, "__planStore", "the studio after dismissing");
  await hideDevBadge();
  assert.equal(await tid(page, "studio-hint").count(), 0, `${tag}: a reload does not bring it back`);
  await menuItem("import-menu", "new-plan");
  await press(tid(page, "new-plan-sample"));
  await tid(page, "project-dialog").waitFor({ state: "hidden" });
  assert.equal(await tid(page, "studio-hint").count(), 0, `${tag}: nor does a new sample plan`);

  // ---- Empty plan
  step(`${tag}: Empty plan`);
  await menuItem("import-menu", "new-plan");
  await press(tid(page, "new-plan-empty"));
  const card = tid(page, "empty-plan");
  await card.waitFor();
  assert.equal((await plan(page)).walls.length, 0, `${tag}: an empty plan`);
  const cb = await box(card);
  assert.ok(cb.x >= 0 && cb.x + cb.width <= width && cb.y >= 0 && cb.y + cb.height <= height, `${tag}: the card fits the viewport`);
  assert.equal(await tid(page, "empty-import").getAttribute("href"), "/studio/import", `${tag}: Import a floor plan goes to the import screen`);
  assert.ok((await box(tid(page, "empty-import"))).height >= 43.5 && (await box(tid(page, "empty-draw"))).height >= 43.5, `${tag}: both buttons are 44 px high`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `${tag}: no sideways scroll`);
  assert.match(await tid(page, "no-rooms").textContent() ?? "", /No closed rooms yet/, `${tag}: the Rooms panel has its one-line empty state`);
  assert.match(await tid(page, "takeoff-empty").textContent() ?? "", /No takeoffs of your own yet/, `${tag}: and the Takeoff panel has its own`);
  await waitForHook(page, "__toolStore", "the tool store");
  await waitForScene3d(page, `${tag}: an empty plan in 3D`); // proves the empty scene frames itself (it used to freeze the tab)
  if (width === 1440) await page.screenshot({ path: `${OUT}/empty-state-1440.png` });
  else await page.screenshot({ path: `${OUT}/empty-state-390.png` });
  await press(tid(page, "empty-draw"));
  await waitUntil(page, `${tag}: Draw a wall did not pick the Wall tool`, `window.__toolStore.getState().tool === "wall"`);
  await card.waitFor({ state: "detached" });
  await press(tid(page, "tool-select")); // Escape back to Select is the 2D canvas's own key, so use the rail
  await waitUntil(page, `${tag}: the Select tool was not picked`, `window.__toolStore.getState().tool === "select"`);
  await card.waitFor(); // still an empty plan: the card is back

  // undo goes back to the sample, undo again to the edited plan
  await page.keyboard.press("Control+z");
  await waitUntil(page, `${tag}: undo of the empty plan`, `window.__planStore.getState().plan.walls.length > 0`);
  await context.close();
}

withSuiteTimeout("e2e-newplan", 300_000, main).catch((e) => {
  console.error(e);
  process.exit(1);
});
