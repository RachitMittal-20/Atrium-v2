/**
 * itemToolStore.ts — the state of the Move, Rotate and Scale tools on imported 3D
 * models and their parts (step I.1b): what the pointer is over, the drag in progress,
 * the typed value and the Floor | Lift choice. Editor state like pushPullStore: never
 * in the plan, never undoable, never saved.
 *
 * A drag edits the plan LIVE so the model follows the pointer, and keeps history at
 * exactly one entry the way Push/Pull does: every update rolls the previous preview
 * back (only while it is still the newest history entry) and applies the whole drag
 * again from where it started, in one transaction. A commit leaves one undo step;
 * Escape, pointercancel, blur and a second finger roll back and leave history as it was.
 *
 * The target is a whole item (`path` null: Item.position, rotationY, scale) or one of
 * its parts (`path` set: NodeOverride.transform, in the MODEL frame, about the part's
 * pivot, see src/lib/import/model.ts). The rules are src/lib/import/transform.ts; a
 * part runs them as a stand-in item standing at the part's pivot (where it is now, its
 * ancestors' transforms included), and the world change (a move, or a turn or scale about
 * that pivot) is taken into the model frame (worldToModelDelta) and through the part's
 * ancestors (model.partTransformAfter), so it is right under any parent chain. Alt turns snapping off.
 * Move: on the floor, or straight up with Shift or the Lift toggle (chosen at the press).
 * Typed values: Rotate turns BY the typed degrees, Scale sets the typed percentage
 * exactly; with no drag they act on the selection (the active part, else the item), else
 * on the hovered model. Move takes no typed value: exact positions go in the panel.
 *
 * Connects to: src/lib/import/{transform,model,assetCache}.ts, src/store/{planStore,
 * selectionStore}.ts; driven by src/components/three/ItemTool.tsx (and, for Move, by
 * src/components/three/PushPullTool.tsx through `bridge`); read by
 * src/components/studio/ItemToolOverlay.tsx and src/components/three/ImportedItems.tsx.
 */
import { create } from "zustand";
import { useAssetCache } from "@/lib/import/assetCache";
import { ancestorTransforms, formatSize, modelFrame, partBox, partPivotNow, partTransformAfter, type PartChange } from "@/lib/import/model";
import { itemPoint, liftItem, moveItemFloor, parseDegrees, parsePercent, rotateItem, ROTATE_STEP_DEG, scaleItem, scaleToPercent, turnDegrees, worldToModelDelta, wrapAngle, type Result } from "@/lib/import/transform";
import type { Item, PartTransform, Vec2, Vec3 } from "@/types/plan";
import { usePlanStore } from "./planStore";
import { useSelectionStore } from "./selectionStore";

export type ItemToolKind = "move" | "rotate" | "scale";
/** A whole imported model (`path` null) or one part of it, by its node path. */
export interface ItemTarget {
  itemId: string;
  path: string | null;
}

/** What the label next to the pointer says. */
export interface ItemLabel {
  distance: string;
  value: string;
  note: string | null;
}

/** The pointer input a drag was last given, so Alt can re-apply it with snapping on or off. */
type Input = { kind: "floor"; grab: Vec2; current: Vec2 } | { kind: "lift"; t: number } | { kind: "rotate"; a0: number; a1: number } | { kind: "scale"; px0: number; px1: number } | { kind: "typed"; value: number };

export interface ItemDrag {
  kind: ItemToolKind;
  /** Move: straight up and down instead of on the floor. */
  lift: boolean;
  target: ItemTarget;
  /** The item at the start, or for a part a stand-in item at its pivot (world), turned by rotY, scaled by s. */
  start: Pick<Item, "position" | "rotationY" | "scale">;
  /** A part's transform at the start. */
  transform0: PartTransform | null;
  /** A part's pivot at the start, in the model frame (its own transform and its ancestors' applied): what it turns and scales about. */
  pivot0: Vec3 | null;
  input: Input | null;
  label: ItemLabel | null;
  /** True while a preview edit sits on top of history, ready to roll back. */
  live: boolean;
}

/** How PushPullTool hands the Move tool's presses on imported models to ItemTool (set by ItemTool while it is mounted). */
export interface ItemBridge {
  /** The model under the pointer and how far from the camera (m), or null. */
  probe: (clientX: number, clientY: number, touch: boolean) => { target: ItemTarget; distance: number } | null;
  /** Start a drag on what probe found; false when nothing was started. */
  press: (e: PointerEvent) => boolean;
}

interface ItemToolState {
  hover: ItemTarget | null;
  drag: ItemDrag | null;
  typed: string;
  message: string | null;
  pointer: { x: number; y: number } | null;
  /** The Floor | Lift toggle (for touch, where there is no Shift). */
  liftMode: boolean;
  alt: boolean;
  bridge: ItemBridge | null;

