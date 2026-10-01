"use client";

/**
 * WalkControls.tsx — drives the 3D camera while walking (viewStore.mode ===
 * "walk"). Lives inside the R3F <Canvas> (mounted by Scene3D) and renders
 * nothing. Built on the pure parts: src/lib/walk/input.ts (walkStep) and
 * src/lib/walk/collision.ts (moveWithCollision and friends). Ideas ported from
 * V1's WalkthroughControls (a held-key set, frame-rate-independent velocity
 * smoothing, clamped pitch); none of its code or stores.
 *
 * - Entering: saves the orbit camera (position, rotation, target, fov, near)
 *   into viewStore.savedOrbit, switches to fov 70 / near 0.05 and turns
 *   OrbitControls off. Exiting puts all of it back exactly. Both happen in a
 *   store subscription, so at the moment the mode flips, before any frame.
 * - Every frame: reads the CURRENT plan from the store (never a stale copy), so
 *   collision follows every edit. When getCollision returns a new build (a wall
 *   or opening edit, or an undo of one), the eye height is recomputed and, if a
 *   wall now covers the camera, it is moved to freePointNear, else to the start
 *   pose, with a notice. The eye height is otherwise fixed, so walking past a
 *   low wall never bobs the view.
 * - Keys (W A S D, left/right arrows, Shift, Escape) are read on the focusable
 *   host element Scene3D wraps around the canvas, so they count only while the
 *   3D view has focus, and never in a form field; the 2D canvas keeps its own
 *   arrow keys. Keys are released on blur and when the tab is hidden.
 * - Look: drag on the canvas (pointer capture, no pointer lock, so it works in
 *   Split). One pointer looks; another (the joystick's) can move at the same time.
 * - Dev only: window.__walkDebug for test setup and read-outs.
 *
 * Connects to: src/store/{viewStore,planStore,selectionStore}.ts, src/lib/keyboard.ts.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { isTypingTarget } from "@/lib/keyboard";
import { CAMERA_RADIUS, clearance, eyeHeight, freePointNear, getCollision, moveWithCollision, startPose, type Collision } from "@/lib/walk/collision";
import { planToWorld, walkForward, walkStep } from "@/lib/walk/input";
import { usePlanStore } from "@/store/planStore";
import { useSelectionStore } from "@/store/selectionStore";
import { MOVED_NOTICE, NO_ROOM_NOTICE, useViewStore, walkJoystick } from "@/store/viewStore";
import type { Plan } from "@/types/plan";

const WALK_FOV = 70;
const WALK_NEAR = 0.05;
const PUBLISH_EVERY = 1 / 15; // s: the store hears the pose at most 15 times a second
const SETTLE_SLACK = 0.001; // a wall within radius - 1 mm of the camera counts as on it
const KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"]);

type Orbit = { target: THREE.Vector3; enabled: boolean };

export function WalkControls({ host }: { host: RefObject<HTMLDivElement | null> }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const get = useThree((s) => s.get);
  const keys = useRef(new Set<string>());
  const look = useRef({ id: null as number | null, x: 0, y: 0, dx: 0, dy: 0 });
  const reduced = useRef(false);
  // The live pose. Refs, not React state: it changes every frame.
  const pose = useRef({ x: 0, y: 0, heading: 0, pitch: 0, velocity: { x: 0, y: 0 }, eye: 1.6, collision: null as Collision | null, sincePublish: 0 });

  // ---- shared by the subscription, the frame loop and the debug hook (all run outside render)
  const placeCamera = () => {
    const w = pose.current;
    camera.position.set(...planToWorld(w, w.eye));
    const f = walkForward(w.heading, w.pitch);
    camera.lookAt(camera.position.x + f[0], camera.position.y + f[1], camera.position.z + f[2]);
  };
  const publish = () => {
    const { x, y, heading, pitch } = pose.current;
    useViewStore.getState().setPose({ x, y, heading, pitch });
    pose.current.sincePublish = 0;
  };
  const release = () => {
    keys.current.clear();
    look.current = { id: null, x: 0, y: 0, dx: 0, dy: 0 };
    walkJoystick.forward = walkJoystick.strafe = 0;
  };
  /** The collision was rebuilt: new eye height, and step out from under a wall that moved onto us. False if walking had to stop. */
  const settle = (plan: Plan, c: Collision): boolean => {
    const w = pose.current;
    if (clearance(c, w) < CAMERA_RADIUS - SETTLE_SLACK) {
      const free = freePointNear(c, w, 2);
      const start = free ? null : startPose(plan, c);
      if (!free && !start) {
        useViewStore.getState().exitWalk();
        useViewStore.getState().setNotice(NO_ROOM_NOTICE);
        return false;
      }
      if (free) Object.assign(w, free);
      else Object.assign(w, start!.position, { heading: start!.heading });
      w.velocity = { x: 0, y: 0 };
      useViewStore.getState().setNotice(MOVED_NOTICE);
    }
    w.eye = eyeHeight(plan, w);
    useViewStore.setState({ eyeHeight: w.eye });
    publish();
    return true;
  };

  // ---- entering and exiting: save and restore the orbit camera, at the moment the mode flips
  useEffect(
    () =>
      useViewStore.subscribe((s, prev) => {
        if (s.mode === prev.mode) return;
        const controls = get().controls as unknown as Orbit | null;
        release();
        if (s.mode === "walk") {
          useViewStore.setState({
            savedOrbit: {
              position: camera.position.toArray(),
              quaternion: camera.quaternion.toArray() as [number, number, number, number],
              target: (controls?.target ?? new THREE.Vector3()).toArray(),
              fov: camera.fov,
              near: camera.near,
            },
          });
          if (controls) controls.enabled = false; // Scene3D's prop says the same on its next render
          useSelectionStore.getState().hover(null);
          const p = s.walkPose!;
          Object.assign(pose.current, { x: p.x, y: p.y, heading: p.heading, pitch: p.pitch, velocity: { x: 0, y: 0 }, eye: s.eyeHeight, sincePublish: 0 });
          pose.current.collision = getCollision(usePlanStore.getState().plan); // the build enterWalk started from
          camera.fov = WALK_FOV;
          camera.near = WALK_NEAR;
          camera.updateProjectionMatrix();
          placeCamera();
        } else {
          const o = useViewStore.getState().savedOrbit;
          if (!o) return;
          camera.position.fromArray(o.position);
          camera.quaternion.fromArray(o.quaternion);
          camera.fov = o.fov;
          camera.near = o.near;
          camera.updateProjectionMatrix();
          controls?.target.fromArray(o.target);
          if (controls) controls.enabled = true;
        }
      }),
    // placeCamera/release read refs and the camera only; they are rebuilt each render but behave the same.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [camera, get],
  );

  // ---- every frame while walking
  useFrame((_, dt) => {
    if (useViewStore.getState().mode !== "walk") return;
    const w = pose.current;
    const plan = usePlanStore.getState().plan; // the live plan, every frame
    const c = getCollision(plan); // memoised: a new object only after a wall or opening change
    if (c !== w.collision) {
      w.collision = c;
      if (!settle(plan, c)) return;
    }
    const k = keys.current;
    const axis = (plus: string, minus: string) => (k.has(plus) ? 1 : 0) - (k.has(minus) ? 1 : 0);
    const l = look.current;
    const step = walkStep(
      w,
      {
        forward: axis("KeyW", "KeyS") + walkJoystick.forward,
        strafe: axis("KeyD", "KeyA") + walkJoystick.strafe,
        turn: axis("ArrowRight", "ArrowLeft"),
        run: k.has("ShiftLeft") || k.has("ShiftRight"),
        lookDX: l.dx,
        lookDY: l.dy,
      },
      dt,
      { reducedMotion: reduced.current },
    );
    l.dx = l.dy = 0;
    const p = moveWithCollision(c, w, step.delta);
    Object.assign(w, { x: p.x, y: p.y, heading: step.heading, pitch: step.pitch, velocity: step.velocity });
    placeCamera();
    w.sincePublish += dt;
    if (w.sincePublish >= PUBLISH_EVERY) publish();
  });

  // ---- keys and look, on the focusable host only
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const walking = () => useViewStore.getState().mode === "walk";
    const onKeyDown = (e: KeyboardEvent) => {
      if (!walking() || isTypingTarget(e.target)) return;
      if (e.key === "Escape") return useViewStore.getState().exitWalk();
      // With a modifier held (Ctrl+Z, Cmd+S…) the key is a shortcut, and macOS drops the keyup, so it would stick.
      if (!KEYS.has(e.code) || e.metaKey || e.ctrlKey || e.altKey) return;
      keys.current.add(e.code);
      e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => keys.current.delete(e.code);
    const onPointerDown = (e: PointerEvent) => {
      el.focus({ preventScroll: true }); // a click gives the 3D view the keys
      if (!walking() || look.current.id !== null || (e.pointerType === "mouse" && e.button !== 0)) return;
      look.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
      el.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      const l = look.current;
      if (e.pointerId !== l.id) return;
      l.dx += e.clientX - l.x; // summed until the next frame reads it
      l.dy += e.clientY - l.y;
      l.x = e.clientX;
      l.y = e.clientY;
    };
    const onPointerEnd = (e: PointerEvent) => {
      if (e.pointerId === look.current.id) look.current.id = null;
    };
    const onHidden = () => document.visibilityState === "hidden" && release();
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("keyup", onKeyUp);
    el.addEventListener("blur", release);
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerEnd);
    el.addEventListener("pointercancel", onPointerEnd);
    el.addEventListener("lostpointercapture", onPointerEnd);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("keyup", onKeyUp);
      el.removeEventListener("blur", release);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerEnd);
      el.removeEventListener("pointercancel", onPointerEnd);
      el.removeEventListener("lostpointercapture", onPointerEnd);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [host]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => (reduced.current = mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // ---- development only: read-outs, and teleport for TEST SETUP (never a way to play)
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const hook = {
      mode: () => useViewStore.getState().mode,
      pose: () => {
        const { x, y, heading, pitch, eye } = pose.current;
        return { x, y, heading, pitch, eye };
      },
      camera: () => {
        camera.updateMatrixWorld();
        return {
          position: camera.position.toArray(),
          forward: camera.getWorldDirection(new THREE.Vector3()).toArray(),
          right: new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).toArray(),
          fov: camera.fov,
          near: camera.near,
        };
      },
      /** Distance from the camera's ground point to the nearest solid. */
      clearance: () => clearance(getCollision(usePlanStore.getState().plan), { x: camera.position.x, y: camera.position.z }),
      teleport: (x: number, y: number, heading: number) => {
        Object.assign(pose.current, { x, y, heading, velocity: { x: 0, y: 0 }, eye: eyeHeight(usePlanStore.getState().plan, { x, y }) });
        if (useViewStore.getState().mode === "walk") placeCamera();
        publish();
      },
    };
    const win = window as unknown as { __walkDebug?: typeof hook };
    win.__walkDebug = hook;
    return () => {
      if (win.__walkDebug === hook) delete win.__walkDebug;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  return null;
}
