"use client";

/*
 * src/components/plan2d/LabelControls.tsx — the "Labels" control in the 2D pane (step L.1): Full,
 * Compact and Off, and how many labels the layout pass hid (overprinting, under a control, or a room too small). A native
 * <select> 44 px tall: Tab reaches it, the arrow keys and Space change it, a phone opens its own picker,
 * and it is only about 130 px wide, which matters because this row floats over the plan (a segmented
 * control 215 px wide covered a wall a test taps at 390 with the plan-details sheet open). The shown
 * choice is the one in force: the user's own, or Compact while the drawing shows and they have never
 * chosen (src/lib/plan2d/labels.ts effectiveDetail). Connects to: src/store/labelsStore.ts; mounted by
 * PlanCanvas.tsx beside "Set scale…".
 */
import { LABEL_DETAILS, LABEL_DETAIL_WORD, type LabelDetail } from "@/lib/plan2d/labels";
import { useLabelsStore } from "@/store/labelsStore";

export function LabelControls({ detail, hidden, className = "" }: { detail: LabelDetail; hidden: number; className?: string }) {
  const choose = useLabelsStore((s) => s.choose);
  const why = hidden > 0 ? `${hidden} ${hidden === 1 ? "label is" : "labels are"} hidden because ${hidden === 1 ? "it" : "they"} would print over another, or sit under a control, or belong to a room too small to hold ${hidden === 1 ? "it" : "them"}. Zoom in, or choose Compact or Off, to see fewer at once.` : undefined;
  return (
    <>
      <div data-plan-obstacle="labels" className={`flex items-center ${className}`}>
        <label className="flex min-h-11 items-center gap-1.5 pl-3 text-xs text-iron">
          Labels
          <select
            data-testid="plan-labels-select"
            data-detail={detail}
            value={detail}
            title={why}
            onChange={(e) => choose(e.target.value as LabelDetail)}
            className="min-h-11 min-w-11 cursor-pointer rounded border-0 bg-transparent py-0 pl-1 pr-2 text-xs text-iron focus-visible:outline-2"
          >
            {LABEL_DETAILS.map((d) => (
              <option key={d} value={d}>
                {LABEL_DETAIL_WORD[d]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {hidden > 0 && (
        // Its own element, not inside the bordered control, and pointer-events-none: a taller or wider control would cover
        // the plan under it (it once swallowed a tap on a wall), and the count is text to read, not a target.
        <span data-testid="plan-labels-hidden" data-plan-obstacle="hidden" aria-live="polite" className="pointer-events-none shrink-0 rounded bg-limestone/80 px-1.5 text-xs text-smoke">
          {hidden} hidden
        </span>
      )}
    </>
  );
}
