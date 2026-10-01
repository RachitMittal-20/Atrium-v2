/**
 * test-analyse.ts — offline checks for src/lib/blueprint/nameRooms.ts and
 * src/lib/blueprint/analyse.ts. No real OCR: analyseBlueprint gets an injected
 * fake `ocr` that returns hand-written labels and words.
 *
 * nameRooms, via analyseBlueprint + buildFromAnalysis at the true 100 px/m:
 *   - 02 and 03 with the four room names placed by hand (label centres in image
 *     pixels, from the fixture generator's layout) are named exactly
 *     Bedroom 1, Bedroom 2, Living, Bath / Kitchen, and loadPlan keeps them;
 *   - 01 with no labels gives four rooms with default names;
 *   - on 01's plan, direct nameRooms calls: two labels in one room are joined
 *     in reading order; a size label is ignored; a label outside every room
 *     and one on a wall band go to `unplaced`; "Dining", "Room" and the
 *     misread size "13 X 16°" (and "18 x 1%", "15 x19") in one room name it
 *     "Dining / Room".
 * analyseBlueprint:
 *   - 03 with two hand-written room-size labels (4.85 m × 3.35 m, the inner
 *     size of the two top rooms) gives 4 doors, 4 windows and no warnings;
 *   - 04 warns "rotated" with an angle near its generator's 2.2°;
 *   - 01 with an OCR that finds nothing warns "no-scale";
 *   - 01 upscaled 2.5× by nearest neighbour (2950 px, over maxSide) is
 *     downscaled: imageScale is not 1 and the footprint shrinks by that factor,
 *     within footprint.ts's tolerance scaled the same way;
 *   - onProgress gets all five stages in order.
 * parseTypedLength (import screen): 3.8, 3.8 m, 380 cm, 12'6", 12 ft 6 in.
 * Run: npx tsx scripts/test-analyse.ts
 */
import assert from "node:assert/strict";
import sharp from "sharp";
import { analyseBlueprint, buildFromAnalysis, STAGES, type OcrResult } from "../src/lib/blueprint/analyse";
import { nameRooms } from "../src/lib/blueprint/nameRooms";
import type { PlanLabel } from "../src/lib/blueprint/roomLabels";
import { deriveRooms, pointInPolygon } from "../src/lib/plan/rooms";
import { usePlanStore } from "../src/store/planStore";
import type { OcrWord, PlanPixels } from "../src/types/blueprint";
import { parseTypedLength } from "../src/app/studio/import/importFile";
import { footprintCheck } from "./footprint";

const MANUAL_100 = { pxPerM: 100, source: "manual" as const };

async function load(file: string, upscale = 1): Promise<PlanPixels> {
  let img = sharp(`tests/fixtures/${file}`).rotate();
  if (upscale !== 1) {
    const { width, height } = await img.metadata();
    img = img.resize(Math.round(width! * upscale), Math.round(height! * upscale), { kernel: "nearest" });
  }
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, rgba: data };
}

const fakeOcr = (labels: PlanLabel[] = [], words: OcrWord[] = []) => async (): Promise<OcrResult> => ({ labels, words, error: null, rereads: [] });
const label = (text: string, x: number, y: number): PlanLabel => ({ text, x, y, confidence: 90 });
const ROOM_LABELS = [label("BEDROOM 1", 310, 263), label("BEDROOM 2", 800, 263), label("LIVING", 400, 663), label("BATH / KITCHEN", 930, 663)];
const codes = (a: { warnings: { code: string }[] }) => a.warnings.map((w) => w.code);

