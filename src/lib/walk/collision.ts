/**
 * collision.ts — the walkthrough's collision model, pure and in plan metres
 * (x → east, y → south, as everywhere). Derived from `Plan` like every other
 * view: walls become solid boxes, doors are cut out of them, windows stay
 * solid. No React, no camera. Connects to: src/types/plan.ts,
 * src/lib/plan/{geometry,rooms}.ts; the walkthrough controls (step 5.1 piece B)
 * call getCollision, moveWithCollision, startPose and eyeHeight; tested by
 * scripts/test-walk.ts.
 *
 * Solids: each wall's centre line [0, length] minus every passable DOOR span
 * (offset ± width/2) leaves solid intervals; each is a box of the wall's
 * thickness. An interval end that is a wall end (not a door cut) is extended by
 * half the thickness, so L-corners, T-stems and free ends close with no notch.
 * Window spans stay solid at every height. A door's leaf is never collision.
 *
 * The camera is a disc of CAMERA_RADIUS. Moving treats every box as a rectangle
 * grown by that radius (square corners) and pushes the camera's centre out
 * along the shortest exit normal; `clearance` is the true Euclidean distance.
 * A centre outside every grown rectangle therefore always has clearance >= the
 * radius.
 */
import type { Plan, Vec2 } from "@/types/plan";
import { pointToWallDistance, wallDirection, wallLength, JOINT_EPS } from "@/lib/plan/geometry";
import { deriveRooms, pointInPolygon } from "@/lib/plan/rooms";

/**
 * 0.2 m: about half a shoulder width, so the eye cannot get close enough to a
 * wall for the near clipping plane to cut into it, yet a standard 0.8–0.9 m
 * door still leaves 0.4–0.5 m of play for the centre.
 */
export const CAMERA_RADIUS = 0.2;
/** Narrowest door the camera walks through: its body plus 0.1 m of play. Narrower doors stay solid. */
export const MIN_DOOR_WIDTH = 2 * CAMERA_RADIUS + 0.1;
/** The camera's centre stays inside the solids' bounding box grown by this, so it can step out of a front door but not wander off. */
export const FENCE_MARGIN = 1;
/** Eye height cap (m) and its share of the lowest nearby wall. */
const EYE_MAX = 1.6;
const EYE_SHARE = 0.9;
const EYE_NEAR = 3;
/** No substep is longer than this, so the centre can never reach past the middle of a grown wall. */
const SUBSTEP = CAMERA_RADIUS / 2;
const PASSES = 4;
/** Overlap left after the passes above which a substep is undone (well under the 1 mm promise). */
const MAX_OVERLAP = 1e-4;
const EPS = 1e-9;

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Collision {
  /** STRIDE numbers per solid: centre x, centre y, unit direction x, y, half length, half thickness. */
  pieces: Float64Array;
  count: number;
  /** Bounding box of the solids, or null when there are none. */
  bounds: Box | null;
  /** Where the camera's centre may go: `bounds` grown by FENCE_MARGIN (infinite when there are no solids). */
  fence: Box;
  /** Uniform grid; cell k lists items[start[k] .. start[k+1]), each piece's box grown by the radius. */
  grid: { minX: number; minY: number; size: number; nx: number; ny: number; start: Int32Array; items: Int32Array };
  /** Ids of doors narrower than MIN_DOOR_WIDTH: they stay solid. */
  narrowDoors: string[];
}

const STRIDE = 6;
const MAX_CELLS = 64; // per axis

// ---------------------------------------------------------------- build

