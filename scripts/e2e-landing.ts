/**
 * e2e-landing.ts — step 8.1: the landing page's blueprint scene in Playwright's Chromium, with real input.
 * NOT in npm test: it needs `npm run dev` on port 3000 (E2E_URL overrides). Reads no dev-only window hook: the
 * scene's own data-* attributes say what it did. No blind sleeps before a read; each wait is a named condition.
 *
 * At 1440x900 (mouse wheel, through Lenis) and 390x844 (a phone: real touch scroll gestures through CDP's
 * Input.synthesizeScrollGesture, device scale 3):
 *   - the headline "From one drawing, a whole house" is an h1 inside the first screen;
 *   - the 3D canvas loads lazily, fades in over the server-rendered sheet without changing the page's height;
 *   - screenshots at 0, 50 and 100% of the BUILD (100% = data-build-end of the scene's scroll, where the walls
 *     stand at full height, before the hand-over fade), each checked by pixels: NOT BLANK = no single colour
 *     (within 40, summed over RGB) covers more than 95% of the frame, and at least 3 colours (16 levels a channel)
 *     each cover 0.5% or more; 50% differs from 0% in at least 5% of pixels and 100% from 0% in at least 15%,
 *     a pixel "differing" when its RGB moved more than 60 summed;
 *   - at 50% the canvas alone makes the picture: hiding the DOM sheet under it changes under 0.5% of pixels;
 *   - the pixel ratio is capped at 1.5 on the phone; nothing is wider than the viewport;
 *   - nothing renders while the page rests, nor once the scene has scrolled away (data-renders stays put);
 *   - the hand-over: mid-fade the stage is part-transparent and the tour is rising into place; at the end the
 *     stage is hidden and the tour stands pinned exactly at the top (within 2 px);
 *   - frame times of a scripted scroll through the scene are measured and PRINTED, not asserted (headless
 *     Chromium on SwiftShader renders WebGL on the CPU, so the numbers are a floor, not a phone's).
 * Then reduced motion (1440 and 390) and a Chromium with WebGL switched off (1440): data-mode="static", no canvas
 * and neither three.js nor react-three-fiber fetched, the sheet first and the end-state drawing after the middle, the stage gone at the end.
 * No console errors anywhere.
 *
 * Step L.2 adds (E2E_ONLY=fit|scene|story|load|failed|tour runs one part; the rest of this header is step 8.1's):
 *   fit     1440x900, 1280x720 and 390x844, 3D mode, nine scroll positions from 0 to 100% of the build, each by pixels:
 *           the outer ring of the screenshot (one device pixel wide) is the ground colour, so no part of the sheet or the
 *           model reaches the edge of the viewport (whole sheet and model in view); and from 25% of the build on, with the
 *           headline text hidden, nothing model-coloured (RGB sum over 300; the ground, paper and grid are far under)
 *           shows in the headline's band. FAILED on the 8.1 page: at 1440 the sheet ran off the bottom right at 100%.
 *   h1      one h1, and "From one drawing, a whole house" once in the page's text (the mansion has its own heading).
 *   load    at 1440 and 390: the preloader is visible from the first paint, is gone by 3 s and within a second of the
 *           canvas being ready, layout shift stays under 0.01 and the page height does not change when it goes; the
 *           photos after the first are not requested until the scroll is near them (network requests, node side), and
 *           all five arrive by the end of the tour; under reduced motion the preloader is never visible.
 *   failed  the canvas chunk blocked: the preloader still goes by 3 s, the scene turns static and the page works.
 *   tour    at 390 the tour is a crossfade (no clip-path, no will-change, nothing wider than the screen), the hero caption
 *           and Step inside do not overlap and the caption is readable (contrast against the picture, measured); at 1440
 *           the arches are kept. Frame times through the tour are printed.
 * Step H.2 (the hero is a story now: lines rise, a scan turns them solid, the camera tours the house and walks in at the
 * front door; see src/lib/landing/story.ts): the build is the first 24% of a seven-screen scroll, so every "% of the
 * build" above is of that first phase, which still uses cameraAt and its no-crop fitting. The tour starts in the lobby, so
 * the photos are 02 to 05 (four), and Step inside is gone. Step H.3: the villa photograph (01) is shown in the hero's
 * reveal, fetched once the build is done, so it is requested before the tour's pin. The story's later phases are checked in Node
 * (scripts/test-landing-story.ts) and by `story` here: frames at the settle, the tour, the walk in, the daylight wash and
 * the end are drawn and differ from each other, the sky shows behind the finished house, and the stage dissolves onto
 * the lobby.
 * Screenshots in /tmp/studio/ (L.2): landing-final-{0,100}-{1440,1280,390}.png, landing-final-tour-{1440,390}.png.
 * Screenshots in /tmp/studio/: landing-scene-{0,50,100}-1440.png, landing-scene-390.png (the 50% frame) and
 * landing-scene-{0,100}-390.png, landing-scene-reduced-{1440,390}.png, landing-scene-nowebgl-1440.png.
 * Run: npx tsx scripts/e2e-landing.ts
 */
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import sharp from "sharp";
import { BASE, step, waitUntil, warmRoutes, watchErrors, withSuiteTimeout } from "./e2e-helpers";

const OUT = "/tmp/studio";
const EXECUTABLE = process.env.E2E_CHROMIUM || undefined;
const GL_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const SCENE = "[data-testid=blueprint-scene]";
const errors: string[] = [];

interface Geometry {
  span: number; // the scene's scroll: section height minus the stage
  buildEnd: number;
  fadeStart: number;
}

const geometry = (page: Page) =>
  page.evaluate<Geometry>(`(() => { const s = document.querySelector("${SCENE}"); const st = document.querySelector("[data-testid=blueprint-stage]");
    return { span: s.offsetHeight - st.offsetHeight, buildEnd: Number(s.dataset.buildEnd), fadeStart: Number(s.dataset.fadeStart) }; })()`);

/** Waits until the scroll position and the canvas's frame count have both held still for 200 ms. */
async function settle(page: Page, what: string) {
  await page.evaluate("window.__settle = null");
  try {
    await page.waitForFunction(
      `(() => { const s = document.querySelector("${SCENE}"); const k = scrollY + ":" + (s.dataset.renders || "") + ":" + s.dataset.step; const same = window.__settle === k; window.__settle = k; return same; })()`,
      undefined,
      { timeout: 20_000, polling: 200 },
    );
  } catch {
    throw new Error(`the page never settled (${what})`);
  }
}

