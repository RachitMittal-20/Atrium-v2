/**
 * make-pdf-fixtures.ts — writes tests/fixtures/pdf/ (step M.1a): floor-plan PDFs
 * drawn with pdf-lib from the sample plan's known geometry (src/data/samplePlan.ts,
 * a 10 × 8 m house), and truth.json with what each one must read as.
 *
 *   plan-filled.pdf    walls as filled polygons, dimension lines in mm, room names,
 *                      title block "SCALE 1:100", A4
 *   plan-lines.pdf     the same with each wall piece drawn as a stroked outline
 *   plan-fit.pdf       plan-filled scaled to 87% (a cm matrix) while the title block
 *                      still says 1:100: the page "printed to fit"
 *   plan-rotated.pdf   plan-filled with /Rotate 90
 *   plan-imperial.pdf  the plan at 3.5 ft per sample metre (1.0668 m), dimensions in
 *                      feet and inches (14'-0", 21' 0", 17 ft 6 in), title block
 *                      1/8" = 1'-0", US Letter
 *   plan-two-pages.pdf a cover page (text and a border), then plan-filled
 *   plan-scanned.pdf   only a raster image of plan-filled (150 dpi, grey PNG)
 *   plan-single-line.pdf plan-filled with the bathroom's top wall (w-KM) drawn as ONE stroked
 *                      line as thick as the wall, as CAD often draws thin walls: no pair of
 *                      faces, so in step M.1b that wall could only be traced; since step S.1 a
 *                      stroke 50–600 mm wide is a wall, and it is read from the PDF
 *   plan-small-on-big.pdf (step X.1) plan-filled at 1:100 on an A0 landscape sheet, the
 *                      drawing and its title block in the middle and the rest of the sheet
 *                      empty: the page reader must render only the drawing's content box,
 *                      within the pixel budget
 *   plan-no-dims.pdf   plan-filled without dimensions: walls, names, title block only
 *   plan-clutter.pdf   plan-lines plus clutter (step M.1b): 45° hatching inside the
 *                      exterior walls, a 1.2 × 0.6 m table, two boxed door tags
 *                      ("01", "02"), a 0.5 m stray line and a free-standing diagonal
 *                      wall (2 m, 0.1 m thick, 45°)
 *   plan-broken-dims.pdf plan-filled with every dimension line broken around its text
 *                      (the text sits on the line), short perpendicular ticks instead of
 *                      extension lines, the first line overshooting its ticks by 5 mm
 *                      (real size) at each end, and the overall 10 m line with no ticks
 *   plan-doors.pdf     step M.1c, SYNTHETIC: the sample's walls with eleven openings drawn
 *                      the way CAD draws them, door swings as POLYLINE arcs (16 straight
 *                      pieces a quarter; every other fixture's swings are Bézier curves):
 *                      single doors in all four hinge / side combinations (hinge at the
 *                      wall's a or b jamb, leaf to either side, so into and out of rooms),
 *                      a double door (two 0.8 m leaves), a sliding door (two staggered
 *                      panels, no arc), windows with three glazing lines (faces and glass)
 *                      and with two glazing lines in a real gap, a bare gap (unclassified),
 *                      two printed opening widths, and decoy arcs (as Béziers): a
 *                      quarter-round sink (r 0.35 m, with a radius line), a chair back
 *                      (r 0.25 m, 120°), a stair's walking line (r 1.8 m, with a radius
 *                      line) and a quarter circle with NO leaf hinged at the bare gap's jamb
 *   plan-single-stroke.pdf (step S.1, SYNTHETIC) every wall drawn as ONE stroked line on its centre
 *                      line, as wide as the wall (230 mm exterior, 115 mm interior at 1:100),
 *                      node to node with butt caps (so a half-thickness notch at each corner),
 *                      broken at openings: line-leaf doors in all four hinge / side combinations,
 *                      three-line windows, twelve thin stair treads against a partition, the
 *                      plan-furniture set and ticked mm dimensions. -round and -square: the same
 *                      with round or square caps; -mixed: the exterior walls as paired outlines
 *                      drawn with a heavy 1.5 pt pen (53 mm at 1:100), the interior single strokes
 *   plan-traced-wall.pdf (step S.1, SYNTHETIC) plan-filled with the bathroom's top wall (w-KM) drawn
 *                      as an embedded PICTURE of a black bar, no vector line: the one wall only the
 *                      tracing can see (plan-single-line's single stroke is read from the PDF since S.1)
 *   plan-outlined.pdf  plan-filled with NO text items: room names and the title block
 *                      "converted to outlines" (each string drawn by @napi-rs/canvas in
 *                      Arial and its ink turned into filled rectangles, row runs merged
 *                      down), and every dimension text a small embedded greyscale PNG
 *                      (drawn the same way at 300 dpi) so OCR can read it. SYNTHETIC: real
 *                      CAD outlines are glyph curves, not pixel rectangles.
 *
 * Truth is computed here, independently of pdf.js: every straight segment drawn,
 * every door arc (centre and radius), every text item (baseline start, reading
 * angle, height, width), every dimension (value and line length), all in VIEWPORT
 * points (y down) after the fixture's own matrix and /Rotate (for /Rotate 90 a
 * user-space point (x, y) shows at (y, x)), plus the true metres per point and
 * the true walls in metres.
 *
 * Step M.1b also records each wall and opening in the PAGE's frame (planWalls,
 * planOpenings: viewport axes, metres, origin at the top-left of the centre lines),
 * so a reading of plan-rotated compares directly, and each dimension's measured
 * length and how (between its ticks, or the line's length).
 *
 * misprintedPdf() makes plan-filled with one dimension printed wrong (4100 mm on a
 * 4 m line) for scripts/e2e-pdf-import.ts; it is written to /tmp, never committed.
 * Door arcs are cubic Béziers (k = 0.5523 r), so they test curve flattening.
 * Step M.1c records each opening's class, and for a door with a swing its hinge
 * jamb and the side its leaf opens to (a unit vector in the page's frame), so a
 * reading compares without knowing which way the wall runs.
 * Run: npx tsx scripts/make-pdf-fixtures.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendBezierCurve,
  clip,
  closePath,
  concatTransformationMatrix,
  degrees,
  endPath,
  fill,
  LineCapStyle,
  lineTo,
  moveTo,
  PDFDocument,
  type PDFFont,
  type PDFOperator,
  type PDFPage,
  popGraphicsState,
  pushGraphicsState,
  setDashPattern,
  setFillingGrayscaleColor,
  setLineCap,
  setLineWidth,
  StandardFonts,
  stroke,
} from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";
import sharp from "sharp";
import { samplePlan } from "../src/data/samplePlan";
import type { Opening } from "../src/types/plan";
import { renderNode, openNode } from "./pdf-node";

export const OUT = join(__dirname, "../tests/fixtures/pdf");
const A4: [number, number] = [595.28, 841.89];
const LETTER: [number, number] = [612, 792];
const A0_LANDSCAPE: [number, number] = [3370.39, 2383.94];
const PT_PER_IN = 72;
const FT_PER_SAMPLE_M = 3.5; // the imperial plan: one sample metre drawn as 3'-6"

type Seg = [number, number, number, number, number, boolean]; // x1 y1 x2 y2 width filled
export interface Truth {
  file: string;
  pages: number;
  /** 1-based page holding the plan. */
  planPage: number;
  rotate: number;
  viewport: { width: number; height: number };
  kind: "vector" | "scanned" | "mixed";
  /** True metres per viewport point. */
  mPerPt: number;
  title: string | null;
  expectedScale: "good" | "check" | "none";
  /** Expected mismatch measured ratio (plan-fit), or null. */
  mismatchRatio: number | null;
  /** lengthPt: what should be measured (between the ticks, or the line); lineLengthPt: the drawn line (step M.1b). */
  dims: { text: string; metres: number; lengthPt: number; measure?: "ticks" | "line"; lineLengthPt?: number; spans?: "opening width" | "inside faces" | "outside faces" }[];
  segments: Seg[];
  arcs: { cx: number; cy: number; r: number }[];
  texts: { str: string; x: number; y: number; rotation: number; height: number; width: number }[];
  rooms: string[];
  /** The plan's walls in metres (centre lines), the sample's ids. */
  walls: { id: string; a: { x: number; y: number }; b: { x: number; y: number }; thickness: number }[];
  /** Step M.1b: the same walls in the page's frame (viewport axes, origin the top-left of the centre lines). */
  planWalls: { id: string; a: { x: number; y: number }; b: { x: number; y: number }; thickness: number }[];
  /** Step M.1b: every opening's two jambs on its wall's centre line, in the page's frame. */
  planOpenings: {
    id: string;
    kind: "door" | "window";
    wallId: string;
    a: { x: number; y: number };
    b: { x: number; y: number };
    /** Step M.1c: how it is drawn, as openings.ts must classify it. */
    class?: "door" | "double" | "sliding" | "window" | "unclassified";
    /** Doors with a swing: the hinge jamb (on the centre line) and the leaf's side (unit vector), page frame. */
    hinge?: { x: number; y: number };
    side?: { x: number; y: number };
    /** Step M.1d: which jamb of the BUILT wall the leaf must pivot on ("a" is nearer its a end). */
    hingeEnd?: "a" | "b";
  }[];
  /** Step M.1c: decoy arcs drawn (never swings). */
  decoyArcs?: number;
  /** Step M.1d: the sizes (m) of the collinear gaps drawn OUTSIDE 0.45–4 m, in the order
   *  walls.ts reads them (along each wall, walls in reading order). They are not openings. */
  outOfRangeGaps?: number[];
  /** plan-clutter: diagonal walls drawn (never read, counted). */
  diagonal?: number;
  /** plan-single-line: walls that can only be traced (the sample's ids). */
  tracedWalls?: string[];
}

/**
 * Text "converted to outlines" (plan-outlined): the string drawn by the canvas in
 * Arial at RES px per point, and every run of ink in a row merged with identical
 * runs in the rows below into one rectangle. Rectangles in points from the
 * baseline start, y UP: [x, y, w, h].
 */
function glyphRects(str: string, size: number): [number, number, number, number][] {
  const RES = 4;
  const ink = inkOf(str, size, RES);
  const rects: [number, number, number, number][] = [];
  let open = new Map<string, { y0: number; x0: number; x1: number }>();
  for (let y = 0; y <= ink.h; y++) {
    const next = new Map<string, { y0: number; x0: number; x1: number }>();
    for (let x = 0; y < ink.h && x < ink.w; ) {
      if (!ink.at(x, y)) {
        x++;
        continue;
      }
      const x0 = x;
      while (x < ink.w && ink.at(x, y)) x++;
      const key = `${x0},${x}`;
      next.set(key, open.get(key) ?? { y0: y, x0, x1: x });
      open.delete(key);
    }
    for (const r of open.values()) rects.push([r.x0 / RES, (ink.base - y) / RES, (r.x1 - r.x0) / RES, (y - r.y0) / RES]);
    open = next;
  }
  return rects;
}

/** A string drawn black on transparent by the canvas: `at(x, y)` is ink (alpha over half), `base` the baseline row. */
function inkOf(str: string, size: number, res: number) {
  const px = size * res;
  const probe = createCanvas(1, 1).getContext("2d");
  probe.font = `${px}px Arial`;
  const w = Math.ceil(probe.measureText(str).width) + 2;
  const h = Math.ceil(px * 1.4);
  const base = Math.round(px * 1.1);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.font = `${px}px Arial`;
  ctx.fillStyle = "#000";
  ctx.fillText(str, 1, base);
  const data = ctx.getImageData(0, 0, w, h).data;
  return { w, h, base, canvas, at: (x: number, y: number) => data[(y * w + x) * 4 + 3] > 127 };
}

