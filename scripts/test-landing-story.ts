/**
 * test-landing-story.ts — step H.2: the landing hero's story after the build (src/lib/landing/story.ts), on the REAL
 * sample plan, at the desktop, laptop and phone aspects the e2e uses:
 *   - the phases run 0 → 1 in order and hold outside their range;
 *   - the front door is found from the plan (the sample's d-front, out to the north), and a plan without an exterior
 *     door has none, and then the camera stays outside on its orbit;
 *   - the camera is continuous over the whole scroll (no jump between two scroll positions 1/4000 apart) and never
 *     below 0.3 m;
 *   - while it settles and tours, the whole house (floor to the tallest wall) is inside the view and in front of it;
 *   - on the walk in, wherever the camera is lower than the walls, it is clear of every wall solid by at least 0.15 m
 *     (the studio's own walk collision, which cuts door spans out), it crosses the wall line inside the door's gap
 *     and under its head, and it ends inside a room;
 *   - the build's own camera (cameraAt) is what the story uses up to BUILD_END, so step L.2's no-crop checks still hold.
 * Not written failing first: the module and this test were written together (HANDOFF section 48 says so).
 * Run: npx tsx scripts/test-landing-story.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { samplePlan } from "../src/data/samplePlan";
import { cameraAt, FOV, planBounds } from "../src/lib/landing/blueprint";
import { BUILD_END, ENTER_END, FADE_START, frontDoor, orbitFrame, storyAt, storyCamera, TOUR_END, TOUR_START } from "../src/lib/landing/story";
import { deriveRooms, pointInPolygon } from "../src/lib/plan/rooms";
import { buildCollision, clearance } from "../src/lib/walk/collision";
import type { Plan } from "../src/types/plan";

const plan = samplePlan;
const ASPECTS = [1440 / 900, 1280 / 720, 390 / 844];
const H = Math.max(2.7, ...plan.walls.map((w) => w.height));
const TAN = Math.tan((FOV / 2) * (Math.PI / 180));

// ---- phases
let prev = storyAt(0);
for (const k of Object.keys(prev) as (keyof typeof prev)[]) assert.equal(prev[k], 0, `${k} starts at 0`);
for (let i = 1; i <= 1000; i++) {
  const s = storyAt(i / 1000);
  for (const k of Object.keys(s) as (keyof typeof s)[]) {
    assert.ok(s[k] >= prev[k] - 1e-12 && s[k] >= 0 && s[k] <= 1, `${k} never goes back and stays in 0..1 (p=${i / 1000})`);
  }
  prev = s;
}
const end = storyAt(1);
for (const k of Object.keys(end) as (keyof typeof end)[]) assert.equal(end[k], 1, `${k} ends at 1`);
assert.ok(BUILD_END < TOUR_START && TOUR_START < TOUR_END && TOUR_END < ENTER_END && FADE_START < ENTER_END, "the marks are in order, and the fade starts before the camera is all the way in");

// ---- the front door
const door = frontDoor(plan);
assert.ok(door, "the sample has a front door");
assert.equal(door.id, "d-front", "it is d-front");
assert.ok(Math.abs(door.outward.x) < 1e-9 && Math.abs(door.outward.y + 1) < 1e-9, `out is north (got ${door.outward.x}, ${door.outward.y})`);
const noDoor: Plan = { ...plan, openings: plan.openings.filter((o) => o.id !== "d-front") };
assert.equal(frontDoor(noDoor), null, "without d-front every door has rooms on both sides: no front door");

// ---- an independent look-at projection (up = +Y), as test-landing-scene does
function ndc(c: { position: number[]; target: number[] }, p: [number, number, number], aspect: number): [number, number, number] {
  const f = [0, 1, 2].map((i) => c.target[i] - c.position[i]);
  const fl = Math.hypot(f[0], f[1], f[2]);
  const fw = f.map((v) => v / fl);
  const r = [-fw[2], 0, fw[0]];
  const rl = Math.hypot(r[0], r[2]);
  const rw = r.map((v) => v / rl);
  const u = [rw[1] * fw[2] - rw[2] * fw[1], rw[2] * fw[0] - rw[0] * fw[2], rw[0] * fw[1] - rw[1] * fw[0]];
  const d = [0, 1, 2].map((i) => p[i] - c.position[i]);
  const depth = d[0] * fw[0] + d[1] * fw[1] + d[2] * fw[2];
  return [(d[0] * rw[0] + d[1] * rw[1] + d[2] * rw[2]) / (depth * TAN * aspect), (d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) / (depth * TAN), depth];
}

const pb = planBounds(plan);
const corners: [number, number, number][] = [pb.x, pb.x + pb.w].flatMap((x) => [pb.y, pb.y + pb.h].flatMap((z) => [0, H].map((y) => [x, y, z] as [number, number, number])));
const collision = buildCollision(plan);
const rooms = deriveRooms(plan);
const N = 4000;

for (const aspect of ASPECTS) {
  const tag = `aspect ${aspect.toFixed(2)}`;
  // The build is cameraAt's, untouched.
  for (const b of [0, 0.3, 0.7, 1]) {
    const a = storyCamera(b * BUILD_END, plan, aspect, 0.25);
    const c = cameraAt(b, plan, aspect, 0.25);
    assert.deepEqual([a.position, a.target], [c.position, c.target], `${tag}: up to BUILD_END the camera is the build's (b=${b})`);
  }

  let last = storyCamera(0, plan, aspect, 0.25);
  let worstStep = 0;
  let crossed = false;
  for (let i = 0; i <= N; i++) {
    const p = i / N;
    const c = storyCamera(p, plan, aspect, 0.25);
    for (const v of [...c.position, ...c.target]) assert.ok(Number.isFinite(v), `${tag}: finite at p=${p}`);
    assert.ok(c.position[1] > 0.3, `${tag}: above the ground at p=${p} (y ${c.position[1].toFixed(3)})`);
    const step = Math.max(Math.hypot(c.position[0] - last.position[0], c.position[1] - last.position[1], c.position[2] - last.position[2]), Math.hypot(c.target[0] - last.target[0], c.target[1] - last.target[1], c.target[2] - last.target[2]));
    worstStep = Math.max(worstStep, step);
    last = c;

    // Settling and touring: the whole house in view.
    if (p > BUILD_END && p <= TOUR_END) {
      for (const q of corners) {
        const [x, y, depth] = ndc(c, q, aspect);
        assert.ok(depth > 0 && Math.abs(x) <= 1 && Math.abs(y) <= 1, `${tag}: house corner ${q} in view at p=${p.toFixed(4)} (ndc ${x.toFixed(3)}, ${y.toFixed(3)})`);
      }
    }
    // The walk in: never inside a wall while lower than the walls; through the door's gap, under its head.
    if (p > TOUR_END && c.position[1] < H + 0.2) {
      const at = { x: c.position[0], y: c.position[2] };
      assert.ok(clearance(collision, at) >= 0.15, `${tag}: clear of every wall at p=${p.toFixed(4)} (clearance ${clearance(collision, at).toFixed(3)} at ${at.x.toFixed(2)}, ${at.y.toFixed(2)})`);
      const across = (at.x - door.centre.x) * door.outward.x + (at.y - door.centre.y) * door.outward.y;
      if (Math.abs(across) <= door.thickness / 2) {
        crossed = true;
        const along = Math.abs((at.x - door.centre.x) * door.outward.y - (at.y - door.centre.y) * door.outward.x);
        assert.ok(along <= door.width / 2 - 0.2, `${tag}: inside the door's gap as it crosses the wall (${along.toFixed(3)} m off centre)`);
        assert.ok(c.position[1] < door.height - 0.2, `${tag}: under the door's head as it crosses the wall`);
      }
    }
  }
  assert.ok(worstStep < 0.2, `${tag}: no jump: the largest move between scroll steps 1/${N} apart is ${worstStep.toFixed(3)} m`);
  assert.ok(crossed, `${tag}: the walk crosses the front wall`);
  const inside = storyCamera(1, plan, aspect);
  assert.ok(rooms.some((r) => pointInPolygon({ x: inside.position[0], y: inside.position[2] }, r.polygon)), `${tag}: the story ends inside a room`);
  assert.ok(inside.near <= 0.05, `${tag}: a small near plane for the walk in`);

  // No front door: the camera ends on the orbit, outside every room, still framing the house.
  const out = storyCamera(1, noDoor, aspect);
  assert.ok(!rooms.some((r) => pointInPolygon({ x: out.position[0], y: out.position[2] }, r.polygon)), `${tag}: without a front door the camera stays outside`);
  const { distance } = orbitFrame(noDoor, aspect);
  assert.ok(Math.abs(Math.hypot(out.position[0] - out.target[0], out.position[1] - out.target[1], out.position[2] - out.target[2]) - distance) < 1e-9, `${tag}: on the orbit`);
}

// ---- derived from the plan with the shared helpers
const story = readFileSync("src/lib/landing/story.ts", "utf8");
assert.match(story, /from "@\/lib\/plan\/rooms"/, "story.ts finds rooms with rooms.ts");
assert.match(story, /from "@\/lib\/plan2d\/openings"/, "story.ts places the door with openingFrame");

console.log(`test-landing-story: OK (front door ${door.id}, ${ASPECTS.length} aspects, ${N + 1} scroll positions each)`);
