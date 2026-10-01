/**
 * test-walk.ts — checks the walkthrough collision model (src/lib/walk/collision.ts)
 * on the sample plan, on plans built from fixtures 01–04 (buildPlan at 100 px/m,
 * as test-toplan does) and on small hand-built plans. Cases (a)–(l) are listed
 * as they run. Edits in (j) and (l) go through the real plan store.
 *
 * To show the tests have teeth, a deliberately naive mover (no substeps, one
 * pass that adds up every push found at the target) is run through (c), (h)
 * and (i), and each must FAIL on it.
 *
 * The tolerances were fixed before the first run and are printed first.
 * Run: npx tsx scripts/test-walk.ts
 */
import assert from "node:assert/strict";
import sharp from "sharp";
import { samplePlan } from "../src/data/samplePlan";
import { deskew } from "../src/lib/blueprint/deskew";
import { detectWalls } from "../src/lib/blueprint/hollowWalls";
import { detectOpenings } from "../src/lib/blueprint/openings";
import { buildPlan } from "../src/lib/blueprint/toPlan";
import { vectorize } from "../src/lib/blueprint/vectorize";
import { wallDirection, wallNormal } from "../src/lib/plan/geometry";
import { deriveRooms, pointInPolygon } from "../src/lib/plan/rooms";
import {
  buildCollision,
  CAMERA_RADIUS as R,
  clearance,
  collisionStats,
  eyeHeight,
  freePointNear,
  getCollision,
  MIN_DOOR_WIDTH,
  moveWithCollision,
  startPose,
  type Collision,
} from "../src/lib/walk/collision";
import { usePlanStore } from "../src/store/planStore";
import type { Opening, Plan, Vec2, Wall } from "../src/types/plan";

const TOL = { inside: 0.001, slidePerM: 0.005, drift: 0.001, jitter: 0.001, snag: 0.5, door: 0.001 };
console.log(
  `radius ${R} m, min door ${MIN_DOOR_WIDTH} m. tolerances: never inside a solid by more than ${TOL.inside * 1000} mm; ` +
    `slide keeps the along-wall component within ${TOL.slidePerM * 1000} mm per metre; lateral drift and corner jitter under ${TOL.drift * 1000} mm; ` +
    `no snag = every step moves at least ${TOL.snag * 100}% of its length; door clear half-width ±${TOL.door * 1000} mm`,
);

type Mover = (c: Collision, from: Vec2, delta: Vec2) => Vec2;
const real: Mover = moveWithCollision;

/** The naive mover: the whole delta at once, then one pass that sums every grown-rectangle push at the target. */
const naive: Mover = (c, from, delta) => {
  const q = { x: from.x + delta.x, y: from.y + delta.y };
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < c.count; i++) {
    const [cx, cy, ux, uy, hl, ht] = c.pieces.subarray(i * 6, i * 6 + 6);
    const s = (q.x - cx) * ux + (q.y - cy) * uy;
    const t = -(q.x - cx) * uy + (q.y - cy) * ux;
    const es = hl + R - Math.abs(s);
    const et = ht + R - Math.abs(t);
    if (es <= 0 || et <= 0) continue;
    if (es < et) {
      sx += ux * Math.sign(s || 1) * es;
      sy += uy * Math.sign(s || 1) * es;
    } else {
      sx += -uy * Math.sign(t || 1) * et;
      sy += ux * Math.sign(t || 1) * et;
    }
  }
  return { x: q.x + sx, y: q.y + sy };
};

// ------------------------------------------------------------ helpers
const len = (v: Vec2) => Math.hypot(v.x, v.y);
const sub = (p: Vec2, q: Vec2) => ({ x: p.x - q.x, y: p.y - q.y });
const add = (p: Vec2, v: Vec2, k = 1) => ({ x: p.x + v.x * k, y: p.y + v.y * k });

/** Move toward `to` in steps of at most `step`; returns every position, start included. */
function walkTo(c: Collision, mover: Mover, from: Vec2, to: Vec2, step = 0.05, maxSteps = 2000): Vec2[] {
  const path = [from];
  let p = from;
  for (let k = 0; k < maxSteps; k++) {
    const d = sub(to, p);
    const l = len(d);
    if (l < 1e-9) break;
    const next = mover(c, p, l > step ? { x: (d.x / l) * step, y: (d.y / l) * step } : d);
    path.push(next);
    if (len(sub(next, p)) < 1e-9) break; // stuck
    p = next;
  }
  return path;
}

