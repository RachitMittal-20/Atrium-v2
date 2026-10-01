/**
 * edit.ts — pure maths for selecting and editing walls (no React, no store):
 * hit-testing a pointer, snapping a dragged point, moving a joint, finding the
 * run of pieces one straight wall was split into, sliding a whole run sideways,
 * and the tolerances the editor works to. Every number the
 * editor rounds or limits to is declared here and printed by
 * scripts/test-edit.ts. Connects to: src/types/plan.ts, ./geometry.ts;
 * called by src/components/plan2d/PlanCanvas.tsx and
 * src/components/studio/WallPanel.tsx, which feed the results to planStore.
 *
 * Plan space: x → east, y → south. A wall's normal is the left of a→b.
 */
import type { Plan, Vec2, Wall } from "@/types/plan";
import { dist, JOINT_EPS, pointToWallDistance, snapPoint, wallDirection, wallLength, wallNormal, type SnapKind } from "./geometry";

// ---------------------------------------------------------------- tolerances

/** No edit may leave a wall shorter than this (metres). */
export const MIN_WALL_LENGTH = 0.2;
/** Coordinates round to this on release and on a typed edit (1 cm). */
export const ROUND_STEP = 0.01;

/** Hit-test distances, in screen pixels: the canvas divides by the view scale. */
export const PICK_TOL_PX = 8;
export const HANDLE_TOL_PX = 12;
export const HANDLE_TOL_TOUCH_PX = 20;
/** Snapping reaches this far on screen, clamped so it stays sane at any zoom. */
export const SNAP_TOL_PX = 12;
export const SNAP_MIN_M = 0.02;
export const SNAP_MAX_M = 0.5;

/** Arrow-key nudge, and the window inside which presses fold into one undo step. */
export const NUDGE_M = 0.05;
export const NUDGE_SHIFT_M = 0.25;
export const NUDGE_MERGE_MS = 400;

export const THICKNESS_RANGE = [0.05, 0.6] as const;
export const HEIGHT_RANGE = [1.0, 6.0] as const;

const clean = (v: number) => Math.round(v * 1e9) / 1e9; // strip float dust like 6e-17

export const roundTo = (v: number, step = ROUND_STEP) => clean(Math.round(v / step) * step);
export const roundPoint = (p: Vec2, step = ROUND_STEP): Vec2 => ({ x: roundTo(p.x, step), y: roundTo(p.y, step) });

/** Snap reach in metres at a given view scale (px/m). */
export const snapRadius = (scale: number) => Math.min(SNAP_MAX_M, Math.max(SNAP_MIN_M, SNAP_TOL_PX / scale));

// ---------------------------------------------------------------- picking

export interface WallPick {
  wallId: string;
  /** The endpoint handle that was hit, or null for the wall's body. */
  end: "a" | "b" | null;
}

/**
 * The wall under `p`: nearest wins, but any endpoint handle within `handleTol`
 * beats every wall body. Distances are in metres, so the caller converts its
 * pixel tolerances through the view scale. Several walls share a joint, so ties
 * go to `prefer` (the selected wall) — otherwise grabbing the handle of the wall
 * you just selected could hand you one of its neighbours instead.
 */
export function pickWall(p: Vec2, walls: Wall[], tol: number, handleTol: number, prefer?: string | null): WallPick | null {
  let hit: WallPick | null = null;
  let best = Infinity;
  const wins = (d: number, id: string) => d < best - JOINT_EPS || (d <= best + JOINT_EPS && id === prefer && hit?.wallId !== prefer) || d < best;
  for (const w of walls) {
    for (const end of ["a", "b"] as const) {
      const d = dist(p, w[end]);
      if (d <= handleTol && wins(d, w.id)) [best, hit] = [Math.min(d, best), { wallId: w.id, end }];
    }
  }
  if (hit) return hit;
  for (const w of walls) {
    const d = pointToWallDistance(p, w);
    if (d <= tol && wins(d, w.id)) [best, hit] = [Math.min(d, best), { wallId: w.id, end: null }];
  }
  return hit;
}

// ---------------------------------------------------------------- snapping

export interface Snap {
  point: Vec2;
  /** null when snapping was off (Alt held): the point is only rounded to 1 cm. */
  kind: SnapKind | null;
}

/**
 * Where a dragged point lands. Priority comes straight from geometry.snapPoint:
 * wall endpoints, then midpoints, then 45°/90° rays from `from` (use the OTHER
 * end of the dragged wall), then the 5 cm grid. `free` (Alt) turns snapping off.
 *
 * Walls meeting the joint being dragged (`exclude`) are dropped from the
 * candidates: their endpoint at the joint is the point we are moving, their
 * midpoints move with it, and their far ends are exactly the places the
 * minimum-length rule forbids anyway.
 */
