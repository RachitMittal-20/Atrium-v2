/**
 * site.ts — the landing hero's site dressing (step H.2; a villa garden since step H.3): a paved terrace round the house,
 * a path out from the front door to a round drive with a fountain in its middle, clipped hedges along the front of the
 * terrace, cypresses flanking the way in, low shrubs round the terrace and round-headed trees farther out.
 * DECORATION, not plan data: nothing here is in the Plan and nothing reads it back. It is placed from the plan's footprint
 * (planBounds) and its front door (story.ts), so it follows any plan, and it is seeded, so the same plan always gets the
 * same garden (no Math.random, nothing that changes between the server, the test and the browser).
 *
 * Rules, all in plan metres; "along" is distance out from the front door's centre along its outward normal, "across"
 * the distance either side of that line:
 *   - the terrace is the walls' footprint grown by TERRACE on every side;
 *   - the path runs from the door out to PATH_LENGTH, PATH_PAD wider than the door, and meets the drive, a paved ring
 *     (DRIVE inner and outer radii) round a fountain whose centre is PATH_LENGTH + DRIVE.inner out;
 *   - hedges stand just outside the terrace's front edge, from the path's side to the terrace's ends;
 *   - cypresses stand in pairs either side of the path (CYPRESS_AT along it) and at the terrace's four corners;
 *   - shrubs stand in a ring just outside the terrace, never on the path and never on the front where the hedges are;
 *   - round trees stand farther out, never inside the CORRIDOR either side of the line from the door out through the
 *     drive and beyond, so nothing stands between the camera's front view and the house.
 * Connects to: src/lib/landing/{blueprint,story}.ts, src/components/landing/BlueprintCanvas.tsx.
 */
import type { Vec2 } from "@/types/plan";
import type { Box } from "./blueprint";
import type { FrontDoor } from "./story";

export const TERRACE = 0.9;
const PATH_LENGTH = 7;
const PATH_PAD = 0.8;
export const DRIVE = { inner: 2.4, outer: 4.4 };
export const FOUNTAIN = { basin: 1.3, height: 0.5 };
const SHRUB_RING = 0.55; // shrubs' distance outside the terrace's edge
const SHRUB_STEP = 1.25;
const HEDGE = { gap: 0.35, depth: 0.5, height: 0.6 };
const CYPRESS_AT = [1.8, 4.6];
export const CORRIDOR = 2.6;
const TREES = 9;

export interface Shrub {
  x: number;
  z: number;
  /** Radius, metres. */
  r: number;
}
export interface Tree {
  x: number;
  z: number;
  /** Total height, metres. */
  h: number;
  /** A tall narrow cypress, or a round-headed tree on a trunk. */
  kind: "cypress" | "round";
}
export interface Hedge {
  centre: Vec2;
  /** Its length along the terrace's front edge, its depth across it, its height; `dir` is the unit length direction. */
  length: number;
  depth: number;
  height: number;
  dir: Vec2;
}
export interface Site {
  terrace: Box;
  /** The path as a rectangle: its centre, its length along `dir` and its width across it. */
  path: { centre: Vec2; dir: Vec2; length: number; width: number } | null;
  /** The fountain's centre, which is also the drive's. */
  fountain: Vec2 | null;
  hedges: Hedge[];
  shrubs: Shrub[];
  trees: Tree[];
}

/** mulberry32: a small seeded generator, so the garden is the same on every run. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where p is relative to the door's line: `along` from the door outwards, `across` signed (positive to the door's right). */
export function doorCoords(door: FrontDoor, p: Vec2): { along: number; across: number } {
  const [dx, dy] = [p.x - door.centre.x, p.y - door.centre.y];
  return { along: dx * door.outward.x + dy * door.outward.y, across: dx * door.outward.y - dy * door.outward.x };
}
const fromDoor = (door: FrontDoor, along: number, across: number): Vec2 => ({
  x: door.centre.x + door.outward.x * along + door.outward.y * across,
  y: door.centre.y + door.outward.y * along - door.outward.x * across,
});

