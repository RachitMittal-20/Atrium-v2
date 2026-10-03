/**
 * test-pushpull.ts — asserts for the 3D Push/Pull tool (step 4.7a), no browser:
 *   1. face roles: every triangle of every wall mesh has exactly one role, the
 *      roles sit on the geometry (so they survive PlanModel's per-wall cache),
 *      and each role's outward normal is the right one;
 *   2. the pull itself (src/lib/plan/pushpull.ts): heights inside and outside the
 *      limits with reasons, a whole straight wall versus one piece, openings
 *      kept inside a lowered wall, typed distances, negative distances;
 *   3. the tool's store (src/store/pushPullStore.ts): one pull is one undo step,
 *      Escape leaves history as it was, a typed distance equals a dragged one,
 *      and a hidden wall end (one at a joint) changes nothing and says why.
 *   4. exposed faces (step 4.7c): the north wall's split and corner ends expose no end
 *      faces, a T stem's end is not exposed, a free end is, and every opening's jamb,
 *      head and sill faces are exposed over exactly the visible reveal, no more.
 * Run: npx tsx scripts/test-pushpull.ts (throws on the first failure).
 */
import assert from "node:assert/strict";
import { samplePlan } from "../src/data/samplePlan";
import { wallDirection } from "../src/lib/plan/geometry";
import { buildWallGeometry, buildWallMeshData, faceRoleAt, pickableFaceAt, type FaceRole, type WallFaceData } from "../src/lib/plan/meshBuilders";
import { HIDDEN_END, parseSignedDistance, pullWallTop, scopeLabel } from "../src/lib/plan/pushpull";
import { validatePlan } from "../src/lib/plan/validate";
import { startPull, pullDistance } from "../src/lib/handles3d/math";
import { usePlanStore } from "../src/store/planStore";
import { usePushPullStore, type Face } from "../src/store/pushPullStore";
import { useSelectionStore } from "../src/store/selectionStore";
import type { Opening, Plan, Wall } from "../src/types/plan";

const close = (a: number, b: number, eps: number, msg: string) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const COS_1_DEG = Math.cos((1 * Math.PI) / 180);

// ================================================================= 1. face roles

/** The unit normal of triangle i, read from the geometry's own normal attribute. */
function triNormal(geo: { getAttribute(n: string): { getX(i: number): number; getY(i: number): number; getZ(i: number): number } }, tri: number) {
  const n = geo.getAttribute("normal");
  return { x: n.getX(tri * 3), y: n.getY(tri * 3), z: n.getZ(tri * 3) };
}

