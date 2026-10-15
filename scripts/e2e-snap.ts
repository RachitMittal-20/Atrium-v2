/**
 * e2e-snap.ts — step P.1 in a real browser: takeoff points snap to the PDF drawing's own corners.
 * Needs `npm run dev` on port 3000 from THIS checkout. Not in `npm test`. Real file input, real
 * mouse clicks, wheel and keys at 1440, Chromium's own touch input at 390; the dev hooks are only
 * read, never written; no blind sleeps (every wait is a named condition from e2e-helpers.ts).
 *
 * 1440 (mouse), plan-filled.pdf built into the studio, 2D, the Drawing on:
 *   - while the snap index is still being read (its worker's script is held back by a route, so
 *     this is not a race), the bar says "Reading drawing for snapping…", and a click still adds
 *     a point (with the walls' snaps); released, the index is ready;
 *   - a Length takeoff by two clicks 5 px away from two wall corners of the drawing that are an
 *     offset copy of a printed dimension: each hover shows the marker with the word "corner", the
 *     stored points equal the PDF's corners (truth.json, through the stored mapping) within
 *     0.01 mm, the value equals the printed dimension within 0.01 mm, the takeoff stores
 *     ["corner", "corner"] and its row's basis is "PDF exact";
 *   - Alt-click stores the raw pointer point (no snap, no drawing kind);
 *   - Set scale by 2%, then the same takeoff again: the points equal the corners through the NEW
 *     mapping and the value is 1.02 × the printed one (0.01 mm); the first row says
 *     "PDF exact · Rescaled x1.0200".
 * 390 (real touch), plan-filled.pdf: the same takeoff by taps after zooming with the zoom buttons
 *   and panning with a one-finger drag; Finish by its button. A finger has no hover and lifting
 *   it clears the marker, so each tap's drawing kind is read from the draft, not the marker.
 * 1440, plan-scanned.pdf and 03_with_dimensions.png: the bar says "Drawing snapping needs a
 *   vector PDF" and a click still adds a point.
 * Also: for each .pdf in test-plans/ (none today) one row: points indexed, hatching skipped, time.
 * Screenshots in /tmp/studio/: snap-marker-1440.png, snap-takeoff-1440.png, snap-390.png.
 * Run: npx tsx scripts/e2e-snap.ts
 */
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Locator, type Page, type Route } from "playwright";
import { extractVectorPage } from "../src/lib/pdf/extract";
import { buildSnapIndex } from "../src/lib/pdf/snapIndex";
import { snapTargets } from "../src/lib/takeoff/geometry";
import type { Affine, Plan, Takeoff } from "../src/types/plan";
import { BASE, step, waitForHook, waitUntil, warmRoutes, watchErrors, withSuiteTimeout } from "./e2e-helpers";
import type { Truth } from "./make-pdf-fixtures";
import { openNode, pdfjs } from "./pdf-node";

const OUT = "/tmp/studio";
const DIR = join(process.cwd(), "tests/fixtures/pdf");
const PNG = join(process.cwd(), "tests/fixtures/03_with_dimensions.png");
const EXECUTABLE = process.env.E2E_CHROMIUM || undefined;
const LONG = 240_000; // the scanned page goes through OCR
const MM = 1e-5; // 0.01 mm in metres
const OFF_PX = 5; // how far from the corner the pointer is put
const truths: Truth[] = JSON.parse(readFileSync(join(DIR, "truth.json"), "utf8"));

type Pt = { x: number; y: number };
const errors: string[] = [];
const report: string[] = [];
const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
const plan = (page: Page) => page.evaluate(() => (window as unknown as { __planStore: { getState(): { plan: Plan } } }).__planStore.getState().plan);
const draft = (page: Page) => page.evaluate(() => (window as unknown as { __takeoffStore: { getState(): { draft: [number, number][] } } }).__takeoffStore.getState().draft);
const apply = (m: Affine, p: Pt): Pt => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });
const dist = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.y - q.y);

async function camera(page: Page) {
  const c = await tid(page, "plan-canvas").evaluate((e) => ({ s: +e.getAttribute("data-scale")!, tx: +e.getAttribute("data-tx")!, ty: +e.getAttribute("data-ty")! }));
  const b = (await tid(page, "plan-canvas").boundingBox())!;
  return { ...c, x: b.x, y: b.y, w: b.width, h: b.height };
}
async function toScreen(page: Page, p: Pt): Promise<Pt> {
  const c = await camera(page);
  return { x: c.x + p.x * c.s + c.tx, y: c.y + p.y * c.s + c.ty };
}

