/**
 * test-pushpull-openings.ts — asserts for step 4.7b, no browser: door and window
 * faces for the 3D Push/Pull tool, the Move tool, and picking openings in 3D.
 *   0. failing first: the existing resizeOpening keeps the CENTRE, so pulling one side
 *      moves the other; resizeOpeningEdge keeps the opposite edge where it was.
 *   1. the pure edits (src/lib/plan/edit.ts): resizeOpeningEdge on a horizontal and a
 *      vertical wall, both sides, out and in, with the opposite edge fixed to 1e-9, and
 *      its clamps (0.3 m, 4 m, a wall end, a T-joint, a neighbouring opening);
 *      resizeOpeningHead and resizeOpeningSill limits for doors and windows, including
 *      the wall's height; the door sill refusal; moveOpening's limits and midpoint snap.
 *   2. the pull rules (src/lib/plan/pushpull.ts): the sign convention (+ = bigger),
 *      the labels, faceAxis, faceBlock.
 *   3. the store (src/store/pushPullStore.ts): one pull is one undo step, redo works,
 *      Escape leaves history as it was, typed equals dragged, a commit selects the
 *      opening, Move's typed direction, Move refuses a wall top (4.7c: a wall side moves); openings stay inside their
 *      wall when the wall is edited afterwards.
 *   4. picking (src/lib/handles3d/edges.ts): resolveOpeningEdge with hand-made
 *      segments, the edge lines (a door has no sill edge, the face toward the camera),
 *      and pickAlongRay (an opening beats the wall in front of it within one thickness).
 *   5. the tool shortcuts (src/store/toolStore.ts): no two tools share a key, and none
 *      is a key a typed distance or the walk uses.
 * Run: npx tsx scripts/test-pushpull-openings.ts (throws on the first failure).
 */
import assert from "node:assert/strict";
import { samplePlan } from "../src/data/samplePlan";
import { EDGE_TOL_MOUSE_PX, EDGE_TOL_TOUCH_PX, openingEdgeLines, openingFaceQuad, pickAlongRay, resolveOpeningEdge, type ScreenEdge } from "../src/lib/handles3d/edges";
import { DOOR_ON_FLOOR, moveOpening, NEXT_TO_OPENING, openingProblem, resizeOpening, resizeOpeningEdge, resizeOpeningHead, resizeOpeningSill } from "../src/lib/plan/edit";
import { wallLength } from "../src/lib/plan/geometry";
import { faceAxis, faceBlock, MOVE_TOP, pullOpening } from "../src/lib/plan/pushpull";
import { usePlanStore } from "../src/store/planStore";
import { usePushPullStore, type Face } from "../src/store/pushPullStore";
import { useSelectionStore } from "../src/store/selectionStore";
import { TOOL_SHORTCUTS } from "../src/store/toolStore";
import type { Opening, Plan, Wall } from "../src/types/plan";

const close = (a: number, b: number, eps: number, msg: string) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const fresh = (): Plan => {
  usePlanStore.getState().loadPlan(structuredClone(samplePlan));
  return usePlanStore.getState().plan;
};
const op = (plan: Plan, id: string) => plan.openings.find((o) => o.id === id)!;
const edgeA = (o: Pick<Opening, "offset" | "width">) => o.offset - o.width / 2;
const edgeB = (o: Pick<Opening, "offset" | "width">) => o.offset + o.width / 2;
/** Unwrap an ok FaceEdit, failing the test if it was refused. */
function ok<T>(r: { ok: true; value: T; reason: string | null } | { ok: false; value: null; reason: string }, msg: string): { value: T; reason: string | null } {
  assert.ok(r.ok, `${msg}: refused (${r.reason})`);
  return r;
}

// Sample plan, for reference: w-BC B(4,0) → C(10,0), 0.2 thick, a T at B (w-BI, 0.1) and a corner at C
// (w-CM, 0.2): usable span 0.05 → 5.9. On it d-front (centre 3, 1 m: 2.5 → 3.5) and win-living-n
// (centre 5, 1.2 m: 4.4 → 5.6). w-HA H(0,4) → A(0,0) runs north: span 0.05 → 3.9, win-bed1 centre 2, 1.2 m (1.4 → 2.6).

// ================================================================= 0. failing first

