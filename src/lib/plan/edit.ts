/**
 * edit.ts — pure maths for selecting and editing walls (no React, no store):
 * hit-testing a pointer, snapping a dragged point, moving a joint, finding the
 * run of pieces one straight wall was split into, sliding a whole run sideways,
 * drawing new walls (where a click lands, whether a new wall is allowed, and
 * splitting the wall it joins at a T-junction), placing and editing doors and
 * windows (usable span, placement, slide, resize, height and sill, picking, the
 * door swing side and its migration), the 3D tools' opening edits (one side,
 * the top or the sill moved with the opposite edge fixed, and a slide along the
 * wall; step 4.7b), and the tolerances the editor works to. Every number the editor rounds or limits to is declared here and
 * printed by scripts/test-edit.ts. Connects to: src/types/plan.ts, ./geometry.ts;
 * src/lib/plan2d/openings.ts; called by src/components/plan2d/PlanCanvas.tsx,
 * src/components/studio/{WallPanel,OpeningPanel}.tsx and src/store/planStore.ts.
 *
 * Plan space: x → east, y → south. A wall's normal is the left of a→b.
 */
import { DOOR_SIZE, LEGACY_SWING, WALL_HEIGHT, WINDOW_SIZE } from "@/data/samplePlan";
import { doorSwing, openingFrame } from "@/lib/plan2d/openings";
import type { Opening, OpeningKind, Plan, SwingSide, Vec2, Wall } from "@/types/plan";
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
  /** null when snapping was off (Alt held): the point is only rounded to 1 cm.
   *  "wall" only comes from snapDraw: the point sits on a wall's centre line. */
  kind: SnapKind | "wall" | null;
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

// ---------------------------------------------------------------- drawing walls

/** A newly drawn wall's thickness (metres); the panel edits it afterwards. */
export const DRAW_THICKNESS = 0.15;

const sub = (p: Vec2, q: Vec2): Vec2 => ({ x: p.x - q.x, y: p.y - q.y });
const crossOf = (p: Vec2, q: Vec2) => p.x * q.y - p.y * q.x;
const dotOf = (p: Vec2, q: Vec2) => p.x * q.x + p.y * q.y;

/**
 * Where a click lands while drawing. The same priority as snapDrag (wall
 * endpoints, midpoints, 45°/90° rays from `from`, the 5 cm grid), with one step
 * added after midpoints: a pointer within `radius` of a wall's body lands ON that
 * wall's centre line ("wall"), so the new wall meets it in a T-junction instead
 * of stopping a few millimetres short. When a 45°/90° ray from `from` crosses
 * that wall in reach, the crossing is used, so the angle is kept. A landing
 * closer than MIN_WALL_LENGTH to the wall's end takes the end itself: splitting
 * there would leave a piece too short to keep.
 *
 * Landings on existing geometry (endpoint, midpoint, wall) keep their exact
 * coordinates, so the new wall shares the joint; free landings are on the 5 cm
 * grid or a ray, and Alt (`free`) rounds to 1 cm with no snapping at all.
 */
export function snapDraw(p: Vec2, walls: Wall[], opts: { from?: Vec2; radius: number; free?: boolean }): Snap {
  if (opts.free) return { point: roundPoint(p), kind: null };
  const base = snapPoint(p, walls, { from: opts.from, radius: opts.radius });
  if (base.kind === "endpoint" || base.kind === "midpoint") return base;

  let host: Wall | null = null;
  let best = opts.radius;
  for (const w of walls) {
    if (wallLength(w) < JOINT_EPS) continue;
    const d = pointToWallDistance(p, w);
    if (d <= best) [best, host] = [d, w];
  }
  if (!host) return base;

  const len = wallLength(host);
  const u = wallDirection(host);
  const alongOf = (q: Vec2) => dotOf(sub(q, host.a), u);
  let at: Vec2 | null = null;
  const { from } = opts;
  if (base.kind === "angle" && from) {
    // Where the ray from `from` through the angle snap crosses the wall's centre line.
    const ray = sub(base.point, from);
    const rayLen = Math.hypot(ray.x, ray.y);
    const c = crossOf(ray, u);
    if (rayLen > JOINT_EPS && Math.abs(c) > 1e-9) {
      const t = crossOf(sub(host.a, from), u) / c; // fraction of `ray`
      const q = { x: from.x + ray.x * t, y: from.y + ray.y * t };
      const s = alongOf(q);
      if (t > 0 && s >= 0 && s <= len && dist(q, p) <= opts.radius) at = q;
    }
  }
  if (!at) {
    // Project the 1 cm-rounded pointer onto the centre line: on an axis-aligned
    // wall that keeps the landing on the 1 cm grid as well as on the wall.
    const s = Math.max(0, Math.min(len, alongOf(roundPoint(p))));
    at = { x: host.a.x + u.x * s, y: host.a.y + u.y * s };
  }
  const s = alongOf(at);
  if (s < MIN_WALL_LENGTH) return { point: host.a, kind: "endpoint" };
  if (len - s < MIN_WALL_LENGTH) return { point: host.b, kind: "endpoint" };
  return { point: { x: clean(at.x), y: clean(at.y) }, kind: "wall" };
}

