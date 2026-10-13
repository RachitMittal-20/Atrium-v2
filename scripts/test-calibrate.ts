/**
 * test-calibrate.ts — step M.2b, recalibrating the plan's scale: the pure rules
 * (src/lib/plan/calibrate.ts) and the store action (planStore.calibratePlan).
 *
 *   - the factor of two clicked points: 4.1 m measured where 4.00 m was drawn is 1.025;
 *   - scaling by f then 1/f returns every coordinate within 1e-9 (walls, openings,
 *     takeoff points and cutouts, imported items);
 *   - room net areas scale by f² within 1e-9 relative;
 *   - wall heights, opening sills and heights, an imported model's own size, its height
 *     and its rotation, and typed references, overrides and notes are untouched;
 *   - takeoff points scale, and a takeoff that was current stays current (its hash is
 *     re-stamped against the scaled walls); one that was already stale stays stale;
 *   - refusals with their reasons: points under 0.1 m apart, a distance of 0, a factor
 *     under 0.1 and over 10, and a scaled plan whose opening no longer fits its wall
 *     (the store refuses and changes nothing, not even history);
 *   - the store: one undo step, undo restores every coordinate and redo puts the new ones
 *     back; `plan.calibrations` records the factor and the note; provenance and the
 *     "Edited" marks are untouched;
 *   - an old plan (no `calibrations`, no takeoff `source`) loads unchanged (test-persist.ts
 *     has the round trips).
 * Run: npx tsx scripts/test-calibrate.ts
 */
import assert from "node:assert/strict";
import { samplePlan } from "../src/data/samplePlan";
import { calibrateFactor, calibrationProblem, factorPercent, FACTOR_RANGE, MIN_SPAN, planExtent, scalePlan } from "../src/lib/plan/calibrate";
import { withSwingSides } from "../src/lib/plan/edit";
import { wallLength } from "../src/lib/plan/geometry";
import { deriveRooms, toStoredRoom } from "../src/lib/plan/rooms";
import { validatePlan } from "../src/lib/plan/validate";
import { wallsHash } from "../src/lib/takeoff/rows";
import { usePlanStore } from "../src/store/planStore";
import type { Item, Plan, Takeoff } from "../src/types/plan";