async function main() {
  // ------------------------------------------------------------ nameRooms on the fixtures
  for (const file of ["02_thick_exterior_thin_interior.png", "03_with_dimensions.png"]) {
    const analysis = await analyseBlueprint(await load(file), { ocr: fakeOcr(ROOM_LABELS) });
    const { plan, naming } = buildFromAnalysis(analysis, MANUAL_100, {}, file);
    const want = ["Bath / Kitchen", "Bedroom 1", "Bedroom 2", "Living"];
    assert.deepEqual(plan.rooms.map((r) => r.name).sort(), want, `${file}: room names`);
    assert.deepEqual(naming.unplaced, [], `${file}: every label placed`);
    usePlanStore.getState().loadPlan(plan);
    assert.deepEqual(usePlanStore.getState().plan.rooms.map((r) => r.name).sort(), want, `${file}: loadPlan keeps the names`);
    assert.notEqual(plan.meta.createdAt, new Date(0).toISOString(), `${file}: real createdAt`);
    console.log(`${file}: ${plan.rooms.map((r) => r.name).join(", ")}`);
  }

  const a01 = await analyseBlueprint(await load("01_clean_uniform.png"), { ocr: fakeOcr() });
  const b01 = buildFromAnalysis(a01, MANUAL_100);
  assert.deepEqual(b01.plan.rooms.map((r) => r.name).sort(), ["Room 1", "Room 2", "Room 3", "Room 4"], "01: default names");

  // Direct calls on 01's plan. Plan metres → image pixels: origin + m × 100.
  const { origin } = b01.report;
  const at = (text: string, x: number, y: number) => label(text, origin.x + x * 100, origin.y + y * 100);
  const named = (labels: PlanLabel[]) => nameRooms(b01.plan, labels, origin, 100);
  const nameAt = (plan: typeof b01.plan, x: number, y: number) => deriveRooms(plan).find((d) => pointInPolygon({ x, y }, d.polygon))?.name;
  // Two labels in the top-left room (x 0–5, y 0–3.5): the lower one is written first,
  // and two on one row a pixel apart, right one higher; reading order wins, duplicates once.
  {
    const { plan, report } = named([at("STUDY", 2.5, 2.5), at("KITCHEN", 3.2, 1.0), at("BATH", 1.5, 1.01), at("bath", 2.5, 2.6)]);
    assert.equal(nameAt(plan, 2.5, 1.75), "Bath / Kitchen / Study", "joined in reading order, identical text once");
    assert.equal(report.placed.length, 4);
  }
  // A size label is ignored; a label outside every room and one on the y = 3.5 wall band are unplaced.
  {
    const { plan, report } = named([at("12'0\" x 14'0\"", 2.5, 1.75), at("10.0 m", 8.5, 5.75), at("GARDEN", 12, 4), at("HALL", 2.5, 3.5)]);
    assert.deepEqual(report.placed, [], "no label placed");
    assert.deepEqual(report.unplaced, ["Garden", "Hall"], "outside and wall-band labels unplaced");
    assert.deepEqual(plan.rooms.map((r) => r.name).sort(), ["Room 1", "Room 2", "Room 3", "Room 4"], "sizes never become names");
  }
  // OCR's misread size labels (foot marks read as ° or %, a lost space) are still sizes, never names.
  {
    const { plan } = named([at("Dining", 2.5, 1.2), at("Room", 2.5, 1.6), at("13 X 16°", 2.5, 2.0), at("18 x 1%", 2.5, 2.4), at("15 x19", 2.5, 2.8)]);
    assert.equal(nameAt(plan, 2.5, 1.75), "Dining / Room", "size-like labels are not names");
  }
  console.log("nameRooms: fixtures 02, 03 named; 01 default; joined, size ignored, outside and wall band unplaced, size-like ignored");

  // ------------------------------------------------------------ analyseBlueprint
  // 03: two room-size labels centred in the two top rooms (inner 4.85 × 3.35 m at
  // 03's 20 px exterior / 10 px interior walls). The house origin comes from 01's
  // walls; the fixtures share one layout.
  {
    const size = (cx: number, cy: number): OcrWord => ({ text: "4.85 m x 3.35 m", confidence: 90, box: { x0: origin.x + cx * 100 - 60, y0: origin.y + cy * 100 - 8, x1: origin.x + cx * 100 + 60, y1: origin.y + cy * 100 + 8 } });
    const a = await analyseBlueprint(await load("03_with_dimensions.png"), { ocr: fakeOcr([], [size(2.5, 1.75), size(7.5, 1.75)]) });
    const kinds = (k: string) => a.openings.filter((o) => o.kind === k).length;
    console.log(`03: ${kinds("door")} doors, ${kinds("window")} windows, scale ${a.scale.confidence} ${a.scale.pxPerM?.toFixed(1)} px/m, coverage ${a.coverage.toFixed(3)}, inkCapture ${a.inkCapture.toFixed(3)}, warnings [${codes(a)}]`);
    assert.equal(kinds("door"), 4, "03: 4 doors");
    assert.equal(kinds("window"), 4, "03: 4 windows");
    assert.deepEqual(a.warnings, [], "03: no warnings");
  }
  // 04: tilted 2.2° by its generator.
  {
    const a = await analyseBlueprint(await load("04_fake_scan.jpg"), { ocr: fakeOcr() });
    const rotated = a.warnings.find((w) => w.code === "rotated");
    console.log(`04: angle ${a.angleDeg}°, warnings [${codes(a)}]`);
    assert.ok(rotated && Math.abs(Math.abs(a.angleDeg) - 2.2) <= 0.2, `04: "rotated" near 2.2°, got ${a.angleDeg}`);
  }
  // 01 with nothing read.
  assert.ok(codes(a01).includes("no-scale"), `01: "no-scale", got [${codes(a01)}]`);
  // 01 upscaled 2.5× (2950 px wide), processed at the default 2400.
  {
    const stages: string[] = [];
    const a = await analyseBlueprint(await load("01_clean_uniform.png", 2.5), { ocr: fakeOcr(), onProgress: (s) => stages.push(s) });
    const scale = 2.5 * a.imageScale;
    const fp = footprintCheck(a.walls, 15 * scale, scale);
    console.log(`01 ×2.5: imageScale ${a.imageScale.toFixed(4)}, ${a.pixels.width}×${a.pixels.height}, footprint ${fp.width.toFixed(1)} × ${fp.height.toFixed(1)} px vs ${(1000 * scale).toFixed(1)} × ${(800 * scale).toFixed(1)} ±${fp.tol.toFixed(1)}`);
    assert.notEqual(a.imageScale, 1, "upscaled: downscaled");
    assert.ok(Math.max(a.pixels.width, a.pixels.height) <= 2400, "upscaled: within maxSide");
    assert.ok(fp.pass, "upscaled: footprint shrinks by imageScale");
    assert.deepEqual(stages, [...STAGES], "onProgress: all five stages in order");
  }
  // A scale that is not a finite positive number is refused.
  for (const pxPerM of [0, NaN, -1, Infinity]) assert.throws(() => buildFromAnalysis(a01, { pxPerM, source: "manual" }), /positive number/, `pxPerM ${pxPerM} refused`);

  // What the import screen accepts as a typed length, in metres.
  const typed: [string, number | null][] = [["3.8", 3.8], ["3.8 m", 3.8], ["380 cm", 3.8], ["12'6\"", 3.81], ["12 ft 6 in", 3.81], ["12 ft", 3.6576], ["10m", 10], ["abc", null], ["3 x 4", null]];
  for (const [text, want] of typed) {
    const got = parseTypedLength(text);
    assert.ok(want === null ? got === null : got !== null && Math.abs(got - want) < 1e-9, `parseTypedLength("${text}") = ${got}, want ${want}`);
  }
  console.log("parseTypedLength: metres, centimetres, feet and inches, bare numbers");
  console.log("OK");
}

main();