/** True when `p` is an existing wall endpoint (a joint). */
export const isJoint = (walls: Wall[], p: Vec2) => walls.some((w) => dist(w.a, p) < JOINT_EPS || dist(w.b, p) < JOINT_EPS);

/** The wall whose MIDDLE `p` lies on (within JOINT_EPS of its centre line, away
 *  from both ends): a new wall ending there must split it into two pieces. */
export function hostAt(walls: Wall[], p: Vec2): string | null {
  for (const w of walls) {
    if (wallLength(w) < JOINT_EPS || dist(w.a, p) < JOINT_EPS || dist(w.b, p) < JOINT_EPS) continue;
    if (pointToWallDistance(p, w) < JOINT_EPS) return w.id;
  }
  return null;
}

/** A click that lands on what's already drawn (a joint or a wall's body) ends a
 *  drawing chain: the new wall has joined the plan. */
export const landsOnPlan = (walls: Wall[], p: Vec2) => isJoint(walls, p) || hostAt(walls, p) !== null;

export interface WallSplit {
  /** The host's two pieces: the first keeps its id (a → at), the second is new (at → b). */
  pieces: [Wall, Wall];
  /** Openings that move to the second piece, with their new offset from its a end. */
  moved: Pick<Opening, "id" | "wallId" | "offset">[];
}

/**
 * Split `wallId` at `at` (projected onto its centre line) into two collinear
 * pieces, the CLAUDE.md T-junction convention. Openings past the split move to
 * the second piece with their offset re-measured from its a end; an opening the
 * split would cut through, or a piece shorter than MIN_WALL_LENGTH, is refused
 * with plain words instead.
 */
export function splitWallAt(plan: Pick<Plan, "walls" | "openings">, wallId: string, at: Vec2, newId: string): WallSplit | { error: string } {
  const wall = plan.walls.find((w) => w.id === wallId);
  if (!wall) return { error: "That wall is no longer in the plan." };
  const len = wallLength(wall);
  const u = wallDirection(wall);
  const t = dotOf(sub(at, wall.a), u); // distance from a along the wall
  if (t < MIN_WALL_LENGTH - 1e-9 || len - t < MIN_WALL_LENGTH - 1e-9) {
    return { error: `Too close to the end of a wall: each part must be at least ${MIN_WALL_LENGTH.toFixed(2)} m.` };
  }
  const moved: WallSplit["moved"] = [];
  for (const o of plan.openings) {
    if (o.wallId !== wallId) continue;
    const [start, end] = [o.offset - o.width / 2, o.offset + o.width / 2];
    if (end <= t + JOINT_EPS) continue; // stays on the first piece, offset unchanged
    if (start >= t - JOINT_EPS) moved.push({ id: o.id, wallId: newId, offset: clean(o.offset - t) });
    else return { error: `A wall can't join in the middle of a ${o.kind}.` };
  }
  const point = { x: clean(wall.a.x + u.x * t), y: clean(wall.a.y + u.y * t) };
  return {
    pieces: [
      { ...wall, a: { ...wall.a }, b: point },
      { ...wall, id: newId, a: { ...point }, b: { ...wall.b } },
    ],
    moved,
  };
}

/**
 * Why a wall from `a` to `b` can't be added to the plan, or null when it can.
 * Only the rules that keep the wall graph valid: the 0.2 m minimum, a T-junction
 * landing that splitWallAt accepts, and no crossing or running along an existing
 * wall — walls meet only at shared joints (CLAUDE.md Conventions), so a crossing
 * would leave rooms the derivation can't see.
 */
