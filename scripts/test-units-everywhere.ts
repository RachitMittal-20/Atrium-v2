/**
 * test-units-everywhere.ts — step U.1's guard: no length or area text is hard-coded in the
 * studio. Every length and area shown follows the one units setting (src/store/unitsStore.ts)
 * through src/lib/units/format.ts, so this scans src/components, src/app and src/lib/plan2d
 * for unit text written into the source:
 *   - an expression followed by a unit, in a template or in JSX: `${x} m`, `${n.toFixed(2)} mm`, `{a} m²`;
 *   - a number followed by a unit in a string or in JSX text: "0.9 m", 4000 mm, 5 cm;
 *   - the area signs m², m2 (as text), mm² and "sq ft", anywhere in a string.
 * Comment lines are skipped, as is src/lib/units (the one place the units live). A hit is
 * allowed only when scripts/units-allowlist.json has an entry for that file whose `match` is
 * a substring of the line, with a `reason`; an entry that matches no line is stale and fails
 * too, so the list can't rot. FAILING FIRST: run against the tree as it was before step U.1
 * (UNITS_ROOT=/path/to/old/checkout) it lists the offenders; against the fixed tree it passes.
 * Run: npx tsx scripts/test-units-everywhere.ts
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.env.UNITS_ROOT ?? join(__dirname, "..");
const DIRS = ["src/components", "src/app", "src/lib/plan2d"];
const PATTERNS: [string, RegExp][] = [
  ["an expression then a unit", /\}\s?(?:mm|cm|m|ft|m²|mm²|sq ?ft)(?![A-Za-z0-9_²])/],
  ["number then a unit", new RegExp(`(?<![A-Za-z0-9_.#-])\\d+(?:\\.\\d+)?\\s?(?:mm|cm|m|ft)(?![A-Za-z0-9_²])`)],
  ["an area unit in text", /m²|mm²|sq ?ft|\\u00b2/],
];

interface Allowed {
  file: string;
  match: string;
  reason: string;
}
const allow: Allowed[] = JSON.parse(readFileSync(join(__dirname, "units-allowlist.json"), "utf8"));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

// Source lines with comments blanked: whole-line // and * comments, block comments, and a trailing // comment.
function code(text: string): string[] {
  let inBlock = false;
  return text.split("\n").map((line) => {
    let out = line;
    if (inBlock) {
      const end = out.indexOf("*/");
      if (end < 0) return "";
      out = out.slice(end + 2);
      inBlock = false;
    }
    for (let start = out.indexOf("/*"); start >= 0; start = out.indexOf("/*")) {
      const end = out.indexOf("*/", start + 2);
      if (end < 0) {
        inBlock = true;
        out = out.slice(0, start);
        break;
      }
      out = out.slice(0, start) + out.slice(end + 2);
    }
    if (/^\s*(\/\/|\*)/.test(out)) return "";
    return out.replace(/(^|\s)\/\/\s.*$/, "$1"); // a trailing comment (not a URL: those have no space before //)
  });
}

const offenders: { file: string; line: number; what: string; text: string }[] = [];
for (const dir of DIRS)
  for (const path of files(join(ROOT, dir))) {
    const file = relative(ROOT, path);
    code(readFileSync(path, "utf8")).forEach((text, i) => {
      for (const [what, re] of PATTERNS) if (re.test(text)) offenders.push({ file, line: i + 1, what, text: text.trim() });
    });
  }

const used = new Set<Allowed>();
const bad = offenders.filter((o) => {
  const hit = allow.find((a) => a.file === o.file && o.text.includes(a.match));
  if (hit) used.add(hit);
  return !hit;
});
const stale = allow.filter((a) => !used.has(a));
const noReason = allow.filter((a) => !a.reason || a.reason.trim().length < 10);

if (bad.length) {
  console.log(`${bad.length} hard-coded unit text${bad.length === 1 ? "" : "s"} found outside src/lib/units:`);
  for (const o of bad) console.log(`  ${o.file}:${o.line} [${o.what}] ${o.text.slice(0, 150)}`);
}
assert.equal(noReason.length, 0, `every allow-list entry needs a reason: ${noReason.map((a) => `${a.file} "${a.match}"`).join("; ")}`);
assert.equal(stale.length, 0, `stale allow-list entries (they match no line): ${stale.map((a) => `${a.file} "${a.match}"`).join("; ")}`);
assert.equal(bad.length, 0, `${bad.length} hard-coded unit texts; follow the units setting (useUnitFormat / formatLength) or add an allow-list entry with a reason`);
console.log(`units everywhere: ${offenders.length} unit texts in ${DIRS.join(", ")}, all ${used.size} allow-listed with a reason; none stale`);
console.log("OK");
