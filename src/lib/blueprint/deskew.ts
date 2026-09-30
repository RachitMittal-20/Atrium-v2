/**
 * src/lib/blueprint/deskew.ts
 *
 * Stage 0 of the Blueprint pipeline: straighten a slightly rotated plan (a
 * scan, a phone photo) before wallMask.ts looks for walls, because vectorize.ts
 * only understands horizontal and vertical walls.
 *
 * How the angle is found: walls (and text baselines) are long axis-aligned
 * strokes, so when the plan is upright the count of dark pixels per row and per
 * column is spiky; when it is tilted the spikes smear out. Each candidate angle
 * is scored by the sharpness of those two projection profiles, and the best
 * score wins. The search runs on a downscaled grid of dark-pixel counts and
 * rotates point coordinates rather than the image, so it is cheap.
 *
 * Limits: only angles within ±10° are searched. A plan tilted further than
 * that (or lying on its side) comes back with whatever angle inside ±10° scores
 * best, which will be wrong. Perspective (a photo taken at a slant) is not
 * corrected either.
 *
 * Sign: `angleDeg` is the tilt that was found and removed, positive = the plan
 * content was turned counter-clockwise on screen (the usual image-editor sense).
 * `rotatePixels(upright, a)` followed by `deskew` reports `a`.
 *
 * Connects to: wallMask.ts (shares its `binarize`, so "dark" means the same
 * thing in both stages); called by scripts/vectorize-overlay.ts before
 * extractWalls; exercised by scripts/test-deskew.ts.
 */
import type { PlanPixels } from "@/types/blueprint";
import { binarize } from "./wallMask";

const MAX_DEG = 10; // search range, either side of upright
const MIN_DEG = 0.3; // below this the image is left alone: resampling would only blur it
const SEARCH_SIDE = 1000; // longest side of the downscaled copy the search runs on

const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Rotates the image content counter-clockwise on screen by `deg`, with bilinear
 * sampling. The canvas grows to hold the rotated corners and everything
 * outside the source is opaque white (paper).
 */
export function rotatePixels(pixels: PlanPixels, deg: number): PlanPixels {
  const { width: w, height: h, rgba } = pixels;
  const cos = Math.cos(rad(deg));
  const sin = -Math.sin(rad(deg)); // image y grows downward, so counter-clockwise on screen is a negative turn
  const ow = Math.ceil(w * Math.abs(cos) + h * Math.abs(sin));
  const oh = Math.ceil(w * Math.abs(sin) + h * Math.abs(cos));
  const out = new Uint8ClampedArray(ow * oh * 4);

  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      // Output pixel centre relative to the output centre, turned back by
      // -deg into the source image (inverse mapping, so there are no holes).
      const dx = x + 0.5 - ow / 2;
      const dy = y + 0.5 - oh / 2;
      const sx = dx * cos + dy * sin + w / 2 - 0.5;
      const sy = -dx * sin + dy * cos + h / 2 - 0.5;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const o = (y * ow + x) * 4;
      for (let c = 0; c < 4; c++) {
        // The four neighbours; anything outside the source reads as white.
        const at = (px: number, py: number) =>
          px < 0 || py < 0 || px >= w || py >= h ? 255 : rgba[(py * w + px) * 4 + c];
        out[o + c] =
          (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) +
          (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
      }
    }
  }
  return { width: ow, height: oh, rgba: out };
}

/** The tilt of the plan in degrees, to 0.1°, within ±MAX_DEG. */
function estimateAngle(pixels: PlanPixels): number {
  const { width: w, height: h } = pixels;
  const ink = binarize(pixels);

  // Downscaled copy: one cell per f×f block, holding how many dark pixels it has.
  const f = Math.max(1, Math.ceil(Math.max(w, h) / SEARCH_SIDE));
  const gw = Math.ceil(w / f);
  const gh = Math.ceil(h / f);
  const grid = new Float32Array(gw * gh);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (ink[y * w + x]) grid[Math.floor(y / f) * gw + Math.floor(x / f)]++;

  // Non-empty cells as points around the centre, so rotating them is two multiplies each.
  const px: number[] = [];
  const py: number[] = [];
  const pw: number[] = [];
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const v = grid[y * gw + x];
      if (!v) continue;
      px.push(x + 0.5 - gw / 2);
      py.push(y + 0.5 - gh / 2);
      pw.push(v);
    }

  // Profiles are indexed by rounded coordinate; the diagonal bounds every rotation.
  const half = Math.ceil(Math.hypot(gw, gh) / 2) + 1;
  const rows = new Float64Array(2 * half + 1);
  const cols = new Float64Array(2 * half + 1);

  /** Sharpness of the row and column profiles if the tilt were `deg`. The total
   *  ink and the bin count are fixed, so the sum of squares ranks angles exactly
   *  as the variance would. */
  const score = (deg: number) => {
    const cos = Math.cos(rad(deg));
    const sin = -Math.sin(rad(deg)); // same sign flip as rotatePixels
    rows.fill(0);
    cols.fill(0);
    for (let i = 0; i < px.length; i++) {
      cols[Math.round(px[i] * cos + py[i] * sin) + half] += pw[i]; // undo a tilt of `deg`
      rows[Math.round(-px[i] * sin + py[i] * cos) + half] += pw[i];
    }
    let s = 0;
    for (let i = 0; i < rows.length; i++) s += rows[i] * rows[i] + cols[i] * cols[i];
    return s;
  };

  // Upright is the starting answer and only a strictly better score replaces
  // it, so a blank or featureless image reports 0 rather than an arbitrary angle.
  let best = 0;
  let bestScore = score(0);
  const consider = (deg: number) => {
    if (Math.abs(deg) > MAX_DEG) return;
    const s = score(deg);
    if (s > bestScore) [best, bestScore] = [deg, s];
  };
  for (let i = -2 * MAX_DEG; i <= 2 * MAX_DEG; i++) consider(i / 2); // coarse: 0.5° steps
  const coarse = best;
  for (let j = -5; j <= 5; j++) consider(Math.round(coarse * 10 + j) / 10); // refine: 0.1° steps
  return best;
}

/**
 * Straightens the plan. Returns the input object itself with `angleDeg` 0 when
 * the tilt is under 0.3°, otherwise a rotated copy and the tilt that was removed.
 */
export function deskew(pixels: PlanPixels): { pixels: PlanPixels; angleDeg: number } {
  const angleDeg = estimateAngle(pixels);
  if (Math.abs(angleDeg) < MIN_DEG) return { pixels, angleDeg: 0 };
  return { pixels: rotatePixels(pixels, -angleDeg), angleDeg };
}
