/**
 * e2e-labels.ts — a repeatable browser check of step L.1 (2D labels never overprint) with
 * Playwright's Chromium. NOT in npm test: it needs `npm run dev` on port 3000 (E2E_URL overrides)
 * for the dev-only hooks window.__planStore and window.__plan2d (the layout's placed and hidden
 * labels), which are only READ. Every action is real input (the real file input, mouse clicks at
 * 1440, taps at 390, the keyboard), and no step waits a blind number of milliseconds: each wait is a
 * named condition (scripts/e2e-helpers.ts), and a camera change is followed by two animation frames
 * and then by the layout's own "settled" flag (data-labels-settled on the canvas).
 *
 * `readLabelRects` is the one function that reads label rectangles from the rendered SVG
 * (getBoundingClientRect of every label's <text>). `--baseline` runs ONLY the failing-first
 * measurement with it — the sample plan with a Length takeoff and three Wall takeoffs on the partition at
 * five zoom levels, counting overlapping pairs — and asserts nothing, so it can run on a tree without the
 * layout pass (it printed 11 pairs on the tree before step L.1).
 *
 * At 1440×900 with a mouse: plan-filled.pdf built and opened; with the drawing on and no choice made the
 * Labels setting is Compact (room areas and takeoffs, no names, no carried PDF dimensions) and turning the
 * drawing off makes the default Full; three Wall takeoffs on the partition (Left, Centre, Right) print on
 * the same spot and the layout stacks them; the Takeoff mode bar sits in a strip above the canvas (its
 * rectangle and the canvas's do not intersect and nothing covers the canvas's top-left corner); then, for
 * the drawing on and off, m² / mm² / sq ft and Full / Compact, a zero-intersection check over every VISIBLE
 * label (their real rectangles), that every label's real rectangle is inside the one the layout reserved
 * for it, that the page's "N hidden" matches the layout's hidden list, and that nothing leaves the pane;
 * five zoom levels; Off keeps only the selected takeoff's label; a long takeoff name wraps with its whole
 * text in a tooltip and in the panel; a 2% Set scale; the choice survives a reload and a later toggle of
 * the drawing, and is a view setting (localStorage "atrium.labels", never in the plan).
 * At 390×844 with real touch: the Labels control (a native select) is at least 44 px and inside the viewport, and stops well short of the plan's right-hand walls, the Takeoff
 * strip wraps without leaving the viewport and does not overlap the canvas, three Wall takeoffs by taps,
 * zero intersections in Full, Compact and Off, a choice survives a reload, and the page is exactly 390 px wide.
 * Step L.1b adds: no visible label touches a control (the zoom buttons, "Set scale…", the Labels control and its
 * "N hidden", the Drawing group) in any state at 1440 or 390, after a window resize re-measures them; a room too
 * small for its label is hidden by the layout pass and counted (zoomed all the way out); and the backing plate
 * (the drawing's ink at 100% differs by under 70 inside a label's box, against over 120 with the plate removed).
 * `--baseline-controls` is the failing-first measurement for it (one label under the zoom buttons at 390).
 * Screenshots in /tmp/studio/: labels-on-1440.png (Full, drawing off), labels-compact-drawing-1440.png
 * (the default under the drawing), labels-390.png.
 * Run: npx tsx scripts/e2e-labels.ts [--baseline]
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import sharp from "sharp";
import { afterFrames, BASE, step, waitForHook, waitUntil, warmRoutes, watchErrors, withSuiteTimeout } from "./e2e-helpers";
import type { Plan, Wall } from "../src/types/plan";

const EXECUTABLE = process.env.E2E_CHROMIUM || undefined;
const OUT = "/tmp/studio";
const DIR = join(process.cwd(), "tests/fixtures/pdf");
const LONG = 240_000;

export interface LabelRect {
  /** The layout's id for it (room-name:…, takeoff:…, item:…), or "" for the scale bar's words. */
  id: string;
  text: string;
  group: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The groups that hold a label's <text>. */
const LABEL_GROUPS = ["plan-room-label", "takeoff-shape", "plan-item", "plan-scalebar"] as const;

/**
 * Every label the 2D plan draws, as the page's own rectangles. A string, not a function: esbuild's
 * keepNames would wrap named inner functions in __name, which the page has never heard of (CLAUDE.md, F.1).
 */
export async function readLabelRects(page: Page): Promise<LabelRect[]> {
  const groups = JSON.stringify(LABEL_GROUPS);
  return (await page.evaluate(`(() => {
    const out = [];
    for (const g of ${groups}) {
      for (const text of document.querySelectorAll('[data-testid="plan-svg"] [data-testid="' + g + '"] text')) {
        const r = text.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        out.push({ id: text.getAttribute("data-label") || "", text: text.textContent.trim(), group: g, x: r.x, y: r.y, width: r.width, height: r.height });
      }
    }
    return out;
  })()`)) as LabelRect[];
}

