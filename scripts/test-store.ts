/**
 * test-store.ts — proves planStore's history behaviour with plain asserts.
 * Run: npx tsx scripts/test-store.ts (throws on the first failure).
 */
import assert from "node:assert/strict";
import { samplePlan } from "../src/data/samplePlan";
import { usePlanStore } from "../src/store/planStore";

const s = () => usePlanStore.getState();
const reset = () => s().loadPlan(structuredClone(samplePlan));

// (a) five moves in one transaction undo in a single step
reset();
const before = structuredClone(s().plan);
// w-AB end a is joint A (0,0): shared with w-HA's end b, so both must move
s().transaction(() => {
  for (let i = 1; i <= 5; i++) s().moveWallEndpoint("w-AB", "a", { x: -i * 0.1, y: -i * 0.1 });
});
const moved = structuredClone(s().plan);
assert.deepEqual(moved.walls.find((w) => w.id === "w-AB")!.a, { x: -0.5, y: -0.5 });
assert.deepEqual(moved.walls.find((w) => w.id === "w-HA")!.b, { x: -0.5, y: -0.5 }, "joined wall moves too");
assert.equal(s().past.length, 1, "whole drag is one history entry");
s().undo();
assert.deepEqual(s().plan, before, "(a) one undo restores the original");

// (b) redo reapplies it
s().redo();
assert.deepEqual(s().plan, moved, "(b) redo reapplies the move");

// (c) deleteWall drops its openings; one undo brings back both
reset();
const withWall = structuredClone(s().plan);
const openingsOnBC = withWall.openings.filter((o) => o.wallId === "w-BC").length;
assert.ok(openingsOnBC > 0);
s().deleteWall("w-BC");
assert.equal(s().plan.walls.some((w) => w.id === "w-BC"), false);
assert.equal(s().plan.openings.some((o) => o.wallId === "w-BC"), false, "(c) openings removed");
s().undo();
assert.deepEqual(s().plan, withWall, "(c) one undo restores wall and openings");

// (d) history is capped at 100
reset();
for (let i = 0; i < 150; i++) s().updateWall("w-AB", { thickness: 0.1 + i / 1000 });
assert.equal(s().past.length, 100, "(d) history capped at 100");

console.log("OK");
