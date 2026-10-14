/**
 * e2e-background.ts — a repeatable browser check of step M.2c with Playwright's Chromium: the
 * imported drawing shown under the 2D plan, kept aligned through a recalibration, and the
 * Rescaled labels. NOT in npm test: it needs `npm run dev` on port 3000 (E2E_URL overrides) for
 * the dev-only hooks window.__planStore and window.__background, which are only READ. Every
 * action is real input (the real file input, mouse clicks and the wheel at 1440, taps at 390,
 * the keyboard), and no step waits a blind number of milliseconds: each wait is a named
 * condition (scripts/e2e-helpers.ts).
 *
 * At 1440×900 with a mouse:
 *   - plan-filled.pdf through the file input, its scale used, Build model, Open in studio. In the
 *     3D view there is no drawing and no Drawing section; in 2D the drawing renders, and the
 *     Drawing toggle and opacity slider are in the 2D pane and the panel;
 *   - alignment: every wall end of the plan, taken back through the stored mapping to the
 *     drawing's points, then through the rendered bitmap's own placement and the element's
 *     computed CSS transform, lands within 1 px of where the 2D camera draws that wall end;
 *   - pixels, not only the DOM: a screenshot crop around a wall with the drawing on and off
 *     differs by a mean RGB difference above PIXEL_DIFF_MIN; the slider (keyboard) sets the
 *     element's computed opacity;
 *   - several quick wheel steps zoom in, and exactly ONE render follows once the camera settles
 *     (renderCount + 1, nothing pending); the alignment holds at the new zoom;
 *   - a Length takeoff with real clicks on two wall ends of the drawing (each snapped to a wall's
 *     end, the snap read before the click) equals the PDF's printed dimension within 1 mm;
 *   - Set scale by 2% (two clicks, a typed distance, Apply): the drawing is still aligned within
 *     1 px, and the From PDF heading, a wall's and a door's provenance read "Rescaled x1.0200";
 *     Ctrl+Z restores the walls, the mapping and the labels;
 *   - a reload keeps the drawing; deleting the IndexedDB database and reloading draws nothing,
 *     says "Import it again to see the background" and raises no error;
 *   - plan-scanned.pdf (raster route, scale set by hand) and a PNG (tests/fixtures/03): the same
 *     toggle, drawing, pixels and alignment.
 * At 390×844 with real touch: plan-filled.pdf, the 2D pane's controls inside the viewport, a tap
 * hides and shows the drawing, the alignment holds, and the page is exactly 390 px wide.
 * Screenshots in /tmp/studio/: background-on-1440.png, background-takeoff-1440.png,
 * background-rescaled-1440.png, background-390.png.
 * Run: npx tsx scripts/e2e-background.ts
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import sharp from "sharp";
import { BASE, step, waitForHook, waitUntil, warmRoutes, watchErrors, withSuiteTimeout } from "./e2e-helpers";
import type { Affine, Plan, Wall } from "../src/types/plan";

const OUT = "/tmp/studio";
const DIR = join(process.cwd(), "tests/fixtures/pdf");
const PNG = join(process.cwd(), "tests/fixtures/03_with_dimensions.png");
const EXECUTABLE = process.env.E2E_CHROMIUM || undefined;
const LONG = 240_000; // the scanned page goes through OCR
/** Mean absolute RGB difference (0–255) a crop must show between drawing on and off. */
const PIXEL_DIFF_MIN = 2;

type Pt = { x: number; y: number };
type Hook = { kind: string | null; mapping: Affine | null; bitmapSize: { width: number; height: number } | null; region: { x: number; y: number; k: number } | null; renderCount: number; pending: boolean };
type Win = Window & { __planStore?: { getState(): { plan: Plan; past: unknown[] } }; __background?: Hook };

const errors: string[] = [];
const report: string[] = [];
const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
const plan = (page: Page) => page.evaluate(() => (window as Win).__planStore!.getState().plan);
const hook = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window as Win).__background)) as Hook);
const len = (w: Wall) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
const apply = (m: Affine, p: Pt): Pt => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });
function invert(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c;
  return { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det, e: (m.c * m.f - m.d * m.e) / det, f: (m.b * m.e - m.a * m.f) / det };
}

/** The 2D camera (the canvas's own attributes) and its box on the page. */
async function camera(page: Page) {
  const c = await tid(page, "plan-canvas").evaluate((e) => ({ s: +e.getAttribute("data-scale")!, tx: +e.getAttribute("data-tx")!, ty: +e.getAttribute("data-ty")! }));
  const b = (await tid(page, "plan-canvas").boundingBox())!;
  return { ...c, x: b.x, y: b.y, w: b.width, h: b.height };
}
/** Plan metres → page pixels, through the 2D camera. */
async function toScreen(page: Page, p: Pt): Promise<Pt> {
  const c = await camera(page);
  return { x: c.x + p.x * c.s + c.tx, y: c.y + p.y * c.s + c.ty };
}

