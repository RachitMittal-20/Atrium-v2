/**
 * src/types/pdf.ts
 *
 * Shared types for reading floor-plan PDFs (step M.1a). Everything here is in
 * PAGE POINTS (1 pt = 1/72 inch on paper) in the page's viewport space at
 * scale 1: the current transformation matrix and the page's /Rotate are
 * already applied, x points right and y points DOWN, like image pixels. A
 * raster of the page at k pixels per point is exactly these coordinates × k.
 *
 * Produced by src/lib/pdf/extract.ts (VectorPage), src/lib/pdf/scale.ts
 * (PdfScale, DimensionMatch) and src/lib/pdf/analysePdf.ts (PdfInfo); the
 * import screen (src/app/studio/import/) shows them and
 * src/lib/pdf/dimensions.ts turns DimensionMatch into the dimension check.
 */

/** One straight piece of a stroked or filled path. Curves arrive flattened. */
export interface PdfSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Stroke width in points; 0 when the path is only filled (or a hairline). */
  width: number;
  /** True for an edge of a filled path (including fill-and-stroke). */
  filled: boolean;
}

/** One text item as pdf.js reports it, placed on the page. */
export interface PdfText {
  str: string;
  /** Start of the baseline. */
  x: number;
  y: number;
  /** Reading direction in degrees, atan2(dy, dx) with y down: 0 reads left to
   *  right, -90 reads bottom to top, 90 top to bottom. */
  rotation: number;
  /** Font size: the text's height across the baseline. */
  height: number;
  /** Advance along the baseline. */
  width: number;
}

export type PdfPageKind = "vector" | "scanned" | "mixed";

export interface VectorPage {
  /** Viewport size in points (swapped for /Rotate 90 and 270). */
  width: number;
  height: number;
  /** The page's /Rotate, 0, 90, 180 or 270. */
  rotate: number;
  /** Paper size of the unrotated page, e.g. "A4" or "612 × 792 pt". */
  paper: string;
  segments: PdfSegment[];
  texts: PdfText[];
  /** Each painted image's area in square points and its bounding box. */
  images: { area: number; x0: number; y0: number; x1: number; y1: number }[];
  /** Path commands read (move, line, curve, close), the number the cap applies to. */
  pathOps: number;
  /** Total length of all segments, in points. */
  lineLength: number;
  /** Largest image's area / page area. */
  imageCover: number;
  kind: PdfPageKind;
}

/** A dimension text matched to the line it labels. */
export interface DimensionMatch {
  /** The text as printed, e.g. `3800 mm` or `12'-6"`. */
  text: string;
  /** The printed value in metres. */
  metres: number;
  /** Length of the matched line in points. */
  lengthPt: number;
  /** The matched line. */
  line: { x1: number; y1: number; x2: number; y2: number };
  /** The text's centre and its axis-aligned box, in points. */
  centre: { x: number; y: number };
  box: { x0: number; y0: number; x1: number; y1: number };
  /** False when an earlier text already measured the same line with the same
   *  value: it is still checked, but counted once for the scale. */
  counted: boolean;
}

export interface TitleBlockScale {
  /** The scale as printed, e.g. "1:100" or `1/8" = 1'-0"`. */
  text: string;
  /** N of 1:N. */
  ratio: number;
  mPerPt: number;
}

export interface PdfScale {
  /** Metres per point, null when there is no scale. */
  mPerPt: number | null;
  confidence: "good" | "check" | "none";
  /** Written for the user. */
  reason: string;
  /** The title-block-versus-dimensions warning, or null. */
  mismatch: string | null;
  /** The dimensions' own result, before the title block is considered. */
  dimensions: { mPerPt: number | null; n: number; spreadPct: number; confidence: "good" | "check" | "none" };
  title: TitleBlockScale | null;
  /** Every dimension text matched to a line (the dimension check's rows). */
  matches: DimensionMatch[];
  /** Dimension texts with no line found, and why. */
  rejected: { text: string; why: string }[];
  /** Numbers with no unit matched to lines: printed units per point. Only
   *  looked at when no dimension with a unit was matched. */
  unitless: { unitsPerPt: number; n: number; spreadPct: number; confidence: "good" | "check" } | null;
}

/** What the import screen needs to know about the PDF page it is showing. */
export interface PdfInfo {
  pageNumber: number;
  pageCount: number;
  kind: PdfPageKind;
  /** "vector": walls traced from a raster of the vector page, scale from the
   *  PDF. "raster": the page went through the image pipeline as a picture. */
  route: "vector" | "raster";
  /** Raster pixels per page point. */
  pxPerPt: number;
  paper: string;
  /** Null on the raster route. */
  scale: PdfScale | null;
  /** About one raster pixel in millimetres at the PDF's scale; null without one. */
  traceMm: number | null;
  /** One plain line per note ("Scanned PDF: measurements are approximate", ...). */
  notes: string[];
}

/** One row of the dimension check (src/lib/pdf/dimensions.ts). */
export interface DimensionRow {
  text: string;
  printedM: number;
  measuredM: number;
  diffMm: number;
  diffPct: number;
  status: "ok" | "flagged" | "overridden";
  /** The user's typed value and note; the measured value is kept beside it. */
  override: { valueM: number; note: string } | null;
}
