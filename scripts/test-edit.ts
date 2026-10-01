/**
 * test-edit.ts — asserts for src/lib/plan/edit.ts (the pure wall-editing maths)
 * and for the store path the editor components take when they apply it: picking,
 * snapping, dragging a joint, sliding a wall sideways, the 0.2 m minimum, how
 * rooms and their names survive an edit, one-drag-one-undo, Escape-cancel and
 * delete. Pure Node, no browser. Each block prints what it covers.
 * Run: npx tsx scripts/test-edit.ts (throws on the first failure).
 */
import assert from "node:assert/strict";
import { samplePlan } from "../src/data/samplePlan";
import {
  clampField,
  dragEndpoint,
  dragWallBody,
  HANDLE_TOL_PX,
  HANDLE_TOL_TOUCH_PX,
  HEIGHT_RANGE,
  lengthTarget,
  MIN_WALL_LENGTH,
  NUDGE_M,
  NUDGE_MERGE_MS,
  NUDGE_SHIFT_M,
  normalComponent,
  PICK_TOL_PX,
  pickWall,
  ROUND_STEP,
  SNAP_TOL_PX,
  snapDrag,
  snapRadius,
  THICKNESS_RANGE,
} from "../src/lib/plan/edit";
import { wallLength } from "../src/lib/plan/geometry";
import { deriveRooms } from "../src/lib/plan/rooms";
import { validatePlan } from "../src/lib/plan/validate";
import { usePlanStore } from "../src/store/planStore";
import type { Plan, Vec2, Wall } from "../src/types/plan";

const s = () => usePlanStore.getState();
const reset = () => s().loadPlan(structuredClone(samplePlan));
const wallIn = (plan: Plan, id: string) => plan.walls.find((w) => w.id === id)!;
const close = (a: number, b: number, eps: number, msg: string) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const names = (plan: Plan) => plan.rooms.map((r) => r.name).sort();

/** The 2D canvas's drag, applied through the store: one transaction, one undo step. */
const applyEndpoint = (wallId: string, end: "a" | "b", to: Vec2) => {
  const out = dragEndpoint(s().plan.walls, wallId, end, to);
  s().transaction(() => s().moveWallEndpoint(wallId, end, out.point));
  return out;
};
const applyBody = (wallId: string, offset: number) => {
  const out = dragWallBody(s().plan.walls, wallId, offset);
  s().transaction(() => {
    s().moveWallEndpoint(wallId, "a", out.a);
    s().moveWallEndpoint(wallId, "b", out.b);
  });
  return out;
};

// --- (0) the tolerances this step works to, all from edit.ts
console.log(
  [
    "(0) tolerances:",
    `  pick: ${PICK_TOL_PX} px to a wall body, ${HANDLE_TOL_PX} px to an end handle (${HANDLE_TOL_TOUCH_PX} px for touch); a handle always beats a body`,
    `  snap: ${SNAP_TOL_PX} px, clamped to ${snapRadius(1000).toFixed(2)}–${snapRadius(1).toFixed(2)} m (e.g. ${snapRadius(60).toFixed(3)} m at 60 px/m); grid 0.05 m; Alt turns it off`,
    `  minimum wall length ${MIN_WALL_LENGTH} m; coordinates round to ${ROUND_STEP} m on release`,
    `  arrow nudge ${NUDGE_M} m, ${NUDGE_SHIFT_M} m with Shift, presses within ${NUDGE_MERGE_MS} ms share one undo step`,
    `  thickness ${THICKNESS_RANGE[0]}–${THICKNESS_RANGE[1]} m, height ${HEIGHT_RANGE[0]}–${HEIGHT_RANGE[1]} m`,
  ].join("\n"),
);