export function drawProblem(plan: Pick<Plan, "walls" | "openings">, a: Vec2, b: Vec2): string | null {
  const len = dist(a, b);
  if (len < MIN_WALL_LENGTH - 1e-9) return `Walls can't be shorter than ${MIN_WALL_LENGTH.toFixed(2)} m.`; // 1e-9: 1.2 - 1 is 0.1999…
  for (const p of [a, b]) {
    const host = hostAt(plan.walls, p);
    if (!host) continue;
    const split = splitWallAt(plan, host, p, "probe");
    if ("error" in split) return split.error;
  }
  const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  for (const w of plan.walls) {
    const wl = wallLength(w);
    if (wl < JOINT_EPS) continue;
    const e = wallDirection(w);
    const c = crossOf(d, e);
    if (Math.abs(c) < 1e-6) {
      // Parallel: a problem only on the same line with some shared length.
      if (Math.abs(crossOf(sub(w.a, a), d)) >= JOINT_EPS) continue;
      const [s0, s1] = [dotOf(sub(w.a, a), d), dotOf(sub(w.b, a), d)].sort((x, y) => x - y);
      if (Math.min(len, s1) - Math.max(0, s0) > JOINT_EPS) return "This wall would run along an existing wall.";
      continue;
    }
    // Where the two centre lines cross; fine when it is one of the new wall's ends.
    const t = crossOf(sub(w.a, a), e) / c;
    const x = { x: a.x + d.x * t, y: a.y + d.y * t };
    if (dist(x, a) < JOINT_EPS || dist(x, b) < JOINT_EPS) continue;
    if (t > 0 && t < len && pointToWallDistance(x, w) < JOINT_EPS) {
      return "This wall would cross another wall. End it where they meet, then carry on from there.";
    }
  }
  return null;
}

/** A new wall's thickness and height: DRAW_THICKNESS, and the plan's commonest
 *  wall height so it stands as tall as its neighbours (2.7 m in an empty plan). */
export function drawDefaults(walls: Wall[]): Pick<Wall, "thickness" | "height"> {
  const counts = new Map<number, number>();
  for (const w of walls) counts.set(roundTo(w.height), (counts.get(roundTo(w.height)) ?? 0) + 1);
  let height = WALL_HEIGHT;
  let most = 0;
  for (const [h, n] of counts) if (n > most) [height, most] = [h, n];
  return { thickness: DRAW_THICKNESS, height };
}

/** Where a typed length puts the wall's end: `length` metres from `from` towards
 *  `toward`, rounded to 1 cm like lengthTarget. Null without a direction. */
export function typedTarget(from: Vec2, toward: Vec2, length: number): Vec2 | null {
  const d = dist(from, toward);
  if (d < JOINT_EPS) return null;
  return roundPoint({ x: from.x + ((toward.x - from.x) / d) * length, y: from.y + ((toward.y - from.y) / d) * length });
}

// ---------------------------------------------------------------- doors and windows

export { LEGACY_SWING };

/** How wide an opening may be (metres). */
export const OPENING_WIDTH_RANGE = [0.3, 4] as const;
/** What the Door and Window tools place; heights and sills are the importer's own. */
export const OPENING_DEFAULTS = {
  door: { width: 0.9, ...DOOR_SIZE },
  window: { width: 1.2, ...WINDOW_SIZE },
} as const;
export const DOOR_HEIGHT_MIN = 1.8;
export const WINDOW_HEIGHT_MIN = 0.3;
/** An opening's centre snaps to this step along its wall when not at the midpoint. */
export const OPENING_STEP = 0.05;
/** At a shallow joint the joining wall's face crosses the centre line far out;
 *  its clearance is capped at this many half-thicknesses, like the mitre limit. */
const CLEAR_CAP = 4;

type Openings = Pick<Plan, "walls" | "openings">;
type NewOpening = Omit<Opening, "id"> & { id?: string };

/** The other side. A door with no side yet counts as LEGACY_SWING. */
export const flipSide = (side: SwingSide | undefined): SwingSide => ((side ?? LEGACY_SWING) === "left" ? "right" : "left");