/** Check every triangle of one wall: a role, the right opening id, the right outward normal. Returns the roles seen. */
function checkWall(wall: Wall, walls: Wall[], openings: Opening[], tag: string): Set<FaceRole> {
  const { geometry, faces } = buildWallMeshData(wall, walls, openings);
  const triangles = geometry.getAttribute("position").count / 3;
  assert.equal(faces.roles.length, triangles, `${tag}: one role per triangle`);
  assert.equal(faces.openingIds.length, triangles, `${tag}: and one opening id (or null) per triangle`);
  assert.equal(faces.wallId, wall.id);
  assert.equal(geometry.userData.faces, faces, `${tag}: the roles sit on the geometry itself, so the geometry cache keeps them`);
  assert.deepEqual(buildWallGeometry(wall, walls, openings).userData.faces, faces, `${tag}: buildWallGeometry carries the same roles`);

  const d = wallDirection(wall);
  const along = { x: d.x, y: 0, z: d.y }; // a → b in world space
  const left = { x: -d.y, y: 0, z: d.x }; // the left normal (-dy, dx), in world space
  const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => a.x * b.x + a.y * b.y + a.z * b.z;
  const seen = new Set<FaceRole>();
  const ids = new Set(openings.filter((o) => o.wallId === wall.id).map((o) => o.id));

  for (let i = 0; i < triangles; i++) {
    const hit = faceRoleAt(faces, i);
    assert.ok(hit, `${tag}: triangle ${i} has a role`);
    const { role, openingId } = hit;
    const n = triNormal(geometry, i);
    seen.add(role);
    const where = `${tag} triangle ${i} (${role})`;
    // an opening id on exactly the faces that belong to an opening
    if (role === "head" || role === "sill") assert.ok(openingId && ids.has(openingId), `${where}: names its opening`);
    else if (role === "jambA" || role === "jambB") assert.ok(openingId === null || ids.has(openingId), `${where}: names its opening or is a wall end`);
    else assert.equal(openingId, null, `${where}: belongs to no opening`);

    switch (role) {
      case "top":
        assert.ok(n.y >= COS_1_DEG, `${where}: faces +Y within 1° (${n.y})`);
        break;
      case "sill":
        assert.ok(n.y >= COS_1_DEG, `${where}: a sill is the top of the low slice, so it faces up`);
        break;
      case "head":
        assert.ok(n.y <= -COS_1_DEG, `${where}: a head is the underside of the lintel, so it faces down`);
        break;
      case "sideLeft":
        assert.ok(dot(n, left) >= COS_1_DEG, `${where}: faces the left normal of a → b`);
        break;
      case "sideRight":
        assert.ok(dot(n, left) <= -COS_1_DEG, `${where}: faces the right normal of a → b`);
        break;
      case "jambA":
        assert.ok(dot(n, along) >= COS_1_DEG, `${where}: runs along the wall direction, facing a → b`);
        break;
      case "jambB":
        assert.ok(dot(n, along) <= -COS_1_DEG, `${where}: runs along the wall direction, facing b → a`);
        break;
      case "endA":
        assert.ok(dot(n, along) < -0.1 && Math.abs(n.y) < 1e-6, `${where}: a vertical face looking out of the a end`);
        break;
      case "endB":
        assert.ok(dot(n, along) > 0.1 && Math.abs(n.y) < 1e-6, `${where}: a vertical face looking out of the b end`);
        break;
    }
  }
  return seen;
}

// every wall of the sample plan, with its openings
{
  const all = new Set<FaceRole>();
  let triangles = 0;
  for (const wall of samplePlan.walls) {
    for (const r of checkWall(wall, samplePlan.walls, samplePlan.openings, `sample ${wall.id}`)) all.add(r);
    triangles += buildWallMeshData(wall, samplePlan.walls, samplePlan.openings).faces.roles.length;
  }
  for (const role of ["top", "endA", "endB", "sideLeft", "sideRight", "jambA", "jambB", "head", "sill"] as FaceRole[]) {
    assert.ok(all.has(role), `the sample plan exercises the ${role} role`);
  }
  assert.ok(triangles > 100, `checked ${triangles} triangles`);
}

// each opening of the sample owns jambs and a head (and a sill, for a window with one)
for (const o of samplePlan.openings) {
  const wall = samplePlan.walls.find((w) => w.id === o.wallId)!;
  const { faces } = buildWallMeshData(wall, samplePlan.walls, samplePlan.openings);
  const mine = (role: FaceRole) => faces.roles.filter((r, i) => r === role && faces.openingIds[i] === o.id).length;
  assert.ok(mine("jambA") > 0 && mine("jambB") > 0, `${o.id}: has both jambs`);
  assert.ok(mine("head") > 0, `${o.id}: has a head (every sample opening stops below the wall top)`);
  assert.equal(mine("sill") > 0, o.sillHeight > 0, `${o.id}: has a sill exactly when it sits above the floor`);
}

