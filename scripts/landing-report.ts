/**
 * landing-report.ts — step L.2: what the landing page loads before the first scroll, and how it paints. On-demand,
 * NOT in npm test: it wants a PRODUCTION server (`npm run build && npx next start -p 3100`, E2E_URL=http://localhost:3100),
 * because a dev server's numbers say nothing about a deployed page. Reads no dev hook.
 * Per viewport (1440x900 and 390x844 with touch): every image request (name, bytes on the wire from CDP), the JS
 * bytes, Largest Contentful Paint and Cumulative Layout Shift (PerformanceObserver, read after the page has been
 * idle for 2 s). Headless Chromium on SwiftShader on this Mac: these are NOT a phone's numbers.
 * Run: E2E_URL=http://localhost:3100 npx tsx scripts/landing-report.ts
 */
import { chromium } from "playwright";
import { BASE } from "./e2e-helpers";

const GL_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const OBSERVE = `
  window.__lcp = 0; window.__cls = 0; window.__lcpEl = ""; window.__fcp = 0;
  new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__lcp = e.startTime; window.__lcpEl = (e.element ? e.element.tagName.toLowerCase() + (e.element.dataset && Object.keys(e.element.dataset).length ? "[data-" + Object.keys(e.element.dataset)[0] + "]" : "") + " " + (e.url || (e.element.textContent || "").slice(0, 24)) : "?") + " (" + Math.round(e.size) + " px²)"; } }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__fcp = e.startTime; }).observe({ type: "paint", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true });
`;

async function main() {
  const browser = await chromium.launch({ args: GL_ARGS });
  // A throwaway page first: the browser's own start-up (GPU process, SwiftShader) would otherwise land on the 1440 run's FCP.
  const warm = await (await browser.newContext()).newPage();
  await warm.goto(`${BASE}/limits`, { waitUntil: "networkidle" });
  await warm.context().close();
  for (const [width, height, touch] of [[1440, 900, false], [390, 844, true]] as const) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: touch ? 3 : 1, hasTouch: touch, isMobile: touch });
    const page = await context.newPage();
    await page.addInitScript({ content: OBSERVE });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    const urls = new Map<string, string>();
    const files: { url: string; bytes: number; type: string }[] = [];
    cdp.on("Network.requestWillBeSent", (e) => urls.set(e.requestId, e.request.url));
    cdp.on("Network.loadingFinished", (e) => {
      const url = urls.get(e.requestId) ?? "?";
      files.push({ url, bytes: e.encodedDataLength, type: /\.(jpe?g|png|webp|avif)(\?|$)|\/_next\/image/.test(url) ? "image" : /\.js(\?|$)/.test(url) ? "js" : "other" });
    });
    await page.goto(`${BASE}/`, { waitUntil: "load" });
    await page.waitForLoadState("networkidle");
    await page.waitForFunction("document.querySelector('[data-testid=blueprint-scene]').dataset.mode !== 'pending'");
    await new Promise((done) => setTimeout(done, 2000)); // LCP and layout shifts settle; this is a measurement window, not a wait for a condition
    const { lcp, cls, el, fcp } = await page.evaluate<{ lcp: number; cls: number; el: string; fcp: number }>("({ lcp: window.__lcp, cls: window.__cls, el: window.__lcpEl, fcp: window.__fcp })");
    const images = files.filter((f) => f.type === "image");
    const js = files.filter((f) => f.type === "js");
    console.log(`\n== ${width}x${height}${touch ? " touch" : ""} ==`);
    console.log(`LCP ${lcp.toFixed(0)} ms (${el}), FCP ${fcp.toFixed(0)} ms, CLS ${cls.toFixed(4)}`);
    console.log(`images before first scroll: ${images.length}, ${(images.reduce((s, f) => s + f.bytes, 0) / 1024).toFixed(0)} kB`);
    for (const f of images) console.log(`  ${f.url.replace(BASE, "")}  ${(f.bytes / 1024).toFixed(0)} kB`);
    console.log(`js before first scroll: ${js.length} files, ${(js.reduce((s, f) => s + f.bytes, 0) / 1024).toFixed(0)} kB on the wire`);
    await context.close();
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
