"use client";

/*
 * src/app/studio/import/PlanViewer.tsx — the results view of the import
 * screen (page.tsx): the deskewed image the analysis worked on
 * (analysis.pixels) with an SVG overlay drawn in the same pixel space, so it
 * lines up whatever imageScale or straightening angle the analysis applied.
 *
 * Overlay layers, each with a toggle: walls (cyanotype, at their detected
 * thickness), windows (green) and doors (blue) as short bars across their
 * gap, free wall ends (orange dots). Wheel zooms toward the cursor, dragging
 * pans, and +, − and Fit do the same for touch and keyboard users.
 *
 * For a vector PDF (step M.1b) a "traced walls" layer marks, in gilt dashes, the
 * walls the coverage report says were traced rather than read from the PDF, and
 * (step M.1c) two more mark the openings to check: traced openings in gilt and
 * unclassified ones (nothing drawn in the gap, assumed doors) in orange, each a
 * dashed box around the gap. Step Q.2 adds "Detached groups": walls joined to nothing in the
 * building and lying outside it (walls.ts rule 7b), each outlined with its size, orange when it was
 * left out (a title block) and gilt when it was kept (a separate building).
 *
 * Step R.3: when the build holds only PDF-read walls and openings (`exactOpenings`, from
 * pdf/overlay.ts), the door and window bars are the plan's own openings (jambs, wall thickness), not
 * the tracing's guesses; otherwise they are the traced openings, as before.
 *
 * Picking: while `picking` is on, a click (a press that hardly moves) reports
 * the image pixel under it through onPick; ScalePanel.tsx uses this to set
 * the scale from two points, drawn here with the line between them.
 *
 * Read-only: editing walls on this screen is a later piece (piece B).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Analysis } from "@/lib/blueprint/analyse";
import type { OpeningBar } from "@/lib/pdf/overlay";
import type { Vec2 } from "@/types/plan";

type Layer = "walls" | "doors" | "windows" | "ends" | "traced" | "tracedOpenings" | "unclassified" | "gaps" | "detached";
/** A wall or an opening's gap (jambs on the centre line) in image pixels, for the PDF layers. */
type Mark = { id: string; a: Vec2; b: Vec2; thickness: number };
/** Step Q.2: a detached group's footprint in image pixels (corners min and max), its label and whether it was left out. */
type Outline = { id: string; min: Vec2; max: Vec2; label: string; dropped: boolean };
const MIN_K = 0.02;
const MAX_K = 40;
const CLICK_PX = 5; // a press that moves less than this is a click, not a pan
const STEP = 1.4; // zoom factor of the + and − buttons
const TOOLBAR_PX = 60; // height of the zoom buttons' strip, left clear by Fit
const MARGIN_PX = 12;

interface View {
  k: number; // screen px per image px
  x: number; // screen position of image (0, 0)
  y: number;
}

/** The image as an object URL, made once per analysis. */
function useImageUrl(analysis: Analysis): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const { width, height, rgba } = analysis.pixels;
    let made: string | null = null;
    let live = true;
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.length), width, height), 0, 0);
    canvas.convertToBlob().then((blob) => {
      if (!live) return;
      made = URL.createObjectURL(blob);
      setUrl(made);
    });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [analysis]);
  return url;
}