const near = (a: number, b: number, eps: number, msg: string) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (allowed ${eps})`);

/** The sample plan with its rooms derived, a takeoff, a cutout and an imported model. */
function basePlan(): Plan {
  const walls = samplePlan.walls.map((w) => ({ ...w, a: { ...w.a }, b: { ...w.b }, provenance: "vector" as const }));
  const plan: Plan = { ...samplePlan, walls, openings: withSwingSides(samplePlan.openings.map((o) => ({ ...o }))) };
  const rooms = deriveRooms(plan).map(toStoredRoom);
  const item: Item = { id: "i-1", catalogId: "import:abcdef0123456789", position: { x: 2, y: 0.5, z: 3 }, rotationY: 0.4, scale: 1.5, colorOverrides: {}, import: { assetId: "abcdef0123456789", name: "chair.glb", format: "glb", unitToMetres: 1, upAxis: "y", doubleSided: false, nodeOverrides: {} } };
  const area: Takeoff = {
    id: "t-area",
    name: "Area 1",
    kind: "area",
    points: [[0.1, 0.1], [3.9, 0.1], [3.9, 3.9], [0.1, 3.9]],
    cutouts: [[[1, 1], [2, 1], [2, 2], [1, 2]]],
    reference: { value: 13.44, note: "from the lease" },
    override: { value: 13.5, note: "agreed" },
    wallsHash: wallsHash(walls),
  };
  const len: Takeoff = { id: "t-len", name: "Length 1", kind: "length", points: [[0, 0], [4, 0]], reference: { value: 4 }, wallsHash: "stale-already" };
  return { ...plan, rooms, items: [item], takeoffs: [area, len] };
}

/** Every coordinate of a plan, flattened, in a fixed order. */
const coords = (p: Plan): number[] => [
  ...p.walls.flatMap((w) => [w.a.x, w.a.y, w.b.x, w.b.y, w.thickness]),
  ...p.openings.flatMap((o) => [o.offset, o.width]),
  ...(p.takeoffs ?? []).flatMap((t) => [...t.points.flat(), ...(t.cutouts ?? []).flat().flat()]),
  ...p.items.flatMap((i) => [i.position.x, i.position.z]),
];

function main() {
  const plan = basePlan();

  // ---------------------------------------------------------------- the factor
  {
    // Two clicked points 4 m apart on the drawing; the tape says 4.10 m. 4.1 / 4 = 1.025 exactly.
    const f = calibrateFactor({ x: 0, y: 0 }, { x: 4, y: 0 }, 4.1);
    assert.ok(f.ok);
    near(f.value, 1.025, 1e-12, "4.10 m over a 4 m span");
    // A diagonal: |(3, 4)| = 5, true 5.5 → 1.1 exactly.
    const g = calibrateFactor({ x: 1, y: 1 }, { x: 4, y: 5 }, 5.5);
    assert.ok(g.ok && Math.abs(g.value - 1.1) < 1e-12, "a diagonal span");
    assert.equal(factorPercent(1.025), "+2.50%");
    assert.equal(factorPercent(0.99), "−1.00%");

    // Refusals, each with its reason.
    const close = calibrateFactor({ x: 0, y: 0 }, { x: 0.09, y: 0 }, 1);
    assert.equal(close.ok, false);
    assert.match(close.reason!, /at least 0.10 m apart/, "points under 0.1 m apart are refused");
    assert.equal(calibrateFactor({ x: 0, y: 0 }, { x: 4, y: 0 }, 0).ok, false, "a distance of 0");
    assert.equal(calibrateFactor({ x: 0, y: 0 }, { x: 4, y: 0 }, -2).ok, false, "a negative distance");
    assert.match(calibrateFactor({ x: 0, y: 0 }, { x: 4, y: 0 }, 0).reason!, /true distance/, "and says to type one");
    const small = calibrateFactor({ x: 0, y: 0 }, { x: 4, y: 0 }, 0.39); // 0.0975 < 0.1
    assert.equal(small.ok, false);
    assert.match(small.reason!, /0\.1× to 10×/, `a factor under ${FACTOR_RANGE[0]} is refused`);
    const big = calibrateFactor({ x: 0, y: 0 }, { x: 4, y: 0 }, 41); // 10.25 > 10
    assert.equal(big.ok, false);
    assert.match(big.reason!, /10\.25×/, `a factor over ${FACTOR_RANGE[1]} is refused, with the number`);
    // Exactly MIN_SPAN apart is allowed.
    assert.ok(calibrateFactor({ x: 0, y: 0 }, { x: MIN_SPAN, y: 0 }, 0.1).ok, "0.1 m apart is enough");
    console.log("factor: 4.10 m over 4 m = 1.025, a diagonal 5 → 5.5 = 1.1; too close, 0, negative, under 0.1× and over 10× refused with reasons");
  }

  // ---------------------------------------------------------------- scale and unscale
  {
    const f = 1.025;
    const once = scalePlan(plan, f);
    const back = scalePlan(once, 1 / f);
    const [a, b] = [coords(plan), coords(back)];
    assert.equal(a.length, b.length);
    let worst = 0;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
    assert.ok(worst <= 1e-9, `scaling by f then 1/f returns every coordinate (worst ${worst})`);
    assert.equal(validatePlan(once).length, 0, "the scaled plan is still valid");

    // Rooms: net areas by f² (relative, so it holds for every size).
    const was = deriveRooms(plan);
    const now = deriveRooms(once);
    assert.equal(now.length, was.length, "the same rooms derive");
    for (const r of was) {
      const s = now.find((x) => x.id === r.id)!;
      near(s.area / (r.area * f * f), 1, 1e-9, `${r.name} net area × f²`);
    }
    // 10.2 × 8.2 m becomes 10.455 × 8.405 m.
    const e0 = planExtent(plan);
    const e1 = planExtent(once);
    near(e1.width, e0.width * f, 1e-9, "the plan's width");
    near(e1.depth, e0.depth * f, 1e-9, "its depth");
    console.log(`scale: f=${f} then 1/f returns every coordinate (worst ${worst.toExponential(1)}); ${was.length} room areas × f²; extent ${e0.width.toFixed(2)} × ${e0.depth.toFixed(2)} → ${e1.width.toFixed(3)} × ${e1.depth.toFixed(3)} m`);

    // ---- what must NOT scale
    for (const w of plan.walls) near(once.walls.find((x) => x.id === w.id)!.height, w.height, 0, `wall ${w.id} height`);
    for (const o of plan.openings) {
      const s = once.openings.find((x) => x.id === o.id)!;
      assert.equal(s.height, o.height, `opening ${o.id} height`);
      assert.equal(s.sillHeight, o.sillHeight, `opening ${o.id} sill`);
      assert.equal(s.swing, o.swing, `opening ${o.id} swing`);
    }
    const it = once.items[0];
    assert.equal(it.scale, plan.items[0].scale, "an imported model's own size");
    assert.equal(it.rotationY, plan.items[0].rotationY, "and its rotation");
    assert.equal(it.position.y, plan.items[0].position.y, "and its height above the floor");
    near(it.position.x, plan.items[0].position.x * f, 1e-12, "but where it stands moves");
    near(it.position.z, plan.items[0].position.z * f, 1e-12, "in both plan axes");
    const sa = once.takeoffs!.find((t) => t.id === "t-area")!;
    assert.deepEqual(sa.reference, plan.takeoffs![0].reference, "a typed reference and its note are untouched");
    assert.deepEqual(sa.override, plan.takeoffs![0].override, "and so is an override");
    near(sa.points[1][0], 3.9 * f, 1e-12, "the takeoff's points scale");
    near(sa.cutouts![0][2][1], 2 * f, 1e-12, "and its cutout's");
    // Provenance stays, and so does the absence of "Edited".
    assert.ok(once.walls.every((w) => w.provenance === "vector" && w.edited === undefined), "provenance kept, nothing marked Edited");
    console.log("unchanged: wall heights, opening heights, sills and swings, a model's size, rotation and height, references, overrides; provenance kept");

    // ---- the stale hash: current stays current, stale stays stale
    assert.equal(sa.wallsHash, wallsHash(once.walls), "a takeoff that was current is re-stamped against the scaled walls");
    assert.equal(once.takeoffs!.find((t) => t.id === "t-len")!.wallsHash, "stale-already", "one already stale stays stale");
    console.log("takeoffs: points and cutouts scale; a current one stays current (hash re-stamped), an already stale one stays stale");
  }

  // ---------------------------------------------------------------- refusals on the result
  {
    assert.equal(calibrationProblem(scalePlan(plan, 1.025)), null, "a small change is fine");
    // Shrinking hard: a 0.9 m door no longer fits inside its wall's usable span.
    const tight = calibrationProblem(scalePlan(plan, 0.2));
    assert.ok(tight, "a 5× shrink is refused");
    assert.match(tight, /wouldn't fit its wall|under the/, `with the reason: ${tight}`);
    // A wall under the 0.2 m minimum.
    const stub: Plan = { ...plan, walls: [{ id: "w1", a: { x: 0, y: 0 }, b: { x: 0.5, y: 0 }, thickness: 0.1, height: 2.7 }, { id: "w2", a: { x: 0.5, y: 0 }, b: { x: 0.5, y: 2 }, thickness: 0.1, height: 2.7 }], openings: [], rooms: [], takeoffs: [], items: [] };
    const short = calibrationProblem(scalePlan(stub, 0.3)); // 0.5 → 0.15 m
    assert.ok(short && /under the 0.20 m minimum/.test(short), `a wall under the minimum is refused: ${short}`);
    console.log(`refused on the result: ${tight} / ${short}`);
  }

  // ---------------------------------------------------------------- the store
  {
    const store = usePlanStore.getState();
    store.loadPlan(plan);
    const before = coords(usePlanStore.getState().plan);
    const steps = usePlanStore.getState().past.length;
    assert.equal(steps, 0, "loadPlan starts a fresh history");

    const f = 1.02;
    assert.equal(store.calibratePlan(f, "tape measure, hall"), null, "the store applies it");
    const after = usePlanStore.getState();
    assert.equal(after.past.length, steps + 1, "one undo step");
    assert.deepEqual(after.plan.calibrations, [{ factor: f, note: "tape measure, hall" }], "recorded with its note");
    const now = coords(after.plan);
    for (let i = 0; i < before.length; i++) near(now[i], before[i] * f, 1e-9, `coordinate ${i} scaled`);
    assert.equal(after.plan.rooms.length, plan.rooms.length, "the rooms came through");
    assert.deepEqual(after.plan.rooms.map((r) => r.name), plan.rooms.map((r) => r.name), "with their names");
    assert.ok(after.plan.walls.every((w) => w.provenance === "vector" && w.edited === undefined), "and nothing is marked Edited");

    usePlanStore.getState().undo();
    assert.deepEqual(coords(usePlanStore.getState().plan), before, "undo restores every coordinate");
    assert.equal(usePlanStore.getState().plan.calibrations, undefined, "and the record goes with it");
    assert.equal(usePlanStore.getState().past.length, steps, "one step consumed");
    usePlanStore.getState().redo();
    const again = coords(usePlanStore.getState().plan);
    for (let i = 0; i < before.length; i++) near(again[i], before[i] * f, 1e-9, `redo puts coordinate ${i} back`);
    assert.equal(usePlanStore.getState().plan.calibrations?.length, 1, "and the record");

    // A refusal changes nothing, not even history.
    const held = coords(usePlanStore.getState().plan);
    const history = usePlanStore.getState().past.length;
    const reason = usePlanStore.getState().calibratePlan(0.2);
    assert.ok(reason, `refused: ${reason}`);
    assert.deepEqual(coords(usePlanStore.getState().plan), held, "the plan is untouched");
    assert.equal(usePlanStore.getState().past.length, history, "and history");
    console.log(`store: one undo step, undo and redo exact, calibrations recorded; a refusal changes nothing ("${reason!.slice(0, 60)}…")`);

    // An old plan (no calibrations, no takeoff source) loads unchanged.
    const old: Plan = { ...samplePlan, openings: withSwingSides(samplePlan.openings), rooms: [] };
    usePlanStore.getState().loadPlan(old);
    const loaded = usePlanStore.getState().plan;
    assert.equal(loaded.calibrations, undefined, "an old plan has no calibrations");
    assert.equal(loaded.takeoffs, undefined, "and no takeoffs");
    assert.deepEqual(loaded.walls.map((w) => wallLength(w).toFixed(6)), samplePlan.walls.map((w) => wallLength(w).toFixed(6)), "and every wall is the length it was");
    console.log("old plan: no calibrations, no takeoffs, walls unchanged");
  }

  console.log("OK");
}

main();