/** Waits until the drawing has rendered more than `n` times and nothing is pending. */
const settled = (page: Page, n: number, what: string) =>
  waitUntil(page, `the drawing never finished rendering (${what})`, `Boolean(window.__background) && window.__background.renderCount > ${n} && !window.__background.pending`, LONG);

/**
 * Waits until the drawing has caught up with the plan: the layer holds the plan's current mapping
 * and no render is waiting or in flight. A change that leaves the same region of the page at the
 * same pixels per point (a Set scale followed by its refit can) rightly renders nothing: the bitmap
 * already on screen is placed in points, so the alignment check holds either way.
 */
const quiet = (page: Page, what: string) =>
  waitUntil(
    page,
    `the drawing never caught up with the plan (${what})`,
    "Boolean(window.__background) && !window.__background.pending && JSON.stringify(window.__background.mapping) === JSON.stringify(window.__planStore.getState().plan.background.mapping)",
    LONG,
  );

/**
 * Every plan wall end through the stored mapping (back to the drawing's units), the bitmap's
 * placement and the element's COMPUTED transform, against the camera's own drawing of it.
 * Returns the worst distance in CSS pixels, over the ends that are on screen.
 */
async function alignment(page: Page, tag: string): Promise<number> {
  const h = await hook(page);
  const p = await plan(page);
  assert.ok(h.mapping && h.region, `${tag}: the drawing has a mapping and a placement`);
  assert.deepEqual(h.mapping, p.background!.mapping, `${tag}: the drawing uses the plan's stored mapping`);
  const el = await tid(page, "plan-background").evaluate((e) => {
    const m = new DOMMatrix(getComputedStyle(e).transform);
    const html = e as HTMLElement;
    return { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f, left: html.offsetLeft, top: html.offsetTop, origin: getComputedStyle(e).transformOrigin };
  });
  assert.equal(el.left, 0, `${tag}: the drawing element sits at the pane's left`);
  assert.equal(el.top, 0, `${tag}: and top`);
  assert.equal(el.origin, "0px 0px", `${tag}: transformed about the pane's corner`);
  const c = await camera(page);
  const toUnits = invert(h.mapping!);
  let worst = 0;
  let counted = 0;
  for (const w of p.walls)
    for (const end of [w.a, w.b]) {
      const want = { x: end.x * c.s + c.tx, y: end.y * c.s + c.ty }; // the camera, in the pane
      if (want.x < 0 || want.y < 0 || want.x > c.w || want.y > c.h) continue;
      const u = apply(toUnits, end); // drawing units
      const px = { x: (u.x - h.region!.x) * h.region!.k, y: (u.y - h.region!.y) * h.region!.k }; // bitmap pixels
      const got = { x: el.a * px.x + el.c * px.y + el.e, y: el.b * px.x + el.d * px.y + el.f };
      worst = Math.max(worst, Math.hypot(got.x - want.x, got.y - want.y));
      counted++;
    }
  assert.ok(counted >= 4, `${tag}: at least four wall ends on screen to check (${counted})`);
  assert.ok(worst <= 1, `${tag}: the drawing is aligned with the plan within 1 px (worst ${worst.toFixed(4)} px over ${counted} wall ends)`);
  return worst;
}

/**
 * Alignment in the PIXELS, not the DOM: with the plan's own SVG hidden (a test-only style) and the
 * drawing at 100%, the drawing's dark wall band is measured across each long wall every half
 * metre (clear of openings and of the joints at its ends) and its centre compared with where the 2D camera draws
 * that wall's centre line. The band's edges are found at half the contrast, with sub-pixel
 * interpolation. Returns the worst offset in CSS pixels and how many crossings were measured.
 */
