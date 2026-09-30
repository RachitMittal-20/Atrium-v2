/**
 * scale-debug.ts — shows how scale.ts measured every printed size on the plans
 * given (default test-plans/06 and 08). Runs the real pipeline (deskew,
 * detectWalls, vectorize, real OCR with ocr.ts, estimateScale) and draws the
 * `rooms` and `dimensions` traces estimateScale returns, so it shows exactly
 * what the estimate did, not a re-implementation.
 *
 * Per image it writes, to /tmp/scale/:
 *   <image>.png — the deskewed image dimmed, wall centre lines in blue; for
 *     every room-size label its box, its rays and their hit points (green
 *     accepted, red rejected, a ray that disagreed with its span's median
 *     paler), and every dimension line that was measured, in green.
 *   <id>_dimline.png — only when there are single-length labels: one panel per
 *     label, 3× enlarged, of the dark-pixel map (wallMask.ts `binarize`) around
 *     it, with the label's box in pale blue and every row the search followed
 *     drawn through the middle of that row: green the row measured, orange a
 *     row that was a line but not chosen, red a row rejected. Short bars mark
 *     each row's two ends. Vertical text is shown transposed (along = y), as the
 *     code reads it.
 * Every picture is stamped with the commit, wall count and time, and the
 * image's older pictures are deleted first (stamp.ts).
 *
 * It prints, per label: the parsed sizes, every ray's two hits, the two
 * implied scales for both assignments and the exact rejection reason; per
 * single length, every row followed and why it was or was not the line.
 * Needs the network once for tesseract's language data. Not in npm test.
 * Run: npx tsx scripts/scale-debug.ts [file-prefix ...]   (default: 06 08)
 */
import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { deskew } from "../src/lib/blueprint/deskew";
import { detectWalls } from "../src/lib/blueprint/hollowWalls";
import { ocrPlan } from "../src/lib/blueprint/ocr";
import { estimateScale, type DimensionTrace, type RayHit } from "../src/lib/blueprint/scale";
import { vectorize } from "../src/lib/blueprint/vectorize";
import { binarize } from "../src/lib/blueprint/wallMask";
import { clearOld, writeStamped } from "./stamp";
import type { PlanPixels } from "../src/types/blueprint";

const IN = "test-plans";
const OUT = "/tmp/scale";
const ZOOM = 3; // dimension-line panels: output px per image px
const prefixes = process.argv.slice(2).length ? process.argv.slice(2) : ["06", "08"];
mkdirSync(OUT, { recursive: true });

type P = { x: number; y: number };

/** A line of round dots of radius r from p to q. */
function stroke(rgba: Buffer, w: number, h: number, p: P, q: P, r: number, [R, G, B]: number[]) {
  const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y)));
  for (let i = 0; i <= n; i++) {
    const cx = p.x + ((q.x - p.x) * i) / n;
    const cy = p.y + ((q.y - p.y) * i) / n;
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++)
        if (x >= 0 && y >= 0 && x < w && y < h && (x - cx) ** 2 + (y - cy) ** 2 <= r * r) rgba.set([R, G, B, 255], (y * w + x) * 4);
  }
}

const hitText = (h: RayHit | null, across: string, along: string) =>
  h ? `${h.dist.toFixed(0).padStart(4)} px to wall ${across}=${h.wall.c.toFixed(0)} (${along} ${h.wall.s0.toFixed(0)}..${h.wall.s1.toFixed(0)}, t ${h.wall.t.toFixed(0)})` : "   no wall (ran off the plan)";

const GREEN = [0, 150, 40];
const ORANGE = [235, 130, 0];
const RED = [215, 25, 25];

