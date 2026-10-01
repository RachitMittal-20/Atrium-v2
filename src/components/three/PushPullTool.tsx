"use client";

/**
 * PushPullTool.tsx — the 3D Push/Pull tool (step 4.7a). Lives inside the R3F
 * <Canvas> (mounted by Scene3D, next to PlanModel) and renders only the face
 * highlight. Active when toolStore.tool is "pushpull" and the 3D pane is not
 * walking. The state is in src/store/pushPullStore.ts, the rules in
 * src/lib/plan/pushpull.ts, the pointer maths in src/lib/handles3d/math.ts; this
 * file turns pointer events into those calls.
 *
 * - Hover: a raycast on pointer move finds the wall triangle under the pointer and
 *   its role (meshBuilders face roles); that face's triangles are tinted light blue
 *   (a polygon-offset overlay). Hover never touches the selection store.
 * - Start: pointerdown on a wired face (only a wall top in 4.7a) starts a pull and
 *   keeps OrbitControls from also orbiting, by switching its left-button and
 *   one-finger actions off for that press. A press anywhere else, a face that is
 *   not wired yet, the middle or right button and a second finger all still orbit.
 *   A press that moves 5 px is a drag (the pull follows the pointer, release
 *   commits). A press that comes up as a click (math.isClick) leaves the pull
 *   armed: move the pointer, click again to commit.
 * - The pointer becomes a distance along the face's normal through the grab point
 *   (math.startPull / pullDistance), measured from where it was grabbed so the
 *   face never jumps, and the ray-versus-pixels method is fixed at the grab.
 * - Keys, only while the 3D host (src/components/studio/Scene3D.tsx) has focus and
 *   not in a text field: digits, a minus, a point and unit letters fill the typed
 *   field, Enter applies it exactly, Backspace edits it, Escape cancels, Alt
 *   means "this piece only" and no snapping. Escape, pointercancel, window blur
 *   and a second finger cancel the pull and leave history as it was.
 * - A coarse pointer (a finger) tests a 44 px target around the touch, so thin
 *   faces are grabbable.
 * - Development and test builds: window.__studio3d = { project, wallBox } so the
 *   browser test can find where to point and read the real mesh; neither exists in
 *   a production build.
 *
 * Connects to: src/store/{pushPullStore,toolStore,viewStore,planStore}.ts,
 * src/lib/plan/{meshBuilders,pushpull,edit}.ts, src/lib/handles3d/math.ts,
 * src/lib/keyboard.ts; the label and status line are src/components/studio/PushPullOverlay.tsx.
 */
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { isClick, pullDistance, startPull, CLICK_MAX_PX, type CameraInfo, type PullGrab, type Ray } from "@/lib/handles3d/math";
import { isTypingTarget } from "@/lib/keyboard";
import { wallRun } from "@/lib/plan/edit";
import { buildWallMeshData, faceRoleAt, type WallFaceData } from "@/lib/plan/meshBuilders";
import { isWired } from "@/lib/plan/pushpull";
import { usePlanStore } from "@/store/planStore";
import { usePushPullStore, type Face } from "@/store/pushPullStore";
import { useToolStore } from "@/store/toolStore";
import { useViewStore } from "@/store/viewStore";

