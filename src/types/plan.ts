/**
 * plan.ts — the editable building model. `Plan` is the single source of truth:
 * the 3D scene, 2D plan, room areas, schedules and every export are derived
 * views of it (see CLAUDE.md). Connects to: src/data/samplePlan.ts (example
 * data); later the plan store, the blueprint importer and the exporters.
 *
 * All lengths are metres. Plan space is 2D on the ground: x → east, y → south
 * (matches the 2D drawing); Vec3 world space is x → east, y → up, z → south,
 * so a plan point (x, y) sits at world (x, 0, y).
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A straight wall segment. Walls meeting at a T-junction share an endpoint, so
 *  the wall being joined is split there — that keeps room loops closed. */
export interface Wall {
  id: string;
  a: Vec2;
  b: Vec2;
  thickness: number;
  height: number;
}

export type OpeningKind = "door" | "window";

/** Which side of its wall a door's leaf opens to, looking from the wall's a end
 *  to its b end. The hinge is always the gap end nearer a. */
export type SwingSide = "left" | "right";

/** A hole cut in a wall. Position is stored relative to the wall, so moving or
 *  resizing the wall carries its openings along. */
export interface Opening {
  id: string;
  wallId: string;
  kind: OpeningKind;
  /** Distance from wall.a along the wall to the opening's centre. */
  offset: number;
  width: number;
  height: number;
  /** Floor to the bottom of the opening; 0 for doors. */
  sillHeight: number;
  /** Doors only, and required for them (validatePlan says so): the side the leaf
   *  opens to. Plans from before step 4.5 get "left" on load (edit.withSwingSides),
   *  which is what the 2D plan always drew. Windows have none. */
  swing?: SwingSide;
}

/** Rooms are derived from the wall graph; only the user-authored bits are
 *  stored (name, material) plus the wall loop that identifies the room. */
export interface Room {
  id: string;
  name: string;
  /** Ordered loop of wall ids that encloses the room. */
  wallIds: string[];
  /** Material id from the material catalogue, e.g. "oak-floor". */
  floorMaterial: string;
}

/** Model formats that can be imported in the browser (step I.1). */
export type ImportFormat = "glb" | "gltf" | "obj" | "fbx" | "dae" | "stl" | "3ds";

/** Per-node changes to an imported model, keyed by the node's child-index path from the model root ("0/3/1"). */
export interface NodeOverride {
  hidden?: boolean;
  deleted?: boolean;
}

/**
 * What makes an Item an imported 3D model (step I.1). The file's bytes are NOT
 * here: they live in the browser's asset store (src/lib/import/assetStore.ts)
 * under `assetId`, and the Plan only points at them, so autosave stays small.
 */
export interface ImportInfo {
  /** First 16 hex characters of the SHA-256 of the file bytes; identical re-imports share it. */
  assetId: string;
  name: string;
  format: ImportFormat;
  /** Metres per source unit: 1 for metres, 0.01 for centimetres, 0.0254 for inches… */
  unitToMetres: number;
  /** The file's up axis; "z" is turned to the plan's y-up when drawn. */
  upAxis: "y" | "z";
  doubleSided: boolean;
  nodeOverrides: Record<string, NodeOverride>;
}

/**
 * A furniture/fixture instance placed from the catalogue, or an imported model
 * (`import` set, catalogId "import:" + assetId). Imported models are meshes only:
 * walls, rooms, collision, the validator and schedules ignore them.
 */
export interface Item {
  id: string;
  catalogId: string;
  /** World space (x east, y up, z south): plan x, height, plan y. For an imported
   *  model, where its base point (the bottom centre of its bounding box) goes. */
  position: Vec3;
  /** Radians around the vertical axis. */
  rotationY: number;
  /** Uniform multiplier on the catalogue size. */
  scale: number;
  /** Material slot name → hex colour, overriding the catalogue default. */
  colorOverrides: Record<string, string>;
  import?: ImportInfo;
}

export interface PlanMeta {
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  /** Where the plan came from. */
  source: "blueprint" | "manual" | "sample";
}

export interface Plan {
  id: string;
  name: string;
  units: "m";
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  items: Item[];
  meta: PlanMeta;
}

/** A named design alternative: a full snapshot so options can be compared and
 *  switched without diffing. */
export interface DesignOption {
  id: string;
  name: string;
  plan: Plan;
}
