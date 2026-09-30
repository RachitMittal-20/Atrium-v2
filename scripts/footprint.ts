/**
 * footprint.ts — the truth checks for the synthetic test plans (a 10 × 8 m
 * house at 100 px/m with 7 walls). Shared by scripts/vectorize-overlay.ts,
 * which prints them per image, scripts/test-deskew.ts, which asserts the
 * footprint fails on a tilted plan that was not deskewed, and
 * scripts/test-hollow.ts, which builds the same house with hollow walls at two
 * image scales.
 *
 * Also holds the fixtures' opening truth (TRUTH, in metres from the house's
 * top-left centre-line corner) and the wall thickness the generator drew per
 * fixture (GENERATOR_T), shared by scripts/test-openings.ts and
 * scripts/test-toplan.ts.
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

/** h: the wall runs along x at y = line; v: along y at x = line. from/to along the wall. */
export type Truth = { kind: "window" | "door"; h: boolean; line: number; from: number; to: number };
export const TRUTH: Truth[] = [
  { kind: "door", h: true, line: 3.5, from: 1.0, to: 1.9 },
  { kind: "door", h: true, line: 3.5, from: 6.0, to: 6.9 },
  { kind: "door", h: false, line: 7, from: 5.0, to: 5.9 },
  { kind: "door", h: true, line: 8, from: 2.0, to: 3.0 },
  { kind: "window", h: true, line: 0, from: 1.5, to: 3.0 },
  { kind: "window", h: true, line: 0, from: 6.5, to: 8.0 },
  { kind: "window", h: false, line: 10, from: 5.0, to: 6.5 },
  { kind: "window", h: false, line: 0, from: 5.0, to: 6.5 },
];
/** The outer walls of the 10 × 8 m house; every other line is interior. */
export const exterior = (t: Truth) => t.line === 0 || t.line === (t.h ? 8 : 10);
/** Wall thickness the fixture generator drew, [exterior, interior], in px. */
export const GENERATOR_T: Record<string, [number, number]> = {
  "01_clean_uniform.png": [15, 15],
  "02_thick_exterior_thin_interior.png": [25, 8],
  "03_with_dimensions.png": [20, 10],
  "04_fake_scan.jpg": [20, 10],
};
