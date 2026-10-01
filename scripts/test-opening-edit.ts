/**
 * test-opening-edit.ts — asserts for editable doors and windows (step 4.5): the
 * pure opening rules in src/lib/plan/edit.ts (usable span, placement, snapping,
 * slide, resize, height and sill, picking), the explicit door swing side and
 * its migration, and the store path the editor takes (placeOpening, flipDoor,
 * updateOpening, deleteOpening) as single undo steps. Also how openings ride
 * through wall edits and the 4.4 wall split. Pure Node, no browser.
 *
 * Each block runs on its own and reports, so a run against unfinished code lists
 * every failing block instead of stopping at the first. Exits 1 if any failed.
 * Run: npx tsx scripts/test-opening-edit.ts
 */
import assert from "node:assert/strict";
import { samplePlan } from "../src/data/samplePlan";
import * as edit from "../src/lib/plan/edit";
import { dist, JOINT_EPS, wallLength } from "../src/lib/plan/geometry";
import { deriveRooms } from "../src/lib/plan/rooms";
import { validatePlan } from "../src/lib/plan/validate";
import { doorSwing, openingFrame } from "../src/lib/plan2d/openings";
import { usePlanStore } from "../src/store/planStore";
import type { Opening, Plan, Wall } from "../src/types/plan";

const s = () => usePlanStore.getState();
const reset = () => s().loadPlan(structuredClone(samplePlan));
const op = (plan: Plan, id: string) => plan.openings.find((o) => o.id === id)!;
const wallIn = (plan: Plan, id: string) => plan.walls.find((w) => w.id === id)!;
const close = (a: number, b: number, eps: number, msg: string) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
/** An opening's centre in plan space: what must not move when its wall is split. */
const centreOf = (plan: Plan, o: Opening) => openingFrame(wallIn(plan, o.wallId), o).centre;
/** Every opening inside [0, wall length] and no two overlapping: the validator's own rules. */
const openingsValid = (plan: Plan) => validatePlan(plan).filter((p) => /^Opening/.test(p));

const EPS = 1e-9; // lengths and offsets, metres
const POS_EPS = 1e-6; // plan-space positions after a split, metres

let failed = 0;
function block(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok    ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}\n        ${(e as Error).message.split("\n")[0]}`);
  }
}

console.log("tolerances:");
try {
  console.log(
    [
      `  opening width ${edit.OPENING_WIDTH_RANGE[0]}–${edit.OPENING_WIDTH_RANGE[1]} m; new door ${edit.OPENING_DEFAULTS.door.width} m wide, ${edit.OPENING_DEFAULTS.door.height} m high; new window ${edit.OPENING_DEFAULTS.window.width} m wide, ${edit.OPENING_DEFAULTS.window.height} m high on a ${edit.OPENING_DEFAULTS.window.sillHeight} m sill`,
      `  door height ${edit.DOOR_HEIGHT_MIN} m to the wall's height; window height from ${edit.WINDOW_HEIGHT_MIN} m; sill + height never above the wall`,
      `  usable span: each wall end loses half the thickness of the thickest non-collinear wall meeting it (more at a slanted joint, at most 4 half-thicknesses); centres snap to the wall's midpoint within the snap reach, else to ${edit.OPENING_STEP} m along the wall`,
      `  offsets and widths round to ${edit.ROUND_STEP} m; legacy doors get swing "${edit.LEGACY_SWING}"`,
      `  this file compares lengths to ${EPS} m and plan positions after a split to ${POS_EPS} m; joints within ${JOINT_EPS} m are one joint`,
    ].join("\n"),
  );
} catch (e) {
  failed++;
  console.log(`  FAIL  tolerances are not exported: ${(e as Error).message}`);
}

