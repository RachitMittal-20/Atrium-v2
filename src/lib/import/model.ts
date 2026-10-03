/**
 * model.ts — pure helpers on an imported model's three.js scene (step I.1). No DOM,
 * no React, no loaders: everything here runs the same in the browser and in Node, so
 * scripts/test-import.ts can check it.
 *
 *   nodePaths       every node below the root with its child-index path ("0/3/1").
 *                   Paths are how Item.import.nodeOverrides names a node, so they must
 *                   come out the same on every parse of the same file.
 *   nodeAt          the node at a path, or null.
 *   applyOverrides  hide (invisible) or delete (removed) nodes of a CLONE. Never call it
 *                   on the cached original: assetCache shares that between items.
 *   countTriangles  triangles in every mesh (indexed or not).
 *   applyUpAxis     turns a Z-up model to the plan's Y-up.
 *   placeOnFloor    moves an object so its lowest point is at y = 0.
 *   guessUnit       which unit the file was drawn in, from its size.
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
import type { Item, NodeOverride, Vec2, Vec3 } from "@/types/plan";

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
 * Apply hidden / deleted overrides to `clone` in place: a hidden node is made
 * invisible, a deleted one is removed from its parent. Paths are resolved before
 * anything is removed, so removing one node never shifts another's path. Unknown
 * paths (a file that changed) are ignored.
 */
export function applyOverrides(clone: THREE.Object3D, overrides: Record<string, NodeOverride>): void {
  const found = Object.entries(overrides).map(([path, o]) => ({ node: nodeAt(clone, path), o }));
  for (const { node, o } of found) {
    if (!node) continue;
    if (o.hidden) node.visible = false;
    if (o.deleted && node !== clone) node.removeFromParent();
  }
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
}

/**
 * The unit a model was drawn in. A unit the file states (`detected`, metres per
 * unit: COLLADA's <unit meter>, glTF's metres) wins. Otherwise the first of m,
 * cm, mm, in, ft under which the largest side is between 0.2 m and 60 m; metres
 * when none is. Every candidate comes back with its resulting size, so the
 * dialog can show them all.
 */
export function guessUnit(size: Vec3, detected: number | null): UnitGuess {
  const at = (unit: UnitId, label: string, toMetres: number): UnitCandidate => {
    const s = { x: size.x * toMetres, y: size.y * toMetres, z: size.z * toMetres };
    const longest = Math.max(s.x, s.y, s.z);
    return { unit, label, toMetres, size: s, plausible: longest >= PLAUSIBLE_M[0] && longest <= PLAUSIBLE_M[1] };
  };
  const candidates = UNITS.map((u) => at(u.id, u.label, u.toMetres));
  if (detected !== null && detected > 0) {
    const same = candidates.find((c) => Math.abs(c.toMetres - detected) <= detected * 1e-6);
    if (same) return { chosen: same, candidates };
    const own = at("file", `The file's unit (${Number(detected.toPrecision(4))} m)`, detected);
    return { chosen: own, candidates: [own, ...candidates] };
  }
  return { chosen: candidates.find((c) => c.plausible) ?? candidates[0], candidates };
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
