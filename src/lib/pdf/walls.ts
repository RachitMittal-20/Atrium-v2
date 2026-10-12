/**
 * src/lib/pdf/walls.ts
 *
 * Walls read EXACTLY from a vector PDF page's own lines by pairing wall faces
 * (step M.1b). Pure. Input: a VectorPage (points, y down) and the PDF's scale in
 * metres per point; every coordinate is turned into PAGE METRES (x = pt × mPerPt,
 * y likewise) and the walls come out as the Plan's Wall type in page metres,
 * unrounded. src/lib/pdf/snap.ts moves them to the plan's origin, rounds them to
 * 0.1 mm and merges them with the traced walls.
 *
 *  1. Faces. Every straight, axis-aligned (within 0.5°) segment at least 0.3 m
 *     long, stroked or the edge of a filled path, is a face candidate. Not faces:
 *     pieces of curves, and door leaves (a straight segment up to 1.5 m long with
 *     an end on an end of a curve, the swing arc). Collinear faces that overlap or
 *     touch (within 1 mm) are joined, so a line drawn in pieces or twice is one face.
 *  2. Filled rectangles. A filled path that is exactly an axis-aligned rectangle
 *     whose short side is a wall thickness (0.05–0.60 m) gives its two long edges
 *     as the pair directly; its edges are not used again.
 *  3. Pairing. Two parallel faces 0.05–0.60 m apart that overlap along their
 *     length by at least 60% of the shorter one form a piece: centre line midway,
 *     thickness the gap, span the overlap. Pieces under 0.4 m are dropped. A piece
 *     lying inside a wider piece's band (a window's glass line paired with its
 *     frame line, an inner hatch line) is dropped: the widest wins. Filled
 *     rectangles come first.
 *  4. Merging and openings. Pieces on one line with the same thickness (centre and
 *     thickness within 1 mm) that overlap or are under 0.45 m apart (a face broken
 *     where another wall meets it) merge. Pieces on one line 0.45–4 m apart with
 *     no other piece crossing the gap are bridged into one wall with a DOOR in
 *     the gap (toPlan.ts's 4 m limit). A face inside a wall's band, away from
 *     both faces, 0.45–4 m long and within the wall's span, is a window's glass
 *     line: a WINDOW over its span. (M.1b used 0.3 m; M.1c's openings start at 0.45.)
 *  5. Clutter. A piece with no other piece within 0.3 m of either end AND shorter
 *     than 1.5 m is dropped (furniture, text boxes, a stray pair of lines); the
 *     dropped pieces are returned (`clutter`) so a traced wall on one is dropped too.
 *  6. Diagonal and curved walls are not read, only counted: diagonal faces pair by
 *     the same rules (and the same clutter and inside-a-wall drops, so hatching is
 *     not counted); two curved polylines 0.05–0.60 m apart all along are a curved wall.
 *  7. Joints. A wall end within 0.15 m of another, non-parallel wall's footprint
 *     (its band, extended by half its thickness at the ends) moves to the
 *     crossing of the two centre lines: that is how a pair's overlap is extended
 *     to the wall's real end (an outer corner, or the centre of the wall a stem
 *     meets). Then every joint becomes an end of every wall touching it: a wall
 *     with another's end on its middle is split there (the T-junction rule, as
 *     toPlan.ts), and two walls crossing are both split. An opening goes with the
 *     piece holding its centre; one a split would cut is dropped and counted.
 *
 * Step M.1c (openings.ts): arcs are found first (Bézier pieces and polyline arcs
 * alike) and their pieces and leaves are never faces, so a polyline door's leaf
 * can't pair as a wall. Openings are 0.45–4 m: pieces on one line closer than
 * 0.45 m merge as solid wall. A thinner pair lying wholly inside a door gap's
 * band (two glazing lines in a real gap) neither blocks the bridge nor stays a
 * wall. Every opening span is then classified by openings.classifyOpening (door
 * from a swing arc at a jamb, double door, sliding door, window from glazing lines,
 * or "unclassified", kept as a door), with its swing side read from the arc; the
 * arcs no opening used are reported with why (`arcs`).
 *
 * Output ids are "v1", "v2", ... ; a is the end with the smaller x (horizontal
 * walls) or y (vertical ones). Doors without an arc get LEGACY_SWING, as
 * buildPlan's do. Connects to: extract.ts (VectorPage, `path` and `curve` on
 * segments), openings.ts, snap.ts, analysePdf.ts; tested by
 * scripts/test-pdf-walls.ts and scripts/test-pdf-openings.ts.
 */
