/**
 * pushPullStore.ts — the state of the 3D Push/Pull and Move tools (steps 4.7a,
 * 4.7b and 4.7c): which face or corner the pointer is over, the pull, move or
 * corner drag in progress, and the typed-distance field. Editor state like
 * selectionStore and toolStore: never in the plan, never undoable, never saved.
 * Hovering never touches the selection store; committing a pull or move of a door
 * or window selects that opening, so the OpeningPanel shows its exact numbers.
 *
 * A pull edits the plan LIVE so the 3D model follows the pointer, and keeps
 * history at exactly one entry the way a 2D drag does (see planStore.rollback):
 * every update rolls the previous preview back and applies the whole pull again
 * from the plan as it was at the start, in one transaction. So a commit leaves
 * one undo step, and Escape is a bare rollback that leaves history as it was
 * (as with a 2D drag, starting an edit has already dropped any redo steps).
 *
 * `kind` is the active tool: "pull" (Push/Pull: a wall top, a wall side, a free
 * wall end, or a door's or window's side, top or sill) or "move" (Move: a door or
 * window slides along its wall, a wall run slides sideways, a corner is dragged on
 * the floor). A face that can't be pulled can still be hovered, but `begin` refuses
 * it with the reason (pushpull.faceBlock: "A door stays on the floor", over a wall
 * top in Move "Pull the top with Push/Pull", a hidden wall end).
 * Shift on a wall side moves the run instead of thickening it (tracked like Alt).
 * A corner drag takes a ground point, not a distance (`moveCorner`), and has no
 * typed distance: exact lengths are typed in the wall panel.
 *
 * Connects to: src/lib/plan/pushpull.ts (the rules), src/store/{planStore,selectionStore}.ts;
 * driven by src/components/three/PushPullTool.tsx and read by
 * src/components/studio/PushPullOverlay.tsx and src/components/three/PlanModel.tsx.
 * The dev-only window.__pushPullDebug is set up in src/store/toolStore.ts.
 */
import { create } from "zustand";
import {
  dragCorner,
  faceBlock,
  isEndRole,
  isOpeningRole,
  isSideRole,
  parseSignedDistance,
  pullOpening,
  pullWallEnd,
  pullWallSide,
  pullWallTop,
  snapPull,
  type CornerPull,
  type FaceRef,
  type OpeningPull,
  type TopPull,
  type WallPull,
} from "@/lib/plan/pushpull";
import type { Plan, Vec2 } from "@/types/plan";
import { usePlanStore } from "./planStore";
import { useSelectionStore } from "./selectionStore";

/** A face of a wall mesh: the wall, what part of it, and for opening faces which opening. */
export type Face = FaceRef;
export type PullKind = "pull" | "move";
/** A screen segment in the 3D pane's own pixels: the grabbed edge or corner, drawn 3 px wide by the overlay. */
export interface EdgeSeg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
/** A joint of the plan the Move tool can drag: one wall end there (dragEndpoint carries the rest). */
export interface CornerRef {
  wallId: string;
  end: "a" | "b";
  point: Vec2;
}

/** The pull (or move, or corner drag) in progress. */
export interface Pull {
  face: Face;
  kind: PullKind;
  /** Alt: only the picked piece of a straight wall (a wall top), and no snapping. */
  onlyPiece: boolean;
  /** Shift: a wall side moves the whole run sideways instead of thickening it. */
  shift: boolean;
  /** The plan as it was when the pull began: every preview is computed from it. */
  baseline: Plan;
  /** How the pull ends: "drag" on release, "click" on the next click. */
  mode: "drag" | "click";
  /** The distance asked for (snapped, from the pointer or typed), and what the rules made of it. */
  distance: number;
  result: TopPull | null;
  opening: OpeningPull | null;
  wall: WallPull | null;
  /** A corner drag (Move): the joint, where the pointer put it, and what the rules made of that. */
  corner: CornerRef | null;
  cornerTo: Vec2 | null;
  cornerResult: CornerPull | null;
  /** Move: which way the pointer last moved along the wall (+1 towards its b end). A typed distance goes this way. */
  direction: 1 | -1;
  /** Move: how far (m) the midpoint or corner snap reaches, from the camera's scale at the grab. */
  radius: number;
  /** True while a preview edit sits on top of history, ready to roll back. */
  live: boolean;
}

