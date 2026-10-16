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
 * it labels (dimensionLine): the nearest segment that runs in the text's
 * direction (within 2°), is at least 4 text heights long, lies within 1.5 text
 * heights of the text's centre (perpendicular distance) and passes beside it
 * (the centre projects inside the segment); or (step M.1b) a line BROKEN around
 * its own text: two collinear parts with the text between them, each ending
 * within 2 text heights of the text, treated as one line from end to end.
 * What is measured (step M.1b): when ticks or extension lines cross the line
 * near both ends (segments perpendicular to it, at least 1 text height long,
 * within 0.5 text heights of the end), the distance between those crossings
 * ("between ticks"), so a line that overshoots its ticks is not over-measured;
 * otherwise the line's own length ("line length"). Sample = value / measured
 * length. A second text on the same line with the same value (within 2%) is
 * checked but counted once.
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
 *   - STATED UNIT (step Q.1): a metric drawing prints bare millimetres and says so
 *     in its general notes. A text line such as "ALL DIMENSIONS IN mm",
 *     "DIMENSIONS ARE IN CENTIMETRES" or "UNITS: m" (mm, cm or m only; feet and
 *     inches never) makes every bare number on a dimension line a dimension in that
 *     unit, with a row and a sample like any other. Two notes that disagree state
 *     nothing. The reason says where the unit came from.
 *   - ANNOTATION (step Q.1): dimensions are annotation, never walls. `annotation`
 *     lists the segments (indexes into page.segments) of every dimension whose
 *     sample agrees with its band's median within 5% (the line's length is
 *     explained by its text at the page's scale, with or without a unit): the
 *     drawn line (both parts when broken) and its extension lines, which are
 *     perpendicular to it, have an end within 0.5 text heights of one of its
 *     ends, and do not cross it (both ends on one side, within 0.05 text
 *     heights). A wall face that passes THROUGH a dimension line's end (a
 *     dimension drawn face to face inside a room) is never one. walls.ts leaves
 *     them all out of the wall faces. Ticks are too short to be faces anyway.
 *
 * OCR (step M.1b): an outlined page's text, read by OCR, goes through the SAME
 * rules (pdfScale(page, "ocr")); the matches say so, and the title block
 * alone still gives "check".
 *
 * Connects to: blueprint/scale.ts (parseLength, band), extract.ts (VectorPage),
 * analysePdf.ts; tested by scripts/test-pdf.ts and scripts/test-pdf-walls.ts.
 */
import { band, parseLength } from "@/lib/blueprint/scale";
import type { DimensionMatch, PdfScale, PdfText, TitleBlockScale, VectorPage } from "@/types/pdf";

/** Metres of real world per point of paper at 1:1. */
export const PAPER_M_PER_PT = 25.4 / 72 / 1000;
const PARALLEL = Math.sin((2 * Math.PI) / 180);
const MIN_LINE_H = 4; // × text height
const NEAR_H = 1.5; // × text height
const BROKEN_H = 2; // × text height: a broken line's parts end this close to the text
const TICK_NEAR_H = 0.5; // × text height: a tick this close to a line end measures it
const TICK_MIN_H = 1; // × text height: a tick or extension line at least this long
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
/** A general note stating the dimension unit (header, step Q.1): mm, cm or m only. */
const UNIT_NOTE = /\b(?:dimensions?|dims\.?|units?)\s*(?:are\s+)?(?:in\b|:|-|–)?\s*(mm|millimet(?:er|re)s?|cm|centimet(?:er|re)s?|m|met(?:er|re)s?)(?![a-z²\d])/i;

/** The unit the page's notes state for bare numbers, or null (none, or two that disagree). */
export function statedUnit(lines: Pick<TextLine, "text">[]): { unit: "mm" | "cm" | "m"; metres: number; note: string } | null {
  const found = lines.flatMap((l) => {
    const m = l.text.match(UNIT_NOTE);
    if (!m) return [];
    const w = m[1].toLowerCase();
    const unit = w.startsWith("mm") || w.startsWith("milli") ? "mm" : w.startsWith("c") ? "cm" : "m";
    return [{ unit, metres: { mm: 0.001, cm: 0.01, m: 1 }[unit], note: l.text } as const];
  });
  return found.length && found.every((f) => f.unit === found[0].unit) ? found[0] : null;
}
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
  // By rotation, then across the reading direction, then along it (for 0°: y, then x), so the
  // words of a line always arrive in reading order, bottom-to-top text included.
  const key = (t: PdfText) => {
    const [c, n] = [Math.cos((t.rotation * Math.PI) / 180), Math.sin((t.rotation * Math.PI) / 180)];
    return { across: -t.x * n + t.y * c, along: t.x * c + t.y * n };
  };
  const sorted = [...texts].sort((p, q) => p.rotation - q.rotation || key(p).across - key(q).across || key(p).along - key(q).along);
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

