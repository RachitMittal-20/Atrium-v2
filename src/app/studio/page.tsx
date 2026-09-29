"use client";

/*
 * src/app/studio/page.tsx — the editor route the landing CTA leads to. For now
 * it shows the plan in 3D (PlanModel) with orbit controls; editing arrives in
 * later phases. Mounts the undo/redo shortcuts from planStore.
 */
import { OrbitControls, Grid } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { PlanModel } from "@/components/three/PlanModel";
import { SCENE_COLORS } from "@/data/materials";
import { installPlanShortcuts, usePlanStore } from "@/store/planStore";

/** Centre and size of the walls' bounding box on the ground, in world x/z. */
function planBounds(walls: { a: { x: number; y: number }; b: { x: number; y: number } }[]) {
  const xs = walls.flatMap((w) => [w.a.x, w.b.x]);
  const zs = walls.flatMap((w) => [w.a.y, w.b.y]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, size: Math.max(x1 - x0, z1 - z0, 1) };
}

/** On mount, back the camera off far enough that the whole plan fits both the
 *  width and the height of the viewport (a phone is taller than it is wide). */
function FitCamera({ cx, cz, size }: { cx: number; cz: number; size: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const aspect = useThree((s) => s.size.width / s.size.height);
  useEffect(() => {
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const distance = (size * 0.85) / Math.min(tanV, tanV * aspect); // 0.85 ≈ half the diagonal, plus margin
    camera.position.set(cx, 0, cz).addScaledVector(new THREE.Vector3(0.5, 0.65, 0.75).normalize(), distance);
    camera.lookAt(cx, 0, cz);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- frame once on mount; later resizes and edits keep the user's view
  }, []);
  return null;
}

export default function Studio() {
  const [ceiling, setCeiling] = useState(false);
  const plan = usePlanStore((s) => s.plan);
  useEffect(() => installPlanShortcuts(), []);

  // Frame the plan once, from its bounds when the page opens (later edits don't move the camera).
  const [{ cx, cz, size }] = useState(() => planBounds(usePlanStore.getState().plan.walls));
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
        <FitCamera cx={cx} cz={cz} size={size} />
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
