/**
 * transform.ts — the pure rules for moving, lifting, turning and scaling an
 * imported 3D model or one of its parts with the 3D tools (step I.1b). No React,
 * no three.js, no stores: metres, plan space (x east, y south) and radians.
 *
 *   moveItemFloor  new plan (x, y) = start + (pointer now − pointer at the grab), on a
 *                  5 cm grid (1 cm with snapping off).
 *   liftItem       new height = start + t, 5 cm steps (1 cm free), held to 0–10 m
 *                  ("Can't go below the floor").
 *   rotateItem     turned by the pointer's angle change about the base point, in 15°
 *                  steps (0.1° free), wrapped to (−π, π]. The sign is the panel's
 *                  rotation field's: Item.rotationY, three's rotateY (pinned by a test).
 *   scaleItem      × (pointer distance now / at the grab) from the base point's
 *                  projection on screen, 1% steps (0.1% free), held to 1–10,000%;
 *                  refused under a 24 px grab ("Grab farther from the base point").
 * Every one returns { ok, value, reason }: ok is false only for a refusal; a clamp
 * is ok, with its reason. They take the fields they read (Pick<Item, …>), so the
 * store also runs them on a part, as a stand-in item at the part's pivot.
 *
 * Also: the pointer's angle on the floor, typed degrees and percentages, an item's
 * world point, and a world displacement turned back into the model's own frame
 * (parts are moved in the model frame, src/lib/import/model.ts).
 * Connects to: src/types/plan.ts; used by src/store/itemToolStore.ts; tested by
 * scripts/test-import-transform.ts.
 */
import type { Item, PartTransform, Vec2, Vec3 } from "@/types/plan";

export interface Result<T> {
  ok: boolean;
  value: T;
  reason: string | null;
}

export const MOVE_STEP_M = 0.05;
export const FREE_STEP_M = 0.01;
export const HEIGHT_RANGE: [number, number] = [0, 10];
export const ROTATE_STEP_DEG = 15;
export const FREE_STEP_DEG = 0.1;
/** Scale as a multiplier: 1% to 10,000%, as in the panel. */
export const SCALE_RANGE: [number, number] = [0.01, 100];
export const SCALE_MIN_GRAB_PX = 24;

export const BELOW_FLOOR = "Can't go below the floor";
export const ABOVE_TOP = "Height goes up to 10 m";
export const GRAB_FARTHER = "Grab farther from the base point";
export const SCALE_LIMIT = "Scale goes from 1% to 10,000%.";

/** True when a part's transform moves nothing (within 1e-9): it is dropped rather than stored. */
export const isIdentityTransform = (t: PartTransform) => t.t.every((v) => Math.abs(v) < 1e-9) && Math.abs(t.rotY) < 1e-9 && Math.abs(t.s - 1) < 1e-9;

/** Round to a step, without float dust (0.1 + 0.2 style) in what gets stored. */
const roundTo = (v: number, step: number) => Number((Math.round(v / step) * step).toFixed(6));
const ok = <T>(value: T, reason: string | null = null): Result<T> => ({ ok: true, value, reason });

/** An angle in (−π, π]. */
export function wrapAngle(a: number): number {
  const t = a % (2 * Math.PI);
  const w = t > Math.PI ? t - 2 * Math.PI : t <= -Math.PI ? t + 2 * Math.PI : t;
  return w === 0 ? 0 : w; // never -0
}

/**
 * The pointer's angle round `centre` on the floor, in plan coordinates (y south).
 * Measured so that a growing angle is the way a growing rotationY turns the model:
 * three's rotateY takes east towards north, so the angle is atan2(−dy, dx).
 */
export function pointerAngle(centre: Vec2, p: Vec2): number {
  return Math.atan2(-(p.y - centre.y), p.x - centre.x);
}

/** New plan (x, y) of the item's base point: where it started plus how far the pointer moved on the floor. */
export function moveItemFloor(item: Pick<Item, "position">, grab: Vec2, current: Vec2, opts: { snap: boolean }): Result<Vec2> {
  const step = opts.snap ? MOVE_STEP_M : FREE_STEP_M;
  return ok({ x: roundTo(item.position.x + current.x - grab.x, step), y: roundTo(item.position.z + current.y - grab.y, step) });
}