/** Pull edge B of win-living-n out 0.2 m with `resize`, and require edge A to stay exactly where it was. */
function anchoredEdgeHolds(resize: (plan: Plan, id: string, newEdgeB: number) => { offset: number; width: number }) {
  const plan = fresh();
  const o = op(plan, "win-living-n");
  const r = resize(plan, o.id, edgeB(o) + 0.2);
  close(edgeA(r), edgeA(o), 1e-9, "the opposite edge (A) stays put");
  close(edgeB(r), edgeB(o) + 0.2, 1e-9, "the dragged edge (B) lands where it was dragged");
}
assert.throws(
  () =>
    anchoredEdgeHolds((plan, id, b) => {
      const o = op(plan, id);
      const r = resizeOpening(plan, id, b - edgeA(o)); // the existing panel resize: the same new width, centre kept
      if ("error" in r) throw new Error(r.error);
      return r;
    }),
  /the opposite edge \(A\) stays put: 4\.3 vs 4\.4/,
  "the existing resizeOpening moves the opposite edge 0.1 m (it keeps the centre): the anchored behaviour is new",
);
anchoredEdgeHolds((plan, id, b) => ok(resizeOpeningEdge(plan, id, "B", b), "edge B").value);

// ================================================================= 1. the pure edits

// ---- resizeOpeningEdge: each side, out and in, on a horizontal wall (w-BC) and a vertical one (w-HA)
{
  const plan = fresh();
  for (const id of ["win-living-n", "win-bed1"]) {
    const o = op(plan, id);
    const wall = plan.walls.find((w) => w.id === o.wallId)!;
    const [a, b] = [edgeA(o), edgeB(o)];
    const cases: ["A" | "B", number][] = [["B", b + 0.2], ["B", b - 0.3], ["A", a - 0.3], ["A", a + 0.4]];
    for (const [edge, to] of cases) {
      const tag = `${id} on ${wall.id}: edge ${edge} to ${to.toFixed(2)}`;
      const r = ok(resizeOpeningEdge(plan, id, edge, to), tag);
      assert.equal(r.reason, null, `${tag}: inside every limit`);
      if (edge === "B") {
        close(edgeA(r.value), a, 1e-9, `${tag}: edge A unchanged`);
        close(edgeB(r.value), to, 1e-9, `${tag}: edge B where it was dragged`);
      } else {
        close(edgeB(r.value), b, 1e-9, `${tag}: edge B unchanged`);
        close(edgeA(r.value), to, 1e-9, `${tag}: edge A where it was dragged`);
      }
      assert.equal(openingProblem(plan, { ...o, ...r.value }), null, `${tag}: a valid opening`);
    }
  }

  // the clamps, each with its reason
  const win = op(plan, "win-living-n");
  const door = op(plan, "d-front");
  const min = ok(resizeOpeningEdge(plan, win.id, "B", edgeA(win) + 0.1), "min");
  assert.equal(min.value.width, 0.3, "a side pushed nearly onto the other stops at 0.3 m");
  assert.equal(min.reason, "Openings can't be narrower than 0.3 m, so it's 0.3 m.");
  close(edgeA(min.value), edgeA(win), 1e-9, "…with the other side still fixed");
  const past = ok(resizeOpeningEdge(plan, win.id, "B", edgeA(win) - 1), "past");
  assert.equal(past.value.width, 0.3, "a side pushed right past the other also stops at 0.3 m");

  const end = ok(resizeOpeningEdge(plan, win.id, "B", 7), "wall end");
  close(edgeB(end.value), 5.9, 1e-9, "the window's side stops at the usable span's end (6 m - half the 0.2 m corner wall)");
  assert.equal(end.reason, "Stopped at the end of the wall");
  close(edgeA(end.value), edgeA(win), 1e-9, "…edge A unchanged");

  const tee = ok(resizeOpeningEdge(plan, door.id, "A", -1), "T-joint");
  close(edgeA(tee.value), 0.05, 1e-9, "the door's side stops half the 0.1 m stem's thickness short of the T-joint at B");
  assert.equal(tee.value.width, 3.45);
  assert.equal(tee.reason, "Stopped at the end of the wall");

  const next = ok(resizeOpeningEdge(plan, door.id, "B", 5), "neighbour");
  close(edgeB(next.value), edgeA(win), 1e-9, "the door's side stops at the window's side");
  assert.equal(next.reason, NEXT_TO_OPENING);
  assert.equal(next.reason, "Next to another opening");
  assert.equal(openingProblem(plan, { ...door, ...next.value }), null, "touching the neighbour is allowed; overlapping it is not");
  const back = ok(resizeOpeningEdge(plan, win.id, "A", 1), "neighbour, the other way");
  close(edgeA(back.value), edgeB(door), 1e-9, "the window's side stops at the door's");
  assert.equal(back.reason, "Next to another opening");

  // 4 m: a long free wall with a 1 m opening in its middle
  const long: Wall = { id: "w", a: { x: 0, y: 0 }, b: { x: 12, y: 0 }, thickness: 0.2, height: 2.7 };
  const lone: Opening = { id: "o", wallId: "w", kind: "window", offset: 6, width: 1, height: 1.2, sillHeight: 0.9 };
  const max = ok(resizeOpeningEdge({ walls: [long], openings: [lone] }, "o", "B", 11.5), "max");
  assert.equal(max.value.width, 4, "never wider than 4 m");
  assert.equal(max.reason, "Openings can't be wider than 4 m, so it's 4 m.");
  close(edgeA(max.value), 5.5, 1e-9, "…edge A unchanged");

  // results round to 1 cm
  const rounded = ok(resizeOpeningEdge(plan, win.id, "B", edgeB(win) + 0.1234), "rounding");
  close(rounded.value.width, 1.32, 1e-9, "the width is rounded to 1 cm");
  assert.equal(resizeOpeningEdge(plan, "nope", "A", 1).ok, false, "an opening that is gone is refused");
}

