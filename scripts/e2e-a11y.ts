/**
 * e2e-a11y.ts — step A.1: accessibility in a real browser. NOT in npm test: it needs `npm run dev` on port 3000
 * (E2E_URL overrides) for the dev-only hooks used to set up states. Two parts, each at 1440×900 (mouse) and
 * 390×844 (touch):
 *
 *   1. axe-core (node_modules/axe-core, injected into the page; no network) on every route and every view and dialog:
 *      /, /limits, /studio/import (idle, and the review of plan-chatgpt-flat.pdf), the 404, and the studio in 3D, 2D
 *      and split (not at 390: Split is hidden under 640 px), with a wall and a door selected, the Takeoff tool, a walk,
 *      and each open dialog (Report a problem, New plan, Export report, Save project, Set scale). Every violation is
 *      printed with its rule, impact and element; the suite FAILS on any critical or serious one. Moderate and minor are
 *      listed, never failed. `A11Y_OUT=/path.json` also writes them all as JSON.
 *   2. The keyboard walk of the studio, with Tab and the keys only: every control of the top bar, the tool rail and the
 *      camera group is reached, each shows a focus ring, the controls work from the keyboard (Enter or Space), each menu
 *      opens, reaches its items and closes on Escape with focus back on its button, and each dialog takes focus,
 *      keeps it inside while Tab goes round, and closes on Escape with focus back where it came from.
 *
 * No blind sleeps: every wait is a named condition (scripts/e2e-helpers.ts). Dev-only badge `nextjs-portal` is excluded from
 * axe, because it is Next's, not ours.
 * Run: npx tsx scripts/e2e-a11y.ts
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { BASE, step, waitForHook, waitForScene3d, waitUntil, warmRoutes, watchErrors, withSuiteTimeout } from "./e2e-helpers";

const AXE = readFileSync(join(process.cwd(), "node_modules/axe-core/axe.min.js"), "utf8");
const PDF = join(process.cwd(), "tests/fixtures/pdf/plan-chatgpt-flat.pdf");
const EXECUTABLE = process.env.E2E_CHROMIUM || undefined;
const WIDTHS: [number, number, boolean][] = [[1440, 900, false], [390, 844, true]];

const errors: string[] = [];
const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);

// ------------------------------------------------------------------ axe

interface Found { where: string; rule: string; impact: string; target: string; help: string }
const found: Found[] = [];

/** Runs axe on the page as it is and records every violation. Strings only: see the keepNames rule in CLAUDE.md. */
async function axe(page: Page, where: string): Promise<void> {
  if (!(await page.evaluate("typeof window.axe !== 'undefined'"))) await page.addScriptTag({ content: AXE });
  const result = (await page.evaluate(`axe.run(document, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
    resultTypes: ["violations"],
    exclude: [["nextjs-portal"]],
  }).then(r => r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map(n => n.target.join(" ").slice(0, 160) + " :: " + ((n.any[0] || n.all[0] || n.none[0] || {}).message || "").slice(0, 150)) })))`)) as { id: string; impact: string; help: string; nodes: string[] }[];
  for (const v of result) for (const n of v.nodes) found.push({ where, rule: v.id, impact: v.impact, target: n, help: v.help });
  console.log(`axe ${where}: ${result.length === 0 ? "clean" : result.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}`).join(", ")}`);
}

const LEVEL = ["minor", "moderate", "serious", "critical"];
const blocking = () => found.filter((f) => LEVEL.indexOf(f.impact) >= 2);

// ------------------------------------------------------------------ page helpers

async function openStudio(page: Page, what: string) {
  await page.goto(`${BASE}/studio`);
  await waitForHook(page, "__planStore", what);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

/** On a phone the details panel is a sheet that starts closed: open it so axe sees what is selected. */
async function openSheet(page: Page) {
  const toggle = page.locator("button[aria-controls=plan-details]");
  if ((await toggle.isVisible()) && (await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
}

/** Opens an Export or Import menu item the way a user does. */
async function menuItem(page: Page, menu: string, item: string, touch: boolean) {
  const press = (id: string) => (touch ? tid(page, id).tap() : tid(page, id).click());
  await press(menu);
  await press(item);
}

// ------------------------------------------------------------------ part 1: axe over everything

async function axePart(browser: Browser, width: number, height: number, touch: boolean) {
  const tag = String(width);
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  const page = await context.newPage();
  watchErrors(page, tag, errors);
  const press = (id: string) => (touch ? tid(page, id).tap() : tid(page, id).click());

  step(`${tag}: landing`);
  await page.goto(`${BASE}/`);
  await page.waitForSelector("[data-testid=blueprint-scene]");
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await axe(page, `${tag} /`);
  await page.evaluate("window.scrollTo(0, innerHeight * 4.5)");
  await waitUntil(page, `${tag}: the landing never scrolled`, "window.scrollY > 100");
  await axe(page, `${tag} / (in the tour)`);
  // Not at the very end of the scroll: there the hero stage is visibility:hidden (it must not slide over the tour), so the
  // page briefly has no visible h1. The footer is in the DOM, and checked, at every other position.

  step(`${tag}: limits, 404`);
  await page.goto(`${BASE}/limits`);
  await tid(page, "limits-link").or(page.locator("h1")).first().waitFor();
  await axe(page, `${tag} /limits`);
  const seen = errors.length;
  await page.goto(`${BASE}/no-such-page`);
  await tid(page, "not-found").waitFor();
  errors.length = seen; // the browser logs "Failed to load resource: 404" for the 404 document itself, which is the point of the visit
  await axe(page, `${tag} 404`);

  step(`${tag}: import, idle and review`);
  await page.goto(`${BASE}/studio/import`);
  await tid(page, "first-run-hint").waitFor();
  await axe(page, `${tag} /studio/import (idle)`);
  await tid(page, "file-input").setInputFiles(PDF);
  await page.waitForSelector("[data-testid=results][data-review=ready], [data-testid=error]", { timeout: 120_000 });
  assert.equal(await tid(page, "error").count(), 0, `${tag}: plan-chatgpt-flat.pdf failed to import`);
  await axe(page, `${tag} /studio/import (review of plan-chatgpt-flat.pdf)`);
  await press("report-problem");
  await tid(page, "report-dialog").waitFor();
  await axe(page, `${tag} import: Report a problem dialog`);
  await page.keyboard.press("Escape");
  await tid(page, "report-dialog").waitFor({ state: "hidden" });

  step(`${tag}: studio views`);
  await openStudio(page, "the studio");
  await waitForScene3d(page, "the studio, 3D");
  await axe(page, `${tag} /studio 3D`);
  await press("view-2d");
  await tid(page, "plan-canvas").waitFor();
  await axe(page, `${tag} /studio 2D`);
  if (width >= 640) {
    await press("view-split");
    await tid(page, "plan-canvas").waitFor();
    await waitForScene3d(page, "the studio, split");
    await axe(page, `${tag} /studio split`);
  }
  await press("view-2d");
  await tid(page, "plan-canvas").waitFor();

  step(`${tag}: studio states`);
  if (await tid(page, "studio-hint-dismiss").count()) await press("studio-hint-dismiss"); // the first-run hint: a visitor dismisses it (see CLAUDE.md, step A.1, for where it overlaps the zoom buttons)
  const ids = (await page.evaluate("(() => { const s = window.__planStore.getState().plan; return { wall: s.walls[0].id, door: s.openings.find(o => o.kind === 'door').id }; })()")) as { wall: string; door: string };
  await page.evaluate(`window.__selectionStore.getState().select(${JSON.stringify(ids.wall)})`);
  await openSheet(page);
  await tid(page, "wall-panel").waitFor();
  await axe(page, `${tag} /studio, a wall selected`);
  await page.evaluate(`window.__selectionStore.getState().selectOpening(${JSON.stringify(ids.door)})`);
  await tid(page, "opening-panel").waitFor();
  await axe(page, `${tag} /studio, a door selected`);
  await page.evaluate("window.__selectionStore.getState().select(null)");
  await press("tool-takeoff");
  await waitUntil(page, `${tag}: Takeoff never became the tool`, `window.__toolStore.getState().tool === "takeoff"`);
  await axe(page, `${tag} /studio, Takeoff tool`);
  await press("tool-select");
  await press("view-3d");
  await waitForScene3d(page, "the studio, 3D again");
  await press("camera-walk");
  await waitUntil(page, `${tag}: the walk never started`, `document.querySelector('[data-testid="camera-walk"]').getAttribute("aria-pressed") === "true"`);
  await axe(page, `${tag} /studio, walking`);
  await page.keyboard.press("Escape");

  step(`${tag}: dialogs`);
  await press("report-problem");
  await tid(page, "report-dialog").waitFor();
  await axe(page, `${tag} studio: Report a problem dialog`);
  await page.keyboard.press("Escape");
  await tid(page, "report-dialog").waitFor({ state: "hidden" });

  await menuItem(page, "import-menu", "new-plan", touch);
  await tid(page, "project-dialog").waitFor();
  await axe(page, `${tag} studio: New plan dialog`);
  await page.keyboard.press("Escape");
  await tid(page, "project-dialog").waitFor({ state: "hidden" });

  await menuItem(page, "export-menu", "export-pdf", touch);
  await tid(page, "export-dialog").waitFor();
  await axe(page, `${tag} studio: Export report dialog`);
  await page.keyboard.press("Escape");
  await tid(page, "export-dialog").waitFor({ state: "hidden" });

  await menuItem(page, "export-menu", "save-project", touch);
  await tid(page, "project-dialog").waitFor();
  await waitUntil(page, `${tag}: the file size never showed`, `document.querySelector('[data-testid="project-size"]')?.dataset.bytes`);
  await axe(page, `${tag} studio: Save project dialog`);
  await page.keyboard.press("Escape");
  await tid(page, "project-dialog").waitFor({ state: "hidden" });

  await press("view-2d");
  await tid(page, "plan-canvas").waitFor();
  // Set scale: two picked points open its dialog (the points themselves are canvas input, covered by e2e-calibrate).
  await page.evaluate(`window.__calibrateStore.setState({ picking: false, points: [[0, 0], [3, 0]], asking: true })`);
  await page.waitForSelector("dialog[open]");
  await axe(page, `${tag} studio: Set scale dialog`);
  await page.keyboard.press("Escape");
  await page.waitForSelector("dialog[open]", { state: "detached" });
  await context.close();
}

// ------------------------------------------------------------------ part 2: the keyboard walk

/** What the focused element is called: its test id, else its accessible name, else its tag. */
const FOCUS = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  const ring = (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2) || (s.boxShadow !== "none" && s.boxShadow !== "");
  return {
    id: el.getAttribute("data-testid") || el.getAttribute("aria-label") || (el.textContent || el.tagName).trim().slice(0, 30),
    tag: el.tagName, ring, visible: r.width > 0 && r.height > 0, inDialog: !!el.closest("dialog[open]"),
    expanded: el.getAttribute("aria-expanded"), pressed: el.getAttribute("aria-pressed"),
    focusVisible: el.matches(":focus-visible"),
  };
})()`;
interface Focus { id: string; tag: string; ring: boolean; visible: boolean; inDialog: boolean; expanded: string | null; pressed: string | null; focusVisible: boolean }
const focused = (page: Page) => page.evaluate(FOCUS) as Promise<Focus | null>;

