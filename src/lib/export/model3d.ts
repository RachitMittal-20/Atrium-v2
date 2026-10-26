/**
 * model3d.ts — the plan as a 3D file (step X.2, roadmap 7.2): GLB through three's GLTFExporter, OBJ
 * through its OBJExporter. Loaded only when the user exports (ExportDialog.tsx imports this module
 * dynamically), so neither exporter is in the studio's first load.
 *
 * The meshes are the studio's own: each wall is `buildWallMeshData` (the geometry PlanModel renders,
 * openings cut out) and each room floor `buildFloorGeometry` of the derived room's net polygon. Plan
 * metres, world Y up, world (x, y, z) = (plan x, height, plan y), exactly as PlanModel places them; the
 * floors sit at y = 0 (the studio lifts them 1 cm only so they never z-fight on screen). Every mesh is
 * named by id: `wall:<wall id>` and `floor:<room id>`; a floor carries its room's name and net area in
 * userData (glTF extras). Not included: door and window frames, leaves and glass, ceilings, and imported
 * models and their parts (ExportDialog says so). The wall geometry's own face-role data (userData.faces,
 * for the 3D tools) is dropped, so it never lands in the file.
 * Connects to: src/lib/plan/meshBuilders.ts, src/lib/plan/rooms.ts, src/data/materials.ts;
 * used by src/components/studio/ExportDialog.tsx and scripts/test-exports.ts.
 */
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { floorColor, SCENE_COLORS } from "@/data/materials";
import { buildFloorGeometry, buildWallMeshData } from "@/lib/plan/meshBuilders";
import { deriveRooms, type DerivedRoom } from "@/lib/plan/rooms";
import type { Plan } from "@/types/plan";

/** The walls and floors as a three.js group, named by id, matrices updated. */
export function exportScene(plan: Plan, rooms: DerivedRoom[] = deriveRooms(plan)): THREE.Group {
  const root = new THREE.Group();
  root.name = plan.name;
  const wallMaterial = new THREE.MeshStandardMaterial({ name: "wall", color: SCENE_COLORS.wall, roughness: 0.9 });
  for (const wall of plan.walls) {
    const { geometry } = buildWallMeshData(wall, plan.walls, plan.openings);
    geometry.userData = {}; // the 3D tools' face roles are not part of the file
    const mesh = new THREE.Mesh(geometry, wallMaterial);
    mesh.name = `wall:${wall.id}`;
    mesh.userData = { wallId: wall.id };
    root.add(mesh);
  }
  const floorMaterials = new Map<string, THREE.MeshStandardMaterial>();
  for (const room of rooms) {
    let material = floorMaterials.get(room.floorMaterial);
    if (!material) floorMaterials.set(room.floorMaterial, (material = new THREE.MeshStandardMaterial({ name: room.floorMaterial, color: floorColor(room.floorMaterial) })));
    const mesh = new THREE.Mesh(buildFloorGeometry(room.polygon), material);
    mesh.name = `floor:${room.id}`;
    mesh.userData = { roomId: room.id, name: room.name, netArea: room.area };
    root.add(mesh);
  }
  root.updateMatrixWorld(true);
  return root;
}

/** A binary glTF (.glb) of the walls and floors. */
export async function toGlb(plan: Plan): Promise<ArrayBuffer> {
  const out = await new GLTFExporter().parseAsync(exportScene(plan), { binary: true });
  return out as ArrayBuffer;
}

/** A Wavefront OBJ of the walls and floors: one `o` object per mesh, no materials file. */
export const toObj = (plan: Plan): string => new OBJExporter().parse(exportScene(plan));
