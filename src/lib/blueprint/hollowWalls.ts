/**
 * src/lib/blueprint/hollowWalls.ts
 *
 * Hollow-wall support for the Blueprint pipeline. Some plans draw a wall as two
 * thin parallel lines with white between them. wallMask.ts finds walls by
 * thickness, so it sees only thin lines there and erases them all. This file
 * fills the white between such line pairs, so each pair becomes one solid bar
 * that wallMask.ts and vectorize.ts already understand, and decides per image
 * whether that is needed at all.
 *
 * How pairs are found (fillHollowWalls), on the same dark-pixel map wallMask.ts
 * uses (`binarize`):
 *  1. Every row is read as dark run, light gap, dark run, ... Each light gap
 *     with ink on both sides is a candidate. A gap that reappears on the next
 *     row at the same place extends a "stretch". Each row is compared with the
 *     row before it, never with the first: either edge may move by 1 px and
 *     the width may change by 1 px per row, so lines that are slightly tilted
 *     or not quite parallel stay one stretch. The stretch's gap width is the
 *     median of its rows. Columns are scanned the same way on the transposed
 *     map, so rows find vertical walls and columns horizontal ones.
 *  2. A stretch is a pair when it is at least 4× as long as its gap is wide
 *     (LENGTH_PER_GAP, the rule given for this stage) and the lines on both
 *     sides are thinner than the gap (median over the stretch, so a crossing
 *     line at a junction does not break it).
 *  3. Which gap widths count as walls is taken from the image itself: the
 *     histogram of pair gap widths, each pair weighted by its length, has its
 *     peak at the drawing's commonest wall gap, G. Pairs with a gap from G ÷ 3
 *     to G × 3 are walls. The 3 (GAP_BAND) is not measured on any image; it is a
 *     building ratio: partitions and exterior walls in one drawing differ by up
 *     to about 3× (100 mm to 300 mm), and the narrowest walkable space (a
 *     900 mm corridor) is about 3× the thickest wall, so the band takes every
 *     wall thickness and stops short of corridors. No pixel size appears
 *     anywhere, so the method is the same at any image scale.
 *  4. The gap of every accepted pair is painted black in a copy of the image.
 *
 * Not filled, on purpose: the small square where two hollow walls meet at a
 * corner or an open T-junction (no pair of lines faces each other there).
 * vectorize.ts closes those when it snaps wall ends onto joints.
 *
 * Mode choice (detectWalls): the hollow path is used only when parallel-line
 * pairs hold more of the drawing's ink than the solid-wall mask captured.
 *
 * inkCapture in hollow mode: the mask there is made from the filled image, so
 * mask pixels / filled-image ink (kept as `fillCapture`) cannot be compared
 * with a solid plan's number. `inkCapture` is instead the share of the
 * ORIGINAL dark pixels lying on or within one wall thickness of a wall centre
 * line found by vectorize.ts (each wall's own thickness).
 *
 * Connects to: wallMask.ts (`binarize`, `extractWalls`); vectorize.ts (only to
 * measure inkCapture in hollow mode); called by
 * scripts/vectorize-overlay.ts; exercised by scripts/test-hollow.ts.
 */
import { BlueprintError, type PixelWall, type PlanPixels, type WallMask } from "@/types/blueprint";
import { vectorize } from "./vectorize";
import { binarize, extractWalls } from "./wallMask";

const LENGTH_PER_GAP = 4; // a pair must run at least this many gap widths
const GAP_BAND = 3; // accepted gaps: peak / 3 … peak × 3 (see header, step 3)

/** One light gap followed along consecutive rows. `rows` holds, per row,
 *  [gap start, gap end (exclusive), dark run before, dark run after]. */
interface Stretch {
  y0: number;
  g: number; // gap width: 0 while the stretch is open, the median of its rows once closed
  x0: number; // the latest row's gap, for matching the next row
  x1: number;
  rows: number[];
}

const median = (v: number[]) => [...v].sort((p, q) => p - q)[v.length >> 1];

