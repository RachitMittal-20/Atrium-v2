/**
 * test-ocr-assets.ts — step O.1's guard that OCR is fully self-hosted ("works offline" depends on it).
 *   1. No http(s) URL to a CDN host (jsdelivr, unpkg, cdnjs, googleapis static, projectnaptha) in src/.
 *   2. No tesseract path in src/ outside /tesseract/ (no workerPath/corePath/langPath other than ocrAssets.ts's).
 *   3. next.config.ts wires the loader that blanks tesseract.js's bundled CDN default.
 *   4. src/lib/blueprint/ocr.ts passes ocrOptions() to createWorker, and every file ocrAssets.ts
 *      can ask for exists in public/tesseract/ and is listed in its LICENSES.md.
 * FAILING FIRST: OCR_ROOT=/path/to/checkout-before-O.1 lists the CDN default (tesseract.js's, which
 * is what the old createWorker("eng") used) as missing config; against this tree it passes.
 * Run: npx tsx scripts/test-ocr-assets.ts
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.env.OCR_ROOT ?? join(__dirname, "..");
const CDN = /https?:\/\/[^\s"'`)]*(?:jsdelivr|unpkg|cdnjs|googleapis|gstatic|projectnaptha)[^\s"'`)]*/gi;
const TESS_PATH = /\b(?:workerPath|corePath|langPath)\b\s*[:=]\s*(["'`])([^"'`]*)\1/g;

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const f = join(dir, name);
    if (statSync(f).isDirectory()) yield* files(f);
    else if (/\.(tsx?|css|html|json|mjs)$/.test(name)) yield f;
  }
}

const problems: string[] = [];
for (const f of files(join(ROOT, "src"))) {
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    const where = `${relative(ROOT, f)}:${i + 1}`;
    for (const m of line.matchAll(CDN)) problems.push(`${where}: CDN URL ${m[0]}`);
    for (const m of line.matchAll(TESS_PATH)) if (!m[2].startsWith("/tesseract")) problems.push(`${where}: tesseract path ${m[2]} is not under /tesseract/`);
  });
}

// The config: ocr.ts must pass its options (tesseract.js's own default is a CDN).
const ocr = readFileSync(join(ROOT, "src/lib/blueprint/ocr.ts"), "utf8");
if (!/createWorker\([^)]*ocrOptions\(\)/.test(ocr)) problems.push("src/lib/blueprint/ocr.ts: createWorker is not given ocrOptions(), so tesseract.js falls back to its CDN default");

// Every file the config points to exists in public/tesseract/ and has a licence line.
const assets = join(ROOT, "src/lib/blueprint/ocrAssets.ts");
if (!existsSync(assets)) problems.push("src/lib/blueprint/ocrAssets.ts is missing (no self-hosted config)");
else {
  const src = readFileSync(assets, "utf8");
  const listed = [...src.slice(src.indexOf("OCR_FILES")).matchAll(/:\s*"([^"]+\.(?:js|gz))"/g)].map((m) => m[1]);
  if (listed.length < 4) problems.push(`ocrAssets.ts lists ${listed.length} files, expected the worker, two cores and the language data`);
  const licences = existsSync(join(ROOT, "public/tesseract/LICENSES.md")) ? readFileSync(join(ROOT, "public/tesseract/LICENSES.md"), "utf8") : "";
  if (!licences) problems.push("public/tesseract/LICENSES.md is missing");
  for (const file of listed) {
    if (!existsSync(join(ROOT, "public/tesseract", file))) problems.push(`public/tesseract/${file} is missing`);
    if (licences && !licences.includes(file)) problems.push(`public/tesseract/LICENSES.md does not mention ${file}`);
  }
  if (!/OCR_DIR\s*=\s*"\/tesseract"/.test(src)) problems.push('ocrAssets.ts: OCR_DIR is not "/tesseract"');
}

// tesseract.js's own CDN default must not reach the bundle: next.config.ts blanks it with a loader.
const cfg = readFileSync(join(ROOT, "next.config.ts"), "utf8");
if (!cfg.includes("tesseract-default-options-loader.cjs") || !existsSync(join(ROOT, "scripts/tesseract-default-options-loader.cjs")))
  problems.push("next.config.ts does not wire scripts/tesseract-default-options-loader.cjs, so tesseract.js's CDN default stays in the bundle");

assert.deepEqual(problems, [], `OCR is not self-hosted:\n  ${problems.join("\n  ")}`);
console.log("ocr assets: no CDN URL in src/, every tesseract path under /tesseract/, every file present with a licence — ok");