export function snapDrag(p: Vec2, walls: Wall[], opts: { from?: Vec2; radius: number; free?: boolean; exclude?: Vec2 }): Snap {
  if (opts.free) return { point: roundPoint(p), kind: null };
  const { exclude } = opts;
  const candidates = exclude ? walls.filter((w) => dist(w.a, exclude) >= JOINT_EPS && dist(w.b, exclude) >= JOINT_EPS) : walls;
  return snapPoint(p, candidates, { from: opts.from, radius: opts.radius });
}

// ---------------------------------------------------------------- joints

/** One joint of a drag: where it was, where it goes, and a wall that owns it so
 *  the caller can hand it to planStore.moveWallEndpoint. */
export interface JointMove {
  wallId: string;
  end: "a" | "b";
  from: Vec2;
  to: Vec2;
}

/** Move every wall endpoint within JOINT_EPS of a move's `from` to its `to`, all
 *  in one pass: a joint that lands on top of another joint's old place must not
 *  then drag that one along. Every `from` is read from the walls as they came in. */
export function moveJoints(walls: Wall[], moves: { from: Vec2; to: Vec2 }[]): Wall[] {
  const at = (p: Vec2) => moves.find((m) => dist(p, m.from) < JOINT_EPS)?.to ?? p;
  return walls.map((w) => {
    const a = at(w.a);
    const b = at(w.b);
    return a === w.a && b === w.b ? w : { ...w, a, b };
  });
}

/** Move every wall endpoint within JOINT_EPS of `from` to `to`. The same rule as
 *  planStore.moveWallEndpoint, in pure form; test-edit.ts checks they agree. */
export const moveJoint = (walls: Wall[], from: Vec2, to: Vec2): Wall[] => moveJoints(walls, [{ from, to }]);

export interface EndpointDrag {
  walls: Wall[];
  /** Where the joint landed: the request, pulled back when a wall hit the minimum. */
  point: Vec2;
  /** Plain words for why the drag stopped short, when it did. */
  limited?: string;
}

/**
 * Move the joint at `walls[wallId][end]` to `to`, carrying every wall endpoint
 * joined there. A wall that would end up shorter than MIN_WALL_LENGTH pushes the
 * joint back out along its own direction to exactly that length.
 */
export function dragEndpoint(walls: Wall[], wallId: string, end: "a" | "b", to: Vec2): EndpointDrag {
  const wall = walls.find((w) => w.id === wallId);
  if (!wall) return { walls, point: to };
  const joint = wall[end];
  // The far end of every wall meeting the joint; those ends stay where they are.
  const fixed = walls.flatMap((w) => {
    if (wallLength(w) < JOINT_EPS) return [];
    return dist(w.a, joint) < JOINT_EPS ? [w.b] : dist(w.b, joint) < JOINT_EPS ? [w.a] : [];
  });

  let point = to;
  let limited: string | undefined;
  // ponytail: two passes, not a proper multi-circle solve. Walls at one joint
  // point in different directions, so pushing out of one circle rarely re-enters
  // another; a second pass settles the cases where it does.
  for (let pass = 0; pass < 2; pass++) {
    for (const o of fixed) {
      const d = dist(point, o);
      if (d >= MIN_WALL_LENGTH) continue;
      limited = `Stopped here: walls can't be shorter than ${MIN_WALL_LENGTH.toFixed(2)} m.`;
      const u = d < 1e-9 ? { x: 1, y: 0 } : { x: (point.x - o.x) / d, y: (point.y - o.y) / d }; // on top of the far end: any direction will do
      point = { x: clean(o.x + u.x * MIN_WALL_LENGTH), y: clean(o.y + u.y * MIN_WALL_LENGTH) };
    }
  }
  return { walls: moveJoint(walls, joint, point), point, limited };
}

// ---------------------------------------------------------------- wall runs

/**
 * Two pieces count as one straight wall when their directions differ by at most
 * this many degrees. Detection splits walls at T-junctions, so what the drawing
 * shows as one wall is several pieces that are collinear to within rounding.
 */
export const RUN_ANGLE_DEG = 1;
const RUN_SIN = Math.sin((RUN_ANGLE_DEG * Math.PI) / 180);

/** Unit vector pointing from joint J along `w`, or null when `w` doesn't meet J. */
function spokeAt(w: Wall, J: Vec2): Vec2 | null {
  const o = dist(w.a, J) < JOINT_EPS ? w.b : dist(w.b, J) < JOINT_EPS ? w.a : null;
  if (!o) return null;
  const len = dist(o, J);
  return len < JOINT_EPS ? null : { x: (o.x - J.x) / len, y: (o.y - J.y) / len };
}

