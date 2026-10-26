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
 * Screenshots in /tmp/studio/: landing-scene-{0,50,100}-1440.png, landing-scene-390.png (the 50% frame) and
 * landing-scene-{0,100}-390.png, landing-scene-reduced-{1440,390}.png, landing-scene-nowebgl-1440.png.
 * Run: npx tsx scripts/e2e-landing.ts
 */
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync } from "node:fs";
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

/** Scrolls with the real device: mouse wheel (Lenis) or touch gestures, until within `tol` px of `y`. */
async function scrollTo(page: Page, y: number, touch: boolean, tol: number, what: string) {
  const vw = await page.evaluate<number>("innerWidth");
  for (let i = 0; i < 40; i++) {
    const at = await page.evaluate<number>("scrollY");
    const d = y - at;
    if (Math.abs(d) <= tol) return;
    if (touch) {
      const cdp = await page.context().newCDPSession(page);
      const move = Math.max(-500, Math.min(500, d));
      // yDistance is positive to scroll UP: the finger moves down the screen.
      await cdp.send("Input.synthesizeScrollGesture", { x: Math.round(vw / 2), y: move > 0 ? 700 : 150, yDistance: -move, gestureSourceType: "touch", speed: 1200, preventFling: true });
      await cdp.detach();
    } else {
      await page.mouse.wheel(0, d);
    }
    await settle(page, what);
  }
  throw new Error(`could not scroll to ${y} for ${what} (at ${await page.evaluate("scrollY")})`);
}

interface Pixels {
  data: Buffer;
  n: number;
}
const pixels = async (png: Buffer): Promise<Pixels> => {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, n: info.width * info.height };
};

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

async function headlineInFirstScreen(page: Page, tag: string) {
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
    await headlineInFirstScreen(page, tag);
    const end = `getComputedStyle(document.querySelector("[data-testid=blueprint-end]")).opacity`;
    assert.equal(await page.evaluate<string>(end), "0", `${tag}: the end state is hidden at the top`);
    const first = await pixels(await page.screenshot());
    assert.ok(!blankness(first).blank, `${tag}: the sheet is not blank`);

    const g = await geometry(page);
    const tol = Math.round(g.span * 0.01);
    step(`${tag}: past the middle of the build, the end state`);
    await scrollTo(page, Math.round(g.span * g.buildEnd * 0.75), touch, tol, "past the middle");
    await waitUntil(page, `${tag}: the end state never showed`, `${end} === "1"`);
    const shot = await page.screenshot({ path: `${OUT}/landing-scene-${why}-${width}.png` });
    const second = await pixels(shot);
    assert.ok(!blankness(second).blank, `${tag}: the end state is not blank`);
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

async function main() {
  await warmRoutes(["/"]);
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: GL_ARGS });
  try {
    await run3d(browser, 1440, 900, false);
    await run3d(browser, 390, 844, true);
    await runStatic(browser, 1440, 900, false, "reduced");
    await runStatic(browser, 390, 844, true, "reduced");
  } finally {
    await browser.close();
  }
  const noGl = await chromium.launch({ executablePath: EXECUTABLE, args: ["--disable-webgl", "--disable-webgl2"] });
  try {
    await runStatic(noGl, 1440, 900, false, "nowebgl");
  } finally {
    await noGl.close();
  }
  assert.deepEqual(errors, [], `console errors:\n${errors.join("\n")}`);
  console.log("e2e-landing: OK");
}

withSuiteTimeout("e2e-landing", 600_000, main).catch((e) => {
  console.error(e);
  process.exit(1);
});