/**
 * Two wall corners of the drawing (visible vertices of plan-filled's filled wall polygons, through the
 * plan's stored mapping) that are an offset copy of a printed dimension (a From PDF takeoff): the
 * same vector, shifted at most 0.25 m along it. Of those, the pair whose nearer face corner of the
 * plan's own walls (the one snap that outranks a drawing corner) is farthest away. Each corner
 * also gets the direction to put the pointer in: straight away from that face corner.
 */
function cornerPair(p: Plan) {
  const t = truths.find((x) => x.file === "plan-filled.pdf")!;
  const m = p.background!.mapping;
  // The fills come four edges to a rectangle; a vertex strictly inside ANOTHER rectangle is buried
  // under that wall's fill, and is no snap point (test-snap-index.ts).
  const edges = t.segments.filter((s) => s[5]);
  const rects = Array.from({ length: edges.length / 4 }, (_, i) => edges.slice(i * 4, i * 4 + 4));
  const buried = (x: number, y: number, own: number) =>
    rects.some((r, j) => j !== own && x > Math.min(...r.map((e) => e[0])) + 0.05 && x < Math.max(...r.map((e) => e[0])) - 0.05 && y > Math.min(...r.map((e) => e[1])) + 0.05 && y < Math.max(...r.map((e) => e[1])) - 0.05);
  const seen = new Map<string, Pt>();
  rects.forEach((r, i) => {
    for (const e of r) {
      if (buried(e[0], e[1], i)) continue;
      const q = apply(m, { x: e[0], y: e[1] });
      seen.set(`${q.x.toFixed(6)},${q.y.toFixed(6)}`, q);
    }
  });
  const faces = snapTargets(p).filter((x) => x.kind === "corner").map((x) => ({ x: x.point[0], y: x.point[1] }));
  const corners = [...seen.values()].map((c) => {
    const f = faces.reduce((b, q) => (dist(q, c) < dist(b, c) ? q : b));
    const d = dist(f, c);
    return { c, margin: d, away: { x: (c.x - f.x) / d, y: (c.y - f.y) / d } };
  });
  const dims = (p.takeoffs ?? []).filter((x) => x.source === "pdf" && x.reference).map((x) => ({ a: { x: x.points[0][0], y: x.points[0][1] }, b: { x: x.points[1][0], y: x.points[1][1] }, printed: x.reference!.value, text: x.reference!.note ?? "" }));
  let best: { a: (typeof corners)[number]; b: (typeof corners)[number]; printed: number; text: string } | null = null;
  for (const dm of dims) {
    const v = { x: dm.b.x - dm.a.x, y: dm.b.y - dm.a.y };
    const L = Math.hypot(v.x, v.y);
    for (const a of corners)
      for (const b of corners) {
        if (Math.abs(b.c.x - a.c.x - v.x) > 1e-6 || Math.abs(b.c.y - a.c.y - v.y) > 1e-6) continue;
        const along = Math.abs(((a.c.x - dm.a.x) * v.x + (a.c.y - dm.a.y) * v.y) / L);
        if (along > 0.25) continue;
        if (!best || Math.min(a.margin, b.margin) > Math.min(best.a.margin, best.b.margin)) best = { a, b, printed: dm.printed, text: dm.text };
      }
  }
  assert.ok(best, "plan-filled has two drawing wall corners spanning an offset copy of a printed dimension");
  return best!;
}

