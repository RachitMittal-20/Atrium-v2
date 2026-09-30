/**
 * scale-report.ts — runs REAL OCR and scale calibration on every image in
 * test-plans/: deskew.ts, hollowWalls.ts detectWalls, vectorize.ts, then
 * ocr.ts ocrPlan on the deskewed, unfilled image and scale.ts estimateScale.
 * Prints per image the labels read, each sample, the median, spread,
 * confidence and reason, and a summary table at the end.
 *
 * Not in npm test: tesseract.js downloads its English language data from the
 * jsdelivr CDN on the first run (cached afterwards as ./eng.traineddata).
 *
 * Known truths checked: 03 must give 100 px/m within 3%; 01 and 02 print no
 * sizes and must give "none". 04 is the same house as a fake scan and is held
 * to the same 100 px/m, reported whether it passes or not. 05–08 are reported
 * only; for 06 and 08 the building footprint the scale implies is printed too.
 * Run: npx tsx scripts/scale-report.ts
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { deskew } from "../src/lib/blueprint/deskew";
import { detectWalls } from "../src/lib/blueprint/hollowWalls";
import { ocrPlan } from "../src/lib/blueprint/ocr";
import { estimateScale } from "../src/lib/blueprint/scale";
import { vectorize } from "../src/lib/blueprint/vectorize";
import type { PixelWall } from "../src/types/blueprint";

const IN = "test-plans";

const median = (v: number[]) => {
  const s = [...v].sort((p, q) => p - q);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

async function main() {
  const table: string[][] = [["image", "labels", "samples", "median px/m", "spread", "confidence", "truth"]];
  for (const file of readdirSync(IN).filter((f) => !f.startsWith(".")).sort()) {
    const id = file.slice(0, 2);
    const { data, info } = await sharp(path.join(IN, file)).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { pixels, angleDeg } = deskew({ width: info.width, height: info.height, rgba: data });
    console.log(`\n${file}  (${pixels.width}×${pixels.height}, deskew ${angleDeg.toFixed(1)}°)`);

    let walls: PixelWall[] = [];
    try {
      const found = detectWalls(pixels);
      walls = vectorize(found.mask).walls;
      console.log(`  walls ${walls.length} (${found.mode})`);
    } catch (e) {
      console.log(`  no walls: ${(e as Error).message}`);
    }

    // OCR reads the deskewed, UNFILLED pixels, never the hollow-filled copy.
    const ocr = await ocrPlan(pixels, []);
    if (ocr.error) {
      console.log(`  FAIL OCR did not run: ${ocr.error}`);
      table.push([id, "-", "-", "-", "-", "OCR failed", "FAIL"]);
      continue;
    }
    for (const x of ocr.rereads) console.log(`    second read "${x.first}" (${x.firstConfidence.toFixed(0)}) -> "${x.second}" (${x.secondConfidence.toFixed(0)}), kept the ${x.kept}`);
    const r = estimateScale({ words: ocr.words, walls, pixels });
    const labels = r.samples.length + r.rejected.length;
    console.log(`  OCR words ${ocr.words.length} (${ocr.words.filter((w) => w.vertical).length} from the rotated pass); dimension labels read ${labels}, unparsed number lines ${r.unparsed.length}`);
    for (const s of r.samples) console.log(`    sample   ${s.pxPerM.toFixed(1).padStart(7)} px/m  ${s.source.padEnd(9)} "${s.text}" at (${Math.round((s.box.x0 + s.box.x1) / 2)}, ${Math.round((s.box.y0 + s.box.y1) / 2)})`);
    for (const x of r.rejected) console.log(`    rejected "${x.text}": ${x.why}`);
    if (r.unparsed.length) console.log(`    unparsed ${r.unparsed.map((t) => `"${t}"`).join(", ")}`);
    const med = r.samples.length ? median(r.samples.map((s) => s.pxPerM)) : null;
    console.log(`  median ${med === null ? "-" : med.toFixed(1) + " px/m"}, spread ${r.spreadPct.toFixed(1)}%, confidence ${r.confidence}, pxPerM ${r.pxPerM === null ? "null" : r.pxPerM.toFixed(1)}`);
    console.log(`  reason: ${r.reason}`);

    let truth = "";
    if (id === "01" || id === "02") {
      truth = r.confidence === "none" ? "PASS" : "FAIL";
      console.log(`  ${truth} must be "none" (no sizes printed)`);
    } else if (id === "03" || id === "04") {
      truth = r.pxPerM !== null && Math.abs(r.pxPerM - 100) <= 3 ? "PASS" : "FAIL";
      console.log(`  ${truth} must be 100 px/m within 3%${id === "04" ? " (04: reported as it comes)" : ""}`);
    }
    if (id === "06" || id === "08") {
      // Centre line to centre line, like scripts/footprint.ts.
      const xs = walls.flatMap((w) => [w.a.x, w.b.x]);
      const ys = walls.flatMap((w) => [w.a.y, w.b.y]);
      const [fw, fh] = walls.length ? [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)] : [0, 0];
      const scale = r.pxPerM ?? med;
      console.log(
        scale === null
          ? `  footprint ${fw.toFixed(0)} × ${fh.toFixed(0)} px; no scale, so no size in metres`
          : `  footprint ${fw.toFixed(0)} × ${fh.toFixed(0)} px = ${(fw / scale).toFixed(1)} × ${(fh / scale).toFixed(1)} m at ${scale.toFixed(1)} px/m${r.pxPerM === null ? " (the rejected median, not a trusted scale)" : ""}`,
      );
    }
    table.push([id, String(labels), String(r.samples.length), med === null ? "-" : med.toFixed(1), r.spreadPct.toFixed(1) + "%", r.confidence, truth]);
  }

  console.log("");
  const widths = table[0].map((_, c) => Math.max(...table.map((row) => row[c].length)));
  for (const row of table) console.log(row.map((cell, c) => cell.padEnd(widths[c])).join("  "));
}

main();