export function PlanViewer({
  analysis,
  picking,
  points,
  onPick,
  traced,
  openingMarks,
  detached,
  exactOpenings,
}: {
  analysis: Analysis;
  picking: boolean;
  points: Vec2[];
  onPick: (p: Vec2) => void;
  /** Walls traced rather than read from the PDF, in image pixels (step M.1b). */
  traced?: Mark[];
  /** Openings to check, in image pixels (step M.1c): traced, and read from the PDF but unclassified.
   *  Step M.1d adds `gaps`: collinear gaps outside 0.45–4 m, not read as openings at all. */
  openingMarks?: { traced: Mark[]; unclassified: Mark[]; gaps: Mark[] };
  /** Step Q.2: detached groups (walls.ts rule 7b), outlined with their sizes. */
  detached?: Outline[];
  /** Step R.3: the built plan's openings in image pixels, drawn instead of `analysis.openings`. */
  exactOpenings?: { bars: OpeningBar[]; pxPerM: number };
}) {
  const { width: W, height: H } = analysis.pixels;
  const url = useImageUrl(analysis);
  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
  const [show, setShow] = useState<Record<Layer, boolean>>({ walls: true, doors: true, windows: true, ends: true, traced: true, tracedOpenings: true, unclassified: true, gaps: true, detached: true });
  const touched = useRef(false); // once the user zooms or pans, resizing no longer refits

  const fit = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    const { clientWidth: cw, clientHeight: ch } = box;
    const top = TOOLBAR_PX; // keep the image clear of the zoom buttons
    const k = Math.min((cw - 2 * MARGIN_PX) / W, (ch - top - MARGIN_PX) / H);
    setView({ k, x: (cw - W * k) / 2, y: top + (ch - top - H * k) / 2 });
  }, [W, H]);

  useEffect(() => {
    touched.current = false;
    fit();
    const ro = new ResizeObserver(() => !touched.current && fit());
    if (boxRef.current) ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, [fit]);

  /** Zoom by `f` keeping screen point (sx, sy) fixed. */
  const zoomAt = useCallback((f: number, sx: number, sy: number) => {
    touched.current = true;
    setView((v) => {
      const k = Math.min(MAX_K, Math.max(MIN_K, v.k * f));
      return { k, x: sx - ((sx - v.x) * k) / v.k, y: sy - ((sy - v.y) * k) / v.k };
    });
  }, []);
  const zoomCentre = (f: number) => {
    const box = boxRef.current;
    if (box) zoomAt(f, box.clientWidth / 2, box.clientHeight / 2);
  };

  // React's onWheel is passive, so the page would scroll too; listen directly.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const drag = useRef<{ id: number; sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (drag.current) return; // one pointer pans; a second finger is ignored
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < CLICK_PX) return;
    d.moved = true;
    touched.current = true;
    setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.moved || !picking) return;
    const r = svgRef.current!.getBoundingClientRect();
    onPick({ x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k });
  };

  // Bars to draw: the plan's own openings when given (R.3), else the tracing's; both as a line a→b with a stroke.
  const bars = useMemo(
    () => (exactOpenings ? exactOpenings.bars.map((o) => ({ ...o, stroke: o.thickness })) : analysis.openings.map((o, i) => ({ id: `t${i}`, wallId: "", kind: o.kind, a: o.a, b: o.b, stroke: o.wallThicknessPx * 1.2 }))),
    [analysis, exactOpenings],
  );
  const doors = useMemo(() => bars.filter((o) => o.kind === "door"), [bars]);
  const windows = useMemo(() => bars.filter((o) => o.kind === "window"), [bars]);
  const px = 1 / view.k; // one screen pixel, in image pixels: keeps dots and the measure line a fixed size on screen

  const layers: { id: Layer; label: string; count: number; swatch: string; hint?: string }[] = [
    { id: "walls", label: "wall pieces found", hint: "Raw pieces, split at every door and window. They are joined into fewer walls when the model is built.", count: analysis.walls.length, swatch: "bg-cyanotype" },
    { id: "doors", label: "Doors", count: doors.length, swatch: "bg-overlay-door" },
    { id: "windows", label: "Windows", count: windows.length, swatch: "bg-overlay-window" },
    { id: "ends", label: "Free ends", count: analysis.unpaired.length, swatch: "bg-overlay-end" },
    ...(traced ? [{ id: "traced" as const, label: "Traced walls", count: traced.length, swatch: "bg-gilt", hint: "Walls not read from the PDF's lines: traced from the picture, about a pixel out." }] : []),
    ...(openingMarks
      ? [
          { id: "tracedOpenings" as const, label: "Traced openings", count: openingMarks.traced.length, swatch: "bg-gilt", hint: "Doors and windows not read from the PDF's lines: traced from the picture, about a pixel out." },
          { id: "unclassified" as const, label: "Unclassified openings", count: openingMarks.unclassified.length, swatch: "bg-overlay-end", hint: "Gaps with no swing, glazing or panels drawn in them: kept as doors. Check them." },
          { id: "gaps" as const, label: "Gaps not read", count: openingMarks.gaps.length, swatch: "bg-overlay-door", hint: "Gaps in the PDF's lines too narrow or too wide to be a door or window (a narrow one is closed as wall, a wide one leaves the wall open), and openings a wall ends inside, which are not read." },
        ]
      : []),
    ...(detached?.length
      ? [{ id: "detached" as const, label: "Detached groups", count: detached.length, swatch: "bg-overlay-end", hint: "Walls joined to nothing in the building and lying outside it: a title block is left out, anything else is kept as a separate building." }]
      : []),
  ];
  /** A dashed box round an opening's gap. */
  const box = (m: Mark, kind: string) => (
    <line key={m.id} data-opening-mark={kind} data-id={m.id} x1={m.a.x} y1={m.a.y} x2={m.b.x} y2={m.b.y} strokeWidth={Math.max(m.thickness * 2.4, 8 * px)} strokeDasharray={`${8 * px} ${5 * px}`} strokeOpacity={0.55} />
  );
  const bar = (o: (typeof bars)[number], kind: string) => (
    <line key={o.id} data-kind={kind} data-opening-id={exactOpenings ? o.id : undefined} data-wall-id={exactOpenings ? o.wallId : undefined} x1={o.a.x} y1={o.a.y} x2={o.b.x} y2={o.b.y} strokeWidth={o.stroke} strokeLinecap="butt" />
  );

  return (
    <div className="flex flex-col gap-2">
      <div ref={boxRef} data-lenis-prevent className="relative h-[55svh] min-h-72 w-full overflow-hidden rounded border border-stone bg-vellum lg:h-[calc(100svh-11rem)]">
        <svg
          ref={svgRef}
          data-testid="plan-viewer"
          role="img"
          aria-label={`Your plan with ${analysis.walls.length} walls, ${doors.length} doors and ${windows.length} windows found`}
          className={`absolute inset-0 h-full w-full touch-none select-none ${picking ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => (drag.current = null)}
        >
          <g data-testid="plan-content" data-px-per-m={exactOpenings?.pxPerM} data-openings-from={exactOpenings ? "plan" : "tracing"} transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {url && <image href={url} width={W} height={H} style={{ imageRendering: view.k > 2 ? "pixelated" : "auto" }} />}
            {show.walls && (
              <g data-layer="walls" className="stroke-cyanotype" strokeOpacity={0.55} strokeLinecap="square">
                {analysis.walls.map((w, i) => (
                  <line key={i} data-wall x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} strokeWidth={w.thickness} />
                ))}
              </g>
            )}
            {show.doors && <g data-layer="doors" className="stroke-overlay-door">{doors.map((o) => bar(o, "door"))}</g>}
            {show.windows && <g data-layer="windows" className="stroke-overlay-window">{windows.map((o) => bar(o, "window"))}</g>}
            {show.ends && (
              <g data-layer="ends" className="fill-overlay-end stroke-vellum" strokeWidth={1.5 * px}>
                {analysis.unpaired.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={6 * px} />
                ))}
              </g>
            )}
            {traced && show.traced && (
              <g data-layer="traced" className="stroke-gilt" strokeOpacity={0.85} strokeLinecap="butt" fill="none">
                {traced.map((w) => (
                  <line key={w.id} data-traced={w.id} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} strokeWidth={Math.max(w.thickness * 1.6, 6 * px)} strokeDasharray={`${12 * px} ${6 * px}`} />
                ))}
              </g>
            )}
            {openingMarks && show.tracedOpenings && (
              <g data-layer="traced-openings" className="stroke-gilt" strokeLinecap="butt" fill="none">
                {openingMarks.traced.map((m) => box(m, "traced"))}
              </g>
            )}
            {openingMarks && show.unclassified && (
              <g data-layer="unclassified-openings" className="stroke-overlay-end" strokeLinecap="butt" fill="none">
                {openingMarks.unclassified.map((m) => box(m, "unclassified"))}
              </g>
            )}
            {/* Step M.1d: gaps the PDF drew that are outside the opening range, so nothing was read there. */}
            {openingMarks && show.gaps && (
              <g data-layer="gaps-not-read" className="stroke-overlay-door" strokeLinecap="butt" fill="none">
                {openingMarks.gaps.map((m) => box(m, "gap"))}
              </g>
            )}
            {/* Step Q.2: detached groups, outlined with their size; orange when left out, gilt when kept. */}
            {detached && show.detached && (
              <g data-layer="detached" fill="none">
                {detached.map((d) => (
                  <g key={d.id} data-detached={d.id} data-dropped={d.dropped} className={d.dropped ? "stroke-overlay-end fill-overlay-end" : "stroke-gilt fill-gilt"}>
                    <rect x={d.min.x} y={d.min.y} width={d.max.x - d.min.x} height={d.max.y - d.min.y} fill="none" strokeWidth={2.5 * px} strokeDasharray={`${10 * px} ${6 * px}`} />
                    <text x={d.min.x} y={d.min.y - 6 * px} fontSize={13 * px} stroke="none">
                      {d.label}
                    </text>
                  </g>
                ))}
              </g>
            )}
            {points.length > 0 && (
              <g data-layer="measure" className="fill-gilt stroke-gilt">
                {points.length === 2 && <line x1={points[0].x} y1={points[0].y} x2={points[1].x} y2={points[1].y} strokeWidth={2.5 * px} />}
                {points.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={6 * px} className="stroke-vellum" strokeWidth={2 * px} />
                ))}
              </g>
            )}
          </g>
        </svg>

        <div className="absolute right-2 top-2 flex gap-1">
          {[
            { label: "Zoom in", text: "+", act: () => zoomCentre(STEP) },
            { label: "Zoom out", text: "−", act: () => zoomCentre(1 / STEP) },
          ].map((b) => (
            <button key={b.label} type="button" aria-label={b.label} onClick={b.act} className="h-11 w-11 rounded border border-stone bg-vellum text-lg text-iron hover:bg-limestone">
              {b.text}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              touched.current = false;
              fit();
            }}
            className="h-11 rounded border border-stone bg-vellum px-3 text-sm text-iron hover:bg-limestone"
          >
            Fit
          </button>
        </div>
        {picking && (
          <p className="pointer-events-none absolute bottom-2 left-2 right-2 rounded bg-cyanotype/90 px-3 py-1.5 text-sm text-vellum">
            {points.length < 2 ? `Click ${points.length === 0 ? "the first" : "the second"} end of a length you know.` : "Both points set. Type the length in the panel."}
          </p>
        )}
      </div>

      <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-smoke">
        <legend className="sr-only">Show on the plan</legend>
        {layers.map((l) => (
          <label key={l.id} className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={show[l.id]} onChange={(e) => setShow((s) => ({ ...s, [l.id]: e.target.checked }))} className="h-4 w-4 accent-cyanotype" />
            <span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-full ${l.swatch}`} />
            <span className="text-iron" title={l.hint}>
              {l.id === "walls" ? (
                <>
                  <span data-testid="count-walls">{l.count}</span> {l.label}
                </>
              ) : (
                l.label
              )}
            </span>
            {l.id !== "walls" && <span data-testid={`count-${l.id}`}>{l.count}</span>}
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-smoke">Wall pieces are merged across doors and windows when the model is built, so the final wall count is lower.</p>
    </div>
  );
}