async function session(browser: Browser, width: number, height: number, touch: boolean) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const tag = `${width}`;
  watchErrors(page, tag, errors);
  const press = (l: Locator) => (touch ? l.tap() : l.click());
  const tap = async (p: Pt) => (touch ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y));
  const hideDevBadge = () => page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  const upload = async (path: string) => {
    await page.goto(`${BASE}/studio/import`);
    await hideDevBadge();
    await tid(page, "file-input").setInputFiles(path);
    await page.waitForSelector("[data-testid=results], [data-testid=error]", { timeout: LONG });
    if (await tid(page, "error").count()) assert.fail(`${path}: error "${await tid(page, "error-message").textContent()}"`);
  };
  /** No scale found: the north wall's two ends on the overlay are 10 m apart (the fixtures' house), as e2e-background does. */
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
  /** The 2D plan only, with the Drawing on and rendered. */
  const open2d = async () => {
    await press(tid(page, "view-2d"));
    await tid(page, "plan-svg").waitFor();
    if ((await tid(page, "plan-drawing-toggle").getAttribute("aria-pressed")) !== "true") await press(tid(page, "plan-drawing-toggle"));
    assert.equal(await tid(page, "plan-drawing-toggle").getAttribute("aria-pressed"), "true", `${tag}: the Drawing is on`);
    await waitUntil(page, `${tag}: the drawing never rendered`, "Boolean(window.__background) && window.__background.renderCount > 0 && !window.__background.pending", LONG);
  };
  const chooseTakeoff = async () => {
    await press(tid(page, "tool-takeoff"));
    await waitUntil(page, `${tag}: the Takeoff tool was not chosen`, `window.__toolStore.getState().tool === "takeoff"`);
  };
  const snapStatus = () => tid(page, "takeoff-drawing-snap").getAttribute("data-status");
  const waitStatus = (status: string, what: string) =>
    waitUntil(page, `${tag}: the drawing snap status never became "${status}" (${what})`, `document.querySelector('[data-testid="takeoff-drawing-snap"]')?.getAttribute("data-status") === "${status}"`, LONG);
  return { page, context, tag, touch, press, tap, upload, buildAndOpen, open2d, chooseTakeoff, snapStatus, waitStatus, close: () => context.close() };
}
type Session = Awaited<ReturnType<typeof session>>;

/** Before a screenshot: the drawing has caught up with the camera (its render settles 300 ms after a zoom or pan). */
const drawn = (page: Page, what: string) =>
  waitUntil(page, `the drawing never caught up (${what})`, "Boolean(window.__background) && !window.__background.pending && JSON.stringify(window.__background.mapping) === JSON.stringify(window.__planStore.getState().plan.background.mapping)", LONG);

/** The newest takeoff measured in the studio (not one carried from the PDF). */
const newest = async (page: Page): Promise<Takeoff> => (await plan(page)).takeoffs!.filter((t) => t.source !== "pdf").at(-1)!;

/**
 * Fits the plan, drags `c` (plan metres) to the pane's middle (a drag pans with the Takeoff tool:
 * the mouse, or one finger through Chromium's touch input), then zooms in about the middle until
 * `need` px per metre: the wheel there, or the Zoom in button. Then puts the pointer OFF_PX away
 * from it, straight away from the nearest face corner, and returns that point.
 */
async function aimAt(s: Session, c: Pt, away: Pt, need: number): Promise<Pt> {
  const { page } = s;
  await s.press(tid(page, "plan-fit"));
  const cam0 = await camera(page);
  const from = await toScreen(page, c);
  const to = { x: cam0.x + cam0.w / 2, y: cam0.y + cam0.h / 2 };
  const steps = Array.from({ length: 8 }, (_, i) => ({ x: from.x + ((to.x - from.x) * (i + 1)) / 8, y: from.y + ((to.y - from.y) * (i + 1)) / 8 }));
  if (dist(from, to) > 20) {
    // Only a real drag: one this short would be a click, and add a point.
    if (s.touch) {
      const cdp = await page.context().newCDPSession(page);
      const touch = (type: "touchStart" | "touchMove" | "touchEnd", p?: Pt) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
      await touch("touchStart", from);
      for (const p of steps) await touch("touchMove", p);
      await touch("touchEnd");
      await cdp.detach();
    } else {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      for (const p of steps) await page.mouse.move(p.x, p.y);
      await page.mouse.up();
    }
  }
  if (s.touch) {
    while ((await camera(page)).s < need) {
      const before = (await camera(page)).s;
      await s.press(tid(page, "plan-zoom-in"));
      await waitUntil(page, `${s.tag}: Zoom in did nothing`, `+document.querySelector('[data-testid="plan-canvas"]').getAttribute("data-scale") > ${before}`);
    }
  } else {
    await page.mouse.move(to.x, to.y);
    while ((await camera(page)).s < need) {
      const before = (await camera(page)).s;
      await page.mouse.wheel(0, -120);
      await waitUntil(page, `${s.tag}: the wheel did not zoom`, `+document.querySelector('[data-testid="plan-canvas"]').getAttribute("data-scale") > ${before}`);
    }
  }
  const at = await toScreen(page, c);
  const cam = await camera(page);
  assert.ok(at.x > cam.x + 20 && at.x < cam.x + cam.w - 60 && at.y > cam.y + 20 && at.y < cam.y + cam.h - 20, `${s.tag}: the corner is on screen after zooming (${at.x.toFixed(0)}, ${at.y.toFixed(0)})`);
  return { x: at.x + away.x * OFF_PX, y: at.y + away.y * OFF_PX };
}

