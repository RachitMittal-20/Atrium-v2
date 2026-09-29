/**
 * meshBuilders.ts — pure three.js geometry for the plan view (no React), so it
 * can be checked from a script. Connects to: geometry.ts (outlines),
 * src/types/plan.ts; used by src/components/three/PlanModel.tsx.
 *
 * Coordinates: plan (x, y) → world (x, height, y); metres; world up is +Y.
 * Walls are built without boolean ops: the outline is cut into slices along its
 * length at each opening's edges, and every slice becomes a box.
 */
import * as THREE from "three";
import type { Opening, Vec2, Wall } from "@/types/plan";
import { dist, JOINT_EPS, wallDirection, wallLength, wallOutline } from "./geometry";

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

/** Collects flat-shaded faces, each wound to face away from its box's centre. */
class Faces {
  positions: number[] = [];
  normals: number[] = [];

  box(a: Section, b: Section, y0: number, y1: number) {
    const v = (p: Vec2, y: number) => new THREE.Vector3(p.x, y, p.y);
    const corners = [v(a.r, y0), v(a.l, y0), v(b.l, y0), v(b.r, y0), v(a.r, y1), v(a.l, y1), v(b.l, y1), v(b.r, y1)];
    const centre = corners.reduce((s, c) => s.add(c), new THREE.Vector3()).multiplyScalar(1 / 8);
    const [ar0, al0, bl0, br0, ar1, al1, bl1, br1] = corners;
    this.face(centre, [ar1, al1, bl1, br1]); // top
    if (y0 > 0) this.face(centre, [ar0, al0, bl0, br0]); // bottom; at floor level it's hidden
    this.face(centre, [ar0, br0, br1, ar1]); // right side
    this.face(centre, [al0, bl0, bl1, al1]); // left side
    this.face(centre, [ar0, al0, al1, ar1]); // start cap
    this.face(centre, [br0, bl0, bl1, br1]); // end cap
  }

  private face(centre: THREE.Vector3, q: THREE.Vector3[]) {
    const n = new THREE.Vector3().crossVectors(q[1].clone().sub(q[0]), q[2].clone().sub(q[0]));
    if (n.lengthSq() < 1e-12) return; // zero-area slice
    const mid = q.reduce((s, c) => s.add(c), new THREE.Vector3()).multiplyScalar(0.25);
    if (n.dot(mid.sub(centre)) < 0) q = [q[0], q[3], q[2], q[1]], n.negate(); // winding faces outward
    n.normalize();
    for (const i of [0, 1, 2, 0, 2, 3]) {
      this.positions.push(q[i].x, q[i].y, q[i].z);
      this.normals.push(n.x, n.y, n.z);
    }
  }
}

/** A wall as one BufferGeometry, with holes left for its openings. */
export function buildWallGeometry(wall: Wall, allWalls: Wall[], openings: Opening[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const len = wallLength(wall);
  if (len < JOINT_EPS) return geometry;

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

  const faces = new Faces();
  const H = wall.height;
  let x = 0;
  const own = openings.filter((o) => o.wallId === wall.id).sort((p, q) => p.offset - q.offset);
  for (const o of own) {
    const x0 = Math.max(x, o.offset - o.width / 2);
    const x1 = Math.min(len, o.offset + o.width / 2);
    if (x1 <= x0) continue; // outside the wall or swallowed by an earlier opening
    if (x0 > x) faces.box(section(x), section(x0), 0, H); // solid wall up to the opening
    const sill = Math.min(H, Math.max(0, o.sillHeight));
    const head = Math.min(H, sill + o.height);
    if (sill > 0) faces.box(section(x0), section(x1), 0, sill); // under a window
    if (head < H) faces.box(section(x0), section(x1), head, H); // lintel
    x = x1;
  }
  if (x < len) faces.box(section(x), section(len), 0, H);

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(faces.positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(faces.normals, 3));
  return geometry;
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
