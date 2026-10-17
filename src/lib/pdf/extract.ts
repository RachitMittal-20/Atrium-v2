/**
 * src/lib/pdf/extract.ts
 *
 * Reads one PDF page into a VectorPage (src/types/pdf.ts): every stroked or
 * filled path as straight segments, every text item, every image's area, and
 * the page's kind. Coordinates are page points in the viewport at scale 1, so
 * the current transformation matrix AND the page's /Rotate are applied, with
 * y down.
 *
 * Paths come from pdf.js's operator list. The CTM is tracked through q / Q
 * (save, restore), cm (transform) and form XObjects (their /Matrix); line
 * width through w and the graphics state's LW. A path is kept when it is
 * painted (stroke, fill, or both, in any of their close / even-odd forms); a
 * path that only sets a clip (n) is not. Fills close every subpath. Curves are
 * flattened in page points within FLATTEN_PT, with Wang's formula: n pieces
 * where n = ceil(sqrt(0.75 × M / tol)) and M is the largest second difference
 * of the control points, which bounds the distance between curve and polyline.
 * Quadratic curves are raised to cubics first.
 *
 * Each segment carries the number of the painted path it came from (`path`,
 * in painting order) and whether it is a piece of a flattened curve (`curve`):
 * src/lib/pdf/walls.ts reads a filled rectangle's edges as one wall, finds door
 * leaves by the swing arcs they meet, and counts curved walls (step M.1b).
 *
 * A fill in the paper's colour is a MASK, not ink (step Q.2): a generated plan knocks a window out
 * of its poche with a white rectangle a little bigger than the gap, and some exporters paint a white
 * sheet behind the drawing. It paints paper, so a path that is only filled white gives no segments,
 * and one filled white and stroked keeps its stroke only. pdf.js hands every fill colour over as
 * setFillRGBColor with a hex string (gray, CMYK and the rest converted); white is every channel at
 * least PAPER (250 of 255). A pattern or shading fill is ink.
 *
 * A stroke-only path with a dash pattern (setDash with a non-empty array) marks its segments `dashed` (step Q.2):
 * CAD draws centre lines, hidden and overhead lines and setting-out lines dashed, and a wall's cut face
 * continuous, so walls.ts never takes a dashed line as a face or an opening's line. The dash pattern is
 * part of the graphics state (saved and restored with q / Q).
 *
 * CLIPPING (step Q.2): what a clip path hides is not on the drawing. A clip (W or W*, then the path)
 * adds a region to the graphics state, saved and restored with q / Q; every segment is cut to the
 * parts inside every region in force (even-odd or nonzero, as the clip said), so a poche's hatching,
 * drawn as long lines clipped to each wall piece, arrives as only its visible parts. A clip path with
 * no geometry clips nothing. Text and images are not clipped.
 *
 * Stroke width in points is the line width × sqrt(|det|) of the CTM (a hairline,
 * width 0, stays 0). Text items come from getTextContent: position = the start
 * of the baseline, rotation from the text matrix's x axis, height from its y axis.
 *
 * Caps: more than `maxPathOps` path commands (MAX_PATH_OPS by default) is
 * refused with a plain message, before any segment is built. Step X.1 adds the
 * two counts that can grow past the commands: flattened segments (a few curve
 * commands can flatten into millions of pieces), MAX_SEGMENTS, refused as soon
 * as the count passes it; and text items, MAX_TEXT_ITEMS. Every array the
 * readers build after this is bounded by these.
 *
 * Kind (CLASSIFY):
 *   - line work is "meaningful" with at least 40 segments whose total length is
 *     at least half the page's perimeter (width + height);
 *   - "scanned": the largest image covers at least 40% of the page and the
 *     line work is not meaningful (essentially one picture);
 *   - "mixed": a picture that large AND meaningful line work (read as vector);
 *   - "vector": everything else (meaningful line work and no large picture, or
 *     a page with little on it, such as a cover page).
 *
 * Connects to: open.ts (PdfJs), scale.ts, analysePdf.ts; tested by scripts/test-pdf.ts.
 */
import type { PDFPageProxy } from "pdfjs-dist";
import { BlueprintError } from "@/types/blueprint";
import type { PdfSegment, PdfText, VectorPage } from "@/types/pdf";
import type { PdfJs } from "./open";