export function sitePlan(footprint: Box, door: FrontDoor | null): Site {
  const terrace = { x: footprint.x - TERRACE, y: footprint.y - TERRACE, w: footprint.w + 2 * TERRACE, h: footprint.h + 2 * TERRACE };
  const width = door ? door.width + PATH_PAD : 0;
  const path = door ? { centre: fromDoor(door, PATH_LENGTH / 2, 0), dir: door.outward, length: PATH_LENGTH, width } : null;
  const fountain = door ? fromDoor(door, PATH_LENGTH + DRIVE.inner, 0) : null;
  const rand = seeded(Math.round(footprint.w * 1000) * 31 + Math.round(footprint.h * 1000));
  const corners: Vec2[] = [
    { x: terrace.x, y: terrace.y },
    { x: terrace.x + terrace.w, y: terrace.y },
    { x: terrace.x + terrace.w, y: terrace.y + terrace.h },
    { x: terrace.x, y: terrace.y + terrace.h },
  ];

  // The terrace's front edge, in the door's coordinates, and the hedges along it either side of the path.
  const hedges: Hedge[] = [];
  let frontEdge = Infinity;
  if (door) {
    const c = corners.map((p) => doorCoords(door, p));
    frontEdge = Math.max(...c.map((q) => q.along));
    const [lo, hi] = [Math.min(...c.map((q) => q.across)), Math.max(...c.map((q) => q.across))];
    const along = frontEdge + HEDGE.gap + HEDGE.depth / 2;
    const dir = { x: door.outward.y, y: -door.outward.x }; // along the edge, towards +across
    for (const [a, b] of [[width / 2 + 0.4, hi], [lo, -(width / 2 + 0.4)]])
      if (b - a > 0.8) hedges.push({ centre: fromDoor(door, along, (a + b) / 2), length: b - a, depth: HEDGE.depth, height: HEDGE.height, dir });
  }
  const offPath = (p: Vec2, margin: number) => {
    if (!door) return true;
    const { along, across } = doorCoords(door, p);
    return along < 0 || Math.abs(across) > width / 2 + margin;
  };
  const inDrive = (p: Vec2, margin: number) => fountain !== null && Math.hypot(p.x - fountain.x, p.y - fountain.y) < DRIVE.outer + margin;
  const byHedges = (p: Vec2) => door !== null && Math.abs(doorCoords(door, p).along - (frontEdge + HEDGE.gap + HEDGE.depth / 2)) < 0.9;

  // Shrubs: walk the ring round the terrace, one every SHRUB_STEP or so.
  const shrubs: Shrub[] = [];
  const ring = { x: terrace.x - SHRUB_RING, y: terrace.y - SHRUB_RING, w: terrace.w + 2 * SHRUB_RING, h: terrace.h + 2 * SHRUB_RING };
  const perimeter = 2 * (ring.w + ring.h);
  const count = Math.floor(perimeter / SHRUB_STEP);
  for (let i = 0; i < count; i++) {
    let d = ((i + 0.5 + (rand() - 0.5) * 0.4) / count) * perimeter;
    let p: Vec2;
    if (d < ring.w) p = { x: ring.x + d, y: ring.y };
    else if ((d -= ring.w) < ring.h) p = { x: ring.x + ring.w, y: ring.y + d };
    else if ((d -= ring.h) < ring.w) p = { x: ring.x + ring.w - d, y: ring.y + ring.h };
    else p = { x: ring.x, y: ring.y + ring.h - (d - ring.w) };
    const r = 0.32 + rand() * 0.28;
    if (offPath(p, r + 0.15) && !byHedges(p)) shrubs.push({ x: p.x, z: p.y, r });
  }

  // Cypresses: pairs flanking the path, and one off each terrace corner.
  const trees: Tree[] = [];
  if (door) for (const at of CYPRESS_AT) for (const s of [-1, 1]) {
    const p = fromDoor(door, frontEdge + at, s * (width / 2 + 0.9));
    trees.push({ x: p.x, z: p.y, h: 4.4 + rand() * 1.2, kind: "cypress" });
  }
  const cx = footprint.x + footprint.w / 2;
  const cy = footprint.y + footprint.h / 2;
  for (const q of corners) {
    const [dx, dy] = [q.x - cx, q.y - cy];
    const l = Math.hypot(dx, dy);
    const p = { x: q.x + (dx / l) * 1.1, y: q.y + (dy / l) * 1.1 };
    if (offPath(p, 1) && !inDrive(p, 0.5)) trees.push({ x: p.x, z: p.y, h: 4.8 + rand() * 1.4, kind: "cypress" });
  }

  // Round trees: on a wider ring, at even angles with jitter, never in the corridor or on the drive.
  let placed = 0;
  for (let i = 0; i < TREES * 3 && placed < TREES; i++) {
    const angle = ((i % TREES) / TREES + rand() * 0.08) * 2 * Math.PI;
    const reach = Math.hypot(terrace.w, terrace.h) / 2 + 1.6 + rand() * 2.4; // close in: the orbit passes 9 m or more outside them
    const p = { x: cx + Math.cos(angle) * reach, y: cy + Math.sin(angle) * reach };
    if ((!door || offPath(p, CORRIDOR)) && !inDrive(p, 1)) {
      trees.push({ x: p.x, z: p.y, h: 3.8 + rand() * 1.6, kind: "round" });
      placed++;
    }
  }
  return { terrace, path, fountain, hedges, shrubs, trees };
}
