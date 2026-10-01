/**
 * test-measure.ts — asserts for the Measure tool: the pure maths in
 * src/lib/plan2d/measure.ts (distance, formatting, the two-point state machine,
 * snapping, marker picking) and the tool store in src/store/toolStore.ts
 * (cancel, leaving the tool, Escape) — above all that measuring never touches
 * the Plan or its undo history.
 * Run: npx tsx scripts/test-measure.ts (throws on the first failure).
 */
import assert from "node:assert/strict";
import { samplePlan } from "../src/data/samplePlan";
import {
  formatMeasure,
  measureDistance,
  measureSnapRadius,
  moveMeasurePoint,
  pickMeasurePoint,
  placeMeasurePoint,
  snapMeasurePoint,
  type Measurement,
} from "../src/lib/plan2d/measure";
import { fitView, screenToWorld, worldToScreen } from "../src/lib/plan2d/view";
import { usePlanStore } from "../src/store/planStore";
import { useSelectionStore } from "../src/store/selectionStore";
import { installToolShortcuts, useToolStore } from "../src/store/toolStore";

const close = (a: number, b: number, eps: number, msg: string) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

// --- distance: horizontal, vertical, diagonal, arbitrary angle, and symmetric
close(measureDistance({ x: 1, y: 2 }, { x: 5, y: 2 }), 4, 1e-12, "horizontal");
close(measureDistance({ x: 3, y: 1 }, { x: 3, y: -2 }), 3, 1e-12, "vertical");
close(measureDistance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5, 1e-12, "3-4-5 diagonal");
close(measureDistance({ x: 5.5, y: 1.5 }, { x: 8.5, y: 3.5 }), Math.sqrt(13), 1e-12, "arbitrary angle");
close(measureDistance({ x: 2, y: 9 }, { x: -1, y: 5 }), measureDistance({ x: -1, y: 5 }, { x: 2, y: 9 }), 1e-12, "symmetric");

// --- the distance is a world distance: unchanged however the camera zooms and pans
{
  const a = { x: 5.5, y: 1.5 };
  const b = { x: 9.5, y: 1.5 };
  const base = fitView({ x0: 0, y0: 0, x1: 10, y1: 8 }, { width: 1000, height: 700 });
  for (const v of [base, { scale: base.scale * 3.7, tx: base.tx - 410, ty: base.ty + 77 }, { scale: 8, tx: -40, ty: 12 }]) {
    const [sa, sb] = [worldToScreen(v, a), worldToScreen(v, b)];
    close(measureDistance(screenToWorld(v, sa), screenToWorld(v, sb)), 4, 1e-9, `distance at scale ${v.scale}`);
    close(Math.hypot(sb.x - sa.x, sb.y - sa.y) / v.scale, 4, 1e-9, `pixels / scale at ${v.scale}`);
  }
}

// --- formatting: centimetres, then decimetres from 100 m, always metres
assert.equal(formatMeasure(4), "4.00 m");
assert.equal(formatMeasure(3.60555), "3.61 m");
assert.equal(formatMeasure(0.049), "0.05 m");
assert.equal(formatMeasure(99.994), "99.99 m");
assert.equal(formatMeasure(123.456), "123.5 m");
assert.equal(formatMeasure(NaN), "–");

// --- the two-point state machine
{
  const p1 = { x: 1, y: 1 };
  const p2 = { x: 5, y: 1 };
  const p3 = { x: 2, y: 6 };
  let m: Measurement | null = placeMeasurePoint(null, p1);
  assert.deepEqual(m, { a: p1, b: null }, "first tap places a");
  assert.equal(placeMeasurePoint(m, { x: 1.001, y: 1 }), m, "a second tap on top of the first is ignored");
  m = placeMeasurePoint(m, p2);
  assert.deepEqual(m, { a: p1, b: p2 }, "second tap places b");
  m = placeMeasurePoint(m, p3);
  assert.deepEqual(m, { a: p3, b: null }, "a tap on a finished measurement starts a new one, replacing it");

  // markers can be picked (nearer wins) and dragged
  const done: Measurement = { a: p1, b: p2 };
  assert.equal(pickMeasurePoint(done, { x: 1.1, y: 1 }, 0.3), "a");
  assert.equal(pickMeasurePoint(done, { x: 4.9, y: 1.1 }, 0.3), "b");
  assert.equal(pickMeasurePoint(done, { x: 3, y: 3 }, 0.3), null);
  assert.equal(pickMeasurePoint({ a: p1, b: null }, { x: 5, y: 1 }, 0.3), null, "no b to pick yet");
  assert.deepEqual(moveMeasurePoint(done, "b", { x: 7, y: 4 }), { a: p1, b: { x: 7, y: 4 } });
  assert.equal(moveMeasurePoint(done, "b", p1), done, "dragging b onto a is ignored");
  assert.deepEqual(moveMeasurePoint({ a: p1, b: null }, "b", p3), { a: p1, b: null }, "no b to move yet");
}

