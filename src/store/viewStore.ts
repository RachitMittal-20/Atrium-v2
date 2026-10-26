/**
 * viewStore.ts — how the 3D pane is being looked at: orbiting the model (freely, or from
 * above in the bird's-eye "Top" view) or walking through it. View state, not plan state:
 * it is never undoable and never saved (autosave, src/store/persistence.ts, subscribes to
 * planStore only, so its payload stays `{ schema, savedAt, plan }`).
 *
 * enterWalk() starts at collision.startPose (the largest room) with a fixed eye
 * height, or refuses with a notice when the plan has no closed room.
 * src/components/three/WalkControls.tsx watches `mode`: on entering it saves the
 * orbit camera into `savedOrbit`, on exiting it puts that camera back exactly.
 * `walkPose` is published by WalkControls at most 15 times a second; the live
 * pose lives in its refs. `ghost` ("Walk through walls", step G.1) makes the walk
 * ignore walls: a view setting, refused outside walk, set to false by every
 * enterWalk and exitWalk, never saved. `frame` asks the orbit camera to frame an imported model
 * (Show in view, step I.1b); it is ignored while walking.
 *
 * Step V.1, the bird's-eye view and Recenter. `mode` is still "orbit" | "walk"; `top` says
 * the orbit camera is in the Top view (looking straight down at the whole plan). The camera
 * moves are REQUESTS (`request`, numbered so the same one twice is two moves), carried out by
 * src/components/three/ViewCamera.tsx inside the canvas:
 *   setTop(true)   "top": glide to the top view (ending a walk first, its camera restored exactly).
 *   setTop(false)  "back": glide back to the camera from before Top (the home view if there is none).
 *   recenter()     "top" in Top, "home" (the three-quarter view of the whole plan) in Orbit; while
 *                  walking it bumps `walkHome` instead, and WalkControls returns to the start pose.
 *   chooseOrbit()  the Orbit button: ends a walk (its exact restore) and leaves Top without moving,
 *                  or, outside a walk, setTop(false).
 * `top` is kept through a walk, so leaving it (Exit, Escape) returns to Top with the camera
 * exactly as it was. ViewCamera turns it off when the user orbits more than half a degree
 * away from straight down. RECENTER_KEY (R) is read on the 3D host only, like G.
 *
 * Connects to: src/lib/walk/collision.ts, src/store/planStore.ts; read by
 * src/components/three/{WalkControls,ViewCamera,PlanModel}.tsx,
 * src/components/studio/{Scene3D,WalkOverlay}.tsx and src/app/studio/page.tsx.
 */
import { create } from "zustand";
import { eyeHeight, getCollision, startPose } from "@/lib/walk/collision";
import { usePlanStore } from "./planStore";

export type CameraMode = "orbit" | "walk";

/** Plan metres; heading in radians with forward = (cos h, sin h) in plan space; pitch up is positive. */
export interface WalkPose {
  x: number;
  y: number;
  heading: number;
  pitch: number;
}

/** The orbit camera as it was when walking began (world space). */
export interface SavedOrbit {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  target: [number, number, number];
  fov: number;
  near: number;
}

/** A camera move for ViewCamera: the top view, the home view, or back to the camera from before Top. */
export type ViewRequestKind = "top" | "home" | "back";

interface ViewState {
  mode: CameraMode;
  walkPose: WalkPose | null;
  savedOrbit: SavedOrbit | null;
  /** Fixed eye height (m) while walking; recomputed only when the collision rebuilds. */
  eyeHeight: number;
  /** "Walk through walls": the walk camera ignores walls (collision's ghost option). Only true while walking. */
  ghost: boolean;
  /** Turn ghost on or off; refused (false) outside walk. WalkControls rescues the camera when it turns off. */
  setGhost: (on: boolean) => boolean;
  /** One line for the 3D pane, cleared by itself. */
  notice: string | null;
  /** A request to frame an imported model with the orbit camera (step I.1b: Show in view, or right after an import,
   *  `auto`: only when it isn't already fully in view). Carried out and cleared by src/components/three/ImportedItems.tsx. */
  frame: { itemId: string; auto: boolean; n: number } | null;
  requestFrame: (itemId: string, auto: boolean) => void;
  clearFrame: () => void;
  /** The orbit camera is in the bird's-eye Top view (step V.1). Kept through a walk. */
  top: boolean;
  /** The latest camera move asked of ViewCamera; `n` grows with every request. Never cleared: ViewCamera remembers the last n it did. */
  request: { kind: ViewRequestKind; n: number } | null;
  /** Bumped by Recenter while walking: WalkControls puts the walker back on the start pose. */
  walkHome: number;
  setTop: (on: boolean) => void;
  recenter: () => void;
  chooseOrbit: () => void;
  /** True when walking started; false (with a notice) when the plan has no closed room. */
  enterWalk: () => boolean;
  exitWalk: () => void;
  setPose: (pose: WalkPose) => void;
  setNotice: (notice: string | null, ms?: number) => void;
}

