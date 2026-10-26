/**
 * blueprintMeshes.ts — the three.js half of the landing page's blueprint scene (step 8.1). The walls are the
 * studio's own meshes: buildWallMeshData (src/lib/plan/meshBuilders.ts), the function PlanModel draws with, so
 * every door and window is cut out of its wall exactly as in the studio and every triangle carries its face role.
 * Nothing here slices, extrudes or outlines a wall itself.
 *
 *   buildBlueprintWalls  one mesh per plan wall, memoised per Plan object (the sample plan is built once)
 *   cutOpeningIds        which openings those meshes have holes for (read from their face roles)
 *   axonometricFaces     the same meshes' visible quads, projected along the 3D scene's last viewing direction
 *                        and painted far to near: the static end-state picture for reduced motion and for
 *                        browsers without WebGL, drawn on the server by BlueprintDrawings.tsx
 *
 * Imported only by the lazy canvas (BlueprintCanvas.tsx), a server component and the Node test, so three.js never
 * reaches the landing page's first-load JavaScript.
 * Connects to: src/lib/landing/blueprint.ts (the view direction), src/lib/plan/meshBuilders.ts.
 */
import type * as THREE from "three";
import { buildWallMeshData, type FaceRole, type WallFaceData } from "@/lib/plan/meshBuilders";
import type { Plan, Wall } from "@/types/plan";
import { endProjection, sheetBox } from "./blueprint";

export interface BlueprintWall {
  id: string;
  wall: Wall;
  geometry: THREE.BufferGeometry;
  faces: WallFaceData;
}

const built = new WeakMap<Plan, BlueprintWall[]>();

/** Every plan wall as the studio builds it, openings cut, in plan order. The same Plan gives the same array. */
export function buildBlueprintWalls(plan: Plan): BlueprintWall[] {
  let walls = built.get(plan);
  if (!walls) {
    walls = plan.walls.map((wall) => ({ id: wall.id, wall, ...buildWallMeshData(wall, plan.walls, plan.openings) }));
    built.set(plan, walls);
  }
  return walls;
}

/** The openings the meshes have holes for: every opening id on a jamb, head or sill face. */
export function cutOpeningIds(walls: BlueprintWall[]): Set<string> {
  return new Set(walls.flatMap((w) => w.faces.openingIds.filter((id): id is string => id !== null)));
}

export interface AxoFace {
  wallId: string;
  openingId: string | null;
  role: FaceRole;
  /** The quad's four corners on the drawing, in its own units (metres across the view; SVG y down). */
  points: [number, number][];
  /** Distance along the view direction; larger is farther. Faces come sorted farthest first. */
  depth: number;
  /** Which of three tones it is painted: the tops, the faces turned south, the faces turned east or west. */
  shade: "top" | "lit" | "shade";
}

/**
 * The end state as a flat drawing: an orthographic view along the 3D scene's last viewing direction (camera's
 * up = world +Y), of every exposed quad that faces the viewer, painted far to near. Each quad of a wall mesh is
 * two consecutive triangles laid out (q0 q1 q2) (q0 q2 q3) by meshBuilders' Faces.face, so quad k is vertices
 * 6k, 6k+1, 6k+2 and 6k+5. Sorting quads by their centre's depth is a painter's approximation: right for this
 * plan's walls, which never pass through each other, and checked by eye in the reduced-motion screenshot.
 */
export function axonometricFaces(plan: Plan): { faces: AxoFace[]; sheet: [number, number][]; viewBox: [number, number, number, number] } {
  const { view: [fx, fy, fz], project, depth } = endProjection();
  const faces: AxoFace[] = [];
  for (const w of buildBlueprintWalls(plan)) {
    const pos = w.geometry.getAttribute("position");
    const nor = w.geometry.getAttribute("normal");
    if (!pos) continue;
    for (let k = 0; k * 6 < pos.count; k++) {
      if (!w.faces.exposed[2 * k]) continue; // a cap inside the wall or against another wall
      const v = 6 * k;
      const [nx, ny, nz] = [nor.getX(v), nor.getY(v), nor.getZ(v)];
      if (nx * fx + ny * fy + nz * fz >= -1e-9) continue; // turned away from the viewer (or edge-on)
      const corners = [v, v + 1, v + 2, v + 5].map((i) => [pos.getX(i), pos.getY(i), pos.getZ(i)] as const);
      const c = corners.reduce((s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4, s[2] + p[2] / 4], [0, 0, 0]);
      faces.push({
        wallId: w.id,
        openingId: w.faces.openingIds[2 * k],
        role: w.faces.roles[2 * k],
        points: corners.map(([x, y, z]) => project(x, y, z)),
        depth: depth(c[0], c[1], c[2]),
        shade: ny > 0.5 ? "top" : Math.abs(nz) >= Math.abs(nx) ? "lit" : "shade",
      });
    }
  }
  faces.sort((a, b) => b.depth - a.depth);
  // The sheet the model stands on, at floor level; the view is framed on the model, so the sheet runs off it.
  const box = sheetBox(plan);
  const sheet = [[box.x, box.y], [box.x + box.w, box.y], [box.x + box.w, box.y + box.h], [box.x, box.y + box.h]].map(([x, y]) => project(x, 0, y));
  const xs = faces.flatMap((f) => f.points.map((p) => p[0]));
  const ys = faces.flatMap((f) => f.points.map((p) => p[1]));
  const pad = 1;
  const [x0, y0] = [Math.min(...xs) - pad, Math.min(...ys) - pad];
  return { faces, sheet, viewBox: [x0, y0, Math.max(...xs) + pad - x0, Math.max(...ys) + pad - y0] };
}
