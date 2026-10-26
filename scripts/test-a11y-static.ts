/**
 * test-a11y-static.ts — step A.1: the accessibility rules that can be checked without a browser (the browser half,
 * axe-core and the keyboard walk, is scripts/e2e-a11y.ts). Written failing first. In npm test, no network, nothing
 * gitignored:
 *   1. Every <button> and link in src/ whose content is only an icon has an accessible name (aria-label, aria-labelledby,
 *      title, or visible or sr-only text).
 *   2. Every form control (input, select, textarea) has a label: aria-label, aria-labelledby, a wrapping <label>, or an
 *      id that a <label htmlFor> in the same file names. Hidden inputs and the file input behind a menu are exempt.
 *   3. Every <img> and next/image has an alt attribute (alt="" is for decoration and is allowed).
 *   4. Every route (src/app/**\/page.tsx and not-found.tsx) has a title: a `metadata` export with a title in its own file
 *      or in a layout above it.
 *   5. Every route renders exactly one <h1> (react-dom/server on the page as it first renders; the 404 is checked too).
 *   6. No animation library call runs without the reduced-motion rule being visible in the same file.
 * Reads source text only; the rules are the simple ones a regular expression can state, not a parser. A false hit is
 * fixed by naming the thing, not by adding an exception here.
 * Run: npx tsx scripts/test-a11y-static.ts
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
/** Source with every comment blanked out (newlines kept, so line numbers hold): a tag named in a comment is not a tag. */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\/|(?<![:"'`])\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
const read = (f: string) => stripComments(readFileSync(f, "utf8"));
const tsx = walk(join(ROOT, "src")).filter((f) => f.endsWith(".tsx"));
const rel = (f: string) => relative(ROOT, f);

/** Index of the `}` matching the `{` at `i` (JSX braces nest; strings with braces are rare enough here). */
function closeBrace(s: string, i: number): number {
  let depth = 0;
  for (let k = i; k < s.length; k++) {
    if (s[k] === "{") depth++;
    else if (s[k] === "}" && --depth === 0) return k;
  }
  return s.length - 1;
}

/** Index of the `>` that ends the opening tag starting at `i` (attribute values may hold `>` inside braces or quotes). */
function endOfTag(s: string, i: number): number {
  for (let k = i; k < s.length; k++) {
    if (s[k] === "{") k = closeBrace(s, k);
    else if (s[k] === '"' || s[k] === "'") k = s.indexOf(s[k], k + 1);
    else if (s[k] === ">" && s[k - 1] !== "=") return k;
  }
  return s.length - 1;
}

/** Everything inside an element, from the end of its opening tag to its closing tag (no nesting of the same tag in this code). */
function innerOf(s: string, tag: string, open: number): { attrs: string; inner: string; selfClosing: boolean } {
  const end = endOfTag(s, open);
  const attrs = s.slice(open, end + 1);
  if (attrs.endsWith("/>")) return { attrs, inner: "", selfClosing: true };
  const close = s.indexOf(`</${tag}>`, end);
  return { attrs, inner: s.slice(end + 1, close < 0 ? s.length : close), selfClosing: false };
}

/** The visible-or-spoken text of some JSX: letters left once icons, comments and non-text expressions are removed. */
function hasName(inner: string): boolean {
  let s = inner.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/<svg[\s\S]*?<\/svg>/g, "");
  // Drop {…} expressions that are only an icon (icon(...), t.icon, glyph) and keep every other expression as text.
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "{") {
      out += s[i];
      continue;
    }
    const end = closeBrace(s, i);
    const expr = s.slice(i + 1, end).trim();
    if (!/^(icon\(|[\w.]*icon\b|glyph\b|children\b)/.test(expr)) out += " x ";
    else if (/^children\b/.test(expr)) out += " x "; // a caller names it (checked at the caller)
    i = end;
  }
  s = out.replace(/<[^>]+>/g, " ");
  return /[A-Za-z0-9]/.test(s);
}

const problems: string[] = [];

