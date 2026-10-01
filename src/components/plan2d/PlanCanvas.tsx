"use client";

/*
 * src/components/plan2d/PlanCanvas.tsx — the 2D plan, a derived view of the Plan
 * in usePlanStore (display only; selecting and editing come later). An SVG
 * drawn in screen space: every point goes through the View camera
 * (src/lib/plan2d/view.ts), so text and line widths stay a constant pixel size
 * at any zoom. Draw order: room floors, metre grid, walls (mitred outlines),
 * opening gaps, door and window symbols, room labels, scale bar.
 * Wheel zooms to the cursor, drag pans, two fingers pinch and pan; with the
 * canvas focused + / - zoom, arrows pan, 0 fits. Pan/zoom lives here, not in
 * the store. Nothing animates, so prefers-reduced-motion needs no special case.
 * Mounted by src/app/studio/page.tsx (2D view and the 2D half of Split).
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { formatArea, type Unit } from "@/components/studio/PlanPanel";
import { floorColor } from "@/data/materials";
import { wallOutline } from "@/lib/plan/geometry";
import { doorSwing, openingFrame } from "@/lib/plan2d/openings";
import { fitView, niceScaleBar, screenToWorld, worldToScreen, zoomAt, type Bounds, type View } from "@/lib/plan2d/view";
import { useDerivedRooms, usePlanStore } from "@/store/planStore";
import type { Vec2, Wall } from "@/types/plan";

const NAME_PX = 15; // text-sm
const AREA_PX = 13; // text-xs
const GLYPH = 0.55; // average glyph width / font size, to guess a label's width
const GRID_MIN_PX = 8; // grid lines closer than this are hidden; they fade in over the next 8 px
const GAP_OVERSHOOT_PX = 1.2; // the gap paint pokes past the wall edges so no hairline of wall shows
const KEY_PAN_PX = 40;
const KEY_ZOOM = 1.25;

const pts = (ps: Vec2[]) => ps.map((p) => `${p.x},${p.y}`).join(" ");
const add = (p: Vec2, d: Vec2, k: number): Vec2 => ({ x: p.x + d.x * k, y: p.y + d.y * k });

/** The walls' outlines (mitred, so thickness counts) and their bounding box. */
function outlinesOf(walls: Wall[]) {
  const outlines = new Map<string, Vec2[]>();
  const b: Bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const w of walls) {
    const o = wallOutline(w, walls);
    if (o.length === 0) continue; // zero-length wall
    outlines.set(w.id, o);
    for (const p of o) {
      b.x0 = Math.min(b.x0, p.x);
      b.y0 = Math.min(b.y0, p.y);
      b.x1 = Math.max(b.x1, p.x);
      b.y1 = Math.max(b.y1, p.y);
    }
  }
  return { outlines, bounds: outlines.size > 0 ? b : { x0: 0, y0: 0, x1: 10, y1: 10 } };
}

