/**
 * test-edit.ts — asserts for src/lib/plan/edit.ts (the pure wall-editing maths)
 * and for the store path the editor components take when they apply it: picking,
 * snapping, dragging a joint, sliding a wall sideways, wall runs (the pieces one
 * straight wall was split into at its T-junctions), the 0.2 m minimum, how rooms
 * and their names survive an edit, one-drag-one-undo, Escape-cancel and delete;
 * and, from (10), drawing walls (step 4.4): snapDraw, drawProblem, splitting a
 * wall at a T-junction, planStore.drawWall as one undo step, rooms re-derived
 * when a drawn wall closes a loop, and a drawn wall editing like any other.
 * Pure Node, no browser. Each block prints what it covers.
 * Run: npx tsx scripts/test-edit.ts (throws on the first failure).
 */
import assert from "node:assert/strict";
import { samplePlan } from "../src/data/samplePlan";
import {
  clampField,
  DRAW_THICKNESS,
  dragEndpoint,
  dragWallBody,
  drawDefaults,
  drawProblem,
  hostAt,
  landsOnPlan,
  splitWallAt,
  snapDraw,
  typedTarget,
  HANDLE_TOL_PX,
  HANDLE_TOL_TOUCH_PX,
  HEIGHT_RANGE,
  lengthTarget,
  MIN_WALL_LENGTH,
  NUDGE_M,
  NUDGE_MERGE_MS,
  NUDGE_SHIFT_M,
  newProblems,
  normalComponent,
  PICK_TOL_PX,
  pickWall,
  ROUND_STEP,
  RUN_ANGLE_DEG,
  SNAP_TOL_PX,
  snapDrag,
  snapRadius,
  THICKNESS_RANGE,
  wallRun,
} from "../src/lib/plan/edit";
import { dist, JOINT_EPS, wallLength } from "../src/lib/plan/geometry";
import { deriveRooms } from "../src/lib/plan/rooms";
import { validatePlan } from "../src/lib/plan/validate";
import { usePlanStore } from "../src/store/planStore";
import type { Plan, Vec2, Wall } from "../src/types/plan";

const s = () => usePlanStore.getState();
const reset = () => s().loadPlan(structuredClone(samplePlan));
const wallIn = (plan: Plan, id: string) => plan.walls.find((w) => w.id === id)!;
const close = (a: number, b: number, eps: number, msg: string) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const names = (plan: Plan) => plan.rooms.map((r) => r.name).sort();

/** How far a wall's a→b heading differs from `deg`, in degrees (0–180). */
const headingDeg = (w: Wall) => (Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x) * 180) / Math.PI;
const turn = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};
/** A direction assert: every piece of a run must stay this straight (degrees). */
const DIR_EPS_DEG = 0.01;
const straight = (plan: Plan, ids: string[], deg: number, msg: string) => {
  for (const id of ids) {
    const h = headingDeg(wallIn(plan, id));
    assert.ok(
      Math.min(turn(h, deg), turn(h, deg + 180)) <= DIR_EPS_DEG,
      `${msg}: ${id} is at ${h.toFixed(4)}°, not within ${DIR_EPS_DEG}° of ${deg}°`,
    );
  }
};

