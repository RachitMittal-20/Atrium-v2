"use client";

/**
 * PlanModel.tsx — renders the plan from usePlanStore as a 3D model. A derived
 * view of Plan: nothing here is edited or stored.
 *
 * Selecting: each wall mesh carries its wall id in userData, and every mesh of a
 * door or window (frame, leaf, glass) its opening id, so a raycast maps straight
 * back to the plan and into selectionStore — the same selection the 2D plan
 * shows. One handler on the model's group decides what a click picks, by
 * edges.pickAlongRay: the nearest wall or opening, except that an opening up to
 * one wall thickness behind the nearest wall wins (a click that clips a jamb is
 * still aimed at the door). A floor in front picks nothing and clears the
 * selection. Only a real click (handles3d/math.isClick) selects: an orbit drag
 * never does. Selected walls are tinted gilt, hovered ones lighter, and the other
 * pieces of the straight wall the selection belongs to (its run, which a 2D body
 * drag moves as one) lighter still; a selected door or window frame is gilt and a
 * hovered one lighter. Walls and openings are not dragged here; the 2D plan and
 * the 3D tools edit them.
 * While walking (viewStore.mode === "walk") nothing is picked, hovered or
 * tinted: a drag looks around, it does not select. The same while a 3D tool
 * (Push/Pull or Move) is active: its clicks and hovers belong to PushPullTool,
 * which finds what was hit from the face roles each wall mesh carries in
 * userData.faces (see src/lib/plan/meshBuilders.ts) and from the opening ids.
 * The opening the Move tool is over (or moving) has its frame tinted light blue.
 * Doors and windows are built from the same Opening data as the 2D plan: a
 * door's leaf stands slightly open towards its stored swing side (the hinge at
 * the jamb nearer the wall's a end), so Flip turns it to the other side.
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
 * Connects to: src/store/{planStore,selectionStore,toolStore,viewStore,pushPullStore}.ts,
 * src/lib/plan/{geometry,meshBuilders}.ts, src/lib/handles3d/{edges,math}.ts,
 * src/data/materials.ts; mounted by src/components/studio/Scene3D.tsx inside a <Canvas>.
 */
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { floorColor, SCENE_COLORS } from "@/data/materials";
import { pickAlongRay, type RayHit } from "@/lib/handles3d/edges";
import { isClick, type PointerStamp } from "@/lib/handles3d/math";
import { wallDirection } from "@/lib/plan/geometry";
import { buildFloorGeometry, buildWallGeometry, wallSignature } from "@/lib/plan/meshBuilders";
import type { DerivedRoom } from "@/lib/plan/rooms";
import { useDerivedRooms, usePlanStore } from "@/store/planStore";
import { usePushPullStore } from "@/store/pushPullStore";
import { is3dTool, useToolStore } from "@/store/toolStore";
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

/** One box of a door or window; `openingId` rides in userData so a raycast hit maps back to the opening. */
function Box({ size, position, color, glass, openingId }: { size: [number, number, number]; position: [number, number, number]; color: string; glass?: boolean; openingId: string }) {
  return (
    <mesh position={position} castShadow={!glass} userData={{ openingId }}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} transparent={glass} opacity={glass ? 0.25 : 1} depthWrite={!glass} roughness={glass ? 0.1 : 0.7} />
    </mesh>
  );
}

const LEAF_OPEN = 0.3; // radians a door leaf stands open, about 17°

/** How an opening's frame is tinted: the Move tool's target, the selection, the hover, or not at all. */
type Tint = "tool" | "selected" | "hovered" | null;
const FRAME_TINT: Record<Exclude<Tint, null>, string> = { tool: SCENE_COLORS.toolHighlight, selected: SCENE_COLORS.wallSelected, hovered: SCENE_COLORS.wallHovered };

/** Frame plus a glass pane (window) or a slightly open leaf (door). Local x runs
 *  along the wall (a → b), local z across it, so the group is rotated to the wall.
 *  With that rotation local +z is the wall's left normal (plan (-dy, dx)), and
 *  turning the leaf by -LEAF_OPEN about y swings its tip towards +z: so "left"
 *  turns -LEAF_OPEN and "right" +LEAF_OPEN, matching the 2D swing. */