export function buildCollision(plan: Pick<Plan, "walls" | "openings">): Collision {
  const narrowDoors: string[] = [];
  const out: number[] = [];
  for (const w of plan.walls) {
    const len = wallLength(w);
    if (len < JOINT_EPS) continue;
    const u = wallDirection(w);
    const h = w.thickness / 2;
    // Door cuts along this wall, clipped to it, sorted; overlapping cuts merge in the walk below.
    const cuts: [number, number][] = [];
    for (const o of plan.openings) {
      if (o.wallId !== w.id || o.kind !== "door") continue;
      if (o.width < MIN_DOOR_WIDTH) {
        narrowDoors.push(o.id);
        continue;
      }
      cuts.push([Math.max(0, o.offset - o.width / 2), Math.min(len, o.offset + o.width / 2)]);
    }
    cuts.sort((p, q) => p[0] - q[0]);
    let s = 0;
    const solid = (s0: number, s1: number) => {
      if (s1 - s0 <= EPS) return;
      // ponytail: a wall end is extended even where a collinear neighbour has a door flush at the joint, which narrows that door by half a thickness.
      const e0 = s0 === 0 ? s0 - h : s0;
      const e1 = s1 === len ? s1 + h : s1;
      const mid = (e0 + e1) / 2;
      out.push(w.a.x + u.x * mid, w.a.y + u.y * mid, u.x, u.y, (e1 - e0) / 2, h);
    };
    for (const [c0, c1] of cuts) {
      solid(s, c0);
      s = Math.max(s, c1);
    }
    solid(s, len);
  }

  const pieces = Float64Array.from(out);
  const count = out.length / STRIDE;
  const boxes = Array.from({ length: count }, (_, i) => pieceBox(pieces, i, 0));
  const bounds = count === 0 ? null : boxes.reduce((b, x) => ({ minX: Math.min(b.minX, x.minX), minY: Math.min(b.minY, x.minY), maxX: Math.max(b.maxX, x.maxX), maxY: Math.max(b.maxY, x.maxY) }));
  const fence = bounds
    ? { minX: bounds.minX - FENCE_MARGIN, minY: bounds.minY - FENCE_MARGIN, maxX: bounds.maxX + FENCE_MARGIN, maxY: bounds.maxY + FENCE_MARGIN }
    : { minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity };
  return { pieces, count, bounds, fence, grid: buildGrid(boxes.map((b) => grow(b, CAMERA_RADIUS))), narrowDoors };
}

/** Axis-aligned box of piece i grown by r. */
function pieceBox(p: Float64Array, i: number, r: number): Box {
  const k = i * STRIDE;
  const [cx, cy, ux, uy, hl, ht] = [p[k], p[k + 1], p[k + 2], p[k + 3], p[k + 4], p[k + 5]];
  const ex = Math.abs(ux) * hl + Math.abs(uy) * ht + r;
  const ey = Math.abs(uy) * hl + Math.abs(ux) * ht + r;
  return { minX: cx - ex, minY: cy - ey, maxX: cx + ex, maxY: cy + ey };
}

const grow = (b: Box, r: number): Box => ({ minX: b.minX - r, minY: b.minY - r, maxX: b.maxX + r, maxY: b.maxY + r });

function buildGrid(boxes: Box[]): Collision["grid"] {
  if (boxes.length === 0) return { minX: 0, minY: 0, size: 1, nx: 0, ny: 0, start: new Int32Array(1), items: new Int32Array(0) };
  const minX = Math.min(...boxes.map((b) => b.minX));
  const minY = Math.min(...boxes.map((b) => b.minY));
  const w = Math.max(...boxes.map((b) => b.maxX)) - minX;
  const h = Math.max(...boxes.map((b) => b.maxY)) - minY;
  const size = Math.max(1, w / MAX_CELLS, h / MAX_CELLS); // 1 m cells, fewer for huge plans
  const nx = Math.max(1, Math.ceil(w / size));
  const ny = Math.max(1, Math.ceil(h / size));
  const lists: number[][] = Array.from({ length: nx * ny }, () => []);
  boxes.forEach((b, i) => {
    const r = cellRange({ minX, minY, size, nx, ny }, b)!;
    for (let iy = r.y0; iy <= r.y1; iy++) for (let ix = r.x0; ix <= r.x1; ix++) lists[iy * nx + ix].push(i);
  });
  const start = new Int32Array(nx * ny + 1);
  lists.forEach((l, k) => (start[k + 1] = start[k] + l.length));
  return { minX, minY, size, nx, ny, start, items: Int32Array.from(lists.flat()) };
}

/** Cells the box overlaps, clamped to the grid; null when it misses the grid entirely. */
function cellRange(g: Pick<Collision["grid"], "minX" | "minY" | "size" | "nx" | "ny">, b: Box) {
  const x0 = Math.floor((b.minX - g.minX) / g.size);
  const y0 = Math.floor((b.minY - g.minY) / g.size);
  const x1 = Math.floor((b.maxX - g.minX) / g.size);
  const y1 = Math.floor((b.maxY - g.minY) / g.size);
  if (x1 < 0 || y1 < 0 || x0 >= g.nx || y0 >= g.ny) return null;
  return { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(g.nx - 1, x1), y1: Math.min(g.ny - 1, y1) };
}

/** Pieces whose grown box may lie within r of p (each listed once). */
function nearby(c: Collision, p: Vec2, r: number): number[] {
  const g = c.grid;
  const range = cellRange(g, { minX: p.x - r, minY: p.y - r, maxX: p.x + r, maxY: p.y + r });
  if (!range) return [];
  const found = new Set<number>();
  for (let iy = range.y0; iy <= range.y1; iy++)
    for (let ix = range.x0; ix <= range.x1; ix++) {
      const k = iy * g.nx + ix;
      for (let j = g.start[k]; j < g.start[k + 1]; j++) found.add(g.items[j]);
    }
  return [...found].sort((a, b) => a - b); // build order, so pushes are deterministic
}