/** `n` moves of a fixed delta; returns every position, start included. */
function push(c: Collision, mover: Mover, from: Vec2, delta: Vec2, n: number): Vec2[] {
  const path = [from];
  for (let k = 0; k < n; k++) path.push(mover(c, path[path.length - 1], delta));
  return path;
}

let nextId = 0;
const W = (a: [number, number], b: [number, number], thickness: number, height = 2.7): Wall => ({ id: `w${nextId++}`, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness, height });
const D = (wallId: string, offset: number, width = 0.9): Opening => ({ id: `o${nextId++}`, wallId, kind: "door", offset, width, height: 2.1, sillHeight: 0, swing: "left" });
const Wi = (wallId: string, offset: number, width = 1.2, sillHeight = 0.9, height = 1.2): Opening => ({ id: `o${nextId++}`, wallId, kind: "window", offset, width, height, sillHeight });
const plan = (walls: Wall[], openings: Opening[] = []): Plan => ({ ...structuredClone(samplePlan), id: "t", walls, openings, rooms: [], items: [] });

/** Plan-space centre and unit normal of an opening. */
function openingFrame(p: Plan, o: Opening) {
  const w = p.walls.find((x) => x.id === o.wallId)!;
  return { w, centre: add(w.a, wallDirection(w), o.offset), n: wallNormal(w), u: wallDirection(w) };
}
const side = (w: Wall, p: Vec2) => (p.x - w.a.x) * wallNormal(w).x + (p.y - w.a.y) * wallNormal(w).y; // signed distance across the centre line

const sample = structuredClone(samplePlan);
const sampleC = buildCollision(sample);
const report = (label: string, covers: string) => console.log(`\n${label} — ${covers}`);

// ------------------------------------------------------------ fixtures
async function fixturePlans(): Promise<Plan[]> {
  const out: Plan[] = [];
  for (const file of ["01_clean_uniform.png", "02_thick_exterior_thin_interior.png", "03_with_dimensions.png", "04_fake_scan.jpg"]) {
    const { data, info } = await sharp(`tests/fixtures/${file}`).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixels = deskew({ width: info.width, height: info.height, rgba: data }).pixels;
    const { walls } = vectorize(detectWalls(pixels).mask);
    const { openings, unpaired } = detectOpenings(walls, pixels);
    out.push(buildPlan({ walls, openings, unpaired, imageSize: { width: pixels.width, height: pixels.height }, name: file }, { pxPerM: 100, source: "manual" }).plan);
  }
  return out;
}

// ------------------------------------------------------------ (c), (h), (i): also run on the naive mover
function checkSlide(mover: Mover): string[] {
  const bad: string[] = [];
  const p = plan([W([0, 0], [20, 0], 0.1)]);
  const c = buildCollision(p);
  const face = 0.05 + R; // the camera's centre stays this far south of the centre line
  for (const step of [0.05, 0.5]) {
    const dir = { x: Math.SQRT1_2 * step, y: -Math.SQRT1_2 * step }; // 45° east and north, into the wall
    const n = Math.round(6 / step);
    const path = push(c, mover, { x: 1, y: 1 }, dir, n);
    const crossed = path.find((q) => q.y < face - TOL.inside);
    if (crossed) bad.push(`step ${step}: crossed the wall (y ${crossed.y.toFixed(3)} < ${face})`);
    const along = path[path.length - 1].x - 1;
    const want = dir.x * n;
    if (Math.abs(along - want) > TOL.slidePerM * want) bad.push(`step ${step}: along-wall ${along.toFixed(4)} m vs ${want.toFixed(4)} m`);
  }
  return bad;
}

