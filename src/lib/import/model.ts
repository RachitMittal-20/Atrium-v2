/**
 * model.ts — pure helpers on an imported model's three.js scene (step I.1). No DOM,
 * no React, no loaders: everything here runs the same in the browser and in Node, so
 * scripts/test-import.ts can check it.
 *
 *   nodePaths       every node below the root with its child-index path ("0/3/1").
 *                   Paths are how Item.import.nodeOverrides names a node, so they must
 *                   come out the same on every parse of the same file.
 *   nodeAt          the node at a path, or null.
 *   applyOverrides  move parts (applyPartTransforms), hide (invisible) or delete (removed)
 *                   nodes of a CLONE. Never call it on the cached original: assetCache
 *                   shares that between items.
 *   partBox, pickPart, applyPartTransforms  parts (step I.1b): a part's original box in
 *                   the model frame (its pivot is the bottom centre), which part a click
 *                   means, and its move / turn / scale put on a clone.
 *   countTriangles  triangles in every mesh (indexed or not).
 *   applyUpAxis     turns a Z-up model to the plan's Y-up.
 *   placeOnFloor    moves an object so its lowest point is at y = 0.
 *   guessUnit       which unit the file was drawn in: declared, else the last unit used,
 *                   else metric nearest 1.5 m; and whether that is ambiguous.
 *   modelFrame      the base point (bottom centre of the bounding box, metres) and size
 *                   of a model under a unit and an up axis.
 *   visibleBox      the bounding box of the meshes an item still shows.
 *   footprint       the floor outline of a placed item, for the 2D plan.
 *
 * Coordinates: three.js world space as everywhere in 3D (x east, y up, z south);
 * a plan point (x, y) is world (x, ·, y). Connects to: src/lib/import/loadModel.ts
 * (produces the scenes), src/lib/import/assetCache.ts, src/components/three/ImportedItems.tsx,
 * src/components/plan2d/PlanCanvas.tsx, src/components/studio/{ItemPanel,ImportModelDialog}.tsx.
 */
import * as THREE from "three";
import type { Item, NodeOverride, PartTransform, Vec2, Vec3 } from "@/types/plan";
import { isIdentityTransform } from "./transform";

// ---------------------------------------------------------------- node paths

export interface NodeEntry {
  /** Child indices from the root joined by "/"; the root itself is "". */
  path: string;
  object: THREE.Object3D;
  depth: number;
  /** The node's own name, or "Object N" (N = its place among its siblings) when it has none. */
  label: string;
  /** Meshes in this node's subtree, itself included. */
  meshes: number;
}

const isMesh = (o: THREE.Object3D): o is THREE.Mesh => (o as THREE.Mesh).isMesh === true;

/** Every node below `root`, depth first, in child order. */
export function nodePaths(root: THREE.Object3D): NodeEntry[] {
  const out: NodeEntry[] = [];
  const walk = (o: THREE.Object3D, path: string, depth: number): number => {
    let meshes = isMesh(o) ? 1 : 0;
    o.children.forEach((child, i) => {
      const p = path === "" ? String(i) : `${path}/${i}`;
      const at = out.length;
      out.push({ path: p, object: child, depth, label: child.name.trim() || `Object ${i + 1}`, meshes: 0 });
      const n = walk(child, p, depth + 1);
      out[at].meshes = n;
      meshes += n;
    });
    return meshes;
  };
  walk(root, "", 0);
  return out;
}

/** The node at `path` below `root`; "" is the root. */
export function nodeAt(root: THREE.Object3D, path: string): THREE.Object3D | null {
  let o: THREE.Object3D | undefined = root;
  if (path === "") return root;
  for (const i of path.split("/")) {
    o = o?.children[Number(i)];
    if (!o) return null;
  }
  return o;
}

