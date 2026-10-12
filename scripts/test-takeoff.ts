/**
 * test-takeoff.ts — the Takeoff tool's rules (step M.2a), with the exact arithmetic in comments:
 *   1. units: formatting, parsing through the existing parser, totals rounded once (this test
 *      was written first against a naive sum of the rounded values and failed: '3 mm' !== '2 mm');
 *   2. geometry: shoelace areas (rectangle, L, triangle, either winding), a bowtie refused,
 *      cutouts, polyline lengths, wall faces against wallOutline, the side picker, snapping;
 *   3. rows: tolerance boundaries, overrides, totals, basis from provenance, the stale hash, CSV;
 *   4. the store: each action one undo step with redo; the tool's drafts never touch history;
 *      validatePlan, rooms and collision ignore takeoffs; the autosave round trip;
 *   5. tool shortcuts: unique, not a unit letter, not a walking key.
 * Run: npx tsx scripts/test-takeoff.ts (throws on the first failure).
 */
import assert from "node:assert/strict";
import { samplePlan } from "../src/data/samplePlan";
import { parseStoredPlan, serializePlan } from "../src/lib/persist/planStorage";
import { wallOutline } from "../src/lib/plan/geometry";
import { deriveRooms } from "../src/lib/plan/rooms";
import { validatePlan } from "../src/lib/plan/validate";
import {
  areaWithCutouts,
  CROSSES,
  CUTOUT_OUTSIDE,
  NEEDS_THREE,
  NEEDS_TWO,
  polygonArea,
  polylineLength,
  sideAt,
  snapTakeoffPoint,
  wallFaceLengths,
  type Pt,
} from "../src/lib/takeoff/geometry";
import { basisOf, csvFileName, nextName, tableCells, takeoffRow, takeoffStatus, toCsv, totals, wallsHash, wallTakeoffName } from "../src/lib/takeoff/rows";
import { formatArea, formatAreaTotal, formatLength, formatLengthTotal, parseAreaInput, parseLengthInput } from "../src/lib/units/format";
import { collisionStats, getCollision } from "../src/lib/walk/collision";
import { usePlanStore } from "../src/store/planStore";
import { useTakeoffStore, type TakeoffPointer } from "../src/store/takeoffStore";
import { TOOL_SHORTCUTS, useToolStore } from "../src/store/toolStore";
import type { Plan, Takeoff } from "../src/types/plan";

const close = (a: number, b: number, eps: number, msg: string) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const dist = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(q.x - p.x, q.y - p.y);

// ================================================================= 1. units
{
  assert.equal(formatLength(3.8, "mm"), "3800 mm"); // 3.8 m × 1000
  assert.equal(formatLength(3.8, "m"), "3.800 m");
  assert.equal(formatLength(0.3048, "ftin"), `1'-0"`); // 304.8 mm = 12" exactly
  assert.equal(formatLength(0.3, "ftin"), `11 13/16"`); // 0.3 / 0.0254 = 11.811"; × 16 = 188.98 → 189/16 = 11 13/16
  assert.equal(formatLength(3.81 + 0.0047625, "ftin"), `12'-6 3/16"`); // 3/16" = 4.7625 mm past 12'6"
  assert.equal(formatLength(0.3048 - 0.0001, "ftin"), `1'-0"`, "11.996\" rounds to 192/16 and carries to the next foot"); // 0.3047 / 0.0254 × 16 = 191.94 → 192
  assert.ok(Math.abs(parseLengthInput(`12'6"`, "m")! - 3.81) < 1e-12); // 12.5 ft × 0.3048 = 3.81 m
  assert.ok(Math.abs(parseLengthInput(`12'-6 3/16"`, "m")! - (3.81 + 0.0047625)) < 1e-12, "our own ft-in text reads back");
  close(parseLengthInput("3800", "mm")!, 3.8, 1e-12, "a bare number is in the field's unit: mm");
  assert.equal(parseLengthInput("3.8", "m"), 3.8);
  assert.ok(Math.abs(parseLengthInput("10", "ftin")! - 3.048) < 1e-12, "and feet in ft-in"); // 10 × 0.3048
  close(parseLengthInput("380 cm", "mm")!, 3.8, 1e-12, "a unit typed wins over the field's");
  assert.equal(parseLengthInput("abc", "m"), null);
  assert.equal(formatArea(1, "mm2"), "1,000,000 mm²"); // 1000 mm × 1000 mm
  assert.equal(formatArea(1, "sqft"), "10.764 sq ft"); // 1 / 0.3048² = 10.7639…
  assert.equal(formatArea(12.6, "m2"), "12.600 m²");
  assert.equal(parseAreaInput("12.6", "m2"), 12.6);
  close(parseAreaInput("1,000,000 mm²", "m2")!, 1, 1e-12, "mm² typed");
  close(parseAreaInput("10.7639", "sqft")!, 1, 1e-5, "a bare number in sq ft");
  // Round once: 0.6 mm shows "1 mm"; three of them total 1.8 mm, which shows "2 mm", not 1 + 1 + 1 = "3 mm".
  const v = [0.0006, 0.0006, 0.0006];
  for (const x of v) assert.equal(formatLength(x, "mm"), "1 mm");
  assert.equal(formatLengthTotal(v, "mm"), "2 mm", "the total is summed from unrounded values and rounded once");
  assert.equal(formatAreaTotal([0.0004, 0.0004, 0.0004], "m2"), "0.001 m²"); // each "0.000"; 0.0012 → "0.001"
  console.log("units: ok");
}