/** New height of the base point after lifting it by `t` metres (from the grab), held to the floor and 10 m. */
export function liftItem(item: Pick<Item, "position">, t: number, opts: { snap: boolean }): Result<number> {
  const h = roundTo(item.position.y + t, opts.snap ? MOVE_STEP_M : FREE_STEP_M);
  if (h < HEIGHT_RANGE[0]) return ok(HEIGHT_RANGE[0], BELOW_FLOOR);
  if (h > HEIGHT_RANGE[1]) return ok(HEIGHT_RANGE[1], ABOVE_TOP);
  return ok(h);
}

/**
 * New rotationY after the pointer turned from `startAngle` to `currentAngle` round the
 * base point (pointerAngle). The CHANGE is snapped (15° steps, or 0.1° with
 * `snapDeg: null`), so a model that starts at 7° goes to 22°, 37°…
 */
export function rotateItem(item: Pick<Item, "rotationY">, startAngle: number, currentAngle: number, opts: { snapDeg: number | null }): Result<number> {
  const step = ((opts.snapDeg ?? FREE_STEP_DEG) * Math.PI) / 180;
  const delta = Math.round(wrapAngle(currentAngle - startAngle) / step) * step;
  return ok(wrapAngle(item.rotationY + delta));
}

/** A rotation change in degrees, for the label: (−180, 180], 0.1°. */
export const turnDegrees = (from: number, to: number) => Math.round(((wrapAngle(to - from) * 180) / Math.PI) * 10) / 10 || 0;

/** Clamp and round a scale multiplier: 1% steps with snapping, 0.1% without. */
function clampScale(raw: number, snap: boolean): Result<number> {
  const k = Math.min(SCALE_RANGE[1], Math.max(SCALE_RANGE[0], raw));
  return ok(roundTo(k, snap ? 0.01 : 0.001), k !== raw ? SCALE_LIMIT : null);
}

/**
 * New scale after the pointer moved from `grabPx` to `currentPx` screen pixels away from
 * the base point's projection: the scale grows by their ratio. A grab under 24 px is
 * refused (the ratio would swing wildly), with the item's scale unchanged.
 */
export function scaleItem(item: Pick<Item, "scale">, grabPx: number, currentPx: number, opts: { snap: boolean }): Result<number> {
  if (!(grabPx >= SCALE_MIN_GRAB_PX)) return { ok: false, value: item.scale, reason: GRAB_FARTHER };
  return clampScale((item.scale * currentPx) / grabPx, opts.snap);
}

/** A typed scale set exactly: "150" or "150%" → 1.5 (held to 1–10,000%, rounded to 0.1% like the panel). */
export function scaleToPercent(percent: number): Result<number> {
  return clampScale(percent / 100, false);
}

const NUMBER = String.raw`[+\-−]?(?:\d+(?:[.,]\d*)?|[.,]\d+)`;
const num = (s: string) => Number(s.replace("−", "-").replace(",", "."));

/** "30", "-45", "30°", "30 deg" → degrees; null when it isn't an angle. */
export function parseDegrees(text: string): number | null {
  const m = new RegExp(`^\\s*(${NUMBER})\\s*(?:°|deg)?\\s*$`, "i").exec(text);
  return m ? num(m[1]) : null;
}

/** "150" or "150%" → 150; null when it isn't a positive percentage. */
export function parsePercent(text: string): number | null {
  const m = new RegExp(`^\\s*(${NUMBER})\\s*%?\\s*$`).exec(text);
  const v = m ? num(m[1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * A point given in item-local metres (base point at the origin, Y up, before the
 * item's turn and scale) in world space: scaled, turned by rotationY (three's rotateY
 * maps (x, z) to (x cos θ + z sin θ, −x sin θ + z cos θ)) and moved to the base point.
 */
export function itemPoint(item: Pick<Item, "position" | "rotationY" | "scale">, local: Vec3): Vec3 {
  const [c, s, k] = [Math.cos(item.rotationY), Math.sin(item.rotationY), item.scale];
  return { x: item.position.x + k * (local.x * c + local.z * s), y: item.position.y + k * local.y, z: item.position.z + k * (-local.x * s + local.z * c) };
}

/** A world displacement in the item's own (model) frame: turned back by rotationY and divided by the scale. */
export function worldToModelDelta(item: Pick<Item, "rotationY" | "scale">, d: Vec3): Vec3 {
  const [c, s, k] = [Math.cos(item.rotationY), Math.sin(item.rotationY), item.scale];
  return { x: (d.x * c - d.z * s) / k, y: d.y / k, z: (d.x * s + d.z * c) / k };
}
