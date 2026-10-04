/**
 * test-import-transform.ts — asserts for moving, turning and scaling imported 3D
 * models and their parts (step I.1b), run under Node:
 *   1. the pure rules (src/lib/import/transform.ts) with exact numbers: the floor move
 *      and its 5 cm grid, the lift and its 0–10 m limits, the turn in 15° steps and its
 *      sign (pinned to the panel's rotation field), the scale and its 24 px / 1% /
 *      10,000% limits, typed degrees and percentages;
 *   2. part transforms (src/lib/import/model.ts) on a nested model whose parent is turned
 *      and scaled unevenly, in a model frame with a unit and Z up: the part's box moves by
 *      exactly the offset asked for, turns and scales about its pivot, its children follow,
 *      its siblings do not move, a transformed parent carries it, hidden and deleted rules,
 *      Restore, re-applying, and the cached original never touched;
 *   3. pickPart: the highest named node, Alt's deep pick, wrappers of the whole model;
 *   4. frameBox: the box is inside the frustum afterwards at 1440×900 and 390×844, from
 *      the current direction, and the camera stays above the ground;
 *   5. the unit rule (model.guessUnit) and its ambiguity flag;
 *   6. the store (src/store/itemToolStore.ts, planStore.setNodeTransform): every edit
 *      ONE undo step with redo, a rollback leaves history unchanged, typed degrees and
 *      percentages equal the dragged values, a part drag in the model frame;
 *   7. the tool shortcuts, Rotate and Scale included.
 * Run: npx tsx scripts/test-import-transform.ts (throws on the first failure).
 */
