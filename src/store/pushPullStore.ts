/**
 * pushPullStore.ts — the state of the 3D Push/Pull and Move tools (steps 4.7a and
 * 4.7b): which face the pointer is over, the pull or move in progress, and the
 * typed-distance field. Editor state like selectionStore and toolStore: never in
 * the plan, never undoable, never saved. Hovering never touches the selection
 * store; committing a pull or move of a door or window selects that opening, so
 * the OpeningPanel shows its exact numbers.
 *
 * A pull edits the plan LIVE so the 3D model follows the pointer, and keeps
 * history at exactly one entry the way a 2D drag does (see planStore.rollback):
 * every update rolls the previous preview back and applies the whole pull again
 * from the plan as it was at the start, in one transaction. So a commit leaves
 * one undo step, and Escape is a bare rollback that leaves history as it was
 * (as with a 2D drag, starting an edit has already dropped any redo steps).
 *
 * `kind` is the active tool: "pull" (Push/Pull: a wall top, or a door's or window's
 * side, top or sill; pushpull.isWired) or "move" (Move: a door or window slides
 * along its wall). A face that can't be pulled can still be hovered, but `begin`
 * refuses it with the reason (pushpull.faceBlock: "Not yet", "A door stays on the
 * floor", or over a wall in Move, "Wall moves arrive with the side faces").
 *
 * Connects to: src/lib/plan/pushpull.ts (the rules), src/store/{planStore,selectionStore}.ts;
 * driven by src/components/three/PushPullTool.tsx and read by
 * src/components/studio/PushPullOverlay.tsx and src/components/three/PlanModel.tsx.
 * The dev-only window.__pushPullDebug is set up in src/store/toolStore.ts.
 */
import { create } from "zustand";
import { faceBlock, isOpeningRole, parseSignedDistance, pullOpening, pullWallTop, snapPull, type FaceRef, type OpeningPull, type TopPull } from "@/lib/plan/pushpull";
import type { Plan } from "@/types/plan";
import { usePlanStore } from "./planStore";
import { useSelectionStore } from "./selectionStore";

/** A face of a wall mesh: the wall, what part of it, and for opening faces which opening. */
export type Face = FaceRef;
export type PullKind = "pull" | "move";
/** A screen segment in the 3D pane's own pixels: the grabbed edge, drawn 3 px wide by the overlay. */
export interface EdgeSeg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** The pull (or move) in progress. */
export interface Pull {
  face: Face;
  kind: PullKind;
  /** Alt: only the picked piece of a straight wall, and no snapping. */
  onlyPiece: boolean;
  /** The plan as it was when the pull began: every preview is computed from it. */
  baseline: Plan;
  /** How the pull ends: "drag" on release, "click" on the next click. */
  mode: "drag" | "click";
  /** The distance asked for (snapped, from the pointer or typed), and what the rules made of it: a wall top's pull, or an opening's. */
  distance: number;
  result: TopPull | null;
  opening: OpeningPull | null;
  /** Move: which way the pointer last moved along the wall (+1 towards its b end). A typed distance goes this way. */
  direction: 1 | -1;
  /** Move: how far (m) the wall's midpoint snap reaches, from the camera's scale at the grab. */
  radius: number;
  /** True while a preview edit sits on top of history, ready to roll back. */
  live: boolean;
}

interface PushPullState {
  /** The active 3D tool, set by PushPullTool. */
  kind: PullKind;
  hover: Face | null;
  /** The opening edge the pointer is on, when the hover came from an edge band. */
  edge: EdgeSeg | null;
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

