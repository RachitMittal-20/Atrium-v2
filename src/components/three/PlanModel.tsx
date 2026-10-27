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
 * door's leaf stands slightly open towards its stored swing side, pivoting on the
 * jamb its `hinge` names (step M.1d: "a", the jamb nearer the wall's a end, when
 * none is stored), so Flip turns it to the other side and the panel's hinge control
 * moves it to the other jamb.
 * In development the wall ids of the meshes actually in the scene are exposed
 * as window.__scene3d.wallIds(), and the openings as __scene3d.openings() (id,
 * kind, which way the door leaf actually turned, and since step M.1d where it pivots
 * and the world box of its mesh), so
 * scripts/e2e-studio.ts can check an edit really reached the 3D model, not just
 * the store.
 *
 * Coordinates: plan (x, y) → world (x, 0, y); plan units are metres; world up
 * is +Y. Seen from above (+Y looking down) with -Z at screen-top, the model
 * reads exactly like the 2D plan: x to the right, y (south) downward.
 *
 * Step V.2, Cutaway (src/lib/view/cutaway.ts): in Orbit and Top, when chosen, walls, doors, windows and ceilings
 * are clipped at 1.2 m by a clipping plane on their materials (no mesh changes), each cut wall gets a dark
 * BackSide copy that shows its section, and every wall and opening mesh's raycast (cutRaycast) drops what the plane
 * clipped and counts the section, so nothing cut away is ever picked. Full height while walking and for Push/Pull
 * and Move. __scene3d.cut() reports the cut in force (development only).
 *
 * Connects to: src/store/{planStore,selectionStore,toolStore,viewStore,pushPullStore,cutawayStore}.ts,
 * src/lib/plan/{geometry,meshBuilders}.ts, src/lib/handles3d/{edges,math}.ts,
 * src/data/materials.ts; mounted by src/components/studio/Scene3D.tsx inside a <Canvas>.
 */
import type { ThreeEvent } from "@react-three/fiber";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { floorColor, SCENE_COLORS } from "@/data/materials";
import { pickAlongRay, type RayHit } from "@/lib/handles3d/edges";
import { isClick, type PointerStamp } from "@/lib/handles3d/math";
import { wallDirection } from "@/lib/plan/geometry";
import { buildFloorGeometry, buildWallGeometry, doorLeaf3d, wallSignature } from "@/lib/plan/meshBuilders";
import type { DerivedRoom } from "@/lib/plan/rooms";
import { CUT_HEIGHT, CUT_PLANES, NO_PLANES, cutInForce, cutRaycast } from "@/lib/view/cutaway";
import { cutawayOn, useCutawayStore } from "@/store/cutawayStore";
import { useDerivedRooms, usePlanStore } from "@/store/planStore";
import { usePushPullStore } from "@/store/pushPullStore";
import { is3dTool, useToolStore } from "@/store/toolStore";
import { useSelectedRun, useSelectionStore } from "@/store/selectionStore";
import { useViewStore } from "@/store/viewStore";
import type { Opening, Plan, Wall } from "@/types/plan";

const FLOOR_Y = 0.01; // just above y = 0 so floors never z-fight the wall bottoms
const FRAME = 0.05; // frame member width, metres
const NEVER_PICKED = () => {}; // a raycast that finds nothing: the cut walls' section caps are drawn, never picked

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

/** One box of a door or window; `openingId` rides in userData so a raycast hit maps back to the opening.
 *  With the cut on (step V.2) it is clipped at the cut height and its raycast ignores what was clipped. */
function Box({ size, position, color, glass, openingId, cut }: { size: [number, number, number]; position: [number, number, number]; color: string; glass?: boolean; openingId: string; cut: boolean }) {
  return (
    <mesh position={position} castShadow={!glass} userData={{ openingId, cutY: cut ? CUT_HEIGHT : undefined }} raycast={cutRaycast}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} transparent={glass} opacity={glass ? 0.25 : 1} depthWrite={!glass} roughness={glass ? 0.1 : 0.7} clippingPlanes={cut ? CUT_PLANES : NO_PLANES} clipShadows />
    </mesh>
  );
}

