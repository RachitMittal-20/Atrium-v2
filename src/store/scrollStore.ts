/*
 * src/store/scrollStore.ts
 *
 * App-wide scroll state (from Atrium v1, extended for v2).
 *  - progress: normalised page scroll 0–1, published every frame by
 *    SmoothScrollProvider so 3D scenes can read scroll without listeners.
 *  - lenis: the live Lenis instance (null under reduced motion), so buttons
 *    like "Step inside" can glide to a position through the same smooth
 *    scroller instead of fighting it with window.scrollTo.
 */
import { create } from "zustand";
import type Lenis from "lenis";

interface ScrollState {
  progress: number;
  setProgress: (progress: number) => void;
  lenis: Lenis | null;
  setLenis: (lenis: Lenis | null) => void;
}

export const useScrollStore = create<ScrollState>((set) => ({
  progress: 0,
  setProgress: (progress) => set({ progress }),
  lenis: null,
  setLenis: (lenis) => set({ lenis }),
}));

/** Smoothly scroll to an absolute page offset, via Lenis when it's running. */
export function scrollToOffset(top: number) {
  const { lenis } = useScrollStore.getState();
  if (lenis) lenis.scrollTo(top, { duration: 1.8 });
  else window.scrollTo({ top, behavior: "auto" }); // reduced motion: jump, no animation
}
