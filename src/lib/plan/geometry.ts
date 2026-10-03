/**
 * geometry.ts — pure 2D geometry for walls: lengths and normals, mitred wall
 * outlines, snapping, and keeping openings inside their wall. No React, no
 * store. Connects to: src/types/plan.ts; used by validate.ts, planStore.ts and
 * (later) the 3D wall builder and the 2D plan editor.
 *
 * Plan space: x → east, y → south. "Left" below is the mathematical left of the
 * direction a→b, i.e. normal = (-dy, dx).
 */
import type { Opening, Vec2, Wall } from "@/types/plan";

/** Endpoints closer than this (metres) count as the same joint. */
export const JOINT_EPS = 0.01;
const GRID = 0.05;
const SNAP_RADIUS = 0.15;
/** A mitre corner further than this × half-thickness from the joint is cut square instead. */
const MITER_LIMIT = 8;

type Segment = Pick<Wall, "a" | "b">;

export const dist = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.y - q.y);
export const wallLength = (w: Segment) => dist(w.a, w.b);

/** Unit vector a→b; (0,0) for a zero-length wall. */
export function wallDirection(w: Segment): Vec2 {
  const len = wallLength(w);
  return len === 0 ? { x: 0, y: 0 } : { x: (w.b.x - w.a.x) / len, y: (w.b.y - w.a.y) / len };
}

/** Unit left-hand normal of the wall direction. */
export function wallNormal(w: Segment): Vec2 {
  const d = wallDirection(w);
  return { x: -d.y, y: d.x };
}

/** True when no OTHER wall ends at `p`: a free wall end, whose end face can be seen (a split, a T stem or a corner covers it). */
export const isFreeEnd = (walls: Wall[], wallId: string, p: Vec2) =>
  !walls.some((o) => o.id !== wallId && wallLength(o) >= JOINT_EPS && (dist(o.a, p) < JOINT_EPS || dist(o.b, p) < JOINT_EPS));

/** Shortest distance from p to the wall's centre line (a segment, not an infinite line). */
export function pointToWallDistance(p: Vec2, w: Segment): number {
  const dx = w.b.x - w.a.x;
  const dy = w.b.y - w.a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - w.a.x) * dx + (p.y - w.a.y) * dy) / len2));
  return dist(p, { x: w.a.x + t * dx, y: w.a.y + t * dy });
}

// ---------------------------------------------------------------- outlines

/** One wall as seen from a joint: unit direction pointing away from it. */
interface Spoke {
  id: string;
  u: Vec2;
  n: Vec2; // left normal of u
  h: number; // half thickness
  angle: number;
}

function makeSpoke(id: string, thickness: number, from: Vec2, to: Vec2): Spoke {
  const d = dist(from, to);
  const u = { x: (to.x - from.x) / d, y: (to.y - from.y) / d };
  return { id, u, n: { x: -u.y, y: u.x }, h: thickness / 2, angle: Math.atan2(u.y, u.x) };
}

/** Every wall in `walls` with an endpoint at joint J, as spokes. */
function spokesAt(J: Vec2, walls: Wall[]): Spoke[] {
  const spokes: Spoke[] = [];
  for (const w of walls) {
    if (wallLength(w) < JOINT_EPS) continue;
    const other = dist(w.a, J) < JOINT_EPS ? w.b : dist(w.b, J) < JOINT_EPS ? w.a : null;
    if (other) spokes.push(makeSpoke(w.id, w.thickness, J, other));
  }
  return spokes;
}

/** Where the `side` edge (+1 left, -1 right) of spoke s meets the `oSide` edge of spoke o. */
function edgeIntersection(J: Vec2, s: Spoke, side: 1 | -1, o: Spoke, oSide: 1 | -1): Vec2 {
  const p1 = { x: J.x + s.n.x * s.h * side, y: J.y + s.n.y * s.h * side };
  const p2 = { x: J.x + o.n.x * o.h * oSide, y: J.y + o.n.y * o.h * oSide };
  const cross = s.u.x * o.u.y - s.u.y * o.u.x;
  if (Math.abs(cross) < 1e-6) return p1; // parallel edges never meet: square cut
  const t = ((p2.x - p1.x) * o.u.y - (p2.y - p1.y) * o.u.x) / cross;
  if (Math.abs(t) > MITER_LIMIT * Math.max(s.h, o.h)) return p1; // sliver angle: no spike
  return { x: p1.x + s.u.x * t, y: p1.y + s.u.y * t };
}

/**
 * The two outline corners of `self` at joint J, in self's own frame (left/right
 * looking away from J). Walls at the joint are sorted by angle; each edge of
 * `self` is mitred against the edge of its angular neighbour on that side.
 */
