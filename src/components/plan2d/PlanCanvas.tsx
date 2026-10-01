"use client";

/*
 * src/components/plan2d/PlanCanvas.tsx — the 2D plan, a derived view of the Plan
 * in usePlanStore. An SVG drawn in screen space: every point goes through the
 * View camera (src/lib/plan2d/view.ts), so text and line widths stay a constant
 * pixel size at any zoom. Draw order: room floors, metre grid, walls (mitred
 * outlines), opening gaps, door and window symbols, hover and selection
 * highlights, room labels, drag read-out, scale bar.
 *
 * Camera: wheel zooms to the cursor, dragging empty space pans, two fingers
 * pinch and pan; with the canvas focused + / - zoom, 0 fits, and the arrows pan
 * while NO wall is selected.
 *
 * Select tool (src/store/selectionStore.ts holds the selection, which is not
 * undoable): click a wall to select it, click empty space or press Escape to
 * clear, Delete removes it. Drag an end handle to move that joint and every wall
 * joined there; drag the body to slide the whole straight wall sideways, every
 * piece it was split into at its T-junctions keeping its direction (the run is
 * outlined in a lighter gilt so you can see what will move). With a wall
 * selected the arrows nudge it instead of panning, and
 * presses within 400 ms fold into one undo step. The maths is pure, in
 * src/lib/plan/edit.ts; this file only turns pointers into metres and calls the
 * store. Each drag is one undo step: see planStore.rollback for how.
 *
 * Wall tool (src/store/toolStore.ts): click to start, click again to add a
 * wall, and keep clicking to add joined walls; Escape, double-click, Enter or
 * the Finish button ends the chain, and so does a click that lands on a wall
 * already in the plan (closing a room). A tap does the same on a phone; a drag
 * still pans. Each wall is added with planStore.drawWall, one undo step each;
 * the preview (outline, snap marker, 45°/90° guide, live length) is local state
 * and never touches the store, so a cancelled wall leaves no history. Points
 * land through edit.snapDraw; edit.drawProblem says why a wall isn't allowed.
 * With a wall started, typing a length (3.5, 350 cm, 11' 6") and Enter adds a
 * wall exactly that long towards the pointer.
 *
 * Doors and windows (step 4.5): with the Select tool, every press goes through
 * edit.pickTarget: a wall end handle, else a door or window (its stretch of
 * wall, or a door's swing grown by the pick tolerance so the drawn leaf and arc
 * are clickable from either side), else a wall body, else nothing. Picking is
 * geometry on the pointer's plan coordinates, done on the <svg> itself, so the
 * stacking order of the shapes never decides what a click hits. A click on an
 * opening selects THAT opening instead of the wall behind it, and dragging it slides it along its
 * wall (edit.slideOpening: it stops at the wall's usable ends and at its
 * neighbours, one undo step per drag); Delete removes it. The selected opening
 * is outlined in cyanotype, so it never reads as a selected wall (gilt). The
 * Door and Window tools preview a default-size opening on the wall under the
 * pointer (edit.snapOpening + edit.placeOpening) with its width, and a click or
 * tap places it (planStore.placeOpening, one undo step); a spot where it can't
 * go shows the reason instead. Escape goes back to Select.
 *
 * Pan/zoom lives here, not in the store. Nothing animates, so
 * prefers-reduced-motion needs no special case.
 * Mounted by src/app/studio/page.tsx (2D view and the 2D half of Split).
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { formatArea, formatLength, type Unit } from "@/components/studio/PlanPanel";
import { floorColor } from "@/data/materials";
import { parseTypedLength } from "@/app/studio/import/importFile";
import {
  DRAW_THICKNESS,
  dragEndpoint,
  dragWallBody,
  drawDefaults,
  drawProblem,
  HANDLE_TOL_PX,
  OPENING_DEFAULTS,
  OPENING_STEP,
  pickTarget,
  placeOpening as planOpening,
  slideOpening,
  snapOpening,
  type OpeningSnap,
  HANDLE_TOL_TOUCH_PX,
  landsOnPlan,
  newProblems,
  normalComponent,
  NUDGE_M,
  NUDGE_MERGE_MS,
  NUDGE_SHIFT_M,
  PICK_TOL_PX,
  roundPoint,
  roundTo,
  snapDrag,
  snapDraw,
  snapRadius,
  typedTarget,
  type Snap,
} from "@/lib/plan/edit";
import { dist, JOINT_EPS, wallLength, wallOutline } from "@/lib/plan/geometry";
import { validatePlan } from "@/lib/plan/validate";
import { doorSwing, openingFrame } from "@/lib/plan2d/openings";
import { fitView, niceScaleBar, screenToWorld, worldToScreen, zoomAt, type Bounds, type View } from "@/lib/plan2d/view";
import { useDerivedRooms, usePlanStore } from "@/store/planStore";
import { useSelectedRun, useSelectionStore } from "@/store/selectionStore";
import { useToolStore } from "@/store/toolStore";
import type { Opening, OpeningKind, Vec2, Wall } from "@/types/plan";

const NAME_PX = 15; // text-sm
const AREA_PX = 13; // text-xs
const GLYPH = 0.55; // average glyph width / font size, to guess a label's width
const GRID_MIN_PX = 8; // grid lines closer than this are hidden; they fade in over the next 8 px
const GAP_OVERSHOOT_PX = 1.2; // the gap paint pokes past the wall edges so no hairline of wall shows
const KEY_PAN_PX = 40;
const KEY_ZOOM = 1.25;
const HANDLE_PX = 9; // side of a selected wall's end handles
const CLICK_SLOP_PX = 3; // a press that moves less than this is a click, not a pan

const pts = (ps: Vec2[]) => ps.map((p) => `${p.x},${p.y}`).join(" ");
const add = (p: Vec2, d: Vec2, k: number): Vec2 => ({ x: p.x + d.x * k, y: p.y + d.y * k });

const SNAP_WORDS: Record<string, string> = { endpoint: "corner", midpoint: "middle", wall: "on wall", angle: "angle", grid: "grid" };
const TYPED_KEY = /^[0-9.,'" cmfitn]$/i; // what a typed length can be made of: 3.5, 350 cm, 11' 6", 12 ft
const GUIDE_PX = 4000; // the 45°/90° guide runs this far each way: off any screen

/** A wall chain being drawn: where the next wall starts, how many walls it has
 *  added, and the plan's problems before it began (for the warnings at the end). */