/** E2E_NO_TOUCH=1 scrolls the phone runs with the mouse wheel: on the cloud's Linux headless Chromium, CDP's touch scroll
 *  gestures do not scroll at all (step H.2 found it: a plain 5000 px page stays at scrollY 0), so the 390 parts cannot
 *  run there otherwise. The phone's layout, pixel ratio and touch flags are unchanged; only the scrolling input differs. */
const NO_TOUCH = process.env.E2E_NO_TOUCH === "1";

/** Scrolls with the real device: mouse wheel (Lenis) or touch gestures, until within `tol` px of `y`. */
async function scrollTo(page: Page, y: number, touch: boolean, tol: number, what: string, maxStep = touch ? 500 : Infinity) {
  touch &&= !NO_TOUCH;
  const vw = await page.evaluate<number>("innerWidth");
  for (let i = 0; i < 80; i++) { // 80 (step H.2; was 40): the hero is seven screens now, and a wheel step can move a phone run under 200 px
    const at = await page.evaluate<number>("scrollY");
    const d = y - at;
    if (Math.abs(d) <= tol) return;
    if (touch) {
      const cdp = await page.context().newCDPSession(page);
      const move = Math.max(-maxStep, Math.min(maxStep, d));
      // yDistance is positive to scroll UP: the finger moves down the screen.
      await cdp.send("Input.synthesizeScrollGesture", { x: Math.round(vw / 2), y: move > 0 ? 700 : 150, yDistance: -move, gestureSourceType: "touch", speed: 1200, preventFling: true });
      await cdp.detach();
    } else {
      await page.mouse.wheel(0, Math.max(-maxStep, Math.min(maxStep, d)));
    }
    await settle(page, what);
  }
  throw new Error(`could not scroll to ${y} for ${what} (at ${await page.evaluate("scrollY")})`);
}

interface Pixels {
  data: Buffer;
  n: number;
  w: number;
  h: number;
}
const pixels = async (png: Buffer): Promise<Pixels> => {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, n: info.width * info.height, w: info.width, h: info.height };
};

/** The ground colour (--color-iron) and the share of the frame's outer ring (`ring` device pixels wide) that is NOT it. */
const IRON = [0x1c, 0x19, 0x16];
function ringOffGround(p: Pixels, ring: number): number {
  let off = 0;
  let total = 0;
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      if (x >= ring && x < p.w - ring && y >= ring && y < p.h - ring) {
        x = p.w - ring - 1; // jump across the middle of the row
        continue;
      }
      const i = 3 * (y * p.w + x);
      total++;
      if (Math.abs(p.data[i] - IRON[0]) + Math.abs(p.data[i + 1] - IRON[1]) + Math.abs(p.data[i + 2] - IRON[2]) > 40) off++;
    }
  }
  return off / total;
}

/** Pixels that are near-black (RGB sum under 30): the ground is 75, so these are an unpainted edge, not the scene. */
function blackPixels(p: Pixels): number {
  let n = 0;
  for (let i = 0; i < p.n; i++) if (p.data[3 * i] + p.data[3 * i + 1] + p.data[3 * i + 2] < 30) n++;
  return n;
}

/** Pixels inside the device-pixel box that look like the model (RGB sum over 300): ground, paper and grid are far under. */
function modelPixelsIn(p: Pixels, box: { x0: number; y0: number; x1: number; y1: number }): number {
  let n = 0;
  for (let y = Math.max(0, Math.floor(box.y0)); y < Math.min(p.h, Math.ceil(box.y1)); y++)
    for (let x = Math.max(0, Math.floor(box.x0)); x < Math.min(p.w, Math.ceil(box.x1)); x++) {
      const i = 3 * (y * p.w + x);
      if (p.data[i] + p.data[i + 1] + p.data[i + 2] > 300) n++;
    }
  return n;
}

/** Not blank: no one colour over 95% of the frame, and at least 3 colour bins with 0.5% each. Returns the numbers. */
function blankness(p: Pixels) {
  const bins = new Map<number, number>();
  for (let i = 0; i < p.n; i++) {
    const k = ((p.data[3 * i] >> 4) << 8) | ((p.data[3 * i + 1] >> 4) << 4) | (p.data[3 * i + 2] >> 4);
    bins.set(k, (bins.get(k) ?? 0) + 1);
  }
  const [top] = [...bins.entries()].sort((a, b) => b[1] - a[1]);
  const [r, g, b] = [((top[0] >> 8) << 4) + 8, (((top[0] >> 4) & 15) << 4) + 8, ((top[0] & 15) << 4) + 8];
  let near = 0;
  for (let i = 0; i < p.n; i++) if (Math.abs(p.data[3 * i] - r) + Math.abs(p.data[3 * i + 1] - g) + Math.abs(p.data[3 * i + 2] - b) <= 40) near++;
  const big = [...bins.values()].filter((c) => c >= p.n * 0.005).length;
  return { dominant: near / p.n, bins: big, blank: near / p.n > 0.95 || big < 3 };
}