import assert from "node:assert/strict";
import * as THREE from "three";
import { samplePlan } from "../src/data/samplePlan";
import { frameBox } from "../src/lib/handles3d/math";
import { putLoaded, setAssetStoreForTests } from "../src/lib/import/assetCache";
import { memoryAssetStore } from "../src/lib/import/assetStore";
import { loadModel } from "../src/lib/import/loadModel";
import { applyOverrides, applyPartTransforms, footprint, guessUnit, modelFrame, nodePaths, partBox, pickPart, pivotOf } from "../src/lib/import/model";
import {
  BELOW_FLOOR,
  GRAB_FARTHER,
  isIdentityTransform,
  itemPoint,
  liftItem,
  moveItemFloor,
  parseDegrees,
  parsePercent,
  pointerAngle,
  rotateItem,
  SCALE_LIMIT,
  scaleItem,
  scaleToPercent,
  wrapAngle,
  worldToModelDelta,
} from "../src/lib/import/transform";
import { useItemToolStore } from "../src/store/itemToolStore";
import { usePlanStore } from "../src/store/planStore";
import { useSelectionStore } from "../src/store/selectionStore";
import { TOOL_SHORTCUTS } from "../src/store/toolStore";
import type { ImportInfo, NodeOverride, Plan } from "../src/types/plan";
import { makeGlb } from "./make-import-fixtures";

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const nearV = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, eps: number, msg: string) =>
  assert.ok(near(a.x, b.x, eps) && near(a.y, b.y, eps) && near(a.z, b.z, eps), `${msg}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
const DEG = Math.PI / 180;
const item = { position: { x: 2, y: 0, z: 3 }, rotationY: 0, scale: 1 };

// ================================================================= 1. the pure rules
{
  // floor move: start + pointer movement, on the 5 cm grid; 1 cm with snapping off
  assert.deepEqual(moveItemFloor(item, { x: 1, y: 1 }, { x: 1.33, y: 0.88 }, { snap: true }), { ok: true, value: { x: 2.35, y: 2.9 }, reason: null });
  assert.deepEqual(moveItemFloor(item, { x: 1, y: 1 }, { x: 1.334, y: 0.876 }, { snap: false }).value, { x: 2.33, y: 2.88 }, "Alt: 1 cm");
  assert.deepEqual(moveItemFloor({ position: { x: 2.03, y: 0, z: 3 } }, { x: 0, y: 0 }, { x: 0, y: 0 }, { snap: true }).value, { x: 2.05, y: 3 }, "the grid is absolute: an off-grid model lands on it");

  // lift: 0 to 10 m, with the reason
  assert.deepEqual(liftItem(item, 0.52, { snap: true }), { ok: true, value: 0.5, reason: null });
  assert.deepEqual(liftItem(item, 0.527, { snap: false }), { ok: true, value: 0.53, reason: null });
  assert.deepEqual(liftItem({ position: { x: 0, y: 0.4, z: 0 } }, -1, { snap: true }), { ok: true, value: 0, reason: BELOW_FLOOR }, "Can't go below the floor");
  assert.equal(BELOW_FLOOR, "Can't go below the floor");
  assert.deepEqual(liftItem(item, 12, { snap: true }), { ok: true, value: 10, reason: "Height goes up to 10 m" });

  // rotate: 15° steps of the change, free 0.1°, wrapped to (-π, π]
  const r = (a0: number, a1: number, snapDeg: number | null, start = 0) => rotateItem({ rotationY: start }, a0 * DEG, a1 * DEG, { snapDeg }).value / DEG;
  assert.ok(near(r(0, 22, 15), 15), "22° → 15°");
  assert.ok(near(r(0, 23, 15), 30), "23° → 30°");
  assert.ok(near(r(10, 42.34, null), 32.3, 1e-9), "free: 0.1° (32.34 → 32.3)");
  assert.ok(near(r(0, 30, 15, 7 * DEG), 37), "the change is snapped, not the result (7° + 30°)");
  assert.ok(near(r(0, 90, 15, 170 * DEG), -100), "wrapped: 170° + 90° = -100°");
  assert.ok(near(r(170, -170, 15), 15), "across ±180°: the short way (+20° → 15°)");
  assert.equal(wrapAngle(Math.PI), Math.PI, "π stays π");
  assert.equal(wrapAngle(-Math.PI), Math.PI, "-π is π");

  // the SIGN: the panel's rotation field sets rotationY = degrees × π/180 (90 → π/2). A pointer dragged from east of
  // the base point to north of it gives +90°, and the model, turned by that, carries its east point to the north,
  // under the pointer (three's rotateY, the same map as model.footprint and transform.itemPoint)
  const c = { x: 2, y: 3 };
  const east = { x: 3, y: 3 };
  const north = { x: 2, y: 2 }; // plan y runs south: north is y - 1
  const turned = rotateItem({ rotationY: 0 }, pointerAngle(c, east), pointerAngle(c, north), { snapDeg: 15 }).value;
  assert.ok(near(turned, Math.PI / 2), `east → north is +90° (${turned / DEG}°), the panel's "90"`);
  const p = itemPoint({ position: { x: 2, y: 0, z: 3 }, rotationY: turned, scale: 1 }, { x: 1, y: 0, z: 0 });
  assert.ok(near(p.x, north.x) && near(p.z, north.y), `the model's east point follows the pointer to the north (${JSON.stringify(p)})`);
  const fp = footprint({ position: { x: 2, y: 0, z: 3 }, rotationY: turned, scale: 1 }, { min: { x: 1, y: 0, z: -0.001 }, max: { x: 1, y: 0, z: 0.001 } });
  assert.ok(fp.every((q) => near(q.x, 2, 0.002) && near(q.y, 2, 0.002)), "and the 2D footprint agrees");

  // scale: the ratio of screen distances from the base point; 1%, 0.1% free; 1–10,000%; a grab under 24 px is refused
  assert.deepEqual(scaleItem({ scale: 1 }, 100, 150, { snap: true }), { ok: true, value: 1.5, reason: null });
  assert.deepEqual(scaleItem({ scale: 1.2 }, 100, 123, { snap: true }), { ok: true, value: 1.48, reason: null }, "1.2 × 1.23 = 1.476 → 148%");
  assert.deepEqual(scaleItem({ scale: 1.2 }, 100, 123, { snap: false }).value, 1.476, "Alt: 0.1%");
  assert.deepEqual(scaleItem({ scale: 1 }, 23.9, 100, { snap: true }), { ok: false, value: 1, reason: GRAB_FARTHER }, "under 24 px: refused");
  assert.equal(GRAB_FARTHER, "Grab farther from the base point");
  assert.deepEqual(scaleItem({ scale: 1 }, 24, 24, { snap: true }), { ok: true, value: 1, reason: null }, "24 px is enough");
  assert.deepEqual(scaleItem({ scale: 0.02 }, 100, 10, { snap: true }), { ok: true, value: 0.01, reason: SCALE_LIMIT }, "held at 1%");
  assert.deepEqual(scaleItem({ scale: 50 }, 30, 300, { snap: true }), { ok: true, value: 100, reason: SCALE_LIMIT }, "held at 10,000%");

  // typed values
  assert.equal(parseDegrees("30"), 30);
  assert.equal(parseDegrees("-45°"), -45);
  assert.equal(parseDegrees("12.5 deg"), 12.5);
  assert.equal(parseDegrees("abc"), null);
  assert.equal(parsePercent("150"), 150);
  assert.equal(parsePercent("150%"), 150);
  assert.equal(parsePercent("0"), null, "0% is not a scale");
  assert.deepEqual(scaleToPercent(150), { ok: true, value: 1.5, reason: null });
  assert.deepEqual(scaleToPercent(20000), { ok: true, value: 100, reason: SCALE_LIMIT });

  // world ↔ model frame
  const it = { position: { x: 1, y: 0, z: 1 }, rotationY: 0.7, scale: 2 };
  const local = { x: 0.3, y: 0.2, z: -0.4 };
  const d = { x: 0.5, y: 0.1, z: -0.2 };
  const moved = itemPoint(it, { x: local.x + worldToModelDelta(it, d).x, y: local.y + worldToModelDelta(it, d).y, z: local.z + worldToModelDelta(it, d).z });
  nearV(moved, { x: itemPoint(it, local).x + d.x, y: itemPoint(it, local).y + d.y, z: itemPoint(it, local).z + d.z }, 1e-12, "worldToModelDelta undoes the item's turn and scale");
  assert.ok(isIdentityTransform({ t: [0, 0, 0], rotY: 0, s: 1 }) && !isIdentityTransform({ t: [0, 0.01, 0], rotY: 0, s: 1 }));
}