// ================================================================= 2. geometry
{
  // A 4.2 × 3.0 rectangle: 4.2 × 3 = 12.6 m², either way round.
  const rect: Pt[] = [[0, 0], [4.2, 0], [4.2, 3], [0, 3]];
  close(polygonArea(rect).value!, 12.6, 1e-12, "rectangle");
  close(polygonArea([...rect].reverse()).value!, 12.6, 1e-12, "clockwise equals counter-clockwise");
  // An L: a 4 × 4 square minus its 2 × 2 top-right corner = 16 − 4 = 12 m².
  const L: Pt[] = [[0, 0], [2, 0], [2, 2], [4, 2], [4, 4], [0, 4]];
  close(polygonArea(L).value!, 12, 1e-12, "L-shape");
  close(polygonArea([...L].reverse()).value!, 12, 1e-12, "L reversed");
  // A triangle with base 3 and height 2: 3 × 2 / 2 = 3 m².
  close(polygonArea([[0, 0], [3, 0], [1, 2]]).value!, 3, 1e-12, "triangle");
  // A bowtie: (0,0) → (2,2) → (2,0) → (0,2) crosses itself at (1,1).
  assert.deepEqual(polygonArea([[0, 0], [2, 2], [2, 0], [0, 2]]), { ok: false, value: null, reason: CROSSES });
  assert.equal(polygonArea([[0, 0], [1, 0]]).reason, NEEDS_THREE);
  // Cutouts: the rectangle minus a 1 × 0.5 cutout = 12.6 − 0.5 = 12.1 m².
  const cut: Pt[] = [[1, 1], [2, 1], [2, 1.5], [1, 1.5]];
  close(areaWithCutouts(rect, [cut]).value!, 12.1, 1e-12, "a cutout subtracts");
  // Two cutouts: 12.6 − 0.5 − 0.25 = 11.85.
  close(areaWithCutouts(rect, [cut, [[3, 2], [3.5, 2], [3.5, 2.5], [3, 2.5]]]).value!, 11.85, 1e-12, "two cutouts");
  // A cutout touching the outline from inside is still inside: 12.6 − 1 × 1 = 11.6.
  close(areaWithCutouts(rect, [[[0, 0], [1, 0], [1, 1], [0, 1]]]).value!, 11.6, 1e-12, "a cutout on the edge");
  assert.equal(areaWithCutouts(rect, [[[4, 1], [5, 1], [5, 2], [4, 2]]]).reason, CUTOUT_OUTSIDE, "half outside");
  assert.equal(areaWithCutouts(rect, [[[6, 1], [7, 1], [7, 2], [6, 2]]]).reason, CUTOUT_OUTSIDE, "wholly outside");
  // In the L's missing corner: every corner on the L's outline, but the cutout lies outside it.
  assert.equal(areaWithCutouts(L, [[[2, 2], [4, 2], [4, 0], [2, 0]]]).reason, CUTOUT_OUTSIDE, "in the notch of an L");
  // Polylines: 3 + 4 = 7; a 3-4-5 diagonal is 5.
  close(polylineLength([[0, 0], [3, 0], [3, 4]]).value!, 7, 1e-12, "polyline");
  close(polylineLength([[0, 0], [3, 4]]).value!, 5, 1e-12, "diagonal");
  assert.equal(polylineLength([[0, 0]]).reason, NEEDS_TWO);
  console.log("areas and lengths: ok");
}

