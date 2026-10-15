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
 * plumb with the previous one. Step P.1: once src/store/drawingSnapStore.ts has the plan's vector
 * PDF indexed, its corners, ends, midpoints and lines are snap targets too (DRAWING_PX, a finger
 * TOUCH_PX), and the draft remembers which drawing point each click landed on (`draftSnaps`), so
 * the finished takeoff stores it per point (`Takeoff.drawingSnaps`).
 *
 * Connects to: src/store/planStore.ts, src/lib/takeoff/{geometry,rows}.ts; driven by
 * src/components/plan2d/{PlanCanvas,TakeoffLayer}.tsx, read by
 * src/components/studio/TakeoffPanel.tsx; src/store/toolStore.ts cancels the draft when the
 * tool changes.
 */
import { create } from "zustand";
import { pointToWallDistance, wallDirection, wallLength } from "@/lib/plan/geometry";
import { areaWithCutouts, drawingKindOf, polygonArea, sideAt, snapTakeoffPoint, wallFaceLengths, NEEDS_TWO, type DrawingSource, type Pt, type Side, type SnapKind, type WallFaces } from "@/lib/takeoff/geometry";
import { nextName, wallTakeoffName } from "@/lib/takeoff/rows";
import type { DrawingSnapKind } from "@/types/plan";
import { keyOf, useDrawingSnapStore } from "./drawingSnapStore";
import { usePlanStore } from "./planStore";

export type TakeoffMode = "length" | "area" | "wall";

/** Pointer tolerances in screen pixels: a finger gets 44 px. */
export const SNAP_PX = 12;
export const WALL_PX = 8;
export const TOUCH_PX = 44;
/** The drawing's own points and lines (step P.1) reach a little further for a mouse; a finger still gets TOUCH_PX. */
export const DRAWING_PX = 14;
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
  /** For each draft point, the drawing point it snapped to (step P.1), or null. */
  draftSnaps: (DrawingSnapKind | null)[];
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

/** The plan's vector PDF as a snap source, once its index is ready for THIS background; else null (the walls' snaps only). */
export function drawingSource(p: Pick<TakeoffPointer, "px" | "touch">): DrawingSource | null {
  const bg = plan().background;
  const s = useDrawingSnapStore.getState();
  if (!bg || s.status !== "ready" || !s.index || s.key !== keyOf(bg)) return null;
  return { index: s.index, mapping: bg.mapping, tolerance: (p.touch ? TOUCH_PX : DRAWING_PX) * p.px };
}

/** Where a Length or Area point lands for this pointer. */
function landing(draft: Pt[], p: TakeoffPointer) {
  const last = draft[draft.length - 1] ?? null;
  return snapTakeoffPoint(plan(), p.at, (p.touch ? TOUCH_PX : SNAP_PX) * p.px, { snap: !p.alt, orthoFrom: p.shift ? last : null, drawing: drawingSource(p) }).value!;
}

/** The per-point drawing kinds to store, or nothing when no point snapped to the drawing. */
const snapsToStore = (snaps: (DrawingSnapKind | null)[]) => (snaps.some((k) => k !== null) ? { drawingSnaps: snaps } : {});

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
  draftSnaps: [],
  cutoutFor: null,
  hover: null,
  wallHover: null,
  selectedId: null,
  show: true,
  message: null,

  setMode: (mode) => set({ mode, draft: [], draftSnaps: [], cutoutFor: null, hover: null, wallHover: null, message: null }),
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
    const { mode, draft, draftSnaps, wallSide } = get();
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
    // A Shift-held point keeps one coordinate of the previous point, so it is no longer the drawing's point.
    set({ draft: [...draft, l.point], draftSnaps: [...draftSnaps, l.ortho ? null : drawingKindOf(l.kind)], hover: { point: l.point, kind: l.kind }, message: null });
  },

  finish: () => {
    const { mode, draft, draftSnaps, cutoutFor } = get();
    if (mode === "wall") return;
    const store = usePlanStore.getState();
    if (mode === "length") {
      if (draft.length < 2) {
        set({ message: NEEDS_TWO });
        return;
      }
      const id = store.addTakeoff({ name: nextName(plan().takeoffs ?? [], "length"), kind: "length", points: draft, ...snapsToStore(draftSnaps) });
      set({ draft: [], draftSnaps: [], selectedId: id, message: null });
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
        set({ draft: [], draftSnaps: [], cutoutFor: null });
        return;
      }
      const cutouts = [...(host.cutouts ?? []), draft];
      const check = areaWithCutouts(host.points, cutouts);
      if (!check.ok) {
        set({ message: check.reason });
        return;
      }
      store.updateTakeoff(host.id, { cutouts });
      set({ draft: [], draftSnaps: [], cutoutFor: null, selectedId: host.id, message: null });
      return;
    }
    const id = store.addTakeoff({ name: nextName(plan().takeoffs ?? [], "area"), kind: "area", points: draft, ...snapsToStore(draftSnaps) });
    set({ draft: [], draftSnaps: [], selectedId: id, message: null });
  },
  undoPoint: () => set((s) => ({ draft: s.draft.slice(0, -1), draftSnaps: s.draftSnaps.slice(0, -1), message: null })),
  cancel: () => set({ draft: [], draftSnaps: [], cutoutFor: null, message: null }),
  startCutout: (id) => set({ mode: "area", cutoutFor: id, draft: [], draftSnaps: [], selectedId: id, message: null, wallHover: null }),
}));

/** A selected takeoff that leaves the plan (deleted, undone away) is no longer selected; a cutout's host likewise. */
usePlanStore.subscribe((state) => {
  const { selectedId, cutoutFor } = useTakeoffStore.getState();
  const has = (id: string | null) => id !== null && (state.plan.takeoffs ?? []).some((t) => t.id === id);
  if (selectedId !== null && !has(selectedId)) useTakeoffStore.setState({ selectedId: null });
  if (cutoutFor !== null && !has(cutoutFor)) useTakeoffStore.setState({ cutoutFor: null, draft: [], draftSnaps: [] });
});

// Development only: lets scripts/e2e-takeoff.ts read the mode and the draft (never written by the test).
if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
  (window as unknown as { __takeoffStore?: typeof useTakeoffStore }).__takeoffStore = useTakeoffStore;
}