/** The share of pixels whose RGB moved more than 60 (summed). */
function changed(a: Pixels, b: Pixels): number {
  assert.equal(a.n, b.n, "frames of one size");
  let n = 0;
  for (let i = 0; i < a.n; i++) if (Math.abs(a.data[3 * i] - b.data[3 * i]) + Math.abs(a.data[3 * i + 1] - b.data[3 * i + 1]) + Math.abs(a.data[3 * i + 2] - b.data[3 * i + 2]) > 60) n++;
  return n / a.n;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const noSideways = async (page: Page, width: number, what: string) => assert.ok((await page.evaluate<number>("document.documentElement.scrollWidth")) <= width, `${what}: the page is wider than ${width} px`);
const renders = (page: Page) => page.evaluate<number>(`Number(document.querySelector("${SCENE}").dataset.renders || 0)`);
const hideDevBadge = (page: Page) => page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

const HEADLINE = "From one drawing, a whole house";
async function headlineInFirstScreen(page: Page, tag: string) {
  assert.equal(await page.locator("h1").count(), 1, `${tag}: exactly one h1`);
  const said = await page.evaluate<number>(`document.body.textContent.split(${JSON.stringify(HEADLINE)}).length - 1`);
  assert.equal(said, 1, `${tag}: "${HEADLINE}" appears once in the page's text (got ${said})`);
  const h1 = page.locator("h1");
  assert.equal((await h1.innerText()).trim(), "From one drawing, a whole house", `${tag}: the headline`);
  const box = await h1.boundingBox();
  const vh = await page.evaluate<number>("innerHeight");
  assert.ok(box && box.y >= 0 && box.y + box.height <= vh, `${tag}: the headline is inside the first screen`);
}

// ------------------------------------------------------------------ the 3D scene

async function run3d(browser: Browser, width: number, height: number, touch: boolean) {
  const tag = `${width}`;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: touch ? 3 : 1, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  watchErrors(page, tag, errors);
  try {
    step(`${tag}: open the landing page`);
    await page.goto(`${BASE}/`);
    await hideDevBadge(page);
    await waitUntil(page, `${tag}: the scene never chose a mode`, `document.querySelector("${SCENE}").dataset.mode !== "pending"`);
    assert.equal(await page.getAttribute(SCENE, "data-mode"), "3d", `${tag}: WebGL and motion allowed, so the 3D scene`);
    await headlineInFirstScreen(page, tag);
    const heightBefore = await page.evaluate<number>("document.documentElement.scrollHeight");
    await waitUntil(page, `${tag}: the canvas never drew the sheet`, `document.querySelector("${SCENE}").dataset.ready === "true"`, 90_000);
    await waitUntil(page, `${tag}: the canvas never finished fading in`, `getComputedStyle(document.querySelector("[data-testid=blueprint-canvas]")).opacity === "1"`);
    assert.equal(await page.evaluate<number>("document.documentElement.scrollHeight"), heightBefore, `${tag}: loading the canvas did not change the page's height`);
    const loaded = await page.evaluate<string[]>("performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /three_build|react-three/.test(n))");
    assert.ok(loaded.length > 0, `${tag}: three.js and react-three-fiber were fetched (what the static runs check is absent; next/dynamic's 1 kB loader stub for BlueprintCanvas is fetched in every mode)`);
    const ratio = await page.evaluate<number>("(() => { const c = document.querySelector('[data-testid=blueprint-canvas] canvas'); return c.width / c.clientWidth; })()");
    if (touch) assert.ok(ratio <= 1.5 + 1e-6, `${tag}: the pixel ratio is capped at 1.5 on a touch device (got ${ratio})`);
    console.log(`  ${tag}: canvas pixel ratio ${ratio.toFixed(2)} (device ${touch ? 3 : 1})`);

    const g = await geometry(page);
    const tol = Math.round(g.span * 0.01);
    const frames: Record<number, Pixels> = {};
    for (const at of [0, 50, 100]) {
      step(`${tag}: ${at}% of the build`);
      await scrollTo(page, Math.round((g.span * g.buildEnd * at) / 100), touch, tol, `${at}%`);
      await settle(page, `${at}%`);
      const actual = (await page.evaluate<number>("scrollY")) / (g.span * g.buildEnd);
      const file = `${OUT}/landing-scene-${at}-${width}.png`;
      const png = await page.screenshot({ path: file });
      frames[at] = await pixels(png);
      const b = blankness(frames[at]);
      console.log(`  ${tag} ${at}% (actual ${pct(actual)}): dominant colour ${pct(b.dominant)}, ${b.bins} colours over 0.5%`);
      assert.ok(!b.blank, `${tag}: the ${at}% frame is blank (dominant ${pct(b.dominant)}, ${b.bins} colours)`);
      await noSideways(page, width, `${tag} ${at}%`);
      if (at === 50) {
        if (touch) copyFileSync(file, `${OUT}/landing-scene-390.png`);
        step(`${tag}: the canvas alone makes the picture`);
        await page.addStyleTag({ content: "svg[data-blueprint-sheet] { visibility: hidden !important; }" });
        const without = await pixels(await page.screenshot());
        const diff = changed(frames[50], without);
        console.log(`  ${tag}: hiding the DOM sheet changes ${pct(diff)} of pixels`);
        assert.ok(diff < 0.005, `${tag}: the canvas covers the DOM sheet (hiding it changed ${pct(diff)})`);
        await page.addStyleTag({ content: "svg[data-blueprint-sheet] { visibility: visible !important; }" });
        step(`${tag}: nothing renders while the page rests`);
        const r = await renders(page);
        await new Promise((done) => setTimeout(done, 600)); // proving nothing fires, not waiting for something
        assert.equal(await renders(page), r, `${tag}: frames were drawn while nothing changed`);
      }
    }
    const d50 = changed(frames[0], frames[50]);
    const d100 = changed(frames[0], frames[100]);
    console.log(`  ${tag}: 50% differs from 0% in ${pct(d50)} of pixels, 100% in ${pct(d100)}`);
    assert.ok(d50 >= 0.05, `${tag}: the 50% frame differs from 0% (${pct(d50)})`);
    assert.ok(d100 >= 0.15, `${tag}: the 100% frame differs from 0% (${pct(d100)})`);

    step(`${tag}: the hand-over`);
    const vh = await page.evaluate<number>("innerHeight");
    const tour = `document.querySelector("section[aria-label='A walk through the house']").getBoundingClientRect().top`;
    const stageOpacity = `Number(getComputedStyle(document.querySelector("[data-testid=blueprint-stage]")).opacity)`;
    await scrollTo(page, Math.round(g.span * (g.fadeStart + 1) / 2), touch, tol, "mid-fade");
    const mid = { tour: await page.evaluate<number>(tour), opacity: await page.evaluate<number>(stageOpacity) };
    console.log(`  ${tag} mid-fade: stage opacity ${mid.opacity.toFixed(2)}, tour top ${mid.tour.toFixed(0)} px`);
    assert.ok(mid.opacity > 0.05 && mid.opacity < 0.95, `${tag}: mid-fade the stage is part-transparent (${mid.opacity})`);
    assert.ok(mid.tour > 0 && mid.tour < vh * 0.3, `${tag}: mid-fade the tour is rising into place (${mid.tour})`);
    await scrollTo(page, g.span, touch, 2, "the end");
    const end = { tour: await page.evaluate<number>(tour), visibility: await page.evaluate<string>(`getComputedStyle(document.querySelector("[data-testid=blueprint-stage]")).visibility`) };
    assert.ok(Math.abs(end.tour) <= 2, `${tag}: at the end the tour stands at the top (${end.tour})`);
    assert.equal(end.visibility, "hidden", `${tag}: at the end the stage is hidden`);
    await page.screenshot({ path: `${OUT}/landing-scene-handover-${width}.png` });

    step(`${tag}: rendering stops once the scene has scrolled away`);
    await scrollTo(page, g.span + vh * 2, touch, tol, "past the scene");
    const r1 = await renders(page);
    await scrollTo(page, g.span + vh * 3, touch, tol, "further on");
    assert.equal(await renders(page), r1, `${tag}: frames were drawn after the scene had scrolled away`);
    await noSideways(page, width, `${tag} in the tour`);

    step(`${tag}: frame times through the scene`);
    await scrollTo(page, 0, touch, tol, "back to the top");
    await page.evaluate("window.__ft = []; window.__ftOn = true; (() => { let last = performance.now(); const loop = (t) => { window.__ft.push(t - last); last = t; if (window.__ftOn) requestAnimationFrame(loop); }; requestAnimationFrame(loop); })()");
    const before = await renders(page);
    for (let i = 1; i <= 8; i++) await scrollTo(page, Math.round((g.span * g.buildEnd * i) / 8), touch, tol, `timed ${i}/8`);
    const times = await page.evaluate<number[]>("(window.__ftOn = false, window.__ft.slice(1))");
    const s = [...times].sort((a, b) => a - b);
    const q = (f: number) => s[Math.min(s.length - 1, Math.floor(s.length * f))];
    console.log(`  ${tag} frame times over ${s.length} frames (${(await renders(page)) - before} scene renders): median ${q(0.5).toFixed(1)} ms, p95 ${q(0.95).toFixed(1)} ms, max ${s[s.length - 1].toFixed(1)} ms, over 50 ms: ${s.filter((t) => t > 50).length}`);
  } finally {
    await context.close();
  }
}

// ------------------------------------------------------------------ the static fallback

async function runStatic(browser: Browser, width: number, height: number, touch: boolean, why: "reduced" | "nowebgl") {
  const tag = `${width} ${why}`;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: touch ? 3 : 1, hasTouch: touch, isMobile: touch, reducedMotion: why === "reduced" ? "reduce" : "no-preference" });
  const page = await context.newPage();
  watchErrors(page, tag, errors);
  try {
    step(`${tag}: open the landing page`);
    await page.goto(`${BASE}/`);
    await hideDevBadge(page);
    await waitUntil(page, `${tag}: the scene never chose a mode`, `document.querySelector("${SCENE}").dataset.mode !== "pending"`);
    assert.equal(await page.getAttribute(SCENE, "data-mode"), "static", `${tag}: the static fallback`);
    // Without reduced motion the preloader covers the page until the scene has chosen; a screenshot waits for it to go (step L.2).
    await waitUntil(page, `${tag}: the preloader never went`, `!document.querySelector("${PRELOADER}")`);
    await headlineInFirstScreen(page, tag);
    const end = `getComputedStyle(document.querySelector("[data-testid=blueprint-end]")).opacity`;
    assert.equal(await page.evaluate<string>(end), "0", `${tag}: the end state is hidden at the top`);
    const first = await pixels(await page.screenshot());
    assert.ok(!blankness(first).blank, `${tag}: the sheet is not blank`);
    assert.equal(ringOffGround(first, touch ? 3 : 1), 0, `${tag}: the sheet reaches the edge of the viewport`);

    const g = await geometry(page);
    const tol = Math.round(g.span * 0.01);
    step(`${tag}: past the middle of the build, the end state`);
    await scrollTo(page, Math.round(g.span * g.buildEnd * 0.75), touch, tol, "past the middle");
    await waitUntil(page, `${tag}: the end state never showed`, `${end} === "1"`);
    const shot = await page.screenshot({ path: `${OUT}/landing-scene-${why}-${width}.png` });
    const second = await pixels(shot);
    assert.ok(!blankness(second).blank, `${tag}: the end state is not blank`);
    assert.equal(ringOffGround(second, touch ? 3 : 1), 0, `${tag}: the end-state drawing (model and sheet) reaches the edge of the viewport`);
    const d = changed(first, second);
    console.log(`  ${tag}: the end-state drawing differs from the sheet in ${pct(d)} of pixels`);
    assert.ok(d >= 0.15, `${tag}: the second step differs from the first (${pct(d)})`);
    await noSideways(page, width, tag);

    step(`${tag}: the hand-over`);
    await scrollTo(page, g.span, touch, 2, "the end");
    await waitUntil(page, `${tag}: the stage never handed over`, `getComputedStyle(document.querySelector("[data-testid=blueprint-stage]")).visibility === "hidden"`);
    assert.equal(await page.locator("canvas").count(), 0, `${tag}: no canvas at all`);
    const fetched = await page.evaluate<string[]>("performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /three_build|react-three/.test(n))");
    assert.deepEqual(fetched, [], `${tag}: three.js and react-three-fiber were never fetched`);
  } finally {
    await context.close();
  }
}