// ---- wall faces on the sample plan
{
  const plan: Plan = structuredClone(samplePlan);
  plan.rooms = deriveRooms(plan).map(({ id, name, wallIds, floorMaterial }) => ({ id, name, wallIds, floorMaterial }));
  // The partition H(0,4) → I(4,4), 0.1 thick: a stem at both ends, so its faces run between the walls it meets:
  // x 0.1 (the 0.2 west wall's inner face) to x 3.95 (the 0.1 B-I-F wall's face) = 3.85 m; centre line 4 m.
  const hi = wallFaceLengths(plan, "w-HI").value!;
  const [aR, bR, bL, aL] = wallOutline(plan.walls.find((w) => w.id === "w-HI")!, plan.walls);
  close(hi.centre, 4, 1e-12, "partition centre line");
  close(hi.left, dist(aL, bL), 1e-12, "partition left face = wallOutline's a-left → b-left");
  close(hi.right, dist(aR, bR), 1e-12, "partition right face = wallOutline's a-right → b-right");
  close(hi.left, 3.85, 1e-12, "3.85 m");
  assert.deepEqual(hi.pieces, ["w-HI"], "a run of one");
  // H → I points east; its left normal (−dy, dx) = (0, 1) points south (plan y is south): Bedroom 2.
  assert.deepEqual(hi.rooms, { left: ["Bedroom 2"], right: ["Bedroom 1"] });
  assert.equal(hi.stepped, false);
  assert.equal(sideAt(0.04, 0.1, 0.005), "left");
  assert.equal(sideAt(-0.04, 0.1, 0.005), "right");
  assert.equal(sideAt(0.0125, 0.1, 0.005), "centre", "the middle quarter: |s| ≤ 0.1 / 8 = 0.0125");
  assert.equal(sideAt(0.013, 0.1, 0.005), "left");
  assert.equal(sideAt(0.02, 0.1, 0.03), "centre", "or 3 px when that is wider");

  // The south outer wall, three pieces E(10,8) → L(7,8) → F(4,8) → G(0,8), all 0.2 thick. Asked from L → F (west):
  // its left is (−dy, dx) = (0, −1), north, the inside. Centre 3 + 3 + 4 = 10 m. Outside face from G's outer
  // corner (−0.1, 8.1) to E's (10.1, 8.1) = 10.2 m; inside from (0.1, 7.9) to (9.9, 7.9) = 9.8 m.
  const south = wallFaceLengths(plan, "w-LF").value!;
  assert.deepEqual(south.pieces, ["w-EL", "w-LF", "w-FG"], "the whole run, in order along L → F");
  close(south.centre, 10, 1e-12, "run centre line");
  close(south.right, 10.2, 1e-12, "outside face");
  close(south.left, 9.8, 1e-12, "inside face");
  const pieces = ["w-EL", "w-LF", "w-FG"].map((id) => wallOutline(plan.walls.find((w) => w.id === id)!, plan.walls));
  // every piece runs west, as w-LF does, so its right face is a-right → b-right: the sum of wallOutline's edges
  close(south.right, pieces.reduce((s, o) => s + dist(o[0], o[1]), 0), 1e-12, "outside = Σ wallOutline right edges");
  close(south.left, pieces.reduce((s, o) => s + dist(o[3], o[2]), 0), 1e-12, "inside = Σ wallOutline left edges");
  assert.deepEqual(south.rooms, { left: ["Bathroom", "Living room", "Bedroom 2"], right: [] });
  // Alt: one piece. L → F with a T stem at both ends: square ends, 3 m each face.
  const one = wallFaceLengths(plan, "w-LF", { run: false }).value!;
  assert.deepEqual(one.pieces, ["w-LF"]);
  close(one.left, 3, 1e-12, "one piece's inside face");
  close(one.right, 3, 1e-12, "one piece's outside face");
  // Asked from E → L (the same run, the same direction) it is the same.
  close(wallFaceLengths(plan, "w-EL").value!.right, 10.2, 1e-12, "same run from another piece");

  // Stepped: w-LF made 0.3 thick. Its faces sit 0.15 off the centre line, its neighbours' 0.1, so each face steps
  // 0.05 at L and at F. Outside: 3.1 (10.1 → 7) + 0.05 + 3 + 0.05 + 4.1 (4 → −0.1) = 10.3; inside: 2.9 + 0.05 + 3 + 0.05 + 3.9 = 9.9.
  const thick = structuredClone(plan);
  thick.walls.find((w) => w.id === "w-LF")!.thickness = 0.3;
  const st = wallFaceLengths(thick, "w-LF").value!;
  assert.equal(st.stepped, true);
  close(st.right, 10.3, 1e-12, "stepped outside face, steps included");
  close(st.left, 9.9, 1e-12, "stepped inside face");
  close(st.centre, 10, 1e-12, "the centre line does not step");
  assert.equal(wallTakeoffName(plan, "w-LF", "right"), "South wall, right face");
  assert.equal(wallTakeoffName(plan, "w-CM", "centre"), "East wall, centre line");

  // Step M.1d: Opening.hinge must not touch a takeoff. Faces come from the walls alone, so hanging
  // every door on the jamb nearer its wall's b end — which M.1c could only hold by turning the wall
  // round, and that WOULD have swapped left and right — changes nothing here.
  const farHinged: Plan = { ...plan, openings: plan.openings.map((o) => (o.kind === "door" ? { ...o, hinge: "b" as const } : o)) };
  for (const id of ["w-HI", "w-LF", "w-EL", "w-CM", "w-BI", "w-BC", "w-KL"]) {
    const was = wallFaceLengths(plan, id).value!;
    const now = wallFaceLengths(farHinged, id).value!;
    assert.deepEqual(now, was, `far-hinged doors leave ${id}'s left and right faces, rooms and pieces exactly as they were`);
    assert.equal(wallTakeoffName(farHinged, id, "left"), wallTakeoffName(plan, id, "left"), `…and ${id}'s left-face label`);
    assert.equal(wallTakeoffName(farHinged, id, "right"), wallTakeoffName(plan, id, "right"), `…and its right-face label`);
  }
  console.log("wall faces: ok (and unchanged by far-hinged doors, step M.1d)");
}