/**
 * A Length takeoff by two clicks (or taps) 5 px off the pair's corners, finished by Enter (or the
 * Finish button). Checks the marker before each mouse click (after each tap: a finger has no hover),
 * and returns the new takeoff and where its corners should be.
 */
async function measurePair(s: Session, label: string, shot?: string) {
  const { page, tag } = s;
  const p = await plan(page);
  const pair = cornerPair(p);
  // Out of the face corner's reach (12 px, a finger 44): the pointer is margin × scale + OFF_PX from it, so
  // the scale must give margin × scale > reach − OFF_PX, with 6 px to spare.
  const need = ((s.touch ? 44 : 12) - OFF_PX + 6) / Math.min(pair.a.margin, pair.b.margin);
  const before = (p.takeoffs ?? []).length;
  for (const [i, k] of [pair.a, pair.b].entries()) {
    const at = await aimAt(s, k.c, k.away, need);
    if (s.touch) {
      // A finger has no hover, and lifting it clears the marker: read what the tap landed on from the draft instead.
      await s.tap(at);
      await waitUntil(page, `${tag} ${label}: tap ${i + 1} was not added`, `window.__takeoffStore.getState().draft.length === ${i + 1}`);
      assert.equal((await page.evaluate(() => (window as unknown as { __takeoffStore: { getState(): { draftSnaps: string[] } } }).__takeoffStore.getState().draftSnaps))[i], "corner", `${tag} ${label}: tap ${i + 1} landed on a drawing corner`);
      continue;
    }
    await page.mouse.move(at.x, at.y, { steps: 3 });
    try {
      await waitUntil(page, `${tag} ${label}: no "corner" snap marker at corner ${i + 1}`, `document.querySelector('[data-testid="takeoff-snap"]')?.getAttribute("data-snap") === "drawing-corner"`);
    } catch (e) {
      const seen = await page.evaluate(`[document.querySelector('[data-testid="takeoff-snap"]')?.getAttribute("data-snap") ?? "no marker", JSON.stringify(window.__takeoffStore.getState().draft), document.querySelector('[data-testid="takeoff-drawing-snap"]')?.getAttribute("data-status"), document.elementFromPoint(${at.x}, ${at.y})?.getAttribute("data-testid") ?? document.elementFromPoint(${at.x}, ${at.y})?.tagName]`);
      throw new Error(`${(e as Error).message}\n  seen: marker, draft, snap status, element at the pointer = ${JSON.stringify(seen)}; corner ${JSON.stringify(k.c)}, pointer ${JSON.stringify(at)}, camera ${JSON.stringify(await camera(page))}`);
    }
    const word = (await tid(page, "takeoff-snap-word").textContent())?.trim();
    assert.equal(word, "corner", `${tag} ${label}: the marker's word at corner ${i + 1}`);
    if (shot && i === 1) {
      await drawn(page, shot);
      await page.screenshot({ path: `${OUT}/${shot}` });
    }
    await page.mouse.click(at.x, at.y);
    await waitUntil(page, `${tag} ${label}: point ${i + 1} was not added`, `window.__takeoffStore.getState().draft.length === ${i + 1}`);
  }
  if (s.touch) await s.press(tid(page, "takeoff-finish"));
  else await page.keyboard.press("Enter");
  await waitUntil(page, `${tag} ${label}: the takeoff was not added`, `(window.__planStore.getState().plan.takeoffs ?? []).length === ${before + 1}`);
  const t = await newest(page);
  const pts = t.points.map(([x, y]) => ({ x, y }));
  const e0 = dist(pts[0], pair.a.c);
  const e1 = dist(pts[1], pair.b.c);
  assert.ok(e0 <= MM && e1 <= MM, `${tag} ${label}: the stored points are the PDF's corners within 0.01 mm (${(e0 * 1000).toExponential(2)} mm, ${(e1 * 1000).toExponential(2)} mm)`);
  assert.deepEqual(t.drawingSnaps, ["corner", "corner"], `${tag} ${label}: stored as two drawing corners`);
  return { t, pair, value: dist(pts[0], pts[1]), worstMm: Math.max(e0, e1) * 1000, zoom: need };
}

