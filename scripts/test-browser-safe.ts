/**
 * test-browser-safe.ts — checks that src/lib/blueprint/analyse.ts can run in a
 * browser: walks its import graph (static imports, `export ... from` and
 * dynamic `import()`, type-only ones included) through the project's own
 * files, and fails on any import of sharp, fs, path, child_process or a node:
 * specifier. Other packages (tesseract.js) are not walked into. Prints every
 * project file visited.
 * Run: npx tsx scripts/test-browser-safe.ts
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const BANNED = /^(?:node:.*|sharp|fs|path|child_process)(?:\/.*)?$/;
const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;

/** The project file a specifier points at, or null for a package. */
function resolve(spec: string, from: string): string | null {
  const base = spec.startsWith("@/") ? path.join(ROOT, "src", spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;
  const hit = ["", ".ts", ".tsx", "/index.ts"].map((ext) => base + ext).find((f) => existsSync(f) && statSync(f).isFile());
  assert.ok(hit, `${path.relative(ROOT, from)}: cannot resolve "${spec}"`);
  return hit;
}

const start = path.join(ROOT, "src/lib/blueprint/analyse.ts");
const seen = new Set<string>([start]);
const bad: string[] = [];
for (const file of seen) {
  for (const [, spec] of readFileSync(file, "utf8").matchAll(SPEC)) {
    if (BANNED.test(spec)) bad.push(`${path.relative(ROOT, file)} imports "${spec}"`);
    const next = resolve(spec, file);
    if (next) seen.add(next); // a Set iterates items added during the loop
  }
}
console.log(`visited ${seen.size} files:\n  ${[...seen].map((f) => path.relative(ROOT, f)).join("\n  ")}`);
assert.deepEqual(bad, [], `not browser-safe:\n  ${bad.join("\n  ")}`);
console.log("OK");