import { WALL_HEIGHT } from "@/data/samplePlan";
import type { OpeningKind, Vec2, Wall } from "@/types/plan";
import type { PdfSegment, VectorOpening, VectorPage, VectorWalls } from "@/types/pdf";
import { classifyOpening, findArcs, OPENING_WIDTH, unusedWhy, type Span as OpeningSpan } from "./openings";

export const WALL_RULES = {
  minFace: 0.3,
  gap: [0.05, 0.6] as const,
  overlap: 0.6,
  minPiece: 0.4,
  jointReach: 0.3,
  clutterLength: 1.5,
  meet: 0.15,
  opening: OPENING_WIDTH,
  maxLeaf: 1.5,
};
/** Two lines, ends or thicknesses this close (m) are the same. */
const SAME = 0.001;
/** Float slack on the rule limits, so a 0.05 m gap read back from points still counts. */
const EPS = 1e-6;
const AXIS_SIN = Math.sin((0.5 * Math.PI) / 180);

type Axis = "h" | "v";
/** A line along an axis: `c` its offset across (y for "h", x for "v"), [s0, s1] its span along. */
interface Face {
  axis: Axis;
  c: number;
  s0: number;
  s1: number;
}
interface Span {
  kind: OpeningKind;
  s0: number;
  s1: number;
}
interface Piece extends Face {
  t: number;
  openings: Span[];
  rect?: boolean;
}

// ---------------------------------------------------------------- small helpers

type Seg = { x1: number; y1: number; x2: number; y2: number };
const len = (s: Seg) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
function axisOf(s: Seg): Axis | null {
  const l = len(s);
  if (Math.abs(s.y2 - s.y1) <= l * AXIS_SIN) return "h";
  if (Math.abs(s.x2 - s.x1) <= l * AXIS_SIN) return "v";
  return null;
}
const faceOf = (s: Seg, axis: Axis): Face =>
  axis === "h"
    ? { axis, c: (s.y1 + s.y2) / 2, s0: Math.min(s.x1, s.x2), s1: Math.max(s.x1, s.x2) }
    : { axis, c: (s.x1 + s.x2) / 2, s0: Math.min(s.y1, s.y2), s1: Math.max(s.y1, s.y2) };
/** A point on an axis line: `s` along, `c` across. */
const at = (axis: Axis, s: number, c: number): Vec2 => (axis === "h" ? { x: s, y: c } : { x: c, y: s });
const along = (axis: Axis, p: Vec2) => (axis === "h" ? p.x : p.y);
const across = (axis: Axis, p: Vec2) => (axis === "h" ? p.y : p.x);
const flen = (f: { s0: number; s1: number }) => f.s1 - f.s0;
const overlapOf = (f: { s0: number; s1: number }, g: { s0: number; s1: number }) => Math.min(f.s1, g.s1) - Math.max(f.s0, g.s0);

/** Distance from p to a piece's footprint: its band, extended by half its thickness at the ends. */
function toFootprint(p: Vec2, w: Piece): number {
  const s = along(w.axis, p);
  const c = across(w.axis, p);
  const ds = Math.max(w.s0 - w.t / 2 - s, 0, s - w.s1 - w.t / 2);
  const dc = Math.max(Math.abs(c - w.c) - w.t / 2, 0);
  return Math.hypot(ds, dc);
}

/** Joins collinear faces (same axis, offsets within SAME) that overlap or touch. */
function joinFaces(faces: Face[]): Face[] {
  const out: Face[] = [];
  for (const axis of ["h", "v"] as const) {
    const fs = faces.filter((f) => f.axis === axis).sort((p, q) => p.c - q.c);
    // Cluster by offset (a chain of offsets each within SAME of the previous), then join spans.
    for (let i = 0; i < fs.length; ) {
      let j = i + 1;
      while (j < fs.length && fs[j].c - fs[j - 1].c <= SAME) j++;
      const group = fs.slice(i, j).sort((p, q) => p.s0 - q.s0);
      const c = group.reduce((s, f) => s + f.c * flen(f), 0) / Math.max(EPS, group.reduce((s, f) => s + flen(f), 0));
      let cur: Face | null = null;
      for (const f of group) {
        if (cur && f.s0 <= cur.s1 + SAME) cur.s1 = Math.max(cur.s1, f.s1);
        else out.push((cur = { axis, c, s0: f.s0, s1: f.s1 }));
      }
      i = j;
    }
  }
  return out;
}