export const NO_ROOM_NOTICE = "Walk needs at least one closed room.";
export const MOVED_NOTICE = "A wall moved onto you, so we moved you.";
export const GHOST_STATUS = "Walls are ignored. Turn this off to be stopped by walls.";
/** The one walk shortcut beside W A S D, the arrows, Shift and Escape (read on the 3D host by WalkControls). */
export const GHOST_KEY = "g";
/** Recenter (step V.1), in every camera mode, read on the 3D host by ViewCamera. scripts/test-views.ts checks it is free. */
export const RECENTER_KEY = "r";
const NOTICE_MS = 4000;

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

export const useViewStore = create<ViewState>((set, get) => {
  const ask = (kind: ViewRequestKind) => set({ request: { kind, n: (get().request?.n ?? 0) + 1 } });
  return {
    mode: "orbit",
    walkPose: null,
    savedOrbit: null,
    eyeHeight: 1.6,
    notice: null,
    frame: null,
    ghost: false,
    top: false,
    request: null,
    walkHome: 0,

    enterWalk: () => {
      if (get().mode === "walk") return true;
      const plan = usePlanStore.getState().plan;
      const start = startPose(plan, getCollision(plan));
      if (!start) {
        get().setNotice(NO_ROOM_NOTICE);
        return false;
      }
      set({
        mode: "walk",
        walkPose: { x: start.position.x, y: start.position.y, heading: start.heading, pitch: 0 },
        eyeHeight: eyeHeight(plan, start.position),
        ghost: false, // every walk starts stopped by walls
      });
      return true;
    },
    exitWalk: () => {
      if (get().mode === "walk") set({ mode: "orbit", ghost: false });
    },
    setGhost: (on) => {
      if (get().mode !== "walk") return false;
      if (get().ghost !== on) set({ ghost: on });
      return true;
    },
    setTop: (on) => {
      if (on) {
        get().exitWalk(); // WalkControls restores the orbit camera at once; the glide starts from there
        set({ top: true });
        ask("top");
      } else if (get().top) {
        set({ top: false });
        if (get().mode !== "walk") ask("back");
      }
    },
    recenter: () => {
      if (get().mode === "walk") set({ walkHome: get().walkHome + 1 });
      else ask(get().top ? "top" : "home");
    },
    chooseOrbit: () => {
      if (get().mode === "walk") {
        set({ top: false }); // the camera comes back exactly as it was; Orbit is what was chosen
        get().exitWalk();
      } else get().setTop(false);
    },
    setPose: (walkPose) => set({ walkPose }),
    requestFrame: (itemId, auto) => {
      if (get().mode === "walk") return; // the walk camera is not the orbit camera's to move
      set({ frame: { itemId, auto, n: (get().frame?.n ?? 0) + 1 } });
    },
    clearFrame: () => set({ frame: null }),
    setNotice: (notice, ms = NOTICE_MS) => {
      clearTimeout(noticeTimer);
      set({ notice });
      if (notice) noticeTimer = setTimeout(() => set({ notice: null }), ms);
    },
  };
});

/**
 * The on-screen joystick's deflection, -1..1 on each axis (forward up the
 * screen, strafe to the right). Written by WalkOverlay on pointer moves, read by
 * WalkControls every frame. A plain object, not store state: it changes on every
 * pointer move and nothing needs to re-render for it.
 */
export const walkJoystick = { forward: 0, strafe: 0 };
