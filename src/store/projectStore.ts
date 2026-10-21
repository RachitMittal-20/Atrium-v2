"use client";

/**
 * projectStore.ts — saving and opening a project file (step E.1; the format is
 * src/lib/persist/projectFile.ts). Three things live here, none of them in the Plan:
 *   - the "saved" baseline: the plan as it was at the last Save, Open, or app start (the sample).
 *     `isDirty()` is true when the plan is anything else, so Open can ask before it replaces work
 *     that was never written to a file. Undoing back to the saved state still counts as unsaved
 *     (plans are compared by identity, which is cheap and errs on the side of asking);
 *   - `saveProject`: the file's text, with the assets the plan names read from the asset store
 *     (a name the store no longer has is left out and counted in `missing`);
 *   - `openProject`: read, then write assets to the store by content hash, then replace the plan
 *     as one undo step. The assets are written only after the whole file has checked out, and the
 *     plan only after they are in, so a refusal or a full disk changes nothing.
 * View settings are never touched. Connects to: planStore, src/lib/import/assetCache.ts (the
 * store and the model cache), backgroundStore; used by src/components/studio/ProjectDialog.tsx.
 */
import { create } from "zustand";
import { assetStore, useAssetCache } from "@/lib/import/assetCache";
import type { StoredAsset } from "@/lib/import/assetStore";
import { buildProject, checkProjectSize, estimateProjectBytes, readProject, referencedAssetIds } from "@/lib/persist/projectFile";
import type { Plan } from "@/types/plan";
import { useBackgroundStore } from "./backgroundStore";
import { usePlanStore } from "./planStore";

/** `epoch` goes up each time a file is opened, so the studio can remount its panes and fit both cameras to the new plan. */
export const useProjectStore = create<{ saved: Plan; epoch: number }>(() => ({ saved: usePlanStore.getState().plan, epoch: 0 }));

/** Mark the current plan as the one in the file on disk (after Save or Open). */
export function markSaved(): void {
  useProjectStore.setState({ saved: usePlanStore.getState().plan });
}

/** True when the plan has changed since the last Save or Open (or since the app started). */
export const isDirty = (): boolean => usePlanStore.getState().plan !== useProjectStore.getState().saved;

/** The assets the plan names, as the store has them, and how many it no longer has. */
async function gather(plan: Plan): Promise<{ assets: StoredAsset[]; missing: number }> {
  const found = await Promise.all(referencedAssetIds(plan).map((id) => assetStore().get(id)));
  return { assets: found.filter((a): a is StoredAsset => a !== null), missing: found.filter((a) => a === null).length };
}

/** What the Save dialog shows before saving: how many files could go in and about how large the file will be, with and without them. */
export async function projectSizes(): Promise<{ withAssets: number; without: number; count: number; missing: number }> {
  const plan = usePlanStore.getState().plan;
  const ids = referencedAssetIds(plan);
  const listed = new Map((await assetStore().list().catch(() => [])).map((a) => [a.id, a.bytes]));
  const have = ids.filter((id) => listed.has(id));
  return {
    // per-file overhead is a few hundred bytes: not worth reading the bytes to count files
    withAssets: estimateProjectBytes(plan, have.map((id) => ({ files: 1, bytes: listed.get(id)! }))),
    without: estimateProjectBytes(plan, []),
    count: have.length,
    missing: ids.length - have.length,
  };
}

/** The file's text for the current plan; marks the plan as saved. Pass `now` only in tests. */
export async function saveProject(includeAssets: boolean, now?: Date): Promise<{ text: string; missing: number }> {
  const plan = usePlanStore.getState().plan;
  const { assets, missing } = includeAssets ? await gather(plan) : { assets: [], missing: 0 };
  const text = buildProject(plan, assets, now);
  markSaved();
  return { text, missing };
}

export type OpenResult = { ok: true } | { ok: false; error: string };

/** A picked file, or anything shaped like one. */
export interface PickedFile {
  size: number;
  text(): Promise<string>;
}

/** Open a project file. The caller has already asked about unsaved changes. Never throws; on any refusal nothing has changed. */
export async function openProject(file: PickedFile): Promise<OpenResult> {
  const tooBig = checkProjectSize(file.size);
  if (tooBig) return { ok: false, error: tooBig }; // by size alone: the file is never read
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: "This file couldn't be read, so nothing was opened." };
  }
  const read = await readProject(text, file.size);
  if (!read.ok) return read;
  try {
    for (const a of read.assets) await assetStore().put(a.name, a.files); // by content hash: the same bytes are stored once
  } catch (e) {
    console.warn("[project] the files were not stored", e); // details to the console only
    return { ok: false, error: "The files in this project couldn't be stored in this browser (storage may be off or full), so it wasn't opened." };
  }
  // A model or drawing that was "missing" a moment ago may be in the store now: let both views look again.
  const gone = new Set(read.assets.map((a) => a.id));
  useAssetCache.setState((s) => ({ assets: Object.fromEntries(Object.entries(s.assets).filter(([id, a]) => !(gone.has(id) && a.status !== "ready"))) }));
  useBackgroundStore.setState((s) => (s.asset && gone.has(s.asset.id) && s.asset.status !== "ready" ? { asset: null } : s));
  usePlanStore.getState().replacePlan(read.plan);
  useProjectStore.setState((s) => ({ saved: usePlanStore.getState().plan, epoch: s.epoch + 1 }));
  return { ok: true };
}