// ---- snapping: corners, then ends, then jambs, then midpoints, then the 5 cm grid
{
  const plan = samplePlan;
  const at = (p: Pt, tol: number, o = {}) => snapTakeoffPoint(plan, p, tol, o).value!;
  assert.deepEqual(at([-0.08, -0.09], 0.1), { point: [-0.1, -0.1], kind: "corner", ortho: false }, "A's outer face corner");
  // At A itself the end (0, 0) is nearer, but a face corner (0.141 m away) is within 0.15 and comes first.
  assert.equal(at([0, 0], 0.15).kind, "corner", "corners beat a nearer wall end");
  assert.deepEqual(at([0.01, 0], 0.05), { point: [0, 0], kind: "endpoint", ortho: false }, "with no corner in reach, the end");
  // The front door on B(4,0) → C(10,0) is centred 3 m along, 1 m wide: jambs at x 6.5 and 7.5, on y 0 and the faces y ±0.1.
  assert.deepEqual(at([6.52, 0.02], 0.05), { point: [6.5, 0], kind: "jamb", ortho: false }, "a door jamb on the centre line");
  assert.deepEqual(at([7.49, 0.09], 0.05), { point: [7.5, 0.1], kind: "jamb", ortho: false }, "a jamb on a face");
  assert.deepEqual(at([2.02, 4.01], 0.05), { point: [2, 4], kind: "midpoint", ortho: false }, "H-I's midpoint");
  assert.deepEqual(at([2.33, 2.47], 0.05), { point: [2.35, 2.45], kind: "grid", ortho: false }, "the 5 cm grid");
  assert.deepEqual(at([2.33, 2.47], 0.05, { snap: false }), { point: [2.33, 2.47], kind: "free", ortho: false }, "Alt: no snap");
  // Shift from (1, 1): the pointer is further across than down, so the point stays level: y = 1.
  assert.deepEqual(at([3.33, 1.2], 0.05, { orthoFrom: [1, 1] }), { point: [3.35, 1], kind: "grid", ortho: true }, "Shift: level");
  assert.deepEqual(at([1.1, 3.33], 0.05, { orthoFrom: [1, 1] }), { point: [1, 3.35], kind: "grid", ortho: true }, "Shift: plumb");
  assert.deepEqual(at([1.1, 3.33], 0.05, { orthoFrom: [1, 1], snap: false }), { point: [1, 3.33], kind: "free", ortho: true }, "Shift + Alt");
  console.log("snapping: ok");
}

