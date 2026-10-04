"use client";

/**
 * ImportedItems.tsx — draws every imported 3D model in the plan (Items with
 * `import`, step I.1) inside the R3F canvas, as a derived view of the Plan: each
 * item's look comes from its ImportInfo and its position, rotationY and scale.
 *
 * Each item draws its own CLONE of the session-cached scene (src/lib/import/
 * assetCache.ts): SkeletonUtils.clone (it keeps skinned meshes bound), the item's
 * part transforms and hidden / deleted nodes applied to the clone (model.applyOverrides,
 * which also tags every clone node with its path in the ORIGINAL, so a deletion that
 * shifts the clone's indices never confuses which node a path means), and a material
 * copy per mesh (so one item's tint or "both sides" never shows on another). The clone
 * is rebuilt only when what is hidden or deleted changes; a part's move, turn or scale
 * (step I.1b) is put on the existing clone (model.applyPartTransforms), so a part drag
 * never rebuilds it.
 * The transform, outermost first: the item (position = the base point, rotationY,
 * scale), minus the base point, the unit (metres per source unit), the up-axis tilt.
 *
 * Disposal: a clone's material copies are disposed when it is rebuilt or the item
 * goes; the shared geometries and textures belong to the cache, which disposes them
 * when the last item using the asset goes (acquire / release). <primitive dispose={null}>
 * keeps R3F from disposing anything shared.
 * A missing or unreadable asset is a 1 m grey box named "Missing file: <name>".
 * Shadows only under 200k triangles.
 *
 * Select tool: a real click (math.isClick) on a model selects its item
 * (selectionStore.itemId); with Edit parts on for that model it selects the PART
 * (model.pickPart: the highest named node below the root; Alt-click: the mesh's own).
 * The selected item or part is tinted gilt AND outlined: its meshes' edges as 2 px gilt
 * lines (LineSegments2), the visible ones solid and depth-tested, the ones a surface hides
 * at 20%, so it shows on a pale model too and back edges never read as solid lines. Hover is lighter; what Move, Rotate or Scale would act on is light
 * blue (src/store/itemToolStore.ts, driven by ItemTool.tsx); a row clicked in the
 * panel's object list tints that node light blue for a moment (importStore.highlight).
 * Walking picks nothing here.
 *
 * Show in view (step I.1b): a viewStore.frame request moves the orbit camera to frame
 * the item's world box from the way it already looks (math.frameBox, 15% padding),
 * over 0.45 s, or at once under prefers-reduced-motion; never while walking. The
 * request made right after an import (`auto`) does nothing when the model is already
 * fully in view. The framed box stays framed when the pane changes size (a phone's
 * details sheet closing) until the user orbits, pans or zooms. Development and test builds expose window.__importDebug.
 *
 * Connects to: src/lib/import/{assetCache,model,assetStore}.ts, src/lib/handles3d/math.ts,
 * src/store/{planStore,selectionStore,toolStore,viewStore,importStore,itemToolStore}.ts;
 * mounted by src/components/studio/Scene3D.tsx.
 */
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { clone as cloneScene } from "three/examples/jsm/utils/SkeletonUtils.js";
import { SCENE_COLORS } from "@/data/materials";
import { frameBox, isClick, type PointerStamp } from "@/lib/handles3d/math";
import { acquire, assetStore, release, useAsset } from "@/lib/import/assetCache";
import type { LoadedModel } from "@/lib/import/loadModel";
import { applyOverrides, applyPartTransforms, modelFrame, pickPart, upTilt } from "@/lib/import/model";
import { useImportStore } from "@/store/importStore";
import { targetPivot, useItemToolStore } from "@/store/itemToolStore";
import { usePlanStore } from "@/store/planStore";
import { useSelectionStore } from "@/store/selectionStore";
import { is3dTool, isItemTool, useToolStore } from "@/store/toolStore";
import { useViewStore } from "@/store/viewStore";
import type { Item, NodeOverride } from "@/types/plan";

export const SHADOW_TRIANGLES = 200_000;
const MISSING_GREY = "#9a9a9a";
/** Show in view: the box takes at most 1/1.15 of the view, and the camera glides there in this long. */
export const FRAME_PADDING = 1.15;
const FRAME_MS = 450;
const OUTLINE_PX = 2;
const OUTLINE_ANGLE = 30; // degrees: edges between faces meeting at less than this are not drawn