// ------------------------------------------------------------------ step L.2

const ONLY = process.env.E2E_ONLY ?? "";
const wants = (part: string) => !ONLY || ONLY.split(",").includes(part);
const TOUR = "section[aria-label='A walk through the house']";
const PRELOADER = "[data-testid=preloader]";

/** Polls a node-side condition; the message names what never happened. */
async function until(cond: () => boolean, what: string, ms = 15_000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`${what} (after ${ms / 1000} s)`);
    await new Promise((done) => setTimeout(done, 50));
  }
}

/** The whole sheet and the model are in view at nine positions of the build, and the headline's band is clear of the model. */
async function runFit(browser: Browser, width: number, height: number, touch: boolean) {
  const tag = `${width}x${height} fit`;
  const dpr = touch ? 3 : 1;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  watchErrors(page, tag, errors);
  try {
    step(`${tag}: open the landing page`);
    await page.goto(`${BASE}/`);
    await hideDevBadge(page);
    await waitUntil(page, `${tag}: the scene never chose a mode`, `document.querySelector("${SCENE}").dataset.mode !== "pending"`);
    assert.equal(await page.getAttribute(SCENE, "data-mode"), "3d", `${tag}: the 3D scene`);
    await headlineInFirstScreen(page, tag);
    await waitUntil(page, `${tag}: the canvas never drew the sheet`, `document.querySelector("${SCENE}").dataset.ready === "true"`, 90_000);
    await waitUntil(page, `${tag}: the canvas never finished fading in`, `getComputedStyle(document.querySelector("[data-testid=blueprint-canvas]")).opacity === "1"`);
    await waitUntil(page, `${tag}: the preloader never went`, `!document.querySelector("${PRELOADER}")`, 20_000);
    const g = await geometry(page);
    const tol = Math.round(g.span * 0.01);
    for (const at of [0, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100]) {
      step(`${tag}: ${at}% of the build`);
      await scrollTo(page, Math.round((g.span * g.buildEnd * at) / 100), touch, tol, `${at}%`);
      await settle(page, `${at}%`);
      const png = await page.screenshot();
      if (at === 0 || at === 100) writeFileSync(`${OUT}/landing-final-${at}-${width}.png`, png);
      const shot = await pixels(png);
      const off = ringOffGround(shot, dpr);
      const black = blackPixels(shot);
      assert.equal(black, 0, `${tag} ${at}%: ${black} near-black pixels (an unpainted edge round the sheet?)`);
      let band = 0;
      if (at >= 25) {
        // With the headline's text hidden, the model must not show in the band the headline occupies.
        const head = (await page.locator("[data-headline]").boundingBox())!;
        await page.evaluate(`document.querySelector("[data-headline]").style.visibility = "hidden"`);
        const bare = await pixels(await page.screenshot());
        await page.evaluate(`document.querySelector("[data-headline]").style.visibility = ""`);
        band = modelPixelsIn(bare, { x0: 0, y0: 0, x1: bare.w, y1: (head.y + head.height) * dpr });
      }
      console.log(`  ${tag} ${at}%: ${(off * 100).toFixed(3)}% of the outer ring is not ground${at >= 25 ? `, ${band} model pixels in the headline's band` : ""}`);
      assert.equal(off, 0, `${tag} ${at}%: the sheet or the model reaches the edge of the viewport (${(off * 100).toFixed(3)}% of the outer ring is not ground)`);
      assert.equal(band, 0, `${tag} ${at}%: ${band} model pixels sit under the headline`);
    }
  } finally {
    await context.close();
  }
}

/** In-page recorder: when the preloader was seen, when it was not any more, when the canvas was ready, layout shift. */
const RECORDER = `
  window.__pre = { seen: false, hiddenAt: null, readyAt: null, cls: 0, shown: 0, after: 0 };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__pre.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
  setInterval(() => {
    const p = window.__pre;
    const el = document.querySelector("[data-testid=preloader]");
    let vis = false;
    if (el) { const s = getComputedStyle(el); vis = s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0.05; }
    const h = document.documentElement.scrollHeight;
    if (vis) { p.seen = true; p.shown = h; }
    if (p.seen && !vis && p.hiddenAt === null) { p.hiddenAt = performance.now(); p.after = h; }
    const sc = document.querySelector("[data-testid=blueprint-scene]");
    if (sc && sc.dataset.ready === "true" && p.readyAt === null) p.readyAt = performance.now();
  }, 20);
`;
interface Rec {
  seen: boolean;
  hiddenAt: number | null;
  readyAt: number | null;
  cls: number;
  shown: number;
  after: number;
}

/** The preloader and the photos' loading, with a real scroll. */
async function runLoad(browser: Browser, width: number, height: number, touch: boolean) {
  const tag = `${width} load`;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: touch ? 3 : 1, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  watchErrors(page, tag, errors);
  await page.addInitScript({ content: RECORDER });
  const photos: string[] = [];
  page.on("request", (r) => {
    const m = /\/images\/(\d\d)_/.exec(r.url());
    if (m && !photos.includes(m[1])) photos.push(m[1]);
  });
  try {
    step(`${tag}: the preloader at the first paint`);
    await page.goto(`${BASE}/`, { waitUntil: "commit" });
    await page.waitForSelector(PRELOADER, { state: "visible", timeout: 10_000 });
    assert.match(await page.innerText(PRELOADER), /Atrium/, `${tag}: the preloader shows the wordmark`);
    await hideDevBadge(page);

    step(`${tag}: the preloader goes, by 3 s and soon after the canvas is ready`);
    await waitUntil(page, `${tag}: the canvas never drew the sheet`, `document.querySelector("${SCENE}").dataset.ready === "true"`, 90_000);
    await waitUntil(page, `${tag}: the preloader never went`, `window.__pre.hiddenAt !== null`, 20_000);
    const rec = await page.evaluate<Rec>("window.__pre");
    console.log(`  ${tag}: preloader gone at ${rec.hiddenAt!.toFixed(0)} ms, canvas ready at ${rec.readyAt!.toFixed(0)} ms, layout shift ${rec.cls.toFixed(4)}, page height ${rec.shown} → ${rec.after}`);
    assert.ok(rec.seen, `${tag}: the preloader was seen`);
    assert.ok(rec.hiddenAt! <= 3000, `${tag}: the preloader was gone by 3 s (${rec.hiddenAt!.toFixed(0)} ms)`);
    assert.ok(rec.hiddenAt! <= Math.min(3000, rec.readyAt! + 1000), `${tag}: the preloader stayed past the point the hero was ready (gone ${rec.hiddenAt!.toFixed(0)} ms, ready ${rec.readyAt!.toFixed(0)} ms)`);
    assert.ok(rec.cls < 0.01, `${tag}: layout shift ${rec.cls}`);
    assert.equal(rec.after, rec.shown, `${tag}: the page's height did not change when the preloader went`);
    await waitUntil(page, `${tag}: the preloader was never removed`, `!document.querySelector("${PRELOADER}")`);

    step(`${tag}: photos are not requested before the scroll is near them`);
    await page.waitForLoadState("networkidle");
    assert.deepEqual(photos, ["02"], `${tag}: at rest only the first photo (the lobby, since step H.2) is requested (got ${photos})`);
    const g = await geometry(page);
    const tol = Math.round(g.span * 0.01);
    const vh = await page.evaluate<number>("innerHeight");
    // In steps of 200 px: a wheel or swipe that is counted twice by a moving scroll can then only overshoot by that much.
    await scrollTo(page, Math.round(vh * 0.4), touch, tol, "a little way into the build", 200);
    await page.waitForLoadState("networkidle");
    assert.deepEqual(photos, ["02"], `${tag}: a little way into the build still only the first (got ${photos})`);
    // 400 px short of the tour's pin (its progress is still 0): the tour has been in view for half a screen, so the lobby, and no more
    await scrollTo(page, g.span - 400, touch, tol, "the tour's first screen", 200);
    await until(() => photos.includes("03"), `${tag}: the living room was never requested once the tour was near`);
    await page.waitForLoadState("networkidle");
    // Step H.3: by now the hero has passed its build, so the villa photograph (01, shown in the hero's reveal) is in too.
    assert.deepEqual([...photos].sort(), ["01", "02", "03"], `${tag}: before the tour's pin the villa and the tour's first two (got ${photos}, scrollY ${await page.evaluate("scrollY")} of pin at ${g.span})`);
    const spacer = await page.evaluate<number>(`(() => { const p = document.querySelector("${TOUR}").parentElement; if (!p.classList.contains("pin-spacer")) throw new Error("the tour is not pinned"); return p.offsetHeight - innerHeight; })()`);
    await scrollTo(page, g.span + Math.round(spacer * 0.14), touch, tol, "into the first room change", 200);
    await until(() => photos.includes("04"), `${tag}: the dining room was never requested once the scroll reached the living room`);
    await page.waitForLoadState("networkidle");
    assert.deepEqual([...photos].sort(), ["01", "02", "03", "04"], `${tag}: one room ahead of the scroll, no more (got ${photos})`);
    await scrollTo(page, g.span + Math.round(spacer * 0.875), touch, tol, "near the end of the tour", 600);
    await until(() => photos.length === 5, `${tag}: not every photo arrived by the end of the tour (got ${photos})`);
    console.log(`  ${tag}: photos requested in order: ${photos.join(", ")} (vh ${vh})`);
  } finally {
    await context.close();
  }
}

/** Reduced motion: the preloader is never visible. */
async function runLoadReduced(browser: Browser, width: number, height: number, touch: boolean) {
  const tag = `${width} reduced load`;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: touch ? 3 : 1, hasTouch: touch, isMobile: touch, reducedMotion: "reduce" });
  const page = await context.newPage();
  watchErrors(page, tag, errors);
  await page.addInitScript({ content: RECORDER });
  try {
    step(`${tag}: no preloader`);
    await page.goto(`${BASE}/`, { waitUntil: "commit" });
    await page.waitForSelector("h1", { state: "visible", timeout: 10_000 });
    await waitUntil(page, `${tag}: the scene never chose a mode`, `document.querySelector("${SCENE}").dataset.mode !== "pending"`);
    await waitUntil(page, `${tag}: the preloader element was never removed`, `!document.querySelector("${PRELOADER}")`);
    assert.equal((await page.evaluate<Rec>("window.__pre")).seen, false, `${tag}: the preloader was never visible`);
  } finally {
    await context.close();
  }
}