/**
 * Apply an item's overrides to `clone` in place: each part's transform first (see
 * applyPartTransforms; pivots come from `pivotRoot`, the cached original, or the clone
 * before anything is removed), then a hidden node is made invisible and a deleted one
 * is removed from its parent. Paths are resolved before anything is removed, so removing
 * one node never shifts another's path; every node of the clone is tagged with its path
 * in the ORIGINAL (userData.importPath) and its matrix as the file made it
 * (userData.importBase). Unknown paths (a file that changed) are ignored. A deleted
 * parent takes its children with it, but their transforms stay in the plan, so Restore
 * brings them back exactly. Never call it on the cached original.
 */
export function applyOverrides(clone: THREE.Object3D, overrides: Record<string, NodeOverride>, frame: ModelFrameInfo = { unitToMetres: 1, upAxis: "y" }, pivotRoot?: THREE.Object3D): void {
  tagNodes(clone);
  applyPartTransforms(clone, overrides, frame, pivotRoot ?? clone);
  const found = Object.entries(overrides).map(([path, o]) => ({ node: findNode(clone, path), o }));
  for (const { node, o } of found) {
    if (!node) continue;
    if (o.hidden) node.visible = false;
    if (o.deleted && node !== clone) node.removeFromParent();
  }
}

// ---------------------------------------------------------------- parts (step I.1b)

export interface ModelFrameInfo {
  unitToMetres: number;
  upAxis: "y" | "z";
}

/**
 * The model frame (metres, Y up) from the file's own: F = scale(unit) · tilt(up axis),
 * the same nesting ImportedItems draws (a unit group around an up-axis group).
 */
export function frameMatrix(frame: ModelFrameInfo): THREE.Matrix4 {
  const k = frame.unitToMetres;
  return new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeRotationX(upTilt(frame.upAxis)));
}

/** A node's matrix as the file made it: the one recorded when the clone was tagged, else its own. */
function baseMatrix(o: THREE.Object3D): THREE.Matrix4 {
  const b = o.userData.importBase as number[] | undefined;
  if (b) return new THREE.Matrix4().fromArray(b);
  return o.matrixAutoUpdate ? new THREE.Matrix4().compose(o.position, o.quaternion, o.scale) : o.matrix.clone();
}

/** Tag every node of a clone with its path and original matrix (once: the tags are what later calls rely on). */
function tagNodes(clone: THREE.Object3D): void {
  if (typeof clone.userData.importPath === "string") return;
  const tag = (o: THREE.Object3D, path: string) => {
    o.userData.importBase = baseMatrix(o).toArray(); // a plain array: userData is copied as JSON by three's clone()
    o.userData.importAuto = o.matrixAutoUpdate;
    o.userData.importPath = path;
  };
  for (const n of nodePaths(clone)) tag(n.object, n.path);
  tag(clone, "");
}

/** The node at `path`: by its tag in a tagged clone (deletions shift indices), else by child indices. */
function findNode(root: THREE.Object3D, path: string): THREE.Object3D | null {
  if (typeof root.userData.importPath !== "string") return nodeAt(root, path);
  let found: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!found && o.userData.importPath === path) found = o;
  });
  return found;
}

/** The original matrix from `root` (its own transform included) down to `o` (included): where the file put `o`. */
function chainTo(root: THREE.Object3D, o: THREE.Object3D): THREE.Matrix4 {
  const list: THREE.Object3D[] = [];
  for (let x: THREE.Object3D | null = o; x; x = x === root ? null : x.parent) list.push(x);
  return list.reverse().reduce((m, x) => m.multiply(baseMatrix(x)), new THREE.Matrix4());
}