interface PushPullState {
  /** The active 3D tool, set by PushPullTool. */
  kind: PullKind;
  hover: Face | null;
  /** The corner the pointer is over (Move), or the one being dragged. */
  corner: CornerRef | null;
  /** The opening edge or corner line the pointer is on, when the hover came from a band. */
  edge: EdgeSeg | null;
  /** A small marker at the corner's foot (or the snapped point while dragging), in the pane's pixels. */
  marker: { x: number; y: number } | null;
  pull: Pull | null;
  /** The typed-distance text; the pointer is ignored while there is any. */
  typed: string;
  /** The 3D pane's one-line message: why a face can't be pulled, or why typing was not understood. */
  message: string | null;
  /** The pointer, in the 3D pane's own pixels, for the label next to it. */
  pointer: { x: number; y: number } | null;
  /** The touch "123" button has opened the field. */
  fieldOpen: boolean;
  /** Alt is held (tracked here so a typed distance knows the scope). */
  alt: boolean;
  /** Shift is held (a wall side then moves instead of thickening). */
  shift: boolean;

  setKind: (kind: PullKind) => void;
  setHover: (face: Face | null, edge?: EdgeSeg | null) => void;
  /** Hover a corner (Move); clears any face hover. */
  setCorner: (corner: CornerRef | null, edge?: EdgeSeg | null, marker?: { x: number; y: number } | null) => void;
  setEdge: (edge: EdgeSeg | null, marker?: { x: number; y: number } | null) => void;
  setPointer: (p: { x: number; y: number } | null) => void;
  setAlt: (alt: boolean) => void;
  setShift: (shift: boolean) => void;
  openField: (open: boolean) => void;
  /** Start pulling `face`. False, with the reason and nothing changed, when it can't be pulled. `radius`: Move's midpoint snap reach. */
  begin: (face: Face, opts: { mode: "drag" | "click"; onlyPiece?: boolean; shift?: boolean; radius?: number }) => boolean;
  /** Start dragging a corner (Move only). `radius`: the snap reach in metres. */
  beginCorner: (corner: CornerRef, opts: { radius: number }) => boolean;
  /** The pointer moved to `distance` metres along the face's axis (+ = bigger, or outward; towards b for an opening's move). Ignored while typing. */
  move: (distance: number) => void;
  /** The pointer put the dragged corner at `to` (plan metres, before snapping). */
  moveCorner: (to: Vec2) => void;
  /** Make the pull a click-move-click pull (the press came up as a click). */
  armClick: () => void;
  setTyped: (text: string) => void;
  /** Enter: apply the typed distance exactly and finish. False when the text is not a distance or nothing is being pulled. */
  applyTyped: () => boolean;
  /** Finish: keep the previewed edit as the one undo step. */
  commit: () => void;
  /** Escape, pointercancel, blur, a second finger: take the preview back; history is as it was. */
  cancel: () => void;
}

export const TYPE_HINT = "Type a distance like 0.3, 30 cm or 1 ft, then Enter.";
export const CORNER_TYPE_HINT = "Type exact lengths in the wall panel";

// The history entry the live preview made (module-level: nothing renders from it). A rollback is only done
// while it is still the newest entry, so an undo or any other edit made mid-pull is never undone twice.
let liveEntry: unknown = null;
function rollbackPreview() {
  const s = usePlanStore.getState();
  if (liveEntry !== null && s.past[s.past.length - 1] === liveEntry) s.rollback();
  liveEntry = null;
}

/** What the rules make of `distance` for this pull. `exact` (typed) skips the 5 cm snap; Alt does too. */
function compute(pull: Pull, distance: number, exact: boolean): TopPull | OpeningPull | WallPull | null {
  const { face, baseline } = pull;
  const d = exact ? distance : snapPull(distance, pull.onlyPiece);
  if (face.openingId) {
    if (pull.kind === "move") return pullOpening(baseline, face.openingId, "move", distance, { radius: pull.radius, free: exact || pull.onlyPiece });
    return isOpeningRole(face.role) ? pullOpening(baseline, face.openingId, face.role, d) : null;
  }
  if (isSideRole(face.role)) return pullWallSide(baseline, face.wallId, face.role, d, { move: pull.kind === "move" || pull.shift });
  if (pull.kind === "move") return null; // a wall top or end: Move refuses them (faceBlock)
  if (face.role === "top") return pullWallTop(baseline, face.wallId, d, { onlyPiece: pull.onlyPiece });
  if (isEndRole(face.role)) return pullWallEnd(baseline, face.wallId, face.role, d);
  return null;
}

/** Write a wall pull into the plan: thicknesses, then the joint moves, then the openings that keep their place. Inside a transaction. */
function applyWall(r: WallPull) {
  const s = usePlanStore.getState();
  for (const t of r.thickness) s.updateWall(t.id, { thickness: t.thickness });
  // ponytail: one store call per joint, as PlanCanvas does: run joints are at least MIN_WALL_LENGTH apart,
  // so no earlier move can land on a joint this loop has yet to read.
  for (const m of r.moves) s.moveWallEndpoint(m.wallId, m.end, m.to);
  for (const o of r.openings) s.updateOpening(o.id, o.changes);
}

