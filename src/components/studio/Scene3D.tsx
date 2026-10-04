"use client";

/*
 * src/components/studio/Scene3D.tsx — the 3D canvas of the editor: lights, grid,
 * FitCamera, orbit controls and PlanModel (a derived view of the plan). Framed
 * once from the plan's bounds when it mounts. Clicking a wall selects it (see
 * PlanModel); clicking past everything clears the selection. Mounted by
 * src/app/studio/page.tsx.
 *
 * Walking (src/store/viewStore.ts): the canvas sits in a focusable host div
 * that WalkControls reads keys and look drags from; WalkOverlay (toggle, hint,
 * Exit, joystick) sits beside it, not inside, so its buttons are never walking
 * input. While walking, orbit controls are off, FitCamera never refits, nothing
 * is picked, and a soft fill light brightens the interior under the ceilings.
 * The 3D tools (Push/Pull and Move, src/components/three/PushPullTool.tsx) read
 * the same host; its cursor says what a press would do. Move, Rotate and Scale on
 * imported models (step I.1b) are src/components/three/ItemTool.tsx with
 * ItemToolOverlay beside the canvas.
 *
 * Imported 3D models (step I.1) are drawn by ImportedItems; files dropped on this
 * pane go to the same import flow as the top bar's file picker
 * (src/store/importStore.ts), and a thin bar along the top shows while a stored
 * model is being read.
 */
import { OrbitControls, Grid } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import * as THREE from "three";
import { ImportedItems } from "@/components/three/ImportedItems";
import { ItemTool } from "@/components/three/ItemTool";
import { PlanModel } from "@/components/three/PlanModel";
import { PushPullTool } from "@/components/three/PushPullTool";
import { WalkControls } from "@/components/three/WalkControls";
import { SCENE_COLORS } from "@/data/materials";
import { useAssetsLoading } from "@/lib/import/assetCache";
import { useImportStore } from "@/store/importStore";
import { usePlanStore } from "@/store/planStore";
import { useSelectionStore } from "@/store/selectionStore";
import { usePushPullStore } from "@/store/pushPullStore";
import { useItemToolStore } from "@/store/itemToolStore";
import { isItemTool, isPushPullTool, useToolStore } from "@/store/toolStore";
import { useViewStore } from "@/store/viewStore";
import { ItemToolOverlay } from "./ItemToolOverlay";
import { PushPullOverlay } from "./PushPullOverlay";
import { WalkOverlay } from "./WalkOverlay";

/** The walls' bounding box in world space: x/z on the ground, `height` up. */
interface Bounds {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  height: number;
  cx: number;
  cz: number;
  size: number; // longest ground side
}

function planBounds(walls: { a: { x: number; y: number }; b: { x: number; y: number }; height: number }[]): Bounds {
  const xs = walls.flatMap((w) => [w.a.x, w.b.x]);
  const zs = walls.flatMap((w) => [w.a.y, w.b.y]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  return {
    x0, x1, z0, z1,
    height: Math.max(...walls.map((w) => w.height)),
    cx: (x0 + x1) / 2,
    cz: (z0 + z1) / 2,
    size: Math.max(x1 - x0, z1 - z0, 1),
  };
}

const VIEW_DIRECTION = new THREE.Vector3(0.5, 0.65, 0.75).normalize(); // from the plan centre towards the camera
const FIT_PADDING = 1.1; // the plan fills at most 1/1.1 of the width and height

/**
 * Keeps the whole plan in view. For each of the bounding box's 8 corners it
 * finds how far back the camera must sit for that corner to land inside the
 * frame (both fields of view, tilt included), and takes the farthest. Refits
 * on every viewport change until the user orbits, pans or zooms, then leaves
 * the camera alone.
 */
function FitCamera({ bounds }: { bounds: Bounds }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const controls = useThree((s) => s.controls) as {
    addEventListener(type: "start", fn: () => void): void;
    removeEventListener(type: "start", fn: () => void): void;
  } | null;
  const userMoved = useRef(false);

  useEffect(() => {
    if (!controls) return;
    const onStart = () => (userMoved.current = true); // fires on orbit, pan and zoom, not on our own repositioning
    controls.addEventListener("start", onStart);
    return () => controls.removeEventListener("start", onStart);
  }, [controls]);

  useEffect(() => {
    // Never while walking: the walk camera is not ours to move (and leaving walk restores the orbit camera exactly).
    if (userMoved.current || width === 0 || height === 0 || useViewStore.getState().mode === "walk") return;
    const { x0, x1, z0, z1, cx, cz } = bounds;
    const target = new THREE.Vector3(cx, 0, cz);
    const forward = VIEW_DIRECTION.clone().negate(); // camera → target
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward);
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const tanH = tanV * (width / height);

    // A corner at depth (distance + f) from the camera fits when |x| <= depth * tan / padding.
    let distance = 0;
    for (const x of [x0, x1]) {
      for (const z of [z0, z1]) {
        for (const y of [0, bounds.height]) {
          const rel = new THREE.Vector3(x, y, z).sub(target);
          const f = rel.dot(forward);
          distance = Math.max(distance, (FIT_PADDING * Math.abs(rel.dot(right))) / tanH - f, (FIT_PADDING * Math.abs(rel.dot(up))) / tanV - f);
        }
      }
    }
    camera.position.copy(target).addScaledVector(VIEW_DIRECTION, distance);
    camera.lookAt(target);
  }, [camera, bounds, width, height]);
  return null;
}

