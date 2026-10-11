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
 *                      faces, so that wall can only be traced (step M.1b)
 *   plan-no-dims.pdf   plan-filled without dimensions: walls, names, title block only
 *   plan-clutter.pdf   plan-lines plus clutter (step M.1b): 45° hatching inside the
 *                      exterior walls, a 1.2 × 0.6 m table, two boxed door tags
 *                      ("01", "02"), a 0.5 m stray line and a free-standing diagonal
 *                      wall (2 m, 0.1 m thick, 45°)
 *   plan-broken-dims.pdf plan-filled with every dimension line broken around its text
 *                      (the text sits on the line), short perpendicular ticks instead of
 *                      extension lines, the first line overshooting its ticks by 5 mm
 *                      (real size) at each end, and the overall 10 m line with no ticks
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
 * Run: npx tsx scripts/make-pdf-fixtures.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendBezierCurve,
  closePath,
  concatTransformationMatrix,
  degrees,
  fill,
  lineTo,
  moveTo,
  PDFDocument,
  type PDFFont,
  type PDFOperator,
  type PDFPage,
  popGraphicsState,
  pushGraphicsState,
  setLineWidth,
  StandardFonts,
  stroke,
} from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";
import sharp from "sharp";
import { samplePlan } from "../src/data/samplePlan";
import { renderNode, openNode } from "./pdf-node";

export const OUT = join(__dirname, "../tests/fixtures/pdf");
const A4: [number, number] = [595.28, 841.89];
const LETTER: [number, number] = [612, 792];
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
  dims: { text: string; metres: number; lengthPt: number; measure?: "ticks" | "line"; lineLengthPt?: number }[];
  segments: Seg[];
  arcs: { cx: number; cy: number; r: number }[];
  texts: { str: string; x: number; y: number; rotation: number; height: number; width: number }[];
  rooms: string[];
  /** The plan's walls in metres (centre lines), the sample's ids. */
  walls: { id: string; a: { x: number; y: number }; b: { x: number; y: number }; thickness: number }[];
  /** Step M.1b: the same walls in the page's frame (viewport axes, origin the top-left of the centre lines). */
  planWalls: { id: string; a: { x: number; y: number }; b: { x: number; y: number }; thickness: number }[];
  /** Step M.1b: every opening's two jambs on its wall's centre line, in the page's frame. */
  planOpenings: { id: string; kind: "door" | "window"; wallId: string; a: { x: number; y: number }; b: { x: number; y: number } }[];
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
  /** Quarter circle about c from p0 to p3 (both at radius r), as one cubic Bézier. */
  arc(c: number[], p0: number[], p3: number[], r: number, w: number) {
    const K = 0.5523 * r;
    const t0 = [(p3[0] - c[0]) / r, (p3[1] - c[1]) / r]; // tangent at p0 points along c->p3
    const t3 = [(p0[0] - c[0]) / r, (p0[1] - c[1]) / r];
    this.ops.push(setLineWidth(w), moveTo(p0[0], p0[1]), appendBezierCurve(p0[0] + t0[0] * K, p0[1] + t0[1] * K, p3[0] + t3[0] * K, p3[1] + t3[1] * K, p3[0], p3[1]), stroke());
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
  dims: "mm" | "imperial" | null;
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
}

const fmtImperial = (ft: number, i: number) => {
  const whole = Math.floor(ft + 1e-9);
  const inches = Math.round((ft - whole) * 12);
  // Three printed forms, all read by parseDimension.
  return [`${whole}'-${inches}"`, `${whole}' ${inches}"`, `${whole} ft ${inches} in`][i % 3];
};

