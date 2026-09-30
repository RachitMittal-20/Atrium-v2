/**
 * test-hollow.ts — checks src/lib/blueprint/hollowWalls.ts three ways.
 *
 * 1. Hollow house. The known synthetic plan (a 10 × 8 m house at 100 px/m:
 *    7 walls, 4 door gaps, 4 windows, same layout as tests/fixtures/01–04) is
 *    built by hand as solid rectangles, then turned hollow by keeping only the
 *    outline of their union, so every wall is two thin lines and junctions are
 *    open. Exterior walls are 24 px, interior 12 px, lines 2 px; windows are a
 *    single thin line across the opening. It is built at 1× and at 1.5× (every
 *    number scaled), and both must give 7 wall lines and the true centre-line
 *    footprint (footprint.ts, tolerance scaled). Nothing in hollowWalls.ts is
 *    a pixel size, and this proves it. Furniture-like double lines shorter
 *    than 4× their gap, added inside a room, must not change the result.
 *    The 1× house is also tilted by 0.25° and sent through deskew.ts, and
 *    must still give 7 wall lines and the same footprint. A separate pair of
 *    lines whose gap narrows slowly (16 → 14 px) must be filled as one pair.
 * 2. Furniture alone: a page of such short double lines has no pairs at all
 *    and produces no walls.
 * 3. Regression: the solid-wall plans must stay on the solid path with exactly
 *    the numbers they had before hollow support existed. 01–04 are read from
 *    tests/fixtures (tracked in git). 06 is a real listing that is kept out of
 *    git, so it is checked when test-plans/ has it and reported as skipped
 *    when it does not.
 * Run: npx tsx scripts/test-hollow.ts
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import sharp from "sharp";
import { footprintCheck, wallLines } from "./footprint";
import { deskew, rotatePixels } from "../src/lib/blueprint/deskew";
import { dilate } from "../src/lib/blueprint/grid";
import { detectWalls, fillHollowWalls } from "../src/lib/blueprint/hollowWalls";
import { vectorize } from "../src/lib/blueprint/vectorize";
import { BlueprintError, type PlanPixels } from "../src/types/blueprint";

type Rect = [number, number, number, number]; // [x0, y0, x1, y1) in 1× pixels

// Centre lines: x 90 and 1090, y 90 and 890. Exterior 24 px (±12), interior 12 px (±6).
const WALLS: Rect[] = [
  [78, 78, 253, 102], [377, 78, 753, 102], [877, 78, 1102, 102], // top, two windows
  [78, 878, 303, 902], [377, 878, 1102, 902], // bottom, front door
  [78, 78, 102, 603], [78, 727, 102, 902], // left, one window
  [1078, 78, 1102, 603], [1078, 727, 1102, 902], // right, one window
  [102, 434, 195, 446], [276, 434, 695, 446], [776, 434, 1078, 446], // interior y 440, two doors
  [584, 102, 596, 434], // interior x 590
  [784, 446, 796, 595], [784, 676, 796, 878], // interior x 790, one door
];
// Windows: one thin line along the wall's centre line, across the opening.
const WINDOWS: Rect[] = [[253, 89, 377, 91], [753, 89, 877, 91], [89, 603, 91, 727], [1089, 603, 1091, 727]];
// A bed-like box and two short double lines in the living room: gap 20, length 60 (< 4 × 20).
const FURNITURE: Rect[] = [
  [200, 600, 260, 602], [200, 622, 260, 624],
  [400, 560, 402, 620], [422, 560, 424, 620],
  [500, 700, 560, 702], [500, 738, 560, 740], [500, 700, 502, 740], [558, 700, 560, 740],
];

/** Paints rects (scaled by `s`) into a 1 = ink map of the 1180 × 980 page. */
function paint(rects: Rect[], s: number, w: number, h: number, into = new Uint8Array(w * h)) {
  for (const r of rects) {
    const [x0, y0, x1, y1] = r.map((v) => Math.round(v * s));
    for (let y = y0; y < y1; y++) into.fill(1, y * w + x0, y * w + x1);
  }
  return into;
}

/** Black ink on opaque white. */
function toPixels(ink: Uint8Array, width: number, height: number): PlanPixels {
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let i = 0; i < ink.length; i++) if (ink[i]) rgba.fill(0, i * 4, i * 4 + 3);
  return { width, height, rgba };
}

function hollowHouse(s: number, furniture: boolean): PlanPixels {
  const w = Math.round(1180 * s);
  const h = Math.round(980 * s);
  const line = Math.round(2 * s);
  const solid = paint(WALLS, s, w, h);
  // Outline: wall pixels within `line` px of a non-wall pixel.
  const outside = dilate(solid.map((v) => 1 - v), w, h, 2 * line + 1);
  const ink = solid.map((v, i) => v & outside[i]);
  paint(WINDOWS, s, w, h, ink);
  if (furniture) paint(FURNITURE, s, w, h, ink);
  return toPixels(ink, w, h);
}