export const MAX_PATH_OPS = 500_000;
/** Most straight segments a page may flatten into (step X.1). */
export const MAX_SEGMENTS = 500_000;
/** Most text items a page may have (step X.1). */
export const MAX_TEXT_ITEMS = 50_000;
export const FLATTEN_PT = 0.05;
const CLASSIFY = { minSegments: 40, scanCover: 0.4 };
/** A fill whose every channel is at least this (of 255) is the paper's colour (header, step Q.2). */
const PAPER_CHANNEL = 250;
const isPaper = (hex: unknown) => typeof hex === "string" && /^#[0-9a-f]{6}$/i.test(hex) && [1, 3, 5].every((i) => parseInt(hex.slice(i, i + 2), 16) >= PAPER_CHANNEL);

type M = [number, number, number, number, number, number];

/** m1 · m2: apply m2 first, then m1 (pdf.js's Util.transform). */
const mul = (m1: M, m2: number[]): M => [
  m1[0] * m2[0] + m1[2] * m2[1],
  m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3],
  m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
  m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];
const apply = (m: number[], x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** pdf.js's path command codes inside constructPath (its DrawOPS, not exported). */
const DRAW = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 };

/**
 * Walks one constructPath's data through the CTM, emitting straight pieces in viewport points;
 * curves are flattened within FLATTEN_PT (header) and emitted with `curve` true. `closeAll` closes
 * every subpath (a fill or a clip does).
 */
function walkPath(data: ArrayLike<number>, ctm: M, closeAll: boolean, emit: (x1: number, y1: number, x2: number, y2: number, curve: boolean) => void) {
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let open = false; // a subpath has started
  const seg = (x1: number, y1: number, x2: number, y2: number, curve = false) => {
    if (x1 !== x2 || y1 !== y2) emit(x1, y1, x2, y2, curve);
  };
  const close = () => {
    if (open) seg(cx, cy, sx, sy);
    cx = sx;
    cy = sy;
  };
  const cubic = (p1x: number, p1y: number, p2x: number, p2y: number, p3x: number, p3y: number) => {
    const ddx = Math.max(Math.abs(cx - 2 * p1x + p2x), Math.abs(p1x - 2 * p2x + p3x));
    const ddy = Math.max(Math.abs(cy - 2 * p1y + p2y), Math.abs(p1y - 2 * p2y + p3y));
    const n = Math.max(1, Math.ceil(Math.sqrt((0.75 * Math.hypot(ddx, ddy)) / FLATTEN_PT)));
    let [px, py] = [cx, cy];
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const u = 1 - t;
      const x = u * u * u * cx + 3 * u * u * t * p1x + 3 * u * t * t * p2x + t * t * t * p3x;
      const y = u * u * u * cy + 3 * u * u * t * p1y + 3 * u * t * t * p2y + t * t * t * p3y;
      seg(px, py, x, y, true);
      [px, py] = [x, y];
    }
    [cx, cy] = [p3x, p3y];
  };
  for (let j = 0; j < data.length; ) {
    const cmd = data[j++];
    if (cmd === DRAW.moveTo) {
      if (closeAll) close();
      [cx, cy] = apply(ctm, data[j++], data[j++]);
      [sx, sy] = [cx, cy];
      open = true;
    } else if (cmd === DRAW.lineTo) {
      const [x, y] = apply(ctm, data[j++], data[j++]);
      seg(cx, cy, x, y);
      [cx, cy] = [x, y];
    } else if (cmd === DRAW.curveTo) {
      const [p1x, p1y] = apply(ctm, data[j++], data[j++]);
      const [p2x, p2y] = apply(ctm, data[j++], data[j++]);
      const [p3x, p3y] = apply(ctm, data[j++], data[j++]);
      cubic(p1x, p1y, p2x, p2y, p3x, p3y);
    } else if (cmd === DRAW.quadraticCurveTo) {
      const [qx, qy] = apply(ctm, data[j++], data[j++]);
      const [p3x, p3y] = apply(ctm, data[j++], data[j++]);
      // Raised to a cubic: control points 2/3 of the way to the quadratic's.
      cubic(cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy), p3x + (2 / 3) * (qx - p3x), p3y + (2 / 3) * (qy - p3y), p3x, p3y);
    } else if (cmd === DRAW.closePath) {
      close();
      open = false;
    }
  }
  if (closeAll) close();
}

