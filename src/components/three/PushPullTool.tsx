"use client";

/**
 * PushPullTool.tsx — the 3D Push/Pull and Move tools (steps 4.7a, 4.7b and 4.7c). Lives
 * inside the R3F <Canvas> (mounted by Scene3D, next to PlanModel) and renders only
 * the face highlight. Active when toolStore.tool is "pushpull" or "move" and the 3D
 * pane is not walking. The state is in src/store/pushPullStore.ts, the rules in
 * src/lib/plan/pushpull.ts, the pointer maths in src/lib/handles3d/{math,edges}.ts;
 * this file turns pointer events into those calls.
 *
 * - What the pointer is over:
 *   1. Move only, first: a door's or window's frame, leaf or glass under the pointer (an
 *      opening within one wall thickness behind the nearest wall wins, edges.pickAlongRay).
 *   2. an opening's EDGE BAND: each door's and window's sides, top and (windows) sill,
 *      on the wall face looking at the camera, projected to the screen
 *      (edges.openingEdgeLines); the nearest within 14 px (44 px for a finger) wins
 *      (edges.resolveOpeningEdge) unless a wall hides it. A jamb is seen almost
 *      edge-on from the front, so this band is what makes it grabbable. The edge is
 *      drawn as a 3 px blue line by the overlay. Push/Pull also has a band on a door's
 *      bottom, which says "A door stays on the floor".
 *   3. Move only: a CORNER (4.7c). Every distinct joint is a vertical line from the floor
 *      to its tallest wall's top, projected to the screen; the nearest within 14 px (44 px
 *      for a finger) wins (edges.resolveCorner) unless a wall hides it. Drawn as a 3 px
 *      blue line with a small marker at its foot. The order edge > corner > face holds
 *      within 14 px; past that (a finger's 44 px), the nearer wins, and a finger right on
 *      a wall face keeps it (see `pick`).
 *   4. the face-role raycast on the wall meshes (meshBuilders face roles), with rings of
 *      rays round a finger. Only EXPOSED triangles count (meshBuilders.pickableFaceAt):
 *      a hidden face (inside the wall, or a wall end at a joint) is never hovered or
 *      picked; the ray goes on to the next hit. An edge beats a face of its own straight
 *      wall and any face behind it; a face of another wall IN FRONT of the edge keeps the
 *      pointer; with no face under the pointer the nearer of edge and ring face wins (see
 *      `pick`). In Move a wall face that belongs to an opening means that opening, a wall
 *      side moves the whole straight wall sideways, and a wall top says "Pull the top
 *      with Push/Pull".
 *   So the order is: (Move) the opening's own meshes, then an opening edge, then (Move) a
 *   corner, then a wall face. The face is tinted light blue (a polygon-offset overlay: a
 *   wall face's exposed triangles, across the whole straight wall for a side; an opening
 *   face's reveal quad; in Move every face of the opening, or of the whole wall, and
 *   PlanModel tints an opening's frame). Hover never selects.
 * - Start: pointerdown on something that can be pulled starts a pull and keeps
 *   OrbitControls from also orbiting, by switching its left-button and one-finger
 *   actions off for that press. A press anywhere else, a face that can't be pulled, the
 *   middle or right button and a second finger all still orbit. A press that moves
 *   5 px is a drag (the pull follows the pointer, release commits). A press that comes
 *   up as a click (math.isClick) leaves the pull armed: move the pointer, click again.
 * - The pointer becomes a distance along the face's axis (pushpull.faceAxis: a wall top
 *   up through the grab point; an opening's sides, and a Move, along the wall through
 *   the opening's centre at mid-height; its top and sill along world Y; a wall side
 *   along its outward normal and a wall end along the wall, through the grab point),
 *   measured from where it was grabbed so nothing jumps (math.startPull / pullDistance).
 *   The ray-versus-pixels method is fixed at the grab. Move's midpoint snap reaches 12 px
 *   at the opening's depth (math.metresPerPixel), like the 2D tool's.
 * - A corner is dragged on the horizontal plane through the point where it was grabbed
 *   (math.rayPlanePoint), measured from the grab so it does not jump: the joint moves
 *   by the pointer's movement on that plane. When the ray misses the plane (aimed above
 *   the horizon) the last valid position is held. Snapping is the 2D handle drag's
 *   (pushpull.dragCorner), reaching 12 px at the joint's depth; Alt turns it off. No
 *   typed distance: the status line says to type exact lengths in the wall panel.
 * - Keys, only while the 3D host (src/components/studio/Scene3D.tsx) has focus and
 *   not in a text field: digits, a minus, a point and unit letters fill the typed
 *   field, Enter applies it exactly, Backspace edits it, Escape cancels, Alt
 *   means "this piece only" (a wall top) and no snapping, Shift on a wall side moves
 *   the wall instead of thickening it (latched while a distance is being typed, since
 *   a typed inch mark needs Shift). Escape, pointercancel, window blur and a second
 *   finger cancel the pull and leave history as it was.
 * - A coarse pointer (a finger) tests a 44 px target around the touch, so thin
 *   faces are grabbable.
 * - Development and test builds: window.__studio3d = { project, wallBox, openingBox }
 *   so the browser test can find where to point and read the real meshes; it does not
 *   exist in a production build.
 *
 * Connects to: src/store/{pushPullStore,toolStore,viewStore,planStore}.ts,
 * src/lib/plan/{meshBuilders,pushpull,edit}.ts, src/lib/handles3d/{math,edges}.ts,
 * src/lib/keyboard.ts; the label, edge line and status are src/components/studio/PushPullOverlay.tsx.
 */
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { SCENE_COLORS } from "@/data/materials";
import { EDGE_TOL_MOUSE_PX, EDGE_TOL_TOUCH_PX, openingEdgeLine, openingEdgeLines, openingFaceQuad, pickAlongRay, resolveCorner, resolveOpeningEdge, type EdgeLine, type RayHit, type ScreenCorner, type ScreenEdge } from "@/lib/handles3d/edges";
import { isClick, metresPerPixel, pullDistance, rayPlanePoint, startPull, CLICK_MAX_PX, type CameraInfo, type PullGrab, type Ray } from "@/lib/handles3d/math";
import { isTypingTarget } from "@/lib/keyboard";
import { SNAP_MAX_M, SNAP_MIN_M, SNAP_TOL_PX, wallRun } from "@/lib/plan/edit";
import { wallDirection } from "@/lib/plan/geometry";
import { buildWallMeshData, pickableFaceAt, type FaceRole, type WallFaceData } from "@/lib/plan/meshBuilders";
import { faceAxis, faceBlock, isOpeningRole, isSideRole, planCorners } from "@/lib/plan/pushpull";
import { usePlanStore } from "@/store/planStore";
import { usePushPullStore, type CornerRef, type EdgeSeg, type Face } from "@/store/pushPullStore";
import { is3dTool, useToolStore } from "@/store/toolStore";
import { useViewStore } from "@/store/viewStore";
import type { Plan, Vec2 } from "@/types/plan";

