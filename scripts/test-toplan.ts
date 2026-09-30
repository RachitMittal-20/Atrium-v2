/**
 * test-toplan.ts — checks src/lib/blueprint/toPlan.ts (buildPlan) two ways.
 *
 * 1. Fixtures 01–04 (tracked in tests/fixtures), run the way the pipeline runs
 *    them (deskew, walls, vectorize, detectOpenings on the deskewed unfilled
 *    image), then buildPlan at the true 100 px/m (source "manual") and loaded
 *    into the plan store with loadPlan. Truth: the 10 × 8 m house of
 *    footprint.ts, openings as in TRUTH there, wall thicknesses as the
 *    generator drew them (GENERATOR_T). Asserted per image:
 *    (i) validatePlan finds no problems;
 *    (ii) 4 doors and 4 windows, each matched one to one to a truth opening of
 *        its kind on the same wall line, centre and width within tolerance
 *        (expected width = nominal − the wall's generator thickness, as in
 *        test-openings.ts);
 *    (iii) the store derives exactly 4 rooms, net areas within tolerance of
 *        the hand-computed values below;
 *    (iv) total wall length within tolerance of the 54 m of centre line.
 * 2. Hand-built pixel walls and gaps (no image): a gap over 4 m is not bridged
 *    and is reported; a 3 m gap stays an opening and is flagged wide; a window
 *    ending at a T-joint lands in one piece, and one whose T-joint falls
 *    inside it is moved into one piece and reported; removeWalls drops a wall
 *    (and a gap that loses its wall is reported, not dropped); a wall whose
 *    two ends round onto one joint is removed and listed in removedWalls; a
 *    scale of 0, NaN or a negative number is refused.
 * The tolerances were fixed before the first run and are not tuned.
 * Run: npx tsx scripts/test-toplan.ts
 */
import assert from "node:assert/strict";
import sharp from "sharp";
import { deskew } from "../src/lib/blueprint/deskew";
import { detectWalls } from "../src/lib/blueprint/hollowWalls";
import { detectOpenings } from "../src/lib/blueprint/openings";
import { buildPlan } from "../src/lib/blueprint/toPlan";
import { vectorize } from "../src/lib/blueprint/vectorize";
import { wallDirection, wallLength } from "../src/lib/plan/geometry";
import { deriveRooms, pointInPolygon } from "../src/lib/plan/rooms";
import { validatePlan } from "../src/lib/plan/validate";
import { usePlanStore } from "../src/store/planStore";
import type { BuildInput, OpeningCandidate, PixelWall } from "../src/types/blueprint";
import type { Opening, Plan } from "../src/types/plan";
import { exterior, GENERATOR_T, TRUTH } from "./footprint";

const TOL = { centreM: 0.15, widthM: 0.2, areaPct: 3, lengthPct: 2 };
console.log(
  `tolerances: opening centre ±${TOL.centreM} m, width ±${TOL.widthM} m, room area ±${TOL.areaPct}%, total wall length ±${TOL.lengthPct}%`,
);
const MANUAL_100 = { pxPerM: 100, source: "manual" as const };

async function load(file: string) {
  const { data, info } = await sharp(file).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return deskew({ width: info.width, height: info.height, rgba: data }).pixels;
}

// ------------------------------------------------------------ 1. fixtures
/**
 * The house's four rooms, centre line to centre line (metres):
 *   top-left  x 0–5,  y 0–3.5    top-right    x 5–10, y 0–3.5
 *   bottom-left x 0–7, y 3.5–8   bottom-right x 7–10, y 3.5–8
 * Every room has one exterior and one interior wall across each axis (e.g.
 * top-left: exterior left and top, interior x = 5 and y = 3.5), so its net
 * floor is the centre-line box less half an exterior and half an interior
 * thickness each way:  net = (W − (tE + tI)/2) × (H − (tE + tI)/2).
 *   01 (0.15, 0.15): s = 0.15  → 4.85 × 3.35 = 16.2475, twice; 6.85 × 4.35 = 29.7975; 2.85 × 4.35 = 12.3975
 *   02 (0.25, 0.08): s = 0.165 → 4.835 × 3.335 = 16.1247, twice; 6.835 × 4.335 = 29.6297; 2.835 × 4.335 = 12.2897
 *   03, 04 (0.20, 0.10): s = 0.15 → the same as 01
 */