// --- snapping: wall end, then wall middle, else exactly where it was clicked; Alt = free
{
  const walls = samplePlan.walls;
  assert.deepEqual(snapMeasurePoint({ x: 0.08, y: -0.05 }, walls, 0.2), { x: 0, y: 0 }, "snaps to corner A");
  assert.deepEqual(snapMeasurePoint({ x: 7.05, y: 0.1 }, walls, 0.2), { x: 7, y: 0 }, "snaps to the middle of w-BC");
  assert.deepEqual(snapMeasurePoint({ x: 5.537, y: 1.481 }, walls, 0.2), { x: 5.537, y: 1.481 }, "open floor stays exact: no grid");
  assert.deepEqual(snapMeasurePoint({ x: 0.08, y: -0.05 }, walls, 0.2, true), { x: 0.08, y: -0.05 }, "free turns snapping off");
  // a finger gets a wider radius than a mouse, and neither runs away when zoomed far out
  assert.ok(measureSnapRadius(60, true) > measureSnapRadius(60, false));
  assert.ok(measureSnapRadius(5, false) <= 0.5 && measureSnapRadius(5, true) <= 0.75);
}

// --- the tool store: a measurement is overlay state and never touches the plan
const tool = () => useToolStore.getState();
const plan = () => usePlanStore.getState();
plan().loadPlan(structuredClone(samplePlan));
tool().setTool("select");

{
  const planBefore = plan().plan;
  const jsonBefore = JSON.stringify(planBefore);
  const pastBefore = plan().past.length;
  let planNotices = 0;
  const unsubscribe = usePlanStore.subscribe(() => planNotices++);

  tool().placeMeasurePoint({ x: 1, y: 1 });
  assert.equal(tool().measurement, null, "points are ignored unless the Measure tool is active");

  useSelectionStore.getState().select("w-AB");
  tool().setTool("measure");
  assert.equal(useSelectionStore.getState().selectedId, null, "entering Measure clears the wall selection");
  tool().placeMeasurePoint({ x: 5.5, y: 1.5 });
  tool().placeMeasurePoint({ x: 9.5, y: 1.5 });
  const m = tool().measurement!;
  close(measureDistance(m.a, m.b!), 4, 1e-12, "the stored measurement is 4 m");
  tool().moveMeasurePoint("b", { x: 8.5, y: 3.5 });
  close(measureDistance(tool().measurement!.a, tool().measurement!.b!), Math.sqrt(13), 1e-12, "dragging a marker updates it");

  // starting a new measurement replaces the old one
  tool().placeMeasurePoint({ x: 2, y: 2 });
  assert.deepEqual(tool().measurement, { a: { x: 2, y: 2 }, b: null }, "a new measurement replaces the old");
  tool().placeMeasurePoint({ x: 2, y: 5 });

  // cancel
  tool().cancelMeasure();
  assert.equal(tool().measurement, null, "cancel clears the measurement");
  assert.equal(tool().tool, "measure", "and the tool stays active");

  // leaving the tool clears it
  tool().placeMeasurePoint({ x: 1, y: 1 });
  tool().placeMeasurePoint({ x: 3, y: 1 });
  tool().setTool("select");
  assert.equal(tool().measurement, null, "switching away from Measure clears the measurement");

  unsubscribe();
  assert.equal(planNotices, 0, "the plan store was never notified");
  assert.equal(plan().plan, planBefore, "Plan object is the very same reference");
  assert.equal(JSON.stringify(plan().plan), jsonBefore, "and its content is unchanged");
  assert.equal(plan().past.length, pastBefore, "undo history has no new entry");
  assert.equal(plan().future.length, 0, "and no redo entry");
}

// --- Escape cancels (capture-phase window listener), but only when there is something to cancel
{
  const target = new EventTarget();
  (globalThis as unknown as { window: EventTarget }).window = target;
  const stop = installToolShortcuts();
  const press = (key: string) => {
    const e = Object.assign(new Event("keydown", { cancelable: true }), { key });
    target.dispatchEvent(e);
    return e;
  };
  tool().setTool("measure");
  tool().placeMeasurePoint({ x: 1, y: 1 });
  press("Enter");
  assert.ok(tool().measurement, "other keys leave it alone");
  press("Escape");
  assert.equal(tool().measurement, null, "Escape cancels the measurement");
  assert.equal(tool().tool, "measure", "Escape does not leave the tool");
  stop();
  tool().placeMeasurePoint({ x: 1, y: 1 });
  press("Escape");
  assert.ok(tool().measurement, "after cleanup the shortcut is gone");
  tool().setTool("select");
  delete (globalThis as { window?: unknown }).window;
}

console.log("OK");