/** The bounding box (model frame, metres) of a part as the file made it, every mesh below it counted; null when there is none. */
export function partBox(root: THREE.Object3D, path: string, frame: ModelFrameInfo): Box | null {
  const node = findNode(root, path);
  if (!node) return null;
  const F = frameMatrix(frame);
  const box = new THREE.Box3();
  node.traverse((o) => {
    const g = isMesh(o) ? o.geometry : null;
    if (!g?.attributes?.position) return;
    const local = g.boundingBox?.clone() ?? new THREE.Box3().setFromBufferAttribute(g.attributes.position as THREE.BufferAttribute); // never writes to a shared geometry
    box.union(local.applyMatrix4(F.clone().multiply(chainTo(root, o))));
  });
  return box.isEmpty() ? null : { min: { x: box.min.x, y: box.min.y, z: box.min.z }, max: { x: box.max.x, y: box.max.y, z: box.max.z } };
}

/** A part's pivot: the centre of its original box, at its lowest point (model frame). */
export const pivotOf = (b: Box): Vec3 => ({ x: (b.min.x + b.max.x) / 2, y: b.min.y, z: (b.min.z + b.max.z) / 2 });

/** X: scale by s and turn by rotY about `pivot`, then move by t (model frame). */
export function partMatrix(t: PartTransform, pivot: Vec3): THREE.Matrix4 {
  return new THREE.Matrix4()
    .makeTranslation(pivot.x + t.t[0], pivot.y + t.t[1], pivot.z + t.t[2])
    .multiply(new THREE.Matrix4().makeRotationY(t.rotY))
    .multiply(new THREE.Matrix4().makeScale(t.s, t.s, t.s))
    .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
}

/**
 * Put every part transform in `overrides` on a tagged clone, undoing earlier ones first,
 * so it can run again on every change without rebuilding the clone. For a node N whose
 * parent's ORIGINAL model-frame matrix is P (F times the file's matrices from the root),
 * its new local matrix is P⁻¹ · X · P · L (X = partMatrix, L = N's own original matrix):
 * pre-multiplied in the model frame, converted into the parent's space. Its world
 * matrix is then X · (where the file put it) whatever the parent does, so children
 * follow their parent, a part inside a moved parent turns about its own carried pivot,
 * and a parent with its own rotation and non-uniform scale still works (the matrix is
 * set directly, never decomposed, so a shear is kept exactly).
 */
export function applyPartTransforms(clone: THREE.Object3D, overrides: Record<string, NodeOverride>, frame: ModelFrameInfo, pivotRoot: THREE.Object3D = clone): void {
  tagNodes(clone);
  const byPath = new Map<string, THREE.Object3D>();
  clone.traverse((o) => void byPath.set(String(o.userData.importPath), o));
  for (const o of byPath.values()) {
    if (!o.userData.importMoved) continue;
    o.matrix.fromArray(o.userData.importBase as number[]); // back to the file's own place
    o.matrix.decompose(o.position, o.quaternion, o.scale);
    o.matrixAutoUpdate = o.userData.importAuto !== false;
    o.matrixWorldNeedsUpdate = true;
    o.userData.importMoved = false;
  }
  const F = frameMatrix(frame);
  for (const [path, o] of Object.entries(overrides)) {
    const node = o.transform && path !== "" && !isIdentityTransform(o.transform) ? byPath.get(path) : undefined;
    const box = node?.parent ? partBox(pivotRoot, path, frame) : null;
    if (!node?.parent || !box) continue;
    const P = F.clone().multiply(chainTo(clone, node.parent));
    node.matrix.copy(P.clone().invert().multiply(partMatrix(o.transform!, pivotOf(box))).multiply(P).multiply(baseMatrix(node)));
    node.matrixAutoUpdate = false;
    node.matrixWorldNeedsUpdate = true;
    node.userData.importMoved = true;
  }
}

/**
 * The part transforms of `path`'s ancestors (not its own), multiplied outermost first: the
 * model-frame matrix that carries the part after its own transform. applyPartTransforms makes
 * a node's model-frame matrix X(ancestor 1) · … · X(parent) · X(node) · (where the file put
 * it), so this is everything above the part. The identity when no ancestor is transformed.
 */