/** Two rectangles that share any area (touching edges is not overlap). */
export const intersects = (a: LabelRect, b: LabelRect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Every pair of label rectangles that overlap, as "text ⟷ text". */
export function overlappingPairs(rects: LabelRect[]): string[] {
  const pairs: string[] = [];
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (intersects(rects[i], rects[j])) pairs.push(`"${rects[i].text}" ⟷ "${rects[j].text}"`);
  return pairs;
}

/** A control floating over the plan: the zoom buttons, "Set scale…", the Labels control, "N hidden" and the Drawing group. */
export interface ControlRect {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The controls' rectangles by test id (the same on a tree without data-plan-obstacle). A string for the reason above. */
export async function readControlRects(page: Page): Promise<ControlRect[]> {
  return (await page.evaluate(`(() => {
    const out = [];
    const add = (name, el) => { if (!el) return; const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) out.push({ name, x: r.x, y: r.y, width: r.width, height: r.height }); };
    const q = (id) => document.querySelector('[data-testid="' + id + '"]');
    for (const id of ["plan-fit", "plan-zoom-in", "plan-zoom-out", "plan-set-scale", "plan-labels-hidden"]) add(id, q(id));
    add("plan-labels-control", q("plan-labels-select")?.closest(".pointer-events-auto"));
    add("plan-drawing-control", q("plan-drawing-toggle")?.closest(".pointer-events-auto"));
    return out;
  })()`)) as ControlRect[];
}

/** Every visible label that shares area with a control, as "text ⟷ control". */
export function labelControlOverlaps(labels: LabelRect[], controls: ControlRect[]): string[] {
  const out: string[] = [];
  for (const l of labels) for (const c of controls) if (l.x < c.x + c.width && c.x < l.x + l.width && l.y < c.y + c.height && c.y < l.y + l.height) out.push(`"${l.text}" ⟷ ${c.name}`);
  return out;
}

type Pt = { x: number; y: number };
type Placed = { id: string; x: number; y: number; width: number; height: number; forced: boolean };
type Hook = { detail: string; placed: Placed[]; hidden: string[]; offscreen: string[]; settled: boolean };
type Win = Window & { __planStore?: { getState(): { plan: Plan; past: unknown[] } }; __plan2d?: { labels: Hook }; __toolStore?: { getState(): { tool: string } } };

const errors: string[] = [];
const report: string[] = [];
const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
const plan = (page: Page) => page.evaluate(() => (window as Win).__planStore!.getState().plan);
const hook = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window as Win).__plan2d?.labels ?? null)) as Hook | null);
const len = (w: Wall) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);

/** The 2D camera and its box on the page. */
async function camera(page: Page) {
  const c = await tid(page, "plan-canvas").evaluate((e) => ({ s: +e.getAttribute("data-scale")!, tx: +e.getAttribute("data-tx")!, ty: +e.getAttribute("data-ty")! }));
  const b = (await tid(page, "plan-canvas").boundingBox())!;
  return { ...c, x: b.x, y: b.y, w: b.width, h: b.height };
}
async function toScreen(page: Page, p: Pt): Promise<Pt> {
  const c = await camera(page);
  return { x: c.x + p.x * c.s + c.tx, y: c.y + p.y * c.s + c.ty };
}

/** After a camera or content change: two frames for React to commit, then the layout's own settled flag. */
async function settle(page: Page, what: string) {
  await afterFrames(page, 2);
  await waitUntil(page, `the label layout never settled (${what})`, `document.querySelector('[data-testid="plan-canvas"]')?.getAttribute("data-labels-settled") === "true" && Boolean(window.__plan2d)`, 15_000);
}

// ---------------------------------------------------------------- the baseline (failing first)

/** The sample plan, 2D only, with a Length takeoff and three Wall takeoffs on the partition (real clicks). */
async function sampleWithTakeoffs(page: Page) {
  await page.goto(`${BASE}/studio`);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await waitForHook(page, "__planStore", "the studio has just been opened");
  await tid(page, "view-2d").click();
  await tid(page, "plan-svg").waitFor();
  await tid(page, "plan-fit").click();
  await afterFrames(page, 2);
  await tid(page, "tool-takeoff").click();
  await afterFrames(page, 2); // the mode bar's strip shrinks the canvas, which refits
  const [p, q] = [await toScreen(page, { x: -0.1, y: 8.1 }), await toScreen(page, { x: 10.1, y: 8.1 })];
  await page.mouse.click(p.x, p.y);
  await page.mouse.move(q.x - 40, q.y - 10, { steps: 3 });
  await page.mouse.click(q.x, q.y);
  await page.keyboard.press("Enter");
  await tid(page, "takeoff-mode-wall").click();
  const mid = await toScreen(page, { x: 2, y: 4 });
  for (const dy of [6, 0, -6]) {
    await page.mouse.move(mid.x, mid.y + dy, { steps: 3 });
    await tid(page, "takeoff-wall-hover").waitFor();
    await page.mouse.click(mid.x, mid.y + dy);
  }
  await tid(page, "tool-select").click();
  await page.keyboard.press("Escape");
}

/** Five zoom levels, by the zoom buttons: two out, fit, two in, four in, six in. */
const ZOOM_STEPS = [-2, 0, 2, 4, 6];

async function zoomTo(page: Page, clicks: number) {
  await tid(page, "plan-fit").click();
  for (let i = 0; i < Math.abs(clicks); i++) await tid(page, clicks > 0 ? "plan-zoom-in" : "plan-zoom-out").click();
}

async function baseline() {
  step("baseline: the sample plan with takeoffs, five zoom levels");
  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  watchErrors(page, "1440", errors);
  await sampleWithTakeoffs(page);
  let total = 0;
  for (const z of ZOOM_STEPS) {
    await zoomTo(page, z);
    // The old tree has no settle flag; the new one has, and is read through it.
    if ((await tid(page, "plan-canvas").getAttribute("data-labels-settled")) !== null) await settle(page, `zoom ${z}`);
    else await afterFrames(page, 3);
    const rects = await readLabelRects(page);
    const pairs = overlappingPairs(rects);
    total += pairs.length;
    console.log(`zoom ${z >= 0 ? "in" : "out"} ${Math.abs(z)} (${await tid(page, "plan-canvas").getAttribute("data-scale")} px/m): ${rects.length} labels, ${pairs.length} overlapping pairs${pairs.length ? `\n    ${pairs.join("\n    ")}` : ""}`);
  }
  console.log(`baseline total: ${total} overlapping pairs across ${ZOOM_STEPS.length} zoom levels`);
  await browser.close();
}

// ---------------------------------------------------------------- the full run

/**
 * The central check, at whatever state the page is in: no two visible labels overlap; each is inside the
 * pane; each real rectangle is inside the rectangle the layout reserved for it (so the estimate that the
 * layout is built on never under-guesses the text); the "N hidden" shown is the layout's hidden count.
 */
