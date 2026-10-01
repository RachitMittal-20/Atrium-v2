/**
 * pushPullStore.ts — the state of the 3D Push/Pull tool (step 4.7a): which face
 * the pointer is over, the pull in progress, and the typed-distance field. Editor
 * state like selectionStore and toolStore: never in the plan, never undoable, never
 * saved, and it never touches the selection store (hovering a face is not selecting).
 *
 * A pull edits the plan LIVE so the 3D model follows the pointer, and keeps
 * history at exactly one entry the way a 2D drag does (see planStore.rollback):
 * every update rolls the previous preview back and applies the whole pull again
 * from the plan as it was at the start, in one transaction. So a commit leaves
 * one undo step, and Escape is a bare rollback that leaves history as it was
 * (as with a 2D drag, starting an edit has already dropped any redo steps).
 *
 * Only the wall TOP does anything in 4.7a (pushpull.isWired). Every other role can be
 * hovered but `begin` refuses it with "Not yet" and changes nothing.
 *
 * Connects to: src/lib/plan/pushpull.ts (the rules), src/store/planStore.ts;
 * driven by src/components/three/PushPullTool.tsx and read by
 * src/components/studio/PushPullOverlay.tsx.
 */
import { create } from "zustand";
import type { FaceRole } from "@/lib/plan/meshBuilders";
import { isWired, NOT_YET, parseSignedDistance, pullWallTop, snapPull, type TopPull } from "@/lib/plan/pushpull";
import { usePlanStore } from "./planStore";
import type { Plan } from "@/types/plan";

/** A face of a wall mesh: the wall, what part of it, and for opening faces which opening. */
export interface Face {
  wallId: string;
  role: FaceRole;
  openingId: string | null;
}

/** The pull in progress. */
export interface Pull {
  face: Face;
  /** Alt: only the picked piece of a straight wall, and no snapping. */
  onlyPiece: boolean;
  /** The plan as it was when the pull began: every preview is computed from it. */
  baseline: Plan;
  /** How the pull ends: "drag" on release, "click" on the next click. */
  mode: "drag" | "click";
  /** The distance asked for (snapped, from the pointer or typed), and what the rules made of it. */
  distance: number;
  result: TopPull | null;
  /** True while a preview edit sits on top of history, ready to roll back. */
  live: boolean;
}

interface PushPullState {
  hover: Face | null;
  pull: Pull | null;
  /** The typed-distance text; the pointer is ignored while there is any. */
  typed: string;
  /** The 3D pane's one-line message: "Not yet", or why typing was not understood. */
  message: string | null;
  /** The pointer, in the 3D pane's own pixels, for the label next to it. */
  pointer: { x: number; y: number } | null;
  /** The touch "123" button has opened the field. */
  fieldOpen: boolean;
  /** Alt is held (tracked here so a typed distance knows the scope). */
  alt: boolean;

  setHover: (face: Face | null) => void;
  setPointer: (p: { x: number; y: number } | null) => void;
  setAlt: (alt: boolean) => void;
  openField: (open: boolean) => void;
  /** Start pulling `face`. False, with a message and nothing changed, when it is not wired. */
  begin: (face: Face, opts: { mode: "drag" | "click"; onlyPiece?: boolean }) => boolean;
  /** The pointer moved to `distance` metres along the face's normal. Ignored while typing. */
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

export const usePushPullStore = create<PushPullState>((set, get) => {
  /** Roll back the live preview, only if it is still the newest history entry, then re-apply the pull for `distance`. */
  function render(distance: number, exact: boolean) {
    const pull = get().pull;
    if (!pull) return;
    if (pull.live) rollbackPreview();
    const result = pullWallTop(pull.baseline, pull.face.wallId, exact ? distance : snapPull(distance, pull.onlyPiece), { onlyPiece: pull.onlyPiece });
    const before = usePlanStore.getState().past.length;
    if (result) {
      usePlanStore.getState().transaction(() => {
        const s = usePlanStore.getState();
        for (const h of result.heights) s.updateWall(h.id, { height: h.height });
        for (const o of result.openings) s.updateOpening(o.id, o.changes);
      });
    }
    const after = usePlanStore.getState().past;
    const live = after.length > before; // a pull that changes nothing records nothing: do not roll back someone else's step
    liveEntry = live ? after[after.length - 1] : null;
    set({ pull: { ...pull, distance: result?.requested ?? distance, result, live } });
  }

  return {
    hover: null,
    pull: null,
    typed: "",
    message: null,
    pointer: null,
    fieldOpen: false,
    alt: false,

    setHover: (hover) => {
      if (get().pull) return; // while pulling, the face being pulled is the highlight
      const cur = get().hover;
      if (cur === hover || (cur && hover && cur.wallId === hover.wallId && cur.role === hover.role && cur.openingId === hover.openingId)) return;
      set({ hover, message: hover && !isWired(hover.role) ? NOT_YET : null });
    },
    setPointer: (pointer) => set({ pointer }),
    setAlt: (alt) => {
      if (get().alt === alt) return;
      set({ alt });
      const pull = get().pull;
      if (pull && pull.onlyPiece !== alt) {
        set({ pull: { ...pull, onlyPiece: alt } });
        render(pull.distance, get().typed !== ""); // the same distance, now to a different set of pieces
      }
    },
    openField: (fieldOpen) => set({ fieldOpen }),

    begin: (face, { mode, onlyPiece }) => {
      if (get().pull) return false;
      if (!isWired(face.role)) {
        set({ message: NOT_YET });
        return false;
      }
      set({
        pull: { face, onlyPiece: onlyPiece ?? get().alt, baseline: usePlanStore.getState().plan, mode, distance: 0, result: null, live: false },
        hover: face,
        typed: "",
        message: null,
      });
      return true;
    },

    move: (distance) => {
      const pull = get().pull;
      if (!pull || get().typed !== "") return; // typing overrides the mouse
      render(distance, false);
    },
    armClick: () => {
      const pull = get().pull;
      if (pull) set({ pull: { ...pull, mode: "click" } });
    },

    setTyped: (typed) => {
      set({ typed, message: null });
      const m = parseSignedDistance(typed);
      if (m !== null && get().pull) render(m, true); // a live preview as the number is typed
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
      render(m, true);
      get().commit();
      return true;
    },

    commit: () => {
      if (!get().pull) return;
      liveEntry = null; // the edit now belongs to history: it is the one undo step
      set({ pull: null, typed: "", message: null, fieldOpen: false });
    },
    cancel: () => {
      const pull = get().pull;
      if (pull?.live) rollbackPreview();
      if (pull || get().typed !== "") set({ pull: null, typed: "", message: null, fieldOpen: false });
    },
  };
});

// Development and test builds only: the browser test reads what is hovered and whether a pull is active.
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
  const debug = {} as { hoverFace: { wallId: string; role: FaceRole } | null; active: boolean };
  Object.defineProperties(debug, {
    hoverFace: { get: () => { const h = usePushPullStore.getState().hover; return h ? { wallId: h.wallId, role: h.role } : null; }, enumerable: true },
    active: { get: () => usePushPullStore.getState().pull !== null, enumerable: true },
  });
  (window as unknown as { __pushPullDebug?: typeof debug }).__pushPullDebug = debug;
}
