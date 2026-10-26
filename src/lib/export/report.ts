/**
 * report.ts — the takeoff report as a PDF (step X.2, roadmap 7.3), written from plan data with pdf-lib,
 * never a screenshot. Loaded only when the user exports (ExportDialog.tsx imports this module
 * dynamically), so pdf-lib is not in the studio's first load. Nothing is fetched: the text is in
 * Helvetica and Helvetica-Bold, two of the 14 fonts every PDF reader has built in, so no font is
 * embedded or downloaded. Those fonts only encode Windows-1252, so `clean` turns "−" into "-" and
 * any other character they lack into "?".
 *
 * A4 landscape (841.89 × 595.28 pt), 36 pt margins.
 *   - Page 1: the title, plan name, date and units used; the plan verdict and its reasons; the scale
 *     source; the counts; and a vector drawing of the plan (walls, gaps, door swings, window lines, as
 *     the 2D plan draws them, via the landing page's pure `sheetShapes`) with each room's name and area.
 *   - Then the room schedule and openings schedule (schedule.ts, totals summed from exact values), the
 *     studio's takeoffs and the PDF's dimension rows (src/lib/takeoff/rows.ts), page breaks as needed.
 *     Every takeoff row shows its measured value, the reference, the difference, the status and the
 *     override BESIDE the measured value, never in its place.
 *   - A footer on every page: REPORT_FOOTER and "Page n of N".
 * The verdict is `planVerdict` on the plan as it is now (the import's coverage is not kept in the plan),
 * as the studio's Report a problem judges it. The report holds no coordinates and no file names: the
 * plan stores neither in a form the report prints, and nothing here reads them.
 * Values are in the user's units (src/store/unitsStore.ts, passed in), lengths and areas to the
 * takeoff table's precision (3 decimals in m, m² and sq ft; whole mm and mm²; 1/16").
 * Connects to: pdf-lib, src/lib/export/schedule.ts, src/lib/takeoff/rows.ts, src/lib/pdf/verdict.ts,
 * src/lib/plan/calibrate.ts (rescaledText), src/lib/landing/blueprint.ts (sheetShapes),
 * src/lib/units/format.ts; used by ExportDialog.tsx and scripts/test-exports.ts.
 */
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { sheetShapes } from "@/lib/landing/blueprint";
import { planVerdict, VERDICT_LABEL } from "@/lib/pdf/verdict";
import { rescaledText } from "@/lib/plan/calibrate";
import { deriveRooms } from "@/lib/plan/rooms";
import { STATUS_TEXT, takeoffRow, totals, wallsHash, type TakeoffRow, type Units } from "@/lib/takeoff/rows";
import { AREA_LABEL, formatArea, formatLength, LENGTH_LABEL } from "@/lib/units/format";
import type { Plan, Vec2 } from "@/types/plan";
import { buildSchedule, KIND_TEXT } from "./schedule";

export const REPORT_FOOTER = "Measured from the drawing; heights are defaults unless changed. Check against the original drawing.";

const W = 841.89;
const H = 595.28;
const M = 36;
const FOOTER_Y = 20;
/** Content stops this far above the page's bottom edge, clear of the footer. */
const BOTTOM = 44;
const ROW = 13;

/** The design tokens' values (src/app/globals.css): iron text and lines, smoke secondary, stone hairlines, gilt accent. */
const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const INK = { iron: hex("#1c1916"), smoke: hex("#6f675c"), stone: hex("#cfc5b3"), gilt: hex("#a9823f"), paper: rgb(1, 1, 1) };

export interface ReportInput {
  plan: Plan;
  units: Units;
  /** The date as it should be printed; the caller formats it (the test passes a fixed one). */
  date: string;
}

/** Where the plan's scale came from, as far as the plan itself records it. */
export function scaleSource(plan: Plan): string {
  const base =
    plan.background?.kind === "pdf"
      ? "from the PDF the plan was read from"
      : plan.background?.kind === "image"
        ? "from the image the plan was read from"
        : plan.meta.source === "sample"
          ? "the sample plan's own dimensions"
          : plan.meta.source === "blueprint"
            ? "from the imported drawing"
            : "as drawn in the studio";
  const r = rescaledText(plan.calibrations);
  return r ? `${base}; then Set scale in the studio (${r})` : base;
}