block("migration: doors without a swing side get the old fixed rule (left of a→b); windows get none", () => {
  const legacy: Plan = structuredClone(samplePlan);
  for (const o of legacy.openings) delete (o as Partial<Opening>).swing;
  assert.ok(validatePlan(legacy).some((p) => /no swing side/.test(p)), "the validator reports a door with no swing side");
  s().loadPlan(legacy);
  for (const o of s().plan.openings) {
    if (o.kind === "door") assert.equal(o.swing, edit.LEGACY_SWING, `${o.id} gets the legacy side`);
    else assert.equal(o.swing, undefined, `${o.id} (window) has no swing`);
  }
  assert.equal(edit.LEGACY_SWING, "left", "the old rule opened to the left of a→b");
  // The old 2D rule: hinge at the end nearer a, leaf on the positive side of the normal.
  const wall = wallIn(s().plan, "w-BC");
  const door = op(s().plan, "d-front");
  const f = openingFrame(wall, door);
  const sw = doorSwing(wall, door);
  assert.deepEqual(sw.hinge, f.start, "hinge at the end nearer a");
  close((sw.leafEnd.x - sw.hinge.x) * f.normal.x + (sw.leafEnd.y - sw.hinge.y) * f.normal.y, door.width, EPS, "leaf on the left (+normal) side, as before");
  assert.deepEqual(validatePlan(s().plan), validatePlan(samplePlan), "after migration the plan is exactly as valid as the sample");
  assert.equal(op(samplePlan, "d-front").swing, "left", "the sample's doors carry the side explicitly");
});

block("swing side is explicit data: right puts the leaf on the other side, same hinge", () => {
  const wall = wallIn(samplePlan, "w-BC");
  const left = { ...op(samplePlan, "d-front"), swing: "left" as const };
  const right = { ...left, swing: "right" as const };
  const f = openingFrame(wall, left);
  const [l, r] = [doorSwing(wall, left), doorSwing(wall, right)];
  assert.deepEqual(r.hinge, l.hinge, "flip keeps the hinge");
  close((r.leafEnd.x - r.hinge.x) * f.normal.x + (r.leafEnd.y - r.hinge.y) * f.normal.y, -left.width, EPS, "right: leaf on the -normal side");
  assert.deepEqual(r.arcEnd, l.arcEnd, "the arc closes on the same wall line");
  const noSwing = { ...left } as Opening;
  delete noSwing.swing;
  assert.ok(validatePlan({ ...samplePlan, openings: [noSwing] }).some((p) => p.includes("no swing side")), "a door must have one");
  assert.ok(validatePlan({ ...samplePlan, openings: [{ ...op(samplePlan, "win-bed1"), swing: "left" }] }).some((p) => p.includes("swing")), "a window must not");
});

block("usable span: wall ends lose half the joining wall's thickness; collinear neighbours don't count", () => {
  assert.deepEqual(edit.usableSpan(samplePlan.walls, "w-AB"), { start: 0.1, end: 3.95 }, "w-AB: H–A is 0.2 m at A, B–I is 0.1 m at B, B–C is collinear");
  assert.deepEqual(edit.usableSpan(samplePlan.walls, "w-ME"), { start: 0.05, end: 2.9 }, "w-ME (vertical): K–M 0.1 m at M, E–L 0.2 m at E");
  const free: Wall = { id: "f", a: { x: 20, y: 0 }, b: { x: 23, y: 0 }, thickness: 0.1, height: 2.7 };
  assert.deepEqual(edit.usableSpan([free], "f"), { start: 0, end: 3 }, "free ends lose nothing");
  assert.equal(edit.usableSpan(samplePlan.walls, "nope"), null, "an unknown wall has no span");
});

block("place a door on a horizontal wall: centre, width, defaults, explicit swing", () => {
  const snap = edit.snapOpening({ x: 2.31, y: 0.04 }, samplePlan.walls, { tol: 0.1, radius: 0.15 });
  assert.deepEqual(snap, { wallId: "w-AB", offset: 2.3, kind: "grid" }, "w-AB, centre 2.3 m from A on the 5 cm step");
  const out = edit.placeOpening(samplePlan, "door", "w-AB", snap!.offset);
  assert.ok("opening" in out, `placed: ${JSON.stringify(out)}`);
  assert.deepEqual(out.opening, { wallId: "w-AB", kind: "door", offset: 2.3, width: 0.9, height: 2.1, sillHeight: 0, swing: "left" });
  const mid = edit.snapOpening({ x: 2.08, y: -0.03 }, samplePlan.walls, { tol: 0.1, radius: 0.15 });
  assert.deepEqual(mid, { wallId: "w-AB", offset: 2, kind: "midpoint" }, "near the middle: the midpoint exactly");
});

