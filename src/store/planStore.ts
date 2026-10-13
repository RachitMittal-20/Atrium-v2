/**
 * planStore.ts — the one editable `Plan` plus undo/redo. Every edit runs
 * through `edit()`, which uses Immer patches so history stores small diffs, not
 * whole plans. `transaction()` folds many edits (e.g. a drag) into one undo
 * step. Every wall edit re-derives `plan.rooms` in the same recipe, so undo
 * restores room names and loops together with the walls. `drawWall` adds a
 * drawn wall in one step, splitting any wall it joins in the middle (the
 * T-junction convention) inside the same transaction. `placeOpening` and
 * `flipDoor` add a door or window and flip a door's swing side, one undo step
 * each; plans made before swing sides were stored are migrated on load
 * (edit.withSwingSides). `addImportedItem` and `setNodeOverride` add an imported
 * 3D model and hide, delete or restore its parts (step I.1), and `setNodeTransform`
 * moves, turns or scales one part (step I.1b), one undo step each; imported models
 * never touch walls or rooms. A wall imported from a PDF keeps its provenance
 * through edits; `edit()` marks it `edited` once its shape changes (step M.1b),
 * and does the same for a door or window imported from a PDF (step M.1c: its wall,
 * kind, place, size, swing or hinge jamb), clearing `defaultHeight` once its height or sill changes.
 * `addTakeoff`, `updateTakeoff`, `deleteTakeoff` and `markTakeoffCurrent` keep the
 * quantity takeoffs (step M.2a), one undo step each; takeoffs are annotations and
 * never touch walls, rooms or openings. `calibratePlan` rescales the whole plan about its
 * origin (step M.2b, src/lib/plan/calibrate.ts) in one undo step, or refuses with a reason
 * and changes nothing; it is the one edit that keeps the provenance marks as they are.
 * Connects to:
 * src/types/plan.ts, src/lib/plan/{validate,geometry,rooms,edit}.ts,
 * src/lib/keyboard.ts; the 3D scene, 2D plan and exports read `plan` from here.
 */
import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from "immer";
import { useMemo } from "react";
import { create } from "zustand";
import { samplePlan } from "@/data/samplePlan";
import { isTypingTarget } from "@/lib/keyboard";
import { calibrationProblem, scalePlan } from "@/lib/plan/calibrate";
import { drawProblem, flipSide, hostAt, placeOpening as planOpening, splitWallAt, withSwingSides } from "@/lib/plan/edit";
import { clampOpening, JOINT_EPS, wallLength } from "@/lib/plan/geometry";
import { deriveRooms, toStoredRoom, type DerivedRoom } from "@/lib/plan/rooms";
import { validatePlan } from "@/lib/plan/validate";
import { isIdentityTransform } from "@/lib/import/transform";
import { wallsHash } from "@/lib/takeoff/rows";
import type { ImportInfo, Item, NodeOverride, Opening, OpeningKind, PartTransform, Plan, Takeoff, TakeoffValue, Vec2, Vec3, Wall } from "@/types/plan";

enablePatches();

const HISTORY_LIMIT = 100;
export const PLAN_NAME_MAX = 80;

/** One undo step: `patches` redo it, `inverse` undoes it. */
interface HistoryEntry {
  patches: Patch[];
  inverse: Patch[];
}

interface PlanState {
  plan: Plan;
  past: HistoryEntry[];
  future: HistoryEntry[];

