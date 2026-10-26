/**
 * test-landing-scene.ts — step 8.1: the landing page's blueprint scene is a derived view of the REAL sample plan,
 * built with the studio's own helpers, never a copy and never a baked mesh.
 *   - every extruded wall is buildWallMeshData's geometry for that plan wall, vertex for vertex, one per wall;
 *   - every door and window is cut out: each opening's id is on its wall's jamb faces, and there are as many as the
 *     plan has openings;
 *   - the drawn sheet is wallOutline's polygons, openingFrame's gaps and doorSwing's swings, one of each per wall,
 *     opening and door;
 *   - the static end-state picture projects the same mesh faces, so its walls and openings are the plan's too;
 *   - the camera starts straight down on the sheet and ends pulled back and tilted, at every aspect;
 *   - the source files import the shared helpers and define no outline, slicing or swing maths of their own.
 * Written failing first (step 8.1): before src/lib/landing existed it stopped at "Cannot find module".
 * Run: npx tsx scripts/test-landing-scene.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { samplePlan } from "../src/data/samplePlan";
import { BUILD_END, cameraAt, sheetBox, sheetShapes, wallRise } from "../src/lib/landing/blueprint";
import { axonometricFaces, buildBlueprintWalls, cutOpeningIds } from "../src/lib/landing/blueprintMeshes";
import { wallOutline } from "../src/lib/plan/geometry";
import { buildWallMeshData } from "../src/lib/plan/meshBuilders";
import { doorSwing, openingFrame } from "../src/lib/plan2d/openings";

const plan = samplePlan;
const doors = plan.openings.filter((o) => o.kind === "door");

// ---- the extruded walls are the studio's own geometry, one per plan wall
const walls = buildBlueprintWalls(plan);
assert.equal(walls.length, plan.walls.length, "one extruded wall per plan wall");
assert.deepEqual(walls.map((w) => w.id), plan.walls.map((w) => w.id), "in the plan's order, with the plan's ids");
for (const [i, w] of walls.entries()) {
  const own = buildWallMeshData(plan.walls[i], plan.walls, plan.openings).geometry.getAttribute("position").array;
  const got = w.geometry.getAttribute("position").array;
  assert.ok(got.length > 0, `${w.id} has triangles`);
  assert.deepEqual(Array.from(got), Array.from(own), `${w.id}: the same vertices as the studio's buildWallMeshData`);
}
assert.equal(buildBlueprintWalls(plan), walls, "memoised: the same plan gives the same meshes");

// ---- every opening is cut out of its own wall
const cut = cutOpeningIds(walls);
assert.equal(cut.size, plan.openings.length, `${plan.openings.length} openings cut, got ${cut.size}`);
for (const o of plan.openings) {
  assert.ok(cut.has(o.id), `${o.id} is cut out`);
  const host = walls.find((w) => w.id === o.wallId)!;
  const roles = new Set(host.faces.roles.filter((_, t) => host.faces.openingIds[t] === o.id));
  assert.ok(roles.has("jambA") && roles.has("jambB"), `${o.id}: both jambs on ${o.wallId}`);
  assert.ok(roles.has("head") || o.sillHeight + o.height >= host.wall.height, `${o.id}: a lintel over it`);
  if (o.kind === "window") assert.ok(roles.has("sill"), `${o.id}: a sill under the window`);
}

// ---- the sheet is drawn with the 2D plan's helpers
const sheet = sheetShapes(plan);
assert.equal(sheet.walls.length, plan.walls.length, "one outline per wall");
for (const [i, poly] of sheet.walls.entries()) assert.deepEqual(poly, wallOutline(plan.walls[i], plan.walls), `${plan.walls[i].id}: the outline is wallOutline's`);
assert.equal(sheet.gaps.length, plan.openings.length, "one gap per opening");
for (const [i, o] of plan.openings.entries()) {
  const wall = plan.walls.find((w) => w.id === o.wallId)!;
  const f = openingFrame(wall, o);
  const g = sheet.gaps[i];
  assert.equal(g.id, o.id);
  assert.ok(Math.hypot(g.from.x - f.start.x, g.from.y - f.start.y) < 1e-12 && Math.hypot(g.to.x - f.end.x, g.to.y - f.end.y) < 1e-12, `${o.id}: the gap is openingFrame's`);
}
assert.equal(sheet.doors.length, doors.length, "one swing per door");
for (const [i, o] of doors.entries()) assert.deepEqual({ hinge: sheet.doors[i].hinge, leafEnd: sheet.doors[i].leafEnd, arcEnd: sheet.doors[i].arcEnd }, doorSwing(plan.walls.find((w) => w.id === o.wallId)!, o), `${o.id}: doorSwing's`);
assert.equal(sheet.windows.length, plan.openings.length - doors.length, "one window symbol per window");
const box = sheetBox(plan);
const xs = plan.walls.flatMap((w) => wallOutline(w, plan.walls).map((p) => p.x));
const ys = plan.walls.flatMap((w) => wallOutline(w, plan.walls).map((p) => p.y));
assert.ok(box.x < Math.min(...xs) && box.y < Math.min(...ys) && box.x + box.w > Math.max(...xs) && box.y + box.h > Math.max(...ys), "the sheet holds every wall");

// ---- the static end state projects those same faces
const axo = axonometricFaces(plan);
assert.deepEqual([...new Set(axo.faces.map((f) => f.wallId))].sort(), plan.walls.map((w) => w.id).sort(), "every wall is in the end-state picture");
assert.deepEqual([...new Set(axo.faces.flatMap((f) => (f.openingId ? [f.openingId] : [])))].sort(), plan.openings.map((o) => o.id).sort(), "every opening's jambs show in it");
for (const f of axo.faces) assert.ok(f.points.length === 4 && f.points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)), "quads with finite points");
for (let i = 1; i < axo.faces.length; i++) assert.ok(axo.faces[i - 1].depth >= axo.faces[i].depth, "painted far to near");

// ---- the camera: straight down at the start, pulled back and tilted at the end, at every aspect
for (const aspect of [1440 / 900, 390 / 844, 1]) {
  const start = cameraAt(0, plan, aspect);
  const end = cameraAt(1, plan, aspect);
  const off = (c: typeof start) => [c.position[0] - c.target[0], c.position[1] - c.target[1], c.position[2] - c.target[2]];
  const [sx, sy, sz] = off(start);
  const [ex, ey, ez] = off(end);
  assert.ok(Math.hypot(sx, sz) / sy < 1e-2, `aspect ${aspect.toFixed(2)}: the first frame looks straight down`);
  // At the first frame the sheet box just fits: its larger relative side fills the view (fov 40°), at the
  // camera's distance to the sheet's centre (it looks along that line).
  const half = Math.tan((20 * Math.PI) / 180) * Math.hypot(sx, sy, sz);
  const fit = Math.max(box.h / 2 / half, box.w / 2 / (half * aspect));
  assert.ok(Math.abs(fit - 1) < 1e-9, `aspect ${aspect.toFixed(2)}: the sheet fits the first frame exactly (got ${fit})`);
  assert.ok(Math.hypot(ex, ey, ez) > Math.hypot(sx, sy, sz) * 0.9 && Math.atan2(Math.hypot(ex, ez), ey) > (40 * Math.PI) / 180, `aspect ${aspect.toFixed(2)}: the last frame is tilted at least 40° and not closer in`);
}
assert.equal(wallRise(0), 0, "walls flat at the start");
assert.equal(wallRise(1), 1, "walls full height at the end of the build");
assert.ok(BUILD_END > 0.5 && BUILD_END < 1, "the build ends before the hand-over");

// ---- shared helpers, not a copy
const src = (p: string) => readFileSync(p, "utf8");
const lib = src("src/lib/landing/blueprint.ts");
const meshes = src("src/lib/landing/blueprintMeshes.ts");
const canvas = src("src/components/landing/BlueprintCanvas.tsx");
const drawings = src("src/components/landing/BlueprintDrawings.tsx");
assert.match(lib, /from "@\/lib\/plan\/geometry"/, "blueprint.ts uses geometry.ts");
assert.match(lib, /from "@\/lib\/plan2d\/openings"/, "blueprint.ts uses plan2d/openings.ts");
assert.match(meshes, /from "@\/lib\/plan\/meshBuilders"/, "blueprintMeshes.ts uses meshBuilders.ts");
assert.match(canvas, /buildBlueprintWalls/, "the canvas draws buildBlueprintWalls' meshes");
assert.match(drawings, /sheetShapes/, "the sheet drawing uses sheetShapes");
assert.match(drawings, /axonometricFaces/, "the end-state drawing uses axonometricFaces");
for (const [name, text] of [["blueprint.ts", lib], ["blueprintMeshes.ts", meshes], ["BlueprintCanvas.tsx", canvas], ["BlueprintDrawings.tsx", drawings]] as const)
  assert.doesNotMatch(text, /function (wallOutline|jointCorners|buildWallMeshData|buildWallGeometry|doorSwing|openingFrame)\b|new THREE\.(BoxGeometry|ExtrudeGeometry|Shape)\b/, `${name} defines no wall or opening geometry of its own`);

console.log(`test-landing-scene: OK (${walls.length} walls, ${cut.size} openings cut, ${axo.faces.length} end-state faces)`);