block("place a door on a vertical wall: the centre lands where the pointer is, on the wall", () => {
  const snap = edit.snapOpening({ x: 9.97, y: 6.52 }, samplePlan.walls, { tol: 0.1, radius: 0.15 }); // w-ME M(10,5)→E(10,8)
  assert.equal(snap?.wallId, "w-ME", "the vertical wall");
  const out = edit.placeOpening(samplePlan, "door", "w-ME", snap!.offset);
  assert.ok("opening" in out, `placed: ${JSON.stringify(out)}`);
  const plan = { ...samplePlan, openings: [...samplePlan.openings, { ...out.opening, id: "new" }] };
  const c = centreOf(plan, op(plan, "new"));
  close(c.x, 10, EPS, "on the wall's centre line");
  close(c.y, 6.5, EPS, "1.5 m from M, where the pointer was (snapped to 5 cm)");
  close(op(plan, "new").width, 0.9, EPS, "the default width is kept");
  assert.deepEqual(openingsValid(plan), [], "valid");
});

block("place a window: own defaults, no swing, sill kept", () => {
  const out = edit.placeOpening(samplePlan, "window", "w-HI", 2);
  assert.ok("opening" in out, `placed: ${JSON.stringify(out)}`);
  assert.deepEqual(out.opening, { wallId: "w-HI", kind: "window", offset: 2, width: 1.2, height: 1.2, sillHeight: 0.9 });
});

block("placement near or past a wall end is refused; a centre inside the span slides to fit", () => {
  const atEnd = edit.placeOpening(samplePlan, "door", "w-AB", 0.05);
  assert.ok("error" in atEnd && /end of the wall/i.test(atEnd.error), `refused at the end: ${JSON.stringify(atEnd)}`);
  const past = edit.placeOpening(samplePlan, "door", "w-AB", 4);
  assert.ok("error" in past, "refused at the far end too");
  const near = edit.placeOpening(samplePlan, "door", "w-AB", 0.3);
  assert.ok("opening" in near, "a centre inside the span is fine");
  close(near.opening.offset, 0.1 + 0.45, EPS, "it slides so its edge is at the span's start");
  const shortWall: Wall = { id: "s", a: { x: 20, y: 0 }, b: { x: 20.5, y: 0 }, thickness: 0.1, height: 2.7 };
  const tooShort = edit.placeOpening({ walls: [shortWall], openings: [] }, "door", "s", 0.25);
  assert.ok("error" in tooShort && /room for/i.test(tooShort.error), `a 0.9 m door on a 0.5 m wall: ${JSON.stringify(tooShort)}`);
});

block("two openings can't overlap: placement refused, a slide stops at the neighbour", () => {
  // w-BC: d-front 2.5–3.5, win-living-n 4.4–5.6
  const clash = edit.placeOpening(samplePlan, "window", "w-BC", 3.3);
  assert.ok("error" in clash && /overlap/i.test(clash.error), `refused: ${JSON.stringify(clash)}`);
  const slid = edit.slideOpening(samplePlan, "win-living-n", 3);
  close(slid.offset, 3.5 + 0.6, EPS, "stops with its edge on the door's edge");
  assert.match(slid.limited ?? "", /door/, "and says what stopped it");
  const intoEnd = edit.slideOpening(samplePlan, "win-living-n", 9);
  close(intoEnd.offset, 6 - 0.1 - 0.6, EPS, "and short of the corner at C");
  const overlapping = { ...samplePlan, openings: samplePlan.openings.map((o) => (o.id === "win-living-n" ? { ...o, offset: 3.4 } : o)) };
  assert.ok(validatePlan(overlapping).some((p) => /overlap/.test(p)), "the validator still reports an overlap");
  assert.match(edit.openingProblem(samplePlan, { ...op(samplePlan, "win-living-n"), offset: 3.4 }) ?? "", /overlap/, "and openingProblem says so plainly");
});