export function ancestorTransforms(root: THREE.Object3D, path: string, overrides: Record<string, NodeOverride>, frame: ModelFrameInfo): THREE.Matrix4 {
  const steps = path.split("/");
  const A = new THREE.Matrix4();
  for (let i = 1; i < steps.length; i++) {
    const up = steps.slice(0, i).join("/");
    const tr = overrides[up]?.transform;
    const box = tr && !isIdentityTransform(tr) ? partBox(root, up, frame) : null;
    if (tr && box) A.multiply(partMatrix(tr, pivotOf(box)));
  }
  return A;
}

/** Where a part's pivot is now (model frame): its original pivot moved by its own transform `own`, then carried by its ancestors'. */
export function partPivotNow(root: THREE.Object3D, path: string, overrides: Record<string, NodeOverride>, frame: ModelFrameInfo, own: PartTransform): Vec3 | null {
  const box = partBox(root, path, frame);
  if (!box) return null;
  const p = pivotOf(box);
  const v = new THREE.Vector3(p.x + own.t[0], p.y + own.t[1], p.z + own.t[2]).applyMatrix4(ancestorTransforms(root, path, overrides, frame));
  return { x: v.x, y: v.y, z: v.z };
}

/** A change made to a part in the MODEL frame (a world drag with the item's own turn and scale taken out). */
export type PartChange = { kind: "move"; d: Vec3 } | { kind: "turn"; angle: number; about: Vec3 } | { kind: "scale"; factor: number; about: Vec3 };

/**
 * The part's new transform after `change` (step I.1b-fix: right under any parent chain). The
 * part sits at A · X · (file), A its ancestors' transforms, X its own; the change D happens in
 * the model frame, so the new own transform is X' = A⁻¹ · D · A · X. A, D and X are all a turn
 * about the vertical, a uniform scale and a move, so X' is one too, and is read back as
 * { t, rotY, s } about the part's original pivot.
 */
export function partTransformAfter(root: THREE.Object3D, path: string, overrides: Record<string, NodeOverride>, frame: ModelFrameInfo, own: PartTransform, change: PartChange): PartTransform | null {
  const box = partBox(root, path, frame);
  if (!box) return null;
  const pivot = pivotOf(box);
  const A = ancestorTransforms(root, path, overrides, frame);
  const at = (c: Vec3) => [new THREE.Matrix4().makeTranslation(c.x, c.y, c.z), new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z)];
  let D: THREE.Matrix4;
  if (change.kind === "move") D = new THREE.Matrix4().makeTranslation(change.d.x, change.d.y, change.d.z);
  else {
    const [to, from] = at(change.about);
    const k = change.kind === "scale" ? change.factor : 1;
    D = to.multiply(change.kind === "turn" ? new THREE.Matrix4().makeRotationY(change.angle) : new THREE.Matrix4().makeScale(k, k, k)).multiply(from);
  }
  const X = A.clone().invert().multiply(D).multiply(A).multiply(partMatrix(own, pivot));
  const e = X.elements; // column-major: the first column is s · (cos θ, 0, −sin θ)
  const sc = Math.hypot(e[0], e[1], e[2]);
  const rotY = Math.atan2(-e[2], e[0]);
  const rp = new THREE.Vector3(pivot.x, pivot.y, pivot.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY).multiplyScalar(sc);
  // X · pivot = pivot + t, and X · pivot = s R pivot + (its translation): t = translation − pivot + s R pivot
  return { t: [e[12] - pivot.x + rp.x, e[13] - pivot.y + rp.y, e[14] - pivot.z + rp.z], rotY, s: sc };
}

/** A node's path below `root`: its tag in a tagged clone, else its child indices. */
function pathOf(root: THREE.Object3D, node: THREE.Object3D): string {
  if (typeof node.userData.importPath === "string") return node.userData.importPath;
  const idx: number[] = [];
  for (let x = node; x !== root && x.parent; x = x.parent) idx.push(x.parent.children.indexOf(x));
  return idx.reverse().join("/");
}