/** Candidate pieces from parallel faces (rule 3), before the widest-wins selection. */
function pairFaces(faces: Face[]): Piece[] {
  const out: Piece[] = [];
  const [gMin, gMax] = WALL_RULES.gap;
  for (const axis of ["h", "v"] as const) {
    const fs = faces.filter((f) => f.axis === axis).sort((p, q) => p.c - q.c);
    for (let i = 0; i < fs.length; i++)
      for (let j = i + 1; j < fs.length && fs[j].c - fs[i].c <= gMax + EPS; j++) {
        const [f, g] = [fs[i], fs[j]];
        const gap = g.c - f.c;
        if (gap < gMin - EPS) continue;
        const ov = overlapOf(f, g);
        if (ov <= 0 || ov < WALL_RULES.overlap * Math.min(flen(f), flen(g)) - EPS) continue;
        out.push({ axis, c: (f.c + g.c) / 2, t: gap, s0: Math.max(f.s0, g.s0), s1: Math.min(f.s1, g.s1), openings: [] });
      }
  }
  return out;
}

/** True when `p` lies inside `q`'s band (within SAME) along at least half its own length. */
const inside = (p: Piece, q: Piece) =>
  p.axis === q.axis && p.c - p.t / 2 >= q.c - q.t / 2 - SAME && p.c + p.t / 2 <= q.c + q.t / 2 + SAME && overlapOf(p, q) >= 0.5 * flen(p);

/** Rule 3's selection: rectangles first, then widest first; drops short and inside pieces. */
function selectPieces(candidates: Piece[], dropped: VectorWalls["dropped"]): Piece[] {
  const kept: Piece[] = [];
  const order = [...candidates].sort((p, q) => Number(Boolean(q.rect)) - Number(Boolean(p.rect)) || q.t - p.t || flen(q) - flen(p));
  for (const p of order) {
    if (flen(p) < WALL_RULES.minPiece - EPS) dropped.short++;
    else if (kept.some((q) => inside(p, q))) dropped.inside++;
    else kept.push(p);
  }
  return kept;
}

/** Rule 4: merge pieces on one line, then bridge door gaps where nothing crosses. */
function mergeLines(pieces: Piece[]): Piece[] {
  const sameLine = (p: Piece, q: Piece) => p.axis === q.axis && Math.abs(p.c - q.c) <= SAME && Math.abs(p.t - q.t) <= SAME;
  const groups: Piece[][] = [];
  for (const p of pieces) {
    const g = groups.find((g) => sameLine(g[0], p));
    if (g) g.push(p);
    else groups.push([p]);
  }
  const merged: Piece[] = [];
  for (const g of groups) {
    g.sort((p, q) => p.s0 - q.s0);
    let cur: Piece | null = null;
    for (const p of g) {
      if (cur && p.s0 < cur.s1 + WALL_RULES.opening[0] - EPS) {
        cur.s1 = Math.max(cur.s1, p.s1);
        cur.openings.push(...p.openings);
      } else merged.push((cur = { ...p, openings: [...p.openings] }));
    }
  }
  // Doors: consecutive pieces on one line 0.45–4 m apart, with no other piece crossing the gap. A
  // thinner pair wholly inside the gap and inside the walls' band is two glazing lines (a window in a
  // real gap, step M.1c): it doesn't block the bridge, and it is no wall (openings.ts reads its lines).
  const glazing = (w: Piece, gap: Face, host: Piece) =>
    w.axis === gap.axis && w.t < host.t - SAME && Math.abs(w.c - host.c) + w.t / 2 <= host.t / 2 + SAME && w.s0 >= gap.s0 - SAME && w.s1 <= gap.s1 + SAME;
  const absorbed = new Set<Piece>();
  const crosses = (gap: Face, skip: Piece[]) =>
    merged.some((w) => {
      if (skip.includes(w) || glazing(w, gap, skip[0])) return false;
      if (w.axis === gap.axis) return Math.abs(w.c - gap.c) < w.t / 2 && overlapOf(w, gap) > SAME;
      const s = w.c; // a perpendicular piece crosses the gap's line at s = its offset
      return s > gap.s0 + SAME && s < gap.s1 - SAME && gap.c >= w.s0 - w.t / 2 && gap.c <= w.s1 + w.t / 2;
    });
  const out: Piece[] = [];
  for (const g of groups.map((g) => merged.filter((p) => sameLine(g[0], p)))) {
    let cur: Piece | null = null;
    for (const p of g.sort((p, q) => p.s0 - q.s0)) {
      if (out.includes(p)) continue; // groups can repeat a line found twice
      const gap = cur ? p.s0 - cur.s1 : -1;
      const door = cur && { axis: cur.axis, c: cur.c, s0: cur.s1, s1: p.s0 };
      if (cur && door && gap >= WALL_RULES.opening[0] - EPS && gap <= WALL_RULES.opening[1] + EPS && !crosses(door, [cur, p])) {
        for (const w of merged) if (glazing(w, door, cur)) absorbed.add(w);
        cur.openings.push({ kind: "door", s0: cur.s1, s1: p.s0 }, ...p.openings);
        cur.s1 = p.s1;
      } else out.push((cur = p));
    }
  }
  return out.filter((p) => !absorbed.has(p));
}