block("resize keeps the centre when it fits, shifts or clamps when it doesn't, never below the minimum", () => {
  const wider = edit.resizeOpening(samplePlan, "win-living-n", 1.4);
  assert.ok("width" in wider, JSON.stringify(wider));
  assert.deepEqual([wider.width, wider.offset, wider.note], [1.4, 5, undefined], "room either side: centre kept");
  const huge = edit.resizeOpening(samplePlan, "win-living-n", 3);
  assert.ok("width" in huge, JSON.stringify(huge));
  close(huge.width, 5.9 - 3.5, EPS, "clamped to the room between the door and the corner");
  close(huge.offset, 3.5 + huge.width / 2, EPS, "and centred in it");
  assert.match(huge.note ?? "", /fits/, "with the reason");
  const tiny = edit.resizeOpening(samplePlan, "win-living-n", 0.1);
  assert.ok("width" in tiny && tiny.width === edit.OPENING_WIDTH_RANGE[0] && /narrower/.test(tiny.note ?? ""), `minimum: ${JSON.stringify(tiny)}`);
});

block("height and sill: clamped to the wall with a reason; a door's sill stays at the floor", () => {
  const sill = edit.openingSize(samplePlan, "win-living-n", "sillHeight", 2);
  assert.ok("value" in sill, JSON.stringify(sill));
  close(sill.value, 2.7 - 1.2, EPS, "sill + height stops at the wall's height");
  assert.match(sill.note ?? "", /wall/, "and says why");
  const doorSill = edit.openingSize(samplePlan, "d-front", "sillHeight", 0.3);
  assert.ok("error" in doorSill, "a door has no sill to edit");
  const tall = edit.openingSize(samplePlan, "d-front", "height", 3);
  assert.ok("value" in tall && tall.value === 2.7, "a door is at most as tall as its wall");
});

block("store: placing a door is one undo step; redo restores it exactly", () => {
  reset();
  const before = structuredClone(s().plan);
  const id = s().placeOpening("door", "w-AB", 2.3);
  assert.ok(id, "placed");
  assert.equal(s().past.length, 1, "one undo step");
  assert.equal(s().plan.openings.length, before.openings.length + 1, "one opening added");
  assert.deepEqual(s().plan.walls, before.walls, "no wall changed");
  assert.deepEqual(s().plan.rooms, before.rooms, "rooms are untouched: they come from walls only");
  const placed = structuredClone(s().plan);
  s().undo();
  assert.deepEqual(s().plan, before, "undo removes it");
  s().redo();
  assert.deepEqual(s().plan, placed, "redo restores it");
  assert.equal(s().placeOpening("door", "w-AB", 0.05), null, "a refused placement returns null");
  assert.deepEqual(s().plan, placed, "and changes nothing");
  assert.equal(s().past.length, 1, "nor history");
});

block("Flip reverses only the swing side, as one undo step", () => {
  reset();
  const before = structuredClone(op(s().plan, "d-bed1"));
  s().flipDoor("d-bed1");
  const after = op(s().plan, "d-bed1");
  assert.equal(after.swing, "right", "left → right");
  assert.deepEqual({ ...after, swing: before.swing }, before, "wall, width, offset, height and sill unchanged");
  assert.equal(s().past.length, 1, "one undo step");
  s().flipDoor("d-bed1");
  assert.equal(op(s().plan, "d-bed1").swing, "left", "flip again → left");
  s().undo();
  assert.equal(op(s().plan, "d-bed1").swing, "right", "one undo takes back one flip");
  s().flipDoor("win-bed1");
  assert.equal(s().past.length, 1, "flipping a window does nothing (history after the undo stays at one step)");
});