/** Presses Tab up to `max` times, until `done` says stop; returns everything focused on the way. */
async function tabUntil(page: Page, max: number, done: (f: Focus) => boolean): Promise<Focus[]> {
  const seen: Focus[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const f = await focused(page);
    if (!f) continue;
    seen.push(f);
    if (done(f)) break;
  }
  return seen;
}

/** Focuses a control by id with the keyboard only: Tab from the page's start until it is reached. */
async function tabTo(page: Page, id: string, max = 80): Promise<void> {
  await page.evaluate("document.activeElement && document.activeElement.blur()");
  const seen = await tabUntil(page, max, (f) => f.id === id);
  assert.equal(seen.at(-1)?.id, id, `Tab never reached "${id}" in ${max} presses (saw ${seen.map((s) => s.id).join(", ")})`);
}

async function keyboardPart(browser: Browser, width: number, height: number, touch: boolean) {
  const tag = String(width);
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  const page = await context.newPage();
  watchErrors(page, tag, errors);

  step(`${tag}: Tab walk`);
  await openStudio(page, "the studio, keyboard walk");
  await waitForScene3d(page, "the studio, keyboard walk");
  // An edit makes Undo enabled (a disabled button is correctly skipped by Tab) and the plan "unsaved" (Open project asks first).
  await page.evaluate("window.__planStore.getState().renamePlan('Keyboard test')");
  await waitUntil(page, `${tag}: Undo never enabled`, `!document.querySelector('[data-testid="undo"]').disabled`);

  const required = [
    "plan-name", "undo", "redo", "view-3d", "view-2d", ...(width >= 640 ? ["view-split"] : []), "view-options", "units-menu", "import-menu", "export-menu", "report-problem",
    "tool-select", "tool-wall", "tool-door", "tool-window", "tool-pushpull", "tool-move", "tool-rotate", "tool-scale", "tool-measure", "tool-takeoff",
    "camera-orbit", "camera-top", "camera-walk", "camera-recenter",
  ];
  await page.evaluate("document.activeElement && document.activeElement.blur()");
  const walk = await tabUntil(page, 120, () => false);
  const ids = new Set(walk.map((f) => f.id));
  for (const id of required) {
    if (id === "redo") continue; // nothing to redo yet: correctly skipped
    assert.ok(ids.has(id), `${tag}: Tab never reached "${id}". It reached: ${[...ids].join(", ")}`);
  }
  for (const f of walk) {
    if (!f.visible) continue;
    assert.ok(f.focusVisible, `${tag}: "${f.id}" was focused by Tab but is not :focus-visible`);
    assert.ok(f.ring, `${tag}: "${f.id}" has no visible focus ring (outline or shadow)`);
  }
  console.log(`${tag}: Tab reached ${walk.length} stops, ${required.length - 1} required controls among them`);

  step(`${tag}: controls work from the keyboard`);
  await tabTo(page, "view-2d");
  await page.keyboard.press("Enter");
  await waitUntil(page, `${tag}: Enter on 2D did nothing`, `document.querySelector('[data-testid="view-2d"]').getAttribute("aria-pressed") === "true"`);
  await tabTo(page, "tool-wall");
  await page.keyboard.press("Space");
  await waitUntil(page, `${tag}: Space on Wall did nothing`, `window.__toolStore.getState().tool === "wall"`);
  await tabTo(page, "tool-select");
  await page.keyboard.press("Enter");
  await waitUntil(page, `${tag}: Enter on Select did nothing`, `window.__toolStore.getState().tool === "select"`);
  await tabTo(page, "view-3d");
  await page.keyboard.press("Enter");
  await waitForScene3d(page, "the studio, back to 3D by keyboard");
  await tabTo(page, "camera-top");
  await page.keyboard.press("Enter");
  await waitUntil(page, `${tag}: Enter on Top did nothing`, `document.querySelector('[data-testid="camera-top"]').getAttribute("aria-pressed") === "true"`);
  await tabTo(page, "camera-orbit");
  await page.keyboard.press("Enter");
  await waitUntil(page, `${tag}: Enter on Orbit did nothing`, `document.querySelector('[data-testid="camera-orbit"]').getAttribute("aria-pressed") === "true"`);
  await tabTo(page, "camera-recenter");
  await page.keyboard.press("Enter");
  await tabTo(page, "undo");
  await page.keyboard.press("Enter");
  await waitUntil(page, `${tag}: Enter on Undo did nothing`, `window.__planStore.getState().plan.name !== "Keyboard test"`);
  await page.evaluate("window.__planStore.getState().renamePlan('Keyboard test')");

  step(`${tag}: menus`);
  const menus: [string, string[]][] = [
    ["view-options", ["show-ceilings"]],
    ["import-menu", ["new-plan", "import-link", "import-model", "open-project"]],
    ["export-menu", ["save-project", "export-schedule", "export-pdf", "export-glb", "export-obj"]],
  ];
  for (const [menu, items] of menus) {
    await tabTo(page, menu);
    await page.keyboard.press("Enter");
    await waitUntil(page, `${tag}: Enter on ${menu} did not open it`, `document.querySelector('[data-testid="${menu}"]').getAttribute("aria-expanded") === "true"`);
    const inside = await tabUntil(page, items.length + 1, (f) => f.id === items.at(-1));
    for (const item of items) assert.ok(inside.some((f) => f.id === item), `${tag}: Tab inside ${menu} never reached "${item}" (${inside.map((f) => f.id).join(", ")})`);
    for (const f of inside) assert.ok(f.ring, `${tag}: "${f.id}" in ${menu} has no focus ring`);
    await page.keyboard.press("Escape");
    await waitUntil(page, `${tag}: Escape did not close ${menu}`, `document.querySelector('[data-testid="${menu}"]').getAttribute("aria-expanded") === "false"`);
    assert.equal((await focused(page))?.id, menu, `${tag}: focus did not return to ${menu} after Escape`);
  }
  // Units: two radio groups. Tab reaches the checked radio of each; the arrow keys change it.
  await tabTo(page, "units-menu");
  await page.keyboard.press("Enter");
  const radios = await tabUntil(page, 2, () => false);
  assert.equal(radios.length, 2, `${tag}: Units menu did not hold two radio groups`);
  const checked = `document.querySelector('input[name="topbar-length"]:checked').dataset.testid`;
  const before = await page.evaluate(checked);
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("ArrowRight");
  const after = await page.evaluate(checked);
  assert.notEqual(after, before, `${tag}: an arrow key did not change the length unit`);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Escape");
  assert.equal((await focused(page))?.id, "units-menu", `${tag}: focus did not return to the Units button`);

  step(`${tag}: dialogs by keyboard`);
  // [opener, item inside its menu (null when the opener opens the dialog itself), dialog test id, who gets focus back]
  const dialogs: [string, string | null, string][] = [
    ["report-problem", null, "report-dialog"],
    ["import-menu", "new-plan", "project-dialog"],
    ["import-menu", "open-project", "project-dialog"], // the plan is "unsaved", so Open asks first
    ["export-menu", "save-project", "project-dialog"],
    ["export-menu", "export-pdf", "export-dialog"],
    ["export-menu", "export-glb", "export-dialog"],
  ];
  for (const [opener, item, dialog] of dialogs) {
    const what = `${tag}: ${opener}${item ? " > " + item : ""}`;
    await tabTo(page, opener);
    await page.keyboard.press("Enter");
    if (item) {
      await tabUntil(page, 10, (f) => f.id === item);
      assert.equal((await focused(page))?.id, item, `${what}: item not reached`);
      await page.keyboard.press("Enter");
    }
    await tid(page, dialog).waitFor();
    await waitUntil(page, `${what}: focus never went into the dialog`, `Boolean(document.activeElement?.closest("dialog[open]"))`);
    // Tab goes round inside the dialog and never out of it.
    const round = await tabUntil(page, 14, () => false);
    assert.ok(round.length > 0 && round.every((f) => f.inDialog), `${what}: Tab left the dialog (${round.map((f) => `${f.id}:${f.inDialog}`).join(", ")})`);
    for (const f of round) assert.ok(f.ring, `${what}: "${f.id}" in the dialog has no focus ring`);
    await page.keyboard.press("Escape");
    await tid(page, dialog).waitFor({ state: "hidden" });
    // The dialog's "close" event, where focus goes back, is queued after the dialog is hidden: wait for it by name.
    await waitUntil(page, `${what}: Escape did not return focus to "${opener}"`, `document.activeElement?.getAttribute("data-testid") === "${opener}"`);
  }
  await context.close();
}