// ================================================================= 3. rows
{
  // Lengths: max(2 mm, 0.2%). For 4 m that is 8 mm: 4.008 is OK, 4.0081 (0.1 mm beyond) is Flagged.
  assert.equal(takeoffStatus("length", 4.008, 4), "ok");
  assert.equal(takeoffStatus("length", 3.992, 4), "ok");
  assert.equal(takeoffStatus("length", 4.0081, 4), "flagged");
  // For 0.5 m, 0.2% is 1 mm, so the 2 mm floor applies: 0.502 OK, 0.5021 Flagged.
  assert.equal(takeoffStatus("length", 0.502, 0.5), "ok");
  assert.equal(takeoffStatus("length", 0.5021, 0.5), "flagged");
  // Areas: max(0.005 m², 0.4%). For 10 m² that is 0.04: 10.04 OK, 10.0401 Flagged.
  assert.equal(takeoffStatus("area", 10.04, 10), "ok");
  assert.equal(takeoffStatus("area", 10.0401, 10), "flagged");
  // For 1 m², 0.4% is 0.004, so the 0.005 floor applies: 1.005 OK, 1.0051 Flagged.
  assert.equal(takeoffStatus("area", 1.005, 1), "ok");
  assert.equal(takeoffStatus("area", 1.0051, 1), "flagged");
  assert.equal(takeoffStatus("length", 4, undefined), "none", "no reference");

  const plan: Plan = structuredClone(samplePlan);
  const hash = wallsHash(plan.walls);
  const len: Takeoff = { id: "t1", name: "Length 1", kind: "length", points: [[1, 1], [5.062, 1]], reference: { value: 4 }, override: { value: 4.1, note: "site" }, wallsHash: hash };
  const row = takeoffRow(plan, len);
  close(row.measured!, 4.062, 1e-12, "measured kept");
  close(row.effective!, 4.1, 1e-12, "effective is the override");
  close(row.difference!, 0.062, 1e-12, "difference from the measured value, not the override");
  assert.equal(row.status, "flagged", "62 mm out of 8 mm: Flagged; the override does not hide it");
  // Totals from unrounded values: 4.062 + 5 measured; 4.1 + 5 effective; areas 12.6.
  const rows = [row, takeoffRow(plan, { id: "t2", name: "Length 2", kind: "length", points: [[0, 0], [3, 4]], wallsHash: hash }), takeoffRow(plan, { id: "t3", name: "Area 1", kind: "area", points: [[0, 0], [4.2, 0], [4.2, 3], [0, 3]], wallsHash: hash })];
  const tot = totals(rows);
  close(tot.lengthMeasured, 9.062, 1e-12, "lengths measured");
  close(tot.lengthEffective, 9.1, 1e-12, "lengths effective");
  close(tot.areaMeasured, 12.6, 1e-12, "areas");
  assert.equal(nextName(rows.map((r) => r.takeoff), "length"), "Length 3");
  assert.equal(nextName(rows.map((r) => r.takeoff), "area"), "Area 2");

  // CSV: the measured, override and effective values in their own columns, in the chosen units; names escaped.
  const tricky = takeoffRow(plan, { ...len, name: `Hall, "east"\nwall` });
  const cells = tableCells([tricky], { length: "mm", area: "m2" });
  assert.deepEqual(cells[0], ["name", "kind", "basis", "measured (mm | m²)", "reference (mm | m²)", "difference (mm | m²)", "status", "override (mm | m²)", "override note", "effective (mm | m²)", "stale"]);
  assert.deepEqual(cells[1], [`Hall, "east"\nwall`, "length", "Free points", "4062", "4000", "62.0", "Flagged", "4100", "site", "4100", "no"]);
  const csv = toCsv(cells);
  assert.ok(csv.includes(`"Hall, ""east""\nwall",length`), "comma, quotes and the line break are quoted and the quotes doubled");
  assert.equal(csvFileName("Two-bedroom house"), "two-bedroom-house-takeoffs.csv");
  assert.equal(tableCells([tricky], { length: "ftin", area: "sqft" })[1][3], `13'-3 15/16"`, "ft-in in the CSV"); // 4.062 / 0.0254 = 159.92" → 2559/16 = 13' 3 15/16"

  // Basis: the worst provenance among the walls the points sit on.
  const pdf: Plan = structuredClone(samplePlan);
  for (const w of pdf.walls) w.provenance = "vector";
  pdf.walls.find((w) => w.id === "w-HI")!.provenance = "traced";
  pdf.walls.find((w) => w.id === "w-CM")!.edited = true;
  assert.equal(basisOf(pdf, [[-0.1, -0.1], [4, 0]]), "PDF exact", "an outer corner and B, all vector walls");
  assert.equal(basisOf(pdf, [[-0.1, -0.1], [2, 4]]), "Traced approximate", "one point on the traced partition's midpoint");
  assert.equal(basisOf(pdf, [[10, 2.5], [4, 0]]), "Drawn", "C-M was edited: no longer the PDF's numbers");
  assert.equal(basisOf(samplePlan, [[0, 0], [4, 0]]), "Drawn", "the sample's walls are drawn");
  assert.equal(basisOf(samplePlan, [[1.234, 2.345], [2.5, 2.5]]), "Free points", "no point on a wall");
  console.log("rows: ok");
}

