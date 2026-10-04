"use client";

/**
 * ItemTool.tsx — Move, Rotate and Scale on imported 3D models and their parts (step
 * I.1b). Lives inside the R3F <Canvas> (mounted by Scene3D next to PushPullTool) and
 * renders nothing: the tint is ImportedItems', the label and status ItemToolOverlay's.
 * The state and the one-transaction drag are src/store/itemToolStore.ts, the rules
 * src/lib/import/transform.ts; this file turns pointer events into those calls.
 *
 * - What the pointer is over: the first thing a ray from it hits, when that is a model
 *   (a wall or a door in front hides the model behind it). A finger (coarse pointer)
 *   with nothing right under it tries two rings of rays, 11 and 22 px out: a 44 px target.
 *   With Edit parts on for that model, the target is a part: the active one when the
 *   pointer is on it, else the one model.pickPart gives (the highest named node).
 * - Rotate and Scale: this component takes the press itself. Move: PushPullTool takes
 *   every press and hover (it also moves doors, windows, walls and corners); it asks
 *   `probe` how far the model under the pointer is, and when the model is the nearest
 *   thing it calls `press` (both handed over through itemToolStore.bridge).
 * - The drag, measured from where it was grabbed so nothing jumps:
 *     Move    on the horizontal plane through the base point (math.rayPlanePoint; the
 *             last valid point is held when the ray misses it), or with Shift or the
 *             Lift toggle straight up along world Y (math.startPull / pullDistance);
 *     Rotate  the pointer's angle on that plane round the base point;
 *     Scale   the pointer's screen distance from the base point's projection.
 *   A part's base point is its pivot. A press that comes up as a click selects the model
 *   (or part) without changing it. Alt turns snapping off.
 * - OrbitControls is switched off for a press that grabbed a model (its left button and
 *   one-finger actions, as PushPullTool does); a press anywhere else still orbits.
 *   Escape, pointercancel, window blur and a second finger roll the drag back.
 * - Keys, only while the 3D host has focus: Rotate takes digits, a sign, a point and °,
 *   Scale digits, a point and %; Enter applies (Rotate turns BY the degrees, Scale sets
 *   the percentage), Backspace edits, Escape cancels.
 *
 * Connects to: src/store/{itemToolStore,selectionStore,toolStore,viewStore}.ts,
 * src/lib/handles3d/math.ts, src/lib/import/{model,transform}.ts, src/lib/keyboard.ts;
 * PushPullTool.tsx (Move).
 */
import { useThree } from "@react-three/fiber";
import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { CLICK_MAX_PX, isClick, pullDistance, rayPlanePoint, startPull, type CameraInfo, type PullGrab, type Ray } from "@/lib/handles3d/math";
import { pickPart } from "@/lib/import/model";
import { pointerAngle } from "@/lib/import/transform";
import { isTypingTarget } from "@/lib/keyboard";
import { targetPivot, useItemToolStore, type ItemTarget, type ItemToolKind } from "@/store/itemToolStore";
import { useSelectionStore } from "@/store/selectionStore";
import { isItemTool, useToolStore } from "@/store/toolStore";
import { useViewStore } from "@/store/viewStore";
import type { Vec2 } from "@/types/plan";

const TOUCH_TARGET_PX = 44;
const NO_ORBIT = -1; // an action OrbitControls does not know: the gesture does nothing
const UP = { x: 0, y: 1, z: 0 };
const TYPED: Record<"rotate" | "scale", RegExp> = { rotate: /^[0-9.,+\-−°]$/, scale: /^[0-9.,%]$/ };

type Grab =
  | { kind: "floor"; at: Vec2; height: number; last: Vec2 }
  | { kind: "lift"; pull: PullGrab }
  | { kind: "rotate"; centre: Vec2; height: number; a0: number; last: number }
  | { kind: "scale"; centre: { x: number; y: number }; px0: number };

const itemOf = (o: THREE.Object3D | null): string | null => {
  for (let x = o; x; x = x.parent) if (x.userData.importItemId) return String(x.userData.importItemId);
  return null;
};
const cloneRootOf = (o: THREE.Object3D | null): THREE.Object3D | null => {
  for (let x = o; x; x = x.parent) if (x.userData.importPath === "") return x;
  return null;
};
const inside = (path: string, part: string) => path === part || path.startsWith(`${part}/`);

/** The model (or part) a hit mesh means for the tools, given the selection's Edit parts state. */
function targetOf(object: THREE.Object3D): ItemTarget | null {
  const itemId = itemOf(object);
  if (!itemId) return null;
  const sel = useSelectionStore.getState();
  const root = cloneRootOf(object);
  if (sel.itemId !== itemId || !sel.editParts || !root) return { itemId, path: null };
  const own = object.userData.importPath;
  if (sel.partPath !== null && typeof own === "string" && inside(own, sel.partPath)) return { itemId, path: sel.partPath }; // keeps an Alt-picked part
  return { itemId, path: pickPart(root, object, { deep: false }) };
}