/** A clip region (header, CLIPPING): its closed edges in viewport points and its fill rule. */
interface ClipRegion {
  edges: [number, number, number, number][];
  evenOdd: boolean;
  box: [number, number, number, number];
}

/** True when (x, y) is inside the region, by its rule (crossings for even-odd, winding for nonzero). */
function insideClip(r: ClipRegion, x: number, y: number): boolean {
  let winding = 0;
  let crossings = 0;
  for (const [x1, y1, x2, y2] of r.edges) {
    if (y1 <= y !== y2 <= y) {
      const xc = x1 + ((y - y1) / (y2 - y1)) * (x2 - x1);
      if (xc > x) {
        crossings++;
        winding += y2 > y1 ? 1 : -1;
      }
    }
  }
  return r.evenOdd ? crossings % 2 === 1 : winding !== 0;
}

/**
 * The parameter intervals [t0, t1] of the segment that lie inside every region (header, CLIPPING):
 * the segment is split where it crosses a region's edges, a piece is kept when its middle is
 * inside, and touching kept pieces are joined.
 * ponytail: O(edges) per segment per region; fine for clip rectangles and poche outlines, index the
 * edges if a page ever clips everything to a path of thousands of edges.
 */
function clipIntervals(regions: ClipRegion[], x1: number, y1: number, x2: number, y2: number): [number, number][] {
  let kept: [number, number][] = [[0, 1]];
  const [dx, dy] = [x2 - x1, y2 - y1];
  for (const r of regions) {
    if (Math.max(x1, x2) < r.box[0] || Math.min(x1, x2) > r.box[2] || Math.max(y1, y2) < r.box[1] || Math.min(y1, y2) > r.box[3]) return [];
    const cuts: number[] = [];
    for (const [ex1, ey1, ex2, ey2] of r.edges) {
      const [ex, ey] = [ex2 - ex1, ey2 - ey1];
      const den = dx * ey - dy * ex;
      if (den === 0) continue; // parallel: no single crossing
      const t = ((ex1 - x1) * ey - (ey1 - y1) * ex) / den;
      const u = ((ex1 - x1) * dy - (ey1 - y1) * dx) / den;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
    }
    const next: [number, number][] = [];
    for (const [a, b] of kept) {
      const stops = [a, ...cuts.filter((t) => t > a && t < b).sort((p, q) => p - q), b];
      for (let i = 1; i < stops.length; i++) {
        const m = (stops[i - 1] + stops[i]) / 2;
        if (!insideClip(r, x1 + dx * m, y1 + dy * m)) continue;
        const last = next[next.length - 1];
        if (last && last[1] === stops[i - 1]) last[1] = stops[i];
        else next.push([stops[i - 1], stops[i]]);
      }
    }
    kept = next;
    if (!kept.length) return [];
  }
  return kept;
}

/** Paper names by their short × long side in points (unrotated). */
const PAPER: [string, number, number][] = [
  ["A0", 2383.94, 3370.39],
  ["A1", 1683.78, 2383.94],
  ["A2", 1190.55, 1683.78],
  ["A3", 841.89, 1190.55],
  ["A4", 595.28, 841.89],
  ["A5", 419.53, 595.28],
  ["Letter", 612, 792],
  ["Legal", 612, 1008],
  ["Tabloid", 792, 1224],
];

export function paperName(w: number, h: number): string {
  const [s, l] = w < h ? [w, h] : [h, w];
  const hit = PAPER.find(([, ps, pl]) => Math.abs(ps - s) <= 2 && Math.abs(pl - l) <= 2);
  return hit ? hit[0] : `${Math.round((s * 25.4) / 72)} × ${Math.round((l * 25.4) / 72)} mm`;
}

/** CLASSIFY's "meaningful line work": enough segments, long enough in total. */
export const meaningfulLines = (p: Pick<VectorPage, "segments" | "lineLength" | "width" | "height">) => p.segments.length >= CLASSIFY.minSegments && p.lineLength >= p.width + p.height;

export const tooManyOps = (max: number) =>
  `This page has more than ${max.toLocaleString("en-GB")} drawing commands, too many to read in the browser. Export just the floor plan from your drawing program, or simplify it, and try again.`;