interface Col {
  head: string;
  width: number;
  right?: boolean;
}

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(
    readonly doc: PDFDocument,
    readonly font: PDFFont,
    readonly bold: PDFFont,
  ) {
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([W, H]);
    this.y = H - M;
  }

  /** Room for `h` more points on this page, else a new one. */
  ensure(h: number) {
    if (this.y - h < BOTTOM) this.newPage();
  }

  text(s: string, x: number, y: number, size: number, opts: { bold?: boolean; color?: RGB; width?: number; right?: boolean } = {}) {
    const f = opts.bold ? this.bold : this.font;
    const t = opts.width ? fit(clean(f, s), opts.width, size, f) : clean(f, s);
    if (!t) return;
    const dx = opts.right && opts.width ? opts.width - f.widthOfTextAtSize(t, size) : 0;
    this.page.drawText(t, { x: x + dx, y, size, font: f, color: opts.color ?? INK.iron });
  }

  /** A paragraph wrapped to `width`, from the current y down. */
  para(s: string, x: number, width: number, size: number, opts: { bold?: boolean; color?: RGB } = {}) {
    for (const line of wrap(clean(opts.bold ? this.bold : this.font, s), width, size, opts.bold ? this.bold : this.font)) {
      this.ensure(size + 3);
      this.text(line, x, this.y - size, size, opts);
      this.y -= size + 3;
    }
  }

  heading(s: string) {
    this.ensure(22 + 2 * ROW); // never a heading alone at the foot of a page
    this.y -= 10;
    this.text(s, M, this.y - 12, 12, { bold: true });
    this.y -= 18;
  }

  /** A table; the head repeats on each page it runs onto. `boldLast` sets a totals row in bold. */
  table(cols: Col[], rows: string[][], boldLast = false) {
    const head = () => {
      this.ensure(2 * ROW);
      this.row(cols, cols.map((c) => c.head), true, INK.smoke);
      this.page.drawLine({ start: { x: M, y: this.y + 3 }, end: { x: M + cols.reduce((s, c) => s + c.width, 0), y: this.y + 3 }, thickness: 0.5, color: INK.stone });
    };
    head();
    rows.forEach((r, i) => {
      if (this.y - ROW < BOTTOM) {
        this.newPage();
        head();
      }
      this.row(cols, r, boldLast && i === rows.length - 1);
    });
  }

  private row(cols: Col[], cells: string[], bold: boolean, color?: RGB) {
    let x = M;
    cols.forEach((c, i) => {
      this.text(cells[i] ?? "", x, this.y - 9, 8, { bold, color, width: c.width - 6, right: c.right });
      x += c.width;
    });
    this.y -= ROW;
  }
}

/** Only what a standard font can encode: "−" becomes "-", anything else it lacks "?". */
function clean(font: PDFFont, s: string): string {
  const set = new Set(font.getCharacterSet());
  return [...s.replace(/−/g, "-").replace(/[\t\r\n]+/g, " ")].map((c) => (set.has(c.codePointAt(0)!) ? c : "?")).join("");
}

/** `s` shortened with an ellipsis to fit `width`. */
function fit(s: string, width: number, size: number, font: PDFFont): string {
  if (font.widthOfTextAtSize(s, size) <= width) return s;
  let t = s;
  while (t && font.widthOfTextAtSize(t + "…", size) > width) t = t.slice(0, -1);
  return t + "…";
}

/** Words into lines no wider than `width` (a single overlong word is shortened). */
function wrap(s: string, width: number, size: number, font: PDFFont): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of s.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.map((l) => fit(l, width, size, font));
}