export function Scene3D({ showCeiling }: { showCeiling: boolean }) {
  // Frame the plan once, from its bounds when the scene opens (later edits don't move the camera).
  const [bounds] = useState(() => planBounds(usePlanStore.getState().plan.walls));
  const { cx, cz, size } = bounds;
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(cx, 0, cz);
    return o;
  }, [cx, cz]);
  const host = useRef<HTMLDivElement>(null);
  const walking = useViewStore((s) => s.mode === "walk");
  // A 3D tool's cursor says what a press would do: a face that can't be pulled says no (the store has the reason
  // as its message), a door's or window's side resizes sideways, Move moves, everything else resizes up and down
  const cursor = usePushPullStore((s) => {
    const face = s.pull?.face ?? s.hover;
    if (!face) return undefined;
    if (!s.pull && s.message) return "not-allowed";
    return s.kind === "move" ? "move" : face.role === "jambA" || face.role === "jambB" ? "ew-resize" : "ns-resize";
  });
  const tool = useToolStore((s) => s.tool);
  const pushPull = isPushPullTool(tool) && !walking;
  // over an imported model, Move, Rotate and Scale say they would grab it
  const itemCursor = useItemToolStore((s) => (isItemTool(tool) && !walking && (s.drag || s.hover) ? (s.drag ? "grabbing" : "grab") : undefined));
  const loading = useAssetsLoading();
  const [dropping, setDropping] = useState(false);
  const hasFiles = (e: ReactDragEvent) => e.dataTransfer.types.includes("Files");

  return (
    <>
      <div
        ref={host}
        tabIndex={0}
        role="group"
        aria-label="3D view. Drag to orbit. Click a wall, door, window or imported model to select it. With the Push/Pull tool, drag a wall top, or a door's or window's side, top or sill, to resize it; with the Move tool, drag a door or window along its wall, or an imported model on the floor (Shift: up and down); or type a distance and press Enter. With Rotate or Scale, drag an imported model, or type degrees or a percentage and press Enter. In Walk: W A S D move, arrows turn, drag to look, Shift runs, Escape exits."
        data-testid="scene-3d"
        className="absolute inset-0 focus-visible:outline-offset-[-3px]"
        style={{ touchAction: walking ? "none" : undefined, cursor: itemCursor ?? (pushPull ? cursor : undefined) }} // a walking drag looks; it never scrolls the page
        onDragOver={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault(); // allows the drop
          e.dataTransfer.dropEffect = "copy";
          setDropping(true);
        }}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDropping(false)}
        onDrop={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault(); // never let the browser open the file itself
          setDropping(false);
          void useImportStore.getState().openFiles([...e.dataTransfer.files]);
        }}
      >
        <Canvas
          shadows
          dpr={[1, 2]}
          camera={{ fov: 45, near: 0.1, far: 500 }}
          onPointerMissed={() => useViewStore.getState().mode === "orbit" && useSelectionStore.getState().select(null)} // a walking drag looks, it does not select
        >
          <color attach="background" args={[SCENE_COLORS.background]} />
          <hemisphereLight args={["#ffffff", "#b8ad98", 0.9]} />
          {/* Walking, under the ceilings: a ceiling faces down, so the hemisphere gives it only its beige ground
              colour and it read as dark brown. A neutral fill lifts it and the shadowed walls. Ceilings cast no shadows. */}
          {walking && <ambientLight intensity={0.6} />}
          {/* The sun's shadow frustum is centred on the plan, not the world origin. */}
          <primitive object={target} />
          <directionalLight
            castShadow
            intensity={1.6}
            target={target}
            position={[cx + size * 0.8, size * 1.5, cz + size * 0.5]}
            shadow-mapSize={[2048, 2048]}
            shadow-camera-left={-size}
            shadow-camera-right={size}
            shadow-camera-top={size}
            shadow-camera-bottom={-size}
            shadow-camera-near={0.5}
            shadow-camera-far={size * 5}
            shadow-bias={-0.0005}
          />
          <Grid
            position={[0, -0.005, 0]}
            infiniteGrid
            cellSize={1}
            sectionSize={5}
            cellColor={SCENE_COLORS.gridCell}
            sectionColor={SCENE_COLORS.gridSection}
            fadeDistance={size * 5}
          />
          <FitCamera bounds={bounds} />
          <PlanModel showCeiling={showCeiling} />
          <ImportedItems />
          <OrbitControls makeDefault enabled={!walking} target={[cx, 0, cz]} maxPolarAngle={Math.PI / 2 - 0.02} />
          <WalkControls host={host} />
          <PushPullTool host={host} />
          <ItemTool host={host} />
        </Canvas>
        {dropping && (
          <div className="pointer-events-none absolute inset-2 grid place-items-center rounded border-2 border-dashed border-cyanotype bg-vellum/60 text-sm text-cyanotype" data-testid="drop-hint">
            Drop a 3D model to import it
          </div>
        )}
      </div>
      {loading && (
        <div role="progressbar" aria-label="Loading a 3D model" data-testid="model-loading" className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-cyanotype motion-safe:animate-pulse" />
      )}
      <WalkOverlay host={host} />
      <PushPullOverlay />
      <ItemToolOverlay />
    </>
  );
}
