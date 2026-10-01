/**
 * toolStore.ts — which editor tool is active and the temporary Measure overlay.
 * Like selectionStore this is deliberately NOT part of the plan store: choosing
 * a tool or measuring is not an edit, so it never lands in undo history, never
 * touches the Plan, and is never autosaved. Leaving Measure clears the overlay;
 * Escape cancels it from anywhere on the page.
 *
 * Connects to: src/lib/plan2d/measure.ts (the maths), src/store/selectionStore.ts
 * (entering Measure clears the wall selection, so no handles invite a drag);
 * read by src/components/studio/ToolRail.tsx, src/components/plan2d/PlanCanvas.tsx
 * and src/app/studio/page.tsx.
 */
import { create } from "zustand";
import { isTypingTarget } from "@/lib/keyboard";
import { moveMeasurePoint, placeMeasurePoint, type Measurement } from "@/lib/plan2d/measure";
import type { Vec2 } from "@/types/plan";
import { useSelectionStore } from "./selectionStore";

/** Tools that work today; Wall, Door and Window are still "coming soon" in the rail. */
export type Tool = "select" | "measure";

interface ToolState {
  tool: Tool;
  /** In plan metres. Null when nothing is being measured. */
  measurement: Measurement | null;
  setTool: (tool: Tool) => void;
  placeMeasurePoint: (p: Vec2) => void;
  moveMeasurePoint: (which: "a" | "b", p: Vec2) => void;
  cancelMeasure: () => void;
}

export const useToolStore = create<ToolState>((set, get) => ({
  tool: "select",
  measurement: null,

  setTool: (tool) => {
    if (tool === get().tool) return;
    set({ tool, measurement: null }); // switching either way drops the temporary measurement
    if (tool === "measure") useSelectionStore.getState().select(null);
  },
  placeMeasurePoint: (p) => set((s) => (s.tool === "measure" ? { measurement: placeMeasurePoint(s.measurement, p) } : s)),
  moveMeasurePoint: (which, p) => set((s) => (s.measurement ? { measurement: moveMeasurePoint(s.measurement, which, p) } : s)),
  cancelMeasure: () => set({ measurement: null }),
}));

/**
 * Escape cancels the current measurement from anywhere. Registered in the
 * capture phase and stopped there, so the same keypress does not also clear the
 * wall selection or close something else underneath. Returns a cleanup; call it
 * from an effect.
 */
export function installToolShortcuts(): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || isTypingTarget(e.target) || !useToolStore.getState().measurement) return;
    useToolStore.getState().cancelMeasure();
    e.stopPropagation();
  };
  window.addEventListener("keydown", onKeyDown, { capture: true });
  return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
}

// Development only: lets scripts/e2e-studio.ts read the tool and the measurement from the page.
if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
  (window as unknown as { __toolStore?: typeof useToolStore }).__toolStore = useToolStore;
}