/**
 * Migration for plans made before swing sides were stored: every door without a
 * valid side gets LEGACY_SWING ("left" of a→b, which is what the 2D plan always
 * drew), and a window loses any side. Openings that need nothing come back as
 * the same objects. Run by planStore on the initial plan and on loadPlan.
 */
export function withSwingSides(openings: Opening[]): Opening[] {
  return openings.map((o) => {
    if (o.kind === "door") return o.swing === "left" || o.swing === "right" ? o : { ...o, swing: LEGACY_SWING };
    if (o.swing === undefined) return o;
    const rest = { ...o };
    delete rest.swing;
    return rest;
  });
}

/**
 * The part of a wall an opening may use, as distances from its a end. Each end
 * loses the room the walls joined there take up across it — half the thickest
 * one's thickness, more at a slanted joint (capped) — so no opening cuts into a
 * corner or a T. A collinear neighbour (the rest of a split run) takes nothing,
 * and a free end loses nothing. Null for an unknown wall.
 */
export function usableSpan(walls: Wall[], wallId: string): { start: number; end: number } | null {
  const wall = walls.find((w) => w.id === wallId);
  if (!wall) return null;
  const u = wallDirection(wall);
  const clearAt = (J: Vec2) => {
    let c = 0;
    for (const w of walls) {
      if (w.id === wall.id || wallLength(w) < JOINT_EPS) continue;
      const spoke = spokeAt(w, J);
      if (!spoke) continue;
      const sin = Math.abs(crossOf(u, spoke));
      if (sin <= RUN_SIN) continue; // the run carries straight on: nothing in the way
      c = Math.max(c, Math.min(CLEAR_CAP, 1 / sin) * (w.thickness / 2));
    }
    return c;
  };
  return { start: clean(clearAt(wall.a)), end: clean(wallLength(wall) - clearAt(wall.b)) };
}

const onWall = (plan: Openings, wallId: string, except?: string) => plan.openings.filter((o) => o.wallId === wallId && o.id !== except);
const edges = (o: Pick<Opening, "offset" | "width">) => [o.offset - o.width / 2, o.offset + o.width / 2] as const;

/**
 * Why an opening can't be in the plan as given, or null when it can: its wall
 * exists, it is at least the minimum width, it sits inside the wall's usable
 * span, it overlaps no other opening on that wall, and it doesn't reach above
 * the wall. The rule every placement and edit is checked against.
 */
export function openingProblem(plan: Openings, o: NewOpening): string | null {
  const wall = plan.walls.find((w) => w.id === o.wallId);
  if (!wall) return "That wall is no longer in the plan.";
  if (o.width < OPENING_WIDTH_RANGE[0] - 1e-9) return `Openings can't be narrower than ${OPENING_WIDTH_RANGE[0]} m.`;
  const span = usableSpan(plan.walls, wall.id)!;
  const [start, end] = edges(o);
  if (start < span.start - 1e-9 || end > span.end + 1e-9) {
    const room = Math.max(0, span.end - span.start);
    return room < o.width - 1e-9
      ? `This wall only has room for an opening ${room.toFixed(2)} m wide.`
      : `A ${o.kind} must sit fully inside its wall, clear of the walls at its ends.`;
  }
  for (const x of onWall(plan, wall.id, o.id)) {
    const [xs, xe] = edges(x);
    if (start < xe - 1e-9 && xs < end - 1e-9) return `It would overlap the ${x.kind} already on this wall.`;
  }
  if (o.sillHeight < -1e-9 || o.sillHeight + o.height > wall.height + 1e-9) return `A ${o.kind} can't reach above the top of its wall (${wall.height} m).`;
  return null;
}

export interface OpeningSnap {
  wallId: string;
  /** Where the centre would go, from the wall's a end. */
  offset: number;
  kind: "midpoint" | "grid";
}

/**
 * The wall a Door or Window tool pointer is over, and where along it the
 * opening's centre would go. The nearest wall whose band (half its thickness
 * plus `tol`) holds the pointer wins; the pointer is projected onto that wall's
 * centre line — the same line Opening.offset is measured along — and snaps to
 * the midpoint within `radius`, else to OPENING_STEP. Null away from every wall.
 */