// ---- resizeOpeningHead and resizeOpeningSill
{
  const plan = fresh();
  const door = op(plan, "d-front"); // 2.1 m on a 2.7 m wall
  const win = op(plan, "win-living-n"); // sill 0.9, 1.2 m tall: top 2.1
  close(ok(resizeOpeningHead(plan, door.id, 2.4), "door up").value.height, 2.4, 1e-9, "a door's top moves up");
  const doorHigh = ok(resizeOpeningHead(plan, door.id, 3), "door past the wall");
  assert.equal(doorHigh.value.height, 2.7, "…but not past the wall");
  assert.equal(doorHigh.reason, "Wall is 2.70 m high");
  const doorLow = ok(resizeOpeningHead(plan, door.id, 1.2), "door down");
  assert.equal(doorLow.value.height, 1.8, "a door is at least 1.8 m tall");
  assert.equal(doorLow.reason, "A door can't be under 1.8 m tall, so it's 1.8 m.");

  const winUp = ok(resizeOpeningHead(plan, win.id, 2.5), "window up");
  close(winUp.value.height, 1.6, 1e-9, "a window's top moves up; the sill stays");
  const winHigh = ok(resizeOpeningHead(plan, win.id, 9), "window past the wall");
  close(winHigh.value.height, 1.8, 1e-9, "sill + height never above the wall: 0.9 + 1.8 = 2.7");
  assert.equal(winHigh.reason, "Wall is 2.70 m high");
  const winLow = ok(resizeOpeningHead(plan, win.id, 1), "window down");
  assert.equal(winLow.value.height, 0.3, "a window is at least 0.3 m tall");
  assert.equal(winLow.reason, "A window can't be under 0.3 m tall, so it's 0.3 m.");

  // the wall's height decides: the same door on a 3.2 m wall
  const tall = { ...plan, walls: plan.walls.map((w) => (w.id === door.wallId ? { ...w, height: 3.2 } : w)) };
  const doorTall = ok(resizeOpeningHead(tall, door.id, 3.5), "door on a taller wall");
  assert.equal(doorTall.value.height, 3.2);
  assert.equal(doorTall.reason, "Wall is 3.20 m high");
  assert.equal(ok(resizeOpeningHead(tall, door.id, 3), "door 3 m").reason, null, "3 m fits a 3.2 m wall");

  const down = ok(resizeOpeningSill(plan, win.id, 0.6), "sill down");
  assert.deepEqual(down.value, { sillHeight: 0.6, height: 1.5 }, "the sill goes down, the window gets taller");
  close(down.value.sillHeight + down.value.height, 2.1, 1e-9, "…and the top stays at 2.1 m");
  assert.equal(down.reason, null);
  const floor = ok(resizeOpeningSill(plan, win.id, -0.2), "sill below the floor");
  assert.deepEqual(floor.value, { sillHeight: 0, height: 2.1 });
  assert.equal(floor.reason, "The sill can't be below the floor, so it's 0 m.");
  const up = ok(resizeOpeningSill(plan, win.id, 2), "sill up");
  assert.deepEqual(up.value, { sillHeight: 1.8, height: 0.3 }, "a sill pushed up stops 0.3 m under the top");
  assert.equal(up.reason, "A window can't be under 0.3 m tall, so the sill stops at 1.80 m.");
  const doorSill = resizeOpeningSill(plan, door.id, 0.3);
  assert.equal(doorSill.ok, false, "a door has no sill to move");
  assert.equal(doorSill.reason, DOOR_ON_FLOOR);
  assert.equal(doorSill.reason, "A door stays on the floor");
}