// edge cases the sample does not have: an opening against each end, two openings side by side, a wall with none
{
  const wall: Wall = { id: "w", a: { x: 0, y: 0 }, b: { x: 6, y: 0 }, thickness: 0.2, height: 2.7 };
  const op = (id: string, offset: number, width: number, sill: number, height: number): Opening => ({ id, wallId: "w", kind: sill > 0 ? "window" : "door", offset, width, height, sillHeight: sill });
  const cases: [string, Opening[]][] = [
    ["no openings", []],
    ["a door against the a end", [op("d", 0.45, 0.9, 0, 2.1)]],
    ["a door against the b end", [op("d", 5.55, 0.9, 0, 2.1)]],
    ["two openings touching", [op("p", 2, 1, 0, 2.1), op("q", 3, 1, 0.9, 1.2)]],
    ["two openings apart", [op("p", 1.5, 1, 0, 2.1), op("q", 4.5, 1.2, 0.9, 1.2)]],
    ["a window as tall as the wall", [op("t", 3, 1, 0.5, 2.2)]],
  ];
  for (const [name, openings] of cases) {
    const seen = checkWall(wall, [wall], openings, name);
    assert.ok(seen.has("top") && seen.has("sideLeft") && seen.has("sideRight"), `${name}: top and both sides`);
  }
  // a wall with no openings is one box: its ends are the wall's ends
  const plain = buildWallMeshData(wall, [wall], []).faces;
  assert.ok(plain.roles.includes("endA") && plain.roles.includes("endB") && !plain.roles.includes("jambA"), "no openings: ends, no jambs");
  // a door against the a end has no jamb A... its a-side cap is the wall's own end
  const atA = buildWallMeshData(wall, [wall], [op("d", 0.45, 0.9, 0, 2.1)]).faces;
  assert.ok(atA.roles.includes("endA"), "a door against the a end leaves the wall end as an end");
  // a zero-length wall has no triangles and no roles
  const none = buildWallMeshData({ ...wall, b: wall.a }, [wall], []).faces;
  assert.equal(none.roles.length, 0);
}

// faceRoleAt on a triangle that does not exist
{
  const faces: WallFaceData = { wallId: "w", roles: ["top"], openingIds: [null], exposed: [true] };
  assert.deepEqual(faceRoleAt(faces, 0), { role: "top", openingId: null });
  assert.equal(faceRoleAt(faces, 1), null, "past the end: null");
  assert.equal(faceRoleAt(faces, -1), null, "before the start: null");
}

// ================================================================= 2. the pull rules (pure)

const fresh = (): Plan => {
  usePlanStore.getState().loadPlan(structuredClone(samplePlan));
  return usePlanStore.getState().plan;
};
const heightOf = (plan: Plan, id: string) => plan.walls.find((w) => w.id === id)!.height;

