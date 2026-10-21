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
 * (PdfScale, DimensionMatch), src/lib/pdf/walls.ts (VectorWalls, in page
 * METRES, step M.1b) and src/lib/pdf/analysePdf.ts (PdfInfo); the
 * import screen (src/app/studio/import/) shows them and
 * src/lib/pdf/dimensions.ts turns DimensionMatch into the dimension check.
 */
import type { OpeningKind, SwingSide, Vec2, Wall } from "./plan";

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
  /** The painted path it belongs to, numbered in painting order (step M.1b). */
  path: number;
  /** True for a piece of a flattened curve (a door swing, a curved wall). */
  curve: boolean;
  /** Step Q.2: stroked with a dash pattern (a centre, hidden or setting-out line); absent when solid. */
  dashed?: true;
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
  /** The measured length in points: between filled arrowheads' tips when both ends have one (step
   *  Q.4a), else between the ticks (or extension lines) when both ends have one, else the line's own
   *  length (`measure`). */
  lengthPt: number;
  /** The matched line (both parts of a line broken around its text, joined). */
  line: { x1: number; y1: number; x2: number; y2: number };
  /** What `lengthPt` measures between: the arrow tips, the two ticks' crossings, or the line's ends. */
  ends: { x1: number; y1: number; x2: number; y2: number };
  measure: "arrows" | "ticks" | "line";
  /** "ocr": the text was read by OCR off a raster of the page (outlined text). */
  source: "pdf" | "ocr";
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
  /** Step Q.1: segments (indexes into the page's segments) that are dimension annotation — the
   *  lines dimensions label and their extension lines — so never wall faces (walls.ts). */
  annotation?: number[];
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
  /** Step X.1: a vector page's raster covers only the drawing's content box. Its top-left in page
   *  points, so a raster pixel is (point − rasterOrigin) × pxPerPt; absent means (0, 0), the whole page. */
  rasterOrigin?: { x: number; y: number };
  /** Step X.1: that raster's size in pixels; absent means the whole page at pxPerPt. */
  rasterSize?: { width: number; height: number };
  /** The page's size in points (viewport at scale 1, /Rotate applied), so the raster the image
   *  pipeline read can be mapped back to the page (step M.2c, the drawing under the plan). */
  pageSize: { width: number; height: number };
  paper: string;
  /** Null on the raster route. */
  scale: PdfScale | null;
  /** About one raster pixel in millimetres at the PDF's scale; null without one. */
  traceMm: number | null;
  /** One plain line per note ("Scanned PDF: measurements are approximate", ...). */
  notes: string[];
  /** Walls read from the PDF's own lines at the PDF's scale (step M.1b); null on
   *  the raster route or without a scale. */
  vectorWalls: VectorWalls | null;
  /** True when the page's text was outlined and was read by OCR instead. */
  ocrText: boolean;
}

/** What the PDF's lines say an opening is (step M.1c, openings.ts): a door with a swing arc,
 *  a double door (two arcs), a sliding door (staggered panels), a window (glazing lines), or
 *  nothing drawn in the gap ("unclassified", kept as a door). */
export type OpeningClass = "door" | "double" | "sliding" | "window" | "unclassified";

/** A door or window found in the PDF's lines (walls.ts), on a VectorWalls wall. */
export interface VectorOpening {
  id: string;
  wallId: string;
  kind: OpeningKind;
  /** From the wall's a end to the opening's centre, m. */
  offset: number;
  width: number;
  /** Doors: the side the leaf opens to on THIS wall (from its arc; LEGACY_SWING without one). */
  swing?: SwingSide;
  /** The two jambs on the centre line, page metres (a nearer the wall's a). */
  a: Vec2;
  b: Vec2;
  /** Step M.1c. Absent on readings made before it (M.1b read every gap as a door). */
  class?: OpeningClass;
  /** Doors read from an arc: the leaf's side as a unit vector, page frame (snap.ts re-derives the
   *  swing on the final wall from it). */
  swingNormal?: Vec2;
  /** Single doors read from an arc: the jamb the leaf hangs on (on the centre line, page metres)
   *  and which end of this wall it is. */
  hinge?: Vec2;
  hingeEnd?: "a" | "b";
}

