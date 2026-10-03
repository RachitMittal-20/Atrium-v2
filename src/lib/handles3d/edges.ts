/**
 * edges.ts — pure maths for picking doors and windows in the 3D view (step 4.7b;
 * no three.js, no React).
 *   openingEdgeLine(s)  the edges of an opening's hole (its two sides, its top and a
 *                       window's sill) as world segments on the wall face that looks
 *                       at the camera. A door has no sill edge: it stays on the floor.
 *   openingFaceQuad     one face of the hole (a side, the top, the sill) across the wall's
 *                       thickness, for the tools' highlight: exactly the visible reveal.
 *   resolveOpeningEdge  which projected edge a pointer is grabbing. A jamb is seen
 *                       almost edge-on from the front, so the tools test a band round
 *                       each edge's on-screen line instead of the thin face itself.
 *   pickAlongRay        the Select tool's 3D rule: an opening beats the wall it sits in.
 *   resolveCorner       which projected corner (a joint drawn as a vertical line from the
 *                       floor to the wall top) the Move tool's pointer is on (step 4.7c).
 * World space as everywhere in 3D: plan (x, y) → (x, height, y), metres.
 * Connects to: src/types/plan.ts, src/lib/plan/geometry.ts; used by
 * src/components/three/{PushPullTool,PlanModel}.tsx; tested by scripts/test-pushpull-openings.ts.
 */
import { wallDirection } from "@/lib/plan/geometry";
import type { Opening, Vec2, Vec3, Wall } from "@/types/plan";

export type EdgeRole = "jambA" | "jambB" | "head" | "sill";

/** The band round an edge, in screen pixels: a mouse is precise, a finger is not. */
export const EDGE_TOL_MOUSE_PX = 14;
export const EDGE_TOL_TOUCH_PX = 44;
/** Two edges this close (px) to the pointer are a tie, broken jamb, then head, then sill. */
const TIE_PX = 0.5;
const RANK: Record<EdgeRole, number> = { jambA: 0, jambB: 0, head: 1, sill: 2 };

/** A plan point at a height, in world space. */
const world = (p: Vec2, y: number): Vec3 => ({ x: p.x, y, z: p.y });

/** +1 when the wall's left face (plan normal (-dy, dx)) looks at the camera from `at`, else -1 (the right face). */
export function faceTowards(wall: Wall, at: Vec2, camera: Vec3): 1 | -1 {
  const d = wallDirection(wall);
  return (camera.x - at.x) * -d.y + (camera.z - at.y) * d.x >= 0 ? 1 : -1;
}

export interface EdgeLine {
  role: EdgeRole;
  a: Vec3;
  b: Vec3;
}

/** An opening's hole in its wall: a point `along` the wall at `side` metres off the centre line (+ = left), and where the hole starts and ends. */
function hole(wall: Wall, o: Opening) {
  const d = wallDirection(wall);
  const at = (along: number, side: number): Vec2 => ({ x: wall.a.x + d.x * along - d.y * side, y: wall.a.y + d.y * along + d.x * side });
  return { at, s0: o.offset - o.width / 2, s1: o.offset + o.width / 2, y0: o.sillHeight, y1: o.sillHeight + o.height, half: wall.thickness / 2 }; // s0: edge A, nearer the wall's a end
}

/** The two ends of one edge of the hole, `side` metres off the wall's centre line. */
function edgeEnds(h: ReturnType<typeof hole>, role: EdgeRole, side: number): [Vec3, Vec3] {
  const { at, s0, s1, y0, y1 } = h;
  switch (role) {
    case "jambA":
      return [world(at(s0, side), y0), world(at(s0, side), y1)];
    case "jambB":
      return [world(at(s1, side), y0), world(at(s1, side), y1)];
    case "head":
      return [world(at(s0, side), y1), world(at(s1, side), y1)];
    case "sill":
      return [world(at(s0, side), y0), world(at(s1, side), y0)];
  }
}

/** One edge of an opening's hole, on the face of its wall that looks at the camera (the larger dot product with the direction to it). */
export function openingEdgeLine(wall: Wall, o: Opening, role: EdgeRole, camera: Vec3): EdgeLine {
  const h = hole(wall, o);
  const centre = h.at(o.offset, 0);
  const [a, b] = edgeEnds(h, role, faceTowards(wall, centre, camera) * h.half); // out along the left normal, or back along it
  return { role, a, b };
}