// ---------------------------------------------------------------- queries

/** p in piece i's own frame: s along the wall, t across it, with the half extents. */
function local(c: Collision, i: number, p: Vec2) {
  const k = i * STRIDE;
  const p_ = c.pieces;
  const dx = p.x - p_[k];
  const dy = p.y - p_[k + 1];
  const ux = p_[k + 2];
  const uy = p_[k + 3];
  return { s: dx * ux + dy * uy, t: -dx * uy + dy * ux, ux, uy, hl: p_[k + 4], ht: p_[k + 5] };
}

/** Euclidean signed distance from p to piece i (negative inside). */
function pieceDistance(c: Collision, i: number, p: Vec2): number {
  const { s, t, hl, ht } = local(c, i, p);
  const qx = Math.abs(s) - hl;
  const qy = Math.abs(t) - ht;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
}

/** Distance from p to the nearest solid, negative inside one; Infinity with no solids. */
export function clearance(c: Collision, p: Vec2): number {
  const R = 1; // exact when something lies within R: its box is then within R of p, so in the cells searched
  let best = Infinity;
  for (const i of nearby(c, p, R)) best = Math.min(best, pieceDistance(c, i, p));
  if (best <= R) return best;
  for (let i = 0; i < c.count; i++) best = Math.min(best, pieceDistance(c, i, p));
  return best;
}

/** How deep p sits inside piece i grown by the radius (0 when outside), and the push that gets it out. */
function overlap(c: Collision, i: number, p: Vec2): { depth: number; x: number; y: number } {
  const { s, t, ux, uy, hl, ht } = local(c, i, p);
  const es = hl + CAMERA_RADIUS - Math.abs(s);
  const et = ht + CAMERA_RADIUS - Math.abs(t);
  if (es <= EPS || et <= EPS) return { depth: 0, x: 0, y: 0 };
  if (es < et) {
    const k = s < 0 ? -es : es; // out through the nearer end
    return { depth: es, x: ux * k, y: uy * k };
  }
  const k = t < 0 ? -et : et; // out through the nearer face; normal is (-uy, ux)
  return { depth: et, x: -uy * k, y: ux * k };
}

function deepestOverlap(c: Collision, p: Vec2): number {
  let d = 0;
  for (const i of nearby(c, p, 0)) d = Math.max(d, overlap(c, i, p).depth);
  return d;
}

const clampTo = (b: Box, p: Vec2): Vec2 => ({ x: Math.min(b.maxX, Math.max(b.minX, p.x)), y: Math.min(b.maxY, Math.max(b.minY, p.y)) });

/**
 * Move the camera's centre from `from` by `delta`, sliding along walls. Substeps
 * of at most SUBSTEP; after each, up to PASSES passes push the centre out of
 * every grown piece it is in. A substep that still overlaps (a corner tighter
 * than the passes can settle) is undone and the move stops there, so a start
 * that is free never ends inside a solid.
 */
export function moveWithCollision(c: Collision, from: Vec2, delta: Vec2): Vec2 {
  const len = Math.hypot(delta.x, delta.y);
  const n = Math.ceil(len / SUBSTEP);
  let p = { ...from };
  for (let k = 0; k < n; k++) {
    let q = clampTo(c.fence, { x: p.x + delta.x / n, y: p.y + delta.y / n });
    for (let pass = 0; pass < PASSES; pass++) {
      let pushed = false;
      for (const i of nearby(c, q, 0)) {
        const o = overlap(c, i, q);
        if (o.depth === 0) continue;
        q = { x: q.x + o.x, y: q.y + o.y };
        pushed = true;
      }
      if (!pushed) break;
    }
    if (deepestOverlap(c, q) > MAX_OVERLAP) break;
    p = q;
  }
  return p;
}

/**
 * The nearest point to p (within maxDist) whose clearance is at least the
 * radius, or null. Searches rings 1 cm apart, 72 directions each; on the first
 * ring with a free point it returns the freest one (lowest direction on ties).
 */
export function freePointNear(c: Collision, p: Vec2, maxDist = 2): Vec2 | null {
  if (clearance(c, p) >= CAMERA_RADIUS) return { ...p };
  const RING = 0.01;
  const DIRS = 72;
  for (let r = RING; r <= maxDist + EPS; r += RING) {
    let best: Vec2 | null = null;
    let bestC = CAMERA_RADIUS;
    for (let i = 0; i < DIRS; i++) {
      const a = (i / DIRS) * 2 * Math.PI;
      const q = { x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r };
      const cq = clearance(c, q);
      if (cq >= bestC && (!best || cq > bestC)) {
        best = q;
        bestC = cq;
      }
    }
    if (best) return best;
  }
  return null;
}

