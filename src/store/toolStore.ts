/**
 * toolStore.ts — which editor tool is active: Select (pick and edit walls,
 * doors and windows), Wall (draw new walls), Door or Window (place one on a
 * wall), Measure (a temporary two-point dimension) or Push/Pull (move a face of
 * the 3D model; its state is in src/store/pushPullStore.ts). Editor state, not plan
 * state, so switching tools or measuring is never an undo step and never saved.
 * Choosing any tool but Select clears the wall selection: the right panel then
 * shows the Summary, whose counts and room areas follow every edit. Leaving
 * Measure (or entering it) drops the temporary measurement, and Escape cancels
 * it from anywhere.
 *
 * Connects to: src/store/selectionStore.ts, src/lib/plan2d/measure.ts (the
 * maths); set by src/components/studio/ToolRail.tsx and read by
 * src/components/plan2d/PlanCanvas.tsx and src/app/studio/page.tsx.
 */
import { create } from "zustand";
import { isTypingTarget } from "@/lib/keyboard";
import { moveMeasurePoint, placeMeasurePoint, type Measurement } from "@/lib/plan2d/measure";
import type { Vec2 } from "@/types/plan";
import { usePushPullStore } from "./pushPullStore";
import { useSelectionStore } from "./selectionStore";

export type Tool = "select" | "wall" | "door" | "window" | "measure" | "pushpull";

interface ToolState {
  tool: Tool;
  /** The temporary Measure overlay, in plan metres. Null when nothing is being measured. */
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
    if (tool !== "select") useSelectionStore.getState().select(null);
    if (tool === get().tool) return;
    if (get().tool === "pushpull") {
      usePushPullStore.getState().cancel(); // leaving the tool mid-pull takes the preview back
      usePushPullStore.getState().setHover(null);
    }
    set({ tool, measurement: null }); // any tool change drops the temporary measurement
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

// Development only: lets scripts/e2e-studio.ts read the active tool and the measurement.
if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
  (window as unknown as { __toolStore?: typeof useToolStore }).__toolStore = useToolStore;
}
