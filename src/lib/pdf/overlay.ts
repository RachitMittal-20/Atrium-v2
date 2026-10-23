/**
 * src/lib/pdf/overlay.ts — step R.3: the door and window bars the import review draws over the
 * page, taken from the BUILT plan instead of the picture tracing.
 *
 * Until R.3 PlanViewer drew `analysis.openings` (the tracing's guesses) even when the model was built
 * from the PDF's own openings, so on plan-chatgpt-flat.pdf some bars were tilted or several times too
 * long while the model was right. `openingBars` turns each plan opening into a bar between its two
 * jambs on the wall's centre line, as thick as its wall, in raster pixels (planToPixels), so the overlay
 * and the model cannot disagree. `drawnFromPlan` says when that is safe: only when nothing in the build
 * came from the tracing. Otherwise (a traced wall or opening is in the plan, or the whole traced plan
 * was used) the page keeps drawing the traced openings, as before.
 *
 * Connects to: snap.ts (Coverage, planToPixels); used by src/app/studio/import/page.tsx and PlanViewer.tsx.
 */
import type { Opening, Plan, Vec2 } from "@/types/plan";
import type { Coverage } from "./snap";

/** One opening for the overlay, in raster pixels: jambs on the wall's centre line, the wall's thickness. */
export interface OpeningBar {
  id: string;
  wallId: string;
  kind: Opening["kind"];
  a: Vec2;
  b: Vec2;
  thickness: number;
}

/** True when the plan holds only PDF-read walls and openings: Coverage.pdfOnly (rule 8/8b), or a merge
 *  that kept no traced wall, no traced opening and did not fall back (plan-filled: every wall exact, every
 *  traced opening snapped onto the PDF's). Then the plan's openings are the truth to draw. */
export const drawnFromPlan = (c: Coverage): boolean =>
  !c.fellBack && (c.pdfOnly || (c.tracedWalls.length === 0 && c.tracedOpenings.length === 0 && c.openings.traced === 0));

/** Every opening of the plan as a bar (an opening whose wall is missing is skipped; the validator says so elsewhere). */
export function openingBars(plan: Pick<Plan, "walls" | "openings">, pxPerM: number, toPx: (p: Vec2) => Vec2): OpeningBar[] {
  const bars: OpeningBar[] = [];
  for (const o of plan.openings) {
    const w = plan.walls.find((x) => x.id === o.wallId);
    if (!w) continue;
    const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    if (len === 0) continue;
    const ux = (w.b.x - w.a.x) / len;
    const uy = (w.b.y - w.a.y) / len;
    // Offset is measured from the wall's a end to the opening's centre (CLAUDE.md conventions).
    const at = (d: number) => toPx({ x: w.a.x + ux * d, y: w.a.y + uy * d });
    bars.push({ id: o.id, wallId: w.id, kind: o.kind, a: at(o.offset - o.width / 2), b: at(o.offset + o.width / 2), thickness: w.thickness * pxPerM });
  }
  return bars;
}