async function inkAlignment(page: Page, tag: string, tol: number, prefix = "plan"): Promise<{ worst: number; n: number }> {
  const slider = tid(page, `${prefix}-drawing-opacity`);
  const was = Number(await slider.inputValue());
  await slider.focus();
  await page.keyboard.press("End"); // 100%
  await waitUntil(page, `${tag}: the drawing did not go to 100%`, `getComputedStyle(document.querySelector('[data-testid="plan-background"]')).opacity === "1"`);
  const hide = await page.addStyleTag({ content: '[data-testid="plan-svg"] { visibility: hidden !important; } [data-testid="plan-svg"] [data-label] { display: none !important; }' }); // step L.1b: a label's backing plate is an SVG filter, which Chromium paints even under visibility:hidden, so the labels go too
  const shot = await page.screenshot();
  await hide.evaluate((e) => (e as Element).remove());
  await slider.focus();
  await page.keyboard.press("Home");
  for (let i = 0; i < was / 5; i++) await page.keyboard.press("ArrowRight"); // back to where it was
  await waitUntil(page, `${tag}: the opacity did not come back`, `document.querySelector('[data-testid="${prefix}-drawing-opacity"]').value === "${was}"`);

  const { data, info } = await sharp(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const lum = (x: number, y: number) => {
    const [xi, yi] = [Math.round(x), Math.round(y)];
    if (xi < 0 || yi < 0 || xi >= info.width || yi >= info.height) return NaN;
    const i = (yi * info.width + xi) * 3;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };
  const p = await plan(page);
  const c = await camera(page);
  let worst = 0;
  let n = 0;
  for (const w of p.walls) {
    const L = len(w);
    const tpx = w.thickness * c.s;
    if (L * c.s < 80 || tpx < 4) continue;
    const dir = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L };
    const nrm = { x: -dir.y, y: dir.x };
    for (let along = 0.4; along <= L - 0.4; along += 0.5) {
      if (p.openings.some((o) => o.wallId === w.id && Math.abs(o.offset - along) < o.width / 2 + 0.3)) continue; // a gap has no ink
      const at = { x: c.x + (w.a.x + dir.x * along) * c.s + c.tx, y: c.y + (w.a.y + dir.y * along) * c.s + c.ty };
      if (at.x < c.x + 50 || at.y < c.y + 80 || at.x > c.x + c.w - 80 || at.y > c.y + c.h - 120) continue; // off screen or under a control
      // A profile across the wall, a quarter pixel apart, reaching 12 px past each face.
      const reach = tpx / 2 + 12;
      const ts: number[] = [];
      const vs: number[] = [];
      for (let t = -reach; t <= reach; t += 0.25) {
        ts.push(t);
        vs.push(lum(at.x + nrm.x * t, at.y + nrm.y * t));
      }
      if (vs.some(Number.isNaN)) continue;
      const lo = Math.min(...vs);
      const hi = Math.max(...vs);
      if (hi - lo < 60) continue; // no clear ink here
      const half = (lo + hi) / 2;
      // The dark run around the predicted centre line (t = 0), and its two half-contrast crossings.
      let i0 = ts.findIndex((t) => t >= 0);
      if (vs[i0] > half) i0 = vs.reduce((best, v, i) => (v < vs[best] ? i : best), 0);
      let a = i0;
      while (a > 0 && vs[a - 1] <= half) a--;
      let b = i0;
      while (b < vs.length - 1 && vs[b + 1] <= half) b++;
      if (a === 0 || b === vs.length - 1) continue; // the band runs off the profile: not a clean wall here
      const cross = (i: number, j: number) => ts[i] + ((half - vs[i]) / (vs[j] - vs[i])) * (ts[j] - ts[i]);
      const centre = (cross(a - 1, a) + cross(b, b + 1)) / 2;
      worst = Math.max(worst, Math.abs(centre));
      n++;
    }
  }
  assert.ok(n >= 6, `${tag}: at least six wall crossings measured in the pixels (${n})`);
  assert.ok(worst <= tol, `${tag}: in the pixels, the drawing's wall bands are centred on the plan's walls within ${tol} px (worst ${worst.toFixed(2)} px over ${n} crossings)`);
  return { worst, n };
}

/** Mean absolute RGB difference between two PNG screenshots of the same size. */
async function meanDiff(a: Buffer, b: Buffer): Promise<number> {
  const [x, y] = await Promise.all([a, b].map((buf) => sharp(buf).removeAlpha().raw().toBuffer()));
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += Math.abs(x[i] - y[i]);
  return sum / x.length;
}

/** The drawing on and off, by the toggle, in pixels around a wall; the toggle is left on. */
async function pixels(page: Page, press: (l: Locator) => Promise<void>, tag: string, prefix = "plan"): Promise<number> {
  const p = await plan(page);
  const c = await camera(page);
  // The longest wall on screen; a 200 px square around its middle catches its surroundings.
  const wall = [...p.walls].sort((a, b) => len(b) - len(a))[0];
  const mid = await toScreen(page, { x: (wall.a.x + wall.b.x) / 2, y: (wall.a.y + wall.b.y) / 2 });
  const size = 200;
  const clip = { x: Math.max(c.x, Math.min(mid.x - size / 2, c.x + c.w - size)), y: Math.max(c.y, Math.min(mid.y - size / 2, c.y + c.h - size)), width: size, height: size };
  const toggle = tid(page, `${prefix}-drawing-toggle`);
  assert.equal(await toggle.getAttribute("aria-pressed"), "true", `${tag}: the drawing starts shown`);
  const on = await page.screenshot({ clip });
  await press(toggle);
  await waitUntil(page, `${tag}: the drawing did not hide`, `getComputedStyle(document.querySelector('[data-testid="plan-background"]')).display === "none"`);
  assert.equal(await toggle.getAttribute("aria-pressed"), "false", `${tag}: the toggle says hidden`);
  const off = await page.screenshot({ clip });
  await press(toggle);
  await waitUntil(page, `${tag}: the drawing did not come back`, `getComputedStyle(document.querySelector('[data-testid="plan-background"]')).display !== "none"`);
  const diff = await meanDiff(on, off);
  assert.ok(diff > PIXEL_DIFF_MIN, `${tag}: the drawing shows in the pixels: mean RGB difference on/off ${diff.toFixed(2)} > ${PIXEL_DIFF_MIN}`);
  return diff;
}

