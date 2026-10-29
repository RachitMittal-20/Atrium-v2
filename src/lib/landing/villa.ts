/**
 * villa.ts — the pure geometry that finishes the landing hero's house as a small villa (step H.3, after a photograph
 * of a villa the owner wanted the house to look like): a hip roof with its fascia over the walls, black frames, glazing
 * bars and warm glass in every window, a closed double front door with glass, a porch slab in front of it and a lamp
 * either side. No React and no three.js: plain arrays of triangles and boxes, which the lazy canvas turns into meshes
 * and the Node test checks.
 *
 * What comes from the Plan and what does not:
 *   - every frame, pane, the door, the porch and the lamps are placed on the plan's own openings with openingFrame
 *     (centre, direction, normal), sized by the opening's width, height and sill and its wall's thickness;
 *   - the roof covers the walls' footprint (planBounds) grown by OVERHANG, with its ridge along the longer side and
 *     PITCH degrees of slope, so a plan's size and proportions decide it. A plan has no roof, so its form is a CHOICE
 *     made here, not data: a non-rectangular plan still gets one rectangular hip roof over its bounding box.
 * World = (plan x, height, plan y), as in PlanModel.
 * Connects to: src/lib/landing/{blueprint,story}.ts, src/lib/plan2d/openings.ts, src/components/landing/BlueprintCanvas.tsx.
 */
import { openingFrame } from "@/lib/plan2d/openings";
import type { Opening, Plan, Vec2, Wall } from "@/types/plan";
import { planBounds, type Box } from "./blueprint";

/** The roof's slope, degrees, and how far its eaves reach past the walls' outer faces, metres. */
export const PITCH = 26;
export const OVERHANG = 0.45;
/** The fascia: the band round the eaves, metres deep. */
const FASCIA = 0.2;

export type V3 = [number, number, number];

/** An axis-aligned box turned about the vertical by `rotY` (three's rotation.y): centre, size (x along the turned +x). */
export interface Piece {
  centre: V3;
  size: V3;
  rotY: number;
}
/** A flat rectangle standing upright, facing ±(its turned +z): the glass of a window or a door. */
export interface Pane {
  centre: V3;
  w: number;
  h: number;
  rotY: number;
}

export interface Roof {
  /** Triangles, three corners each, nine numbers per triangle: the four slopes, the soffit and the fascia. */
  positions: number[];
  /** The ridge's height above the walls' tops, metres. */
  rise: number;
  /** The eaves' rectangle (plan metres). */
  eaves: Box;
}

const tallest = (plan: Plan) => Math.max(2.7, ...plan.walls.map((w) => w.height));
const tan = (deg: number) => Math.tan((deg * Math.PI) / 180);

/** How high the ridge stands above the walls for a footprint: half the shorter side of the eaves, at PITCH. */
export function roofRise(footprint: Box): number {
  return (Math.min(footprint.w, footprint.h) / 2 + OVERHANG) * tan(PITCH);
}

/** The house's highest point, metres: the tallest wall plus the roof's rise. */
export function houseTop(plan: Plan): number {
  return tallest(plan) + roofRise(planBounds(plan));
}

/**
 * A hip roof over the plan: eaves at the tallest wall's top, a ridge along the longer side, four slopes (two trapezoids
 * and two triangles), the flat soffit under the overhang, and the fascia band hanging from the eaves' edge.
 */
export function hipRoof(plan: Plan): Roof {
  const pb = planBounds(plan);
  const top = tallest(plan);
  const e = { x: pb.x - OVERHANG, y: pb.y - OVERHANG, w: pb.w + 2 * OVERHANG, h: pb.h + 2 * OVERHANG };
  const s = Math.min(e.w, e.h) / 2;
  const rise = s * tan(PITCH);
  const [x0, x1, z0, z1, y] = [e.x, e.x + e.w, e.y, e.y + e.h, top];
  const r = y + rise;
  const out: number[] = [];
  const tri = (a: V3, b: V3, c: V3) => out.push(...a, ...b, ...c);
  const quad = (a: V3, b: V3, c: V3, d: V3) => (tri(a, b, c), tri(a, c, d));
  if (e.w >= e.h) {
    // The ridge runs east-west.
    const [ra, rb]: V3[] = [[x0 + s, r, z0 + s], [x1 - s, r, z0 + s]];
    quad([x0, y, z1], [x1, y, z1], rb, ra); // south slope
    quad([x1, y, z0], [x0, y, z0], ra, rb); // north slope
    tri([x0, y, z0], [x0, y, z1], ra); // west hip
    tri([x1, y, z1], [x1, y, z0], rb); // east hip
  } else {
    const [ra, rb]: V3[] = [[x0 + s, r, z0 + s], [x0 + s, r, z1 - s]];
    quad([x1, y, z1], [x1, y, z0], ra, rb); // east slope
    quad([x0, y, z0], [x0, y, z1], rb, ra); // west slope
    tri([x1, y, z0], [x0, y, z0], ra); // north hip
    tri([x0, y, z1], [x1, y, z1], rb); // south hip
  }
  quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]); // the soffit (and the ceiling seen from the eaves)
  const f = y - FASCIA;
  quad([x0, f, z1], [x1, f, z1], [x1, y, z1], [x0, y, z1]);
  quad([x1, f, z0], [x0, f, z0], [x0, y, z0], [x1, y, z0]);
  quad([x0, f, z0], [x0, f, z1], [x0, y, z1], [x0, y, z0]);
  quad([x1, f, z1], [x1, f, z0], [x1, y, z0], [x1, y, z1]);
  return { positions: out, rise, eaves: e };
}

/** Where an opening is, in its wall's own frame: `at(a, b, y)` is the world point `a` along the wall from the opening's
 *  centre, `b` along the wall's left normal and `y` up; `rotY` turns a piece's +x along the wall and its +z to the normal. */