async function assertClean(page: Page, tag: string): Promise<{ labels: number; hidden: number; detail: string; forced: number }> {
  await settle(page, tag);
  const [all, h, c] = [await readLabelRects(page), await hook(page), await camera(page)];
  assert.ok(h, `${tag}: window.__plan2d is installed`);
  // A label wholly outside the pane (the layout calls it off screen and leaves it at its natural spot, so a pan
  // brings it in) is clipped away: not visible. One that is partly inside must be wholly inside.
  const rects = all.filter((r) => r.x < c.x + c.w && c.x < r.x + r.width && r.y < c.y + c.h && c.y < r.y + r.height);
  assert.deepEqual(overlappingPairs(rects), [], `${tag}: no two visible labels overlap (${rects.length} read)`);
  const controls = await readControlRects(page);
  assert.ok(controls.length >= 5, `${tag}: the controls were found (${controls.map((x) => x.name).join(", ")})`);
  assert.deepEqual(labelControlOverlaps(rects, controls), [], `${tag}: no visible label touches a control`);
  assert.ok((await page.locator('[data-testid="plan-canvas"] [data-plan-obstacle]').count()) >= 3, `${tag}: the controls are marked as obstacles`);
  for (const r of rects) assert.ok(r.x >= c.x - 0.5 && r.y >= c.y - 0.5 && r.x + r.width <= c.x + c.w + 0.5 && r.y + r.height <= c.y + c.h + 0.5, `${tag}: "${r.text}" (${r.x.toFixed(1)}, ${r.y.toFixed(1)}, ${r.width.toFixed(1)}×${r.height.toFixed(1)}) is inside the pane (${c.x.toFixed(1)}, ${c.y.toFixed(1)}, ${c.w.toFixed(1)}×${c.h.toFixed(1)}); layout: ${JSON.stringify(h!.placed.find((p) => p.id === r.id) ?? "not placed")}, offscreen: ${h!.offscreen.includes(r.id)}`);
  const byId = new Map(h!.placed.map((p) => [p.id, p]));
  for (const r of rects.filter((r) => r.id)) {
    const p = byId.get(r.id);
    if (!p) continue; // placed at its natural spot because the layout never saw it (off screen when it ran)
    const [x0, y0] = [c.x + p.x - p.width / 2, c.y + p.y - p.height / 2];
    assert.ok(r.x >= x0 - 1 && r.y >= y0 - 1 && r.x + r.width <= x0 + p.width + 1 && r.y + r.height <= y0 + p.height + 1, `${tag}: "${r.text}" (${r.x.toFixed(1)}, ${r.y.toFixed(1)}, ${r.width.toFixed(1)}×${r.height.toFixed(1)}) is inside the rectangle the layout reserved (${x0.toFixed(1)}, ${y0.toFixed(1)}, ${p.width.toFixed(1)}×${p.height.toFixed(1)})`);
  }
  const attr = Number(await tid(page, "plan-canvas").getAttribute("data-labels-hidden"));
  assert.equal(attr, h!.hidden.length, `${tag}: data-labels-hidden is the layout's hidden count`);
  assert.equal(await tid(page, "plan-labels-hidden").count(), attr > 0 ? 1 : 0, `${tag}: "N hidden" is shown exactly when something is hidden`);
  if (attr > 0) assert.match((await tid(page, "plan-labels-hidden").innerText()).trim(), new RegExp(`^${attr} hidden$`), `${tag}: it says how many`);
  const forced = h!.placed.filter((p) => p.forced).length;
  report.push(`${tag}: ${rects.length} labels visible, ${attr} hidden, ${forced} forced, ${h!.detail}`);
  return { labels: rects.length, hidden: attr, detail: h!.detail, forced };
}

/**
 * How far the drawing reads through the labels: for each label's box, over every pixel that is background in the
 * drawing-off shot (not the text's own dark pixels), the largest per-pixel difference (0–255) between the shots with
 * the drawing on and off. Returns the largest over all the boxes.
 */
async function readThrough(on: Buffer, off: Buffer, boxes: LabelRect[]): Promise<number> {
  const [a, b] = await Promise.all([on, off].map((buf) => sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true })));
  const { width } = a.info;
  let worst = 0;
  for (const r of boxes)
    for (let y = Math.ceil(r.y); y < Math.floor(r.y + r.height); y++)
      for (let x = Math.ceil(r.x); x < Math.floor(r.x + r.width); x++) {
        const i = (y * width + x) * 3;
        const lum = 0.299 * b.data[i] + 0.587 * b.data[i + 1] + 0.114 * b.data[i + 2];
        if (lum < 150) continue; // the text itself
        worst = Math.max(worst, ...[0, 1, 2].map((k) => Math.abs(a.data[i + k] - b.data[i + k])));
      }
  return worst;
}

const detailOf = (page: Page) => tid(page, "plan-canvas").getAttribute("data-labels-detail");
/** Choose a Labels setting in the native <select> the way a person does: focus it and pick the option. */
const chooseLabels = (page: Page, detail: "full" | "compact" | "off") => tid(page, "plan-labels-select").selectOption(detail);
const labelIds = (page: Page, prefix: string) => page.locator(`[data-testid="plan-svg"] text[data-label^="${prefix}"]`).count();

