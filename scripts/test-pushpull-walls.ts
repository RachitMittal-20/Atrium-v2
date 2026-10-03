/**
 * test-pushpull-walls.ts — asserts for step 4.7c, no browser: the wall side and end
 * faces for the 3D Push/Pull tool, wall moves and corner drags for the Move tool.
 *   0. failing first: planStore.updateWall with only a new thickness moves BOTH faces
 *      by d/2, so the face opposite the pulled one is not fixed; pullWallSide keeps it.
 *   1. side faces through the store (the tool's path): the bedroom partition pulled
 *      +0.10 m changes only the pulled side's room, by exactly -0.10 × its length;
 *      Shift moves it instead and both rooms change by ± d × length; an exterior run
 *      thickened +0.10 grows every piece and keeps the outer face fixed; the 0.05 m and
 *      0.6 m limits (also when another piece of the run sets them) and the 0.2 m length
 *      limit, each with its reason; openings re-clamped; room names kept; the labels.
 *   2. one transaction is one undo step, Escape (cancel) leaves history unchanged,
 *      a typed distance equals the dragged one (thickness, Shift move, Move tool, free end).
 *   3. a free wall end: longer and shorter with the other end fixed, the 0.2 m stop,
 *      openings kept in place when the a end moves, a hidden end refused.
 *   4. corners (Move): the drag equals edit.dragEndpoint to the same snapped point, Alt
 *      turns snapping off, one undo; resolveCorner and rayPlanePoint; shortcuts unique.
 * Run: npx tsx scripts/test-pushpull-walls.ts (throws on the first failure).
 */
import assert from "node:assert/strict";
import { samplePlan } from "../src/data/samplePlan";
import { resolveCorner, type ScreenCorner } from "../src/lib/handles3d/edges";
import { rayPlanePoint } from "../src/lib/handles3d/math";
import { dragEndpoint, snapDrag } from "../src/lib/plan/edit";
import { wallLength, wallNormal } from "../src/lib/plan/geometry";
import { dragCorner, HIDDEN_END, planCorners, pullWallEnd, pullWallSide } from "../src/lib/plan/pushpull";
import { deriveRooms } from "../src/lib/plan/rooms";
import { usePlanStore } from "../src/store/planStore";
import { usePushPullStore, type Face } from "../src/store/pushPullStore";
import { TOOL_SHORTCUTS } from "../src/store/toolStore";
import type { Plan, Wall } from "../src/types/plan";

const close = (a: number, b: number, eps: number, msg: string) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const dist2 = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);
const S = () => usePlanStore.getState();
const fresh = (): Plan => {
  S().loadPlan(structuredClone(samplePlan));
  return S().plan;
};
const wallIn = (plan: Pick<Plan, "walls">, id: string) => plan.walls.find((w) => w.id === id)!;
/** Where a wall's left and right faces are, as signed distances along the unit normal `n` (fixed, so before and after compare). */
const faces = (w: Wall, n: { x: number; y: number }) => {
  const c = w.a.x * n.x + w.a.y * n.y; // the centre line's distance along n
  const s = Math.sign(wallNormal(w).x * n.x + wallNormal(w).y * n.y); // +1 when n is this wall's left
  return { left: c + (s * w.thickness) / 2, right: c - (s * w.thickness) / 2 };
};

