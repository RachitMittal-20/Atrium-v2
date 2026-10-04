/**
 * toolStore.ts — which editor tool is active: Select (pick and edit walls,
 * doors and windows), Wall (draw new walls), Door or Window (place one on a
 * wall), Measure (a temporary two-point dimension), Push/Pull (move a face of
 * the 3D model), Move (slide a door or window along its wall, a wall sideways, a
 * corner, or an imported model in 3D), Rotate or Scale (an imported model or one of its
 * parts, step I.1b). Push/Pull and Move share src/store/pushPullStore.ts, whose `kind`
 * follows the tool chosen here; Move, Rotate and Scale use src/store/itemToolStore.ts
 * on imported models, and keep a selected model selected when chosen.
 * Editor state, not plan state, so switching tools or measuring is never an undo
 * step and never saved. Choosing any tool but Select clears the wall selection:
 * the right panel then shows the Summary, whose counts and room areas follow every
 * edit. Leaving Measure (or entering it) drops the temporary measurement, and
 * Escape cancels it from anywhere. Leaving a 3D tool mid-pull takes the preview back.
 *
 * TOOL_SHORTCUTS is the one list of tool keys (src/app/studio/page.tsx reads it):
 * P for Push/Pull, V for Move, Q for Rotate and Z for Scale. Not M: m is a unit letter
 * in a typed distance ("30 cm", "0.3 m"), so it would switch tools in the middle of
 * typing one. None may be a walking key (W A S D) either.
 *
 * Connects to: src/store/{selectionStore,pushPullStore}.ts, src/lib/plan2d/measure.ts
 * (the maths); set by src/components/studio/ToolRail.tsx and read by
 * src/components/plan2d/PlanCanvas.tsx, src/components/three/{PlanModel,PushPullTool}.tsx
 * and src/app/studio/page.tsx.
 */
import { create } from "zustand";
import { isTypingTarget } from "@/lib/keyboard";
import { faceExposed } from "@/lib/plan/pushpull";
import { moveMeasurePoint, placeMeasurePoint, type Measurement } from "@/lib/plan2d/measure";
import type { Vec2 } from "@/types/plan";
import { useItemToolStore } from "./itemToolStore";
import { usePlanStore } from "./planStore";
import { usePushPullStore } from "./pushPullStore";
import { useSelectionStore } from "./selectionStore";

export type Tool = "select" | "wall" | "door" | "window" | "measure" | "pushpull" | "move" | "rotate" | "scale";

/** The tools that work in the 3D pane only: disabled in the 2D-only view and while walking. */
export const TOOLS_3D: readonly Tool[] = ["pushpull", "move", "rotate", "scale"];
export const is3dTool = (tool: Tool) => TOOLS_3D.includes(tool);
/** The tools that act on imported 3D models (step I.1b): Move also moves doors, windows, walls and corners; Rotate and Scale only models. */
export const ITEM_TOOLS: readonly Tool[] = ["move", "rotate", "scale"];
export const isItemTool = (tool: Tool) => ITEM_TOOLS.includes(tool);
/** Push/Pull and Move share src/store/pushPullStore.ts. */
export const isPushPullTool = (tool: Tool) => tool === "pushpull" || tool === "move";

/**
 * Single-key shortcuts, lower case. scripts/test-pushpull-openings.ts and
 * scripts/test-import-transform.ts check no two tools share one, and that none is a
 * walking key (W A S D) or a letter a typed distance uses (digits, signs, c m f t i n).
 */
export const TOOL_SHORTCUTS: Partial<Record<Tool, string>> = { pushpull: "p", move: "v", rotate: "q", scale: "z" };

interface ToolState {
  tool: Tool;
  /** The temporary Measure overlay, in plan metres. Null when nothing is being measured. */
  measurement: Measurement | null;
  setTool: (tool: Tool) => void;
  placeMeasurePoint: (p: Vec2) => void;
  moveMeasurePoint: (which: "a" | "b", p: Vec2) => void;
  cancelMeasure: () => void;
}

export const useToolStore = create<ToolState>((set, get) => ({
  tool: "select",
  measurement: null,

  setTool: (tool) => {
    // an imported model stays selected for Move, Rotate and Scale: they act on it (or on its active part), and typed values go to it
    const keepModel = isItemTool(tool) && useSelectionStore.getState().itemId !== null;
    if (tool !== "select" && !keepModel) useSelectionStore.getState().select(null);
    if (tool === get().tool) return;
    if (isPushPullTool(get().tool)) {
      usePushPullStore.getState().cancel(); // leaving the tool mid-pull takes the preview back
      usePushPullStore.getState().setHover(null);
    }
    if (isItemTool(get().tool)) {
      useItemToolStore.getState().cancel(); // and mid-drag on a model
      useItemToolStore.getState().setHover(null);
    }
    if (isPushPullTool(tool)) usePushPullStore.getState().setKind(tool === "move" ? "move" : "pull");
    set({ tool, measurement: null }); // any tool change drops the temporary measurement
  },
  placeMeasurePoint: (p) => set((s) => (s.tool === "measure" ? { measurement: placeMeasurePoint(s.measurement, p) } : s)),
  moveMeasurePoint: (which, p) => set((s) => (s.measurement ? { measurement: moveMeasurePoint(s.measurement, which, p) } : s)),
  cancelMeasure: () => set({ measurement: null }),
}));

/**
 * Escape cancels the current measurement from anywhere. Registered in the
 * capture phase and stopped there, so the same keypress does not also clear the
 * wall selection or close something else underneath. Returns a cleanup; call it
 * from an effect.
 */
export function installToolShortcuts(): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || isTypingTarget(e.target) || !useToolStore.getState().measurement) return;
    useToolStore.getState().cancelMeasure();
    e.stopPropagation();
  };
  window.addEventListener("keydown", onKeyDown, { capture: true });
  return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
}

// Development only: lets scripts/e2e-studio.ts read the active tool and the measurement.
if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
  (window as unknown as { __toolStore?: typeof useToolStore }).__toolStore = useToolStore;
}

// Development and test builds only: the browser test reads which 3D tool is active, what is hovered and whether a
// pull is under way. `hoverFace` is the 4.7a shape, kept so the 4.7a checks read it unchanged. 4.7c adds `corner`
// (the plan point of the corner hovered or dragged, or null) and `exposed` (whether the hovered face can be seen;
// null with nothing hovered).
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
  const face = () => usePushPullStore.getState().hover;
  const debug = {} as {
    tool: Tool;
    hover: { wallId: string; openingId: string | null; role: string } | null;
    hoverFace: { wallId: string; role: string } | null;
    active: boolean;
    corner: { x: number; y: number } | null;
    exposed: boolean | null;
  };
  Object.defineProperties(debug, {
    tool: { get: () => useToolStore.getState().tool, enumerable: true },
    hover: { get: () => { const h = face(); return h ? { wallId: h.wallId, openingId: h.openingId, role: h.role } : null; }, enumerable: true },
    hoverFace: { get: () => { const h = face(); return h ? { wallId: h.wallId, role: h.role } : null; }, enumerable: true },
    active: { get: () => usePushPullStore.getState().pull !== null, enumerable: true },
    corner: { get: () => { const c = usePushPullStore.getState().corner; return c ? { ...c.point } : null; }, enumerable: true },
    exposed: { get: () => { const h = face(); return h ? faceExposed(usePlanStore.getState().plan, h) : null; }, enumerable: true },
  });
  (window as unknown as { __pushPullDebug?: typeof debug }).__pushPullDebug = debug;
}
