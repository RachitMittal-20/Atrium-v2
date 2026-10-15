/**
 * geometry.ts — the Takeoff tool's pure geometry (step M.2a), in plan metres (x east,
 * y south), no React. Points are [x, y] tuples, the form a Takeoff stores. Every measure
 * returns edit.ts's { ok, value, reason }: a refusal is not ok and says why.
 *
 *   - polylineLength: the sum of the segments.
 *   - polygonArea: the shoelace formula, |Σ (x_i·y_{i+1} − x_{i+1}·y_i)| / 2, so a clockwise
 *     and a counter-clockwise outline give the same area; refused under 3 points or when two
 *     of its edges cross ("The outline crosses itself").
 *   - areaWithCutouts: the outer area minus each cutout's; a cutout must lie fully inside.
 *   - wallFaceLengths: a wall's centre line and its two faces, read from wallOutline, by
 *     default over the whole straight run (wallRun); pieces of different thicknesses give
 *     stepped faces, measured as the polyline with its steps.
 *   - snapTakeoffPoint: wall face corners, then (step P.1) the drawing's own corners and line
 *     ends, then centre-line endpoints, then door and window jambs, then wall midpoints, then
 *     the drawing's line midpoints, then the nearest point on a drawing line, each within its
 *     tolerance (the walls' and the drawing's are separate), else the 0.05 m grid. No snap (Alt)
 *     keeps the point; `orthoFrom` (Shift) keeps it level or plumb with that point.
 *
 * Connects to: src/lib/plan/{geometry,edit,rooms}.ts, src/lib/plan2d/openings.ts,
 * src/lib/pdf/snapIndex.ts (the drawing's points); used by
 * src/lib/takeoff/rows.ts, src/store/takeoffStore.ts, scripts/test-takeoff.ts.
 */
import { wallRun, type FaceEdit } from "@/lib/plan/edit";
import { JOINT_EPS, wallDirection, wallLength, wallOutline } from "@/lib/plan/geometry";
import { deriveRooms, pointInPolygon } from "@/lib/plan/rooms";
import { drawingCandidates, type SnapIndex } from "@/lib/pdf/snapIndex";
import { openingFrame } from "@/lib/plan2d/openings";
import type { Affine, DrawingSnapKind, Plan, Vec2 } from "@/types/plan";

export type Pt = [number, number];
export type Result<T> = FaceEdit<T>;

const ok = <T>(value: T): Result<T> => ({ ok: true, value, reason: null });
const no = <T>(reason: string): Result<T> => ({ ok: false, value: null, reason });
const v2 = (p: Pt): Vec2 => ({ x: p[0], y: p[1] });
const pt = (p: Vec2): Pt => [p.x, p.y];
const d = (p: Pt, q: Pt) => Math.hypot(q[0] - p[0], q[1] - p[1]);

export const NEEDS_TWO = "A length needs at least two points";
export const NEEDS_THREE = "An area needs at least three corners";
export const CROSSES = "The outline crosses itself";
export const NO_AREA = "The outline has no area";
export const CUTOUT_OUTSIDE = "Cutout is outside the area";

// ---------------------------------------------------------------- lengths and areas

export function polylineLength(points: Pt[]): Result<number> {
  if (points.length < 2) return no(NEEDS_TWO);
  let s = 0;
  for (let i = 1; i < points.length; i++) s += d(points[i - 1], points[i]);
  return ok(s);
}

/** Closed perimeter: the polyline back to its first point. */
export const perimeter = (points: Pt[]) => (points.length < 2 ? 0 : polylineLength([...points, points[0]]).value!);

const orient = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const EPS = 1e-12;

/** c lies on segment ab (collinear and inside its box). */
const onSegment = (a: Pt, b: Pt, c: Pt) =>
  Math.abs(orient(a, b, c)) <= EPS && c[0] >= Math.min(a[0], b[0]) - 1e-9 && c[0] <= Math.max(a[0], b[0]) + 1e-9 && c[1] >= Math.min(a[1], b[1]) - 1e-9 && c[1] <= Math.max(a[1], b[1]) + 1e-9;

