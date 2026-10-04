/**
 * import-report.ts — an ON-DEMAND report of how real 3D model files import (step
 * I.1b). NOT in npm test and not a pre-commit check: it needs the dev server
 * (npm run dev on port 3000; E2E_URL overrides) for the dev-only window.__importDebug,
 * and it reads whatever is in test-models/ (git-ignored: real files are often large
 * or licensed, so they are never committed).
 *
 * For each file or zip in test-models/ (a zip by its own name, "table.zip"; a .obj, .gltf and so on grouped with its .mtl,
 * .bin and textures by base name; images and .bin files with no model of their own go
 * with every OBJ and glTF; any other type is skipped, and said so) it drives the REAL
 * file input with Playwright in a fresh browser context (so models never pile up in one
 * plan), and reads the import dialog: the detected format, every unit with its size,
 * the guess, the ambiguous flag, the warnings, the stats and the parse time
 * (__importDebug.parseMs). It then imports the model, presses "Show in view", saves a
 * screenshot to /tmp/import-report/<name>.png and the object list to
 * /tmp/import-report/<name>.json, and prints one table row per file: format, MB,
 * triangles, objects, parse ms, ms per MB, chosen unit, ambiguous, warnings.
 *
 * It never crashes on a bad file: a refusal prints its plain message. A per-file 30 s
 * watchdog asks the page for a heartbeat every 2 s; when the page stops answering it
 * reports "page unresponsive" and carries on in a new browser. A synchronous freeze (a
 * loader looping on the main thread) cannot be interrupted from outside the page: the
 * watchdog can only notice it, abandon that browser and move on.
 * Run: npx tsx scripts/import-report.ts
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, parse } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const DIR = join(process.cwd(), "test-models");
const OUT = "/tmp/import-report";
const WATCHDOG_MS = 30_000;
const HEARTBEAT_MS = 2_000;
const MODEL = new Set([".glb", ".gltf", ".obj", ".fbx", ".dae", ".stl", ".3ds", ".skp", ".max"]); // .skp/.max: to show their message
const COMPANION = new Set([".mtl", ".bin", ".png", ".jpg", ".jpeg", ".webp"]);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Entry {
  name: string;
  files: string[];
}

/** The files of test-models/ as import entries: a zip alone, a model with its companions by base name. */
function entries(): { list: Entry[]; skipped: string[] } {
  const all = readdirSync(DIR).filter((f) => !f.startsWith(".") && statSync(join(DIR, f)).isFile());
  const byBase = new Map<string, string[]>();
  const list: Entry[] = [];
  const skipped: string[] = [];
  for (const f of all) {
    const ext = extname(f).toLowerCase();
    if (ext === ".zip") list.push({ name: f, files: [join(DIR, f)] }); // "table.zip": never the same name as a "table" model
    else if (MODEL.has(ext) || COMPANION.has(ext)) byBase.set(parse(f).name.toLowerCase(), [...(byBase.get(parse(f).name.toLowerCase()) ?? []), f]);
    else skipped.push(`${f} (unknown type)`);
  }
  const orphans: string[] = [];
  for (const [base, files] of byBase) {
    const models = files.filter((f) => MODEL.has(extname(f).toLowerCase()));
    if (models.length === 0) orphans.push(...files);
    else for (const m of models) list.push({ name: base + (models.length > 1 ? extname(m) : ""), files: [m, ...files.filter((f) => !MODEL.has(extname(f).toLowerCase()))].map((f) => join(DIR, f)) });
  }
  // shared textures and buffers (wood.png beside chair.obj): every OBJ and glTF gets them
  for (const e of list) if (/\.(obj|gltf)$/i.test(e.files[0])) e.files.push(...orphans.map((f) => join(DIR, f)));
  if (orphans.length && !list.some((e) => /\.(obj|gltf)$/i.test(e.files[0]))) skipped.push(...orphans.map((f) => `${f} (no model to go with)`));
  return { list: list.sort((a, b) => a.name.localeCompare(b.name)), skipped };
}

interface Row {
  name: string;
  format: string;
  mb: number;
  triangles: string;
  objects: string;
  parseMs: number | null;
  unit: string;
  ambiguous: boolean | null;
  warnings: string[];
  note: string;
}