// ================================================================= 4. the store
const s = () => usePlanStore.getState();
const fresh = () => s().loadPlan(structuredClone(samplePlan));
{
  fresh();
  const baseRooms = JSON.stringify(s().plan.rooms);
  const baseProblems = validatePlan(s().plan);
  getCollision(s().plan);
  const builds = collisionStats.builds;

  // add: one undo step, with redo
  const id = s().addTakeoff({ name: "Length 1", kind: "length", points: [[0, 0], [4, 0]] });
  assert.equal(s().past.length, 1, "add is one undo step");
  assert.equal(s().plan.takeoffs![0].wallsHash, wallsHash(s().plan.walls), "stamped with the walls' hash");
  s().undo();
  assert.equal(s().plan.takeoffs, undefined, "undo removes it, back to a plan with no takeoffs at all");
  s().redo();
  assert.equal(s().plan.takeoffs![0].id, id, "redo brings it back");

  // update: rename, reference, override, cutouts — one step each
  for (const [changes, check] of [
    [{ name: "Hall" }, () => assert.equal(s().plan.takeoffs![0].name, "Hall")],
    [{ reference: { value: 4.002 } }, () => assert.equal(s().plan.takeoffs![0].reference!.value, 4.002)],
    [{ override: { value: 4.1, note: "as built" } }, () => assert.deepEqual(s().plan.takeoffs![0].override, { value: 4.1, note: "as built" })],
  ] as const) {
    const n = s().past.length;
    s().updateTakeoff(id, changes);
    check();
    assert.equal(s().past.length, n + 1, `${JSON.stringify(changes)} is one step`);
    s().undo();
    s().redo();
    check();
  }
  const row = takeoffRow(s().plan, s().plan.takeoffs![0]);
  close(row.measured!, 4, 1e-12, "the override never replaces the measured value");
  close(row.effective!, 4.1, 1e-12, "it is the effective one");
  s().updateTakeoff(id, { override: null });
  assert.ok(!("override" in s().plan.takeoffs![0]), "null clears it");
  s().undo();

  // area with a cutout
  const aid = s().addTakeoff({ name: "Area 1", kind: "area", points: [[0.1, 0.1], [3.95, 0.1], [3.95, 3.95], [0.1, 3.95]] });
  const n = s().past.length;
  s().updateTakeoff(aid, { cutouts: [[[1, 1], [2, 1], [2, 2], [1, 2]]] });
  assert.equal(s().past.length, n + 1, "a cutout is one step");
  close(takeoffRow(s().plan, s().plan.takeoffs!.find((t) => t.id === aid)!).measured!, 14.8225 - 1, 1e-9, "3.85² − 1 = 13.8225 m²");

  // takeoffs leave walls, rooms, the validator and collision alone
  assert.equal(JSON.stringify(s().plan.rooms), baseRooms, "rooms unchanged");
  assert.deepEqual(validatePlan(s().plan), baseProblems, "validatePlan ignores takeoffs");
  getCollision(s().plan);
  assert.equal(collisionStats.builds, builds, "collision is not rebuilt: plan.walls and plan.openings are the same arrays");

  // stale after a wall edit, current again after Mark as current (one step)
  s().updateWall("w-HI", { thickness: 0.12 });
  assert.equal(takeoffRow(s().plan, s().plan.takeoffs![0]).stale, true, "a wall edit makes it stale");
  const m = s().past.length;
  s().markTakeoffCurrent(id);
  assert.equal(s().past.length, m + 1, "Mark as current is one step");
  assert.equal(takeoffRow(s().plan, s().plan.takeoffs![0]).stale, false, "and clears the marker");
  s().undo();
  assert.equal(takeoffRow(s().plan, s().plan.takeoffs![0]).stale, true, "undo brings the marker back");

  // delete: one step, undo restores it exactly
  const before = structuredClone(s().plan.takeoffs);
  const k = s().past.length;
  s().deleteTakeoff(id);
  assert.equal(s().past.length, k + 1);
  assert.ok(!s().plan.takeoffs!.some((t) => t.id === id));
  s().undo();
  assert.deepEqual(s().plan.takeoffs, before, "undo restores the deleted takeoff");

  // the autosave carries them and stays small
  const raw = serializePlan(s().plan);
  assert.deepEqual(parseStoredPlan(raw)!.takeoffs, s().plan.takeoffs, "takeoffs round-trip");
  const without = serializePlan({ ...s().plan, takeoffs: undefined });
  assert.ok(raw.length - without.length < 1000, `two takeoffs add ${raw.length - without.length} bytes`);
  assert.ok(!raw.includes("selectedId") && !raw.includes("draft") && !raw.includes("mode"), "no tool state in the autosave");
  console.log(`store: ok (two takeoffs add ${raw.length - without.length} bytes to the autosave)`);
}