/** A string as a small greyscale PNG at 300 dpi (plan-outlined's dimension texts), its baseline 1.1 size from the top. */
async function textPng(str: string, size: number): Promise<{ png: Buffer; wPt: number; hPt: number }> {
  const res = 300 / 72;
  const { canvas, w, h } = inkOf(str, size, res);
  const ctx = canvas.getContext("2d");
  ctx.globalCompositeOperation = "destination-over"; // white paper under the black text
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  const png = await sharp(canvas.toBuffer("image/png")).greyscale().png({ palette: true, colours: 4 }).toBuffer();
  return { png, wPt: w / res, hPt: h / res };
}

/** Draws into one page and records the truth in viewport points. */
class Pen {
  ops: PDFOperator[] = [];
  segments: Seg[] = [];
  arcs: Truth["arcs"] = [];
  texts: Truth["texts"] = [];
  constructor(
    private page: PDFPage,
    private font: PDFFont,
    /** user space -> viewport points (the fixture's cm and /Rotate). */
    private view: (x: number, y: number) => [number, number],
    /** the cm's uniform scale (stroke widths, text sizes). */
    private k: number,
  ) {}
  private v = (p: number[]) => this.view(p[0], p[1]);
  private seg(p: number[], q: number[], w: number, filled: boolean) {
    const [a, b] = [this.v(p), this.v(q)];
    this.segments.push([a[0], a[1], b[0], b[1], w * this.k, filled]);
  }
  line(p: number[], q: number[], w: number) {
    this.ops.push(setLineWidth(w), moveTo(p[0], p[1]), lineTo(q[0], q[1]), stroke());
    this.seg(p, q, w, false);
  }
  /** A closed polygon, filled (width 0) or stroked. */
  poly(pts: number[][], mode: "fill" | "stroke", w = 0.5) {
    this.ops.push(...(mode === "stroke" ? [setLineWidth(w)] : []), moveTo(pts[0][0], pts[0][1]), ...pts.slice(1).map((p) => lineTo(p[0], p[1])), closePath(), mode === "fill" ? fill() : stroke());
    pts.forEach((p, i) => this.seg(p, pts[(i + 1) % pts.length], mode === "fill" ? 0 : w, mode === "fill"));
  }
  /** Step Q.2: a dash-dot line (5, 2, 0.8, 2 pt), as CAD draws a centre or setting-out line. */
  dashed(p: number[], q: number[], w: number) {
    this.ops.push(pushGraphicsState(), setDashPattern([5, 2, 0.8, 2], 0), setLineWidth(w), moveTo(p[0], p[1]), lineTo(q[0], q[1]), stroke(), popGraphicsState());
    this.seg(p, q, w, false);
  }
  /** Step Q.2: 45° hatching of the axis-aligned box [x0, x1] × [y0, y1] (user space), `gap` apart,
   *  drawn as lines running `over` past the box on both sides and CLIPPED to the box by a clip path,
   *  as a generated plan hatches its poche. The truth keeps only the visible, clipped parts. */
  hatch(x0: number, y0: number, x1: number, y1: number, gap: number, over: number, w: number) {
    this.ops.push(pushGraphicsState(), moveTo(x0, y0), lineTo(x1, y0), lineTo(x1, y1), lineTo(x0, y1), closePath(), clip(), endPath(), setLineWidth(w));
    const step = gap * Math.SQRT2; // along y, for lines y = x + c
    for (let c = y0 - x1 + step / 2; c < y1 - x0; c += step) {
      const [ax, bx] = [x0 - over, x1 + over];
      this.ops.push(moveTo(ax, ax + c), lineTo(bx, bx + c), stroke());
      const [lo, hi] = [Math.max(x0, y0 - c), Math.min(x1, y1 - c)]; // the part inside the box
      if (hi > lo) this.seg([lo, lo + c], [hi, hi + c], w, false);
    }
    this.ops.push(popGraphicsState());
  }
  /** Step Q.2: a polygon filled in the paper's colour (white), the way a generated plan knocks a
   *  window out of its poche. It paints paper, not ink, so it is not in the truth's segments. */
  mask(pts: number[][]) {
    this.ops.push(setFillingGrayscaleColor(1), moveTo(pts[0][0], pts[0][1]), ...pts.slice(1).map((p) => lineTo(p[0], p[1])), closePath(), fill(), setFillingGrayscaleColor(0));
  }
  /** Quarter circle about c from p0 to p3 (both at radius r), as one cubic Bézier. */
  arc(c: number[], p0: number[], p3: number[], r: number, w: number) {
    const K = 0.5523 * r;
    const t0 = [(p3[0] - c[0]) / r, (p3[1] - c[1]) / r]; // tangent at p0 points along c->p3
    const t3 = [(p0[0] - c[0]) / r, (p0[1] - c[1]) / r];
    this.ops.push(setLineWidth(w), moveTo(p0[0], p0[1]), appendBezierCurve(p0[0] + t0[0] * K, p0[1] + t0[1] * K, p3[0] + t3[0] * K, p3[1] + t3[1] * K, p3[0], p3[1]), stroke());
    const [vc, vp] = [this.v(c), this.v(p0)];
    this.arcs.push({ cx: vc[0], cy: vc[1], r: Math.hypot(vp[0] - vc[0], vp[1] - vc[1]) });
  }
  /** An arc about c from angle a0 through `sweep` (radians, user space), radius r, as
   *  `n` straight pieces in ONE path (a CAD polyline arc, step M.1c). */
  polyArc(c: number[], r: number, a0: number, sweep: number, n: number, w: number) {
    const pts = Array.from({ length: n + 1 }, (_, i) => [c[0] + r * Math.cos(a0 + (sweep * i) / n), c[1] + r * Math.sin(a0 + (sweep * i) / n)]);
    this.ops.push(setLineWidth(w), moveTo(pts[0][0], pts[0][1]), ...pts.slice(1).map((p) => lineTo(p[0], p[1])), stroke());
    pts.slice(1).forEach((p, i) => this.seg(pts[i], p, w, false));
  }
  /** An arc about c from angle a0 through `sweep` (at most 120°) as one cubic Bézier (k = 4/3 tan(sweep/4)). */
  bezArc(c: number[], r: number, a0: number, sweep: number, w: number) {
    const K = (4 / 3) * Math.tan(sweep / 4) * r;
    const a1 = a0 + sweep;
    const p0 = [c[0] + r * Math.cos(a0), c[1] + r * Math.sin(a0)];
    const p3 = [c[0] + r * Math.cos(a1), c[1] + r * Math.sin(a1)];
    const t0 = [-Math.sin(a0), Math.cos(a0)];
    const t3 = [-Math.sin(a1), Math.cos(a1)];
    this.ops.push(setLineWidth(w), moveTo(p0[0], p0[1]), appendBezierCurve(p0[0] + t0[0] * K, p0[1] + t0[1] * K, p3[0] - t3[0] * K, p3[1] - t3[1] * K, p3[0], p3[1]), stroke());
    const [vc, vp] = [this.v(c), this.v(p0)];
    this.arcs.push({ cx: vc[0], cy: vc[1], r: Math.hypot(vp[0] - vc[0], vp[1] - vc[1]) });
  }
  /** Outlined text (no text item): glyph rectangles turned by `rot` about the baseline start. */
  outlined = false;
  /** Texts to draw as images once the page is otherwise done (plan-outlined's dimensions). */
  images: { str: string; x: number; y: number; size: number; rot: number }[] = [];
  private glyphs(str: string, x: number, y: number, size: number, rot: number) {
    const [c, s] = [Math.cos((rot * Math.PI) / 180), Math.sin((rot * Math.PI) / 180)];
    const to = (lx: number, ly: number) => [x + lx * c - ly * s, y + lx * s + ly * c];
    for (const [rx, ry, rw, rh] of glyphRects(str, size)) {
      const pts = [to(rx, ry), to(rx + rw, ry), to(rx + rw, ry + rh), to(rx, ry + rh)];
      this.ops.push(moveTo(pts[0][0], pts[0][1]), ...pts.slice(1).map((p) => lineTo(p[0], p[1])), closePath(), fill());
    }
  }
  /** A dimension text: real text, or (plan-outlined) a picture of it drawn later. */
  dimText(str: string, x: number, y: number, size: number, rot = 0) {
    if (this.outlined) this.images.push({ str, x, y, size, rot });
    else this.text(str, x, y, size, rot);
  }
  /** Text from baseline start (x, y), `rot` degrees anticlockwise in user space. */
  text(str: string, x: number, y: number, size: number, rot = 0) {
    if (this.outlined) return this.glyphs(str, x, y, size, rot);
    this.flush();
    this.page.drawText(str, { x, y, size, font: this.font, rotate: degrees(rot) });
    const [a, b] = [this.view(x, y), this.view(x + Math.cos((rot * Math.PI) / 180), y + Math.sin((rot * Math.PI) / 180))];
    this.texts.push({ str, x: a[0], y: a[1], rotation: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI, height: size * this.k, width: this.font.widthOfTextAtSize(str, size) * this.k });
  }
  width = (str: string, size: number) => this.font.widthOfTextAtSize(str, size);
  /** Writes the pending path operators to the page (before text, which pdf-lib writes directly). */
  flush() {
    if (this.ops.length) this.page.pushOperators(...this.ops);
    this.ops = [];
  }
}

interface Options {
  walls: "fill" | "stroke";
  /** "bare" (step Q.1): millimetres printed as bare numbers ("4000"), as metric CAD prints them. */
  dims: "mm" | "imperial" | "bare" | null;
  /** Step Q.1: a general note printed in the title block, e.g. "ALL DIMENSIONS IN mm". */
  note?: string;
  /** Step Q.1 (plan-dims-close): dimension strings drawn CLOSE to the walls instead of the usual set,
   *  the way a generated drawing draws them: extension lines from the measured face to the dimension
   *  line, ending on it; a string 0.35 m off the outer face and a second one stacked 0.25 m beyond it;
   *  and one across a room whose ends sit on the two wall faces it measures. */
  closeDims?: boolean;
  /** Step Q.1 (plan-against-wall): a bath (outline and rim, 0.7 × 1.8 m) standing 5 cm off the
   *  bathroom's east wall, so its back lines lie within 0.6 m of that wall's OUTER face with the
   *  inner face between; and a centre line drawn lengthwise through the west wall, 0.4 m past
   *  both of its ends. */
  againstWall?: boolean;
  /** Step Q.1 (plan-window-board): an interior window board (sill) drawn as one line 0.1 m in front
   *  of the living room's north window and 5 cm past each jamb, within 0.6 m of its glazing lines. */
  windowBoard?: boolean;