{
  const plan = fresh();
  // w-AB and w-BC are the two pieces of the north wall (split at the T-junction where w-BI meets it)
  const run = pullWallTop(plan, "w-AB", 0.35)!;
  assert.deepEqual(run.pieceIds, ["w-AB", "w-BC"], "the whole straight wall is pulled");
  close(run.height, 3.05, 1e-9, "2.7 + 0.35");
  close(run.distance, 0.35, 1e-9, "the distance is what was asked");
  assert.equal(run.note, null, "inside the limits: no reason");
  assert.deepEqual(run.heights.map((h) => [h.id, h.height]), [["w-AB", 3.05], ["w-BC", 3.05]], "every piece gets the new height");
  assert.equal(scopeLabel(run), "Wall of 2 pieces");

  const one = pullWallTop(plan, "w-AB", 0.35, { onlyPiece: true })!;
  assert.deepEqual(one.pieceIds, ["w-AB"], "Alt: only the picked piece");
  assert.deepEqual(one.heights.map((h) => h.id), ["w-AB"]);
  assert.equal(scopeLabel(one), "This piece only");
  assert.equal(scopeLabel(pullWallTop(plan, "w-HI", 0.1)!), "This wall", "a wall that is one piece");

  // the limits, with the reason in plain words (clampField's words)
  const high = pullWallTop(plan, "w-AB", 10)!;
  assert.equal(high.height, 6, "held to 6 m");
  close(high.distance, 3.3, 1e-9, "the distance the top really moved");
  assert.equal(high.requested, 10);
  assert.equal(high.note, "Height can't be over 6 m, so it's 6 m.");
  const low = pullWallTop(plan, "w-HI", -5)!; // an interior wall without openings
  assert.equal(low.height, 1, "held to 1 m");
  assert.equal(low.note, "Height can't be under 1 m, so it's 1 m.");
  assert.equal(pullWallTop(plan, "w-HI", 0)!.heights.length, 0, "no distance, no change");
  assert.equal(pullWallTop(plan, "w-nope", 1), null, "an unknown wall");
  // exactly at the limits is not clamped
  assert.equal(pullWallTop(plan, "w-HI", 3.3)!.note, null, "exactly 6 m is allowed");
  assert.equal(pullWallTop(plan, "w-HI", -1.7)!.note, null, "exactly 1 m is allowed");
  // rounded to 1 cm, whatever is asked
  close(pullWallTop(plan, "w-HI", 0.3456)!.height, 3.05, 1e-9, "heights are rounded to 1 cm");
  // negative distances
  close(pullWallTop(plan, "w-HI", -0.3)!.height, 2.4, 1e-9, "negative pushes down");

  // a door floors the wall at its minimum height; the wall without one goes lower
  const door = pullWallTop(plan, "w-BC", -2)!; // w-BC holds the front door d-front
  assert.equal(door.pieceIds.length, 2);
  const bc = door.heights.find((h) => h.id === "w-BC")!;
  assert.equal(bc.height, 1.8, "a door needs 1.8 m");
  assert.equal(door.note, "A door in this wall needs it at least 1.8 m tall, so it's 1.8 m.", "the picked piece reports its own limit: the door's floor");
  assert.equal(door.heights.find((h) => h.id === "w-AB")!.height, 1, "the other piece, with no door, goes down to the 1 m limit");
  const pickedDoor = pullWallTop(plan, "w-BC", -2, { onlyPiece: true })!;
  assert.equal(pickedDoor.note, "A door in this wall needs it at least 1.8 m tall, so it's 1.8 m.", "the door's reason, in words");

  // openings stay inside a lowered wall: windows first shorten, then slide down; doors shorten to the wall
  const lowered = pullWallTop(plan, "w-BC", -0.8, { onlyPiece: true })!; // 2.7 → 1.9
  assert.equal(lowered.height, 1.9);
  const changes = new Map(lowered.openings.map((o) => [o.id, o.changes]));
  assert.deepEqual(changes.get("d-front"), { height: 1.9, sillHeight: 0 }, "the 2.1 m door shortens to the 1.9 m wall");
  assert.deepEqual(changes.get("win-living-n"), { height: 1, sillHeight: 0.9 }, "the window (sill 0.9, top 2.1) shortens to fit under 1.9");
  const windowOnly = pullWallTop(plan, "w-HA", -1.7, { onlyPiece: true })!; // 2.7 → 1.0, win-bed1 sits on it
  assert.deepEqual(windowOnly.openings.find((o) => o.id === "win-bed1")!.changes, { height: 0.3, sillHeight: 0.7 }, "too low to keep the sill: it slides down to stay inside");
  assert.equal(pullWallTop(plan, "w-BC", 0.5, { onlyPiece: true })!.openings.length, 0, "raising touches no opening");
  assert.equal(pullWallTop(plan, "w-BC", -0.5, { onlyPiece: true })!.openings.length, 0, "lowered to 2.2 m everything still fits");
}

// ---- the signed distance parser: the wall panel's units plus a sign
{
  const table: [string, number | null][] = [
    ["0.3", 0.3], ["+0.3", 0.3], ["-0.3", -0.3], ["\u22120.3", -0.3], [" 0.35 m ", 0.35], ["30 cm", 0.3], ["-30cm", -0.3], ["300 mm", 0.3], ["-250mm", -0.25],
    ["1 ft", 0.3048], ["1.5 ft", 0.4572], ["-2 ft", -0.6096], ["6 in", 0.1524], ["-6in", -0.1524], ["12'", 0.3048 * 12], ["1'6\"", 0.3048 * 1.5], ["2.5", 2.5], ["0", 0],
    ["", null], ["-", null], ["abc", null], ["--1", null], ["1 yard", null], ["1..2", null], ["0.3 0.4", null],
  ];
  for (const [raw, want] of table) {
    const got = parseSignedDistance(raw);
    if (want === null) assert.equal(got, null, `"${raw}" is not a distance`);
    else assert.ok(got !== null && Math.abs(got - want) < 1e-9, `"${raw}" → ${got}, wanted ${want}`);
  }
}

// ---- a pull measured from rays: the distance the pointer pulls is the distance the wall grows
{
  fresh();
  const cam = { position: { x: 5, y: 1.5, z: 20 }, forward: { x: 0, y: 0, z: -1 }, fovDeg: 45 };
  const anchor = { x: 5, y: 2.7, z: 0 }; // a point on the top of the north wall
  const through = (h: number) => ({ origin: cam.position, direction: { x: 0, y: (h - cam.position.y) / 20, z: -1 } }); // the ray crossing the axis at height h
  const grab = startPull(through(2.7), anchor, { x: 0, y: 1, z: 0 }, { x: 600, y: 300 });
  const d = pullDistance(grab, through(2.7 + 0.35), { x: 600, y: 280 }, cam, 900)!;
  close(d, 0.35, 1e-9, "a ray 0.35 m higher is a pull of 0.35");
  close(pullWallTop(usePlanStore.getState().plan, "w-AB", d)!.height, 3.05, 1e-9, "…which makes the wall 3.05 m");
}