/** Segments ab and cd cross or touch. */
function segmentsMeet(a: Pt, b: Pt, c: Pt, e: Pt): boolean {
  const [d1, d2, d3, d4] = [orient(c, e, a), orient(c, e, b), orient(a, b, c), orient(a, b, e)];
  const opposite = (p: number, q: number) => (p > EPS && q < -EPS) || (p < -EPS && q > EPS);
  if (opposite(d1, d2) && opposite(d3, d4)) return true;
  return onSegment(c, e, a) || onSegment(c, e, b) || onSegment(a, b, c) || onSegment(a, b, e);
}

/** Two non-neighbouring edges of the closed outline meet. ponytail: O(n²), fine for hand-clicked outlines. */
function selfCrossing(points: Pt[]): boolean {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // neighbours share a corner
      if (segmentsMeet(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** Shoelace, signed: positive when the points turn counter-clockwise in x-right, y-up terms. */
const signedArea = (points: Pt[]) => points.reduce((s, p, i) => s + p[0] * points[(i + 1) % points.length][1] - points[(i + 1) % points.length][0] * p[1], 0) / 2;

export function polygonArea(points: Pt[]): Result<number> {
  if (points.length < 3) return no(NEEDS_THREE);
  if (selfCrossing(points)) return no(CROSSES);
  const a = Math.abs(signedArea(points));
  return a < 1e-12 ? no(NO_AREA) : ok(a);
}

/** p is inside the polygon or on its edge. */
const insideOrOn = (poly: Pt[], p: Pt) => pointInPolygon(v2(p), poly.map(v2)) || poly.some((q, i) => onSegment(q, poly[(i + 1) % poly.length], p));

/** A cutout lies inside the outer outline: every corner inside or on it, and no edge crossing one of its edges. */
function cutoutInside(outer: Pt[], cut: Pt[]): boolean {
  if (!cut.every((p) => insideOrOn(outer, p))) return false;
  const opposite = (p: number, q: number) => (p > EPS && q < -EPS) || (p < -EPS && q > EPS);
  for (let i = 0; i < cut.length; i++) {
    const [a, b] = [cut[i], cut[(i + 1) % cut.length]];
    for (let j = 0; j < outer.length; j++) {
      const [c, e] = [outer[j], outer[(j + 1) % outer.length]];
      if (opposite(orient(c, e, a), orient(c, e, b)) && opposite(orient(a, b, c), orient(a, b, e))) return false; // a proper crossing
    }
    if (!insideOrOn(outer, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])) return false; // an edge that leaves through a corner
  }
  return true;
}

/** Outer minus cutouts. ponytail: overlapping cutouts are each subtracted; merge them first if that ever matters. */
export function areaWithCutouts(outer: Pt[], cutouts: Pt[][] = []): Result<number> {
  const base = polygonArea(outer);
  if (!base.ok) return base;
  let a = base.value;
  for (const c of cutouts) {
    const ca = polygonArea(c);
    if (!ca.ok) return ca;
    if (!cutoutInside(outer, c)) return no(CUTOUT_OUTSIDE);
    a -= ca.value;
  }
  return ok(a);
}

// ---------------------------------------------------------------- wall faces

export type Side = "left" | "centre" | "right";

export interface WallFaces {
  /** The run's piece ids in order along the picked wall's a→b. */
  pieces: string[];
  centre: number;
  left: number;
  right: number;
  /** The pieces' thicknesses differ, so the faces step at the joints. */
  stepped: boolean;
  /** Each line as a polyline along the picked wall's a→b (a face includes its steps). */
  lines: Record<Side, Pt[]>;
  /** Names of the rooms each face looks into, in order along the wall (none outside). */
  rooms: { left: string[]; right: string[] };
}

/** Append q unless it repeats the last point. */
const push = (line: Pt[], q: Pt) => {
  const last = line[line.length - 1];
  if (!last || d(last, q) > 1e-9) line.push(q);
};

/**
 * The centre line and both faces of `wallId` (left and right of ITS a→b), from wallOutline's
 * mitred corners: [a-right, b-right, b-left, a-left]. With `run` (the default) the whole straight
 * wall it was split into at T-junctions is measured, each piece turned to the picked wall's direction.
 */
export function wallFaceLengths(plan: Plan, wallId: string, opts: { run?: boolean } = {}): Result<WallFaces> {
  const picked = plan.walls.find((w) => w.id === wallId);
  if (!picked || wallLength(picked) < JOINT_EPS) return no("No wall there");
  const D = wallDirection(picked);
  const ids = opts.run === false ? [wallId] : wallRun(plan, wallId);
  const pieces = ids
    .map((id) => plan.walls.find((w) => w.id === id)!)
    .map((w) => {
      const [aR, bR, bL, aL] = wallOutline(w, plan.walls).map(pt);
      const same = wallDirection(w).x * D.x + wallDirection(w).y * D.y > 0;
      return same
        ? { w, start: pt(w.a), end: pt(w.b), right: [aR, bR], left: [aL, bL] }
        : { w, start: pt(w.b), end: pt(w.a), right: [bL, aL], left: [bR, aR] }; // a reversed piece's left is the picked wall's right
    })
    .sort((p, q) => (p.start[0] - q.start[0]) * D.x + (p.start[1] - q.start[1]) * D.y);

  const lines: Record<Side, Pt[]> = { centre: [], left: [], right: [] };
  for (const p of pieces) {
    push(lines.centre, p.start);
    push(lines.centre, p.end);
    for (const q of p.left) push(lines.left, q);
    for (const q of p.right) push(lines.right, q);
  }
  const n = { x: -D.y, y: D.x }; // the picked wall's left
  const derived = deriveRooms(plan);
  const roomsOn = (k: 1 | -1) => {
    const names: string[] = [];
    for (const p of pieces) {
      const m = { x: (p.start[0] + p.end[0]) / 2, y: (p.start[1] + p.end[1]) / 2 };
      const probe = { x: m.x + n.x * k * (p.w.thickness / 2 + 0.05), y: m.y + n.y * k * (p.w.thickness / 2 + 0.05) }; // 5 cm off the face
      const r = derived.find((room) => pointInPolygon(probe, room.polygon));
      if (r && !names.includes(r.name)) names.push(r.name);
    }
    return names;
  };
  const len = (line: Pt[]) => polylineLength(line).value ?? 0;
  return ok({
    pieces: pieces.map((p) => p.w.id),
    centre: len(lines.centre),
    left: len(lines.left),
    right: len(lines.right),
    stepped: pieces.some((p) => Math.abs(p.w.thickness - pieces[0].w.thickness) > 1e-9),
    lines,
    rooms: { left: roomsOn(1), right: roomsOn(-1) },
  });
}

/** Which line of a wall a pointer at signed distance `s` (m, + = left of a→b) from its centre line means: the middle quarter of the thickness, or `minCentre` (3 px), is the centre line. */
export const sideAt = (s: number, thickness: number, minCentre: number): Side => (Math.abs(s) <= Math.max(thickness / 8, minCentre) ? "centre" : s > 0 ? "left" : "right");

// ---------------------------------------------------------------- snapping

export type SnapKind = "corner" | "endpoint" | "jamb" | "midpoint" | "grid" | "free" | `drawing-${DrawingSnapKind}`;

/** The drawing kind a landing snapped to (step P.1), or null for a wall, grid or free landing. */
export const drawingKindOf = (k: SnapKind): DrawingSnapKind | null => (k.startsWith("drawing-") ? (k.slice(8) as DrawingSnapKind) : null);

/** The plan's vector PDF as a snap source (step P.1): its index, its mapping to plan metres and a tolerance in metres. */
export interface DrawingSource {
  index: SnapIndex;
  mapping: Affine;
  tolerance: number;
}
export interface SnapTarget {
  kind: Exclude<SnapKind, "grid" | "free">;
  point: Pt;
  wallId: string;
}
export const TAKEOFF_GRID = 0.05;

/** Every point a takeoff can snap to, in priority order: face corners, centre-line ends, jambs (both faces and the centre line), midpoints. */
export function snapTargets(plan: Pick<Plan, "walls" | "openings">): SnapTarget[] {
  const out: SnapTarget[] = [];
  const walls = plan.walls.filter((w) => wallLength(w) >= JOINT_EPS);
  for (const w of walls) for (const p of wallOutline(w, plan.walls)) out.push({ kind: "corner", point: pt(p), wallId: w.id });
  for (const w of walls) for (const p of [w.a, w.b]) out.push({ kind: "endpoint", point: pt(p), wallId: w.id });
  for (const o of plan.openings) {
    const w = walls.find((x) => x.id === o.wallId);
    if (!w) continue;
    const f = openingFrame(w, o);
    const h = w.thickness / 2;
    for (const e of [f.start, f.end]) for (const k of [h, 0, -h]) out.push({ kind: "jamb", point: [e.x + f.normal.x * k, e.y + f.normal.y * k], wallId: w.id });
  }
  for (const w of walls) out.push({ kind: "midpoint", point: [(w.a.x + w.b.x) / 2, (w.a.y + w.b.y) / 2], wallId: w.id });
  return out;
}

const clean = (v: number) => Math.round(v * 1e9) / 1e9; // strip float dust like 6e-17

/**
 * Where a takeoff click at `point` lands. With `snap` (default) the first kind of target with one
 * within `tolerance` metres wins, the nearest of that kind; else the 0.05 m grid. `snap: false`
 * (Alt) keeps the point as it is. `orthoFrom` (Shift) then keeps the point level or plumb with the
 * previous one, whichever is nearer the pointer's own direction: the snapped coordinate along that
 * axis stays, the other is the previous point's.
 */
export function snapTakeoffPoint(
  plan: Pick<Plan, "walls" | "openings">,
  point: Pt,
  tolerance: number,
  opts: { snap?: boolean; orthoFrom?: Pt | null; drawing?: DrawingSource | null } = {},
): Result<{ point: Pt; kind: SnapKind; ortho: boolean }> {
  let out: { point: Pt; kind: SnapKind } = { point: [point[0], point[1]], kind: "free" };
  if (opts.snap !== false) {
    const targets = snapTargets(plan);
    const dr = opts.drawing ? drawingCandidates(opts.drawing.index, opts.drawing.mapping, { x: point[0], y: point[1] }, opts.drawing.tolerance) : null;
    const nearestWall = (kind: SnapTarget["kind"]) => {
      let hit: SnapTarget | null = null;
      for (const t of targets) if (t.kind === kind && d(t.point, point) <= tolerance && (!hit || d(t.point, point) < d(hit.point, point))) hit = t;
      return hit && { point: hit.point, kind: hit.kind as SnapKind };
    };
    const fromDrawing = (h: { point: Pt; kind: DrawingSnapKind } | null | undefined) => h && { point: h.point, kind: `drawing-${h.kind}` as SnapKind };
    // The priority order (header): the first tier with anything in reach wins, the nearest in it.
    const tiers = [
      () => nearestWall("corner"),
      () => fromDrawing(dr?.point),
      () => nearestWall("endpoint"),
      () => nearestWall("jamb"),
      () => nearestWall("midpoint"),
      () => fromDrawing(dr?.mid),
      () => fromDrawing(dr?.edge),
    ];
    let hit: { point: Pt; kind: SnapKind } | null = null;
    for (const tier of tiers) if ((hit = tier() ?? null)) break;
    out = hit ? { point: [hit.point[0], hit.point[1]], kind: hit.kind } : { point: [clean(Math.round(point[0] / TAKEOFF_GRID) * TAKEOFF_GRID), clean(Math.round(point[1] / TAKEOFF_GRID) * TAKEOFF_GRID)], kind: "grid" };
  }
  const from = opts.orthoFrom;
  if (!from) return ok({ ...out, ortho: false });
  const level = Math.abs(point[0] - from[0]) >= Math.abs(point[1] - from[1]); // the pointer's own direction decides the axis
  return ok({ point: level ? [out.point[0], from[1]] : [from[0], out.point[1]], kind: out.kind, ortho: true });
}
