"use client";

/*
 * src/components/studio/CalibrateDialog.tsx — the Set scale dialog (step M.2b). A native
 * <dialog> opened with showModal(), so the page behind it is inert, focus is trapped and
 * Escape closes it without any code of ours — the same pattern as ImportModelDialog.
 *
 * It opens once the 2D plan has both points (src/store/calibrateStore.ts) and shows:
 *   - the distance it measured between them, in the one units setting;
 *   - a field for the true distance, read by the existing parser (a bare number is in the
 *     current unit, "13'6\"" and "3800 mm" work too);
 *   - a live preview: the factor and the percentage, the plan's size before and after, and
 *     what does and does not scale;
 *   - a warning when the factor is outside 0.8–1.25 ("Large change: check you clicked the
 *     right two points."), and the reason when the factor or the result is refused;
 *   - Apply and Cancel, both at least 44 px tall so a finger can hit them.
 * Apply calls planStore.calibratePlan (one undo step; a refusal shows its reason and changes
 * nothing) and then asks the 2D plan to fit the plan again (`onApplied`).
 *
 * Connects to: src/lib/plan/calibrate.ts, src/store/{calibrateStore,planStore}.ts,
 * src/lib/units/format.ts; mounted by src/components/plan2d/PlanCanvas.tsx (the pane that
 * does the picking and holds the camera).
 */
import { useEffect, useRef, useState } from "react";
import { calibrateFactor, factorPercent, planExtent, SAFE_RANGE } from "@/lib/plan/calibrate";
import { formatLength, lengthHint, lengthValue, parseLengthInput, STUDIO_DP } from "@/lib/units/format";
import { useCalibrateStore } from "@/store/calibrateStore";
import { usePlanStore } from "@/store/planStore";
import { useUnitsStore } from "@/store/unitsStore";

export function CalibrateDialog({ onApplied }: { onApplied: () => void }) {
  const { asking, points, cancel } = useCalibrateStore();
  const plan = usePlanStore((s) => s.plan);
  const unit = useUnitsStore((s) => s.length);
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  // showModal / close follow `asking`, and the browser's own Escape closes it (so: cancel).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (asking && !el.open) {
      setTyped("");
      setError(null);
      el.showModal();
    }
    if (!asking && el.open) el.close();
  }, [asking]);

  const measured = points.length === 2 ? Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]) : 0;
  const len = (m: number) => formatLength(m, unit, STUDIO_DP.length);
  const pair = (a: number, b: number) => `${lengthValue(a, unit, STUDIO_DP.length)} × ${len(b)}`;
  const want = typed.trim() ? parseLengthInput(typed, unit) : null;
  const factor = want === null ? null : calibrateFactor({ x: points[0]?.[0] ?? 0, y: points[0]?.[1] ?? 0 }, { x: points[1]?.[0] ?? 0, y: points[1]?.[1] ?? 0 }, want);
  const f = factor?.ok ? factor.value : null;
  const extent = planExtent(plan);
  const large = f !== null && (f < SAFE_RANGE[0] || f > SAFE_RANGE[1]);

  const apply = () => {
    if (f === null) {
      setError(factor?.reason ?? `"${typed}" isn't a distance. ${lengthHint(unit)}`);
      return;
    }
    const problem = usePlanStore.getState().calibratePlan(f, typed.trim());
    if (problem) {
      setError(problem);
      return;
    }
    cancel();
    onApplied();
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="calibrate-h"
      data-testid="calibrate-dialog"
      onCancel={(e) => {
        e.preventDefault(); // close it through the store, so the picked points go too
        cancel();
      }}
      onClose={cancel}
      className="m-auto max-h-[90svh] w-[min(28rem,calc(100vw-1rem))] rounded border border-stone bg-vellum p-0 text-iron shadow-xl backdrop:bg-iron/40"
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
        className="flex flex-col gap-3 p-4"
      >
        <h2 id="calibrate-h" className="font-display text-lg">
          Set the scale
        </h2>
        <p className="text-sm text-smoke" data-testid="calibrate-measured" data-metres={measured.toFixed(6)}>
          The two points you picked are {len(measured)} apart on the plan.
        </p>
        <label className="flex flex-col gap-1 text-sm">
          <span>True distance between them</span>
          <input
            data-testid="calibrate-input"
            autoFocus
            value={typed}
            spellCheck={false}
            placeholder={lengthValue(measured, unit, STUDIO_DP.length)}
            onChange={(e) => {
              setTyped(e.target.value);
              setError(null);
            }}
            className="min-h-11 rounded border border-stone bg-limestone/60 px-2"
          />
        </label>
        <p className="text-sm" data-testid="calibrate-preview" data-factor={f === null ? "" : f.toFixed(6)}>
          {f === null
            ? typed.trim()
              ? (factor?.reason ?? `"${typed}" isn't a distance. ${lengthHint(unit)}`)
              : "Type the true distance to see what it would change."
            : `Factor ${f.toFixed(4)} (${factorPercent(f)}). Plan ${pair(extent.width, extent.depth)} becomes ${pair(extent.width * f, extent.depth * f)}. Walls, openings and takeoffs scale; heights and imported models do not.`}
        </p>
        {large && (
          <p role="status" data-testid="calibrate-warning" className="rounded border border-gilt/60 bg-gilt/10 px-2 py-1.5 text-sm">
            Large change: check you clicked the right two points.
          </p>
        )}
        {error && (
          <p role="alert" data-testid="calibrate-error" className="text-sm text-gilt-ink">
            {error}
          </p>
        )}
        <div className="mt-1 flex flex-wrap justify-end gap-2">
          <button type="button" data-testid="calibrate-cancel" onClick={cancel} className="min-h-11 rounded border border-stone px-4 text-sm hover:bg-limestone">
            Cancel
          </button>
          <button type="submit" data-testid="calibrate-apply" disabled={f === null} className="min-h-11 rounded bg-cyanotype px-4 text-sm text-vellum disabled:opacity-50">
            Apply
          </button>
        </div>
      </form>
    </dialog>
  );
}
