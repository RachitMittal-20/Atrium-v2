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
import type { Opening } from "../src/types/plan";
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
  dims: { text: string; metres: number; lengthPt: number; measure?: "ticks" | "line"; lineLengthPt?: number; spans?: "opening width" }[];
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
  }[];
  /** Step M.1c: decoy arcs drawn (never swings). */
  decoyArcs?: number;
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
  /** Step M.1c (plan-doors): these openings in place of the sample's, swings as polyline arcs,
   *  the decoy arcs, and two printed opening widths (the north dimensions move out to make room). */
  doors?: FixtureOpening[];
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
  style: "door" | "double" | "sliding" | "window3" | "window2" | "gap";
  hinge?: "a" | "b";
  side?: 1 | -1;
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
const CLASS_OF = { door: "door", double: "double", sliding: "sliding", window3: "window", window2: "window", gap: "unclassified" } as const;

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
    // The sample's openings drawn as before, or plan-doors' (step M.1c) in their own styles.
    const styleOf = (op: Opening | FixtureOpening): FixtureOpening["style"] => ("style" in op ? op.style : op.kind === "window" ? "window3" : "door");
    const gaps = (o.doors ?? samplePlan.openings).filter((op) => op.wallId === w.id).map((op) => [op.offset - op.width / 2, op.offset + op.width / 2, op] as const).sort((p, q) => p[0] - q[0]);
    if (o.singleLine?.includes(w.id) && !gaps.length) {
      pen.line(at(-t / 2, 0), at(L + t / 2, 0), t * s); // one line as thick as the wall (butt caps)
      continue;
    }
    /** A swing about the hinge at u = h, leaf r long to side sd, arc to the wall line at u = to. */
    const swing = (h: number, to: number, r: number, sd: number) => {
      pen.line(at(h, 0), at(h, sd * r), 0.35);
      const [c, tip, end] = [at(h, 0), at(h, sd * r), at(to, 0)];
      const a0 = Math.atan2(tip[1] - c[1], tip[0] - c[0]);
      let sweep = Math.atan2(end[1] - c[1], end[0] - c[0]) - a0;
      sweep -= 2 * Math.PI * Math.round(sweep / (2 * Math.PI));
      pen.polyArc(c, r * s, a0, sweep, 16, 0.35);
    };
    let from = -t / 2;
    for (const [g0, g1, op] of gaps) {
      pen.poly([at(from, -t / 2), at(g0, -t / 2), at(g0, t / 2), at(from, t / 2)], o.walls, 0.5);
      from = g1;
      const style = styleOf(op);
      const fo = "style" in op ? op : null;
      if (style === "window3") for (const v of [-t / 2, 0, t / 2]) pen.line(at(g0, v), at(g1, v), 0.35);
      else if (style === "window2") for (const v of [-t / 4, t / 4]) pen.line(at(g0, v), at(g1, v), 0.35);
      else if (style === "sliding") {
        // Two 0.04 m panels, each 55% of the gap, one from each jamb, staggered across the wall.
        const pw = 0.55 * (g1 - g0);
        pen.poly([at(g0, -0.06), at(g0 + pw, -0.06), at(g0 + pw, -0.02), at(g0, -0.02)], "stroke", 0.35);
        pen.poly([at(g1 - pw, 0.02), at(g1, 0.02), at(g1, 0.06), at(g1 - pw, 0.06)], "stroke", 0.35);
      } else if (style === "double") {
        const r = (g1 - g0) / 2;
        swing(g0, g0 + r, r, fo!.side!);
        swing(g1, g1 - r, r, fo!.side!);
      } else if (style === "door" && fo) swing(fo.hinge === "b" ? g1 : g0, fo.hinge === "b" ? g0 : g1, g1 - g0, fo.side!);
      else if (style === "door") {
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
  if (o.doors) {
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
  if (o.dims) {
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
    if (o.doors) {
      dimH(6.5, 7.5, -0.75, 6); // the front door's width
      dimH(8.4, 9.6, -0.75, 6); // the north window's width
      for (const dm of dims.slice(-2)) dm.spans = "opening width"; // what the model check measures them between
    }
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
    planOpenings: (o.doors ?? samplePlan.openings).map((op) => {
      const style = "style" in op ? op.style : op.kind === "window" ? "window3" : "door";
      const fo = "style" in op ? op : null;
      const kind = style === "window3" || style === "window2" ? ("window" as const) : ("door" as const);
      const [s0, s1] = [op.offset - op.width / 2, op.offset + op.width / 2];
      // The leaf's side as a unit vector in the page's frame: the sample wall's (-dy, dx) normal times the side, mapped.
      const w = samplePlan.walls.find((x) => x.id === op.wallId)!;
      const Lw = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
      const n = { x: -(w.b.y - w.a.y) / Lw, y: (w.b.x - w.a.x) / Lw };
      const sd = fo ? (fo.side ?? 1) : 1;
      const p0 = inView(w.a);
      const p1 = inView({ x: w.a.x + n.x * sd, y: w.a.y + n.y * sd });
      const side = { x: (p1.x - p0.x) / Math.hypot(p1.x - p0.x, p1.y - p0.y), y: (p1.y - p0.y) / Math.hypot(p1.x - p0.x, p1.y - p0.y) };
      const swingInfo = style === "door" ? { hinge: jamb(op.wallId, fo?.hinge === "b" ? s1 : s0), side } : style === "double" ? { side } : {};
      return { id: op.id, kind, wallId: op.wallId, a: jamb(op.wallId, s0), b: jamb(op.wallId, s1), class: CLASS_OF[style], ...swingInfo };
    }),
    ...(o.clutter ? { diagonal: 1 } : {}),
    ...(o.doors ? { decoyArcs: 4 } : {}),
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
  truths.push(await make("plan-doors.pdf", async (d, f) => ({ ...plain, expectedScale: "good", ...(await drawPlan(d, f, { walls: "stroke", dims: "mm", doors: DOOR_FIXTURE })) })));
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
