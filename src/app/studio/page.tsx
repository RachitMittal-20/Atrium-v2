"use client";

/*
 * src/app/studio/page.tsx — the editor route the landing CTA leads to. For now
 * it shows the plan in 3D (PlanModel) with orbit controls; editing arrives in
 * later phases. Mounts the undo/redo shortcuts from planStore.
 */
import { OrbitControls, Grid } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { PlanModel } from "@/components/three/PlanModel";
import { SCENE_COLORS } from "@/data/materials";
import { installPlanShortcuts, usePlanStore } from "@/store/planStore";

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
    if (userMoved.current || width === 0 || height === 0) return;
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

export default function Studio() {
  const [ceiling, setCeiling] = useState(false);
  const plan = usePlanStore((s) => s.plan);
  useEffect(() => installPlanShortcuts(), []);

  // Frame the plan once, from its bounds when the page opens (later edits don't move the camera).
  const [bounds] = useState(() => planBounds(usePlanStore.getState().plan.walls));
  const { cx, cz, size } = bounds;
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(cx, 0, cz);
    return o;
  }, [cx, cz]);

  return (
    <main className="relative h-svh w-full bg-limestone">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ fov: 45, near: 0.1, far: 500 }}
      >
        <color attach="background" args={[SCENE_COLORS.background]} />
        <hemisphereLight args={["#ffffff", "#b8ad98", 0.9]} />
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
        <PlanModel showCeiling={ceiling} />
        <OrbitControls makeDefault target={[cx, 0, cz]} maxPolarAngle={Math.PI / 2 - 0.02} />
      </Canvas>

      {/* Temporary: counts and the ceiling toggle, until the editor chrome exists. */}
      <div className="absolute left-3 top-3 flex flex-col gap-2 rounded bg-vellum/90 px-3 py-2 text-sm text-smoke">
        <span>
          {plan.walls.length} walls · {plan.openings.length} openings · {plan.rooms.length} rooms
        </span>
        <label className="flex items-center gap-2 text-iron">
          <input type="checkbox" checked={ceiling} onChange={(e) => setCeiling(e.target.checked)} />
          Show ceilings
        </label>
      </div>
    </main>
  );
}
