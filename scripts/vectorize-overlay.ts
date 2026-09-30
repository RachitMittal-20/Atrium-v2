/**
 * vectorize-overlay.ts — runs the real image → deskew → mask → segments
 * pipeline (deskew.ts, hollowWalls.ts detectWalls, then vectorize.ts) on every
 * image in test-plans/, then finds openings (openings.ts detectOpenings, on
 * the deskewed unfilled image), writes an overlay PNG per image to
 * /tmp/vectorize/ (the deskewed image dimmed, wall centre lines red, windows
 * as green bars, doors as blue bars, unpaired free ends as orange dots), and
 * prints the deskew angle, the wall mode chosen (solid or
 * hollow) and why, wall count, coverage, inkCapture (plus fillCapture in
 * hollow mode, see hollowWalls.ts), doors, windows and unpaired ends (every
 * opening with its kind and widthPx for 06 and 08), and joint problems. Images
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
import { detectOpenings } from "../src/lib/blueprint/openings";
import { footprintCheck, wallLines } from "./footprint";
import { clearOld, writeStamped } from "./stamp";

const IN = "test-plans";
const OUT = "/tmp/vectorize";
mkdirSync(OUT, { recursive: true });

type P = { x: number; y: number };

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
    const { openings, unpaired } = detectOpenings(walls, pixels);
    const doors = openings.filter((o) => o.kind === "door").length;
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
    console.log(`  doors ${doors}, windows ${openings.length - doors}, unpaired ${unpaired.length}`);
    if (/^0[68]_/.test(file))
      for (const o of openings)
        console.log(`    ${o.kind.padEnd(6)} widthPx ${o.widthPx.toFixed(1).padStart(6)} at (${o.centre.x.toFixed(0)}, ${o.centre.y.toFixed(0)})`);
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
        [`doors ${doors} = 4, windows ${openings.length - doors} = 4`, doors === 4 && openings.length === 8],
        [`unpaired free ends ${unpaired.length} = 0`, unpaired.length === 0],
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
    // Openings as bars along the gap (green window, blue door), unpaired ends as orange dots.
    for (const o of openings) {
      const n = Math.ceil(o.widthPx);
      for (let s = 0; s <= n; s++)
        draw(
          out,
          width,
          height,
          { x: o.a.x + ((o.b.x - o.a.x) * s) / n, y: o.a.y + ((o.b.y - o.a.y) * s) / n },
          Math.max(3, o.wallThicknessPx / 2),
          o.kind === "window" ? [20, 170, 60] : [30, 90, 230],
        );
    }
    for (const p of unpaired) draw(out, width, height, p, 6, [240, 140, 0]);
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
