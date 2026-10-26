/**
 * lighthouse-report.ts — step A.1: runs Lighthouse on a PRODUCTION build served locally and prints the median
 * performance, accessibility, best-practices and SEO scores per route and profile, with the top failing audits.
 * NOT in npm test (slow; needs `npm run build && npx next start -p 3100`, E2E_URL overrides). Uses Playwright's
 * Chromium through chrome-launcher, headless. These are headless desktop-Mac numbers on SwiftShader (CPU WebGL):
 * not a phone's, and Lighthouse's mobile profile only EMULATES a phone (throttling is simulated).
 *
 * Run: node scripts/lighthouse-report.ts [--runs 3] [--out /path/report.json] [--only /,/limits] [--bases before=http://localhost:3101,after=http://localhost:3100]
 * With --bases, every run alternates between the servers (route, profile, run, then each base in turn), so a busy machine
 * (a background update, another app) slows both alike: use it for before/after, because two sequential passes on a loaded
 * Mac differed by more than the changes did (step A.1).
 * (Plain node, not tsx: tsx's keepNames helper breaks the functions Lighthouse injects into the page.)
 * Output: a table on stdout and the raw medians + failing audits as JSON at --out (default /tmp/lighthouse.json).
 */
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";
import desktopConfig from "lighthouse/core/config/desktop-config.js";

const BASES = Object.fromEntries(
  (process.argv.includes("--bases") ? process.argv[process.argv.indexOf("--bases") + 1] : `run=${process.env.E2E_URL ?? "http://localhost:3100"}`).split(",").map((b) => b.split("=", 2) as [string, string]),
);
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const RUNS = Number(arg("runs", "3"));
const OUT = arg("out", "/tmp/lighthouse.json");
const ROUTES = arg("only", "/,/limits,/studio/import,/studio").split(",");
const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"] as const;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

interface Failing { id: string; title: string; score: number | null; display?: string; items: string[] }
interface Cell { scores: Record<string, number>; metrics: Record<string, number>; bytes: number; failing: Record<string, Failing[]> }

async function once(url: string, profile: "mobile" | "desktop") {
  // A fresh browser each run so no cache or service state carries over.
  const chrome = await launch({
    chromePath: chromium.executablePath(),
    chromeFlags: ["--headless=new", "--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  try {
    const r = await lighthouse(url, { port: chrome.port, output: "json", logLevel: "error", onlyCategories: [...CATEGORIES] }, profile === "desktop" ? desktopConfig : undefined);
    if (!r) throw new Error(`no result for ${url}`);
    return r.lhr;
  } finally {
    await chrome.kill();
  }
}

async function main() {
  const out: Record<string, Cell> = {};
  for (const profile of ["mobile", "desktop"] as const) {
    for (const route of ROUTES) {
      const runs: Record<string, Awaited<ReturnType<typeof once>>[]> = Object.fromEntries(Object.keys(BASES).map((k) => [k, []]));
      for (let i = 0; i < RUNS; i++) {
        for (const [label, base] of Object.entries(BASES)) {
          runs[label].push(await once(base + route, profile));
          console.log(`${profile} ${route} ${label} run ${i + 1}/${RUNS}: perf ${Math.round((runs[label][i].categories.performance.score ?? 0) * 100)}`);
        }
      }
      for (const [label, rs] of Object.entries(runs)) {
        const scores: Record<string, number> = {};
        for (const c of CATEGORIES) scores[c] = Math.round(100 * median(rs.map((r) => r.categories[c].score ?? 0)));
        const metrics: Record<string, number> = {};
        for (const m of ["first-contentful-paint", "largest-contentful-paint", "total-blocking-time", "cumulative-layout-shift", "speed-index", "interactive"]) {
          metrics[m] = median(rs.map((r) => r.audits[m]?.numericValue ?? 0));
        }
        const bytes = median(rs.map((r) => r.audits["total-byte-weight"]?.numericValue ?? 0));
        // Failing audits from the median-performance run, per category.
        const pick = rs.slice().sort((a, b) => (a.categories.performance.score ?? 0) - (b.categories.performance.score ?? 0))[Math.floor(rs.length / 2)];
        const failing: Record<string, Failing[]> = {};
        for (const c of CATEGORIES) {
          failing[c] = pick.categories[c].auditRefs
            .filter((ref) => ref.weight > 0 || c !== "performance")
            .map((ref) => pick.audits[ref.id])
            .filter((a) => a.score !== null && a.score < 0.9 && a.scoreDisplayMode !== "notApplicable" && a.scoreDisplayMode !== "manual")
            .map((a) => {
              const items = ((a.details as { items?: Array<{ node?: { selector?: string }; url?: string }> } | undefined)?.items ?? [])
                .slice(0, 5)
                .map((it) => it.node?.selector ?? it.url ?? "");
              return { id: a.id, title: a.title, score: a.score, display: a.displayValue, items: items.filter(Boolean) };
            })
            .sort((a, b) => (a.score ?? 1) - (b.score ?? 1))
            .slice(0, 6);
        }
        out[`${label} ${profile} ${route}`] = { scores, metrics, bytes, failing };
      }
    }
  }
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log("\n| build | profile | route | perf | a11y | best-practices | SEO | FCP ms | LCP ms | TBT ms | CLS | transfer kB |\n|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const [k, v] of Object.entries(out)) {
    const [l, p, r] = k.split(" ");
    const m = v.metrics;
    console.log(`| ${l} | ${p} | ${r} | ${v.scores.performance} | ${v.scores.accessibility} | ${v.scores["best-practices"]} | ${v.scores.seo} | ${Math.round(m["first-contentful-paint"])} | ${Math.round(m["largest-contentful-paint"])} | ${Math.round(m["total-blocking-time"])} | ${m["cumulative-layout-shift"].toFixed(3)} | ${Math.round(v.bytes / 1024)} |`);
  }
  console.log("\nTop failing audits (median run):");
  for (const [k, v] of Object.entries(out)) {
    for (const c of CATEGORIES) for (const f of v.failing[c]) console.log(`${k} [${c}] ${f.id} (${f.score}) ${f.display ?? ""} ${f.items.join(" | ")}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
