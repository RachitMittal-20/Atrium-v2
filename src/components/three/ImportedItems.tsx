"use client";

/**
 * ImportedItems.tsx — draws every imported 3D model in the plan (Items with
 * `import`, step I.1) inside the R3F canvas, as a derived view of the Plan: each
 * item's look comes from its ImportInfo and its position, rotationY and scale.
 *
 * Each item draws its own CLONE of the session-cached scene (src/lib/import/
 * assetCache.ts): SkeletonUtils.clone (it keeps skinned meshes bound), the item's
 * hidden / deleted nodes applied to the clone (model.applyOverrides), and a material
 * copy per mesh (so one item's tint or "both sides" never shows on another). Every
 * clone node is tagged with its path in the ORIGINAL, so a deletion that shifts the
 * clone's indices never confuses which node the object list means.
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
 * (selectionStore.itemId), gilt; hover is lighter; a row clicked in the panel's
 * object list tints that node light blue for a moment (importStore.highlight).
 * Walking and the 3D tools pick nothing here (PushPullTool says imported objects
 * are edited in the panel). Development and test builds expose window.__importDebug.
 *
 * Connects to: src/lib/import/{assetCache,model,assetStore}.ts, src/store/{planStore,
 * selectionStore,toolStore,viewStore,importStore}.ts; mounted by src/components/studio/Scene3D.tsx.
 */
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { clone as cloneScene } from "three/examples/jsm/utils/SkeletonUtils.js";
import { SCENE_COLORS } from "@/data/materials";
import { isClick, type PointerStamp } from "@/lib/handles3d/math";
import { acquire, assetStore, release, useAsset } from "@/lib/import/assetCache";
import type { LoadedModel } from "@/lib/import/loadModel";
import { applyOverrides, modelFrame, nodePaths, upTilt } from "@/lib/import/model";
import { useImportStore } from "@/store/importStore";
import { usePlanStore } from "@/store/planStore";
import { useSelectionStore } from "@/store/selectionStore";
import { is3dTool, useToolStore } from "@/store/toolStore";
import { useViewStore } from "@/store/viewStore";
import type { Item } from "@/types/plan";

export const SHADOW_TRIANGLES = 200_000;
const MISSING_GREY = "#9a9a9a";

type Tint = "selected" | "hovered" | null;
const TINT: Record<Exclude<Tint, null>, THREE.Color> = { selected: new THREE.Color(SCENE_COLORS.wallSelected), hovered: new THREE.Color(SCENE_COLORS.wallHovered) };
const HIGHLIGHT = new THREE.Color(SCENE_COLORS.toolHighlight);
const TINT_STRENGTH = 0.6; // of the tint colour added as emissive light

type Lit = THREE.Material & { emissive?: THREE.Color; userData: { baseEmissive?: THREE.Color } };

/** The item an intersected object belongs to (meshes carry it, and so does every placeholder). */
const itemOf = (o: THREE.Object3D | null): string | null => {
  for (let x = o; x; x = x.parent) if (x.userData.importItemId) return String(x.userData.importItemId);
  return null;
};

/** One item's clone of the cached scene, with its overrides, per-mesh materials and shadow flags. */
function buildInstance(item: Item, model: LoadedModel): THREE.Object3D {
  const info = item.import!;
  const clone = cloneScene(model.root);
  for (const n of nodePaths(clone)) n.object.userData.importPath = n.path; // paths of the original, before deletions shift them
  applyOverrides(clone, info.nodeOverrides);
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

/** Tint every mesh: the highlighted node's subtree light blue, else the item's selection or hover colour, else none. */
function paint(clone: THREE.Object3D, tint: Tint, highlight: string | null) {
  clone.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const path = String(o.userData.importPath ?? "");
    const lit = highlight !== null && (path === highlight || path.startsWith(`${highlight}/`));
    const colour = lit ? HIGHLIGHT : tint ? TINT[tint] : null;
    for (const mat of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Lit[]) {
      if (!mat.emissive || !mat.userData.baseEmissive) continue; // unlit materials take no tint
      mat.emissive.copy(mat.userData.baseEmissive);
      if (colour) mat.emissive.add(colour.clone().multiplyScalar(TINT_STRENGTH));
    }
  });
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

function ModelInstance({ item, model, tint, highlight }: { item: Item; model: LoadedModel; tint: Tint; highlight: string | null }) {
  const info = item.import!;
  const instance = useMemo(() => buildInstance(item, model), [item.id, model, info.nodeOverrides, info.doubleSided]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => disposeCopies(instance), [instance]);
  useEffect(() => paint(instance, tint, highlight), [instance, tint, highlight]);
  const { base } = modelFrame(model.box, info.unitToMetres, info.upAxis);
  return (
    <Placed item={item}>
      <group position={[-base.x, -base.y, -base.z]}>
        <group scale={info.unitToMetres}>
          <group rotation={[upTilt(info.upAxis), 0, 0]}>
            <primitive object={instance} dispose={null} />
          </group>
        </group>
      </group>
    </Placed>
  );
}

