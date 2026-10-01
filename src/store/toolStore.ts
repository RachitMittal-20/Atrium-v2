/**
 * toolStore.ts — which editor tool is active: Select (pick and edit walls) or
 * Wall (draw new ones). Editor state, not plan state, so switching tools is
 * never an undo step. Choosing Wall clears the selection: the right panel then
 * shows the Summary, whose room list and areas follow every wall drawn.
 *
 * Connects to: src/store/selectionStore.ts; set by
 * src/components/studio/ToolRail.tsx and read by
 * src/components/plan2d/PlanCanvas.tsx and src/app/studio/page.tsx.
 */
import { create } from "zustand";
import { useSelectionStore } from "./selectionStore";

export type Tool = "select" | "wall";

interface ToolState {
  tool: Tool;
  setTool: (tool: Tool) => void;
}

export const useToolStore = create<ToolState>((set) => ({
  tool: "select",
  setTool: (tool) => {
    if (tool === "wall") useSelectionStore.getState().select(null);
    set({ tool });
  },
}));

// Development only: lets scripts/e2e-studio.ts read the active tool.
if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
  (window as unknown as { __toolStore?: typeof useToolStore }).__toolStore = useToolStore;
}
