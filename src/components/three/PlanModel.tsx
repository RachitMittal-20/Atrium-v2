"use client";

/**
 * PlanModel.tsx — renders the plan from usePlanStore as a 3D model. A derived
 * view of Plan: nothing here is edited or stored.
 *
 * Selecting: each wall mesh carries its wall id in userData, so the raycast hit
 * R3F hands to onClick maps straight back to a wall and into selectionStore —
 * the same selection the 2D plan shows. Selected walls are tinted gilt, hovered
 * ones lighter, and the other pieces of the straight wall the selection belongs
 * to (its run, which a 2D body drag moves as one) lighter still.
 * Walls are NOT draggable in 3D; editing happens in the 2D plan.
 * While walking (viewStore.mode === "walk") nothing is picked, hovered or
 * tinted: a drag looks around, it does not select.
 * Doors and windows are built from the same Opening data as the 2D plan: a
 * door's leaf stands slightly open towards its stored swing side (the hinge at
 * the jamb nearer the wall's a end), so Flip turns it to the other side. The
 * selected opening's frame is tinted gilt.
 * In development the wall ids of the meshes actually in the scene are exposed
 * as window.__scene3d.wallIds(), and the openings as __scene3d.openings() (id,
 * kind, and which way the door leaf actually turned), so
 * scripts/e2e-studio.ts can check an edit really reached the 3D model, not just
 * the store.
 *
 * Coordinates: plan (x, y) → world (x, 0, y); plan units are metres; world up
 * is +Y. Seen from above (+Y looking down) with -Z at screen-top, the model
 * reads exactly like the 2D plan: x to the right, y (south) downward.
 *
 * Connects to: src/store/planStore.ts, src/lib/plan/{geometry,meshBuilders}.ts,
 * src/data/materials.ts; mounted by src/app/studio/page.tsx inside a <Canvas>.
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { floorColor, SCENE_COLORS } from "@/data/materials";
import { wallDirection } from "@/lib/plan/geometry";
import { buildFloorGeometry, buildWallGeometry, wallSignature } from "@/lib/plan/meshBuilders";
import type { DerivedRoom } from "@/lib/plan/rooms";
import { useDerivedRooms, usePlanStore } from "@/store/planStore";
import { useSelectedRun, useSelectionStore } from "@/store/selectionStore";
import { useViewStore } from "@/store/viewStore";
import type { Opening, Plan, Wall } from "@/types/plan";

const FLOOR_Y = 0.01; // just above y = 0 so floors never z-fight the wall bottoms
const FRAME = 0.05; // frame member width, metres

// ---------------------------------------------------------------- walls

interface CachedGeometry {
  sig: string;
  geo: THREE.BufferGeometry;
}

/** One geometry per wall, rebuilt only when that wall, its openings or a
 *  neighbour at either end changed (see wallSignature). */
function useWallGeometries(plan: Plan): Map<string, CachedGeometry> {
  const cache = useRef(new Map<string, CachedGeometry>());
  const geometries = useMemo(() => {
    const next = new Map<string, CachedGeometry>();
    for (const wall of plan.walls) {
      const sig = wallSignature(wall, plan.walls, plan.openings);
      const hit = cache.current.get(wall.id);
      next.set(wall.id, hit?.sig === sig ? hit : { sig, geo: buildWallGeometry(wall, plan.walls, plan.openings) });
    }
    return next;
  }, [plan.walls, plan.openings]);

  // After commit, free geometries that were replaced or whose wall is gone.
  useEffect(() => {
    const kept = new Set(geometries.values());
    for (const entry of cache.current.values()) if (!kept.has(entry)) entry.geo.dispose();
    cache.current = geometries;
  }, [geometries]);
  useEffect(() => () => cache.current.forEach((e) => e.geo.dispose()), []);

  return geometries;
}

// ---------------------------------------------------------------- openings

function Box({ size, position, color, glass }: { size: [number, number, number]; position: [number, number, number]; color: string; glass?: boolean }) {
  return (
    <mesh position={position} castShadow={!glass}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} transparent={glass} opacity={glass ? 0.25 : 1} depthWrite={!glass} roughness={glass ? 0.1 : 0.7} />
    </mesh>
  );
}

const LEAF_OPEN = 0.3; // radians a door leaf stands open, about 17°

/** Frame plus a glass pane (window) or a slightly open leaf (door). Local x runs
 *  along the wall (a → b), local z across it, so the group is rotated to the wall.
 *  With that rotation local +z is the wall's left normal (plan (-dy, dx)), and
 *  turning the leaf by -LEAF_OPEN about y swings its tip towards +z: so "left"
 *  turns -LEAF_OPEN and "right" +LEAF_OPEN, matching the 2D swing. */