  setHover: (t: ItemTarget | null) => void;
  setPointer: (p: { x: number; y: number } | null) => void;
  setAlt: (alt: boolean) => void;
  setLiftMode: (on: boolean) => void;
  setMessage: (m: string | null) => void;
  /** Start a drag on `target`. False, with a message, when it can't be (the item is gone, or a part's file isn't loaded). */
  begin: (target: ItemTarget, kind: ItemToolKind, opts?: { lift?: boolean }) => boolean;
  /** Move on the floor: the pointer was at `grab` (plan metres) at the press and is at `current` now. */
  moveFloor: (grab: Vec2, current: Vec2) => void;
  /** Move straight up: `t` metres from the grab along world Y. */
  lift: (t: number) => void;
  /** Rotate: the pointer's angle (transform.pointerAngle) at the grab and now. */
  rotate: (a0: number, a1: number) => void;
  /** Scale: the pointer's screen distance (px) from the base point's projection at the grab and now. */
  scale: (px0: number, px1: number) => void;
  setTyped: (text: string) => void;
  /** Enter: Rotate turns by the typed degrees, Scale sets the typed percentage, then commits. False when it can't. */
  applyTyped: (kind: ItemToolKind) => boolean;
  commit: () => void;
  cancel: () => void;
  setBridge: (b: ItemBridge | null) => void;
}

export const MOVE_TYPE_HINT = "Type exact positions in the panel";
export const ROTATE_TYPE_HINT = "Type degrees like 30 or -45, then Enter.";
export const SCALE_TYPE_HINT = "Type a percentage like 150, then Enter.";
const PART_NOT_LOADED = "This model's file isn't loaded, so its parts can't be moved.";

const signed = (m: number, unit = " m") => `${m < 0 ? "-" : "+"}${Math.abs(m).toFixed(2)}${unit}`;
const deg = (rad: number) => turnDegrees(0, rad);
const pct = (k: number) => `${Number((k * 100).toFixed(1))}%`;

// The history entry the live preview made (module-level: nothing renders from it), as in pushPullStore.
let liveEntry: unknown = null;
function rollbackPreview() {
  const s = usePlanStore.getState();
  if (liveEntry !== null && s.past[s.past.length - 1] === liveEntry) s.rollback();
  liveEntry = null;
}

const itemOf = (id: string) => usePlanStore.getState().plan.items.find((i) => i.id === id);

/** The loaded model of an item, or null (still loading, missing or broken). */
function modelOf(item: Item) {
  const a = item.import ? useAssetCache.getState().assets[item.import.assetId] : undefined;
  return a?.status === "ready" ? a.model : null;
}

/**
 * What a part drag needs: the cached original and the model frame (for model.partTransformAfter), the part's own
 * transform now, where its pivot is now in the model frame (moved by its own transform AND carried by its ancestors'),
 * the item's base point, its original size and the scale its ancestors give it; null when the file isn't loaded.
 */
function partInfo(item: Item, path: string) {
  const model = modelOf(item);
  const info = item.import;
  if (!model || !info) return null;
  const frame = { unitToMetres: info.unitToMetres, upAxis: info.upAxis };
  const box = partBox(model.root, path, frame);
  if (!box) return null;
  const base = modelFrame(model.box, info.unitToMetres, info.upAxis).base;
  const transform = info.nodeOverrides[path]?.transform ?? { t: [0, 0, 0] as [number, number, number], rotY: 0, s: 1 };
  const e = ancestorTransforms(model.root, path, info.nodeOverrides, frame).elements;
  return {
    root: model.root,
    frame,
    overrides: info.nodeOverrides,
    base,
    transform,
    pivotNow: partPivotNow(model.root, path, info.nodeOverrides, frame, transform)!,
    size: { x: box.max.x - box.min.x, y: box.max.y - box.min.y, z: box.max.z - box.min.z },
    ancestorScale: Math.hypot(e[0], e[1], e[2]),
  };
}

/** Width × depth × height (m) of what the target looks like at scale `k` (its own scale; a part also takes the item's). */
function sizeAt(item: Item, path: string | null, k: number): string {
  const model = modelOf(item);
  if (path !== null) {
    const p = partInfo(item, path);
    const m = p ? k * p.ancestorScale * item.scale : 0;
    return p ? formatSize(p.size.x * m, p.size.z * m, p.size.y * m) : "–";
  }
  if (!model || !item.import) return formatSize(k, k, k); // the 1 m placeholder
  const f = modelFrame(model.box, item.import.unitToMetres, item.import.upAxis);
  return formatSize(f.width * k, f.depth * k, f.height * k);
}