async function session(browser: Browser, width: number, height: number, touch: boolean) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const tag = `${width}`;
  watchErrors(page, tag, errors);
  const press = (l: Locator) => (touch ? l.tap() : l.click());
  const tap = async (p: Pt) => (touch ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y));
  /** The dev badge sits bottom left, over the 2D pane's controls: it would swallow taps. */
  const hideDevBadge = () => page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  const upload = async (path: string) => {
    await page.goto(`${BASE}/studio/import`);
    await hideDevBadge();
    await tid(page, "file-input").setInputFiles(path);
    await page.waitForSelector("[data-testid=results], [data-testid=error]", { timeout: LONG });
    if (await tid(page, "error").count()) assert.fail(`${path}: error "${await tid(page, "error-message").textContent()}"`);
  };
  /** No scale found: the north wall's two ends on the overlay are 10 m apart (the fixtures' house). */
  const scaleByHand = async () => {
    await press(page.getByRole("button", { name: "Set the scale yourself" }));
    const top = await page.evaluate(() => {
      const ls = [...document.querySelectorAll("line[data-wall]")].map((l) => ["x1", "y1", "x2", "y2"].map((k) => Number(l.getAttribute(k))));
      const hs = ls.filter(([x1, y1, x2, y2]) => Math.abs(y2 - y1) < Math.abs(x2 - x1));
      const y = Math.min(...hs.map((h) => (h[1] + h[3]) / 2));
      const row = hs.filter((h) => Math.abs((h[1] + h[3]) / 2 - y) < 2);
      return { x0: Math.min(...row.flatMap((h) => [h[0], h[2]])), x1: Math.max(...row.flatMap((h) => [h[0], h[2]])), y };
    });
    for (const x of [top.x0, top.x1]) {
      const s = await page.evaluate(([x, y]) => {
        const g = document.querySelector<SVGGElement>("[data-testid=plan-content]")!;
        const q = new DOMPoint(x, y).matrixTransform(g.getScreenCTM()!);
        return { x: q.x, y: q.y };
      }, [x, top.y] as const);
      await tap(s);
    }
    await tid(page, "manual-length").fill("10 m");
    await press(page.getByRole("button", { name: "Use this scale" }));
  };
  const buildAndOpen = async () => {
    const use = tid(page, "scale-found").getByRole("button", { name: /^(Use this scale|Confirm this scale)$/ });
    if (await use.count()) await press(use);
    else await scaleByHand();
    await press(page.getByRole("button", { name: "Build model" }));
    await tid(page, "summary").waitFor();
    await press(page.getByRole("button", { name: "Open in studio" }));
    await page.waitForURL(/\/studio$/);
    await waitForHook(page, "__planStore", "the studio after Open in studio");
    await waitForHook(page, "__background", "the studio after Open in studio");
    await hideDevBadge();
  };
  /** The 2D plan only, with the drawing rendered once. */
  const open2d = async () => {
    await press(tid(page, "view-2d"));
    await tid(page, "plan-svg").waitFor();
    await waitUntil(page, `${tag}: the drawing never rendered`, "Boolean(window.__background) && window.__background.renderCount > 0 && !window.__background.pending", LONG);
    await settle(page, "the 2D plan opened");
  };
  /** The partition: the longest thin interior wall that runs across the plan. */
  const partition = async () => {
    const p = await plan(page);
    const thin = p.walls.filter((w) => w.thickness < 0.15 && Math.abs(w.b.y - w.a.y) < 1e-6);
    return [...thin].sort((a, b) => len(b) - len(a))[0];
  };
  /** The Takeoff tool's Wall mode, with a real click on the partition for each of its sides. */
  const threeTakeoffs = async () => {
    const w = await partition();
    await press(tid(page, "tool-takeoff"));
    await tid(page, "takeoff-bar").waitFor();
    await afterFrames(page, 2);
    await press(tid(page, "takeoff-mode-wall"));
    for (const side of ["left", "centre", "right"] as const) {
      await press(tid(page, `takeoff-side-${side}`));
      await tap(await toScreen(page, { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 }));
      await waitUntil(page, `${tag}: the ${side} takeoff was not added`, `window.__planStore.getState().plan.takeoffs.filter((t) => t.source !== "pdf").length >= ${["left", "centre", "right"].indexOf(side) + 1}`);
    }
  };
  const toSelect = async () => {
    await press(tid(page, "tool-select"));
    await afterFrames(page, 2);
  };
  return { page, tag, press, tap, upload, buildAndOpen, open2d, partition, threeTakeoffs, toSelect, hideDevBadge, close: () => context.close() };
}

/** The mode bar docked above the canvas: its box and the canvas's do not meet, and nothing covers the canvas's corner. */
async function assertStrip(page: Page, tag: string, viewportWidth: number) {
  const bar = (await tid(page, "takeoff-bar").boundingBox())!;
  const canvas = (await tid(page, "plan-canvas").boundingBox())!;
  const meet = bar.x < canvas.x + canvas.width && canvas.x < bar.x + bar.width && bar.y < canvas.y + canvas.height && canvas.y < bar.y + bar.height;
  assert.equal(meet, false, `${tag}: the Takeoff mode bar (${bar.y.toFixed(0)}–${(bar.y + bar.height).toFixed(0)}) and the canvas (${canvas.y.toFixed(0)}–${(canvas.y + canvas.height).toFixed(0)}) do not intersect`);
  assert.ok(bar.y + bar.height <= canvas.y + 0.5, `${tag}: the bar is above the canvas`);
  assert.ok(bar.x >= -0.5 && bar.x + bar.width <= viewportWidth + 0.5, `${tag}: the bar is inside the viewport (${bar.x.toFixed(0)}–${(bar.x + bar.width).toFixed(0)})`);
  const covered = await page.evaluate(`(() => { const c = document.querySelector('[data-testid="plan-canvas"]').getBoundingClientRect(); const el = document.elementFromPoint(c.x + 6, c.y + 6); return el ? !document.querySelector('[data-testid="plan-canvas"]').contains(el) : true; })()`);
  assert.equal(covered, false, `${tag}: nothing but the canvas is at the canvas's top-left corner`);
  const rows = bar.height > 60 ? "wrapped onto more than one row" : "one row";
  report.push(`${tag}: Takeoff bar ${bar.width.toFixed(0)}×${bar.height.toFixed(0)} px above a ${canvas.width.toFixed(0)}×${canvas.height.toFixed(0)} canvas, ${rows}`);
}