// --- (1) dragEndpoint moves every wall joined at joint I (4, 4), and the plan stays valid
{
  const before = validatePlan(samplePlan);
  const r = dragEndpoint(samplePlan.walls, "w-BI", "b", { x: 4.5, y: 4.3 });
  const at = (id: string) => wallIn({ ...samplePlan, walls: r.walls }, id);
  assert.deepEqual(at("w-BI").b, { x: 4.5, y: 4.3 }, "the dragged end moved");
  assert.deepEqual(at("w-HI").b, { x: 4.5, y: 4.3 }, "w-HI, joined at I, moved too");
  assert.deepEqual(at("w-IF").a, { x: 4.5, y: 4.3 }, "w-IF, joined at I, moved too");
  assert.deepEqual(at("w-AB").a, { x: 0, y: 0 }, "a wall that isn't at the joint stayed put");
  assert.deepEqual(validatePlan({ ...samplePlan, walls: r.walls }).filter((p) => !before.includes(p)), [], "no new problems");
  assert.equal(r.limited, undefined, "a roomy move isn't limited");

  // the store does the same thing: edit.ts and planStore.moveWallEndpoint agree on a joint
  reset();
  applyEndpoint("w-BI", "b", { x: 4.5, y: 4.3 });
  assert.deepEqual(s().plan.walls, r.walls, "the store's moveWallEndpoint matches edit.ts");

  // the 0.2 m minimum pushes the joint back out, and says so
  const tight = dragEndpoint(samplePlan.walls, "w-BI", "b", { x: 4, y: 0.05 }); // almost on top of B (4, 0)
  close(wallLength(wallIn({ ...samplePlan, walls: tight.walls }, "w-BI")), MIN_WALL_LENGTH, 1e-9, "pushed out to the minimum");
  assert.match(tight.limited ?? "", /shorter than 0\.20 m/, "and says why");
  console.log("(1) dragEndpoint moves every wall at a joint, keeps the plan valid, matches the store, and holds the 0.2 m minimum");
}

// --- (2) picking: an end handle beats a wall body, nearest wins, empty space misses
{
  const tol = PICK_TOL_PX / 50; // 50 px/m
  const handle = HANDLE_TOL_PX / 50;
  assert.deepEqual(pickWall({ x: 2, y: 0.02 }, samplePlan.walls, tol, handle), { wallId: "w-AB", end: null }, "the body of w-AB");
  assert.deepEqual(pickWall({ x: 4.01, y: 0.01 }, samplePlan.walls, tol, handle)?.end, "b", "an end handle at joint B, not the body");
  // Joint B is the b end of w-AB and an end of w-BC and w-BI too; whichever it names, it must be a handle.
  assert.ok(["w-AB", "w-BC", "w-BI"].includes(pickWall({ x: 4.01, y: 0.01 }, samplePlan.walls, tol, handle)!.wallId), "a wall that meets B");
  assert.equal(pickWall({ x: 2, y: 2 }, samplePlan.walls, tol, handle), null, "empty space picks nothing");
  // A handle wins even when another wall's body is nearer the cursor.
  const near = pickWall({ x: 4, y: 0.12 }, samplePlan.walls, tol, handle);
  assert.equal(near?.end !== null, true, "a handle 0.12 m away beats the wall body 0 m away");
  // Joint I is an end of three walls at once: grabbing it keeps the selected one.
  for (const prefer of ["w-BI", "w-HI", "w-IF"]) {
    assert.equal(pickWall({ x: 4, y: 4 }, samplePlan.walls, tol, handle, prefer)?.wallId, prefer, `a tie at a shared joint goes to ${prefer}`);
  }
  console.log("(2) pickWall: body hits, endpoint handles beat bodies, empty space misses");
}