interface Chain {
  last: Vec2;
  count: number;
  baseline: string[];
}

/** What a pointer is doing: nothing, panning the camera, or editing a wall. */
type Drag =
  /** `multi` once a second finger joined: lifting after a pinch is not a click. */
  | { kind: "pan"; from: Vec2; moved: number; multi?: boolean }
  /** `joint` and `other` are the dragged end and the far end as they were when the
   *  drag started, and `walls` the plan it started from: snap targets must not
   *  drift under the cursor as the preview moves. */
  | { kind: "endpoint"; wallId: string; end: "a" | "b"; joint: Vec2; other: Vec2; walls: Wall[]; baseline: string[] }
  | { kind: "body"; wallId: string; from: Vec2; wall: Wall; baseline: string[] }
  /** Sliding an opening: `grab` keeps the pointer where it took hold of it. */
  | { kind: "opening"; id: string; wall: Wall; grab: number; baseline: string[] };

/** Distance of `p` along `wall` from its a end: the axis Opening.offset is measured on. */
const alongWall = (wall: Wall, p: Vec2) => {
  const len = wallLength(wall);
  return len === 0 ? 0 : ((p.x - wall.a.x) * (wall.b.x - wall.a.x) + (p.y - wall.a.y) * (wall.b.y - wall.a.y)) / len;
};

