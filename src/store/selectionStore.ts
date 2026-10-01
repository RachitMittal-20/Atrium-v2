/**
 * selectionStore.ts — which wall is selected and which is hovered, plus the
 * warnings the last edit raised. Deliberately NOT part of the plan store:
 * selecting is not an edit, so it never lands in undo history, and both the 2D
 * plan and the 3D scene read the same selection so they highlight together.
 *
 * The selection clears itself whenever the selected wall leaves the plan —
 * deleted, or undone away — by watching planStore.
 *
 * Connects to: src/store/planStore.ts, src/lib/keyboard.ts; read by
 * src/components/plan2d/PlanCanvas.tsx, src/components/three/PlanModel.tsx and
 * src/components/studio/{PlanPanel,WallPanel}.tsx.
 */
import { create } from "zustand";
import { isTypingTarget } from "@/lib/keyboard";
import { usePlanStore } from "./planStore";

interface SelectionState {
  selectedId: string | null;
  hoveredId: string | null;
  /** Plain-words problems the last edit introduced, shown in the right panel. */
  warnings: string[];
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  setWarnings: (warnings: string[]) => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedId: null,
  hoveredId: null,
  warnings: [],
  // A new selection starts with a clean slate: old warnings belonged to the old wall.
  select: (selectedId) => set({ selectedId, warnings: [] }),
  hover: (hoveredId) => set({ hoveredId }),
  setWarnings: (warnings) => set({ warnings }),
}));

/** Forget a wall that is no longer in the plan (deleted, or undone away). */
usePlanStore.subscribe((state) => {
  const { selectedId, hoveredId } = useSelectionStore.getState();
  const gone = (id: string | null) => id !== null && !state.plan.walls.some((w) => w.id === id);
  if (gone(selectedId)) useSelectionStore.setState({ selectedId: null, warnings: [] });
  if (gone(hoveredId)) useSelectionStore.setState({ hoveredId: null });
});

/**
 * Escape clears the selection from anywhere on the page (the 2D canvas handles
 * its own Escape first, so cancelling a drag wins). Returns a cleanup; call it
 * from an effect.
 */
export function installSelectionShortcuts(): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || isTypingTarget(e.target)) return;
    if (useSelectionStore.getState().selectedId) useSelectionStore.getState().select(null);
  };
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}

// Development only: lets scripts/e2e-studio.ts read the selection from the page.
if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
  (window as unknown as { __selectionStore?: typeof useSelectionStore }).__selectionStore = useSelectionStore;
}
