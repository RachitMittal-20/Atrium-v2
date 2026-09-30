/**
 * test-vectorize.ts — hand-built wall masks with exact expected segments for
 * src/lib/blueprint/vectorize.ts. Rects are [x0, y0, x1, y1) in pixels, so a
 * wall filling rows 20..29 has its centre line at y = (20 + 30) / 2 = 25.
 * Run: npx tsx scripts/test-vectorize.ts
 */
import assert from "node:assert/strict";
import { vectorize } from "../src/lib/blueprint/vectorize";
import type { PixelWall, WallMask } from "../src/types/blueprint";

function mask(width: number, height: number, wallThickness: number, rects: number[][]): WallMask {
  const m = new Uint8Array(width * height);
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y < y1; y++) m.fill(1, y * width + x0, y * width + x1);
  return { width, height, mask: m, wallThickness };
}

/** Order-independent comparison: each wall as "ax,ay-bx,by t" with a/b sorted. */
const key = ({ a, b, thickness }: PixelWall) => {
  const [p, q] = [`${a.x},${a.y}`, `${b.x},${b.y}`].sort();
  return `${p}-${q} t${thickness}`;
};
function expectWalls(name: string, m: WallMask, want: [number, number, number, number, number][], minCoverage = 0.999) {
  const { walls, coverage } = vectorize(m);
  assert.deepEqual(
    walls.map(key).sort(),
    want.map(([ax, ay, bx, by, t]) => key({ a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: t })).sort(),
    name,
  );
  assert.ok(coverage >= minCoverage, `${name}: coverage ${coverage}`);
}

// Rectangle: 10 px walls, outer box (20,20)-(220,170). Centre lines x 25/215, y 25/165.
const box = [
  [20, 20, 220, 30],
  [20, 160, 220, 170],
  [20, 20, 30, 170],
  [210, 20, 220, 170],
];
expectWalls("rectangle", mask(240, 190, 10, box), [
  [25, 25, 215, 25, 10],
  [25, 165, 215, 165, 10],
  [25, 25, 25, 165, 10],
  [215, 25, 215, 165, 10],
]);

// L: free ends stay at the drawn ends (x = 200, y = 180).
expectWalls("L", mask(220, 200, 10, [[20, 20, 200, 30], [20, 20, 30, 180]]), [
  [25, 25, 200, 25, 10],
  [25, 25, 25, 180, 10],
]);

// T: the stem (x 115..124 → 120) ends on the bar's centre line, and the bar is split there.
expectWalls("T", mask(240, 200, 10, [[20, 20, 220, 30], [115, 20, 125, 180]]), [
  [20, 25, 120, 25, 10],
  [120, 25, 220, 25, 10],
  [120, 25, 120, 180, 10],
]);

// Rectangle with a 40 px door gap in the bottom wall (x 100..140): two pieces, free ends at the gap.
expectWalls("door gap", mask(240, 190, 10, [[20, 20, 220, 30], [20, 160, 100, 170], [140, 160, 220, 170], [20, 20, 30, 170], [210, 20, 220, 170]]), [
  [25, 25, 215, 25, 10],
  [25, 165, 100, 165, 10],
  [140, 165, 215, 165, 10],
  [25, 25, 25, 165, 10],
  [215, 25, 215, 165, 10],
]);

// Two rooms: 12 px exterior box (20,20)-(260,180) → centre lines x 26/254, y 26/174;
// a 6 px interior wall at x 137..142 → x 140, splitting the top and bottom walls.
expectWalls(
  "two rooms",
  mask(280, 200, 12, [
    [20, 20, 260, 32],
    [20, 168, 260, 180],
    [20, 20, 32, 180],
    [248, 20, 260, 180],
    [137, 32, 143, 168],
  ]),
  [
    [26, 26, 140, 26, 12],
    [140, 26, 254, 26, 12],
    [26, 174, 140, 174, 12],
    [140, 174, 254, 174, 12],
    [26, 26, 26, 174, 12],
    [254, 26, 254, 174, 12],
    [140, 26, 140, 174, 6],
  ],
);

// Diagonal-only mask: no walls found, and coverage says so instead of claiming success.
{
  const m = mask(200, 200, 8, []);
  for (let i = 20; i < 180; i++) for (let d = 0; d < 8; d++) m.mask[i * 200 + i + d] = 1;
  const { walls, coverage } = vectorize(m);
  assert.equal(walls.length, 0, "diagonal: skipped");
  assert.equal(coverage, 0, "diagonal: coverage flags it");
}

console.log("OK");