/** How an opening's frame is tinted: the Move tool's target, the selection, the hover, or not at all. */
type Tint = "tool" | "selected" | "hovered" | null;
const FRAME_TINT: Record<Exclude<Tint, null>, string> = { tool: SCENE_COLORS.toolHighlight, selected: SCENE_COLORS.wallSelected, hovered: SCENE_COLORS.wallHovered };

/** Frame plus a glass pane (window) or a slightly open leaf (door). Local x runs
 *  along the wall (a → b), local z across it, so the group is rotated to the wall.
 *  With that rotation local +z is the wall's left normal (plan (-dy, dx)). Where the
 *  leaf hangs and which way it turns is doorLeaf3d (step M.1d), which reads the same
 *  hinge jamb and swing side as the 2D plan, so the two can never disagree. */
function OpeningMesh({ opening, wall, tint, cut }: { opening: Opening; wall: Wall; tint: Tint; cut: boolean }) {
  const d = wallDirection(wall);
  const { id, width: w, height: h, sillHeight: s } = opening;
  const depth = wall.thickness + 0.02; // frames stand a hair proud of the wall faces
  const midY = s + h / 2;
  const frame = tint ? FRAME_TINT[tint] : SCENE_COLORS.frame;
  const leaf = doorLeaf3d(opening, FRAME);
  return (
    <group
      position={[wall.a.x + d.x * opening.offset, 0, wall.a.y + d.y * opening.offset]}
      rotation={[0, Math.atan2(-d.y, d.x), 0]} // rotateY(θ) maps local +x to (cos θ, 0, -sin θ) = the wall direction
      userData={{ openingId: id, kind: opening.kind }}
    >
      <Box cut={cut} openingId={id} size={[FRAME, h, depth]} position={[-w / 2 + FRAME / 2, midY, 0]} color={frame} />
      <Box cut={cut} openingId={id} size={[FRAME, h, depth]} position={[w / 2 - FRAME / 2, midY, 0]} color={frame} />
      <Box cut={cut} openingId={id} size={[w, FRAME, depth]} position={[0, s + h - FRAME / 2, 0]} color={frame} />
      {opening.kind === "window" ? (
        <>
          <Box cut={cut} openingId={id} size={[w, FRAME, depth]} position={[0, s + FRAME / 2, 0]} color={frame} />
          <Box cut={cut} openingId={id} size={[w - 2 * FRAME, h - 2 * FRAME, 0.01]} position={[0, midY, 0]} color={SCENE_COLORS.glass} glass />
        </>
      ) : (
        // Leaf hinged on its own jamb ("a" or "b"), standing open towards the swing side.
        <group position={[leaf.pivotX, 0, 0]} rotation={[0, leaf.turn, 0]} userData={{ leaf: true }}>
          <Box cut={cut} openingId={id} size={[leaf.length, h - FRAME, 0.04]} position={[leaf.boxX, s + (h - FRAME) / 2, 0]} color={SCENE_COLORS.door} />
        </group>
      )}
    </group>
  );
}

// ---------------------------------------------------------------- rooms