  loadPlan: (plan: Plan) => void;
  addWall: (wall: Omit<Wall, "id">) => string;
  updateWall: (id: string, changes: Partial<Omit<Wall, "id">>) => void;
  deleteWall: (id: string) => void;
  moveWallEndpoint: (wallId: string, end: "a" | "b", to: Vec2) => void;
  /** Split a wall in two at `at` (see edit.splitWallAt); returns the second piece's id, or null when refused. */
  splitWall: (wallId: string, at: Vec2) => string | null;
  /**
   * Add a drawn wall from `a` to `b` as ONE undo step: an end landing in the
   * middle of a wall splits that wall there first, so the new wall meets it in a
   * T-junction. Refused (null, nothing recorded) when edit.drawProblem objects.
   */
  drawWall: (a: Vec2, b: Vec2, size: Pick<Wall, "thickness" | "height">) => string | null;
  addOpening: (opening: Omit<Opening, "id">) => string;
  /**
   * A default-size door or window centred `centre` m along `wallId`, checked by
   * edit.placeOpening (inside the wall's usable span, no overlap). One undo step;
   * null, with nothing recorded, when it is refused.
   */
  placeOpening: (kind: OpeningKind, wallId: string, centre: number) => string | null;
  /** Reverse a door's swing side and nothing else — not its hinge jamb (step M.1d).
   *  One undo step; a window is left alone. */
  flipDoor: (id: string) => void;
  updateOpening: (id: string, changes: Partial<Omit<Opening, "id">>) => void;
  deleteOpening: (id: string) => void;
  addItem: (item: Omit<Item, "id">) => string;
  /** An imported 3D model (step I.1) with its base point at `position` (world: plan x, height, plan y). One undo step. */
  addImportedItem: (info: ImportInfo, position: Vec3) => string;
  updateItem: (id: string, changes: Partial<Omit<Item, "id">>) => void;
  /** Hide, show, delete or restore one node of an imported model by its index path. `null` clears the flags. A part's
   *  transform is kept whatever the flags say (only setNodeTransform changes it), so Restore brings a part back where it was. One undo step. */
  setNodeOverride: (itemId: string, path: string, override: NodeOverride | null) => void;
  /** Move, turn or scale one part of an imported model (step I.1b, model frame, see PartTransform). `null` or the identity
   *  puts it back (Reset part). One undo step. */
  setNodeTransform: (itemId: string, path: string, transform: PartTransform | null) => void;
  deleteItem: (id: string) => void;
  renameRoom: (id: string, name: string) => void;
  /** Trims, caps at PLAN_NAME_MAX; an empty name is ignored. Undoable. */
  renamePlan: (name: string) => void;
  setRoomMaterial: (id: string, floorMaterial: string) => void;
  /** A takeoff (step M.2a), stamped with the walls' hash now. One undo step; returns its id. */
  addTakeoff: (takeoff: Omit<Takeoff, "id" | "wallsHash">) => string;
  /** Rename, set or clear (null) the reference or the override, or replace the cutouts. One undo step. */
  updateTakeoff: (id: string, changes: TakeoffChanges) => void;
  deleteTakeoff: (id: string) => void;
  /** Accept the walls as they are now: the stale marker goes. One undo step. */
  markTakeoffCurrent: (id: string) => void;
  /**
   * Multiply every plan-space length by `factor` about the plan's (0, 0) (step M.2b,
   * src/lib/plan/calibrate.ts): walls, openings, takeoffs and imported models' positions;
   * never heights, sills, a model's own size, or a typed reference or override. Returns the
   * reason when the result would not hold together (nothing is changed then), else null.
   * One undo step, and redo puts it back; provenance and the "Edited" marks are untouched.
   */
  calibratePlan: (factor: number, note?: string) => string | null;

  /** Run `fn`; every edit inside becomes a single undo step. Synchronous only. */
  transaction: (fn: () => void) => void;
  /**
   * Undo the newest step and drop it from history: nothing is left to redo.
   * `transaction()` is synchronous, so a drag that spans many pointer events
   * cannot hold one open. Instead the editor re-applies the whole drag from the
   * start on every move — rollback, then one transaction — so the plan is live
   * in the store (3D and openings follow) while history holds exactly one entry.
   * Escape mid-drag is then a bare rollback, and holding an arrow key folds the
   * presses into one step the same way. Used by PlanCanvas.
   */
  rollback: () => void;
  undo: () => void;
  redo: () => void;
}

export interface TakeoffChanges {
  name?: string;
  reference?: TakeoffValue | null;
  override?: TakeoffValue | null;
  cutouts?: [number, number][][];
}

const copyValue = (v: TakeoffValue): TakeoffValue => ({ value: v.value, ...(v.note?.trim() && { note: v.note.trim() }) });
const copyPoints = (ps: [number, number][]): [number, number][] => ps.map(([x, y]) => [x, y]);

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

// Open transaction, if any. Module-level (not state): nothing renders from it.
let tx: { depth: number; entry: HistoryEntry } | null = null;

