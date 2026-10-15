/**
 * src/lib/pdf/snapIndex.ts — the points a takeoff can snap to on the ORIGINAL drawing (step P.1).
 * Pure and worker-safe (no DOM, no React): src/workers/background.worker.ts builds it from the
 * page's VectorPage (extract.ts) and posts it to the page, where src/store/drawingSnapStore.ts
 * keeps it and src/lib/takeoff/geometry.ts snapTakeoffPoint asks it for candidates.
 *
 * Everything is stored in PDF POINTS (the page viewport at scale 1, /Rotate applied, y down,
 * as src/types/pdf.ts). A query converts with Plan.background.mapping at query time, so a
 * recalibration (which scales the mapping, src/lib/plan/calibrate.ts) moves every snap point
 * with the plan and nothing here is rebuilt.
 *
 * What is indexed, from the segments that survive the filters below:
 *   - corners: a segment end where two or more segment ends meet within 0.05 pt;
 *   - ends: any other segment end;
 *   - mids: each straight segment's midpoint (not a flattened curve's pieces);
 *   - the segments themselves, for the nearest point on a line ("edge").
 * Corners and ends keep the coordinates of the first end seen, exactly as drawn.
 *
 * Skipped as clutter (counted in `counts`):
 *   - short: under 1 mm on paper;
 *   - thin: a stroked line under 0.1 pt (filled edges carry width 0 and are kept);
 *   - dense: any segment whose midpoint is in a 5 mm cell holding more than 40 segments
 *     (outlined text, symbols, fine patterns);
 *   - hatch: 4 or more parallel lines of the same length and stroke, each overlapping the next
 *     by at least half its length, under 5 mm apart, at least three of the gaps between them
 *     within 10% of their median gap. The first three rules alone keep plan-clutter's 0.18 pt
 *     diagonal hatching (2.8 mm long, 1.06 mm apart); the even spacing is what keeps a wall's
 *     ends and a window's three glass lines (only three) out of it. Once a family is found, every
 *     line of the same angle (0.5°), length (0.25 pt) and stroke goes with it: the two lines on a
 *     short piece of hatched wall are its leftovers.
 * Buried points are dropped (counted as `buried`), as a hidden 3D face is never a target: a
 * corner, end or midpoint strictly inside (by more than 0.05 pt) a NARROW filled path, one whose
 * box is at most 5 mm across — a wall's poché. A partition drawn as its own filled rectangle runs
 * into the wall it meets, and its end corners there are under that wall's fill: no one can see
 * them, and at a T they would outrank the wall's own centre-line end. Wide fills (a page's white
 * background, a room's tint) bury nothing; segments themselves stay, for the edge snap.
 * At most MAX_POINTS points are kept (corners, then ends, then mids) and `note` says so.
 *
 * The grid: square cells of at least 5 mm (larger on a huge sheet, so there are at most about a
 * million), with each point in one cell and each segment in every cell its box covers. A query
 * looks only at the cells within its radius, so it costs the same on a 50k-segment page.
 *
 * Connects to: src/types/pdf.ts, src/lib/background/mapping.ts; used by
 * src/workers/background.worker.ts, src/store/drawingSnapStore.ts, src/lib/takeoff/geometry.ts;
 * tested by scripts/test-snap-index.ts.
 */
import { apply, invert } from "@/lib/background/mapping";
import type { Affine, DrawingSnapKind, Vec2 } from "@/types/plan";
import type { PdfSegment, VectorPage } from "@/types/pdf";

export const PT_PER_MM = 72 / 25.4;
export const SNAP_INDEX_RULES = {
  cornerPt: 0.05,
  minLengthMm: 1,
  minStrokePt: 0.1,
  denseCellMm: 5,
  denseMax: 40,
  hatchSpacingMm: 5,
  hatchMin: 4,
  hatchEven: 0.1,
  coverMaxMm: 5,
  maxPoints: 200_000,
  maxCells: 1 << 20,
};
export const MAX_POINTS = SNAP_INDEX_RULES.maxPoints;

/** Shown while the index is built, and when it can't be (an image, a scanned page, a missing file). */
export const READING_DRAWING = "Reading drawing for snapping…";
export const NEEDS_VECTOR = "Drawing snapping needs a vector PDF";
export const capNote = (total: number) =>
  `This drawing has ${total.toLocaleString("en-US")} snap points; only the first ${MAX_POINTS.toLocaleString("en-US")} are used (corners and ends first).`;

