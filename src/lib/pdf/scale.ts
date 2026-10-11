/**
 * src/lib/pdf/scale.ts
 *
 * The scale of a vector PDF page in METRES PER POINT, from its own text and
 * lines (no OCR, no pixels). Pure.
 *
 * Text lines: text items with the same rotation (within 1°), on the same
 * baseline (within 0.3 text heights across it) and close along it (a gap of at
 * most 0.8 text heights) are joined into one line, so `12'` and `-6"` printed
 * as two items read as one.
 *
 * SOURCE A, dimension text. A line whose whole text is one length
 * (parseDimension: the image pipeline's parseLength, plus "12 ft 6 in"; so
 * 3800 mm, 3.8 m, 380 cm, 12'-6", 12' 6", 12 ft 6 in) is matched to the line
 * it labels: the nearest segment that runs in the text's direction (within
 * 2°), is at least 4 text heights long, lies within 1.5 text heights of the
 * text's centre (perpendicular distance) and passes beside it (the centre
 * projects inside the segment). Sample = value / segment length. A second
 * text on the same segment with the same value (within 2%) is checked but
 * counted once.
 *
 * SOURCE B, a title-block scale: "1:100", "SCALE 1:50" (any line holding
 * 1:N), or the imperial 1/8" = 1'-0" (N = 12 / inches). Converted with
 * 1 pt = 25.4 / 72 mm on paper: mPerPt = N × 25.4 / 72 / 1000. When lines
 * disagree, the one that also says "scale" wins, else the first.
 *
 * RESULT RULES (the image pipeline's bands, blueprint/scale.ts `band`):
 *   - dimensions: good = 2 or more samples within 5% of their median; check =
 *     one sample, or a spread over 5 up to 15%; none = no samples or over 15%.
 *   - The result is the dimensions' when they give one (good or check).
 *   - THE TITLE BLOCK ALONE NEVER MAKES THE SCALE "good": with no usable
 *     dimensions it gives "check".
 *   - Agreeing (good) dimensions that differ from the title block by more than
 *     2% are used, and `mismatch` says so ("The title block says 1:100, but
 *     the printed dimensions measure 1:115, so the page was probably scaled to
 *     fit when printed. Using the dimensions.").
 *   - Numbers with no unit matched to lines are measured the same way but only
 *     reported in `unitless` (the "Feet or metres?" question), and only when
 *     no dimension with a unit was matched.
 *
 * Connects to: blueprint/scale.ts (parseLength, band), extract.ts (VectorPage),
 * analysePdf.ts; tested by scripts/test-pdf.ts.
 */
import { band, parseLength } from "@/lib/blueprint/scale";
import type { DimensionMatch, PdfScale, PdfText, TitleBlockScale, VectorPage } from "@/types/pdf";

/** Metres of real world per point of paper at 1:1. */
export const PAPER_M_PER_PT = 25.4 / 72 / 1000;
const PARALLEL = Math.sin((2 * Math.PI) / 180);
const MIN_LINE_H = 4; // × text height
const NEAR_H = 1.5; // × text height
const SAME_PCT = 2;
const TITLE_AGREE_PCT = 2;

/** One joined line of text. `u` is the unit reading direction, `centre` the
 *  middle of the line at half its cap height. */
export interface TextLine {
  text: string;
  x: number;
  y: number;
  u: { x: number; y: number };
  height: number;
  width: number;
  centre: { x: number; y: number };
}

/** One length in metres, as printed on a dimension: the image pipeline's
 *  parseLength after "ft" / "in" words become ' and " (as the wall panel's
 *  parseTypedLength does). Null for anything else, including a bare number. */
export function parseDimension(raw: string): number | null {
  const s = raw
    .trim()
    .replace(/\s*(?:feet|foot|ft)\.?(?![a-z])/gi, "'")
    .replace(/\s*(?:inches|inch|in)\.?(?![a-z])/gi, '"');
  return parseLength(s);
}

const BARE = /^\d+(?:\.\d+)?$/;
const RATIO = /(?<![\d.:/])1\s*:\s*(\d+(?:\.\d+)?)(?![\d.:])/;
const IMPERIAL = /(\d+(?:\/\d+)?)\s*(?:"|''|in\.?)\s*=\s*1\s*(?:'|ft\.?)(?:\s*-?\s*0\s*(?:"|in\.?)?)?/i;