type Tint = "selected" | "hovered" | "tool" | null;
const TINT: Record<Exclude<Tint, null>, THREE.Color> = { selected: new THREE.Color(SCENE_COLORS.wallSelected), hovered: new THREE.Color(SCENE_COLORS.wallHovered), tool: new THREE.Color(SCENE_COLORS.toolHighlight) };
const HIGHLIGHT = new THREE.Color(SCENE_COLORS.toolHighlight);
const TINT_STRENGTH = 0.6; // of the tint colour added as emissive light
/**
 * The outline in two passes, shared by every selection (step I.1b-fix): the edges a surface hides at 20% (depth test off),
 * then the visible ones solid, depth-tested, pulled a little towards the camera (polygon offset on the lines' own quads)
 * so they win over the faces they lie on. A visible edge is drawn by both, which reads as solid gilt.
 */
export const OUTLINE_HIDDEN_OPACITY = 0.2;
const OUTLINE_HIDDEN = new LineMaterial({ color: SCENE_COLORS.outline, linewidth: OUTLINE_PX, depthTest: false, depthWrite: false, transparent: true, opacity: OUTLINE_HIDDEN_OPACITY });
const OUTLINE_VISIBLE = new LineMaterial({ color: SCENE_COLORS.outline, linewidth: OUTLINE_PX, depthTest: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 });

type Lit = THREE.Material & { emissive?: THREE.Color; userData: { baseEmissive?: THREE.Color } };
/** A subtree of the clone (by node path) tinted in its own colour, over the item's tint. */
type PathTint = { path: string; colour: THREE.Color };

/** The item an intersected object belongs to (meshes carry it, and so does every placeholder). */
const itemOf = (o: THREE.Object3D | null): string | null => {
  for (let x = o; x; x = x.parent) if (x.userData.importItemId) return String(x.userData.importItemId);
  return null;
};
/** The clone root (path "") above an intersected mesh, or null for a placeholder. */
const cloneRootOf = (o: THREE.Object3D | null): THREE.Object3D | null => {
  for (let x = o; x; x = x.parent) if (x.userData.importPath === "") return x;
  return null;
};
const inside = (path: string, part: string) => path === part || path.startsWith(`${part}/`);
const frameOf = (item: Item) => ({ unitToMetres: item.import!.unitToMetres, upAxis: item.import!.upAxis });

/** What is hidden or deleted: the clone is rebuilt only when this changes (a part's transform is put on it in place). */
const structureKey = (o: Record<string, NodeOverride>) =>
  Object.entries(o)
    .filter(([, v]) => v.hidden || v.deleted)
    .map(([p, v]) => `${p}${v.hidden ? "h" : ""}${v.deleted ? "d" : ""}`)
    .sort()
    .join(" ");

/** One item's clone of the cached scene, with its overrides, per-mesh materials and shadow flags. */
function buildInstance(item: Item, model: LoadedModel): THREE.Object3D {
  const info = item.import!;
  const clone = cloneScene(model.root);
  applyOverrides(clone, info.nodeOverrides, frameOf(item), model.root); // pivots come from the untouched original
  // three's raycaster ignores `visible`: a hidden part must not catch clicks (or block the 3D tools)
  clone.traverse((o) => {
    if (!o.visible) o.traverse((x) => void (x.raycast = () => {}));
  });
  const shadows = model.stats.triangles < SHADOW_TRIANGLES;
  clone.traverse((o) => {
    o.userData.importItemId = item.id;
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    const copy = (m: THREE.Material) => {
      const c = m.clone() as Lit;
      if (info.doubleSided) c.side = THREE.DoubleSide;
      if (c.emissive) c.userData.baseEmissive = c.emissive.clone();
      return c;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(copy) : copy(mesh.material);
  });
  return clone;
}

/** Dispose the material copies of a clone (never its geometries or textures: those are the cache's). */
function disposeCopies(clone: THREE.Object3D) {
  clone.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (m) for (const mat of Array.isArray(m) ? m : [m]) mat.dispose();
  });
}

