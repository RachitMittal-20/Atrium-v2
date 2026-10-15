/**
 * drawingSnapStore.ts — the original drawing's snap index for the Takeoff tool (step P.1).
 * View state: never in the plan, its history or the autosave.
 *
 *   - `ensure(background)` is called when the Takeoff tool shows (TakeoffBar). For a PDF
 *     background it reads the bytes through the background store (the I.1a asset store, as the
 *     drawing under the plan does), then a separate instance of src/workers/background.worker.ts
 *     extracts the page and builds src/lib/pdf/snapIndex.ts's index OFF the main thread, and is
 *     terminated after its one reply. Until then the status is "loading" with READING_DRAWING,
 *     and takeoff clicks use the walls' snaps only: nothing waits for it.
 *   - "disabled" with NEEDS_VECTOR: an image background, a missing file, a scanned page or a
 *     worker that failed. "none": no background. "ready": the index, and its cap note if any.
 *   - One index per asset id and page, cached for the session. When the plan's background is
 *     cleared or replaced, the cached index for any other drawing is released.
 * Read by src/store/takeoffStore.ts (`drawingSource`) and src/components/plan2d/TakeoffLayer.tsx.
 */
import { create } from "zustand";
import { NEEDS_VECTOR, READING_DRAWING, type SnapIndex } from "@/lib/pdf/snapIndex";
import type { Background } from "@/types/plan";
import type { BackgroundReply, BackgroundRequest } from "@/workers/background.worker";
import { useBackgroundStore } from "./backgroundStore";
import { usePlanStore } from "./planStore";

export type DrawingSnapStatus = "none" | "loading" | "ready" | "disabled";

interface DrawingSnapState {
  /** Which drawing the state is about (`keyOf`), null with no background. */
  key: string | null;
  status: DrawingSnapStatus;
  index: SnapIndex | null;
  /** What the Takeoff bar says, or null. */
  note: string | null;
  /** How long the worker took to read the page and build the index. */
  ms: number | null;
  ensure: (background: Background | undefined) => void;
}

export const keyOf = (b: Background) => `${b.kind}:${b.assetId}#${b.page ?? 1}`;

const cache = new Map<string, { index: SnapIndex; ms: number }>();

/** The drawing's bytes, once the background store has settled on them; null when missing. */
async function bytesOf(id: string): Promise<Uint8Array | null> {
  const bg = useBackgroundStore;
  await bg.getState().load(id); // returns at once when this id is already loaded or being loaded
  const settled = () => {
    const a = bg.getState().asset;
    return a?.id === id && a.status !== "loading" ? a : a?.id !== id ? { status: "missing" as const, bytes: null } : null;
  };
  const now = settled();
  if (now) return now.bytes;
  return new Promise((resolve) => {
    const stop = bg.subscribe(() => {
      const a = settled();
      if (!a) return;
      stop();
      resolve(a.bytes);
    });
  });
}

/** The index built in a worker of its own (terminated after the reply); null for a scanned page. */
function indexInWorker(bytes: Uint8Array, page: number): Promise<{ index: SnapIndex | null; ms: number }> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("../workers/background.worker.ts", import.meta.url), { type: "module" });
    const done = () => w.terminate();
    w.onmessage = (e: MessageEvent<BackgroundReply>) => {
      const msg = e.data;
      if (!msg || typeof msg !== "object" || "sourceName" in msg) return; // pdf.js's own handshake
      done();
      if (msg.type === "index") resolve({ index: msg.index, ms: msg.ms });
      else reject(new Error(msg.type === "error" ? msg.message : "unexpected reply"));
    };
    w.onerror = (e) => {
      done();
      reject(e);
    };
    const copy = bytes.slice().buffer; // the background store keeps its own copy; this one is transferred
    w.postMessage({ type: "index", bytes: copy, page } satisfies BackgroundRequest, [copy]);
  });
}

export const useDrawingSnapStore = create<DrawingSnapState>((set, get) => {
  const disable = (key: string) => set({ key, status: "disabled", index: null, note: NEEDS_VECTOR, ms: null });

  async function load(b: Background, key: string) {
    const bytes = await bytesOf(b.assetId);
    if (get().key !== key) return; // the drawing changed meanwhile
    if (!bytes) return disable(key);
    let built: { index: SnapIndex | null; ms: number } | null = null;
    try {
      built = await indexInWorker(bytes, b.page ?? 1);
    } catch (err) {
      console.warn("[drawing snap]", err); // details to the console only
    }
    if (get().key !== key) return;
    if (!built?.index) return disable(key);
    cache.set(key, { index: built.index, ms: built.ms });
    set({ status: "ready", index: built.index, note: built.index.note, ms: built.ms });
  }

  return {
    key: null,
    status: "none",
    index: null,
    note: null,
    ms: null,
    ensure: (b) => {
      if (!b) {
        set({ key: null, status: "none", index: null, note: null, ms: null });
        return;
      }
      const key = keyOf(b);
      if (get().key === key) return; // loading, ready or disabled already
      if (b.kind !== "pdf") return disable(key);
      const hit = cache.get(key);
      if (hit) {
        set({ key, status: "ready", index: hit.index, note: hit.index.note, ms: hit.ms });
        return;
      }
      set({ key, status: "loading", index: null, note: READING_DRAWING, ms: null });
      void load(b, key);
    },
  };
});

// Memory: the moment the plan's drawing is cleared or replaced, other drawings' indexes go.
usePlanStore.subscribe((state) => {
  const want = state.plan.background ? keyOf(state.plan.background) : null;
  for (const k of [...cache.keys()]) if (k !== want) cache.delete(k);
  if (useDrawingSnapStore.getState().key !== want) useDrawingSnapStore.setState({ key: null, status: "none", index: null, note: null, ms: null });
});
