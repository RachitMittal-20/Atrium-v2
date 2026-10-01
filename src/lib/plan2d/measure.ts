/**
 * measure.ts — pure maths for the 2D Measure tool (no React, no store). A
 * `Measurement` is two points in plan metres, the same space as the Plan, so the
 * 2D camera (view.ts) maps it to the screen at any zoom and pan. It is editor
 * overlay state only: it is never written into the Plan or into undo history.
 * Connects to: src/store/toolStore.ts (holds it), src/components/plan2d/PlanCanvas.tsx
 * (draws it), scripts/test-measure.ts.
 */
import type { Vec2, Wall } from "@/types/plan";

/** First point placed, second not yet (`b` null), or both placed. */
export interface Measurement {
  a: Vec2;
  b: Vec2 | null;
}

/** A second point closer than this to the first is ignored: a double tap, not a measurement. */
export const MIN_MEASURE_M = 0.005;

/** Snap and pick radii in screen pixels; fingers get the larger ones. */
export const MEASURE_SNAP_PX = 12;
export const MEASURE_SNAP_TOUCH_PX = 24;
export const MEASURE_HIT_PX = 14;
export const MEASURE_HIT_TOUCH_PX = 28;
/** Snapping never reaches further than this in metres, however far the view is zoomed out. */
const SNAP_MAX_M = 0.5;
const SNAP_MAX_TOUCH_M = 0.75;

export const measureDistance = (a: Vec2, b: Vec2) => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * A distance in metres as text: centimetres up to 100 m, then decimetres. The
 * measurement is always shown in metres, whatever unit the area panel uses.
 */
export function formatMeasure(metres: number): string {
  if (!Number.isFinite(metres)) return "–";
  return `${metres.toFixed(Math.abs(metres) < 100 ? 2 : 1)} m`;
}

/**
 * The next measurement after a click or tap at `p`. First tap: a start point.
 * Second tap: the end point (ignored when it is on top of the first). A tap on a
 * finished measurement starts a new one, so the old one is replaced.
 */
export function placeMeasurePoint(m: Measurement | null, p: Vec2): Measurement {
  if (!m || m.b) return { a: p, b: null };
  if (measureDistance(m.a, p) < MIN_MEASURE_M) return m;
  return { a: m.a, b: p };
}

/** Move one placed point (dragging its marker). A move onto the other point is ignored. */
export function moveMeasurePoint(m: Measurement, which: "a" | "b", p: Vec2): Measurement {
  const other = which === "a" ? m.b : m.a;
  if (which === "b" && !m.b) return m; // nothing to move yet
  if (other && measureDistance(other, p) < MIN_MEASURE_M) return m;
  return which === "a" ? { a: p, b: m.b } : { a: m.a, b: p };
}

/** Which placed point lies within `tol` metres of `p`, the nearer when both do. */
export function pickMeasurePoint(m: Measurement, p: Vec2, tol: number): "a" | "b" | null {
  const da = measureDistance(m.a, p);
  const db = m.b ? measureDistance(m.b, p) : Infinity;
  if (Math.min(da, db) > tol) return null;
  return da <= db ? "a" : "b";
}

/** The snap radius in metres for a screen tolerance; capped so zoomed-out plans don't jump across rooms. */
export const measureSnapRadius = (scale: number, touch: boolean) =>
  Math.min(touch ? SNAP_MAX_TOUCH_M : SNAP_MAX_M, (touch ? MEASURE_SNAP_TOUCH_PX : MEASURE_SNAP_PX) / scale);

/**
 * Where a measure click lands: on the nearest wall end within `radius`, else the
 * nearest wall midpoint, else exactly where it was clicked. No grid: unlike
 * drawing, a measurement should report the real distance between the points.
 * `free` (Alt) turns snapping off.
 */
export function snapMeasurePoint(p: Vec2, walls: Pick<Wall, "a" | "b">[], radius: number, free = false): Vec2 {
  if (free) return p;
  const nearest = (pts: Vec2[]): Vec2 | null => {
    let best: Vec2 | null = null;
    for (const c of pts) if (measureDistance(p, c) <= radius && (!best || measureDistance(p, c) < measureDistance(p, best))) best = c;
    return best;
  };
  const end = nearest(walls.flatMap((w) => [w.a, w.b]));
  if (end) return { x: end.x, y: end.y };
  const mid = nearest(walls.map((w) => ({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 })));
  return mid ?? p;
}
