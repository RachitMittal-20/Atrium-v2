/**
 * meshBuilders.ts — pure three.js geometry for the plan view (no React), so it
 * can be checked from a script. Connects to: geometry.ts (outlines),
 * src/types/plan.ts; used by src/components/three/PlanModel.tsx and
 * src/components/three/PushPullTool.tsx.
 *
 * Coordinates: plan (x, y) → world (x, height, y); metres; world up is +Y.
 * Walls are built without boolean ops: the outline is cut into slices along its
 * length at each opening's edges, and every slice becomes a box.
 *
 * Face roles (step 4.7): every triangle of a wall's mesh also gets exactly one
 * role, assigned where the wall is sliced, so the 3D editing tools can tell what
 * a raycast hit. The roles live in a per-triangle array on the geometry itself
 * (`geometry.userData.faces`), so they travel with the geometry through the
 * per-wall cache in PlanModel and can never go stale against it:
 *   top                 the top of any slice that reaches the wall's height
 *   endA / endB         the wall's own two ends (at the a end / the b end)
 *   sideLeft/sideRight  the long faces, left and right of a → b
 *                       (left = plan normal (-dy, dx), as everywhere in the codebase)
 *   jambA / jambB       the faces beside an opening: jambA faces along a → b (it is
 *                       the end of the slice before the opening), jambB faces back
 *   head                the underside of the lintel above an opening
 *   sill                the top of the low slice under a window
 * A box's inside faces (the caps where a sill or lintel slice meets the solid
 * slice beside it) are never visible; they are named by the way they face, so
 * every role still means one outward normal.
 */
import * as THREE from "three";
import type { Opening, Vec2, Wall } from "@/types/plan";
import { dist, JOINT_EPS, wallDirection, wallLength, wallOutline } from "./geometry";

export type FaceRole = "top" | "endA" | "endB" | "sideLeft" | "sideRight" | "jambA" | "jambB" | "head" | "sill";

/** The roles of one wall mesh, a triangle at a time. */
export interface WallFaceData {
  wallId: string;
  /** roles[i] is the role of triangle i (the geometry is not indexed: triangle i = vertices 3i..3i+2). */
  roles: FaceRole[];
  /** openingIds[i] is the opening a jamb, head or sill triangle belongs to, else null. */
  openingIds: (string | null)[];
}

/** What a raycast hit on a wall mesh is: its role and, for opening faces, the opening. Null for an unknown triangle. */
export function faceRoleAt(data: WallFaceData, faceIndex: number): { role: FaceRole; openingId: string | null } | null {
  const role = data.roles[faceIndex];
  return role === undefined ? null : { role, openingId: data.openingIds[faceIndex] ?? null };
}

const touches = (w: Wall, p: Vec2) => dist(w.a, p) < JOINT_EPS || dist(w.b, p) < JOINT_EPS;

/** Cache key for a wall's geometry: the wall, its openings, and every wall
 *  touching either end (their directions and thicknesses shape the mitre). */
export function wallSignature(wall: Wall, allWalls: Wall[], openings: Opening[]): string {
  const neighbours = allWalls.filter((o) => o.id !== wall.id && (touches(o, wall.a) || touches(o, wall.b)));
  return JSON.stringify([wall, openings.filter((o) => o.wallId === wall.id), neighbours]);
}

/** One box between two cross-sections (each a right/left outline point) and two heights. */
interface Section {
  r: Vec2;
  l: Vec2;
}

/** A role and the opening it belongs to (null for the wall's own faces). */
type Tag = [FaceRole, string | null];

/** What each end of a box is: a wall end, or a jamb beside an opening. */
interface BoxTags {
  top: Tag;
  /** The underside, which only exists above floor level (a lintel's: the head). */
  bottom?: Tag;
  start: Tag;
  end: Tag;
}

/** Collects flat-shaded faces, each wound to face away from its box's centre, and a role per triangle. */
class Faces {
  positions: number[] = [];
  normals: number[] = [];
  roles: FaceRole[] = [];
  openingIds: (string | null)[] = [];
  /** The wall's left-hand normal in world space, to tell its two long sides apart. */
  private left: THREE.Vector3;

  constructor(wall: Wall) {
    const d = wallDirection(wall);
    this.left = new THREE.Vector3(-d.y, 0, d.x);
  }

  box(a: Section, b: Section, y0: number, y1: number, tags: BoxTags) {
    const v = (p: Vec2, y: number) => new THREE.Vector3(p.x, y, p.y);
    const corners = [v(a.r, y0), v(a.l, y0), v(b.l, y0), v(b.r, y0), v(a.r, y1), v(a.l, y1), v(b.l, y1), v(b.r, y1)];
    const centre = corners.reduce((s, c) => s.add(c), new THREE.Vector3()).multiplyScalar(1 / 8);
    const [ar0, al0, bl0, br0, ar1, al1, bl1, br1] = corners;
    this.face(centre, [ar1, al1, bl1, br1], tags.top); // top
    if (y0 > 0) this.face(centre, [ar0, al0, bl0, br0], tags.bottom ?? ["head", null]); // bottom; at floor level it's hidden
    this.face(centre, [ar0, br0, br1, ar1], null); // right side
    this.face(centre, [al0, bl0, bl1, al1], null); // left side
    this.face(centre, [ar0, al0, al1, ar1], tags.start); // start cap
    this.face(centre, [br0, bl0, bl1, br1], tags.end); // end cap
  }