/** One dimension-line panel (see header) as a PNG, with its size. */
async function dimPanel(ink: Uint8Array, pixels: PlanPixels, d: DimensionTrace) {
  const v = d.vertical;
  const [A, C] = v ? [pixels.height, pixels.width] : [pixels.width, pixels.height]; // along, across
  const { x0, y0, x1, y1 } = d.box;
  const [b0, b1, c0, c1] = v ? [y0, y1, x0, x1] : [x0, x1, y0, y1];
  const h = c1 - c0;
  // Window: the rows searched (two text heights either side) and everything they reached.
  const sA = Math.max(0, Math.floor(Math.min(b0 - h, ...d.rows.map((r) => r.s0)) - 30));
  const sB = Math.min(A, Math.ceil(Math.max(b1 + h, ...d.rows.map((r) => r.s1)) + 30));
  const cA = Math.max(0, Math.floor(c0 - 2 * h - 4));
  const cB = Math.min(C, Math.ceil(c1 + 2 * h + 4));
  const w = (sB - sA) * ZOOM;
  const hh = (cB - cA) * ZOOM;
  const rgba = Buffer.alloc(w * hh * 4, 255);
  for (let Y = 0; Y < hh; Y++)
    for (let X = 0; X < w; X++) {
      const s = sA + Math.floor(X / ZOOM);
      const c = cA + Math.floor(Y / ZOOM);
      const dark = v ? ink[s * pixels.width + c] : ink[c * pixels.width + s];
      const inBox = s >= b0 && s < b1 && c >= c0 && c < c1;
      rgba.set(dark ? [0, 0, 0, 255] : inBox ? [205, 222, 250, 255] : [255, 255, 255, 255], (Y * w + X) * 4);
    }
  d.rows.forEach((r, i) => {
    const col = i === d.chosen ? GREEN : r.why === null ? ORANGE : RED;
    const Y = (r.c - cA) * ZOOM + 1; // middle of the row's band, so its ink stays visible above and below
    stroke(rgba, w, hh, { x: (r.s0 - sA) * ZOOM, y: Y }, { x: (r.s1 - sA) * ZOOM + ZOOM - 1, y: Y }, 0, col);
    for (const s of [r.s0, r.s1]) stroke(rgba, w, hh, { x: (s - sA) * ZOOM + 1, y: Y - 4 }, { x: (s - sA) * ZOOM + 1, y: Y + 4 }, 0, col);
  });
  const chosen = d.chosen === null ? null : d.rows[d.chosen];
  const caption = `"${d.text}" ${v ? "vertical, shown transposed (along = y)" : "horizontal"}: ${
    chosen ? `measured row ${v ? "x" : "y"}=${chosen.c}, ${chosen.s0}..${chosen.s1} = ${chosen.len} px` : "no line"
  }. Green measured, orange a line not chosen, red rejected.`;
  return { png: await sharp(rgba, { raw: { width: w, height: hh, channels: 4 } }).png().toBuffer(), w, h: hh, caption };
}

