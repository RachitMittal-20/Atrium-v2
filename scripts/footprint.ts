/**
 * footprint.ts — the footprint truth check for the synthetic test plans 01–04
 * (a 10 × 8 m house at 100 px/m). Shared by scripts/vectorize-overlay.ts, which
 * prints it per image, and scripts/test-deskew.ts, which asserts it fails on a
 * tilted plan that was not deskewed.
 *
 * The footprint is measured centre line to centre line (the extent of the wall
 * endpoints), because that is what the truth of 1000 × 800 px describes; the
 * outer faces sit a wall thickness further out.
 */
import type { PixelWall } from "../src/types/blueprint";

const TRUE_W = 1000;
const TRUE_H = 800;

/** `T` is the mask's wall thickness in pixels. Tolerance: max(2 px, 10% of T). */
export function footprintCheck(walls: PixelWall[], T: number) {
  const xs = walls.flatMap((w) => [w.a.x, w.b.x]);
  const ys = walls.flatMap((w) => [w.a.y, w.b.y]);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const tol = Math.max(2, 0.1 * T);
  const pass = Math.abs(width - TRUE_W) <= tol && Math.abs(height - TRUE_H) <= tol; // no walls → -Infinity → fails
  return { width, height, tol, pass };
}