async function chooseUnits(page: Page, press: (l: Locator) => Promise<void>, length: "m" | "mm" | "ftin", area: "m2" | "mm2" | "sqft") {
  if ((await tid(page, "topbar-length-mm").count()) === 0) await press(tid(page, "units-menu"));
  await tid(page, "topbar-length-mm").waitFor();
  await press(tid(page, `topbar-length-${length}`));
  await press(tid(page, `topbar-area-${area}`));
  await page.keyboard.press("Escape");
  await waitUntil(page, "the Units menu did not close", `!document.querySelector('[data-testid="topbar-length-mm"]')`);
  await afterFrames(page, 2);
}

async function desktop(browser: Browser) {
  step("1440: plan-filled.pdf into the studio, 2D");
  const s = await session(browser, 1440, 900, false);
  const { page, tag, press } = s;
  await s.upload(join(DIR, "plan-filled.pdf"));
  await s.buildAndOpen();
  await s.open2d();
  const p0 = await plan(page);
  assert.ok(p0.background, `${tag}: the plan has a drawing`);
  assert.equal(await page.evaluate(() => localStorage.getItem("atrium.labels")), null, `${tag}: nobody has chosen a Labels setting`);

  step("1440: the default under the drawing is Compact");
  assert.equal(await detailOf(page), "compact", `${tag}: the drawing shows and nothing was chosen: Compact`);
  assert.equal(await tid(page, "plan-labels-select").inputValue(), "compact", `${tag}: the Labels control shows it`);
  assert.equal(await labelIds(page, "room-name:"), 0, `${tag}: Compact has no room names`);
  assert.ok((await labelIds(page, "room-area:")) >= 4, `${tag}: but the room areas`);
  await press(tid(page, "plan-drawing-toggle")); // the drawing off
  await settle(page, "drawing off");
  assert.equal(await detailOf(page), "full", `${tag}: with the drawing hidden and no choice made, the default is Full`);
  assert.ok((await labelIds(page, "room-name:")) >= 4, `${tag}: names are back`);
  await press(tid(page, "plan-drawing-toggle")); // and on again
  await settle(page, "drawing on");
  assert.equal(await detailOf(page), "compact", `${tag}: and Compact again when it comes back`);
  assert.equal(await page.evaluate(() => localStorage.getItem("atrium.labels")), null, `${tag}: still nothing stored: a default is not a choice`);
  await assertClean(page, `${tag} default Compact, drawing on`);

  step("1440: three Wall takeoffs on the partition, and the mode bar's strip");
  await s.threeTakeoffs();
  await assertStrip(page, tag, 1440);
  await settle(page, "takeoffs added");
  const studioTakeoffs = (await plan(page)).takeoffs!.filter((t) => t.source !== "pdf");
  assert.equal(studioTakeoffs.length, 3, `${tag}: three takeoffs on the partition`);
  await assertClean(page, `${tag} three takeoffs, strip open`);
  await s.toSelect();
  assert.equal(await tid(page, "takeoff-bar").count(), 0, `${tag}: the strip goes with the tool`);
  const stacked = await page.evaluate(`[...document.querySelectorAll('[data-testid="takeoff-shape"] text')].map((t) => t.getBoundingClientRect().y)`) as number[];
  assert.ok(new Set(stacked.map((y) => Math.round(y))).size >= 3, `${tag}: the three takeoff labels are on different lines (${stacked.map((y) => y.toFixed(0)).join(", ")})`);
  const a1 = await assertClean(page, `${tag} Compact, drawing on, m²`);
  await page.screenshot({ path: `${OUT}/labels-compact-drawing-1440.png` });

  step("1440: the Labels control");
  await chooseLabels(page, "full");
  await settle(page, "Full");
  assert.equal(await detailOf(page), "full", `${tag}: Full chosen`);
  assert.equal(await tid(page, "plan-labels-select").inputValue(), "full");
  assert.ok((await labelIds(page, "room-name:")) >= 3, `${tag}: Full shows room names (others may be hidden)`);
  const stored = JSON.parse((await page.evaluate(() => localStorage.getItem("atrium.labels")))!);
  assert.deepEqual(stored, { detail: "full" }, `${tag}: the choice is in localStorage atrium.labels`);
  assert.ok(!JSON.stringify(await plan(page)).includes("atrium.labels") && !("labels" in (await plan(page))), `${tag}: and nothing about labels is in the plan`);
  const full = await assertClean(page, `${tag} Full, drawing on, m²`);
  assert.ok(full.labels + full.hidden > a1.labels, `${tag}: Full wants more labels than Compact (${full.labels} + ${full.hidden} hidden vs ${a1.labels})`);
  // The drawing toggling no longer changes anything: the user has chosen.
  await press(tid(page, "plan-drawing-toggle"));
  await settle(page, "drawing off after a choice");
  assert.equal(await detailOf(page), "full", `${tag}: a chosen Full stays Full when the drawing hides`);
  await press(tid(page, "plan-drawing-toggle"));
  await settle(page, "drawing on after a choice");
  await chooseLabels(page, "compact");
  await settle(page, "Compact chosen");
  assert.equal(await detailOf(page), "compact");
  await assertClean(page, `${tag} chosen Compact, drawing on`);
  // Off: only what is selected. Adding a takeoff selects it, so the last one added is the one that stays.
  await chooseLabels(page, "off");
  await settle(page, "Off");
  assert.equal(await detailOf(page), "off");
  assert.equal(await labelIds(page, "room-"), 0, `${tag}: Off shows no room labels`);
  assert.equal(await labelIds(page, "takeoff:"), 1, `${tag}: and only the selected takeoff's`);
  assert.equal(await page.locator(`[data-testid="plan-svg"] text[data-label="takeoff:${studioTakeoffs[2].id}"]`).count(), 1, `${tag}: the one added last (selected when it was added)`);
  // Select another by its row in the panel, as a person would.
  await page.locator('[data-testid="takeoff-table"][data-group="studio"] [data-testid="takeoff-row"]').nth(0).click();
  await settle(page, "another takeoff selected");
  const off = await assertClean(page, `${tag} Off with a takeoff selected`);
  assert.equal(await labelIds(page, "takeoff:"), 1, `${tag}: still one`);
  assert.equal(await page.locator(`[data-testid="plan-svg"] text[data-label="takeoff:${studioTakeoffs[0].id}"]`).count(), 1, `${tag}: the one just selected`);
  assert.equal(off.hidden, 0, `${tag}: and it is never hidden`);

  step("1440: m², mm² and sq ft, Full and Compact, the drawing on and off");
  const units = [
    ["m", "m2"],
    ["mm", "mm2"],
    ["ftin", "sqft"],
  ] as const;
  for (const drawing of ["on", "off"] as const) {
    const shown = (await tid(page, "plan-drawing-toggle").getAttribute("aria-pressed")) === "true";
    if (shown !== (drawing === "on")) await press(tid(page, "plan-drawing-toggle"));
    for (const [length, area] of units)
      for (const detail of ["full", "compact"] as const) {
        await chooseUnits(page, press, length, area);
        await chooseLabels(page, detail);
        const cell = `${tag} drawing ${drawing}, ${area}, ${detail}`;
        const res = await assertClean(page, cell);
        const areas = await page.locator('[data-testid="plan-svg"] text[data-label^="room-area:"]').allTextContents();
        const word = area === "m2" ? /m²$/ : area === "mm2" ? /mm²$/ : /sq ft$/;
        assert.ok(areas.length >= 3 && areas.every((a) => word.test(a.trim())), `${cell}: room areas are in ${area} (${areas.join(" | ")})`);
        if (area === "mm2") assert.ok(areas.some((a) => /\d,\d{3},\d{3} mm²/.test(a)), `${cell}: a grouped mm² value`);
        if (drawing === "off" && area === "m2" && detail === "full") {
          await page.screenshot({ path: `${OUT}/labels-on-1440.png` });
          report.push(`${cell}: ${res.labels} labels visible (screenshot labels-on-1440.png)`);
        }
      }
  }
  await chooseUnits(page, press, "m", "m2");
  if ((await tid(page, "plan-drawing-toggle").getAttribute("aria-pressed")) !== "true") await press(tid(page, "plan-drawing-toggle"));

  step("1440: five zoom levels");
  await chooseLabels(page, "full");
  for (const z of ZOOM_STEPS) {
    await zoomTo(page, z);
    await assertClean(page, `${tag} Full zoom ${z >= 0 ? "in" : "out"} ${Math.abs(z)} (${(await camera(page)).s.toFixed(0)} px/m)`);
  }
  await tid(page, "plan-fit").click();
  await settle(page, "fit");

  step("1440: a room too small for its label is hidden by the layout pass, and counted");
  await chooseLabels(page, "full");
  for (let i = 0; i < 16; i++) await tid(page, "plan-zoom-out").click();
  await settle(page, "zoomed all the way out");
  assert.equal((await camera(page)).s, 5, `${tag}: 5 px/m, the smallest scale`);
  const tiny = await assertClean(page, `${tag} zoomed all the way out`);
  const hid = (await hook(page))!.hidden;
  assert.ok(hid.some((id) => id.startsWith("room-area:")) && hid.some((id) => id.startsWith("room-name:")), `${tag}: the rooms' names and areas are in the hidden list (${hid.join(", ")})`);
  assert.ok(tiny.hidden >= 8, `${tag}: and in the count (${tiny.hidden})`);
  assert.equal(await labelIds(page, "room-"), 0, `${tag}: and not drawn`);
  await tid(page, "plan-fit").click();
  await settle(page, "fit");
  assert.equal((await hook(page))!.hidden.filter((id) => id.startsWith("room-")).length, 0, `${tag}: back at fit none is hidden for size`);

  step("1440: the controls are measured again when the window changes");
  await page.setViewportSize({ width: 1100, height: 700 });
  await waitUntil(page, `${tag}: the canvas did not follow the window`, `document.querySelector('[data-testid="plan-canvas"]').getBoundingClientRect().height < 650`);
  await assertClean(page, `${tag} in a 1100×700 window`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await waitUntil(page, `${tag}: the canvas did not follow the window back`, `document.querySelector('[data-testid="plan-canvas"]').getBoundingClientRect().height > 750`);
  await assertClean(page, `${tag} back in 1440×900`);

  step("1440: the backing plate: the drawing does not read through a label");
  await chooseLabels(page, "compact");
  await settle(page, "Compact for the plate");
  await tid(page, "plan-drawing-opacity").focus();
  await page.keyboard.press("End"); // the drawing at 100%
  await waitUntil(page, `${tag}: the drawing did not go to 100%`, `getComputedStyle(document.querySelector('[data-testid="plan-background"]')).opacity === "1"`);
  const labelRects = (await readLabelRects(page)).filter((r) => r.id.startsWith("room-area:"));
  assert.ok(labelRects.length >= 3, `${tag}: room areas to look at (${labelRects.length})`);
  const shotOn = await page.screenshot();
  await press(tid(page, "plan-drawing-toggle"));
  await waitUntil(page, `${tag}: the drawing did not hide`, `getComputedStyle(document.querySelector('[data-testid="plan-background"]')).display === "none"`);
  const shotOff = await page.screenshot();
  const plated = await readThrough(shotOn, shotOff, labelRects);
  const bare = await page.addStyleTag({ content: '[data-label] { filter: none !important; }' });
  await press(tid(page, "plan-drawing-toggle"));
  await waitUntil(page, `${tag}: the drawing did not come back`, `getComputedStyle(document.querySelector('[data-testid="plan-background"]')).display !== "none"`);
  const shotBare = await page.screenshot();
  await press(tid(page, "plan-drawing-toggle"));
  await waitUntil(page, `${tag}: the drawing did not hide again`, `getComputedStyle(document.querySelector('[data-testid="plan-background"]')).display === "none"`);
  const shotBareOff = await page.screenshot();
  const unplated = await readThrough(shotBare, shotBareOff, labelRects);
  await bare.evaluate((e) => (e as Element).remove());
  await press(tid(page, "plan-drawing-toggle"));
  await waitUntil(page, `${tag}: the drawing did not come back`, `getComputedStyle(document.querySelector('[data-testid="plan-background"]')).display !== "none"`);
  assert.ok(unplated >= 120, `${tag}: with the plate taken away the drawing reads through a label by up to ${unplated.toFixed(0)}/255, so the check is meaningful`);
  assert.ok(plated <= 70, `${tag}: with the plate the drawing reads through by at most ${plated.toFixed(0)}/255 (limit 70)`);
  report.push(`${tag}: backing plate: the drawing at 100% shows through a label by at most ${plated.toFixed(0)}/255 with the plate, ${unplated.toFixed(0)}/255 without`);
  await tid(page, "plan-drawing-opacity").focus();
  await page.keyboard.press("Home");
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowRight"); // back to 50%
  await waitUntil(page, `${tag}: the opacity did not come back`, `document.querySelector('[data-testid="plan-drawing-opacity"]').value === "50"`);
  await chooseLabels(page, "full");
  await settle(page, "Full again");

  step("1440: a long name wraps, with its whole text in a tooltip and in the panel");
  const longName = "Partition between Bedroom 1 and Bedroom 2, left face";
  const row = page.locator('[data-testid="takeoff-table"][data-group="studio"] [data-testid="takeoff-row"]').first();
  const id = (await plan(page)).takeoffs!.filter((t) => t.source !== "pdf")[0].id;
  await row.getByTestId("takeoff-name").fill(longName);
  await page.keyboard.press("Enter");
  await waitUntil(page, `${tag}: the takeoff was not renamed`, `window.__planStore.getState().plan.takeoffs.some((t) => t.name === ${JSON.stringify(longName)})`);
  await settle(page, "renamed");
  const wrapped = page.locator(`[data-testid="plan-svg"] text[data-label="takeoff:${id}"]`);
  assert.equal(await wrapped.locator("tspan").count(), 2, `${tag}: the long label is on two lines`);
  const tooltip = (await wrapped.locator("title").textContent())!;
  const measured = (await row.getByTestId("takeoff-measured").innerText()).trim();
  assert.equal(tooltip, `${longName}: ${measured}`, `${tag}: its tooltip has the whole text, the panel's own value included`);
  assert.equal(await row.getByTestId("takeoff-name").inputValue(), longName, `${tag}: the panel has the whole name`);
  assert.match(measured, /^\d+\.\d{3} m$/, `${tag}: and the whole value ("${measured}")`);
  await assertClean(page, `${tag} a long name`);

  step("1440: Set scale by 2%");
  const south = [...(await plan(page)).walls].sort((a, b) => (b.a.y + b.b.y) / 2 - (a.a.y + a.b.y) / 2 || len(b) - len(a)).filter((w) => len(w) >= 3)[0];
  await press(tid(page, "plan-set-scale"));
  await s.tap(await toScreen(page, south.a));
  await s.tap(await toScreen(page, south.b));
  await tid(page, "calibrate-dialog").waitFor();
  const picked = await page.evaluate(() => (window as unknown as { __calibrateStore: { getState(): { points: [number, number][] } } }).__calibrateStore.getState().points);
  await tid(page, "calibrate-input").focus();
  await page.keyboard.type(`${(Math.hypot(picked[1][0] - picked[0][0], picked[1][1] - picked[0][1]) * 1.02).toFixed(6)} m`);
  await press(tid(page, "calibrate-apply"));
  await waitUntil(page, `${tag}: the calibration was not applied`, "Boolean(window.__planStore.getState().plan.calibrations)");
  await assertClean(page, `${tag} after Set scale ×1.02`);
  assert.match((await tid(page, "takeoff-pdf-toggle").innerText()).trim(), /Rescaled x1\.0200/, `${tag}: the plan is rescaled`);

  step("1440: the choice survives a reload");
  await chooseLabels(page, "off");
  await settle(page, "Off before the reload");
  await page.reload();
  await waitForHook(page, "__planStore", "after the reload");
  await s.hideDevBadge();
  await waitUntil(page, `${tag}: the plan was not restored after the reload`, "Boolean(window.__planStore.getState().plan.background)");
  await s.open2d();
  assert.equal(await detailOf(page), "off", `${tag}: Off after a reload, though the drawing shows (the default would be Compact)`);
  assert.equal(await tid(page, "plan-labels-select").inputValue(), "off", `${tag}: and the control says so`);
  assert.deepEqual(JSON.parse((await page.evaluate(() => localStorage.getItem("atrium.labels")))!), { detail: "off" });
  await chooseLabels(page, "full");
  await assertClean(page, `${tag} Full after the reload`);

  step("1440: a crowd on one spot: some labels are hidden, counted, and the selected one stays");
  const w = await s.partition();
  await press(tid(page, "tool-takeoff"));
  await tid(page, "takeoff-bar").waitFor();
  await afterFrames(page, 2); // the strip shrank the canvas, which refits: read the camera after it
  await press(tid(page, "takeoff-mode-wall"));
  await press(tid(page, "takeoff-side-centre"));
  const centre = await toScreen(page, { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 });
  const had = (await plan(page)).takeoffs!.length;
  for (let i = 1; i <= 14; i++) {
    await page.mouse.click(centre.x, centre.y);
    await waitUntil(page, `${tag}: takeoff ${i} of the crowd was not added`, `window.__planStore.getState().plan.takeoffs.length >= ${had + i}`);
  }
  await s.toSelect();
  const last = (await plan(page)).takeoffs!.at(-1)!;
  const crowd = await assertClean(page, `${tag} fourteen more takeoffs on the partition, Full`);
  assert.ok(crowd.hidden > 0, `${tag}: with fourteen more labels on one spot some had to be hidden (${crowd.hidden})`);
  assert.equal(await page.locator(`[data-testid="plan-svg"] text[data-label="takeoff:${last.id}"]`).count(), 1, `${tag}: the selected takeoff's label is still there`);
  assert.match((await tid(page, "plan-labels-select").getAttribute("title")) ?? "", /hidden because/, `${tag}: the Labels control explains the count in its tooltip`);
  assert.equal(await tid(page, "plan-labels-hidden").evaluate((e) => getComputedStyle(e).pointerEvents), "none", `${tag}: and the count itself never takes a tap`);
  report.push(`${tag}: crowd of ${studioTakeoffs.length + 14} takeoffs on one spot: ${crowd.labels} labels visible, ${crowd.hidden} hidden and counted`);
  await s.close();
}

async function phone(browser: Browser) {
  step("390: plan-filled.pdf, touch");
  const s = await session(browser, 390, 844, true);
  const { page, tag, press } = s;
  await s.upload(join(DIR, "plan-filled.pdf"));
  await s.buildAndOpen();
  await s.open2d();
  {
    const b = (await tid(page, "plan-labels-select").boundingBox())!;
    assert.ok(b.height >= 44 && b.width >= 44, `${tag}: the Labels control is at least 44 × 44 px (${b.width.toFixed(0)} × ${b.height.toFixed(0)})`);
    assert.ok(b.x >= 0 && b.x + b.width <= 390, `${tag}: and inside the viewport (${b.x.toFixed(0)}–${(b.x + b.width).toFixed(0)})`);
    const set = (await tid(page, "plan-set-scale").boundingBox())!;
    assert.ok(set.height >= 44, `${tag}: Set scale is 44 px tall`);
    const group = (await page.locator('[data-testid="plan-labels-select"]').locator("xpath=ancestor::div[contains(@class,'pointer-events-auto')][1]").boundingBox())!;
    assert.ok(group.x + group.width <= 260, `${tag}: the Labels group stops at x ${(group.x + group.width).toFixed(0)}, well short of the plan's right-hand walls`);
  }
  assert.equal(await detailOf(page), "compact", `${tag}: the default under the drawing is Compact`);
  await s.threeTakeoffs();
  await assertStrip(page, tag, 390);
  await s.toSelect();
  await assertClean(page, `${tag} Compact, drawing on`);
  await chooseLabels(page, "full");
  const full = await assertClean(page, `${tag} Full, drawing on`);
  await press(tid(page, "plan-drawing-toggle"));
  await assertClean(page, `${tag} Full, drawing off`);
  await page.screenshot({ path: `${OUT}/labels-390.png` });
  await chooseLabels(page, "off");
  await assertClean(page, `${tag} Off`);
  await chooseLabels(page, "compact");
  await assertClean(page, `${tag} Compact, drawing off`);
  const widths = await page.evaluate(() => ({ inner: innerWidth, doc: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.deepEqual([widths.inner, widths.doc, widths.body], [390, 390, 390], `${tag}: the page is exactly 390 px wide`);
  await page.reload();
  await waitForHook(page, "__planStore", "after the reload");
  await s.hideDevBadge();
  await waitUntil(page, `${tag}: the plan was not restored after the reload`, "Boolean(window.__planStore.getState().plan.background)");
  await press(tid(page, "view-2d"));
  await tid(page, "plan-svg").waitFor();
  await settle(page, "after the reload");
  assert.equal(await detailOf(page), "compact", `${tag}: a tapped choice survives a reload`);
  assert.ok(full.labels > 0, `${tag}: Full showed labels`);
  await s.close();
}

/** Failing first for L.1b: Full at 390 on plan-filled.pdf, which labels sit under a control. Asserts nothing. */
async function baselineControls() {
  step("baseline: labels under the controls at 390");
  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const s = await session(browser, 390, 844, true);
  await s.upload(join(DIR, "plan-filled.pdf"));
  await s.buildAndOpen();
  await s.open2d();
  await tid(s.page, "plan-labels-select").selectOption("full");
  await settle(s.page, "Full");
  const [labels, controls, c] = [await readLabelRects(s.page), await readControlRects(s.page), await camera(s.page)];
  const clipped = labels.filter((l) => l.x < c.x - 0.5 || l.y < c.y - 0.5 || l.x + l.width > c.x + c.w + 0.5 || l.y + l.height > c.y + c.h + 0.5);
  const over = labelControlOverlaps(labels, controls);
  console.log(`390 Full: ${labels.length} labels, ${controls.length} controls (${controls.map((x) => `${x.name} ${x.x.toFixed(0)},${x.y.toFixed(0)} ${x.width.toFixed(0)}×${x.height.toFixed(0)}`).join("; ")})`);
  console.log(`label ⟷ control overlaps: ${over.length}${over.length ? `\n    ${over.join("\n    ")}` : ""}`);
  for (const l of labels.filter((x) => /PDF 10000/.test(x.text))) console.log(`"${l.text}" is at x ${l.x.toFixed(0)}–${(l.x + l.width).toFixed(0)}, y ${l.y.toFixed(0)}–${(l.y + l.height).toFixed(0)}; the zoom buttons are at x ${controls.find((x) => x.name === "plan-zoom-in")!.x.toFixed(0)}–390`);
  await s.page.screenshot({ path: `${OUT}/labels-baseline-controls-390.png` });
  console.log(`partly outside the pane: ${clipped.length}`);
  await browser.close();
}

async function main() {
  await warmRoutes(["/studio/import", "/studio"]);
  if (process.argv.includes("--baseline")) return baseline();
  mkdirSync(OUT, { recursive: true });
  if (process.argv.includes("--baseline-controls")) return baselineControls();
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  try {
    await desktop(browser);
    await phone(browser);
  } finally {
    await browser.close();
  }
  console.log(`\n${report.join("\n")}`);
  assert.deepEqual(errors, [], `console errors:\n${errors.join("\n")}`);
  console.log("e2e-labels: OK");
}

withSuiteTimeout("e2e-labels", 25 * 60_000, main).catch((e) => {
  console.error(e);
  process.exit(1);
});
