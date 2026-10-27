/**
 * cutawayStore.ts — the 3D view's Cutaway and Room names settings (step V.2), as VIEW state, like
 * labelsStore. `cutaway` and `roomNames` are what the user picked, or null if they never have.
 * `imported` says the plan on screen was built from an import (Build model sets it; opening a project
 * and New plan clear it). The settings in force:
 *   cutawayOn   the user's choice, else ON for an imported plan and OFF for the sample or an opened project;
 *   roomNamesOn the user's choice, else the same as cutawayOn (the two toggle together until chosen apart).
 * Kept in localStorage under "atrium.cutaway" ({ cutaway?, roomNames?, imported }), never in the plan,
 * the autosave, a project file or the undo history. A missing, blocked or garbled entry means "never chosen".
 * Connects to: src/components/studio/TopBar.tsx (the View menu), src/components/three/{PlanModel,RoomLabels}.tsx,
 * src/components/studio/PushPullOverlay.tsx, src/app/studio/import/page.tsx and src/store/projectStore.ts
 * (setImported); tested by scripts/test-cutaway.ts.
 */
import { create } from "zustand";

export const CUTAWAY_KEY = "atrium.cutaway";

interface CutawayState {
  cutaway: boolean | null;
  roomNames: boolean | null;
  imported: boolean;
  setCutaway: (on: boolean) => void;
  setRoomNames: (on: boolean) => void;
  setImported: (on: boolean) => void;
}

type Saved = Pick<CutawayState, "cutaway" | "roomNames" | "imported">;
const NEVER: Saved = { cutaway: null, roomNames: null, imported: false };

function read(): Saved {
  try {
    const v = JSON.parse(window.localStorage.getItem(CUTAWAY_KEY) ?? "null");
    if (typeof v !== "object" || v === null) return NEVER;
    const bool = (x: unknown) => (typeof x === "boolean" ? x : null);
    return { cutaway: bool(v.cutaway), roomNames: bool(v.roomNames), imported: v.imported === true };
  } catch {
    return NEVER; // no window (server, tests), blocked storage, or not JSON
  }
}

function write(s: Saved) {
  const out: Partial<Saved> = { imported: s.imported };
  if (s.cutaway !== null) out.cutaway = s.cutaway;
  if (s.roomNames !== null) out.roomNames = s.roomNames;
  try {
    window.localStorage.setItem(CUTAWAY_KEY, JSON.stringify({ cutaway: out.cutaway, roomNames: out.roomNames, imported: out.imported }));
  } catch {
    // blocked or full: the setting still holds for this page
  }
}

export const useCutawayStore = create<CutawayState>((set, get) => {
  const change = (patch: Partial<Saved>) => {
    set(patch);
    write(get());
  };
  return {
    ...read(),
    setCutaway: (on) => change({ cutaway: on }),
    setRoomNames: (on) => change({ roomNames: on }),
    setImported: (on) => change({ imported: on }),
  };
});

export const cutawayOn = (s: Saved) => s.cutaway ?? s.imported;
export const roomNamesOn = (s: Saved) => s.roomNames ?? cutawayOn(s);

/** Reads the saved settings into the store (once at module load; the tests call it to play a page load). */
export function restoreCutawaySettings() {
  useCutawayStore.setState(read());
}