export const usePlanStore = create<PlanState>((set, get) => {
  /** Apply `recipe` to the plan and record it in history (or in the open transaction). */
  function edit(recipe: (draft: Draft<Plan>) => void, opts: { keepMarks?: boolean } = {}) {
    const before = get().plan;
    const [plan, patches, inverse] = produceWithPatches(before, (d) => {
      recipe(d);
      // keepMarks: a recalibration moves every wall at once, which is not an edit of one
      // wall's shape against the drawing it was read from, so nothing is marked "Edited".
      if (!opts.keepMarks) markEdited(d, before);
    });
    if (patches.length === 0) return;
    if (tx) {
      // Undo applies the newest edit first, so later inverses go in front.
      tx.entry.patches.push(...patches);
      tx.entry.inverse.unshift(...inverse);
      set({ plan });
      return;
    }
    set((s) => ({
      plan,
      past: [...s.past, { patches, inverse }].slice(-HISTORY_LIMIT),
      future: [],
    }));
  }

  /** Update a plan-array entry by id; silently ignores unknown ids. */
  const patchById = <K extends "openings" | "items">(key: K, id: string, changes: object) =>
    edit((d) => {
      const target = (d[key] as { id: string }[]).find((e) => e.id === id);
      if (target) Object.assign(target, changes);
    });

  /** Wall edit: run `mutate`, then rebuild `d.rooms` against the pre-edit plan. */
  function editWalls(mutate: (d: Draft<Plan>) => void, opts: { keepMarks?: boolean } = {}) {
    const before = get().plan;
    edit((d) => {
      mutate(d);
      syncRooms(d, before);
    }, opts);
  }

  /** Run `mutate` on the walls, then clamp openings on every wall whose length changed. */
  function withClampedOpenings(d: Draft<Plan>, mutate: () => void) {
    const before = new Map(d.walls.map((w) => [w.id, wallLength(w)]));
    mutate();
    for (const o of d.openings) {
      const wall = d.walls.find((w) => w.id === o.wallId);
      const was = before.get(o.wallId);
      if (!wall || was === undefined || Math.abs(wallLength(wall) - was) < 1e-9) continue;
      Object.assign(o, clampOpening(o, wall)); // unchanged values add no patch
    }
  }

  return {
    plan: { ...samplePlan, openings: withSwingSides(samplePlan.openings), rooms: deriveRooms(samplePlan).map(toStoredRoom) },
    past: [],
    future: [],

    loadPlan: (loaded) => {
      const plan = { ...loaded, openings: withSwingSides(loaded.openings) }; // doors from before 4.5 get the old side
      if (process.env.NODE_ENV === "development") {
        const problems = validatePlan(plan);
        if (problems.length > 0) console.warn(`Plan "${plan.name}" has problems:\n- ${problems.join("\n- ")}`);
      }
      tx = null;
      const rooms = deriveRooms(plan).map(toStoredRoom); // stored rooms keep names by matching loop
      set({ plan: { ...plan, rooms }, past: [], future: [] }); // a fresh plan starts a fresh history
    },

    addWall: (wall) => {
      const id = newId("w");
      editWalls((d) => void d.walls.push({ ...wall, id }));
      return id;
    },
    updateWall: (id, changes) =>
      editWalls((d) =>
        withClampedOpenings(d, () => {
          const wall = d.walls.find((w) => w.id === id);
          if (wall) Object.assign(wall, changes);
        }),
      ),
    deleteWall: (id) =>
      editWalls((d) => {
        d.walls = d.walls.filter((w) => w.id !== id);
        d.openings = d.openings.filter((o) => o.wallId !== id);
      }),
    moveWallEndpoint: (wallId, end, to) => {
      const from = get().plan.walls.find((w) => w.id === wallId)?.[end];
      if (!from) return;
      editWalls((d) =>
        withClampedOpenings(d, () => {
          for (const w of d.walls) {
            for (const key of ["a", "b"] as const) {
              if (Math.hypot(w[key].x - from.x, w[key].y - from.y) < JOINT_EPS) w[key] = { x: to.x, y: to.y };
            }
          }
        }),
      );
    },

    splitWall: (wallId, at) => {
      const id = newId("w");
      const split = splitWallAt(get().plan, wallId, at, id);
      if ("error" in split) return null;
      editWalls((d) => {
        const i = d.walls.findIndex((w) => w.id === wallId);
        d.walls.splice(i, 1, ...split.pieces); // the second piece sits right after the first
        for (const m of split.moved) {
          const o = d.openings.find((x) => x.id === m.id);
          if (o) Object.assign(o, m);
        }
      });
      return id;
    },
    drawWall: (a, b, size) => {
      if (drawProblem(get().plan, a, b)) return null;
      let id: string | null = null;
      get().transaction(() => {
        // Re-read the plan per end: splitting at a can create the wall b lands on.
        for (const p of [a, b]) {
          const host = hostAt(get().plan.walls, p);
          if (host) get().splitWall(host, p);
        }
        id = get().addWall({ a: { ...a }, b: { ...b }, ...size });
      });
      return id;
    },

    addOpening: (opening) => {
      const id = newId("o");
      edit((d) => void d.openings.push({ ...opening, id }));
      return id;
    },
    placeOpening: (kind, wallId, centre) => {
      const out = planOpening(get().plan, kind, wallId, centre);
      return "error" in out ? null : get().addOpening(out.opening);
    },
    flipDoor: (id) =>
      edit((d) => {
        const o = d.openings.find((x) => x.id === id);
        if (o?.kind === "door") o.swing = flipSide(o.swing);
      }),
    updateOpening: (id, changes) => patchById("openings", id, changes),
    deleteOpening: (id) =>
      edit((d) => {
        d.openings = d.openings.filter((o) => o.id !== id);
      }),

    addItem: (item) => {
      const id = newId("i");
      edit((d) => void d.items.push({ ...item, id }));
      return id;
    },
    addImportedItem: (info, position) =>
      get().addItem({ catalogId: `import:${info.assetId}`, position: { ...position }, rotationY: 0, scale: 1, colorOverrides: {}, import: structuredClone(info) }),
    updateItem: (id, changes) => patchById("items", id, changes),
    setNodeOverride: (itemId, path, override) =>
      edit((d) => {
        const overrides = d.items.find((i) => i.id === itemId)?.import?.nodeOverrides;
        if (!overrides) return;
        const transform = overrides[path]?.transform; // not the flags' business: kept as it is
        const clean = { ...(override?.hidden && { hidden: true }), ...(override?.deleted && { deleted: true }), ...(transform && { transform }) }; // false flags are just absent
        if (Object.keys(clean).length > 0) overrides[path] = clean;
        else delete overrides[path];
      }),
    setNodeTransform: (itemId, path, transform) =>
      edit((d) => {
        const overrides = d.items.find((i) => i.id === itemId)?.import?.nodeOverrides;
        if (!overrides || path === "") return; // the root is the item itself: it moves with Item.position
        const flags: NodeOverride = { ...overrides[path] };
        delete flags.transform;
        const keep = transform && !isIdentityTransform(transform) ? { transform: { t: [...transform.t] as [number, number, number], rotY: transform.rotY, s: transform.s } } : {};
        const next = { ...flags, ...keep };
        if (Object.keys(next).length > 0) overrides[path] = next;
        else delete overrides[path];
      }),
    deleteItem: (id) =>
      edit((d) => {
        d.items = d.items.filter((i) => i.id !== id);
      }),

    renameRoom: (id, name) =>
      edit((d) => {
        const room = d.rooms.find((r) => r.id === id);
        if (room) room.name = name;
      }),
    renamePlan: (name) => {
      const clean = name.trim().slice(0, PLAN_NAME_MAX).trim();
      if (clean) edit((d) => void (d.name = clean)); // edit() adds no history when the name is unchanged
    },
    setRoomMaterial: (id, floorMaterial) =>
      edit((d) => {
        const room = d.rooms.find((r) => r.id === id);
        if (room) room.floorMaterial = floorMaterial;
      }),

    addTakeoff: (takeoff) => {
      const id = newId("t");
      const hash = wallsHash(get().plan.walls);
      edit((d) => {
        const t: Takeoff = { id, name: takeoff.name, kind: takeoff.kind, points: copyPoints(takeoff.points), wallsHash: hash };
        if (takeoff.cutouts?.length) t.cutouts = takeoff.cutouts.map(copyPoints);
        if (takeoff.reference) t.reference = copyValue(takeoff.reference);
        if (takeoff.override) t.override = copyValue(takeoff.override);
        (d.takeoffs ??= []).push(t);
      });
      return id;
    },
    updateTakeoff: (id, changes) =>
      edit((d) => {
        const t = d.takeoffs?.find((x) => x.id === id);
        if (!t) return;
        const name = changes.name?.trim();
        if (name) t.name = name;
        for (const key of ["reference", "override"] as const) {
          const v = changes[key];
          if (v === null) delete t[key];
          else if (v) t[key] = copyValue(v);
        }
        if (changes.cutouts) {
          if (changes.cutouts.length) t.cutouts = changes.cutouts.map(copyPoints);
          else delete t.cutouts;
        }
      }),
    deleteTakeoff: (id) =>
      edit((d) => {
        if (d.takeoffs) d.takeoffs = d.takeoffs.filter((t) => t.id !== id);
      }),
    markTakeoffCurrent: (id) => {
      const hash = wallsHash(get().plan.walls);
      edit((d) => {
        const t = d.takeoffs?.find((x) => x.id === id);
        if (t) t.wallsHash = hash;
      });
    },
    calibratePlan: (factor, note) => {
      const scaled = scalePlan(get().plan, factor);
      const problem = calibrationProblem(scaled);
      if (problem) return problem; // refused: nothing is written, so there is nothing to undo
      editWalls((d) => {
        d.walls = scaled.walls;
        d.openings = scaled.openings;
        d.items = scaled.items;
        if (scaled.takeoffs) d.takeoffs = scaled.takeoffs;
        (d.calibrations ??= []).push({ factor, ...(note?.trim() && { note: note.trim() }) });
      }, { keepMarks: true });
      return null;
    },

    transaction: (fn) => {
      if (tx) {
        tx.depth++; // nested: fold into the outer step
        try {
          fn();
        } finally {
          tx.depth--;
        }
        return;
      }
      const open = { depth: 1, entry: { patches: [], inverse: [] } as HistoryEntry };
      tx = open;
      try {
        fn();
      } finally {
        tx = null;
        if (open.entry.patches.length > 0) {
          set((s) => ({ past: [...s.past, open.entry].slice(-HISTORY_LIMIT), future: [] }));
        }
      }
    },

    rollback: () => {
      const { past, plan } = get();
      const entry = past[past.length - 1];
      if (!entry || tx) return;
      set((s) => ({ plan: applyPatches(plan, entry.inverse), past: s.past.slice(0, -1), future: [] }));
    },

    undo: () => {
      const { past, plan } = get();
      const entry = past[past.length - 1];
      if (!entry || tx) return;
      set((s) => ({
        plan: applyPatches(plan, entry.inverse),
        past: s.past.slice(0, -1),
        future: [...s.future, entry],
      }));
    },
    redo: () => {
      const { future, plan } = get();
      const entry = future[future.length - 1];
      if (!entry || tx) return;
      set((s) => ({
        plan: applyPatches(plan, entry.patches),
        past: [...s.past, entry],
        future: s.future.slice(0, -1),
      }));
    },
  };
});

