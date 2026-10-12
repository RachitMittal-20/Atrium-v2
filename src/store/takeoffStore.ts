/**
 * takeoffStore.ts — the Takeoff tool's working state (step M.2a): the mode (Length, Area or
 * Wall), the points placed so far, where the next one would land, the wall line under the
 * pointer, the Left | Centre | Right choice for touch, the selected row and whether takeoffs
 * are shown. Editor state, never in the plan or the autosave and never undoable: only a
 * finished takeoff reaches the plan, through planStore.addTakeoff / updateTakeoff, one undo
 * step each, so a cancelled draft leaves history exactly as it was.
 *
 *   - Length: each click adds a snapped point; finish (double-click, Enter, Finish) with 2+.
 *   - Area: each click adds a corner; a click on the first corner, Enter or Finish closes it
 *     (3+ corners, not crossing itself). With `cutoutFor` set ("Add cutout"), the closed
 *     outline is added to that area as a cutout instead, refused when it isn't inside.
 *   - Wall: a click adds the hovered wall line (left face, centre line or right face, by the
 *     pointer's side or the forced side) over its whole straight run; Alt: one piece only.
 * Snapping (src/lib/takeoff/geometry.ts): Alt turns it off, Shift keeps the point level or
 * plumb with the previous one.
 *
 * Connects to: src/store/planStore.ts, src/lib/takeoff/{geometry,rows}.ts; driven by
 * src/components/plan2d/{PlanCanvas,TakeoffLayer}.tsx, read by
 * src/components/studio/TakeoffPanel.tsx; src/store/toolStore.ts cancels the draft when the
 * tool changes.
 */
import { create } from "zustand";
import { pointToWallDistance, wallDirection, wallLength } from "@/lib/plan/geometry";
import { areaWithCutouts, polygonArea, sideAt, snapTakeoffPoint, wallFaceLengths, NEEDS_TWO, type Pt, type Side, type SnapKind, type WallFaces } from "@/lib/takeoff/geometry";
import { nextName, wallTakeoffName } from "@/lib/takeoff/rows";
import { usePlanStore } from "./planStore";

export type TakeoffMode = "length" | "area" | "wall";

/** Pointer tolerances in screen pixels: a finger gets 44 px. */
export const SNAP_PX = 12;
export const WALL_PX = 8;
export const TOUCH_PX = 44;
/** A wall's centre line is the middle quarter of its thickness, or this many pixels, whichever is wider. */
export const CENTRE_PX = 3;
/** A point this close to the last one is the second click of a double-click, not a new point. */
const SAME_POINT_M = 0.005;

/** Where a pointer is, in plan metres, and what it is: `px` is metres per screen pixel. */
export interface TakeoffPointer {
  at: Pt;
  px: number;
  touch: boolean;
  alt: boolean;
  shift: boolean;
}

export interface WallHover {
  wallId: string;
  side: Side;
  run: boolean;
  faces: WallFaces;
}

interface TakeoffState {
  mode: TakeoffMode;
  /** Forced by the Left | Centre | Right toggle (the touch path); null: the pointer's side decides. */
  wallSide: Side | null;
  draft: Pt[];
  /** Drawing a cutout for this area takeoff. */
  cutoutFor: string | null;
  /** Where the next point would land (mouse hover). */
  hover: { point: Pt; kind: SnapKind } | null;
  wallHover: WallHover | null;
  selectedId: string | null;
  show: boolean;
  message: string | null;
  setMode: (mode: TakeoffMode) => void;
  setWallSide: (side: Side | null) => void;
  select: (id: string | null) => void;
  setShow: (show: boolean) => void;
  pointer: (p: TakeoffPointer) => void;
  leave: () => void;
  click: (p: TakeoffPointer) => void;
  finish: () => void;
  undoPoint: () => void;
  cancel: () => void;
  startCutout: (id: string) => void;
}

const plan = () => usePlanStore.getState().plan;
const near = (p: Pt, q: Pt, tol: number) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol;

/** Where a Length or Area point lands for this pointer. */
function landing(draft: Pt[], p: TakeoffPointer) {
  const last = draft[draft.length - 1] ?? null;
  return snapTakeoffPoint(plan(), p.at, (p.touch ? TOUCH_PX : SNAP_PX) * p.px, { snap: !p.alt, orthoFrom: p.shift ? last : null }).value!;
}

/** The wall line under the pointer: the nearest wall whose band (half its thickness + the tolerance) holds it. */
export function wallAt(p: TakeoffPointer, forced: Side | null): WallHover | null {
  const pl = plan();
  const at = { x: p.at[0], y: p.at[1] };
  const pad = (p.touch ? TOUCH_PX : WALL_PX) * p.px;
  let best: { id: string; gap: number } | null = null;
  for (const w of pl.walls) {
    if (wallLength(w) === 0) continue;
    const gap = pointToWallDistance(at, w) - w.thickness / 2;
    if (gap <= pad && (!best || gap < best.gap)) best = { id: w.id, gap };
  }
  if (!best) return null;
  const w = pl.walls.find((x) => x.id === best.id)!;
  const dir = wallDirection(w);
  const s = (at.x - w.a.x) * -dir.y + (at.y - w.a.y) * dir.x; // signed distance along the left normal (-dy, dx)
  const side = forced ?? sideAt(s, w.thickness, CENTRE_PX * p.px);
  const faces = wallFaceLengths(pl, w.id, { run: !p.alt });
  return faces.ok ? { wallId: w.id, side, run: !p.alt, faces: faces.value } : null;
}

