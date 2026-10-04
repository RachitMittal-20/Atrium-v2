/**
 * planStorage.ts — the small, explicit persistence layer for the editable Plan
 * (pure TypeScript, no React, no store). Three jobs:
 *   1. the stored format: `{ schema, savedAt, plan }` under one localStorage key,
 *      so a later release can read an old save and migrate it (see `migrate`);
 *   2. reading it back strictly: anything corrupt, from a newer schema or the
 *      wrong shape is ignored (returns null) instead of reaching the editor;
 *   3. a debounced autosaver, so a drag that changes the plan on every pointer
 *      move writes once, after it settles.
 * Only the Plan is stored. Selection, hover, the tool, 2D pan/zoom and the
 * Measure overlay live in other stores and never come through here, and undo
 * history is not stored either. An imported model's Item keeps only its asset id and
 * settings (`Item.import`); the file bytes live in IndexedDB (src/lib/import/assetStore.ts)
 * and never come through here. Connects to: src/types/plan.ts; wired to the plan
 * store by src/store/persistence.ts; tested by scripts/test-persist.ts.
 */
import type { ImportFormat, ImportInfo, Item, NodeOverride, Opening, OpeningKind, PartTransform, Plan, Room, Vec2, Wall } from "@/types/plan";

export const STORAGE_KEY = "atrium-v2:plan";
/** Bump when the stored shape changes, and add a case to `migrate`. */
export const SCHEMA_VERSION = 1;
/** Quiet time after the last plan change before it is written. */
export const AUTOSAVE_DELAY_MS = 800;
/** A plan that keeps changing is still written at least this often. */
export const AUTOSAVE_MAX_WAIT_MS = 5000;

/** The slice of the Storage API used here, so tests can pass a plain object. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The browser's localStorage, or null when it is missing or blocked (some private modes throw on access). */
export function browserStorage(): KeyValueStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- format

export interface StoredEnvelope {
  schema: number;
  savedAt: string; // ISO 8601, informational
  plan: Plan;
}

export function serializePlan(plan: Plan, now: Date = new Date()): string {
  const envelope: StoredEnvelope = { schema: SCHEMA_VERSION, savedAt: now.toISOString(), plan };
  return JSON.stringify(envelope);
}

/**
 * The Plan in a stored string, or null when there is none or it cannot be
 * trusted. Never throws.
 */
export function parseStoredPlan(raw: string | null | undefined): Plan | null {
  if (!raw) return null;
  try {
    return migrate(JSON.parse(raw));
  } catch {
    return null; // not JSON
  }
}

/** Upgrade a parsed envelope to the current Plan. Unknown (older or newer) schemas are refused, not guessed at. */
function migrate(envelope: unknown): Plan | null {
  if (!isObject(envelope)) return null;
  switch (envelope.schema) {
    case 1:
      return coercePlan(envelope.plan);
    // Future: case 1 would map its plan to the v2 shape here and fall through to v2.
    default:
      return null;
  }
}