block("move and resize through the store are one undo step each and stay valid", () => {
  reset();
  const out = edit.slideOpening(s().plan, "win-living-n", 3);
  s().updateOpening("win-living-n", { offset: out.offset });
  const r = edit.resizeOpening(s().plan, "win-living-n", 3);
  assert.ok("width" in r);
  s().updateOpening("win-living-n", { width: r.width, offset: r.offset });
  assert.equal(s().past.length, 2, "two edits, two steps");
  assert.deepEqual(openingsValid(s().plan), [], "still valid");
  s().undo();
  s().undo();
  assert.deepEqual(s().plan.openings, structuredClone(samplePlan).openings, "both undone");
});

block("wall edits keep openings inside their walls and keep the swing side", () => {
  reset();
  s().flipDoor("d-bed1");
  s().moveWallEndpoint("w-BI", "b", { x: 4, y: 2 }); // I pulled north: w-BI is 2 m, d-bed1 was at 2.45–3.35
  const d = op(s().plan, "d-bed1");
  assert.ok(d.offset - d.width / 2 >= -EPS && d.offset + d.width / 2 <= 2 + EPS, `inside the 2 m wall: ${d.offset} ± ${d.width / 2}`);
  assert.equal(d.swing, "right", "the side survives");
  assert.deepEqual(openingsValid(s().plan), [], "no opening outside its wall");
  reset();
  const body = edit.dragWallBody(s().plan.walls, "w-BC", 0.6); // slides the north wall run south
  s().transaction(() => body.moves.forEach((m) => s().moveWallEndpoint(m.wallId, m.end, m.to)));
  assert.deepEqual(openingsValid(s().plan), [], "a body drag keeps every opening inside");
});

block("a 4.4 split keeps each opening on the right piece, in the same place, with its properties", () => {
  reset();
  s().flipDoor("d-front");
  const before = structuredClone(s().plan);
  // (8,0) on w-BC to (8,5) on w-KM: splits w-BC between the door (2.5–3.5) and the window (4.4–5.6).
  const id = s().drawWall({ x: 8, y: 0 }, { x: 8, y: 5 }, edit.drawDefaults(s().plan.walls));
  assert.ok(id, "drawn");
  const after = s().plan;
  assert.equal(after.openings.length, before.openings.length, "no opening duplicated or lost");
  for (const o of before.openings) {
    const now = op(after, o.id);
    assert.ok(after.walls.some((w) => w.id === now.wallId), `${o.id} is on a wall that exists`);
    const [p, q] = [centreOf(before, o), centreOf(after, now)];
    assert.ok(dist(p, q) <= POS_EPS, `${o.id} did not move: (${p.x}, ${p.y}) → (${q.x}, ${q.y})`);
    assert.deepEqual({ ...now, wallId: o.wallId, offset: o.offset }, o, `${o.id} keeps width, height, sill, kind and swing`);
  }
  assert.equal(op(after, "d-front").wallId, "w-BC", "the door is before the split: first piece");
  assert.notEqual(op(after, "win-living-n").wallId, "w-BC", "the window is past it: second piece");
  close(op(after, "win-living-n").offset, 1, EPS, "re-measured from the second piece's a end");
  assert.ok(wallLength(wallIn(after, op(after, "win-living-n").wallId)) > 0, "the piece exists");
  assert.deepEqual(openingsValid(after), [], "every opening still inside its piece");
  const split = edit.drawProblem(before, { x: 9, y: 0 }, { x: 9, y: 2 }); // x 9 is inside the window (8.4–9.6)
  assert.match(split ?? "", /window/, "a split through the window is refused");
  assert.equal(deriveRooms(after).length, 5, "rooms come from the walls alone");
});

