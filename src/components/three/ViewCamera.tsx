"use client";

/**
 * ViewCamera.tsx — places the orbit camera (step V.1; before it, Scene3D's FitCamera did
 * the first part). Lives inside the R3F <Canvas> (mounted by Scene3D) and renders nothing.
 *
 * - The opening view: the home view (src/lib/view/camera.ts homeView, the three-quarter
 *   view of the whole plan), or the top view when Top is on (with the band under the pane's
 *   own controls, CONTROL_STRIP_PX, kept clear of the plan), placed at once and kept
 *   framed whenever the pane changes size, until the user orbits, pans or zooms. The same
 *   holds after Top or Recenter: what was framed stays framed on a resize.
 * - The camera moves viewStore asks for (`request`): "top" (the bird's-eye view), "home"
 *   (Recenter in Orbit) and "back" (Orbit from Top: the camera from before Top, else home).
 *   Each is a GSAP tween of the camera's position and the orbit target (GLIDE_S, instant
 *   under prefers-reduced-motion), from the bounds of the plan as it is NOW. Before it
 *   starts, OrbitControls' damping is drained (one update without damping), so a flick's
 *   leftover spin cannot carry the camera off the pose afterwards. A press of the user's own
 *   (the controls' "start") stops a tween where it is.
 * - Top is left by rotating: when the camera turns more than TOP_LEAVE away from straight
 *   down (orbiting, not panning or zooming), viewStore.top goes off without moving anything.
 * - R (viewStore.RECENTER_KEY) on the focusable 3D host recenters, in every mode (walking:
 *   WalkControls returns to the start pose). Not in a form field, not with a modifier, not
 *   in the middle of a Push/Pull pull or a model drag.
 * Never while walking: the walk camera is not this one's to move, and leaving the walk
 * restores the orbit camera exactly (WalkControls).
 *
 * Connects to: src/lib/view/camera.ts, src/store/{viewStore,planStore,pushPullStore,itemToolStore}.ts;
 * dispatches OrbitControls' "start" when it takes the camera, so ImportedItems lets go of a
 * model it was keeping framed.
 */
import { useThree } from "@react-three/fiber";
import gsap from "gsap";
import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { isTypingTarget } from "@/lib/keyboard";
import { CONTROL_STRIP_PX, homeView, planBounds, topView, type CameraPose, type PlanBounds } from "@/lib/view/camera";
import { useItemToolStore } from "@/store/itemToolStore";
import { usePlanStore } from "@/store/planStore";
import { usePushPullStore } from "@/store/pushPullStore";
import { RECENTER_KEY, useViewStore } from "@/store/viewStore";

const GLIDE_S = 0.6; // s
/** Orbiting further than this from straight down leaves the Top view. */
const TOP_LEAVE = THREE.MathUtils.degToRad(0.5);
const UP = new THREE.Vector3(0, 1, 0);

type OrbitLike = {
  target: THREE.Vector3;
  enableDamping: boolean;
  update(): boolean;
  addEventListener(type: "start" | "change", fn: () => void): void;
  removeEventListener(type: "start" | "change", fn: () => void): void;
  dispatchEvent(e: { type: "start" }): void;
};
type Glide = { from: [THREE.Vector3, THREE.Vector3]; to: [THREE.Vector3, THREE.Vector3] };

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const vec = (v: { x: number; y: number; z: number }) => new THREE.Vector3(v.x, v.y, v.z);