  /** Step Q.1 (plan-furniture): a corner cupboard of two thin double-line partitions in bedroom 1
   *  (a 0.6 × 0.45 m loop with the room's walls), and free-standing furniture drawn as a generated
   *  plan draws it: a sofa of nested rectangles, a bed with pillows and a duvet fold, a bath with
   *  its rim, and two 0.5 m square columns, one stroked and one filled. */
  furniture?: boolean;
  fit?: number;
  rotate?: number;
  imperial?: boolean;
  /** Prints the first dimension as 4100 mm on its 4 m line (scripts/e2e-pdf-import.ts). */
  misprint?: boolean;
  /** Step M.1b: dimension lines broken around their text, with ticks (plan-broken-dims). */
  broken?: boolean;
  /** Step M.1b: hatching, furniture, text boxes, a stray line and a diagonal wall (plan-clutter). */
  clutter?: boolean;
  /** Step M.1b: no text items; outlines and pictures of text (plan-outlined). */
  outlined?: boolean;
  /** Step M.1b: these walls as one stroked line each, as thick as the wall (plan-single-line). */
  singleLine?: string[];
  /** Step M.1c (plan-doors): these openings in place of the sample's, swings as polyline arcs,
   *  the decoy arcs, and two printed opening widths (the north dimensions move out to make room). */
  doors?: FixtureOpening[];
  /** Step M.1d: draw the four decoy arcs. Defaults to true whenever `doors` is given; plan-gaps
   *  turns them off, because it is about gaps, not arcs. */
  decoys?: boolean;
  /** Step Q.2 (plan-poche-mask): every window knocked out of the poche by a white filled rectangle
   *  6 mm past each jamb and 15 mm past each face, painted before its glazing lines. */
  masks?: boolean;
  /** Step Q.2 (plan-centre-lines): a dash-dot centre line along every wall, end to end through its
   *  openings, and a solid finish line 80 mm off the centre line of the bedrooms' partition (w-HI). */
  centreLines?: boolean;
  /** Step Q.2 (plan-poche-hatch): 45° hatching in every exterior wall piece, 0.04 m apart, each line
   *  running 1.5 m past the piece and clipped to it by a clip path. */
  clipHatch?: boolean;
  /** Step Q.2 (plan-finish-line): a finish line 30 mm off the bedrooms' face of the w-BI / w-IF
   *  partition (x 3.92, y 3.4 to 5.5) and, across that partition, the back of a living-room shelf
   *  drawn as one line 0.15 m off its other face (x 4.2, y 3.7 to 4.3), level with w-HI's end. */
  finishLine?: boolean;
  /** Step Q.2 (plan-title-block): the title block ruled into rows 15 pt apart (0.53 m at 1:100) as a
   *  CAD title block is, and a sheet border 20 pt inside the page edge. */
  titleRows?: boolean;
  /** Step Q.2 (plan-outbuilding): a detached 4 × 3 m shed in poche (0.2 m walls, centre lines x 0.5
   *  to 4.5, y 10.5 to 13.5), below the house and joined to nothing, with no title-block text. */
  outbuilding?: boolean;
  /** Step Q.2 (plan-stem-in-window): a 0.1 m partition across bedroom 1 at y 2, from w-BI to the west
   *  wall, whose poche runs into the middle of bedroom 1's west window (win-bed1, y 1.4 to 2.6). */
  stemInWindow?: boolean;
  /** Step Q.2 (plan-poche-diagonal): in bedroom 2, a 0.1 m partition from w-HI at x 2 down to y 6.5,
   *  then a 45° poche wall from there to the south wall (w-FG) at x 0.5, each a filled rectangle
   *  running half its thickness past its ends, as a generated poche plan chamfers a corner. */
  diagonal?: boolean;
  /** Step Q.2 (plan-free-end): a 0.1 m nib wall 1 m long standing out from the living room's north wall
   *  at x 8, its far end free (a wing wall), drawn like the other walls. */
  nib?: boolean;
  /** Step Q.2 (plan-dims-chain): one more string, 0 to 1.5 m, drawn after the others on the SAME line
   *  as the 0 to 4 m one, so its text lies over both lines (a generated plan draws two such strings). */
  overlapDim?: boolean;
  /** Step Q.2 (plan-dims-one-wrong): the first dimension printed as this text instead (a value far
   *  off its line, unlike `misprint`'s 2.5%), every other dimension right. */
  wrongFirst?: string;
  /** Step Q.2b (plan-levels): level notes beside the room names, as a plan prints floor levels:
   *  "FFL +0.150" under Bedroom 1, "+0.000" under Bedroom 2, "LEVEL 1" and "SSL +0.100" under the
   *  living room, and "FL -0.020" on the Bathroom's own line (so it joins the name's text line). */
  levels?: boolean;
  /** Step H.1 (plan-strips): draw THESE walls instead of the sample's, with no openings: parallel
   *  strips that touch nothing, so the PDF has plenty of wall-like line work but no building. */
  strips?: typeof samplePlan.walls;
  /** Step S.1 (plan-traced-wall): these walls drawn as an embedded picture of a black bar (their
   *  footprint, half the thickness past each end), no vector line: only the tracing can see them. */
  pictureWalls?: string[];
  /** Step S.1 (plan-single-stroke): every wall as ONE stroked line on its centre line, node to node,
   *  as wide as the wall (sample 0.2 m walls drawn 0.23 m, 0.1 m ones 0.115 m), broken at its
   *  openings, with this line cap on every line of the page. `mixed`: the exterior walls drawn as
   *  paired outlines (`walls` mode) with a heavy pen instead, the interior ones as single strokes. */
  stroke?: { cap: "butt" | "round" | "square"; mixed?: boolean };
  /** Step S.1: twelve thin stair treads, 1 m long and 0.22 m apart, standing on the south wall's
   *  inside face (w-LF, 0.23 m: y 7.885) in the living room, x 4.3 to 6.72. */
  stairs?: boolean;
  /** Step X.1 (plan-small-on-big): the sheet's size in points and where the drawing sits on it
   *  (added to every user-space position), so a small plan can sit on a big, mostly empty sheet. */
  sheet?: { name: string; size: [number, number]; shift: [number, number] };
}

/**
 * An opening as plan-doors draws it, on a sample wall (offset from the sample's a end).
 * `hinge` is the jamb the leaf hangs on ("a": nearer the sample wall's a end) and `side`
 * +1 to open to the sample wall's (-dy, dx) side, -1 to the other.
 */
interface FixtureOpening {
  id: string;
  wallId: string;
  offset: number;
  width: number;
  /** "oddgap" (step M.1d) is a bare gap drawn OUTSIDE 0.45–4 m: never an opening, only reported. */
  /** "sill2" (step Q.2): two glazing lines 28 mm either side of the centre line, a jamb line across
   *  the wall at each end and a sill line 35 mm inside the room's face, as a generated poche plan draws a window. */
  style: "door" | "double" | "sliding" | "window3" | "window2" | "gap" | "oddgap" | "glass3" | "sill2";
  hinge?: "a" | "b";
  side?: 1 | -1;
  /** Step M.1d: how the swing arc is drawn (default a polyline), and the leaf as a thin
   *  closed rectangle 60 mm across instead of one line (plan-doors-rect). */
  arc?: "poly" | "bezier";
  leaf?: "line" | "rect";
  /** Step Q.1 (plan-strike-jamb), as a generated plan draws a swing: the hinge on the FACE on the
   *  leaf's side, the arc (a Bézier) ending exactly at the strike jamb's face corner, where the
   *  wall's face goes on. "open": the leaf drawn open, square to the wall; "closed": the leaf
   *  drawn shut along the face across the gap, the arc sweeping out to the open position. */
  strike?: "open" | "closed";
}

/** plan-doors' openings (step M.1c). The sample's a→b: BC east, BI / IF / KL / CM south, LF west, HA / GH north, EL west. */
const DOOR_FIXTURE: FixtureOpening[] = [
  { id: "d-front", wallId: "w-BC", offset: 3, width: 1, style: "door", hinge: "a", side: 1 }, // into the living room
  { id: "d-bed1", wallId: "w-BI", offset: 2.9, width: 0.9, style: "door", hinge: "b", side: 1 }, // into bedroom 1
  { id: "d-bed2", wallId: "w-IF", offset: 2, width: 0.9, style: "door", hinge: "a", side: -1 }, // out of bedroom 2
  { id: "d-bath", wallId: "w-KL", offset: 1.5, width: 0.8, style: "door", hinge: "b", side: -1 }, // into the bathroom
  { id: "dd-living", wallId: "w-LF", offset: 1.5, width: 1.6, style: "double", side: 1 }, // two 0.8 m leaves into the living room
  { id: "sl-living", wallId: "w-CM", offset: 1.2, width: 1.6, style: "sliding" },
  { id: "win-living-e", wallId: "w-CM", offset: 3.6, width: 1.2, style: "window3" },
  { id: "win-living-n", wallId: "w-BC", offset: 5, width: 1.2, style: "window3" },
  { id: "win-bed1", wallId: "w-HA", offset: 2, width: 1.2, style: "window2" },
  { id: "gap-bed2", wallId: "w-GH", offset: 2, width: 1, style: "gap" },
  { id: "win-bath", wallId: "w-EL", offset: 1.5, width: 0.6, style: "window3" },
];
const CLASS_OF = { door: "door", double: "double", sliding: "sliding", window3: "window", window2: "window", glass3: "window", sill2: "window", gap: "unclassified", oddgap: "unclassified" } as const;
/** plan-doors-rect (step M.1d): the same house with every leaf drawn as a thin closed
 *  rectangle, Bézier arcs on some doors and polyline arcs on others, and TWO doors on the
 *  north wall (w-BC) hinged at opposite jambs and opening to opposite sides. */
const RECT_FIXTURE: FixtureOpening[] = [
  { id: "dr-a", wallId: "w-BC", offset: 1.5, width: 0.9, style: "door", hinge: "a", side: 1, arc: "bezier", leaf: "rect" }, // hinge at w-BC's a jamb, into the living room
  { id: "dr-b", wallId: "w-BC", offset: 4.4, width: 0.9, style: "door", hinge: "b", side: -1, arc: "poly", leaf: "rect" }, // the SAME wall, the other jamb and the other side
  { id: "dr-bed1", wallId: "w-BI", offset: 2.9, width: 0.9, style: "door", hinge: "b", side: 1, arc: "bezier", leaf: "rect" },
  { id: "dr-bed2", wallId: "w-IF", offset: 2, width: 0.9, style: "door", hinge: "a", side: -1, arc: "poly", leaf: "rect" },
  { id: "dr-bath", wallId: "w-KL", offset: 1.5, width: 0.8, style: "door", hinge: "b", side: -1, arc: "bezier", leaf: "rect" },
  { id: "ddr-living", wallId: "w-LF", offset: 1.5, width: 1.6, style: "double", side: 1, arc: "poly", leaf: "rect" },
  { id: "slr-living", wallId: "w-CM", offset: 1.2, width: 1.6, style: "sliding" },
  { id: "winr-living-e", wallId: "w-CM", offset: 3.6, width: 1.2, style: "window3" },
  { id: "winr-bed1", wallId: "w-HA", offset: 2, width: 1.2, style: "window2" },
  { id: "gapr-bed2", wallId: "w-GH", offset: 2, width: 1, style: "gap" }, // the leafless decoy arc is centred on this jamb
  { id: "winr-bath", wallId: "w-EL", offset: 1.5, width: 0.6, style: "window3" },
];
/** plan-gaps (step M.1d): the sample's openings, plus a 0.30 m gap (closed as wall) and a
 *  4.60 m gap (too wide to bridge) on walls long enough to hold them. No decoy arcs. */