async function session(browser: Browser, width: number, height: number, touch: boolean) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const tag = `${width}`;
  watchErrors(page, tag, errors);
  const press = (l: Locator) => (touch ? l.tap() : l.click());
  const tap = async (p: Pt) => (touch ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y));
  /** The dev badge sits bottom left, over the 2D pane's Set scale row: it would swallow taps. */
  const hideDevBadge = () => page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  const upload = async (path: string) => {
    await page.goto(`${BASE}/studio/import`);
    await hideDevBadge();
    await tid(page, "file-input").setInputFiles(path);
    await page.waitForSelector("[data-testid=results], [data-testid=error]", { timeout: LONG });
    if (await tid(page, "error").count()) assert.fail(`${path}: error "${await tid(page, "error-message").textContent()}"`);
  };
  /** Use the found scale (or, with none, the top wall as 10 m, by hand), build, open the studio. */
  const buildAndOpen = async () => {
    const use = tid(page, "scale-found").getByRole("button", { name: /^(Use this scale|Confirm this scale)$/ });
    if (await use.count()) await press(use);
    else await scaleByHand();
    await press(page.getByRole("button", { name: "Build model" }));
    await tid(page, "summary").waitFor();
    assert.equal(await tid(page, "summary-drawing-note").count(), 0, `${tag}: the drawing was kept (no note)`);
    await press(page.getByRole("button", { name: "Open in studio" }));
    await page.waitForURL(/\/studio$/);
    await waitForHook(page, "__planStore", "the studio after Open in studio");
    await waitForHook(page, "__background", "the studio after Open in studio");
    await hideDevBadge();
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
  /** The 2D plan only, and the drawing's first render. */
  const open2d = async () => {
    const before = (await hook(page)).renderCount;
    await press(tid(page, "view-2d"));
    await tid(page, "plan-svg").waitFor();
    await settled(page, before, "on opening the 2D plan");
  };
  return { page, tag, press, tap, upload, buildAndOpen, open2d, hideDevBadge, close: () => context.close() };
}

/** Every printed PDF dimension that runs between two plan wall ends on one wall line. */
function dimensionsOnWalls(p: Plan): { ref: number; a: Pt; b: Pt }[] {
  const ends = p.walls.flatMap((w) => [w.a, w.b]);
  const found: { ref: number; a: Pt; b: Pt }[] = [];
  for (const t of p.takeoffs ?? []) {
    if (t.source !== "pdf" || !t.reference || t.reference.value > 4.5) continue; // short enough to zoom in on
    const [[x0, y0], [x1, y1]] = t.points;
    const horizontal = Math.abs(y1 - y0) < 1e-6;
    for (const a of ends)
      for (const b of ends) {
        const on = horizontal ? Math.abs(a.y - b.y) < 1e-9 && Math.abs(Math.min(a.x, b.x) - Math.min(x0, x1)) < 1e-3 && Math.abs(Math.max(a.x, b.x) - Math.max(x0, x1)) < 1e-3 : Math.abs(a.x - b.x) < 1e-9 && Math.abs(Math.min(a.y, b.y) - Math.min(y0, y1)) < 1e-3 && Math.abs(Math.max(a.y, b.y) - Math.max(y0, y1)) < 1e-3;
        if (on && Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - t.reference.value) < 1e-6 && (horizontal ? a.x < b.x : a.y < b.y)) found.push({ ref: t.reference.value, a, b });
      }
  }
  assert.ok(found.length, "plan-filled has a printed dimension between two wall ends");
  return found;
}

const WHEEL_STEPS = 4;
const WHEEL_DY = -120; // PlanCanvas zooms by exp(-dy × 0.0015) per step: about ×2 for four