// ------------------------------------------------------------------ main

async function main() {
  await warmRoutes(["/", "/limits", "/studio", "/studio/import"]);
  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  let failure: unknown = null;
  try {
    for (const [w, h, t] of WIDTHS) await axePart(browser, w, h, t);
  } catch (e) {
    failure = e;
  }
  try {
    if (!failure) for (const [w, h, t] of WIDTHS) await keyboardPart(browser, w, h, t);
  } catch (e) {
    failure = e;
  } finally {
    await browser.close();
  }

  if (process.env.A11Y_OUT) writeFileSync(process.env.A11Y_OUT, JSON.stringify(found, null, 2));
  console.log(`\naxe: ${found.length} violations (${blocking().length} critical or serious)`);
  for (const f of found.sort((a, b) => LEVEL.indexOf(b.impact) - LEVEL.indexOf(a.impact))) console.log(`  [${f.impact}] ${f.rule} @ ${f.where}: ${f.target}`);
  if (failure) throw failure;
  assert.deepEqual(errors, [], `console errors:\n${errors.join("\n")}`);
  assert.equal(blocking().length, 0, `${blocking().length} critical or serious axe violations`);
  console.log("e2e-a11y: OK");
}

withSuiteTimeout("e2e-a11y", 600_000, main).catch((e) => {
  console.error(e);
  process.exit(1);
});