export interface SnapCounts {
  /** Segments on the page. */
  segments: number;
  /** Segments indexed (for edges, ends and mids). */
  kept: number;
  short: number;
  thin: number;
  dense: number;
  hatch: number;
  /** Corners, ends and midpoints left out because a wall's fill covers them. */
  buried: number;
  corners: number;
  ends: number;
  mids: number;
  /** Points left out by the MAX_POINTS cap. */
  capped: number;
}

/** Typed arrays only, so it crosses from the worker by structured clone (the buffers transferred). */
export interface SnapIndex {
  /** Kept segments: x1, y1, x2, y2 each, in points. */
  segs: Float64Array;
  xs: Float64Array;
  ys: Float64Array;
  /** 0 corner, 1 end, 2 mid. */
  kinds: Uint8Array;
  grid: { x0: number; y0: number; cell: number; cols: number; rows: number };
  /** Cell c's points are pointItems[pointStart[c] .. pointStart[c + 1]); segments likewise. */
  pointStart: Uint32Array;
  pointItems: Uint32Array;
  segStart: Uint32Array;
  segItems: Uint32Array;
  counts: SnapCounts;
  /** The cap's note, or null. */
  note: string | null;
}

const KINDS: DrawingSnapKind[] = ["corner", "end", "mid"];

/** Every typed array's buffer, for postMessage's transfer list. */
export const transferables = (i: SnapIndex): ArrayBuffer[] =>
  [i.segs, i.xs, i.ys, i.kinds, i.pointStart, i.pointItems, i.segStart, i.segItems].map((a) => a.buffer as ArrayBuffer);

// ---------------------------------------------------------------- filters

const cellKey = (x: number, y: number, size: number) => `${Math.floor(x / size)},${Math.floor(y / size)}`;

/** Segments whose midpoint is in a cell of `size` holding more than `max` segments (all segments counted). */
function denseSet(segments: PdfSegment[], size: number, max: number): Set<string> {
  const n = new Map<string, number>();
  for (const s of segments) {
    const k = cellKey((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, size);
    n.set(k, (n.get(k) ?? 0) + 1);
  }
  return new Set([...n].filter(([, c]) => c > max).map(([k]) => k));
}

/** Indexes (into `segs`) of the hatching: see the header. */
function hatching(segs: PdfSegment[]): Set<number> {
  const spacing = SNAP_INDEX_RULES.hatchSpacingMm * PT_PER_MM;
  const groups = new Map<string, number[]>();
  segs.forEach((s, i) => {
    let a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
    if (a < 0) a += Math.PI;
    if (a >= Math.PI - 1e-9) a = 0; // a line and its reverse are the same direction
    const key = `${Math.round((a * 180) / Math.PI / 0.5)}|${Math.round(Math.hypot(s.x2 - s.x1, s.y2 - s.y1) / 0.25)}|${Math.round(s.width / 0.01)}`;
    const g = groups.get(key);
    if (g) g.push(i);
    else groups.set(key, [i]);
  });
  const out = new Set<number>();
  for (const g of groups.values()) {
    if (g.length < SNAP_INDEX_RULES.hatchMin) continue;
    const s0 = segs[g[0]];
    const L = Math.hypot(s0.x2 - s0.x1, s0.y2 - s0.y1);
    const u = { x: (s0.x2 - s0.x1) / L, y: (s0.y2 - s0.y1) / L };
    const along = g.map((i) => ((segs[i].x1 + segs[i].x2) / 2) * u.x + ((segs[i].y1 + segs[i].y2) / 2) * u.y);
    const across = g.map((i) => -((segs[i].x1 + segs[i].x2) / 2) * u.y + ((segs[i].y1 + segs[i].y2) / 2) * u.x);
    // Union-find over mates: parallel lines under `spacing` apart that overlap by half their length.
    const parent = g.map((_, k) => k);
    const find = (k: number): number => (parent[k] === k ? k : (parent[k] = find(parent[k])));
    const size = Math.max(spacing, L);
    const cells = new Map<string, number[]>();
    g.forEach((_, k) => {
      const key = cellKey(along[k], across[k], size);
      const c = cells.get(key);
      if (c) c.push(k);
      else cells.set(key, [k]);
    });
    g.forEach((_, k) => {
      const cx = Math.floor(along[k] / size);
      const cy = Math.floor(across[k] / size);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const j of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
            if (j <= k) continue;
            const gap = Math.abs(across[j] - across[k]);
            if (gap >= 0.2 && gap <= spacing && Math.abs(along[j] - along[k]) <= L / 2) parent[find(j)] = find(k);
          }
    });
    const comps = new Map<number, number[]>();
    g.forEach((_, k) => {
      const r = find(k);
      const c = comps.get(r);
      if (c) c.push(k);
      else comps.set(r, [k]);
    });
    for (const c of comps.values()) {
      if (c.length < SNAP_INDEX_RULES.hatchMin) continue;
      const xs = c.map((k) => across[k]).sort((p, q) => p - q);
      const gaps = xs.slice(1).map((x, i) => x - xs[i]).filter((d) => d >= 0.2); // two strokes of one line count once
      // Evenly spaced: at least hatchMin − 1 gaps within 10% of the median gap. Not ALL of them: two
      // pieces of one hatched wall overlap at their joint, and there the two runs interleave.
      const med = [...gaps].sort((p, q) => p - q)[Math.floor(gaps.length / 2)];
      if (gaps.filter((d) => Math.abs(d - med) <= SNAP_INDEX_RULES.hatchEven * med).length < SNAP_INDEX_RULES.hatchMin - 1) continue;
      // Hatching found: every line of this exact angle, length and stroke goes with it, so a piece of
      // wall too short for four lines (two lines beside a window) leaves nothing behind either.
      for (const k of g) out.add(k);
      break;
    }
  }
  return out;
}

