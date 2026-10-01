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
 */
import { OrbitControls, Grid } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { PlanModel } from "@/components/three/PlanModel";
import { WalkControls } from "@/components/three/WalkControls";
import { SCENE_COLORS } from "@/data/materials";
import { usePlanStore } from "@/store/planStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useViewStore } from "@/store/viewStore";
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

  return (
    <>
      <div
        ref={host}
        tabIndex={0}
        role="group"
        aria-label="3D view. Drag to orbit. In Walk: W A S D move, arrows turn, drag to look, Shift runs, Escape exits."
        data-testid="scene-3d"
        className="absolute inset-0 focus-visible:outline-offset-[-3px]"
        style={{ touchAction: walking ? "none" : undefined }} // a walking drag looks; it never scrolls the page
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
          <OrbitControls makeDefault enabled={!walking} target={[cx, 0, cz]} maxPolarAngle={Math.PI / 2 - 0.02} />
          <WalkControls host={host} />
        </Canvas>
      </div>
      <WalkOverlay host={host} />
    </>
  );
}
