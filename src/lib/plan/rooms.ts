/**
 * rooms.ts — derives rooms from the wall graph (pure, no React). Walls are
 * split at T-junctions (CLAUDE.md Conventions), so the walls form a planar
 * graph whose bounded faces are the rooms. Stored names/materials are carried
 * over from the previous plan by overlap matching. Connects to:
 * src/types/plan.ts, geometry.ts; called by planStore on every wall edit.
 *
 * Known limitation: a room with an internal island (a courtyard, a free-standing
 * wall loop inside a room) is not supported — the island becomes its own room
 * and the surrounding room's area still includes it.
 */
import type { Plan, Room, Vec2, Wall } from "@/types/plan";
import { dist, JOINT_EPS, wallLength } from "./geometry";

export const DEFAULT_FLOOR_MATERIAL = "oak-floor";

export interface DerivedRoom extends Room {
  /** Net floor outline: the centreline loop pulled in by half of each wall's thickness. */
  polygon: Vec2[];
  area: number; // m², net floor area
  perimeter: number; // m, of `polygon`
  centroid: Vec2;
}

/** A bounded face of the wall graph, before names are attached. */
interface Face {
  wallIds: string[];
  polygon: Vec2[];
  area: number;
  perimeter: number;
  centroid: Vec2;
}

// ---------------------------------------------------------------- polygon helpers