export function snapOpening(p: Vec2, walls: Wall[], opts: { tol: number; radius: number }): OpeningSnap | null {
  let best: Wall | null = null;
  let bestD = Infinity;
  for (const w of walls) {
    if (wallLength(w) < JOINT_EPS) continue;
    const d = pointToWallDistance(p, w);
    if (d <= w.thickness / 2 + opts.tol && d < bestD) [best, bestD] = [w, d];
  }
  if (!best) return null;
  const len = wallLength(best);
  const along = Math.max(0, Math.min(len, dotOf(sub(p, best.a), wallDirection(best))));
  if (Math.abs(along - len / 2) <= opts.radius) return { wallId: best.id, offset: clean(len / 2), kind: "midpoint" };
  return { wallId: best.id, offset: Math.max(0, Math.min(len, roundTo(along, OPENING_STEP))), kind: "grid" };
}

/**
 * A new door or window of the default size centred `centre` metres along
 * `wallId`, or why not. A centre outside the wall's usable span (on or past an
 * end, or in a corner) is refused; one inside it slides just far enough for the
 * whole opening to fit. A wall too short for it, or an overlap with an opening
 * already there, is refused. Doors get LEGACY_SWING; the inspector flips them.
 */
export function placeOpening(plan: Openings, kind: OpeningKind, wallId: string, centre: number): { opening: Omit<Opening, "id"> } | { error: string } {
  const span = usableSpan(plan.walls, wallId);
  if (!span) return { error: "That wall is no longer in the plan." };
  const d = OPENING_DEFAULTS[kind];
  const room = span.end - span.start;
  if (room < d.width - 1e-9) return { error: `This wall is too short for a ${d.width.toFixed(2)} m ${kind}: it has room for ${Math.max(0, room).toFixed(2)} m.` };
  if (centre < span.start || centre > span.end) return { error: `Too close to the end of the wall: a ${kind} has to sit clear of the corner.` };
  const offset = clean(Math.min(span.end - d.width / 2, Math.max(span.start + d.width / 2, centre)));
  const opening: Omit<Opening, "id"> = { wallId, kind, offset, width: d.width, height: d.height, sillHeight: d.sillHeight, ...(kind === "door" ? { swing: LEGACY_SWING } : {}) };
  const problem = openingProblem(plan, opening);
  return problem ? { error: problem } : { opening };
}

interface FreeRange {
  /** The free stretch of wall around the opening: span ends or neighbours' edges. */
  loEdge: number;
  hiEdge: number;
  /** What bounds each side, in words. */
  loBy: string;
  hiBy: string;
}

/** The stretch of its wall an opening can move and grow in without leaving the
 *  usable span or touching a neighbour. Null for an unknown opening or wall. */
export function freeRange(plan: Openings, id: string): FreeRange | null {
  const o = plan.openings.find((x) => x.id === id);
  const span = o && usableSpan(plan.walls, o.wallId);
  if (!o || !span) return null;
  const r: FreeRange = { loEdge: span.start, hiEdge: span.end, loBy: "the end of the wall", hiBy: "the end of the wall" };
  for (const x of onWall(plan, o.wallId, o.id)) {
    const [xs, xe] = edges(x);
    if (x.offset < o.offset) {
      if (xe > r.loEdge) [r.loEdge, r.loBy] = [xe, `the ${x.kind} next to it`];
    } else if (xs < r.hiEdge) [r.hiEdge, r.hiBy] = [xs, `the ${x.kind} next to it`];
  }
  return r;
}

/** Slide an opening along its wall to centre `offset`, stopping at the usable
 *  span's ends and at its neighbours, and saying what stopped it. */
export function slideOpening(plan: Openings, id: string, offset: number): { offset: number; limited?: string } {
  const o = plan.openings.find((x) => x.id === id);
  const r = freeRange(plan, id);
  if (!o || !r) return { offset };
  const [lo, hi] = [r.loEdge + o.width / 2, r.hiEdge - o.width / 2];
  if (lo > hi + 1e-9) return { offset: o.offset, limited: "There's no room to move it here." };
  if (offset < lo) return { offset: clean(lo), limited: `Stopped here: it can't go past ${r.loBy}.` };
  if (offset > hi) return { offset: clean(hi), limited: `Stopped here: it can't go past ${r.hiBy}.` };
  return { offset };
}

/**
 * A typed width for an opening: clamped to OPENING_WIDTH_RANGE and to the free
 * stretch it sits in, with the reason. The centre stays put when the new width
 * fits around it, and shifts just enough when it doesn't.
 */
