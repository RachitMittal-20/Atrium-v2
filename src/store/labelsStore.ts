/**
 * labelsStore.ts — the 2D plan's Labels setting (step L.1), as VIEW state: Full, Compact or Off.
 * `choice` is what the user picked, or null if they never have; the setting in force is
 * `effectiveDetail(choice, drawingShown)` (src/lib/plan2d/labels.ts), which is Compact while the
 * imported drawing shows and the user has never chosen, and Full otherwise. Once they choose, that
 * choice stays. Kept in localStorage under "atrium.labels" ({ detail }), never in the plan, the
 * autosave or the undo history. A missing, blocked or garbled entry means "never chosen".
 * Connects to: src/components/plan2d/{LabelControls,PlanCanvas}.tsx; tested by scripts/test-label-layout.ts.
 */
import { create } from "zustand";
import { LABEL_DETAILS, type LabelDetail } from "@/lib/plan2d/labels";

export const LABELS_KEY = "atrium.labels";

interface LabelsState {
  choice: LabelDetail | null;
  choose: (detail: LabelDetail) => void;
}

function read(): LabelDetail | null {
  try {
    const v = JSON.parse(window.localStorage.getItem(LABELS_KEY) ?? "null")?.detail;
    return LABEL_DETAILS.includes(v) ? v : null;
  } catch {
    return null; // no window (server, tests), blocked storage, or not JSON
  }
}

export const useLabelsStore = create<LabelsState>((set) => ({
  choice: read(),
  choose: (detail) => {
    set({ choice: detail });
    try {
      window.localStorage.setItem(LABELS_KEY, JSON.stringify({ detail }));
    } catch {
      // blocked or full: the choice still holds for this page
    }
  },
}));

/** Reads the saved setting into the store (once at module load; the tests call it to play a page load). */
export function restoreLabelSettings() {
  useLabelsStore.setState({ choice: read() });
}
