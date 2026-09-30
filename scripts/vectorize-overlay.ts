/**
 * vectorize-overlay.ts — runs the real image → deskew → mask → segments
 * pipeline (deskew.ts, hollowWalls.ts detectWalls, then vectorize.ts) on every
 * image in test-plans/, writes an overlay PNG per image to /tmp/vectorize/
 * (the deskewed image dimmed, wall centre lines red, shared joints blue, free
 * ends orange), and prints the deskew angle, the wall mode chosen (solid or
 * hollow) and why, wall count, coverage, inkCapture (plus fillCapture in
 * hollow mode, see hollowWalls.ts) and joint problems. Images
 * decode with `sharp` (devDependency). Each overlay is stamped with the
 * commit, wall count and time, and replaces the image's older overlays
 * (stamp.ts).
 *
 * For the synthetic plans 01–04 it also checks the known truth: a 10 × 8 m
 * house at 100 px/m (footprint.ts), 7 walls, 4 door gaps + 4 window gaps.
 * Run: npx tsx scripts/vectorize-overlay.ts
 */
import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { deskew } from "../src/lib/blueprint/deskew";
import { detectWalls } from "../src/lib/blueprint/hollowWalls";
import { vectorize } from "../src/lib/blueprint/vectorize";
import { validatePlan } from "../src/lib/plan/validate";
import { samplePlan } from "../src/data/samplePlan";
import { footprintCheck, isH, wallLines } from "./footprint";
import { clearOld, writeStamped } from "./stamp";
import type { PixelWall } from "../src/types/blueprint";

const IN = "test-plans";
const OUT = "/tmp/vectorize";
mkdirSync(OUT, { recursive: true });

type P = { x: number; y: number };
const k = (p: P) => `${p.x},${p.y}`;

/** Endpoints used by only one wall. */
function freeEnds(walls: PixelWall[]) {
  const count = new Map<string, number>();
  for (const w of walls)
    for (const p of [w.a, w.b]) count.set(k(p), (count.get(k(p)) ?? 0) + 1);
  return walls.flatMap((w) =>
    [w.a, w.b].filter((p) => count.get(k(p)) === 1).map((p) => ({ p, w })),
  );
}

/**
 * Openings: each free end looks along its own wall's direction for the nearest
 * endpoint of another collinear wall. That endpoint may itself be free (a gap
 * mid-wall) or a joint (a door right next to a corner). Pairs are counted once.
 */
function gapPairs(ends: ReturnType<typeof freeEnds>, walls: PixelWall[]) {
  const paired = new Set<string>();
  let pairs = 0;
  for (const e of ends) {
    if (paired.has(k(e.p))) continue;
    const other = e.w.a === e.p ? e.w.b : e.w.a;
    const dir = { x: Math.sign(e.p.x - other.x), y: Math.sign(e.p.y - other.y) }; // outward from the wall
    let best: P | null = null;
    let bestGap = Infinity;
    for (const w of walls) {
      if (w === e.w || isH(w) !== isH(e.w)) continue;
      for (const q of [w.a, w.b]) {
        const across = isH(e.w) ? Math.abs(e.p.y - q.y) : Math.abs(e.p.x - q.x);
        const gap = (q.x - e.p.x) * dir.x + (q.y - e.p.y) * dir.y;
        if (gap > 0 && gap < bestGap && !paired.has(k(q)) && across <= Math.max(e.w.thickness, w.thickness) / 2)
          [best, bestGap] = [q, gap];
      }
    }
    if (best) {
      paired.add(k(e.p)).add(k(best));
      pairs++;
    }
  }
  return { pairs, unpaired: ends.filter((e) => !paired.has(k(e.p))).length };
}

function draw(
  rgba: Buffer,
  w: number,
  h: number,
  p: P,
  r: number,
  [R, G, B]: number[],
) {
  for (let y = Math.floor(p.y - r); y <= p.y + r; y++)
    for (let x = Math.floor(p.x - r); x <= p.x + r; x++) {
      if (
        x < 0 ||
        y < 0 ||
        x >= w ||
        y >= h ||
        (x - p.x) ** 2 + (y - p.y) ** 2 > r * r
      )
        continue;
      rgba.set([R, G, B, 255], (y * w + x) * 4);
    }
}