export function PlanCanvas({ unit }: { unit: Unit }) {
  const plan = usePlanStore((s) => s.plan);
  const rooms = useDerivedRooms();
  const { outlines } = useMemo(() => outlinesOf(plan.walls), [plan.walls]);

  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const root = useRef<HTMLDivElement>(null);
  const userMoved = useRef(false); // once true, resizing no longer refits (same rule as the 3D FitCamera)
  const pointers = useRef(new Map<number, Vec2>()); // active touches / mouse, in canvas pixels

  // Bounds are read at fit time from the store, so plan edits never move the camera by themselves.
  const fit = (s: { width: number; height: number }) => fitView(outlinesOf(usePlanStore.getState().plan.walls).bounds, s);

  useEffect(() => {
    const el = root.current!;
    const measure = () => {
      const s = { width: el.clientWidth, height: el.clientHeight };
      setSize(s);
      if (!userMoved.current && s.width > 0 && s.height > 0) setView(fit(s));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  // Wheel needs a non-passive listener: React's onWheel is passive and cannot preventDefault.
  useEffect(() => {
    const el = root.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const cursor = { x: e.clientX - r.left, y: e.clientY - r.top };
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; // lines → pixels
      userMoved.current = true;
      setView((v) => zoomAt(v, cursor, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)))); // ctrl+wheel is a trackpad pinch: bigger steps
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const change = (next: (v: View) => View) => {
    userMoved.current = true;
    setView(next);
  };
  const refit = () => {
    userMoved.current = false; // pressing Fit puts auto-fit back on
    setView(fit(size));
  };
  const zoomBy = (factor: number) => change((v) => zoomAt(v, { x: size.width / 2, y: size.height / 2 }, factor));

  // ---- pointers: one pans, two pinch-zoom and pan
  const local = (e: ReactPointerEvent): Vec2 => {
    const r = root.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button === 2) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const pos = local(e);
    if (pointers.current.size === 1) {
      change((v) => ({ ...v, tx: v.tx + pos.x - prev.x, ty: v.ty + pos.y - prev.y }));
    } else {
      const [p, q] = [...pointers.current.values()]; // the first two fingers
      const mid0 = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      const d0 = Math.hypot(p.x - q.x, p.y - q.y);
      pointers.current.set(e.pointerId, pos);
      const [p1, q1] = [...pointers.current.values()];
      const mid1 = { x: (p1.x + q1.x) / 2, y: (p1.y + q1.y) / 2 };
      const d1 = Math.hypot(p1.x - q1.x, p1.y - q1.y);
      // Zoom about the old midpoint, then slide by how far the midpoint moved.
      change((v) => {
        const z = d0 > 0 ? zoomAt(v, mid0, d1 / d0) : v;
        return { ...z, tx: z.tx + mid1.x - mid0.x, ty: z.ty + mid1.y - mid0.y };
      });
    }
    pointers.current.set(e.pointerId, pos);
  };
  const onPointerEnd = (e: ReactPointerEvent<SVGSVGElement>) => void pointers.current.delete(e.pointerId);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey) return; // only when the canvas itself has focus
    const pan = (dx: number, dy: number) => change((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
    const actions: Record<string, () => void> = {
      "+": () => zoomBy(KEY_ZOOM),
      "=": () => zoomBy(KEY_ZOOM),
      "-": () => zoomBy(1 / KEY_ZOOM),
      "_": () => zoomBy(1 / KEY_ZOOM),
      "0": refit,
      ArrowLeft: () => pan(KEY_PAN_PX, 0), // arrows move the view, so the drawing slides the other way
      ArrowRight: () => pan(-KEY_PAN_PX, 0),
      ArrowUp: () => pan(0, KEY_PAN_PX),
      ArrowDown: () => pan(0, -KEY_PAN_PX),
    };
    const act = actions[e.key];
    if (!act) return;
    e.preventDefault();
    act();
  };

  // ---- drawing, in screen space
  const S = (p: Vec2) => worldToScreen(view, p);
  const visible = size.width > 0 && size.height > 0;

  const gridPath = useMemo(() => {
    if (!visible || view.scale < GRID_MIN_PX) return "";
    const tl = screenToWorld(view, { x: 0, y: 0 });
    const br = screenToWorld(view, { x: size.width, y: size.height });
    let d = "";
    for (let x = Math.floor(tl.x); x <= Math.ceil(br.x); x++) d += `M${x * view.scale + view.tx},0V${size.height}`;
    for (let y = Math.floor(tl.y); y <= Math.ceil(br.y); y++) d += `M0,${y * view.scale + view.ty}H${size.width}`;
    return d;
  }, [visible, view, size]);
  const gridOpacity = Math.min(1, (view.scale - GRID_MIN_PX) / GRID_MIN_PX);

  const barMetres = niceScaleBar(view.scale);
  const barPx = barMetres * view.scale;

  return (
    <div
      ref={root}
      tabIndex={0}
      role="group"
      aria-label="2D plan. Plus and minus zoom, arrow keys pan, 0 fits the plan."
      data-testid="plan-canvas"
      data-scale={view.scale.toFixed(4)}
      data-tx={view.tx.toFixed(2)}
      data-ty={view.ty.toFixed(2)}
      onKeyDown={onKeyDown}
      style={{ outlineOffset: -3 }} // inside the box, so the overflow clip doesn't cut the focus ring
      className="absolute inset-0 touch-none select-none overflow-hidden bg-limestone"
    >
      {visible && (
        <svg
          width={size.width}
          height={size.height}
          role="img"
          aria-label={`Floor plan with ${rooms.length} ${rooms.length === 1 ? "room" : "rooms"}`}
          data-testid="plan-svg"
          className="block cursor-grab touch-none active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          {/* room floors, tinted by the floor material */}
          {rooms.map((r) => (
            <polygon key={r.id} points={pts(r.polygon.map(S))} fill={floorColor(r.floorMaterial)} fillOpacity={0.4} data-testid="plan-floor" />
          ))}

          {gridPath && <path d={gridPath} className="stroke-stone" strokeWidth={1} opacity={gridOpacity * 0.7} fill="none" data-testid="plan-grid" />}

          {/* walls: mitred outlines; the thin stroke hides seams between neighbouring polygons */}
          {plan.walls.map((w) => {
            const o = outlines.get(w.id);
            return o && <polygon key={w.id} points={pts(o.map(S))} className="fill-iron stroke-iron" strokeWidth={0.75} data-testid="plan-wall" />;
          })}

          {/* opening gaps: the wall band between the opening's ends, painted in the ground colour */}
          {plan.openings.map((op) => {
            const wall = plan.walls.find((w) => w.id === op.wallId);
            if (!wall || outlines.get(wall.id) === undefined) return null;
            const f = openingFrame(wall, op);
            const [s, e] = [S(f.start), S(f.end)];
            const h = (wall.thickness / 2) * view.scale + GAP_OVERSHOOT_PX;
            return <polygon key={`gap-${op.id}`} points={pts([add(s, f.normal, h), add(e, f.normal, h), add(e, f.normal, -h), add(s, f.normal, -h)])} className="fill-limestone" data-testid="plan-gap" />;
          })}

          {/* door and window symbols */}
          {plan.openings.map((op) => {
            const wall = plan.walls.find((w) => w.id === op.wallId);
            if (!wall || outlines.get(wall.id) === undefined) return null;
            const f = openingFrame(wall, op);
            const [s, e] = [S(f.start), S(f.end)];
            if (op.kind === "door") {
              const sw = doorSwing(wall, op);
              const [hinge, leaf, arcEnd] = [S(sw.hinge), S(sw.leafEnd), S(sw.arcEnd)];
              const r = op.width * view.scale;
              // Quarter circle from the leaf tip to the closed position; the sweep flag follows the turn direction.
              const sweep = (leaf.x - hinge.x) * (arcEnd.y - hinge.y) - (leaf.y - hinge.y) * (arcEnd.x - hinge.x) > 0 ? 1 : 0;
              return (
                <g key={`door-${op.id}`} fill="none" className="stroke-iron" strokeWidth={1.2} data-testid="plan-door">
                  <line x1={hinge.x} y1={hinge.y} x2={leaf.x} y2={leaf.y} />
                  <path d={`M${leaf.x},${leaf.y}A${r},${r} 0 0 ${sweep} ${arcEnd.x},${arcEnd.y}`} strokeWidth={0.8} />
                </g>
              );
            }
            const h = (wall.thickness / 2) * view.scale; // frame lines sit on the wall's two faces
            const line = (k: number, cls: string, sw: number) => {
              const [p, q] = [add(s, f.normal, k), add(e, f.normal, k)];
              return <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} className={cls} strokeWidth={sw} />;
            };
            return (
              <g key={`win-${op.id}`} data-testid="plan-window">
                {line(h, "stroke-iron", 1.2)}
                {line(-h, "stroke-iron", 1.2)}
                {line(0, "stroke-cyanotype", 1)}
              </g>
            );
          })}

          {/* room labels: constant size, hidden when the room is too small on screen to hold them */}
          {rooms.map((r) => {
            const xs = r.polygon.map((p) => p.x);
            const ys = r.polygon.map((p) => p.y);
            const wPx = (Math.max(...xs) - Math.min(...xs)) * view.scale;
            const hPx = (Math.max(...ys) - Math.min(...ys)) * view.scale;
            const area = formatArea(r.area, unit);
            const textW = Math.max(r.name.length * NAME_PX, area.length * AREA_PX) * GLYPH;
            if (wPx < textW || hPx < NAME_PX + AREA_PX + 8) return null;
            const p = S(r.labelPoint);
            const halo = { paintOrder: "stroke", strokeWidth: 3, strokeLinejoin: "round" } as const;
            return (
              <g key={r.id} textAnchor="middle" data-testid="plan-room-label" className="font-sans">
                <text x={p.x} y={p.y - 2} className="fill-iron stroke-limestone text-sm" style={halo}>
                  {r.name}
                </text>
                <text x={p.x} y={p.y + AREA_PX + 2} className="fill-smoke stroke-limestone text-xs" style={halo}>
                  {area}
                </text>
              </g>
            );
          })}

          {/* scale bar, bottom left */}
          <g data-testid="plan-scalebar" className="font-sans" transform={`translate(16 ${size.height - 16})`}>
            <path d={`M0,-6V0H${barPx}V-6`} fill="none" className="stroke-iron" strokeWidth={1.5} />
            <text x={0} y={-10} className="fill-iron stroke-limestone text-xs" style={{ paintOrder: "stroke", strokeWidth: 3, strokeLinejoin: "round" }}>
              {`${+barMetres.toFixed(3)} m`}
            </text>
          </g>
        </svg>
      )}

      {/* Fit, +, − : a column at the top right, outside the plan's fitted area */}
      <div className="absolute right-2 top-2 flex flex-col gap-1">
        {[
          { id: "fit", label: "Fit plan to view", on: refit, glyph: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /> },
          { id: "zoom-in", label: "Zoom in", on: () => zoomBy(KEY_ZOOM), glyph: <path d="M12 5v14M5 12h14" /> },
          { id: "zoom-out", label: "Zoom out", on: () => zoomBy(1 / KEY_ZOOM), glyph: <path d="M5 12h14" /> },
        ].map((b) => (
          <button
            key={b.id}
            type="button"
            data-testid={`plan-${b.id}`}
            aria-label={b.label}
            title={b.label}
            onClick={b.on}
            className="grid size-10 place-items-center rounded border border-stone bg-vellum text-iron hover:bg-limestone"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {b.glyph}
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