export function resizeOpening(plan: Openings, id: string, width: number): { width: number; offset: number; note?: string } | { error: string } {
  const o = plan.openings.find((x) => x.id === id);
  const r = freeRange(plan, id);
  if (!o || !r) return { error: "That opening is no longer in the plan." };
  const [min, max] = OPENING_WIDTH_RANGE;
  const room = r.hiEdge - r.loEdge;
  if (room < min - 1e-9) return { error: "There's no room for it to be any wider here." };
  let w = width;
  let note: string | undefined;
  if (w < min) [w, note] = [min, `Openings can't be narrower than ${min} m, so it's ${min} m.`];
  if (w > max) [w, note] = [max, `Openings can't be wider than ${max} m, so it's ${max} m.`];
  if (w > room + 1e-9) [w, note] = [room, `Only ${room.toFixed(2)} m fits here, between ${r.loBy} and ${r.hiBy}.`];
  const offset = Math.min(r.hiEdge - w / 2, Math.max(r.loEdge + w / 2, o.offset));
  return { width: clean(w), offset: clean(offset), ...(note ? { note } : {}) };
}

/**
 * A typed height or sill, clamped so the opening stays between the floor and
 * the top of its wall, with the reason. Doors start at the floor: their sill is
 * not editable. Door heights start at DOOR_HEIGHT_MIN, window heights at
 * WINDOW_HEIGHT_MIN.
 */
export function openingSize(plan: Openings, id: string, key: "height" | "sillHeight", value: number): { value: number; note?: string } | { error: string } {
  const o = plan.openings.find((x) => x.id === id);
  const wall = o && plan.walls.find((w) => w.id === o.wallId);
  if (!o || !wall) return { error: "That opening is no longer in the plan." };
  if (key === "sillHeight") {
    if (o.kind === "door") return { error: "Doors start at the floor, so they have no sill." };
    const max = wall.height - o.height;
    if (value < 0) return { value: 0, note: "The sill can't be below the floor, so it's 0 m." };
    if (value > max) return { value: clean(max), note: `With a ${o.height} m window the sill can't be over ${max.toFixed(2)} m, or it would pass the top of the wall.` };
    return { value };
  }
  const min = o.kind === "door" ? DOOR_HEIGHT_MIN : WINDOW_HEIGHT_MIN;
  const max = wall.height - o.sillHeight;
  if (value < min) return { value: min, note: `A ${o.kind} can't be under ${min} m tall, so it's ${min} m.` };
  if (value > max) return { value: clean(max), note: `It can't reach past the top of its ${wall.height} m wall, so it's ${max.toFixed(2)} m.` };
  return { value };
}

/** An opening hit: which one, and whether it was on the opening's own stretch
 *  of wall band (`band`) or only inside a door's swing. */
export interface OpeningHit {
  id: string;
  band: boolean;
}

/**
 * The opening under `p` (plan metres), or null. A hit is either the opening's
 * own stretch of wall band — half the wall's thickness plus `tol` across, and
 * only JOINT_EPS past each end, so the wall beside the gap stays the wall's at
 * any zoom — or, for a door, the quarter circle its leaf sweeps, grown by
 * `tol` on every side. The growth matters: the drawn leaf lies on one straight
 * edge of that quarter circle and the drawn arc on its rim, so with no tolerance
 * half of every click on the visible symbol fell outside it (the 4.5 manual
 * failure). The nearest band hit wins and beats any swing hit.
 */
export function pickOpeningAt(p: Vec2, plan: Openings, tol: number): OpeningHit | null {
  let best: (OpeningHit & { d: number }) | null = null;
  for (const o of plan.openings) {
    const wall = plan.walls.find((w) => w.id === o.wallId);
    if (!wall || wallLength(wall) < JOINT_EPS) continue;
    const f = openingFrame(wall, o);
    const along = dotOf(sub(p, f.start), f.dir);
    const across = Math.abs(dotOf(sub(p, f.centre), f.normal));
    let hit: (OpeningHit & { d: number }) | null = null;
    if (along >= -JOINT_EPS && along <= o.width + JOINT_EPS && across <= wall.thickness / 2 + tol) hit = { id: o.id, band: true, d: across };
    else if (o.kind === "door") {
      const sw = doorSwing(wall, o);
      const v = sub(p, sw.hinge);
      const leafLen = Math.hypot(sw.leafEnd.x - sw.hinge.x, sw.leafEnd.y - sw.hinge.y);
      const leaf = leafLen > 0 ? { x: (sw.leafEnd.x - sw.hinge.x) / leafLen, y: (sw.leafEnd.y - sw.hinge.y) / leafLen } : f.normal;
      // The swing quarter circle, every edge pushed out by `tol`: past the arc, behind the leaf, before the hinge.
      if (Math.hypot(v.x, v.y) <= o.width + tol && dotOf(v, f.dir) >= -tol && dotOf(v, leaf) >= -tol) hit = { id: o.id, band: false, d: wall.thickness / 2 + tol };
    }
    if (hit && hit.d < (best?.d ?? Infinity)) best = hit;
  }
  return best && { id: best.id, band: best.band };
}