// ---- moveOpening: the 2D tool's snapping, then slideOpening's limits
{
  const plan = fresh();
  const at = (id: string, offset: number, radius = 0.1, free = false) => ok(moveOpening(plan, id, offset, { radius, free }), `${id} to ${offset}`);
  assert.equal(at("win-bed1", 2.37).value.offset, 2.35, "the centre snaps to 5 cm");
  assert.equal(at("win-bed1", 2.37).value.snap, "grid");
  assert.equal(at("win-bed1", 2.08).value.offset, 2, "within reach of the wall's midpoint (2 m on a 4 m wall), it snaps there");
  assert.equal(at("win-bed1", 2.08).value.snap, "midpoint");
  assert.equal(at("win-bed1", 2.08, 0.05).value.offset, 2.1, "…not when the midpoint is out of reach");
  assert.equal(at("win-bed1", 2.37, 0.1, true).value.offset, 2.37, "Alt: no snapping, 1 cm");
  const neighbour = at("d-front", 4.5);
  close(neighbour.value.offset, 3.9, 1e-9, "the door stops with its side against the window's (4.4 - 0.5)");
  assert.match(neighbour.reason ?? "", /window next to it/);
  const end = at("win-living-n", 6);
  close(end.value.offset, 5.3, 1e-9, "the window stops at the usable span's end (5.9 - 0.6)");
  assert.match(end.reason ?? "", /end of the wall/);
  assert.equal(at("win-living-n", 5.2).reason, null, "inside the limits: no reason");
}

// ================================================================= 2. the pull rules