/** The 3D canvas's chunk is blocked: the page must still work, as the static scene. */
async function runFailed(browser: Browser) {
  const tag = "1440 canvas blocked";
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const own: string[] = []; // the failed load is expected to be logged; anything else is not
  watchErrors(page, tag, own);
  await page.addInitScript({ content: RECORDER });
  let blocked = 0;
  // The chunk names are readable in development and hashed in a production build, so a script is judged by what it holds:
  // three.js's renderer. The landing page's first-load scripts never contain it (that is step 8.1's rule).
  await page.route(/\/_next\/static\/.*\.js/, async (route) => {
    const res = await route.fetch();
    if (/WebGLRenderer/.test(await res.text())) {
      blocked++;
      return route.abort();
    }
    return route.fulfill({ response: res });
  });
  try {
    step(`${tag}: the page without its canvas`);
    await page.goto(`${BASE}/`, { waitUntil: "commit" });
    await page.waitForSelector(PRELOADER, { state: "visible", timeout: 10_000 });
    await waitUntil(page, `${tag}: the preloader never went`, `window.__pre.hiddenAt !== null`, 20_000);
    const rec = await page.evaluate<Rec>("window.__pre");
    assert.ok(blocked > 0, `${tag}: the route blocked nothing, so this test proved nothing`);
    assert.ok(rec.hiddenAt! <= 3000, `${tag}: the preloader was gone by 3 s (${rec.hiddenAt!.toFixed(0)} ms)`);
    await waitUntil(page, `${tag}: the scene never fell back to static`, `document.querySelector("${SCENE}").dataset.mode === "static"`, 20_000);
    assert.equal(await page.locator("canvas").count(), 0, `${tag}: no canvas`);
    await headlineInFirstScreen(page, tag);
    const g = await geometry(page);
    await scrollTo(page, Math.round(g.span * g.buildEnd * 0.75), false, Math.round(g.span * 0.01), "the page still scrolls");
    await waitUntil(page, `${tag}: the static end state never showed`, `getComputedStyle(document.querySelector("[data-testid=blueprint-end]")).opacity === "1"`);
    console.log(`  ${tag}: ${blocked} requests blocked, preloader gone at ${rec.hiddenAt!.toFixed(0)} ms; logged: ${own.length ? own.map((e) => e.slice(0, 90)).join(" | ") : "nothing"}`);
    for (const e of own) assert.match(e, /chunk|Failed to load|ERR_FAILED|net::|BlueprintCanvas|three/i, `${tag}: an unexpected error: ${e}`);
  } finally {
    await context.close();
  }
}