/** Whether a point is buried under a narrow filled path (see the header): strictly inside it, by more than `margin`. */
function coverTest(segments: PdfSegment[], margin: number): (x: number, y: number) => boolean {
  const size = SNAP_INDEX_RULES.coverMaxMm * PT_PER_MM;
  const byPath = new Map<number, PdfSegment[]>();
  for (const s of segments) {
    if (!s.filled) continue;
    const g = byPath.get(s.path);
    if (g) g.push(s);
    else byPath.set(s.path, [s]);
  }
  const covers: PdfSegment[][] = [];
  const cells = new Map<string, number[]>();
  for (const segs of byPath.values()) {
    const xs = segs.flatMap((s) => [s.x1, s.x2]);
    const ys = segs.flatMap((s) => [s.y1, s.y2]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    if (Math.min(x1 - x0, y1 - y0) > size) continue; // wide: a background or a tint, not a wall
    for (let cx = Math.floor(x0 / size); cx <= Math.floor(x1 / size); cx++)
      for (let cy = Math.floor(y0 / size); cy <= Math.floor(y1 / size); cy++) {
        const key = `${cx},${cy}`;
        const c = cells.get(key);
        if (c) c.push(covers.length);
        else cells.set(key, [covers.length]);
      }
    covers.push(segs);
  }
  const inside = (segs: PdfSegment[], x: number, y: number) => {
    let odd = false;
    for (const s of segs) {
      const vx = s.x2 - s.x1;
      const vy = s.y2 - s.y1;
      const t = Math.min(1, Math.max(0, ((x - s.x1) * vx + (y - s.y1) * vy) / (vx * vx + vy * vy || 1)));
      if (Math.hypot(s.x1 + vx * t - x, s.y1 + vy * t - y) <= margin) return false; // on (or near) its outline: visible
      if (s.y1 > y !== s.y2 > y && x < s.x1 + ((y - s.y1) * vx) / vy) odd = !odd; // even-odd, as a fill closes its subpaths
    }
    return odd;
  };
  return (x, y) => (cells.get(cellKey(x, y, size)) ?? []).some((c) => inside(covers[c], x, y));
}

// ---------------------------------------------------------------- build

/** The index for one page's segments (src/types/pdf.ts VectorPage.segments). */
export function buildSnapIndex(page: { segments: PdfSegment[] }): SnapIndex {
  const R = SNAP_INDEX_RULES;
  const counts: SnapCounts = { segments: page.segments.length, kept: 0, short: 0, thin: 0, dense: 0, hatch: 0, buried: 0, corners: 0, ends: 0, mids: 0, capped: 0 };
  const denseSize = R.denseCellMm * PT_PER_MM;
  const dense = denseSet(page.segments, denseSize, R.denseMax);
  const survivors: PdfSegment[] = [];
  for (const s of page.segments) {
    if (Math.hypot(s.x2 - s.x1, s.y2 - s.y1) < R.minLengthMm * PT_PER_MM - 1e-3) counts.short++; // a 0.1 m wall end at 1:100 is exactly 1 mm, and pdf.js's float32 coordinates can make it 0.00003 pt less: kept
    else if (!s.filled && s.width < R.minStrokePt) counts.thin++;
    else if (dense.has(cellKey((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, denseSize))) counts.dense++;
    else survivors.push(s);
  }
  const hatch = hatching(survivors);
  counts.hatch = hatch.size;
  const kept = survivors.filter((_, i) => !hatch.has(i));
  counts.kept = kept.length;

  // Ends, clustered within cornerPt: the first end seen is the point; two or more make a corner.
  const C = R.cornerPt;
  const reps: { x: number; y: number; n: number }[] = [];
  const repCells = new Map<string, number[]>();
  const addEnd = (x: number, y: number) => {
    const cx = Math.floor(x / C);
    const cy = Math.floor(y / C);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const r of repCells.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (Math.hypot(reps[r].x - x, reps[r].y - y) <= C) {
            reps[r].n++;
            return;
          }
        }
    const key = `${cx},${cy}`;
    const list = repCells.get(key);
    if (list) list.push(reps.length);
    else repCells.set(key, [reps.length]);
    reps.push({ x, y, n: 1 });
  };
  for (const s of kept) {
    addEnd(s.x1, s.y1);
    addEnd(s.x2, s.y2);
  }
  const corners = reps.filter((r) => r.n >= 2);
  const ends = reps.filter((r) => r.n < 2);
  const mids = kept.filter((s) => !s.curve).map((s) => ({ x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 }));
  const buried = coverTest(page.segments, C);
  const visible = [...corners.map((p) => [p.x, p.y, 0] as const), ...ends.map((p) => [p.x, p.y, 1] as const), ...mids.map((p) => [p.x, p.y, 2] as const)];
  const all = visible.filter((p) => !buried(p[0], p[1]));
  counts.buried = visible.length - all.length;
  counts.capped = Math.max(0, all.length - R.maxPoints);
  const pts = counts.capped ? all.slice(0, R.maxPoints) : all;
  counts.corners = pts.filter((p) => p[2] === 0).length;
  counts.ends = pts.filter((p) => p[2] === 1).length;
  counts.mids = pts.filter((p) => p[2] === 2).length;

  const xs = Float64Array.from(pts, (p) => p[0]);
  const ys = Float64Array.from(pts, (p) => p[1]);
  const kinds = Uint8Array.from(pts, (p) => p[2]);
  const segs = new Float64Array(kept.length * 4);
  kept.forEach((s, i) => segs.set([s.x1, s.y1, s.x2, s.y2], i * 4));

  // The grid over everything kept.
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < segs.length; i += 2) {
    x0 = Math.min(x0, segs[i]);
    x1 = Math.max(x1, segs[i]);
    y0 = Math.min(y0, segs[i + 1]);
    y1 = Math.max(y1, segs[i + 1]);
  }
  if (!kept.length) [x0, y0, x1, y1] = [0, 0, 1, 1];
  let cell = R.denseCellMm * PT_PER_MM;
  while (Math.ceil((x1 - x0) / cell + 1) * Math.ceil((y1 - y0) / cell + 1) > R.maxCells) cell *= 2;
  const cols = Math.max(1, Math.ceil((x1 - x0) / cell) + 1);
  const rows = Math.max(1, Math.ceil((y1 - y0) / cell) + 1);
  const grid = { x0, y0, cell, cols, rows };
  const col = (x: number) => Math.min(cols - 1, Math.max(0, Math.floor((x - x0) / cell)));
  const row = (y: number) => Math.min(rows - 1, Math.max(0, Math.floor((y - y0) / cell)));

  const csr = (n: number, cellsOf: (i: number, visit: (c: number) => void) => void) => {
    const start = new Uint32Array(cols * rows + 1);
    for (let i = 0; i < n; i++) cellsOf(i, (c) => start[c + 1]++);
    for (let c = 0; c < cols * rows; c++) start[c + 1] += start[c];
    const fill = start.slice(0, cols * rows);
    const items = new Uint32Array(start[cols * rows]);
    for (let i = 0; i < n; i++) cellsOf(i, (c) => (items[fill[c]++] = i));
    return { start, items };
  };
  const p = csr(xs.length, (i, visit) => visit(row(ys[i]) * cols + col(xs[i])));
  const s = csr(kept.length, (i, visit) => {
    const [ax, ay, bx, by] = segs.subarray(i * 4, i * 4 + 4);
    for (let r = row(Math.min(ay, by)); r <= row(Math.max(ay, by)); r++) for (let c = col(Math.min(ax, bx)); c <= col(Math.max(ax, bx)); c++) visit(r * cols + c);
  });
  return { segs, xs, ys, kinds, grid, pointStart: p.start, pointItems: p.items, segStart: s.start, segItems: s.items, counts, note: counts.capped ? capNote(all.length) : null };
}