/** The plan drawn into the box (left, top, width, height) in page points, y up. */
function drawPlan(w: Writer, plan: Plan, units: Units, box: { left: number; top: number; width: number; height: number }) {
  const { page } = w;
  page.drawRectangle({ x: box.left, y: box.top - box.height, width: box.width, height: box.height, borderColor: INK.stone, borderWidth: 0.5 });
  const shapes = sheetShapes(plan);
  const pts = shapes.walls.flat();
  if (pts.length === 0) {
    w.text("No walls to draw.", box.left + 12, box.top - 24, 9, { color: INK.smoke });
    return;
  }
  const pad = 18;
  const [minX, maxX] = [Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x))];
  const [minY, maxY] = [Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y))];
  const k = Math.min((box.width - 2 * pad) / Math.max(maxX - minX, 1e-6), (box.height - 2 * pad) / Math.max(maxY - minY, 1e-6));
  // Plan y points down, like the path's: drawSvgPath flips it about (x, y) = the drawing's top-left.
  const ox = box.left + (box.width - (maxX - minX) * k) / 2;
  const oy = box.top - (box.height - (maxY - minY) * k) / 2;
  const P = (p: Vec2) => `${((p.x - minX) * k).toFixed(3)},${((p.y - minY) * k).toFixed(3)}`;
  const poly = (ps: Vec2[]) => `M${ps.map(P).join("L")}Z`;
  const at = { x: ox, y: oy };
  for (const o of shapes.walls) if (o.length) page.drawSvgPath(poly(o), { ...at, color: INK.iron, borderColor: INK.iron, borderWidth: 0.3 });
  for (const g of shapes.gaps) page.drawSvgPath(poly(g.band), { ...at, color: INK.paper });
  for (const d of shapes.doors) {
    page.drawSvgPath(`M${P(d.hinge)}L${P(d.leafEnd)}`, { ...at, borderColor: INK.iron, borderWidth: 0.6 });
    page.drawSvgPath(`M${P(d.leafEnd)}A${(d.r * k).toFixed(3)},${(d.r * k).toFixed(3)} 0 0 ${d.sweep} ${P(d.arcEnd)}`, { ...at, borderColor: INK.smoke, borderWidth: 0.4 });
  }
  for (const win of shapes.windows) win.lines.forEach(([p, q], i) => page.drawSvgPath(`M${P(p)}L${P(q)}`, { ...at, borderColor: INK.iron, borderWidth: i === 2 ? 0.4 : 0.6 }));
  for (const r of deriveRooms(plan)) {
    const x = ox + (r.labelPoint.x - minX) * k;
    const y = oy - (r.labelPoint.y - minY) * k;
    for (const [s, size, bold, dy] of [[r.name, 7.5, true, 1], [formatArea(r.area, units.area), 6.5, false, -8]] as const) {
      const f = bold ? w.bold : w.font;
      const t = fit(clean(f, s), 110, size, f);
      w.text(t, x - f.widthOfTextAtSize(t, size) / 2, y + dy, size, { bold, color: bold ? INK.iron : INK.smoke });
    }
  }
}