const sameFace = (p: Face | null, q: Face | null) => p === q || (!!p && !!q && p.wallId === q.wallId && p.role === q.role && p.openingId === q.openingId);
const sameSeg = (p: EdgeSeg | null, q: EdgeSeg | null) => p === q || (!!p && !!q && p.x1 === q.x1 && p.y1 === q.y1 && p.x2 === q.x2 && p.y2 === q.y2);
const samePt = (p: { x: number; y: number } | null, q: { x: number; y: number } | null) => p === q || (!!p && !!q && p.x === q.x && p.y === q.y);
const sameCorner = (p: CornerRef | null, q: CornerRef | null) => p === q || (!!p && !!q && p.wallId === q.wallId && p.end === q.end);

export const usePushPullStore = create<PushPullState>((set, get) => {
  /** Roll back the live preview (only if it is still the newest history entry), then apply `edit` in one transaction. */
  function live(edit: () => void) {
    const pull = get().pull;
    if (pull?.live) rollbackPreview();
    const before = usePlanStore.getState().past.length;
    usePlanStore.getState().transaction(edit);
    const after = usePlanStore.getState().past;
    const isLive = after.length > before; // a pull that changes nothing records nothing: do not roll back someone else's step
    liveEntry = isLive ? after[after.length - 1] : null;
    return isLive;
  }
  /** Re-apply the pull for `distance` from its baseline. */
  function render(distance: number, exact: boolean) {
    const pull = get().pull;
    if (!pull || pull.corner) return;
    const result = compute(pull, distance, exact);
    const isLive = live(() => {
      if (!result) return;
      const s = usePlanStore.getState();
      if ("heights" in result) {
        for (const h of result.heights) s.updateWall(h.id, { height: h.height });
        for (const o of result.openings) s.updateOpening(o.id, o.changes);
      } else if (result.kind === "opening") {
        if (!result.refused) s.updateOpening(result.openingId, result.changes);
      } else if (!result.refused) applyWall(result);
    });
    const opening = result && "kind" in result && result.kind === "opening" ? result : null;
    const wall = result && "kind" in result && result.kind === "wall" ? result : null;
    const top = result && "heights" in result ? result : null;
    set({ pull: { ...pull, distance: result?.requested ?? distance, result: top, opening, wall, live: isLive } });
  }
  /** Re-apply the corner drag for the pointer at `to`. */
  function renderCorner(to: Vec2) {
    const pull = get().pull;
    if (!pull?.corner) return;
    const result = dragCorner(pull.baseline, pull.corner.wallId, pull.corner.end, to, { radius: pull.radius, free: pull.onlyPiece });
    const isLive = live(() => {
      if (result) usePlanStore.getState().moveWallEndpoint(pull.corner!.wallId, pull.corner!.end, result.point);
    });
    set({ pull: { ...pull, cornerTo: to, cornerResult: result, live: isLive } });
  }
  /** A typed distance: an opening's move goes the way the pointer last went (+ towards the wall's b end before it has moved). */
  const typedDistance = (m: number) => {
    const pull = get().pull;
    return pull?.kind === "move" && pull.face.openingId ? m * pull.direction : m;
  };
  const newPull = (face: Face, mode: "drag" | "click", extra: Partial<Pull> = {}): Pull => ({
    face,
    kind: get().kind,
    onlyPiece: get().alt,
    shift: get().shift,
    baseline: usePlanStore.getState().plan,
    mode,
    distance: 0,
    result: null,
    opening: null,
    wall: null,
    corner: null,
    cornerTo: null,
    cornerResult: null,
    direction: 1,
    radius: 0,
    live: false,
    ...extra,
  });

  return {
    kind: "pull",
    hover: null,
    corner: null,
    edge: null,
    marker: null,
    pull: null,
    typed: "",
    message: null,
    pointer: null,
    fieldOpen: false,
    alt: false,
    shift: false,

    setKind: (kind) => {
      if (get().kind === kind) return;
      get().cancel();
      set({ kind, hover: null, corner: null, edge: null, marker: null, message: null });
    },
    setHover: (hover, edge = null) => {
      if (get().pull) return; // while pulling, the face being pulled is the highlight
      if (sameFace(get().hover, hover) && sameSeg(get().edge, edge) && get().corner === null) return;
      set({ hover, corner: null, marker: null, edge, message: hover ? faceBlock(usePlanStore.getState().plan, hover, get().kind === "move") : null });
    },
    setCorner: (corner, edge = null, marker = null) => {
      if (get().pull) return;
      if (sameCorner(get().corner, corner) && sameSeg(get().edge, edge) && samePt(get().marker, marker) && get().hover === null) return;
      set({ corner, hover: null, edge, marker, message: null });
    },
    setEdge: (edge, marker) => {
      if (!sameSeg(get().edge, edge)) set({ edge });
      if (marker !== undefined && !samePt(get().marker, marker)) set({ marker });
    },
    setPointer: (pointer) => set({ pointer }),
    setAlt: (alt) => {
      if (get().alt === alt) return;
      set({ alt });
      const pull = get().pull;
      if (pull && pull.onlyPiece !== alt) {
        set({ pull: { ...pull, onlyPiece: alt } });
        if (pull.corner) {
          if (pull.cornerTo) renderCorner(pull.cornerTo); // the same pointer, now snapped (or not)
        } else render(pull.distance, get().typed !== ""); // the same distance, now to a different set of pieces (or unsnapped)
      }
    },
    setShift: (shift) => {
      if (get().shift === shift) return;
      set({ shift });
      const pull = get().pull;
      if (pull && !pull.corner && pull.shift !== shift) {
        set({ pull: { ...pull, shift } });
        render(pull.distance, get().typed !== ""); // a side: thicken again, or move
      }
    },
    openField: (fieldOpen) => set({ fieldOpen }),

    begin: (face, { mode, onlyPiece, shift, radius }) => {
      if (get().pull) return false;
      const block = faceBlock(usePlanStore.getState().plan, face, get().kind === "move");
      if (block) {
        set({ message: block });
        return false;
      }
      set({ pull: newPull(face, mode, { onlyPiece: onlyPiece ?? get().alt, shift: shift ?? get().shift, radius: radius ?? 0 }), hover: face, corner: null, typed: "", message: null });
      return true;
    },
    beginCorner: (corner, { radius }) => {
      if (get().pull || get().kind !== "move") return false;
      if (!usePlanStore.getState().plan.walls.some((w) => w.id === corner.wallId)) return false;
      const face: Face = { wallId: corner.wallId, role: corner.end === "a" ? "endA" : "endB", openingId: null };
      set({ pull: newPull(face, "drag", { corner, radius }), corner, hover: null, typed: "", message: null });
      return true;
    },

    move: (distance) => {
      const pull = get().pull;
      if (!pull || pull.corner || get().typed !== "") return; // typing overrides the mouse
      if (pull.kind === "move" && distance !== 0 && Math.sign(distance) !== pull.direction) set({ pull: { ...pull, direction: distance > 0 ? 1 : -1 } });
      render(distance, false);
    },
    moveCorner: (to) => renderCorner(to),
    armClick: () => {
      const pull = get().pull;
      if (pull) set({ pull: { ...pull, mode: "click" } });
    },

    setTyped: (typed) => {
      if (get().pull?.corner || (get().corner && !get().pull)) {
        set({ typed: "", message: CORNER_TYPE_HINT }); // corners take no typed distance
        return;
      }
      set({ typed, message: null });
      const m = parseSignedDistance(typed);
      if (m !== null && get().pull) render(typedDistance(m), true); // a live preview as the number is typed
    },
    applyTyped: () => {
      const { typed, hover, pull } = get();
      if (pull?.corner) return false;
      const m = parseSignedDistance(typed);
      if (m === null) {
        set({ message: TYPE_HINT });
        return false;
      }
      if (!pull) {
        // Typing with a face hovered and no pull started: pull that face by exactly the typed distance.
        if (!hover || !get().begin(hover, { mode: "click" })) return false;
        set({ typed });
      }
      render(typedDistance(m), true);
      get().commit();
      return true;
    },

    commit: () => {
      const pull = get().pull;
      if (!pull) return;
      liveEntry = null; // the edit now belongs to history: it is the one undo step
      set({ pull: null, typed: "", message: null, fieldOpen: false, edge: null, marker: null, corner: null });
      // a door or window that was pulled or moved becomes the selection, so the panel shows its exact numbers
      if (pull.face.openingId && (pull.kind === "move" || isOpeningRole(pull.face.role))) useSelectionStore.getState().selectOpening(pull.face.openingId);
    },
    cancel: () => {
      const pull = get().pull;
      if (pull?.live) rollbackPreview();
      if (pull || get().typed !== "") set({ pull: null, typed: "", message: null, fieldOpen: false, edge: null, marker: null, ...(pull?.corner ? { corner: null } : {}) });
    },
  };
});