// ================================================================= 3. the tool's store

const S = () => usePlanStore.getState();
const T = () => usePushPullStore.getState();
const top = (wallId: string): Face => ({ wallId, role: "top", openingId: null });
const sel0 = JSON.stringify([useSelectionStore.getState().selectedId, useSelectionStore.getState().openingId, useSelectionStore.getState().hoveredId]);

{
  const base = fresh();
  assert.equal(S().past.length, 0);

  // hover: highlights, never selects
  T().setHover(top("w-AB"));
  assert.deepEqual(T().hover, top("w-AB"));
  assert.equal(T().message, null, "the wall top is wired: no message");
  assert.equal(JSON.stringify([useSelectionStore.getState().selectedId, useSelectionStore.getState().openingId, useSelectionStore.getState().hoveredId]), sel0, "hovering a face leaves the selection store alone");

  // a drag: many moves, ONE history entry, the plan live in the store the whole time
  assert.equal(T().begin(top("w-AB"), { mode: "drag" }), true);
  assert.equal(T().pull!.baseline, base);
  for (const d of [0.05, 0.1, 0.2, 0.3, 0.35]) {
    T().move(d);
    assert.equal(S().past.length, 1, `after a move to ${d}: still exactly one history entry`);
    close(heightOf(S().plan, "w-AB"), 2.7 + d, 1e-9, `the plan follows the pointer (${d})`);
    close(heightOf(S().plan, "w-BC"), 2.7 + d, 1e-9, "the whole run follows");
  }
  assert.equal(T().pull!.result!.height, 3.05);
  const afterDrag = structuredClone(S().plan);
  T().commit();
  assert.equal(T().pull, null, "committed");
  assert.equal(S().past.length, 1, "a commit is one undo step");
  assert.deepEqual(S().plan, afterDrag, "and keeps the previewed plan");
  S().undo();
  assert.deepEqual(S().plan, base, "one undo puts everything back (every piece, every height)");
  assert.equal(S().past.length, 0);
  S().redo();
  assert.deepEqual(S().plan, afterDrag, "redo brings the pull back");
  S().undo();

  // typed distance equals dragged distance, in any unit, positive and negative
  for (const [typed, moved] of [["0.35", 0.35], ["35 cm", 0.35], ["350mm", 0.35], ["13.78 in", 0.35], ["1.15 ft", 0.35], ["-0.3", -0.3], ["−0.3", -0.3], ["-30 cm", -0.3]] as const) {
    assert.equal(T().begin(top("w-AB"), { mode: "drag" }), true);
    T().move(moved);
    const dragged = structuredClone(S().plan);
    T().cancel();
    assert.deepEqual(S().plan, base, "cancelled: back to the start");
    assert.equal(T().begin(top("w-AB"), { mode: "click" }), true);
    T().setTyped(typed);
    assert.equal(T().applyTyped(), true, `"${typed}" is a distance`);
    assert.deepEqual(S().plan, dragged, `typing "${typed}" lands where dragging ${moved} m does`);
    assert.equal(S().past.length, 1, "one undo step");
    S().undo();
  }

  // typing overrides the mouse while a pull is active
  assert.equal(T().begin(top("w-AB"), { mode: "drag" }), true);
  T().setTyped("0.5");
  close(heightOf(S().plan, "w-AB"), 3.2, 1e-9, "typing previews live");
  T().move(0.1); // the mouse keeps moving
  close(heightOf(S().plan, "w-AB"), 3.2, 1e-9, "…and is ignored while there is typed text");
  T().cancel();
  assert.equal(T().typed, "", "cancel clears the field");

  // Enter with text that is not a distance applies nothing and says what to type
  assert.equal(T().begin(top("w-AB"), { mode: "click" }), true);
  T().setTyped("abc");
  assert.equal(T().applyTyped(), false);
  assert.match(T().message ?? "", /^Type a distance/);
  assert.notEqual(T().pull, null, "the pull is still on");
  T().cancel();

  // typing with a face hovered and no pull started pulls that face
  T().setHover(top("w-HI"));
  T().setTyped("-0.2");
  assert.equal(T().applyTyped(), true);
  close(heightOf(S().plan, "w-HI"), 2.5, 1e-9, "a typed distance on the hovered face");
  assert.equal(S().past.length, 1);
  S().undo();
  T().setHover(null);

  // Escape (cancel) mid-pull: history exactly as it was
  S().renamePlan("history marker"); // one real step, so "unchanged" is not just "empty"
  const pastBefore = S().past.length;
  const planBefore = structuredClone(S().plan);
  assert.equal(T().begin(top("w-AB"), { mode: "drag" }), true);
  T().move(0.8);
  assert.notDeepEqual(S().plan, planBefore, "the pull is live before Escape");
  assert.equal(S().past.length, pastBefore + 1);
  T().cancel();
  assert.equal(S().past.length, pastBefore, "Escape leaves the history length as it was");
  assert.deepEqual(S().plan, planBefore, "and the plan exactly as it was");
  assert.equal(T().pull, null);
  S().undo();

  // a pull that changes nothing records nothing, and cancelling it undoes nothing
  S().renamePlan("another marker");
  const keep = S().past.length;
  assert.equal(T().begin(top("w-AB"), { mode: "drag" }), true);
  T().move(0);
  assert.equal(S().past.length, keep, "a zero pull adds no history");
  T().cancel();
  assert.equal(S().past.length, keep, "cancelling it does not roll back the step before");
  S().undo();

  // a clamped pull: the reason is there, the model stops at the limit
  assert.equal(T().begin(top("w-HI"), { mode: "drag" }), true);
  T().move(9);
  assert.equal(T().pull!.result!.height, 6);
  assert.equal(T().pull!.result!.note, "Height can't be over 6 m, so it's 6 m.");
  close(heightOf(S().plan, "w-HI"), 6, 1e-9, "the plan stops at the limit");
  T().cancel();

  // Alt: this piece only, and no snapping; releasing Alt goes back to the whole wall
  assert.equal(T().begin(top("w-AB"), { mode: "drag" }), true);
  T().move(0.35);
  assert.equal(heightOf(S().plan, "w-BC"), 3.05, "the run follows without Alt");
  T().setAlt(true);
  assert.equal(heightOf(S().plan, "w-BC"), 2.7, "Alt: only the picked piece");
  assert.equal(heightOf(S().plan, "w-AB"), 3.05);
  assert.equal(T().pull!.onlyPiece, true);
  assert.equal(S().past.length, 1, "still one history entry");
  T().move(0.372);
  assert.equal(heightOf(S().plan, "w-AB"), 3.07, "Alt turns snapping off: 1 cm, not 5 cm");
  T().setAlt(false);
  assert.equal(heightOf(S().plan, "w-BC"), 3.05, "release Alt: the whole wall again (snapped back to 5 cm)");
  assert.equal(heightOf(S().plan, "w-AB"), 3.05);
  T().commit();
  S().undo();
  assert.deepEqual(S().plan, base);

  // snapping: 5 cm steps
  assert.equal(T().begin(top("w-HI"), { mode: "drag" }), true);
  T().move(0.372);
  assert.equal(heightOf(S().plan, "w-HI"), 3.05, "0.372 snaps to 0.35");
  T().move(0.376);
  assert.equal(heightOf(S().plan, "w-HI"), 3.1, "0.376 snaps to 0.40");
  T().cancel();

  // openings follow a lowered wall in the same single undo step
  assert.equal(T().begin(top("w-BC"), { mode: "drag", onlyPiece: true }), true);
  T().move(-0.8);
  const lowered = S().plan;
  assert.equal(heightOf(lowered, "w-BC"), 1.9);
  assert.equal(lowered.openings.find((o) => o.id === "d-front")!.height, 1.9, "the door was shortened with the wall");
  for (const o of lowered.openings) {
    const w = lowered.walls.find((x) => x.id === o.wallId)!;
    assert.ok(o.sillHeight + o.height <= w.height + 1e-9, `${o.id} stays inside its wall`);
  }
  assert.deepEqual(validatePlan(lowered), validatePlan(base), "no new validator problems");
  T().commit();
  assert.equal(S().past.length, 1, "wall and openings are ONE undo step");
  S().undo();
  assert.deepEqual(S().plan, base, "and one undo restores the openings too");

  // a wall end at a joint can't be pulled: it says why and changes nothing. (4.7b wired the opening faces and 4.7c
  // the wall sides and free ends: scripts/test-pushpull-openings.ts and test-pushpull-walls.ts cover them.) Both ends
  // of w-AB are at joints (the corner A, the split B), so in 3D they are hidden and never hovered; this is the store's guard.
  const roles: FaceRole[] = ["endA", "endB"];
  for (const role of roles) {
    const planNow = S().plan;
    const past = S().past.length;
    const face: Face = { wallId: "w-AB", role, openingId: null };
    T().setHover(face);
    assert.deepEqual(T().hover, face, `${role}: the store takes the hover`);
    assert.equal(T().message, HIDDEN_END, `${role}: and says why it can't be pulled`);
    assert.equal(T().begin(face, { mode: "drag" }), false, `${role}: a press does not start a pull`);
    assert.equal(T().pull, null, `${role}: no pull`);
    assert.equal(T().message, HIDDEN_END);
    T().setTyped("0.3");
    assert.equal(T().applyTyped(), false, `${role}: a typed distance does nothing either`);
    T().setTyped("");
    assert.equal(S().plan, planNow, `${role}: the plan is the very same object`);
    assert.equal(S().past.length, past, `${role}: no history`);
    T().setHover(null);
    assert.equal(T().message, null, "moving off clears the message");
  }
  assert.equal(JSON.stringify([useSelectionStore.getState().selectedId, useSelectionStore.getState().openingId, useSelectionStore.getState().hoveredId]), sel0, "the selection store was never touched by any of this");
}