/**
 * The ids of the maximal chain of walls that are end to end and collinear with
 * `wallId` — the pieces one straight wall was split into at its T-junctions —
 * ordered from one end of the chain to the other. Other walls may meet those
 * joints (the stem of a T); they neither join the run nor break it, because a
 * stem's spoke is not antiparallel to the run. A wall with no collinear
 * neighbour is a run of one, and the same chain comes back whichever of its
 * pieces you ask about.
 */
export function wallRun(plan: Pick<Plan, "walls">, wallId: string): string[] {
  const walls = plan.walls.filter((w) => wallLength(w) >= JOINT_EPS);
  const start = walls.find((w) => w.id === wallId);
  if (!start) return plan.walls.some((w) => w.id === wallId) ? [wallId] : [];
  const seen = new Set([start.id]); // shared by both walks, so a ring can't loop forever

  /** Walk outwards from `joint`, collecting the collinear continuation of `from`. */
  const grow = (from: Wall, joint: Vec2): string[] => {
    const out: string[] = [];
    let cur = from;
    let J = joint;
    for (;;) {
      const u = spokeAt(cur, J); // along cur, away from J
      if (!u) return out;
      let best: { w: Wall; dot: number } | null = null;
      for (const w of walls) {
        if (seen.has(w.id)) continue;
        const s = spokeAt(w, J);
        if (!s) continue;
        const dot = u.x * s.x + u.y * s.y;
        // End to end means the two spokes point opposite ways; the cross product
        // is the sine of the angle between the lines, so it caps the tilt.
        if (dot >= 0 || Math.abs(u.x * s.y - u.y * s.x) > RUN_SIN) continue;
        if (!best || dot < best.dot) best = { w, dot }; // the straightest continuation
      }
      if (!best) return out;
      out.push(best.w.id);
      seen.add(best.w.id);
      J = dist(best.w.a, J) < JOINT_EPS ? best.w.b : best.w.a; // on to its far end
      cur = best.w;
    }
  };

  return [...grow(start, start.a).reverse(), start.id, ...grow(start, start.b)];
}

/**
 * The run's joints in order — one more than it has pieces: the outer end of the
 * first piece, then every shared joint, then the outer end of the last. Each
 * comes with a piece that owns it and which end of that piece it is.
 */
function runJoints(walls: Wall[], run: string[]): Omit<JointMove, "to">[] {
  const pieces = run.map((id) => walls.find((w) => w.id === id)).filter((w): w is Wall => !!w);
  if (pieces.length === 0) return [];
  const second = pieces[1];
  const shared = (p: Vec2) => !!second && (dist(second.a, p) < JOINT_EPS || dist(second.b, p) < JOINT_EPS);
  const outer: "a" | "b" = shared(pieces[0].a) ? "b" : "a"; // start at the end the next piece doesn't touch
  const out: Omit<JointMove, "to">[] = [{ wallId: pieces[0].id, end: outer, from: pieces[0][outer] }];
  for (const p of pieces) {
    const far: "a" | "b" = dist(p.a, out[out.length - 1].from) < JOINT_EPS ? "b" : "a";
    out.push({ wallId: p.id, end: far, from: p[far] });
  }
  return out;
}

// ---------------------------------------------------------------- wall body

export interface BodyDrag {
  walls: Wall[];
  /** The dragged piece's new end joints. */
  a: Vec2;
  b: Vec2;
  /** The run the drag moved: the dragged piece alone when it has no collinear neighbour. */
  run: string[];
  /** Every joint of the run that moved; the caller feeds these to planStore.moveWallEndpoint. */
  moves: JointMove[];
  /** How far it actually slid: less than asked when a wall hit the minimum. */
  offset: number;
  limited?: string;
}

/** The component of a plan-space delta that slides the wall sideways; the rest
 *  would slide it along itself, which the Select tool doesn't allow. */
export function normalComponent(wall: Wall, delta: Vec2): number {
  const n = wallNormal(wall);
  return delta.x * n.x + delta.y * n.y;
}

/** The wall at joint J whose direction is kept while J moves: the least parallel
 *  one, because its line crosses the run's new line at the steepest, most stable
 *  angle. Walls belonging to the run itself are not candidates — they move with
 *  it. Null at a free end. */
function guideAt(walls: Wall[], run: Set<string>, u: Vec2, J: Vec2): { o: Vec2; d: Vec2 } | null {
  let best: { o: Vec2; d: Vec2; cross: number } | null = null;
  for (const w of walls) {
    if (run.has(w.id) || wallLength(w) < JOINT_EPS) continue;
    const o = dist(w.a, J) < JOINT_EPS ? w.b : dist(w.b, J) < JOINT_EPS ? w.a : null;
    if (!o) continue;
    const len = dist(o, J);
    const d = { x: (o.x - J.x) / len, y: (o.y - J.y) / len };
    const cross = Math.abs(u.x * d.y - u.y * d.x);
    if (!best || cross > best.cross) best = { o, d, cross };
  }
  return best && { o: best.o, d: best.d };
}

