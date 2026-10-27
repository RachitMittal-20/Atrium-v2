"use client";

/*
 * src/components/studio/Scene3D.tsx — the 3D canvas of the editor: lights, grid,
 * ViewCamera, orbit controls and PlanModel (a derived view of the plan). Framed
 * from the plan's bounds when it mounts (the home view, or the top view when Top is on;
 * src/lib/view/camera.ts) and kept framed on a resize until the user moves the camera.
 * ViewCamera (step V.1) also glides to the bird's-eye Top view and back, and to the home
 * view on Recenter (the button, or R with this pane focused). Clicking a wall selects it (see
 * PlanModel); clicking past everything clears the selection. An empty plan (step N.1) is
 * framed on a 10 x 10 m patch of ground instead of NaN bounds (planBounds). Mounted by
 * src/app/studio/page.tsx.
 *
 * Walking (src/store/viewStore.ts): the canvas sits in a focusable host div
 * that WalkControls reads keys and look drags from; WalkOverlay (Orbit | Top | Walk,
 * Recenter, hint, Exit, joystick) sits beside it, not inside, so its buttons are never walking
 * input. While walking, orbit controls are off, ViewCamera never moves the camera, nothing
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
 *
 * Step V.2: Cutaway (src/lib/view/cutaway.ts, src/store/cutawayStore.ts) clips walls and openings at 1.2 m in Orbit
 * and Top with per-material clipping planes (the renderer's localClippingEnabled is turned on here), and room names
 * (RoomLabels, DOM beside the canvas, placed by RoomLabelTracker inside it) label the floors. A gentle ambient fill
 * (0.3) lights the floors in Orbit and Top; walking keeps its 0.6.
 */
import { OrbitControls, Grid } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import * as THREE from "three";
import { ImportedItems } from "@/components/three/ImportedItems";
import { ItemTool } from "@/components/three/ItemTool";
import { PlanModel } from "@/components/three/PlanModel";
import { RoomLabelTracker, RoomLabels } from "@/components/three/RoomLabels";
import { PushPullTool } from "@/components/three/PushPullTool";
import { ViewCamera } from "@/components/three/ViewCamera";
import { WalkControls } from "@/components/three/WalkControls";
import { SCENE_COLORS } from "@/data/materials";
import { useAssetsLoading } from "@/lib/import/assetCache";
import { planBounds } from "@/lib/view/camera";
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
  const labelEls = useRef(new Map<string, HTMLDivElement>()); // step V.2: the room labels, placed every frame by RoomLabelTracker
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
        aria-label="3D view. Drag to orbit. Click a wall, door, window or imported model to select it. With the Push/Pull tool, drag a wall top, or a door's or window's side, top or sill, to resize it; with the Move tool, drag a door or window along its wall, or an imported model on the floor (Shift: up and down); or type a distance and press Enter. With Rotate or Scale, drag an imported model, or type degrees or a percentage and press Enter. In Walk: W A S D move, arrows turn, drag to look, Shift runs, Escape exits. R recenters the view."
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
          onCreated={({ gl }) => void (gl.localClippingEnabled = true)} // Cutaway (step V.2) clips with per-material planes
          onPointerMissed={() => useViewStore.getState().mode === "orbit" && useSelectionStore.getState().select(null)} // a walking drag looks, it does not select
        >
          <color attach="background" args={[SCENE_COLORS.background]} />
          <hemisphereLight args={["#ffffff", "#b8ad98", 0.9]} />
          {/* Walking, under the ceilings: a ceiling faces down, so the hemisphere gives it only its beige ground
              colour and it read as dark brown. A neutral fill lifts it and the shadowed walls. Ceilings cast no shadows.
              Step V.2: a gentler fill in Orbit and Top too, because about half of an imported plan's floor is in the
              sun's shadow (plan-chatgpt-flat: 48%; the sample: 44%) and read as a dark pit between the walls. */}
          <ambientLight intensity={walking ? 0.6 : 0.3} />
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
          <ViewCamera bounds={bounds} host={host} />
          <PlanModel showCeiling={showCeiling} />
          <RoomLabelTracker els={labelEls} />
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
      <RoomLabels els={labelEls} />
      <WalkOverlay host={host} />
      <PushPullOverlay />
      <ItemToolOverlay />
    </>
  );
}