/** The line a dimension text labels, and what its length is measured between. */
export interface DimensionLine {
  /** Identifies the drawn line (segment indexes), for counting a value once per line. */
  key: string;
  line: { x1: number; y1: number; x2: number; y2: number };
  ends: { x1: number; y1: number; x2: number; y2: number };
  measure: "ticks" | "line";
  lengthPt: number;
}

/** The line a text line labels (see header): one segment beside the text, or two
 *  collinear parts with the text in the gap between them; null when neither. */
export function dimensionLine(page: Pick<VectorPage, "segments">, l: TextLine): DimensionLine | null {
  const h = l.height;
  let best: { key: string; line: DimensionLine["line"]; d: number } | null = null;
  const parts: { i: number; s: number; e: number; off: number }[] = []; // parallel segments on the text's line, in text coordinates
  page.segments.forEach((g, i) => {
    const dx = g.x2 - g.x1;
    const dy = g.y2 - g.y1;
    const len = Math.hypot(dx, dy);
    if (len === 0 || Math.abs((dx / len) * l.u.y - (dy / len) * l.u.x) > PARALLEL) return;
    // Along and across the text, from its centre.
    const a1 = (g.x1 - l.centre.x) * l.u.x + (g.y1 - l.centre.y) * l.u.y;
    const a2 = (g.x2 - l.centre.x) * l.u.x + (g.y2 - l.centre.y) * l.u.y;
    const off = (g.x1 - l.centre.x) * -l.u.y + (g.y1 - l.centre.y) * l.u.x;
    const d = Math.abs(off);
    if (d > NEAR_H * h) return;
    const [s, e] = a1 < a2 ? [a1, a2] : [a2, a1];
    if (len >= MIN_LINE_H * h && s <= 0 && e >= 0 && (!best || d < best.d)) best = { key: `${i}`, line: { x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2 }, d };
    parts.push({ i, s, e, off });
  });
  // Broken around the text: a part ending before the text and one starting after it, on one line, each within 2 text heights of it.
  const reach = l.width / 2 + BROKEN_H * h;
  for (const p of parts.filter((p) => p.e <= 0 && p.e >= -reach))
    for (const q of parts.filter((q) => q.s >= 0 && q.s <= reach && Math.abs(q.off - p.off) <= 0.1 * h)) {
      const d = Math.abs((p.off + q.off) / 2);
      if (q.e - p.s < MIN_LINE_H * h || (best && d >= best.d)) continue;
      const at = (a: number, off: number) => ({ x: l.centre.x + l.u.x * a - l.u.y * off, y: l.centre.y + l.u.y * a + l.u.x * off });
      const [from, to] = [at(p.s, p.off), at(q.e, q.off)];
      best = { key: `${p.i}+${q.i}`, line: { x1: from.x, y1: from.y, x2: to.x, y2: to.y }, d };
    }
  if (!best) return null;
  const { key, line } = best as { key: string; line: DimensionLine["line"] };
  const ticks = tickEnds(page, line, h);
  const ends = ticks ?? line;
  return { key, line, ends, measure: ticks ? "ticks" : "line", lengthPt: Math.hypot(ends.x2 - ends.x1, ends.y2 - ends.y1) };
}

/** Where ticks or extension lines cross the line near both its ends (header), or null. */
function tickEnds(page: Pick<VectorPage, "segments">, line: DimensionLine["line"], h: number): DimensionLine["ends"] | null {
  const len = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
  const u = { x: (line.x2 - line.x1) / len, y: (line.y2 - line.y1) / len };
  const found: (number | null)[] = [null, null]; // along the line from its start
  const gap: number[] = [Infinity, Infinity];
  for (const g of page.segments) {
    const dx = g.x2 - g.x1;
    const dy = g.y2 - g.y1;
    const gl = Math.hypot(dx, dy);
    if (gl < TICK_MIN_H * h || Math.abs((dx / gl) * u.x + (dy / gl) * u.y) > PARALLEL) continue; // perpendicular, at least one text height
    // The tick's position along the line, and whether it reaches the line across.
    const a = ((g.x1 + g.x2) / 2 - line.x1) * u.x + ((g.y1 + g.y2) / 2 - line.y1) * u.y;
    const c1 = (g.x1 - line.x1) * -u.y + (g.y1 - line.y1) * u.x;
    const c2 = (g.x2 - line.x1) * -u.y + (g.y2 - line.y1) * u.x;
    if (Math.min(c1, c2) > 0.05 * h || Math.max(c1, c2) < -0.05 * h) continue;
    [0, len].forEach((end, k) => {
      const d = Math.abs(a - end);
      if (d <= TICK_NEAR_H * h && d < gap[k]) [found[k], gap[k]] = [a, d];
    });
  }
  if (found[0] === null || found[1] === null) return null;
  const p = (a: number) => ({ x: line.x1 + u.x * a, y: line.y1 + u.y * a });
  const [p1, p2] = [p(found[0]), p(found[1])];
  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
}