async function main() {
  for (const file of readdirSync(IN).filter((f) => prefixes.some((p) => f.startsWith(p))).sort()) {
    const { data, info } = await sharp(path.join(IN, file)).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { pixels } = deskew({ width: info.width, height: info.height, rgba: data });
    const { width, height } = pixels;
    const found = detectWalls(pixels);
    const { walls } = vectorize(found.mask);
    const ocr = await ocrPlan(pixels, []);
    if (ocr.error) {
      console.log(`${file}: OCR did not run: ${ocr.error}`);
      continue;
    }
    const r = estimateScale({ words: ocr.words, walls, pixels });
    console.log(`\n${file}  (${width}×${height}, ${found.mode} walls, ${walls.length} segments, ${r.rooms.length} room-size labels, ${r.dimensions.length} single lengths)`);
    clearOld(OUT, file);

    const out = Buffer.from(pixels.rgba);
    for (let i = 0; i < out.length; i += 4) for (let c = 0; c < 3; c++) out[i + c] = 255 - (255 - out[i + c]) * 0.35;
    for (const wl of walls) stroke(out, width, height, wl.a, wl.b, 1, [40, 80, 220]);

    for (const room of r.rooms) {
      const ok = room.pxPerUnit !== null;
      const unit = room.hasUnit ? "m" : "units (none printed)";
      console.log(`\n  "${room.text}" at (${room.cx.toFixed(0)}, ${room.cy.toFixed(0)}): ${room.size[0].toFixed(3)} × ${room.size[1].toFixed(3)} ${unit}`);
      for (const ray of room.rays) {
        const [across, along] = ray.axis === "width" ? ["x", "y"] : ["y", "x"];
        console.log(
          `    ${ray.axis.padEnd(6)} ray at ${along}=${ray.at.toFixed(0).padStart(4)}: ${ray.axis === "width" ? "left " : "up   "}${hitText(ray.lo, across, along)} | ${ray.axis === "width" ? "right" : "down "}${hitText(ray.hi, across, along)} | inner ${ray.inner === null ? "-" : ray.inner.toFixed(0)}${ray.agrees ? "" : "  DISAGREES"}`,
        );
      }
      console.log(`    inner width ${room.width?.toFixed(0) ?? "rejected"} px, inner height ${room.height?.toFixed(0) ?? "rejected"} px`);
      for (const f of room.fits)
        console.log(`    first number = ${f.firstIs.padEnd(6)}: ${f.scaleW.toFixed(1)} px/unit from the width, ${f.scaleH.toFixed(1)} from the height, ${f.diffPct.toFixed(1)}% apart`);
      console.log(ok ? `    ACCEPTED at ${room.pxPerUnit!.toFixed(1)} px per ${room.hasUnit ? "metre" : "printed unit"}` : `    REJECTED: ${room.why}`);

      // Picture: box, rays, hit points.
      const strong = ok ? GREEN : RED;
      const pale = ok ? [140, 215, 150] : [245, 160, 160];
      const { x0, y0, x1, y1 } = room.box;
      for (const [p, q] of [[{ x: x0, y: y0 }, { x: x1, y: y0 }], [{ x: x1, y: y0 }, { x: x1, y: y1 }], [{ x: x1, y: y1 }, { x: x0, y: y1 }], [{ x: x0, y: y1 }, { x: x0, y: y0 }]])
        stroke(out, width, height, p, q, 0.8, strong);
      for (const ray of room.rays) {
        const at = (v: number): P => (ray.axis === "width" ? { x: v, y: ray.at } : { x: ray.at, y: v });
        const lo = ray.lo ? ray.from - ray.lo.dist : 0;
        const hi = ray.hi ? ray.from + ray.hi.dist : ray.axis === "width" ? width : height;
        stroke(out, width, height, at(lo), at(hi), 0.8, ray.agrees ? strong : pale);
        if (ray.lo) stroke(out, width, height, at(lo), at(lo), 4, strong);
        if (ray.hi) stroke(out, width, height, at(hi), at(hi), 4, strong);
      }
    }

    for (const d of r.dimensions) {
      const [across, along] = d.vertical ? ["x", "y"] : ["y", "x"];
      console.log(`\n  "${d.text}" (${d.vertical ? "vertical" : "horizontal"}) at (${((d.box.x0 + d.box.x1) / 2).toFixed(0)}, ${((d.box.y0 + d.box.y1) / 2).toFixed(0)})`);
      d.rows.forEach((row, i) =>
        console.log(`    row ${across}=${row.c}: ${along} ${row.s0}..${row.s1}, ${String(row.len).padStart(4)} px  ${i === d.chosen ? "MEASURED" : (row.why ?? "a line, not the nearest group's longest row")}`),
      );
      if (d.chosen === null) continue;
      const { c, s0, s1 } = d.rows[d.chosen];
      stroke(out, width, height, d.vertical ? { x: c, y: s0 } : { x: s0, y: c }, d.vertical ? { x: c, y: s1 } : { x: s1, y: c }, 1.5, GREEN);
    }

    for (const x of r.rejected) console.log(`\n  REJECTED "${x.text}": ${x.why}`);
    // Lines with a number that never became a label: usually a size OCR misread.
    for (const text of r.unparsed) console.log(`  (no usable length) "${text}"`);
    const png = path.join(OUT, file.replace(/\.[^.]+$/, "") + ".png");
    await writeStamped(sharp(out, { raw: { width, height, channels: 4 } }), width, height, png, walls.length);
    console.log(`\n  picture ${png}`);

    if (r.dimensions.length) {
      const ink = binarize(pixels);
      const panels = await Promise.all(r.dimensions.map((d) => dimPanel(ink, pixels, d)));
      const W = Math.max(1100, ...panels.map((p) => p.w));
      const font = Math.max(15, Math.round(W / 110));
      const CAP = font * 2; // caption strip above each panel
      const layers: { input: Buffer; top: number; left: number }[] = [];
      let top = 0;
      for (const p of panels) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${CAP}"><text x="6" y="${Math.round(font * 1.4)}" font-family="Menlo, monospace" font-size="${font}" fill="#111">${p.caption.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text></svg>`;
        layers.push({ input: Buffer.from(svg), top: top, left: 0 }, { input: p.png, top: top + CAP, left: 0 });
        top += CAP + p.h + 12;
      }
      const sheet = sharp({ create: { width: W, height: top, channels: 4, background: "#f4f4f4" } }).composite(layers);
      const dimPng = path.join(OUT, `${file.split("_")[0]}_dimline.png`);
      // composite() can only be called once per pipeline, so flatten the sheet before stamping.
      await writeStamped(sharp(await sheet.png().toBuffer()), W, top, dimPng, walls.length);
      console.log(`  dimension lines ${dimPng}`);
    }
  }
}

main();