const TOUCH_TARGET_PX = 44; // a finger's hit area around the touch point
const OCCLUDE_EPS = 0.05; // m: a wall this much nearer than an edge hides it (less is the edge's own corner)
/** Typed characters the field takes: digits, a sign, a point, a quote mark; letters only once there is text (units). */
const TYPED_KEY = /^[0-9.,'"+\-−]$/;
const UNIT_LETTER = /^[cmftin ]$/i;

/** What the pointer is over: the face, where a raycast hit it (null for an edge band), the edge's screen line,
 *  how far from the pointer it was found (px; 0 for a direct hit) and how far from the camera (m). */
interface Pick {
  face: Face;
  point: THREE.Vector3 | null;
  seg: EdgeSeg | null;
  px: number;
  depth: number;
}

/** A corner the pointer is on (Move): the joint, where along its line (0 floor, 1 top), its line on screen and its foot. */
interface CornerPick {
  corner: CornerRef;
  height: number;
  t: number;
  seg: EdgeSeg | null;
  marker: { x: number; y: number } | null;
  px: number;
}
const isCorner = (h: Pick | CornerPick | null): h is CornerPick => !!h && "corner" in h;

const NO_ORBIT = -1; // an action OrbitControls does not know: the gesture does nothing
const UP = { x: 0, y: 1, z: 0 };
const v3 = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z);