async function desktop(browser: Browser) {
  step("1440: plan-filled.pdf into the studio, 2D, the Drawing on");
  const s = await session(browser, 1440, 900, false);
  const { page, tag } = s;
  await s.upload(join(DIR, "plan-filled.pdf"));
  await s.buildAndOpen();
  await s.open2d();

  step("1440: clicks work while the drawing is read");
  // Hold back the snap worker's script (the drawing's own worker has already loaded it): the index
  // cannot be ready until it is released, so "while loading" is certain, not a race.
  const held: Route[] = [];
  await s.context.route(/background_worker/, (r) => {
    held.push(r);
  });
  await s.chooseTakeoff();
  await s.waitStatus("loading", "with the worker held");
  assert.equal((await tid(page, "takeoff-drawing-snap").innerText()).trim(), "Reading drawing for snapping…", `${tag}: the bar says the drawing is being read`);
  const cam0 = await camera(page);
  const free = { x: Math.round(cam0.x + cam0.w * 0.4), y: Math.round(cam0.y + cam0.h * 0.55) };
  await page.mouse.click(free.x, free.y);
  await waitUntil(page, `${tag}: a click while loading added no point`, "window.__takeoffStore.getState().draft.length === 1");
  assert.equal(await s.snapStatus(), "loading", `${tag}: still loading when the point went in`);
  const loadingKind = await tid(page, "takeoff-snap").getAttribute("data-snap");
  assert.ok(loadingKind && !loadingKind.startsWith("drawing-"), `${tag}: that click used the walls' snaps or the grid (${loadingKind})`);
  await page.keyboard.press("Escape"); // cancels the draft (a second Escape would leave the tool)
  await waitUntil(page, `${tag}: Escape did not cancel the draft`, "window.__takeoffStore.getState().draft.length === 0");
  for (const r of held.splice(0)) await r.continue();
  await s.context.unroute(/background_worker/);
  await s.waitStatus("ready", "after releasing the worker");
  const points = Number(await tid(page, "takeoff-drawing-snap").getAttribute("data-points"));
  assert.ok(points > 100, `${tag}: the index holds the drawing's points (${points})`);
  report.push(`1440 loading: a click while "Reading drawing for snapping…" added a point (${loadingKind}); then ready with ${points} points`);

  step("1440: a Length takeoff on two drawing wall corners");
  const first = await measurePair(s, "takeoff", "snap-marker-1440.png");
  const err = Math.abs(first.value - first.pair.printed);
  assert.ok(err <= MM, `${tag}: the value equals the printed ${first.pair.text || first.pair.printed} within 0.01 mm (${(err * 1000).toExponential(2)} mm)`);
  if ((await tid(page, "takeoff-toggle").getAttribute("aria-expanded")) === "false") await tid(page, "takeoff-toggle").click();
  const basis = () => page.locator(`[data-testid="takeoff-row"][data-takeoff="${first.t.id}"] [data-testid="takeoff-basis"]`).innerText();
  assert.equal((await basis()).trim(), "PDF exact", `${tag}: its basis`);
  await s.press(tid(page, "plan-fit"));
  await drawn(page, "snap-takeoff-1440.png");
  await page.screenshot({ path: `${OUT}/snap-takeoff-1440.png` });
  report.push(
    `1440 takeoff: (${first.pair.a.c.x.toFixed(3)}, ${first.pair.a.c.y.toFixed(3)}) → (${first.pair.b.c.x.toFixed(3)}, ${first.pair.b.c.y.toFixed(3)}) at ${first.zoom.toFixed(0)}+ px/m, points within ${first.worstMm.toExponential(2)} mm of the PDF corners, ${(first.value * 1000).toFixed(4)} mm against the printed ${(first.pair.printed * 1000).toFixed(0)} mm, basis PDF exact`,
  );

  step("1440: Alt-click stores the raw point");
  const k = first.pair.a;
  const near = await aimAt(s, k.c, k.away, first.zoom);
  const raw = { x: Math.round(near.x), y: Math.round(near.y) };
  await page.keyboard.down("Alt");
  await page.mouse.move(raw.x, raw.y, { steps: 2 });
  await page.mouse.click(raw.x, raw.y);
  await page.keyboard.up("Alt");
  await waitUntil(page, `${tag}: the Alt-click added no point`, "window.__takeoffStore.getState().draft.length === 1");
  const cam = await camera(page);
  const want = { x: (raw.x - cam.x - cam.tx) / cam.s, y: (raw.y - cam.y - cam.ty) / cam.s };
  const got = (await draft(page))[0];
  // Within 0.05 px: the camera's data attributes, which this conversion reads, are rounded.
  const offPx = Math.hypot(got[0] - want.x, got[1] - want.y) * cam.s;
  assert.ok(offPx < 0.05, `${tag}: Alt keeps the pointer's own point (${offPx.toFixed(4)} px from it)`);
  assert.ok(dist({ x: got[0], y: got[1] }, k.c) > 1 / cam.s, `${tag}: which is not the corner`);
  assert.equal(await tid(page, "takeoff-snap").getAttribute("data-snap"), "free", `${tag}: the marker says nothing snapped`);
  await page.keyboard.press("Escape");
  await waitUntil(page, `${tag}: Escape did not cancel the Alt draft`, "window.__takeoffStore.getState().draft.length === 0");
  report.push(`1440 Alt: raw point stored, ${(dist({ x: got[0], y: got[1] }, k.c) * 1000).toFixed(1)} mm from the corner`);

  step("1440: Set scale by 2%, then the same takeoff again");
  await s.press(tid(page, "plan-fit"));
  const pBefore = await plan(page);
  await s.press(tid(page, "plan-set-scale"));
  // Two ends of a long wall that are on the plan itself, not under a control or the Set scale hint bar.
  const onPlan = (p: Pt) => page.evaluate(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest('[data-testid="plan-svg"]')), [p.x, p.y] as const);
  let ends: [Pt, Pt] | null = null;
  for (const w of [...pBefore.walls].sort((a, b) => Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y) - Math.hypot(a.b.x - a.a.x, a.b.y - a.a.y))) {
    const [a, b] = [await toScreen(page, w.a), await toScreen(page, w.b)];
    if ((await onPlan(a)) && (await onPlan(b))) {
      ends = [a, b];
      break;
    }
  }
  assert.ok(ends, `${tag}: a wall with both ends clear of the controls to Set scale on`);
  await s.tap(ends![0]);
  await s.tap(ends![1]);
  await tid(page, "calibrate-dialog").waitFor();
  const picked = await page.evaluate(() => (window as unknown as { __calibrateStore: { getState(): { points: [number, number][] } } }).__calibrateStore.getState().points);
  const span = Math.hypot(picked[1][0] - picked[0][0], picked[1][1] - picked[0][1]);
  await tid(page, "calibrate-input").focus();
  await page.keyboard.type(`${(span * 1.02).toFixed(6)} m`);
  await s.press(tid(page, "calibrate-apply"));
  await waitUntil(page, `${tag}: the calibration was not applied`, "Boolean(window.__planStore.getState().plan.calibrations)");
  const factor = (await plan(page)).calibrations![0].factor;
  assert.ok(Math.abs(factor - 1.02) < 1e-5, `${tag}: a 2% calibration (${factor})`);
  await waitUntil(page, `${tag}: the Takeoff tool did not stay`, `window.__toolStore.getState().tool === "takeoff"`);
  assert.equal(await s.snapStatus(), "ready", `${tag}: the index is still ready (the mapping moved, the drawing did not)`);
  const second = await measurePair(s, "after Set scale");
  const err2 = Math.abs(second.value - factor * second.pair.printed);
  assert.ok(err2 <= MM, `${tag}: after Set scale the value is ${factor.toFixed(6)} × the printed ${second.pair.printed} m within 0.01 mm (${(err2 * 1000).toExponential(2)} mm)`);
  assert.equal((await basis()).trim(), `PDF exact · Rescaled x${factor.toFixed(4)}`, `${tag}: the first row says Rescaled`);
  report.push(`1440 after Set scale x${factor.toFixed(4)}: points within ${second.worstMm.toExponential(2)} mm of the corners through the new mapping, ${(second.value * 1000).toFixed(4)} mm = ${factor.toFixed(4)} × ${(second.pair.printed * 1000).toFixed(0)} mm (${(err2 * 1000).toExponential(2)} mm off); first row "PDF exact · Rescaled x${factor.toFixed(4)}"`);
  for (const r of report.slice(-5)) console.log(r);
  await s.close();
}