const HIGHLIGHT = "#6cb6ff"; // light blue: the one colour this tool adds
const TOUCH_TARGET_PX = 44; // a finger's hit area around the touch point
/** Typed characters the field takes: digits, a sign, a point, a quote mark; letters only once there is text (units). */
const TYPED_KEY = /^[0-9.,'"+\-−]$/;
const UNIT_LETTER = /^[cmftin ]$/i;

/** What a raycast found: the face, and where. */
interface Pick {
  face: Face;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  /** Distance in px from the pointer to the ray that found it (0 for a direct hit). */
  offsetPx: number;
}

const NO_ORBIT = -1; // an action OrbitControls does not know: the gesture does nothing

export function PushPullTool({ host }: { host: RefObject<HTMLDivElement | null> }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const get = useThree((s) => s.get);
  const tool = useToolStore((s) => s.tool);
  const walking = useViewStore((s) => s.mode === "walk");
  const active = tool === "pushpull" && !walking;
  const plan = usePlanStore((s) => s.plan);
  const hover = usePushPullStore((s) => s.hover);
  const pull = usePushPullStore((s) => s.pull);

  const raycaster = useRef(new THREE.Raycaster());
  const press = useRef<{ id: number; down: { x: number; y: number; t: number }; started: boolean; restore: () => void } | null>(null);
  const grab = useRef<PullGrab | null>(null);
  const pointers = useRef(new Set<number>());

  // ---- development and test builds only: where to point, and the real mesh's size
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const hook = {
      /** A world point's position on the page, in CSS pixels. */
      project: (p: { x: number; y: number; z: number }) => {
        const r = gl.domElement.getBoundingClientRect();
        const v = new THREE.Vector3(p.x, p.y, p.z).project(camera);
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
      },
      /** The world-space box of a wall's actual mesh in the scene. */
      wallBox: (id: string) => {
        const found: THREE.Box3[] = [];
        scene.traverse((o) => {
          if (o.userData.wallId === id && (o as THREE.Mesh).isMesh) found.push(new THREE.Box3().setFromObject(o));
        });
        const b = found[0];
        return b ? { minY: b.min.y, maxY: b.max.y, minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z } : null;
      },
    };
    (window as unknown as { __studio3d?: typeof hook }).__studio3d = hook;
    return () => {
      if ((window as unknown as { __studio3d?: typeof hook }).__studio3d === hook) delete (window as unknown as { __studio3d?: typeof hook }).__studio3d;
    };
  }, [camera, gl, scene]);

  useEffect(() => {
    const el = host.current;
    if (!active || !el) {
      usePushPullStore.getState().cancel();
      usePushPullStore.getState().setHover(null);
      usePushPullStore.getState().setPointer(null);
      return;
    }
    const store = usePushPullStore;
    const canvas = gl.domElement;
    const fingers = pointers.current; // the same Set for the life of the component

    // ---- picking
    const wallMeshes = () => {
      const out: THREE.Mesh[] = [];
      scene.traverse((o) => {
        if (o.userData.wallId !== undefined && (o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
      });
      return out;
    };
    const rayAt = (clientX: number, clientY: number) => {
      const r = canvas.getBoundingClientRect();
      raycaster.current.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
      return raycaster.current.ray;
    };
    const castAt = (clientX: number, clientY: number, meshes: THREE.Mesh[]): Omit<Pick, "offsetPx"> | null => {
      rayAt(clientX, clientY);
      const hit = raycaster.current.intersectObjects(meshes, false)[0];
      const faces = hit?.object.userData.faces as WallFaceData | undefined;
      if (!hit || !faces || hit.faceIndex == null) return null;
      const info = faceRoleAt(faces, hit.faceIndex);
      if (!info) return null;
      return {
        face: { wallId: faces.wallId, role: info.role, openingId: info.openingId },
        point: hit.point.clone(),
        normal: (hit.face?.normal ?? new THREE.Vector3(0, 1, 0)).clone().transformDirection(hit.object.matrixWorld),
      };
    };
    /** The face under the pointer; a finger also gets a 44 px target: rings of rays around the touch, nearest first. */
    const pick = (clientX: number, clientY: number, touch: boolean): Pick | null => {
      const meshes = wallMeshes();
      const direct = castAt(clientX, clientY, meshes);
      if (direct) return { ...direct, offsetPx: 0 };
      if (!touch) return null;
      for (const radius of [TOUCH_TARGET_PX / 4, TOUCH_TARGET_PX / 2]) {
        let best: Pick | null = null;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const dx = Math.cos(a) * radius;
          const dy = Math.sin(a) * radius;
          const h = castAt(clientX + dx, clientY + dy, meshes);
          // prefer a wired face (the thing the user is most likely reaching for), then the closest
          if (h && (!best || (isWired(h.face.role) && !isWired(best.face.role)))) best = { ...h, offsetPx: radius };
        }
        if (best) return best;
      }
      return null;
    };

    // ---- the pointer as a distance
    const cameraInfo = (): CameraInfo => ({ position: camera.position, forward: camera.getWorldDirection(new THREE.Vector3()), fovDeg: camera.fov });
    const distanceAt = (clientX: number, clientY: number) => {
      const g = grab.current;
      if (!g) return null;
      const r = canvas.getBoundingClientRect();
      const ray = rayAt(clientX, clientY);
      return pullDistance(g, { origin: ray.origin, direction: ray.direction } as Ray, { x: clientX, y: clientY }, cameraInfo(), r.height);
    };
    const hostPoint = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    };

    // ---- OrbitControls: off for a press that grabbed a face, back as it ends
    type OrbitLike = { mouseButtons: { LEFT: number | null }; touches: { ONE: number | null } };
    const suppressOrbit = () => {
      const c = get().controls as unknown as OrbitLike | null;
      if (!c) return () => {};
      const saved = { left: c.mouseButtons.LEFT, one: c.touches.ONE };
      c.mouseButtons.LEFT = NO_ORBIT;
      c.touches.ONE = NO_ORBIT; // a second finger still starts OrbitControls' two-finger gesture
      return () => {
        c.mouseButtons.LEFT = saved.left;
        c.touches.ONE = saved.one;
      };
    };
    const endPress = () => {
      press.current?.restore();
      press.current = null;
    };
    const cancelAll = () => {
      endPress();
      grab.current = null;
      store.getState().cancel();
    };

    // ---- pointer events
    const onDown = (e: PointerEvent) => {
      fingers.add(e.pointerId);
      store.getState().setAlt(e.altKey);
      if (fingers.size > 1) {
        // a second finger: the pull is abandoned and the two fingers orbit
        cancelAll();
        return;
      }
      if (e.button !== 0) return; // middle and right always orbit
      const state = store.getState();
      const touch = e.pointerType !== "mouse";
      el.focus({ preventScroll: true }); // so Escape, digits and Enter reach this tool

      if (state.pull?.mode === "click") {
        // the second click: finish at the pointer
        e.stopPropagation();
        press.current = { id: e.pointerId, down: { x: e.clientX, y: e.clientY, t: e.timeStamp }, started: true, restore: suppressOrbit() };
        const d = distanceAt(e.clientX, e.clientY);
        if (d !== null) state.move(d);
        store.getState().commit();
        grab.current = null;
        return;
      }

      const hit = pick(e.clientX, e.clientY, touch);
      if (!hit) return; // empty space and anything that is not a wall: orbit as usual
      if (!isWired(hit.face.role)) {
        store.getState().setHover(hit.face); // "Not yet"; the press itself orbits
        store.getState().begin(hit.face, { mode: "drag" });
        return;
      }
      if (!store.getState().begin(hit.face, { mode: "drag", onlyPiece: e.altKey })) return;
      grab.current = startPull(rayAt(e.clientX, e.clientY) as unknown as Ray, hit.point, hit.normal, { x: e.clientX, y: e.clientY });
      press.current = { id: e.pointerId, down: { x: e.clientX, y: e.clientY, t: e.timeStamp }, started: false, restore: suppressOrbit() };
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* a pointer that is already gone */
      }
      store.getState().setPointer(hostPoint(e.clientX, e.clientY));
    };

    const onMove = (e: PointerEvent) => {
      store.getState().setAlt(e.altKey);
      store.getState().setPointer(hostPoint(e.clientX, e.clientY));
      const p = press.current;
      const state = store.getState();
      if (p && p.id === e.pointerId) {
        if (!p.started && Math.hypot(e.clientX - p.down.x, e.clientY - p.down.y) >= CLICK_MAX_PX) p.started = true; // a drag
        if (p.started) {
          const d = distanceAt(e.clientX, e.clientY);
          if (d !== null) state.move(d);
        }
        return;
      }
      if (state.pull?.mode === "click") {
        // click-move-click: the preview follows the pointer with no button down
        const d = distanceAt(e.clientX, e.clientY);
        if (d !== null) state.move(d);
        return;
      }
      if (state.pull || e.pointerType !== "mouse" || e.buttons !== 0) return; // hover is for a mouse with nothing pressed
      const hit = pick(e.clientX, e.clientY, false);
      state.setHover(hit ? hit.face : null);
    };

    const onUp = (e: PointerEvent) => {
      fingers.delete(e.pointerId);
      const p = press.current;
      if (!p || p.id !== e.pointerId) return;
      const state = store.getState();
      endPress();
      if (!state.pull) return;
      if (p.started) {
        state.commit(); // a drag ends on release
        grab.current = null;
      } else if (isClick(p.down, { x: e.clientX, y: e.clientY, t: e.timeStamp })) {
        state.armClick(); // a click: move the pointer, click again to finish
      } else {
        cancelAll(); // a long press that never moved
      }
    };

    const onCancel = (e: PointerEvent) => {
      fingers.delete(e.pointerId);
      if (press.current?.id === e.pointerId || store.getState().pull) cancelAll();
    };

    const onLeave = () => {
      if (!store.getState().pull) {
        store.getState().setHover(null);
        store.getState().setPointer(null);
      }
    };

    // ---- keys: only here, so only while the 3D pane has focus
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        store.getState().setAlt(e.type === "keydown");
        return;
      }
      if (e.type !== "keydown" || isTypingTarget(e.target) || e.metaKey || e.ctrlKey) return;
      const state = store.getState();
      if (e.key === "Escape") {
        if (state.pull || state.typed !== "") {
          e.preventDefault();
          e.stopPropagation(); // the pull is cancelled; the selection is not also cleared
          cancelAll();
        }
        return;
      }
      if (!state.pull && !state.hover) return; // nothing to type a distance for
      if (e.key === "Enter") {
        if (state.typed !== "") {
          e.preventDefault();
          if (state.applyTyped()) {
            endPress();
            grab.current = null;
          }
        } else if (state.pull) {
          e.preventDefault();
          state.commit();
          endPress();
          grab.current = null;
        }
        return;
      }
      if (e.key === "Backspace") {
        if (state.typed !== "") {
          e.preventDefault();
          state.setTyped(state.typed.slice(0, -1));
        }
        return;
      }
      if (e.key.length !== 1) return;
      const ch = e.key === "," ? "." : e.key;
      if (TYPED_KEY.test(e.key) || (state.typed !== "" && UNIT_LETTER.test(e.key))) {
        e.preventDefault();
        state.setTyped((state.typed + ch).slice(0, 24));
      }
    };

    el.addEventListener("pointerdown", onDown, { capture: true }); // before OrbitControls sees the press
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", cancelAll);
    el.addEventListener("keydown", onKey);
    el.addEventListener("keyup", onKey);
    return () => {
      el.removeEventListener("pointerdown", onDown, { capture: true });
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", cancelAll);
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("keyup", onKey);
      cancelAll();
      fingers.clear();
    };
  }, [active, host, gl, scene, camera, get]);

  // ---- the highlight: the face's triangles, rebuilt from the plan so it follows a live pull
  const target = active ? (pull?.face ?? hover) : null;
  const alt = usePushPullStore((s) => s.alt);
  const onlyPiece = pull ? pull.onlyPiece : alt;
  const highlight = useMemo(() => {
    if (!target) return null;
    const wall = plan.walls.find((w) => w.id === target.wallId);
    if (!wall) return null;
    // a wall top pulls the whole straight wall (unless Alt), so the whole run's tops light up
    const ids = target.role === "top" && !onlyPiece ? wallRun(plan, target.wallId) : [target.wallId];
    const positions: number[] = [];
    for (const id of ids) {
      const w = plan.walls.find((x) => x.id === id);
      if (!w) continue;
      const { geometry, faces } = buildWallMeshData(w, plan.walls, plan.openings);
      const pos = geometry.getAttribute("position");
      for (let tri = 0; tri < faces.roles.length; tri++) {
        if (faces.roles[tri] !== target.role || faces.openingIds[tri] !== target.openingId) continue; // same role, and the same opening for an opening's face
        for (let k = 0; k < 3; k++) positions.push(pos.getX(tri * 3 + k), pos.getY(tri * 3 + k), pos.getZ(tri * 3 + k));
      }
      geometry.dispose();
    }
    if (positions.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return g;
  }, [plan, target, onlyPiece]);
  useEffect(() => () => highlight?.dispose(), [highlight]);

  if (!highlight) return null;
  return (
    <mesh geometry={highlight} renderOrder={5} userData={{ pushPullHighlight: true }} raycast={() => null /* never picked itself */}>
      <meshBasicMaterial color={HIGHLIGHT} transparent opacity={0.65} side={THREE.DoubleSide} depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
    </mesh>
  );
}
