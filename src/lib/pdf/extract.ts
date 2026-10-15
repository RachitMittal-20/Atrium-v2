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
  // pdf.js's path command codes inside constructPath (its DrawOPS, not exported).
  const DRAW = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 };
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
  const stack: { ctm: M; lineWidth: number }[] = [];

  /** Adds the straight pieces of one painted path, in viewport points. */
  let pathIndex = 0;
  const addPath = (data: ArrayLike<number>, op: number) => {
    const path = pathIndex++; // every painted path gets its own number (walls.ts groups a filled polygon's edges by it)
    const stroked = STROKE.has(op) || BOTH.has(op);
    const filled = FILL.has(op) || BOTH.has(op);
    if (!stroked && !filled) return; // endPath: a clip only
    const closeAll = filled || CLOSES.has(op);
    const w = stroked ? lineWidth * Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])) : 0;
    let cx = 0;
    let cy = 0;
    let sx = 0;
    let sy = 0;
    let open = false; // a subpath has started
    const seg = (x1: number, y1: number, x2: number, y2: number, curve = false) => {
      if (x1 === x2 && y1 === y2) return;
      if (segments.length >= maxSegments) throw new BlueprintError(tooManySegments(maxSegments));
      segments.push({ x1, y1, x2, y2, width: w, filled, path, curve });
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
  };

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    if (fn === OPS.save) stack.push({ ctm: [...ctm], lineWidth });
    else if (fn === OPS.restore) ({ ctm, lineWidth } = stack.pop() ?? { ctm, lineWidth });
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push({ ctm: [...ctm], lineWidth });
      if (Array.isArray(args?.[0]) || ArrayBuffer.isView(args?.[0])) ctm = mul(ctm, Array.from(args[0] as ArrayLike<number>));
    } else if (fn === OPS.paintFormXObjectEnd) ({ ctm, lineWidth } = stack.pop() ?? { ctm, lineWidth });
    else if (fn === OPS.setLineWidth) lineWidth = args[0];
    else if (fn === OPS.setGState) for (const [key, value] of args[0] as [string, unknown][]) key === "LW" && typeof value === "number" && (lineWidth = value);
    else if (fn === OPS.constructPath) {
      const data = args?.[1]?.[0] as ArrayLike<number> | null | undefined;
      if (data) addPath(data, args[0]);
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