const ROOMS = [
  { name: "top-left", x0: 0, y0: 0, x1: 5, y1: 3.5 },
  { name: "top-right", x0: 5, y0: 0, x1: 10, y1: 3.5 },
  { name: "bottom-left", x0: 0, y0: 3.5, x1: 7, y1: 8 },
  { name: "bottom-right", x0: 7, y0: 3.5, x1: 10, y1: 8 },
];
const TRUE_LENGTH = 2 * (10 + 8) + 10 + 3.5 + 4.5; // exterior ring + y = 3.5 + x = 5 (to 3.5) + x = 7 (from 3.5) = 54 m

/** Opening centre in plan metres. */
function centreOf(o: Opening, plan: Plan) {
  const w = plan.walls.find((x) => x.id === o.wallId)!;
  const d = wallDirection(w);
  return { w, x: w.a.x + d.x * o.offset, y: w.a.y + d.y * o.offset };
}

async function fixtures() {
  const failures: string[] = []; // collected so one run shows every miss, then asserted empty
  const s = () => usePlanStore.getState();
  for (const [file, [tExtPx, tIntPx]] of Object.entries(GENERATOR_T)) {
    const pixels = await load(`tests/fixtures/${file}`);
    const { walls } = vectorize(detectWalls(pixels).mask);
    const { openings, unpaired } = detectOpenings(walls, pixels);
    const { plan, report } = buildPlan({ walls, openings, unpaired, imageSize: { width: pixels.width, height: pixels.height }, name: file }, MANUAL_100);
    s().loadPlan(plan);
    const stored = s().plan;
    const [tE, tI] = [tExtPx / 100, tIntPx / 100];

    // (i)
    const problems = validatePlan(stored);
    if (problems.length) failures.push(`${file}: validatePlan: ${problems.join("; ")}`);

    // (ii)
    const kinds = (k: string) => stored.openings.filter((o) => o.kind === k).length;
    console.log(`\n${file}: ${stored.walls.length} walls, ${kinds("door")} doors, ${kinds("window")} windows; report: ${report.wideOpenings.length} wide, ${report.droppedPairs.length} dropped, ${report.unbridged.length} unbridged, ${report.adjusted.length} adjusted, ${report.freeEnds.length} free ends`);
    if (kinds("door") !== 4 || kinds("window") !== 4) failures.push(`${file}: ${kinds("door")} doors, ${kinds("window")} windows; want 4, 4`);
    const used = new Set<Opening>();
    for (const t of TRUTH) {
      const centre = (t.from + t.to) / 2;
      const want = t.to - t.from - (exterior(t) ? tE : tI);
      const where = `${t.kind} on ${t.h ? "y" : "x"}=${t.line} at ${t.from}–${t.to} m`;
      const m = stored.openings.find((o) => {
        const c = centreOf(o, stored);
        const h = Math.abs(c.w.b.x - c.w.a.x) >= Math.abs(c.w.b.y - c.w.a.y);
        const [across, along] = h ? [c.y, c.x] : [c.x, c.y];
        return !used.has(o) && o.kind === t.kind && h === t.h && Math.abs(across - t.line) <= c.w.thickness / 2 && Math.abs(along - centre) <= TOL.centreM;
      });
      if (!m) {
        failures.push(`${file}: no ${where} within ±${TOL.centreM} m`);
        continue;
      }
      used.add(m);
      const c = centreOf(m, stored);
      const off = (t.h ? c.x : c.y) - centre;
      const ok = Math.abs(m.width - want) <= TOL.widthM;
      const line = `${where}: wall ${m.wallId}, centre ${off >= 0 ? "+" : ""}${off.toFixed(2)} m, width ${m.width} vs ${want.toFixed(2)} m`;
      console.log(`  ${ok ? "PASS" : "FAIL"} ${line}`);
      if (!ok) failures.push(`${file}: ${line}`);
    }

    // (iii)
    const derived = deriveRooms(stored);
    if (derived.length !== 4) failures.push(`${file}: ${derived.length} rooms derived; want 4`);
    const inset = (tE + tI) / 2;
    for (const r of ROOMS) {
      const want = (r.x1 - r.x0 - inset) * (r.y1 - r.y0 - inset);
      const got = derived.find((d) => pointInPolygon({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 }, d.polygon));
      const pct = got ? ((got.area - want) / want) * 100 : NaN;
      const ok = Math.abs(pct) <= TOL.areaPct;
      const line = `room ${r.name}: ${got ? got.area.toFixed(3) : "none"} m² vs ${want.toFixed(3)} m² (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`;
      console.log(`  ${ok ? "PASS" : "FAIL"} ${line}`);
      if (!ok) failures.push(`${file}: ${line}`);
    }

    // (iv)
    const total = stored.walls.reduce((sum, w) => sum + wallLength(w), 0);
    const lengthPct = ((total - TRUE_LENGTH) / TRUE_LENGTH) * 100;
    const lengthOk = Math.abs(lengthPct) <= TOL.lengthPct;
    const line = `total wall length ${total.toFixed(2)} m vs ${TRUE_LENGTH} m (${lengthPct >= 0 ? "+" : ""}${lengthPct.toFixed(2)}%)`;
    console.log(`  ${lengthOk ? "PASS" : "FAIL"} ${line}`);
    if (!lengthOk) failures.push(`${file}: ${line}`);
  }
  assert.deepEqual(failures, [], `fixtures:\n  ${failures.join("\n  ")}`);
}

