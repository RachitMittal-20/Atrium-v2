/**
 * walls-dump.ts — writes and compares wall lists, so a change to wall
 * detection can be checked wall by wall instead of by eye on overlays.
 *
 * Dump: runs the real pipeline (deskew.ts, hollowWalls.ts detectWalls,
 * vectorize.ts) on every image in test-plans/ and tests/fixtures/ and writes
 * /tmp/walls/<image>.json: the commit it came from (see stamp.ts) and the
 * walls as { a, b, thickness }, rounded to 0.1 px. The fixtures share their
 * names with test-plans/ 01–04 (and are the same files), so a name already
 * dumped is skipped.
 *   npx tsx scripts/walls-dump.ts [file-prefix ...]
 *
 * Diff: compares two dumps (by default an older one against /tmp/walls) and
 * prints, per image in both, the walls added and removed. Two walls match when
 * both ends are within 3 px of each other (either end order); matching is one
 * to one, nearest first.
 *   npx tsx scripts/walls-dump.ts --diff <older-dump-folder> [<newer-dump-folder>]
 *
 * Connects to: the blueprint pipeline above; stamp.ts for the commit label.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { deskew } from "../src/lib/blueprint/deskew";
import { detectWalls } from "../src/lib/blueprint/hollowWalls";
import { vectorize } from "../src/lib/blueprint/vectorize";
import { commit } from "./stamp";

const OUT = "/tmp/walls";
const MATCH_PX = 3;

type P = { x: number; y: number };
type Wall = { a: P; b: P; thickness: number };
type Dump = { image: string; commit: string; walls: Wall[] };

const r1 = (v: number) => Math.round(v * 10) / 10;

async function dump(prefixes: string[]) {
  mkdirSync(OUT, { recursive: true });
  const done = new Set<string>();
  for (const dir of ["test-plans", "tests/fixtures"]) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort()) {
      if (done.has(file) || (prefixes.length && !prefixes.some((p) => file.startsWith(p)))) continue;
      done.add(file);
      const { data, info } = await sharp(path.join(dir, file)).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const { pixels } = deskew({ width: info.width, height: info.height, rgba: data });
      let walls: Wall[] = [];
      try {
        walls = vectorize(detectWalls(pixels).mask).walls.map((w) => ({ a: { x: r1(w.a.x), y: r1(w.a.y) }, b: { x: r1(w.b.x), y: r1(w.b.y) }, thickness: r1(w.thickness) }));
      } catch (e) {
        console.log(`${file}: no walls (${(e as Error).message})`);
      }
      const out: Dump = { image: file, commit, walls };
      writeFileSync(path.join(OUT, `${path.parse(file).name}.json`), JSON.stringify(out, null, 1));
      console.log(`${dir}/${file}: ${walls.length} walls -> ${OUT}/${path.parse(file).name}.json`);
    }
  }
}

/** How far apart two walls' ends are (the worse end), trying both end orders. */
const endGap = (p: Wall, q: Wall) => {
  const d = (u: P, v: P) => Math.hypot(u.x - v.x, u.y - v.y);
  return Math.min(Math.max(d(p.a, q.a), d(p.b, q.b)), Math.max(d(p.a, q.b), d(p.b, q.a)));
};

const show = (w: Wall) => `(${w.a.x}, ${w.a.y}) -> (${w.b.x}, ${w.b.y})  thickness ${w.thickness}`;

function diff(olderDir: string, newerDir: string) {
  const read = (dir: string) => new Map(readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => [f, JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Dump]));
  const older = read(olderDir);
  const newer = read(newerDir);
  for (const [f, o] of [...older].sort()) {
    const n = newer.get(f);
    if (!n) continue;
    // Every close pair, nearest first; each wall is matched at most once.
    const pairs: [number, number, number][] = [];
    o.walls.forEach((p, i) => n.walls.forEach((q, j) => {
      const g = endGap(p, q);
      if (g <= MATCH_PX) pairs.push([g, i, j]);
    }));
    pairs.sort((p, q) => p[0] - q[0]);
    const usedO = new Set<number>();
    const usedN = new Set<number>();
    for (const [, i, j] of pairs) if (!usedO.has(i) && !usedN.has(j)) (usedO.add(i), usedN.add(j));
    const removed = o.walls.filter((_, i) => !usedO.has(i));
    const added = n.walls.filter((_, j) => !usedN.has(j));
    console.log(`\n${o.image}: ${o.walls.length} walls (${o.commit}) -> ${n.walls.length} walls (${n.commit}); ${usedO.size} matched, ${removed.length} removed, ${added.length} added`);
    for (const w of removed) console.log(`  - ${show(w)}`);
    for (const w of added) console.log(`  + ${show(w)}`);
  }
}

const args = process.argv.slice(2);
if (args[0] === "--diff") {
  if (!args[1]) throw new Error("usage: walls-dump.ts --diff <older-dump-folder> [<newer-dump-folder>]");
  diff(args[1], args[2] ?? OUT);
} else dump(args);