async function phone(browser: Browser) {
  step("390: plan-filled.pdf, real touch");
  const s = await session(browser, 390, 844, true);
  const { page, tag } = s;
  await s.upload(join(DIR, "plan-filled.pdf"));
  await s.buildAndOpen();
  await s.open2d();
  await s.chooseTakeoff();
  await s.waitStatus("ready", "at 390");
  const r = await measurePair(s, "by touch");
  const err = Math.abs(r.value - r.pair.printed);
  assert.ok(err <= MM, `${tag}: the value equals the printed ${r.pair.printed} m within 0.01 mm (${(err * 1000).toExponential(2)} mm)`);
  await s.press(tid(page, "plan-fit"));
  await drawn(page, "snap-390.png");
  await page.screenshot({ path: `${OUT}/snap-390.png` });
  const widths = await page.evaluate(() => ({ inner: innerWidth, doc: document.documentElement.scrollWidth }));
  assert.equal(widths.doc, 390, `${tag}: the page is exactly 390 px wide`);
  report.push(`390 touch: two taps 5 px off the corners at ${r.zoom.toFixed(0)}+ px/m, points within ${r.worstMm.toExponential(2)} mm, ${(r.value * 1000).toFixed(4)} mm against ${(r.pair.printed * 1000).toFixed(0)} mm, page ${widths.doc} px wide`);
  console.log(report.at(-1));
  await s.close();
}

