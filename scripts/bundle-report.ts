/**
 * bundle-report.ts — step D.1: first-load JavaScript per route after `npm run build`, raw and gzipped, from
 * .next/diagnostics/route-bundle-stats.json (Turbopack's own list of the chunks a route loads first), plus the
 * largest chunks nothing loads first (workers, three, pdf.js load later). Not in npm test: it reads a build.
 * Run: npx tsx scripts/bundle-report.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const NEXT = ".next";
const kb = (n: number) => `${(n / 1024).toFixed(0)} kB`;
const gz = (p: string) => gzipSync(readFileSync(join(NEXT, p))).length;

const routes = JSON.parse(readFileSync(join(NEXT, "diagnostics/route-bundle-stats.json"), "utf8")) as { route: string; firstLoadUncompressedJsBytes: number; firstLoadChunkPaths: string[] }[];
const first = new Set<string>();
console.log("route".padEnd(18), "chunks".padStart(6), "raw".padStart(9), "gzip".padStart(9));
for (const r of routes.sort((a, b) => a.route.localeCompare(b.route))) {
  r.firstLoadChunkPaths.forEach((p) => first.add(p.replace(/^.*?static\//, "static/")));
  const js = r.firstLoadChunkPaths.filter((p) => p.endsWith(".js"));
  console.log(r.route.padEnd(18), String(js.length).padStart(6), kb(r.firstLoadUncompressedJsBytes).padStart(9), kb(js.reduce((s, p) => s + gz(p.replace(/^.*?static\//, "static/")), 0)).padStart(9));
}

const dir = join(NEXT, "static/chunks");
const later = readdirSync(dir).filter((f) => f.endsWith(".js") && !first.has(`static/chunks/${f}`)).map((f) => ({ f, raw: statSync(join(dir, f)).size })).sort((a, b) => b.raw - a.raw).slice(0, 8);
console.log("\nlargest chunks not in any route's first load (loaded on demand):");
for (const c of later) console.log(`  ${c.f.padEnd(26)} ${kb(c.raw).padStart(8)} raw ${kb(gz(`static/chunks/${c.f}`)).padStart(8)} gzip`);