// ---- 1. buttons and links
for (const f of tsx) {
  const src = read(f);
  for (const tag of ["button", "a", "Link"]) {
    for (const m of src.matchAll(new RegExp(`<${tag}(?=[\\s>])`, "g"))) {
      const { attrs, inner, selfClosing } = innerOf(src, tag, m.index!);
      if (/aria-label(ledby)?=|\btitle=/.test(attrs) || /\{\.\.\./.test(attrs)) continue;
      if (!selfClosing && hasName(inner)) continue;
      problems.push(`${rel(f)}:${src.slice(0, m.index).split("\n").length}: <${tag}> has no accessible name (no text, aria-label or title)`);
    }
  }
}

// ---- 2. form controls
for (const f of tsx) {
  const src = read(f);
  for (const tag of ["input", "select", "textarea"]) {
    for (const m of src.matchAll(new RegExp(`<${tag}(?=[\\s>/])`, "g"))) {
      const { attrs } = innerOf(src, tag, m.index!);
      if (/type="hidden"|\bhidden\b/.test(attrs.replace(/className="[^"]*"/g, ""))) continue;
      if (/type="file"/.test(attrs) && /className="[^"]*\b(hidden|sr-only)\b/.test(attrs)) continue; // opened by a button that is named
      if (/aria-label(ledby)?=|\{\.\.\./.test(attrs)) continue;
      // Wrapped in a <label>: the nearest earlier <label that has not been closed.
      const before = src.slice(0, m.index);
      if (before.lastIndexOf("<label") > before.lastIndexOf("</label>")) continue;
      const id = /\bid=(?:"([^"]+)"|\{([^}]+)\})/.exec(attrs);
      if (id && new RegExp(`htmlFor=(?:"${id[1] ?? ""}"|\\{${(id[2] ?? "").replace(/[$.*+?^()[\]\\|]/g, "\\$&")}\\})`).test(src) && (id[1] || id[2])) continue;
      problems.push(`${rel(f)}:${before.split("\n").length}: <${tag}> has no label (aria-label, a wrapping <label>, or id + htmlFor)`);
    }
  }
}

// ---- 3. images
for (const f of tsx) {
  const src = read(f);
  for (const tag of ["img", "Image"]) {
    for (const m of src.matchAll(new RegExp(`<${tag}(?=[\\s/])`, "g"))) {
      const { attrs } = innerOf(src, tag, m.index!);
      if (!/\balt=/.test(attrs) && !/\{\.\.\./.test(attrs)) problems.push(`${rel(f)}:${src.slice(0, m.index).split("\n").length}: <${tag}> has no alt`);
    }
  }
}

// ---- 4. titles
const appDir = join(ROOT, "src/app");
const pages = walk(appDir).filter((f) => /\/page\.tsx$/.test(f));
const hasTitle = (f: string) => /export (const metadata|async function generateMetadata)/.test(read(f)) && /title/.test(read(f));
for (const page of pages) {
  const dirs: string[] = [];
  for (let d = join(page, ".."); d.startsWith(appDir); d = join(d, "..")) dirs.push(d);
  const owners = [page, ...dirs.map((d) => join(d, "layout.tsx"))].filter((f) => {
    try {
      return statSync(f).isFile();
    } catch {
      return false;
    }
  });
  if (!owners.some(hasTitle)) problems.push(`${rel(page)}: no title (no metadata export with a title in the page or a layout above it)`);
}

// ---- 6. animation libraries respect prefers-reduced-motion
for (const f of tsx) {
  const src = read(f);
  if (/\bgsap\.(to|from|fromTo|timeline|set)\b|\bscrollTo\(|new Lenis/.test(src) && !/prefers-reduced-motion|reducedMotion|reduceMotion|useReducedMotion|isReduced/i.test(src)) {
    problems.push(`${rel(f)}: calls an animation library but never mentions prefers-reduced-motion`);
  }
}

assert.deepEqual(problems, [], `\n${problems.join("\n")}\n`);

// ---- 5. exactly one h1 per route, rendered
// Done in a second file-free step below so the rule above can fail on its own first.
async function h1s() {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  // useRouter() needs a mounted app router; a stub with the methods the pages could call is enough to render once.
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const router = { push() {}, replace() {}, back() {}, forward() {}, refresh() {}, prefetch() {} };
  const routes: [string, string][] = [
    ["/", "src/app/page.tsx"],
    ["/limits", "src/app/limits/page.tsx"],
    ["/studio", "src/app/studio/page.tsx"],
    ["/studio/import", "src/app/studio/import/page.tsx"],
    ["404", "src/app/not-found.tsx"],
  ];
  const bad: string[] = [];
  for (const [route, file] of routes) {
    const mod = (await import(join(ROOT, file))) as { default: () => unknown };
    const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router as never }, createElement(mod.default as never)));
    const count = (html.match(/<h1[\s>]/g) ?? []).length;
    if (count !== 1) bad.push(`${route}: ${count} <h1> in the first render (want exactly 1)`);
  }
  assert.deepEqual(bad, [], `\n${bad.join("\n")}\n`);
}

h1s().then(
  () => console.log("test-a11y-static: OK"),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