// ---- the tool: drafts never touch history; finishing is one step
{
  fresh();
  useToolStore.getState().setTool("takeoff");
  const t = () => useTakeoffStore.getState();
  const ptr = (x: number, y: number, o: Partial<TakeoffPointer> = {}): TakeoffPointer => ({ at: [x, y], px: 0.01, touch: false, alt: false, shift: false, ...o });
  // Length: two corners of the south wall's outside face, (−0.1, 8.1) and (10.1, 8.1): 10.2 m.
  t().setMode("length");
  t().click(ptr(-0.12, 8.11));
  t().click(ptr(10.08, 8.12));
  assert.deepEqual(t().draft, [[-0.1, 8.1], [10.1, 8.1]], "both snapped to face corners (12 px × 0.01 m = 0.12 m reach)");
  assert.equal(s().past.length, 0, "a draft is not in history");
  t().click(ptr(10.1, 8.1)); // the second click of a double-click lands on the same point
  assert.equal(t().draft.length, 2, "ignored");
  t().finish();
  assert.equal(s().past.length, 1, "finishing is one step");
  const L = s().plan.takeoffs![0];
  assert.equal(L.name, "Length 1");
  close(polylineLength(L.points).value!, 10.2, 1e-12, "10.2 m");
  assert.equal(t().selectedId, L.id, "and selected");
  // Escape (cancel) mid-draw: history unchanged.
  t().click(ptr(1, 1));
  t().click(ptr(2, 1));
  t().cancel();
  assert.equal(s().past.length, 1, "cancel leaves history as it was");
  assert.deepEqual(t().draft, []);
  // Undo point.
  t().click(ptr(1, 1));
  t().click(ptr(2, 1));
  t().undoPoint();
  assert.equal(t().draft.length, 1, "Undo point drops the last one");
  t().cancel();

  // Area: Bedroom 1's four inner corners (0.1, 0.1) … (3.95, 3.95), closed by clicking the first: 3.85² = 14.8225 m².
  t().setMode("area");
  for (const [x, y] of [[0.12, 0.11], [3.94, 0.12], [3.96, 3.94], [0.11, 3.93], [0.13, 0.12]] as const) t().click(ptr(x, y));
  const A = s().plan.takeoffs![1];
  assert.equal(A.name, "Area 1");
  close(polygonArea(A.points).value!, 14.8225, 1e-9, "Bedroom 1's net area");
  assert.equal(s().past.length, 2);
  // A cutout outside the area is refused with the reason, and records nothing.
  t().startCutout(A.id);
  for (const [x, y] of [[5, 1], [6, 1], [6, 2]] as const) t().click(ptr(x, y, { alt: true }));
  t().finish();
  assert.equal(t().message, CUTOUT_OUTSIDE);
  assert.equal(s().past.length, 2, "a refused cutout records nothing");
  t().cancel();
  // A 1 × 1 cutout inside: 14.8225 − 1 = 13.8225 m².
  t().startCutout(A.id);
  for (const [x, y] of [[1, 1], [2, 1], [2, 2], [1, 2]] as const) t().click(ptr(x, y, { alt: true }));
  t().finish();
  assert.equal(s().past.length, 3, "an accepted cutout is one step");
  close(takeoffRow(s().plan, s().plan.takeoffs![1]).measured!, 13.8225, 1e-9, "the cutout subtracts");
  // A bowtie is refused and the draft stays to fix.
  for (const [x, y] of [[1, 5], [3, 7], [3, 5], [1, 7]] as const) t().click(ptr(x, y, { alt: true }));
  t().finish();
  assert.equal(t().message, CROSSES);
  assert.equal(t().draft.length, 4, "the draft stays");
  t().cancel();

  // Wall: the partition's left face, pointing 3.5 cm south of its centre line at x 2. The centre line reaches
  // max(0.1 / 8, 3 px × 0.01 m) = max(0.0125, 0.03) = 0.03 m each side, so 0.035 is the left (south) face.
  t().setMode("wall");
  t().click(ptr(2, 4.035));
  const W = s().plan.takeoffs![2];
  assert.equal(W.name, "North wall, left face"); // its middle (2, 4) is not south of the walls' centre (5, 4)
  close(polylineLength(W.points).value!, 3.85, 1e-12, "the partition's left face");
  t().click(ptr(2, 4.0));
  close(polylineLength(s().plan.takeoffs![3].points).value!, 4, 1e-12, "the centre line");
  t().setWallSide("right");
  t().click(ptr(2, 4.04)); // the toggle wins over the pointer's side (the touch path)
  assert.equal(s().plan.takeoffs![4].name, "North wall, right face");
  t().setWallSide(null);
  // Alt: one piece of the south run.
  t().click(ptr(5.5, 8.05, { alt: true }));
  close(polylineLength(s().plan.takeoffs![5].points).value!, 3, 1e-12, "Alt measures w-LF alone");
  assert.equal(s().past.length, 7, "each wall click is one step");
  // leaving the tool drops a draft
  t().setMode("length");
  t().click(ptr(1, 1));
  useToolStore.getState().setTool("select");
  assert.deepEqual(t().draft, [], "leaving the tool drops the draft");
  console.log("tool: ok");
}

// ================================================================= 5. shortcuts
{
  const keys = Object.values(TOOL_SHORTCUTS);
  assert.equal(new Set(keys).size, keys.length, `no two tools share a shortcut: ${JSON.stringify(TOOL_SHORTCUTS)}`);
  assert.equal(TOOL_SHORTCUTS.takeoff, "k");
  for (const k of keys) {
    assert.ok(!/^[0-9.,'"+\-cmftin %°]$/i.test(k!), `${k} is not a key a typed distance, angle or percentage uses`);
    assert.ok(!"wasd".includes(k!), `${k} is not a walking key`);
  }
  console.log("shortcuts: ok");
}

console.log("OK");