function OpeningMesh({ opening, wall, selected }: { opening: Opening; wall: Wall; selected: boolean }) {
  const d = wallDirection(wall);
  const { width: w, height: h, sillHeight: s } = opening;
  const depth = wall.thickness + 0.02; // frames stand a hair proud of the wall faces
  const midY = s + h / 2;
  const frame = selected ? SCENE_COLORS.wallSelected : SCENE_COLORS.frame;
  const turn = opening.swing === "right" ? LEAF_OPEN : -LEAF_OPEN;
  return (
    <group
      position={[wall.a.x + d.x * opening.offset, 0, wall.a.y + d.y * opening.offset]}
      rotation={[0, Math.atan2(-d.y, d.x), 0]} // rotateY(θ) maps local +x to (cos θ, 0, -sin θ) = the wall direction
      userData={{ openingId: opening.id, kind: opening.kind }}
    >
      <Box size={[FRAME, h, depth]} position={[-w / 2 + FRAME / 2, midY, 0]} color={frame} />
      <Box size={[FRAME, h, depth]} position={[w / 2 - FRAME / 2, midY, 0]} color={frame} />
      <Box size={[w, FRAME, depth]} position={[0, s + h - FRAME / 2, 0]} color={frame} />
      {opening.kind === "window" ? (
        <>
          <Box size={[w, FRAME, depth]} position={[0, s + FRAME / 2, 0]} color={frame} />
          <Box size={[w - 2 * FRAME, h - 2 * FRAME, 0.01]} position={[0, midY, 0]} color={SCENE_COLORS.glass} glass />
        </>
      ) : (
        // Leaf hinged at the jamb nearer a, standing open towards the swing side.
        <group position={[-w / 2 + FRAME, 0, 0]} rotation={[0, turn, 0]} userData={{ leaf: true }}>
          <Box size={[w - 2 * FRAME, h - FRAME, 0.04]} position={[(w - 2 * FRAME) / 2, s + (h - FRAME) / 2, 0]} color={SCENE_COLORS.door} />
        </group>
      )}
    </group>
  );
}

// ---------------------------------------------------------------- rooms

/** Flat polygon for a room's floor or ceiling, built once per polygon. */
function RoomSurface({ room, y, color, ceiling }: { room: DerivedRoom; y: number; color: string; ceiling?: boolean }) {
  const geometry = useMemo(() => buildFloorGeometry(room.polygon), [room.polygon]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} position={[0, y, 0]} receiveShadow={!ceiling}>
      {/* The ceiling is the floor shape seen from below: BackSide hides it from above so the model stays viewable. */}
      <meshStandardMaterial color={color} side={ceiling ? THREE.BackSide : THREE.FrontSide} />
    </mesh>
  );
}

// ---------------------------------------------------------------- model

export function PlanModel({ showCeiling = false }: { showCeiling?: boolean }) {
  const plan = usePlanStore((s) => s.plan);
  const rooms = useDerivedRooms();
  const wallGeometries = useWallGeometries(plan);
  const wallById = useMemo(() => new Map(plan.walls.map((w) => [w.id, w])), [plan.walls]);
  const selectedId = useSelectionStore((s) => s.selectedId);
  const openingId = useSelectionStore((s) => s.openingId);
  const hoveredId = useSelectionStore((s) => s.hoveredId);
  const run = useSelectedRun();
  const inRun = useMemo(() => new Set(run), [run]);
  const walking = useViewStore((s) => s.mode === "walk");
  const select = useSelectionStore((s) => s.select);
  const hover = useSelectionStore((s) => s.hover);
  /** The wall id a raycast hit, read back out of the mesh's userData. */
  const idOf = (object: THREE.Object3D) => String(object.userData.wallId);

  // Development only: read the wall meshes back out of the live scene graph.
  const groupRef = useRef<THREE.Group>(null);
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const children = () => groupRef.current?.children ?? [];
    const hook = {
      wallIds: () => children().filter((c) => c.userData.wallId).map((c) => String(c.userData.wallId)),
      // The leaf's real rotation, read back from the scene graph: which way the door stands open.
      openings: () =>
        children()
          .filter((c) => c.userData.openingId)
          .map((c) => ({ id: String(c.userData.openingId), kind: String(c.userData.kind), leafTurn: c.children.find((k) => k.userData.leaf)?.rotation.y ?? null })),
    };
    (window as unknown as { __scene3d?: typeof hook }).__scene3d = hook;
    return () => {
      if ((window as unknown as { __scene3d?: typeof hook }).__scene3d === hook) delete (window as unknown as { __scene3d?: typeof hook }).__scene3d;
    };
  }, []);

  return (
    <group ref={groupRef}>
      {plan.walls.map((wall) => (
        <mesh
          key={wall.id}
          geometry={wallGeometries.get(wall.id)!.geo}
          userData={{ wallId: wall.id }}
          castShadow
          receiveShadow
          onClick={(e) => {
            if (walking) return;
            e.stopPropagation(); // only the nearest wall is selected, not everything behind it
            select(idOf(e.object));
          }}
          onPointerOver={(e) => {
            if (walking) return;
            e.stopPropagation();
            hover(idOf(e.object));
          }}
          onPointerOut={() => !walking && hover(null)}
        >
          <meshStandardMaterial
            color={
              walking
                ? SCENE_COLORS.wall
                : wall.id === selectedId
                ? SCENE_COLORS.wallSelected
                : wall.id === hoveredId
                  ? SCENE_COLORS.wallHovered
                  : inRun.has(wall.id)
                    ? SCENE_COLORS.wallRun
                    : SCENE_COLORS.wall
            }
            roughness={0.9}
          />
        </mesh>
      ))}
      {plan.openings.map((o) => {
        const wall = wallById.get(o.wallId);
        return wall ? <OpeningMesh key={o.id} opening={o} wall={wall} selected={!walking && o.id === openingId} /> : null;
      })}
      {rooms.map((room) => (
        <RoomSurface key={room.id} room={room} y={FLOOR_Y} color={floorColor(room.floorMaterial)} />
      ))}
      {showCeiling &&
        rooms.map((room) => {
          const height = Math.max(0, ...room.wallIds.map((id) => wallById.get(id)?.height ?? 0));
          return <RoomSurface key={`c-${room.id}`} room={room} y={height} color={SCENE_COLORS.ceiling} ceiling />;
        })}
    </group>
  );
}