// ------------------------------------------------------------ 2. hand-built
// Written in metres, turned into pixels at 100 px/m with the page origin at (50, 50) px.
type M2 = [number, number];
const px = ([x, y]: M2) => ({ x: 50 + x * 100, y: 50 + y * 100 });
const W = (a: M2, b: M2, t = 0.2): PixelWall => ({ a: px(a), b: px(b), thickness: t * 100 });
const gap = (a: M2, b: M2, kind: "door" | "window" = "door", t = 0.2): OpeningCandidate => {
  const [A, B] = [px(a), px(b)];
  return { a: A, b: B, centre: { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }, widthPx: Math.hypot(B.x - A.x, B.y - A.y), wallThicknessPx: t * 100, kind, evidence: { glazingLine: kind === "window" } };
};
/** A 10 × 8 m box whose top wall is given as pieces; `bottom` defaults to one wall. */
const box = (top: PixelWall[], more: PixelWall[] = [], bottom: PixelWall[] = [W([0, 8], [10, 8])]) => [...top, W([10, 0], [10, 8]), ...bottom, W([0, 0], [0, 8]), ...more];
const input = (walls: PixelWall[], openings: OpeningCandidate[]): BuildInput => ({ walls, openings, unpaired: [], imageSize: { width: 1100, height: 900 }, name: "hand-built" });
const has = (list: { x: number; y: number }[], x: number, y: number) => list.some((p) => Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9);

// A 4.5 m gap is not bridged: both wall ends stay free and the pair is reported.
{
  const { plan, report } = buildPlan(input(box([W([0, 0], [2, 0]), W([6.5, 0], [10, 0])]), [gap([2, 0], [6.5, 0])]), MANUAL_100);
  assert.equal(report.droppedPairs.length, 1, "4.5 m gap: reported in droppedPairs");
  assert.equal(report.droppedPairs[0].widthM, 4.5);
  assert.equal(plan.openings.length, 0, "4.5 m gap: no opening");
  assert.ok(has(report.freeEnds, 2, 0) && has(report.freeEnds, 6.5, 0), `4.5 m gap: its ends stay free, got ${JSON.stringify(report.freeEnds)}`);
  assert.equal(plan.walls.length, 5, "4.5 m gap: both top pieces kept");
}

// A 3 m gap stays an opening, flagged wide, and the two pieces become one wall.
{
  const { plan, report } = buildPlan(input(box([W([0, 0], [2, 0]), W([5, 0], [10, 0])]), [gap([2, 0], [5, 0])]), MANUAL_100);
  assert.deepEqual(report.wideOpenings, [{ openingId: "o1", kind: "door", widthM: 3 }], "3 m gap: flagged wide");
  assert.deepEqual(plan.openings.map(({ wallId, kind, offset, width }) => ({ wallId, kind, offset, width })), [{ wallId: "p1+p2", kind: "door", offset: 3.5, width: 3 }], "3 m gap: one door inside the merged wall");
  assert.deepEqual(plan.walls.find((w) => w.id === "p1+p2")!.a, { x: 0, y: 0 });
  assert.deepEqual(validatePlan(plan), [], "3 m gap: valid");
}