function checkSplits(mover: Mover): string[] {
  const bad: string[] = [];
  // North wall outside face (pieces w-AB | w-BC at B, x = 4), pressing 5 mm a step into it; stop before the front door.
  const north = push(sampleC, mover, { x: 0.5, y: -0.1 - R }, { x: 0.05, y: 0.005 }, 114);
  for (const q of north) if (Math.abs(q.y - (-0.1 - R)) > TOL.drift) { bad.push(`north wall: drift ${((q.y + 0.1 + R) * 1000).toFixed(2)} mm at x ${q.x.toFixed(2)}`); break; }
  // East wall outside face (pieces w-CM | w-ME at M, y = 5).
  const east = push(sampleC, mover, { x: 10.1 + R, y: 0.5 }, { x: -0.005, y: 0.05 }, 140);
  for (const q of east) if (Math.abs(q.x - (10.1 + R)) > TOL.drift) { bad.push(`east wall: drift ${((q.x - 10.1 - R) * 1000).toFixed(2)} mm at y ${q.y.toFixed(2)}`); break; }
  // T stems: solid all the way into the through-wall, and the corner beside the stem holds.
  for (let y = -0.095; y <= 2.4; y += 0.01) if (clearance(sampleC, { x: 4, y }) >= 0) { bad.push(`stem w-BI: gap at y ${y.toFixed(2)}`); break; }
  const thin = plan([W([0, 0], [2, 0], 0.3), W([2, 0], [4, 0], 0.3), W([2, 0], [2, 3], 0.05)]);
  const tc = buildCollision(thin);
  for (let y = -0.145; y <= 3; y += 0.005) if (clearance(tc, { x: 2, y }) >= 0) { bad.push(`thin stem: gap at y ${y.toFixed(3)}`); break; }
  const corner = push(sampleC, mover, { x: 3.5, y: 0.5 }, { x: 0.05, y: -0.02 }, 60);
  if (corner.some((q) => q.x > 4 - 0.05 - R + TOL.inside)) bad.push("bedroom 1: got past the stem w-BI at its T");
  const thinCorner = push(tc, mover, { x: 1.5, y: 1 }, { x: 0.05, y: -0.03 }, 60);
  if (thinCorner.some((q) => q.x > 2 - 0.025 - R + TOL.inside)) bad.push("thin stem: got past it at its T");
  return bad;
}

function checkTunnel(mover: Mover): string[] {
  const c = buildCollision(plan([W([0, -5], [0, 5], 0.05)]));
  const end = mover(c, { x: -5, y: 0 }, { x: 10, y: 0 });
  return end.x > -0.025 - R + TOL.inside ? [`one 10 m move ended at x ${end.x.toFixed(3)}, past a 0.05 m wall`] : [];
}

function realAndNaive(label: string, covers: string, check: (m: Mover) => string[]) {
  report(label, covers);
  const r = check(real);
  assert.deepEqual(r, [], `${label}: ${r.join("; ")}`);
  console.log("  PASS real mover");
  const nv = check(naive);
  assert.ok(nv.length > 0, `${label}: the naive mover should fail`);
  console.log(`  naive mover FAILS as it should: ${nv.join("; ")}`);
}

