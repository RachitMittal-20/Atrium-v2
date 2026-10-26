/**
 * blueprint.ts — the pure maths of the landing page's blueprint scene (step 8.1): what the cyanotype sheet
 * draws, the box it is framed in, where the camera stands at each moment of the scroll, and how high the walls
 * have risen. No React and no three.js, so the server-rendered drawings, the lazy 3D canvas and the Node test
 * (scripts/test-landing-scene.ts) all read the same numbers.
 *
 * Everything is derived from a Plan with the studio's own helpers: wallOutline (src/lib/plan/geometry.ts) for the
 * walls, openingFrame and doorSwing (src/lib/plan2d/openings.ts) for the gaps, swings and window lines, exactly as
 * the 2D plan (PlanCanvas) draws them. Plan metres; plan x east, y south; world = (x, height, y), as in PlanModel.
 *
 * The scroll: `b` is the build's progress, 0 at the top of the page and 1 where the walls stand at full height.
 * The scene's timeline (BlueprintScene.tsx) runs b over the first BUILD_END of its scroll, holds, then fades the
 * stage out from FADE_START so the mansion below takes over.
 *
 * Connects to: src/components/landing/{BlueprintScene,BlueprintCanvas,BlueprintDrawings}.tsx,
 * src/lib/landing/blueprintMeshes.ts.
 */
import { wallOutline } from "@/lib/plan/geometry";
import { doorSwing, openingFrame } from "@/lib/plan2d/openings";
import type { Plan, Vec2 } from "@/types/plan";

export { BUILD_END, FADE_START } from "./timeline";