/** An arc in the PDF's lines that no opening used (step M.1c), page metres, and why. */
export interface UnusedArc {
  centre: Vec2;
  r: number;
  sweep: number;
  why: string;
}

/** Walls read exactly from a vector page by face pairing (walls.ts), in PAGE
 *  METRES (x = pt × mPerPt), unrounded. */
export interface VectorWalls {
  mPerPt: number;
  /** Provenance "vector". */
  walls: Wall[];
  openings: VectorOpening[];
  /** Read but not built: walls the Plan can't hold yet. */
  skipped: { diagonal: number; curved: number };
  /** Pairs dropped, by rule, and openings a joint would have cut. */
  dropped: { short: number; clutter: number; inside: number; openingsCut: number };
  /** The clutter pieces themselves (centre line and thickness, page metres): a
   *  traced wall lying on one is furniture or a text box too (snap.ts drops it). */
  clutter: { a: Vec2; b: Vec2; thickness: number }[];
  /** Step M.1c: arcs found (fitted circles, 0.2 m and 30° or more), how many became door
   *  swings, and the rest with why. Absent on readings made before it. */
  arcs?: { found: number; used: number; notUsed: UnusedArc[] };
  /** Step M.1d: collinear gaps outside 0.45–4 m, which are not read as openings (a narrow
   *  one closes as wall, a wide one is left unbridged). Page metres, on the centre line.
   *  Absent on readings made before M.1d. */
  gaps?: { a: Vec2; b: Vec2; thickness: number; size: number }[];
  /** Step Q.1: line work dropped as furniture, by group, page metres: "loop" a small closed loop
   *  (under 1 m² or 0.6 m wide), "island" a group joined to no wall inside the building, "treads" (step
   *  S.1) a run of pairs whose bodies overlap (stair treads, hatching) joined to the building, "small" a
   *  lone short piece (the clutter rule). `box` is the group's pairs' footprint as read (before the
   *  joints), `walls` how many pieces. Absent on readings made before Q.1. */
  furniture?: { kind: "loop" | "island" | "treads" | "small"; walls: number; box: { x0: number; y0: number; x1: number; y1: number } }[];
  /** Step Q.2 (walls.ts rule 7b): groups of walls joined to nothing in the building and lying outside
   *  it, page metres. `dropped` when there was evidence they are sheet furniture (`why` says which);
   *  kept otherwise (a separate building), and `why` says that. */
  detached?: { walls: number; box: { x0: number; y0: number; x1: number; y1: number }; dropped: boolean; why: string }[];
  /** Step Q.2 (walls.ts): openings a joint cut, so not read: a wall ends inside them or crosses them.
   *  Jambs on the centre line, page metres; `kind` as the opening is drawn. */
  conflicts?: { kind: OpeningKind; a: Vec2; b: Vec2; width: number; why: string }[];
}

/** One row of the dimension check (src/lib/pdf/dimensions.ts), or of the
 *  model-versus-printed check (`spans` and `approximate` set). */
export interface DimensionRow {
  text: string;
  /** "between arrow tips" / "between ticks" / "line length", and "read by OCR" when it was. */
  how: string;
  /** Model check only: what the model length runs between ("centre to centre", ...). */
  spans?: string;
  /** Model check only: a wall it measures is traced, not read from the PDF. */
  approximate?: boolean;
  printedM: number;
  measuredM: number;
  diffMm: number;
  diffPct: number;
  status: "ok" | "flagged" | "overridden";
  /** The user's typed value and note; the measured value is kept beside it. */
  override: { valueM: number; note: string } | null;
}