/** The 2D canvas's drag, applied through the store: one transaction, one undo step. */
const applyEndpoint = (wallId: string, end: "a" | "b", to: Vec2) => {
  const out = dragEndpoint(s().plan.walls, wallId, end, to);
  s().transaction(() => s().moveWallEndpoint(wallId, end, out.point));
  return out;
};
/** A body drag through the store: every joint of the dragged wall's run moves. */
const applyBody = (wallId: string, offset: number) => {
  const out = dragWallBody(s().plan.walls, wallId, offset);
  s().transaction(() => {
    for (const m of out.moves) s().moveWallEndpoint(m.wallId, m.end, m.to);
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
    `  wall run: pieces count as one straight wall within ${RUN_ANGLE_DEG.toFixed(2)}° of each other, sharing a joint within ${(JOINT_EPS * 100).toFixed(0)} cm`,
    `  this file asserts a run's pieces keep their direction within ${DIR_EPS_DEG}°, and lengths to 1e-9 m unless it says otherwise`,
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

// --- (5) a T-junction: the stem drag is exact, and dragging one half moves the whole run
{
  // G(0,8)–H(0,4)–A(0,0) is one straight run split at H, with w-HI stemming off it.
  // Dragging the STEM slides the T joint along the run and keeps both halves straight.
  const stem = dragWallBody(samplePlan.walls, "w-HI", 1);
  const sp = { ...samplePlan, walls: stem.walls };
  assert.deepEqual(wallIn(sp, "w-HI").a, { x: 0, y: 5 }, "the T joint stayed on the run (x = 0) and slid along it");
  for (const id of ["w-GH", "w-HA"]) assert.equal(wallIn(sp, id).a.x, wallIn(sp, id).b.x, `${id} is still straight`);
  close(wallLength(wallIn(sp, "w-GH")) + wallLength(wallIn(sp, "w-HA")), 8, 1e-9, "the run is still 8 m end to end");

  // Dragging ONE HALF of the split run now moves the WHOLE run: both halves slide
  // together and stay straight, and the stem stretches to meet the new line.
  const half = dragWallBody(samplePlan.walls, "w-GH", 0.5); // G→H runs north, so its normal points east
  const hp = { ...samplePlan, walls: half.walls };
  assert.deepEqual(half.run, ["w-GH", "w-HA"], "w-GH's run is both halves of the west wall");
  straight(hp, ["w-GH", "w-HA"], 90, "the whole west wall stayed vertical"); // G→H and H→A both head north: -90°
  for (const id of ["w-GH", "w-HA"]) assert.equal(wallIn(hp, id).a.x, 0.5, `${id} slid the full 0.5 m`);
  assert.deepEqual(wallIn(hp, "w-HI").a, { x: 0.5, y: 4 }, "the stem w-HI stretched to the run's new line");
  close(wallLength(wallIn(hp, "w-HI")), 3.5, 1e-9, "which made it 0.5 m shorter");
  console.log("(5) dragging the stem keeps the T joint on the crossing wall; dragging one half of a split wall now slides the whole run and keeps every piece straight");
}

// --- (5a) wallRun: the pieces of each outer wall in order, and a run of one for a lone partition
{
  // Every outer wall of the sample plan is drawn as several pieces, split at its T-junctions.
  const runs: [string, string[]][] = [
    ["w-AB", ["w-AB", "w-BC"]], // north: A(0,0)–B(4,0)–C(10,0)
    ["w-CM", ["w-CM", "w-ME"]], // east: C(10,0)–M(10,5)–E(10,8)
    ["w-LF", ["w-EL", "w-LF", "w-FG"]], // south: E(10,8)–L(7,8)–F(4,8)–G(0,8)
    ["w-HA", ["w-GH", "w-HA"]], // west: G(0,8)–H(0,4)–A(0,0)
    ["w-IF", ["w-BI", "w-IF"]], // the interior spine B(4,0)–I(4,4)–F(4,8) is a run too
  ];
  for (const [id, expected] of runs) {
    assert.deepEqual(wallRun(samplePlan, id), expected, `wallRun(${id}) is the whole straight wall, in order`);
    // Starting from any piece gives the same chain in the same order.
    for (const member of expected) assert.deepEqual(wallRun(samplePlan, member), expected, `wallRun(${member}) agrees`);
  }
  // A partition whose every neighbour crosses it is a run of one.
  for (const id of ["w-HI", "w-KL", "w-KM"]) assert.deepEqual(wallRun(samplePlan, id), [id], `${id} has no collinear neighbour: a run of one`);
  assert.deepEqual(wallRun(samplePlan, "no-such-wall"), [], "an unknown id has no run");
  console.log("(5a) wallRun returns each outer wall's pieces in order from either end, and a run of one for a partition with no collinear neighbour");
}

// --- (5b) case (a): dragging the left half of the north wall up 1 m keeps the whole facade straight
{
  reset();
  const north = wallRun(s().plan, "w-AB");
  assert.deepEqual(north, ["w-AB", "w-BC"], "the north wall is two pieces");
  // "Up" is -y; w-AB heads east, so its normal points south: the offset is negative.
  const out = applyBody("w-AB", normalComponent(wallIn(s().plan, "w-AB"), { x: 0, y: -1 }));
  assert.equal(out.limited, undefined, "1 m north is within reach");
  const p = s().plan;
  straight(p, north, 0, "every piece of the north wall kept its direction");
  for (const [id, end, at] of [
    ["w-AB", "a", { x: 0, y: -1 }], // A
    ["w-AB", "b", { x: 4, y: -1 }], // B, the T joint
    ["w-BC", "b", { x: 10, y: -1 }], // C
  ] as const) {
    assert.deepEqual(wallIn(p, id)[end], at, `${id}.${end} moved the full 1 m north`);
  }
  // The three walls hanging off the facade stretched; none of them tilted.
  for (const [id, len] of [["w-HA", 5], ["w-BI", 5], ["w-CM", 6]] as const) {
    close(wallLength(wallIn(p, id)), len, 1e-9, `${id} stretched by 1 m`);
    assert.equal(wallIn(p, id).a.x, wallIn(p, id).b.x, `${id} stayed vertical`);
  }
  assert.deepEqual(newProblems(validatePlan(samplePlan), validatePlan(p)), [], "no new problems");

  // Rooms are re-derived and keep their names; one undo puts everything back.
  assert.deepEqual(names(p), names(samplePlan), "every room kept its name");
  assert.equal(p.rooms.length, 4, "still four rooms");
  assert.notDeepEqual(deriveRooms(p).map((r) => r.area), deriveRooms(samplePlan).map((r) => r.area), "but the areas grew");
  s().undo();
  assert.deepEqual(s().plan.walls, samplePlan.walls, "one undo restores every wall");
  console.log("(5b) case (a): the left half of the north wall dragged 1 m north carries the right half with it; both stay straight and the three walls below stretch");
}

// --- (5c) case (b): dragging the lower piece of the east wall right 0.8 m, and the bathroom stem
{
  reset();
  const east = wallRun(s().plan, "w-ME");
  assert.deepEqual(east, ["w-CM", "w-ME"], "the east wall is two pieces, split at M where the bathroom's top wall lands");
  const stemWas = wallLength(wallIn(s().plan, "w-KM")); // K(7,5)–M(10,5), the stem at the T
  const out = applyBody("w-ME", normalComponent(wallIn(s().plan, "w-ME"), { x: 0.8, y: 0 }));
  assert.equal(out.limited, undefined, "0.8 m east is within reach");
  const p = s().plan;
  straight(p, east, 90, "every piece of the east wall stayed vertical");
  for (const [id, end] of [["w-CM", "a"], ["w-CM", "b"], ["w-ME", "a"], ["w-ME", "b"]] as const) {
    close(wallIn(p, id)[end].x, 10.8, 1e-9, `${id}.${end} slid the full 0.8 m east`);
  }
  // The stem at the T stretched and still ends exactly on the run's new line.
  const stem = wallIn(p, "w-KM");
  close(wallLength(stem), stemWas + 0.8, 1e-9, "the bathroom's top wall stretched by 0.8 m");
  assert.deepEqual(stem.b, { x: 10.8, y: 5 }, "and still ends on the run");
  assert.deepEqual(stem.a, { x: 7, y: 5 }, "its far end stayed put");
  // The walls at the run's two corners stretched too.
  for (const [id, len] of [["w-BC", 6.8], ["w-EL", 3.8]] as const) close(wallLength(wallIn(p, id)), len, 1e-9, `${id} stretched to the new corner`);
  assert.deepEqual(names(p), names(samplePlan), "every room kept its name");
  s().undo();
  assert.deepEqual(s().plan.walls, samplePlan.walls, "one undo restores every wall");
  assert.deepEqual(names(s().plan), names(samplePlan), "and the room names");
  console.log("(5c) case (b): the lower piece of the east wall dragged 0.8 m east carries the upper piece; both stay vertical, the bathroom's top wall stretches and still ends on the run");
}

// --- (5d) a run drag stops when a stem would go under the minimum, and says so
{
  reset();
  // Pushing the north wall south squeezes w-BI (B(4,0)–I(4,4)) and w-HA (4 m each).
  const far = applyBody("w-AB", normalComponent(wallIn(s().plan, "w-AB"), { x: 0, y: 4 }));
  close(far.offset, 3.8, 0.01, "stopped where the shortest stem reaches 0.2 m");
  assert.match(far.limited ?? "", /shorter than 0\.20 m/, "and says why");
  const p = s().plan;
  close(Math.min(wallLength(wallIn(p, "w-BI")), wallLength(wallIn(p, "w-HA"))), MIN_WALL_LENGTH, 0.01, "the tightest stem sits exactly at the minimum");
  straight(p, ["w-AB", "w-BC"], 0, "and the run is still straight at the limit");
  s().undo();
  assert.deepEqual(s().plan.walls, samplePlan.walls, "one undo restores everything");
  console.log("(5d) a run drag stops at the 0.2 m minimum with a reason, leaves the run straight, and undoes in one step");
}

// --- (5e) endpoint drags are unchanged by runs: a joint handle still moves only the walls at it
{
  // Joint H is the T between the west wall's two halves and the stem w-HI. Dragging
  // the HANDLE moves the vertex itself, so w-HA tilts — exactly as before this step.
  const r = dragEndpoint(samplePlan.walls, "w-GH", "b", { x: 0.5, y: 4 });
  const p = { ...samplePlan, walls: r.walls };
  assert.deepEqual(wallIn(p, "w-GH").b, { x: 0.5, y: 4 }, "the dragged joint moved");
  assert.deepEqual(wallIn(p, "w-GH").a, { x: 0, y: 8 }, "its far end stayed put");
  assert.deepEqual(wallIn(p, "w-HA").a, { x: 0.5, y: 4 }, "w-HA followed the joint");
  assert.deepEqual(wallIn(p, "w-HA").b, { x: 0, y: 0 }, "and its far end stayed put, so it tilts");
  assert.deepEqual(wallIn(p, "w-HI").a, { x: 0.5, y: 4 }, "the stem followed the joint too");
  assert.deepEqual(wallIn(p, "w-BC"), wallIn(samplePlan, "w-BC"), "a wall away from the joint is untouched");
  assert.equal(r.limited, undefined, "a roomy move isn't limited");
  console.log("(5e) an endpoint handle drag still moves only the walls joined at that joint, so a collinear neighbour tilts: moving a vertex, not a wall");
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

// ---------------------------------------------------------------- drawing walls (step 4.4)

/** Where an opening's centre is in plan space: must not move when its wall is split. */
const openingCentres = (plan: Plan) =>
  Object.fromEntries(
    plan.openings.map((o) => {
      const w = wallIn(plan, o.wallId);
      const len = wallLength(w);
      return [o.id, { x: +(w.a.x + ((w.b.x - w.a.x) / len) * o.offset).toFixed(9), y: +(w.a.y + ((w.b.y - w.a.y) / len) * o.offset).toFixed(9) }];
    }),
  );
const size = () => drawDefaults(s().plan.walls);

// --- (10) a valid drawn wall is a normal Wall: id, a, b, thickness, height; one undo step
{
  reset();
  const before = structuredClone(s().plan);
  const past = s().past.length;
  assert.deepEqual(drawDefaults(samplePlan.walls), { thickness: DRAW_THICKNESS, height: 2.7 }, "the plan's commonest height, the draw thickness");
  assert.deepEqual(drawDefaults([]), { thickness: DRAW_THICKNESS, height: 2.7 }, "2.7 m in an empty plan");
  const id = s().drawWall({ x: 6, y: 1 }, { x: 6, y: 3 }, size()); // free-standing, inside the living room
  assert.ok(id, "drawWall returns the new wall's id");
  assert.deepEqual(wallIn(s().plan, id!), { id, a: { x: 6, y: 1 }, b: { x: 6, y: 3 }, thickness: DRAW_THICKNESS, height: 2.7 }, "a plain Wall, nothing else");
  assert.equal(s().plan.walls.length, before.walls.length + 1, "exactly one wall added");
  assert.equal(s().past.length, past + 1, "one undo step");
  const fresh = newProblems(validatePlan(before), validatePlan(s().plan));
  assert.equal(fresh.length, 2, "a free-standing wall has two unjoined ends, and the validator says so");
  assert.ok(fresh.every((p) => p.includes("isn't shared")), "as unjoined ends");
  close(typedTarget({ x: 6, y: 3 }, { x: 6, y: 4.2 }, 1.5)!.y, 4.5, 1e-9, "a typed 1.5 m goes 1.5 m towards the pointer");
  assert.equal(typedTarget({ x: 6, y: 3 }, { x: 6, y: 3 }, 1.5), null, "no direction, no typed wall");
  console.log(`(10) drawWall adds one plain Wall (${DRAW_THICKNESS} m thick, the plan's commonest height) as one undo step; typedTarget measures towards the pointer`);
}

// --- (11) the 0.2 m minimum: refused with a reason, and a refused draw records nothing
{
  reset();
  const before = structuredClone(s().plan);
  assert.match(drawProblem(s().plan, { x: 6, y: 1 }, { x: 6, y: 1.19 }) ?? "", /shorter than 0\.20 m/, "0.19 m is refused");
  assert.match(drawProblem(s().plan, { x: 6, y: 1 }, { x: 6, y: 1 }) ?? "", /shorter than 0\.20 m/, "zero length is refused");
  assert.equal(drawProblem(s().plan, { x: 6, y: 1 }, { x: 6, y: 1.2 }), null, "exactly 0.2 m is allowed");
  assert.equal(s().drawWall({ x: 6, y: 1 }, { x: 6, y: 1.1 }, size()), null, "the store refuses it too");
  assert.deepEqual(s().plan, before, "and the plan is untouched");
  assert.equal(s().past.length, 0, "with nothing in history");
  console.log(`(11) walls under ${MIN_WALL_LENGTH} m (and zero-length ones) are refused with a reason and leave plan and history alone`);
}

// --- (12) endpoint connection: a click near a joint lands exactly on it, and the new wall shares it
{
  reset();
  const K = { x: 7, y: 5 };
  const snap = snapDraw({ x: 7.05, y: 5.04 }, s().plan.walls, { radius: 0.15 });
  assert.deepEqual(snap, { point: K, kind: "endpoint" }, "lands on joint K exactly");
  assert.equal(landsOnPlan(s().plan.walls, K), true, "K is on the plan");
  const before = structuredClone(s().plan);
  const id = s().drawWall(snap.point, { x: 7, y: 3 }, size())!;
  const w = wallIn(s().plan, id);
  assert.deepEqual(w.a, K, "the new wall starts at K");
  assert.equal(s().plan.walls.filter((x) => dist(x.a, K) < JOINT_EPS || dist(x.b, K) < JOINT_EPS).length, 3, "three walls now share joint K");
  assert.equal(s().plan.walls.length, before.walls.length + 1, "no wall was split: K was already a joint");
  const fresh = newProblems(validatePlan(before), validatePlan(s().plan));
  assert.deepEqual(fresh, [`Wall ${id} end b (7, 3) isn't shared with any other wall.`], "only the free end is unjoined");
  console.log("(12) a wall drawn to an existing joint shares it exactly; only its free end is reported");
}

// --- (13) T-junctions: landing on a wall's middle or body splits that wall there
{
  reset();
  const before = structuredClone(s().plan);
  const centres = openingCentres(before);
  // The midpoint of w-AB A(0,0)–B(4,0) beats the grid, then splits w-AB.
  const mid = snapDraw({ x: 2.03, y: 0.04 }, s().plan.walls, { radius: 0.15 });
  assert.deepEqual(mid, { point: { x: 2, y: 0 }, kind: "midpoint" }, "the midpoint of w-AB");
  assert.equal(hostAt(s().plan.walls, mid.point), "w-AB", "which is the middle of w-AB");
  // A point near the body of w-BI B(4,0)–I(4,4), away from its midpoint, lands ON its centre line.
  const onWall = snapDraw({ x: 4.04, y: 1.52 }, s().plan.walls, { radius: 0.15 });
  assert.deepEqual(onWall, { point: { x: 4, y: 1.52 }, kind: "wall" }, "on w-BI's centre line, 1 cm grid kept");
  // A 0° ray from (4, 1.5) that ends near w-CM C(10,0)–M(10,5) meets it on the ray, so the angle is kept.
  const ray = snapDraw({ x: 9.95, y: 1.53 }, s().plan.walls, { from: { x: 4, y: 1.5 }, radius: 0.15 });
  assert.deepEqual(ray, { point: { x: 10, y: 1.5 }, kind: "wall" }, "where the 0° ray crosses w-CM");

  const past = s().past.length;
  const id = s().drawWall({ x: 4, y: 1.5 }, { x: 10, y: 1.5 }, size())!; // splits the living room in two
  assert.equal(s().past.length, past + 1, "two splits and a new wall are ONE undo step");
  assert.equal(s().plan.walls.length, before.walls.length + 3, "the new wall plus one extra piece of each wall it joins");
  assert.deepEqual(newProblems(validatePlan(before), validatePlan(s().plan)), [], "every end is a shared joint: no new problems");
  assert.deepEqual(wallIn(s().plan, "w-BI").b, { x: 4, y: 1.5 }, "w-BI keeps its id and now ends at the T");
  assert.deepEqual(wallIn(s().plan, "w-CM").b, { x: 10, y: 1.5 }, "so does w-CM");
  assert.equal(wallRun(s().plan, "w-BI").length, 3, "and its two pieces are one straight run with w-IF beyond I");
  assert.deepEqual(openingCentres(s().plan), centres, "no door or window moved");
  assert.ok(s().plan.openings.some((o) => o.id === "d-bed1" && o.wallId !== "w-BI"), "d-bed1, past the split, moved to the second piece");
  assert.equal(hostAt(s().plan.walls, { x: 4, y: 1.5 }), null, "nothing is left landing on a wall's middle");
  assert.ok(wallIn(s().plan, id), "the drawn wall is in");

  // A split through a door or window, or too near a wall's end, is refused.
  assert.match(drawProblem(before, { x: 7, y: 2.5 }, { x: 10, y: 2.5 }) ?? "", /middle of a window/, "w-CM's window is at 1.9–3.1 m");
  assert.match(drawProblem(before, { x: 0, y: 2 }, { x: 2, y: 2 }) ?? "", /middle of a window/, "w-HA's window sits on its midpoint");
  const tooClose = splitWallAt(before, "w-AB", { x: 0.1, y: 0 }, "x");
  assert.ok("error" in tooClose && /too close/i.test(tooClose.error), "0.1 m from A is too close to split");
  // ...and snapDraw never offers that: within 0.2 m of an end it takes the end itself.
  assert.deepEqual(snapDraw({ x: 3.88, y: 0.02 }, before.walls, { radius: 0.05 }), { point: { x: 4, y: 0 }, kind: "endpoint" }, "near B on w-AB: B itself");
  console.log("(13) landing on a wall's midpoint or body splits it into a straight run at that point in the same undo step; openings keep their place; splits through openings or within 0.2 m of an end are refused");
}

// --- (14) crossing, running along, and the snapping order the Wall tool uses
{
  reset();
  const plan = s().plan;
  assert.match(drawProblem(plan, { x: 2, y: 1 }, { x: 2, y: 6 }) ?? "", /cross another wall/, "through w-HI is a crossing");
  assert.match(drawProblem(plan, { x: 1, y: 0 }, { x: 3, y: 0 }) ?? "", /run along/, "along w-AB overlaps it");
  assert.equal(drawProblem(plan, { x: 4, y: 0 }, { x: 4, y: -2 }), null, "carrying on from a joint, straight out, is fine");
  // Same order as snapDrag (endpoint > midpoint > angle > grid), with "on wall" after midpoint.
  const r = 0.15;
  assert.equal(snapDraw({ x: 4.05, y: 0.05 }, plan.walls, { radius: r }).kind, "endpoint", "endpoint first");
  assert.equal(snapDraw({ x: 2.05, y: 0.05 }, plan.walls, { radius: r }).kind, "midpoint", "midpoint beats the wall body under it");
  assert.equal(snapDraw({ x: 2.53, y: 0.03 }, plan.walls, { radius: r }).kind, "wall", "the body beats the grid");
  assert.deepEqual(snapDraw({ x: 6.0, y: 2.03 }, plan.walls, { from: { x: 4, y: 4 }, radius: r }), snapDrag({ x: 6.0, y: 2.03 }, plan.walls, { from: { x: 4, y: 4 }, radius: r }), "angle, as snapDrag");
  assert.deepEqual(snapDraw({ x: 6.37, y: 2.03 }, plan.walls, { radius: r }), { point: { x: 6.35, y: 2.05 }, kind: "grid" }, "then the 5 cm grid");
  assert.deepEqual(snapDraw({ x: 2.531, y: 0.017 }, plan.walls, { radius: r, free: true }), { point: { x: 2.53, y: 0.02 }, kind: null }, "Alt: no snapping, 1 cm rounding");
  console.log("(14) crossing or overlapping an existing wall is refused; snapDraw order endpoint > midpoint > on wall > angle > grid, Alt disables");
}

// --- (15) closing a loop re-derives the rooms; undo and redo walk it back and forth
{
  reset();
  const original = structuredClone(s().plan);
  const bed1 = () => deriveRooms(s().plan).find((r) => r.name === "Bedroom 1")!;
  const bed1Area = bed1().area;
  // A cupboard in Bedroom 1's north-east corner: (2,0) [midpoint of w-AB] → (2,1.5) → (4,1.5) [on w-BI].
  assert.equal(landsOnPlan(s().plan.walls, { x: 2, y: 1.5 }), false, "(2, 1.5) is open floor: the chain goes on");
  s().drawWall({ x: 2, y: 0 }, { x: 2, y: 1.5 }, size());
  assert.equal(s().plan.rooms.length, 4, "one wall alone closes nothing");
  const half = structuredClone(s().plan);
  assert.equal(landsOnPlan(s().plan.walls, { x: 4, y: 1.5 }), true, "(4, 1.5) is on w-BI: the chain ends there");
  s().drawWall({ x: 2, y: 1.5 }, { x: 4, y: 1.5 }, size());
  const closed = structuredClone(s().plan);
  const rooms = deriveRooms(closed);
  assert.equal(closed.rooms.length, 5, "the second wall closes a fifth room");
  assert.deepEqual(names(closed).filter((n) => !names(original).includes(n)).length, 1, "with a new default name; the old names stay");
  // Net area: x 2.075–3.95 (half of 0.15 drawn, half of 0.1 interior), y 0.1–1.425 (half of 0.2 exterior).
  const cupboard = rooms.find((r) => !names(original).includes(r.name))!;
  close(cupboard.area, (3.95 - 2.075) * (1.425 - 0.1), 1e-6, "the new room's net area");
  assert.ok(bed1().area < bed1Area - cupboard.area, "Bedroom 1 lost the cupboard and its walls");
  assert.deepEqual(newProblems(validatePlan(original), validatePlan(closed)), [], "and the plan is valid");

  assert.equal(s().past.length, 2, "two walls, two undo steps");
  s().undo();
  assert.deepEqual(s().plan, half, "undo takes the closing wall off, its split and the fifth room with it");
  s().undo();
  assert.deepEqual(s().plan, original, "a second undo is the sample again");
  s().redo();
  s().redo();
  assert.deepEqual(s().plan, closed, "redo twice: walls, splits and rooms are back");
  console.log(`(15) closing a loop adds a room (net ${cupboard.area.toFixed(3)} m²) and shrinks Bedroom 1; undo and redo restore each wall exactly`);
}

// --- (16) a drawn wall edits like any other: pick, handles, body drag, typed length, size, delete
{
  reset();
  const id = s().drawWall({ x: 4, y: 1.5 }, { x: 10, y: 1.5 }, size())!;
  const baseline = validatePlan(s().plan);
  assert.deepEqual(pickWall({ x: 7, y: 1.52 }, s().plan.walls, 0.16, 0.24), { wallId: id, end: null }, "picked by its body");
  // Body drag: the whole wall slides 0.5 m south; the walls it joins stretch and stay straight.
  const body = applyBody(id, 0.5);
  assert.equal(body.limited, undefined, "within reach");
  assert.deepEqual([wallIn(s().plan, id).a, wallIn(s().plan, id).b], [{ x: 4, y: 2 }, { x: 10, y: 2 }], "slid with its T-joints on w-BI and w-CM");
  straight(s().plan, wallRun(s().plan, "w-BI"), 90, "the split w-BI after the slide");
  assert.deepEqual(newProblems(baseline, validatePlan(s().plan)), [], "still valid");
  s().undo();
  // Free end handle and typed length, on a free-standing drawn wall.
  const free = s().drawWall({ x: 6, y: 3 }, { x: 6, y: 4 }, size())!;
  applyEndpoint(free, "b", { x: 6, y: 4.4 });
  close(wallLength(wallIn(s().plan, free)), 1.4, 1e-9, "its b handle drags");
  applyEndpoint(free, "b", lengthTarget(wallIn(s().plan, free), 2.25));
  close(wallLength(wallIn(s().plan, free)), 2.25, 1e-9, "a typed length takes");
  s().updateWall(free, { thickness: 0.2, height: 3 });
  assert.equal(wallIn(s().plan, free).thickness, 0.2, "thickness edits");
  assert.equal(wallIn(s().plan, free).height, 3, "height edits");
  const kept = structuredClone(s().plan);
  s().deleteWall(free);
  assert.equal(s().plan.walls.some((w) => w.id === free), false, "delete removes it");
  s().undo();
  assert.deepEqual(s().plan, kept, "and undo brings it back");
  console.log("(16) a drawn wall is picked, body-dragged with its T-joints, handle-dragged, typed to a length, resized and deleted through the same paths as any wall");
}

console.log("test-edit: ok");
