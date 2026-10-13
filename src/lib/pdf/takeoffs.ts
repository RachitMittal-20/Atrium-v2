/**
 * src/lib/pdf/takeoffs.ts — carrying the PDF's printed dimensions into the studio as takeoffs
 * (step M.2b). Pure.
 *
 * At Build model, every dimension the review matched to a line (scale.ts's DimensionMatch,
 * the first table's rows) becomes one LENGTH takeoff:
 *   - points: the two ends the review measured between (its ticks, or the line's own ends),
 *     turned into plan metres, so the measured value is their distance at the plan's scale
 *     and a recalibration changes it;
 *   - reference: the printed value, with the text as printed as its note;
 *   - override: whatever was typed on the review screen for that row, with its note;
 *   - source: "pdf", which is what puts the row in the panel's "From PDF" group and names it in
 *     the CSV; and `approximate` when the model-versus-printed check landed that dimension on a
 *     wall the image pipeline traced, which is what makes the row say "approximate". The ends of
 *     a printed dimension line lie off the building, so no point of such a row is ON a wall:
 *     that verdict has to be carried, not derived from the points.
 * Nothing else is carried: the status rules, units, overrides, CSV and stale marker are the
 * takeoffs' own (src/lib/takeoff/rows.ts), unchanged.
 *
 * A scanned PDF and an image carry nothing: they have no matched dimensions, and the import
 * screen only calls this on the vector route. At most MAX_PDF_TAKEOFFS rows are carried, so a
 * drawing with thousands of dimensions can't bloat the autosave; the screen says when it caps.
 *
 * Connects to: src/types/pdf.ts (DimensionMatch), src/lib/pdf/dimensions.ts (Overrides),
 * src/lib/takeoff/rows.ts; used by src/app/studio/import/page.tsx; tested by
 * scripts/test-pdf-takeoffs.ts.
 */
import type { Takeoff, Vec2 } from "@/types/plan";
import type { DimensionMatch } from "@/types/pdf";
import type { Overrides } from "./dimensions";

/** The cap on carried rows; the review screen says so when it bites. */
export const MAX_PDF_TAKEOFFS = 200;

/** A takeoff as planStore.addTakeoff takes it (the id and the walls' hash are its business). */
export type NewTakeoff = Omit<Takeoff, "id" | "wallsHash">;

/**
 * One takeoff per matched dimension (header). `toPlan` maps page points to plan metres —
 * the same mapping the model-versus-printed table uses.
 */
export function pdfTakeoffs(matches: DimensionMatch[], toPlan: (x: number, y: number) => Vec2, overrides: Overrides = {}, approximate: ReadonlySet<number> = new Set()): NewTakeoff[] {
  return matches.slice(0, MAX_PDF_TAKEOFFS).map((m, i) => {
    const [a, b] = [toPlan(m.ends.x1, m.ends.y1), toPlan(m.ends.x2, m.ends.y2)];
    const o = overrides[i];
    return {
      name: `PDF ${m.text}`,
      kind: "length" as const,
      points: [[a.x, a.y], [b.x, b.y]] as [number, number][],
      reference: { value: m.metres, note: m.text },
      ...(o && { override: { value: o.valueM, ...(o.note.trim() && { note: o.note.trim() }) } }),
      source: "pdf" as const,
      ...(approximate.has(i) && { approximate: true as const }),
    };
  });
}

/** Which matched dimensions the model check landed on a traced wall (`modelRows`' own verdict). */
export const approximateIndexes = (model: { index: number; approximate?: boolean }[]) => new Set(model.filter((r) => r.approximate).map((r) => r.index));
