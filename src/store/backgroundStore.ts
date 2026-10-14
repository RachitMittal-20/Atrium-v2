/**
 * backgroundStore.ts — the imported drawing under the 2D plan (step M.2c), as VIEW state:
 *   - `visible` and `opacity`: how it is shown. Kept in localStorage under "atrium.background"
 *     ({ visible, opacity }), never in the plan, the autosave or the undo history. Default:
 *     shown at 50%. A missing, blocked or garbled entry gives the default.
 *   - `asset`: the drawing's bytes, read once per asset id from the I.1a asset store
 *     (IndexedDB, src/lib/import/assetCache.ts's assetStore()). "missing" when they are not
 *     there (the database was cleared, or the plan came from another browser): nothing is
 *     drawn and the panel says "Import it again to see the background".
 * What the drawing IS (asset id, kind, page, mapping) is plan data: Plan.background.
 * Connects to: src/components/plan2d/{BackgroundLayer,DrawingControls}.tsx,
 * src/components/studio/PlanPanel.tsx; tested by scripts/test-background.ts.
 */
import { create } from "zustand";
import { assetStore } from "@/lib/import/assetCache";

export const BACKGROUND_KEY = "atrium.background";
export const DEFAULT_OPACITY = 0.5;

export type DrawingStatus = "loading" | "ready" | "missing";

interface BackgroundState {
  visible: boolean;
  /** 0–1. */
  opacity: number;
  setVisible: (visible: boolean) => void;
  setOpacity: (opacity: number) => void;
  /** The drawing's bytes for the plan's asset id, once read. */
  asset: { id: string; status: DrawingStatus; bytes: Uint8Array | null } | null;
  /** Read `id`'s bytes unless they are already read or being read. Resolves when settled. */
  load: (id: string) => Promise<void>;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function read(): { visible: boolean; opacity: number } {
  const fallback = { visible: true, opacity: DEFAULT_OPACITY };
  try {
    const v = JSON.parse(window.localStorage.getItem(BACKGROUND_KEY) ?? "null");
    return {
      visible: typeof v?.visible === "boolean" ? v.visible : fallback.visible,
      opacity: typeof v?.opacity === "number" && Number.isFinite(v.opacity) ? clamp01(v.opacity) : fallback.opacity,
    };
  } catch {
    return fallback; // no window (server, tests), blocked storage, or not JSON
  }
}

function write(s: { visible: boolean; opacity: number }) {
  try {
    window.localStorage.setItem(BACKGROUND_KEY, JSON.stringify({ visible: s.visible, opacity: s.opacity }));
  } catch {
    // blocked or full: the setting still holds for this page
  }
}

export const useBackgroundStore = create<BackgroundState>((set, get) => ({
  ...read(),
  setVisible: (visible) => {
    set({ visible });
    write(get());
  },
  setOpacity: (opacity) => {
    set({ opacity: clamp01(opacity) });
    write(get());
  },
  asset: null,
  load: async (id) => {
    if (get().asset?.id === id) return;
    set({ asset: { id, status: "loading", bytes: null } });
    const stored = await assetStore()
      .get(id)
      .catch(() => null); // storage gone: the same as missing
    if (get().asset?.id !== id) return; // the plan moved on to another drawing meanwhile
    const bytes = stored?.files[0]?.bytes ?? null;
    set({ asset: { id, status: bytes ? "ready" : "missing", bytes } });
  },
}));

/** Reads the saved view settings into the store (once at module load; the tests call it to play a page load). */
export function restoreBackgroundSettings() {
  useBackgroundStore.setState(read());
}