/** The scale a title block states, or null. */
export function parseTitleScale(text: string): TitleBlockScale | null {
  const r = text.match(RATIO);
  if (r) {
    const ratio = Number(r[1]);
    return ratio >= 1 && ratio <= 10000 ? { text: `1:${r[1]}`, ratio, mPerPt: ratio * PAPER_M_PER_PT } : null;
  }
  const i = text.match(IMPERIAL);
  if (!i) return null;
  const [n, d] = i[1].split("/").map(Number);
  const inches = d ? n / d : n;
  if (!(inches > 0)) return null;
  const ratio = 12 / inches;
  return { text: i[0].trim(), ratio, mPerPt: ratio * PAPER_M_PER_PT };
}

/** Joins text items into lines (see header). */
export function textLines(texts: PdfText[]): TextLine[] {
  const lines: (TextLine & { rotation: number })[] = [];
  const sorted = [...texts].sort((p, q) => p.rotation - q.rotation || p.y - q.y || p.x - q.x);
  for (const t of sorted) {
    const u = { x: Math.cos((t.rotation * Math.PI) / 180), y: Math.sin((t.rotation * Math.PI) / 180) };
    const line = lines.find((l) => {
      if (Math.abs(l.rotation - t.rotation) > 1 || Math.abs(l.height - t.height) > 0.2 * l.height) return false;
      const dx = t.x - l.x;
      const dy = t.y - l.y;
      const across = Math.abs(dx * -l.u.y + dy * l.u.x);
      const gap = dx * l.u.x + dy * l.u.y - l.width;
      return across <= 0.3 * l.height && gap >= -0.3 * l.height && gap <= 0.8 * l.height;
    });
    if (line) {
      const gap = (t.x - line.x) * line.u.x + (t.y - line.y) * line.u.y - line.width;
      line.text += (gap > 0.15 * line.height ? " " : "") + t.str;
      line.width += gap + t.width;
    } else lines.push({ text: t.str, x: t.x, y: t.y, u, height: t.height, width: t.width, rotation: t.rotation, centre: { x: 0, y: 0 } });
  }
  return lines.map(({ rotation: _r, ...l }) => {
    const up = { x: l.u.y, y: -l.u.x }; // towards the tops of the letters (y down)
    const cap = 0.35 * l.height; // half a cap height above the baseline
    return { ...l, text: l.text.replace(/\s+/g, " ").trim(), centre: { x: l.x + (l.u.x * l.width) / 2 + up.x * cap, y: l.y + (l.u.y * l.width) / 2 + up.y * cap } };
  });
}

/** The axis-aligned box of a text line's rotated rectangle (baseline to cap height ≈ 0.75 h). */
export function lineBox(l: TextLine) {
  const up = { x: l.u.y, y: -l.u.x };
  const pts = [
    [l.x, l.y],
    [l.x + l.u.x * l.width, l.y + l.u.y * l.width],
    [l.x + up.x * 0.75 * l.height, l.y + up.y * 0.75 * l.height],
    [l.x + l.u.x * l.width + up.x * 0.75 * l.height, l.y + l.u.y * l.width + up.y * 0.75 * l.height],
  ];
  return { x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])) };
}

/** Index of the segment a text line labels (see header), or -1. */
export function labelledSegment(page: VectorPage, l: TextLine): number {
  let best = -1;
  let bestD = Infinity;
  page.segments.forEach((s, i) => {
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    const len = Math.hypot(dx, dy);
    if (len < MIN_LINE_H * l.height) return;
    const sx = dx / len;
    const sy = dy / len;
    if (Math.abs(sx * l.u.y - sy * l.u.x) > PARALLEL) return;
    const cx = l.centre.x - s.x1;
    const cy = l.centre.y - s.y1;
    const along = cx * sx + cy * sy;
    const d = Math.abs(cx * sy - cy * sx);
    if (along < 0 || along > len || d > NEAR_H * l.height || d >= bestD) return;
    best = i;
    bestD = d;
  });
  return best;
}