// ================================================================= 0. failing first
// w-HI is the partition between the bedrooms: H(0,4) → I(4,4), 0.10 m thick. Its left normal (-dy, dx) = (0, 1)
// points south, into Bedroom 2: sideLeft faces Bedroom 2 (y = 4.05), sideRight faces Bedroom 1 (y = 3.95).
{
  const plan = fresh();
  const n = wallNormal(wallIn(plan, "w-HI"));
  const before = faces(wallIn(plan, "w-HI"), n);
  close(before.left, 4.05, 1e-12, "sideLeft starts at y = 4 + 0.05");
  close(before.right, 3.95, 1e-12, "sideRight starts at y = 4 - 0.05");

  // the naive version: pull sideLeft by d = 0.10 by just making the wall 0.10 thicker
  S().updateWall("w-HI", { thickness: 0.2 });
  const naive = faces(wallIn(S().plan, "w-HI"), n);
  close(naive.left, 4.1, 1e-12, "naive: the pulled face moves only d/2 = 0.05 (4.05 → 4.10)");
  close(naive.right, 3.9, 1e-12, "naive: and the OPPOSITE face moves d/2 = 0.05 the other way (3.95 → 3.90)");
  assert.ok(Math.abs(naive.right - before.right) > 0.04, "so updateWall alone does NOT keep the opposite face fixed");

  // the new rule: thickness + d AND the centre line d/2 towards the pulled side
  const pulled = pullWallSide(fresh(), "w-HI", "sideLeft", 0.1)!;
  const after = faces(wallIn(pulled, "w-HI"), n);
  close(after.right, before.right, 1e-9, "pullWallSide: the far face (sideRight) stays put within 1e-9 m");
  close(after.left, before.left + 0.1, 1e-9, "pullWallSide: the pulled face moves the full d = 0.10 (4.05 → 4.15)");
}

// ================================================================= 1. side faces, through the store

const T = () => usePushPullStore.getState();
const side = (wallId: string, role: "sideLeft" | "sideRight"): Face => ({ wallId, role, openingId: null });
const area = (plan: Plan, name: string) => deriveRooms(plan).find((r) => r.name === name)!.area;
/** Pull `face` by `d` with the store's own begin / move / commit, as the tool does. */
const pull = (face: Face, d: number, opts: { shift?: boolean } = {}) => {
  assert.equal(T().begin(face, { mode: "drag", shift: opts.shift ?? false }), true, `${face.wallId} ${face.role}: a pull starts`);
  T().move(d);
  const r = T().pull!.wall!;
  T().commit();
  return r;
};
T().setKind("pull");