export function PushPullTool({ host }: { host: RefObject<HTMLDivElement | null> }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const get = useThree((s) => s.get);
  const tool = useToolStore((s) => s.tool);
  const walking = useViewStore((s) => s.mode === "walk");
  const active = is3dTool(tool) && !walking;
  const moving = tool === "move";
  const plan = usePlanStore((s) => s.plan);
  const hover = usePushPullStore((s) => s.hover);
  const pull = usePushPullStore((s) => s.pull);

  const raycaster = useRef(new THREE.Raycaster());
  const press = useRef<{ id: number; down: { x: number; y: number; t: number }; started: boolean; restore: () => void } | null>(null);
  const grab = useRef<(PullGrab & { sign: 1 | -1 }) | null>(null);
  /** A corner drag: where on the horizontal plane at `height` it was grabbed, the joint then, and the last valid pointer point. */
  const cornerGrab = useRef<{ at: { x: number; z: number }; joint: Vec2; height: number; last: Vec2 } | null>(null);
  const pointers = useRef(new Set<number>());

  // ---- development and test builds only: where to point, and the real meshes' sizes
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const boxOf = (match: (o: THREE.Object3D) => boolean, first: boolean) => {
      const b = new THREE.Box3();
      let any = false;
      scene.traverse((o) => {
        if ((first && any) || !(o as THREE.Mesh).isMesh || !match(o)) return;
        b.union(new THREE.Box3().setFromObject(o));
        any = true;
      });
      return any ? { minY: b.min.y, maxY: b.max.y, minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z } : null;
    };
    const hook = {
      /** A world point's position on the page, in CSS pixels. */
      project: (p: { x: number; y: number; z: number }) => {
        const r = gl.domElement.getBoundingClientRect();
        const v = v3(p).project(camera);
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
      },
      /** The world-space box of a wall's actual mesh in the scene. */
      wallBox: (id: string) => boxOf((o) => o.userData.wallId === id, true),
      /** The world-space box of every mesh of a door or window (its frame spans exactly its width and height). */
      openingBox: (id: string) => boxOf((o) => o.userData.openingId === id, false),
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
    const livePlan = () => usePlanStore.getState().plan;

    // ---- the scene's meshes
    const meshes = (key: "wallId" | "openingId") => {
      const out: THREE.Mesh[] = [];
      scene.traverse((o) => {
        if (o.userData[key] !== undefined && (o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
      });
      return out;
    };
    const rayAt = (clientX: number, clientY: number) => {
      const r = canvas.getBoundingClientRect();
      raycaster.current.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
      return raycaster.current.ray;
    };
    /** A world point on the page (client px), or null behind the camera. */
    const toClient = (p: THREE.Vector3) => {
      const v = p.clone().project(camera);
      if (v.z > 1 || v.z < -1) return null;
      const r = canvas.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    };
    const hostPoint = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    };
    /** An edge or corner line as a segment in the host's own pixels, for the overlay to draw. */
    const segOf = (line: { a: { x: number; y: number; z: number }; b: { x: number; y: number; z: number } }): EdgeSeg | null => {
      const [a, b] = [toClient(v3(line.a)), toClient(v3(line.b))];
      if (!a || !b) return null;
      const [p, q] = [hostPoint(a.x, a.y), hostPoint(b.x, b.y)];
      return { x1: p.x, y1: p.y, x2: q.x, y2: q.y };
    };

    // ---- 2: edge bands
    /** True when a wall stands more than `slack` m in front of `p`. */
    const hiddenAt = (p: THREE.Vector3, walls: THREE.Mesh[], slack = OCCLUDE_EPS) => {
      const dir = p.clone().sub(camera.position);
      const dist = dir.length();
      raycaster.current.set(camera.position, dir.normalize());
      const hit = raycaster.current.intersectObjects(walls, false)[0];
      return !!hit && hit.distance < dist - slack;
    };
    /** True when a wall stands in front of the point `t` of the way along `line`. */
    const hidden = (line: EdgeLine, t: number, walls: THREE.Mesh[]) => hiddenAt(v3(line.a).lerp(v3(line.b), t), walls);
    /** The nearest visible edge in `lines` within `tol` px of the pointer. */
    const nearestEdge = (clientX: number, clientY: number, lines: { line: EdgeLine; openingId: string; wallId: string }[], tol: number, walls: THREE.Mesh[]): Pick | null => {
      const screen = new Map<ScreenEdge, (typeof lines)[number]>();
      for (const l of lines) {
        const [a, b] = [toClient(v3(l.line.a)), toClient(v3(l.line.b))];
        if (a && b) screen.set({ role: l.line.role, openingId: l.openingId, a, b }, l);
      }
      // ponytail: drop a hidden winner and ask again, at most 4 times; plenty for a house, a scan if plans grow huge
      for (let tries = 0; tries < 4 && screen.size > 0; tries++) {
        const r = resolveOpeningEdge({ x: clientX, y: clientY }, [...screen.keys()], tol);
        if (!r) return null;
        const key = [...screen.keys()].find((k) => k.openingId === r.openingId && k.role === r.role)!;
        const l = screen.get(key)!;
        if (!hidden(l.line, r.t, walls)) {
          const depth = v3(l.line.a).lerp(v3(l.line.b), r.t).distanceTo(camera.position);
          return { face: { wallId: l.wallId, role: l.line.role, openingId: l.openingId }, point: null, seg: segOf(l.line), px: r.distancePx, depth };
        }
        screen.delete(key);
      }
      return null;
    };
    const pickEdge = (clientX: number, clientY: number, touch: boolean, walls: THREE.Mesh[]): Pick | null => {
      const p = livePlan();
      const tol = touch ? EDGE_TOL_TOUCH_PX : EDGE_TOL_MOUSE_PX;
      const edges: { line: EdgeLine; openingId: string; wallId: string }[] = [];
      const floors: typeof edges = [];
      for (const o of p.openings) {
        const wall = p.walls.find((w) => w.id === o.wallId);
        if (!wall) continue;
        for (const line of openingEdgeLines(wall, o, camera.position)) edges.push({ line, openingId: o.id, wallId: wall.id });
        if (o.kind === "door") floors.push({ line: openingEdgeLine(wall, o, "sill", camera.position), openingId: o.id, wallId: wall.id }); // a door's bottom: Push/Pull says why it can't move
      }
      return nearestEdge(clientX, clientY, edges, tol, walls) ?? (moving ? null : nearestEdge(clientX, clientY, floors, tol, walls));
    };

    // ---- 3: corners (Move)
    /** A joint's vertical line, floor to top, as world points. */
    const cornerLine = (p: Vec2, height: number) => ({ a: { x: p.x, y: 0, z: p.y }, b: { x: p.x, y: height, z: p.y } });
    const footOf = (p: Vec2) => {
      const c = toClient(v3({ x: p.x, y: 0, z: p.y }));
      return c ? hostPoint(c.x, c.y) : null;
    };
    const pickCorner = (clientX: number, clientY: number, touch: boolean, walls: THREE.Mesh[]): CornerPick | null => {
      const p = livePlan();
      const list = planCorners(p);
      const screen: ScreenCorner[] = [];
      list.forEach((c, i) => {
        const [a, b] = [toClient(v3({ x: c.point.x, y: 0, z: c.point.y })), toClient(v3({ x: c.point.x, y: c.height, z: c.point.y }))];
        if (a && b) screen.push({ id: String(i), a, b });
      });
      const tol = touch ? EDGE_TOL_TOUCH_PX : EDGE_TOL_MOUSE_PX;
      // ponytail: drop a hidden winner and ask again, at most 4 times, as nearestEdge does
      for (let tries = 0; tries < 4 && screen.length > 0; tries++) {
        const r = resolveCorner({ x: clientX, y: clientY }, screen, tol);
        if (!r) return null;
        const c = list[Number(r.id)];
        // The joint's line runs inside the walls' corner, so the walls there may stand in front of it by up to about their thickness.
        const slack = Math.max(...c.wallIds.map((id) => p.walls.find((w) => w.id === id)?.thickness ?? 0)) + OCCLUDE_EPS;
        if (!hiddenAt(new THREE.Vector3(c.point.x, r.t * c.height, c.point.y), walls, slack)) {
          return { corner: { wallId: c.wallId, end: c.end, point: c.point }, height: c.height, t: r.t, seg: segOf(cornerLine(c.point, c.height)), marker: footOf(c.point), px: r.distancePx };
        }
        screen.splice(screen.findIndex((s) => s.id === r.id), 1);
      }
      return null;
    };

    // ---- 1: a door's or window's own meshes (Move)
    const pickOpeningMesh = (clientX: number, clientY: number, walls: THREE.Mesh[]): Pick | null => {
      rayAt(clientX, clientY);
      const hits: RayHit[] = raycaster.current.intersectObjects([...walls, ...meshes("openingId")], false).map((h) =>
        h.object.userData.wallId !== undefined ? { kind: "wall", id: String(h.object.userData.wallId), distance: h.distance } : { kind: "opening", id: String(h.object.userData.openingId), distance: h.distance },
      );
      const p = livePlan();
      const t = pickAlongRay(hits, (id) => p.walls.find((w) => w.id === id)?.thickness ?? 0);
      const o = t?.kind === "opening" ? p.openings.find((x) => x.id === t.id) : undefined;
      return o ? { face: { wallId: o.wallId, role: "jambA", openingId: o.id }, point: null, seg: null, px: 0, depth: hits[0]?.distance ?? 0 } : null;
    };

    // ---- 4: the face-role raycast (exposed triangles only)
    const castAt = (clientX: number, clientY: number, walls: THREE.Mesh[]): Pick | null => {
      rayAt(clientX, clientY);
      // the first EXPOSED triangle along the ray: a hidden one (inside a wall, or a wall end at a joint) is passed by
      for (const hit of raycaster.current.intersectObjects(walls, false)) {
        const faces = hit.object.userData.faces as WallFaceData | undefined;
        const info = faces && hit.faceIndex != null ? pickableFaceAt(faces, hit.faceIndex) : null;
        if (faces && info) return { face: { wallId: faces.wallId, role: info.role, openingId: info.openingId }, point: hit.point.clone(), seg: null, px: 0, depth: hit.distance };
      }
      return null;
    };
    /** For a finger that hit no face: rings of rays around the touch, nearest first, so a 44 px target finds a thin face. */
    const castRings = (clientX: number, clientY: number, walls: THREE.Mesh[]): Pick | null => {
      const p = livePlan();
      for (const radius of [TOUCH_TARGET_PX / 4, TOUCH_TARGET_PX / 2]) {
        let best: Pick | null = null;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const h = castAt(clientX + Math.cos(a) * radius, clientY + Math.sin(a) * radius, walls);
          // prefer a face that can be pulled (the thing the user is most likely reaching for), then the one nearest the
          // camera: since 4.7c every wall side can be pulled, and the first ray's hit could be a wall behind the one the
          // finger is next to
          const pullable = (f: Pick) => !faceBlock(p, f.face, moving);
          if (h && (!best || (pullable(h) && !pullable(best)) || (pullable(h) === pullable(best) && h.depth < best.depth))) best = { ...h, px: radius };
        }
        if (best) return best;
      }
      return null;
    };

    /**
     * The edge band comes first, and an edge beats the wall face behind it: any face of the opening's own straight
     * wall, and any face further from the camera. A face of ANOTHER wall standing in front of the edge keeps the
     * pointer, whether it is right under it or found by a finger's touch rings (on a phone a door just over a nearer
     * wall's top is a few px from that wall's top). With no face under the pointer, the nearer to the finger of the
     * edge and the ring face wins, the edge on a tie.
     */
    const pick = (clientX: number, clientY: number, touch: boolean): Pick | CornerPick | null => {
      const walls = meshes("wallId");
      if (moving) {
        const frame = pickOpeningMesh(clientX, clientY, walls); // the door or window itself, under the pointer
        if (frame) return frame;
      }
      const edge = pickEdge(clientX, clientY, touch, walls);
      const inFront = (f: Pick, e: Pick) => !wallRun(livePlan(), e.face.wallId).includes(f.face.wallId) && f.depth < e.depth - OCCLUDE_EPS;
      const direct = castAt(clientX, clientY, walls); // in Move, a wall top or end: the store says why it can't move
      let hit: Pick | null;
      if (direct) hit = edge && !inFront(direct, edge) ? edge : direct;
      else {
        const ring = touch ? castRings(clientX, clientY, walls) : null;
        hit = !edge || !ring ? (edge ?? ring) : inFront(ring, edge) || ring.px < edge.px ? ring : edge;
      }
      // Priority is opening edge > corner > wall face within the precise (mouse) 14 px. A finger's extra reach, 14 to
      // 44 px, goes to whichever is nearer: at phone scale the 44 px bands would otherwise cover most of the model, so a
      // finger aimed right at a corner would get a window 40 px away, and one right ON a wall face would get a corner.
      const corner = moving ? pickCorner(clientX, clientY, touch, walls) : null;
      if (hit && hit === edge) return corner && edge.px > EDGE_TOL_MOUSE_PX && corner.px < edge.px ? corner : edge;
      if (corner && direct && hit === direct && corner.px > EDGE_TOL_MOUSE_PX) return direct; // a finger on a face keeps it
      return corner ?? hit;
    };

    // ---- the pointer as a distance
    const cameraInfo = (): CameraInfo => ({ position: camera.position, forward: camera.getWorldDirection(new THREE.Vector3()), fovDeg: camera.fov });
    const distanceAt = (clientX: number, clientY: number) => {
      const g = grab.current;
      if (!g) return null;
      const r = canvas.getBoundingClientRect();
      const ray = rayAt(clientX, clientY);
      const d = pullDistance(g, { origin: ray.origin, direction: ray.direction } as Ray, { x: clientX, y: clientY }, cameraInfo(), r.height);
      return d === null ? null : d * g.sign;
    };
    /** The dragged corner's new place: the joint plus how far the pointer moved on its horizontal plane (the last valid place when the ray misses it). */
    const cornerTo = (clientX: number, clientY: number): Vec2 | null => {
      const g = cornerGrab.current;
      if (!g) return null;
      const ray = rayAt(clientX, clientY);
      const at = rayPlanePoint({ origin: ray.origin, direction: ray.direction }, { x: 0, y: g.height, z: 0 }, UP);
      if (at) g.last = { x: g.joint.x + at.x - g.at.x, y: g.joint.y + at.z - g.at.z };
      return g.last;
    };
    /** Move the pull to the pointer, and keep the drawn edge (or corner line) on it as it moves. */
    const follow = (clientX: number, clientY: number) => {
      if (cornerGrab.current) {
        const to = cornerTo(clientX, clientY);
        if (to) store.getState().moveCorner(to);
        const now = store.getState().pull;
        const at = now?.cornerResult?.point ?? cornerGrab.current.joint;
        const height = Math.max(...planCorners(livePlan()).filter((c) => Math.hypot(c.point.x - at.x, c.point.y - at.y) < 0.01).map((c) => c.height), cornerGrab.current.height);
        store.getState().setEdge(segOf(cornerLine(at, height)), footOf(at));
        return;
      }
      const d = distanceAt(clientX, clientY);
      if (d !== null) store.getState().move(d);
      const now = store.getState().pull;
      const p = livePlan();
      const o = now && now.kind === "pull" && isOpeningRole(now.face.role) ? p.openings.find((x) => x.id === now.face.openingId) : undefined;
      const wall = o && p.walls.find((w) => w.id === o.wallId);
      store.getState().setEdge(o && wall && now && isOpeningRole(now.face.role) ? segOf(openingEdgeLine(wall, o, now.face.role, camera.position)) : null);
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
      cornerGrab.current = null;
      store.getState().cancel();
    };

    // ---- pointer events
    const onDown = (e: PointerEvent) => {
      fingers.add(e.pointerId);
      store.getState().setAlt(e.altKey);
      store.getState().setShift(e.shiftKey);
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
        follow(e.clientX, e.clientY);
        store.getState().commit();
        grab.current = null;
        cornerGrab.current = null;
        return;
      }

      const hit = pick(e.clientX, e.clientY, touch);
      if (!hit) return; // empty space and anything that is not a wall or opening: orbit as usual
      const r = canvas.getBoundingClientRect();
      if (isCorner(hit)) {
        // a corner (Move): dragged on the horizontal plane through the grab point
        const height = hit.t * hit.height;
        const at = rayPlanePoint(rayAt(e.clientX, e.clientY) as unknown as Ray, { x: 0, y: height, z: 0 }, UP);
        const joint = { x: hit.corner.point.x, y: height, z: hit.corner.point.y };
        const radius = Math.min(SNAP_MAX_M, Math.max(SNAP_MIN_M, SNAP_TOL_PX * metresPerPixel(cameraInfo(), joint, r.height))); // 12 px at the joint
        store.getState().setCorner(hit.corner, hit.seg, hit.marker);
        if (!at || !store.getState().beginCorner(hit.corner, { radius })) return;
        cornerGrab.current = { at: { x: at.x, z: at.z }, joint: hit.corner.point, height, last: hit.corner.point };
        press.current = { id: e.pointerId, down: { x: e.clientX, y: e.clientY, t: e.timeStamp }, started: false, restore: suppressOrbit() };
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          /* a pointer that is already gone */
        }
        store.getState().setPointer(hostPoint(e.clientX, e.clientY));
        return;
      }
      const plan = livePlan();
      const axis = faceAxis(plan, hit.face, moving, hit.point ?? new THREE.Vector3());
      if (faceBlock(plan, hit.face, moving) || !axis) {
        store.getState().setHover(hit.face, hit.seg); // says why; the press itself orbits
        store.getState().begin(hit.face, { mode: "drag" });
        return;
      }
      const radius = Math.min(SNAP_MAX_M, Math.max(SNAP_MIN_M, SNAP_TOL_PX * metresPerPixel(cameraInfo(), axis.anchor, r.height))); // Move's midpoint snap, 12 px at the opening
      store.getState().setHover(hit.face, hit.seg);
      if (!store.getState().begin(hit.face, { mode: "drag", onlyPiece: e.altKey, shift: e.shiftKey, radius })) return;
      grab.current = { ...startPull(rayAt(e.clientX, e.clientY) as unknown as Ray, axis.anchor, axis.axis, { x: e.clientX, y: e.clientY }), sign: axis.sign };
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
      store.getState().setShift(e.shiftKey);
      store.getState().setPointer(hostPoint(e.clientX, e.clientY));
      const p = press.current;
      const state = store.getState();
      if (p && p.id === e.pointerId) {
        if (!p.started && Math.hypot(e.clientX - p.down.x, e.clientY - p.down.y) >= CLICK_MAX_PX) p.started = true; // a drag
        if (p.started) follow(e.clientX, e.clientY);
        return;
      }
      if (state.pull?.mode === "click") {
        follow(e.clientX, e.clientY); // click-move-click: the preview follows the pointer with no button down
        return;
      }
      if (state.pull || e.pointerType !== "mouse") return; // hover is for a mouse
      if (e.buttons !== 0) {
        state.setHover(null); // orbiting: what was under the pointer has moved
        return;
      }
      const hit = pick(e.clientX, e.clientY, false);
      if (isCorner(hit)) state.setCorner(hit.corner, hit.seg, hit.marker);
      else state.setHover(hit ? hit.face : null, hit?.seg ?? null);
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
        cornerGrab.current = null;
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
        store.getState().setCorner(null);
        store.getState().setPointer(null);
      }
    };

    // ---- keys: only here, so only while the 3D pane has focus
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        store.getState().setAlt(e.type === "keydown");
        return;
      }
      if (e.key === "Shift") {
        if (store.getState().typed === "") store.getState().setShift(e.type === "keydown"); // latched while typing: an inch mark needs Shift
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
      if (!state.pull && !state.hover && !state.corner) return; // nothing to type a distance for
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
          cornerGrab.current = null;
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
  }, [active, moving, host, gl, scene, camera, get]);

  // ---- the highlight: the face's triangles, rebuilt from the plan so it follows a live pull
  const target = active && !pull?.corner ? (pull?.face ?? hover) : null; // a corner has no face to tint: the overlay draws its line
  const alt = usePushPullStore((s) => s.alt);
  const onlyPiece = pull ? pull.onlyPiece : alt;
  const highlight = useMemo(() => buildHighlight(plan, target, moving, onlyPiece), [plan, target, moving, onlyPiece]);
  useEffect(() => () => highlight?.dispose(), [highlight]);

  if (!highlight) return null;
  return (
    <mesh geometry={highlight} renderOrder={5} userData={{ pushPullHighlight: true }} raycast={() => null /* never picked itself */}>
      <meshBasicMaterial color={SCENE_COLORS.toolHighlight} transparent opacity={0.65} side={THREE.DoubleSide} depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
    </mesh>
  );
}