export const useTakeoffStore = create<TakeoffState>((set, get) => ({
  mode: "length",
  wallSide: null,
  draft: [],
  cutoutFor: null,
  hover: null,
  wallHover: null,
  selectedId: null,
  show: true,
  message: null,

  setMode: (mode) => set({ mode, draft: [], cutoutFor: null, hover: null, wallHover: null, message: null }),
  setWallSide: (wallSide) => set((s) => ({ wallSide, wallHover: s.wallHover && wallSide ? { ...s.wallHover, side: wallSide } : s.wallHover })),
  select: (selectedId) => set({ selectedId }),
  setShow: (show) => set({ show }),

  pointer: (p) => {
    const { mode, draft, wallSide } = get();
    if (mode === "wall") set({ wallHover: wallAt(p, wallSide), hover: null });
    else {
      const l = landing(draft, p);
      set({ hover: { point: l.point, kind: l.kind }, wallHover: null });
    }
  },
  leave: () => set({ hover: null, wallHover: null }),

  click: (p) => {
    const { mode, draft, wallSide } = get();
    if (mode === "wall") {
      const hit = wallAt(p, wallSide);
      if (!hit) {
        set({ message: "Click or tap a wall to measure it", wallHover: null });
        return;
      }
      const id = usePlanStore.getState().addTakeoff({ name: wallTakeoffName(plan(), hit.wallId, hit.side), kind: "length", points: hit.faces.lines[hit.side] });
      set({ selectedId: id, message: null, wallHover: hit });
      return;
    }
    const l = landing(draft, p);
    if (mode === "area" && draft.length >= 3 && near(l.point, draft[0], (p.touch ? TOUCH_PX : SNAP_PX) * p.px)) {
      get().finish(); // a click on the first corner closes the outline
      return;
    }
    if (draft.length && near(l.point, draft[draft.length - 1], SAME_POINT_M)) return; // the second click of a double-click
    set({ draft: [...draft, l.point], hover: { point: l.point, kind: l.kind }, message: null });
  },

  finish: () => {
    const { mode, draft, cutoutFor } = get();
    if (mode === "wall") return;
    const store = usePlanStore.getState();
    if (mode === "length") {
      if (draft.length < 2) {
        set({ message: NEEDS_TWO });
        return;
      }
      const id = store.addTakeoff({ name: nextName(plan().takeoffs ?? [], "length"), kind: "length", points: draft });
      set({ draft: [], selectedId: id, message: null });
      return;
    }
    const area = polygonArea(draft);
    if (!area.ok) {
      set({ message: area.reason }); // the draft stays: Undo point or Cancel
      return;
    }
    if (cutoutFor) {
      const host = plan().takeoffs?.find((t) => t.id === cutoutFor);
      if (!host) {
        set({ draft: [], cutoutFor: null });
        return;
      }
      const cutouts = [...(host.cutouts ?? []), draft];
      const check = areaWithCutouts(host.points, cutouts);
      if (!check.ok) {
        set({ message: check.reason });
        return;
      }
      store.updateTakeoff(host.id, { cutouts });
      set({ draft: [], cutoutFor: null, selectedId: host.id, message: null });
      return;
    }
    const id = store.addTakeoff({ name: nextName(plan().takeoffs ?? [], "area"), kind: "area", points: draft });
    set({ draft: [], selectedId: id, message: null });
  },
  undoPoint: () => set((s) => ({ draft: s.draft.slice(0, -1), message: null })),
  cancel: () => set({ draft: [], cutoutFor: null, message: null }),
  startCutout: (id) => set({ mode: "area", cutoutFor: id, draft: [], selectedId: id, message: null, wallHover: null }),
}));

/** A selected takeoff that leaves the plan (deleted, undone away) is no longer selected; a cutout's host likewise. */
usePlanStore.subscribe((state) => {
  const { selectedId, cutoutFor } = useTakeoffStore.getState();
  const has = (id: string | null) => id !== null && (state.plan.takeoffs ?? []).some((t) => t.id === id);
  if (selectedId !== null && !has(selectedId)) useTakeoffStore.setState({ selectedId: null });
  if (cutoutFor !== null && !has(cutoutFor)) useTakeoffStore.setState({ cutoutFor: null, draft: [] });
});

// Development only: lets scripts/e2e-takeoff.ts read the mode and the draft (never written by the test).
if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
  (window as unknown as { __takeoffStore?: typeof useTakeoffStore }).__takeoffStore = useTakeoffStore;
}