// ================================================================= 2. part transforms on a nested model
/**
 * root (moved 1 m in x)
 *   0   Furniture  turned 30° about the FILE's z, scaled (2, 1, 1): a shear once a child turns about Y
 *     0/0  Table   moved (1, 0, 0) inside it
 *       0/0/0  Top (mesh)
 *       0/0/1  Leg (mesh)
 *     0/1  Chair (mesh)
 *   1   Lamp (mesh)
 * Drawn in units of 0.5 m, Z up: the model frame is F = scale(0.5) · tilt(-90° about x).
 */
const box = (name: string, sx: number, sy: number, sz: number, at: [number, number, number]) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz));
  m.name = name;
  m.position.set(...at);
  return m;
};
function nested() {
  const root = new THREE.Group();
  root.position.set(1, 0, 0);
  const furniture = new THREE.Group();
  furniture.name = "Furniture";
  furniture.rotation.z = 30 * DEG;
  furniture.scale.set(2, 1, 1);
  const table = new THREE.Group();
  table.name = "Table";
  table.position.set(1, 0, 0);
  table.add(box("Top", 1, 0.8, 0.1, [0, 0, 0.75]), box("Leg", 0.1, 0.1, 0.7, [0.3, 0.2, 0.35]));
  furniture.add(table, box("Chair", 0.5, 0.5, 0.9, [-1, 0.5, 0.45]));
  root.add(furniture, box("Lamp", 0.3, 0.3, 1.6, [3, 2, 0.8]));
  return root;
}
const frame = { unitToMetres: 0.5, upAxis: "z" as const };
/** A clone drawn as ImportedItems draws it (unit group around the up-axis group), and the model-frame world box of a node by path. */
function drawn(clone: THREE.Object3D) {
  const tilt = new THREE.Group().add(clone);
  tilt.rotation.x = -Math.PI / 2;
  const unit = new THREE.Group().add(tilt);
  unit.scale.setScalar(frame.unitToMetres);
  const boxOf = (path: string) => {
    unit.updateMatrixWorld(true);
    let node: THREE.Object3D | null = null;
    clone.traverse((o) => void (node ??= o.userData.importPath === path ? o : null));
    if (!node) return null;
    const b = new THREE.Box3();
    (node as THREE.Object3D).traverseVisible((o) => void ((o as THREE.Mesh).isMesh && b.union(new THREE.Box3().setFromObject(o, true))));
    return b.isEmpty() ? null : b;
  };
  return boxOf;
}
const shift = (b: THREE.Box3, t: [number, number, number]) => b.clone().translate(new THREE.Vector3(...t));
const sameBox = (a: THREE.Box3 | null, b: THREE.Box3 | null, eps: number, msg: string) =>
  assert.ok(a && b && a.min.distanceTo(b.min) <= eps && a.max.distanceTo(b.max) <= eps, `${msg}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
{
  const original = nested();
  const before = JSON.stringify(original.toJSON());
  const paths = nodePaths(original).map((n) => `${n.path}:${n.label}`);
  assert.deepEqual(paths, ["0:Furniture", "0/0:Table", "0/0/0:Top", "0/0/1:Leg", "0/1:Chair", "1:Lamp"], "the nested model's paths");

  const plain = original.clone();
  applyOverrides(plain, {}, frame, original);
  const at0 = drawn(plain);
  const [table0, top0, leg0, chair0, lamp0] = ["0/0", "0/0/0", "0/0/1", "0/1", "1"].map((p) => at0(p)!);

  // the part's box in the model frame is the drawn one, and its pivot is its bottom centre
  const pb = partBox(original, "0/0", frame)!;
  sameBox(new THREE.Box3(new THREE.Vector3(pb.min.x, pb.min.y, pb.min.z), new THREE.Vector3(pb.max.x, pb.max.y, pb.max.z)), table0, 1e-9, "partBox = the drawn box (model frame)");
  const pivot = pivotOf(pb);

  // a move: the part's world box moves by EXACTLY the offset; its children follow; its siblings stay
  const t: [number, number, number] = [0.4, 0.1, -0.3];
  const moved = original.clone();
  applyOverrides(moved, { "0/0": { transform: { t, rotY: 0, s: 1 } } }, frame, original);
  const at1 = drawn(moved);
  sameBox(at1("0/0"), shift(table0, t), 1e-9, "Table moved by exactly (0.4, 0.1, -0.3)");
  sameBox(at1("0/0/0"), shift(top0, t), 1e-9, "its child Top follows");
  sameBox(at1("0/0/1"), shift(leg0, t), 1e-9, "its child Leg follows");
  sameBox(at1("0/1"), chair0, 1e-12, "sibling Chair does not move");
  sameBox(at1("1"), lamp0, 1e-12, "Lamp does not move");
  assert.equal(moved.getObjectByName("Table")!.matrixAutoUpdate, false, "the moved node keeps its exact matrix (a shear, under the uneven parent)");

  // a quarter turn about the pivot: the bottom centre stays, width and depth swap; a scale of 2: the size doubles
  const turned = original.clone();
  applyOverrides(turned, { "0/0": { transform: { t: [0, 0, 0], rotY: Math.PI / 2, s: 2 } } }, frame, original);
  const tb = drawn(turned)("0/0")!;
  const s0 = table0.getSize(new THREE.Vector3());
  const s1 = tb.getSize(new THREE.Vector3());
  assert.ok(near(s1.x, 2 * s0.z, 1e-9) && near(s1.z, 2 * s0.x, 1e-9) && near(s1.y, 2 * s0.y, 1e-9), `turned 90° and scaled ×2 (${s0.toArray()} → ${s1.toArray()})`);
  nearV({ x: (tb.min.x + tb.max.x) / 2, y: tb.min.y, z: (tb.min.z + tb.max.z) / 2 }, pivot, 1e-9, "about its pivot: the bottom centre stays");

  // a transformed parent carries the part: Furniture moved by u, Table by t: Table moves by u + t, Chair by u
  const u: [number, number, number] = [-0.2, 0.3, 0.5];
  const both = original.clone();
  applyOverrides(both, { "0": { transform: { t: u, rotY: 0, s: 1 } }, "0/0": { transform: { t, rotY: 0, s: 1 } } }, frame, original);
  const at2 = drawn(both);
  sameBox(at2("0/0"), shift(table0, [t[0] + u[0], t[1] + u[1], t[2] + u[2]]), 1e-9, "parent and part moved: the offsets add");
  sameBox(at2("0/1"), shift(chair0, u), 1e-9, "Chair follows its parent only");
  sameBox(at2("1"), lamp0, 1e-12, "Lamp still does not move");
  // a turned parent turns the part's pivot with it: Furniture turned 90° about its own pivot carries the Table round it
  const spun = original.clone();
  applyOverrides(spun, { "0": { transform: { t: [0, 0, 0], rotY: Math.PI / 2, s: 1 } } }, frame, original);
  const fPivot = pivotOf(partBox(original, "0", frame)!);
  const tc = table0.getCenter(new THREE.Vector3());
  const expected = new THREE.Vector3(tc.x - fPivot.x, tc.y, tc.z - fPivot.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2).add(new THREE.Vector3(fPivot.x, 0, fPivot.z));
  nearV(drawn(spun)("0/0")!.getCenter(new THREE.Vector3()), expected, 1e-9, "a turned parent carries its part round the parent's pivot");

  // re-applying on the same clone (a drag) undoes the earlier transform first
  applyPartTransforms(moved, { "0/0": { transform: { t: [0, 0, 0.2], rotY: 0, s: 1 } } }, frame, original);
  sameBox(drawn(moved)("0/0"), shift(table0, [0, 0, 0.2]), 1e-9, "applyPartTransforms again: only the new offset");
  applyPartTransforms(moved, {}, frame, original);
  sameBox(drawn(moved)("0/0"), table0, 1e-9, "and none: back where the file put it");
  assert.equal(moved.getObjectByName("Table")!.matrixAutoUpdate, true, "with its own matrix handling back");

  // hidden and deleted rules stay; a deleted parent takes the part with it but keeps its transform; Restore brings it back exactly
  const withT: Record<string, NodeOverride> = { "0/0": { transform: { t, rotY: 0, s: 1 } } };
  const hidden = original.clone();
  applyOverrides(hidden, { "0/0": { ...withT["0/0"], hidden: true } }, frame, original);
  assert.equal(drawn(hidden)("0/0"), null, "a hidden, moved part is not drawn");
  assert.equal(hidden.getObjectByName("Table")!.visible, false);
  const gone = original.clone();
  applyOverrides(gone, { ...withT, "0": { deleted: true } }, frame, original);
  assert.equal(gone.getObjectByName("Table"), undefined, "the parent deleted: the moved part is gone with it");
  sameBox(drawn(gone)("1"), lamp0, 1e-12, "the rest stays");
  const restored = original.clone();
  applyOverrides(restored, withT, frame, original); // Restore drops `deleted`, the plan still holds the transform
  sameBox(drawn(restored)("0/0"), shift(table0, t), 1e-9, "Restore: the part comes back exactly where it was moved to");
  // two deletions plus a transform: paths resolved before anything is removed
  const two = original.clone();
  applyOverrides(two, { "0/0/0": { deleted: true }, "0/1": { deleted: true }, "0/0/1": { transform: { t, rotY: 0, s: 1 } } }, frame, original);
  sameBox(drawn(two)("0/0/1"), shift(leg0, t), 1e-9, "Leg moves although Top, before it, was deleted");

  assert.equal(JSON.stringify(original.toJSON()), before, "the cached original is exactly as it was after all of this");
  assert.equal(original.userData.importPath, undefined, "and was never tagged");
}

// ================================================================= 3. pickPart
{
  const root = new THREE.Group();
  const wrapper = new THREE.Group();
  wrapper.name = "SketchUp"; // a named group that only wraps the whole model
  const chair = new THREE.Group();
  chair.name = "Chair";
  const inner = new THREE.Group(); // unnamed
  const seat = new THREE.Mesh();
  seat.name = "Seat";
  const loose = new THREE.Group(); // unnamed
  const bare = new THREE.Mesh(); // unnamed
  inner.add(seat);
  chair.add(inner);
  loose.add(bare);
  wrapper.add(chair, loose);
  root.add(wrapper);
  assert.equal(pickPart(root, seat, { deep: false }), "0/0", "the highest named node below the wrapper: Chair");
  assert.equal(pickPart(root, seat, { deep: true }), "0/0/0/0", "Alt: the mesh's own node");
  assert.equal(pickPart(root, bare, { deep: false }), "0/1/0", "nothing named on the way: the mesh itself");
  assert.equal(pickPart(root, new THREE.Mesh(), { deep: false }), null, "a mesh of another model: null");
  root.add(new THREE.Mesh()); // the wrapper is no longer the whole model
  assert.equal(pickPart(root, seat, { deep: false }), "0", "a named group beside others is a part: SketchUp");
  // on a tagged clone after a deletion shifted indices: the ORIGINAL path comes back
  const clone = root.clone();
  applyOverrides(clone, { "0/0": { deleted: true } });
  const cloneBare = clone.children[0].children[0].children[0]; // was 0/1/0, now at index 0
  assert.equal(pickPart(clone, cloneBare, { deep: true }), "0/1/0", "tags, not shifted indices");
}

// ================================================================= 4. frameBox
{
  const b = { min: { x: 4, y: 0, z: 2 }, max: { x: 6.4, y: 1.5, z: 3.2 } };
  const check = (camPos: THREE.Vector3, target: THREE.Vector3, w: number, h: number, msg: string) => {
    const r = frameBox(b, { position: camPos, target, fovDeg: 45 }, w / h, 1.15);
    const cam = new THREE.PerspectiveCamera(45, w / h, 0.1, 500);
    cam.position.set(r.position.x, r.position.y, r.position.z);
    cam.lookAt(r.target.x, r.target.y, r.target.z);
    cam.updateMatrixWorld();
    let worst = 0;
    for (const x of [b.min.x, b.max.x])
      for (const y of [b.min.y, b.max.y])
        for (const z of [b.min.z, b.max.z]) {
          const v = new THREE.Vector3(x, y, z).project(cam);
          assert.ok(v.z > -1 && v.z < 1, `${msg}: a corner is between the near and far planes`);
          worst = Math.max(worst, Math.abs(v.x), Math.abs(v.y));
        }
    assert.ok(worst <= 1 / 1.15 + 1e-9, `${msg}: every corner inside the frustum with 15% to spare (${worst.toFixed(4)})`);
    assert.ok(worst >= 1 / 1.15 - 1e-6, `${msg}: and the box fills it (${worst.toFixed(4)})`);
    assert.ok(r.position.y > 0, `${msg}: above the ground (${r.position.y})`);
    return r;
  };
  const from = new THREE.Vector3(20, 15, 25);
  const to = new THREE.Vector3(5, 0, 4);
  for (const [w, h] of [
    [1440, 900],
    [390, 844],
  ]) {
    const r = check(from, to, w, h, `${w}×${h}`);
    const was = from.clone().sub(to).normalize();
    const now = new THREE.Vector3(r.position.x - r.target.x, r.position.y - r.target.y, r.position.z - r.target.z).normalize();
    assert.ok(was.distanceTo(now) < 1e-9, `${w}×${h}: from the camera's current direction`);
    nearV(r.target, { x: 5.2, y: 0.75, z: 2.6 }, 1e-12, `${w}×${h}: looking at the box's centre`);
  }
  const low = check(new THREE.Vector3(5, -3, 12), new THREE.Vector3(5, 0, 4), 1440, 900, "a camera below the floor");
  assert.ok(low.position.y >= 0.75, "is raised above the box's centre (5° up at least)");
}