export function ItemTool({ host }: { host: RefObject<HTMLDivElement | null> }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const get = useThree((s) => s.get);
  const tool = useToolStore((s) => s.tool);
  const walking = useViewStore((s) => s.mode === "walk");
  const active = isItemTool(tool) && !walking;
  const raycaster = useRef(new THREE.Raycaster());
  const press = useRef<{ id: number; down: { x: number; y: number; t: number }; started: boolean; restore: () => void; grab: Grab; target: ItemTarget } | null>(null);
  const fingers = useRef(new Set<number>());

  useEffect(() => {
    const el = host.current;
    const store = useItemToolStore;
    if (!active || !el) {
      store.getState().cancel();
      store.getState().setHover(null);
      store.getState().setPointer(null);
      return;
    }
    const kind = tool as ItemToolKind;
    const canvas = gl.domElement;
    const pointers = fingers.current;

    const rayAt = (clientX: number, clientY: number) => {
      const r = canvas.getBoundingClientRect();
      raycaster.current.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
      return raycaster.current.ray;
    };
    const hostPoint = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    };
    const toClient = (p: { x: number; y: number; z: number }) => {
      const v = new THREE.Vector3(p.x, p.y, p.z).project(camera);
      const r = canvas.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    };
    const cameraInfo = (): CameraInfo => ({ position: camera.position, forward: camera.getWorldDirection(new THREE.Vector3()), fovDeg: camera.fov });

    // ---- what the pointer is over: a model, when it is the first thing the ray meets
    const solids = () => {
      const out: THREE.Object3D[] = [];
      scene.traverse((o) => {
        const u = o.userData;
        if ((o as THREE.Mesh).isMesh && (u.importItemId !== undefined || u.wallId !== undefined || u.openingId !== undefined)) out.push(o);
      });
      return out;
    };
    const hitAt = (clientX: number, clientY: number, list: THREE.Object3D[]) => {
      rayAt(clientX, clientY);
      const first = raycaster.current.intersectObjects(list, false)[0];
      return first && first.object.userData.importItemId !== undefined ? { object: first.object, distance: first.distance } : null;
    };
    const probe = (clientX: number, clientY: number, touch: boolean) => {
      const list = solids();
      let hit = hitAt(clientX, clientY, list);
      for (const radius of touch && !hit ? [TOUCH_TARGET_PX / 4, TOUCH_TARGET_PX / 2] : []) {
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const h = hitAt(clientX + Math.cos(a) * radius, clientY + Math.sin(a) * radius, list);
          if (h && (!hit || h.distance < hit.distance)) hit = h;
        }
        if (hit) break;
      }
      const target = hit && targetOf(hit.object);
      return hit && target ? { target, distance: hit.distance } : null;
    };

    // ---- OrbitControls: off for a press that grabbed a model, back as it ends
    type OrbitLike = { mouseButtons: { LEFT: number | null }; touches: { ONE: number | null } };
    const suppressOrbit = () => {
      const c = get().controls as unknown as OrbitLike | null;
      if (!c) return () => {};
      const saved = { left: c.mouseButtons.LEFT, one: c.touches.ONE };
      c.mouseButtons.LEFT = NO_ORBIT;
      c.touches.ONE = NO_ORBIT;
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
      store.getState().cancel();
    };

    /** Start a drag on the model under the pointer; false when there is none or it can't be moved. */
    const begin = (e: PointerEvent): boolean => {
      if (store.getState().drag || e.button !== 0) return false;
      const found = probe(e.clientX, e.clientY, e.pointerType !== "mouse");
      if (!found) return false;
      el.focus({ preventScroll: true }); // so Escape, digits and Enter reach this tool
      store.getState().setAlt(e.altKey);
      const lift = kind === "move" && (e.shiftKey || store.getState().liftMode);
      if (!store.getState().begin(found.target, kind, { lift })) return false;
      const pivot = targetPivot(found.target)!;
      const ray = rayAt(e.clientX, e.clientY);
      const onPlane = () => rayPlanePoint({ origin: ray.origin, direction: ray.direction }, { x: 0, y: pivot.y, z: 0 }, UP);
      let grab: Grab | null = null;
      if (kind === "scale") {
        const c = toClient(pivot);
        grab = { kind: "scale", centre: c, px0: Math.hypot(e.clientX - c.x, e.clientY - c.y) };
      } else if (lift) grab = { kind: "lift", pull: startPull({ origin: ray.origin, direction: ray.direction } as Ray, pivot, UP, { x: e.clientX, y: e.clientY }) };
      else {
        const at = onPlane();
        if (at && kind === "move") grab = { kind: "floor", at: { x: at.x, y: at.z }, height: pivot.y, last: { x: at.x, y: at.z } };
        if (at && kind === "rotate") {
          const centre = { x: pivot.x, y: pivot.z };
          const a0 = pointerAngle(centre, { x: at.x, y: at.z });
          grab = { kind: "rotate", centre, height: pivot.y, a0, last: a0 };
        }
      }
      if (!grab) {
        store.getState().cancel(); // aimed above the horizon: nothing on the floor to drag
        return false;
      }
      press.current = { id: e.pointerId, down: { x: e.clientX, y: e.clientY, t: e.timeStamp }, started: false, restore: suppressOrbit(), grab, target: found.target };
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* a pointer that is already gone */
      }
      store.getState().setPointer(hostPoint(e.clientX, e.clientY));
      return true;
    };

    /** Move the drag to the pointer. */
    const follow = (clientX: number, clientY: number) => {
      const g = press.current?.grab;
      if (!g) return;
      const s = store.getState();
      if (g.kind === "scale") return s.scale(g.px0, Math.hypot(clientX - g.centre.x, clientY - g.centre.y));
      const ray = rayAt(clientX, clientY);
      if (g.kind === "lift") {
        const d = pullDistance(g.pull, { origin: ray.origin, direction: ray.direction } as Ray, { x: clientX, y: clientY }, cameraInfo(), canvas.getBoundingClientRect().height);
        if (d !== null) s.lift(d);
        return;
      }
      const at = rayPlanePoint({ origin: ray.origin, direction: ray.direction }, { x: 0, y: g.height, z: 0 }, UP);
      if (g.kind === "floor") {
        if (at) g.last = { x: at.x, y: at.z }; // the ray missed the plane: hold the last valid point
        s.moveFloor(g.at, g.last);
      } else {
        if (at) g.last = pointerAngle(g.centre, { x: at.x, y: at.z });
        s.rotate(g.a0, g.last);
      }
    };

    // ---- pointer events
    const onDown = (e: PointerEvent) => {
      pointers.add(e.pointerId);
      if (pointers.size > 1) {
        cancelAll(); // a second finger: the drag is abandoned and the two fingers orbit
        return;
      }
      if (kind !== "move") begin(e); // Move's presses come through PushPullTool (bridge.press)
    };
    const onMove = (e: PointerEvent) => {
      store.getState().setAlt(e.altKey);
      store.getState().setPointer(hostPoint(e.clientX, e.clientY)); // the label follows the pointer (in Move too)
      const p = press.current;
      if (p && p.id === e.pointerId) {
        if (!p.started && Math.hypot(e.clientX - p.down.x, e.clientY - p.down.y) >= CLICK_MAX_PX) p.started = true;
        if (p.started) follow(e.clientX, e.clientY);
        return;
      }
      if (kind === "move") return; // Move's hover is PushPullTool's (it asks probe)
      if (e.pointerType !== "mouse") return; // hover is for a mouse
      if (e.buttons !== 0) return store.getState().setHover(null); // orbiting
      store.getState().setHover(probe(e.clientX, e.clientY, false)?.target ?? null);
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      const p = press.current;
      if (!p || p.id !== e.pointerId) return;
      endPress();
      if (p.started) return store.getState().commit();
      store.getState().cancel();
      if (isClick(p.down, { x: e.clientX, y: e.clientY, t: e.timeStamp })) {
        // a click selects what it was on, changing nothing: typed values then go to it
        const sel = useSelectionStore.getState();
        sel.selectItem(p.target.itemId);
        if (p.target.path !== null) sel.selectPart(p.target.path);
      }
    };
    const onCancel = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (press.current?.id === e.pointerId || store.getState().drag) cancelAll();
    };
    const onLeave = () => {
      if (!press.current && kind !== "move") {
        store.getState().setHover(null);
        store.getState().setPointer(null);
      }
    };

    // ---- keys: only here, so only while the 3D pane has focus
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Alt") return store.getState().setAlt(e.type === "keydown");
      if (e.type !== "keydown" || isTypingTarget(e.target) || e.metaKey || e.ctrlKey) return;
      const s = store.getState();
      if (e.key === "Escape") {
        if (s.drag || s.typed !== "") {
          e.preventDefault();
          e.stopPropagation(); // the drag is cancelled; the selection is not also cleared
          cancelAll();
        }
        return;
      }
      if (kind === "move") return; // Move's typed distances are PushPullTool's (doors, windows, walls)
      if (e.key === "Enter") {
        if (s.typed === "") return;
        e.preventDefault();
        if (s.applyTyped(kind)) endPress();
        return;
      }
      if (e.key === "Backspace") {
        if (s.typed !== "") {
          e.preventDefault();
          s.setTyped(s.typed.slice(0, -1));
        }
        return;
      }
      if (e.key.length === 1 && TYPED[kind].test(e.key)) {
        e.preventDefault();
        s.setTyped((s.typed + (e.key === "," ? "." : e.key)).slice(0, 12));
      }
    };

    if (kind === "move") store.getState().setBridge({ probe, press: begin });
    el.addEventListener("pointerdown", onDown, { capture: true }); // before OrbitControls sees the press
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", cancelAll);
    el.addEventListener("keydown", onKey);
    el.addEventListener("keyup", onKey);
    return () => {
      if (store.getState().bridge?.probe === probe) store.getState().setBridge(null);
      el.removeEventListener("pointerdown", onDown, { capture: true });
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", cancelAll);
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("keyup", onKey);
      cancelAll();
      pointers.clear();
    };
  }, [active, tool, host, gl, scene, camera, get]);

  return null;
}
