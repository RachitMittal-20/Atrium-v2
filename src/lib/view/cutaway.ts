/**
 * cutaway.ts — the Cutaway view (step V.2): walls, doors and windows drawn only up to a cut height,
 * so the floors and rooms of a plan can be seen from Orbit and Top. A RENDER setting: the cut is a
 * three.js clipping plane on the materials (CUT_PLANES), so no mesh, vertex, wall height, collision,
 * export or takeoff changes; the setting itself is view state (src/store/cutawayStore.ts).
 *   CUT_HEIGHT   the cut, 1.2 m above the floor.
 *   cutInForce   whether the cut applies now: chosen, not walking (always full height in Walk), and not
 *                while Push/Pull or Move is active (they reach wall tops, sides and corners).
 *   cutReport    which wall and opening geometry is above the cut: metres of each above it (pure, from the Plan).
 *   cutRaycast   a Mesh.raycast that never returns a point above the mesh's `userData.cutY`, so what the
 *                plane clipped away can't be picked by any raycast (R3F's events, PushPullTool, ItemTool).
 *                While cut it also counts back faces: a ray down into a cut wall meets its inner faces,
 *                the section the user sees, so clicking a cut wall still picks it.
 * Connects to: src/components/three/PlanModel.tsx (materials, raycast), src/store/cutawayStore.ts;
 * tested by scripts/test-cutaway.ts.
 */
import * as THREE from "three";
import type { Plan } from "@/types/plan";

export const CUT_HEIGHT = 1.2;

/** Keeps y <= CUT_HEIGHT (three keeps the side of the plane its normal points to). Shared by every cut material. */
export const CUT_PLANES = [new THREE.Plane(new THREE.Vector3(0, -1, 0), CUT_HEIGHT)];
/** No planes: full height. */
export const NO_PLANES: THREE.Plane[] = [];

/** Tools that act on wall tops, sides and corners: the cut steps aside while one is active. */
const FULL_HEIGHT_TOOLS = new Set(["pushpull", "move"]);

export function cutInForce(s: { on: boolean; walking: boolean; tool: string }): boolean {
  return s.on && !s.walking && !FULL_HEIGHT_TOOLS.has(s.tool);
}

export interface CutReport {
  walls: { id: string; above: number }[];
  openings: { id: string; above: number }[];
}

/** Metres of each wall and opening above the cut (0 when wholly below it). */
export function cutReport(plan: Pick<Plan, "walls" | "openings">, cut: number): CutReport {
  return {
    walls: plan.walls.map((w) => ({ id: w.id, above: Math.max(0, w.height - cut) })),
    openings: plan.openings.map((o) => ({ id: o.id, above: Math.max(0, o.sillHeight + o.height - cut) })),
  };
}

const HIT_SLACK = 1e-6; // m: a hit exactly on the cut is kept
const UP = new THREE.Vector3(0, 1, 0);
const probe = new THREE.Raycaster();

/** Whether `p` (on the cut plane) is inside this closed mesh: an odd number of faces straight above it, front or back. */
function insideAt(mesh: THREE.Mesh, p: THREE.Vector3): boolean {
  const material = mesh.material as THREE.Material; // one material per wall and opening box
  const side = material.side;
  const hits: THREE.Intersection[] = [];
  material.side = THREE.DoubleSide; // only for this test, put back before anything renders
  try {
    probe.set(p, UP);
    THREE.Mesh.prototype.raycast.call(mesh, probe, hits);
  } finally {
    material.side = side;
  }
  return hits.length % 2 === 1;
}

export function cutRaycast(this: THREE.Mesh, raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void {
  const cut = this.userData.cutY;
  if (typeof cut !== "number") return THREE.Mesh.prototype.raycast.call(this, raycaster, intersects);
  const found: THREE.Intersection[] = [];
  THREE.Mesh.prototype.raycast.call(this, raycaster, found);
  for (const h of found) if (h.point.y <= cut + HIT_SLACK) intersects.push(h);
  // The cut section: where the ray crosses the cut plane inside the solid is what the user sees (a wall's top
  // drawn open), so it picks the mesh. Wall meshes have no bottom face, so without this a ray straight down
  // into a cut wall would meet nothing of it.
  const { origin, direction } = raycaster.ray;
  if (Math.abs(direction.y) < 1e-9) return;
  const t = (cut - origin.y) / direction.y;
  if (t < raycaster.near || t > raycaster.far) return;
  const point = origin.clone().addScaledVector(direction, t);
  if (insideAt(this, point)) intersects.push({ distance: t, point, object: this, face: null, faceIndex: undefined });
}