const GAP_FIXTURE: FixtureOpening[] = [
  { id: "gap-wide", wallId: "w-BC", offset: 3, width: 4.6, style: "oddgap" },
  { id: "gap-narrow", wallId: "w-BI", offset: 1, width: 0.3, style: "oddgap" },
  { id: "dg-bed1", wallId: "w-BI", offset: 2.9, width: 0.9, style: "door", hinge: "a", side: 1, arc: "poly", leaf: "line" },
  { id: "dg-bed2", wallId: "w-IF", offset: 2, width: 0.9, style: "door", hinge: "a", side: 1, arc: "poly", leaf: "line" },
  { id: "dg-bath", wallId: "w-KL", offset: 1.5, width: 0.8, style: "door", hinge: "a", side: 1, arc: "poly", leaf: "line" },
  { id: "wing-bed1", wallId: "w-HA", offset: 2, width: 1.2, style: "window3" },
  { id: "wing-bed2", wallId: "w-GH", offset: 2, width: 1.2, style: "window3" },
  { id: "wing-living-e", wallId: "w-CM", offset: 2.5, width: 1.2, style: "window3" },
  { id: "wing-bath", wallId: "w-EL", offset: 1.5, width: 0.6, style: "window3" },
];
/** plan-strike-jamb (step Q.1): the sample's openings, but bedroom 1's partition (w-BI) carries two
 *  doors with 0.8 m of wall between them and 0.7 m beyond, their arcs ending at the strike jamb's
 *  face corner, and the bathroom door's leaf is drawn shut (1.15 m of wall beyond it). */
const STRIKE_FIXTURE: FixtureOpening[] = [
  { id: "d-front", wallId: "w-BC", offset: 3, width: 1, style: "door", hinge: "a", side: 1, arc: "bezier" },
  { id: "sj-bed1a", wallId: "w-BI", offset: 1.2, width: 0.9, style: "door", hinge: "a", side: 1, strike: "open" },
  { id: "sj-bed1b", wallId: "w-BI", offset: 2.9, width: 0.9, style: "door", hinge: "a", side: 1, strike: "open" },
  { id: "d-bed2", wallId: "w-IF", offset: 2, width: 0.9, style: "door", hinge: "a", side: 1, arc: "bezier" },
  { id: "sj-bath", wallId: "w-KL", offset: 1.5, width: 0.8, style: "door", hinge: "a", side: 1, strike: "closed" },
  { id: "win-bed1", wallId: "w-HA", offset: 2, width: 1.2, style: "window3" },
  { id: "win-bed2", wallId: "w-GH", offset: 2, width: 1.2, style: "window3" },
  { id: "win-living-n", wallId: "w-BC", offset: 5, width: 1.2, style: "window3" },
  { id: "win-living-e", wallId: "w-CM", offset: 2.5, width: 1.2, style: "window3" },
  { id: "win-bath", wallId: "w-EL", offset: 1.5, width: 0.6, style: "window3" },
];
/** plan-single-stroke (step S.1): doors with line leaves in all four hinge / side combinations (two
 *  swings as Béziers, two as polylines) and every window as three thin lines across its gap. */
const STROKE_FIXTURE: FixtureOpening[] = [
  { id: "d-front", wallId: "w-BC", offset: 3, width: 1, style: "door", hinge: "a", side: 1, arc: "bezier" },
  { id: "d-bed1", wallId: "w-BI", offset: 2.9, width: 0.9, style: "door", hinge: "b", side: 1 },
  { id: "d-bed2", wallId: "w-IF", offset: 2, width: 0.9, style: "door", hinge: "a", side: -1, arc: "bezier" },
  { id: "d-bath", wallId: "w-KL", offset: 1.5, width: 0.8, style: "door", hinge: "b", side: -1 },
  { id: "win-bed1", wallId: "w-HA", offset: 2, width: 1.2, style: "window3" },
  { id: "win-bed2", wallId: "w-GH", offset: 2, width: 1.2, style: "window3" },
  { id: "win-living-n", wallId: "w-BC", offset: 5, width: 1.2, style: "window3" },
  { id: "win-living-e", wallId: "w-CM", offset: 2.5, width: 1.2, style: "window3" },
  { id: "win-bath", wallId: "w-EL", offset: 1.5, width: 0.6, style: "window3" },
];
/** plan-centre-lines (step Q.2): the sample's openings, with a sliding door on the living room's
 *  east wall (w-CM) and that wall's window moved along to make room, as plan-doors has them. */
const CENTRE_FIXTURE: FixtureOpening[] = [
  { id: "d-front", wallId: "w-BC", offset: 3, width: 1, style: "door", hinge: "a", side: 1, arc: "bezier" },
  { id: "d-bed1", wallId: "w-BI", offset: 2.9, width: 0.9, style: "door", hinge: "a", side: 1, arc: "bezier" },
  { id: "d-bed2", wallId: "w-IF", offset: 2, width: 0.9, style: "door", hinge: "a", side: 1, arc: "bezier" },
  { id: "d-bath", wallId: "w-KL", offset: 1.5, width: 0.8, style: "door", hinge: "a", side: 1, arc: "bezier" },
  { id: "sl-living", wallId: "w-CM", offset: 1.2, width: 1.6, style: "sliding" },
  { id: "win-living-e", wallId: "w-CM", offset: 3.6, width: 1.2, style: "window3" },
  { id: "win-living-n", wallId: "w-BC", offset: 5, width: 1.2, style: "window3" },
  { id: "win-bed1", wallId: "w-HA", offset: 2, width: 1.2, style: "window3" },
  { id: "win-bed2", wallId: "w-GH", offset: 2, width: 1.2, style: "window3" },
  { id: "win-bath", wallId: "w-EL", offset: 1.5, width: 0.6, style: "window3" },
];
/** plan-window-sill (step Q.2): the sample's openings, every window drawn with a sill line ("sill2"). */
const SILL_FIXTURE: FixtureOpening[] = CENTRE_FIXTURE.filter((op) => op.style !== "sliding").map((op) => (op.style === "window3" ? { ...op, style: "sill2" as const } : op));
/** plan-window-board (step Q.1): the sample's openings, the living room's north window drawn as
 *  three glazing lines inside a real gap in the wall (faces broken), as a generated plan draws them. */
const BOARD_FIXTURE: FixtureOpening[] = STRIKE_FIXTURE.map((op) =>
  op.id === "win-living-n" ? { ...op, style: "glass3" as const } : op.strike ? { ...op, strike: undefined, arc: "bezier" as const, offset: op.id === "sj-bed1b" ? 2.9 : op.offset } : op,
).filter((op) => op.id !== "sj-bed1a");
/** A rectangle leaf's thickness (m). Inside walls.ts's 0.05–0.6 m pairing range on purpose:
 *  it would pair into a thin 0.9 m "wall" if openings.ts did not keep all four sides out. */
const LEAF_T = 0.06;

const fmtImperial = (ft: number, i: number) => {
  const whole = Math.floor(ft + 1e-9);
  const inches = Math.round((ft - whole) * 12);
  // Three printed forms, all read by parseDimension.
  return [`${whole}'-${inches}"`, `${whole}' ${inches}"`, `${whole} ft ${inches} in`][i % 3];
};