/** A missing or unreadable model: a 1 m grey cube on its base point, named so the panel and tests can say which. */
function Placeholder({ item, tint }: { item: Item; tint: Tint }) {
  return (
    <Placed item={item}>
      <mesh position={[0, 0.5, 0]} name={`Missing file: ${item.import!.name}`} userData={{ importItemId: item.id, missing: true }}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={MISSING_GREY} emissive={tint ? TINT[tint] : "#000000"} emissiveIntensity={tint ? TINT_STRENGTH : 0} transparent opacity={0.6} />
      </mesh>
    </Placed>
  );
}

function ImportedItem({ item, tint, highlight }: { item: Item; tint: Tint; highlight: string | null }) {
  const assetId = item.import!.assetId;
  const asset = useAsset(assetId);
  const ready = asset.status === "ready";
  useEffect(() => {
    if (!ready) return;
    acquire(assetId); // the cache keeps the shared geometries and textures while any item draws them
    return () => release(assetId);
  }, [assetId, ready]);
  if (asset.status === "loading") return null; // the pane's progress bar says so
  if (asset.status !== "ready") return <Placeholder item={item} tint={tint} />;
  return <ModelInstance item={item} model={asset.model} tint={tint} highlight={highlight} />;
}

const stamp = (e: MouseEvent | PointerEvent): PointerStamp => ({ x: e.clientX, y: e.clientY, t: e.timeStamp });

export function ImportedItems() {
  const items = usePlanStore((s) => s.plan.items);
  const imported = useMemo(() => items.filter((i) => i.import), [items]);
  const selected = useSelectionStore((s) => s.itemId);
  const highlight = useImportStore((s) => s.highlight);
  const walking = useViewStore((s) => s.mode === "walk");
  const tool = useToolStore((s) => s.tool);
  const picking = !walking && !is3dTool(tool); // the 3D tools and walking never pick a model
  const [hovered, setHovered] = useState<string | null>(null);
  const down = useRef<PointerStamp | null>(null);
  const group = useRef<THREE.Group>(null);
  const gl = useThree((s) => s.gl);

  // ---- development and test builds only: what the scene really holds, for scripts/e2e-import3d.ts
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const itemGroup = (id: string) => group.current?.children.find((c) => c.userData.importItemId === id) ?? null;
    const meshesOf = (id: string, visibleOnly: boolean) => {
      const out: THREE.Mesh[] = [];
      const g = itemGroup(id);
      if (g) (visibleOnly ? g.traverseVisible.bind(g) : g.traverse.bind(g))((o) => (o as THREE.Mesh).isMesh && out.push(o as THREE.Mesh));
      return out;
    };
    const hook = {
      /** Item ids drawn in the scene. */
      items: () => (group.current?.children ?? []).map((c) => String(c.userData.importItemId)),
      /** World box of an item's visible meshes. */
      worldBox: (id: string) => {
        const b = new THREE.Box3();
        for (const m of meshesOf(id, true)) b.union(new THREE.Box3().setFromObject(m));
        return b.isEmpty() ? null : { min: b.min.toArray(), max: b.max.toArray() };
      },
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
    };
    (window as unknown as { __importDebug?: typeof hook }).__importDebug = hook;
    return () => {
      if ((window as unknown as { __importDebug?: typeof hook }).__importDebug === hook) delete (window as unknown as { __importDebug?: typeof hook }).__importDebug;
    };
  }, [gl]);

  return (
    <group
      ref={group}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => void (down.current = stamp(e.nativeEvent))}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        if (!picking) return;
        e.stopPropagation(); // the nearest thing under the pointer is this model: walls behind it are not picked
        if (!down.current || !isClick(down.current, stamp(e.nativeEvent))) return; // an orbit drag is not a click
        const id = itemOf(e.object);
        if (id) useSelectionStore.getState().selectItem(id);
      }}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        if (!picking) return;
        e.stopPropagation();
        setHovered(itemOf(e.object));
      }}
      onPointerOut={() => setHovered(null)}
    >
      {imported.map((item) => (
        <ImportedItem
          key={item.id}
          item={item}
          tint={walking ? null : item.id === selected ? "selected" : picking && item.id === hovered ? "hovered" : null}
          highlight={!walking && highlight?.itemId === item.id ? highlight.path : null}
        />
      ))}
    </group>
  );
}