{
  const plan = fresh();
  const win = op(plan, "win-living-n");
  // the sign convention: + makes the opening bigger, whichever face
  const a = pullOpening(plan, win.id, "jambA", 0.2)!;
  close(a.changes.width!, 1.4, 1e-9, "+0.2 on side A: 0.2 m wider");
  close(edgeA({ offset: a.changes.offset!, width: a.changes.width! }), edgeA(win) - 0.2, 1e-9, "…by moving side A towards the wall's start");
  close(edgeB({ offset: a.changes.offset!, width: a.changes.width! }), edgeB(win), 1e-9, "…with side B fixed");
  assert.equal(a.value, "Width 1.40 m");
  assert.equal(a.fixed, "Fixed: the side nearer the wall's end");
  const b = pullOpening(plan, win.id, "jambB", -0.2)!;
  close(b.changes.width!, 1, 1e-9, "-0.2 on side B: 0.2 m narrower");
  assert.equal(b.fixed, "Fixed: the side nearer the wall's start");
  const head = pullOpening(plan, win.id, "head", 0.3)!;
  assert.deepEqual(head.changes, { height: 1.5 });
  assert.equal(head.value, "Height 1.50 m");
  assert.equal(head.fixed, "Fixed: the sill");
  const sill = pullOpening(plan, win.id, "sill", 0.3)!;
  assert.deepEqual(sill.changes, { sillHeight: 0.6, height: 1.5 }, "+0.3 on the sill: it goes DOWN 0.3 and the window is 0.3 taller");
  assert.equal(sill.value, "Sill 0.60 m");
  assert.equal(sill.fixed, "Fixed: the top");
  assert.equal(pullOpening(plan, "d-front", "head", 0.2)!.fixed, "Fixed: the floor");
  // the distance reported is what really happened
  const clamped = pullOpening(plan, win.id, "head", 5)!;
  close(clamped.distance, 0.6, 1e-9, "a clamped pull reports the distance it really moved");
  assert.equal(clamped.requested, 5);
  assert.equal(clamped.note, "Wall is 2.70 m high");
  const move = pullOpening(plan, "win-bed1", "move", 0.4, { radius: 0.1 })!;
  assert.deepEqual(move.changes, { offset: 2.4 });
  assert.equal(move.value, "Centre 2.40 m from the wall start");
  assert.equal(pullOpening(plan, "win-bed1", "move", 0.06, { radius: 0.1 })!.fixed, "At the middle of the wall");
  // refusals and blocks
  assert.equal(pullOpening(plan, "d-front", "sill", 0.2)!.refused, "A door stays on the floor");
  assert.equal(pullOpening(plan, "nope", "head", 0.2), null);
  const face = (role: Face["role"], openingId: string | null, wallId = "w-BC"): Face => ({ wallId, role, openingId });
  assert.equal(faceBlock(plan, face("sill", "d-front")), "A door stays on the floor");
  assert.equal(faceBlock(plan, face("sill", win.id)), null);
  assert.equal(faceBlock(plan, face("jambA", win.id)), null);
  assert.equal(faceBlock(plan, face("sideLeft", null)), null, "4.7c wired the wall sides");
  assert.equal(faceBlock(plan, face("top", null)), null);
  assert.equal(faceBlock(plan, face("sideLeft", null), true), null, "4.7c: Move over a wall side moves the wall");
  assert.equal(faceBlock(plan, face("top", null), true), MOVE_TOP, "Move over a wall top says why not");
  assert.equal(faceBlock(plan, face("jambB", "d-front"), true), null, "Move over an opening's face moves the opening");

  // faceAxis: sides along the wall through the centre at mid-height, top and sill along world Y
  const ax = (role: Face["role"], move = false) => faceAxis(plan, face(role, win.id), move, { x: 0, y: 0, z: 0 })!;
  assert.deepEqual(ax("jambB"), { anchor: { x: 9, y: 1.5, z: 0 }, axis: { x: 1, y: 0, z: 0 }, sign: 1 }, "w-BC runs +x; side B grows along it");
  assert.equal(ax("jambA").sign, -1, "side A grows against the wall's direction");
  assert.deepEqual(ax("head"), { anchor: { x: 9, y: 2.1, z: 0 }, axis: { x: 0, y: 1, z: 0 }, sign: 1 });
  assert.deepEqual(ax("sill"), { anchor: { x: 9, y: 0.9, z: 0 }, axis: { x: 0, y: 1, z: 0 }, sign: -1 }, "a sill grows downwards");
  assert.deepEqual(ax("head", true), { anchor: { x: 9, y: 1.5, z: 0 }, axis: { x: 1, y: 0, z: 0 }, sign: 1 }, "Move: along the wall, whatever face");
  const top = faceAxis(plan, face("top", null), false, { x: 1, y: 2.7, z: 0 })!;
  assert.deepEqual(top, { anchor: { x: 1, y: 2.7, z: 0 }, axis: { x: 0, y: 1, z: 0 }, sign: 1 }, "a wall top, unchanged from 4.7a");
  const vertical = faceAxis(plan, face("jambA", "win-bed1", "w-HA"), false, { x: 0, y: 0, z: 0 })!;
  assert.deepEqual(vertical.axis, { x: 0, y: 0, z: -1 }, "w-HA runs north: -z in world space");
}

// ================================================================= 3. the store

const S = () => usePlanStore.getState();
const T = () => usePushPullStore.getState();
const winFace = (role: Face["role"]): Face => ({ wallId: "w-BC", role, openingId: "win-living-n" });

