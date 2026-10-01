/**
 * test-geometry.ts — asserts for geometry.ts (mitres, snapping, clamping),
 * clamping wired into planStore, and one failing plan per validatePlan fault.
 * Run: npx tsx scripts/test-geometry.ts (throws on the first failure).
 */
import assert from "node:assert/strict";
import { samplePlan } from "../src/data/samplePlan";
import { clampOpening, snapPoint, wallOutline } from "../src/lib/plan/geometry";
import { validatePlan } from "../src/lib/plan/validate";
import { usePlanStore } from "../src/store/planStore";
import type { Opening, Plan, Vec2, Wall } from "../src/types/plan";

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const samePoint = (p: Vec2, q: Vec2, msg: string) =>
  assert.ok(near(p.x, q.x) && near(p.y, q.y), `${msg}: got (${p.x}, ${p.y}), want (${q.x}, ${q.y})`);
const wall = (id: string, a: Vec2, b: Vec2, thickness = 0.2): Wall => ({ id, a, b, thickness, height: 2.7 });
const V = (x: number, y: number): Vec2 => ({ x, y });

// --- L-joint: outer corner reaches out, inner corner tucks in
{
  const w1 = wall("w1", V(0, 0), V(4, 0));
  const w2 = wall("w2", V(4, 0), V(4, 4));
  const [aR, bR, bL, aL] = wallOutline(w1, [w1, w2]);
  samePoint(aR, V(0, -0.1), "L free end, right");
  samePoint(aL, V(0, 0.1), "L free end, left");
  samePoint(bR, V(4.1, -0.1), "L outer corner");
  samePoint(bL, V(3.9, 0.1), "L inner corner");
}

// --- T-junction (walls split at the joint): the through-wall stays square, the stem meets its edge
{
  const left = wall("left", V(0, 0), V(4, 0));
  const right = wall("right", V(4, 0), V(8, 0));
  const stem = wall("stem", V(4, 0), V(4, 4));
  const all = [left, right, stem];
  const l = wallOutline(left, all);
  samePoint(l[1], V(4, -0.1), "T through-wall, top");
  samePoint(l[2], V(4, 0.1), "T through-wall, stem side");
  const s = wallOutline(stem, all);
  samePoint(s[0], V(4.1, 0.1), "T stem, right");
  samePoint(s[3], V(3.9, 0.1), "T stem, left");
}

// --- 3-wall joint (Y at 0°, 120°, 240°): mitres sit on the bisectors, h / sin 60° from the joint
{
  const R = 3;
  const angles = [0, 120, 240].map((d) => (d * Math.PI) / 180);
  const ys = angles.map((t, i) => wall(`y${i}`, V(0, 0), V(R * Math.cos(t), R * Math.sin(t))));
  const [aR, , , aL] = wallOutline(ys[0], ys);
  const m = 0.1 / Math.tan(Math.PI / 3); // x of the corner where y = ±0.1
  samePoint(aL, V(m, 0.1), "Y mitre, left");
  samePoint(aR, V(m, -0.1), "Y mitre, right");
}

// --- snapping priorities: endpoint > midpoint > angle > grid
{
  const walls = [wall("s", V(0, 0), V(4, 0))];
  assert.equal(snapPoint(V(0.03, 0.02), walls, { from: V(0, -2) }).kind, "endpoint", "endpoint beats angle");
  assert.equal(snapPoint(V(2.05, 0.02), walls).kind, "midpoint");
  const ang = snapPoint(V(3.02, 3.05), walls, { from: V(1, 1) });
  assert.equal(ang.kind, "angle");
  assert.ok(near(ang.point.x - 1, ang.point.y - 1), "angle snap lies on the 45° ray");
  const grid = snapPoint(V(7.013, 9.02), walls);
  assert.equal(grid.kind, "grid");
  samePoint(grid.point, V(7, 9), "grid");
  assert.equal(snapPoint(V(7.013, 9.02), walls, { from: V(1, 1) }).kind, "grid", "off every ray falls to grid");
}

// --- clampOpening
{
  const win: Opening = { id: "o", wallId: "w", kind: "window", offset: 0.1, width: 1.2, height: 1.2, sillHeight: 0.9 };
  const w = wall("w", V(0, 0), V(3, 0));
  assert.deepEqual([clampOpening(win, w).offset, clampOpening(win, w).width], [0.6, 1.2], "pushed in from start");
  assert.equal(clampOpening({ ...win, offset: 9 }, w).offset, 2.4, "pushed in from end");
  assert.equal(clampOpening({ ...win, offset: 1.5 }, w).offset, 1.5, "already inside: unchanged");
  const short = clampOpening(win, wall("w", V(0, 0), V(0.8, 0)));
  assert.deepEqual([short.offset, short.width], [0.4, 0.8], "wall shorter than opening shrinks it");
}

// --- store: moving a joint clamps openings, keeps the plan valid, and undoes as one step
{
  const s = () => usePlanStore.getState();
  s().loadPlan(structuredClone(samplePlan));
  const before = structuredClone(s().plan);
  // Joint C (10,0) → (10,2): w-CM shrinks 5 → 3 m, so the 1.2 m window at 2.5 must move to 2.4.
  s().moveWallEndpoint("w-BC", "b", V(10, 2));
  assert.deepEqual(validatePlan(s().plan), [], "plan still valid after move");
  assert.equal(s().plan.openings.find((o) => o.id === "win-living-e")!.offset, 2.4, "window clamped");
  assert.equal(s().past.length, 1, "wall move + clamp is one undo step");
  s().undo();
  assert.deepEqual(s().plan, before, "one undo restores wall and openings");

  // updateWall shrinks a wall too: same clamp, same single undo step
  s().updateWall("w-CM", { a: V(10, 2) });
  assert.equal(s().plan.openings.find((o) => o.id === "win-living-e")!.offset, 2.4, "updateWall clamps too");
  assert.equal(s().past.length, 1);
  s().undo();
  assert.deepEqual(s().plan, before, "updateWall undoes as one step");
}

// --- validatePlan: one small broken plan per fault, asserting the right message appears
{
  const plan = (walls: Wall[], openings: Opening[] = []): Plan => ({ ...samplePlan, walls, openings, rooms: [], items: [] });
  const door = (id: string, wallId: string, offset: number): Opening => ({
    id, wallId, kind: "door", offset, width: 1, height: 2.1, sillHeight: 0, swing: "left",
  });
  const has = (p: Plan, text: string) => {
    const problems = validatePlan(p);
    assert.ok(problems.some((m) => m.includes(text)), `want "${text}" in ${JSON.stringify(problems)}`);
  };
  const a = wall("a", V(0, 0), V(4, 0));
  const b = wall("b", V(4, 0), V(4, 4));
  const c = wall("c", V(4, 4), V(0, 0)); // closes the triangle so every endpoint is shared

  assert.deepEqual(validatePlan(plan([a, b, c], [door("d", "a", 2)])), [], "control plan is valid");
  has(plan([a, wall("z", V(2, 2), V(2, 2))]), "Wall z has zero length");
  has(plan([a, wall("far", V(9, 9), V(12, 9))]), "isn't shared with any other wall");
  has(plan([a, wall("stem", V(2, 0), V(2, 3))]), "lands on the middle of wall a");
  has(plan([a, b, c], [door("d", "a", 3.8)]), "Opening d spans");
  has(plan([a, b, c], [door("d1", "a", 1.5), door("d2", "a", 2)]), "Openings d1 and d2 overlap on wall a");
  has(plan([a, b, c], [door("d", "nope", 1)]), "references missing wall nope");
}

console.log("OK");