/** Draws the plan page and returns its truth. */
async function drawPlan(doc: PDFDocument, font: PDFFont, o: Options): Promise<Omit<Truth, "file" | "pages" | "planPage" | "kind" | "expectedScale" | "mismatchRatio">> {
  const [W, H] = o.imperial ? LETTER : A4;
  const page = doc.addPage([W, H]);
  const rotate = o.rotate ?? 0;
  if (rotate) page.setRotation(degrees(rotate));
  const k = o.fit ?? 1;
  const unit = o.imperial ? FT_PER_SAMPLE_M * 0.3048 : 1; // real metres per sample metre
  const ptPerM = o.imperial ? (PT_PER_IN / 0.0254) / 96 : (PT_PER_IN / 0.0254) / 100; // 1:96 or 1:100 on paper
  const s = unit * ptPerM; // points per sample metre
  const [X0, Y0] = o.imperial ? [150, 600] : [155, 640];
  const P = (x: number, y: number) => [X0 + x * s, Y0 - y * s]; // plan (sample metres, y down) -> user space
  const cmView = (x: number, y: number): [number, number] => [x * k, y * k];
  const view = (x: number, y: number): [number, number] => {
    const [cx, cy] = cmView(x, y);
    return rotate === 90 ? [cy, cx] : [cx, H - cy];
  };
  const pen = new Pen(page, font, view, k);
  pen.outlined = Boolean(o.outlined);
  if (k !== 1) pen.ops.push(pushGraphicsState(), concatTransformationMatrix(k, 0, 0, k, 0, 0));

  // Walls: one rectangle per piece between openings, extended by half its own
  // thickness at both ends so corners and T-junctions close.
  for (const w of samplePlan.walls) {
    const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    const d = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L };
    const n = { x: -d.y, y: d.x };
    const t = w.thickness;
    const at = (u: number, v: number) => P(w.a.x + d.x * u + n.x * v, w.a.y + d.y * u + n.y * v);
    const gaps = samplePlan.openings.filter((op) => op.wallId === w.id).map((op) => [op.offset - op.width / 2, op.offset + op.width / 2, op] as const).sort((p, q) => p[0] - q[0]);
    if (o.singleLine?.includes(w.id) && !gaps.length) {
      pen.line(at(-t / 2, 0), at(L + t / 2, 0), t * s); // one line as thick as the wall (butt caps)
      continue;
    }
    let from = -t / 2;
    for (const [g0, g1, op] of gaps) {
      pen.poly([at(from, -t / 2), at(g0, -t / 2), at(g0, t / 2), at(from, t / 2)], o.walls, 0.5);
      from = g1;
      if (op.kind === "window") for (const v of [-t / 2, 0, t / 2]) pen.line(at(g0, v), at(g1, v), 0.35);
      else {
        // Door: hinge at the gap end nearer a, leaf to the left of a->b, arc to the far end.
        const r = op.width;
        pen.line(at(g0, 0), at(g0, r), 0.35);
        pen.arc(at(g0, 0), at(g0, r), at(g1, 0), r * s, 0.35);
      }
    }
    pen.poly([at(from, -t / 2), at(L + t / 2, -t / 2), at(L + t / 2, t / 2), at(from, t / 2)], o.walls, 0.5);
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

  // Dimensions: a 0.5 pt line, extension lines and 45° ticks, the text 2.5 pt off
  // the line (above it, or left of it reading bottom to top).
  const dims: Truth["dims"] = [];
  const TH = 7;
  let nDim = 0;
  const label = (m: number) => (o.dims === "imperial" ? fmtImperial(m * FT_PER_SAMPLE_M, nDim++) : o.misprint && nDim++ === 0 ? "4100 mm" : `${Math.round(m * 1000)} mm`);
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
  const dimH = (x1: number, x2: number, y: number) => {
    if (o.broken) return broken(P(x1, y), P(x2, y), false, (x2 - x1) * unit);
    const [p, q] = [P(x1, y), P(x2, y)];
    pen.line(p, q, 0.5);
    for (const e of [p, q]) pen.line([e[0], e[1] - 4], [e[0], e[1] + 6], 0.25);
    tick(p);
    tick(q);
    const text = label(x2 - x1);
    pen.dimText(text, (p[0] + q[0]) / 2 - pen.width(text, TH) / 2, p[1] + 2.5, TH);
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
  if (o.dims) {
    dimH(0, 4, -1);
    dimH(4, 10, -1);
    dimH(0, 10, -1.8);
    dimV(0, 4, -1);
    dimV(4, 8, -1);
    dimV(0, 8, -1.8);
    dimV(0, 5, 11);
    dimV(5, 8, 11);
    dimH(0, 4, 9);
    dimH(4, 7, 9);
    dimH(7, 10, 9);
  }

  // Title block, bottom right of the sheet.
  const [tx, ty] = o.imperial ? [340, 40] : [330, 50];
  pen.poly([[tx, ty], [tx + 230, ty], [tx + 230, ty + 100], [tx, ty + 100]], "stroke", 0.75);
  const titleText = o.imperial ? `SCALE 1/8" = 1'-0"` : "SCALE 1:100";
  pen.text("Two-bedroom house", tx + 10, ty + 75, 10);
  pen.text("Ground floor plan", tx + 10, ty + 55, 8);
  pen.text(titleText, tx + 10, ty + 35, 8);
  pen.text(o.imperial ? "Letter" : "A4", tx + 10, ty + 15, 8);

  if (k !== 1) pen.ops.push(popGraphicsState());
  pen.flush();
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
  const raw = samplePlan.walls.map((w) => ({ id: w.id, a: inView(w.a), b: inView(w.b), thickness: w.thickness * unit }));
  const [ox, oy] = [Math.min(...raw.flatMap((w) => [w.a.x, w.b.x])), Math.min(...raw.flatMap((w) => [w.a.y, w.b.y]))];
  const shift = (p: { x: number; y: number }) => ({ x: p.x - ox, y: p.y - oy });
  const jamb = (wallId: string, at: number) => {
    const w = samplePlan.walls.find((x) => x.id === wallId)!;
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
    walls: samplePlan.walls.map((w) => ({ id: w.id, a: { x: w.a.x * unit, y: w.a.y * unit }, b: { x: w.b.x * unit, y: w.b.y * unit }, thickness: w.thickness * unit })),
    planWalls: raw.map((w) => ({ ...w, a: shift(w.a), b: shift(w.b) })),
    planOpenings: samplePlan.openings.map((op) => ({ id: op.id, kind: op.kind, wallId: op.wallId, a: jamb(op.wallId, op.offset - op.width / 2), b: jamb(op.wallId, op.offset + op.width / 2) })),
    ...(o.clutter ? { diagonal: 1 } : {}),
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
  truths.push(await make("plan-single-line.pdf", async (d, f) => ({ ...plain, expectedScale: "good", tracedWalls: ["w-KM"], ...(await drawPlan(d, f, { walls: "fill", dims: "mm", singleLine: ["w-KM"] })) })));
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