{
  // The partition w-HI, H(0,4) → I(4,4), 0.10 thick. sideRight faces north into Bedroom 1.
  // Bedroom 1's net floor: x 0.10 → 3.95 (half of the 0.20 west wall, half of the 0.10 w-BI), y 0.10 → 3.95: 3.85 × 3.85 = 14.8225.
  // Bedroom 2's: x 0.10 → 3.95, y 4.05 → 7.90: 3.85 × 3.85 = 14.8225. The face inside Bedroom 1 is 3.85 m long.
  const base = fresh();
  close(area(base, "Bedroom 1"), 14.8225, 1e-9, "Bedroom 1 starts at 3.85²");
  close(area(base, "Bedroom 2"), 14.8225, 1e-9, "Bedroom 2 starts at 3.85²");
  const n = wallNormal(wallIn(base, "w-HI"));
  const f0 = faces(wallIn(base, "w-HI"), n);

  // +0.10 on sideRight: thickness 0.10 → 0.20, centre y 4 → 3.95, so the north face 3.95 → 3.85 and the south face stays at 4.05.
  // Bedroom 1: 3.85 × (3.85 - 0.10) = 14.4375 = 14.8225 - 0.10 × 3.85. Bedroom 2: unchanged.
  const r = pull(side("w-HI", "sideRight"), 0.1);
  const p1 = S().plan;
  assert.equal(r.mode, "thickness");
  assert.equal(r.value, "Thickness 0.20 m (opposite face fixed)");
  assert.equal(r.rooms, "Bedroom 1 shrinks to 14.4 m²", "the label names the room that changes");
  assert.equal(wallIn(p1, "w-HI").thickness, 0.2);
  close(area(p1, "Bedroom 1") - area(base, "Bedroom 1"), -0.1 * 3.85, 1e-6, "the pulled side's room loses exactly 0.10 × 3.85");
  close(area(p1, "Bedroom 2"), area(base, "Bedroom 2"), 1e-6, "the room on the opposite face is unchanged");
  const f1 = faces(wallIn(p1, "w-HI"), n);
  close(f1.left, f0.left, 1e-9, "the opposite (south) face is fixed");
  close(f1.right, f0.right - 0.1, 1e-9, "the pulled (north) face moved 0.10 outward");
  assert.deepEqual(p1.rooms.map((x) => x.name).sort(), base.rooms.map((x) => x.name).sort(), "room names are kept");
  assert.equal(S().past.length, 1, "one transaction: one undo step");
  S().undo();
  assert.deepEqual(S().plan, base, "one undo puts the plan back exactly");

  // Shift: the partition MOVES 0.10 north, thickness unchanged. Bedroom 1: 3.85 × 3.75 = 14.4375 (-0.385); Bedroom 2: 3.85 × 3.95 = 15.2075 (+0.385).
  const m = pull(side("w-HI", "sideRight"), 0.1, { shift: true });
  const p2 = S().plan;
  assert.equal(m.mode, "move");
  assert.equal(m.value, "Wall moves 0.10 m");
  assert.equal(wallIn(p2, "w-HI").thickness, 0.1, "Shift keeps the thickness");
  close(area(p2, "Bedroom 1") - area(base, "Bedroom 1"), -0.1 * 3.85, 1e-6, "Shift: Bedroom 1 loses 0.10 × 3.85");
  close(area(p2, "Bedroom 2") - area(base, "Bedroom 2"), +0.1 * 3.85, 1e-6, "Shift: Bedroom 2 gains the same");
  close(faces(wallIn(p2, "w-HI"), n).left, f0.left - 0.1, 1e-9, "both faces moved: the south one too");
  S().undo();

  // the Move tool on a side face does the same as Shift, and a typed distance goes along the side's outward normal
  T().setKind("move");
  const mv = pull(side("w-HI", "sideRight"), 0.1);
  assert.equal(mv.mode, "move");
  assert.deepEqual(S().plan.walls, p2.walls, "the Move tool on a side = Push/Pull with Shift");
  S().undo();
  assert.equal(T().begin(side("w-HI", "sideRight"), { mode: "click" }), true);
  T().setTyped("10 cm");
  assert.equal(T().applyTyped(), true);
  assert.deepEqual(S().plan.walls, p2.walls, "Move: typing 10 cm on the north face moves it 0.10 north, as dragging does");
  S().undo();
  T().setKind("pull");

  // Shift can be pressed and released mid-pull: the same distance, thickening again (still one history entry)
  assert.equal(T().begin(side("w-HI", "sideRight"), { mode: "drag" }), true);
  T().move(0.1);
  T().setShift(true);
  assert.equal(wallIn(S().plan, "w-HI").thickness, 0.1, "Shift mid-pull: now a move");
  T().setShift(false);
  assert.equal(wallIn(S().plan, "w-HI").thickness, 0.2, "release Shift: a thickness again");
  assert.equal(S().past.length, 1);
  T().cancel();
  assert.deepEqual(S().plan, base, "Escape: back to the start");
  assert.equal(S().past.length, 0, "and history as it was");
}

