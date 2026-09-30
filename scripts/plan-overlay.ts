/**
 * plan-overlay.ts — draws what buildPlan (src/lib/blueprint/toPlan.ts) made of
 * an image back over the deskewed image, to check the Plan by eye. Runs the
 * real pipeline (deskew.ts, hollowWalls.ts detectWalls, vectorize.ts,
 * openings.ts detectOpenings), then buildPlan at the scale given with
 * --scale, and maps the Plan's metres back to pixels (px = origin + m ×
 * pxPerM, origin from the report).
 *
 * Drawn: each wall's mitred outline (geometry.ts wallOutline) in red, derived
 * rooms (rooms.ts deriveRooms) as a faint yellow fill, doors as blue bars,
 * windows as green bars, wide openings (2.4–4 m) as magenta bars, free wall
 * ends as orange dots, dropped pairs (gaps over 4 m) as purple dashed lines
 * and gaps that could not be bridged as grey dashed lines. The scale and its
 * source go in the stamp (stamp.ts); --estimate adds "manual estimate" for a
 * scale that is a rough hand estimate, only for looking at the result.
 * Writes /tmp/plan-overlay/<image>.png and prints per image: walls, openings
 * by kind, wide openings, dropped pairs, unbridged gaps, free ends, problems
 * (validatePlan) and how many rooms derive.
 *
 * Run: npx tsx scripts/plan-overlay.ts --scale <pxPerM> [--estimate] <image> ...
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { deskew } from "../src/lib/blueprint/deskew";
import { detectWalls } from "../src/lib/blueprint/hollowWalls";
import { detectOpenings } from "../src/lib/blueprint/openings";
import { buildPlan } from "../src/lib/blueprint/toPlan";
import { vectorize } from "../src/lib/blueprint/vectorize";
import { wallDirection, wallOutline } from "../src/lib/plan/geometry";
import { deriveRooms } from "../src/lib/plan/rooms";
import type { Vec2 } from "../src/types/plan";
import { clearOld, writeStamped } from "./stamp";

const OUT = "/tmp/plan-overlay";
mkdirSync(OUT, { recursive: true });

const args = process.argv.slice(2);
const at = args.indexOf("--scale");
const pxPerM = Number(args[at + 1]);
const estimate = args.includes("--estimate");
const files = args.filter((a, i) => a !== "--estimate" && i !== at && i !== at + 1);
if (at < 0 || !files.length) throw new Error("usage: npx tsx scripts/plan-overlay.ts --scale <pxPerM> [--estimate] <image> ...");

async function main() {
  for (const file of files) {
    const { data, info } = await sharp(file).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixels = deskew({ width: info.width, height: info.height, rgba: data }).pixels;
    const { width, height } = pixels;
    const { walls } = vectorize(detectWalls(pixels).mask);
    const { openings, unpaired } = detectOpenings(walls, pixels);
    const { plan, report } = buildPlan({ walls, openings, unpaired, imageSize: { width, height }, name: path.basename(file) }, { pxPerM, source: "manual" });
    const rooms = deriveRooms(plan);

    const note = `scale ${pxPerM} px/m${estimate ? ", manual estimate" : ""}`;
    const count = (k: string) => plan.openings.filter((o) => o.kind === k).length;
    console.log(`\n${path.basename(file)} (${note})`);
    console.log(`  walls ${plan.walls.length}, doors ${count("door")}, windows ${count("window")}, rooms derived ${rooms.length}`);
    console.log(`  wide openings ${report.wideOpenings.length}${report.wideOpenings.map((w) => `\n    ${w.openingId} ${w.kind} ${w.widthM} m`).join("")}`);
    console.log(`  dropped pairs ${report.droppedPairs.length}${report.droppedPairs.map((d) => `\n    ${d.widthM.toFixed(2)} m at (${d.a.x}, ${d.a.y})–(${d.b.x}, ${d.b.y}) px`).join("")}`);
    console.log(`  unbridged ${report.unbridged.length}, adjusted ${report.adjusted.length}, thickness notes ${report.thickness.length}${[...report.adjusted, ...report.thickness].map((m) => `\n    ${m}`).join("")}`);
    console.log(`  free ends ${report.freeEnds.length}`);
    console.log(`  problems ${report.problems.length}${report.problems.slice(0, 8).map((p) => `\n    ${p}`).join("")}${report.problems.length > 8 ? "\n    ..." : ""}`);

    // Metres → pixels, rounded to 0.1 px for the SVG.
    const P = (p: Vec2) => `${(report.origin.x + p.x * pxPerM).toFixed(1)},${(report.origin.y + p.y * pxPerM).toFixed(1)}`;
    const stroke = Math.max(2, width / 600);
    const svg: string[] = [];
    for (const r of rooms) svg.push(`<polygon points="${r.polygon.map(P).join(" ")}" fill="rgb(240,200,40)" fill-opacity="0.18"/>`);
    for (const w of plan.walls)
      svg.push(`<polygon points="${wallOutline(w, plan.walls).map(P).join(" ")}" fill="rgb(220,30,30)" fill-opacity="0.25" stroke="rgb(220,30,30)" stroke-width="${stroke}"/>`);
    const wide = new Set(report.wideOpenings.map((w) => w.openingId));
    for (const o of plan.openings) {
      const w = plan.walls.find((x) => x.id === o.wallId)!;
      const d = wallDirection(w);
      const end = (s: number) => P({ x: w.a.x + d.x * s, y: w.a.y + d.y * s }).split(",");
      const [[x1, y1], [x2, y2]] = [end(o.offset - o.width / 2), end(o.offset + o.width / 2)];
      const colour = wide.has(o.id) ? "rgb(210,40,200)" : o.kind === "door" ? "rgb(30,90,230)" : "rgb(20,170,60)";
      svg.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${colour}" stroke-width="${Math.max(4, w.thickness * pxPerM)}" stroke-opacity="0.8"/>`);
    }
    const dashed = (a: Vec2, b: Vec2, colour: string) =>
      `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${colour}" stroke-width="${stroke * 2}" stroke-dasharray="${stroke * 6} ${stroke * 4}"/>`;
    for (const d of report.droppedPairs) svg.push(dashed(d.a, d.b, "rgb(130,40,200)"));
    for (const u of report.unbridged) svg.push(dashed(u.a, u.b, "rgb(120,120,120)"));
    for (const p of report.freeEnds) {
      const [x, y] = P(p).split(",");
      svg.push(`<circle cx="${x}" cy="${y}" r="${stroke * 4}" fill="rgb(240,140,0)"/>`);
    }

    // The deskewed image dimmed towards white, with the drawing on top.
    const base = Buffer.from(pixels.rgba);
    for (let i = 0; i < base.length; i += 4) for (let c = 0; c < 3; c++) base[i + c] = 255 - (255 - base[i + c]) * 0.3;
    const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${svg.join("")}</svg>`);
    const img = sharp(base, { raw: { width, height, channels: 4 } }).composite([{ input: overlay, top: 0, left: 0 }]);
    const png = path.join(OUT, path.parse(file).name.replace(/[^\w-]+/g, "_") + ".png");
    clearOld(OUT, file);
    await writeStamped(img, width, height, png, plan.walls.length, note);
    console.log(`  overlay ${png}`);
  }
}

main();