export function ViewCamera({ bounds, host }: { bounds: PlanBounds; host: RefObject<HTMLDivElement | null> }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const get = useThree((s) => s.get);
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null;
  // What stays framed while the pane changes size, until the user moves the camera. Starts as the opening view.
  const framed = useRef<{ kind: "home" | "top"; bounds: PlanBounds } | null>({ kind: useViewStore.getState().top ? "top" : "home", bounds });
  const glide = useRef<Glide | null>(null);
  const tween = useRef<gsap.core.Tween | null>(null);
  const own = useRef(false); // the "start" event is ours, not the user's
  const beforeTop = useRef<CameraPose | null>(null);
  const done = useRef(useViewStore.getState().request?.n ?? 0); // a remount never replays an old request

  // The top view keeps the band under the pane's own controls clear (CONTROL_STRIP_PX at the top, and the same at the bottom).
  /** The orbit controls as they are now (read at call time, as WalkControls does, never the render's copy). */
  const orbit = () => get().controls as unknown as OrbitLike | null;
  const poseOf = (kind: "home" | "top", b: PlanBounds, w: number, h: number) => (kind === "top" ? topView(b, w / h, camera.fov, CONTROL_STRIP_PX / h) : homeView(b, w / h, camera.fov));
  const polar = () => {
    const c = orbit();
    return c ? camera.position.clone().sub(c.target).angleTo(UP) : 0;
  };
  const stop = () => {
    tween.current?.kill();
    tween.current = null;
    glide.current = null;
  };
  /** Lerp between the glide's ends; k = 1 is exactly its end. */
  const apply = (k: number) => {
    const g = glide.current;
    const c = orbit();
    if (!g) return;
    camera.position.lerpVectors(g.from[0], g.to[0], k);
    c?.target.lerpVectors(g.from[1], g.to[1], k);
    camera.lookAt(c ? c.target : g.to[1]); // OrbitControls agrees on its next update
  };
  const glideTo = (to: CameraPose) => {
    const controls = orbit();
    if (!controls) return;
    stop();
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update(); // spends what is left of a flick now, so nothing carries the camera off the pose later
    controls.enableDamping = damping;
    own.current = true;
    controls.dispatchEvent({ type: "start" }); // the camera is ours now: ImportedItems stops keeping a model framed
    own.current = false;
    glide.current = { from: [camera.position.clone(), controls.target.clone()], to: [vec(to.position), vec(to.target)] };
    if (reducedMotion()) {
      apply(1);
      glide.current = null;
      return;
    }
    const p = { k: 0 };
    tween.current = gsap.to(p, {
      k: 1,
      duration: GLIDE_S,
      ease: "power2.inOut",
      onUpdate: () => apply(p.k),
      onComplete: () => {
        apply(1);
        tween.current = null;
        glide.current = null;
      },
    });
  };

  // ---- the opening view, and keeping what was framed framed when the pane changes size
  useEffect(() => {
    const f = framed.current;
    if (!f || width === 0 || height === 0 || useViewStore.getState().mode === "walk") return;
    const pose = poseOf(f.kind, f.bounds, width, height);
    if (glide.current) {
      glide.current.to = [vec(pose.position), vec(pose.target)]; // mid-glide: land on the new fit
      return;
    }
    camera.position.copy(vec(pose.position));
    camera.lookAt(vec(pose.target));
    orbit()?.target.copy(vec(pose.target));
  }, [camera, width, height]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the user's own orbit, pan or zoom: let go; turning away from straight down leaves Top
  useEffect(() => {
    if (!controls) return;
    const onStart = () => {
      if (own.current) return;
      framed.current = null;
      stop();
    };
    const onChange = () => {
      const v = useViewStore.getState();
      if (v.top && !glide.current && v.mode !== "walk" && polar() > TOP_LEAVE) useViewStore.setState({ top: false });
    };
    controls.addEventListener("start", onStart);
    controls.addEventListener("change", onChange);
    return () => {
      controls.removeEventListener("start", onStart);
      controls.removeEventListener("change", onChange);
    };
  }, [controls]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the moves viewStore asks for
  useEffect(
    () =>
      useViewStore.subscribe((s) => {
        const r = s.request;
        if (!r || r.n === done.current) return;
        done.current = r.n;
        const { width: w, height: h } = get().size;
        const controls = orbit();
        if (s.mode === "walk" || !controls || w === 0 || h === 0) return;
        const b = planBounds(usePlanStore.getState().plan.walls);
        if (r.kind === "top") {
          if (polar() > TOP_LEAVE) beforeTop.current = { position: camera.position.clone(), target: controls.target.clone() }; // what Orbit goes back to
          framed.current = { kind: "top", bounds: b };
          glideTo(poseOf("top", b, w, h));
        } else if (r.kind === "home") {
          framed.current = { kind: "home", bounds: b };
          glideTo(poseOf("home", b, w, h));
        } else {
          const back = beforeTop.current;
          beforeTop.current = null;
          framed.current = back ? null : { kind: "home", bounds: b };
          glideTo(back ?? poseOf("home", b, w, h));
        }
      }),
    [camera, get], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => () => void tween.current?.kill(), []);

  // ---- R recenters, read on the 3D host like the walking keys
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== RECENTER_KEY || e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (usePushPullStore.getState().pull || useItemToolStore.getState().drag) return; // never in the middle of a pull or a drag
      e.preventDefault();
      useViewStore.getState().recenter();
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [host]);

  return null;
}
