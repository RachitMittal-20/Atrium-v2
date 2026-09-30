/**
 * src/lib/blueprint/vectorize.ts
 *
 * Stage 1b of the Blueprint pipeline: turn the WallMask from wallMask.ts into
 * wall centre-line segments with thickness, in PIXEL coordinates (scale to
 * metres comes later, in scale.ts). Output walls follow the plan Conventions:
 * every joint is an endpoint of every wall touching it (T-junctions split).
 *
 * Steps:
 *  1. Bands: a pixel belongs to a horizontal band if its horizontal ink run is
 *     longer than 2T (T = mask.wallThickness), because across a vertical wall
 *     the run is only one wall-width long. Same for vertical. Each 4-connected
 *     component is one band; its centre line is the mean pixel centre and its
 *     thickness the median per-column (per-row) pixel count.
 *  2. Merge collinear bands that overlap or nearly touch (a noisy scan breaks
 *     one wall into pieces), then drop bands shorter than 2× their thickness.
 *     Dropping happens before joints are made, so it can't orphan a joint.
 *  3. Joints: for every horizontal/vertical pair, the crossing P of their centre
 *     lines is a joint if it lies within 1.5× thickness of both. A wall end
 *     near P snaps onto P (L-joints, the stem of a T); a wall passing through P
 *     is split there (the top of a T, both walls of a +).
 *  4. Joints closer than T/2 are merged, so walls that should meet at one point
 *     but were drawn a pixel apart share the exact same coordinates.
 *
 * Known limitation: diagonal walls are skipped — their runs are short in both
 * directions, so they never form a band. They are not silently lost: they lower
 * `coverage`, the share of mask pixels explained by some wall, which callers
 * should surface (a diagonal-heavy plan shows a low number).
 */
import type { PixelWall, WallMask } from "@/types/blueprint";

export interface VectorizeResult {
  walls: PixelWall[];
  /** Fraction (0–1) of mask pixels lying inside some wall's rectangle. */
  coverage: number;
}

/** An axis-aligned wall: centre line at `c` across, spanning [s0, s1) along. */
interface Band {
  horizontal: boolean;
  c: number;
  s0: number;
  s1: number;
  t: number;
}

const median = (v: number[]) => {
  const s = [...v].sort((p, q) => p - q);
  return s[s.length >> 1];
};

// ---------------------------------------------------------------- 1. bands

/** Bands of one orientation. Works in "along/across" terms: for vertical
 *  bands the image is read transposed. */
function findBands(mask: Uint8Array, w: number, h: number, minRun: number, horizontal: boolean): Band[] {
  const [A, C] = horizontal ? [w, h] : [h, w]; // along, across
  const at = (s: number, c: number) => (horizontal ? mask[c * w + s] : mask[s * w + c]);

  // Keep pixels lying in runs longer than minRun along this orientation.
  const keep = new Uint8Array(A * C); // index = c * A + s
  for (let c = 0; c < C; c++) {
    let start = -1;
    for (let s = 0; s <= A; s++) {
      const ink = s < A && at(s, c);
      if (ink && start < 0) start = s;
      if (!ink && start >= 0) {
        if (s - start > minRun) keep.fill(1, c * A + start, c * A + s);
        start = -1;
      }
    }
  }

  // 4-connected components by flood fill.
  const seen = new Uint8Array(A * C);
  const bands: Band[] = [];
  const stack: number[] = [];
  for (let i = 0; i < keep.length; i++) {
    if (!keep[i] || seen[i]) continue;
    seen[i] = 1;
    stack.push(i);
    let sumC = 0;
    let n = 0;
    let s0 = Infinity;
    let s1 = -Infinity;
    const perAlong = new Map<number, number>(); // pixels in each along-position → thickness samples
    while (stack.length) {
      const j = stack.pop()!;
      const s = j % A;
      const c = (j - s) / A;
      sumC += c + 0.5; // pixel centre
      n++;
      s0 = Math.min(s0, s);
      s1 = Math.max(s1, s + 1);
      perAlong.set(s, (perAlong.get(s) ?? 0) + 1);
      for (const k of [s > 0 ? j - 1 : -1, s < A - 1 ? j + 1 : -1, c > 0 ? j - A : -1, c < C - 1 ? j + A : -1]) {
        if (k >= 0 && keep[k] && !seen[k]) {
          seen[k] = 1;
          stack.push(k);
        }
      }
    }
    bands.push({ horizontal, c: sumC / n, s0, s1, t: median([...perAlong.values()]) });
  }
  return bands;
}

// ---------------------------------------------------------------- 2. merge + drop

/** Merge same-orientation bands on (nearly) the same line whose spans overlap
 *  or are separated by at most half a thickness. */
function mergeCollinear(bands: Band[]): Band[] {
  const out: Band[] = [];
  for (const b of [...bands].sort((p, q) => p.c - q.c || p.s0 - q.s0)) {
    const hit = out.find(
      (o) =>
        o.horizontal === b.horizontal &&
        Math.abs(o.c - b.c) <= Math.max(o.t, b.t) / 2 &&
        b.s0 <= o.s1 + Math.max(o.t, b.t) / 2 &&
        o.s0 <= b.s1 + Math.max(o.t, b.t) / 2,
    );
    if (!hit) {
      out.push({ ...b });
      continue;
    }
    // Length-weighted average of the line and thickness.
    const lo = hit.s1 - hit.s0;
    const lb = b.s1 - b.s0;
    hit.c = (hit.c * lo + b.c * lb) / (lo + lb);
    hit.t = (hit.t * lo + b.t * lb) / (lo + lb);
    hit.s0 = Math.min(hit.s0, b.s0);
    hit.s1 = Math.max(hit.s1, b.s1);
  }
  // One pass can leave pairs that only became mergeable after an earlier merge.
  return out.length < bands.length ? mergeCollinear(out) : out;
}

