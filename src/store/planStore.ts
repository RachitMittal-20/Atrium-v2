/**
 * planStore.ts — the one editable `Plan` plus undo/redo. Every edit runs
 * through `edit()`, which uses Immer patches so history stores small diffs, not
 * whole plans. `transaction()` folds many edits (e.g. a drag) into one undo
 * step. Every wall edit re-derives `plan.rooms` in the same recipe, so undo
 * restores room names and loops together with the walls. Connects to:
 * src/types/plan.ts, src/lib/plan/{validate,geometry,rooms}.ts,
 * src/lib/keyboard.ts; the 3D scene, 2D plan and exports read `plan` from here.
 */
import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from "immer";
import { useMemo } from "react";
import { create } from "zustand";
import { samplePlan } from "@/data/samplePlan";
import { isTypingTarget } from "@/lib/keyboard";
import { clampOpening, JOINT_EPS, wallLength } from "@/lib/plan/geometry";
import { deriveRooms, toStoredRoom, type DerivedRoom } from "@/lib/plan/rooms";
import { validatePlan } from "@/lib/plan/validate";
import type { Item, Opening, Plan, Vec2, Wall } from "@/types/plan";

enablePatches();

const HISTORY_LIMIT = 100;

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
  addOpening: (opening: Omit<Opening, "id">) => string;
  updateOpening: (id: string, changes: Partial<Omit<Opening, "id">>) => void;
  deleteOpening: (id: string) => void;
  addItem: (item: Omit<Item, "id">) => string;
  updateItem: (id: string, changes: Partial<Omit<Item, "id">>) => void;
  deleteItem: (id: string) => void;
  renameRoom: (id: string, name: string) => void;
  setRoomMaterial: (id: string, floorMaterial: string) => void;

  /** Run `fn`; every edit inside becomes a single undo step. Synchronous only. */
  transaction: (fn: () => void) => void;
  undo: () => void;
  redo: () => void;
}

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

// Open transaction, if any. Module-level (not state): nothing renders from it.
let tx: { depth: number; entry: HistoryEntry } | null = null;

export const usePlanStore = create<PlanState>((set, get) => {
  /** Apply `recipe` to the plan and record it in history (or in the open transaction). */
  function edit(recipe: (draft: Draft<Plan>) => void) {
    const [plan, patches, inverse] = produceWithPatches(get().plan, recipe);
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
  function editWalls(mutate: (d: Draft<Plan>) => void) {
    const before = get().plan;
    edit((d) => {
      mutate(d);
      syncRooms(d, before);
    });
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
    plan: { ...samplePlan, rooms: deriveRooms(samplePlan).map(toStoredRoom) },
    past: [],
    future: [],

    loadPlan: (plan) => {
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

    addOpening: (opening) => {
      const id = newId("o");
      edit((d) => void d.openings.push({ ...opening, id }));
      return id;
    },
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
    updateItem: (id, changes) => patchById("items", id, changes),
    deleteItem: (id) =>
      edit((d) => {
        d.items = d.items.filter((i) => i.id !== id);
      }),

    renameRoom: (id, name) =>
      edit((d) => {
        const room = d.rooms.find((r) => r.id === id);
        if (room) room.name = name;
      }),
    setRoomMaterial: (id, floorMaterial) =>
      edit((d) => {
        const room = d.rooms.find((r) => r.id === id);
        if (room) room.floorMaterial = floorMaterial;
      }),

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
function syncRooms(d: Draft<Plan>, previous: Plan) {
  const rooms = deriveRooms(d as Plan, previous).map(toStoredRoom);
  if (JSON.stringify(rooms) !== JSON.stringify(d.rooms)) d.rooms = rooms;
}

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
