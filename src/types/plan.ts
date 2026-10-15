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
  /** Where an imported wall came from (step M.1b): "vector" = read exactly from a
   *  PDF's own lines, "traced" = traced from a picture, about a pixel out. Absent for
   *  walls drawn by hand, the sample, and image imports. Editing keeps it. */
  provenance?: "vector" | "traced";
  /** Set by the plan store the first time a wall with a provenance changes shape, so
   *  the panel can say "Edited" instead of claiming the PDF's numbers. */
  edited?: true;
}

export type OpeningKind = "door" | "window";

/** Which side of its wall a door's leaf opens to, looking from the wall's a end
 *  to its b end. Which JAMB it pivots on is `Opening.hinge`, a separate thing. */
export type SwingSide = "left" | "right";

/** Which jamb a door's leaf pivots on: the gap end nearer the wall's a end, or the one
 *  nearer b (step M.1d). Absent means "a", which is what every door did before. */
export type HingeEnd = "a" | "b";

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
  /** Doors only (step M.1d): the jamb the leaf pivots on. Absent means "a", the only
   *  thing the plan could hold before, so old plans draw exactly as they did. With
   *  `swing` it makes four storable door states. Rooms, collision and validatePlan
   *  ignore it; a flip of the swing never changes it. */
  hinge?: HingeEnd;
  /** Where an imported opening came from (step M.1c), as for walls: "vector" = read
   *  exactly from a PDF's own lines, "traced" = traced from a picture, about a pixel
   *  out. Absent for openings placed by hand, the sample's and image imports. Editing keeps it. */
  provenance?: "vector" | "traced";
  /** Set by the plan store the first time an opening with a provenance changes. */
  edited?: true;
  /** Its height and sill are the importer's defaults, because a PDF has no heights (step
   *  M.1c). The plan store clears it once either is changed. */
  defaultHeight?: true;
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

/**
 * A part of an imported model moved, turned or scaled (step I.1b), in the MODEL frame:
 * metres, Y up, after the file's unit and up axis and before the item's own position,
 * rotationY and scale (so turning or scaling the item carries its parts). About the
 * part's pivot: the centre of its ORIGINAL bounding box, at its lowest point.
 */
export interface PartTransform {
  /** Where the pivot moves to, from where it was (m). */
  t: [number, number, number];
  /** Radians about the vertical through the pivot. */
  rotY: number;
  /** Uniform scale about the pivot. */
  s: number;
}

/** Per-node changes to an imported model, keyed by the node's child-index path from the model root ("0/3/1"). */
export interface NodeOverride {
  hidden?: boolean;
  deleted?: boolean;
  transform?: PartTransform;
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
  /** Quantity takeoffs (step M.2a): annotations measured on the plan, never geometry. Absent on older plans. */
  takeoffs?: Takeoff[];
  /** Scale changes applied in the studio (step M.2b), oldest first. No timestamps, so a save
   *  of the same plan is always the same bytes. Absent until the first one. */
  calibrations?: Calibration[];
  /** The imported drawing shown under the 2D plan (step M.2c): a VIEW of the original file,
   *  never geometry. Absent on plans without one, and on every plan before M.2c. */
  background?: Background;
  meta: PlanMeta;
}

/**
 * An affine map, in SVG matrix order: x' = a·x + c·y + e, y' = b·x + d·y + f.
 */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/**
 * The drawing a plan was imported from (step M.2c). The bytes live in the browser's asset store
 * (src/lib/import/assetStore.ts) under `assetId`, never in the plan or its autosave. `mapping`
 * takes the drawing's own units — PDF points (page viewport at scale 1, /Rotate applied, y down)
 * or image pixels (y down) — to plan metres, exactly as the importer built the plan; a
 * recalibration scales it with the plan, so the drawing stays under the walls it describes.
 */
export interface Background {
  assetId: string;
  kind: "pdf" | "image";
  /** The PDF page (1-based); absent for an image. */
  page?: number;
  mapping: Affine;
}

/** One applied recalibration (step M.2b): every plan-space length was multiplied by `factor`. */
export interface Calibration {
  factor: number;
  note?: string;
}

/** A value someone typed against a takeoff: metres for a length, m² for an area. */
export interface TakeoffValue {
  value: number;
  note?: string;
}

/**
 * A measured length (a polyline) or area (a polygon, minus cutouts) in plan metres (step M.2a).
 * The points are absolute: they do not follow the walls. `wallsHash` is the walls' hash
 * (src/lib/takeoff/rows.ts) when it was measured, so the table can say the walls have moved
 * since. An override never replaces the measured value; both are kept.
 */
export interface Takeoff {
  id: string;
  name: string;
  kind: "length" | "area";
  points: [number, number][];
  cutouts?: [number, number][][];
  reference?: TakeoffValue;
  override?: TakeoffValue;
  wallsHash: string;
  /** "pdf": carried in at Build model from a dimension the PDF review matched to a line
   *  (step M.2b). Absent for a takeoff measured by hand in the studio. */
  source?: "pdf";
  /** A carried PDF dimension whose ends land on a wall the image pipeline traced, so the
   *  comparison is only about a raster pixel good (step M.2b). Absent otherwise. */
  approximate?: true;
  /** Step P.1: for each of `points`, the drawing point it snapped to on the plan's vector PDF
   *  (src/lib/pdf/snapIndex.ts), or null where it did not. Stored only when at least one point
   *  did; cutout points are not tracked. Absent on every takeoff before P.1. */
  drawingSnaps?: (DrawingSnapKind | null)[];
}

/** What a takeoff point snapped to on the original drawing (step P.1). */
export type DrawingSnapKind = "corner" | "end" | "mid" | "edge";

/** A named design alternative: a full snapshot so options can be compared and
 *  switched without diffing. */
export interface DesignOption {
  id: string;
  name: string;
  plan: Plan;
}