// --- (3) snapping: endpoint beats midpoint beats angle beats grid, and Alt turns it all off
{
  const probe: Wall[] = [
    { id: "p1", a: { x: 0, y: 0 }, b: { x: 2, y: 0 }, thickness: 0.1, height: 2.7 }, // midpoint (1, 0)
    { id: "p2", a: { x: 1.05, y: 0.05 }, b: { x: 1.05, y: 2 }, thickness: 0.1, height: 2.7 }, // endpoint (1.05, 0.05)
  ];
  const r = 0.15;
  // (1.02, 0.02) is nearer the midpoint (0.028 m) than the endpoint (0.042 m): the endpoint still wins.
  assert.equal(snapDrag({ x: 1.02, y: 0.02 }, probe, { radius: r }).kind, "endpoint", "endpoint beats a nearer midpoint");
  assert.deepEqual(snapDrag({ x: 1.02, y: 0.02 }, probe, { radius: r }).point, { x: 1.05, y: 0.05 });
  // Away from that endpoint, the midpoint wins over the 45° ray through it.
  const mid = snapDrag({ x: 0.98, y: -0.02 }, [probe[0]], { from: { x: 0, y: -1 }, radius: r });
  assert.equal(mid.kind, "midpoint", "midpoint beats the angle ray");
  // No endpoint or midpoint in reach, but on a 45° ray from the wall's other end.
  const angle = snapDrag({ x: 6.0, y: 2.03 }, samplePlan.walls, { from: { x: 4, y: 4 }, radius: r });
  assert.equal(angle.kind, "angle", "a 45° ray from the other end");
  close(Math.abs(angle.point.x - 4), Math.abs(angle.point.y - 4), 1e-9, "45° means equal runs");
  // Nothing in reach at all: the 5 cm grid.
  const grid = snapDrag({ x: 6.37, y: 2.03 }, samplePlan.walls, { radius: r });
  assert.deepEqual(grid, { point: { x: 6.35, y: 2.05 }, kind: "grid" }, "the 5 cm grid is the weakest");
  // Alt: no snapping at all, just 1 cm rounding.
  assert.deepEqual(snapDrag({ x: 1.023, y: 0.017 }, probe, { radius: r, free: true }), { point: { x: 1.02, y: 0.02 }, kind: null }, "Alt turns snapping off");
  // The walls meeting the dragged joint are not candidates: a joint can't snap to itself.
  assert.notEqual(snapDrag({ x: 4.01, y: 4.01 }, samplePlan.walls, { radius: r, exclude: { x: 4, y: 4 } }).kind, "endpoint", "the joint being dragged is not a snap target");
  console.log("(3) snapping order endpoint > midpoint > angle > grid; Alt disables; the dragged joint is excluded");
}

// --- (4) dragWallBody: both joints move, joining walls stretch, openings stay inside, the minimum stops it
{
  reset();
  const win = s().plan.openings.find((o) => o.id === "win-bed2")!; // on w-GH, which this drag shortens
  const out = applyBody("w-HI", 2.5); // interior wall H(0,4)–I(4,4), slid 2.5 m south
  assert.equal(out.limited, undefined, "2.5 m is within reach");
  const p = s().plan;
  assert.deepEqual(wallIn(p, "w-HI").a, { x: 0, y: 6.5 }, "joint H moved the full 2.5 m");
  assert.deepEqual(wallIn(p, "w-HI").b, { x: 4, y: 6.5 }, "joint I moved with it");
  close(wallLength(wallIn(p, "w-HI")), 4, 1e-9, "the wall kept its length and its direction");
  close(wallLength(wallIn(p, "w-GH")), 1.5, 1e-9, "w-GH shrank from 4 m to 1.5 m");
  close(wallLength(wallIn(p, "w-HA")), 6.5, 1e-9, "w-HA stretched from 4 m to 6.5 m");
  for (const wid of ["w-GH", "w-HA", "w-BI", "w-IF"]) {
    assert.equal(wallIn(p, wid).a.x, wallIn(p, wid).b.x, `${wid} kept its direction (still vertical)`);
  }
  // The opening on the shortened wall was pulled back inside it.
  const moved = p.openings.find((o) => o.id === "win-bed2")!;
  assert.ok(moved.offset + moved.width / 2 <= wallLength(wallIn(p, "w-GH")) + 1e-9, "win-bed2 stayed inside the shortened w-GH");
  assert.notEqual(moved.offset, win.offset, "which meant moving it");
  assert.deepEqual(validatePlan(p).filter((x) => x.includes("Opening")), [], "no opening problems");

  // Too far: it stops at the limit and says why.
  reset();
  const far = applyBody("w-HI", 5); // w-GH would shrink through nothing and come out the far side
  close(far.offset, 3.8, 0.01, "stopped where w-GH reaches 0.2 m");
  assert.match(far.limited ?? "", /shorter than 0\.20 m/, "and says why");
  close(wallLength(wallIn(s().plan, "w-GH")), MIN_WALL_LENGTH, 0.01, "w-GH is exactly at the minimum");
  console.log("(4) dragWallBody moves both joints, joining walls keep direction and stretch, openings stay inside, the 0.2 m limit stops it with a reason");
}