// ================================================================= 5. the unit rule
{
  const s = (n: number) => ({ x: n, y: n * 0.6, z: n * 0.3 });
  const g = (n: number, detected: number | null = null) => guessUnit(s(n), detected);
  assert.equal(g(3200).chosen.unit, "mm", "3200 units → mm (3.2 m)");
  assert.equal(g(320).chosen.unit, "cm", "320 → cm (3.2 m)");
  assert.equal(g(126).chosen.unit, "in", "126 → inches (3.20 m)");
  assert.equal(g(3.2).chosen.unit, "m", "3.2 → m");
  assert.equal(g(3.2, 0.01).chosen.unit, "cm", "a COLLADA unit overrides the guess");
  assert.equal(g(3.2, 0.01).ambiguous, false, "and a stated unit is never ambiguous");
  assert.equal(g(3000).chosen.unit, "mm", "3000 → mm: a 3 m object…");
  assert.equal(g(3000).ambiguous, true, "…or a 30 m house (cm): ambiguous");
  assert.ok(near(g(3000).candidates.find((c) => c.unit === "cm")!.size.x, 30), "the 30 m reading is offered");
  assert.equal(g(0.5).ambiguous, false, "only one unit fits (0.5 m): not ambiguous");
  assert.equal(g(1000).ambiguous, true, "1000 → 1 m (mm) or 10 m (cm): more than 2× apart");
  // ties: equal distance from 3 m on the log scale go m, mm, cm, in, ft. 30 × 0.1 m and 0.3 m are equally far from 3 m.
  assert.equal(guessUnit({ x: 1, y: 0, z: 0 }, null).chosen.unit, "m", "1 → metres (1 m; feet would be 0.30 m)");
}