/**
 * The part a click on `hit` (a mesh of an item's clone) means, as a node path. Normally
 * the HIGHEST node between the root and the mesh that has a real name (not "Object N"),
 * so a click on a chair leg picks the chair; with `deep` (Alt-click) the mesh's own node.
 * A named group that only wraps the whole model (the root's only child, and so on down)
 * is passed over: picking it would be picking the item. With no named node: the mesh's
 * own. Null when `hit` is not below `root`.
 */
export function pickPart(root: THREE.Object3D, hit: THREE.Object3D, opts: { deep: boolean }): string | null {
  const chain: THREE.Object3D[] = []; // from the mesh up to just below the root
  let x: THREE.Object3D | null = hit;
  while (x && x !== root) {
    chain.push(x);
    x = x.parent;
  }
  if (x !== root || chain.length === 0) return null;
  if (opts.deep) return pathOf(root, chain[0]);
  const top = chain.reverse(); // from just below the root down to the mesh
  let first = 0;
  while (first < top.length - 1 && top[first].parent!.children.length === 1) first++; // wrappers of the whole model
  const named = top.slice(first).find((o) => o.name.trim() !== "");
  return pathOf(root, named ?? top[top.length - 1]);
}

// ---------------------------------------------------------------- counting

/** Triangles in every mesh below `root`: index count / 3, or vertex count / 3 without an index. */
export function countTriangles(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if (!isMesh(o)) return;
    const g = o.geometry as THREE.BufferGeometry | undefined;
    if (!g?.attributes?.position) return;
    n += Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3);
  });
  return n;
}

// ---------------------------------------------------------------- orientation and floor

/** The turn about x that stands a model up: -90° takes a Z-up file's (x, y, z) to (x, z, -y). */
export const upTilt = (up: "y" | "z") => (up === "z" ? -Math.PI / 2 : 0);

/** Turn a model drawn Z-up to the plan's Y-up, or leave a Y-up one alone. */
export function applyUpAxis(object: THREE.Object3D, up: "y" | "z"): void {
  object.rotation.set(upTilt(up), 0, 0);
}

/** Move `object` up or down so its lowest point is at y = 0 in its parent's space; returns how far it moved. */
export function placeOnFloor(object: THREE.Object3D): number {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return 0;
  const shift = -box.min.y;
  object.position.y += shift;
  return shift;
}

// ---------------------------------------------------------------- units

export type UnitId = "m" | "cm" | "mm" | "in" | "ft" | "file";

/** The units the import dialog offers, in the order the guess tries them. */
export const UNITS: { id: Exclude<UnitId, "file">; label: string; toMetres: number }[] = [
  { id: "m", label: "Metres", toMetres: 1 },
  { id: "cm", label: "Centimetres", toMetres: 0.01 },
  { id: "mm", label: "Millimetres", toMetres: 0.001 },
  { id: "in", label: "Inches", toMetres: 0.0254 },
  { id: "ft", label: "Feet", toMetres: 0.3048 },
];

/** A model whose largest side lands in this range (metres) is a plausible piece of furniture or building. */
export const PLAUSIBLE_M: [number, number] = [0.2, 60];

export interface UnitCandidate {
  unit: UnitId;
  label: string;
  toMetres: number;
  /** The model's size in metres under this unit (x, y, z of the file, not yet turned up). */
  size: Vec3;
  plausible: boolean;
}

export interface UnitGuess {
  chosen: UnitCandidate;
  /** Every unit, in the order m, cm, mm, in, ft (a file's own unit that is none of them comes first). */
  candidates: UnitCandidate[];
  /** No unit stated, and two or more units give a plausible size, and those sizes differ by more than 2×:
   *  the dialog says so and asks the user to compare with a 1.8 m figure. */
  ambiguous: boolean;
}

