/**
 * camera.ts — where the 3D pane's orbit camera goes to show the whole plan (step V.1):
 * the home view (the three-quarter view the studio opens with, also Recenter's target in
 * Orbit) and the top view (the bird's-eye "Top", also Recenter's target in Top). Pure: no
 * three.js, no React. World space, metres: x = plan x, y up, z = plan y (south).
 *
 * Both frame the walls' bounding box from the floor to the tallest wall with 10% padding
 * (VIEW_PADDING: the box takes at most 1/1.1 of the half-width and half-height), for the
 * pane's own aspect, through math.fitDistance (the corner fit frameBox uses).
 *   planBounds  the walls' box; an empty plan (step N.1) is a 10 × 10 m patch, never NaN.
 *   homeView    from HOME_DIRECTION, aimed at the plan's centre on the ground: exactly the
 *               pose Scene3D's FitCamera framed before V.1 (scripts/test-views.ts checks it).
 *   topView     straight down at the plan's centre, north (−z, up the 2D plan) up the screen.
 *               It leans TOP_TILT (1e-4 rad, 0.006°) towards the south: OrbitControls cannot
 *               hold a camera at exactly 90° (it clamps to 1e-6 rad and its acos there is too
 *               coarse to restore a camera exactly), and the lean fixes which way is up.
 *               `inset` keeps a band of that fraction of the pane's height clear at the top
 *               (and, to keep the plan centred, at the bottom): the pane's own controls sit in
 *               the top band (ViewCamera passes CONTROL_STRIP_PX). The 10% padding is then of
 *               the height that is left. Seen from above, a plan about as wide-for-its-depth as
 *               the pane fills its height, and at 1440 × 900 the north wall ran under Orbit |
 *               Top | Walk without it. The home view needs none: tilted, the plan is shallow on
 *               screen, and it is the exact pose the studio has always opened with.
 *
 * Connects to: src/lib/handles3d/math.ts (fitDistance); used by
 * src/components/three/ViewCamera.tsx and src/components/studio/Scene3D.tsx; tested by
 * scripts/test-views.ts.
 */
import { fitDistance } from "@/lib/handles3d/math";
import type { Vec3 } from "@/types/plan";

/** The walls' bounding box in world space: x/z on the ground, `height` the tallest wall. */
export interface PlanBounds {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  height: number;
  cx: number;
  cz: number;
  size: number; // longest ground side, at least 1
}

export interface CameraPose {
  position: Vec3;
  target: Vec3;
}

/** From the plan's centre towards the home camera: south-east and up (the studio's opening view). */
export const HOME_DIRECTION: Vec3 = (() => {
  const n = Math.hypot(0.5, 0.65, 0.75);
  return { x: 0.5 / n, y: 0.65 / n, z: 0.75 / n };
})();
export const VIEW_PADDING = 1.1;
/** The band (px) at the top of the 3D pane that its own controls take: WalkOverlay's row sits 8 px down, is 44 px
 *  tall, and 8 px more are kept clear. The top view keeps it free of the plan. */
export const CONTROL_STRIP_PX = 60;
/** How far (rad) the top view leans off straight down, towards the south. */
export const TOP_TILT = 1e-4;

export function planBounds(walls: readonly { a: { x: number; y: number }; b: { x: number; y: number }; height: number }[]): PlanBounds {
  // No walls (an empty plan, step N.1): Math.min() of nothing is Infinity and the centre is NaN, which froze the tab.
  // Frame a 10 x 10 m patch of ground, the same box the 2D plan falls back to (PlanCanvas outlinesOf).
  if (walls.length === 0) return { x0: 0, x1: 10, z0: 0, z1: 10, height: 2.7, cx: 5, cz: 5, size: 10 };
  const xs = walls.flatMap((w) => [w.a.x, w.b.x]);
  const zs = walls.flatMap((w) => [w.a.y, w.b.y]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  return {
    x0, x1, z0, z1,
    height: Math.max(...walls.map((w) => w.height)),
    cx: (x0 + x1) / 2,
    cz: (z0 + z1) / 2,
    size: Math.max(x1 - x0, z1 - z0, 1),
  };
}

const corners = (b: PlanBounds): Vec3[] => [b.x0, b.x1].flatMap((x) => [b.z0, b.z1].flatMap((z) => [0, b.height].map((y) => ({ x, y, z }))));
const along = (target: Vec3, back: Vec3, d: number): Vec3 => ({ x: target.x + back.x * d, y: target.y + back.y * d, z: target.z + back.z * d });

/** The three-quarter view of the whole plan. `aspect` is the pane's width / height, `fovDeg` the camera's vertical field of view. */
export function homeView(b: PlanBounds, aspect: number, fovDeg: number): CameraPose {
  const target = { x: b.cx, y: 0, z: b.cz };
  return { position: along(target, HOME_DIRECTION, fitDistance(corners(b), target, HOME_DIRECTION, fovDeg, aspect, VIEW_PADDING)), target };
}

/** The most of the pane's height `inset` may keep clear at each of the top and the bottom. */
export const MAX_INSET = 0.25;

/** The bird's-eye view of the whole plan: from above, looking down, north up the screen, always above the tallest wall.
 *  `inset` (0 to MAX_INSET) is the fraction of the pane's height kept clear at the top and at the bottom. */
export function topView(b: PlanBounds, aspect: number, fovDeg: number, inset = 0): CameraPose {
  const target = { x: b.cx, y: 0, z: b.cz };
  const back = { x: 0, y: Math.cos(TOP_TILT), z: Math.sin(TOP_TILT) };
  const clear = Math.min(MAX_INSET, Math.max(0, Number.isFinite(inset) ? inset : 0));
  const d = fitDistance(corners(b), target, back, fovDeg, aspect, VIEW_PADDING, 0.2, VIEW_PADDING / (1 - 2 * clear)); // the wall tops at least 0.2 m below the camera
  return { position: along(target, back, d), target };
}