/** The result rules (header) from the dimension samples and the title block. */
export function combineScale(samples: number[], title: TitleBlockScale | null, paper: string): Pick<PdfScale, "mPerPt" | "confidence" | "reason" | "mismatch" | "dimensions"> {
  const b = band(samples);
  const dimensions = { mPerPt: b && b.confidence !== "none" ? b.median : null, n: samples.length, spreadPct: b?.spreadPct ?? 0, confidence: b?.confidence ?? ("none" as const) };
  const CLICK = "Click one wall and type its length to set the scale.";
  const CHECK = "Check it against a wall you know.";
  const n = samples.length;
  const pct = dimensions.spreadPct.toFixed(0);
  const out = (mPerPt: number | null, confidence: PdfScale["confidence"], reason: string, mismatch: string | null = null) => ({ mPerPt, confidence, reason, mismatch, dimensions });

  if (b && b.confidence === "good") {
    if (!title) return out(b.median, "good", `${n} printed dimensions agree within 5%.`);
    const off = (Math.abs(b.median - title.mPerPt) / title.mPerPt) * 100;
    if (off <= TITLE_AGREE_PCT) return out(b.median, "good", `${n} printed dimensions agree within 5%, and the title block's ${title.text} agrees.`);
    const measured = Math.round(b.median / PAPER_M_PER_PT);
    return out(
      b.median,
      "good",
      `${n} printed dimensions agree within 5%.`,
      `The title block says ${title.text}, but the printed dimensions measure 1:${measured}, so the page was probably scaled to fit when printed. Using the dimensions.`,
    );
  }
  if (b && b.confidence === "check") {
    const why = n === 1 ? "Only one printed dimension could be measured." : `${n} printed dimensions differ by up to ${pct}%.`;
    const titleNote = title ? ` The title block says ${title.text}.` : "";
    return out(b.median, "check", `${why}${titleNote} ${CHECK}`);
  }
  if (title) {
    const why = n > 0 ? `The printed dimensions disagree by ${pct}%, so the title block's ${title.text} on ${paper} is used.` : `Only the title block gives a scale (${title.text} on ${paper}).`;
    // The title block alone never makes "good": a printout may have been scaled to fit.
    return out(title.mPerPt, "check", `${why} A printed drawing may have been scaled to fit, so ${CHECK.toLowerCase()}`);
  }
  if (n > 0) return out(null, "none", `The printed dimensions disagree by ${pct}%. ${CLICK}`);
  return out(null, "none", `No printed dimensions or title-block scale were found on this page. ${CLICK}`);
}

/** The page's scale (header). */
export function pdfScale(page: VectorPage): PdfScale {
  const lines = textLines(page.texts);
  const matches: DimensionMatch[] = [];
  const rejected: PdfScale["rejected"] = [];
  const bare: number[] = []; // printed units per point
  const used = new Map<number, number[]>(); // segment index -> values already counted on it
  const titles: { t: TitleBlockScale; says: boolean }[] = [];

  for (const l of lines) {
    const title = parseTitleScale(l.text);
    if (title) {
      titles.push({ t: title, says: /scale/i.test(l.text) });
      continue;
    }
    const metres = parseDimension(l.text);
    const isBare = metres === null && BARE.test(l.text);
    if (metres === null && !isBare) continue;
    const i = labelledSegment(page, l);
    if (i < 0) {
      if (metres !== null) rejected.push({ text: l.text, why: "no dimension line found beside it" });
      continue;
    }
    const s = page.segments[i];
    const lengthPt = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    if (isBare) {
      if (Number(l.text) > 0) bare.push(Number(l.text) / lengthPt);
      continue;
    }
    const before = used.get(i) ?? [];
    const counted = !before.some((v) => Math.abs(v - metres!) <= (SAME_PCT / 100) * v);
    if (counted) used.set(i, [...before, metres!]);
    matches.push({ text: l.text, metres: metres!, lengthPt, line: { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 }, centre: l.centre, box: lineBox(l), counted });
  }

  const title = (titles.find((t) => t.says) ?? titles[0])?.t ?? null;
  const samples = matches.filter((m) => m.counted).map((m) => m.metres / m.lengthPt);
  const bareBand = matches.length === 0 ? band(bare) : null;
  const unitless = bareBand && bareBand.confidence !== "none" ? { unitsPerPt: bareBand.median, n: bare.length, spreadPct: bareBand.spreadPct, confidence: bareBand.confidence as "good" | "check" } : null;
  return { ...combineScale(samples, title, page.paper), title, matches, rejected, unitless };
}