/** The tour: a crossfade on a phone, arches on a desktop; the photographs' caption readable. */
async function runTour(browser: Browser, width: number, height: number, touch: boolean) {
  const tag = `${width} tour`;
  const dpr = touch ? 3 : 1;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  watchErrors(page, tag, errors);
  try {
    step(`${tag}: open the landing page`);
    await page.goto(`${BASE}/`);
    await hideDevBadge(page);
    await waitUntil(page, `${tag}: the scene never chose a mode`, `document.querySelector("${SCENE}").dataset.mode !== "pending"`);
    const g = await geometry(page);
    const tol = Math.round(g.span * 0.01);
    await scrollTo(page, g.span, touch, 2, "the tour's first screen");
    await settle(page, "the tour's first screen");
    const png = await page.screenshot({ path: `${OUT}/landing-final-tour-${width}.png` });
    const shot = await pixels(png);
    await noSideways(page, width, tag);

    // Step H.2 removed Step inside (the hero's camera walks in now), so the overlap check with it went too.
    step(`${tag}: the photographs' caption`);
    assert.equal(await page.getByRole("button", { name: "Step inside" }).count(), 0, `${tag}: no Step inside button any more`);
    const note = page.locator("p", { hasText: "Illustrative photographs" });
    const nb = (await note.boundingBox())!;
    const vh = await page.evaluate<number>("innerHeight");
    assert.ok(nb.x >= 0 && nb.x + nb.width <= width && nb.y >= 0 && nb.y + nb.height <= vh, `${tag}: the caption is inside the screen (${JSON.stringify(nb)})`);
    const fontPx = await note.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    assert.ok(fontPx >= 12, `${tag}: the caption's text is ${fontPx}px`);
    // Contrast: the text colour (vellum) against the picture behind it, measured on this screenshot's pixels in the
    // caption's box: the background is the 75th percentile of the luminances under 0.7 (the text and its glow are above).
    const lum = (r: number, gr: number, b: number) => {
      const c = [r, gr, b].map((v) => ((v / 255) ** 2.2));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ls: number[] = [];
    for (let y = Math.floor(nb.y * dpr); y < Math.ceil((nb.y + nb.height) * dpr); y++)
      for (let x = Math.floor(nb.x * dpr); x < Math.ceil((nb.x + nb.width) * dpr); x++) {
        const i = 3 * (y * shot.w + x);
        const l = lum(shot.data[i], shot.data[i + 1], shot.data[i + 2]);
        if (l < 0.7) ls.push(l);
      }
    ls.sort((a, b) => a - b);
    const bg = ls[Math.floor(ls.length * 0.75)];
    const ratio = (lum(0xf4, 0xef, 0xe5) + 0.05) / (bg + 0.05);
    console.log(`  ${tag}: caption ${nb.width.toFixed(0)}x${nb.height.toFixed(0)} at y ${nb.y.toFixed(0)}, ${fontPx}px, contrast ${ratio.toFixed(1)}:1`);
    assert.ok(ratio >= 4.5, `${tag}: the caption's contrast is ${ratio.toFixed(2)}:1`);

    step(`${tag}: how the layers are made`);
    const layers = `[...document.querySelectorAll("[data-layer]")].map((l) => { const s = getComputedStyle(l); const p = getComputedStyle(l.querySelector("[data-photo]")); return { clip: s.clipPath, wc: s.willChange, pwc: p.willChange, vis: s.visibility, op: Number(s.opacity) }; })`;
    const at0 = await page.evaluate<{ clip: string; wc: string; pwc: string; vis: string; op: number }[]>(layers);
    if (width < 640) {
      // A crossfade: no clip-path, no photo scaling (the photos carry no will-change), and one promoted layer per room, for opacity only.
      // (Without will-change: opacity every fade repainted a 3x full-screen photo on the main thread: 5 to 11 frames over 50 ms.)
      for (const l of at0) assert.ok(l.clip === "none" && l.wc === "opacity" && l.pwc === "auto", `${tag}: a layer uses clip-path or a will-change other than opacity (${JSON.stringify(l)})`);
      assert.deepEqual(at0.slice(1).map((l) => l.vis), ["hidden", "hidden", "hidden"], `${tag}: the later rooms are hidden`);
    } else {
      assert.ok(at0.slice(1).every((l) => l.clip !== "none"), `${tag}: the arches are kept on a desktop`);
    }
    const spacer = await page.evaluate<number>(`document.querySelector("${TOUR}").parentElement.offsetHeight - innerHeight`);
    await scrollTo(page, g.span + Math.round(spacer * 0.375), touch, tol, "mid tour");
    await settle(page, "mid tour");
    if (width < 640) {
      const mid = await page.evaluate<{ vis: string }[]>(layers);
      const shown = mid.filter((l) => l.vis !== "hidden").length;
      assert.ok(shown <= 2, `${tag}: ${shown} layers are painted at once; a crossfade needs two at most`);
      console.log(`  ${tag}: ${shown} layers painted at the middle of the tour`);
    }
    await noSideways(page, width, `${tag} mid`);

    step(`${tag}: frame times through the tour`);
    await scrollTo(page, g.span, touch, 2, "back to the tour's start");
    await page.evaluate("window.__ft = []; window.__ftOn = true; (() => { let last = performance.now(); const loop = (t) => { window.__ft.push(t - last); last = t; if (window.__ftOn) requestAnimationFrame(loop); }; requestAnimationFrame(loop); })()");
    for (let i = 1; i <= 8; i++) await scrollTo(page, g.span + Math.round((spacer * i) / 8), touch, tol, `tour ${i}/8`);
    const times = await page.evaluate<number[]>("(window.__ftOn = false, window.__ft.slice(1))");
    const sorted = [...times].sort((a, b) => a - b);
    const q = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))];
    console.log(`  ${tag} frame times over ${sorted.length} frames: median ${q(0.5).toFixed(1)} ms, p95 ${q(0.95).toFixed(1)} ms, max ${sorted[sorted.length - 1].toFixed(1)} ms, over 50 ms: ${sorted.filter((t) => t > 50).length}`);
  } finally {
    await context.close();
  }
}