/** Run `work` under the watchdog: 30 s at most, and a heartbeat from the page every 2 s. */
async function watched<T>(page: Page, work: () => Promise<T>): Promise<{ value?: T; problem?: string; longestGapMs: number }> {
  let last = Date.now();
  let longest = 0;
  let done = false;
  const beat = (async () => {
    while (!done) {
      const t = Date.now();
      const alive = await Promise.race([page.evaluate(() => true).catch(() => false), sleep(HEARTBEAT_MS * 2).then(() => false)]);
      if (alive) {
        longest = Math.max(longest, Date.now() - last);
        last = Date.now();
      }
      await sleep(Math.max(0, HEARTBEAT_MS - (Date.now() - t)));
    }
  })();
  const result = await Promise.race([
    work().then((value) => ({ value }), (e: Error) => ({ problem: `error: ${e.message.split("\n")[0]}` })),
    sleep(WATCHDOG_MS).then(() => ({ problem: Date.now() - last > HEARTBEAT_MS * 2 ? `page unresponsive (no heartbeat for ${((Date.now() - last) / 1000).toFixed(0)} s)` : "timed out after 30 s (the page still answers)" })),
  ]);
  done = true;
  void beat;
  return { ...result, longestGapMs: Math.max(longest, Date.now() - last) } as { value?: T; problem?: string; longestGapMs: number };
}

async function reportOne(browser: Browser, e: Entry): Promise<{ row: Row; frozen: boolean }> {
  const mb = e.files.reduce((n, f) => n + statSync(f).size, 0) / 1024 / 1024;
  const row: Row = { name: e.name, format: "–", mb, triangles: "–", objects: "–", parseMs: null, unit: "–", ambiguous: null, warnings: [], note: "" };
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const tid = (id: string) => page.getByTestId(id);
  const run = await watched(page, async () => {
    await page.goto(`${BASE}/studio`);
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.waitForSelector("canvas");
    await page.waitForFunction(() => !!(window as unknown as { __importDebug?: unknown }).__importDebug); // the dev hook mounts with the 3D view
    await tid("import-model-input").setInputFiles(e.files); // the real file input
    await page.waitForSelector('[data-testid="import-dialog"][data-kind="review"], [data-testid="import-dialog"][data-kind="message"]', { timeout: WATCHDOG_MS });
    row.parseMs = await page.evaluate(() => (window as unknown as { __importDebug?: { parseMs(): number | null } }).__importDebug?.parseMs() ?? null);
    if ((await tid("import-dialog").getAttribute("data-kind")) === "message") {
      row.note = `refused: ${(await tid("import-message").innerText()).trim()}`;
      return;
    }
    const stats = Object.fromEntries(
      await page.locator('[data-testid="import-stats"] > div').evaluateAll((divs) => divs.map((d) => [d.querySelector("dt")?.textContent?.trim() ?? "", d.querySelector("dd")?.textContent?.trim() ?? ""])),
    ) as Record<string, string>;
    row.format = stats.Format ?? "–";
    row.triangles = stats.Triangles ?? "–";
    row.objects = stats.Objects ?? "–";
    const units = await page.locator('[data-testid="import-units"] label').evaluateAll((ls) =>
      ls.map((l) => ({ unit: (l.querySelector("input") as HTMLInputElement).value, checked: (l.querySelector("input") as HTMLInputElement).checked, label: l.querySelector("span > span")?.textContent?.trim() ?? "", size: l.querySelector('[data-testid^="import-size-"]')?.textContent?.trim() ?? "" })),
    );
    row.unit = units.find((u) => u.checked)?.unit ?? "–";
    row.ambiguous = (await tid("import-ambiguous").count()) > 0;
    row.warnings = (await tid("import-warnings").count()) > 0 ? (await tid("import-warnings").locator("li").allInnerTexts()).map((w) => w.trim()) : [];
    await tid("import-confirm").click();
    await page.waitForSelector('[data-testid="import-dialog"][data-kind="closed"]', { state: "attached", timeout: WATCHDOG_MS });
    await tid("item-show").click();
    await page.waitForTimeout(1200); // the glide, and textures arriving
    await page.mouse.move(2, 450);
    await page.screenshot({ path: join(OUT, `${e.name}.png`) });
    const objects = await page.locator('[data-testid^="object-row-"]').evaluateAll((rows) =>
      rows.map((r) => ({ path: r.getAttribute("data-testid")!.replace("object-row-", ""), name: r.querySelector('[data-testid^="object-name-"]')?.textContent?.trim() ?? "", hidden: r.getAttribute("data-hidden") === "true" })),
    );
    const more = await page.getByText(/more rows not shown/).count();
    writeFileSync(join(OUT, `${e.name}.json`), JSON.stringify({ files: e.files.map((f) => parse(f).base), stats, units, ambiguous: row.ambiguous, warnings: row.warnings, parseMs: row.parseMs, objects, truncated: more > 0, note: "the object list as the panel shows it: deeper groups start folded, at most 400 rows" }, null, 2));
  });
  if (run.problem) row.note = run.problem;
  if (run.longestGapMs > 4 * HEARTBEAT_MS) row.note += `${row.note ? "; " : ""}the page did not answer for ${(run.longestGapMs / 1000).toFixed(1)} s at most`;
  const frozen = !!run.problem?.startsWith("page unresponsive");
  if (!frozen) await Promise.race([context.close(), sleep(5000)]);
  return { row, frozen };
}