  /** `tag` null means one of the long sides: left or right is decided from the face's outward normal. */
  private face(centre: THREE.Vector3, q: THREE.Vector3[], tag: Tag | null) {
    const n = new THREE.Vector3().crossVectors(q[1].clone().sub(q[0]), q[2].clone().sub(q[0]));
    if (n.lengthSq() < 1e-12) return; // zero-area slice
    const mid = q.reduce((s, c) => s.add(c), new THREE.Vector3()).multiplyScalar(0.25);
    if (n.dot(mid.sub(centre)) < 0) q = [q[0], q[3], q[2], q[1]], n.negate(); // winding faces outward
    n.normalize();
    for (const i of [0, 1, 2, 0, 2, 3]) {
      this.positions.push(q[i].x, q[i].y, q[i].z);
      this.normals.push(n.x, n.y, n.z);
    }
    const [role, openingId] = tag ?? [n.dot(this.left) > 0 ? "sideLeft" : "sideRight", null];
    this.roles.push(role, role); // a quad is two triangles
    this.openingIds.push(openingId, openingId);
  }
}

/** A wall as one BufferGeometry, with holes left for its openings, and the role of every triangle. */
export function buildWallMeshData(wall: Wall, allWalls: Wall[], openings: Opening[]): { geometry: THREE.BufferGeometry; faces: WallFaceData } {
  const geometry = new THREE.BufferGeometry();
  const faces: WallFaceData = { wallId: wall.id, roles: [], openingIds: [] };
  const len = wallLength(wall);
  if (len < JOINT_EPS) {
    geometry.userData.faces = faces;
    return { geometry, faces };
  }

  const [aR, bR, bL, aL] = wallOutline(wall, allWalls);
  const d = wallDirection(wall);
  const along = (p: Vec2) => (p.x - wall.a.x) * d.x + (p.y - wall.a.y) * d.y;
  // Point on edge p→q at distance x along the centreline: the cut is perpendicular
  // to the wall even where the mitre makes the two edges different lengths.
  const onEdge = (p: Vec2, q: Vec2, x: number): Vec2 => {
    const s0 = along(p);
    const s1 = along(q);
    const t = s1 === s0 ? 0 : Math.min(1, Math.max(0, (x - s0) / (s1 - s0)));
    return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
  };
  // The ends use the mitred corners themselves.
  const section = (x: number): Section =>
    x <= 0 ? { r: aR, l: aL } : x >= len ? { r: bR, l: bL } : { r: onEdge(aR, bR, x), l: onEdge(aL, bL, x) };

  const out = new Faces(wall);
  const H = wall.height;
  let x = 0;
  let before: string | null = null; // the opening just before the slice being cut, if any
  const own = openings.filter((o) => o.wallId === wall.id).sort((p, q) => p.offset - q.offset);
  for (const o of own) {
    const x0 = Math.max(x, o.offset - o.width / 2);
    const x1 = Math.min(len, o.offset + o.width / 2);
    if (x1 <= x0) continue; // outside the wall or swallowed by an earlier opening
    // A solid slice runs up to this opening: its start is the wall's a end or the previous opening's jamb, its end this opening's jamb A.
    if (x0 > x) out.box(section(x), section(x0), 0, H, { top: ["top", null], start: before ? ["jambB", before] : ["endA", null], end: ["jambA", o.id] });
    const sill = Math.min(H, Math.max(0, o.sillHeight));
    const head = Math.min(H, sill + o.height);
    // The slices under and over the opening. Their caps are the wall's own end when the opening reaches it,
    // else faces inside the wall, named by the way they face (the start cap faces back towards a: jambB).
    const startCap: Tag = x0 <= 0 ? ["endA", null] : ["jambB", o.id];
    const endCap: Tag = x1 >= len ? ["endB", null] : ["jambA", o.id];
    if (sill > 0) out.box(section(x0), section(x1), 0, sill, { top: sill >= H ? ["top", null] : ["sill", o.id], start: startCap, end: endCap }); // under a window
    if (head < H) out.box(section(x0), section(x1), head, H, { top: ["top", null], bottom: ["head", o.id], start: startCap, end: endCap }); // lintel
    x = x1;
    before = o.id;
  }
  if (x < len) out.box(section(x), section(len), 0, H, { top: ["top", null], start: before ? ["jambB", before] : ["endA", null], end: ["endB", null] });

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(out.positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(out.normals, 3));
  faces.roles = out.roles;
  faces.openingIds = out.openingIds;
  geometry.userData.faces = faces; // rides along with the geometry through PlanModel's per-wall cache
  return { geometry, faces };
}

/** A wall as one BufferGeometry, with holes left for its openings. Its face roles are in `geometry.userData.faces`. */
export function buildWallGeometry(wall: Wall, allWalls: Wall[], openings: Opening[]): THREE.BufferGeometry {
  return buildWallMeshData(wall, allWalls, openings).geometry;
}

/**
 * A flat polygon at y = 0 facing up. Shape points are (x, -y): rotateX(-90°)
 * sends shape-y to world -z, so the -y flips back to world z = plan y and the
 * polygon is not mirrored. The ceiling reuses this with BackSide.
 */
export function buildFloorGeometry(polygon: Vec2[]): THREE.ShapeGeometry {
  const geometry = new THREE.ShapeGeometry(new THREE.Shape(polygon.map((p) => new THREE.Vector2(p.x, -p.y))));
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}