{
  // An exterior run: the north wall w-AB + w-BC, A(0,0)-B(4,0)-C(10,0), 0.20 thick. Its left normal (0, 1) points south,
  // into the house: sideLeft is the INNER face (y = 0.10), sideRight the OUTER face (y = -0.10).
  // +0.10 on the inner face: every piece 0.30 thick, centre y 0 → 0.05, so the outer face stays at 0.05 - 0.15 = -0.10.
  const base = fresh();
  const n = wallNormal(wallIn(base, "w-AB"));
  const r = pull(side("w-AB", "sideLeft"), 0.1);
  assert.deepEqual(r.pieceIds, ["w-AB", "w-BC"], "the whole straight run");
  for (const id of ["w-AB", "w-BC"]) {
    const w = wallIn(S().plan, id);
    close(w.thickness, 0.3, 1e-12, `${id}: every piece is 0.10 thicker`);
    close(faces(w, n).right, -0.1, 1e-9, `${id}: the outer face is fixed at y = -0.10`);
    close(faces(w, n).left, 0.2, 1e-9, `${id}: the inner face moved 0.10 in (0.10 → 0.20)`);
  }
  // Bedroom 1 loses 0.10 × 3.85 off its north side: 3.85 × 3.75; the living room 0.10 × its north face (x 4.05 → 9.90: 5.85 m)
  close(area(S().plan, "Bedroom 1"), 3.85 * 3.75, 1e-6, "Bedroom 1 = 3.85 × 3.75");
  close(area(S().plan, "Living room") - area(base, "Living room"), -0.1 * 5.85, 1e-6, "the living room loses 0.10 × 5.85");
  // the walls at its ends follow by the stretch rules: the corners A and C slide down the west and east walls by d/2
  assert.deepEqual(wallIn(S().plan, "w-HA").b, { x: 0, y: 0.05 }, "A slid 0.05 down the west wall");
  assert.deepEqual(wallIn(S().plan, "w-CM").a, { x: 10, y: 0.05 }, "C slid 0.05 down the east wall");
  S().undo();

  // pieces of different thickness keep their own plus d
  S().updateWall("w-BC", { thickness: 0.3 });
  const mixed = S().plan;
  const r2 = pull(side("w-AB", "sideLeft"), 0.1);
  assert.equal(wallIn(S().plan, "w-AB").thickness, 0.3);
  assert.equal(wallIn(S().plan, "w-BC").thickness, 0.4);
  close(faces(wallIn(S().plan, "w-BC"), n).right, faces(wallIn(mixed, "w-BC"), n).right, 1e-9, "the thicker piece's outer face is fixed too");
  assert.equal(r2.note, null);
  S().undo();
  // ...and the run's limit is the intersection of theirs: 0.30 + d <= 0.6 makes d at most 0.30 even when 0.20 + d could go on
  const r3 = pullWallSide(S().plan, "w-AB", "sideLeft", 0.5)!;
  close(r3.distance, 0.3, 1e-9, "held by the thicker piece: d = 0.6 - 0.3");
  assert.deepEqual(r3.thickness.map((t) => [t.id, t.thickness]), [["w-AB", 0.5], ["w-BC", 0.6]]);
  assert.equal(r3.note, "Another piece of the wall stopped it: thickness can't be over 0.6 m, so it's 0.6 m.");
}