/** One trial slide of a whole run, with no minimum-length check. */
function slide(walls: Wall[], wall: Wall, run: string[], offset: number): Omit<BodyDrag, "offset" | "run"> {
  const n = wallNormal(wall);
  const u = wallDirection(wall);
  const inRun = new Set(run);
  const moves: JointMove[] = runJoints(walls, run).map((j) => {
    // Project the joint onto the dragged piece's line before shifting, so the
    // whole run lands on ONE straight line even when its pieces differ by up to
    // RUN_ANGLE_DEG. For an exactly collinear run this changes nothing.
    const along = (j.from.x - wall.a.x) * u.x + (j.from.y - wall.a.y) * u.y;
    const on = { x: wall.a.x + u.x * along, y: wall.a.y + u.y * along };
    const shifted = { x: clean(on.x + n.x * offset), y: clean(on.y + n.y * offset) };
    const guide = guideAt(walls, inRun, u, j.from);
    if (!guide) return { ...j, to: shifted }; // free end: it just translates
    const cross = u.x * guide.d.y - u.y * guide.d.x;
    if (Math.abs(cross) < 1e-6) return { ...j, to: shifted }; // the joining wall runs parallel: no crossing to slide to
    // Where the run's new centre line meets the joining wall's line.
    const t = ((guide.o.x - shifted.x) * guide.d.y - (guide.o.y - shifted.y) * guide.d.x) / cross;
    return { ...j, to: { x: clean(shifted.x + u.x * t), y: clean(shifted.y + u.y * t) } };
  });
  const out = moveJoints(walls, moves);
  const moved = out.find((w) => w.id === wall.id)!;
  return { a: moved.a, b: moved.b, moves, walls: out };
}

/**
 * Slide `wallId` — and the whole straight run it belongs to — `offset` metres
 * along its normal. Every joint of the run moves by the same perpendicular
 * offset, so each piece keeps its direction and the run stays straight; each
 * joint lands where the run's new centre line crosses the line of the wall
 * meeting it there (a T's stem, or the wall at a corner), so those walls keep
 * their directions and stretch or shrink. A slide that would make any wall
 * shorter than MIN_WALL_LENGTH stops at that limit and says so.
 */
export function dragWallBody(walls: Wall[], wallId: string, offset: number): BodyDrag {
  const wall = walls.find((w) => w.id === wallId);
  if (!wall) return { walls, a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, offset: 0, run: [], moves: [] };
  // The whole straight wall moves, not just the piece under the pointer: a run of
  // one is the old behaviour, unchanged.
  const run = wallRun({ walls }, wallId);

  const blocked = (t: number) => slide(walls, wall, run, t).walls.some((w) => wallLength(w) < MIN_WALL_LENGTH);

  // Walk the slide, not just its end: a joining wall can shrink through nothing
  // and come out the far side longer again, which would quietly turn the plan
  // inside out. The first step that is blocked brackets the limit.
  // ponytail: 64 samples, so a dip narrower than 1/64 of one drag step is missed.
  const STEPS = 64;
  let bad = -1;
  for (let i = 1; i <= STEPS && bad < 0; i++) if (blocked((offset * i) / STEPS)) bad = i;
  if (bad < 0) return { ...slide(walls, wall, run, offset), offset, run };

  // Bisect inside the bracket for the furthest slide that keeps every wall long enough.
  let lo = (offset * (bad - 1)) / STEPS;
  let hi = (offset * bad) / STEPS;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (blocked(mid)) hi = mid;
    else lo = mid;
  }
  return {
    ...slide(walls, wall, run, lo),
    offset: lo,
    run,
    limited: `Stopped here: going further would make a joining wall shorter than ${MIN_WALL_LENGTH.toFixed(2)} m.`,
  };
}

// ---------------------------------------------------------------- typed edits

/** Where the b end goes for a typed length: along the wall's direction from a. */
export function lengthTarget(wall: Wall, length: number): Vec2 {
  const d = wallDirection(wall);
  return roundPoint({ x: wall.a.x + d.x * length, y: wall.a.y + d.y * length });
}

/** Clamp a typed field, with plain words when the value didn't fit. */
export function clampField(value: number, [min, max]: readonly [number, number], label: string): { value: number; note?: string } {
  if (value < min) return { value: min, note: `${label} can't be under ${min} m, so it's ${min} m.` };
  if (value > max) return { value: max, note: `${label} can't be over ${max} m, so it's ${max} m.` };
  return { value };
}

/** Problems `after` has that `before` didn't: what the panel warns about after an edit. */
export const newProblems = (before: string[], after: string[]) => after.filter((p) => !before.includes(p));