/** Step H.2: the story after the build, by pixels. The camera's path itself is proven in Node (test-landing-story.ts). */
async function runStory(browser: Browser, width: number, height: number, touch: boolean) {
  const tag = `${width} story`;
  const dpr = touch ? 3 : 1;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  watchErrors(page, tag, errors);
  try {
    step(`${tag}: open the landing page`);
    await page.goto(`${BASE}/`);
    await hideDevBadge(page);
    await waitUntil(page, `${tag}: the canvas never drew the sheet`, `document.querySelector("${SCENE}").dataset.ready === "true"`, 90_000);
    await waitUntil(page, `${tag}: the canvas never finished fading in`, `getComputedStyle(document.querySelector("[data-testid=blueprint-canvas]")).opacity === "1"`);
    await waitUntil(page, `${tag}: the preloader was never removed`, `!document.querySelector("${PRELOADER}")`);
    const g = await geometry(page);
    const tol = Math.round(g.span * 0.01);
    // Scroll shares from src/lib/landing/timeline.ts: the walls risen as lines, the settle, the tour, the front, the door, the wash.
    // Step H.3: the front view at 0.72, the sweep halfway at 0.785, the photograph pushing in at 0.86 (its label shows from 0.83 to 0.88), the wash at 0.955.
    const marks: [string, number][] = [["built", 0.22], ["scan", 0.32], ["tour", 0.52], ["front", 0.72], ["reveal", 0.785], ["photo", 0.86], ["wash", 0.955]];
    const frames: Pixels[] = [];
    for (const [name, at] of marks) {
      step(`${tag}: ${name}`);
      await scrollTo(page, Math.round(g.span * at), touch, tol, name, touch ? 500 : 1200);
      await settle(page, name);
      frames.push(await pixels(await page.screenshot({ path: `${OUT}/landing-story-${name}-${width}.png` })));
    }
    for (let i = 1; i < frames.length; i++) {
      const d = changed(frames[i - 1], frames[i]);
      console.log(`  ${tag}: ${marks[i][0]} differs from ${marks[i - 1][0]} in ${pct(d)} of pixels`);
      assert.ok(d >= 0.05, `${tag}: ${marks[i][0]} differs from ${marks[i - 1][0]} (${pct(d)})`);
    }
    // The finished house stands under the sky: the top rows of the tour frame are the light sunset sky (step H.3: a dome
    // from a warm band to a dusky blue overhead, every colour over 400 summed), not the dark ground (iron sums to 69).
    const tour = frames[2];
    let near = 0;
    const rows = Math.round(tour.h * 0.04);
    for (let i = 0; i < rows * tour.w; i++) if (tour.data[3 * i] + tour.data[3 * i + 1] + tour.data[3 * i + 2] > 400) near++;
    console.log(`  ${tag}: top ${rows} rows of the tour frame are sky in ${pct(near / (rows * tour.w))}`);
    assert.ok(near / (rows * tour.w) >= 0.9, `${tag}: the sky shows above the finished house (${pct(near / (rows * tour.w))})`);
    // While touring the headline has gone and the caption shows.
    await scrollTo(page, Math.round(g.span * 0.52), touch, tol, "tour again", touch ? 500 : 1200);
    await settle(page, "tour again");
    const ops = await page.evaluate<number[]>(`[document.querySelector("[data-headline]"), document.querySelector("[data-tour-caption]")].map((e) => Number(getComputedStyle(e).opacity))`);
    assert.ok(ops[0] < 0.05 && ops[1] > 0.95, `${tag}: while touring the headline is gone (${ops[0]}) and the caption shows (${ops[1]})`);
    // The villa photograph with its illustrative label, then the daylight wash: the vellum token over nearly the whole frame.
    await scrollTo(page, Math.round(g.span * 0.86), touch, tol, "photo again", touch ? 500 : 1200);
    await settle(page, "photo again");
    const villa = await page.evaluate<{ src: string; complete: boolean; label: number; text: string }>(`(() => { const i = document.querySelector("[data-villa-photo]"); const c = document.querySelector("[data-villa-caption]"); return { src: i.getAttribute("src"), complete: i.complete && i.naturalWidth > 1, label: Number(getComputedStyle(c).opacity), text: c.textContent }; })()`);
    assert.ok(villa.src.includes("01_mansion") && villa.complete, `${tag}: the villa photograph is loaded (${villa.src.slice(0, 40)})`);
    assert.ok(villa.label > 0.95 && /Illustrative photograph/.test(villa.text), `${tag}: the photograph carries its illustrative label (opacity ${villa.label})`);
    const vellum = [0xf4, 0xef, 0xe5];
    const wash = frames[frames.length - 1];
    let lit = 0;
    for (let i = 0; i < wash.n; i++) if (Math.abs(wash.data[3 * i] - vellum[0]) + Math.abs(wash.data[3 * i + 1] - vellum[1]) + Math.abs(wash.data[3 * i + 2] - vellum[2]) <= 40) lit++;
    assert.ok(lit / wash.n >= 0.9, `${tag}: the daylight wash covers the view at the threshold (${pct(lit / wash.n)})`);
    await noSideways(page, width, tag);
  } finally {
    await context.close();
  }
}