/** Rule 4's windows: glass lines inside a wall's band. */
function findWindows(walls: Piece[], faces: Face[]) {
  for (const w of walls) {
    const margin = Math.max(SAME, 0.1 * w.t);
    const glass = faces
      .filter((f) => f.axis === w.axis && Math.abs(f.c - w.c) < w.t / 2 - margin && f.s0 >= w.s0 - SAME && f.s1 <= w.s1 + SAME)
      .filter((f) => flen(f) >= WALL_RULES.opening[0] - EPS && flen(f) <= WALL_RULES.opening[1] + EPS)
      .sort((p, q) => p.s0 - q.s0);
    for (const f of glass) {
      if (w.openings.some((o) => overlapOf(o, f) > SAME)) {
        const same = w.openings.find((o) => o.kind === "window" && overlapOf(o, f) > SAME);
        if (same) [same.s0, same.s1] = [Math.min(same.s0, f.s0), Math.max(same.s1, f.s1)]; // two glass lines, one window
        continue;
      }
      w.openings.push({ kind: "window", s0: f.s0, s1: f.s1 });
    }
  }
}

/** Rule 7: ends to centre-line crossings, then split at every joint. */
function joinWalls(walls: Piece[], dropped: VectorWalls["dropped"]): Piece[] {
  // Move ends: each end of A that meets a non-parallel B goes to their crossing (the nearest such crossing).
  const ends = walls.map((a) =>
    ([a.s0, a.s1] as const).map((s) => {
      const e = at(a.axis, s, a.c);
      let best: number | null = null;
      for (const b of walls) {
        if (b.axis === a.axis || toFootprint(e, b) > WALL_RULES.meet + EPS) continue;
        if (best === null || Math.abs(b.c - s) < Math.abs(best - s)) best = b.c; // the crossing is at s = b.c along a
      }
      return best ?? s;
    }),
  );
  walls.forEach((w, i) => {
    [w.s0, w.s1] = [Math.min(...ends[i]), Math.max(...ends[i])];
  });
  // Every joint is an end of each wall touching it: T-junctions and crossings split.
  const out: Piece[] = [];
  for (const w of walls) {
    const cuts = new Set<number>();
    for (const o of walls) {
      if (o === w) continue;
      if (o.axis === w.axis) {
        // A collinear neighbour's end on this wall's middle (different thickness, end to end).
        for (const s of [o.s0, o.s1]) if (Math.abs(o.c - w.c) <= SAME && s > w.s0 + SAME && s < w.s1 - SAME) cuts.add(s);
        continue;
      }
      // o's line crosses w's line at s = o.c; it is a joint if o reaches w's line (its end on it, or passing through).
      if (o.c > w.s0 + SAME && o.c < w.s1 - SAME && w.c >= o.s0 - SAME && w.c <= o.s1 + SAME) cuts.add(o.c);
    }
    const stops = [w.s0, ...[...cuts].sort((p, q) => p - q), w.s1];
    for (let i = 1; i < stops.length; i++) {
      const piece: Piece = { ...w, s0: stops[i - 1], s1: stops[i], openings: [] };
      out.push(piece);
    }
    for (const o of w.openings) {
      const host = out.find((p) => p.axis === w.axis && p.c === w.c && o.s0 >= p.s0 - SAME && o.s1 <= p.s1 + SAME);
      if (host) host.openings.push(o);
      else dropped.openingsCut++;
    }
  }
  return out;
}

