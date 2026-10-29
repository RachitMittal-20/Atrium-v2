/**
 * site.ts — the landing hero's site dressing (step H.2): a paved terrace round the house, a path out from the front
 * door, low shrubs along the terrace and a few trees further out. DECORATION, not plan data: nothing here is in the
 * Plan and nothing reads it back. It is placed from the plan's footprint (planBounds) and its front door (story.ts), so
 * it follows any plan, and it is seeded, so the same plan always gets the same garden (no Math.random, nothing that
 * changes between the server, the test and the browser).
 *
 * Rules, all in plan metres:
 *   - the terrace is the walls' footprint grown by TERRACE on every side;
 *   - the path runs from the door's centre out along its outward normal for PATH_LENGTH, PATH_PAD wider than the door;
 *   - shrubs stand in a ring just outside the terrace, about SHRUB_STEP apart with a little jitter, never on the path;
 *   - trees stand farther out, never inside the corridor the camera walks in along (CORRIDOR either side of the path's
 *     centre line, out to the path's end and beyond), so nothing stands between the camera and the door.
 * Connects to: src/lib/landing/{blueprint,story}.ts, src/components/landing/BlueprintCanvas.tsx.
 */
import type { Vec2 } from "@/types/plan";
import type { Box } from "./blueprint";
import type { FrontDoor } from "./story";

export const TERRACE = 0.9;
const PATH_LENGTH = 7;
const PATH_PAD = 0.8;
const SHRUB_RING = 0.55; // shrubs' distance outside the terrace's edge
const SHRUB_STEP = 1.25;
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
  /** Total height, metres; the canopy is the top two thirds. */
  h: number;
}
export interface Site {
  terrace: Box;
  /** The path as a rectangle: its centre, its length along `dir` and its width across it. */
  path: { centre: Vec2; dir: Vec2; length: number; width: number } | null;
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

/** Where p is relative to the path's centre line: `along` from the door outwards, `across` either side. */
function onPath(door: FrontDoor, p: Vec2): { along: number; across: number } {
  const [dx, dy] = [p.x - door.centre.x, p.y - door.centre.y];
  return { along: dx * door.outward.x + dy * door.outward.y, across: Math.abs(dx * door.outward.y - dy * door.outward.x) };
}

export function sitePlan(footprint: Box, door: FrontDoor | null): Site {
  const terrace = { x: footprint.x - TERRACE, y: footprint.y - TERRACE, w: footprint.w + 2 * TERRACE, h: footprint.h + 2 * TERRACE };
  const width = door ? door.width + PATH_PAD : 0;
  const path = door
    ? { centre: { x: door.centre.x + (door.outward.x * PATH_LENGTH) / 2, y: door.centre.y + (door.outward.y * PATH_LENGTH) / 2 }, dir: door.outward, length: PATH_LENGTH, width }
    : null;
  const clearOfPath = (p: Vec2, margin: number) => {
    if (!door) return true;
    const { along, across } = onPath(door, p);
    return along < 0 || across > width / 2 + margin;
  };
  const rand = seeded(Math.round(footprint.w * 1000) * 31 + Math.round(footprint.h * 1000));

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
    if (clearOfPath(p, r + 0.15)) shrubs.push({ x: p.x, z: p.y, r });
  }

  // Trees: on a wider ring, at even angles with jitter, never in the walk-in corridor.
  const trees: Tree[] = [];
  const cx = footprint.x + footprint.w / 2;
  const cy = footprint.y + footprint.h / 2;
  for (let i = 0; i < TREES * 3 && trees.length < TREES; i++) {
    const angle = ((i % TREES) / TREES + rand() * 0.08) * 2 * Math.PI;
    const reach = Math.hypot(terrace.w, terrace.h) / 2 + 2.5 + rand() * 4;
    const p = { x: cx + Math.cos(angle) * reach, y: cy + Math.sin(angle) * reach };
    if (!door || clearOfPath(p, CORRIDOR)) trees.push({ x: p.x, z: p.y, h: 3.2 + rand() * 1.8 });
  }
  return { terrace, path, shrubs, trees };
}
