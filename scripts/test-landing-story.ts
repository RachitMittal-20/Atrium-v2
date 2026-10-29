/**
 * test-landing-story.ts — steps H.2 and H.3: the landing hero's story after the build (src/lib/landing/story.ts), the
 * villa that finishes the house (villa.ts) and its garden (site.ts), on the REAL sample plan, at the desktop, laptop and
 * phone aspects the e2e uses:
 *   - the phases run 0 → 1 in order and hold outside their range, and the marks are in order;
 *   - the front door is found from the plan (the sample's d-front, out to the north), and a plan without an exterior
 *     door has none, and then the camera stays outside on its orbit;
 *   - the camera is continuous over the whole scroll (no jump between two scroll positions 1/4000 apart), never below
 *     0.3 m, and never inside a wall while lower than the roof (the studio's own walk collision);
 *   - while it settles, tours and comes down to the front view, the whole house (floor to the roof's ridge, eaves
 *     included) is inside the view and in front of it; and it ends outside, in front of the door, facing the house;
 *   - the roof covers every wall with its overhang, its ridge stands at PITCH over the shorter side, and its triangles
 *     are finite; every window has its pane and sill on its own opening; the front door has two leaves, glass, a porch
 *     on its outside and two lamps; inner doors get nothing;
 *   - the garden is seeded; nothing of it stands on the terrace or the path; the hedges are outside the terrace's front;
 *     round trees stay out of the corridor in front of the door; nothing stands where the camera is;
 *   - the build's own camera (cameraAt) is what the story uses up to BUILD_END, so step L.2's no-crop checks still hold.
 * H.2's module and test were written together, not failing first; H.3's villa checks were added with villa.ts (HANDOFF
 * sections 48 and 49 say so).
 * Run: npx tsx scripts/test-landing-story.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { samplePlan } from "../src/data/samplePlan";
import { cameraAt, FOV, planBounds } from "../src/lib/landing/blueprint";
import { CORRIDOR, doorCoords, DRIVE, sitePlan, TERRACE } from "../src/lib/landing/site";
import {
  APPROACH_END,
  BUILD_END,
  FADE_END,
  FADE_START,
  frontDoor,
  LIGHT_END,
  LIGHT_START,
  orbitFrame,
  PUSH_END,
  REVEAL_END,
  REVEAL_START,
  storyAt,
  storyCamera,
  TOUR_END,
  TOUR_START,
} from "../src/lib/landing/story";
import { dressing, hipRoof, houseTop, OVERHANG, PITCH, piecesTriangles } from "../src/lib/landing/villa";
import { openingFrame } from "../src/lib/plan2d/openings";
import { deriveRooms, pointInPolygon } from "../src/lib/plan/rooms";
import { buildCollision, clearance } from "../src/lib/walk/collision";
import type { Plan } from "../src/types/plan";

const plan = samplePlan;
const ASPECTS = [1440 / 900, 1280 / 720, 390 / 844];
const H = Math.max(2.7, ...plan.walls.map((w) => w.height));
const TOP = houseTop(plan);
const TAN = Math.tan((FOV / 2) * (Math.PI / 180));

// ---- phases
let prev = storyAt(0);
for (const k of Object.keys(prev) as (keyof typeof prev)[]) assert.equal(prev[k], 0, `${k} starts at 0`);
for (let i = 1; i <= 1000; i++) {
  const s = storyAt(i / 1000);
  for (const k of Object.keys(s) as (keyof typeof s)[]) assert.ok(s[k] >= prev[k] - 1e-12 && s[k] >= 0 && s[k] <= 1, `${k} never goes back and stays in 0..1 (p=${i / 1000})`);
  prev = s;
}
const end = storyAt(1);
for (const k of Object.keys(end) as (keyof typeof end)[]) assert.equal(end[k], 1, `${k} ends at 1`);
assert.ok(
  BUILD_END < TOUR_START && TOUR_START < TOUR_END && TOUR_END < APPROACH_END && APPROACH_END < REVEAL_START && REVEAL_START < REVEAL_END && REVEAL_END < LIGHT_START && LIGHT_START < LIGHT_END && LIGHT_END <= PUSH_END && PUSH_END <= FADE_START && FADE_START < FADE_END && FADE_END < 1,
  "the marks are in order: the camera is at the front before the reveal, and the wash comes before the fade",
);

// ---- the front door
const door = frontDoor(plan);
assert.ok(door, "the sample has a front door");
assert.equal(door.id, "d-front", "it is d-front");
assert.ok(Math.abs(door.outward.x) < 1e-9 && Math.abs(door.outward.y + 1) < 1e-9, `out is north (got ${door.outward.x}, ${door.outward.y})`);
const noDoor: Plan = { ...plan, openings: plan.openings.filter((o) => o.id !== "d-front") };
assert.equal(frontDoor(noDoor), null, "without d-front every door has rooms on both sides: no front door");

// ---- the roof
const pb = planBounds(plan);
const roof = hipRoof(plan);
assert.ok(roof.positions.length % 9 === 0 && roof.positions.every(Number.isFinite), "the roof is whole, finite triangles");
assert.ok(Math.abs(roof.eaves.x - (pb.x - OVERHANG)) < 1e-12 && Math.abs(roof.eaves.w - (pb.w + 2 * OVERHANG)) < 1e-12 && Math.abs(roof.eaves.h - (pb.h + 2 * OVERHANG)) < 1e-12, "the eaves are the footprint grown by the overhang");
const ys = roof.positions.filter((_, i) => i % 3 === 1);
assert.ok(Math.abs(Math.max(...ys) - TOP) < 1e-9, `the ridge is the house's top (${Math.max(...ys)} against ${TOP})`);
assert.ok(Math.abs(roof.rise - (Math.min(roof.eaves.w, roof.eaves.h) / 2) * Math.tan((PITCH * Math.PI) / 180)) < 1e-12, "the ridge stands at PITCH over half the shorter side");
assert.ok(Math.min(...ys) >= H - 0.2 - 1e-9, "nothing of the roof hangs lower than its fascia");

// ---- the dressing: on the plan's own openings
const dress = dressing(plan, door);
const windows = plan.openings.filter((o) => o.kind === "window");
assert.equal(dress.panes.length, windows.length + 4, `a pane per window and four for the front door (got ${dress.panes.length})`);
assert.equal(dress.lamps.length, 2, "two lamps by the front door");
assert.equal(dress.stone.length, windows.length + 1, "a sill per window and the porch");
for (const o of windows) {
  const wall = plan.walls.find((w) => w.id === o.wallId)!;
  const f = openingFrame(wall, o);
  const pane = dress.panes.find((p) => Math.hypot(p.centre[0] - f.centre.x, p.centre[2] - f.centre.y) < 1e-9);
  assert.ok(pane, `${o.id}: a pane at its centre`);
  assert.ok(Math.abs(pane.centre[1] - (o.sillHeight + o.height / 2)) < 1e-9 && pane.w < o.width && pane.h < o.height, `${o.id}: the pane fills the opening inside its frame`);
}
const porch = dress.stone.find((s) => s.size[0] > door.width + 1)!;
const pc = doorCoords(door, { x: porch.centre[0], y: porch.centre[2] });
assert.ok(pc.along > door.thickness / 2 && Math.abs(pc.across) < 1e-9, `the porch is outside the front door (along ${pc.along.toFixed(3)})`);
for (const l of dress.lamps) assert.ok(doorCoords(door, { x: l.centre[0], y: l.centre[2] }).along > door.thickness / 2, "the lamps are on the outside face");
const tris = piecesTriangles(dress.frames);
assert.equal(tris.positions.length, dress.frames.length * 6 * 18, "six faces of two triangles per piece");
assert.ok(tris.positions.every(Number.isFinite) && tris.normals.every(Number.isFinite), "finite");

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

// The house: the eaves' corners at the fascia's foot and at the eaves, the walls' foot, and the ridge's two ends.
const e = roof.eaves;
const corners: [number, number, number][] = [
  ...[e.x, e.x + e.w].flatMap((x) => [e.y, e.y + e.h].flatMap((z) => [H - 0.2, H].map((y) => [x, y, z] as [number, number, number]))),
  ...[pb.x, pb.x + pb.w].flatMap((x) => [pb.y, pb.y + pb.h].map((z) => [x, 0, z] as [number, number, number])),
  ...ys.map((y, i) => [roof.positions[3 * i], y, roof.positions[3 * i + 2]] as [number, number, number]).filter((p) => Math.abs(p[1] - TOP) < 1e-9),
];
const collision = buildCollision(plan);
const rooms = deriveRooms(plan);
const site = sitePlan(pb, door);
const N = 4000;

for (const aspect of ASPECTS) {
  const tag = `aspect ${aspect.toFixed(2)}`;
  for (const b of [0, 0.3, 0.7, 1]) {
    const a = storyCamera(b * BUILD_END, plan, aspect, 0.25);
    const c = cameraAt(b, plan, aspect, 0.25);
    assert.deepEqual([a.position, a.target], [c.position, c.target], `${tag}: up to BUILD_END the camera is the build's (b=${b})`);
  }
  let last = storyCamera(0, plan, aspect, 0.25);
  let worstStep = 0;
  for (let i = 0; i <= N; i++) {
    const p = i / N;
    const c = storyCamera(p, plan, aspect, 0.25);
    for (const v of [...c.position, ...c.target]) assert.ok(Number.isFinite(v), `${tag}: finite at p=${p}`);
    assert.ok(c.position[1] > 0.3, `${tag}: above the ground at p=${p} (y ${c.position[1].toFixed(3)})`);
    worstStep = Math.max(worstStep, Math.hypot(c.position[0] - last.position[0], c.position[1] - last.position[1], c.position[2] - last.position[2]), Math.hypot(c.target[0] - last.target[0], c.target[1] - last.target[1], c.target[2] - last.target[2]));
    last = c;
    if (c.position[1] < TOP + 0.2) assert.ok(clearance(collision, { x: c.position[0], y: c.position[2] }) >= 0.15, `${tag}: clear of every wall at p=${p.toFixed(4)}`);
    if (p > BUILD_END) for (const q of corners) {
      const [x, y, depth] = ndc(c, q, aspect);
      assert.ok(depth > 0 && Math.abs(x) <= 1 && Math.abs(y) <= 1, `${tag}: house point ${q.map((v) => v.toFixed(2))} in view at p=${p.toFixed(4)} (ndc ${x.toFixed(3)}, ${y.toFixed(3)})`);
    }
  }
  assert.ok(worstStep < 0.25, `${tag}: no jump: the largest move between scroll steps 1/${N} apart is ${worstStep.toFixed(3)} m`);

  // The front view: outside, in front of the door, looking at the house, held from APPROACH_END to the end.
  const front = storyCamera(1, plan, aspect);
  assert.deepEqual(storyCamera(APPROACH_END, plan, aspect), front, `${tag}: the camera holds the front view after APPROACH_END`);
  const at = doorCoords(door, { x: front.position[0], y: front.position[2] });
  assert.ok(at.along > TERRACE + 2 && Math.abs(at.across) < 4, `${tag}: out in front of the door (along ${at.along.toFixed(2)}, across ${at.across.toFixed(2)})`);
  assert.ok(!rooms.some((r) => pointInPolygon({ x: front.position[0], y: front.position[2] }, r.polygon)), `${tag}: outside every room`);
  const look = [front.target[0] - front.position[0], front.target[2] - front.position[2]];
  assert.ok((look[0] * door.outward.x + look[1] * door.outward.y) / Math.hypot(look[0], look[1]) < -0.99, `${tag}: facing the house`);
  for (const t of site.trees) assert.ok(Math.hypot(front.position[0] - t.x, front.position[2] - t.z) > 1.5, `${tag}: no tree where the camera stands`);

  // No front door: the camera ends on the orbit, outside every room, still framing the house.
  const out = storyCamera(1, noDoor, aspect);
  assert.ok(!rooms.some((r) => pointInPolygon({ x: out.position[0], y: out.position[2] }, r.polygon)), `${tag}: without a front door the camera stays outside`);
  const { distance } = orbitFrame(noDoor, aspect);
  assert.ok(Math.abs(Math.hypot(out.position[0] - out.target[0], out.position[1] - out.target[1], out.position[2] - out.target[2]) - distance) < 1e-9, `${tag}: on the orbit`);
}

// ---- the garden (decoration, placed from the plan's footprint and front door)
assert.deepEqual(sitePlan(pb, door), site, "seeded: the same plan gets the same garden");
assert.ok(site.path && site.fountain && site.hedges.length === 2 && site.shrubs.length > 8 && site.trees.filter((t) => t.kind === "cypress").length >= 4 && site.trees.filter((t) => t.kind === "round").length >= 6, `a path, a fountain, two hedges, shrubs, cypresses and round trees (${site.shrubs.length} shrubs, ${site.trees.length} trees)`);
const inTerrace = (x: number, z: number) => x > site.terrace.x && x < site.terrace.x + site.terrace.w && z > site.terrace.y && z < site.terrace.y + site.terrace.h;
const pathHalf = site.path!.width / 2;
for (const s of site.shrubs) {
  assert.ok(!inTerrace(s.x, s.z), `shrub at ${s.x.toFixed(2)}, ${s.z.toFixed(2)} is off the terrace`);
  const { along, across } = doorCoords(door, { x: s.x, y: s.z });
  assert.ok(along < 0 || Math.abs(across) > pathHalf + s.r, `shrub at ${s.x.toFixed(2)}, ${s.z.toFixed(2)} is off the path`);
}
for (const t of site.trees) {
  assert.ok(!inTerrace(t.x, t.z), "trees stand off the terrace");
  const { along, across } = doorCoords(door, { x: t.x, y: t.z });
  assert.ok(along < 0 || Math.abs(across) > pathHalf + (t.kind === "round" ? CORRIDOR : 0.5), `${t.kind} at ${t.x.toFixed(2)}, ${t.z.toFixed(2)} is clear of the way in (across ${across.toFixed(2)})`);
  if (t.kind === "round") assert.ok(Math.hypot(t.x - site.fountain!.x, t.z - site.fountain!.y) > DRIVE.outer, "round trees stand off the drive");
}
const edge = Math.max(...[[site.terrace.x, site.terrace.y], [site.terrace.x + site.terrace.w, site.terrace.y + site.terrace.h]].map(([x, z]) => doorCoords(door, { x, y: z }).along));
for (const h of site.hedges) {
  const { along, across } = doorCoords(door, h.centre);
  assert.ok(along - h.depth / 2 > edge && Math.abs(across) - h.length / 2 >= pathHalf, `a hedge outside the terrace's front, clear of the path (along ${along.toFixed(2)}, across ${across.toFixed(2)})`);
}

// ---- derived from the plan with the shared helpers
const story = readFileSync("src/lib/landing/story.ts", "utf8");
const villa = readFileSync("src/lib/landing/villa.ts", "utf8");
assert.match(story, /from "@\/lib\/plan\/rooms"/, "story.ts finds rooms with rooms.ts");
assert.match(story, /from "@\/lib\/plan2d\/openings"/, "story.ts places the door with openingFrame");
assert.match(villa, /from "@\/lib\/plan2d\/openings"/, "villa.ts places frames, panes, porch and lamps with openingFrame");

console.log(`test-landing-story: OK (front door ${door.id}, ridge ${TOP.toFixed(2)} m, ${dress.frames.length} frame pieces, ${ASPECTS.length} aspects, ${N + 1} scroll positions each)`);