// --- (5) a T-junction: the joint slides along the crossing wall
{
  // G(0,8)–H(0,4)–A(0,0) is one straight run split at H, with w-HI stemming off it.
  // Dragging the STEM slides the T joint along the run and keeps both halves straight.
  const stem = dragWallBody(samplePlan.walls, "w-HI", 1);
  const sp = { ...samplePlan, walls: stem.walls };
  assert.deepEqual(wallIn(sp, "w-HI").a, { x: 0, y: 5 }, "the T joint stayed on the run (x = 0) and slid along it");
  for (const id of ["w-GH", "w-HA"]) assert.equal(wallIn(sp, id).a.x, wallIn(sp, id).b.x, `${id} is still straight`);
  close(wallLength(wallIn(sp, "w-GH")) + wallLength(wallIn(sp, "w-HA")), 8, 1e-9, "the run is still 8 m end to end");

  // Dragging ONE HALF of the split run is the case we can't satisfy: the half
  // being dragged and the stem both keep their directions, so the other half
  // has to tilt. Asserted as it really behaves, and listed in CLAUDE.md.
  const half = dragWallBody(samplePlan.walls, "w-GH", 0.5);
  const hp = { ...samplePlan, walls: half.walls };
  assert.equal(wallIn(hp, "w-HI").a.y, wallIn(hp, "w-HI").b.y, "the stem w-HI kept its direction");
  assert.deepEqual(wallIn(hp, "w-HI").a, { x: 0.5, y: 4 }, "the joint slid along the stem");
  assert.notEqual(wallIn(hp, "w-HA").a.x, wallIn(hp, "w-HA").b.x, "the other half w-HA tilts: the known limitation");
  console.log("(5) dragging the stem keeps the T joint on the crossing wall; dragging one half of a split wall tilts the other half (known limitation)");
}

// --- (6) rooms are re-derived; names survive a drag that keeps the topology
{
  reset();
  const before = names(s().plan);
  applyEndpoint("w-BI", "b", { x: 4.4, y: 4.4 });
  assert.equal(s().plan.rooms.length, 4, "still four rooms");
  assert.deepEqual(names(s().plan), before, "every room kept its name");
  const areas = deriveRooms(s().plan).map((r) => r.area);
  assert.notDeepEqual(areas, deriveRooms(samplePlan).map((r) => r.area), "but the areas changed");

  // A drag that folds the plan over itself loses rooms. deriveRooms matches the
  // survivors by overlap, so the big new face takes the bigger old room's name
  // and the vanished rooms' names go with them.
  reset();
  applyEndpoint("w-BI", "b", { x: -1, y: 2 }); // joint I dragged out past the west wall
  const after = s().plan.rooms;
  assert.equal(after.length, 2, "the two bedrooms folded away: 4 rooms become 2");
  assert.deepEqual(names(s().plan), ["Bathroom", "Living room"], "the merged face keeps the larger old room's name");
  s().undo();
  assert.deepEqual(names(s().plan), before, "one undo brings the rooms and their names back");
  console.log("(6) rooms re-derive after a drag: names are kept when the topology holds, and a fold drops rooms, the survivor keeping the larger old name");
}

