/**
 * analyse-report.ts — runs analyseBlueprint (src/lib/blueprint/analyse.ts) with
 * REAL OCR on every image in test-plans/, then buildFromAnalysis, and prints
 * per image what the review screen would get, then a summary table.
 *
 * Scale used for the plan: the estimated one when its confidence is "good";
 * otherwise the manual values below (read off the plans by hand), and 05 and 07
 * are skipped with "no usable scale".
 *
 * Not in npm test: tesseract.js downloads its English language data from the
 * jsdelivr CDN on the first run (cached afterwards as ./eng.traineddata).
 * Run: npx tsx scripts/analyse-report.ts
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { analyseBlueprint, buildFromAnalysis, STAGES } from "../src/lib/blueprint/analyse";
import type { PlanScale } from "../src/types/blueprint";

const IN = "test-plans";
const MANUAL: Record<string, number> = { "01": 100, "02": 100, "04": 100, "06": 47, "08": 95 };

const p = (v: { x: number; y: number }) => `(${v.x}, ${v.y})`;

async function main() {
  const table: string[][] = [["image", "angle", "mode", "walls", "doors", "windows", "unpaired", "scale", "px/m", "warnings", "seconds", "rooms", "removed", "problems"]];
  for (const file of readdirSync(IN).filter((f) => !f.startsWith(".")).sort()) {
    const id = file.slice(0, 2);
    const { data, info } = await sharp(path.join(IN, file)).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const a = await analyseBlueprint({ width: info.width, height: info.height, rgba: data });
    const total = Object.values(a.timings).reduce((s, t) => s + t, 0) / 1000;
    const kinds = (k: string) => a.openings.filter((o) => o.kind === k).length;
    const codes = a.warnings.map((w) => w.code).join(", ") || "-";
    console.log(`\n${file}  (${info.width}×${info.height}, imageScale ${a.imageScale})`);
    console.log(`  angle ${a.angleDeg}°, mode ${a.mode} (${a.modeReason})`);
    console.log(`  walls ${a.walls.length}, doors ${kinds("door")}, windows ${kinds("window")}, unpaired ${a.unpaired.length}; coverage ${a.coverage.toFixed(3)}, inkCapture ${a.inkCapture.toFixed(3)}`);
    console.log(`  scale ${a.scale.confidence}, pxPerM ${a.scale.pxPerM?.toFixed(1) ?? "null"}: ${a.scale.reason}`);
    console.log(`  labels read: ${a.labels.map((l) => `"${l.text}"`).join(", ") || "none"}`);
    for (const w of a.warnings) console.log(`  warning ${w.code}: ${w.message}`);
    console.log(`  timings ${STAGES.map((s) => `${s} ${(a.timings[s] / 1000).toFixed(2)}`).join(", ")}; total ${total.toFixed(2)} s`);

    const row = [id, a.angleDeg.toFixed(1), a.mode, String(a.walls.length), String(kinds("door")), String(kinds("window")), String(a.unpaired.length), a.scale.confidence, a.scale.pxPerM?.toFixed(1) ?? "-", codes, total.toFixed(1)];
    const scale: PlanScale | null = a.scale.confidence === "good" ? { pxPerM: a.scale.pxPerM!, source: "ocr" } : MANUAL[id] ? { pxPerM: MANUAL[id], source: "manual" } : null;
    if (!scale) {
      console.log("  plan: no usable scale");
      table.push([...row, "no usable scale", "-", "-"]);
      continue;
    }
    const { plan, report, naming } = buildFromAnalysis(a, scale, {}, file);
    console.log(`  plan at ${scale.pxPerM.toFixed(1)} px/m (${scale.source}): ${plan.walls.length} walls, ${plan.openings.length} openings`);
    console.log(`  rooms ${plan.rooms.length}: ${plan.rooms.map((r) => r.name).join(", ") || "none"}`);
    if (naming.unplaced.length) console.log(`  labels in no room: ${naming.unplaced.join(", ")}`);
    for (const r of report.removedWalls) console.log(`  removed wall ${r.id} (${r.lengthPx.toFixed(1)} px): ${r.reason}`);
    for (const o of report.wideOpenings) console.log(`  wide opening ${o.openingId} (${o.kind}) ${o.widthM.toFixed(2)} m`);
    for (const d of report.droppedPairs) console.log(`  dropped pair ${d.widthM.toFixed(2)} m`);
    console.log(`  free ends ${report.freeEnds.length}${report.freeEnds.length ? ": " + report.freeEnds.map(p).join(" ") : ""}`);
    console.log(`  problems ${report.problems.length}${report.problems.length ? ":\n    " + report.problems.join("\n    ") : ""}`);
    table.push([...row, String(plan.rooms.length), report.removedWalls.map((r) => r.id).join(" ") || "-", String(report.problems.length)]);
  }

  console.log("");
  const widths = table[0].map((_, c) => Math.max(...table.map((r) => r[c].length)));
  for (const r of table) console.log(r.map((cell, c) => cell.padEnd(widths[c])).join("  "));
}

main();