{
  // the limits on one wall, with clampField's words
  const base = fresh();
  const thin = pullWallSide(base, "w-HI", "sideLeft", -0.2)!; // 0.10 - 0.20 < 0.05
  close(thin.distance, -0.05, 1e-9, "held at 0.05 m thick: d = 0.05 - 0.10");
  assert.equal(thin.thickness[0].thickness, 0.05);
  assert.equal(thin.note, "Thickness can't be under 0.05 m, so it's 0.05 m.");
  const thick = pullWallSide(base, "w-HI", "sideLeft", 1)!; // 0.10 + 1 > 0.6
  close(thick.distance, 0.5, 1e-9, "held at 0.6 m thick: d = 0.6 - 0.10");
  assert.equal(thick.thickness[0].thickness, 0.6);
  assert.equal(thick.note, "Thickness can't be over 0.6 m, so it's 0.6 m.");
  assert.equal(pullWallSide(base, "w-HI", "sideLeft", 0.5)!.note, null, "exactly 0.6 m is allowed");
  // a run whose pieces are all as thick names the picked piece, not "another piece" (found in the e2e screenshot)
  assert.equal(pullWallSide(base, "w-LF", "sideRight", 0.45)!.note, "Thickness can't be over 0.6 m, so it's 0.6 m.", "a tie: the picked piece's own reason");
  // more than two rooms change: two are named and the rest counted (moving the south wall 1 m out grows three rooms)
  assert.match(pullWallSide(base, "w-LF", "sideRight", 1, { move: true })!.rooms ?? "", /^[^;]+ grows to [\d.]+ m²; [^;]+ grows to [\d.]+ m²; 1 more room changes$/);
  assert.equal(pullWallSide(base, "w-HI", "sideLeft", -0.05)!.note, null, "exactly 0.05 m is allowed");
  assert.equal(pullWallSide(base, "w-nope", "sideLeft", 0.1), null, "an unknown wall");
  // regression (found by the e2e): a sum a hair under 0.05 that rounds to 0.05 is not a limit, and never crashes
  const hair = pullWallSide(base, "w-HI", "sideLeft", -0.05000000000000001)!;
  assert.equal(hair.note, null, "0.10 - 0.05000000000000001 rounds to 0.05: allowed, no reason");
  close(hair.thickness[0].thickness, 0.05, 1e-12, "and it is 0.05 m");

  // the 0.2 m minimum length of a wall that stretches: X (0,0)-(4,0) with a 0.30 m stub Y from (0,0) south.
  // Thickening X's south side by d slides X's centre d/2 south, along Y, so Y is 0.30 - d/2 long: d/2 <= 0.10, d <= 0.20.
  // At exactly 0.20 Y reads 0.19999999999999998 (floating point) and counts as too short, so d stops at 0.19.
  const X: Wall = { id: "X", a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, thickness: 0.1, height: 2.7 };
  const Y: Wall = { id: "Y", a: { x: 0, y: 0 }, b: { x: 0, y: 0.3 }, thickness: 0.1, height: 2.7 };
  const tiny: Plan = { ...base, walls: [X, Y], openings: [], rooms: [] };
  const short = pullWallSide(tiny, "X", "sideLeft", 0.5)!;
  close(short.distance, 0.19, 1e-9, "stopped on whole centimetres inside the 0.2 m limit");
  assert.ok(wallLength(short.walls.find((w) => w.id === "Y")!) >= 0.2, "Y is still at least 0.2 m");
  assert.equal(short.note, "Stopped here: going further would make a joining wall shorter than 0.20 m.");
  close(short.thickness[0].thickness, 0.29, 1e-9, "and the thickness grew by the same 0.19");
  const sh = pullWallSide(tiny, "X", "sideLeft", 0.5, { move: true })!;
  close(sh.distance, 0.09, 1e-9, "a move stops on whole centimetres too: 0.30 - 0.09 = 0.21 >= 0.2");
  assert.match(sh.note ?? "", /shorter than 0.20 m/);

  // openings are re-clamped: moving the partition 3 m north leaves w-HA (H → A) 1 m long, under its 1.2 m window
  fresh();
  pull(side("w-HI", "sideRight"), 3, { shift: true });
  const moved = S().plan;
  close(wallLength(wallIn(moved, "w-HA")), 1, 1e-9, "w-HA is now 1 m");
  for (const o of moved.openings) {
    const len = wallLength(wallIn(moved, o.wallId));
    assert.ok(o.offset - o.width / 2 >= -1e-9 && o.offset + o.width / 2 <= len + 1e-9, `${o.id} stays inside its wall`);
  }
  const win = moved.openings.find((o) => o.id === "win-bed1")!;
  assert.deepEqual([win.width, win.offset], [1, 0.5], "the window was clamped to the 1 m wall (clampOpening)");
  S().undo();
}

