/**
 * emptyPlan.ts — a plan with nothing in it, for "New plan > Empty plan" (step N.1). Same shape as
 * samplePlan (src/data/samplePlan.ts) with no walls, openings, rooms or items, and none of the
 * optional parts (takeoffs, calibrations, background), so replacing a plan with it drops those.
 * Metadata source is "manual": it is drawn by hand. Connects to: src/store/projectStore.ts (newPlan).
 */
import type { Plan } from "@/types/plan";

export const EMPTY_PLAN_NAME = "Untitled plan";

/** `now` is an ISO time; the caller passes it so the plan itself stays a pure value. */
export function emptyPlan(now: string): Plan {
  return {
    id: "untitled",
    name: EMPTY_PLAN_NAME,
    units: "m",
    walls: [],
    openings: [],
    rooms: [],
    items: [],
    meta: { createdAt: now, updatedAt: now, source: "manual" },
  };
}
