/**
 * hintStore.ts — whether the studio's first-run hint was dismissed (step N.1), as VIEW state: kept in
 * localStorage under "atrium.studioHint" ({ dismissed: true }), never in the plan, its history, the
 * autosave or a project file. A missing, blocked or garbled entry means "not dismissed". When the hint
 * shows is decided by src/lib/studioHint.ts; the hint itself is src/components/studio/StudioHints.tsx.
 */
import { create } from "zustand";

export const HINT_KEY = "atrium.studioHint";

function read(): boolean {
  try {
    return JSON.parse(window.localStorage.getItem(HINT_KEY) ?? "null")?.dismissed === true;
  } catch {
    return false; // no window (server, tests), blocked storage, or not JSON
  }
}

export const useHintStore = create<{ dismissed: boolean; dismiss: () => void }>((set) => ({
  dismissed: read(),
  dismiss: () => {
    set({ dismissed: true });
    try {
      window.localStorage.setItem(HINT_KEY, JSON.stringify({ dismissed: true }));
    } catch {
      // blocked or full: it stays dismissed for this page
    }
  },
}));

/** Reads the saved setting into the store (once at module load; the tests call it to play a page load). */
export function restoreHint() {
  useHintStore.setState({ dismissed: read() });
}
