/**
 * calibrate.ts — recalibrating the plan's scale (step M.2b). Pure, in plan metres, no React.
 *
 * The user clicks two points they know the true distance between and types it. The factor is
 * `trueDistance / |p1 − p2|`, and every PLAN-SPACE length is multiplied by it ABOUT AN ORIGIN
 * (the plan's own (0, 0) by default), so the drawing keeps its shape and nothing rotates:
 *   scaled   wall endpoints and thickness; opening offsets and widths; takeoff points and
 *            cutouts; imported items' plan positions (x and z of Item.position); and the imported
 *            drawing's mapping (step M.2c, Plan.background), scaled about the same origin, so the
 *            drawing stays under the walls it described instead of drifting by the factor.
 *   NOT      wall heights, opening sills and heights, an imported model's own size (Item.scale)
 *            and rotation, item heights (Item.position.y), typed references, overrides and notes:
 *            a scale read off the drawing says nothing about them.
 * A wall's `provenance` and its `edited` mark are left alone too (planStore.calibratePlan asks
 * edit() to keep the marks): a uniform rescale of the whole plan is not an edit of one wall's
 * shape against the drawing. The disagreement shows up instead as a Flagged row in the From PDF
 * takeoffs, which is the point.
 *
 * Refusals, so a calibration never leaves a plan the editor can't hold: `calibrateFactor` says
 * no to points under 0.1 m apart, a distance that isn't positive, and a factor outside 0.1–10;
 * `calibrationProblem` says no when the SCALED plan fails validatePlan, puts an opening outside
 * its wall's usable span, or makes a wall shorter than MIN_WALL_LENGTH. The store checks before
 * it writes, so a refusal changes nothing.
 *
 * A takeoff that was current before stays current: its `wallsHash` is re-stamped against the
 * scaled walls (a stale one stays stale, since its stored hash was already another plan's).
 *
 * `rescaledText` is the "Rescaled x1.0234" the panels add to "Read from PDF", "Traced,
 * approximate", "PDF exact" and the From PDF group once the plan has been recalibrated (step M.2c).
 *
 * Connects to: src/lib/plan/{edit,geometry,validate}.ts, src/lib/takeoff/rows.ts (the hash),
 * src/lib/background/mapping.ts;
 * used by src/store/planStore.ts (calibratePlan) and src/store/calibrateStore.ts; tested by
 * scripts/test-calibrate.ts.
 */
import { scaleAbout } from "@/lib/background/mapping";
import { lenText } from "@/lib/units/current";
import { wallsHash } from "@/lib/takeoff/rows";
import type { Calibration, Plan, Takeoff, Vec2 } from "@/types/plan";
import { MIN_WALL_LENGTH, openingProblem, type FaceEdit } from "./edit";
import { wallLength } from "./geometry";
import { validatePlan } from "./validate";

/** Two calibration points closer than this can't say anything about the scale. */
export const MIN_SPAN = 0.1;
/** A factor outside this is a mis-click, not a calibration. */
export const FACTOR_RANGE = [0.1, 10] as const;
/** Beyond this, the dialog warns: it is probably the wrong two points. */
export const SAFE_RANGE = [0.8, 1.25] as const;

const ORIGIN: Vec2 = { x: 0, y: 0 };

/**
 * The factor that makes the distance between `p1` and `p2` equal `trueDistance`, or a refusal
 * with its reason (never ok with a value the store would then have to re-check).
 */
export function calibrateFactor(p1: Vec2, p2: Vec2, trueDistance: number): FaceEdit<number> {
  const span = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  if (!(span >= MIN_SPAN)) return { ok: false, value: null, reason: `Pick two points at least ${lenText(MIN_SPAN, 2)} apart.` };
  if (!Number.isFinite(trueDistance) || trueDistance <= 0) return { ok: false, value: null, reason: "Type the true distance between the two points." };
  const factor = trueDistance / span;
  if (factor < FACTOR_RANGE[0] || factor > FACTOR_RANGE[1])
    return { ok: false, value: null, reason: `That would change the plan by ${factor.toFixed(2)}×, outside ${FACTOR_RANGE[0]}× to ${FACTOR_RANGE[1]}×. Check the two points and the distance.` };
  return { ok: true, value: factor, reason: null };
}

