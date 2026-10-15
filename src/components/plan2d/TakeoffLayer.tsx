"use client";

/*
 * src/components/plan2d/TakeoffLayer.tsx — what the Takeoff tool (step M.2a) draws on the 2D
 * plan, and its mode bar. Nothing here is in 3D.
 *   - TakeoffOverlay (inside PlanCanvas's <svg>, screen space through the same camera): every
 *     takeoff in the plan while "Show takeoffs" is on, a length as a dashed line with end dots,
 *     an area with a light fill (its cutouts left clear) and each with its value; the selected
 *     one in gilt (the label text itself comes from the layout pass, see below). While the tool is active: the points placed so far, the line to where the next
 *     would land with the live running total and last segment (Length) or area and perimeter
 *     (Area), the snap marker, and in Wall mode the wall line under the pointer with its length,
 *     the room on that side and how many pieces the straight wall has.
 *   - TakeoffBar (over the canvas): Length | Area | Wall, the Left | Centre | Right toggle in
 *     Wall mode (the touch path: a finger can't aim at one face of a 10 cm wall), and Finish,
 *     Undo point and Cancel (the touch path for Enter, Backspace and Escape), plus "Add cutout"
 *     for a selected area.
 * The values are rounded once, here, in the units chosen in src/store/unitsStore.ts.
 * Step L.1: a takeoff's own label is not placed here. It comes from the layout pass
 * (src/lib/plan2d/labelLayout.ts, run by PlanCanvas) as a `DrawnLabel`, so two takeoffs
 * that print on the same spot are stacked or one is hidden and counted instead of overprinting.
 * The live labels (running total, snap word, wall-hover lines) follow the pointer and stay here.
 * TakeoffBar is no longer drawn over the plan: PlanCanvas docks it in a strip above the canvas.
 * Step P.1: TakeoffBar asks src/store/drawingSnapStore.ts for the drawing's snap index when the
 * tool first shows with a background, and says "Reading drawing for snapping…" while the worker
 * reads it (clicks meanwhile use the walls' snaps), "Drawing snapping needs a vector PDF" for an
 * image, a scanned page or a missing file, and the point cap's note when it applies. The snap
 * marker's word for the drawing's points is "corner", "end", "mid" or "edge".
 * Connects to: src/store/{takeoffStore,planStore,unitsStore}.ts, src/lib/takeoff/*,
 * src/lib/units/format.ts, src/lib/plan2d/labels.ts; mounted by src/components/plan2d/PlanCanvas.tsx.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { areaWithCutouts, perimeter, polylineLength, type Pt, type Side } from "@/lib/takeoff/geometry";
import { formatArea, formatLength } from "@/lib/units/format";
import { midway, type DrawnLabel } from "@/lib/plan2d/labels";
import { worldToScreen, type View } from "@/lib/plan2d/view";
import { LabelText } from "./LabelText";
import { keyOf, useDrawingSnapStore } from "@/store/drawingSnapStore";
import { usePlanStore } from "@/store/planStore";
import { useTakeoffStore, type TakeoffMode } from "@/store/takeoffStore";
import { useUnitsStore } from "@/store/unitsStore";
import type { Vec2 } from "@/types/plan";

const halo = { paintOrder: "stroke", strokeWidth: 3, strokeLinejoin: "round" } as const;
const GLYPH_PX = 6.6; // text-xs average glyph width, to keep a label inside the pane
const SNAP_WORDS: Record<string, string> = {
  corner: "face corner",
  endpoint: "wall end",
  jamb: "jamb",
  midpoint: "middle",
  grid: "grid",
  free: "",
  // step P.1: the drawing's own points
  "drawing-corner": "corner",
  "drawing-end": "end",
  "drawing-mid": "mid",
  "drawing-edge": "edge",
};

export function TakeoffOverlay({ view, active, size, labels }: { view: View; active: boolean; size: { width: number; height: number }; labels: Map<string, DrawnLabel> }) {
  const takeoffs = usePlanStore((s) => s.plan.takeoffs) ?? [];
  const { draft, hover, wallHover, selectedId, show, mode } = useTakeoffStore();
  const units = useUnitsStore();
  const S = ([x, y]: Pt): Vec2 => worldToScreen(view, { x, y });
  const path = (ps: Pt[], close = false) => ps.map((p, i) => `${i ? "L" : "M"}${S(p).x},${S(p).y}`).join("") + (close ? "Z" : "");
  const len = (m: number) => formatLength(m, units.length);
  const area = (m2: number) => formatArea(m2, units.area);
  /** A label beside a point, flipped to the point's left when it would run off the pane, and kept inside it. */
  const text = (at: Pt, s: string, testId?: string, dy = 0) => {
    const p = S(at);
    const flip = p.x + 8 + s.length * GLYPH_PX > size.width - 4;
    const x = flip ? Math.max(p.x - 8, s.length * GLYPH_PX + 4) : Math.max(p.x + 8, 4);
    return (
      <text x={x} y={Math.min(Math.max(p.y - 8 + dy, 16), size.height - 6)} textAnchor={flip ? "end" : "start"} className="fill-iron stroke-limestone text-xs" style={halo} data-testid={testId}>
        {s}
      </text>
    );
  };

  // the line being drawn, on to where the next point would land (a mouse hovers; a finger has no hover)
  const live = active && mode !== "wall" ? (hover && draft.length ? [...draft, hover.point] : draft) : [];
  const liveText = (() => {
    if (live.length < 2) return "";
    if (mode === "length") {
      const [p, q] = live.slice(-2);
      return `Total ${len(polylineLength(live).value!)} · last ${len(Math.hypot(q[0] - p[0], q[1] - p[1]))}`;
    }
    const a = live.length >= 3 ? areaWithCutouts(live) : null;
    return `${a?.ok ? `Area ${area(a.value)}` : a ? a.reason : "Area –"} · perimeter ${len(perimeter(live))}`;
  })();
  const wh = active && mode === "wall" ? wallHover : null;

  return (
    <g className="font-sans" data-testid="takeoff-overlay">
      {show &&
        takeoffs.map((t) => {
          const on = t.id === selectedId;
          const stroke = on ? "stroke-gilt" : "stroke-cyanotype";
          const label = labels.get(`takeoff:${t.id}`);
          if (t.kind === "length") {
            return (
              <g key={t.id} data-testid="takeoff-shape" data-takeoff={t.id} data-selected={on} pointerEvents="none">
                <path d={path(t.points)} fill="none" className="stroke-limestone" strokeWidth={5} />
                <path d={path(t.points)} fill="none" className={stroke} strokeWidth={on ? 2.5 : 1.5} strokeDasharray="6 4" />
                {[t.points[0], t.points[t.points.length - 1]].map((p, i) => (
                  <circle key={i} cx={S(p).x} cy={S(p).y} r={3.5} className={on ? "fill-gilt" : "fill-cyanotype"} />
                ))}
                {label && <LabelText label={label} className="fill-iron stroke-limestone" />}
              </g>
            );
          }
          const d = path(t.points, true) + (t.cutouts ?? []).map((c) => path(c, true)).join("");
          return (
            <g key={t.id} data-testid="takeoff-shape" data-takeoff={t.id} data-selected={on} pointerEvents="none">
              <path d={d} fillRule="evenodd" className={on ? "fill-gilt" : "fill-cyanotype"} fillOpacity={on ? 0.2 : 0.12} />
              <path d={d} fill="none" className={stroke} strokeWidth={on ? 2.5 : 1.5} strokeDasharray="6 4" />
              {label && <LabelText label={label} className="fill-iron stroke-limestone" />}
            </g>
          );
        })}

      {live.length > 0 && (
        <g data-testid="takeoff-draft" data-points={draft.length} pointerEvents="none">
          {mode === "area" && live.length >= 3 && <path d={path([live[live.length - 1], live[0]])} fill="none" className="stroke-gilt" strokeWidth={1} strokeDasharray="3 3" />}
          <path d={path(live)} fill="none" className="stroke-gilt" strokeWidth={2} />
          {draft.map((p, i) => (
            <circle key={i} cx={S(p).x} cy={S(p).y} r={i === 0 && mode === "area" ? 6 : 4} className="fill-gilt stroke-vellum" strokeWidth={1} />
          ))}
          {liveText && text(live[live.length - 1], liveText, "takeoff-live", 22)}
        </g>
      )}

      {active && mode !== "wall" && hover && (
        <g data-testid="takeoff-snap" data-snap={hover.kind} pointerEvents="none">
          <circle cx={S(hover.point).x} cy={S(hover.point).y} r={6} className="fill-none stroke-gilt" strokeWidth={2} />
          {SNAP_WORDS[hover.kind] && text(hover.point, SNAP_WORDS[hover.kind], "takeoff-snap-word")}
        </g>
      )}

      {wh && (
        <g data-testid="takeoff-wall-hover" data-wall={wh.wallId} data-side={wh.side} pointerEvents="none">
          <path d={path(wh.faces.lines[wh.side])} fill="none" className="stroke-gilt" strokeWidth={4} strokeLinecap="round" />
          {(() => {
            const at = midway(wh.faces.lines[wh.side]);
            const room = wh.side === "centre" ? [] : wh.faces.rooms[wh.side];
            const lines = [
              `${SIDE_WORD[wh.side]}: ${len(wh.faces[wh.side])}`,
              ...(room.length ? [`Room side: ${room.join(", ")}`] : []),
              ...(wh.faces.stepped ? ["stepped"] : wh.faces.pieces.length > 1 ? [`Wall of ${wh.faces.pieces.length} pieces`] : []),
            ];
            return <g data-testid="takeoff-wall-label">{lines.map((l, i) => <g key={i}>{text(at, l, undefined, 26 + i * 15)}</g>)}</g>;
          })()}
        </g>
      )}
    </g>
  );
}