// ---------------------------------------------------------------- diagonal and curved walls (counted only)

/** Diagonal wall pairs, after the same drops as straight ones (rules 3, 5 and inside an axis wall). */
function countDiagonal(segs: Seg[], axisWalls: Piece[]): number {
  type D = { th: number; u: Vec2; n: Vec2; c: number; s0: number; s1: number };
  const ds: D[] = segs.map((s) => {
    let th = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
    if (th < 0) th += Math.PI;
    if (th >= Math.PI) th -= Math.PI;
    const u = { x: Math.cos(th), y: Math.sin(th) };
    const n = { x: -u.y, y: u.x };
    const p0 = s.x1 * u.x + s.y1 * u.y;
    const p1 = s.x2 * u.x + s.y2 * u.y;
    return { th, u, n, c: (s.x1 * n.x + s.y1 * n.y + s.x2 * n.x + s.y2 * n.y) / 2, s0: Math.min(p0, p1), s1: Math.max(p0, p1) };
  });
  const pairs: (D & { t: number; mid: Vec2; ends: Vec2[] })[] = [];
  const [gMin, gMax] = WALL_RULES.gap;
  // By angle (0.5° buckets, each checked with its neighbour), then by offset, so hatching stays near-linear.
  const TOL = (0.5 * Math.PI) / 180;
  ds.sort((p, q) => Math.floor(p.th / TOL) - Math.floor(q.th / TOL) || p.c - q.c);
  for (let i = 0; i < ds.length; i++)
    for (let j = i + 1; j < ds.length && Math.floor(ds[j].th / TOL) - Math.floor(ds[i].th / TOL) <= 1; j++) {
      const [f, g] = [ds[i], ds[j]];
      if (Math.abs(f.th - g.th) > TOL) continue;
      if (Math.floor(g.th / TOL) === Math.floor(f.th / TOL) && g.c - f.c > gMax + EPS) {
        // Same bucket, sorted by offset: the rest of this bucket is too far; skip to the next bucket.
        while (j + 1 < ds.length && Math.floor(ds[j + 1].th / TOL) === Math.floor(f.th / TOL)) j++;
        continue;
      }
      const gap = Math.abs(g.c - f.c);
      const ov = overlapOf(f, g);
      if (gap < gMin - EPS || gap > gMax + EPS || ov <= 0 || ov < WALL_RULES.overlap * Math.min(flen(f), flen(g)) - EPS) continue;
      const c = (f.c + g.c) / 2;
      const [s0, s1] = [Math.max(f.s0, g.s0), Math.min(f.s1, g.s1)];
      if (s1 - s0 < WALL_RULES.minPiece - EPS) continue;
      const pt = (s: number) => ({ x: f.u.x * s + f.n.x * c, y: f.u.y * s + f.n.y * c });
      pairs.push({ ...f, c, t: gap, s0, s1, mid: pt((s0 + s1) / 2), ends: [pt(s0), pt(s1)] });
    }
  // Widest wins; hatching (inside an axis wall) and lone short pairs are not walls.
  pairs.sort((p, q) => q.t - p.t);
  const kept: typeof pairs = [];
  for (const p of pairs) {
    const within = kept.some((q) => Math.abs(q.th - p.th) < 0.01 && Math.abs(p.c - q.c) + p.t / 2 <= q.t / 2 + SAME && overlapOf(p, q) >= 0.5 * flen(p));
    if (within || axisWalls.some((w) => toFootprint(p.mid, w) === 0)) continue;
    kept.push(p);
  }
  return kept.filter((p) => {
    if (p.s1 - p.s0 >= WALL_RULES.clutterLength) return true;
    return p.ends.some((e) => axisWalls.some((w) => toFootprint(e, w) <= WALL_RULES.jointReach) || kept.some((q) => q !== p && q.ends.some((f) => Math.hypot(f.x - e.x, f.y - e.y) <= WALL_RULES.jointReach)));
  }).length;
}

