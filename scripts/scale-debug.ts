/**
 * scale-debug.ts — shows how scale.ts measured every room-size label on the two
 * plans that print room sizes, test-plans/06 and 08. Runs the real pipeline
 * (deskew, detectWalls, vectorize, real OCR with ocr.ts, estimateScale) and uses
 * the `rooms` traces estimateScale returns, so it shows exactly what the
 * estimate did, not a re-implementation.
 *
 * Per image it writes /tmp/scale/<name>.png: the deskewed image dimmed, wall
 * centre lines in blue, and for every label its box, its rays and their hit
 * points — green when the label was accepted, red when rejected (a ray that
 * disagreed with its span's median is drawn paler). It prints, per label: the
 * parsed sizes, every ray's two hits (distance and the wall hit), the two
 * implied scales for both assignments, and the exact rejection reason.
 * Needs the network once for tesseract's language data. Not in npm test.
 * Run: npx tsx scripts/scale-debug.ts [file-prefix ...]   (default: 06 08)
 */
import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { deskew } from "../src/lib/blueprint/deskew";
import { detectWalls } from "../src/lib/blueprint/hollowWalls";
import { ocrPlan } from "../src/lib/blueprint/ocr";
import { estimateScale, type RayHit } from "../src/lib/blueprint/scale";
import { vectorize } from "../src/lib/blueprint/vectorize";

const IN = "test-plans";
const OUT = "/tmp/scale";
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
    console.log(`\n${file}  (${width}×${height}, ${found.mode} walls, ${walls.length} segments, ${r.rooms.length} room-size labels)`);

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
      const strong = ok ? [0, 150, 40] : [215, 25, 25];
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
    for (const x of r.rejected.filter((x) => !r.rooms.some((room) => room.text === x.text))) console.log(`\n  (not a room-size label) "${x.text}": ${x.why}`);
    // Lines with a number that never became a label: usually a size OCR misread.
    for (const text of r.unparsed) console.log(`  (no usable length) "${text}"`);
    const png = path.join(OUT, file.replace(/\.[^.]+$/, "") + ".png");
    await sharp(out, { raw: { width, height, channels: 4 } }).png().toFile(png);
    console.log(`\n  picture ${png}`);
  }
}

main();
