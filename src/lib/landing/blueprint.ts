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
/** The sheet fills at most this share of the view, so its edges never touch the viewport's (step L.2). The DOM sheet is scaled by the same number. */
export const SHEET_FIT = 0.96;
/** The headline's band is kept clear of the model fully from this build progress on (the walls are still flat before it). */
const CLEAR_BY = 0.25;
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

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

interface FitPoint {
  p: V3;
  /** The share of the view's height kept clear at the top for this point (the headline's band); 0 for the sheet. */
  top: number;
}

/**
 * The camera's distance and sideways shift that put every point inside the view, for a camera looking at `centre`
 * from direction `o` (unit, from the centre to the camera) with screen axes `right` and `up`. A point p, measured from
 * the centre, has screen coordinates x = p·right, y = p·up and depth d − p·o; it is inside when |x − sx| ≤ h·depth
 * and −v·depth ≤ y − sy ≤ v·(1 − 2·top)·depth (v = SHEET_FIT · tan(fov/2), h = v · aspect), where (sx, sy) is how far
 * the camera and its aim slide across the view. For a given distance those are intervals for sx and sy, which only
 * widen as the distance grows, so a bisection finds the nearest distance with a non-empty pair, and the shift is
 * the middle of each interval (the content is centred in what is left of the view).
 */
function fitView(points: FitPoint[], centre: V3, o: V3, right: V3, up: V3, aspect: number): { d: number; shift: [number, number]; at: (d: number) => [number, number] } {
  const v = Math.tan(rad(FOV / 2)) * SHEET_FIT;
  const h = v * aspect;
  const q = points.map(({ p, top }) => {
    const r: V3 = [p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]];
    return { x: dot(r, right), y: dot(r, up), po: dot(r, o), hi: v * (1 - 2 * top) };
  });
  const range = (d: number): [number, number, number, number] | null => {
    let [xl, xh, yl, yh] = [-Infinity, Infinity, -Infinity, Infinity];
    for (const t of q) {
      const depth = d - t.po;
      if (depth <= 0) return null;
      xl = Math.max(xl, t.x - h * depth);
      xh = Math.min(xh, t.x + h * depth);
      yl = Math.max(yl, t.y - t.hi * depth);
      yh = Math.min(yh, t.y + v * depth);
    }
    return xl <= xh && yl <= yh ? [xl, xh, yl, yh] : null;
  };
  const at = (d: number): [number, number] => {
    const r = range(d) ?? [0, 0, 0, 0];
    return [(r[0] + r[1]) / 2, (r[2] + r[3]) / 2];
  };
  let lo = Math.max(...q.map((t) => t.po)) + 1e-6;
  let hi = Math.max(lo * 2, 1000);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (range(mid)) hi = mid;
    else lo = mid;
  }
  return { d: hi, shift: at(hi), at };
}

/**
 * Where the camera stands at build progress b, for a view of `aspect` (width / height), with the top `reserve`
 * (0 to 0.5) of the view kept clear of the model for the headline (the page measures it; 0 by default).
 *
 * The direction is eased with one smoothstep from straight down (b = 0) to END_POLAR tilted and END_AZIMUTH turned
 * from south (b = 1). At every b the camera stands at the nearest distance, and aims at the sideways shift, where
 *   - the four corners of the whole sheet are inside the view (within SHEET_FIT of it), and
 *   - the model's box, at the height the walls have risen to, is inside it and, as the build passes CLEAR_BY, below
 *     the headline's band,
 * found exactly by fitView (not an interpolation, so no frame between the ends can crop). b = 0 is straight down on the
 * sheet's centre, its larger relative side filling SHEET_FIT of the view, which is what the DOM drawing shows; and the
 * camera never comes nearer than the start (it ends at least 1.1 times as far).
 */
export function cameraAt(b: number, plan: Plan, aspect: number, reserve = 0): CameraPose {
  const box = sheetBox(plan);
  const pb = planBounds(plan);
  const H = tallest(plan);
  const e = smooth(b);
  const polar = lerp(START_POLAR, rad(END_POLAR), e);
  const azimuth = lerp(0, rad(END_AZIMUTH), e);
  // From the target to the camera. Azimuth 0 is due south (+z), so with up = +Y the screen's top is north (-z):
  // the first frame reads exactly like the 2D plan.
  const o: V3 = [Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth)];
  // The screen's up direction for that view: (f × Y) × f with f = -o, which is Y minus its part along o, normalised.
  const k = o[1];
  const ul = Math.hypot(-k * o[0], 1 - k * o[1], -k * o[2]) || 1;
  const up: V3 = [(-k * o[0]) / ul, (1 - k * o[1]) / ul, (-k * o[2]) / ul];
  const right: V3 = [up[1] * o[2] - up[2] * o[1], up[2] * o[0] - up[0] * o[2], up[0] * o[1] - up[1] * o[0]]; // up × o
  const centre: V3 = [box.x + box.w / 2, 0, box.y + box.h / 2];

  const sheetPts: FitPoint[] = [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]].map(([x, z]) => ({ p: [x, 0, z] as V3, top: 0 }));
  const clear = Math.min(0.5, Math.max(0, reserve)) * smooth(b / CLEAR_BY);
  const top = wallRise(b) * H;
  const modelPts: FitPoint[] = [pb.x, pb.x + pb.w].flatMap((x) => [pb.y, pb.y + pb.h].flatMap((z) => [0, top].map((y) => ({ p: [x, y, z] as V3, top: clear }))));
  const fit = fitView([...sheetPts, ...modelPts], centre, o, right, up, aspect);
  // Never nearer than the start: the distance that fits the sheet alone, looking straight down.
  const start = fitView(sheetPts, centre, [0, 1, 0], [1, 0, 0], [0, 0, -1], aspect).d;
  const d = Math.max(fit.d, start * lerp(1, 1.1, e));
  const [sx, sy] = fit.at(d);
  const target: V3 = [centre[0] + right[0] * sx + up[0] * sy, centre[1] + right[1] * sx + up[1] * sy, centre[2] + right[2] * sx + up[2] * sy];
  return { position: [target[0] + d * o[0], target[1] + d * o[1], target[2] + d * o[2]], target };
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