{
  const base = fresh();
  useSelectionStore.getState().select(null);
  T().setKind("pull");

  // a drag on side B: many moves, ONE history entry, the plan live the whole time, edge A fixed
  assert.equal(T().begin(winFace("jambB"), { mode: "drag" }), true);
  for (const d of [0.05, 0.1, 0.2, 0.3]) {
    T().move(d);
    assert.equal(S().past.length, 1, `after a move to ${d}: one history entry`);
    const w = op(S().plan, "win-living-n");
    close(w.width, 1.2 + d, 1e-9, `the plan follows the pointer (${d})`);
    close(edgeA(w), 4.4, 1e-9, "edge A never moves");
  }
  assert.equal(T().pull!.opening!.value, "Width 1.50 m");
  const dragged = structuredClone(S().plan);
  T().commit();
  assert.equal(S().past.length, 1, "a commit is one undo step");
  assert.deepEqual(S().plan, dragged);
  assert.equal(useSelectionStore.getState().openingId, "win-living-n", "the pulled window becomes the selection, so the panel shows its numbers");
  S().undo();
  assert.deepEqual(S().plan, base, "one undo restores it");
  S().redo();
  assert.deepEqual(S().plan, dragged, "redo brings it back");
  S().undo();

  // typed equals dragged, for every opening face, out and in
  for (const [role, d] of [["jambA", 0.3], ["jambB", -0.2], ["head", 0.25], ["sill", 0.3], ["sill", -0.4]] as const) {
    assert.equal(T().begin(winFace(role), { mode: "drag" }), true);
    T().move(d);
    const byPointer = structuredClone(S().plan);
    T().cancel();
    assert.deepEqual(S().plan, base, "cancelled: back to the start");
    assert.equal(T().begin(winFace(role), { mode: "click" }), true);
    T().setTyped(String(d));
    assert.equal(T().applyTyped(), true);
    assert.deepEqual(S().plan, byPointer, `${role}: typing ${d} lands where dragging ${d} m does`);
    assert.equal(S().past.length, 1, "one undo step");
    S().undo();
  }
  // the head of a window: its sill stays; its sill: its top stays
  assert.equal(T().begin(winFace("sill"), { mode: "drag" }), true);
  T().move(0.3);
  const lowered = op(S().plan, "win-living-n");
  assert.deepEqual([lowered.sillHeight, lowered.sillHeight + lowered.height], [0.6, 2.1], "pulling the sill down lowers it; the head stays at 2.1");
  T().cancel();

  // Escape (cancel) mid-pull: history exactly as it was
  S().renamePlan("history marker");
  const pastBefore = S().past.length;
  const planBefore = structuredClone(S().plan);
  assert.equal(T().begin(winFace("head"), { mode: "drag" }), true);
  T().move(0.4);
  assert.notDeepEqual(S().plan, planBefore, "the pull is live before Escape");
  T().cancel();
  assert.equal(S().past.length, pastBefore, "Escape leaves the history length as it was");
  assert.deepEqual(S().plan, planBefore, "and the plan exactly as it was");
  S().undo();

  // snapping 5 cm, Alt 1 cm
  assert.equal(T().begin(winFace("jambB"), { mode: "drag" }), true);
  T().move(0.123);
  close(op(S().plan, "win-living-n").width, 1.3, 1e-9, "0.123 snaps to 0.10");
  T().setAlt(true);
  T().move(0.123); // as for a wall top: Alt re-applies the last distance, the next pointer move is unsnapped
  close(op(S().plan, "win-living-n").width, 1.32, 1e-9, "Alt: 1 cm");
  T().setAlt(false);
  T().cancel();

  // a door's bottom: refused, with the reason, and nothing changes
  const planNow = S().plan;
  const door: Face = { wallId: "w-BC", role: "sill", openingId: "d-front" };
  T().setHover(door);
  assert.equal(T().message, "A door stays on the floor", "hovering a door's bottom says why");
  assert.equal(T().begin(door, { mode: "drag" }), false);
  assert.equal(T().pull, null);
  assert.equal(S().plan, planNow, "nothing changed");
  T().setHover(null);

  // Move: along the wall, typed distances go the way the pointer last went
  T().setKind("move");
  const moveFace: Face = { wallId: "w-HA", role: "jambA", openingId: "win-bed1" };
  assert.equal(T().begin(moveFace, { mode: "drag", radius: 0.1 }), true);
  T().move(0.33);
  close(op(S().plan, "win-bed1").offset, 2.35, 1e-9, "a Move snaps the centre to 5 cm");
  assert.equal(T().pull!.opening!.value, "Centre 2.35 m from the wall start");
  T().move(-0.27);
  assert.equal(T().pull!.direction, -1, "the pointer last went towards the wall's start");
  T().setTyped("0.4");
  close(op(S().plan, "win-bed1").offset, 1.6, 1e-9, "typed 0.4 goes that way: 2 - 0.4");
  assert.equal(T().applyTyped(), true);
  assert.equal(S().past.length, 1, "a Move is one undo step");
  assert.equal(useSelectionStore.getState().openingId, "win-bed1", "the moved window becomes the selection");
  S().undo();
  assert.deepEqual(S().plan, base);
  assert.equal(T().begin(moveFace, { mode: "click", radius: 0.1 }), true);
  T().setTyped("0.4");
  close(op(S().plan, "win-bed1").offset, 2.4, 1e-9, "before any movement, + is towards the wall's end");
  T().cancel();
  // typed equals dragged for a Move
  assert.equal(T().begin(moveFace, { mode: "drag", radius: 0.1 }), true);
  T().move(0.55);
  const moved = structuredClone(S().plan);
  T().cancel();
  assert.equal(T().begin(moveFace, { mode: "click", radius: 0.1 }), true);
  T().setTyped("0.55");
  T().applyTyped();
  assert.deepEqual(S().plan, moved, "typing 0.55 moves it where dragging 0.55 m does");
  S().undo();
  // Move refuses a wall top (4.7c moves wall sides: scripts/test-pushpull-walls.ts)
  const wallFace: Face = { wallId: "w-HA", role: "top", openingId: null };
  const beforeWall = S().plan;
  T().setHover(wallFace);
  assert.equal(T().message, "Pull the top with Push/Pull");
  assert.equal(T().begin(wallFace, { mode: "drag" }), false);
  assert.equal(S().plan, beforeWall, "nothing changed");
  T().setHover(null);
  T().setKind("pull");

  // openings stay inside their wall after the wall is edited: widen win-bed1 to the corner, then shorten w-HA
  assert.equal(T().begin({ wallId: "w-HA", role: "jambB", openingId: "win-bed1" }, { mode: "click" }), true);
  T().setTyped("5");
  T().applyTyped();
  const wide = op(S().plan, "win-bed1");
  close(edgeB(wide), 3.9, 1e-9, "widened to the corner's clearance");
  S().moveWallEndpoint("w-HA", "b", { x: 0, y: 1.5 }); // A(0,0) moves south: w-HA is now 2.5 m long
  for (const o of S().plan.openings) {
    const w = S().plan.walls.find((x) => x.id === o.wallId)!;
    assert.ok(edgeA(o) >= -1e-9 && edgeB(o) <= wallLength(w) + 1e-9, `${o.id} still inside its ${wallLength(w).toFixed(2)} m wall after the wall edit (${edgeA(o).toFixed(2)}–${edgeB(o).toFixed(2)})`);
  }
}