/** Draws the plan page and returns its truth. */
async function drawPlan(doc: PDFDocument, font: PDFFont, o: Options): Promise<Omit<Truth, "file" | "pages" | "planPage" | "kind" | "expectedScale" | "mismatchRatio">> {
  const [W, H] = o.sheet?.size ?? (o.imperial ? LETTER : A4);
  const [dx, dy] = o.sheet?.shift ?? [0, 0];
  const page = doc.addPage([W, H]);
  const rotate = o.rotate ?? 0;
  if (rotate) page.setRotation(degrees(rotate));
  const k = o.fit ?? 1;
  const unit = o.imperial ? FT_PER_SAMPLE_M * 0.3048 : 1; // real metres per sample metre
  const ptPerM = o.imperial ? (PT_PER_IN / 0.0254) / 96 : (PT_PER_IN / 0.0254) / 100; // 1:96 or 1:100 on paper
  const s = unit * ptPerM; // points per sample metre
  const [X0, Y0] = o.imperial ? [150 + dx, 600 + dy] : [155 + dx, 640 + dy];
  const P = (x: number, y: number) => [X0 + x * s, Y0 - y * s]; // plan (sample metres, y down) -> user space
  const cmView = (x: number, y: number): [number, number] => [x * k, y * k];
  const view = (x: number, y: number): [number, number] => {
    const [cx, cy] = cmView(x, y);
    return rotate === 90 ? [cy, cx] : [cx, H - cy];
  };
  const pen = new Pen(page, font, view, k);
  pen.outlined = Boolean(o.outlined);
  if (k !== 1) pen.ops.push(pushGraphicsState(), concatTransformationMatrix(k, 0, 0, k, 0, 0));
  if (o.stroke) pen.ops.push(setLineCap({ butt: LineCapStyle.Butt, round: LineCapStyle.Round, square: LineCapStyle.Projecting }[o.stroke.cap]));

  // Walls: one rectangle per piece between openings, extended by half its own
  // thickness at both ends so corners and T-junctions close.
  // Step S.1: a single-stroke plan's walls are 0.23 m and 0.115 m thick, as UK brick and block walls are.
  const sourceWalls = (o.strips ?? samplePlan.walls).map((w) => (o.stroke ? { ...w, thickness: w.thickness > 0.15 ? 0.23 : 0.115 } : w));
  const sourceOpenings = o.strips ? [] : samplePlan.openings;
  const pictures: [number, number, number, number][] = []; // step S.1: walls drawn as pictures, x y w h in user space
  for (const w of sourceWalls) {
    const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    const d = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L };
    const n = { x: -d.y, y: d.x };
    const t = w.thickness;
    const at = (u: number, v: number) => P(w.a.x + d.x * u + n.x * v, w.a.y + d.y * u + n.y * v);
    // The sample's openings drawn as before, or plan-doors' (step M.1c) in their own styles.
    const styleOf = (op: Opening | FixtureOpening): FixtureOpening["style"] => ("style" in op ? op.style : op.kind === "window" ? "window3" : "door");
    const gaps = (o.doors ?? sourceOpenings).filter((op) => op.wallId === w.id).map((op) => [op.offset - op.width / 2, op.offset + op.width / 2, op] as const).sort((p, q) => p[0] - q[0]);
    if (o.pictureWalls?.includes(w.id) && !gaps.length) {
      const [p, q] = [at(-t / 2, -t / 2), at(L + t / 2, t / 2)];
      pictures.push([Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1])]);
      continue;
    }
    if (o.singleLine?.includes(w.id) && !gaps.length) {
      pen.line(at(-t / 2, 0), at(L + t / 2, 0), t * s); // one line as thick as the wall (butt caps)
      continue;
    }
    /** A swing about the hinge at u = h, leaf r long to side sd, arc to the wall line at u = to.
     *  Step M.1d: the leaf is one line or a thin closed rectangle, and the arc a polyline (16
     *  straight pieces) or one cubic Bézier. */
    const swing = (h: number, to: number, r: number, sd: number, fo?: FixtureOpening | null) => {
      if (fo?.strike) {
        const f = (sd * t) / 2; // the face on the leaf's side
        const [c, tip, end] = [at(h, f), at(h, f + sd * r), at(to, f)];
        pen.line(c, fo.strike === "closed" ? end : tip, 0.35);
        const [from, until] = fo.strike === "closed" ? [end, tip] : [tip, end];
        const a0 = Math.atan2(from[1] - c[1], from[0] - c[0]);
        let sweep = Math.atan2(until[1] - c[1], until[0] - c[0]) - a0;
        sweep -= 2 * Math.PI * Math.round(sweep / (2 * Math.PI));
        pen.bezArc(c, r * s, a0, sweep, 0.35);
        return;
      }
      if (fo?.leaf === "rect") {
        // The hinge end's midpoint is the arc's centre and the far end's its tip, as openings.ts needs.
        pen.poly([at(h - LEAF_T / 2, 0), at(h + LEAF_T / 2, 0), at(h + LEAF_T / 2, sd * r), at(h - LEAF_T / 2, sd * r)], "stroke", 0.35);
      } else pen.line(at(h, 0), at(h, sd * r), 0.35);
      const [c, tip, end] = [at(h, 0), at(h, sd * r), at(to, 0)];
      const a0 = Math.atan2(tip[1] - c[1], tip[0] - c[0]);
      let sweep = Math.atan2(end[1] - c[1], end[0] - c[0]) - a0;
      sweep -= 2 * Math.PI * Math.round(sweep / (2 * Math.PI));
      if (fo?.arc === "bezier") pen.bezArc(c, r * s, a0, sweep, 0.35);
      else pen.polyArc(c, r * s, a0, sweep, 16, 0.35);
    };
    // Step S.1: a wall as one stroke on its centre line, from node to node (no half-thickness overrun),
    // broken at its openings; in the mixed plan only the interior walls, the exterior ones outlined
    // with a heavy pen.
    const single = o.stroke && !(o.stroke.mixed && t > 0.15);
    const pen0 = o.stroke ? 1.5 : 0.5;
    let from = single ? 0 : -t / 2;
    for (const [g0, g1, op] of gaps) {
      if (single) pen.line(at(from, 0), at(g0, 0), t * s);
      else pen.poly([at(from, -t / 2), at(g0, -t / 2), at(g0, t / 2), at(from, t / 2)], o.walls, pen0);
      from = g1;
      const style = styleOf(op);
      const fo = "style" in op ? op : null;
      if (o.masks && (style === "window3" || style === "window2" || style === "glass3" || style === "sill2")) pen.mask([at(g0 - 0.006, -t / 2 - 0.015), at(g1 + 0.006, -t / 2 - 0.015), at(g1 + 0.006, t / 2 + 0.015), at(g0 - 0.006, t / 2 + 0.015)]);
      if (style === "window3") for (const v of [-t / 2, 0, t / 2]) pen.line(at(g0, v), at(g1, v), 0.35);
      else if (style === "window2") for (const v of [-t / 4, t / 4]) pen.line(at(g0, v), at(g1, v), 0.35);
      else if (style === "sill2") {
        for (const v of [-0.028, 0.028]) pen.line(at(g0, v), at(g1, v), 0.22); // glazing
        pen.line(at(g0, t / 2 + 0.035), at(g1, t / 2 + 0.035), 0.28); // the sill, inside the room (+n is inside on the sample's exterior walls)
        for (const u of [g0, g1]) pen.line(at(u, -t / 2), at(u, t / 2), 0.18); // jambs
      } else if (style === "glass3") for (const v of [-t / 3, 0, t / 3]) pen.line(at(g0, v), at(g1, v), 0.25); // step Q.1: glazing inside a real gap
      else if (style === "sliding") {
        // Two 0.04 m panels, each 55% of the gap, one from each jamb, staggered across the wall.
        const pw = 0.55 * (g1 - g0);
        pen.poly([at(g0, -0.06), at(g0 + pw, -0.06), at(g0 + pw, -0.02), at(g0, -0.02)], "stroke", 0.35);
        pen.poly([at(g1 - pw, 0.02), at(g1, 0.02), at(g1, 0.06), at(g1 - pw, 0.06)], "stroke", 0.35);
      } else if (style === "double") {
        const r = (g1 - g0) / 2;
        swing(g0, g0 + r, r, fo!.side!, fo);
        swing(g1, g1 - r, r, fo!.side!, fo);
      } else if (style === "door" && fo) swing(fo.hinge === "b" ? g1 : g0, fo.hinge === "b" ? g0 : g1, g1 - g0, fo.side!, fo);
      else if (style === "door") {
        // Door: hinge at the gap end nearer a, leaf to the left of a->b, arc to the far end.
        const r = op.width;
        pen.line(at(g0, 0), at(g0, r), 0.35);
        pen.arc(at(g0, 0), at(g0, r), at(g1, 0), r * s, 0.35);
      }
    }
    if (single) pen.line(at(from, 0), at(L, 0), t * s);
    else pen.poly([at(from, -t / 2), at(L + t / 2, -t / 2), at(L + t / 2, t / 2), at(from, t / 2)], o.walls, pen0);
    if (o.centreLines) pen.dashed(at(0, 0), at(L, 0), 0.15);
    if (o.clipHatch && t > 0.15) {
      let u0 = -t / 2;
      for (const [u1, next] of [...gaps.map(([g0, g1]) => [g0, g1] as const), [L + t / 2, 0] as const]) {
        const [p, q] = [at(u0, -t / 2), at(u1, t / 2)];
        pen.hatch(Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1]), 0.04 * s, 1.5 * s, 0.1);
        u0 = next;
      }
    }
    // Clutter: 45° hatching inside each exterior piece, every 0.15 m, kept inside the piece.
    if (o.clutter && t > 0.15) {
      const pieces: [number, number][] = [];
      let u0 = -t / 2;
      for (const [g0, g1] of gaps) {
        pieces.push([u0, g0]);
        u0 = g1;
      }
      pieces.push([u0, L + t / 2]);
      for (const [p0, p1] of pieces) for (let u = p0 + 0.05; u + t <= p1; u += 0.15) pen.line(at(u, -t / 2), at(u + t, t / 2), 0.18);
    }
  }
  if (o.againstWall) {
    const rect = (x0: number, y0: number, x1: number, y1: number, w: number) => pen.poly([P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], "stroke", w);
    rect(9.15, 5.6, 9.85, 7.4, 0.35); // the bath, its back 5 cm off the east wall's inner face (x 9.9)
    rect(9.21, 5.66, 9.79, 7.34, 0.25); // its rim
    pen.line(P(0, -0.4), P(0, 8.4), 0.18); // a centre line through the west wall, past both ends
  }
  if (o.furniture) {
    const rect = (x0: number, y0: number, x1: number, y1: number, mode: "fill" | "stroke" = "stroke", w = 0.35) => pen.poly([P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], mode, w);
    // The cupboard: partitions 5 cm thick, from the north wall's and the west wall's inner faces.
    pen.line(P(0.7, 0.1), P(0.7, 0.55), 0.25);
    pen.line(P(0.75, 0.1), P(0.75, 0.6), 0.25);
    pen.line(P(0.1, 0.55), P(0.7, 0.55), 0.25);
    pen.line(P(0.1, 0.6), P(0.75, 0.6), 0.25);
    // The sofa (living room): outline, back cushion, two arms.
    rect(5.0, 3.4, 7.0, 4.25);
    rect(5.0, 4.0, 7.0, 4.25, "stroke", 0.28);
    rect(5.0, 3.4, 5.2, 4.0, "stroke", 0.28);
    rect(6.8, 3.4, 7.0, 4.0, "stroke", 0.28);
    // The bed (bedroom 2): outline, two pillows, the duvet's fold.
    rect(0.8, 4.6, 2.4, 6.6);
    rect(0.88, 4.68, 1.58, 4.93, "stroke", 0.25);
    rect(1.62, 4.68, 2.32, 4.93, "stroke", 0.25);
    pen.line(P(0.8, 5.05), P(2.4, 5.05), 0.25);
    // The bath (bathroom) and its rim.
    rect(7.5, 6.2, 9.2, 6.95);
    rect(7.56, 6.26, 9.14, 6.89, "stroke", 0.25);
    // Two 0.5 m square columns in the living room: one stroked, one filled.
    rect(8.0, 2.5, 8.5, 3.0, "stroke", 0.5);
    rect(5.5, 1.5, 6.0, 2.0, "fill");
  }
  if (o.centreLines) pen.line(P(0.1, 4.08), P(3.95, 4.08), 0.18); // a finish line 30 mm off w-HI's face
  if (o.stairs) for (let i = 0; i < 12; i++) pen.line(P(4.3 + 0.22 * i, 6.885), P(4.3 + 0.22 * i, 7.885), 0.25); // treads on w-LF's face
  if (o.nib) pen.poly([P(7.95, 0.1), P(8.05, 0.1), P(8.05, 1.1), P(7.95, 1.1)], o.walls, 0.5);
  if (o.diagonal) {
    pen.poly([P(1.95, 3.95), P(2.05, 3.95), P(2.05, 6.55), P(1.95, 6.55)], "fill");
    const [d0, d1] = [{ x: 2, y: 6.5 }, { x: 0.5, y: 8 }];
    const L = Math.hypot(d1.x - d0.x, d1.y - d0.y);
    const u = { x: (d1.x - d0.x) / L, y: (d1.y - d0.y) / L };
    const n = { x: -u.y * 0.05, y: u.x * 0.05 };
    const [p0, p1] = [{ x: d0.x - u.x * 0.05, y: d0.y - u.y * 0.05 }, { x: d1.x + u.x * 0.05, y: d1.y + u.y * 0.05 }];
    pen.poly([P(p0.x + n.x, p0.y + n.y), P(p1.x + n.x, p1.y + n.y), P(p1.x - n.x, p1.y - n.y), P(p0.x - n.x, p0.y - n.y)], "fill");
  }
  if (o.stemInWindow) pen.poly([P(-0.05, 1.95), P(4.05, 1.95), P(4.05, 2.05), P(-0.05, 2.05)], "fill");
  if (o.outbuilding) {
    const [x0, y0, x1, y1, t] = [0.5, 10.5, 4.5, 13.5, 0.2];
    const rect = (ax: number, ay: number, bx: number, by: number) => pen.poly([P(ax, ay), P(bx, ay), P(bx, by), P(ax, by)], "fill");
    rect(x0 - t / 2, y0 - t / 2, x1 + t / 2, y0 + t / 2); // north
    rect(x0 - t / 2, y1 - t / 2, x1 + t / 2, y1 + t / 2); // south
    rect(x0 - t / 2, y0 - t / 2, x0 + t / 2, y1 + t / 2); // west
    rect(x1 - t / 2, y0 - t / 2, x1 + t / 2, y1 + t / 2); // east
  }
  if (o.finishLine) {
    pen.line(P(3.92, 3.4), P(3.92, 5.5), 0.18); // the finish line
    pen.line(P(4.2, 3.7), P(4.2, 4.3), 0.25); // the shelf's back
  }
  if (o.windowBoard) pen.line(P(8.35, 0.2), P(9.65, 0.2), 0.25);
  const drawDecoys = o.decoys ?? Boolean(o.doors);
  if (drawDecoys) {
    // Decoy arcs (Béziers), none of them a swing: a quarter-round sink with its radius lines (r 0.35 m),
    // a chair back (r 0.25 m, 120°), a stair's walking line with a radius line (r 1.8 m), and a
    // quarter circle with NO leaf whose centre sits on the bare gap's jamb (w-GH at y 6.5), radius its width.
    const Q = Math.PI / 2;
    pen.bezArc(P(8.2, 6), 0.35 * s, 0, -Q, 0.35);
    pen.line(P(8.2, 6), P(8.55, 6), 0.35);
    pen.line(P(8.2, 6), P(8.2, 6.35), 0.35);
    pen.bezArc(P(8.5, 2.6), 0.25 * s, Math.PI / 6, (2 * Math.PI) / 3, 0.35);
    pen.bezArc(P(4.8, 1.6), 1.8 * s, 0, -Q, 0.35);
    pen.line(P(4.8, 1.6), P(6.6, 1.6), 0.35);
    pen.bezArc(P(0, 6.5), 1 * s, 0, Q, 0.35);
  }
  if (o.clutter) {
    const box = (x0: number, y0: number, x1: number, y1: number) => pen.poly([P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], "stroke", 0.35);
    box(5.2, 3.2, 6.4, 3.8); // a 1.2 × 0.6 m table in the living room
    // Two door tags in boxes (bare numbers, never room names).
    for (const [tag, x, y] of [["01", 5.1, 1.2], ["02", 1.6, 5.0]] as const) {
      box(x, y, x + 0.5, y + 0.35);
      const [ux, uy] = P(x + 0.1, y + 0.27);
      pen.text(tag, ux, uy, 7);
    }
    pen.line(P(8.2, 4.3), P(8.7, 4.3), 0.35); // a stray 0.5 m line
    // A free-standing diagonal wall: 2 m at 45°, 0.1 m thick.
    const [d0, d1, h] = [{ x: 7.6, y: 0.9 }, { x: 7.6 + Math.SQRT2, y: 0.9 + Math.SQRT2 }, 0.05 / Math.SQRT2];
    pen.poly([P(d0.x + h, d0.y - h), P(d1.x + h, d1.y - h), P(d1.x - h, d1.y + h), P(d0.x - h, d0.y + h)], "stroke", 0.5);
  }

  // Room names, centred on their label points.
  const NAMES: [string, number, number][] = [["Bedroom 1", 2, 2], ["Bedroom 2", 2, 6], ["Living room", 7, 2.5], ["Bathroom", 8.5, 6.5]];
  for (const [name, x, y] of NAMES) {
    const [ux, uy] = P(x, y);
    pen.text(name, ux - pen.width(name, 9) / 2, uy - 3, 9);
  }
  if (o.levels) {
    // Under a name: 11 pt below its baseline, centred; on its line: 4 pt after its end.
    const under = (str: string, x: number, y: number, k: number) => {
      const [ux, uy] = P(x, y);
      pen.text(str, ux - pen.width(str, 7) / 2, uy - 3 - 11 * k, 7);
    };
    under("FFL +0.150", 2, 2, 1);
    under("+0.000", 2, 6, 1);
    under("LEVEL 1", 7, 2.5, 1);
    under("SSL +0.100", 7, 2.5, 2);
    const [bx, by] = P(8.5, 6.5);
    pen.text("FL -0.020", bx + pen.width("Bathroom", 9) / 2 + 4, by - 3, 9);
  }

  // Dimensions: a 0.5 pt line, extension lines and 45° ticks, the text 2.5 pt off
  // the line (above it, or left of it reading bottom to top).
  const dims: Truth["dims"] = [];
  const TH = 7;
  let nDim = 0;
  const label = (m: number) => (o.dims === "imperial" ? fmtImperial(m * FT_PER_SAMPLE_M, nDim++) : o.dims === "bare" ? `${Math.round(m * 1000)}` : (o.misprint || o.wrongFirst) && nDim++ === 0 ? (o.wrongFirst ?? "4100 mm") : `${Math.round(m * 1000)} mm`);
  const tick = (p: number[]) => pen.line([p[0] - 2, p[1] - 2], [p[0] + 2, p[1] + 2], 1);
  // Broken style (step M.1b): the line stops 0.4 text heights either side of its text, which
  // sits on the line; ticks are perpendicular, 1.4 text heights long, centred on the ends.
  const TICK = 1.4 * TH;
  const PAD = 0.4 * TH;
  const OVER = (0.005 / unit) * s; // 5 mm (real size) past each tick, in points
  let nBroken = 0;
  const broken = (p: number[], q: number[], vertical: boolean, metres: number) => {
    const first = nBroken++ === 0;
    const ticks = !(vertical === false && Math.abs(q[0] - p[0] - 10 * s) < 1e-6); // the overall 10 m line has none
    const over = first ? OVER : 0;
    const text = label(metres / unit);
    const tw = pen.width(text, TH);
    const along = vertical ? 1 : 0; // the coordinate the line runs along
    const [a, b] = [p[along], q[along]].sort((m, n) => m - n);
    const mid = (a + b) / 2;
    const pt = (v: number) => (vertical ? [p[0], v] : [v, p[1]]);
    pen.line(pt(a - over), pt(mid - tw / 2 - PAD), 0.5);
    pen.line(pt(mid + tw / 2 + PAD), pt(b + over), 0.5);
    if (ticks) for (const e of [a, b]) pen.line(vertical ? [p[0] - TICK / 2, e] : [e, p[1] - TICK / 2], vertical ? [p[0] + TICK / 2, e] : [e, p[1] + TICK / 2], 0.5);
    if (vertical) pen.dimText(text, p[0] + 0.35 * TH, mid - tw / 2, TH, 90);
    else pen.dimText(text, mid - tw / 2, p[1] - 0.35 * TH, TH);
    dims.push({ text, metres, lengthPt: ((ticks ? 0 : 2 * over) + b - a) * k, measure: ticks ? "ticks" : "line", lineLengthPt: (b - a + 2 * over) * k });
  };
  const dimH = (x1: number, x2: number, y: number, th = TH) => {
    if (o.broken) return broken(P(x1, y), P(x2, y), false, (x2 - x1) * unit);
    const [p, q] = [P(x1, y), P(x2, y)];
    pen.line(p, q, 0.5);
    for (const e of [p, q]) pen.line([e[0], e[1] - 4], [e[0], e[1] + 6], 0.25);
    tick(p);
    tick(q);
    const text = label(x2 - x1);
    pen.dimText(text, (p[0] + q[0]) / 2 - pen.width(text, th) / 2, p[1] + 2.5, th);
    dims.push({ text, metres: (x2 - x1) * unit, lengthPt: (q[0] - p[0]) * k, measure: "ticks", lineLengthPt: (q[0] - p[0]) * k });
  };
  const dimV = (y1: number, y2: number, x: number) => {
    if (o.broken) return broken(P(x, y1), P(x, y2), true, (y2 - y1) * unit);
    const [p, q] = [P(x, y1), P(x, y2)];
    pen.line(p, q, 0.5);
    for (const e of [p, q]) pen.line([e[0] - 6, e[1]], [e[0] + 4, e[1]], 0.25);
    tick(p);
    tick(q);
    const text = label(y2 - y1);
    pen.dimText(text, p[0] - 2.5, (p[1] + q[1]) / 2 - pen.width(text, TH) / 2, TH, 90);
    dims.push({ text, metres: (y2 - y1) * unit, lengthPt: (p[1] - q[1]) * k, measure: "ticks", lineLengthPt: (p[1] - q[1]) * k });
  };
  // plan-doors: the north dimensions move 0.45 m out, so the two opening widths fit 0.65 m off the wall
  // (closer, a dimension line would pair with the wall's face as a wall).
  const NY = o.doors ? -0.45 : 0;
  /** A dimension from a to b (user space via P, sample metres), its extension lines from the measured
   *  points fa and fb to the line, stopping on it (step Q.1). */
  const flushDim = (a: number[], b: number[], fa: number[], fb: number[], vertical: boolean, spans: "inside faces" | "outside faces") => {
    const [p, q] = [P(a[0], a[1]), P(b[0], b[1])];
    for (const [f, e] of [[fa, p], [fb, q]] as const) pen.line(P(f[0], f[1]), e, 0.18);
    pen.line(p, q, 0.5);
    tick(p);
    tick(q);
    const metres = Math.hypot(b[0] - a[0], b[1] - a[1]) * unit;
    const text = label(metres / unit);
    if (vertical) pen.dimText(text, p[0] - 2.5, (p[1] + q[1]) / 2 - pen.width(text, TH) / 2, TH, 90);
    else pen.dimText(text, (p[0] + q[0]) / 2 - pen.width(text, TH) / 2, p[1] + 2.5, TH);
    const ext = Math.hypot(...(P(fa[0], fa[1]).map((v, i) => v - p[i]) as [number, number]));
    const lengthPt = Math.hypot(q[0] - p[0], q[1] - p[1]) * k;
    dims.push({ text, metres, lengthPt, measure: ext >= TH ? "ticks" : "line", lineLengthPt: lengthPt, spans });
  };
  if (o.closeDims) {
    flushDim([-0.1, -0.45], [10.1, -0.45], [-0.1, -0.1], [10.1, -0.1], false, "outside faces"); // outer faces, 0.35 m off the north face
    flushDim([0.1, -0.7], [3.95, -0.7], [0.1, 0.1], [3.95, 0.1], false, "inside faces"); // bedroom 1's inside, stacked 0.25 m beyond
    flushDim([-0.45, -0.1], [-0.45, 8.1], [-0.1, -0.1], [-0.1, 8.1], true, "outside faces"); // outer faces, 0.35 m off the west face
    flushDim([-0.7, 0.1], [-0.7, 3.95], [0.1, 0.1], [0.1, 3.95], true, "inside faces"); // bedroom 1's depth, stacked
    flushDim([4.05, 1.5], [9.9, 1.5], [4.05, 1.3], [9.9, 1.3], false, "inside faces"); // across the living room, face to face
  } else if (o.dims) {
    dimH(0, 4, -1 + NY);
    dimH(4, 10, -1 + NY);
    dimH(0, 10, -1.8 + NY);
    dimV(0, 4, -1);
    dimV(4, 8, -1);
    dimV(0, 8, -1.8);
    dimV(0, 5, 11);
    dimV(5, 8, 11);
    dimH(0, 4, 9);
    dimH(4, 7, 9);
    dimH(7, 10, 9);
    if (o.overlapDim) dimH(0, 1.5, -1 + NY);
    if (o.doors) {
      // The first two openings on the north wall (w-BC runs from B at x = 4), printed at their jambs.
      const onBC = o.doors.filter((op) => op.wallId === "w-BC" && op.style !== "oddgap").slice(0, 2);
      for (const op of onBC) dimH(4 + op.offset - op.width / 2, 4 + op.offset + op.width / 2, -0.75, 6);
      for (const dm of dims.slice(-onBC.length)) dm.spans = "opening width"; // what the model check measures them between
    }
  }

  // Title block, bottom right of the sheet.
  const [tx, ty] = o.imperial ? [340 + dx, 40 + dy] : [330 + dx, 50 + dy];
  pen.poly([[tx, ty], [tx + 230, ty], [tx + 230, ty + 100], [tx, ty + 100]], "stroke", 0.75);
  if (o.titleRows) {
    for (let r = 12; r < 100; r += 15) pen.line([tx, ty + r], [tx + 230, ty + r], 0.35); // rows 15 pt apart
    pen.line([tx + 200, ty], [tx + 200, ty + 100], 0.35); // a column for the sheet number
    pen.poly([[20, 20], [W - 20, 20], [W - 20, H - 20], [20, H - 20]], "stroke", 1); // the sheet border
  }
  const titleText = o.imperial ? `SCALE 1/8" = 1'-0"` : "SCALE 1:100";
  pen.text("Two-bedroom house", tx + 10, ty + 75, 10);
  pen.text("Ground floor plan", tx + 10, ty + 55, 8);
  pen.text(titleText, tx + 10, ty + 35, 8);
  pen.text(o.sheet?.name ?? (o.imperial ? "Letter" : "A4"), tx + 10, ty + 15, 8);
  if (o.note) pen.text(o.note, tx + 60, ty + 15, 7);

  if (k !== 1) pen.ops.push(popGraphicsState());
  pen.flush();
  // plan-traced-wall's walls: a 4 px black PNG stretched over each footprint.
  if (pictures.length) {
    const black = await doc.embedPng(await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer());
    for (const [x, y, width, height] of pictures) page.drawImage(black, { x, y, width, height });
  }
  // plan-outlined's dimension texts: pictures, the text's bottom 0.3 size under the baseline.
  for (const im of pen.images) {
    const { png, wPt, hPt } = await textPng(im.str, im.size);
    const below = 0.3 * im.size;
    const at = im.rot === 90 ? { x: im.x + below, y: im.y } : { x: im.x, y: im.y - below };
    page.drawImage(await doc.embedPng(png), { ...at, width: wPt, height: hPt, rotate: degrees(im.rot) });
  }
  const vw = rotate === 90 ? H : W;
  const vh = rotate === 90 ? W : H;
  // Walls and openings in the page's frame (metres at the true scale, origin the walls' top-left).
  const mPP = unit / s / k;
  const inView = (p: { x: number; y: number }) => {
    const [x, y] = view(...(P(p.x, p.y) as [number, number]));
    return { x: x * mPP, y: y * mPP };
  };
  const raw = sourceWalls.map((w) => ({ id: w.id, a: inView(w.a), b: inView(w.b), thickness: w.thickness * unit }));
  const [ox, oy] = [Math.min(...raw.flatMap((w) => [w.a.x, w.b.x])), Math.min(...raw.flatMap((w) => [w.a.y, w.b.y]))];
  const shift = (p: { x: number; y: number }) => ({ x: p.x - ox, y: p.y - oy });
  const jamb = (wallId: string, at: number) => {
    const w = sourceWalls.find((x) => x.id === wallId)!;
    const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    return shift(inView({ x: w.a.x + ((w.b.x - w.a.x) / L) * at, y: w.a.y + ((w.b.y - w.a.y) / L) * at }));
  };
  return {
    rotate,
    viewport: { width: vw, height: vh },
    mPerPt: unit / s / k,
    title: o.imperial ? `1/8" = 1'-0"` : "1:100",
    dims,
    segments: pen.segments,
    arcs: pen.arcs,
    texts: pen.texts,
    rooms: NAMES.map((n) => n[0]),
    walls: sourceWalls.map((w) => ({ id: w.id, a: { x: w.a.x * unit, y: w.a.y * unit }, b: { x: w.b.x * unit, y: w.b.y * unit }, thickness: w.thickness * unit })),
    planWalls: raw.map((w) => ({ ...w, a: shift(w.a), b: shift(w.b) })),
    // Step M.1d: an "oddgap" is drawn but never read as an opening, so it is reported, not listed here.
    outOfRangeGaps: (o.doors ?? []).filter((op) => "style" in op && op.style === "oddgap").map((op) => op.width),
    planOpenings: (o.doors ?? sourceOpenings).filter((op) => !("style" in op) || op.style !== "oddgap").map((op) => {
      const style = "style" in op ? op.style : op.kind === "window" ? "window3" : "door";
      const fo = "style" in op ? op : null;
      const kind = style === "window3" || style === "window2" || style === "glass3" || style === "sill2" ? ("window" as const) : ("door" as const);
      const [s0, s1] = [op.offset - op.width / 2, op.offset + op.width / 2];
      // The leaf's side as a unit vector in the page's frame: the sample wall's (-dy, dx) normal times the side, mapped.
      const w = sourceWalls.find((x) => x.id === op.wallId)!;
      const Lw = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
      const n = { x: -(w.b.y - w.a.y) / Lw, y: (w.b.x - w.a.x) / Lw };
      const sd = fo ? (fo.side ?? 1) : 1;
      const p0 = inView(w.a);
      const p1 = inView({ x: w.a.x + n.x * sd, y: w.a.y + n.y * sd });
      const side = { x: (p1.x - p0.x) / Math.hypot(p1.x - p0.x, p1.y - p0.y), y: (p1.y - p0.y) / Math.hypot(p1.x - p0.x, p1.y - p0.y) };
      // The jamb the leaf pivots on, as a point AND (step M.1d) as which end of the BUILT wall
      // it is: walls.ts always reads a as the smaller coordinate, so compare the two jambs there.
      const atB = fo?.hinge === "b";
      const jambs = [jamb(op.wallId, s0), jamb(op.wallId, s1)] as const;
      const hingeJamb = atB ? jambs[1] : jambs[0];
      const far = atB ? jambs[0] : jambs[1];
      const hingeEnd: "a" | "b" = hingeJamb.x < far.x - 1e-9 || (Math.abs(hingeJamb.x - far.x) < 1e-9 && hingeJamb.y < far.y - 1e-9) ? "a" : "b";
      const swingInfo = style === "door" ? { hinge: hingeJamb, side, hingeEnd } : style === "double" ? { side } : {};
      return { id: op.id, kind, wallId: op.wallId, a: jamb(op.wallId, s0), b: jamb(op.wallId, s1), class: CLASS_OF[style], ...swingInfo };
    }),
    ...(o.clutter ? { diagonal: 1 } : {}),
    ...(drawDecoys ? { decoyArcs: 4 } : {}),
  };
}

