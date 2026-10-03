"use client";

/*
 * src/app/studio/page.tsx — the editor shell. Top bar and tool rail (cyanotype
 * chrome), the canvas area (3D, a 2D placeholder, or both) and the right panel
 * (vellum). The plan in usePlanStore is shown in 3D (Scene3D) and 2D
 * (PlanCanvas); walls, doors and windows are edited and placed in 2D. Choosing
 * the Wall, Door, Window or Measure tool while only 3D is showing opens the 2D
 * plan beside it (Split), or instead of it on a phone, since they work there.
 * Owns the m² / sq ft unit so the panel and the 2D labels agree. Mounts the undo/redo and Escape shortcuts. Starts
 * autosave and restores the last saved plan before the views mount
 * (src/store/persistence.ts), so both cameras fit the restored plan. Walking
 * (src/store/viewStore.ts) turns ceilings on and puts the previous setting back
 * on exit; the View popover can still toggle them meanwhile. Leaving the 3D
 * pane (2D only) ends the walk. The 3D tools (Push/Pull, Move) step back to
 * Select when the 3D pane goes away and when a walk starts. Tool keys come from
 * toolStore.TOOL_SHORTCUTS (P, V). Mounts the "Import a 3D model" dialog
 * (ImportModelDialog, step I.1) once.
 * Connects to src/components/studio/*, src/components/plan2d/* and
 * src/store/toolStore.ts.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PlanCanvas } from "@/components/plan2d/PlanCanvas";
import { ImportModelDialog } from "@/components/studio/ImportModelDialog";
import { PlanPanel, type Unit } from "@/components/studio/PlanPanel";
import { Scene3D } from "@/components/studio/Scene3D";
import { ToolRail } from "@/components/studio/ToolRail";
import { TopBar, type View } from "@/components/studio/TopBar";
import { isTypingTarget } from "@/lib/keyboard";
import { installPlanShortcuts } from "@/store/planStore";
import { usePersistenceReady } from "@/store/persistence";
import { installSelectionShortcuts } from "@/store/selectionStore";
import { installToolShortcuts, is3dTool, TOOL_SHORTCUTS, useToolStore, type Tool } from "@/store/toolStore";
import { useViewStore } from "@/store/viewStore";

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

  const wide = useSyncExternalStore(watchWide, () => window.matchMedia(SPLIT_QUERY).matches, () => true);
  const shown = view === "split" && !wide ? "3d" : view; // a phone that was split on a wider window shows 3D

  // Drawing and placing need the 2D plan: picking a tool from 3D alone brings it up. Done in the
  // store subscription (an event, not an effect on render state) so it fires once
  // per pick and the user can still go back to 3D alone afterwards.
  useEffect(
    () =>
      useToolStore.subscribe((s, prev) => {
        if (s.tool === "select" || is3dTool(s.tool) || s.tool === prev.tool) return; // Push/Pull and Move are 3D tools: they never open the 2D plan
        const isWide = window.matchMedia(SPLIT_QUERY).matches;
        setView((v) => (v === "2d" || (v === "split" && isWide) ? v : isWide ? "split" : "2d"));
      }),
    [],
  );

  // Ceilings on while walking (you are indoors); the setting from before comes back on exit.
  const ceilingBefore = useRef(false);
  useEffect(
    () =>
      useViewStore.subscribe((s, prev) => {
        if (s.mode === prev.mode) return;
        if (s.mode === "walk" && is3dTool(useToolStore.getState().tool)) useToolStore.getState().setTool("select"); // walking has no 3D tools
        if (s.mode === "walk")
          setCeiling((c) => {
            ceilingBefore.current = c; // the updater may run twice in dev; it stores the same value both times
            return true;
          });
        else setCeiling(ceilingBefore.current);
      }),
    [],
  );
  // The walk camera lives in the 3D pane: hiding the pane ends the walk.
  useEffect(() => {
    if (shown === "2d") useViewStore.getState().exitWalk();
    if (shown === "2d" && is3dTool(useToolStore.getState().tool)) useToolStore.getState().setTool("select"); // no 3D pane, no 3D tools
  }, [shown]);
  // P picks Push/Pull and V picks Move, when the 3D pane is showing, nobody is walking and nothing is being typed into a field
  useEffect(() => {
    if (shown === "2d") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTypingTarget(e.target)) return;
      const tool = (Object.keys(TOOL_SHORTCUTS) as Tool[]).find((t) => TOOL_SHORTCUTS[t] === e.key.toLowerCase());
      if (!tool || useViewStore.getState().mode === "walk") return;
      useToolStore.getState().setTool(tool);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown]);

  if (!ready) return <div className="h-svh bg-limestone" aria-busy="true" />; // after every hook

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-limestone">
      <TopBar view={shown} setView={setView} showCeiling={ceiling} setShowCeiling={setCeiling} />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <ToolRail view3d={shown !== "2d"} />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
          {shown !== "2d" && (
            <div className="relative min-h-0 min-w-0 flex-1" data-testid="pane-3d">
              <Scene3D showCeiling={ceiling} />
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
      <ImportModelDialog />
    </div>
  );
}