// ------------------------------------------------------------ run
async function main() {
  const fixtures = await fixturePlans();

  report("(a)", "startPose: in a room, clear by the radius, deterministic; null without a room");
  for (const p of [sample, ...fixtures]) {
    const c = buildCollision(p);
    const s1 = startPose(p, c);
    const s2 = startPose(structuredClone(p), buildCollision(structuredClone(p)));
    assert.ok(s1, `${p.name}: no start`);
    assert.deepEqual(s1, s2, `${p.name}: start differs between runs`);
    const room = deriveRooms(p).find((r) => r.id === s1.roomId)!;
    assert.ok(pointInPolygon(s1.position, room.polygon), `${p.name}: start outside its room`);
    const cl = clearance(c, s1.position);
    assert.ok(cl >= R, `${p.name}: start clearance ${cl}`);
    console.log(`  PASS ${p.name}: ${room.name} at (${s1.position.x.toFixed(2)}, ${s1.position.y.toFixed(2)}), clearance ${cl.toFixed(2)} m, heading ${((s1.heading * 180) / Math.PI).toFixed(1)}°, eye ${eyeHeight(p, s1.position).toFixed(2)} m`);
  }
  assert.equal(startPose(plan([]), buildCollision(plan([]))), null, "empty plan");
  const open = plan([W([0, 0], [4, 0], 0.2), W([4, 0], [4, 3], 0.2)]);
  assert.equal(startPose(open, buildCollision(open)), null, "plan with walls but no closed room");
  console.log("  PASS null for an empty plan and for walls with no closed room");
  assert.equal(eyeHeight(plan([W([0, 0], [4, 0], 0.2, 1.5)]), { x: 1, y: 1 }), 0.9 * 1.5, "eye under a low wall");
  assert.equal(eyeHeight(plan([W([0, 0], [4, 0], 0.2, 1.5)]), { x: 1, y: 5 }), 1.6, "low wall over 3 m away");

  report("(b)", "walking straight at a wall in 0.05 m steps stops against it");
  const b = push(sampleC, real, { x: 2, y: 2 }, { x: 0, y: -0.05 }, 80);
  assert.ok(b.every((q) => q.y >= 0.1 + R - TOL.inside), "(b) crossed w-AB");
  assert.ok(clearance(sampleC, b[b.length - 1]) >= R - TOL.inside, "(b) final clearance");
  console.log(`  PASS stops at y ${b[b.length - 1].y.toFixed(4)} (face + radius = ${0.1 + R})`);

  realAndNaive("(c)", "45° into a wall slides along it, at 0.05 m and at 0.5 m per move", checkSlide);

  report("(d)", "inside corner from five angles settles with no jitter; slides round an outside L-corner");
  for (const deg of [45, 20, 70, 10, 80]) {
    const a = (deg * Math.PI) / 180;
    const delta = { x: -Math.cos(a) * 0.05, y: -Math.sin(a) * 0.05 }; // west and north into bedroom 1's corner at A
    const path = push(sampleC, real, { x: 1.5, y: 1.5 }, delta, 1000);
    const settled = path[path.length - 1];
    const more = push(sampleC, real, settled, delta, 20);
    const moved = more.reduce((s, q, i) => (i ? s + len(sub(q, more[i - 1])) : 0), 0);
    assert.ok(path.every((q) => clearance(sampleC, q) >= R - TOL.inside), `(d) ${deg}°: inside a solid`);
    assert.ok(len(sub(settled, { x: 0.1 + R, y: 0.1 + R })) < TOL.inside, `(d) ${deg}°: settled at ${JSON.stringify(settled)}`);
    assert.ok(moved < TOL.jitter, `(d) ${deg}°: moved ${moved} m over 20 more steps`);
    console.log(`  PASS ${deg}°: settles at (${settled.x.toFixed(4)}, ${settled.y.toFixed(4)}), ${(moved * 1000).toFixed(4)} mm over 20 more steps`);
  }
  const outside = push(sampleC, real, { x: -0.1 - R, y: 1 }, { x: 0.05 * Math.SQRT1_2, y: -0.05 * Math.SQRT1_2 }, 60);
  const worst = Math.min(...outside.slice(1).map((q, i) => len(sub(q, outside[i])) / 0.05));
  const last = outside[outside.length - 1];
  assert.ok(worst >= TOL.snag, `(d) outside corner: a step moved only ${(worst * 100).toFixed(1)}%`);
  assert.ok(last.x > 0.3 && last.y < -0.1 - R, `(d) outside corner: ended at ${JSON.stringify(last)}`);
  console.log(`  PASS outside corner at A: rounds it to (${last.x.toFixed(2)}, ${last.y.toFixed(2)}), slowest step ${(worst * 100).toFixed(1)}% of its length`);

  report("(e)", "every sample door: centre line passes; 0.05 m past the clear half-width never fits; a narrow door is solid");
  for (const o of sample.openings.filter((x) => x.kind === "door")) {
    const { w, centre, n, u } = openingFrame(sample, o);
    const through = walkTo(sampleC, real, add(centre, n, -1), add(centre, n, 1));
    assert.ok(len(sub(through[through.length - 1], add(centre, n, 1))) < 1e-9, `(e) ${o.id}: did not reach the far side`);
    const half = o.width / 2 - R; // how far off the centre line the camera's centre still fits
    assert.ok(clearance(sampleC, add(centre, u, half + 0.05)) < R, `(e) ${o.id}: a body 0.05 m past the clear half-width fits`);
    for (const sgn of [-1, 1]) {
      const off = add(centre, u, sgn * (half + 0.05));
      const path = walkTo(sampleC, real, add(off, n, -1), add(off, n, 1));
      const bad = path.find((q) => Math.abs(side(w, q)) < w.thickness / 2 && Math.abs((q.x - centre.x) * u.x + (q.y - centre.y) * u.y) > half + TOL.door);
      assert.ok(!bad, `(e) ${o.id}: a body ${(half + 0.05).toFixed(2)} m off centre stood in the doorway`);
      const blocked = Math.sign(side(w, path[path.length - 1])) === -1;
      console.log(`  PASS ${o.id} (${o.width} m), ${sgn < 0 ? "a" : "b"} side ${(half + 0.05).toFixed(2)} m off centre: ${blocked ? "blocked" : `nudged in to ≤ ${half.toFixed(2)} m by the jamb, then through`}`);
    }
  }
  const narrowWall = W([0, 0], [6, 0], 0.1);
  const narrow = D(narrowWall.id, 2, MIN_DOOR_WIDTH - 0.05);
  const justOk = D(narrowWall.id, 4.5, MIN_DOOR_WIDTH);
  const np = plan([narrowWall], [narrow, justOk]);
  const nc = buildCollision(np);
  assert.deepEqual(nc.narrowDoors, [narrow.id], "(e) narrowDoors");
  assert.ok(walkTo(nc, real, { x: 2, y: 1 }, { x: 2, y: -1 }).every((q) => q.y >= 0.05 + R - TOL.inside), "(e) narrow door let the camera through");
  assert.ok(len(sub(walkTo(nc, real, { x: 4.5, y: 1 }, { x: 4.5, y: -1 }).at(-1)!, { x: 4.5, y: -1 })) < 1e-9, `(e) a ${MIN_DOOR_WIDTH} m door blocked`);
  console.log(`  PASS a ${narrow.width} m door is solid and listed in narrowDoors; a ${MIN_DOOR_WIDTH} m door passes`);

  report("(f)", "windows block at every height, a floor-to-ceiling one included");
  for (const o of sample.openings.filter((x) => x.kind === "window")) {
    const { w, centre, n } = openingFrame(sample, o);
    const path = walkTo(sampleC, real, add(centre, n, -1), add(centre, n, 1));
    assert.ok(path.every((q) => side(w, q) <= -(w.thickness / 2 + R) + TOL.inside), `(f) ${o.id}: crossed`);
    assert.ok(clearance(sampleC, centre) < 0, `(f) ${o.id}: not solid`);
  }
  const tall = W([0, 0], [4, 0], 0.15, 2.7);
  const tc = buildCollision(plan([tall], [Wi(tall.id, 2, 1.5, 0, 2.7)]));
  assert.ok(walkTo(tc, real, { x: 2, y: 1 }, { x: 2, y: -1 }).every((q) => q.y >= 0.075 + R - TOL.inside), "(f) floor-to-ceiling window let the camera through");
  console.log("  PASS all 5 sample windows and a sill-0, wall-height window block");

  report("(g)", "three doors on one wall: each passes, the wall between them blocks");
  const g = W([0, 0], [10, 0], 0.15);
  const gc = buildCollision(plan([g], [D(g.id, 2), D(g.id, 5), D(g.id, 8)]));
  for (const x of [2, 5, 8]) assert.ok(len(sub(walkTo(gc, real, { x, y: 1 }, { x, y: -1 }).at(-1)!, { x, y: -1 })) < 1e-9, `(g) door at ${x} blocked`);
  for (const x of [3.5, 6.5]) assert.ok(walkTo(gc, real, { x, y: 1 }, { x, y: -1 }).every((q) => q.y >= 0.075 + R - TOL.inside), `(g) wall at ${x} let it through`);
  console.log("  PASS through at x 2, 5, 8; blocked at x 3.5, 6.5");

  realAndNaive("(h)", "pressing along split outer walls drifts under 1 mm at B and M; T stems leave no gap", checkSplits);
  realAndNaive("(i)", "one 10 m move does not tunnel through a 0.05 m wall", checkTunnel);

  report("(j)", "after a real store edit the rebuilt collision changes; undo restores it; item add and room rename do not rebuild");
  const s = () => usePlanStore.getState();
  s().loadPlan(structuredClone(samplePlan));
  const freeThenBlocked = { from: { x: 6.5, y: 6.5 }, to: { x: 7.5, y: 6.5 } }; // living → bath through d-bath
  const blockedThenFree = { from: { x: 7.5, y: 4.3 }, to: { x: 7.5, y: 5.3 } }; // living → across w-KM
  const reaches = (c: Collision, { from, to }: { from: Vec2; to: Vec2 }) => len(sub(walkTo(c, real, from, to).at(-1)!, to)) < 1e-9;
  const c0 = getCollision(s().plan);
  const builds0 = collisionStats.builds;
  const before = [reaches(c0, freeThenBlocked), reaches(c0, blockedThenFree)];
  assert.deepEqual(before, [true, false], "(j) before the edit");
  s().moveWallEndpoint("w-KM", "a", { x: 7, y: 6 }); // K moves 1 m south: w-KM slants, w-KL shortens, d-bath moves south with it
  const c1 = getCollision(s().plan);
  assert.equal(collisionStats.builds, builds0 + 1, "(j) the edit rebuilds");
  assert.deepEqual([reaches(c1, freeThenBlocked), reaches(c1, blockedThenFree)], [false, true], "(j) after the edit");
  s().undo();
  const c2 = getCollision(s().plan);
  assert.equal(collisionStats.builds, builds0 + 2, "(j) undo rebuilds");
  assert.deepEqual([reaches(c2, freeThenBlocked), reaches(c2, blockedThenFree)], before, "(j) undo restores");
  assert.deepEqual(c2.pieces, c0.pieces, "(j) undo restores the same solids");
  s().addItem({ catalogId: "chair", position: { x: 5, y: 0, z: 2 }, rotationY: 0, scale: 1, colorOverrides: {} });
  s().renameRoom(s().plan.rooms[0].id, "Renamed");
  s().renamePlan("Another name");
  assert.equal(getCollision(s().plan), c2, "(j) same collision object");
  assert.equal(collisionStats.builds, builds0 + 2, "(j) item add and renames did not rebuild");
  console.log(`  PASS builds: edit +1, undo +1, item add and two renames +0`);

  report("(k)", "property: 20,000 seeded random moves per plan never end inside a solid or outside the fence");
  for (const p of [sample, ...fixtures]) {
    const c = buildCollision(p);
    const rooms = deriveRooms(p);
    let seed = 20261001;
    const rand = () => {
      // mulberry32
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let q = startPose(p, c)!.position;
    const visited = new Set<string>();
    let minClear = Infinity;
    for (let k = 0; k < 20000; k++) {
      const a = rand() * 2 * Math.PI;
      const l = rand() * 1.5;
      q = moveWithCollision(c, q, { x: Math.cos(a) * l, y: Math.sin(a) * l });
      const cl = clearance(c, q);
      minClear = Math.min(minClear, cl);
      assert.ok(cl >= R - TOL.inside, `(k) ${p.name} move ${k}: clearance ${cl}`);
      const f = c.fence;
      assert.ok(q.x >= f.minX && q.x <= f.maxX && q.y >= f.minY && q.y <= f.maxY, `(k) ${p.name} move ${k}: outside the fence`);
      for (const r of rooms) if (pointInPolygon(q, r.polygon)) visited.add(r.name);
    }
    if (p === sample) assert.ok(visited.size >= 3, `(k) sample visited ${[...visited]}`);
    const f = c.fence;
    console.log(`  PASS ${p.name}: min clearance ${minClear.toFixed(4)} m, fence x ${f.minX.toFixed(2)}–${f.maxX.toFixed(2)}, y ${f.minY.toFixed(2)}–${f.maxY.toFixed(2)} (solids' box + 1 m), rooms visited ${visited.size}/${rooms.length}`);
  }

  report("(l)", "freePointNear after an edit puts a wall where the camera stood");
  s().loadPlan(structuredClone(samplePlan));
  const stood = { x: 6.7, y: 7.4 }; // free in the living room, 0.8 of the way along where w-KL will run, past d-bath
  assert.ok(clearance(getCollision(s().plan), stood) >= R, "(l) free before");
  s().moveWallEndpoint("w-KM", "a", { x: 5.5, y: 5 }); // w-KL now runs (5.5, 5) → (7, 8), through `stood`
  const cl = getCollision(s().plan);
  assert.ok(clearance(cl, stood) < 0, "(l) the wall now covers it");
  const free = freePointNear(cl, stood);
  assert.ok(free && clearance(cl, free) >= R && len(sub(free, stood)) <= 2, `(l) free point ${JSON.stringify(free)}`);
  assert.equal(freePointNear(cl, stood, 0.05), null, "(l) nothing free within 5 cm");
  console.log(`  PASS free point (${free!.x.toFixed(2)}, ${free!.y.toFixed(2)}), ${len(sub(free!, stood)).toFixed(2)} m away; null within 0.05 m`);

  report("timing", "build time, not asserted");
  const time = (p: Plan) => {
    const runs = 200;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) buildCollision(p);
    return (performance.now() - t0) / runs;
  };
  const big: Wall[] = [];
  const bigOpenings: Opening[] = [];
  for (let j = 0; j < 10; j++)
    for (let i = 0; i < 10; i++) {
      const h = W([i * 3, j * 3], [i * 3 + 3, j * 3], 0.15);
      const v = W([i * 3, j * 3], [i * 3, j * 3 + 3], 0.15);
      big.push(h, v);
      bigOpenings.push(D(h.id, 1.5), Wi(v.id, 1.5));
    }
  const bigC = buildCollision(plan(big, bigOpenings));
  console.log(`  sample plan (${sample.walls.length} walls → ${sampleC.count} solids): ${time(sample).toFixed(3)} ms`);
  console.log(`  synthetic ${big.length}-wall plan (${bigC.count} solids): ${time(plan(big, bigOpenings)).toFixed(3)} ms`);

  console.log("\nOK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
