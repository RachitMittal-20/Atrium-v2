/**
 * studioHint.ts — when the studio's first-run hint shows (step N.1). Pure. The hint is for a visitor
 * looking at the untouched sample plan or an empty plan; once they edit, it has nothing to teach
 * from. `planSignature` is a string over the parts that matter (not key order, not rooms, which are
 * derived), so a sample plan that went through the autosave and back still counts as untouched.
 * Whether it was dismissed is a view setting (src/store/hintStore.ts), never in the plan.
 * Connects to: src/data/samplePlan.ts; used by src/components/studio/StudioHints.tsx.
 */
import { samplePlan } from "@/data/samplePlan";
import type { Plan } from "@/types/plan";

/** Walls, openings, name and the counts of items and takeoffs, as one comparable string. */
export function planSignature(plan: Plan): string {
  const r = (n: number) => Math.round(n * 1e6); // an autosave round trip keeps numbers, but never compare floats by ===
  return JSON.stringify([
    plan.name,
    plan.walls.map((w) => [w.id, r(w.a.x), r(w.a.y), r(w.b.x), r(w.b.y), r(w.thickness), r(w.height)]),
    plan.openings.map((o) => [o.id, o.wallId, o.kind, r(o.offset), r(o.width), r(o.height), r(o.sillHeight)]),
    plan.items.length,
    plan.takeoffs?.length ?? 0,
  ]);
}

const SAMPLE = planSignature(samplePlan);

/** True for a plan with nothing drawn in it. */
export const isEmptyPlan = (plan: Plan): boolean => plan.walls.length === 0 && plan.openings.length === 0 && plan.items.length === 0;

/** True for the sample as it ships (any plan with the same walls, openings and name). */
export const isUntouchedSample = (plan: Plan): boolean => planSignature(plan) === SAMPLE;

/** The hint shows for an untouched sample or an empty plan, until it is dismissed. */
export const showHint = (plan: Plan, dismissed: boolean): boolean => !dismissed && (isEmptyPlan(plan) || isUntouchedSample(plan));