async function desktop(browser: Browser) {
  step("1440: plan-filled.pdf into the studio");
  const s = await session(browser, 1440, 900, false);
  const { page, tag, press } = s;
  await s.upload(join(DIR, "plan-filled.pdf"));
  await s.buildAndOpen();
  const p0 = await plan(page);
  assert.ok(p0.background, `${tag}: the built plan has a drawing`);
  assert.equal(p0.background!.kind, "pdf", `${tag}: a PDF page`);
  assert.equal(p0.background!.page, 1, `${tag}: page 1`);
  // The studio opens in 3D: no drawing there, and no Drawing section.
  assert.equal(await tid(page, "plan-background").count(), 0, `${tag}: no drawing in the 3D view`);
  assert.equal(await tid(page, "panel-drawing").count(), 0, `${tag}: and no Drawing section while only 3D shows`);

  step("1440: 2D, the controls and the alignment");
  await s.open2d();
  for (const id of ["plan-drawing-toggle", "plan-drawing-opacity", "panel-drawing-toggle", "panel-drawing-opacity"]) assert.ok(await tid(page, id).isVisible(), `${tag}: ${id} is shown`);
  assert.equal(await tid(page, "plan-drawing-opacity").inputValue(), "50", `${tag}: opacity starts at 50%`);
  const h1 = await hook(page);
  assert.ok(h1.bitmapSize && Math.max(h1.bitmapSize.width, h1.bitmapSize.height) <= 4096, `${tag}: a bitmap at most 4096 px (${JSON.stringify(h1.bitmapSize)})`);
  const a1 = await alignment(page, `${tag} first render`);
  const ink1 = await inkAlignment(page, `${tag} first render`, 1);
  await page.screenshot({ path: `${OUT}/background-on-1440.png` });

  step("1440: pixels on and off, and the slider");
  const diff = await pixels(page, press, tag);
  await tid(page, "plan-drawing-opacity").focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft"); // 50 → 40
  await waitUntil(page, `${tag}: the opacity did not follow the slider`, `getComputedStyle(document.querySelector('[data-testid="plan-background"]')).opacity === "0.4"`);
  assert.equal(await tid(page, "panel-drawing-opacity").inputValue(), "40", `${tag}: the panel's slider shows the same setting`);
  const saved = await page.evaluate(() => localStorage.getItem("atrium.background"));
  assert.deepEqual(JSON.parse(saved!), { visible: true, opacity: 0.4 }, `${tag}: the view setting is in localStorage, not the plan`);
  assert.ok(!("opacity" in (await plan(page)).background!), `${tag}: the plan holds no opacity`);
  console.log(`${tag}: drawing aligned within ${a1.toFixed(4)} px (DOM) and ${ink1.worst.toFixed(2)} px in the pixels (${ink1.n} wall crossings); on/off mean RGB difference ${diff.toFixed(2)}; slider 50% → 40% by keyboard`);

  step("1440: zoom with the wheel: exactly one render after it settles");
  const cam = await camera(page);
  const centre = { x: cam.x + cam.w / 2, y: cam.y + cam.h / 2 };
  const before = (await hook(page)).renderCount;
  const scale0 = cam.s;
  await page.mouse.move(centre.x, centre.y);
  for (let i = 0; i < WHEEL_STEPS; i++) await page.mouse.wheel(0, WHEEL_DY); // quick steps, under the settle time apart
  const scale1 = (await camera(page)).s;
  assert.ok(scale1 > scale0 * 1.5, `${tag}: the wheel zoomed in (${scale0.toFixed(1)} → ${scale1.toFixed(1)} px/m)`);
  await settled(page, before, "after the wheel zoom");
  assert.equal((await hook(page)).renderCount, before + 1, `${tag}: exactly one render after the zoom settled`);
  const a2 = await alignment(page, `${tag} after zoom`);
  const ink2 = await inkAlignment(page, `${tag} after zoom`, 1);
  console.log(`${tag}: ${WHEEL_STEPS} wheel steps ${scale0.toFixed(1)} → ${scale1.toFixed(1)} px/m, ${before} → ${before + 1} renders; aligned within ${a2.toFixed(4)} px (DOM), ${ink2.worst.toFixed(2)} px in the pixels`);

  step("1440: a Length takeoff on the drawing's wall ends");
  await tid(page, "tool-takeoff").click();
  // A printed dimension that fits in the pane at this zoom (clear of the hint bar, the zoom buttons
  // and the Set scale row), brought to the middle with real drags: with the Takeoff tool a drag pans.
  const box = await camera(page);
  const room = { w: box.w - 40 - 70, h: box.h - 70 - 110 };
  const dim = dimensionsOnWalls(await plan(page)).find((c) => Math.abs(c.b.x - c.a.x) * box.s < room.w - 40 && Math.abs(c.b.y - c.a.y) * box.s < room.h - 40);
  assert.ok(dim, `${tag}: a printed dimension fits in the pane at ${box.s.toFixed(0)} px/m`);
  const target = { x: box.x + 40 + room.w / 2, y: box.y + 70 + room.h / 2 };
  for (let i = 0; i < 6; i++) {
    const m = await toScreen(page, { x: (dim.a.x + dim.b.x) / 2, y: (dim.a.y + dim.b.y) / 2 });
    const d = { x: target.x - m.x, y: target.y - m.y };
    if (Math.hypot(d.x, d.y) < 2) break;
    const k = Math.min(1, 300 / Math.hypot(d.x, d.y)); // at most 300 px per drag, starting from the pane's middle
    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    await page.mouse.move(target.x + d.x * k, target.y + d.y * k, { steps: 6 });
    await page.mouse.up();
  }
  const pts: Pt[] = [];
  for (const end of [dim.a, dim.b]) {
    // A few centimetres along the wall from its end: the end is within the 12 px snap, every face corner well outside it.
    const toward = end === dim.a ? dim.b : dim.a;
    const L = Math.hypot(toward.x - end.x, toward.y - end.y);
    const near = await toScreen(page, { x: end.x + ((toward.x - end.x) / L) * 0.03, y: end.y + ((toward.y - end.y) / L) * 0.03 });
    await page.mouse.move(near.x, near.y, { steps: 3 });
    try {
      await waitUntil(page, `${tag}: no snap marker at the wall end`, `document.querySelector('[data-testid="takeoff-snap"]')?.getAttribute("data-snap") === "endpoint"`, 5000);
    } catch (e) {
      const seen = await page.evaluate(`[document.querySelector('[data-testid="takeoff-snap"]')?.getAttribute("data-snap") ?? "no marker", window.__toolStore.getState().tool, JSON.stringify(window.__takeoffStore?.getState().mode)]`);
      throw new Error(`${(e as Error).message}\n  seen: snap, tool, mode = ${JSON.stringify(seen)}; end ${JSON.stringify(end)}, dimension ${JSON.stringify(dim)}, pointer ${JSON.stringify(near)}`);
    }
    await page.mouse.click(near.x, near.y);
    pts.push(near);
  }
  await page.keyboard.press("Enter");
  await waitUntil(page, `${tag}: the takeoff was not added`, `window.__planStore.getState().plan.takeoffs.some((t) => t.source !== "pdf")`);
  const made = (await plan(page)).takeoffs!.filter((t) => t.source !== "pdf").at(-1)!;
  const measured = Math.hypot(made.points[1][0] - made.points[0][0], made.points[1][1] - made.points[0][1]);
  assert.ok(Math.abs(measured - dim.ref) <= 0.001, `${tag}: the takeoff measures the printed dimension within 1 mm (${measured.toFixed(6)} vs ${dim.ref})`);
  await page.screenshot({ path: `${OUT}/background-takeoff-1440.png` });
  await page.keyboard.press("Escape"); // back to Select
  await waitUntil(page, `${tag}: Escape did not go back to Select`, `window.__toolStore.getState().tool === "select"`);
  console.log(`${tag}: Length takeoff by two real clicks on the drawing's wall ends = ${(measured * 1000).toFixed(3)} mm; printed ${(dim.ref * 1000).toFixed(0)} mm`);

  step("1440: Set scale by 2%: still aligned, labels say Rescaled");
  await tid(page, "plan-fit").click();
  await quiet(page, "after Fit");
  const pBefore = await plan(page);
  const south = [...pBefore.walls].sort((a, b) => (b.a.y + b.b.y) / 2 - (a.a.y + a.b.y) / 2 || len(b) - len(a)).filter((w) => len(w) >= 3)[0];
  await press(tid(page, "plan-set-scale"));
  await s.tap(await toScreen(page, south.a));
  await s.tap(await toScreen(page, south.b));
  await tid(page, "calibrate-dialog").waitFor();
  const picked = await page.evaluate(() => (window as unknown as { __calibrateStore: { getState(): { points: [number, number][] } } }).__calibrateStore.getState().points);
  const span = Math.hypot(picked[1][0] - picked[0][0], picked[1][1] - picked[0][1]);
  await tid(page, "calibrate-input").focus();
  await page.keyboard.type(`${(span * 1.02).toFixed(6)} m`);
  const n0 = (await hook(page)).renderCount;
  await press(tid(page, "calibrate-apply"));
  await waitUntil(page, `${tag}: the calibration was not applied`, "Boolean(window.__planStore.getState().plan.calibrations)");
  await quiet(page, "after Set scale");
  const n1 = (await hook(page)).renderCount;
  const p1 = await plan(page);
  const factor = p1.calibrations![0].factor;
  assert.ok(Math.abs(factor - 1.02) < 1e-5, `${tag}: a 2% calibration (${factor})`);
  for (const k of ["a", "d", "e", "f"] as const)
    assert.ok(Math.abs(p1.background!.mapping[k] - pBefore.background!.mapping[k] * factor) < 1e-12, `${tag}: the mapping's ${k} was scaled with the plan, about its origin`);
  const a3 = await alignment(page, `${tag} after Set scale`);
  const ink3 = await inkAlignment(page, `${tag} after Set scale`, 1);
  const heading = (await tid(page, "takeoff-pdf-toggle").innerText()).trim();
  assert.match(heading, /^From PDF \(11\) · 11 flagged · Rescaled x1\.0200/, `${tag}: the From PDF heading says Rescaled ("${heading}")`);
  // A wall's provenance, selected with a real click on its body.
  const wallMid = await toScreen(page, { x: (p1.walls.find((w) => w.id === south.id)!.a.x + p1.walls.find((w) => w.id === south.id)!.b.x) / 2, y: (p1.walls.find((w) => w.id === south.id)!.a.y + p1.walls.find((w) => w.id === south.id)!.b.y) / 2 });
  await page.mouse.click(wallMid.x, wallMid.y);
  await tid(page, "wall-provenance").waitFor();
  const wallLabel = (await tid(page, "wall-provenance").innerText()).trim();
  assert.equal(wallLabel, "Read from PDF · Rescaled x1.0200", `${tag}: the wall says it was rescaled`);
  await page.keyboard.press("Escape");
  // A door's, the same way: the centre of its gap.
  const door = p1.openings.find((o) => o.kind === "door" && o.provenance === "vector")!;
  const dw = p1.walls.find((w) => w.id === door.wallId)!;
  const dl = len(dw);
  const doorAt = await toScreen(page, { x: dw.a.x + ((dw.b.x - dw.a.x) / dl) * door.offset, y: dw.a.y + ((dw.b.y - dw.a.y) / dl) * door.offset });
  await page.mouse.click(doorAt.x, doorAt.y);
  await tid(page, "opening-provenance").waitFor();
  const doorLabel = (await tid(page, "opening-provenance").innerText()).trim();
  assert.equal(doorLabel, "Read from PDF · Rescaled x1.0200 · Default height", `${tag}: the door says it was rescaled`);
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${OUT}/background-rescaled-1440.png` });
  console.log(`${tag}: Set scale ×1.02 (${n1 - n0} render${n1 - n0 === 1 ? "" : "s"} after it): aligned within ${a3.toFixed(4)} px (DOM), ${ink3.worst.toFixed(2)} px in the pixels; "${heading}"; wall "${wallLabel}"; door "${doorLabel}"`);

  step("1440: Ctrl+Z restores the walls, the mapping and the labels");
  await tid(page, "plan-canvas").focus();
  await page.keyboard.press("Control+z");
  await waitUntil(page, `${tag}: Ctrl+Z did not undo the calibration`, "!window.__planStore.getState().plan.calibrations");
  const p2 = await plan(page);
  assert.deepEqual(p2.walls, pBefore.walls, `${tag}: every wall back`);
  assert.deepEqual(p2.background, pBefore.background, `${tag}: and the mapping`);
  await quiet(page, "after Ctrl+Z");
  const a4 = await alignment(page, `${tag} after Ctrl+Z`);
  const ink4 = await inkAlignment(page, `${tag} after Ctrl+Z`, 1);
  const headingBack = (await tid(page, "takeoff-pdf-toggle").innerText()).trim();
  assert.ok(!headingBack.includes("Rescaled"), `${tag}: the heading no longer says Rescaled ("${headingBack}")`);
  console.log(`${tag}: Ctrl+Z: walls and mapping restored, aligned within ${a4.toFixed(4)} px (DOM), ${ink4.worst.toFixed(2)} px in the pixels, "${headingBack}"`);

  step("1440: reload keeps the drawing");
  const kept = (await plan(page)).background;
  await page.reload();
  await waitForHook(page, "__planStore", "after the reload");
  await s.hideDevBadge();
  await waitUntil(page, `${tag}: the plan is not restored after the reload`, "Boolean(window.__planStore.getState().plan.background)");
  assert.deepEqual((await plan(page)).background, kept, `${tag}: the drawing's descriptor survives the reload`);
  await s.open2d();
  await alignment(page, `${tag} after reload`);
  assert.equal(await tid(page, "plan-drawing-opacity").inputValue(), "40", `${tag}: and the opacity setting too`);

  step("1440: the asset store deleted: nothing drawn, the panel says why");
  // A string, not a function: esbuild's keepNames would wrap the handlers (see CLAUDE.md, F.1).
  await page.evaluate(`new Promise((done) => { const q = indexedDB.deleteDatabase("atrium-assets"); q.onsuccess = q.onerror = q.onblocked = () => done(null); })`);
  await page.reload();
  await waitForHook(page, "__planStore", "after deleting the asset store");
  await s.hideDevBadge();
  await press(tid(page, "view-2d"));
  await tid(page, "plan-svg").waitFor();
  await waitUntil(page, `${tag}: the panel never said the file is missing`, `document.querySelector('[data-testid="panel-drawing"]')?.getAttribute("data-status") === "missing"`);
  const missing = (await tid(page, "panel-drawing-status").innerText()).trim();
  assert.match(missing, /Import it again to see the background\.$/, `${tag}: "${missing}"`);
  assert.equal(await tid(page, "plan-background").count(), 0, `${tag}: and nothing is drawn`);
  assert.ok((await plan(page)).walls.length > 0, `${tag}: the plan itself is untouched`);
  console.log(`${tag}: reload kept the drawing; with the asset store deleted: "${missing}", nothing drawn, no error`);
  await s.close();
}