/**
 * The triangles to tint, only ever EXPOSED ones. A wall face: its triangles of that
 * role (a wall top's whole straight run unless Alt; a side across the whole run, the
 * same side of every piece, since thickening or moving acts on all of them). An
 * opening's face: the reveal itself, built from the opening (edges.openingFaceQuad),
 * kept from 4.7b: it is exactly the visible face, edge to edge. In Move every face of
 * the opening, or for a wall side every exposed face of the whole run; nothing over a
 * wall top or end (Move does not take them), and nothing for a door's bottom (it has no
 * face: it stays on the floor).
 */
function buildHighlight(plan: Plan, target: Face | null, moving: boolean, onlyPiece: boolean): THREE.BufferGeometry | null {
  if (!target || (moving && !target.openingId && !isSideRole(target.role))) return null;
  const positions: number[] = [];
  const o = target.openingId ? plan.openings.find((x) => x.id === target.openingId) : undefined;
  const wall = o && plan.walls.find((w) => w.id === o.wallId);
  if (moving || isOpeningRole(target.role)) {
    if (!o || !wall) return null;
    const roles = moving ? (["jambA", "jambB", "head", "sill"] as const).filter((r) => r !== "sill" || o.kind === "window") : o.kind === "door" && target.role === "sill" ? [] : [target.role as "jambA" | "jambB" | "head" | "sill"];
    for (const r of roles) {
      const [p, q, s, t] = openingFaceQuad(wall, o, r);
      for (const c of [p, q, s, p, s, t]) positions.push(c.x, c.y, c.z);
    }
  } else {
    const picked = plan.walls.find((x) => x.id === target.wallId);
    const ids = (target.role === "top" && !onlyPiece) || isSideRole(target.role) ? wallRun(plan, target.wallId) : [target.wallId];
    for (const id of ids) {
      const w = plan.walls.find((x) => x.id === id);
      if (!w || !picked) continue;
      // a piece of the run drawn the other way round has the picked side as its other side
      const flip = isSideRole(target.role) && wallDirection(w).x * wallDirection(picked).x + wallDirection(w).y * wallDirection(picked).y < 0;
      const role: FaceRole = flip ? (target.role === "sideLeft" ? "sideRight" : "sideLeft") : target.role;
      const { geometry, faces } = buildWallMeshData(w, plan.walls, plan.openings);
      const pos = geometry.getAttribute("position");
      for (let tri = 0; tri < faces.roles.length; tri++) {
        if (!faces.exposed[tri]) continue;
        if (!(moving && isSideRole(target.role)) && (faces.roles[tri] !== role || faces.openingIds[tri] !== target.openingId)) continue; // Move tints the whole wall
        for (let k = 0; k < 3; k++) positions.push(pos.getX(tri * 3 + k), pos.getY(tri * 3 + k), pos.getZ(tri * 3 + k));
      }
      geometry.dispose();
    }
  }
  if (positions.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return g;
}