// ---------------------------------------------------------------- start and eye height

export interface StartPose {
  position: Vec2;
  /** Radians in plan space: 0 faces +x (east), π/2 faces +y (south). */
  heading: number;
  roomId: string;
}

const HEADINGS = 16;
const START_GRID = 0.1;

/** How far the camera can travel from p along unit dir before touching a solid or the fence (sphere tracing). */
function clearRun(c: Collision, p: Vec2, dir: Vec2): number {
  const f = c.fence;
  const tx = dir.x > 0 ? (f.maxX - p.x) / dir.x : dir.x < 0 ? (f.minX - p.x) / dir.x : Infinity;
  const ty = dir.y > 0 ? (f.maxY - p.y) / dir.y : dir.y < 0 ? (f.minY - p.y) / dir.y : Infinity;
  const limit = Math.min(tx, ty);
  let t = 0;
  while (t < limit) {
    const room = clearance(c, { x: p.x + dir.x * t, y: p.y + dir.y * t }) - CAMERA_RADIUS;
    if (room < 1e-3) return t;
    t += room;
  }
  return limit;
}

/**
 * Where the walkthrough starts: in the largest room by net area (ties: lowest
 * id), at its labelPoint if that is clear, else at the 0.1 m grid point inside
 * the room with the most clearance (ties: lowest x, then y). It faces the
 * longest clear run among 16 directions (ties: lowest index). Null when the
 * plan has no closed room.
 */
export function startPose(plan: Plan, c: Collision): StartPose | null {
  const rooms = deriveRooms(plan);
  if (rooms.length === 0) return null;
  const room = rooms.reduce((best, r) => (r.area > best.area || (r.area === best.area && r.id < best.id) ? r : best));

  let position = room.labelPoint;
  if (clearance(c, position) < CAMERA_RADIUS) {
    const xs = room.polygon.map((v) => v.x);
    const ys = room.polygon.map((v) => v.y);
    let bestC = -Infinity;
    for (let ix = Math.ceil(Math.min(...xs) / START_GRID); ix * START_GRID <= Math.max(...xs); ix++)
      for (let iy = Math.ceil(Math.min(...ys) / START_GRID); iy * START_GRID <= Math.max(...ys); iy++) {
        const q = { x: ix * START_GRID, y: iy * START_GRID }; // integer steps: no drifting sums
        if (!pointInPolygon(q, room.polygon)) continue;
        const cq = clearance(c, q);
        if (cq > bestC) {
          bestC = cq; // x outer, y inner, strict >: ties keep the lowest x, then y
          position = q;
        }
      }
  }

  let heading = 0;
  let longest = -1;
  for (let i = 0; i < HEADINGS; i++) {
    const a = (i / HEADINGS) * 2 * Math.PI;
    const run = Math.round(clearRun(c, position, { x: Math.cos(a), y: Math.sin(a) }) * 1e6) / 1e6; // equal to 1 µm is a tie
    if (run > longest) {
      longest = run;
      heading = a;
    }
  }
  return { position: { ...position }, heading, roomId: room.id };
}

/** Eye height at p: 1.6 m, or 90% of the lowest wall within 3 m if that is lower. */
export function eyeHeight(plan: Pick<Plan, "walls">, p: Vec2): number {
  let low = Infinity;
  for (const w of plan.walls) if (pointToWallDistance(p, w) <= EYE_NEAR) low = Math.min(low, w.height);
  return Math.min(EYE_MAX, EYE_SHARE * low);
}

// ---------------------------------------------------------------- memo

let memo: { walls: Plan["walls"]; openings: Plan["openings"]; c: Collision } | null = null;
/** How many times getCollision has rebuilt; for tests. */
export const collisionStats = { builds: 0 };

/**
 * The collision for `plan`, rebuilt only when plan.walls or plan.openings is a
 * different array. Immer keeps unchanged arrays, so item edits and renames
 * reuse the last build and any wall or opening edit (or undo of one) rebuilds.
 */
export function getCollision(plan: Pick<Plan, "walls" | "openings">): Collision {
  if (memo && memo.walls === plan.walls && memo.openings === plan.openings) return memo.c;
  collisionStats.builds++;
  memo = { walls: plan.walls, openings: plan.openings, c: buildCollision(plan) };
  return memo.c;
}