block("delete removes only that opening; undo restores every property; redo deletes again", () => {
  reset();
  s().flipDoor("d-bath");
  const before = structuredClone(s().plan);
  s().deleteOpening("d-bath");
  assert.equal(s().plan.openings.some((o) => o.id === "d-bath"), false, "the door is gone");
  assert.deepEqual(s().plan.walls, before.walls, "every wall remains");
  assert.deepEqual(s().plan.openings, before.openings.filter((o) => o.id !== "d-bath"), "no other opening changed");
  s().undo();
  assert.deepEqual(s().plan, before, "undo restores it, swing side included");
  assert.equal(op(s().plan, "d-bath").swing, "right");
  s().redo();
  assert.equal(s().plan.openings.some((o) => o.id === "d-bath"), false, "redo deletes it again");
});

block("picking: an opening beats the wall behind it; the door's swing area picks the door; plain wall picks nothing", () => {
  const tol = 0.1;
  assert.equal(edit.pickOpening({ x: 7, y: 0.02 }, samplePlan, tol), "d-front", "on the gap");
  assert.equal(edit.pickOpening({ x: 6.9, y: 0.4 }, samplePlan, tol), "d-front", "inside the swing (left of a→b on w-BC is south)");
  assert.equal(edit.pickOpening({ x: 6, y: 0.02 }, samplePlan, tol), null, "between openings: the wall's job");
  const flipped = { ...samplePlan, openings: samplePlan.openings.map((o) => (o.id === "d-front" ? { ...o, swing: "right" as const } : o)) };
  assert.equal(edit.pickOpening({ x: 6.9, y: 0.4 }, flipped, tol), null, "flipped, the swing is on the other side");
  assert.equal(edit.pickOpening({ x: 6.9, y: -0.4 }, flipped, tol), "d-front", "and is picked there");
});

block("existing wall tests' sample is unchanged apart from the explicit swing", () => {
  assert.ok(samplePlan.openings.filter((o) => o.kind === "door").every((o) => o.swing === "left"), "every sample door opens left, as the old rule drew it");
  assert.deepEqual(validatePlan(samplePlan), [], "the sample is valid");
});

// ---------------------------------------------------------------- selecting with the Select tool (regression)
// What one click selects: edit.pickTarget, the function PlanCanvas calls on every
// Select-tool press. Tolerances as at about 80 px/m: 8 px ≈ 0.1 m for wall
// bodies and openings, 12 px ≈ 0.15 m for end handles. "3 px" is 0.037 m.
const TOL = { wall: 0.1, handle: 0.15, opening: 0.1 };
const PX3 = 0.037;
const pick = (x: number, y: number, plan: Openings = samplePlan) => edit.pickTarget({ x, y }, plan, TOL);
type Openings = Pick<Plan, "walls" | "openings">;