/** The id of the opening under `p`, or null: pickOpeningAt without the detail. */
export const pickOpening = (p: Vec2, plan: Openings, tol: number): string | null => pickOpeningAt(p, plan, tol)?.id ?? null;

/** What one Select-tool press picks. */
export type PickTarget = { kind: "handle"; wallId: string; end: "a" | "b" } | { kind: "opening"; id: string } | { kind: "wall"; wallId: string };

/**
 * What a Select-tool press at `p` selects, in this order: a wall's end handle
 * (so joints stay draggable), then a door or window — its stretch of wall band
 * always, its swing unless the press is physically ON a wall (within half its
 * thickness, not merely within the pick tolerance: at low zoom that tolerance
 * covers the drawn leaf) — then a wall body, then nothing (empty space). Tolerances are metres: the caller divides
 * its pixel tolerances by the view scale. `prefer` breaks ties at a shared
 * joint in favour of the selected wall, as in pickWall.
 */
export function pickTarget(p: Vec2, plan: Openings, tol: { wall: number; handle: number; opening: number }, prefer?: string | null): PickTarget | null {
  const wall = pickWall(p, plan.walls, tol.wall, tol.handle, prefer);
  if (wall?.end) return { kind: "handle", wallId: wall.wallId, end: wall.end };
  const op = pickOpeningAt(p, plan, tol.opening);
  if (op) {
    const near = wall && plan.walls.find((w) => w.id === wall.wallId);
    const onWall = !!near && pointToWallDistance(p, near) <= near.thickness / 2;
    if (op.band || !onWall) return { kind: "opening", id: op.id };
  }
  return wall ? { kind: "wall", wallId: wall.wallId } : null;
}

// ---------------------------------------------------------------- 3D opening faces (step 4.7b)

/**
 * What a 3D opening edit says: `ok` false only when the edit is refused outright
 * (an opening that is gone, a door's sill); a value clamped to a limit is ok, with
 * the reason in plain words. All values are metres, rounded to 1 cm.
 */
export type FaceEdit<T> = { ok: true; value: T; reason: string | null } | { ok: false; value: null; reason: string };

export const DOOR_ON_FLOOR = "A door stays on the floor";
export const NEXT_TO_OPENING = "Next to another opening";
const GONE: FaceEdit<never> = { ok: false, value: null, reason: "That opening is no longer in the plan." };

/**
 * Move ONE side of an opening along its wall, SketchUp style: the dragged edge
 * ("A" is the side nearer the wall's a end, "B" the side nearer b) goes to
 * `edgeOffset` metres from the wall's a end and the other edge stays exactly
 * where it is. The width is rounded to 1 cm and held to OPENING_WIDTH_RANGE and to
 * the free stretch on the dragged side: the usable span's end, or the neighbouring
 * opening ("Next to another opening"). Compare resizeOpening, which keeps the centre.
 */