// A window ending exactly at a T-joint (x 3.5, where an interior wall meets the top) lands in one piece.
{
  const walls = box([W([0, 0], [2, 0]), W([3.5, 0], [10, 0])], [W([3.5, 0], [3.5, 8], 0.1)], [W([0, 8], [3.5, 8]), W([3.5, 8], [10, 8])]);
  const { plan, report } = buildPlan(input(walls, [gap([2, 0], [3.5, 0], "window")]), MANUAL_100);
  assert.deepEqual(plan.walls.filter((w) => w.id.startsWith("p1+p2")).map((w) => [w.id, w.a.x, w.b.x]), [["p1+p2.1", 0, 3.5], ["p1+p2.2", 3.5, 10]], "T-joint: merged top wall split at 3.5");
  assert.deepEqual(plan.openings.map(({ wallId, offset, width }) => ({ wallId, offset, width })), [{ wallId: "p1+p2.1", offset: 2.75, width: 1.5 }], "T-joint: window in the first piece");
  assert.deepEqual(report.adjusted, [], "T-joint: nothing moved");
  assert.deepEqual(validatePlan(plan), [], "T-joint: valid");
}

// The T-joint (x 3.4) falls 0.1 m inside the window gap (2–3.5): the window is moved into one piece and reported.
{
  const walls = box([W([0, 0], [2, 0]), W([3.5, 0], [10, 0])], [W([3.4, 0], [3.4, 8], 0.1)], [W([0, 8], [3.4, 8]), W([3.4, 8], [10, 8])]);
  const { plan, report } = buildPlan(input(walls, [gap([2, 0], [3.5, 0], "window")]), MANUAL_100);
  assert.deepEqual(plan.openings.map(({ wallId, offset, width }) => ({ wallId, offset, width })), [{ wallId: "p1+p2.1", offset: 2.65, width: 1.5 }], "straddling window: moved inside the first piece");
  assert.equal(report.adjusted.length, 1, "straddling window: reported in adjusted");
  assert.deepEqual(validatePlan(plan), [], "straddling window: valid");
}

// removeWalls drops a wall; a gap that loses its wall is reported, not silently dropped.
{
  const walls = box([W([0, 0], [4, 0]), W([4, 0], [10, 0])], [W([4, 0], [4, 8], 0.1)], [W([0, 8], [4, 8]), W([4, 8], [10, 8])]); // p8 = the interior wall
  const { plan } = buildPlan(input(walls, []), MANUAL_100, { removeWalls: ["p8"] });
  assert.equal(plan.walls.some((w) => w.id === "p8"), false, "removeWalls: p8 gone");
  assert.equal(plan.walls.length, 7, "removeWalls: the other 7 kept");
  assert.deepEqual(validatePlan(plan), [], "removeWalls: the split outer walls still join end to end");

  const cut = buildPlan(input(box([W([0, 0], [2, 0]), W([3, 0], [10, 0])]), [gap([2, 0], [3, 0])]), MANUAL_100, { removeWalls: ["p2"] });
  assert.equal(cut.plan.openings.length, 0, "removed gap wall: no opening");
  assert.equal(cut.report.unbridged.length, 1, "removed gap wall: reported in unbridged");
}

// A stub shorter than a centimetre whose ends go to two joints that round to one
// point (08's p44 is the real case) is removed and reported, and the plan stays valid.
{
  const stub = { a: px([5, 0]), b: { x: px([5, 0]).x, y: px([5, 0]).y + 0.4 }, thickness: 20 }; // listed first, so it seeds both joints
  const { plan, report } = buildPlan(input([stub, ...box([W([0, 0], [5, 0]), W([5, 0], [10, 0])])], []), MANUAL_100);
  assert.equal(plan.walls.some((w) => w.id === "p1"), false, "collapsed wall: p1 not in the plan");
  assert.deepEqual(report.removedWalls.map(({ id, lengthPx }) => ({ id, lengthPx: Math.round(lengthPx * 10) / 10 })), [{ id: "p1", lengthPx: 0.4 }], "collapsed wall: reported");
  assert.deepEqual(validatePlan(plan), [], "collapsed wall: valid");
}

// A scale that is not a finite positive number is refused.
for (const pxPerM of [0, NaN, -100, Infinity])
  assert.throws(() => buildPlan(input(box([W([0, 0], [10, 0])]), []), { pxPerM, source: "manual" }), /positive number/, `pxPerM ${pxPerM} refused`);
console.log("\nhand-built: 4.5 m gap dropped, 3 m gap wide, window at a T-joint, window straddling a T-joint, removeWalls, collapsed wall, bad scales");

fixtures().then(() => console.log("OK"));