/** A scanned PDF and a PNG: the drawing, its toggle, its pixels and its alignment. */
async function otherKinds(browser: Browser) {
  for (const [file, kind] of [
    [join(DIR, "plan-scanned.pdf"), "pdf"],
    [PNG, "image"],
  ] as const) {
    const name = file.split("/").pop()!;
    step(`1440: ${name}`);
    const s = await session(browser, 1440, 900, false);
    const { page, tag, press } = s;
    await s.upload(file);
    await s.buildAndOpen();
    assert.equal((await plan(page)).background?.kind, kind, `${name}: a ${kind} drawing`);
    await s.open2d();
    assert.ok(await tid(page, "plan-drawing-toggle").isVisible(), `${name}: the Drawing toggle`);
    assert.ok(await tid(page, "plan-drawing-opacity").isVisible(), `${name}: and the slider`);
    assert.equal(await tid(page, "plan-background").getAttribute("data-kind"), kind, `${name}: drawn as a ${kind}`);
    const a = await alignment(page, `${tag} ${name}`);
    // The plan's walls here are TRACED from the picture (about a pixel of the raster out), so the ink is allowed 2 px.
    const ink = await inkAlignment(page, `${tag} ${name}`, 2);
    const diff = await pixels(page, press, `${tag} ${name}`);
    report.push(`${name}: ${kind} drawing, aligned within ${a.toFixed(4)} px (DOM), ${ink.worst.toFixed(2)} px in the pixels over ${ink.n} wall crossings, on/off mean RGB difference ${diff.toFixed(2)}`);
    console.log(report[report.length - 1]);
    await s.close();
  }
}