/** Read and parse the saved plan; a throwing or empty store is just "nothing saved". */
export function loadSavedPlan(storage: KeyValueStore): Plan | null {
  try {
    return parseStoredPlan(storage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- strict shape check

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const list = (v: unknown): unknown[] | null => (Array.isArray(v) ? v : null);

function vec2(v: unknown): Vec2 | null {
  return isObject(v) && isNum(v.x) && isNum(v.y) ? { x: v.x, y: v.y } : null;
}

function wall(v: unknown): Wall | null {
  if (!isObject(v) || !isStr(v.id) || !isNum(v.thickness) || !isNum(v.height) || v.thickness <= 0 || v.height <= 0) return null;
  const [a, b] = [vec2(v.a), vec2(v.b)];
  return a && b ? { id: v.id, a, b, thickness: v.thickness, height: v.height } : null;
}

function opening(v: unknown): Opening | null {
  if (!isObject(v) || !isStr(v.id) || !isStr(v.wallId) || (v.kind !== "door" && v.kind !== "window")) return null;
  if (!isNum(v.offset) || !isNum(v.width) || !isNum(v.height) || !isNum(v.sillHeight) || v.width <= 0) return null;
  // A door's swing side (step 4.5) is user data: dropping it would flip every flipped door back on reload.
  // Absent is fine (older plans; loadPlan gives doors a default), present must be one of the two sides.
  if (v.swing !== undefined && v.swing !== "left" && v.swing !== "right") return null;
  const kind: OpeningKind = v.kind; // narrowed by the guard above
  const base = { id: v.id, wallId: v.wallId, kind, offset: v.offset, width: v.width, height: v.height, sillHeight: v.sillHeight };
  return v.swing === undefined ? base : { ...base, swing: v.swing };
}

function room(v: unknown): Room | null {
  if (!isObject(v) || !isStr(v.id) || !isStr(v.name) || !isStr(v.floorMaterial)) return null;
  const ids = list(v.wallIds);
  return ids && ids.every(isStr) ? { id: v.id, name: v.name, wallIds: [...ids], floorMaterial: v.floorMaterial } : null;
}

function item(v: unknown): Item | null {
  if (!isObject(v) || !isStr(v.id) || !isStr(v.catalogId) || !isNum(v.rotationY) || !isNum(v.scale) || !isObject(v.position) || !isObject(v.colorOverrides)) return null;
  const { x, y, z } = v.position;
  if (!isNum(x) || !isNum(y) || !isNum(z)) return null;
  const overrides = Object.entries(v.colorOverrides);
  if (!overrides.every(([, c]) => isStr(c))) return null;
  const base: Item = { id: v.id, catalogId: v.catalogId, position: { x, y, z }, rotationY: v.rotationY, scale: v.scale, colorOverrides: Object.fromEntries(overrides) as Record<string, string> };
  // An imported model (step I.1) is user data like a door's swing: dropping it would lose the model on reload.
  // Absent is fine (every plan before I.1); present must be well formed.
  if (v.import === undefined) return base;
  const info = importInfo(v.import);
  return info ? { ...base, import: info } : null;
}

const FORMATS: readonly ImportFormat[] = ["glb", "gltf", "obj", "fbx", "dae", "stl", "3ds"];
const NODE_PATH = /^(\d+(\/\d+)*)?$/; // "" is the model root, "0/3/1" a descendant

/** A part's move, turn and scale: three finite numbers, a finite angle and a positive scale, or null. */
function partTransform(v: unknown): PartTransform | null {
  if (!isObject(v) || !isNum(v.rotY) || !isNum(v.s) || v.s <= 0) return null;
  const t = list(v.t);
  if (!t || t.length !== 3 || !t.every(isNum)) return null;
  return { t: [t[0] as number, t[1] as number, t[2] as number], rotY: v.rotY, s: v.s };
}

function importInfo(v: unknown): ImportInfo | null {
  if (!isObject(v) || !isStr(v.assetId) || !/^[0-9a-f]{16}$/.test(v.assetId) || !isStr(v.name) || !FORMATS.includes(v.format as ImportFormat)) return null;
  if (!isNum(v.unitToMetres) || v.unitToMetres <= 0 || (v.upAxis !== "y" && v.upAxis !== "z") || typeof v.doubleSided !== "boolean" || !isObject(v.nodeOverrides)) return null;
  const nodeOverrides: Record<string, NodeOverride> = {};
  for (const [path, o] of Object.entries(v.nodeOverrides)) {
    if (!NODE_PATH.test(path) || !isObject(o)) return null;
    if ((o.hidden !== undefined && typeof o.hidden !== "boolean") || (o.deleted !== undefined && typeof o.deleted !== "boolean")) return null;
    const transform = o.transform === undefined ? undefined : partTransform(o.transform); // a moved part (step I.1b)
    if (transform === null) return null;
    nodeOverrides[path] = { ...(o.hidden !== undefined && { hidden: o.hidden }), ...(o.deleted !== undefined && { deleted: o.deleted }), ...(transform && { transform }) };
  }
  return { assetId: v.assetId, name: v.name, format: v.format as ImportFormat, unitToMetres: v.unitToMetres, upAxis: v.upAxis, doubleSided: v.doubleSided, nodeOverrides };
}

/** Map every element through `one`; null when the input is not an array or any element is bad. */
function all<T>(v: unknown, one: (e: unknown) => T | null): T[] | null {
  const xs = list(v);
  if (!xs) return null;
  const out: T[] = [];
  for (const e of xs) {
    const r = one(e);
    if (!r) return null;
    out.push(r);
  }
  return out;
}

const unique = (ids: string[]) => new Set(ids).size === ids.length;

/**
 * A fresh, fully checked Plan built field by field, or null. Rebuilding (rather
 * than casting) means stray keys in the stored JSON never reach the store.
 * Stored rooms are kept exactly as written: they carry the user's names, and
 * the plan store re-derives them against the walls by matching loops and label
 * points, which keeps those names.
 */
function coercePlan(v: unknown): Plan | null {
  if (!isObject(v) || !isStr(v.id) || !isStr(v.name) || v.units !== "m" || !isObject(v.meta)) return null;
  const { createdAt, updatedAt, source } = v.meta;
  if (!isStr(createdAt) || !isStr(updatedAt) || (source !== "blueprint" && source !== "manual" && source !== "sample")) return null;

  const walls = all(v.walls, wall);
  const openings = all(v.openings, opening);
  const rooms = all(v.rooms, room);
  const items = all(v.items, item);
  if (!walls || !openings || !rooms || !items) return null;

  // References must resolve, or the editor would meet a dangling id later.
  const wallIds = new Set(walls.map((w) => w.id));
  if (!unique(walls.map((w) => w.id)) || !unique(openings.map((o) => o.id)) || !unique(rooms.map((r) => r.id)) || !unique(items.map((i) => i.id))) return null;
  if (openings.some((o) => !wallIds.has(o.wallId)) || rooms.some((r) => r.wallIds.some((id) => !wallIds.has(id)))) return null;

  return { id: v.id, name: v.name, units: "m", walls, openings, rooms, items, meta: { createdAt, updatedAt, source } };
}

// ---------------------------------------------------------------- autosave

/** Timer functions, injectable so tests can drive the debounce without waiting. */
export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
  now(): number;
}

export const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

/** idle: nothing saved yet this session; pending: a change is waiting to be written. */
export type SaveStatus = "idle" | "pending" | "saved" | "error";

export interface Autosaver {
  /** Note that `plan` is the newest plan. (Re)starts the quiet-time wait; never writes inline. */
  schedule(plan: Plan): void;
  /** Write the pending plan now, if there is one (used when the tab is hidden or closed). */
  flush(): void;
  /** Drop a pending write. */
  cancel(): void;
}

/**
 * Debounced writer. `schedule` runs on every plan change, so it only remembers
 * the newest plan and restarts a timer; the plan is serialised and stored when
 * the timer fires — `delayMs` after the last change, or `maxWaitMs` after the
 * first unsaved one if changes never pause. A full or blocked store reports
 * "error" and the editor carries on.
 */
export function createAutosaver(opts: {
  storage: KeyValueStore;
  timers?: Timers;
  delayMs?: number;
  maxWaitMs?: number;
  onStatus?: (status: SaveStatus) => void;
}): Autosaver {
  const { storage, timers = realTimers, delayMs = AUTOSAVE_DELAY_MS, maxWaitMs = AUTOSAVE_MAX_WAIT_MS, onStatus = () => {} } = opts;
  let latest: Plan | null = null;
  let firstAt = 0; // when the oldest unsaved change arrived
  let handle: unknown = null;

  const write = () => {
    handle = null;
    const plan = latest;
    latest = null;
    if (!plan) return;
    try {
      storage.setItem(STORAGE_KEY, serializePlan(plan));
      onStatus("saved");
    } catch {
      onStatus("error"); // quota exceeded or storage blocked
    }
  };

  return {
    schedule(plan) {
      const now = timers.now();
      if (!latest) firstAt = now;
      latest = plan;
      if (handle !== null) timers.clear(handle);
      handle = timers.set(write, Math.max(0, Math.min(delayMs, firstAt + maxWaitMs - now)));
      onStatus("pending");
    },
    flush() {
      if (handle !== null) timers.clear(handle);
      write();
    },
    cancel() {
      if (handle !== null) timers.clear(handle);
      handle = null;
      latest = null;
    },
  };
}