/** Flat polygon for a room's floor or ceiling, built once per polygon. */
function RoomSurface({ room, y, color, ceiling, cut = false }: { room: DerivedRoom; y: number; color: string; ceiling?: boolean; cut?: boolean }) {
  const geometry = useMemo(() => buildFloorGeometry(room.polygon), [room.polygon]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} position={[0, y, 0]} receiveShadow={!ceiling}>
      {/* The ceiling is the floor shape seen from below: BackSide hides it from above so the model stays viewable. */}
      <meshStandardMaterial color={color} side={ceiling ? THREE.BackSide : THREE.FrontSide} clippingPlanes={cut ? CUT_PLANES : NO_PLANES} />
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
  // Step V.2: Cutaway clips walls, doors, windows and ceilings at CUT_HEIGHT (never in Walk, never for Push/Pull or Move)
  const cut = cutInForce({ on: useCutawayStore(cutawayOn), walking, tool });
  const cutY = cut ? CUT_HEIGHT : undefined;
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
      // Step V.2: the cut in force on the wall meshes (null: full height) and how many walls carry it
      cut: () => {
        const walls = children().filter((c) => c.userData.wallId);
        const ys = new Set(walls.map((c) => (typeof c.userData.cutY === "number" ? c.userData.cutY : null)));
        return { y: ys.size === 1 ? [...ys][0] : "mixed", walls: walls.length, caps: children().filter((c) => c.userData.cutCap).length };
      },
      // The leaf's real rotation, read back from the scene graph: which way the door stands open.
      // Step M.1d also reports where it PIVOTS, in world space (the leaf group's own position: the
      // hinge jamb), and the world box of its mesh, so a test can tell the two jambs apart.
      openings: () =>
        children()
          .filter((c) => c.userData.openingId)
          .map((c) => {
            const leaf = c.children.find((k) => k.userData.leaf);
            const pivot = leaf && leaf.getWorldPosition(new THREE.Vector3());
            const box = leaf && new THREE.Box3().setFromObject(leaf);
            return {
              id: String(c.userData.openingId),
              kind: String(c.userData.kind),
              leafTurn: leaf?.rotation.y ?? null,
              leafPivot: pivot ? { x: pivot.x, y: pivot.y, z: pivot.z } : null,
              leafBox: box ? { minX: box.min.x, maxX: box.max.x, minY: box.min.y, maxY: box.max.y, minZ: box.min.z, maxZ: box.max.z } : null,
            };
          }),
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
      {plan.walls.map((wall) => {
        const geo = wallGeometries.get(wall.id)!.geo;
        const color = walking
          ? SCENE_COLORS.wall
          : wall.id === selectedId
            ? SCENE_COLORS.wallSelected
            : picking && wall.id === hoveredId
              ? SCENE_COLORS.wallHovered
              : inRun.has(wall.id)
                ? SCENE_COLORS.wallRun
                : SCENE_COLORS.wall;
        return (
          <Fragment key={wall.id}>
            <mesh geometry={geo} userData={{ wallId: wall.id, faces: geo.userData.faces, cutY }} raycast={cutRaycast} castShadow receiveShadow>
              <meshStandardMaterial color={color} roughness={0.9} clippingPlanes={cut ? CUT_PLANES : NO_PLANES} clipShadows />
            </mesh>
            {/* The cut wall's section: its inside faces, seen through the cut, drawn flat dark like a plan's poche, or
                in the wall's tint when it is selected, hovered or in the selected run (the highlight follows the cut). */}
            {cut && (
              <mesh geometry={geo} userData={{ cutCap: true }} raycast={NEVER_PICKED}>
                <meshBasicMaterial color={color === SCENE_COLORS.wall ? SCENE_COLORS.cutSection : color} side={THREE.BackSide} clippingPlanes={CUT_PLANES} />
              </mesh>
            )}
          </Fragment>
        );
      })}
      {plan.openings.map((o) => {
        const wall = wallById.get(o.wallId);
        const tint: Tint = walking ? null : o.id === moveTarget ? "tool" : o.id === openingId ? "selected" : picking && o.id === hoverOpening ? "hovered" : null;
        return wall ? <OpeningMesh key={o.id} opening={o} wall={wall} tint={tint} cut={cut} /> : null;
      })}
      {rooms.map((room) => (
        <RoomSurface key={room.id} room={room} y={FLOOR_Y} color={floorColor(room.floorMaterial)} />
      ))}
      {showCeiling &&
        rooms.map((room) => {
          const height = Math.max(0, ...room.wallIds.map((id) => wallById.get(id)?.height ?? 0));
          return <RoomSurface key={`c-${room.id}`} room={room} y={height} color={SCENE_COLORS.ceiling} ceiling cut={cut} />;
        })}
    </group>
  );
}