/** What the Door or Window tool would place under the pointer, or why it can't. */
interface Placement {
  kind: OpeningKind;
  snap: OpeningSnap;
  opening: Omit<Opening, "id"> | null;
  error: string | null;
}

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

  const selectedId = useSelectionStore((s) => s.selectedId);
  const run = useSelectedRun(); // every piece a body drag will move
  const hoveredId = useSelectionStore((s) => s.hoveredId);
  const select = useSelectionStore((s) => s.select);
  const openingId = useSelectionStore((s) => s.openingId);
  const selectOpening = useSelectionStore((s) => s.selectOpening);
  const hover = useSelectionStore((s) => s.hover);
  const setWarnings = useSelectionStore((s) => s.setWarnings);
  const tool = useToolStore((s) => s.tool);
  const setTool = useToolStore((s) => s.setTool);

  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  /** The live drag read-out: the snap marker, the length and any limit message. */
  const [hud, setHud] = useState<{ at: Vec2; snap: Snap | null; text: string; message?: string } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const userMoved = useRef(false); // once true, resizing no longer refits (same rule as the 3D FitCamera)
  const pointers = useRef(new Map<number, Vec2>()); // active touches / mouse, in canvas pixels
  const drag = useRef<Drag | null>(null);
  const live = useRef(false); // a preview edit is sitting on top of history, ready to roll back
  const burst = useRef({ at: 0, offset: 0, baseline: [] as string[] }); // arrow-key run

  // ---- Wall tool state: all local, none of it is in the plan or its history
  const chainRef = useRef<Chain | null>(null); // read by handlers between renders
  const [chain, setChainState] = useState<Chain | null>(null); // the same, for drawing
  /** Where the pointer would land, and why a wall to there isn't allowed, if it isn't. */
  const [ghost, setGhost] = useState<{ snap: Snap; problem: string | null } | null>(null);
  const [typed, setTyped] = useState(""); // a length being typed
  const [drawMsg, setDrawMsg] = useState<string | null>(null);

  // ---- Door and Window tools, and opening hover: local too
  const [place, setPlace] = useState<Placement | null>(null);
  const [hoverOp, setHoverOp] = useState<string | null>(null);

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

  // ---- editing through the store
  /**
   * Throw the live preview away and hand back the drag's starting walls: every
   * pointer event re-applies the whole drag from there, so history keeps one
   * entry however many events it takes (see planStore.rollback).
   */
  const restart = (): Wall[] => {
    if (live.current) usePlanStore.getState().rollback();
    live.current = false;
    return usePlanStore.getState().plan.walls;
  };

  /** Record `fn` as the drag's single history entry. */
  const commit = (fn: () => void) => {
    const before = usePlanStore.getState().past.length;
    usePlanStore.getState().transaction(fn);
    live.current = usePlanStore.getState().past.length > before; // a no-op drag records nothing: don't roll back someone else's step
  };

  /** Throw away the live preview and leave history as it was. */
  const cancelDrag = () => {
    if (live.current) usePlanStore.getState().rollback();
    live.current = false;
    drag.current = null;
    burst.current.at = 0;
    setHud(null);
  };

  /** After an edit: warn about problems the plan did not have before it. */
  const warnAbout = (baseline: string[]) => setWarnings(newProblems(baseline, validatePlan(usePlanStore.getState().plan)));

  /** Move a joint to `to` (already snapped), and read back the limit and length. */
  const applyEndpoint = (d: Extract<Drag, { kind: "endpoint" }>, to: Vec2, snap: Snap | null) => {
    const out = dragEndpoint(restart(), d.wallId, d.end, to);
    commit(() => usePlanStore.getState().moveWallEndpoint(d.wallId, d.end, out.point));
    const wall = out.walls.find((w) => w.id === d.wallId)!;
    setHud({ at: out.point, snap, text: formatLength(wallLength(wall), unit), message: out.limited });
  };

  /** Slide a wall — and the rest of its straight run — sideways by `offset` metres
   *  along its normal. Every joint of the run moves, so the store gets one call per
   *  joint, not just the dragged piece's two ends. */
  const applyBody = (d: Extract<Drag, { kind: "body" }>, offset: number, snap: Snap | null) => {
    const out = dragWallBody(restart(), d.wallId, offset);
    commit(() => {
      const { moveWallEndpoint } = usePlanStore.getState();
      // ponytail: one store call per joint. Run joints are at least MIN_WALL_LENGTH
      // apart, so no earlier move can land on a joint this loop has yet to read.
      for (const m of out.moves) moveWallEndpoint(m.wallId, m.end, m.to);
    });
    setHud({
      at: { x: (out.a.x + out.b.x) / 2, y: (out.a.y + out.b.y) / 2 },
      snap,
      text: `${formatLength(Math.abs(out.offset), unit)} across`,
      message: out.limited,
    });
  };

  // ---- drawing walls
  const putChain = (c: Chain | null) => {
    chainRef.current = c;
    setChainState(c);
  };

  /** End the chain: the walls stay (each is already its own undo step), the
   *  preview goes, and the panel lists anything the new walls left unjoined. */
  const finishChain = () => {
    const c = chainRef.current;
    if (c && c.count > 0) warnAbout(c.baseline);
    putChain(null);
    setGhost(null);
    setTyped("");
    setDrawMsg(null);
  };
  const finishRef = useRef(finishChain);
  finishRef.current = finishChain;
  // Leaving the Wall tool (the rail, or Escape) ends the chain.
  useEffect(
    () =>
      useToolStore.subscribe((st, prev) => {
        if (prev.tool === "wall" && st.tool !== "wall") finishRef.current();
        if (st.tool !== prev.tool) {
          setPlace(null); // a preview belongs to the tool that made it
          setDrawMsg(null);
          setHoverOp(null);
        }
      }),
    [],
  );

  /** Where a pointer at canvas pixel `p` lands; angles are measured from the chain's last point. */
  const landing = (p: Vec2, free: boolean) =>
    snapDraw(world(p), usePlanStore.getState().plan.walls, { from: chainRef.current?.last, radius: snapRadius(view.scale), free });

  const updateGhost = (p: Vec2, free: boolean) => {
    const snap = landing(p, free);
    const c = chainRef.current;
    const long = c && dist(c.last, snap.point) >= JOINT_EPS;
    setGhost({ snap, problem: long ? drawProblem(usePlanStore.getState().plan, c.last, snap.point) : null });
  };

  /** Add the wall chain.last → `to`, or say why not. Landing on the plan ends the chain. */
  const addSegment = (c: Chain, to: Vec2) => {
    if (dist(c.last, to) < JOINT_EPS) return; // the second click of a double-click: nothing to add
    const now = usePlanStore.getState().plan;
    const problem = drawProblem(now, c.last, to);
    if (problem) {
      setDrawMsg(problem);
      return;
    }
    const joins = landsOnPlan(now.walls, to); // read before the wall is added: it ends at `to` itself
    usePlanStore.getState().drawWall(c.last, to, drawDefaults(now.walls));
    setDrawMsg(null);
    setTyped("");
    const next = { ...c, last: to, count: c.count + 1 };
    if (joins) {
      chainRef.current = next;
      finishChain();
    } else {
      putChain(next);
      setGhost((g) => g && { ...g, problem: null });
    }
  };

  /** A click or tap with the Wall tool: start a chain, or add the next wall. */
  const placePoint = (p: Vec2, free: boolean) => {
    const snap = landing(p, free);
    const c = chainRef.current;
    if (!c) {
      putChain({ last: snap.point, count: 0, baseline: validatePlan(usePlanStore.getState().plan) });
      setGhost({ snap, problem: null });
      setDrawMsg(null);
      return;
    }
    addSegment(c, snap.point);
  };

  /** Enter after typing a length: a wall that long, towards where the pointer is. */
  const commitTyped = () => {
    const c = chainRef.current;
    if (!c) return;
    const len = parseTypedLength(typed.replace(",", "."));
    setTyped("");
    if (len === null) {
      setDrawMsg(`"${typed}" isn't a length. Try 3.5, 350 cm or 11' 6".`);
      return;
    }
    const to = ghost ? typedTarget(c.last, ghost.snap.point, len) : null;
    if (!to) {
      setDrawMsg("Point to where the wall should go, then type its length.");
      return;
    }
    addSegment(c, to);
  };

  // ---- doors and windows
  /** Slide the dragged opening to centre `target` along its wall; edit.slideOpening
   *  stops it at the usable ends and at its neighbours, and says why. */
  const applyOpening = (d: Extract<Drag, { kind: "opening" }>, target: number) => {
    restart();
    const out = slideOpening(usePlanStore.getState().plan, d.id, target);
    commit(() => usePlanStore.getState().updateOpening(d.id, { offset: out.offset }));
    const o = usePlanStore.getState().plan.openings.find((x) => x.id === d.id);
    const at = o ? openingFrame(d.wall, o).centre : d.wall.a;
    setHud({ at, snap: null, text: `${formatLength(out.offset, unit)} from the wall's start`, message: out.limited });
  };

  const placeKind: OpeningKind = tool === "window" ? "window" : "door";
  /** What the Door or Window tool would do at canvas pixel `p`. */
  const placementAt = (p: Vec2): Placement | null => {
    const now = usePlanStore.getState().plan;
    const snap = snapOpening(world(p), now.walls, { tol: PICK_TOL_PX / view.scale, radius: snapRadius(view.scale) });
    if (!snap) return null;
    const out = planOpening(now, placeKind, snap.wallId, snap.offset);
    return "error" in out ? { kind: placeKind, snap, opening: null, error: out.error } : { kind: placeKind, snap, opening: out.opening, error: null };
  };
  /** A click or tap with the Door or Window tool: place one, or say why not. */
  const placeAt = (p: Vec2) => {
    const pl = placementAt(p);
    if (!pl) {
      setPlace(null);
      setDrawMsg(`Click on a wall to place a ${placeKind}.`);
      return;
    }
    if (!pl.opening) {
      setPlace(pl);
      setDrawMsg(pl.error);
      return;
    }
    usePlanStore.getState().placeOpening(pl.kind, pl.snap.wallId, pl.snap.offset);
    setPlace(null); // the next pointer move previews again, against the new opening
    setDrawMsg(null);
  };

  // ---- pointers: a wall under the cursor is edited, otherwise one pans and two pinch-zoom
  const local = (e: ReactPointerEvent): Vec2 => {
    const r = root.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const world = (p: Vec2) => screenToWorld(view, p);
  /** What a Select-tool press at canvas pixel `p` picks. Touch gets bigger handles
   *  and a bigger opening reach: a fingertip covers more than a cursor. */
  const targetAt = (p: Vec2, touch: boolean) =>
    pickTarget(
      world(p),
      plan,
      { wall: PICK_TOL_PX / view.scale, handle: (touch ? HANDLE_TOL_TOUCH_PX : HANDLE_TOL_PX) / view.scale, opening: (touch ? HANDLE_TOL_PX : PICK_TOL_PX) / view.scale },
      selectedId,
    );

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button === 2) return;
    // A second finger means a pinch: give up any wall edit rather than fight it.
    if (pointers.current.size >= 1 && drag.current && drag.current.kind !== "pan") cancelDrag();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    if (pointers.current.size > 1) {
      if (drag.current?.kind === "pan") drag.current.multi = true;
      return;
    }

    root.current!.focus({ preventScroll: true }); // so Escape, Delete and the arrows reach this canvas
    burst.current.at = 0;
    // The other tools never grab walls: a press is a click (place something) or a pan.
    const target = tool === "select" ? targetAt(local(e), e.pointerType === "touch") : null;
    if (target?.kind === "opening") {
      const opHit = target.id;
      selectOpening(opHit); // selection only: not an edit, so no history
      const o = plan.openings.find((x) => x.id === opHit)!;
      const wall = plan.walls.find((w) => w.id === o.wallId)!;
      drag.current = { kind: "opening", id: opHit, wall, grab: alongWall(wall, world(local(e))) - o.offset, baseline: validatePlan(plan) };
      return;
    }
    if (!target) {
      drag.current = { kind: "pan", from: local(e), moved: 0 };
      return;
    }
    const hit = { wallId: target.wallId, end: target.kind === "handle" ? target.end : null };
    select(hit.wallId);
    const wall = plan.walls.find((w) => w.id === hit.wallId)!;
    const baseline = validatePlan(plan);
    drag.current = hit.end
      ? { kind: "endpoint", wallId: hit.wallId, end: hit.end, joint: wall[hit.end], other: hit.end === "a" ? wall.b : wall.a, walls: plan.walls, baseline }
      : { kind: "body", wallId: hit.wallId, from: world(local(e)), wall, baseline };
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) {
      if (drag.current) return;
      if (tool === "wall") updateGhost(local(e), e.altKey); // the preview follows the mouse
      else if (tool !== "select") {
        const pl = placementAt(local(e));
        setPlace(pl);
        if (!pl) setDrawMsg(null); // off every wall: nothing to explain
      } else {
        const t = targetAt(local(e), false); // plain hover, no button down: the same rule as a click
        setHoverOp(t?.kind === "opening" ? t.id : null);
        hover(t && t.kind !== "opening" ? t.wallId : null);
      }
      return;
    }
    const pos = local(e);
    const d = drag.current;

    if (d?.kind === "opening") {
      pointers.current.set(e.pointerId, pos);
      const target = alongWall(d.wall, world(pos)) - d.grab;
      applyOpening(d, e.altKey ? target : roundTo(target, OPENING_STEP)); // Alt: no 5 cm steps
      return;
    }

    if (d?.kind === "endpoint" || d?.kind === "body") {
      pointers.current.set(e.pointerId, pos);
      const free = e.altKey; // Alt turns snapping off
      if (d.kind === "endpoint") {
        // Angles are measured from the wall's OTHER end, so 90° and 45° are relative to it;
        // the walls meeting the joint itself are excluded, or it would snap back onto itself.
        const snap = snapDrag(world(pos), d.walls, { from: d.other, radius: snapRadius(view.scale), free, exclude: d.joint });
        applyEndpoint(d, snap.point, snap);
      } else {
        const delta = { x: world(pos).x - d.from.x, y: world(pos).y - d.from.y };
        const raw = normalComponent(d.wall, delta); // only the sideways part: the wall keeps its direction
        applyBody(d, free ? raw : roundTo(raw, 0.05), free ? null : { point: d.from, kind: "grid" });
      }
      return;
    }

    if (pointers.current.size === 1) {
      if (d?.kind === "pan") d.moved += Math.abs(pos.x - prev.x) + Math.abs(pos.y - prev.y);
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

  const onPointerEnd = (e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    if (!d) return;
    if (d.kind === "pan") {
      drag.current = null;
      if (d.moved > CLICK_SLOP_PX || d.multi || e.type !== "pointerup") return; // a pan, a pinch or a cancel: not a click
      if (tool === "wall") placePoint(local(e), e.altKey);
      else if (tool === "door" || tool === "window") placeAt(local(e));
      else select(null); // a click on empty space clears the selection
      return;
    }
    // Round to 1 cm on release, then say what the edit broke, if anything.
    if (live.current) {
      if (d.kind === "opening") {
        const o = usePlanStore.getState().plan.openings.find((x) => x.id === d.id);
        if (o) applyOpening(d, roundTo(o.offset)); // 1 cm, still inside the free stretch
      } else if (d.kind === "endpoint") {
        const wall = usePlanStore.getState().plan.walls.find((w) => w.id === d.wallId);
        if (wall) applyEndpoint(d, roundPoint(wall[d.end]), null);
      } else {
        const moved = usePlanStore.getState().plan.walls.find((w) => w.id === d.wallId);
        if (moved) applyBody(d, roundTo(normalComponent(d.wall, { x: moved.a.x - d.wall.a.x, y: moved.a.y - d.wall.a.y })), null);
      }
      warnAbout(d.baseline);
    }
    live.current = false;
    drag.current = null;
    setHud(null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey) return; // only when the canvas itself has focus

    if (tool === "wall") {
      if (e.key === "Escape") {
        e.stopPropagation(); // beat the page-wide Escape in selectionStore
        if (typed) setTyped(""); // first Escape drops a half-typed length
        else if (chainRef.current) finishChain();
        else setTool("select"); // nothing being drawn: back to Select
        return;
      }
      if (chainRef.current && !e.altKey) {
        if (TYPED_KEY.test(e.key)) {
          e.preventDefault(); // digits type a length here instead of zooming or fitting
          setTyped((t) => (t + e.key).slice(0, 16));
          return;
        }
        if (e.key === "Backspace" && typed) {
          e.preventDefault();
          setTyped((t) => t.slice(0, -1));
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          if (typed) commitTyped();
          else finishChain();
          return;
        }
      }
    }

    if ((tool === "door" || tool === "window") && e.key === "Escape") {
      e.stopPropagation();
      setTool("select");
      return;
    }

    if (e.key === "Escape") {
      e.stopPropagation(); // beat the page-wide Escape in selectionStore
      if (drag.current) {
        cancelDrag();
        pointers.current.clear(); // a finger still down must not start panning instead
      } else select(null);
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && openingId) {
      e.preventDefault();
      usePlanStore.getState().deleteOpening(openingId); // only the opening: its wall stays
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
      e.preventDefault();
      usePlanStore.getState().deleteWall(selectedId); // selectionStore clears the selection when the wall goes
      return;
    }

    const step = e.shiftKey ? NUDGE_SHIFT_M : NUDGE_M;
    const nudges: Record<string, Vec2> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step }, // plan y points south
      ArrowDown: { x: 0, y: step },
    };
    const wall = selectedId ? plan.walls.find((w) => w.id === selectedId) : undefined;
    if (wall && nudges[e.key] && !e.altKey) {
      e.preventDefault();
      const offset = normalComponent(wall, nudges[e.key]);
      if (Math.abs(offset) < 1e-9) return; // along the wall: a horizontal wall ignores left and right
      // Presses inside the merge window keep re-applying one growing step.
      const now = performance.now();
      const merging = now - burst.current.at < NUDGE_MERGE_MS;
      burst.current = {
        at: now,
        offset: merging ? burst.current.offset + offset : offset,
        baseline: merging ? burst.current.baseline : validatePlan(plan),
      };
      live.current = merging;
      const seed: Extract<Drag, { kind: "body" }> = { kind: "body", wallId: wall.id, from: wall.a, wall, baseline: burst.current.baseline };
      applyBody(seed, burst.current.offset, null);
      warnAbout(burst.current.baseline);
      setHud(null);
      return;
    }

    if (e.altKey) return;
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
  const selected = plan.walls.find((w) => w.id === selectedId);

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

  // The wall being drawn, from the chain's last point to where the pointer lands.
  const ghostWall: Wall | null =
    tool === "wall" && chain && ghost && dist(chain.last, ghost.snap.point) >= JOINT_EPS
      ? { id: "draw-ghost", a: chain.last, b: ghost.snap.point, thickness: DRAW_THICKNESS, height: 0 }
      : null;
  const ghostOutline = ghostWall ? wallOutline(ghostWall, [...plan.walls, ghostWall]) : [];
  const drawLength = typed ? `${typed}…` : ghostWall ? formatLength(wallLength(ghostWall), unit) : "";
  /** The 45°/90° guide: a dashed line through the chain's last point, along the snapped angle. */
  const guide = (() => {
    if (!ghostWall || ghost?.snap.kind !== "angle") return null;
    const [p, q] = [S(ghostWall.a), S(ghostWall.b)];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (len < 1) return null;
    const u = { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
    return { from: add(p, u, -GUIDE_PX), to: add(p, u, GUIDE_PX) };
  })();
  const message = hud?.message ?? drawMsg ?? ghost?.problem ?? place?.error ?? undefined;

  /** An opening's stretch of wall band as a screen polygon, `pad` px proud of the wall faces. */
  const bandOf = (wall: Wall, o: Pick<Opening, "offset" | "width">, pad: number) => {
    const f = openingFrame(wall, o);
    const [s, e] = [S(f.start), S(f.end)];
    const h = (wall.thickness / 2) * view.scale + pad;
    return pts([add(s, f.normal, h), add(e, f.normal, h), add(e, f.normal, -h), add(s, f.normal, -h)]);
  };
  /** A door's leaf (hinge → open tip) and its quarter arc to the closed position, in screen space. */
  const doorShape = (wall: Wall, o: Pick<Opening, "offset" | "width" | "swing">) => {
    const sw = doorSwing(wall, o);
    const [hinge, leaf, arcEnd] = [S(sw.hinge), S(sw.leafEnd), S(sw.arcEnd)];
    const r = o.width * view.scale;
    // The sweep flag follows the turn direction, so a flipped door draws its arc on the other side.
    const sweep = (leaf.x - hinge.x) * (arcEnd.y - hinge.y) - (leaf.y - hinge.y) * (arcEnd.x - hinge.x) > 0 ? 1 : 0;
    return { hinge, leaf, arc: `M${leaf.x},${leaf.y}A${r},${r} 0 0 ${sweep} ${arcEnd.x},${arcEnd.y}` };
  };
  const selectedOpening = plan.openings.find((o) => o.id === openingId);
  const selectedOpeningWall = selectedOpening && plan.walls.find((w) => w.id === selectedOpening.wallId);
  const hoverOpening = tool === "select" && hoverOp !== openingId ? plan.openings.find((o) => o.id === hoverOp) : undefined;
  const hoverOpeningWall = hoverOpening && plan.walls.find((w) => w.id === hoverOpening.wallId);
  const placeWall = place && plan.walls.find((w) => w.id === place.snap.wallId);

  /** A snap marker with its word, and a text read-out beside it. */
  const readout = (at: Vec2, snap: Snap | null, text: string) => {
    const p = S(at);
    return (
      <>
        {snap && (
          <g data-testid="snap-marker" data-snap={snap.kind ?? "none"}>
            <circle cx={p.x} cy={p.y} r={6} className="fill-none stroke-gilt" strokeWidth={2} />
            <text x={p.x + 10} y={p.y - 10} className="fill-gilt stroke-limestone text-xs" style={{ paintOrder: "stroke", strokeWidth: 3 }}>
              {SNAP_WORDS[snap.kind ?? ""] ?? ""}
            </text>
          </g>
        )}
        {text && (
          <text x={p.x + 10} y={p.y + 18} className="fill-iron stroke-limestone text-sm" style={{ paintOrder: "stroke", strokeWidth: 3 }} data-testid="drag-length">
            {text}
          </text>
        )}
      </>
    );
  };

  const barMetres = niceScaleBar(view.scale);
  const barPx = barMetres * view.scale;

  return (
    <div
      ref={root}
      tabIndex={0}
      role="group"
      aria-label={
        tool === "wall"
          ? "2D plan, drawing walls. Click to start a wall and click again to add it; keep clicking to add joined walls. Type a length and press Enter for an exact one. Escape, Enter or double-click finishes; Escape again goes back to Select."
          : tool === "door" || tool === "window"
            ? `2D plan, placing ${tool}s. Click a wall to place a ${tool} there. Escape goes back to Select.`
            : "2D plan. Click a wall, door or window to select it; drag a door or window to slide it along its wall. Arrow keys nudge the selected wall or pan when no wall is selected, Delete removes the selection, Escape clears it. Plus and minus zoom, 0 fits the plan."
      }
      data-testid="plan-canvas"
      data-scale={view.scale.toFixed(4)}
      data-tx={view.tx.toFixed(2)}
      data-ty={view.ty.toFixed(2)}
      data-selected={selectedId ?? ""}
      data-opening={openingId ?? ""}
      data-run={run.join(" ")}
      data-tool={tool}
      data-drawing={chain ? "true" : "false"}
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
          className={`block touch-none ${tool !== "select" ? "cursor-crosshair" : hoveredId || hoverOp ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onPointerLeave={() => {
            if (drag.current) return;
            hover(null);
            setHoverOp(null);
            setPlace(null);
          }}
          onDoubleClick={() => tool === "wall" && finishChain()}
        >
          {/* room floors, tinted by the floor material */}
          {rooms.map((r) => (
            <polygon key={r.id} points={pts(r.polygon.map(S))} fill={floorColor(r.floorMaterial)} fillOpacity={0.4} data-testid="plan-floor" />
          ))}

          {gridPath && <path d={gridPath} className="stroke-stone" strokeWidth={1} opacity={gridOpacity * 0.7} fill="none" data-testid="plan-grid" />}

          {/* walls: mitred outlines; the thin stroke hides seams between neighbouring polygons */}
          {plan.walls.map((w) => {
            const o = outlines.get(w.id);
            return o && <polygon key={w.id} points={pts(o.map(S))} className="fill-iron stroke-iron" strokeWidth={0.75} data-testid="plan-wall" data-wall={w.id} />;
          })}

          {/* opening gaps: the wall band between the opening's ends, painted in the ground colour */}
          {plan.openings.map((op) => {
            const wall = plan.walls.find((w) => w.id === op.wallId);
            if (!wall || outlines.get(wall.id) === undefined) return null;
            return <polygon key={`gap-${op.id}`} points={bandOf(wall, op, GAP_OVERSHOOT_PX)} className="fill-limestone" data-testid="plan-gap" data-opening={op.id} />;
          })}

          {/* door and window symbols */}
          {plan.openings.map((op) => {
            const wall = plan.walls.find((w) => w.id === op.wallId);
            if (!wall || outlines.get(wall.id) === undefined) return null;
            const f = openingFrame(wall, op);
            const [s, e] = [S(f.start), S(f.end)];
            if (op.kind === "door") {
              const { hinge, leaf, arc } = doorShape(wall, op);
              return (
                <g key={`door-${op.id}`} fill="none" className="stroke-iron" strokeWidth={1.2} data-testid="plan-door" data-opening={op.id} data-swing={op.swing}>
                  <line x1={hinge.x} y1={hinge.y} x2={leaf.x} y2={leaf.y} data-testid="door-leaf" />
                  <path d={arc} strokeWidth={0.8} />
                </g>
              );
            }
            const h = (wall.thickness / 2) * view.scale; // frame lines sit on the wall's two faces
            const line = (k: number, cls: string, sw: number) => {
              const [p, q] = [add(s, f.normal, k), add(e, f.normal, k)];
              return <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} className={cls} strokeWidth={sw} />;
            };
            return (
              <g key={`win-${op.id}`} data-testid="plan-window" data-opening={op.id}>
                {line(h, "stroke-iron", 1.2)}
                {line(-h, "stroke-iron", 1.2)}
                {line(0, "stroke-cyanotype", 1)}
              </g>
            );
          })}

          {/* the door or window under the cursor: a light cyanotype wash */}
          {hoverOpening && hoverOpeningWall && <polygon points={bandOf(hoverOpeningWall, hoverOpening, 3)} className="fill-cyanotype" fillOpacity={0.2} data-testid="plan-opening-hover" />}

          {/* the selected door or window: a cyanotype outline (a selected wall is gilt),
              and its symbol redrawn over it in cyanotype — a door's leaf and arc, so its
              side reads at a glance, or a window's two frame lines and glazing line */}
          {selectedOpening && selectedOpeningWall && (
            <g data-testid="plan-opening-selection" data-opening={selectedOpening.id} data-swing={selectedOpening.swing ?? ""}>
              <polygon points={bandOf(selectedOpeningWall, selectedOpening, 4)} className="fill-cyanotype stroke-cyanotype" fillOpacity={0.25} strokeWidth={2} />
              {selectedOpening.kind === "door" &&
                (() => {
                  const { hinge, leaf, arc } = doorShape(selectedOpeningWall, selectedOpening);
                  return (
                    <g fill="none" className="stroke-cyanotype" strokeWidth={2} data-testid="selected-door-symbol">
                      <line x1={hinge.x} y1={hinge.y} x2={leaf.x} y2={leaf.y} />
                      <path d={arc} strokeWidth={1.5} />
                    </g>
                  );
                })()}
              {selectedOpening.kind === "window" &&
                (() => {
                  const f = openingFrame(selectedOpeningWall, selectedOpening);
                  const [s, e] = [S(f.start), S(f.end)];
                  const h = (selectedOpeningWall.thickness / 2) * view.scale;
                  return (
                    <g className="stroke-cyanotype" strokeWidth={2} data-testid="selected-window-symbol">
                      {[h, 0, -h].map((k) => {
                        const [p, q] = [add(s, f.normal, k), add(e, f.normal, k)];
                        return <line key={k} x1={p.x} y1={p.y} x2={q.x} y2={q.y} />;
                      })}
                    </g>
                  );
                })()}
            </g>
          )}

          {/* Door / Window tool: the opening it would place, dashed where it can't go */}
          {place && placeWall && (
            <g data-testid="place-preview" data-valid={place.opening ? "true" : "false"} data-wall={place.snap.wallId}>
              {place.opening ? (
                <>
                  <polygon points={bandOf(placeWall, place.opening, 3)} className="fill-gilt stroke-gilt" fillOpacity={0.45} strokeWidth={1.5} />
                  {place.opening.kind === "door" &&
                    (() => {
                      const { hinge, leaf, arc } = doorShape(placeWall, place.opening);
                      return (
                        <g fill="none" className="stroke-gilt" strokeWidth={1.5} strokeDasharray="4 3">
                          <line x1={hinge.x} y1={hinge.y} x2={leaf.x} y2={leaf.y} />
                          <path d={arc} />
                        </g>
                      );
                    })()}
                  {readout(openingFrame(placeWall, place.opening).centre, null, `${place.kind === "door" ? "Door" : "Window"} ${formatLength(place.opening.width, unit)}`)}
                </>
              ) : (
                (() => {
                  const c = S(openingFrame(placeWall, { offset: place.snap.offset, width: 0 }).centre); // where it was asked for
                  return <circle cx={c.x} cy={c.y} r={6} className="fill-none stroke-smoke" strokeWidth={2} strokeDasharray="3 3" />;
                })()
              )}
            </g>
          )}

          {/* hover: a light gilt wash over the wall under the cursor */}
          {tool === "select" && hoveredId && hoveredId !== selectedId && outlines.get(hoveredId) && (
            <polygon points={pts(outlines.get(hoveredId)!.map(S))} className="fill-gilt" fillOpacity={0.35} data-testid="plan-hover" />
          )}

          {/* the rest of the straight wall the selection belongs to: a lighter gilt
              wash, because dragging the selected piece's body moves all of it */}
          {run.length > 1 && (
            <g data-testid="plan-run">
              {run
                .filter((id) => id !== selectedId)
                .map((id) => {
                  const o = outlines.get(id);
                  return o && <polygon key={id} points={pts(o.map(S))} className="fill-gilt stroke-gilt" fillOpacity={0.15} strokeOpacity={0.6} strokeWidth={2} data-wall={id} />;
                })}
            </g>
          )}

          {/* selection: a gilt outline and a filled handle at each end */}
          {selected && outlines.get(selected.id) && (
            <g data-testid="plan-selection">
              <polygon points={pts(outlines.get(selected.id)!.map(S))} className="fill-gilt stroke-gilt" fillOpacity={0.25} strokeWidth={2} />
              {[selected.a, selected.b].map((p, i) => {
                const s = S(p);
                return <rect key={i} x={s.x - HANDLE_PX / 2} y={s.y - HANDLE_PX / 2} width={HANDLE_PX} height={HANDLE_PX} className="fill-gilt stroke-vellum" strokeWidth={1} data-testid="wall-handle" />;
              })}
            </g>
          )}

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

          {/* live drag read-out: where it snapped, and how long the wall is now */}
          {hud && (
            <g className="font-sans" data-testid="drag-hud">
              {readout(hud.at, hud.snap, hud.text)}
            </g>
          )}

          {/* the wall being drawn: guide, outline (dashed when it isn't allowed), start point, read-out */}
          {tool === "wall" && ghost && (
            <g className="font-sans" data-testid="draw-preview">
              {guide && <line x1={guide.from.x} y1={guide.from.y} x2={guide.to.x} y2={guide.to.y} className="stroke-cyanotype" strokeWidth={1} strokeDasharray="6 4" opacity={0.6} data-testid="snap-guide" />}
              {ghostOutline.length > 0 && (
                <polygon
                  points={pts(ghostOutline.map(S))}
                  className={ghost.problem ? "fill-none stroke-smoke" : "fill-gilt stroke-gilt"}
                  fillOpacity={0.4}
                  strokeWidth={1.5}
                  strokeDasharray={ghost.problem ? "5 4" : undefined}
                  data-testid="draw-ghost"
                  data-valid={ghost.problem ? "false" : "true"}
                />
              )}
              {chain && <circle cx={S(chain.last).x} cy={S(chain.last).y} r={4} className="fill-gilt stroke-vellum" strokeWidth={1} data-testid="draw-start" />}
              {readout(ghost.snap.point, ghost.snap, drawLength)}
            </g>
          )}

          {/* scale bar, bottom left */}
          <g data-testid="plan-scalebar" className="font-sans" transform={`translate(16 ${size.height - 16})`}>
            <path d={`M0,-6V0H${barPx}V-6`} fill="none" className="stroke-iron" strokeWidth={1.5} />
            <text x={0} y={-10} className="fill-iron stroke-limestone text-xs" style={{ paintOrder: "stroke", strokeWidth: 3, strokeLinejoin: "round" }}>
              {`${+barMetres.toFixed(3)} m`}
            </text>
          </g>
        </svg>
      )}

      {/* why a drag stopped short, or why a wall can't be drawn there, in plain words */}
      {message && (
        <p role="status" data-testid="drag-message" className="pointer-events-none absolute bottom-3 left-1/2 w-max max-w-[calc(100%-2rem)] -translate-x-1/2 rounded border border-stone bg-vellum px-3 py-1.5 text-xs text-iron shadow">
          {message}
        </p>
      )}

      {/* Door / Window tool: what to do */}
      {(tool === "door" || tool === "window") && (
        <div data-testid="place-bar" className="absolute left-2 right-14 top-2 flex flex-wrap items-center gap-2">
          <p className="rounded border border-stone bg-vellum px-2 py-1 text-xs text-iron shadow">
            Click a wall to place a {tool} ({formatLength(OPENING_DEFAULTS[tool].width, unit)} wide)
          </p>
        </div>
      )}

      {/* Wall tool: what to do next, and Finish for touch screens with no Escape key */}
      {tool === "wall" && (
        <div data-testid="draw-bar" className="absolute left-2 right-14 top-2 flex flex-wrap items-center gap-2">
          <p className="rounded border border-stone bg-vellum px-2 py-1 text-xs text-iron shadow">
            {chain ? (typed ? `Length ${typed}, Enter to add` : "Click to add a wall, or type its length") : "Click where the wall starts"}
          </p>
          {chain && (
            <button type="button" data-testid="draw-finish" onClick={finishChain} className="min-h-9 rounded border border-stone bg-vellum px-3 text-xs text-iron shadow hover:bg-limestone">
              Finish
            </button>
          )}
        </div>
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