// ================================================================= 2. history, Escape, typed = dragged
{
  const base = fresh();
  S().renamePlan("history marker"); // one real step, so "unchanged" is not just "empty"
  const past = S().past.length;
  const before = structuredClone(S().plan);
  for (const [face, shift] of [[side("w-HI", "sideLeft"), false], [side("w-HI", "sideLeft"), true], [side("w-LF", "sideRight"), false]] as const) {
    assert.equal(T().begin(face, { mode: "drag", shift }), true);
    for (const d of [0.05, 0.1, 0.25, 0.15]) {
      T().move(d);
      assert.equal(S().past.length, past + 1, "many moves, one history entry");
    }
    T().cancel();
    assert.equal(S().past.length, past, "Escape leaves the history length as it was");
    assert.deepEqual(S().plan, before, "and the plan exactly as it was");

    // typed equals dragged, both ways, in other units
    for (const [typed, d] of [["0.15", 0.15], ["15 cm", 0.15], ["-50mm", -0.05]] as const) {
      assert.equal(T().begin(face, { mode: "drag", shift }), true);
      T().move(d);
      const dragged = structuredClone(S().plan);
      T().cancel();
      assert.equal(T().begin(face, { mode: "click", shift }), true);
      T().setTyped(typed);
      assert.equal(T().applyTyped(), true);
      assert.deepEqual(S().plan, dragged, `${face.wallId} ${face.role}${shift ? " + Shift" : ""}: typing "${typed}" lands where dragging ${d} m does`);
      assert.equal(S().past.length, past + 1, "one undo step");
      S().undo();
    }
  }
  // snapping: 5 cm steps, Alt 1 cm
  assert.equal(T().begin(side("w-HI", "sideLeft"), { mode: "drag" }), true);
  T().move(0.172);
  assert.equal(wallIn(S().plan, "w-HI").thickness, 0.25, "0.172 snaps to 0.15: 0.10 + 0.15");
  T().setAlt(true);
  T().move(0.172); // as for a wall top (4.7a): Alt re-applies the distance it had, the next pointer move is unsnapped
  assert.equal(wallIn(S().plan, "w-HI").thickness, 0.27, "Alt: 1 cm, 0.10 + 0.17");
  T().setAlt(false);
  T().cancel();
  assert.deepEqual(S().plan, before);
  S().undo();
  assert.deepEqual(S().plan, base);
}

// ================================================================= 3. a free wall end
{
  // a stub from the joint K(7,5) north into the living room: a at K (hidden: a joint), b at (7,3) free. Length 2.
  const base = fresh();
  S().addWall({ a: { x: 7, y: 5 }, b: { x: 7, y: 3 }, thickness: 0.1, height: 2.7 });
  const stubId = S().plan.walls[S().plan.walls.length - 1].id;
  const withStub = S().plan;
  const longer = pullWallEnd(withStub, stubId, "endB", 0.5)!;
  assert.deepEqual(wallIn(longer, stubId).b, { x: 7, y: 2.5 }, "+0.5: the free end moves 0.5 out along the wall");
  assert.deepEqual(wallIn(longer, stubId).a, { x: 7, y: 5 }, "the other end is fixed");
  assert.equal(longer.value, "Length 5.50 m (other end fixed)", "the stub carries on w-KL (K → L, 3 m) in a straight line: the run is 2.50 + 3.00");
  const shorter = pullWallEnd(withStub, stubId, "endB", -1.25)!;
  assert.deepEqual(wallIn(shorter, stubId).b, { x: 7, y: 4.25 }, "-1.25: 2 → 0.75 m");
  const stop = pullWallEnd(withStub, stubId, "endB", -5)!;
  close(wallLength(wallIn(stop, stubId)), 0.2, 1e-9, "never shorter than 0.2 m");
  assert.equal(stop.note, "Stopped here: walls can't be shorter than 0.20 m.");
  close(stop.distance, -1.8, 1e-9, "it went only 1.8 of the 5 m asked");
  const hidden = pullWallEnd(withStub, stubId, "endA", 0.5)!;
  assert.equal(hidden.refused, HIDDEN_END, "the end at the joint K is refused");

  // through the store: one undo step, Escape, typed = dragged
  const endFace: Face = { wallId: stubId, role: "endB", openingId: null };
  const past = S().past.length;
  assert.equal(T().begin(endFace, { mode: "drag" }), true);
  T().move(0.48);
  const dragged = structuredClone(S().plan);
  close(wallLength(wallIn(dragged, stubId)), 2.5, 1e-9, "snapped to 0.50");
  T().cancel();
  assert.equal(S().past.length, past);
  assert.equal(T().begin(endFace, { mode: "click" }), true);
  T().setTyped("0.5");
  T().applyTyped();
  assert.deepEqual(S().plan, dragged, "typed 0.5 = dragged 0.48 snapped to 0.50");
  assert.equal(S().past.length, past + 1);
  S().undo();
  assert.equal(T().begin({ wallId: stubId, role: "endA", openingId: null }, { mode: "drag" }), false, "the hidden end: no pull");
  assert.equal(T().message, HIDDEN_END);

  // the a end of a wall with a window: the window stays where it is (its offset is measured from a)
  // a free at (7,3), b at K; window centre 1 m from a, i.e. at (7,4). Pull a 0.5 out: a → (7,2.5), offset 1 → 1.5, still at (7,4).
  S().loadPlan(structuredClone(samplePlan));
  S().addWall({ a: { x: 7, y: 3 }, b: { x: 7, y: 5 }, thickness: 0.1, height: 2.7 });
  const rev = S().plan.walls[S().plan.walls.length - 1].id;
  S().addOpening({ wallId: rev, kind: "window", offset: 1, width: 0.6, height: 1.2, sillHeight: 0.9 });
  const r = pullWallEnd(S().plan, rev, "endA", 0.5)!;
  assert.deepEqual(r.openings.map((o) => o.changes), [{ offset: 1.5, width: 0.6 }], "the offset grows by what a moved");
  const pastBefore = S().past.length; // the addWall and addOpening above
  assert.equal(T().begin({ wallId: rev, role: "endA", openingId: null }, { mode: "drag" }), true);
  T().move(0.5);
  T().commit();
  const w = wallIn(S().plan, rev);
  const o = S().plan.openings.find((x) => x.wallId === rev)!;
  assert.deepEqual({ x: w.a.x, y: w.a.y + o.offset }, { x: 7, y: 4 }, "the window's centre is still at (7, 4)");
  assert.equal(S().past.length, pastBefore + 1, "wall and window: one undo step");
  void base;
}