/** Paper around the plan, metres. More above it, where the headline sits. */
const MARGIN = { top: 3.6, right: 1.2, bottom: 1.2, left: 1.2 };
/** Vertical field of view of the 3D camera, degrees. */
export const FOV = 40;
/** The last frame: degrees from straight down, and round from due south towards the east. */
const END_POLAR = 56;
const END_AZIMUTH = 32;
/** At the last frame the model sits this fraction of the view's half-height below the centre, clear of the headline. */
const END_DROP = 0.2;
/** The first frame is "straight down": a hair off vertical, so lookAt has an up direction (north at the top). */
const START_POLAR = 1e-4;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The walls' footprint: every mitred outline corner. */
export function planBounds(plan: Plan): Box {
  const pts = plan.walls.flatMap((w) => wallOutline(w, plan.walls));
  if (!pts.length) return { x: -5, y: -4, w: 10, h: 8 };
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const [x, y] = [Math.min(...xs), Math.min(...ys)];
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** The sheet: the plan plus its paper. Both the DOM drawing and the first 3D frame fit exactly this box. */
export function sheetBox(plan: Plan): Box {
  const b = planBounds(plan);
  return { x: b.x - MARGIN.left, y: b.y - MARGIN.top, w: b.w + MARGIN.left + MARGIN.right, h: b.h + MARGIN.top + MARGIN.bottom };
}

export interface SheetShapes {
  /** wallOutline per wall, in plan order (empty for a zero-length wall). */
  walls: Vec2[][];
  /** Each opening's gap: from its a-side jamb to its b-side jamb on the centre line, and the band painted over the wall there. */
  gaps: { id: string; from: Vec2; to: Vec2; band: Vec2[] }[];
  /** Each door's leaf (hinge to open tip) and its quarter arc to the closed tip; `sweep` is the SVG arc flag in plan space. */
  doors: { id: string; hinge: Vec2; leafEnd: Vec2; arcEnd: Vec2; r: number; sweep: 0 | 1 }[];
  /** Each window's three lines: both wall faces and the glass on the centre line. */
  windows: { id: string; lines: [Vec2, Vec2][] }[];
}

const add = (p: Vec2, d: Vec2, k: number): Vec2 => ({ x: p.x + d.x * k, y: p.y + d.y * k });
/** How far a gap's paint pokes past the wall faces, metres, so no hairline of wall shows (PlanCanvas does the same in px). */
const GAP_OVERSHOOT = 0.015;

/** What the sheet draws, as the 2D plan draws it: walls, gaps, door swings, window lines. */
export function sheetShapes(plan: Plan): SheetShapes {
  const byId = new Map(plan.walls.map((w) => [w.id, w]));
  const out: SheetShapes = { walls: plan.walls.map((w) => wallOutline(w, plan.walls)), gaps: [], doors: [], windows: [] };
  for (const o of plan.openings) {
    const wall = byId.get(o.wallId);
    if (!wall) continue;
    const f = openingFrame(wall, o);
    const h = wall.thickness / 2 + GAP_OVERSHOOT;
    out.gaps.push({ id: o.id, from: f.start, to: f.end, band: [add(f.start, f.normal, h), add(f.end, f.normal, h), add(f.end, f.normal, -h), add(f.start, f.normal, -h)] });
    if (o.kind === "door") {
      const { hinge, leafEnd, arcEnd } = doorSwing(wall, o);
      // The arc's turn direction, as PlanCanvas works it out; plan y points down like SVG y, so it carries over.
      const sweep = (leafEnd.x - hinge.x) * (arcEnd.y - hinge.y) - (leafEnd.y - hinge.y) * (arcEnd.x - hinge.x) > 0 ? 1 : 0;
      out.doors.push({ id: o.id, hinge, leafEnd, arcEnd, r: o.width, sweep });
    } else {
      const t = wall.thickness / 2;
      out.windows.push({ id: o.id, lines: [t, -t, 0].map((k) => [add(f.start, f.normal, k), add(f.end, f.normal, k)] as [Vec2, Vec2]) });
    }
  }
  return out;
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
/** 0 → 0 and 1 → 1 exactly, flat at both ends. */
const smooth = (t: number) => {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** How far the walls have risen at build progress b: 0 until 0.15, full height from 0.75. */
export const wallRise = (b: number) => smooth((b - 0.15) / 0.6);

/** The tallest wall, metres (2.7 for an empty plan, the default height). */
const tallest = (plan: Plan) => Math.max(2.7, ...plan.walls.map((w) => w.height));

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
}

/**
 * Where the camera stands at build progress b, for a view of `aspect` (width / height).
 * b = 0: straight down on the sheet box's centre, at the distance where the box just fits (the larger of its two
 * sides relative to the view fills it), so the first 3D frame lines up with the DOM drawing of the same box.
 * b = 1: on a sphere round the plan's centre, tilted END_POLAR from vertical and turned END_AZIMUTH from south,
 * far enough to hold the whole model (its bounding sphere in the narrower of the two fields of view) and never
 * nearer than 1.1 times the start: the camera always pulls back. It aims a little above the model (END_DROP of
 * the view's half-height), so the model sits in the space below the headline. Between, everything eases with one
 * smoothstep.
 */
export function cameraAt(b: number, plan: Plan, aspect: number): CameraPose {
  const box = sheetBox(plan);
  const pb = planBounds(plan);
  const H = tallest(plan);
  const half = Math.tan(rad(FOV / 2));
  const r0 = Math.max(box.h / 2, box.w / 2 / aspect) / half;
  const narrow = Math.min(half, half * aspect); // tan of the narrower half-angle
  const R = Math.hypot(pb.w, pb.h, H) / 2;
  // The sphere fit, grown by END_DROP: the model is moved down the view by that much, so it needs the room.
  const r1 = Math.max(r0 * 1.1, (R / Math.sin(Math.atan(narrow))) * 0.95 * (1 + END_DROP));
  const e = smooth(b);
  const r = lerp(r0, r1, e);
  const polar = lerp(START_POLAR, rad(END_POLAR), e);
  const azimuth = lerp(0, rad(END_AZIMUTH), e);
  // From the target to the camera. Azimuth 0 is due south (+z), so with up = +Y the screen's top is north (-z):
  // the first frame reads exactly like the 2D plan.
  const o = [Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth)];
  // The screen's up direction for that view: (f × Y) × f with f = -o, which is Y minus its part along o, normalised.
  const k = o[1];
  const ul = Math.hypot(-k * o[0], 1 - k * o[1], -k * o[2]) || 1;
  const up = [(-k * o[0]) / ul, (1 - k * o[1]) / ul, (-k * o[2]) / ul];
  const drop = END_DROP * e * r * half; // aiming this far up the screen puts the model this far down it
  const target: [number, number, number] = [
    lerp(box.x + box.w / 2, pb.x + pb.w / 2, e) + up[0] * drop,
    lerp(0, H * 0.3, e) + up[1] * drop,
    lerp(box.y + box.h / 2, pb.y + pb.h / 2, e) + up[2] * drop,
  ];
  return { position: [target[0] + r * o[0], target[1] + r * o[1], target[2] + r * o[2]], target };
}

/**
 * The last frame as an orthographic projection, for the static end-state drawing: `project` takes a world point
 * (x, height, y) to drawing coordinates (metres across the view, y down as in SVG) and `depth` gives its distance
 * along the viewing direction (larger is farther). The camera's up is world +Y, as in the 3D scene.
 */
export function endProjection(): { view: [number, number, number]; project: (x: number, y: number, z: number) => [number, number]; depth: (x: number, y: number, z: number) => number } {
  const [p, a] = [rad(END_POLAR), rad(END_AZIMUTH)];
  const [fx, fy, fz] = [-Math.sin(p) * Math.sin(a), -Math.cos(p), -Math.sin(p) * Math.cos(a)];
  // right = f × up, then the screen's up = right × f (both unit: f is unit and not vertical).
  const rl = Math.hypot(fz, fx);
  const [rx, rz] = [-fz / rl, fx / rl];
  const [ux, uy, uz] = [-rz * fy, rz * fx - rx * fz, rx * fy];
  return {
    view: [fx, fy, fz],
    project: (x, y, z) => [x * rx + z * rz, -(x * ux + y * uy + z * uz)],
    depth: (x, y, z) => x * fx + y * fy + z * fz,
  };
}
