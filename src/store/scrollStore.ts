/**
 * src/store/scrollStore.ts
 *
 * Single source of truth for scroll position across ATRIUM: one normalised
 * progress value from 0 (top of page) to 1 (bottom), written once per frame
 * by SmoothScrollProvider's Lenis "scroll" callback. Later prompts drive
 * the 3D scene camera from this value directly, instead of each component
 * computing its own window.scrollY math — one number, one writer, many
 * readers across the React/Canvas boundary.
 */
import { create } from "zustand";

interface ScrollState {
  progress: number;
  setProgress: (progress: number) => void;
}

export const useScrollStore = create<ScrollState>((set) => ({
  progress: 0,
  setProgress: (progress) => set({ progress }),
}));
