"use client";

/**
 * RoomLabels.tsx — room names in the 3D view (step V.2): a small label at each room's label point
 * (the polylabel point the 2D plan uses, rooms.ts labelPoint), just above the floor, with the net area
 * in the one units setting under it. Drawn in Orbit and Top, never in Walk. Shown when Room names is on
 * (src/store/cutawayStore.ts: the user's choice, else the same as Cutaway).
 *
 * Two parts, sharing one Map of elements by room id:
 *   RoomLabels        plain DOM laid over the canvas, a sibling of the canvas host like WalkOverlay (rendered
 *                     before it, so the pane's controls stay on top). `pointer-events: none` all through, so a
 *                     click or tap on a label goes straight to the model under it: the labels cover no hit area.
 *   RoomLabelTracker  inside the <Canvas>: every frame it projects each label point with the live camera and
 *                     writes the element's transform directly (no React render per frame), hiding a label whose
 *                     point is behind the camera or well off the pane.
 * (drei's <Html> was tried first: one React root per label, which React 19 in development reported as
 * unmounting a root during a render, and a label went missing.)
 * Text is iron on a vellum plate, so it reads over walls and floors alike.
 * Connects to: src/store/{planStore,cutawayStore,viewStore}.ts, src/components/studio/useUnitFormat.ts;
 * both mounted by src/components/studio/Scene3D.tsx.
 */
import { useFrame } from "@react-three/fiber";
import { useMemo, type RefObject } from "react";
import * as THREE from "three";
import { useUnitFormat } from "@/components/studio/useUnitFormat";
import { roomNamesOn, useCutawayStore } from "@/store/cutawayStore";
import { useDerivedRooms } from "@/store/planStore";
import { useViewStore } from "@/store/viewStore";

const LABEL_Y = 0.05; // m above the floor
const OFF_PANE = 1.2; // NDC: a point this far out is hidden rather than drawn half off the pane

export type LabelEls = RefObject<Map<string, HTMLDivElement>>;

export function RoomLabels({ els }: { els: LabelEls }) {
  const show = useCutawayStore(roomNamesOn);
  const walking = useViewStore((s) => s.mode === "walk");
  const rooms = useDerivedRooms();
  const { area } = useUnitFormat();
  if (!show || walking) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" data-testid="room-labels-3d">
      {rooms.map((r) => (
        <div
          key={r.id}
          ref={(el) => {
            if (el) els.current.set(r.id, el);
            else els.current.delete(r.id);
          }}
          data-testid="room-label-3d"
          data-room={r.id}
          style={{ visibility: "hidden" }} // until the tracker has placed it
          className="absolute left-0 top-0 select-none whitespace-nowrap rounded-sm bg-vellum/85 px-1.5 py-0.5 text-center leading-tight text-iron shadow-sm"
        >
          <div className="text-[11px] font-medium">{r.name}</div>
          <div className="text-[10px] text-smoke">{area(r.area)}</div>
        </div>
      ))}
    </div>
  );
}

export function RoomLabelTracker({ els }: { els: LabelEls }) {
  const rooms = useDerivedRooms();
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const r of rooms) {
      const el = els.current.get(r.id);
      if (!el) continue;
      v.set(r.labelPoint.x, LABEL_Y, r.labelPoint.y).project(camera);
      const shown = v.z < 1 && Math.abs(v.x) <= OFF_PANE && Math.abs(v.y) <= OFF_PANE;
      el.style.visibility = shown ? "visible" : "hidden";
      if (shown) el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) translate(-50%, -50%)`;
    }
  });
  return null;
}