async function make(file: string, build: (doc: PDFDocument, font: PDFFont) => Promise<Omit<Truth, "file" | "pages">> | Omit<Truth, "file" | "pages">): Promise<Truth> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const t = await build(doc, font);
  const bytes = await doc.save({ useObjectStreams: false });
  writeFileSync(join(OUT, file), bytes);
  return { file, pages: doc.getPageCount(), ...t };
}

/** plan-filled with its first dimension misprinted as 4100 mm, for the browser test's override (never committed). */
export async function misprintedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  await drawPlan(doc, await doc.embedFont(StandardFonts.Helvetica), { walls: "fill", dims: "mm", misprint: true });
  return doc.save({ useObjectStreams: false });
}

/** Step H.1: six horizontal strips, 3 m long and 0.2 m thick, no two on one line (a bridged gap would join them) and none
 *  within 0.6 m of another across (a face pair): no joint, no room. */
const STRIPS = [
  { id: "s1", a: { x: 0.5, y: 1 }, b: { x: 3.5, y: 1 } },
  { id: "s2", a: { x: 5, y: 1.7 }, b: { x: 8, y: 1.7 } },
  { id: "s3", a: { x: 0.5, y: 3.5 }, b: { x: 3.5, y: 3.5 } },
  { id: "s4", a: { x: 5, y: 4.3 }, b: { x: 8, y: 4.3 } },
  { id: "s5", a: { x: 0.5, y: 6 }, b: { x: 3.5, y: 6 } },
  { id: "s6", a: { x: 5, y: 6.8 }, b: { x: 8, y: 6.8 } },
].map((w) => ({ ...w, thickness: 0.2, height: 2.7 })) as typeof samplePlan.walls;