export async function buildReport({ plan, units, date }: ReportInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${plan.name}: takeoff report`);
  doc.setCreator("Atrium");
  doc.setProducer("Atrium");
  const w = new Writer(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold));
  const len = (m: number) => formatLength(m, units.length);
  const area = (m2: number) => formatArea(m2, units.area);
  const rooms = deriveRooms(plan);
  const schedule = buildSchedule(plan, rooms);
  const verdict = planVerdict(plan, { detached: [], conflicts: [], refused: 0 });

  // ---------------------------------------------------------------- page 1: title block, verdict, drawing
  const COL = 280;
  w.text("Takeoff report", M, w.y - 18, 18, { bold: true });
  w.y -= 30;
  for (const [k, v] of [["Plan", plan.name], ["Date", date], ["Units", `lengths in ${LENGTH_LABEL[units.length]}, areas in ${AREA_LABEL[units.area]}`]]) {
    w.text(`${k}: ${v}`, M, w.y - 10, 10, { width: COL });
    w.y -= 15;
  }
  w.y -= 8;
  w.text(`Verdict: ${VERDICT_LABEL[verdict.level]}`, M, w.y - 11, 11, { bold: true, color: verdict.level === "good" ? INK.iron : INK.gilt });
  w.y -= 17;
  for (const reason of verdict.reasons) w.para(reason, M, COL, 9);
  w.para("Judged from the plan as it is now: its rooms, free wall ends and connected pieces.", M, COL, 8, { color: INK.smoke });
  w.y -= 8;
  w.para(`Scale: ${scaleSource(plan)}.`, M, COL, 9);
  w.y -= 8;
  const counts: [string, string][] = [
    ["Walls", String(plan.walls.length)],
    ["Doors", String(schedule.totals.doors)],
    ["Windows", String(schedule.totals.windows)],
    ["Rooms", String(rooms.length)],
    ["Net floor area", area(schedule.totals.area)],
    ["Takeoffs", String(plan.takeoffs?.length ?? 0)],
  ];
  for (const [k, v] of counts) {
    w.text(k, M, w.y - 9, 9, { color: INK.smoke });
    w.text(v, M + 110, w.y - 9, 9);
    w.y -= 13;
  }
  drawPlan(w, plan, units, { left: M + COL + 20, top: H - M, width: W - 2 * M - COL - 20, height: H - M - BOTTOM });
  w.text("Plan, not to scale: measure from the tables.", M + COL + 20, BOTTOM - 12, 7, { color: INK.smoke });

  // ---------------------------------------------------------------- schedules
  w.newPage();
  w.heading("Room schedule");
  w.table(
    [{ head: "Room", width: 300 }, { head: "Net area", width: 130, right: true }, { head: "Perimeter", width: 130, right: true }],
    [...schedule.rooms.map((r) => [r.name, area(r.area), len(r.perimeter)]), ["Total", area(schedule.totals.area), len(schedule.totals.perimeter)]],
    true,
  );
  w.para("Rows are rounded; totals are summed from exact values.", M, 560, 7.5, { color: INK.smoke });

  w.heading("Openings schedule");
  w.table(
    [{ head: "Type", width: 120 }, { head: "Width", width: 110, right: true }, { head: "Height", width: 110, right: true }, { head: "Sill", width: 110, right: true }, { head: "Count", width: 70, right: true }],
    [
      ...schedule.openings.map((o) => [KIND_TEXT[o.kind], len(o.width), len(o.height), len(o.sill), String(o.count)]),
      ["Total", "", "", "", String(schedule.totals.doors + schedule.totals.windows)],
    ],
    true,
  );
  w.para(`${schedule.totals.doors} doors and ${schedule.totals.windows} windows, grouped by size.`, M, 560, 7.5, { color: INK.smoke });

  // ---------------------------------------------------------------- takeoffs and the PDF's dimensions
  const hash = wallsHash(plan.walls);
  const rows = (plan.takeoffs ?? []).map((t) => takeoffRow(plan, t, hash));
  const value = (r: TakeoffRow, v: number | null | undefined) => (v === null || v === undefined ? "" : r.takeoff.kind === "length" ? len(v) : area(v));
  const signed = (r: TakeoffRow) => (r.difference === null ? "" : `${r.difference > 0 ? "+" : ""}${value(r, r.difference)}`);
  const cols: Col[] = [
    { head: "Name", width: 150 },
    { head: "Kind", width: 40 },
    { head: "Basis", width: 96 },
    { head: "Measured", width: 74, right: true },
    { head: "Reference", width: 74, right: true },
    { head: "Difference", width: 68, right: true },
    { head: "Status", width: 92 },
    { head: "Override", width: 74, right: true },
    { head: "Override note", width: 102 },
  ];
  const cells = (r: TakeoffRow) => [
    r.takeoff.name,
    r.takeoff.kind,
    r.basis,
    value(r, r.measured),
    value(r, r.takeoff.reference?.value),
    signed(r),
    STATUS_TEXT[r.status] + (r.stale ? ", walls moved" : ""),
    value(r, r.takeoff.override?.value),
    r.takeoff.override?.note ?? "",
  ];
  const mine = rows.filter((r) => r.takeoff.source !== "pdf");
  const pdf = rows.filter((r) => r.takeoff.source === "pdf");
  w.heading("Takeoffs");
  if (mine.length) w.table(cols, mine.map(cells));
  else w.para("No takeoffs measured in the studio.", M, 560, 9, { color: INK.smoke });
  if (pdf.length) {
    w.heading("PDF dimensions");
    w.para("The drawing's printed dimensions, measured on the model. Reference is the printed value.", M, 700, 8, { color: INK.smoke });
    w.table(cols, pdf.map(cells));
  }
  if (rows.length) {
    const t = totals(rows);
    w.y -= 6;
    const sums = [
      rows.some((r) => r.takeoff.kind === "length") && `lengths ${len(t.lengthMeasured)} measured, ${len(t.lengthEffective)} effective`,
      rows.some((r) => r.takeoff.kind === "area") && `areas ${area(t.areaMeasured)} measured, ${area(t.areaEffective)} effective`,
    ].filter(Boolean);
    w.para(`All takeoffs, summed from exact values: ${sums.join("; ")}.`, M, 770, 8);
    w.para("An override never replaces the measured value: the status compares the measured value, and effective uses the override where there is one.", M, 770, 7.5, { color: INK.smoke });
  }

  // ---------------------------------------------------------------- the footer on every page
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    w.page = p;
    w.text(REPORT_FOOTER, M, FOOTER_Y, 7, { color: INK.smoke });
    w.text(`Page ${i + 1} of ${pages.length}`, W - M - 80, FOOTER_Y, 7, { color: INK.smoke, width: 80, right: true });
  });
  return doc.save();
}