const scalePoint = (p: Vec2, f: number, o: Vec2): Vec2 => ({ x: o.x + (p.x - o.x) * f, y: o.y + (p.y - o.y) * f });
const scalePair = ([x, y]: [number, number], f: number, o: Vec2): [number, number] => [o.x + (x - o.x) * f, o.y + (y - o.y) * f];

/** Every plan-space length in `t` scaled; its reference, override and notes are left as typed. */
function scaleTakeoff(t: Takeoff, f: number, o: Vec2, hash: { was: string; now: string }): Takeoff {
  return {
    ...t,
    points: t.points.map((p) => scalePair(p, f, o)),
    ...(t.cutouts && { cutouts: t.cutouts.map((c) => c.map((p) => scalePair(p, f, o))) }),
    // Current before, current after: the walls moved only because the whole plan did.
    wallsHash: t.wallsHash === hash.was ? hash.now : t.wallsHash,
  };
}

/**
 * The plan with every plan-space length multiplied by `factor` about `origin` (header).
 * Pure: it checks nothing — `calibrationProblem` does that on the result.
 */
export function scalePlan(plan: Plan, factor: number, origin: Vec2 = ORIGIN): Plan {
  const was = wallsHash(plan.walls);
  const walls = plan.walls.map((w) => ({ ...w, a: scalePoint(w.a, factor, origin), b: scalePoint(w.b, factor, origin), thickness: w.thickness * factor }));
  const hash = { was, now: wallsHash(walls) };
  return {
    ...plan,
    walls,
    openings: plan.openings.map((o) => ({ ...o, offset: o.offset * factor, width: o.width * factor })),
    // An imported model's own size and height stay: only where it stands on the floor moves.
    items: plan.items.map((i) => ({ ...i, position: { x: origin.x + (i.position.x - origin.x) * factor, y: i.position.y, z: origin.y + (i.position.z - origin.y) * factor } })),
    ...(plan.takeoffs && { takeoffs: plan.takeoffs.map((t) => scaleTakeoff(t, factor, origin, hash)) }),
    // Step M.2c: the drawing is drawn through its mapping, so the mapping scales with the plan.
    ...(plan.background && { background: { ...plan.background, mapping: scaleAbout(plan.background.mapping, factor, origin) } }),
  };
}

/** "Rescaled x1.0234": the product of every applied factor, to 4 decimals; null before the first. */
export function rescaledText(calibrations: Calibration[] | undefined): string | null {
  if (!calibrations?.length) return null;
  return `Rescaled x${calibrations.reduce((p, c) => p * c.factor, 1).toFixed(4)}`;
}

/** Why the scaled plan can't be used, or null. The reason names the first thing that is wrong. */
export function calibrationProblem(scaled: Plan): string | null {
  const short = scaled.walls.find((w) => wallLength(w) < MIN_WALL_LENGTH - 1e-9);
  if (short) return `Wall ${short.id} would be ${lenText(wallLength(short), 2)} long, under the ${lenText(MIN_WALL_LENGTH, 2)} minimum.`;
  const problems = validatePlan(scaled);
  if (problems.length) return `The plan wouldn't hold together at that scale: ${problems[0]}`;
  // openingProblem IS the usable-span check (and the overlap and minimum-width ones).
  for (const o of scaled.openings) {
    const problem = openingProblem(scaled, o);
    if (problem) return `${o.kind === "door" ? "Door" : "Window"} ${o.id} wouldn't fit its wall at that scale: ${problem}`;
  }
  return null;
}

/** "+2.34%" / "-1.00%": how much a factor changes the plan. */
export const factorPercent = (factor: number) => `${factor >= 1 ? "+" : "−"}${(Math.abs(factor - 1) * 100).toFixed(2)}%`;

/** The walls' width and depth in metres (0 × 0 with no walls), for the dialog's preview. */
export function planExtent(plan: Pick<Plan, "walls">): { width: number; depth: number } {
  if (!plan.walls.length) return { width: 0, depth: 0 };
  const xs = plan.walls.flatMap((w) => [w.a.x, w.b.x]);
  const ys = plan.walls.flatMap((w) => [w.a.y, w.b.y]);
  return { width: Math.max(...xs) - Math.min(...xs), depth: Math.max(...ys) - Math.min(...ys) };
}