const plain = { kind: "vector" as const, planPage: 1, mismatchRatio: null };

export async function writePdfFixtures(): Promise<Truth[]> {
  mkdirSync(OUT, { recursive: true });
  const truths: Truth[] = [];
  truths.push(await make("plan-filled.pdf", async (d, f) => ({ ...plain, expectedScale: "good", ...await drawPlan(d, f, { walls: "fill", dims: "mm" }) })));
  truths.push(await make("plan-lines.pdf", async (d, f) => ({ ...plain, expectedScale: "good", ...await drawPlan(d, f, { walls: "stroke", dims: "mm" }) })));
  truths.push(await make("plan-fit.pdf", async (d, f) => ({ ...plain, expectedScale: "good", mismatchRatio: Math.round(100 / 0.87), ...await drawPlan(d, f, { walls: "fill", dims: "mm", fit: 0.87 }) })));
  truths.push(await make("plan-rotated.pdf", async (d, f) => ({ ...plain, expectedScale: "good", ...await drawPlan(d, f, { walls: "fill", dims: "mm", rotate: 90 }) })));
  truths.push(await make("plan-imperial.pdf", async (d, f) => ({ ...plain, expectedScale: "good", ...await drawPlan(d, f, { walls: "fill", dims: "imperial", imperial: true }) })));
  truths.push(
    await make("plan-two-pages.pdf", async (d, f) => {
      const cover = d.addPage(A4);
      cover.drawRectangle({ x: 40, y: 40, width: A4[0] - 80, height: A4[1] - 80, borderWidth: 1 });
      cover.drawText("Two-bedroom house", { x: 80, y: 600, size: 24, font: f });
      cover.drawText("Drawing set: ground floor plan", { x: 80, y: 570, size: 12, font: f });
      return { ...plain, planPage: 2, expectedScale: "good", ...(await drawPlan(d, f, { walls: "fill", dims: "mm" })) };
    }),
  );
  truths.push(await make("plan-clutter.pdf", async (d, f) => ({ ...plain, expectedScale: "good", ...(await drawPlan(d, f, { walls: "stroke", dims: "mm", clutter: true })) })));
  truths.push(await make("plan-broken-dims.pdf", async (d, f) => ({ ...plain, expectedScale: "good", ...(await drawPlan(d, f, { walls: "fill", dims: "mm", broken: true })) })));
  truths.push(await make("plan-outlined.pdf", async (d, f) => ({ ...plain, expectedScale: "good", ...(await drawPlan(d, f, { walls: "fill", dims: "mm", outlined: true })), texts: [] })));
  truths.push(await make("plan-single-line.pdf", async (d, f) => ({ ...plain, expectedScale: "good", ...(await drawPlan(d, f, { walls: "fill", dims: "mm", singleLine: ["w-KM"] })) })));
  truths.push(await make("plan-traced-wall.pdf", async (d, f) => ({ ...plain, expectedScale: "good", tracedWalls: ["w-KM"], ...(await drawPlan(d, f, { walls: "fill", dims: "mm", pictureWalls: ["w-KM"] })) })));
  truths.push(await make("plan-doors.pdf", async (d, f) => ({ ...plain, expectedScale: "good", ...(await drawPlan(d, f, { walls: "stroke", dims: "mm", doors: DOOR_FIXTURE })) })));
  truths.push(await make("plan-doors-rect.pdf", async (d, f) => ({ ...plain, expectedScale: "good", ...(await drawPlan(d, f, { walls: "stroke", dims: "mm", doors: RECT_FIXTURE })) })));
  truths.push(await make("plan-gaps.pdf", async (d, f) => ({ ...plain, expectedScale: "good", ...(await drawPlan(d, f, { walls: "fill", dims: "mm", doors: GAP_FIXTURE, decoys: false })) })));
  // Step X.1: plan-filled at 1:100 in the middle of an A0 landscape sheet, the rest of it empty.
  truths.push(await make("plan-small-on-big.pdf", async (d, f) => ({ ...plain, expectedScale: "good", ...(await drawPlan(d, f, { walls: "fill", dims: "mm", sheet: { name: "A0", size: A0_LANDSCAPE, shift: [1400, 800] } })) })));
  // Step Q.1 fixtures, all SYNTHETIC. plan-bare-mm: plan-filled with every dimension a bare number of
  // millimetres (the vertical ones reading bottom to top) and the general note "ALL DIMENSIONS IN mm".
  truths.push(await make("plan-bare-mm.pdf", async (d, f) => ({ ...plain, expectedScale: "good", ...(await drawPlan(d, f, { walls: "fill", dims: "bare", note: "ALL DIMENSIONS IN mm" })) })));
  // plan-dims-close: plan-lines with its dimensions drawn close to the walls (closeDims).
  truths.push(await make("plan-dims-close.pdf", async (d, f) => ({ ...plain, expectedScale: "good", ...(await drawPlan(d, f, { walls: "stroke", dims: "mm", closeDims: true })) })));
  // plan-against-wall: plan-lines with a bath against a wall and a centre line through a wall (againstWall).
  truths.push(await make("plan-against-wall.pdf", async (d, f) => ({ ...plain, expectedScale: "good", ...(await drawPlan(d, f, { walls: "stroke", dims: "mm", againstWall: true })) })));
  // plan-strike-jamb: swings ending at the strike jamb's face corner, short walls beyond (STRIKE_FIXTURE).
  truths.push(await make("plan-strike-jamb.pdf", async (d, f) => ({ ...plain, expectedScale: "good", ...(await drawPlan(d, f, { walls: "stroke", dims: "mm", doors: STRIKE_FIXTURE, decoys: false })) })));
  // plan-window-board: glazing lines in a real gap with a window board in front (BOARD_FIXTURE, windowBoard).
  truths.push(await make("plan-window-board.pdf", async (d, f) => ({ ...plain, expectedScale: "good", ...(await drawPlan(d, f, { walls: "stroke", dims: "mm", doors: BOARD_FIXTURE, decoys: false, windowBoard: true })) })));
  // plan-furniture: a corner cupboard and free-standing furniture and columns (furniture).
  truths.push(await make("plan-furniture.pdf", async (d, f) => ({ ...plain, expectedScale: "good", ...(await drawPlan(d, f, { walls: "stroke", dims: "mm", furniture: true })) })));
  // Step Q.2 fixtures, all SYNTHETIC, each one class of failure seen on a ChatGPT-generated poche plan
  // (tests/fixtures/pdf/plan-chatgpt-poche.pdf). plan-poche-mask: plan-filled with each window knocked
  // out of the poche by a white rectangle (masks).
  truths.push(await make("plan-poche-mask.pdf", async (d, f) => ({ ...plain, expectedScale: "good", ...(await drawPlan(d, f, { walls: "fill", dims: "mm", masks: true })) })));
  // plan-centre-lines: plan-filled with dash-dot centre lines through every wall and a finish line (centreLines).
  truths.push(await make("plan-centre-lines.pdf", async (d, f) => ({ ...plain, expectedScale: "good", ...(await drawPlan(d, f, { walls: "fill", dims: "mm", doors: CENTRE_FIXTURE, decoys: false, centreLines: true })) })));
  // plan-dims-chain: plan-filled with a second string on the 0 to 4 m dimension's line (overlapDim).
  truths.push(await make("plan-dims-chain.pdf", async (d, f) => ({ ...plain, expectedScale: "good", ...(await drawPlan(d, f, { walls: "fill", dims: "mm", overlapDim: true })) })));
  // plan-dims-one-wrong: plan-filled with its first dimension printed 5200 mm on its 4 m line (wrongFirst).
  truths.push(await make("plan-dims-one-wrong.pdf", async (d, f) => ({ ...plain, expectedScale: "good", ...(await drawPlan(d, f, { walls: "fill", dims: "mm", wrongFirst: "5200 mm" })) })));
  // plan-poche-hatch: plan-filled with clipped 45° hatching in the exterior poche (clipHatch).
  truths.push(await make("plan-poche-hatch.pdf", async (d, f) => ({ ...plain, expectedScale: "good", ...(await drawPlan(d, f, { walls: "fill", dims: "mm", clipHatch: true })) })));
  // plan-finish-line: plan-filled with a finish line and a shelf back on either side of a poche wall (finishLine).
  truths.push(await make("plan-finish-line.pdf", async (d, f) => ({ ...plain, expectedScale: "good", ...(await drawPlan(d, f, { walls: "fill", dims: "mm", finishLine: true })) })));
  // plan-title-block: plan-filled with a ruled title block and a sheet border (titleRows).
  truths.push(await make("plan-title-block.pdf", async (d, f) => ({ ...plain, expectedScale: "good", ...(await drawPlan(d, f, { walls: "fill", dims: "mm", titleRows: true })) })));
  // plan-outbuilding: plan-filled with a detached 4 × 3 m shed and no title text near it (outbuilding).
  truths.push(
    await make("plan-outbuilding.pdf", async (d, f) => {
      const r = await drawPlan(d, f, { walls: "fill", dims: "mm", outbuilding: true });
      // The shed's walls are walls too: in the page frame, which here is the sample's metres (A at the origin).
      const shed = (id: string, a: [number, number], b: [number, number]) => ({ id, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness: 0.2 });
      const sheds = [shed("shed-n", [0.5, 10.5], [4.5, 10.5]), shed("shed-s", [0.5, 13.5], [4.5, 13.5]), shed("shed-w", [0.5, 10.5], [0.5, 13.5]), shed("shed-e", [4.5, 10.5], [4.5, 13.5])];
      return { ...plain, expectedScale: "good" as const, ...r, planWalls: [...r.planWalls, ...sheds] };
    }),
  );
  // plan-window-sill: plan-filled with every window drawn with glazing, jamb and sill lines (SILL_FIXTURE).
  truths.push(await make("plan-window-sill.pdf", async (d, f) => ({ ...plain, expectedScale: "good", ...(await drawPlan(d, f, { walls: "fill", dims: "mm", doors: SILL_FIXTURE, decoys: false })) })));
  // plan-stem-in-window: plan-window-sill with a partition ending inside a window (stemInWindow). The truth
  // splits w-HA and w-BI at the partition's ends and keeps the window as drawn; it can't be read.
  truths.push(
    await make("plan-stem-in-window.pdf", async (d, f) => {
      const r = await drawPlan(d, f, { walls: "fill", dims: "mm", doors: SILL_FIXTURE, decoys: false, stemInWindow: true });
      const w = (id: string, a: [number, number], b: [number, number], thickness: number) => ({ id, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness });
      const split = [w("w-HA.1", [0, 4], [0, 2], 0.2), w("w-HA.2", [0, 2], [0, 0], 0.2), w("w-BI.1", [4, 0], [4, 2], 0.1), w("w-BI.2", [4, 2], [4, 4], 0.1), w("w-stem", [0, 2], [4, 2], 0.1)];
      return { ...plain, expectedScale: "good" as const, ...r, planWalls: [...r.planWalls.filter((x) => x.id !== "w-HA" && x.id !== "w-BI"), ...split] };
    }),
  );
  // plan-poche-diagonal: plan-filled with a partition and a 45° wall chamfering bedroom 2 (diagonal). The
  // truth splits w-HI and w-FG where the two meet them.
  truths.push(
    await make("plan-poche-diagonal.pdf", async (d, f) => {
      const r = await drawPlan(d, f, { walls: "fill", dims: "mm", diagonal: true });
      const w = (id: string, a: [number, number], b: [number, number], thickness: number) => ({ id, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness });
      const extra = [w("w-HI.1", [0, 4], [2, 4], 0.1), w("w-HI.2", [2, 4], [4, 4], 0.1), w("w-FG.1", [4, 8], [0.5, 8], 0.2), w("w-FG.2", [0.5, 8], [0, 8], 0.2), w("w-part", [2, 4], [2, 6.5], 0.1), w("w-diag", [2, 6.5], [0.5, 8], 0.1)];
      return { ...plain, expectedScale: "good" as const, ...r, planWalls: [...r.planWalls.filter((x) => x.id !== "w-HI" && x.id !== "w-FG"), ...extra] };
    }),
  );
  // plan-free-end: plan-filled with a nib wall whose far end is free (nib). The truth splits w-BC at it.
  truths.push(
    await make("plan-free-end.pdf", async (d, f) => {
      const r = await drawPlan(d, f, { walls: "fill", dims: "mm", nib: true });
      const w = (id: string, a: [number, number], b: [number, number], thickness: number) => ({ id, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness });
      const extra = [w("w-BC.1", [4, 0], [8, 0], 0.2), w("w-BC.2", [8, 0], [10, 0], 0.2), w("w-nib", [8, 0], [8, 1.1], 0.1)];
      return { ...plain, expectedScale: "good" as const, ...r, planWalls: [...r.planWalls.filter((x) => x.id !== "w-BC"), ...extra] };
    }),
  );
  // plan-levels: plan-filled with floor-level notes beside the room names (levels), never part of a name.
  truths.push(await make("plan-levels.pdf", async (d, f) => ({ ...plain, expectedScale: "good", ...(await drawPlan(d, f, { walls: "fill", dims: "mm", levels: true })) })));
  // Step H.1: plan-strips, six 3 m wall strips that touch nothing (STRIPS), with the sample's dimensions and names.
  // Written but NOT in truth.json: it has no building, so the generic "every fixture reads its walls exactly"
  // loops (which would need vector walls kept in the plan) do not apply; scripts/test-pdf-verdict.ts reads the file itself.
  await make("plan-strips.pdf", async (d, f) => ({ ...plain, expectedScale: "good", ...(await drawPlan(d, f, { walls: "fill", dims: "mm", strips: STRIPS })) }));
  // Step S.1: walls as single centre-line strokes (stroke), with butt, round and square caps, and mixed
  // with heavy-pen paired outlines; stairs and furniture on every one.
  for (const [file, stroke] of [
    ["plan-single-stroke.pdf", { cap: "butt" }],
    ["plan-single-stroke-round.pdf", { cap: "round" }],
    ["plan-single-stroke-square.pdf", { cap: "square" }],
    ["plan-single-stroke-mixed.pdf", { cap: "butt", mixed: true }],
  ] as const)
    truths.push(await make(file, async (d, f) => ({ ...plain, expectedScale: "good", ...(await drawPlan(d, f, { walls: "stroke", dims: "mm", doors: STROKE_FIXTURE, decoys: false, stroke, stairs: true, furniture: true })) })));
  truths.push(await make("plan-no-dims.pdf", async (d, f) => ({ ...plain, expectedScale: "check", ...await drawPlan(d, f, { walls: "fill", dims: null }), dims: [] })));
  // The scan: plan-filled rendered at 150 dpi, embedded as one grey PNG filling the page.
  const { file: _file, pages: _pages, ...filled } = truths[0];
  const src = await openNode(new Uint8Array(readFileSync(join(OUT, "plan-filled.pdf"))));
  const px = await renderNode(await src.getPage(1), 150 / 72);
  const png = await sharp(Buffer.from(px.rgba.buffer, px.rgba.byteOffset, px.rgba.length), { raw: { width: px.width, height: px.height, channels: 4 } }).greyscale().png({ palette: true, colours: 4 }).toBuffer();
  await src.loadingTask.destroy();
  truths.push(
    await make("plan-scanned.pdf", async (d) => {
      const page = d.addPage(A4);
      page.drawImage(await d.embedPng(png), { x: 0, y: 0, width: A4[0], height: A4[1] });
      return { ...filled, ...plain, kind: "scanned" as const, expectedScale: "none" as const, dims: [], segments: [], arcs: [], texts: [], title: null };
    }),
  );
  writeFileSync(join(OUT, "truth.json"), JSON.stringify(truths, (_k, v) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v)) + "\n");
  return truths;
}

if (require.main === module)
  writePdfFixtures().then((ts) => {
    for (const t of ts) console.log(`${t.file}: ${t.pages} page(s), ${t.segments.length} segments, ${t.arcs.length} arcs, ${t.texts.length} texts, ${t.dims.length} dimensions`);
  });