/** Recompute stored rooms; only writes when they changed, so plain moves add no room patches. */
/** A wall read from a PDF (step M.1b) whose shape changed, or a new piece cut from
 *  one, says "Edited" from then on; its provenance stays. Every edit passes here. */
function markEdited(d: Draft<Plan>, before: Plan) {
  for (const w of d.walls) {
    if (!w.provenance || w.edited) continue;
    const was = before.walls.find((p) => p.id === w.id);
    if (!was || was.a.x !== w.a.x || was.a.y !== w.a.y || was.b.x !== w.b.x || was.b.y !== w.b.y || was.thickness !== w.thickness || was.height !== w.height) w.edited = true;
  }
  // Openings from a PDF (step M.1c): the same rule, and the default-height mark goes once a height is typed.
  for (const o of d.openings) {
    if (!o.provenance) continue;
    const was = before.openings.find((p) => p.id === o.id);
    if (o.defaultHeight && (!was || was.height !== o.height || was.sillHeight !== o.sillHeight)) delete o.defaultHeight;
    if (o.edited) continue;
    if (!was || (["wallId", "kind", "offset", "width", "height", "sillHeight", "swing", "hinge"] as const).some((k) => was[k] !== o[k])) o.edited = true;
  }
}

function syncRooms(d: Draft<Plan>, previous: Plan) {
  const rooms = deriveRooms(d as Plan, previous).map(toStoredRoom);
  if (JSON.stringify(rooms) !== JSON.stringify(d.rooms)) d.rooms = rooms;
}

/** For enabling the Undo and Redo buttons. */
export const useCanUndo = () => usePlanStore((s) => s.past.length > 0);
export const useCanRedo = () => usePlanStore((s) => s.future.length > 0);

/** Rooms with polygon, area, perimeter and centroid for components; recomputed only when the plan changes. */
export function useDerivedRooms(): DerivedRoom[] {
  const plan = usePlanStore((s) => s.plan);
  return useMemo(() => deriveRooms(plan), [plan]);
}

/** Ctrl/Cmd+Z = undo, Shift+Ctrl/Cmd+Z = redo. Returns a cleanup; call it from an effect. */
export function installPlanShortcuts(): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z" || isTypingTarget(e.target)) return;
    e.preventDefault();
    const { undo, redo } = usePlanStore.getState();
    (e.shiftKey ? redo : undo)();
  };
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}

// Development only: lets scripts/e2e-import.ts read the loaded plan from the page.
if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
  (window as unknown as { __planStore?: typeof usePlanStore }).__planStore = usePlanStore;
}
