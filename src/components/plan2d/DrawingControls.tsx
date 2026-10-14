"use client";

/*
 * src/components/plan2d/DrawingControls.tsx — the "Drawing" toggle and its opacity slider (step
 * M.2c), for the imported drawing under the 2D plan. Shown twice — in the 2D pane beside "Set
 * scale…" (PlanCanvas.tsx) and in the plan panel (PlanPanel.tsx) — and both are views of the one
 * setting in src/store/backgroundStore.ts, so they always agree. Both controls are native (a
 * button with aria-pressed and an <input type="range">), so Tab, Space and the arrow keys work,
 * and each is 44 px tall for a finger. `prefix` keeps the two copies' test ids apart.
 */
import { useBackgroundStore } from "@/store/backgroundStore";

export function DrawingControls({ prefix, className = "" }: { prefix: string; className?: string }) {
  const visible = useBackgroundStore((s) => s.visible);
  const opacity = useBackgroundStore((s) => s.opacity);
  const percent = Math.round(opacity * 100);
  return (
    <div role="group" aria-label="Drawing under the plan" className={`flex items-center gap-2 ${className}`}>
      <button
        type="button"
        data-testid={`${prefix}-drawing-toggle`}
        aria-pressed={visible}
        onClick={() => useBackgroundStore.getState().setVisible(!visible)}
        className={`min-h-11 shrink-0 rounded border px-3 text-xs ${visible ? "border-cyanotype bg-cyanotype text-vellum" : "border-stone bg-vellum text-iron hover:bg-limestone"}`}
      >
        Drawing
      </button>
      <label className="flex min-h-11 min-w-0 items-center gap-2 text-xs text-iron">
        <span className="sr-only">Drawing opacity</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={percent}
          aria-valuetext={`${percent}%`}
          data-testid={`${prefix}-drawing-opacity`}
          onChange={(e) => useBackgroundStore.getState().setOpacity(Number(e.target.value) / 100)}
          className="h-11 w-24 min-w-0 cursor-pointer accent-cyanotype"
        />
        <span className="w-9 shrink-0 tabular-nums text-smoke" aria-hidden>
          {percent}%
        </span>
      </label>
    </div>
  );
}