/** One face of the hole, from one face of the wall to the other: the corners in order round the quad. */
export function openingFaceQuad(wall: Wall, o: Opening, role: EdgeRole): [Vec3, Vec3, Vec3, Vec3] {
  const h = hole(wall, o);
  const [p, q] = edgeEnds(h, role, h.half);
  const [r, s] = edgeEnds(h, role, -h.half);
  return [p, q, s, r];
}

/** The edges a pointer can grab: both sides, the top, and a window's sill. A door has no sill edge. */
export function openingEdgeLines(wall: Wall, o: Opening, camera: Vec3): EdgeLine[] {
  const roles: EdgeRole[] = o.kind === "door" ? ["jambA", "jambB", "head"] : ["jambA", "jambB", "head", "sill"];
  return roles.map((r) => openingEdgeLine(wall, o, r, camera));
}

/** An edge as drawn on screen (CSS pixels), and the opening it belongs to. */
export interface ScreenEdge {
  role: EdgeRole;
  openingId: string;
  a: Vec2;
  b: Vec2;
}

/** The pointer's distance to segment a–b, and where along it the nearest point is (0 at a, 1 at b). */
function toSegment(p: Vec2, a: Vec2, b: Vec2): { d: number; t: number } {
  const [vx, vy] = [b.x - a.x, b.y - a.y];
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  return { d: Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t)), t };
}

/**
 * The edge the pointer is grabbing: the nearest within `tolerancePx` (EDGE_TOL_MOUSE_PX
 * or EDGE_TOL_TOUCH_PX), with ties going jamb, then head, then sill. Null when none is
 * that close. `t` is where along the edge the pointer is nearest. The caller tries
 * this band before its face raycast, so an edge beats the wall face behind it.
 */
export function resolveOpeningEdge(pointerPx: Vec2, edges: ScreenEdge[], tolerancePx: number): (ScreenEdge & { distancePx: number; t: number }) | null {
  let best: (ScreenEdge & { distancePx: number; t: number }) | null = null;
  for (const e of edges) {
    const { d, t } = toSegment(pointerPx, e.a, e.b);
    if (d > tolerancePx) continue;
    const tie = best !== null && Math.abs(d - best.distancePx) <= TIE_PX;
    if (!best || (tie ? RANK[e.role] < RANK[best.role] : d < best.distancePx)) best = { ...e, distancePx: d, t };
  }
  return best;
}

/** A plan joint drawn on screen: the vertical line from its foot (`a`, on the floor) to the wall top (`b`), CSS pixels. */
export interface ScreenCorner {
  id: string;
  a: Vec2;
  b: Vec2;
}

/**
 * The corner the pointer is grabbing: the nearest projected corner line within
 * `tolerancePx` (EDGE_TOL_MOUSE_PX or EDGE_TOL_TOUCH_PX), or null. `t` is where along
 * the line (0 at the floor, 1 at the top) the pointer is nearest. The caller ranks it
 * below an opening edge and above a wall face, and drops a corner a wall hides.
 */
export function resolveCorner(pointerPx: Vec2, corners: ScreenCorner[], tolerancePx: number): (ScreenCorner & { distancePx: number; t: number }) | null {
  let best: (ScreenCorner & { distancePx: number; t: number }) | null = null;
  for (const c of corners) {
    const { d, t } = toSegment(pointerPx, c.a, c.b);
    if (d <= tolerancePx && (!best || d < best.distancePx)) best = { ...c, distancePx: d, t };
  }
  return best;
}

/** One thing a 3D ray went through: a wall, a door or window mesh, or anything else (a floor). */
export interface RayHit {
  kind: "wall" | "opening" | "other";
  id: string;
  distance: number;
}

/**
 * What a Select-tool click in 3D picks. The nearest hit decides, except that a
 * door or window hit within one wall thickness BEHIND the nearest wall wins: a ray
 * that clips the jamb or the face beside a frame is still aimed at the opening.
 * Anything else nearest (a floor) picks nothing.
 */
export function pickAlongRay(hits: RayHit[], thicknessOf: (wallId: string) => number): { kind: "wall" | "opening"; id: string } | null {
  const sorted = [...hits].sort((p, q) => p.distance - q.distance);
  const first = sorted[0];
  if (!first || first.kind === "other") return null;
  if (first.kind === "wall") {
    const reach = first.distance + thicknessOf(first.id);
    const behind = sorted.find((h) => h.kind === "opening" && h.distance <= reach + 1e-9);
    if (behind) return { kind: "opening", id: behind.id };
  }
  return { kind: first.kind, id: first.id };
}