// ---------------------------------------------------------------- 3. joints

interface Seg {
  band: Band;
  start: number; // along-coordinate of each end, moved onto joints
  end: number;
  splits: number[]; // along-coordinates where another wall joins mid-span
}

function makeJoints(bands: Band[]): Seg[] {
  const segs: Seg[] = bands.map((band) => ({ band, start: band.s0, end: band.s1, splits: [] }));
  // Best endpoint candidate per segment end: [distance, along-coordinate].
  const bestStart = new Map<Seg, number[]>();
  const bestEnd = new Map<Seg, number[]>();

  const visit = (seg: Seg, p: number, tol: number) => {
    // Always a split candidate too: if another wall wins this end, P may still
    // fall inside the final span and must split it. The assembly step keeps only
    // splits strictly inside (start, end), so the winning endpoint drops out.
    seg.splits.push(p);
    const dStart = Math.abs(p - seg.band.s0);
    const dEnd = Math.abs(p - seg.band.s1);
    if (dStart <= tol && dStart <= dEnd) {
      if (!bestStart.has(seg) || dStart < bestStart.get(seg)![0]) bestStart.set(seg, [dStart, p]);
    } else if (dEnd <= tol) {
      if (!bestEnd.has(seg) || dEnd < bestEnd.get(seg)![0]) bestEnd.set(seg, [dEnd, p]);
    }
  };

  const hs = segs.filter((s) => s.band.horizontal);
  const vs = segs.filter((s) => !s.band.horizontal);
  for (const H of hs) {
    for (const V of vs) {
      const tol = 1.5 * Math.max(H.band.t, V.band.t);
      const px = V.band.c; // crossing point P = (V's x, H's y)
      const py = H.band.c;
      // Distance from P to each span (0 when inside it).
      const offH = Math.max(0, H.band.s0 - px, px - H.band.s1);
      const offV = Math.max(0, V.band.s0 - py, py - V.band.s1);
      if (offH > tol || offV > tol) continue;
      visit(H, px, tol);
      visit(V, py, tol);
    }
  }
  for (const [seg, [, p]] of bestStart) seg.start = p;
  for (const [seg, [, p]] of bestEnd) seg.end = p;
  return segs;
}

// ---------------------------------------------------------------- 4. assemble

/** Merge joint points within `radius` (ponytail: greedy clustering, O(n²); fine
 *  for a few hundred joints). Returns a lookup from a point to its cluster mean. */
function clusterPoints(points: { x: number; y: number }[], radius: number) {
  const clusters: { x: number; y: number; n: number }[] = [];
  for (const p of points) {
    const c = clusters.find((k) => Math.hypot(k.x / k.n - p.x, k.y / k.n - p.y) <= radius);
    if (c) {
      c.x += p.x;
      c.y += p.y;
      c.n++;
    } else clusters.push({ x: p.x, y: p.y, n: 1 });
  }
  const means = clusters.map((k) => ({ x: k.x / k.n, y: k.y / k.n }));
  return (p: { x: number; y: number }) => means.find((m) => Math.hypot(m.x - p.x, m.y - p.y) <= radius) ?? p;
}

/** Fraction of mask pixels inside some wall's rectangle (extended by half a
 *  thickness at both ends, so the outer square of an L corner counts). */
function computeCoverage(mask: WallMask, walls: PixelWall[]): number {
  const { width: w, height: h } = mask;
  const covered = new Uint8Array(w * h);
  for (const { a, b, thickness: t } of walls) {
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - t / 2));
    const x1 = Math.min(w, Math.ceil(Math.max(a.x, b.x) + t / 2));
    const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - t / 2));
    const y1 = Math.min(h, Math.ceil(Math.max(a.y, b.y) + t / 2));
    for (let y = y0; y < y1; y++) covered.fill(1, y * w + x0, y * w + x1);
  }
  let ink = 0;
  let hit = 0;
  for (let i = 0; i < w * h; i++) {
    if (!mask.mask[i]) continue;
    ink++;
    hit += covered[i];
  }
  return ink === 0 ? 0 : hit / ink;
}

/** Wall centre-line segments (pixels) plus how much of the mask they explain. */
export function vectorize(mask: WallMask): VectorizeResult {
  const { width: w, height: h, wallThickness: T } = mask;
  const bands = mergeCollinear([
    ...findBands(mask.mask, w, h, 2 * T, true),
    ...findBands(mask.mask, w, h, 2 * T, false),
  ]).filter((b) => b.s1 - b.s0 >= 2 * b.t);

  const segs = makeJoints(bands);
  const toPoint = (b: Band, s: number) => (b.horizontal ? { x: s, y: b.c } : { x: b.c, y: s });

  // Every end and split point, clustered so near-coincident joints become one.
  const allPoints = segs.flatMap((g) => [g.start, g.end, ...g.splits].map((s) => toPoint(g.band, s)));
  const snap = clusterPoints(allPoints, T / 2);

  const walls: PixelWall[] = [];
  for (const g of segs) {
    const stops = [g.start, ...g.splits.filter((s) => s > g.start && s < g.end).sort((p, q) => p - q), g.end];
    for (let i = 1; i < stops.length; i++) {
      const a = snap(toPoint(g.band, stops[i - 1]));
      const b = snap(toPoint(g.band, stops[i]));
      if (Math.hypot(a.x - b.x, a.y - b.y) > 0) walls.push({ a, b, thickness: g.band.t });
    }
  }
  return { walls, coverage: computeCoverage(mask, walls) };
}