/** Shoelace area; positive for counter-clockwise loops (in x-right, y-up terms). */
function signedArea(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

function centroidOf(poly: Vec2[]): Vec2 {
  const a = signedArea(poly);
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const k = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * k;
    cy += (p.y + q.y) * k;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/** Ray-casting point-in-polygon. */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------- face tracing

/** Half-edge from joint `from` to joint `to`, lying along wall `wall`. */
interface HalfEdge {
  from: number;
  to: number;
  wall: Wall;
  angle: number;
}

/** Every bounded face of the wall graph. Dangling walls are pruned first. */
function traceFaces(walls: Wall[]): Face[] {
  // 1. Merge endpoints within JOINT_EPS into joints.
  const joints: Vec2[] = [];
  const jointOf = (p: Vec2) => {
    const i = joints.findIndex((j) => dist(j, p) < JOINT_EPS);
    return i >= 0 ? i : joints.push(p) - 1;
  };
  let edges = walls
    .filter((w) => wallLength(w) >= JOINT_EPS)
    .map((w) => ({ wall: w, u: jointOf(w.a), v: jointOf(w.b) }))
    .filter((e) => e.u !== e.v);

  // 2. Prune dangling walls: a joint with one wall can't be on any loop.
  for (let pruned = true; pruned; ) {
    const degree = new Map<number, number>();
    for (const e of edges) for (const j of [e.u, e.v]) degree.set(j, (degree.get(j) ?? 0) + 1);
    const kept = edges.filter((e) => degree.get(e.u)! > 1 && degree.get(e.v)! > 1);
    pruned = kept.length < edges.length;
    edges = kept;
  }

  // 3. Two half-edges per wall; outgoing lists sorted counter-clockwise by angle.
  const out = new Map<number, HalfEdge[]>();
  const add = (from: number, to: number, wall: Wall) => {
    const angle = Math.atan2(joints[to].y - joints[from].y, joints[to].x - joints[from].x);
    const list = out.get(from) ?? [];
    list.push({ from, to, wall, angle });
    out.set(from, list);
  };
  for (const e of edges) {
    add(e.u, e.v, e.wall);
    add(e.v, e.u, e.wall);
  }
  for (const list of out.values()) list.sort((p, q) => p.angle - q.angle);

  // 4. Walk faces: arriving at a joint, leave by the edge just clockwise of the
  //    one we came in on. That keeps the face on our left, so bounded faces run
  //    counter-clockwise (positive area) and the outer face runs clockwise.
  const next = (h: HalfEdge): HalfEdge => {
    const list = out.get(h.to)!;
    const back = list.findIndex((e) => e.to === h.from && e.wall === h.wall);
    return list[(back - 1 + list.length) % list.length];
  };
  const seen = new Set<HalfEdge>();
  const faces: Face[] = [];
  for (const list of out.values()) {
    for (const start of list) {
      if (seen.has(start)) continue;
      const loop: HalfEdge[] = [];
      for (let h = start; !seen.has(h); h = next(h)) {
        seen.add(h);
        loop.push(h);
      }
      const centreline = loop.map((h) => joints[h.from]);
      if (signedArea(centreline) <= 1e-9) continue; // outer face(s) and degenerate slivers
      const polygon = insetLoop(loop, joints);
      faces.push({
        wallIds: loop.map((h) => h.wall.id),
        polygon,
        area: Math.abs(signedArea(polygon)),
        perimeter: polygon.reduce((s, p, i) => s + dist(p, polygon[(i + 1) % polygon.length]), 0),
        centroid: centroidOf(polygon),
      });
    }
  }
  return faces;
}

/** Offset each edge of a counter-clockwise loop inward (to its left) by half its wall's
 *  thickness, and intersect neighbouring offset lines to get the net floor corners. */
function insetLoop(loop: HalfEdge[], joints: Vec2[]): Vec2[] {
  const lines = loop.map((h) => {
    const a = joints[h.from];
    const b = joints[h.to];
    const len = dist(a, b);
    const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const t = h.wall.thickness / 2;
    return { p: { x: a.x - d.y * t, y: a.y + d.x * t }, d }; // left normal is (-dy, dx)
  });
  return lines.map((cur, i) => {
    const prev = lines[(i - 1 + lines.length) % lines.length];
    const cross = prev.d.x * cur.d.y - prev.d.y * cur.d.x;
    if (Math.abs(cross) < 1e-9) return cur.p; // collinear (a wall split at a T): no corner
    const s = ((cur.p.x - prev.p.x) * cur.d.y - (cur.p.y - prev.p.y) * cur.d.x) / cross;
    return { x: prev.p.x + prev.d.x * s, y: prev.p.y + prev.d.y * s };
  });
}

// ---------------------------------------------------------------- naming

/** Short deterministic id from the loop's wall set (FNV-1a), so deriveRooms stays pure. */
function idFor(wallIds: string[]): string {
  let h = 0x811c9dc5;
  for (const c of [...wallIds].sort().join("|")) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return `r-${(h >>> 0).toString(16)}`;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

/**
 * Rooms for `plan`'s walls, keeping names/materials/ids from `previous` (the plan
 * before the edit; defaults to `plan`, whose stored rooms then match by loop).
 * Matching: a new and an old room are candidates when either's centroid lies in
 * the other's polygon, scored by area ratio (smaller / larger); pairs are taken
 * greedily by score, so on a split the larger part keeps the name and on a
 * merge the larger old room's name wins.
 */
export function deriveRooms(plan: Plan, previous: Plan = plan): DerivedRoom[] {
  const faces = traceFaces(plan.walls);

  // Old faces carry stored data when their wall loop matches a stored room exactly.
  const old = traceFaces(previous.walls).flatMap((f) => {
    const stored = previous.rooms.find((r) => sameSet(r.wallIds, f.wallIds));
    return stored ? [{ face: f, stored }] : [];
  });

  // ponytail: centroid test can miss a very concave room whose centroid falls outside it; use polygon clipping if that bites.
  const pairs: { n: number; o: number; score: number }[] = [];
  faces.forEach((f, n) =>
    old.forEach(({ face: g }, o) => {
      if (pointInPolygon(f.centroid, g.polygon) || pointInPolygon(g.centroid, f.polygon)) {
        pairs.push({ n, o, score: Math.min(f.area, g.area) / Math.max(f.area, g.area) });
      }
    }),
  );
  pairs.sort((p, q) => q.score - p.score);
  const match = new Map<number, Room>();
  const usedOld = new Set<number>();
  for (const { n, o } of pairs) {
    if (match.has(n) || usedOld.has(o)) continue;
    match.set(n, old[o].stored);
    usedOld.add(o);
  }

  const takenNames = new Set([...match.values()].map((r) => r.name));
  const takenIds = new Set([...match.values()].map((r) => r.id));
  let k = 1;
  return faces.map((f, n) => {
    const stored = match.get(n);
    let id = stored?.id ?? idFor(f.wallIds);
    while (takenIds.has(id) && !stored) id += "x"; // hash collision with a kept id: nudge
    takenIds.add(id);
    let name = stored?.name;
    if (!name) {
      while (takenNames.has(`Room ${k}`)) k++;
      name = `Room ${k}`;
      takenNames.add(name);
    }
    return { ...f, id, name, floorMaterial: stored?.floorMaterial ?? DEFAULT_FLOOR_MATERIAL };
  });
}

/** Just the stored fields of a room, for writing into `plan.rooms`. */
export const toStoredRoom = ({ id, name, wallIds, floorMaterial }: Room): Room => ({ id, name, wallIds, floorMaterial });