function OpeningMesh({ opening, wall, tint }: { opening: Opening; wall: Wall; tint: Tint }) {
  const d = wallDirection(wall);
  const { id, width: w, height: h, sillHeight: s } = opening;
  const depth = wall.thickness + 0.02; // frames stand a hair proud of the wall faces
  const midY = s + h / 2;
  const frame = tint ? FRAME_TINT[tint] : SCENE_COLORS.frame;
  const turn = opening.swing === "right" ? LEAF_OPEN : -LEAF_OPEN;
  return (
    <group
      position={[wall.a.x + d.x * opening.offset, 0, wall.a.y + d.y * opening.offset]}
      rotation={[0, Math.atan2(-d.y, d.x), 0]} // rotateY(θ) maps local +x to (cos θ, 0, -sin θ) = the wall direction
      userData={{ openingId: id, kind: opening.kind }}
    >
      <Box openingId={id} size={[FRAME, h, depth]} position={[-w / 2 + FRAME / 2, midY, 0]} color={frame} />
      <Box openingId={id} size={[FRAME, h, depth]} position={[w / 2 - FRAME / 2, midY, 0]} color={frame} />
      <Box openingId={id} size={[w, FRAME, depth]} position={[0, s + h - FRAME / 2, 0]} color={frame} />
      {opening.kind === "window" ? (
        <>
          <Box openingId={id} size={[w, FRAME, depth]} position={[0, s + FRAME / 2, 0]} color={frame} />
          <Box openingId={id} size={[w - 2 * FRAME, h - 2 * FRAME, 0.01]} position={[0, midY, 0]} color={SCENE_COLORS.glass} glass />
        </>
      ) : (
        // Leaf hinged at the jamb nearer a, standing open towards the swing side.
        <group position={[-w / 2 + FRAME, 0, 0]} rotation={[0, turn, 0]} userData={{ leaf: true }}>
          <Box openingId={id} size={[w - 2 * FRAME, h - FRAME, 0.04]} position={[(w - 2 * FRAME) / 2, s + (h - FRAME) / 2, 0]} color={SCENE_COLORS.door} />
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

/** A DOM event's position and time, for isClick. */
const stamp = (e: MouseEvent | PointerEvent): PointerStamp => ({ x: e.clientX, y: e.clientY, t: e.timeStamp });

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
  const tool = useToolStore((s) => s.tool);
  const picking = !walking && !is3dTool(tool); // a 3D tool's clicks and hovers belong to PushPullTool
  // the door or window the Move tool is over or moving
  const moveTarget = usePushPullStore((s) => (tool === "move" && !walking ? ((s.pull?.face ?? s.hover)?.openingId ?? null) : null));
  const [hoverOpening, setHoverOpening] = useState<string | null>(null);
  const down = useRef<PointerStamp | null>(null);

  /** What a pointer's ray picks: edges.pickAlongRay over every mesh it went through. */
  const targetOf = (e: ThreeEvent<MouseEvent | PointerEvent>) => {
    const seen = new Set<string>();
    const hits: RayHit[] = [];
    for (const i of e.intersections) {
      if (seen.has(i.object.uuid)) continue; // a mesh can appear once per handler on its way up; count it once
      seen.add(i.object.uuid);
      const u = i.object.userData;
      hits.push(u.wallId ? { kind: "wall", id: String(u.wallId), distance: i.distance } : u.openingId ? { kind: "opening", id: String(u.openingId), distance: i.distance } : { kind: "other", id: "", distance: i.distance });
    }
    return pickAlongRay(hits, (id) => wallById.get(id)?.thickness ?? 0);
  };
  const setHovers = (t: ReturnType<typeof targetOf>) => {
    const wallId = t?.kind === "wall" ? t.id : null;
    if (useSelectionStore.getState().hoveredId !== wallId) useSelectionStore.getState().hover(wallId);
    setHoverOpening(t?.kind === "opening" ? t.id : null);
  };

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
    <group
      ref={groupRef}
      onPointerDown={(e) => void (down.current = stamp(e.nativeEvent))}
      onClick={(e) => {
        if (!picking) return;
        e.stopPropagation(); // decided once, here, for every mesh the ray went through
        if (!down.current || !isClick(down.current, stamp(e.nativeEvent))) return; // an orbit drag that ends on a wall is not a click
        const t = targetOf(e);
        if (!t) useSelectionStore.getState().select(null); // the floor: like clicking past everything
        else if (t.kind === "opening") useSelectionStore.getState().selectOpening(t.id);
        else useSelectionStore.getState().select(t.id);
      }}
      onPointerMove={(e) => {
        if (!picking) return;
        e.stopPropagation();
        setHovers(targetOf(e));
      }}
      onPointerOut={() => picking && setHovers(null)}
    >
      {plan.walls.map((wall) => (
        <mesh key={wall.id} geometry={wallGeometries.get(wall.id)!.geo} userData={{ wallId: wall.id, faces: wallGeometries.get(wall.id)!.geo.userData.faces }} castShadow receiveShadow>
          <meshStandardMaterial
            color={
              walking
                ? SCENE_COLORS.wall
                : wall.id === selectedId
                ? SCENE_COLORS.wallSelected
                : picking && wall.id === hoveredId
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
        const tint: Tint = walking ? null : o.id === moveTarget ? "tool" : o.id === openingId ? "selected" : picking && o.id === hoverOpening ? "hovered" : null;
        return wall ? <OpeningMesh key={o.id} opening={o} wall={wall} tint={tint} /> : null;
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
