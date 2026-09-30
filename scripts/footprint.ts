/**
 * footprint.ts — the truth checks for the synthetic test plans (a 10 × 8 m
 * house at 100 px/m with 7 walls). Shared by scripts/vectorize-overlay.ts,
 * which prints them per image, scripts/test-deskew.ts, which asserts the
 * footprint fails on a tilted plan that was not deskewed, and
 * scripts/test-hollow.ts, which builds the same house with hollow walls at two
 * image scales.
 *
 * The footprint is measured centre line to centre line (the extent of the wall
 * endpoints), because that is what the truth of 1000 × 800 px describes; the
 * outer faces sit a wall thickness further out.
 */
import { isH } from "../src/lib/blueprint/openings";
import type { PixelWall } from "../src/types/blueprint";

const TRUE_W = 1000;
const TRUE_H = 800;

/** `T` is the mask's wall thickness in pixels; `scale` is the image scale
 *  relative to 100 px/m. Tolerance: max(2 px × scale, 10% of T). */
export function footprintCheck(walls: PixelWall[], T: number, scale = 1) {
  const xs = walls.flatMap((w) => [w.a.x, w.b.x]);
  const ys = walls.flatMap((w) => [w.a.y, w.b.y]);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const tol = Math.max(2 * scale, 0.1 * T);
  const pass = Math.abs(width - TRUE_W * scale) <= tol && Math.abs(height - TRUE_H * scale) <= tol; // no walls → -Infinity → fails
  return { width, height, tol, pass };
}

/** Distinct wall lines: collinear walls (across the gaps and joints) count once. */
export function wallLines(walls: PixelWall[]) {
  const lines: { h: boolean; c: number; t: number }[] = [];
  for (const w of walls) {
    const c = isH(w) ? w.a.y : w.a.x;
    if (!lines.some((l) => l.h === isH(w) && Math.abs(l.c - c) <= Math.max(l.t, w.thickness) / 2))
      lines.push({ h: isH(w), c, t: w.thickness });
  }
  return lines.length;
}
