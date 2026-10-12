"use client";

/*
 * src/components/plan2d/TakeoffLayer.tsx — what the Takeoff tool (step M.2a) draws on the 2D
 * plan, and its mode bar. Nothing here is in 3D.
 *   - TakeoffOverlay (inside PlanCanvas's <svg>, screen space through the same camera): every
 *     takeoff in the plan while "Show takeoffs" is on, a length as a dashed line with end dots,
 *     an area with a light fill (its cutouts left clear) and each with its value; the selected
 *     one in gilt. While the tool is active: the points placed so far, the line to where the next
 *     would land with the live running total and last segment (Length) or area and perimeter
 *     (Area), the snap marker, and in Wall mode the wall line under the pointer with its length,
 *     the room on that side and how many pieces the straight wall has.
 *   - TakeoffBar (over the canvas): Length | Area | Wall, the Left | Centre | Right toggle in
 *     Wall mode (the touch path: a finger can't aim at one face of a 10 cm wall), and Finish,
 *     Undo point and Cancel (the touch path for Enter, Backspace and Escape), plus "Add cutout"
 *     for a selected area.
 * The values are rounded once, here, in the units chosen in src/store/unitsStore.ts.
 * Connects to: src/store/{takeoffStore,planStore,unitsStore}.ts, src/lib/takeoff/*,
 * src/lib/units/format.ts; mounted by src/components/plan2d/PlanCanvas.tsx.
 */
import { pointInPolygon, polylabel } from "@/lib/plan/rooms";
import { areaWithCutouts, perimeter, polylineLength, type Pt, type Side } from "@/lib/takeoff/geometry";
import { formatArea, formatLength } from "@/lib/units/format";
import { worldToScreen, type View } from "@/lib/plan2d/view";
import { usePlanStore } from "@/store/planStore";
import { useTakeoffStore, type TakeoffMode } from "@/store/takeoffStore";
import { useUnitsStore } from "@/store/unitsStore";
import type { Takeoff, Vec2 } from "@/types/plan";

const halo = { paintOrder: "stroke", strokeWidth: 3, strokeLinejoin: "round" } as const;
const GLYPH_PX = 6.6; // text-xs average glyph width, to keep a label inside the pane
const SNAP_WORDS: Record<string, string> = { corner: "face corner", endpoint: "wall end", jamb: "jamb", midpoint: "middle", grid: "grid", free: "" };

/** The point halfway along a polyline, for its label. */
function midway(points: Pt[]): Pt {
  const total = polylineLength(points).value ?? 0;
  let left = total / 2;
  for (let i = 1; i < points.length; i++) {
    const [p, q] = [points[i - 1], points[i]];
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (l >= left && l > 0) return [p[0] + ((q[0] - p[0]) * left) / l, p[1] + ((q[1] - p[1]) * left) / l];
    left -= l;
  }
  return points[0];
}

/** A label inside an area that is not inside a cutout: the outline's pole of inaccessibility, else its first corner. */
function areaLabelAt(t: Takeoff): Pt {
  const v = polylabel(t.points.map(([x, y]) => ({ x, y })));
  const inCut = (t.cutouts ?? []).some((c) => pointInPolygon(v, c.map(([x, y]) => ({ x, y }))));
  return inCut ? t.points[0] : [v.x, v.y];
}

export function TakeoffOverlay({ view, active, size }: { view: View; active: boolean; size: { width: number; height: number } }) {
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
          if (t.kind === "length") {
            const m = polylineLength(t.points);
            return (
              <g key={t.id} data-testid="takeoff-shape" data-takeoff={t.id} data-selected={on} pointerEvents="none">
                <path d={path(t.points)} fill="none" className="stroke-limestone" strokeWidth={5} />
                <path d={path(t.points)} fill="none" className={stroke} strokeWidth={on ? 2.5 : 1.5} strokeDasharray="6 4" />
                {[t.points[0], t.points[t.points.length - 1]].map((p, i) => (
                  <circle key={i} cx={S(p).x} cy={S(p).y} r={3.5} className={on ? "fill-gilt" : "fill-cyanotype"} />
                ))}
                {m.ok && text(midway(t.points), `${t.name}: ${len(m.value)}`)}
              </g>
            );
          }
          const a = areaWithCutouts(t.points, t.cutouts);
          const d = path(t.points, true) + (t.cutouts ?? []).map((c) => path(c, true)).join("");
          return (
            <g key={t.id} data-testid="takeoff-shape" data-takeoff={t.id} data-selected={on} pointerEvents="none">
              <path d={d} fillRule="evenodd" className={on ? "fill-gilt" : "fill-cyanotype"} fillOpacity={on ? 0.2 : 0.12} />
              <path d={d} fill="none" className={stroke} strokeWidth={on ? 2.5 : 1.5} strokeDasharray="6 4" />
              {a.ok && text(areaLabelAt(t), `${t.name}: ${area(a.value)}`)}
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
          {SNAP_WORDS[hover.kind] && text(hover.point, SNAP_WORDS[hover.kind])}
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

export function TakeoffBar() {
  const { mode, draft, wallSide, cutoutFor, selectedId, message } = useTakeoffStore();
  const st = useTakeoffStore.getState();
  const selected = usePlanStore((s) => s.plan.takeoffs?.find((t) => t.id === selectedId));
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
    <div data-testid="takeoff-bar" className="absolute left-2 right-14 top-2 flex flex-wrap items-center gap-2">
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
    </div>
  );
}