// ------------------------------------------------------------ 1. hollow house
for (const s of [1, 1.5]) {
  for (const furniture of [false, true]) {
    const name = `hollow house ${s}×${furniture ? " + furniture" : ""}`;
    const { mask, mode, reason } = detectWalls(hollowHouse(s, furniture));
    assert.equal(mode, "hollow", `${name}: mode (${reason})`);
    const { walls } = vectorize(mask);
    assert.equal(wallLines(walls), 7, `${name}: wall lines`);
    const fp = footprintCheck(walls, mask.wallThickness, s);
    assert.ok(fp.pass, `${name}: footprint ${fp.width}×${fp.height}, want ${1000 * s}×${800 * s} ±${fp.tol}`);
    console.log(`${name}: 7 wall lines, footprint ${fp.width.toFixed(2)}×${fp.height.toFixed(2)} ±${fp.tol.toFixed(1)}, ${reason}`);
  }
}

// ------------------------------------------------------------ 1b. slow drift
// The 1× house tilted by 0.25°, run the way the pipeline runs it (deskew, then
// walls). deskew.ts measures to 0.1°, reads this tilt as 0.3° and turns it
// back, which leaves a residue of about 0.05° and twice-resampled, soft lines.
{
  const { pixels } = deskew(rotatePixels(hollowHouse(1, false), 0.25));
  const { mask, mode, reason } = detectWalls(pixels);
  assert.equal(mode, "hollow", `tilted 0.25°: mode (${reason})`);
  const { walls } = vectorize(mask);
  const fp = footprintCheck(walls, mask.wallThickness);
  assert.equal(wallLines(walls), 7, "tilted 0.25°: wall lines");
  assert.ok(fp.pass, `tilted 0.25°: footprint ${fp.width}×${fp.height}, want 1000×800 ±${fp.tol}`);
  console.log(`hollow house tilted 0.25°: 7 wall lines, footprint ${fp.width.toFixed(2)}×${fp.height.toFixed(2)} ±${fp.tol.toFixed(1)}, ${reason}`);
}

// Two 2 px lines that are not quite parallel: the gap is 16 px for 10 rows,
// 15 for 40 and 14 for 40. No row differs from the one before by more than
// 1 px, and 90 rows is over 4× the gap, so this is one pair and all of its
// white must be filled. (Measured against the first row instead, the 14 px
// part splits off and neither piece is long enough.)
{
  const W = 200;
  const H = 200;
  const ink = new Uint8Array(W * H);
  let white = 0;
  for (let i = 0; i < 90; i++) {
    const gap = i < 10 ? 16 : i < 50 ? 15 : 14;
    const row = (50 + i) * W;
    ink.fill(1, row + 60, row + 62);
    ink.fill(1, row + 62 + gap, row + 64 + gap);
    white += gap;
  }
  const { filled, pairedInk } = fillHollowWalls(toPixels(ink, W, H));
  let painted = 0;
  for (let i = 0; i < W * H; i++) if (!ink[i] && filled.rgba[i * 4] === 0) painted++;
  assert.equal(painted, white, "drifting pair: every gap pixel filled");
  assert.equal(pairedInk, 1, "drifting pair: both lines counted");
}

// ------------------------------------------------------------ 2. furniture alone
{
  const plan = toPixels(paint(FURNITURE, 1, 1180, 980), 1180, 980);
  const { filled, pairedInk } = fillHollowWalls(plan);
  assert.equal(pairedInk, 0, "furniture: no pairs");
  assert.equal(filled, plan, "furniture: image returned unchanged");
  // No walls means the mask stage refuses the image with its user-facing error.
  assert.throws(() => detectWalls(plan), BlueprintError, "furniture: no walls");
}

// ------------------------------------------------------------ 3. solid plans unchanged
// [file, walls, coverage %, inkCapture %] as measured before hollowWalls.ts existed.
const BASELINE: [string, number, string, string][] = [
  ["tests/fixtures/01_clean_uniform.png", 20, "99.8", "98.5"],
  ["tests/fixtures/02_thick_exterior_thin_interior.png", 21, "100.0", "95.4"],
  ["tests/fixtures/03_with_dimensions.png", 20, "99.9", "89.3"],
  ["tests/fixtures/04_fake_scan.jpg", 20, "99.7", "87.8"],
  ["test-plans/06_real_listing_main_case.jpg", 63, "95.9", "81.4"],
];

async function regression() {
  for (const [file, wantWalls, wantCoverage, wantInk] of BASELINE) {
    if (!existsSync(file)) {
      // Only 06 may be absent; the fixtures are tracked and must be there.
      assert.ok(file.startsWith("test-plans/"), `FAIL: ${file} is missing. It is tracked in git; restore it with: git checkout -- tests/fixtures`);
      console.log(`SKIPPED ${file}: not on this machine (test-plans/ is not in git), so plan 06 was NOT checked`);
      continue;
    }
    const { data, info } = await sharp(file).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { mask, mode, reason } = detectWalls(deskew({ width: info.width, height: info.height, rgba: data }).pixels);
    const { walls, coverage } = vectorize(mask);
    assert.equal(mode, "solid", `${file}: must stay on the solid path (${reason})`);
    assert.deepEqual(
      [walls.length, (coverage * 100).toFixed(1), (mask.inkCapture * 100).toFixed(1)],
      [wantWalls, wantCoverage, wantInk],
      `${file}: walls, coverage, inkCapture`,
    );
    console.log(`${file}: solid, unchanged (${reason})`);
  }
}

regression().then(() => console.log("OK"));