export const useItemToolStore = create<ItemToolState>((set, get) => {
  /** Roll back the live preview (only if it is still the newest entry), then apply `edit` in one transaction. */
  function live(edit: () => void): boolean {
    if (get().drag?.live) rollbackPreview();
    const before = usePlanStore.getState().past.length;
    usePlanStore.getState().transaction(edit);
    const after = usePlanStore.getState().past;
    const isLive = after.length > before; // a drag that changes nothing records nothing
    liveEntry = isLive ? after[after.length - 1] : null;
    return isLive;
  }

  /** Re-apply the drag for `input` from its start: compute with transform.ts, write it, label it. */
  function render(input: Input) {
    const drag = get().drag;
    const item = drag && itemOf(drag.target.itemId);
    if (!drag || !item) return;
    const { start, target, transform0 } = drag;
    const snap = !get().alt;
    const part = target.path !== null && transform0 !== null;
    const info = part ? partInfo(item, target.path!) : null;
    /** A part's new transform after a change in the model frame, right under any parent chain (model.partTransformAfter). */
    const partAfter = (change: PartChange) => (info && transform0 ? partTransformAfter(info.root, target.path!, info.overrides, info.frame, transform0, change) : null);
    const pivot0 = drag.pivot0;
    let label: ItemLabel | null = null;
    let item$: Partial<Pick<Item, "position" | "rotationY" | "scale">> | null = null; // the item's new fields
    let part$: PartTransform | null = null; // or the part's new transform

    if (input.kind === "floor") {
      const r = moveItemFloor(start, input.grab, input.current, { snap });
      const d = { x: r.value.x - start.position.x, y: 0, z: r.value.y - start.position.z };
      if (part) part$ = partAfter({ kind: "move", d: worldToModelDelta(item, d) });
      else item$ = { position: { x: r.value.x, y: start.position.y, z: r.value.y } };
      label = { distance: `${signed(d.x)}, ${signed(d.z)}`, value: `${part ? "Part at" : "At"} x ${r.value.x.toFixed(2)} m, y ${r.value.y.toFixed(2)} m`, note: r.reason };
    } else if (input.kind === "lift") {
      const r = liftItem(start, input.t, { snap });
      const dy = r.value - start.position.y;
      if (part) part$ = partAfter({ kind: "move", d: worldToModelDelta(item, { x: 0, y: dy, z: 0 }) });
      else item$ = { position: { ...start.position, y: r.value } };
      label = { distance: signed(dy), value: `${part ? "Part height" : "Height"} ${r.value.toFixed(2)} m`, note: r.reason };
    } else if (drag.kind === "rotate") {
      const r: Result<number> = input.kind === "rotate" ? rotateItem(start, input.a0, input.a1, { snapDeg: snap ? ROTATE_STEP_DEG : null }) : rotateItem(start, 0, (input.kind === "typed" ? input.value : 0) * (Math.PI / 180), { snapDeg: null });
      if (part && pivot0) part$ = partAfter({ kind: "turn", angle: wrapAngle(r.value - start.rotationY), about: pivot0 }); // about the pivot where it is now
      else item$ = { rotationY: r.value };
      const by = turnDegrees(start.rotationY, r.value);
      label = { distance: `${by < 0 ? "-" : "+"}${Math.abs(by)}°`, value: `Rotation ${deg(r.value)}°`, note: r.reason };
    } else if (drag.kind === "scale") {
      const r: Result<number> = input.kind === "scale" ? scaleItem(start, input.px0, input.px1, { snap }) : scaleToPercent(input.kind === "typed" ? input.value : 100);
      if (r.ok) {
        if (part && pivot0) part$ = partAfter({ kind: "scale", factor: r.value / start.scale, about: pivot0 });
        else item$ = { scale: r.value };
      }
      label = { distance: `Scale ${pct(r.value)}`, value: `Size ${sizeAt(item, part ? target.path : null, r.value)}`, note: r.reason };
    }

    if (part$) part$ = { ...part$, t: part$.t.map((v) => Number(v.toFixed(9)) || 0) as [number, number, number] }; // nanometres: no float dust (1e-17) in the plan
    const isLive = live(() => {
      const s = usePlanStore.getState();
      if (item$) s.updateItem(target.itemId, item$);
      if (part$) s.setNodeTransform(target.itemId, target.path!, part$);
    });
    set({ drag: { ...drag, input, label, live: isLive } });
  }

  /** What a typed value acts on with no drag: the selection (its active part, else the item), else the hovered model. */
  const typedTarget = (): ItemTarget | null => {
    const sel = useSelectionStore.getState();
    if (sel.itemId) return { itemId: sel.itemId, path: sel.editParts ? sel.partPath : null };
    return get().hover;
  };

  return {
    hover: null,
    drag: null,
    typed: "",
    message: null,
    pointer: null,
    liftMode: false,
    alt: false,
    bridge: null,

    setHover: (hover) => {
      const h = get().hover;
      if (h === hover || (h && hover && h.itemId === hover.itemId && h.path === hover.path)) return;
      set({ hover, message: null });
    },
    setPointer: (pointer) => set({ pointer }),
    setAlt: (alt) => {
      if (get().alt === alt) return;
      set({ alt });
      const input = get().drag?.input;
      if (input && input.kind !== "typed") render(input); // the same pointer, snapped (or not)
    },
    setLiftMode: (liftMode) => set({ liftMode }),
    setMessage: (message) => set({ message }),

    begin: (target, kind, opts = {}) => {
      if (get().drag) return false;
      const item = itemOf(target.itemId);
      if (!item?.import) return false;
      let start: ItemDrag["start"] = { position: { ...item.position }, rotationY: item.rotationY, scale: item.scale };
      let transform0: PartTransform | null = null;
      let pivot0: Vec3 | null = null;
      if (target.path !== null) {
        const p = partInfo(item, target.path);
        if (!p) {
          set({ message: PART_NOT_LOADED });
          return false;
        }
        transform0 = { t: [...p.transform.t] as [number, number, number], rotY: p.transform.rotY, s: p.transform.s };
        pivot0 = p.pivotNow;
        // the part as a stand-in item: standing at its pivot (where it is now), turned and scaled by its own transform
        const at = itemPoint(item, { x: pivot0.x - p.base.x, y: pivot0.y - p.base.y, z: pivot0.z - p.base.z });
        start = { position: at, rotationY: transform0.rotY, scale: transform0.s };
      }
      set({ drag: { kind, lift: kind === "move" && !!opts.lift, target, start, transform0, pivot0, input: null, label: null, live: false }, hover: target, typed: "", message: null });
      return true;
    },
    moveFloor: (grab, current) => get().typed === "" && render({ kind: "floor", grab, current }),
    lift: (t) => get().typed === "" && render({ kind: "lift", t }),
    rotate: (a0, a1) => get().typed === "" && render({ kind: "rotate", a0, a1 }),
    scale: (px0, px1) => get().typed === "" && render({ kind: "scale", px0, px1 }),

    setTyped: (typed) => {
      const kind = get().drag?.kind;
      set({ typed, message: null });
      if (kind === "move") return set({ typed: "", message: MOVE_TYPE_HINT });
      const v = kind === "rotate" ? parseDegrees(typed) : kind === "scale" ? parsePercent(typed) : null;
      if (v !== null) render({ kind: "typed", value: v }); // a live preview as the number is typed
    },
    applyTyped: (kind) => {
      if (kind === "move") {
        set({ typed: "", message: MOVE_TYPE_HINT });
        return false;
      }
      const { typed } = get();
      const v = kind === "rotate" ? parseDegrees(typed) : parsePercent(typed);
      if (v === null) {
        set({ message: kind === "rotate" ? ROTATE_TYPE_HINT : SCALE_TYPE_HINT });
        return false;
      }
      if (!get().drag) {
        const target = typedTarget();
        if (!target || !get().begin(target, kind)) return false;
      }
      render({ kind: "typed", value: v });
      get().commit();
      return true;
    },

    commit: () => {
      const drag = get().drag;
      if (!drag) return;
      liveEntry = null; // the edit now belongs to history: it is the one undo step
      set({ drag: null, typed: "", message: null });
      // the model that was moved becomes the selection (a part stays the active part: same item)
      if (useSelectionStore.getState().itemId !== drag.target.itemId) useSelectionStore.getState().selectItem(drag.target.itemId);
      if (drag.target.path !== null) useSelectionStore.getState().selectPart(drag.target.path);
    },
    cancel: () => {
      const drag = get().drag;
      if (drag?.live) rollbackPreview();
      liveEntry = null;
      if (drag || get().typed !== "") set({ drag: null, typed: "", message: null });
    },
    setBridge: (bridge) => set({ bridge }),
  };
});

/** A part's pivot in world space right now (for the tools' axes and the scale's screen centre); null when unknown. */
export function targetPivot(target: ItemTarget): Vec3 | null {
  const item = itemOf(target.itemId);
  if (!item) return null;
  if (target.path === null) return { ...item.position };
  const p = partInfo(item, target.path);
  if (!p) return null;
  return itemPoint(item, { x: p.pivotNow.x - p.base.x, y: p.pivotNow.y - p.base.y, z: p.pivotNow.z - p.base.z });
}