async function main() {
  await warmRoutes(["/"]);
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: GL_ARGS });
  try {
    if (wants("fit")) {
      await runFit(browser, 1440, 900, false);
      await runFit(browser, 1280, 720, false);
      await runFit(browser, 390, 844, true);
    }
    if (wants("scene")) {
      await run3d(browser, 1440, 900, false);
      await run3d(browser, 390, 844, true);
      await runStatic(browser, 1440, 900, false, "reduced");
      await runStatic(browser, 390, 844, true, "reduced");
    }
    if (wants("load")) {
      await runLoad(browser, 1440, 900, false);
      await runLoad(browser, 390, 844, true);
      await runLoadReduced(browser, 1440, 900, false);
      await runLoadReduced(browser, 390, 844, true);
    }
    if (wants("story")) {
      await runStory(browser, 1440, 900, false);
      await runStory(browser, 390, 844, true);
    }
    if (wants("failed")) await runFailed(browser);
    if (wants("tour")) {
      await runTour(browser, 1440, 900, false);
      await runTour(browser, 390, 844, true);
    }
  } finally {
    await browser.close();
  }
  if (wants("scene")) {
    const noGl = await chromium.launch({ executablePath: EXECUTABLE, args: ["--disable-webgl", "--disable-webgl2"] });
    try {
      await runStatic(noGl, 1440, 900, false, "nowebgl");
    } finally {
      await noGl.close();
    }
  }
  assert.deepEqual(errors, [], `console errors:\n${errors.join("\n")}`);
  console.log("e2e-landing: OK");
}

withSuiteTimeout("e2e-landing", 1_500_000, main).catch((e) => {
  console.error(e);
  process.exit(1);
});