/** Tint every mesh: the first path rule that holds it (flash, tool target, active part), else the item's tint, else none. */
function paint(clone: THREE.Object3D, tint: Tint, rules: PathTint[]) {
  clone.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const path = String(o.userData.importPath ?? "");
    const colour = rules.find((r) => inside(path, r.path))?.colour ?? (tint ? TINT[tint] : null);
    for (const mat of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Lit[]) {
      if (!mat.emissive || !mat.userData.baseEmissive) continue; // unlit materials take no tint
      mat.emissive.copy(mat.userData.baseEmissive);
      if (colour) mat.emissive.add(colour.clone().multiplyScalar(TINT_STRENGTH));
    }
  });
}

/**
 * The selection's outline: each mesh's edges (EdgesGeometry, faces meeting at 30° or
 * more) as 2 px gilt lines, twice: hidden at 20%, visible solid (OUTLINE_HIDDEN / OUTLINE_VISIBLE). They live at the scene's root, not in the item (so they are
 * never counted as the model's meshes), and copy their mesh's world matrix every frame,
 * so they follow a drag. ponytail: edges are rebuilt when the selection changes, which is
 * slow for a model of millions of triangles; a cheaper silhouette pass if real models need it.
 */
function Outline({ meshes }: { meshes: THREE.Mesh[] }) {
  const scene = useThree((s) => s.scene);
  const group = useMemo(() => {
    const g = new THREE.Group();
    g.name = "selection-outline";
    for (const m of meshes) {
      const edges = new THREE.EdgesGeometry(m.geometry, OUTLINE_ANGLE);
      const geometry = new LineSegmentsGeometry().fromEdgesGeometry(edges);
      edges.dispose();
      for (const [material, order] of [
        [OUTLINE_HIDDEN, 10],
        [OUTLINE_VISIBLE, 11],
      ] as const) {
        const line = new LineSegments2(geometry, material);
        line.matrixAutoUpdate = false;
        line.renderOrder = order; // after the model: the hidden pass, then the visible one
        line.frustumCulled = false;
        line.raycast = () => {}; // never picked
        line.userData.source = m;
        g.add(line);
      }
    }
    return g;
  }, [meshes]);
  useEffect(() => {
    scene.add(group);
    return () => {
      scene.remove(group);
      for (const l of group.children) (l as LineSegments2).geometry.dispose(); // the two passes share one; disposing twice is harmless
    };
  }, [scene, group]);
  useFrame(() => {
    for (const l of group.children) {
      const src = l.userData.source as THREE.Mesh;
      src.updateWorldMatrix(true, false); // this frame's place, not last frame's
      l.matrix.copy(src.matrixWorld);
      l.matrixWorldNeedsUpdate = true;
    }
  });
  return null;
}

/** The item's own transform: its base point, turn and size. */
function Placed({ item, children }: { item: Item; children: ReactNode }) {
  const { x, y, z } = item.position;
  return (
    <group position={[x, y, z]} rotation={[0, item.rotationY, 0]} scale={item.scale} userData={{ importItemId: item.id, importName: item.import!.name }}>
      {children}
    </group>
  );
}

interface Look {
  tint: Tint;
  rules: PathTint[];
  /** Outline the whole item (""), one part (its path), or nothing (null). */
  outline: string | null;
}