// ================================================================= 4. corners
{
  const base = fresh();
  T().setKind("move");
  // the south-east corner E(10,8): w-ME (M → E) ends there, and w-EL (E → L) starts there
  const se = planCorners(base).find((c) => c.point.x === 10 && c.point.y === 8)!;
  assert.deepEqual(se.wallIds.sort(), ["w-EL", "w-ME"]);
  assert.equal(se.height, 2.7);
  assert.equal(planCorners(base).length, 11, "the sample has 11 distinct joints (A B C E F G H I K L M)");
  const corner = { wallId: se.wallId, end: se.end, point: se.point };
  assert.equal(T().beginCorner(corner, { radius: 0.1 }), true);
  T().moveCorner({ x: 10.52, y: 8.33 });
  const snapped = snapDrag({ x: 10.52, y: 8.33 }, base.walls, { from: wallIn(base, se.wallId)[se.end === "a" ? "b" : "a"], radius: 0.1, exclude: se.point });
  assert.equal(snapped.kind, "grid");
  const expected = dragEndpoint(base.walls, se.wallId, se.end, snapped.point).walls;
  assert.deepEqual(S().plan.walls, expected, "the corner drag = edit.dragEndpoint to the same snapped point");
  assert.deepEqual(wallIn(S().plan, "w-ME").b, { x: 10.5, y: 8.35 });
  assert.deepEqual(wallIn(S().plan, "w-EL").a, { x: 10.5, y: 8.35 }, "both walls joined there follow");
  const res = T().pull!.cornerResult!;
  assert.equal(res.snap, "grid");
  assert.deepEqual(res.lengths.map((l) => l.id).sort(), ["w-EL", "w-ME"], "the label gets both walls' lengths");
  T().setAlt(true);
  assert.deepEqual(wallIn(S().plan, "w-ME").b, { x: 10.52, y: 8.33 }, "Alt: no snapping, 1 cm");
  assert.equal(T().pull!.cornerResult!.snap, null);
  T().setAlt(false);
  T().setTyped("0.3");
  assert.equal(T().typed, "", "a corner takes no typed distance");
  assert.equal(T().message, "Type exact lengths in the wall panel");
  assert.equal(S().past.length, 1, "still one history entry");
  T().commit();
  assert.equal(S().past.length, 1, "a corner drag is one undo step");
  S().undo();
  assert.deepEqual(S().plan, base, "one undo restores it");
  // Escape mid-drag
  assert.equal(T().beginCorner(corner, { radius: 0.1 }), true);
  T().moveCorner({ x: 11, y: 9 });
  T().cancel();
  assert.deepEqual(S().plan, base);
  assert.equal(S().past.length, 0, "Escape: history as it was");
  // the pure rule: an endpoint snap, and the 0.2 m stop
  // (10.01, 5.10): the 90° ray from M snaps it to (10, 5.10), which would leave w-ME 0.10 m long, so dragEndpoint pushes it back to 0.2 m
  const toM = dragCorner(base, se.wallId, se.end, { x: 10.01, y: 5.1 }, { radius: 0.1 })!;
  assert.equal(toM.snap, "angle");
  assert.equal(toM.note, "Stopped here: walls can't be shorter than 0.20 m.", "dragging E onto M stops 0.2 m short");
  close(dist2(toM.point, { x: 10, y: 5 }), 0.2, 1e-9, "0.2 m from M");
  const toK = dragCorner(base, se.wallId, se.end, { x: 7.03, y: 5.02 }, { radius: 0.1 })!;
  assert.equal(toK.snap, "endpoint", "within reach of the joint K: an endpoint snap (the walls at E itself are excluded)");
  assert.deepEqual(toK.point, { x: 7, y: 5 });
  T().setKind("pull");
}