/** The size a guess aims for (m): a piece of furniture. */
export const TYPICAL_M = 1.5;
/** Ties in the guess go in this order (as in I.1b). */
const TIE_ORDER: UnitId[] = ["m", "mm", "cm", "in", "ft"];
const METRIC: UnitId[] = ["m", "cm", "mm"];
/** Plausible sizes further apart than this make the guess ambiguous. */
export const AMBIGUOUS_RATIO = 2;

/**
 * The unit a model was drawn in (rule from step I.1b-fix):
 *   (a) a unit the file declares wins (`detected`, metres per unit: COLLADA's <unit meter>,
 *       glTF's metres);
 *   (b) otherwise the candidates are the units of m, cm, mm, in, ft under which the largest
 *       side is 0.2–60 m;
 *   (c) the unit the user chose on their LAST import (`lastUnit`, remembered by the browser,
 *       never in the plan) wins when it is among them;
 *   (d) otherwise the metric candidate (m, cm, mm) nearest 1.5 m on a log scale
 *       (smallest |ln(size / 1.5 m)|);
 *   (e) only when no metric unit fits, the imperial one nearest 1.5 m; metres when none fits.
 * `ambiguous`: no declared unit, two or more candidates, and their sizes differ by more than
 * 2× (a 120-unit table: 1.2 m in cm or 3.05 m in inches). Every candidate comes back with
 * its resulting size, so the dialog can show them all.
 */
export function guessUnit(size: Vec3, detected: number | null, lastUnit: UnitId | null = null): UnitGuess {
  const at = (unit: UnitId, label: string, toMetres: number): UnitCandidate => {
    const s = { x: size.x * toMetres, y: size.y * toMetres, z: size.z * toMetres };
    const longest = Math.max(s.x, s.y, s.z);
    return { unit, label, toMetres, size: s, plausible: longest >= PLAUSIBLE_M[0] && longest <= PLAUSIBLE_M[1] };
  };
  const candidates = UNITS.map((u) => at(u.id, u.label, u.toMetres));
  if (detected !== null && detected > 0) {
    const same = candidates.find((c) => Math.abs(c.toMetres - detected) <= detected * 1e-6);
    if (same) return { chosen: same, candidates, ambiguous: false };
    const own = at("file", `The file's unit (${Number(detected.toPrecision(4))} m)`, detected);
    return { chosen: own, candidates: [own, ...candidates], ambiguous: false };
  }
  const longest = (c: UnitCandidate) => Math.max(c.size.x, c.size.y, c.size.z);
  const off = (c: UnitCandidate) => Math.abs(Math.log(longest(c) / TYPICAL_M));
  const nearest = (list: UnitCandidate[]) => [...list].sort((p, q) => (Math.abs(off(p) - off(q)) > 1e-12 ? off(p) - off(q) : TIE_ORDER.indexOf(p.unit) - TIE_ORDER.indexOf(q.unit)))[0];
  const fits = candidates.filter((c) => c.plausible);
  if (fits.length === 0) return { chosen: candidates[0], candidates, ambiguous: false };
  const metric = fits.filter((c) => METRIC.includes(c.unit));
  const chosen = fits.find((c) => c.unit === lastUnit) ?? (metric.length > 0 ? nearest(metric) : nearest(fits));
  const sizes = fits.map(longest);
  return { chosen, candidates, ambiguous: fits.length >= 2 && Math.max(...sizes) > AMBIGUOUS_RATIO * Math.min(...sizes) };
}

/** "3.2 × 2.1 × 0.8 m": width × depth × height, in the plan's Y-up frame. */
export function formatSize(width: number, depth: number, height: number): string {
  const n = (v: number) => String(Number(v.toPrecision(3)));
  return `${n(width)} × ${n(depth)} × ${n(height)} m`;
}

// ---------------------------------------------------------------- placement

export interface Box {
  min: Vec3;
  max: Vec3;
}