  setKind: (kind: PullKind) => void;
  setHover: (face: Face | null, edge?: EdgeSeg | null) => void;
  setEdge: (edge: EdgeSeg | null) => void;
  setPointer: (p: { x: number; y: number } | null) => void;
  setAlt: (alt: boolean) => void;
  openField: (open: boolean) => void;
  /** Start pulling `face`. False, with the reason and nothing changed, when it can't be pulled. `radius`: Move's midpoint snap reach. */
  begin: (face: Face, opts: { mode: "drag" | "click"; onlyPiece?: boolean; radius?: number }) => boolean;
  /** The pointer moved to `distance` metres along the face's axis (+ = bigger, or towards b for a move). Ignored while typing. */
  move: (distance: number) => void;
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

// The history entry the live preview made (module-level: nothing renders from it). A rollback is only done
// while it is still the newest entry, so an undo or any other edit made mid-pull is never undone twice.
let liveEntry: unknown = null;
function rollbackPreview() {
  const s = usePlanStore.getState();
  if (liveEntry !== null && s.past[s.past.length - 1] === liveEntry) s.rollback();
  liveEntry = null;
}

/** What the rules make of `distance` for this pull. `exact` (typed) skips the 5 cm snap; Alt does too. */
function compute(pull: Pull, distance: number, exact: boolean): TopPull | OpeningPull | null {
  const { face, baseline } = pull;
  if (pull.kind === "move") return face.openingId ? pullOpening(baseline, face.openingId, "move", distance, { radius: pull.radius, free: exact || pull.onlyPiece }) : null;
  const d = exact ? distance : snapPull(distance, pull.onlyPiece);
  if (face.role === "top") return pullWallTop(baseline, face.wallId, d, { onlyPiece: pull.onlyPiece });
  if (isOpeningRole(face.role) && face.openingId) return pullOpening(baseline, face.openingId, face.role, d);
  return null;
}

const sameFace = (p: Face | null, q: Face | null) => p === q || (!!p && !!q && p.wallId === q.wallId && p.role === q.role && p.openingId === q.openingId);
const sameSeg = (p: EdgeSeg | null, q: EdgeSeg | null) => p === q || (!!p && !!q && p.x1 === q.x1 && p.y1 === q.y1 && p.x2 === q.x2 && p.y2 === q.y2);

export const usePushPullStore = create<PushPullState>((set, get) => {
  /** Roll back the live preview, only if it is still the newest history entry, then re-apply the pull for `distance`. */
  function render(distance: number, exact: boolean) {
    const pull = get().pull;
    if (!pull) return;
    if (pull.live) rollbackPreview();
    const result = compute(pull, distance, exact);
    const before = usePlanStore.getState().past.length;
    if (result) {
      usePlanStore.getState().transaction(() => {
        const s = usePlanStore.getState();
        if ("heights" in result) {
          for (const h of result.heights) s.updateWall(h.id, { height: h.height });
          for (const o of result.openings) s.updateOpening(o.id, o.changes);
        } else if (!result.refused) s.updateOpening(result.openingId, result.changes);
      });
    }
    const after = usePlanStore.getState().past;
    const live = after.length > before; // a pull that changes nothing records nothing: do not roll back someone else's step
    liveEntry = live ? after[after.length - 1] : null;
    const opening = result && "openingId" in result ? result : null;
    const top = result && "heights" in result ? result : null;
    set({ pull: { ...pull, distance: result?.requested ?? distance, result: top, opening, live } });
  }
  /** A typed distance: a move goes the way the pointer last went (+ towards the wall's b end before it has moved). */
  const typedDistance = (m: number) => {
    const pull = get().pull;
    return pull?.kind === "move" ? m * pull.direction : m;
  };

  return {
    kind: "pull",
    hover: null,
    edge: null,
    pull: null,
    typed: "",
    message: null,
    pointer: null,
    fieldOpen: false,
    alt: false,

    setKind: (kind) => {
      if (get().kind === kind) return;
      get().cancel();
      set({ kind, hover: null, edge: null, message: null });
    },
    setHover: (hover, edge = null) => {
      if (get().pull) return; // while pulling, the face being pulled is the highlight
      if (sameFace(get().hover, hover) && sameSeg(get().edge, edge)) return;
      set({ hover, edge, message: hover ? faceBlock(usePlanStore.getState().plan, hover, get().kind === "move") : null });
    },
    setEdge: (edge) => {
      if (!sameSeg(get().edge, edge)) set({ edge });
    },
    setPointer: (pointer) => set({ pointer }),
    setAlt: (alt) => {
      if (get().alt === alt) return;
      set({ alt });
      const pull = get().pull;
      if (pull && pull.onlyPiece !== alt) {
        set({ pull: { ...pull, onlyPiece: alt } });
        render(pull.distance, get().typed !== ""); // the same distance, now to a different set of pieces (or unsnapped)
      }
    },
    openField: (fieldOpen) => set({ fieldOpen }),

    begin: (face, { mode, onlyPiece, radius }) => {
      if (get().pull) return false;
      const kind = get().kind;
      const block = faceBlock(usePlanStore.getState().plan, face, kind === "move");
      if (block) {
        set({ message: block });
        return false;
      }
      set({
        pull: { face, kind, onlyPiece: onlyPiece ?? get().alt, baseline: usePlanStore.getState().plan, mode, distance: 0, result: null, opening: null, direction: 1, radius: radius ?? 0, live: false },
        hover: face,
        typed: "",
        message: null,
      });
      return true;
    },

    move: (distance) => {
      const pull = get().pull;
      if (!pull || get().typed !== "") return; // typing overrides the mouse
      if (pull.kind === "move" && distance !== 0 && Math.sign(distance) !== pull.direction) set({ pull: { ...pull, direction: distance > 0 ? 1 : -1 } });
      render(distance, false);
    },
    armClick: () => {
      const pull = get().pull;
      if (pull) set({ pull: { ...pull, mode: "click" } });
    },

    setTyped: (typed) => {
      set({ typed, message: null });
      const m = parseSignedDistance(typed);
      if (m !== null && get().pull) render(typedDistance(m), true); // a live preview as the number is typed
    },
    applyTyped: () => {
      const { typed, hover, pull } = get();
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
      set({ pull: null, typed: "", message: null, fieldOpen: false, edge: null });
      // a door or window that was pulled or moved becomes the selection, so the panel shows its exact numbers
      if (pull.face.openingId && (pull.kind === "move" || isOpeningRole(pull.face.role))) useSelectionStore.getState().selectOpening(pull.face.openingId);
    },
    cancel: () => {
      const pull = get().pull;
      if (pull?.live) rollbackPreview();
      if (pull || get().typed !== "") set({ pull: null, typed: "", message: null, fieldOpen: false, edge: null });
    },
  };
});