// ================================================================= 4. picking

{
  // hand-made screen edges of one opening: sides at x 100 and 200, top at y 50, sill at y 150
  const E = (role: ScreenEdge["role"], a: [number, number], b: [number, number], openingId = "o"): ScreenEdge => ({ role, openingId, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] } });
  const edges = [E("head", [100, 50], [200, 50]), E("sill", [100, 150], [200, 150]), E("jambA", [100, 50], [100, 150]), E("jambB", [200, 50], [200, 150])];
  const at = (x: number, y: number, tol = EDGE_TOL_MOUSE_PX, list = edges) => resolveOpeningEdge({ x, y }, list, tol)?.role ?? null;
  assert.equal(EDGE_TOL_MOUSE_PX, 14);
  assert.equal(EDGE_TOL_TOUCH_PX, 44);
  assert.equal(at(105, 100), "jambA", "nearest wins: 5 px from side A");
  assert.equal(at(193, 100), "jambB");
  assert.equal(at(150, 58), "head");
  assert.equal(at(150, 141), "sill");
  assert.equal(at(130, 100), null, "30 px from the nearest edge: no hit with a mouse…");
  assert.equal(at(130, 100, EDGE_TOL_TOUCH_PX), "jambA", "…but a finger's 44 px reaches it");
  assert.equal(at(114, 100), "jambA", "exactly the tolerance is in");
  assert.equal(at(114.5, 100), null, "and past it is out");
  assert.equal(at(400, 400, EDGE_TOL_TOUCH_PX), null, "nothing near: null");
  assert.equal(at(95, 45), "jambA", "a tie at a corner (both 7.07 px) goes to the jamb, not the head");
  assert.equal(at(95, 155), "jambA", "…and to the jamb, not the sill");
  const thin = [E("sill", [0, 20], [100, 20]), E("head", [0, 0], [100, 0])];
  assert.equal(at(50, 10, 14, thin), "head", "a tie between top and sill (10 px each) goes to the top, whatever the order");
  assert.equal(resolveOpeningEdge({ x: 105, y: 100 }, edges, 14)!.distancePx, 5);
  close(resolveOpeningEdge({ x: 105, y: 75 }, edges, 14)!.t, 0.25, 1e-12, "t: where along the edge the pointer is nearest");

  // the edge lines: on the face looking at the camera; a door has no sill edge
  const plan = fresh();
  const wall = plan.walls.find((w) => w.id === "w-BC")!;
  const win = op(plan, "win-living-n");
  const door = op(plan, "d-front");
  const south = { x: 9, y: 5, z: 12 };
  assert.deepEqual(openingEdgeLines(wall, door, south).map((l) => l.role), ["jambA", "jambB", "head"], "a door: both sides and the top, no sill edge");
  const lines = openingEdgeLines(wall, win, south);
  assert.deepEqual(lines.map((l) => l.role), ["jambA", "jambB", "head", "sill"], "a window has its sill edge");
  const jambA = lines[0];
  assert.deepEqual(jambA, { role: "jambA", a: { x: 4 + 4.4, y: 0.9, z: 0.1 }, b: { x: 4 + 4.4, y: 2.1, z: 0.1 } }, "side A at 4.4 m along w-BC, sill to top, on the south face (+0.1)");
  assert.equal(openingEdgeLines(wall, win, { x: 9, y: 5, z: -12 })[0].a.z, -0.1, "seen from the north: the north face");
  const head = lines[2];
  assert.deepEqual([head.a.x, head.b.x, head.a.y], [8.4, 9.6, 2.1], "the top runs side to side at sill + height");
  // the highlight's reveal: side A of the window, through the whole wall, from the sill to the top, and nothing else
  const quad = openingFaceQuad(wall, win, "jambA");
  for (const c of quad) assert.equal(c.x, 8.4, "every corner of side A is at 4.4 m along w-BC");
  assert.deepEqual([...new Set(quad.map((c) => c.z))].sort(), [-0.1, 0.1], "it spans the wall's thickness, face to face");
  assert.deepEqual([...new Set(quad.map((c) => c.y))].sort(), [0.9, 2.1], "and only the opening's height, sill to top");
  assert.deepEqual([...new Set(openingFaceQuad(wall, win, "sill").map((c) => c.y))], [0.9], "the sill's reveal is level at the sill");

  // pickAlongRay: an opening beats the wall in front of it, within one wall thickness
  const thick = () => 0.2;
  const hit = (kind: "wall" | "opening" | "other", id: string, distance: number) => ({ kind, id, distance });
  assert.deepEqual(pickAlongRay([hit("wall", "w", 5), hit("opening", "o", 5.15)], thick), { kind: "opening", id: "o" }, "an opening 0.15 m behind a 0.2 m wall wins");
  assert.deepEqual(pickAlongRay([hit("wall", "w", 5), hit("opening", "o", 5.2)], thick), { kind: "opening", id: "o" }, "exactly one thickness behind still wins");
  assert.deepEqual(pickAlongRay([hit("wall", "w", 5), hit("opening", "o", 5.3)], thick), { kind: "wall", id: "w" }, "further behind: the wall");
  assert.deepEqual(pickAlongRay([hit("opening", "o", 4.9), hit("wall", "w", 5)], thick), { kind: "opening", id: "o" }, "an opening in front wins");
  assert.deepEqual(pickAlongRay([hit("opening", "o", 5.15), hit("wall", "w", 5)], thick), { kind: "opening", id: "o" }, "the order the hits come in does not matter");
  assert.equal(pickAlongRay([hit("other", "", 3), hit("wall", "w", 5)], thick), null, "a floor in front picks nothing");
  assert.equal(pickAlongRay([], thick), null, "no hits: nothing");
  assert.deepEqual(pickAlongRay([hit("wall", "w", 5), hit("wall", "v", 9)], thick), { kind: "wall", id: "w" }, "two walls: the nearer");
}

// ================================================================= 5. tool shortcuts

{
  const keys = Object.values(TOOL_SHORTCUTS);
  assert.ok(keys.length >= 2, "Push/Pull and Move have keys");
  assert.equal(new Set(keys).size, keys.length, `no two tools share a shortcut: ${JSON.stringify(TOOL_SHORTCUTS)}`);
  assert.equal(TOOL_SHORTCUTS.pushpull, "p");
  assert.equal(TOOL_SHORTCUTS.move, "v", "Move is V: M is free as a tool key, but it is a unit letter");
  for (const k of keys) {
    assert.ok(!/^[0-9.,'"+\-cmftin ]$/i.test(k!), `${k} is not a key a typed distance uses (digits, signs, units)`);
    assert.ok(!"wasd".includes(k!), `${k} is not a walking key`);
  }
}

console.log("OK");