/** A source-unit box turned Y-up (Z-up: (x, y, z) → (x, z, -y)) and scaled to metres. */
export function frameBox(box: Box, unitToMetres: number, up: "y" | "z"): Box {
  const { min, max } = box;
  const turned = up === "z" ? { min: { x: min.x, y: min.z, z: -max.y }, max: { x: max.x, y: max.z, z: -min.y } } : box;
  const k = unitToMetres;
  return { min: { x: turned.min.x * k, y: turned.min.y * k, z: turned.min.z * k }, max: { x: turned.max.x * k, y: turned.max.y * k, z: turned.max.z * k } };
}

/**
 * The model's base point and size in metres under `unitToMetres` and `up`. The
 * base point is the bottom centre of the WHOLE model's bounding box (overrides
 * ignored, so deleting a part never moves the rest); Item.position says where it
 * goes, and rotationY and scale turn and grow the model about it.
 */
export function modelFrame(sourceBox: Box, unitToMetres: number, up: "y" | "z"): { base: Vec3; width: number; depth: number; height: number } {
  const b = frameBox(sourceBox, unitToMetres, up);
  return {
    base: { x: (b.min.x + b.max.x) / 2, y: b.min.y, z: (b.min.z + b.max.z) / 2 },
    width: b.max.x - b.min.x,
    depth: b.max.z - b.min.z,
    height: b.max.y - b.min.y,
  };
}

/**
 * The box (source units) of every mesh not hidden or deleted; null when nothing
 * shows. Like LoadedModel.box it includes the root's own transform: `root` is a
 * cached original with no parent.
 */
export function visibleBox(root: THREE.Object3D, overrides: Record<string, NodeOverride>): Box | null {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const walk = (o: THREE.Object3D, path: string) => {
    if (path !== "" && (overrides[path]?.hidden || overrides[path]?.deleted)) return; // and its whole subtree
    if (isMesh(o) && o.geometry?.attributes?.position) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box.union(o.geometry.boundingBox!.clone().applyMatrix4(o.matrixWorld));
    }
    o.children.forEach((c, i) => walk(c, path === "" ? String(i) : `${path}/${i}`));
  };
  walk(root, "");
  return box.isEmpty() ? null : { min: { x: box.min.x, y: box.min.y, z: box.min.z }, max: { x: box.max.x, y: box.max.y, z: box.max.z } };
}

/**
 * The floor outline of a placed item, as four plan points: the box `local`
 * (metres, relative to the base point, Y-up) turned by rotationY, scaled, and
 * moved to the item's position. three.js rotateY(θ) maps (x, z) to
 * (x cos θ + z sin θ, -x sin θ + z cos θ).
 */
export function footprint(item: Pick<Item, "position" | "rotationY" | "scale">, local: Box): Vec2[] {
  const c = Math.cos(item.rotationY);
  const s = Math.sin(item.rotationY);
  const k = item.scale;
  const corners: [number, number][] = [
    [local.min.x, local.min.z],
    [local.max.x, local.min.z],
    [local.max.x, local.max.z],
    [local.min.x, local.max.z],
  ];
  return corners.map(([x, z]) => ({ x: item.position.x + k * (x * c + z * s), y: item.position.z + k * (-x * s + z * c) }));
}

/** The item-local box (metres, base point at the origin) of what an imported item shows; null when nothing does. */
export function itemLocalBox(root: THREE.Object3D, sourceBox: Box, info: { unitToMetres: number; upAxis: "y" | "z"; nodeOverrides: Record<string, NodeOverride> }): Box | null {
  const shown = visibleBox(root, info.nodeOverrides);
  if (!shown) return null;
  const { base } = modelFrame(sourceBox, info.unitToMetres, info.upAxis);
  const b = frameBox(shown, info.unitToMetres, info.upAxis);
  return { min: { x: b.min.x - base.x, y: b.min.y - base.y, z: b.min.z - base.z }, max: { x: b.max.x - base.x, y: b.max.y - base.y, z: b.max.z - base.z } };
}