const SIDE_WORD: Record<Side, string> = { left: "Left face", centre: "Centre line", right: "Right face" };
const MODES: { id: TakeoffMode; label: string }[] = [
  { id: "length", label: "Length" },
  { id: "area", label: "Area" },
  { id: "wall", label: "Wall" },
];

const btn = "min-h-10 rounded border border-stone bg-vellum px-3 text-xs text-iron shadow hover:bg-limestone";

/**
 * `onHeight` is told the bar's height in every commit of THIS component, which is when it changes (the bar
 * re-renders on its own store subscription, a commit PlanCanvas is not part of), so PlanCanvas can move the
 * camera by the same amount before the browser paints. See PlanCanvas.tsx, "strip".
 */
export function TakeoffBar({ onHeight }: { onHeight?: (height: number) => void }) {
  const { mode, draft, wallSide, cutoutFor, selectedId, message } = useTakeoffStore();
  const box = useRef<HTMLDivElement>(null);
  // No dependency list on purpose: any commit can change the bar's height (a mode, a draft, a hint that wraps).
  useLayoutEffect(() => {
    if (box.current) onHeight?.(box.current.offsetHeight);
  });
  const st = useTakeoffStore.getState();
  const selected = usePlanStore((s) => s.plan.takeoffs?.find((t) => t.id === selectedId));
  // Step P.1: the drawing's snap index, asked for when the tool first shows with this background.
  const background = usePlanStore((s) => s.plan.background);
  const drawingKey = background ? keyOf(background) : null;
  const snap = useDrawingSnapStore();
  useEffect(() => {
    useDrawingSnapStore.getState().ensure(usePlanStore.getState().plan.background);
  }, [drawingKey]);
  const hint =
    message ??
    (mode === "wall"
      ? wallSide
        ? `Click or tap a wall to measure its ${SIDE_WORD[wallSide].toLowerCase()}`
        : "Point at a wall's side or middle and click; Alt measures one piece"
      : cutoutFor
        ? draft.length === 0
          ? "Cutout: click its first corner"
          : "Cutout: click the first corner, Enter or Finish to close it"
        : mode === "length"
          ? draft.length === 0
            ? "Length: click the first point"
            : "Click to add a point; double-click, Enter or Finish ends it"
          : draft.length === 0
            ? "Area: click the first corner"
            : "Click the first corner, Enter or Finish to close it");
  return (
    <div ref={box} data-testid="takeoff-bar" className="flex flex-wrap items-center gap-2 border-b border-stone bg-limestone px-2 py-1.5">
      <div role="group" aria-label="Takeoff mode" className="flex rounded border border-stone bg-vellum p-0.5 text-xs shadow">
        {MODES.map((m) => (
          <button key={m.id} type="button" data-testid={`takeoff-mode-${m.id}`} aria-pressed={mode === m.id} onClick={() => st.setMode(m.id)} className={`min-h-9 rounded-sm px-2.5 ${mode === m.id ? "bg-cyanotype text-vellum" : "text-iron hover:bg-limestone"}`}>
            {m.label}
          </button>
        ))}
      </div>
      {mode === "wall" && (
        <div role="group" aria-label="Wall line" className="flex rounded border border-stone bg-vellum p-0.5 text-xs shadow">
          {(["left", "centre", "right"] as const).map((s) => (
            <button
              key={s}
              type="button"
              data-testid={`takeoff-side-${s}`}
              aria-pressed={wallSide === s}
              title={wallSide === s ? "Pressed: click again to follow the pointer" : undefined}
              onClick={() => st.setWallSide(wallSide === s ? null : s)}
              className={`min-h-9 rounded-sm px-2.5 ${wallSide === s ? "bg-cyanotype text-vellum" : "text-iron hover:bg-limestone"}`}
            >
              {s === "left" ? "Left" : s === "centre" ? "Centre" : "Right"}
            </button>
          ))}
        </div>
      )}
      {mode !== "wall" && draft.length > 0 && (
        <>
          <button type="button" data-testid="takeoff-finish" onClick={st.finish} className={btn}>
            Finish
          </button>
          <button type="button" data-testid="takeoff-undo-point" onClick={st.undoPoint} className={btn}>
            Undo point
          </button>
        </>
      )}
      {mode !== "wall" && (draft.length > 0 || cutoutFor) && (
        <button type="button" data-testid="takeoff-cancel" onClick={st.cancel} className={btn}>
          Cancel
        </button>
      )}
      {selected?.kind === "area" && !cutoutFor && draft.length === 0 && (
        <button type="button" data-testid="takeoff-add-cutout" onClick={() => st.startCutout(selected.id)} className={btn}>
          Add cutout to {selected.name}
        </button>
      )}
      <p role="status" data-testid="takeoff-hint" className="rounded border border-stone bg-vellum px-2 py-1 text-xs text-iron shadow">
        {hint}
      </p>
      <p
        role="status"
        data-testid="takeoff-drawing-snap"
        data-status={snap.status}
        data-points={snap.index ? snap.index.xs.length : undefined}
        hidden={!snap.note}
        className="rounded border border-stone bg-vellum px-2 py-1 text-xs text-smoke shadow"
      >
        {snap.note}
      </p>
    </div>
  );
}
