/**
 * selectionStore.ts — which wall OR which door/window is selected (never both:
 * choosing one clears the other), which wall is hovered, the run of pieces the
 * selected wall belongs to, plus the warnings the last edit raised. `selectedId`
 * is always a wall id and `openingId` an opening id, so code written for walls
 * keeps working unchanged. Deliberately NOT part of the plan store:
 * selecting is not an edit, so it never lands in undo history, and both the 2D
 * plan and the 3D scene read the same selection so they highlight together.
 *
 * The selection clears itself whenever the selected wall or opening leaves the
 * plan — deleted, or undone away — by watching planStore.
 *
 * Connects to: src/store/planStore.ts, src/lib/keyboard.ts; read by
 * src/components/plan2d/PlanCanvas.tsx, src/components/three/PlanModel.tsx and
 * src/components/studio/{PlanPanel,WallPanel,OpeningPanel}.tsx.
 */
import { useMemo } from "react";
import { create } from "zustand";
import { isTypingTarget } from "@/lib/keyboard";
import { wallRun } from "@/lib/plan/edit";
import { usePlanStore } from "./planStore";

interface SelectionState {
  /** The selected wall. */
  selectedId: string | null;
  /** The selected door or window. */
  openingId: string | null;
  hoveredId: string | null;
  /** Plain-words problems the last edit introduced, shown in the right panel. */
  warnings: string[];
  /** Select a wall (clears any opening); null clears everything. */
  select: (id: string | null) => void;
  /** Select a door or window (clears any wall). */
  selectOpening: (id: string | null) => void;
  hover: (id: string | null) => void;
  setWarnings: (warnings: string[]) => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedId: null,
  openingId: null,
  hoveredId: null,
  warnings: [],
  // A new selection starts with a clean slate: old warnings belonged to the old wall.
  select: (selectedId) => set({ selectedId, openingId: null, warnings: [] }),
  selectOpening: (openingId) => set({ openingId, selectedId: null, warnings: [] }),
  hover: (hoveredId) => set({ hoveredId }),
  setWarnings: (warnings) => set({ warnings }),
}));

/**
 * The straight wall the selection is part of: the ids of every piece it was split
 * into at its T-junctions, in order, or [] with nothing selected. A body drag
 * moves all of them, so the 2D plan and the 3D scene both highlight the run and
 * the panel can say how big it is. Derived, never stored: the plan changes under it.
 */
export function useSelectedRun(): string[] {
  const walls = usePlanStore((s) => s.plan.walls);
  const selectedId = useSelectionStore((s) => s.selectedId);
  return useMemo(() => (selectedId ? wallRun({ walls }, selectedId) : []), [walls, selectedId]);
}

/** Forget a wall or opening that is no longer in the plan (deleted, or undone away). */
usePlanStore.subscribe((state) => {
  const { selectedId, openingId, hoveredId } = useSelectionStore.getState();
  const gone = (id: string | null) => id !== null && !state.plan.walls.some((w) => w.id === id);
  if (gone(selectedId)) useSelectionStore.setState({ selectedId: null, warnings: [] });
  if (gone(hoveredId)) useSelectionStore.setState({ hoveredId: null });
  if (openingId !== null && !state.plan.openings.some((o) => o.id === openingId)) useSelectionStore.setState({ openingId: null, warnings: [] });
});

/**
 * Escape clears the selection from anywhere on the page (the 2D canvas handles
 * its own Escape first, so cancelling a drag wins). Returns a cleanup; call it
 * from an effect.
 */
export function installSelectionShortcuts(): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || isTypingTarget(e.target)) return;
    const { selectedId, openingId } = useSelectionStore.getState();
    if (selectedId || openingId) useSelectionStore.getState().select(null);
  };
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}

// Development only: lets scripts/e2e-studio.ts read the selection from the page.
if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
  (window as unknown as { __selectionStore?: typeof useSelectionStore }).__selectionStore = useSelectionStore;
}