/** The worker's rule: a scanned page (one big picture, no line work) has nothing to snap to. */
export const indexForPage = (page: Pick<VectorPage, "kind" | "segments">): SnapIndex | null => (page.kind === "scanned" ? null : buildSnapIndex(page));

// ---------------------------------------------------------------- query

export interface DrawingHit {
  /** Plan metres. */
  point: [number, number];
  kind: DrawingSnapKind;
  /** Distance from the query, metres. */
  d: number;
}

/** The smallest stretch of the mapping's linear part: a radius in metres covers at most radius / this in points. */
function minStretch(m: Affine): number {
  const S = m.a * m.a + m.b * m.b + m.c * m.c + m.d * m.d;
  const det = m.a * m.d - m.b * m.c;
  return Math.sqrt(Math.max(0, (S - Math.sqrt(Math.max(0, S * S - 4 * det * det))) / 2));
}

/**
 * The nearest drawing candidates within `tolerance` metres of `at` (plan metres), one per tier:
 * `point` a corner or an end (the nearest of either), `mid` a midpoint, `edge` the nearest point
 * on a kept segment. Each point is the stored point mapped by `mapping`, so it is exact.
 */
export function drawingCandidates(index: SnapIndex, mapping: Affine, at: Vec2, tolerance: number): { point: DrawingHit | null; mid: DrawingHit | null; edge: DrawingHit | null } {
  const out: { point: DrawingHit | null; mid: DrawingHit | null; edge: DrawingHit | null } = { point: null, mid: null, edge: null };
  const stretch = minStretch(mapping);
  if (!(stretch > 0) || !(tolerance >= 0)) return out;
  const q = apply(invert(mapping), at);
  const r = tolerance / stretch;
  const { x0, y0, cell, cols, rows } = index.grid;
  const c0 = Math.max(0, Math.floor((q.x - r - x0) / cell));
  const c1 = Math.min(cols - 1, Math.floor((q.x + r - x0) / cell));
  const r0 = Math.max(0, Math.floor((q.y - r - y0) / cell));
  const r1 = Math.min(rows - 1, Math.floor((q.y + r - y0) / cell));
  for (let row = r0; row <= r1; row++) {
    for (let c = c0; c <= c1; c++) {
      const k = row * cols + c;
      for (let j = index.pointStart[k]; j < index.pointStart[k + 1]; j++) {
        const i = index.pointItems[j];
        const m = apply(mapping, { x: index.xs[i], y: index.ys[i] });
        const d = Math.hypot(m.x - at.x, m.y - at.y);
        if (d > tolerance) continue;
        const tier = index.kinds[i] === 2 ? "mid" : "point";
        if (!out[tier] || d < out[tier]!.d) out[tier] = { point: [m.x, m.y], kind: KINDS[index.kinds[i]], d };
      }
      for (let j = index.segStart[k]; j < index.segStart[k + 1]; j++) {
        const i = index.segItems[j]; // a long segment is in several cells: seen again, it gives the same answer
        const a = apply(mapping, { x: index.segs[i * 4], y: index.segs[i * 4 + 1] });
        const b = apply(mapping, { x: index.segs[i * 4 + 2], y: index.segs[i * 4 + 3] });
        const vx = b.x - a.x;
        const vy = b.y - a.y;
        const t = Math.min(1, Math.max(0, ((at.x - a.x) * vx + (at.y - a.y) * vy) / (vx * vx + vy * vy || 1)));
        const p = { x: a.x + vx * t, y: a.y + vy * t };
        const d = Math.hypot(p.x - at.x, p.y - at.y);
        if (d <= tolerance && (!out.edge || d < out.edge.d)) out.edge = { point: [p.x, p.y], kind: "edge", d };
      }
    }
  }
  return out;
}
