/**
 * viewStore.ts — how the 3D pane is being looked at: orbiting the model or
 * walking through it. View state, not plan state: it is never undoable and
 * never saved (autosave, src/store/persistence.ts, subscribes to planStore only,
 * so its payload stays `{ schema, savedAt, plan }`).
 *
 * enterWalk() starts at collision.startPose (the largest room) with a fixed eye
 * height, or refuses with a notice when the plan has no closed room.
 * src/components/three/WalkControls.tsx watches `mode`: on entering it saves the
 * orbit camera into `savedOrbit`, on exiting it puts that camera back exactly.
 * `walkPose` is published by WalkControls at most 15 times a second; the live
 * pose lives in its refs.
 *
 * Connects to: src/lib/walk/collision.ts, src/store/planStore.ts; read by
 * src/components/three/WalkControls.tsx, src/components/studio/{Scene3D,WalkOverlay}.tsx,
 * src/components/three/PlanModel.tsx and src/app/studio/page.tsx.
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

interface ViewState {
  mode: CameraMode;
  walkPose: WalkPose | null;
  savedOrbit: SavedOrbit | null;
  /** Fixed eye height (m) while walking; recomputed only when the collision rebuilds. */
  eyeHeight: number;
  /** One line for the 3D pane, cleared by itself. */
  notice: string | null;
  /** True when walking started; false (with a notice) when the plan has no closed room. */
  enterWalk: () => boolean;
  exitWalk: () => void;
  setPose: (pose: WalkPose) => void;
  setNotice: (notice: string | null, ms?: number) => void;
}

export const NO_ROOM_NOTICE = "Walk needs at least one closed room.";
export const MOVED_NOTICE = "A wall moved onto you, so we moved you.";
const NOTICE_MS = 4000;

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

export const useViewStore = create<ViewState>((set, get) => ({
  mode: "orbit",
  walkPose: null,
  savedOrbit: null,
  eyeHeight: 1.6,
  notice: null,

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
    });
    return true;
  },
  exitWalk: () => {
    if (get().mode === "walk") set({ mode: "orbit" });
  },
  setPose: (walkPose) => set({ walkPose }),
  setNotice: (notice, ms = NOTICE_MS) => {
    clearTimeout(noticeTimer);
    set({ notice });
    if (notice) noticeTimer = setTimeout(() => set({ notice: null }), ms);
  },
}));

/**
 * The on-screen joystick's deflection, -1..1 on each axis (forward up the
 * screen, strafe to the right). Written by WalkOverlay on pointer moves, read by
 * WalkControls every frame. A plain object, not store state: it changes on every
 * pointer move and nothing needs to re-render for it.
 */
export const walkJoystick = { forward: 0, strafe: 0 };
