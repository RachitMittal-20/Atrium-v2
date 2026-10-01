/**
 * materials.ts — flat placeholder colours for the 3D plan view. Floor colours
 * are looked up by `Room.floorMaterial`; unknown ids get a neutral fallback.
 * Real textures replace this in Phase 6. Connects to: PlanModel.tsx, and the
 * studio page for the scene background. Colours here are scene surfaces, not
 * UI, so they sit outside the CSS design tokens (the background matches
 * `limestone`).
 */

const FLOOR_COLORS: Record<string, string> = {
  "oak-floor": "#b98e5a",
  "limestone-tile": "#d8cfbb",
  "stone-tile": "#a9a294",
};
const FALLBACK_FLOOR = "#cfc8b8";

export const floorColor = (materialId: string) => FLOOR_COLORS[materialId] ?? FALLBACK_FLOOR;

export const SCENE_COLORS = {
  background: "#e9e2d4", // = limestone
  wall: "#f4efe5", // = vellum
  wallSelected: "#c9a05a", // vellum pulled towards gilt, to match the 2D selection
  wallHovered: "#e4d3b0", // the same tint, lighter
  ceiling: "#f7f3ea",
  frame: "#5b4a37",
  door: "#7d6446",
  glass: "#a9c8d8",
  gridCell: "#cfc5b3", // = stone
  gridSection: "#6f675c", // = smoke
};