function jointCorners(J: Vec2, self: Spoke, others: Spoke[]): { left: Vec2; right: Vec2 } {
  // A wall with a collinear partner runs straight through (the top bar of a T):
  // it keeps a square end, and the other walls mitre against its edge instead.
  // Mitring it too would leave a triangular notch.
  const straightThrough = others.some(
    (o) => Math.abs(self.u.x * o.u.y - self.u.y * o.u.x) < 1e-3 && self.u.x * o.u.x + self.u.y * o.u.y < 0,
  );
  if (others.length === 0 || straightThrough) {
    return {
      left: { x: J.x + self.n.x * self.h, y: J.y + self.n.y * self.h },
      right: { x: J.x - self.n.x * self.h, y: J.y - self.n.y * self.h },
    };
  }
  const ring = [...others, self].sort((p, q) => p.angle - q.angle);
  const i = ring.indexOf(self);
  const next = ring[(i + 1) % ring.length]; // counter-clockwise neighbour, on self's left
  const prev = ring[(i + ring.length - 1) % ring.length]; // clockwise neighbour, on self's right
  return {
    left: edgeIntersection(J, self, 1, next, -1),
    right: edgeIntersection(J, self, -1, prev, 1),
  };
}

/**
 * The wall's footprint polygon with mitred corners, ordered a-right, b-right,
 * b-left, a-left (right/left looking a→b). Handles free ends, L-joints,
 * T-junctions and joints of 3+ walls. Empty for a zero-length wall.
 */
export function wallOutline(wall: Wall, allWalls: Wall[]): Vec2[] {
  if (wallLength(wall) < JOINT_EPS) return [];
  const others = allWalls.filter((w) => w.id !== wall.id);
  const atA = jointCorners(wall.a, makeSpoke(wall.id, wall.thickness, wall.a, wall.b), spokesAt(wall.a, others));
  const atB = jointCorners(wall.b, makeSpoke(wall.id, wall.thickness, wall.b, wall.a), spokesAt(wall.b, others));
  // At b the frame is reversed (looking b→a), so its "left" is the wall's right.
  return [atA.right, atB.left, atB.right, atA.left];
}

// ---------------------------------------------------------------- snapping

export type SnapKind = "endpoint" | "midpoint" | "angle" | "grid";

const clean = (v: number) => Math.round(v * 1e9) / 1e9; // strip float dust like 6e-17

/**
 * Snap `p` for drawing. Priority: wall endpoints, wall midpoints, 45°/90° rays
 * from `from` (length rounded to the grid), then the grid. Endpoint/midpoint
 * and ray snaps apply within `radius` metres.
 */
export function snapPoint(
  p: Vec2,
  walls: Segment[],
  opts: { from?: Vec2; radius?: number; grid?: number } = {},
): { point: Vec2; kind: SnapKind } {
  const radius = opts.radius ?? SNAP_RADIUS;
  const grid = opts.grid ?? GRID;

  const nearest = (pts: Vec2[]) => {
    let best: Vec2 | null = null;
    for (const c of pts) if (dist(p, c) <= radius && (!best || dist(p, c) < dist(p, best))) best = c;
    return best;
  };

  const endpoint = nearest(walls.flatMap((w) => [w.a, w.b]));
  if (endpoint) return { point: endpoint, kind: "endpoint" };

  const midpoint = nearest(walls.map((w) => ({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 })));
  if (midpoint) return { point: midpoint, kind: "midpoint" };

  const { from } = opts;
  if (from && dist(p, from) > JOINT_EPS) {
    const step = Math.PI / 4;
    const theta = Math.round(Math.atan2(p.y - from.y, p.x - from.x) / step) * step;
    const dir = { x: Math.cos(theta), y: Math.sin(theta) };
    const along = (p.x - from.x) * dir.x + (p.y - from.y) * dir.y; // distance along the ray
    const onRay = { x: from.x + dir.x * along, y: from.y + dir.y * along };
    if (dist(p, onRay) <= radius) {
      const len = Math.round(along / grid) * grid;
      return { point: { x: clean(from.x + dir.x * len), y: clean(from.y + dir.y * len) }, kind: "angle" };
    }
  }

  return { point: { x: clean(Math.round(p.x / grid) * grid), y: clean(Math.round(p.y / grid) * grid) }, kind: "grid" };
}

// ---------------------------------------------------------------- openings

/**
 * Keep an opening fully inside its wall. `offset` is the opening's centre
 * (see CLAUDE.md Conventions), so it may range from width/2 to length - width/2.
 * If the wall is shorter than the opening, the width shrinks to fit.
 */
export function clampOpening(opening: Opening, wall: Segment): Opening {
  const len = wallLength(wall);
  const width = Math.max(0, Math.min(opening.width, len));
  const offset = Math.max(width / 2, Math.min(opening.offset, len - width / 2));
  return { ...opening, width, offset };
}
