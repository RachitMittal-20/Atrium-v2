/**
 * test-rooms.ts — asserts for rooms.ts (face tracing, net areas, name matching)
 * and its wiring into planStore. Run: npx tsx scripts/test-rooms.ts.
 */
import assert from "node:assert/strict";
import { samplePlan } from "../src/data/samplePlan";
import { DEFAULT_FLOOR_MATERIAL, deriveRooms } from "../src/lib/plan/rooms";
import { usePlanStore } from "../src/store/planStore";
import type { Plan } from "../src/types/plan";

const s = () => usePlanStore.getState();
const byName = (p: Plan) => new Map(deriveRooms(p).map((r) => [r.name, r]));

// --- sample: exactly 4 rooms, names kept
const rooms = deriveRooms(samplePlan);
assert.equal(rooms.length, 4);
assert.deepEqual(rooms.map((r) => r.name).sort(), ["Bathroom", "Bedroom 1", "Bedroom 2", "Living room"]);

// --- net areas. Exterior walls are 0.2 m (half = 0.1), interior 0.1 m (half = 0.05).
const ext = samplePlan.walls.find((w) => w.id === "w-AB")!.thickness / 2; // 0.1
const int = samplePlan.walls.find((w) => w.id === "w-BI")!.thickness / 2; // 0.05
const expected: Record<string, number> = {
  // Bedroom 1, centreline x 0–4, y 0–4: x from 0+ext to 4-int, y from 0+ext to 4-int
  //   (4 - 0.1 - 0.05) × (4 - 0.1 - 0.05) = 3.85 × 3.85 = 14.8225
  "Bedroom 1": (4 - ext - int) * (4 - ext - int),
  // Bedroom 2, x 0–4, y 4–8: (4 - 0.1 - 0.05) × (8 - 4 - 0.05 - 0.1) = 3.85 × 3.85 = 14.8225
  "Bedroom 2": (4 - ext - int) * (8 - 4 - int - ext),
  // Bathroom, x 7–10, y 5–8: (10 - 7 - 0.05 - 0.1) × (8 - 5 - 0.05 - 0.1) = 2.85 × 2.85 = 8.1225
  Bathroom: (10 - 7 - int - ext) * (8 - 5 - int - ext),
  // Living room, L-shaped:
  //   top bar  x 4.05–9.9, y 0.1–4.95: (10 - 4 - 0.05 - 0.1) × (5 - 0 - 0.1 - 0.05) = 5.85 × 4.85 = 28.3725
  //   leg      x 4.05–6.95, y 4.95–7.9: (7 - 4 - 0.05 - 0.05) × (8 - 5 - 0.05 - 0.1) = 2.9 × 2.95 = 8.555
  //   total 36.9275
  "Living room": (10 - 4 - int - ext) * (5 - ext - int) + (7 - 4 - int - int) * (8 - 5 - int - ext),
};
let total = 0;
for (const r of rooms) {
  total += r.area;
  const want = expected[r.name];
  assert.ok(Math.abs(r.area - want) / want < 0.02, `${r.name}: area ${r.area}, want ${want}`);
}
// Sum 14.8225 + 14.8225 + 8.1225 + 36.9275 = 74.695 < 10 × 8 = 80
assert.ok(total < 10 * 8, `total ${total} < 80`);

// --- split: a wall from I(4,4) to K(7,5) cuts the L-shaped living room in two
s().loadPlan(structuredClone(samplePlan));
const splitId = s().addWall({ a: { x: 4, y: 4 }, b: { x: 7, y: 5 }, thickness: 0.1, height: 2.7 });
let now = deriveRooms(s().plan);
assert.equal(now.length, 5, "split gives 5 rooms");
const living = now.find((r) => r.name === "Living room")!;
const other = now.find((r) => !["Bathroom", "Bedroom 1", "Bedroom 2", "Living room"].includes(r.name))!;
assert.ok(living.area > other.area, "larger part keeps the name");
assert.match(other.name, /^Room \d+$/);
assert.equal(other.floorMaterial, DEFAULT_FLOOR_MATERIAL);

// --- merge: deleting that wall joins them back under the larger name
s().deleteWall(splitId);
now = deriveRooms(s().plan);
assert.equal(now.length, 4);
assert.ok(now.some((r) => r.name === "Living room" && r.wallIds.length === 7), "merged back to Living room");
assert.ok(s().plan.rooms.every((r) => r.wallIds.every((id) => s().plan.walls.some((w) => w.id === id))), "no stale wall ids");

// --- rename, then move a wall: name survives
s().loadPlan(structuredClone(samplePlan));
s().renameRoom("r-living", "Lounge");
s().moveWallEndpoint("w-BC", "b", { x: 10.5, y: 0 });
assert.ok(byName(s().plan).has("Lounge"), "rename survives a wall move");

// --- one undo after a wall edit restores the old rooms exactly
s().loadPlan(structuredClone(samplePlan));
const beforeRooms = structuredClone(s().plan.rooms);
s().addWall({ a: { x: 4, y: 4 }, b: { x: 7, y: 5 }, thickness: 0.1, height: 2.7 });
assert.notDeepEqual(s().plan.rooms, beforeRooms);
s().undo();
assert.deepEqual(s().plan.rooms, beforeRooms, "undo restores rooms");

// --- dangling walls are ignored: one floating, one sticking out of joint A
const dangling: Plan = {
  ...samplePlan,
  walls: [
    ...samplePlan.walls,
    { id: "float", a: { x: 5, y: 1 }, b: { x: 6, y: 2 }, thickness: 0.1, height: 2.7 },
    { id: "spur", a: { x: 0, y: 0 }, b: { x: -1, y: -1 }, thickness: 0.1, height: 2.7 },
  ],
};
const summary = (p: Plan) => deriveRooms(p).map((r) => `${r.name}:${r.area.toFixed(6)}`).sort();
assert.deepEqual(summary(dangling), summary(samplePlan), "dangling walls don't change rooms");

console.log("OK");