function ModelInstance({ item, model, look }: { item: Item; model: LoadedModel; look: Look }) {
  const info = item.import!;
  const structure = structureKey(info.nodeOverrides);
  const instance = useMemo(() => buildInstance(item, model), [item.id, model, structure, info.doubleSided]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => disposeCopies(instance), [instance]);
  // a part's move, turn or scale goes on the clone in place, before the frame is drawn
  useLayoutEffect(() => applyPartTransforms(instance, info.nodeOverrides, frameOf(item), model.root), [instance, info.nodeOverrides, info.unitToMetres, info.upAxis, model]); // eslint-disable-line react-hooks/exhaustive-deps
  const paintKey = `${look.tint}|${look.rules.map((r) => `${r.path}:${r.colour.getHexString()}`).join(",")}`; // a new Look each render; repaint only when it differs
  useEffect(() => paint(instance, look.tint, look.rules), [instance, paintKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const outlined = useMemo(() => {
    if (look.outline === null) return [];
    let root: THREE.Object3D | null = null;
    instance.traverse((o) => void (root ??= o.userData.importPath === look.outline ? o : null));
    const out: THREE.Mesh[] = [];
    (root as THREE.Object3D | null)?.traverseVisible((o) => void ((o as THREE.Mesh).isMesh && out.push(o as THREE.Mesh)));
    return out;
  }, [instance, look.outline]);
  const { base } = modelFrame(model.box, info.unitToMetres, info.upAxis);
  return (
    <>
      <Placed item={item}>
        <group position={[-base.x, -base.y, -base.z]}>
          <group scale={info.unitToMetres}>
            <group rotation={[upTilt(info.upAxis), 0, 0]}>
              <primitive object={instance} dispose={null} />
            </group>
          </group>
        </group>
      </Placed>
      {outlined.length > 0 && <Outline meshes={outlined} />}
    </>
  );
}

/** A missing or unreadable model: a 1 m grey cube on its base point, named so the panel and tests can say which. */
function Placeholder({ item, look }: { item: Item; look: Look }) {
  const tint = look.tint ?? (look.outline !== null ? "selected" : null);
  return (
    <Placed item={item}>
      <mesh position={[0, 0.5, 0]} name={`Missing file: ${item.import!.name}`} userData={{ importItemId: item.id, missing: true }}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={MISSING_GREY} emissive={tint ? TINT[tint] : "#000000"} emissiveIntensity={tint ? TINT_STRENGTH : 0} transparent opacity={0.6} />
      </mesh>
    </Placed>
  );
}

function ImportedItem({ item, look }: { item: Item; look: Look }) {
  const assetId = item.import!.assetId;
  const asset = useAsset(assetId);
  const ready = asset.status === "ready";
  useEffect(() => {
    if (!ready) return;
    acquire(assetId); // the cache keeps the shared geometries and textures while any item draws them
    return () => release(assetId);
  }, [assetId, ready]);
  if (asset.status === "loading") return null; // the pane's progress bar says so
  if (asset.status !== "ready") return <Placeholder item={item} look={look} />;
  return <ModelInstance item={item} model={asset.model} look={look} />;
}

const stamp = (e: MouseEvent | PointerEvent): PointerStamp => ({ x: e.clientX, y: e.clientY, t: e.timeStamp });
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

type OrbitLike = {
  target: THREE.Vector3;
  update(): void;
  dispatchEvent(e: { type: "start" }): void;
  addEventListener(type: "start", fn: () => void): void;
  removeEventListener(type: "start", fn: () => void): void;
};

export function ImportedItems() {
  const items = usePlanStore((s) => s.plan.items);
  const imported = useMemo(() => items.filter((i) => i.import), [items]);
  const selected = useSelectionStore((s) => s.itemId);
  const editParts = useSelectionStore((s) => s.editParts);
  const partPath = useSelectionStore((s) => s.partPath);
  const highlight = useImportStore((s) => s.highlight);
  const walking = useViewStore((s) => s.mode === "walk");
  const tool = useToolStore((s) => s.tool);
  const picking = !walking && !is3dTool(tool); // the 3D tools and walking never select a model here
  const toolTarget = useItemToolStore((s) => (!walking && isItemTool(tool) ? (s.drag?.target ?? s.hover) : null));
  const [hovered, setHovered] = useState<string | null>(null);
  const down = useRef<PointerStamp | null>(null);
  const group = useRef<THREE.Group>(null);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null;

  /** World box of an item's visible meshes, or of one part's (by path); null when nothing of it is drawn. */
  const worldBoxOf = (id: string, path: string | null = null) => {
    const g = group.current?.children.find((c) => c.userData.importItemId === id);
    if (!g) return null;
    g.updateWorldMatrix(true, true);
    const b = new THREE.Box3();
    g.traverseVisible((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      if (path !== null && !inside(String(o.userData.importPath ?? "\0"), path)) return;
      b.union(new THREE.Box3().setFromObject(o));
    });
    return b.isEmpty() ? null : b;
  };

  // ---- Show in view: frame the requested item's world box (viewStore.frame), gliding there unless motion is reduced
  const glide = useRef<{ from: [THREE.Vector3, THREE.Vector3]; to: [THREE.Vector3, THREE.Vector3]; t0: number } | null>(null);
  // The box last framed, kept framed when the pane changes size (a phone's details sheet closing, a rotated phone)
  // until the user orbits, pans or zooms, as Scene3D's FitCamera does for the plan.
  const framed = useRef<THREE.Box3 | null>(null);
  const ownStart = useRef(false);
  const size = useThree((s) => s.size);
  useEffect(() => {
    if (!controls) return;
    const onStart = () => void (ownStart.current || (framed.current = null)); // a real orbit, pan or zoom lets go of the box
    controls.addEventListener("start", onStart);
    return () => controls.removeEventListener("start", onStart);
  }, [controls]);
  const placeFor = (box: THREE.Box3, aspect: number) => {
    const v = (p: THREE.Vector3) => ({ x: p.x, y: p.y, z: p.z });
    const to = frameBox({ min: v(box.min), max: v(box.max) }, { position: v(camera.position), target: v(controls!.target), fovDeg: camera.fov }, aspect, FRAME_PADDING);
    return [new THREE.Vector3(to.position.x, to.position.y, to.position.z), new THREE.Vector3(to.target.x, to.target.y, to.target.z)] as [THREE.Vector3, THREE.Vector3];
  };
  useEffect(() => {
    const box = framed.current;
    if (!box || !controls || size.height === 0 || useViewStore.getState().mode === "walk") return;
    const [p, t] = placeFor(box, size.width / size.height); // at once: the pane has just changed under the user
    if (glide.current) glide.current.to = [p, t];
    else {
      camera.position.copy(p);
      controls.target.copy(t);
      controls.update();
    }
  }, [size.width, size.height]); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame((state) => {
    const req = useViewStore.getState().frame;
    if (req && !glide.current) {
      const box = useViewStore.getState().mode === "walk" ? null : worldBoxOf(req.itemId);
      const gone = !usePlanStore.getState().plan.items.some((i) => i.id === req.itemId);
      if (gone || useViewStore.getState().mode === "walk") useViewStore.getState().clearFrame();
      else if (box && controls) {
        useViewStore.getState().clearFrame();
        camera.updateMatrixWorld();
        const corners = [box.min.x, box.max.x].flatMap((x) => [box.min.y, box.max.y].flatMap((y) => [box.min.z, box.max.z].map((z) => new THREE.Vector3(x, y, z).project(camera))));
        const inView = corners.every((c) => Math.abs(c.x) <= 1 && Math.abs(c.y) <= 1 && c.z > -1 && c.z < 1);
        if (!(req.auto && inView)) {
          glide.current = { from: [camera.position.clone(), controls.target.clone()], to: placeFor(box, camera.aspect), t0: state.clock.elapsedTime };
          framed.current = box.clone();
          ownStart.current = true;
          controls.dispatchEvent({ type: "start" }); // the camera is placed now: Scene3D's FitCamera must not refit the plan over it
          ownStart.current = false;
        }
      } // else: the model is still loading; try again next frame
    }
    const g = glide.current;
    if (g && controls) {
      const t = reducedMotion() ? 1 : Math.min(1, ((state.clock.elapsedTime - g.t0) * 1000) / FRAME_MS);
      const k = easeInOut(t);
      camera.position.lerpVectors(g.from[0], g.to[0], k);
      controls.target.lerpVectors(g.from[1], g.to[1], k);
      controls.update();
      if (t >= 1) glide.current = null;
    }
  });

  // ---- development and test builds only: what the scene really holds, for scripts/e2e-import3d.ts and import-report.ts
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const itemGroup = (id: string) => group.current?.children.find((c) => c.userData.importItemId === id) ?? null;
    const meshesOf = (id: string, visibleOnly: boolean) => {
      const out: THREE.Mesh[] = [];
      const g = itemGroup(id);
      if (g) (visibleOnly ? g.traverseVisible.bind(g) : g.traverse.bind(g))((o) => (o as THREE.Mesh).isMesh && out.push(o as THREE.Mesh));
      return out;
    };
    const boxJson = (b: THREE.Box3 | null) => (b ? { min: b.min.toArray(), max: b.max.toArray() } : null);
    const hook = {
      /** Item ids drawn in the scene. */
      items: () => (group.current?.children ?? []).map((c) => String(c.userData.importItemId)),
      /** World box of an item's visible meshes. */
      worldBox: (id: string) => boxJson(worldBoxOf(id)),
      /** World box of one part's visible meshes (by its node path in the original). */
      partWorldBox: (id: string, path: string) => boxJson(worldBoxOf(id, path)),
      /** Names of an item's meshes that are drawn (visible) and of all it has (hidden ones too). */
      meshNames: (id: string) => ({ visible: meshesOf(id, true).map((m) => m.name), all: meshesOf(id, false).map((m) => m.name) }),
      /** The placeholder's name ("Missing file: …"), or null when the model itself is drawn. */
      missing: (id: string) => meshesOf(id, false).find((m) => m.userData.missing)?.name ?? null,
      /** Widths of the colour textures an item's materials use (a missing texture is the 1 px grey pixel). */
      textureWidths: (id: string) =>
        meshesOf(id, false).flatMap((m) => (Array.isArray(m.material) ? m.material : [m.material]).flatMap((mat) => ((mat as THREE.MeshStandardMaterial).map?.image as { width?: number } | undefined)?.width ?? [])),
      /** How much the renderer holds on the GPU. */
      renderer: () => ({ geometries: gl.info.memory.geometries, textures: gl.info.memory.textures }),
      /** What the asset store (IndexedDB) holds. */
      assets: () => assetStore().list(),
      /** The orbit camera: where it is, what it looks at, its vertical fov and aspect; and whether a Show-in-view glide is under way. */
      camera: () => ({ position: camera.position.toArray(), target: controls?.target.toArray() ?? null, fov: camera.fov, aspect: camera.aspect, gliding: glide.current !== null || useViewStore.getState().frame !== null }),
      /** A part's pivot in the world right now (its own and its ancestors' transforms applied), or the item's base point for "". */
      partPivot: (id: string, path: string) => targetPivot({ itemId: id, path: path === "" ? null : path }),
      /** How long the last import took to read and parse (ms), from the dialog's file to its review. */
      parseMs: () => useImportStore.getState().parseMs,
    };
    (window as unknown as { __importDebug?: typeof hook }).__importDebug = hook;
    return () => {
      if ((window as unknown as { __importDebug?: typeof hook }).__importDebug === hook) delete (window as unknown as { __importDebug?: typeof hook }).__importDebug;
    };
  }, [gl, camera, controls]); // eslint-disable-line react-hooks/exhaustive-deps

  /** How one item looks: its tint, the subtrees tinted their own colour, and what is outlined. */
  const lookOf = (item: Item): Look => {
    if (walking) return { tint: null, rules: [], outline: null };
    const isSel = item.id === selected;
    const part = isSel && editParts ? partPath : null;
    const rules: PathTint[] = [];
    if (highlight?.itemId === item.id) rules.push({ path: highlight.path, colour: HIGHLIGHT });
    if (toolTarget?.itemId === item.id && toolTarget.path !== null) rules.push({ path: toolTarget.path, colour: HIGHLIGHT });
    if (part !== null) rules.push({ path: part, colour: TINT.selected });
    const tint: Tint = toolTarget?.itemId === item.id && toolTarget.path === null ? "tool" : isSel && part === null ? "selected" : picking && item.id === hovered ? "hovered" : null;
    return { tint, rules, outline: isSel ? (part ?? "") : null };
  };

  return (
    <group
      ref={group}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => void (down.current = stamp(e.nativeEvent))}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        if (!picking) return;
        e.stopPropagation(); // the nearest thing under the pointer is this model: walls behind it are not picked
        if (!down.current || !isClick(down.current, stamp(e.nativeEvent))) return; // an orbit drag is not a click
        const id = itemOf(e.object);
        if (!id) return;
        const sel = useSelectionStore.getState();
        const root = cloneRootOf(e.object);
        if (sel.itemId === id && sel.editParts && root) {
          const path = pickPart(root, e.object, { deep: e.nativeEvent.altKey }); // Edit parts: this click picks a part
          if (path !== null) sel.selectPart(path);
        } else sel.selectItem(id);
      }}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        if (!picking) return;
        e.stopPropagation();
        setHovered(itemOf(e.object));
      }}
      onPointerOut={() => setHovered(null)}
    >
      {imported.map((item) => (
        <ImportedItem key={item.id} item={item} look={lookOf(item)} />
      ))}
    </group>
  );
}