/** Extension lines of a dimension line (header, ANNOTATION): segment indexes. */
function extensionLines(page: Pick<VectorPage, "segments">, line: DimensionLine["line"], h: number): number[] {
  const len = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
  const u = { x: (line.x2 - line.x1) / len, y: (line.y2 - line.y1) / len };
  const ends = [{ x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 }];
  const out: number[] = [];
  page.segments.forEach((g, i) => {
    const gl = Math.hypot(g.x2 - g.x1, g.y2 - g.y1);
    if (gl === 0 || Math.abs(((g.x2 - g.x1) / gl) * u.x + ((g.y2 - g.y1) / gl) * u.y) > PARALLEL) return;
    const off = (x: number, y: number) => (x - line.x1) * -u.y + (y - line.y1) * u.x; // across the dimension line
    const [o1, o2] = [off(g.x1, g.y1), off(g.x2, g.y2)];
    if (Math.min(o1, o2) < -0.05 * h && Math.max(o1, o2) > 0.05 * h) return; // crosses it: a wall face through its end
    const near = (x: number, y: number) => ends.some((e) => Math.hypot(x - e.x, y - e.y) <= TICK_NEAR_H * h);
    if (near(g.x1, g.y1) || near(g.x2, g.y2)) out.push(i);
  });
  return out;
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

/** The page's scale (header). `source` labels the matches: "ocr" when the
 *  texts were read by OCR off a raster of an outlined page. */
export function pdfScale(page: Pick<VectorPage, "segments" | "texts" | "paper">, source: DimensionMatch["source"] = "pdf"): PdfScale {
  const lines = textLines(page.texts);
  const matches: DimensionMatch[] = [];
  const rejected: PdfScale["rejected"] = [];
  const bare: number[] = []; // printed units per point
  const used = new Map<string, number[]>(); // drawn line -> values already counted on it
  const titles: { t: TitleBlockScale; says: boolean }[] = [];
  const stated = statedUnit(lines);
  let fromNote = 0;
  /** Every dimension found, with its sample, for the annotation rule (header). */
  const found: { key: string; line: DimensionLine["line"]; h: number; sample: number; bare: boolean }[] = [];

  for (const l of lines) {
    const title = parseTitleScale(l.text);
    if (title) {
      titles.push({ t: title, says: /scale/i.test(l.text) });
      continue;
    }
    const parsed = parseDimension(l.text);
    const isBare = parsed === null && BARE.test(l.text) && !stated;
    const metres = parsed ?? (stated && BARE.test(l.text) && Number(l.text) > 0 ? Number(l.text) * stated.metres : null);
    if (metres === null && !isBare) continue;
    const dim = dimensionLine(page, l);
    if (!dim) {
      if (metres !== null) rejected.push({ text: l.text, why: "no dimension line found beside it" });
      continue;
    }
    if (isBare) {
      if (Number(l.text) > 0) {
        bare.push(Number(l.text) / dim.lengthPt);
        found.push({ key: dim.key, line: dim.line, h: l.height, sample: Number(l.text) / dim.lengthPt, bare: true });
      }
      continue;
    }
    found.push({ key: dim.key, line: dim.line, h: l.height, sample: metres! / dim.lengthPt, bare: false });
    if (parsed === null) fromNote++;
    const before = used.get(dim.key) ?? [];
    const counted = !before.some((v) => Math.abs(v - metres!) <= (SAME_PCT / 100) * v);
    if (counted) used.set(dim.key, [...before, metres!]);
    matches.push({ text: l.text, metres: metres!, lengthPt: dim.lengthPt, line: dim.line, ends: dim.ends, measure: dim.measure, source, centre: l.centre, box: lineBox(l), counted });
  }

  const title = (titles.find((t) => t.says) ?? titles[0])?.t ?? null;
  const samples = matches.filter((m) => m.counted).map((m) => m.metres / m.lengthPt);
  const bareBand = matches.length === 0 ? band(bare) : null;
  const unitless = bareBand && bareBand.confidence !== "none" ? { unitsPerPt: bareBand.median, n: bare.length, spreadPct: bareBand.spreadPct, confidence: bareBand.confidence as "good" | "check" } : null;
  const combined = combineScale(samples, title, page.paper);
  if (fromNote) combined.reason += ` Bare numbers are read in ${stated!.unit}, as the drawing's note "${stated!.note}" says.`;
  // ANNOTATION (header): the dimensions whose length their text explains, and their extension lines.
  const annotation = new Set<number>();
  for (const f of found) {
    const median = f.bare ? unitless?.unitsPerPt : combined.dimensions.mPerPt;
    if (!median || Math.abs(f.sample / median - 1) > 0.05) continue;
    for (const i of f.key.split("+")) annotation.add(Number(i));
    for (const i of extensionLines(page, f.line, f.h)) annotation.add(i);
  }
  return { ...combined, title, matches, rejected, unitless, annotation: [...annotation].sort((p, q) => p - q) };
}
