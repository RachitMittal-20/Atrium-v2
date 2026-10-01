"use client";

/*
 * src/app/studio/page.tsx — the editor shell. Top bar and tool rail (cyanotype
 * chrome), the canvas area (3D, a 2D placeholder, or both) and the right panel
 * (vellum). No editing tools yet; the plan in usePlanStore is shown as is.
 * Mounts the undo/redo shortcuts from planStore. Connects to
 * src/components/studio/*; the 2D plan view arrives in the next step.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { PlanPanel } from "@/components/studio/PlanPanel";
import { Scene3D } from "@/components/studio/Scene3D";
import { ToolRail } from "@/components/studio/ToolRail";
import { TopBar, type View } from "@/components/studio/TopBar";
import { installPlanShortcuts } from "@/store/planStore";

const SPLIT_QUERY = "(min-width: 640px)"; // Split is offered from here up (see TopBar)
const watchWide = (cb: () => void) => {
  const mq = window.matchMedia(SPLIT_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

export default function Studio() {
  const [view, setView] = useState<View>("3d");
  const [ceiling, setCeiling] = useState(false);
  useEffect(() => installPlanShortcuts(), []);

  const wide = useSyncExternalStore(watchWide, () => window.matchMedia(SPLIT_QUERY).matches, () => true);
  const shown = view === "split" && !wide ? "3d" : view; // a phone that was split on a wider window shows 3D

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-limestone">
      <TopBar view={shown} setView={setView} showCeiling={ceiling} setShowCeiling={setCeiling} />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <ToolRail />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
          {shown !== "2d" && (
            <div className="relative min-h-0 min-w-0 flex-1" data-testid="pane-3d">
              <Scene3D showCeiling={ceiling} />
            </div>
          )}
          {shown !== "3d" && (
            <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-4 md:border-l md:border-stone max-md:border-t max-md:border-stone" data-testid="pane-2d">
              <p className="rounded border border-stone bg-vellum px-5 py-4 text-center text-sm text-smoke">The 2D plan arrives in the next step</p>
            </div>
          )}
        </main>
        <PlanPanel />
      </div>
    </div>
  );
}