block("pickTarget: a horizontal door at its centre is the door", () => {
  assert.deepEqual(pick(7, 0), { kind: "opening", id: "d-front" }, "d-front, centre of its gap on w-BC");
});
block("pickTarget: a vertical door at its centre is the door", () => {
  assert.deepEqual(pick(4, 2.9), { kind: "opening", id: "d-bed1" }, "d-bed1, centre of its gap on w-BI");
});
block("pickTarget: a window at its centre is the window", () => {
  assert.deepEqual(pick(10, 2.5), { kind: "opening", id: "win-living-e" }, "win-living-e on vertical w-CM");
  assert.deepEqual(pick(9, 0), { kind: "opening", id: "win-living-n" }, "win-living-n on horizontal w-BC");
});
block("pickTarget: just past the opening's end falls through to the wall", () => {
  assert.deepEqual(pick(4, 2.45 - 0.3), { kind: "wall", wallId: "w-BI" }, "0.3 m before d-bed1's gap: the wall");
  assert.deepEqual(pick(0, 1.4 - 0.3), { kind: "wall", wallId: "w-HA" }, "0.3 m past win-bed1: the wall");
});
block("pickTarget: where an opening and its wall overlap, the opening wins", () => {
  // (4, 2.9) is inside w-BI's pick band too: pickWall alone would return the wall.
  assert.equal(edit.pickWall({ x: 4, y: 2.9 }, samplePlan.walls, TOL.wall, TOL.handle)?.wallId, "w-BI", "the wall is under it as well");
  assert.deepEqual(pick(4, 2.9), { kind: "opening", id: "d-bed1" }, "but the door is what gets selected");
  assert.equal(pick(4, 0.01)?.kind, "handle", "a wall end handle (joint B) still beats everything");
});
block("pickTarget: empty space selects nothing", () => {
  assert.equal(pick(2, 2), null, "the middle of Bedroom 1");
  assert.equal(pick(-3, -3), null, "outside the house");
});
block("regression: clicks a few px OFF the drawn door leaf and arc still pick the door", () => {
  // d-bed1: hinge (4, 2.45), leaf drawn to (3.1, 2.45), arc radius 0.9 into Bedroom 1.
  const a = Math.PI / 4;
  const cases: [string, number, number][] = [
    ["leaf, 3 px toward B (outside the swing)", 3.55, 2.45 - PX3],
    ["leaf, 3 px into the swing", 3.55, 2.45 + PX3],
    ["arc, 3 px outside", 4 - (0.9 + PX3) * Math.cos(a), 2.45 + (0.9 + PX3) * Math.sin(a)],
    ["arc, 3 px inside", 4 - (0.9 - PX3) * Math.cos(a), 2.45 + (0.9 - PX3) * Math.sin(a)],
    ["leaf tip, 3 px beyond", 3.1 - PX3, 2.45],
  ];
  for (const [name, x, y] of cases) assert.deepEqual(pick(x, y), { kind: "opening", id: "d-bed1" }, name);
  assert.equal(pick(4 - 1.2 * Math.cos(a), 2.45 + 1.2 * Math.sin(a)), null, "well outside the arc (0.3 m) is still empty floor");
});
block("regression (pickOpening, the function the canvas called): the same off-symbol clicks pick the door", () => {
  const a = Math.PI / 4;
  assert.equal(edit.pickOpening({ x: 3.55, y: 2.45 - PX3 }, samplePlan, TOL.opening), "d-bed1", "leaf, 3 px toward B");
  assert.equal(edit.pickOpening({ x: 4 - (0.9 + PX3) * Math.cos(a), y: 2.45 + (0.9 + PX3) * Math.sin(a) }, samplePlan, TOL.opening), "d-bed1", "arc, 3 px outside");
});
block("pickTarget at phone zoom (tolerances ×4): the wall's middle is the wall; the drawn leaf is still the door", () => {
  const far = { wall: 0.4, handle: 0.6, opening: 0.4 }; // 12 px at about 30 px/m, sheet open
  assert.deepEqual(edit.pickTarget({ x: 4, y: 2 }, samplePlan, far), { kind: "wall", wallId: "w-BI" }, "on w-BI 0.45 m before the door: the wall");
  assert.deepEqual(edit.pickTarget({ x: 4, y: 2.3 }, samplePlan, far), { kind: "wall", wallId: "w-BI" }, "on w-BI right next to the hinge: still the wall");
  assert.deepEqual(edit.pickTarget({ x: 3.7, y: 2.4 }, samplePlan, far), { kind: "opening", id: "d-bed1" }, "the drawn leaf, inside the wall's pick band but off its body: the door");
});
block("pickTarget: a door's swing never steals a click on a DIFFERENT wall inside it", () => {
  const plan: Openings = {
    walls: [
      { id: "long", a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, thickness: 0.2, height: 2.7 },
      { id: "stub", a: { x: 5, y: 0.5 }, b: { x: 6, y: 0.5 }, thickness: 0.1, height: 2.7 }, // free-standing, inside the swing
    ],
    openings: [{ id: "d", wallId: "long", kind: "door", offset: 5.5, width: 0.9, height: 2.1, sillHeight: 0, swing: "left" }],
  };
  assert.deepEqual(pick(5.5, 0.5, plan), { kind: "wall", wallId: "stub" }, "on the stub: the stub");
  assert.deepEqual(pick(5.5, 0.3, plan), { kind: "opening", id: "d" }, "inside the swing, off the stub: the door");
});

console.log(failed ? `test-opening-edit: ${failed} block(s) FAILED` : "test-opening-edit: ok");
if (failed) process.exit(1);