export const tooManySegments = (max: number) =>
  `This page's drawing has more than ${max.toLocaleString("en-GB")} line pieces, too many to read in the browser. Export just the floor plan from your drawing program, or simplify it, and try again.`;

export const tooManyTexts = (max: number) =>
  `This page has more than ${max.toLocaleString("en-GB")} pieces of text, too many to read in the browser. Export just the floor plan from your drawing program, and try again.`;

export async function extractVectorPage(pdfjs: PdfJs, page: PDFPageProxy, opts: { maxPathOps?: number; maxSegments?: number; maxTexts?: number } = {}): Promise<VectorPage> {
  const { OPS } = pdfjs;
  const maxPathOps = opts.maxPathOps ?? MAX_PATH_OPS;
  const maxSegments = opts.maxSegments ?? MAX_SEGMENTS;
  const maxTexts = opts.maxTexts ?? MAX_TEXT_ITEMS;
  const viewport = page.getViewport({ scale: 1 });
  const base = viewport.transform as M; // user space -> viewport points, /Rotate included
  const { width, height } = viewport;
  const view = page.view; // the unrotated page box
  const paper = paperName(view[2] - view[0], view[3] - view[1]);

  const ops = await page.getOperatorList();
  const { fnArray, argsArray } = ops;

  // Count path commands first, so a huge page is refused before any work.
  let pathOps = 0;
  for (let i = 0; i < fnArray.length; i++) {
    if (fnArray[i] !== OPS.constructPath) continue;
    const data = argsArray[i]?.[1]?.[0] as ArrayLike<number> | null | undefined;
    if (!data) continue;
    for (let j = 0; j < data.length; ) {
      const op = data[j++];
      pathOps++;
      j += op === DRAW.moveTo || op === DRAW.lineTo ? 2 : op === DRAW.curveTo ? 6 : op === DRAW.quadraticCurveTo ? 4 : 0;
    }
    if (pathOps > maxPathOps) throw new BlueprintError(tooManyOps(maxPathOps));
  }

  const STROKE = new Set([OPS.stroke, OPS.closeStroke]);
  const FILL = new Set([OPS.fill, OPS.eoFill]);
  const BOTH = new Set([OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const CLOSES = new Set([OPS.closeStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const IMAGE = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintSolidColorImageMask]);

  const segments: PdfSegment[] = [];
  const images: VectorPage["images"] = [];
  let ctm: M = [...base];
  let lineWidth = 1;
  let paperFill = false; // the fill colour is the paper's (header, step Q.2)
  let dashed = false; // the stroke has a dash pattern (header, step Q.2)
  let clips: ClipRegion[] = []; // the clip regions in force (header, CLIPPING); replaced, never mutated
  let pendingClip: boolean | null = null; // W (false) or W* (true) seen: the next path is a clip
  const stack: { ctm: M; lineWidth: number; paperFill: boolean; dashed: boolean; clips: ClipRegion[] }[] = [];
  const state = () => ({ ctm: [...ctm] as M, lineWidth, paperFill, dashed, clips });

  /** Adds the straight pieces of one painted path, in viewport points, cut to the clip regions. */
  let pathIndex = 0;
  const addPath = (data: ArrayLike<number>, op: number) => {
    const path = pathIndex++; // every painted path gets its own number (walls.ts groups a filled polygon's edges by it)
    const stroked = STROKE.has(op) || BOTH.has(op);
    const filled = (FILL.has(op) || BOTH.has(op)) && !paperFill; // a white fill paints paper, not ink
    if (!stroked && !filled) return; // endPath: a clip only
    const w = stroked ? lineWidth * Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])) : 0;
    // A filled edge is ink whatever its outline's dash; only a stroke-only path is marked dashed.
    const mark = stroked && !filled && dashed ? { dashed: true as const } : {};
    const push = (x1: number, y1: number, x2: number, y2: number, curve: boolean) => {
      if (segments.length >= maxSegments) throw new BlueprintError(tooManySegments(maxSegments));
      segments.push({ x1, y1, x2, y2, width: w, filled, path, curve, ...mark });
    };
    walkPath(data, ctm, filled || CLOSES.has(op), (x1, y1, x2, y2, curve) => {
      if (!clips.length) return push(x1, y1, x2, y2, curve);
      for (const [t0, t1] of clipIntervals(clips, x1, y1, x2, y2))
        t0 === 0 && t1 === 1 ? push(x1, y1, x2, y2, curve) : push(x1 + (x2 - x1) * t0, y1 + (y2 - y1) * t0, x1 + (x2 - x1) * t1, y1 + (y2 - y1) * t1, curve);
    });
  };

  /** The path after W / W* becomes a clip region, intersected with those in force. */
  const addClip = (data: ArrayLike<number>, evenOdd: boolean) => {
    const edges: ClipRegion["edges"] = [];
    walkPath(data, ctm, true, (x1, y1, x2, y2) => void edges.push([x1, y1, x2, y2]));
    if (!edges.length) return; // no geometry: clips nothing
    const xs = edges.flatMap((e) => [e[0], e[2]]);
    const ys = edges.flatMap((e) => [e[1], e[3]]);
    clips = [...clips, { edges, evenOdd, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] }];
  };

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    if (fn === OPS.save) stack.push(state());
    else if (fn === OPS.restore) ({ ctm, lineWidth, paperFill, dashed, clips } = stack.pop() ?? state());
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(state());
      if (Array.isArray(args?.[0]) || ArrayBuffer.isView(args?.[0])) ctm = mul(ctm, Array.from(args[0] as ArrayLike<number>));
    } else if (fn === OPS.paintFormXObjectEnd) ({ ctm, lineWidth, paperFill, dashed, clips } = stack.pop() ?? state());
    else if (fn === OPS.setLineWidth) lineWidth = args[0];
    else if (fn === OPS.setFillRGBColor) paperFill = isPaper(args?.[0]);
    else if (fn === OPS.setFillColorN || fn === OPS.setFillTransparent) paperFill = false;
    else if (fn === OPS.setDash) dashed = Array.isArray(args?.[0]) && (args[0] as number[]).some((v) => v > 0);
    else if (fn === OPS.setGState) for (const [key, value] of args[0] as [string, unknown][]) key === "LW" && typeof value === "number" && (lineWidth = value);
    else if (fn === OPS.clip || fn === OPS.eoClip) pendingClip = fn === OPS.eoClip;
    else if (fn === OPS.constructPath) {
      const data = args?.[1]?.[0] as ArrayLike<number> | null | undefined;
      // The clip applies after this path is painted (PDF: W takes effect at the painting operator).
      if (data) addPath(data, args[0]);
      if (pendingClip !== null) {
        if (data) addClip(data, pendingClip);
        pendingClip = null;
      }
    } else if (IMAGE.has(fn)) {
      // An image fills the unit square of its CTM.
      const corners = [apply(ctm, 0, 0), apply(ctm, 1, 0), apply(ctm, 1, 1), apply(ctm, 0, 1)];
      const xs = corners.map((c) => c[0]);
      const ys = corners.map((c) => c[1]);
      images.push({ area: Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]), x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
    }
  }

  const texts: PdfText[] = [];
  const content = await page.getTextContent();
  if (content.items.length > maxTexts) throw new BlueprintError(tooManyTexts(maxTexts));
  for (const item of content.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    const t = item.transform as number[];
    const [x, y] = apply(base, t[4], t[5]);
    const [ux, uy] = [base[0] * t[0] + base[2] * t[1], base[1] * t[0] + base[3] * t[1]]; // text x axis in the viewport
    const [vx, vy] = [base[0] * t[2] + base[2] * t[3], base[1] * t[2] + base[3] * t[3]]; // text y axis
    texts.push({ str: item.str, x, y, rotation: (Math.atan2(uy, ux) * 180) / Math.PI, height: Math.hypot(vx, vy), width: item.width });
  }

  const lineLength = segments.reduce((s, g) => s + Math.hypot(g.x2 - g.x1, g.y2 - g.y1), 0);
  const imageCover = images.reduce((m, im) => Math.max(m, im.area), 0) / (width * height);
  const meaningful = meaningfulLines({ segments, lineLength, width, height });
  const picture = imageCover >= CLASSIFY.scanCover;
  const kind = picture ? (meaningful ? "mixed" : "scanned") : "vector";
  return { width, height, rotate: viewport.rotation, paper, segments, texts, images, pathOps, lineLength, imageCover, kind };
}
