"use client";

/**
 * persistence.ts — wires the plan store to browser storage (the pure parts are in
 * src/lib/persist/planStorage.ts). `startPersistence()` runs once per page load:
 * it restores the last saved Plan if there is a valid one (otherwise the sample
 * plan stays), then subscribes to the plan store and hands every changed plan to
 * the debounced autosaver. It reads only `plan`, so selection, tool, 2D pan/zoom
 * and the Measure overlay are never saved, and it only calls `loadPlan` (once,
 * before anything is editable), so autosaving adds nothing to undo history.
 *
 * Called by src/app/studio/page.tsx and src/app/studio/import/page.tsx, so a
 * plan imported on the import page is saved too and not overwritten by an older
 * save when the editor opens. Connects to: src/store/planStore.ts.
 */
import { useEffect } from "react";
import { create } from "zustand";
import { browserStorage, createAutosaver, loadSavedPlan, type KeyValueStore, type SaveStatus } from "@/lib/persist/planStorage";
import { usePlanStore } from "./planStore";

/** `status` is for the small "Saved" read-out in the top bar; `ready` flips once the saved plan (if any) is in the plan store. */
export const useSaveStatus = create<{ status: SaveStatus; ready: boolean }>(() => ({ status: "idle", ready: false }));

let started = false;

/**
 * Put the saved plan into the store. False (store untouched, so the sample or
 * current plan stays) when nothing valid is saved: missing, corrupt, from another
 * schema version, or unreadable. loadPlan keeps the stored room names: it matches
 * stored rooms to the walls by loop and label point and only invents "Room N"
 * for a room it cannot match.
 */
export function restoreSavedPlan(storage: KeyValueStore): boolean {
  const saved = loadSavedPlan(storage);
  if (!saved) return false;
  usePlanStore.getState().loadPlan(saved);
  return true;
}

export function startPersistence(): void {
  if (started) return;
  started = true;
  const storage = browserStorage();
  if (!storage) {
    useSaveStatus.setState({ ready: true }); // storage blocked: the editor works, nothing is kept
    return;
  }

  // Restore first, then subscribe, so the restore itself is not written back.
  restoreSavedPlan(storage);

  const saver = createAutosaver({ storage, onStatus: (status) => useSaveStatus.setState({ status }) });
  let previous = usePlanStore.getState().plan;
  usePlanStore.subscribe((state) => {
    if (state.plan === previous) return; // undo history changes alone are not plan changes
    previous = state.plan;
    saver.schedule(state.plan);
  });

  // A change still waiting out its debounce is written when the tab is hidden or closed.
  window.addEventListener("pagehide", saver.flush);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && saver.flush());
  useSaveStatus.setState({ ready: true });
}

/**
 * True once the saved plan (if any) is in the store. Pages render the editor
 * only after this, so the 2D and 3D cameras fit the restored plan and the
 * server-rendered sample never flashes up in its place. Starts persistence.
 */
export function usePersistenceReady(): boolean {
  useEffect(() => startPersistence(), []);
  return useSaveStatus((s) => s.ready);
}
