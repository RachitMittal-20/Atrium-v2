/**
 * test-import-cycles.ts — step M.1d: a dependency guard over src/.
 *
 * It follows three kinds of edge: a static `import`/`export … from`, a dynamic
 * `import("…")`, and `new Worker(new URL("…", import.meta.url))` — the last one
 * because U.1's 20-minute `next build` stall came through the PDF worker's own
 * bundle (edit.ts → format.ts → importFile.ts → pdf.worker → snap.ts → edit.ts),
 * and only a scanner that walks into a worker's entry file can see it. A cycle
 * fails the test with the path printed; so does any file under src/lib importing
 * src/app/studio/import/importFile.ts (the rule in CLAUDE.md, because that file
 * starts the analyse and PDF workers).
 *
 * Only paths inside the project resolve: bare package specifiers are edges to
 * nothing. Set CYCLE_ROOT to scan another copy of the tree (the failing-first run
 * uses a copy where parseTypedLength is imported back from importFile.ts).
 * Run: npx tsx scripts/test-import-cycles.ts
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(process.env.CYCLE_ROOT ?? join(__dirname, ".."));
const SRC = join(ROOT, "src");
const EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs"];
const BANNED = "src/app/studio/import/importFile.ts";

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? files(p) : EXT.some((x) => e.name.endsWith(x)) ? [p] : [];
  });
}

/** The file a specifier means, or null when it is a package (or isn't there). */
function resolveSpec(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const cand of [base, ...EXT.map((e) => base + e), ...EXT.map((e) => join(base, `index${e}`))]) {
    try {
      if (statSync(cand).isFile()) return cand;
    } catch {}
  }
  return null;
}

/** Every specifier `file` depends on: static imports, dynamic import(), and worker URLs. */
function specifiers(text: string): string[] {
  const out: string[] = [];
  const add = (re: RegExp) => {
    for (const m of text.matchAll(re)) out.push(m[1]);
  };
  // Anchored to the start of a line, so a path inside a header comment (" * …") is not an edge.
  add(/^\s*(?:import|export)\s[^;'"]*?from\s*["']([^"']+)["']/gm);
  add(/^\s*import\s+["']([^"']+)["']/gm);
  add(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g);
  add(/new\s+Worker\s*\(\s*new\s+URL\s*\(\s*["']([^"']+)["']/g);
  return out;
}

const all = files(SRC);
const graph = new Map<string, string[]>();
for (const f of all) {
  const text = readFileSync(f, "utf8");
  graph.set(f, [...new Set(specifiers(text).map((s) => resolveSpec(f, s)).filter((x): x is string => !!x && x.startsWith(SRC)))]);
}
const rel = (f: string) => relative(ROOT, f);
const edges = [...graph.values()].reduce((n, v) => n + v.length, 0);

// ---- cycles: depth-first, keeping the stack so the path can be printed.
const cycles: string[][] = [];
const state = new Map<string, 0 | 1 | 2>(); // 0 unseen, 1 on the stack, 2 done
const stack: string[] = [];
function walk(f: string) {
  state.set(f, 1);
  stack.push(f);
  for (const to of graph.get(f) ?? []) {
    if (state.get(to) === 1) cycles.push([...stack.slice(stack.indexOf(to)), to]);
    else if (!state.get(to)) walk(to);
  }
  stack.pop();
  state.set(f, 2);
}
for (const f of all) if (!state.get(f)) walk(f);

// ---- the importFile.ts rule.
const banned = join(ROOT, BANNED);
const offenders = [...graph].filter(([f, deps]) => f.startsWith(join(SRC, "lib")) && deps.includes(banned)).map(([f]) => rel(f));

for (const c of cycles) console.error(`cycle: ${c.map(rel).join("\n    -> ")}`);
for (const f of offenders) console.error(`${f} imports ${BANNED}; a module under src/lib must never start the workers (CLAUDE.md).`);
assert.equal(cycles.length, 0, `${cycles.length} import ${cycles.length === 1 ? "cycle" : "cycles"} in src/ (printed above)`);
assert.deepEqual(offenders, [], `${offenders.length} file(s) under src/lib import ${BANNED}`);
console.log(`import graph: ${all.length} files, ${edges} edges inside src/, no cycles, nothing under src/lib imports ${BANNED}`);
console.log("OK");