const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
const lpad = (s: string, n: number) => s.padStart(n);

async function main() {
  if (!existsSync(DIR)) {
    console.log(`No test-models/ folder. Put real model files (or zips) in ${DIR} and run again.`);
    return;
  }
  const page = await fetch(`${BASE}/studio`).catch(() => null);
  if (!page?.ok) throw new Error(`The dev server is not answering at ${BASE} (run npm run dev).`);
  mkdirSync(OUT, { recursive: true });
  const { list, skipped } = entries();
  for (const s of skipped) console.log(`skipped: ${s}`);
  console.log(`${list.length} model(s) in test-models/; screenshots and object lists go to ${OUT}/\n`);
  const launch = () => chromium.launch({ executablePath: process.env.E2E_CHROMIUM || undefined, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  let browser = await launch();
  const head = `${pad("file", 26)} ${pad("format", 14)} ${lpad("MB", 7)} ${lpad("triangles", 11)} ${lpad("objects", 8)} ${lpad("parse ms", 9)} ${lpad("ms/MB", 7)} ${pad("unit", 5)} ${pad("ambig.", 6)} warnings`;
  console.log(head);
  console.log("-".repeat(head.length + 10));
  for (const e of list) {
    const { row, frozen } = await reportOne(browser, e);
    const perMb = row.parseMs !== null && row.mb >= 0.1 ? (row.parseMs / row.mb).toFixed(0) : "–"; // under 0.1 MB the fixed cost swamps it
    console.log(
      `${pad(row.name, 26)} ${pad(row.format, 14)} ${lpad(row.mb.toFixed(3), 7)} ${lpad(row.triangles, 11)} ${lpad(row.objects, 8)} ${lpad(row.parseMs === null ? "–" : row.parseMs.toFixed(0), 9)} ${lpad(perMb, 7)} ${pad(row.unit, 5)} ${pad(row.ambiguous === null ? "–" : row.ambiguous ? "yes" : "no", 6)} ${row.warnings.length ? row.warnings.join(" | ") : "none"}${row.note ? `   [${row.note}]` : ""}`,
    );
    if (frozen) {
      // the tab is stuck in a synchronous loop: nothing in it can be stopped, so leave the whole browser behind
      await Promise.race([browser.close(), sleep(5000)]);
      browser = await launch();
    }
  }
  await Promise.race([browser.close(), sleep(5000)]);
  console.log("\nA synchronous freeze (a loader looping on the main thread) cannot be interrupted from outside the page: the watchdog only notices it, reports \"page unresponsive\" and moves on in a fresh browser.");
}

main().then(
  () => process.exit(0), // a browser left behind by a frozen tab must not keep the report running
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