function frameOf(wall: Wall, o: Opening) {
  const f = openingFrame(wall, o);
  const at = (a: number, b: number, y: number): V3 => [f.centre.x + f.dir.x * a + f.normal.x * b, y, f.centre.y + f.dir.y * a + f.normal.y * b];
  return { f, at, rotY: Math.atan2(-f.dir.y, f.dir.x) };
}

/** Bar sizes, metres: the frame's members, the glazing bars, and how far the frame stands proud of each wall face. */
const BAR = 0.07;
const GLAZING = 0.04;
const PROUD = 0.03;

export interface Dressing {
  /** Dark pieces: window and door frames, glazing bars, the door's leaves. */
  frames: Piece[];
  /** Warm glass: one pane per window, and the door's glass on both faces of each leaf. */
  panes: Pane[];
  /** Pale stone: the window sills and the porch slab. */
  stone: Piece[];
  /** The lamps either side of the front door (their bodies glow). */
  lamps: Piece[];
}

/** Frames, bars and glass for every window; a closed double door, a porch and two lamps for the front door (if any). */
export function dressing(plan: Plan, front: { id: string; outward: Vec2 } | null): Dressing {
  const out: Dressing = { frames: [], panes: [], stone: [], lamps: [] };
  for (const o of plan.openings) {
    const wall = plan.walls.find((w) => w.id === o.wallId);
    if (!wall) continue;
    const { f, at, rotY } = frameOf(wall, o);
    const depth = wall.thickness + 2 * PROUD;
    const [w, h, sill] = [o.width, o.height, o.sillHeight];
    if (o.kind === "window") {
      for (const a of [-(w / 2 - BAR / 2), w / 2 - BAR / 2]) out.frames.push({ centre: at(a, 0, sill + h / 2), size: [BAR, h, depth], rotY });
      out.frames.push({ centre: at(0, 0, sill + h - BAR / 2), size: [w, BAR, depth], rotY });
      out.frames.push({ centre: at(0, 0, sill + BAR / 2), size: [w, BAR, depth], rotY });
      out.frames.push({ centre: at(0, 0, sill + h / 2), size: [GLAZING, h - 2 * BAR, GLAZING], rotY }); // the mullion
      out.frames.push({ centre: at(0, 0, sill + h * 0.64), size: [w - 2 * BAR, GLAZING, GLAZING], rotY }); // the transom
      out.stone.push({ centre: at(0, 0, sill - 0.03), size: [w + 0.18, 0.06, depth + 0.1], rotY });
      out.panes.push({ centre: at(0, 0, sill + h / 2), w: w - 2 * BAR, h: h - 2 * BAR, rotY });
      continue;
    }
    if (!front || o.id !== front.id) continue; // inner doors are under the roof, out of sight
    // Which way is out, on this wall's normal: +1 when the door's outward is the wall's left normal.
    const side = Math.sign(front.outward.x * f.normal.x + front.outward.y * f.normal.y) || 1;
    for (const a of [-(w / 2 - BAR / 2), w / 2 - BAR / 2]) out.frames.push({ centre: at(a, 0, h / 2), size: [BAR, h, depth], rotY });
    out.frames.push({ centre: at(0, 0, h - BAR / 2), size: [w, BAR, depth], rotY });
    const leafW = (w - 2 * BAR) / 2;
    for (const a of [-leafW / 2, leafW / 2]) {
      out.frames.push({ centre: at(a, 0, (h - BAR) / 2), size: [leafW - 0.01, h - BAR, 0.06], rotY });
      for (const b of [-0.032, 0.032]) out.panes.push({ centre: at(a, b, h * 0.56), w: leafW - 0.22, h: h * 0.52, rotY });
    }
    const t = wall.thickness / 2;
    out.stone.push({ centre: at(0, side * (t + 0.7), 0.06), size: [w + 1.4, 0.12, 1.4], rotY });
    const lampY = Math.min(h + 0.1, tallest(plan) - 0.4);
    for (const a of [-(w / 2 + 0.38), w / 2 + 0.38]) out.lamps.push({ centre: at(a, side * (t + 0.09), lampY), size: [0.16, 0.3, 0.16], rotY });
  }
  return out;
}

/** Triangles and their outward normals for a list of pieces, eighteen numbers (two triangles) per face, six faces each. */
export function piecesTriangles(pieces: Piece[]): { positions: number[]; normals: number[] } {
  const positions: number[] = [];
  const normals: number[] = [];
  for (const { centre: [cx, cy, cz], size: [sx, sy, sz], rotY } of pieces) {
    const [c, s] = [Math.cos(rotY), Math.sin(rotY)];
    // three's rotation.y: local +x → (cos, 0, −sin), local +z → (sin, 0, cos).
    const world = (x: number, y: number, z: number): V3 => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
    const dirOf = (x: number, y: number, z: number): V3 => [x * c + z * s, y, -x * s + z * c];
    const [hx, hy, hz] = [sx / 2, sy / 2, sz / 2];
    const faces: [V3, V3[]][] = [
      [[1, 0, 0], [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]]],
      [[-1, 0, 0], [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]]],
      [[0, 1, 0], [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]]],
      [[0, -1, 0], [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]]],
      [[0, 0, 1], [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]]],
      [[0, 0, -1], [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]]],
    ];
    for (const [n, q] of faces) {
      const v = q.map(([x, y, z]) => world(x, y, z));
      for (const i of [0, 1, 2, 0, 2, 3]) positions.push(...v[i]);
      const d = dirOf(n[0], n[1], n[2]);
      for (let i = 0; i < 6; i++) normals.push(...d);
    }
  }
  return { positions, normals };
}
