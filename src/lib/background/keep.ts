/**
 * keep.ts — at Build model, keep the imported drawing for the 2D background (step M.2c): put the
 * file's bytes in the I.1a asset store (the same SHA-256 id rule, so importing the same file twice
 * stores it once) and stamp Plan.background with its id, kind, page and mapping. Storage that is
 * off, blocked or full never stops the import: the plan comes back without a background and with
 * the note DRAWING_NOT_KEPT, which the import summary shows. Only the descriptor ever reaches the
 * plan (and so the autosave); the bytes stay in IndexedDB.
 * Connects to: src/lib/import/assetStore.ts, src/types/plan.ts; used by
 * src/app/studio/import/page.tsx; tested by scripts/test-background.ts.
 */
import type { AssetStore } from "@/lib/import/assetStore";
import type { Affine, Plan } from "@/types/plan";

export const DRAWING_NOT_KEPT = "The drawing could not be kept for the background.";

export async function keepDrawing(
  plan: Plan,
  source: { name: string; bytes: Uint8Array; kind: "pdf" | "image"; page?: number },
  mapping: Affine,
  store: AssetStore,
): Promise<{ plan: Plan; note: string | null }> {
  try {
    const assetId = await store.put(source.name, [{ name: source.name, bytes: source.bytes }]);
    const background = source.kind === "pdf" ? { assetId, kind: "pdf" as const, page: source.page ?? 1, mapping: { ...mapping } } : { assetId, kind: "image" as const, mapping: { ...mapping } };
    return { plan: { ...plan, background }, note: null };
  } catch (e) {
    console.warn("[import] the drawing was not kept", e); // the details to the console only
    return { plan, note: DRAWING_NOT_KEPT };
  }
}