async function disabledKinds(browser: Browser) {
  for (const file of [join(DIR, "plan-scanned.pdf"), PNG]) {
    const name = file.split("/").pop()!;
    step(`1440: ${name}: drawing snapping disabled`);
    const s = await session(browser, 1440, 900, false);
    const { page, tag } = s;
    await s.upload(file);
    await s.buildAndOpen();
    await s.open2d();
    await s.chooseTakeoff();
    await s.waitStatus("disabled", name);
    const note = (await tid(page, "takeoff-drawing-snap").innerText()).trim();
    assert.equal(note, "Drawing snapping needs a vector PDF", `${tag} ${name}: the note`);
    const cam = await camera(page);
    await page.mouse.click(Math.round(cam.x + cam.w / 2), Math.round(cam.y + cam.h / 2));
    await waitUntil(page, `${tag} ${name}: a click added no point`, "window.__takeoffStore.getState().draft.length === 1");
    report.push(`${name}: "${note}", and a click still adds a point`);
    console.log(report.at(-1));
    await s.close();
  }
}

/** One row per PDF in test-plans/ (real drawings, when there are any): read and indexed in Node. */
async function testPlans() {
  const dir = join(process.cwd(), "test-plans");
  const pdfs = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf"));
  if (!pdfs.length) {
    report.push("test-plans/: no .pdf files, so no real CAD PDF was indexed");
    return;
  }
  for (const f of pdfs) {
    const doc = await openNode(new Uint8Array(readFileSync(join(dir, f))));
    const t0 = performance.now();
    const v = await extractVectorPage(pdfjs, await doc.getPage(1));
    const i = buildSnapIndex(v);
    report.push(`test-plans/${f}: ${v.kind}, ${i.xs.length} points indexed, ${i.counts.hatch} hatch lines skipped, ${(performance.now() - t0).toFixed(0)} ms`);
    await doc.loadingTask.destroy();
  }
}

async function main() {
  await warmRoutes(["/studio/import", "/studio"]);
  mkdirSync(OUT, { recursive: true });
  await testPlans();
  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  try {
    await desktop(browser);
    await phone(browser);
    await disabledKinds(browser);
  } finally {
    await browser.close();
  }
  console.log(`\n${report.join("\n")}`);
  assert.deepEqual(errors, [], `console errors:\n${errors.join("\n")}`);
  console.log("e2e-snap: OK");
}

withSuiteTimeout("e2e-snap", 20 * 60_000, main).catch((e) => {
  console.error(e);
  process.exit(1);
});
