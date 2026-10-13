/**
 * calibrateStore.ts — the Set scale flow's working state (step M.2b): whether the 2D plan is
 * waiting for the two points, the points placed so far, and where the next one would land.
 * Editor state, never in the plan, never saved and never undoable: only Apply reaches the plan,
 * through planStore.calibratePlan (one undo step), so Escape or Cancel leaves history exactly
 * as it was.
 *
 * It is NOT a tool (src/store/toolStore.ts): it is started from the Takeoff panel's
 * "Set scale…" button or the link beside the 2D scale bar, and while it is picking, PlanCanvas
 * handles presses before any tool does — so no wall, opening or model is picked, hovered or
 * dragged, while a drag still pans and two fingers still pinch. Points snap exactly as a
 * takeoff's do (src/lib/takeoff/geometry.ts snapTakeoffPoint): face corners, wall ends, jambs,
 * midpoints, else the 5 cm grid; Alt keeps the point as it is.
 *
 * Connects to: src/lib/plan/calibrate.ts (the maths), src/store/planStore.ts; driven by
 * src/components/plan2d/PlanCanvas.tsx and src/components/studio/CalibrateDialog.tsx;
 * src/app/studio/page.tsx brings the 2D plan up when picking starts.
 */
import { create } from "zustand";
import { snapTakeoffPoint, type Pt, type SnapKind } from "@/lib/takeoff/geometry";
import { usePlanStore } from "./planStore";
import type { TakeoffPointer } from "./takeoffStore";
import { SNAP_PX, TOUCH_PX } from "./takeoffStore";

interface CalibrateState {
  /** True from "Set scale…" until the two points are in, Escape, or Cancel. */
  picking: boolean;
  points: Pt[];
  /** Where the next point would land (mouse hover). */
  hover: { point: Pt; kind: SnapKind } | null;
  /** Set once both points are in: the dialog is open. */
  asking: boolean;
  start: () => void;
  pointer: (p: TakeoffPointer) => void;
  leave: () => void;
  click: (p: TakeoffPointer) => void;
  /** Escape, Cancel, or Apply: everything goes, history untouched. */
  cancel: () => void;
}

/** Where a calibration click lands: the takeoff snaps, Alt for none. */
const landing = (p: TakeoffPointer) =>
  snapTakeoffPoint(usePlanStore.getState().plan, p.at, (p.touch ? TOUCH_PX : SNAP_PX) * p.px, { snap: !p.alt }).value!;

export const useCalibrateStore = create<CalibrateState>((set, get) => ({
  picking: false,
  points: [],
  hover: null,
  asking: false,

  start: () => set({ picking: true, points: [], hover: null, asking: false }),
  pointer: (p) => {
    if (!get().picking || get().asking) return;
    const l = landing(p);
    set({ hover: { point: l.point, kind: l.kind } });
  },
  leave: () => set({ hover: null }),
  click: (p) => {
    const { picking, asking, points } = get();
    if (!picking || asking) return;
    const l = landing(p);
    const next = [...points, l.point].slice(-2);
    // Two points in: stop picking and ask for the true distance.
    set({ points: next, hover: { point: l.point, kind: l.kind }, asking: next.length === 2 });
  },
  cancel: () => set({ picking: false, points: [], hover: null, asking: false }),
}));

// Development only: lets scripts/e2e-calibrate.ts read the picked points (never written by the test).
if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
  (window as unknown as { __calibrateStore?: typeof useCalibrateStore }).__calibrateStore = useCalibrateStore;
}