export function resizeOpeningEdge(plan: Openings, id: string, edge: "A" | "B", edgeOffset: number): FaceEdit<{ offset: number; width: number }> {
  const o = plan.openings.find((x) => x.id === id);
  const r = freeRange(plan, id);
  if (!o || !r) return GONE;
  const [lo, hi] = edges(o);
  const [min, max] = OPENING_WIDTH_RANGE;
  const room = edge === "B" ? r.hiEdge - lo : hi - r.loEdge; // how wide it can get with the fixed edge where it is
  const by = edge === "B" ? r.hiBy : r.loBy;
  if (room < min - 1e-9) return { ok: true, value: { offset: o.offset, width: o.width }, reason: "There's no room for it to be any wider here." };
  let width = roundTo(edge === "B" ? edgeOffset - lo : hi - edgeOffset);
  let reason: string | null = null;
  if (width < min) [width, reason] = [min, `Openings can't be narrower than ${min} m, so it's ${min} m.`];
  if (width > max) [width, reason] = [max, `Openings can't be wider than ${max} m, so it's ${max} m.`];
  if (width > room + 1e-9) [width, reason] = [clean(room), by === "the end of the wall" ? "Stopped at the end of the wall" : NEXT_TO_OPENING];
  return { ok: true, value: { offset: clean(edge === "B" ? lo + width / 2 : hi - width / 2), width }, reason };
}

/**
 * Move the top of an opening to `top` metres above the floor; the bottom (the
 * sill, or the floor for a door) stays. A door is at least DOOR_HEIGHT_MIN tall,
 * a window WINDOW_HEIGHT_MIN, and sill + height never passes the wall's top
 * ("Wall is 2.70 m high").
 */
export function resizeOpeningHead(plan: Openings, id: string, top: number): FaceEdit<{ height: number }> {
  const o = plan.openings.find((x) => x.id === id);
  const wall = o && plan.walls.find((w) => w.id === o.wallId);
  if (!o || !wall) return GONE;
  const min = o.kind === "door" ? DOOR_HEIGHT_MIN : WINDOW_HEIGHT_MIN;
  const max = wall.height - o.sillHeight;
  let height = roundTo(top - o.sillHeight);
  let reason: string | null = null;
  if (height < min) [height, reason] = [min, `A ${o.kind} can't be under ${min} m tall, so it's ${min} m.`];
  if (height > max + 1e-9) [height, reason] = [clean(max), `Wall is ${wall.height.toFixed(2)} m high`];
  return { ok: true, value: { height }, reason };
}

/**
 * Move a window's sill to `sill` metres above the floor; the top stays, so the
 * window gets taller as the sill goes down. The sill never goes below the floor
 * (the OpeningPanel's minimum) and the window keeps WINDOW_HEIGHT_MIN. A door is
 * refused: "A door stays on the floor".
 */
export function resizeOpeningSill(plan: Openings, id: string, sill: number): FaceEdit<{ sillHeight: number; height: number }> {
  const o = plan.openings.find((x) => x.id === id);
  if (!o || !plan.walls.some((w) => w.id === o.wallId)) return GONE;
  if (o.kind === "door") return { ok: false, value: null, reason: DOOR_ON_FLOOR };
  const top = o.sillHeight + o.height;
  const highest = top - WINDOW_HEIGHT_MIN;
  let s = roundTo(sill);
  let reason: string | null = null;
  if (s < 0) [s, reason] = [0, "The sill can't be below the floor, so it's 0 m."];
  if (s > highest + 1e-9) [s, reason] = [clean(highest), `A window can't be under ${WINDOW_HEIGHT_MIN} m tall, so the sill stops at ${highest.toFixed(2)} m.`];
  return { ok: true, value: { sillHeight: s, height: clean(top - s) }, reason };
}

/**
 * Slide an opening along its wall to centre `offset`, as the 2D tools do: the
 * centre snaps to the wall's midpoint within `radius` metres, else to OPENING_STEP
 * (`free`, Alt: rounded to 1 cm), then slideOpening holds it inside the usable span
 * and clear of its neighbours, saying what stopped it.
 */
export function moveOpening(plan: Openings, id: string, offset: number, opts: { radius: number; free?: boolean }): FaceEdit<{ offset: number; snap: "midpoint" | "grid" | null }> {
  const o = plan.openings.find((x) => x.id === id);
  const wall = o && plan.walls.find((w) => w.id === o.wallId);
  if (!o || !wall) return GONE;
  const half = clean(wallLength(wall) / 2);
  const snap = opts.free ? null : Math.abs(offset - half) <= opts.radius ? "midpoint" : "grid";
  const at = snap === "midpoint" ? half : roundTo(offset, snap === "grid" ? OPENING_STEP : ROUND_STEP);
  const slid = slideOpening(plan, id, at);
  return { ok: true, value: { offset: slid.offset, snap: slid.limited ? null : snap }, reason: slid.limited ?? null };
}