/** Every gap stretch in the map, scanning rows (so stretches run downward). */
function findStretches(ink: Uint8Array, w: number, h: number): Stretch[] {
  const done: Stretch[] = [];
  const close = (s: Stretch) => {
    const widths: number[] = [];
    for (let i = 0; i < s.rows.length; i += 4) widths.push(s.rows[i + 1] - s.rows[i]);
    s.g = median(widths);
    done.push(s);
  };
  let open: Stretch[] = []; // stretches alive on the previous row, in x order
  for (let y = 0; y <= h; y++) {
    const next: Stretch[] = [];
    let p = 0;
    // Walk the row's dark runs; the light between two neighbouring runs is a gap.
    let prevEnd = -1; // end of the previous dark run, -1 before the first
    let prevLen = 0;
    for (let x = 0; y < h && x < w; x++) {
      if (!ink[y * w + x]) continue;
      const start = x;
      while (x < w && ink[y * w + x]) x++;
      if (prevEnd >= 0) {
        const x0 = prevEnd;
        const x1 = start;
        // Open stretches left of this gap can no longer be continued.
        while (p < open.length && open[p].x0 < x0 - 1) close(open[p++]);
        const s = open[p];
        // Against the previous row only: both edges and the width within 1 px.
        if (s && Math.abs(s.x0 - x0) <= 1 && Math.abs(s.x1 - x1) <= 1 && Math.abs(x1 - x0 - (s.x1 - s.x0)) <= 1) {
          p++;
          s.x0 = x0;
          s.x1 = x1;
          s.rows.push(x0, x1, prevLen, x - start);
          next.push(s);
        } else next.push({ y0: y, g: 0, x0, x1, rows: [x0, x1, prevLen, x - start] });
      }
      prevEnd = x;
      prevLen = x - start;
    }
    while (p < open.length) close(open[p++]);
    open = next;
  }
  return done;
}

/** Step 2: long enough for its gap, and bounded by lines thinner than the gap. */
function isPair(s: Stretch): boolean {
  const n = s.rows.length / 4;
  if (n < LENGTH_PER_GAP * s.g) return false;
  const before: number[] = [];
  const after: number[] = [];
  for (let i = 0; i < n; i++) {
    before.push(s.rows[i * 4 + 2]);
    after.push(s.rows[i * 4 + 3]);
  }
  return median(before) < s.g && median(after) < s.g;
}

/**
 * Fills the white between parallel wall lines. `filled` is a copy of the image
 * with those gaps painted black (the input itself when nothing was found);
 * `pairedInk` is the share (0–1) of the image's dark pixels that are one of the
 * two lines of an accepted pair.
 */
export function fillHollowWalls(pixels: PlanPixels): { filled: PlanPixels; pairedInk: number } {
  const { width: w, height: h } = pixels;
  const ink = binarize(pixels);
  const flipped = new Uint8Array(w * h); // transposed map: columns become rows
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) flipped[x * h + y] = ink[y * w + x];

  // [stretch, is it from the transposed scan] for every pair of either orientation.
  const pairs: [Stretch, boolean][] = [
    ...findStretches(ink, w, h).filter(isPair).map((s): [Stretch, boolean] => [s, false]),
    ...findStretches(flipped, h, w).filter(isPair).map((s): [Stretch, boolean] => [s, true]),
  ];

  // Step 3: the peak of the length-weighted gap histogram sets the accepted range.
  const hist = new Map<number, number>();
  for (const [s] of pairs) hist.set(s.g, (hist.get(s.g) ?? 0) + s.rows.length / 4);
  let peak = 0;
  let peakMass = 0;
  for (const [g, mass] of hist) if (mass > peakMass) [peak, peakMass] = [g, mass];

  const fill = new Uint8Array(w * h);
  const paired = new Uint8Array(w * h); // marked, not summed: a line can bound two pairs
  let filledAny = false;
  for (const [s, isFlipped] of pairs) {
    if (s.g * GAP_BAND < peak || s.g > peak * GAP_BAND) continue;
    filledAny = true;
    const at = (x: number, y: number) => (isFlipped ? x * w + y : y * w + x);
    for (let i = 0; i < s.rows.length / 4; i++) {
      const [x0, x1, before, after] = s.rows.slice(i * 4, i * 4 + 4);
      const y = s.y0 + i;
      for (let x = x0; x < x1; x++) fill[at(x, y)] = 1;
      // A run as long as the gap is a line crossing at a junction, not this pair's own line.
      if (before < s.g) for (let x = x0 - before; x < x0; x++) paired[at(x, y)] = 1;
      if (after < s.g) for (let x = x1; x < x1 + after; x++) paired[at(x, y)] = 1;
    }
  }
  if (!filledAny) return { filled: pixels, pairedInk: 0 };

  const rgba = new Uint8ClampedArray(pixels.rgba);
  let inkCount = 0;
  let pairedCount = 0;
  for (let i = 0; i < w * h; i++) {
    inkCount += ink[i];
    pairedCount += paired[i];
    if (fill[i]) rgba.set([0, 0, 0, 255], i * 4);
  }
  return { filled: { width: w, height: h, rgba }, pairedInk: pairedCount / inkCount };
}