/** Curved walls: two curved polylines (by path) 0.05–0.6 m apart at every sample point, each pair once. */
function countCurved(curves: Map<number, Seg[]>): number {
  const lines = [...curves.values()].filter((ss) => ss.reduce((s, g) => s + len(g), 0) >= WALL_RULES.minFace);
  const distTo = (p: Vec2, ss: Seg[]) =>
    Math.min(
      ...ss.map((s) => {
        const dx = s.x2 - s.x1;
        const dy = s.y2 - s.y1;
        const t = Math.max(0, Math.min(1, ((p.x - s.x1) * dx + (p.y - s.y1) * dy) / (dx * dx + dy * dy || 1)));
        return Math.hypot(p.x - s.x1 - dx * t, p.y - s.y1 - dy * t);
      }),
    );
  const box = lines.map((ss) => ({ x0: Math.min(...ss.flatMap((s) => [s.x1, s.x2])), y0: Math.min(...ss.flatMap((s) => [s.y1, s.y2])), x1: Math.max(...ss.flatMap((s) => [s.x1, s.x2])), y1: Math.max(...ss.flatMap((s) => [s.y1, s.y2])) }));
  const far = (i: number, j: number) => box[i].x0 - box[j].x1 > WALL_RULES.gap[1] || box[j].x0 - box[i].x1 > WALL_RULES.gap[1] || box[i].y0 - box[j].y1 > WALL_RULES.gap[1] || box[j].y0 - box[i].y1 > WALL_RULES.gap[1];
  let n = 0;
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      if (far(i, j)) continue;
      const samples = [0, 0.25, 0.5, 0.75, 1].map((f) => {
        const s = lines[i][Math.min(lines[i].length - 1, Math.floor(f * lines[i].length))];
        return { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
      });
      const d = samples.map((p) => distTo(p, lines[j]));
      if (Math.min(...d) >= WALL_RULES.gap[0] - EPS && Math.max(...d) <= WALL_RULES.gap[1] + EPS && Math.max(...d) - Math.min(...d) <= 0.1 * Math.max(...d) + SAME) n++;
    }
  return n;
}

// ---------------------------------------------------------------- the reader

