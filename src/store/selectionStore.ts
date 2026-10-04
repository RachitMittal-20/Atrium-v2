/**
 * selectionStore.ts — which wall OR which door/window OR which imported model is
 * selected (only one at a time: choosing one clears the others), and for a model
 * whether Edit parts is on and which part is active (step I.1b), which wall is hovered, the run of pieces the
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
  /** The selected imported model (an Item id, step I.1). */
  itemId: string | null;
  /** "Edit parts" is on for the selected model (step I.1b): a 3D click picks a part, and the tools act on it. */
  editParts: boolean;
  /** The active part of the selected model, by node path (only while editParts is on). */
  partPath: string | null;
  hoveredId: string | null;
  /** Plain-words problems the last edit introduced, shown in the right panel. */
  warnings: string[];
  /** Select a wall (clears any opening); null clears everything. */
  select: (id: string | null) => void;
  /** Select a door or window (clears any wall). */
  selectOpening: (id: string | null) => void;
  /** Select an imported model (clears any wall or opening). Choosing another model leaves Edit parts. */
  selectItem: (id: string | null) => void;
  /** Turn Edit parts on or off for the selected model; off returns to the whole model. */
  setEditParts: (on: boolean) => void;
  /** Make a part of the selected model the active one (null: back to the whole model). Turns Edit parts on. */
  selectPart: (path: string | null) => void;
  hover: (id: string | null) => void;
  setWarnings: (warnings: string[]) => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedId: null,
  openingId: null,
  itemId: null,
  editParts: false,
  partPath: null,
  hoveredId: null,
  warnings: [],
  // A new selection starts with a clean slate: old warnings belonged to the old wall.
  select: (selectedId) => set({ selectedId, openingId: null, itemId: null, editParts: false, partPath: null, warnings: [] }),
  selectOpening: (openingId) => set({ openingId, selectedId: null, itemId: null, editParts: false, partPath: null, warnings: [] }),
  selectItem: (itemId) =>
    set((s) => ({ itemId, selectedId: null, openingId: null, warnings: [], ...(itemId !== s.itemId && { editParts: false, partPath: null }) })), // the same model again keeps its parts mode
  setEditParts: (editParts) => set((s) => (s.itemId ? { editParts, partPath: editParts ? s.partPath : null } : s)),
  selectPart: (partPath) => set((s) => (s.itemId ? { partPath, editParts: s.editParts || partPath !== null } : s)),
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
  const { selectedId, openingId, itemId, hoveredId } = useSelectionStore.getState();
  const gone = (id: string | null) => id !== null && !state.plan.walls.some((w) => w.id === id);
  if (gone(selectedId)) useSelectionStore.setState({ selectedId: null, warnings: [] });
  if (gone(hoveredId)) useSelectionStore.setState({ hoveredId: null });
  if (openingId !== null && !state.plan.openings.some((o) => o.id === openingId)) useSelectionStore.setState({ openingId: null, warnings: [] });
  if (itemId !== null && !state.plan.items.some((i) => i.id === itemId)) useSelectionStore.setState({ itemId: null, editParts: false, partPath: null });
  // a part that was deleted (or sits inside a deleted part) is no longer there to edit
  const { partPath } = useSelectionStore.getState();
  const overrides = partPath !== null ? state.plan.items.find((i) => i.id === itemId)?.import?.nodeOverrides : undefined;
  if (overrides && Object.entries(overrides).some(([p, o]) => o.deleted && (partPath === p || partPath!.startsWith(`${p}/`)))) useSelectionStore.setState({ partPath: null });
});

/**
 * Escape clears the selection from anywhere on the page (the 2D canvas handles
 * its own Escape first, so cancelling a drag wins). With a part of a model active,
 * the first Escape goes back to the whole model. Returns a cleanup; call it
 * from an effect.
 */
export function installSelectionShortcuts(): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || isTypingTarget(e.target)) return;
    const { selectedId, openingId, itemId, partPath } = useSelectionStore.getState();
    if (partPath !== null) useSelectionStore.getState().selectPart(null);
    else if (selectedId || openingId || itemId) useSelectionStore.getState().select(null);
  };
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}

// Development only: lets scripts/e2e-studio.ts read the selection from the page.
if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
  (window as unknown as { __selectionStore?: typeof useSelectionStore }).__selectionStore = useSelectionStore;
}
