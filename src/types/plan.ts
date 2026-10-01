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

/** A furniture/fixture instance placed from the catalogue. */
export interface Item {
  id: string;
  catalogId: string;
  position: Vec3;
  /** Radians around the vertical axis. */
  rotationY: number;
  /** Uniform multiplier on the catalogue size. */
  scale: number;
  /** Material slot name → hex colour, overriding the catalogue default. */
  colorOverrides: Record<string, string>;
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