// ================================================================= 4. exposed faces (4.7c)

/** Sum of the areas of the triangles of `faces` (in `geo`) that pass `keep`, and their lowest and highest y. */
function areaOf(geo: { getAttribute(n: string): { getX(i: number): number; getY(i: number): number; getZ(i: number): number } }, count: number, keep: (tri: number) => boolean) {
  const pos = geo.getAttribute("position");
  let area = 0;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let tri = 0; tri < count; tri++) {
    if (!keep(tri)) continue;
    const [p, q, r] = [0, 1, 2].map((k) => ({ x: pos.getX(tri * 3 + k), y: pos.getY(tri * 3 + k), z: pos.getZ(tri * 3 + k) }));
    const u = { x: q.x - p.x, y: q.y - p.y, z: q.z - p.z };
    const v = { x: r.x - p.x, y: r.y - p.y, z: r.z - p.z };
    area += Math.hypot(u.y * v.z - u.z * v.y, u.z * v.x - u.x * v.z, u.x * v.y - u.y * v.x) / 2;
    for (const c of [p, q, r]) [y0, y1] = [Math.min(y0, c.y), Math.max(y1, c.y)];
  }
  return { area, y0, y1 };
}
const exposedRoles = (plan: Pick<Plan, "walls" | "openings">, wallId: string) => {
  const { faces } = buildWallMeshData(plan.walls.find((w) => w.id === wallId)!, plan.walls, plan.openings);
  assert.equal(faces.exposed.length, faces.roles.length, `${wallId}: one exposed flag per triangle`);
  return { faces, exposed: new Set(faces.roles.filter((_, i) => faces.exposed[i])), hidden: new Set(faces.roles.filter((_, i) => !faces.exposed[i])) };
};
{
  // the north wall A(0,0)–B(4,0)–C(10,0): split at B (where the T stem w-BI meets it), corners at A and C. No end face of either piece can be seen.
  for (const id of ["w-AB", "w-BC"]) {
    const { exposed, hidden } = exposedRoles(samplePlan, id);
    assert.ok(!exposed.has("endA") && !exposed.has("endB"), `${id}: the split point and the corners expose no end face`);
    assert.ok(hidden.has("endA") && hidden.has("endB"), `${id}: the end caps are still built (and tagged), just hidden`);
    assert.ok(exposed.has("top") && exposed.has("sideLeft") && exposed.has("sideRight"), `${id}: top and both sides are exposed`);
  }
  // T stems: w-BI's a end butts into the north wall at B, w-KM's b end into the east wall at M, w-KL's b end into the south wall at L
  assert.ok(!exposedRoles(samplePlan, "w-BI").exposed.has("endA"), "w-BI: a T stem's end is not exposed");
  assert.ok(!exposedRoles(samplePlan, "w-KM").exposed.has("endB"), "w-KM: a T stem's end is not exposed");
  assert.ok(!exposedRoles(samplePlan, "w-KL").exposed.has("endB"), "w-KL: a T stem's end is not exposed");
  // the sample has no free end anywhere, so no end face of it is exposed at all
  for (const w of samplePlan.walls) {
    const { exposed } = exposedRoles(samplePlan, w.id);
    assert.ok(!exposed.has("endA") && !exposed.has("endB"), `${w.id}: every end of the closed sample is at a joint`);
  }
  // a stub from the joint K(7,5) north into the living room: its a end (at K) is hidden, its b end is FREE and exposed
  const stub: Wall = { id: "w-stub", a: { x: 7, y: 5 }, b: { x: 7, y: 3 }, thickness: 0.1, height: 2.7 };
  const withStub = { walls: [...samplePlan.walls, stub], openings: samplePlan.openings };
  const s = exposedRoles(withStub, "w-stub");
  assert.ok(s.exposed.has("endB"), "a free wall end IS exposed");
  assert.ok(!s.exposed.has("endA"), "its other end, at a joint, is not");
  const free = buildWallMeshData(stub, withStub.walls, []);
  const endB = areaOf(free.geometry, free.faces.roles.length, (i) => free.faces.roles[i] === "endB" && free.faces.exposed[i]);
  close(endB.area, 0.1 * 2.7, 1e-5, "the free end is exposed over its whole face: 0.10 m × 2.70 m (float32 positions)");
  // pickableFaceAt: the role of an exposed triangle, null for a hidden one
  const tri = (role: FaceRole, exp: boolean) => free.faces.roles.findIndex((r, i) => r === role && free.faces.exposed[i] === exp);
  assert.deepEqual(pickableFaceAt(free.faces, tri("endB", true)), { role: "endB", openingId: null });
  assert.equal(pickableFaceAt(free.faces, tri("endA", false)), null, "a hidden triangle is never a target");
  assert.deepEqual(faceRoleAt(free.faces, tri("endA", false)), { role: "endA", openingId: null }, "though it keeps its role");

  // every opening: its jamb, head and sill faces are exposed over exactly the reveal (thickness × height, or × width),
  // between the sill and the head; the bands of the same caps beside the sill and lintel slices, and the slices' own caps, are hidden
  for (const o of samplePlan.openings) {
    const wall = samplePlan.walls.find((w) => w.id === o.wallId)!;
    const { geometry, faces } = buildWallMeshData(wall, samplePlan.walls, samplePlan.openings);
    const n = faces.roles.length;
    const sill = o.sillHeight;
    const head = o.sillHeight + o.height;
    const want: [FaceRole, number][] = [["jambA", wall.thickness * o.height], ["jambB", wall.thickness * o.height], ["head", wall.thickness * o.width]];
    if (o.kind === "window") want.push(["sill", wall.thickness * o.width]);
    for (const [role, area] of want) {
      const mine = (i: number) => faces.roles[i] === role && faces.openingIds[i] === o.id;
      const shown = areaOf(geometry, n, (i) => mine(i) && faces.exposed[i]);
      close(shown.area, area, 1e-5, `${o.id} ${role}: exposed over exactly the reveal`);
      if (role === "jambA" || role === "jambB") {
        close(shown.y0, sill, 1e-5, `${o.id} ${role}: the exposed jamb starts at the sill`);
        close(shown.y1, head, 1e-5, `${o.id} ${role}: and stops at the head`);
        assert.ok(areaOf(geometry, n, (i) => mine(i) && !faces.exposed[i]).area > 0.01, `${o.id} ${role}: the parts of the cap behind the sill and lintel slices are hidden`);
      }
    }
  }
}

console.log("OK");
