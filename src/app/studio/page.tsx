"use client";

/*
 * src/app/studio/page.tsx — the editor shell. Top bar and tool rail (cyanotype
 * chrome), the canvas area (3D, a 2D placeholder, or both) and the right panel
 * (vellum). The plan in usePlanStore is shown in 3D (Scene3D) and 2D
 * (PlanCanvas). Owns the m² / sq ft unit so the panel and the 2D labels agree.
 * Mounts the undo/redo and Escape shortcuts. Starts autosave and restores the
 * last saved plan before the views mount (src/store/persistence.ts), so both
 * cameras fit the restored plan. Shows a hint when Measure is picked in 3D.
 * Connects to src/components/studio/* and src/components/plan2d/*.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { PlanCanvas } from "@/components/plan2d/PlanCanvas";
import { PlanPanel, type Unit } from "@/components/studio/PlanPanel";
import { Scene3D } from "@/components/studio/Scene3D";
import { ToolRail } from "@/components/studio/ToolRail";
import { TopBar, type View } from "@/components/studio/TopBar";
import { installPlanShortcuts } from "@/store/planStore";
import { usePersistenceReady } from "@/store/persistence";
import { installSelectionShortcuts } from "@/store/selectionStore";
import { installToolShortcuts, useToolStore } from "@/store/toolStore";

const SPLIT_QUERY = "(min-width: 640px)"; // Split is offered from here up (see TopBar)
const watchWide = (cb: () => void) => {
  const mq = window.matchMedia(SPLIT_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

export default function Studio() {
  const [view, setView] = useState<View>("3d");
  const [ceiling, setCeiling] = useState(false);
  const [unit, setUnit] = useState<Unit>("m2");
  useEffect(() => installPlanShortcuts(), []);
  useEffect(() => installSelectionShortcuts(), []); // Escape clears the selection from anywhere
  useEffect(() => installToolShortcuts(), []); // Escape cancels a measurement first
  const ready = usePersistenceReady(); // the saved plan is in the store once this is true
  const measuring = useToolStore((s) => s.tool === "measure");

  const wide = useSyncExternalStore(watchWide, () => window.matchMedia(SPLIT_QUERY).matches, () => true);
  const shown = view === "split" && !wide ? "3d" : view; // a phone that was split on a wider window shows 3D

  if (!ready) return <div className="h-svh bg-limestone" aria-busy="true" />;

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-limestone">
      <TopBar view={shown} setView={setView} showCeiling={ceiling} setShowCeiling={setCeiling} />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <ToolRail />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
          {shown !== "2d" && (
            <div className="relative min-h-0 min-w-0 flex-1" data-testid="pane-3d">
              <Scene3D showCeiling={ceiling} />
              {measuring && shown === "3d" && (
                <p role="status" data-testid="measure-3d-hint" className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded border border-stone bg-vellum px-3 py-1.5 text-xs text-iron shadow">
                  Measure works in the 2D plan. Switch to 2D to measure.
                </p>
              )}
            </div>
          )}
          {shown !== "3d" && (
            <div className="relative min-h-0 min-w-0 flex-1 md:border-l md:border-stone max-md:border-t max-md:border-stone" data-testid="pane-2d">
              <PlanCanvas unit={unit} />
            </div>
          )}
        </main>
        <PlanPanel unit={unit} setUnit={setUnit} />
      </div>
    </div>
  );
}
