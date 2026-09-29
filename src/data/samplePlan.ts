/**
 * samplePlan.ts — a hand-made 2-bedroom house (10 m × 8 m) used as demo data
 * until a blueprint is imported. Connects to: src/types/plan.ts.
 *
 *   A(0,0) ─── B(4,0) ─────────── C(10,0)
 *   │ Bedroom 1 │                    │
 *   H(0,4) ─ I(4,4)   Living         │
 *   │ Bedroom 2 │        M(10,5)─────┤   (K(7,5) ── M is the bathroom's top)
 *   │           │     K(7,5)  Bath   │
 *   G(0,8) ─ F(4,8) ─── L(7,8) ─ E(10,8)
 *
 * The living area is L-shaped (x 4–10, y 0–5, plus x 4–7, y 5–8). Wall ids are
 * readable on purpose so openings and rooms below are easy to check by eye.
 */
import type { Opening, Plan, Vec2, Wall } from "@/types/plan";

const P: Record<string, Vec2> = {
  A: { x: 0, y: 0 },
  B: { x: 4, y: 0 },
  C: { x: 10, y: 0 },
  H: { x: 0, y: 4 },
  I: { x: 4, y: 4 },
  K: { x: 7, y: 5 },
  M: { x: 10, y: 5 },
  G: { x: 0, y: 8 },
  F: { x: 4, y: 8 },
  L: { x: 7, y: 8 },
  E: { x: 10, y: 8 },
};

const EXTERIOR = 0.2;
const INTERIOR = 0.1;
const HEIGHT = 2.7;

// id is the two node letters it joins; thickness follows exterior/interior.
const wall = (from: string, to: string, exterior: boolean): Wall => ({
  id: `w-${from}${to}`,
  a: P[from],
  b: P[to],
  thickness: exterior ? EXTERIOR : INTERIOR,
  height: HEIGHT,
});

const walls: Wall[] = [
  // exterior (9)
  wall("A", "B", true),
  wall("B", "C", true),
  wall("C", "M", true),
  wall("M", "E", true),
  wall("E", "L", true),
  wall("L", "F", true),
  wall("F", "G", true),
  wall("G", "H", true),
  wall("H", "A", true),
  // interior (5)
  wall("B", "I", false),
  wall("H", "I", false),
  wall("I", "F", false),
  wall("K", "M", false),
  wall("K", "L", false),
];

const door = (id: string, wallId: string, offset: number, width = 0.9): Opening => ({
  id,
  wallId,
  kind: "door",
  offset,
  width,
  height: 2.1,
  sillHeight: 0,
});

const window_ = (id: string, wallId: string, offset: number, width = 1.2): Opening => ({
  id,
  wallId,
  kind: "window",
  offset,
  width,
  height: 1.2,
  sillHeight: 0.9,
});

const openings: Opening[] = [
  // doors (4)
  door("d-front", "w-BC", 3, 1), // front door, living, top wall
  door("d-bed1", "w-BI", 2.9), // bedroom 1 → living
  door("d-bed2", "w-IF", 2), // bedroom 2 → living
  door("d-bath", "w-KL", 1.5, 0.8), // bathroom → living
  // windows (5)
  window_("win-bed1", "w-HA", 2), // bedroom 1, left wall (H→A runs north)
  window_("win-bed2", "w-GH", 2), // bedroom 2, left wall (G→H runs north)
  window_("win-living-n", "w-BC", 5), // living, top wall
  window_("win-living-e", "w-CM", 2.5), // living, right wall
  window_("win-bath", "w-EL", 1.5, 0.6), // bathroom, bottom wall
];

export const samplePlan: Plan = {
  id: "sample-2br",
  name: "Two-bedroom house",
  units: "m",
  walls,
  openings,
  rooms: [
    { id: "r-bed1", name: "Bedroom 1", wallIds: ["w-AB", "w-BI", "w-HI", "w-HA"], floorMaterial: "oak-floor" },
    { id: "r-bed2", name: "Bedroom 2", wallIds: ["w-HI", "w-IF", "w-FG", "w-GH"], floorMaterial: "oak-floor" },
    {
      id: "r-living",
      name: "Living room",
      wallIds: ["w-BC", "w-CM", "w-KM", "w-KL", "w-LF", "w-IF", "w-BI"],
      floorMaterial: "limestone-tile",
    },
    { id: "r-bath", name: "Bathroom", wallIds: ["w-KM", "w-ME", "w-EL", "w-KL"], floorMaterial: "stone-tile" },
  ],
  items: [],
  meta: {
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    source: "sample",
  },
};