// ---- resolveCorner: the nearest projected corner line within the tolerance
{
  const c = (id: string, x: number): ScreenCorner => ({ id, a: { x, y: 400 }, b: { x, y: 200 } });
  const list = [c("p", 100), c("q", 130)];
  assert.equal(resolveCorner({ x: 110, y: 300 }, list, 14)!.id, "p", "10 px from p, 20 from q");
  assert.equal(resolveCorner({ x: 124, y: 300 }, list, 14)!.id, "q");
  assert.equal(resolveCorner({ x: 160, y: 300 }, list, 14), null, "30 px from the nearest: none");
  assert.equal(resolveCorner({ x: 160, y: 300 }, list, 44)!.id, "q", "a finger's 44 px reaches it");
  const r = resolveCorner({ x: 100, y: 250 }, list, 14)!;
  close(r.t, 0.75, 1e-12, "t: 0 at the floor, 1 at the top");
  close(r.distancePx, 0, 1e-12, "on the line: 0 px");
  assert.equal(resolveCorner({ x: 100, y: 420 }, list, 14), null, "20 px below the foot: measured to the foot, out of reach");
  assert.equal(resolveCorner({ x: 100, y: 410 }, list, 14)!.distancePx, 10, "10 px below the foot: in reach");
}

// ---- rayPlanePoint
{
  const ground = { x: 0, y: 0, z: 0 };
  const up = { x: 0, y: 1, z: 0 };
  assert.deepEqual(rayPlanePoint({ origin: { x: 1, y: 5, z: 2 }, direction: { x: 0, y: -1, z: 0 } }, ground, up), { x: 1, y: 0, z: 2 }, "straight down onto the floor");
  const slant = rayPlanePoint({ origin: { x: 0, y: 4, z: 0 }, direction: { x: 3, y: -2, z: 1 } }, { x: 0, y: 1, z: 0 }, up)!;
  assert.deepEqual(slant, { x: 4.5, y: 1, z: 1.5 }, "a slanted ray meets the plane y = 1 at t = 1.5");
  assert.equal(rayPlanePoint({ origin: { x: 0, y: 4, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, ground, up), null, "parallel: null");
  assert.equal(rayPlanePoint({ origin: { x: 0, y: 4, z: 0 }, direction: { x: 0, y: 1, z: 0 } }, ground, up), null, "the plane behind the ray: null");
  assert.deepEqual(rayPlanePoint({ origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: -1, z: 0 } }, ground, up), { x: 0, y: 0, z: 0 }, "starting on the plane: the origin");
}

// ---- the tool shortcuts are still unique
{
  const keys = Object.values(TOOL_SHORTCUTS);
  assert.equal(new Set(keys).size, keys.length, `no two tools share a shortcut: ${JSON.stringify(TOOL_SHORTCUTS)}`);
}

console.log("OK");