// --- (7) one drag is one undo step; Escape leaves no trace; a typed length equals the b-handle drag
{
  reset();
  const start = structuredClone(s().plan);
  const history = s().past.length;
  // Many moves, as a real drag sends them: roll the preview back, re-apply, as PlanCanvas does.
  for (let i = 1; i <= 5; i++) {
    if (i > 1) s().rollback();
    applyEndpoint("w-BI", "b", { x: 4, y: 4 + i * 0.1 });
  }
  assert.equal(s().past.length, history + 1, "a whole drag is one history entry");
  assert.deepEqual(wallIn(s().plan, "w-HI").b, { x: 4, y: 4.5 }, "and the last position is the one that stuck");
  s().undo();
  assert.deepEqual(s().plan, start, "one undo restores the plan");

  // Escape mid-drag: rollback restores the plan and leaves history exactly as it was, with nothing to redo.
  reset();
  const before = structuredClone(s().plan);
  const h0 = s().past.length;
  applyEndpoint("w-BI", "b", { x: 4, y: 4.8 });
  s().rollback();
  assert.deepEqual(s().plan, before, "Escape restores the plan exactly");
  assert.equal(s().past.length, h0, "history length is unchanged");
  assert.equal(s().future.length, 0, "and there is nothing to redo");

  // A typed length is the same edit as dragging the b handle to that point.
  reset();
  const wall = wallIn(s().plan, "w-BI");
  const typed = lengthTarget(wall, 4.6); // the panel's path
  applyEndpoint("w-BI", "b", typed);
  const byTyping = structuredClone(s().plan);
  close(wallLength(wallIn(byTyping, "w-BI")), 4.6, ROUND_STEP, "the wall is the typed length");
  reset();
  applyEndpoint("w-BI", "b", { x: 4, y: 4.6 }); // the canvas's path: the b handle dragged to the same point
  assert.deepEqual(s().plan, byTyping, "typing a length equals dragging the b handle there");

  // The arrow nudge is a body slide of the perpendicular part only.
  const horizontal = wallIn(s().plan, "w-AB"); // A(0,0)–B(4,0)
  close(normalComponent(horizontal, { x: NUDGE_M, y: 0 }), 0, 1e-12, "a horizontal wall ignores left and right");
  close(Math.abs(normalComponent(horizontal, { x: 0, y: NUDGE_M })), NUDGE_M, 1e-12, "and takes the full step up and down");
  console.log("(7) one drag = one undo step, Escape leaves history untouched with nothing to redo, a typed length equals the b-handle drag, arrows move only perpendicular");
}

// --- (8) delete takes the wall's openings with it; one undo brings everything back
{
  reset();
  const before = structuredClone(s().plan);
  const openings = before.openings.filter((o) => o.wallId === "w-BC").length;
  assert.ok(openings > 0, "w-BC carries openings");
  s().deleteWall("w-BC");
  assert.equal(s().plan.walls.some((w) => w.id === "w-BC"), false, "the wall is gone");
  assert.equal(s().plan.openings.some((o) => o.wallId === "w-BC"), false, "its openings went with it");
  assert.notDeepEqual(names(s().plan), names(before), "and the room it bounded is gone");
  s().undo();
  assert.deepEqual(s().plan, before, "one undo restores the wall, its openings and the room names");
  console.log(`(8) delete removes a wall and its ${openings} openings; one undo restores both and the room names`);
}

// --- (9) typed thickness and height are clamped, with the reason
{
  assert.deepEqual(clampField(0.15, THICKNESS_RANGE, "Thickness"), { value: 0.15 }, "a sensible thickness passes through");
  assert.match(clampField(0.9, THICKNESS_RANGE, "Thickness").note ?? "", /can't be over 0\.6 m/, "too thick is clamped with a reason");
  assert.match(clampField(0.4, HEIGHT_RANGE, "Height").note ?? "", /can't be under 1 m/, "too short is clamped with a reason");
  console.log("(9) thickness and height clamp to their ranges and say why");
}

console.log("test-edit: ok");