export function readVectorWalls(page: Pick<VectorPage, "segments">, mPerPt: number): VectorWalls {
  const dropped: VectorWalls["dropped"] = { short: 0, clutter: 0, inside: 0, openingsCut: 0 };
  const m = (s: PdfSegment): Seg & { src: PdfSegment } => ({ x1: s.x1 * mPerPt, y1: s.y1 * mPerPt, x2: s.x2 * mPerPt, y2: s.y2 * mPerPt, src: s });
  const segs = page.segments.map(m);

  // Curves by path, and the ends of each (a point used by one piece only): door swings end on their leaf.
  const curves = new Map<number, Seg[]>();
  for (const s of segs) if (s.src.curve) curves.set(s.src.path, [...(curves.get(s.src.path) ?? []), s]);
  const key = (x: number, y: number) => `${Math.round(x / SAME)},${Math.round(y / SAME)}`;
  const count = new Map<string, number>();
  for (const ss of curves.values()) for (const s of ss) for (const k of [key(s.x1, s.y1), key(s.x2, s.y2)]) count.set(k, (count.get(k) ?? 0) + 1);
  const arcEnd = (x: number, y: number) => {
    const [i, j] = [Math.round(x / SAME), Math.round(y / SAME)];
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) if (count.get(`${i + di},${j + dj}`) === 1) return true;
    return false;
  };
  // Step M.1c: arcs (Bézier or polyline); their pieces and leaves are never faces.
  const arcs = findArcs(segs.map((s) => ({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, curve: s.src.curve })));
  const notFace = new Set(arcs.flatMap((a) => [...a.pieces, ...(a.leaf === null ? [] : [a.leaf])]).map((i) => segs[i]));
  const straight = segs.filter((s) => !s.src.curve && !notFace.has(s) && !(len(s) <= WALL_RULES.maxLeaf && (arcEnd(s.x1, s.y1) || arcEnd(s.x2, s.y2))));

  // Rule 2: filled rectangles are pairs as they stand.
  const rects: Piece[] = [];
  const used = new Set<Seg>();
  const byPath = new Map<number, typeof straight>();
  for (const s of straight) if (s.src.filled) byPath.set(s.src.path, [...(byPath.get(s.src.path) ?? []), s]);
  for (const ss of byPath.values()) {
    if (ss.length !== 4 || !ss.every((s) => axisOf(s))) continue;
    const uniq = (vs: number[]) => vs.sort((p, q) => p - q).filter((v, i, a) => i === 0 || v - a[i - 1] > SAME);
    const xs = uniq(ss.flatMap((s) => [s.x1, s.x2]));
    const ys = uniq(ss.flatMap((s) => [s.y1, s.y2]));
    if (xs.length !== 2 || ys.length !== 2) continue;
    const [w, h] = [xs[1] - xs[0], ys[1] - ys[0]];
    const t = Math.min(w, h);
    if (t < WALL_RULES.gap[0] - EPS || t > WALL_RULES.gap[1] + EPS) continue;
    rects.push(w >= h ? { axis: "h", c: (ys[0] + ys[1]) / 2, t, s0: xs[0], s1: xs[1], openings: [], rect: true } : { axis: "v", c: (xs[0] + xs[1]) / 2, t, s0: ys[0], s1: ys[1], openings: [], rect: true });
    ss.forEach((s) => used.add(s));
  }

  // Rule 1: faces; rule 3: pairs and the widest-wins selection.
  const rest = straight.filter((s) => !used.has(s) && len(s) >= WALL_RULES.minFace - EPS);
  const faces = joinFaces(rest.flatMap((s) => (axisOf(s) ? [faceOf(s, axisOf(s)!)] : [])));
  const diagonal = rest.filter((s) => !axisOf(s));
  let pieces = selectPieces([...rects, ...pairFaces(faces)], dropped);

  // Rule 4: one line, doors and windows.
  pieces = mergeLines(pieces);
  findWindows(pieces, faces);

  // Rule 5: clutter.
  const lone = (p: Piece) => [at(p.axis, p.s0, p.c), at(p.axis, p.s1, p.c)].every((e) => !pieces.some((q) => q !== p && toFootprint(e, q) <= WALL_RULES.jointReach + EPS));
  const clutter: VectorWalls["clutter"] = [];
  pieces = pieces.filter((p) => {
    const drop = flen(p) < WALL_RULES.clutterLength && lone(p);
    if (drop) clutter.push({ a: at(p.axis, p.s0, p.c), b: at(p.axis, p.s1, p.c), thickness: p.t });
    return !drop;
  });
  dropped.clutter = clutter.length;

  // Rule 7: joints.
  const joined = joinWalls(pieces, dropped);
  // Openings, classified from the lines and arcs in and around each gap (step M.1c).
  const walls: Wall[] = [];
  const openings: VectorOpening[] = [];
  const spans: OpeningSpan[] = joined.flatMap((p) => p.openings.map((o) => ({ axis: p.axis, c: p.c, t: p.t, s0: o.s0, s1: o.s1 })));
  const arcsUsed = new Set<number>();
  joined.forEach((p, i) => {
    const id = `v${i + 1}`;
    const wall: Wall = { id, a: at(p.axis, p.s0, p.c), b: at(p.axis, p.s1, p.c), thickness: p.t, height: WALL_HEIGHT, provenance: "vector" };
    walls.push(wall);
    for (const o of p.openings.sort((q, r) => q.s0 - r.s0)) {
      const c = classifyOpening({ axis: p.axis, c: p.c, t: p.t, s0: o.s0, s1: o.s1 }, straight, arcs, arcsUsed);
      openings.push({
        id: `vo${openings.length + 1}`,
        wallId: id,
        kind: c.kind,
        offset: (o.s0 + o.s1) / 2 - p.s0,
        width: o.s1 - o.s0,
        ...(c.swing ? { swing: c.swing } : {}),
        a: at(p.axis, o.s0, p.c),
        b: at(p.axis, o.s1, p.c),
        class: c.class,
        ...(c.swingNormal ? { swingNormal: c.swingNormal } : {}),
        ...(c.hinge ? { hinge: c.hinge, hingeEnd: c.hingeEnd } : {}),
      });
    }
  });
  const notUsed = arcs.flatMap((a, i) => (arcsUsed.has(i) ? [] : [{ centre: a.centre, r: a.r, sweep: a.sweep, why: unusedWhy(a, spans) }]));

  return {
    mPerPt,
    walls,
    openings,
    skipped: { diagonal: countDiagonal(diagonal, pieces), curved: countCurved(curves) },
    dropped,
    clutter,
    arcs: { found: arcs.length, used: arcsUsed.size, notUsed },
  };
}