async function main() {
  for (const file of readdirSync(IN)
    .filter((f) => !f.startsWith("."))
    .sort()) {
    const { data: raw, info } = await sharp(path.join(IN, file))
      .rotate()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    // Everything after this line, overlay included, works on the straightened image.
    const { pixels, angleDeg } = deskew({ width: info.width, height: info.height, rgba: raw });
    const { width, height, rgba: data } = pixels;
    console.log(`\n${file}  (${info.width}×${info.height})`);
    console.log(`  deskew angleDeg ${angleDeg.toFixed(1)}°${angleDeg ? ` → ${width}×${height}` : " (unchanged)"}`);

    let mask;
    try {
      const found = detectWalls(pixels);
      mask = found.mask;
      console.log(`  mode ${found.mode}: ${found.reason}`);
    } catch (e) {
      console.log(`  mask failed: ${(e as Error).message}`);
      continue;
    }
    const { walls, coverage } = vectorize(mask);
    const ends = freeEnds(walls);
    const gaps = gapPairs(ends, walls);
    const problems = validatePlan({
      ...samplePlan,
      walls: walls.map((w, i) => ({
        id: `w${i}`,
        a: w.a,
        b: w.b,
        thickness: w.thickness,
        height: 1,
      })),
      openings: [],
      rooms: [],
    });
    const tSplits = problems.filter((m) => m.includes("lands on the middle"));

    console.log(`  mask thickness T = ${mask.wallThickness} px`);
    console.log(
      `  walls ${walls.length}, coverage ${(coverage * 100).toFixed(1)}%, inkCapture ${(mask.inkCapture * 100).toFixed(1)}%${mask.fillCapture === undefined ? "" : `, fillCapture ${(mask.fillCapture * 100).toFixed(1)}%`}`,
    );
    console.log(
      `  free ends ${ends.length}: ${gaps.pairs} facing pairs (openings), ${gaps.unpaired} unpaired`,
    );
    console.log(
      `  missing T-splits ${tSplits.length}${tSplits.length ? "\n    " + tSplits.slice(0, 5).join("\n    ") : ""}`,
    );

    if (/^0[1-4]_/.test(file)) {
      // Truth: 10 × 8 m at 100 px/m, centre line to centre line (see footprint.ts).
      const fp = footprintCheck(walls, mask.wallThickness);
      const checks: [string, boolean][] = [
        [
          `footprint ${fp.width.toFixed(2)}×${fp.height.toFixed(2)} px ≈ 1000×800 (±${fp.tol.toFixed(1)}, centre lines)`,
          fp.pass,
        ],
        [`wall lines ${wallLines(walls)} = 7`, wallLines(walls) === 7],
        [`openings ${gaps.pairs} = 8 (4 doors + 4 windows)`, gaps.pairs === 8],
        [`unpaired free ends ${gaps.unpaired} = 0`, gaps.unpaired === 0],
        [`missing T-splits ${tSplits.length} = 0`, tSplits.length === 0],
      ];
      for (const [label, ok] of checks)
        console.log(`  ${ok ? "PASS" : "FAIL"} ${label}`);
    }

    // Overlay: original dimmed towards white, then segments and joints.
    const out = Buffer.from(data);
    for (let i = 0; i < out.length; i += 4)
      for (let c = 0; c < 3; c++) out[i + c] = 255 - (255 - out[i + c]) * 0.3;
    for (const wl of walls) {
      const n = Math.ceil(Math.hypot(wl.b.x - wl.a.x, wl.b.y - wl.a.y));
      for (let s = 0; s <= n; s++)
        draw(
          out,
          width,
          height,
          {
            x: wl.a.x + ((wl.b.x - wl.a.x) * s) / n,
            y: wl.a.y + ((wl.b.y - wl.a.y) * s) / n,
          },
          1.5,
          [220, 30, 30],
        );
    }
    const free = new Set(ends.map((e) => k(e.p)));
    for (const wl of walls)
      for (const p of [wl.a, wl.b])
        draw(
          out,
          width,
          height,
          p,
          5,
          free.has(k(p)) ? [240, 140, 0] : [30, 60, 200],
        );
    const png = path.join(
      OUT,
      file.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "_") + ".png",
    );
    clearOld(OUT, file);
    await writeStamped(sharp(out, { raw: { width, height, channels: 4 } }), width, height, png, walls.length);
    console.log(`  overlay ${png}`);
  }
}

main();