/** Share (0–1) of `ink` pixels within one wall thickness of a wall's centre
 *  line (distance to the segment, each wall's own thickness). */
function inkNearWalls(ink: Uint8Array, w: number, h: number, walls: PixelWall[]): number {
  const near = new Uint8Array(w * h); // marked, not summed: walls overlap at joints
  for (const { a, b, thickness: t } of walls) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const y1 = Math.min(h, Math.ceil(Math.max(a.y, b.y) + t));
    const x1 = Math.min(w, Math.ceil(Math.max(a.x, b.x) + t));
    for (let y = Math.max(0, Math.floor(Math.min(a.y, b.y) - t)); y < y1; y++)
      for (let x = Math.max(0, Math.floor(Math.min(a.x, b.x) - t)); x < x1; x++) {
        // Nearest point of the segment to this pixel's centre.
        const u = Math.min(1, Math.max(0, ((x + 0.5 - a.x) * dx + (y + 0.5 - a.y) * dy) / len2));
        if (Math.hypot(x + 0.5 - a.x - u * dx, y + 0.5 - a.y - u * dy) <= t) near[y * w + x] = 1;
      }
  }
  let inkCount = 0;
  let hit = 0;
  for (let i = 0; i < w * h; i++) {
    inkCount += ink[i];
    hit += ink[i] & near[i];
  }
  return inkCount === 0 ? 0 : hit / inkCount;
}

export interface DetectedWalls {
  mask: WallMask;
  mode: "solid" | "hollow";
  /** One line saying why that mode was chosen, with the two numbers compared. */
  reason: string;
}

/**
 * The wall mask for an image of either drawing style. Rule: use the hollow
 * path only when parallel-line pairs hold more of the drawing's ink than the
 * solid-wall mask captured (pairedInk > inkCapture). In hollow mode the mask's
 * `inkCapture` is measured on the original ink (see header) and the
 * filled-image number is kept as `fillCapture`.
 */
export function detectWalls(pixels: PlanPixels): DetectedWalls {
  let solid: WallMask | null = null;
  let solidError: unknown;
  try {
    solid = extractWalls(pixels);
  } catch (e) {
    if (!(e instanceof BlueprintError)) throw e;
    solidError = e; // no solid walls at all: counts as capturing 0% of the ink
  }
  const { filled, pairedInk } = fillHollowWalls(pixels);
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const numbers = `line pairs hold ${pct(pairedInk)} of the ink, the solid mask ${solid ? pct(solid.inkCapture) : "nothing (no solid walls found)"}`;
  if (pairedInk > (solid?.inkCapture ?? 0)) {
    const mask = extractWalls(filled);
    // ponytail: vectorize runs here and again in the caller; return the walls from here if that ever costs.
    const inkCapture = inkNearWalls(binarize(pixels), mask.width, mask.height, vectorize(mask).walls);
    return { mask: { ...mask, inkCapture, fillCapture: mask.inkCapture }, mode: "hollow", reason: numbers };
  }
  if (!solid) throw solidError;
  return { mask: solid, mode: "solid", reason: numbers };
}