// ================================================================= 6. the store: one undo step each, rollback, typed = dragged
async function storeChecks() {
  const store = memoryAssetStore();
  setAssetStoreForTests(store);
  const glb = makeGlb(
    [
      { name: "Seat", min: [-0.25, 0.4, -0.25], max: [0.25, 0.45, 0.25] },
      { name: "Back", min: [-0.25, 0.45, 0.2], max: [0.25, 0.9, 0.25] },
    ],
    { group: "Chair" },
  );
  const files = [{ name: "chair.glb", bytes: glb }];
  const assetId = await store.put("Chair", files);
  const model = await loadModel(files);
  putLoaded(assetId, model);

  const s = () => usePlanStore.getState();
  const t = () => useItemToolStore.getState();
  s().loadPlan(structuredClone(samplePlan));
  const info: ImportInfo = { assetId, name: "Chair", format: "glb", unitToMetres: 1, upAxis: "y", doubleSided: false, nodeOverrides: {} };
  const id = s().addImportedItem(info, { x: 2, y: 0, z: 3 });
  const it = () => s().plan.items.find((i) => i.id === id)!;

  /** `drag` makes several pointer updates then commits: exactly one undo step, undo puts it back, redo applies it again. */
  const oneStep = (what: string, drag: () => void, check: (p: Plan) => void) => {
    const before = structuredClone(s().plan);
    const n = s().past.length;
    drag();
    t().commit();
    assert.equal(s().past.length, n + 1, `${what}: exactly one undo step`);
    const after = structuredClone(s().plan);
    check(after);
    s().undo();
    assert.deepEqual(s().plan, before, `${what}: one undo puts it back`);
    s().redo();
    assert.deepEqual(s().plan, after, `${what}: redo applies it again`);
  };
  const whole = { itemId: id, path: null };

  oneStep(
    "move on the floor",
    () => {
      assert.ok(t().begin(whole, "move"));
      t().moveFloor({ x: 0, y: 0 }, { x: 0.1, y: 0.4 });
      t().moveFloor({ x: 0, y: 0 }, { x: 0.33, y: -0.12 }); // only the last one counts
      assert.equal(t().drag!.label!.distance, "+0.35 m, -0.10 m", "the label says how far");
      assert.equal(t().drag!.label!.value, "At x 2.35 m, y 2.90 m");
    },
    () => assert.deepEqual(it().position, { x: 2.35, y: 0, z: 2.9 }),
  );
  oneStep(
    "lift, held at the floor",
    () => {
      t().begin(whole, "move", { lift: true });
      t().lift(0.8);
      t().lift(-5);
      assert.equal(t().drag!.label!.note, BELOW_FLOOR);
    },
    () => assert.equal(it().position.y, 0),
  );
  oneStep(
    "lift",
    () => {
      t().begin(whole, "move", { lift: true });
      t().lift(0.52);
      assert.equal(t().drag!.label!.value, "Height 0.50 m");
    },
    () => assert.equal(it().position.y, 0.5),
  );

  // rotate: dragged by 30° (snapped from 31°) vs typed "30" + Enter: the same rotation
  const rot0 = it().rotationY;
  oneStep(
    "rotate by dragging",
    () => {
      t().begin(whole, "rotate");
      t().rotate(0, 31 * DEG);
      assert.equal(t().drag!.label!.distance, "+30°");
    },
    () => assert.ok(near(it().rotationY, rot0 + 30 * DEG, 1e-12)),
  );
  const dragged = it().rotationY;
  s().undo();
  useSelectionStore.getState().selectItem(id);
  oneStep(
    "rotate by typing 30",
    () => {
      t().setTyped("30");
      assert.equal(t().applyTyped("rotate"), true);
      t().commit(); // (already committed: a no-op)
    },
    () => assert.ok(near(it().rotationY, dragged, 1e-12), `typed 30° = dragged 30° (${it().rotationY} vs ${dragged})`),
  );

  // scale: dragged 100 → 150 px vs typed "150%": the same scale
  oneStep(
    "scale by dragging",
    () => {
      t().begin(whole, "scale");
      t().scale(100, 150);
      assert.equal(t().drag!.label!.distance, "Scale 150%");
      assert.equal(t().drag!.label!.value, "Size 0.75 × 0.75 × 0.75 m", "and the size it makes (0.5 m × 1.5)");
    },
    () => assert.equal(it().scale, 1.5),
  );
  const draggedScale = it().scale;
  s().undo();
  oneStep(
    "scale by typing 150%",
    () => {
      t().setTyped("150%");
      assert.ok(t().applyTyped("scale"));
    },
    () => assert.equal(it().scale, draggedScale),
  );
  oneStep("a scale grabbed under 24 px changes nothing", () => {
    const n = s().past.length;
    t().begin(whole, "scale");
    t().scale(10, 40);
    assert.equal(t().drag!.label!.note, GRAB_FARTHER);
    assert.equal(s().past.length, n, "no preview while refused");
    t().scale(100, 120); // farther out: it works
  }, () => assert.ok(near(it().scale / draggedScale, 1.2, 0.01)));

  // a rollback (Escape, pointercancel, blur, a second finger) leaves plan and history exactly as they were
  for (const kind of ["move", "rotate", "scale"] as const) {
    const plan = structuredClone(s().plan);
    const past = s().past.length;
    const top = s().past[past - 1];
    t().begin(whole, kind);
    if (kind === "move") t().moveFloor({ x: 0, y: 0 }, { x: 1, y: 1 });
    if (kind === "rotate") t().rotate(0, 1);
    if (kind === "scale") t().scale(100, 300);
    assert.notDeepEqual(s().plan, plan, `${kind}: the preview is live`);
    t().cancel();
    assert.deepEqual(s().plan, plan, `${kind}: cancel puts the plan back`);
    assert.equal(s().past.length, past, `${kind}: and history has the same length`);
    assert.equal(s().past[past - 1], top, `${kind}: with the same newest entry`);
  }
  // Alt mid-drag re-applies the same pointer unsnapped
  t().begin(whole, "move");
  t().moveFloor({ x: 0, y: 0 }, { x: 0.333, y: 0 });
  const snapped = it().position.x;
  t().setAlt(true);
  assert.ok(near(it().position.x - snapped, 0.33 - 0.35, 1e-9), `Alt: 1 cm instead of 5 cm (${snapped} → ${it().position.x})`);
  t().setAlt(false);
  t().cancel();

  // ---- a part: moved in the MODEL frame. Turn and scale the item first, so world and model differ.
  s().updateItem(id, { rotationY: Math.PI / 2, scale: 2, position: { x: 2, y: 0, z: 3 } });
  const seat = nodePaths(model.root).find((n) => n.label === "Seat")!.path;
  const part = { itemId: id, path: seat };
  const tr = () => it().import!.nodeOverrides[seat]?.transform;
  oneStep(
    "move a part on the floor",
    () => {
      assert.ok(t().begin(part, "move"));
      t().moveFloor({ x: 0, y: 0 }, { x: 0.5, y: 0 });
    },
    () => {
      const m = worldToModelDelta(it(), { x: 0.5, y: 0, z: 0 }); // 0.5 m east in the world, under a 90° turn and ×2
      assert.ok(near(tr()!.t[0], m.x, 1e-12) && near(tr()!.t[2], m.z, 1e-12) && tr()!.t[1] === 0, `t = ${tr()!.t} (expected ${m.x}, 0, ${m.z})`);
      assert.ok(near(m.z, 0.25, 1e-12) && near(m.x, 0, 1e-12), "0.5 m east is 0.25 model metres along the model's z");
    },
  );
  oneStep(
    "turn a part",
    () => {
      t().begin(part, "rotate");
      t().rotate(0, 44 * DEG);
    },
    () => assert.ok(near(tr()!.rotY, 45 * DEG, 1e-12)),
  );
  oneStep(
    "scale a part by typing 200",
    () => {
      useSelectionStore.getState().selectItem(id);
      useSelectionStore.getState().selectPart(seat);
      t().setTyped("200");
      t().applyTyped("scale");
    },
    () => assert.equal(tr()!.s, 2),
  );
  oneStep("Reset part", () => s().setNodeTransform(id, seat, null), (p) => assert.equal(p.items.find((i) => i.id === id)!.import!.nodeOverrides[seat], undefined, "nothing left: the identity is never stored"));
  s().undo(); // the part is scaled again
  const kept = structuredClone(tr()!); // moved 0.25 along z, turned 45°, scaled ×2
  assert.deepEqual(kept, { t: [0, 0, 0.25], rotY: 45 * DEG, s: 2 }, "the part's three edits add up (t rounded to the micrometre)");
  oneStep("hide a moved part (its transform kept)", () => s().setNodeOverride(id, seat, { hidden: true }), () => assert.deepEqual(it().import!.nodeOverrides[seat], { hidden: true, transform: kept }));
  oneStep("show it again", () => s().setNodeOverride(id, seat, null), () => assert.deepEqual(it().import!.nodeOverrides[seat], { transform: kept }, "null clears the flags, not the transform"));
  // the part store's pivot: the seat's original bottom centre, whatever its transform
  const pb = partBox(model.root, seat, { unitToMetres: 1, upAxis: "y" })!;
  nearV(pivotOf(pb), { x: 0, y: 0.4, z: 0 }, 1e-6, "the seat's pivot is its bottom centre");
  const base = modelFrame(model.box, 1, "y").base;
  nearV(base, { x: 0, y: 0.4, z: 0 }, 1e-6, "(the model's base point, for comparison)");
  useSelectionStore.getState().select(null);
}

// ================================================================= 7. shortcuts
{
  const keys = Object.values(TOOL_SHORTCUTS);
  assert.equal(new Set(keys).size, keys.length, `no two tools share a shortcut: ${JSON.stringify(TOOL_SHORTCUTS)}`);
  assert.equal(TOOL_SHORTCUTS.rotate, "q");
  assert.equal(TOOL_SHORTCUTS.scale, "z");
  for (const k of keys) {
    assert.ok(!/^[0-9.,'"+\-cmftin %°]$/i.test(k!), `${k} is not a key a typed distance, angle or percentage uses`);
    assert.ok(!"wasd".includes(k!), `${k} is not a walking key`);
  }
}

storeChecks().then(
  () => console.log("OK"),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
