/**
 * assetCache.ts — one parsed scene per imported asset, for the whole session
 * (step I.1). The 3D view, the 2D footprints and the item panel all read the same
 * entry, so a model is read from IndexedDB and parsed once, however many items
 * use it and whichever view is open. Each item in 3D draws its own clone; the
 * cached original is never drawn or changed.
 *
 * States: loading, ready (the LoadedModel), missing (no bytes in the asset store:
 * the database was cleared, or the plan came from another browser) and error (the
 * bytes are there but no longer parse). The 3D view draws a grey box for the last two.
 *
 * GPU memory: every item drawn in 3D holds a reference (acquire / release). When
 * the last one goes, the original's geometries, materials and textures are disposed
 * (on the next task, so React's unmount-and-mount in development doesn't throw them
 * away mid-render). The objects stay in the cache: three uploads them again if an
 * item comes back (Undo). Never dispose while a reference is held: the clones
 * share the original's geometries and textures.
 *
 * Connects to: src/lib/import/{assetStore,loadModel}.ts; used by
 * src/components/three/ImportedItems.tsx, src/components/plan2d/PlanCanvas.tsx,
 * src/components/studio/ItemPanel.tsx and src/store/importStore.ts.
 */
import { useEffect } from "react";
import { create } from "zustand";
import type { Item } from "@/types/plan";
import { indexedDbAssetStore, type AssetStore } from "./assetStore";
import { disposeScene, ImportError, loadModel, type LoadedModel } from "./loadModel";
import type { Box } from "./model";

export type AssetState = { status: "loading" } | { status: "ready"; model: LoadedModel } | { status: "missing" } | { status: "error"; message: string };

export const useAssetCache = create<{ assets: Record<string, AssetState> }>(() => ({ assets: {} }));

/** The placeholder a missing or unreadable model is drawn as: a 1 m grey cube standing on its base point. */
export const PLACEHOLDER_BOX: Box = { min: { x: -0.5, y: 0, z: -0.5 }, max: { x: 0.5, y: 1, z: 0.5 } };

let store: AssetStore | null = null;
/** The asset store: IndexedDB, unless a test swapped in another. */
export const assetStore = (): AssetStore => (store ??= indexedDbAssetStore());
/** Tests only: use `s` (an in-memory store) and forget everything cached. */
export function setAssetStoreForTests(s: AssetStore): void {
  store = s;
  useAssetCache.setState({ assets: {} });
  refs.clear();
}

const setAsset = (id: string, state: AssetState) => useAssetCache.setState((s) => ({ assets: { ...s.assets, [id]: state } }));

/** Start loading `id` unless it is already loading, loaded, missing or broken. Resolves when it has settled. */
export async function requestAsset(id: string): Promise<void> {
  if (!id || useAssetCache.getState().assets[id]) return;
  setAsset(id, { status: "loading" });
  const stored = await assetStore()
    .get(id)
    .catch(() => null);
  if (!stored) return setAsset(id, { status: "missing" });
  try {
    setAsset(id, { status: "ready", model: await loadModel(stored.files) });
  } catch (e) {
    setAsset(id, { status: "error", message: e instanceof ImportError ? e.message : "This model couldn't be read." });
  }
}

/** A model the import dialog has just parsed, cached under its new id. False (keep using the cached one) when it is already loaded. */
export function putLoaded(id: string, model: LoadedModel): boolean {
  if (useAssetCache.getState().assets[id]?.status === "ready") return false;
  setAsset(id, { status: "ready", model });
  return true;
}

// ---------------------------------------------------------------- GPU references

const refs = new Map<string, number>();
export const refCount = (id: string) => refs.get(id) ?? 0;

export function acquire(id: string): void {
  refs.set(id, refCount(id) + 1);
}

export function release(id: string): void {
  refs.set(id, Math.max(0, refCount(id) - 1));
  if (refCount(id) > 0) return;
  setTimeout(() => {
    if (refCount(id) > 0) return; // taken again meanwhile (React's development remount, or an Undo)
    const a = useAssetCache.getState().assets[id];
    if (a?.status === "ready") disposeScene(a.model.root);
  }, 0);
}

// ---------------------------------------------------------------- hooks

/** The cache entry for `id`, loading it on first need. */
export function useAsset(id: string): AssetState {
  useEffect(() => void requestAsset(id), [id]);
  return useAssetCache((s) => s.assets[id]) ?? { status: "loading" };
}

/** Every imported item's asset, loading each on first need (the 2D plan, which has no 3D clones). */
export function useImportedAssets(items: Item[]): Record<string, AssetState> {
  const ids = [...new Set(items.flatMap((i) => (i.import ? [i.import.assetId] : [])))].join(" ");
  useEffect(() => {
    for (const id of ids.split(" ")) if (id) void requestAsset(id);
  }, [ids]);
  return useAssetCache((s) => s.assets);
}

/** True while any asset is loading: the 3D pane shows a thin progress bar. */
export const useAssetsLoading = () => useAssetCache((s) => Object.values(s.assets).some((a) => a.status === "loading"));