async function phone(browser: Browser) {
  step("390: plan-filled.pdf, touch");
  const s = await session(browser, 390, 844, true);
  const { page, tag, press } = s;
  await s.upload(join(DIR, "plan-filled.pdf"));
  await s.buildAndOpen();
  await s.open2d();
  for (const id of ["plan-drawing-toggle", "plan-drawing-opacity", "plan-set-scale"]) {
    const b = (await tid(page, id).boundingBox())!;
    assert.ok(b.x >= 0 && b.x + b.width <= 390, `${tag}: ${id} is inside the viewport (${b.x.toFixed(0)}–${(b.x + b.width).toFixed(0)})`);
    assert.ok(b.height >= 44, `${tag}: ${id} is at least 44 px tall (${b.height})`);
  }
  await alignment(page, `${tag}`);
  const ink = await inkAlignment(page, tag, 1);
  const diff = await pixels(page, press, tag);
  await page.screenshot({ path: `${OUT}/background-390.png` });
  const widths = await page.evaluate(() => ({ inner: innerWidth, doc: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.equal(widths.inner, 390, `${tag}: viewport`);
  assert.equal(widths.doc, 390, `${tag}: the page is exactly 390 px wide`);
  assert.equal(widths.body, 390, `${tag}: and so is the body`);
  // The panel's copy, in the sheet.
  await press(page.getByRole("button", { name: /Plan details/ }));
  await tid(page, "panel-drawing").scrollIntoViewIfNeeded();
  assert.ok(await tid(page, "panel-drawing-toggle").isVisible(), `${tag}: the panel's toggle is in the sheet`);
  const pb = (await tid(page, "panel-drawing").boundingBox())!;
  assert.ok(pb.x >= 0 && pb.x + pb.width <= 390, `${tag}: the panel's Drawing section fits`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390, `${tag}: still exactly 390 px wide with the sheet open`);
  console.log(`${tag}: controls inside the viewport and 44 px tall, aligned (${ink.worst.toFixed(2)} px in the pixels, ${ink.n} crossings), on/off by tap (mean RGB difference ${diff.toFixed(2)}), page ${widths.doc} px`);
  await s.close();
}

async function main() {
  await warmRoutes(["/studio/import", "/studio"]);
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  try {
    await desktop(browser);
    await phone(browser);
    await otherKinds(browser);
  } finally {
    await browser.close();
  }
  console.log(`\n${report.join("\n")}`);
  assert.deepEqual(errors, [], `console errors:\n${errors.join("\n")}`);
  console.log("e2e-background: OK");
}

withSuiteTimeout("e2e-background", 20 * 60_000, main).catch((e) => {
  console.error(e);
  process.exit(1);
});
