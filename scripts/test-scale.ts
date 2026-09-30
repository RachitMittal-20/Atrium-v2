/**
 * test-scale.ts — offline checks for src/lib/blueprint/scale.ts. No real OCR
 * (tesseract downloads language data): the OCR words are written by hand, with
 * boxes, and so are the walls.
 *
 * The house is the 10 × 8 m test house (centre line to centre line) at
 * 100 px/m × `s`: 20 px exterior walls, 10 px interior walls, one wall down the
 * middle and one across the left half. That makes three rooms: two of
 * 4.85 × 3.85 m inside (left) and one of 4.85 × 7.80 m (right).
 * Run: npx tsx scripts/test-scale.ts
 */
import assert from "node:assert/strict";
import { estimateScale, parseLength, parseSizeLabel } from "../src/lib/blueprint/scale";
import type { OcrWord, PixelWall, PlanPixels } from "../src/types/blueprint";

const near = (got: number | null, want: number, tolPct: number, name: string) =>
  assert.ok(got !== null && Math.abs(got - want) <= (tolPct / 100) * want, `${name}: got ${got}, want ${want} ±${tolPct}%`);

// ------------------------------------------------------------ parsing table
const FT = 0.3048;
const sizes: [string, number, number][] = [
  [`12'0" x 14'0"`, 12 * FT, 14 * FT],
  [`14' x 19'`, 14 * FT, 19 * FT],
  [`12' 6" x 10' 3"`, 12.5 * FT, 10.25 * FT],
  [`3.8 m x 4.2 m`, 3.8, 4.2],
  [`3800 x 4200 mm`, 3.8, 4.2],
  // misreads and variants
  [`12’0” × 14’0”`, 12 * FT, 14 * FT], // curly quotes and ×
  [`12'O" X 14'O"`, 12 * FT, 14 * FT], // capital O for 0, capital X
  [`12'6'' x 10'3''`, 12.5 * FT, 10.25 * FT], // two apostrophes for the inch mark
  [`3.8m x 4.2m`, 3.8, 4.2],
  [`3.8mx4.2m`, 3.8, 4.2],
];
for (const [text, a, b] of sizes) {
  const got = parseSizeLabel(text);
  assert.ok(got, `parseSizeLabel(${text}) parsed`);
  near(got[0], a, 1e-9, `parseSizeLabel(${text}) first`);
  near(got[1], b, 1e-9, `parseSizeLabel(${text}) second`);
}
const lengths: [string, number][] = [
  [`12'6"`, 12.5 * FT],
  [`12'-6"`, 12.5 * FT],
  [`14'`, 14 * FT],
  [`3.8m`, 3.8],
  [`10.0 m`, 10],
  [`1O.O m`, 10], // capital O inside the number
  [`10.0 M`, 10],
  [`3800 mm`, 3.8],
  [`380 cm`, 3.8],
];
for (const [text, want] of lengths) near(parseLength(text), want, 1e-9, `parseLength(${text})`);
// Never guess a unit, and never read a word or an area as a length.
for (const text of ["12", "3.8", "12 x 14", "3.8 x 4.2", "Room 2", "12 m²", "12 m2", "3 max", `12'14"`, ""]) {
  assert.equal(parseLength(text), null, `parseLength(${text}) must be null`);
  assert.equal(parseSizeLabel(text), null, `parseSizeLabel(${text}) must be null`);
}
assert.equal(parseSizeLabel("3.8 m x 4.2"), null, "a bare second number is not given a unit");

// ------------------------------------------------------------ hand-built house
const M = 100; // margin around the house, px before scaling

/** Walls of the house at scale `s`, split at every joint. `door` cuts a 1 m gap
 *  in the middle wall at y 1.5–2.5 m, the height of the top-left room's label. */
function house(s: number, door = false): PixelWall[] {
  const mid: number[][] = door
    ? [[500, 0, 500, 150, 10], [500, 250, 500, 400, 10]]
    : [[500, 0, 500, 400, 10]];
  return [
    [0, 0, 500, 0, 20], [500, 0, 1000, 0, 20], // top
    [0, 800, 500, 800, 20], [500, 800, 1000, 800, 20], // bottom
    [0, 0, 0, 400, 20], [0, 400, 0, 800, 20], // left
    [1000, 0, 1000, 800, 20], // right
    ...mid, [500, 400, 500, 800, 10], // middle wall
    [0, 400, 500, 400, 10], // across the left half
  ].map(([ax, ay, bx, by, t]) => ({
    a: { x: (M + ax) * s, y: (M + ay) * s },
    b: { x: (M + bx) * s, y: (M + by) * s },
    thickness: t * s,
  }));
}

/** A printed label as OCR would return it: one word per space-separated piece,
 *  14 px text, centred on (cx, cy) in house pixels before scaling. */
function label(text: string, cx: number, cy: number, s: number, confidence = 90): OcrWord[] {
  const parts = text.split(" ");
  const widths = parts.map((p) => p.length * 8);
  const total = widths.reduce((p, q) => p + q, 0) + 5 * (parts.length - 1);
  let x = M + cx - total / 2;
  return parts.map((p, i) => {
    const box = { x0: x * s, y0: (M + cy - 7) * s, x1: (x + widths[i]) * s, y1: (M + cy + 7) * s };
    x += widths[i] + 5;
    return { text: p, box, confidence };
  });
}

const blank = (width: number, height: number): PlanPixels => ({ width, height, rgba: new Uint8ClampedArray(width * height * 4).fill(255) });
const paper = (s: number) => blank(Math.round(1200 * s), Math.round(1000 * s));

// Room centres: top-left (250, 200), bottom-left (250, 600), right (750, 400).
const threeLabels = (s: number) => [
  ...label("4.85 m x 3.85 m", 250, 200, s),
  ...label("3.85m x 4.85m", 250, 600, s), // numbers the other way round: the assignment must swap
  ...label("4.85 m x 7.80 m", 750, 400, s),
];

for (const s of [1, 1.5]) {
  const r = estimateScale({ words: threeLabels(s), walls: house(s), pixels: paper(s) });
  assert.equal(r.samples.length, 3, `house ${s}×: three samples`);
  near(r.pxPerM, 100 * s, 1e-6, `house ${s}×`);
  assert.equal(r.confidence, "good", `house ${s}×: ${r.reason}`);
  console.log(`house ${s}×: ${r.pxPerM!.toFixed(2)} px/m, ${r.confidence}`);
}

// Feet and inches, with the room name on the line above: 15'11" × 12'8" is 4.851 × 3.861 m.
{
  const words = [...label("Bedroom 1", 250, 180, 1), ...label(`15'11" x 12'8"`, 250, 200, 1), ...label(`15'11" x 25'7"`, 750, 400, 1)];
  const r = estimateScale({ words, walls: house(1), pixels: paper(1) });
  near(r.pxPerM, 100, 0.5, "feet labels");
  assert.equal(r.confidence, "good", "feet labels");
}

// A label whose numbers do not fit the room shape is rejected.
{
  const r = estimateScale({ words: label("3.0 m x 9.0 m", 250, 200, 1), walls: house(1), pixels: paper(1) });
  assert.equal(r.samples.length, 0, "misfit: no sample");
  assert.match(r.rejected[0].why, /does not fit the room shape/, "misfit: rejected with the reason");
  assert.equal(r.confidence, "none", "misfit");
  assert.equal(r.pxPerM, null, "misfit");
}

// A door aligned with the centre ray: that ray runs on to the far wall, the median ignores it.
{
  const words = [...label("4.85 m x 3.85 m", 250, 200, 1), ...label("4.85 m x 7.80 m", 750, 400, 1)];
  const r = estimateScale({ words, walls: house(1, true), pixels: paper(1) });
  assert.equal(r.samples.length, 2, "door: both labels accepted");
  near(r.pxPerM, 100, 1e-6, "door");
  assert.equal(r.confidence, "good", "door");
}

// No labels, and labels with no unit.
{
  const r = estimateScale({ words: [], walls: house(1), pixels: paper(1) });
  assert.deepEqual([r.pxPerM, r.confidence, r.samples.length], [null, "none", 0], "no labels");
  assert.match(r.reason, /Click one wall and type its length/, "no labels: reason");

  const bare = estimateScale({ words: [...label("Kitchen", 250, 180, 1), ...label("12 x 14", 250, 200, 1)], walls: house(1), pixels: paper(1) });
  assert.deepEqual([bare.pxPerM, bare.confidence], [null, "none"], "bare numbers");
  assert.deepEqual(bare.unparsed, ["12 x 14"], "bare numbers are listed as unparsed");
}

// Exactly one sample is "check"; the same room labelled twice is still one sample.
{
  const one = estimateScale({ words: label("4.85 m x 3.85 m", 250, 200, 1), walls: house(1), pixels: paper(1) });
  assert.deepEqual([one.confidence, one.samples.length], ["check", 1], "one label");
  near(one.pxPerM, 100, 1e-6, "one label");

  const twice = [...label("4.85 m x 3.85 m", 250, 190, 1), ...label(`15'11" x 12'8"`, 250, 215, 1)];
  const r = estimateScale({ words: twice, walls: house(1), pixels: paper(1) });
  assert.deepEqual([r.confidence, r.samples.length], ["check", 1], "metres and feet in one room count once");
}

// A low-confidence word is ignored: without its "x" the label is not a size any more.
{
  const words = label("4.85 m x 3.85 m", 250, 200, 1).map((w) => (w.text === "x" ? { ...w, confidence: 20 } : w));
  assert.equal(estimateScale({ words, walls: house(1), pixels: paper(1) }).samples.length, 0, "low confidence");
}

// Two labels that each fit their room but contradict each other (100 and 50 px/m).
{
  const words = [...label("4.85 m x 3.85 m", 250, 200, 1), ...label("9.70 m x 15.60 m", 750, 400, 1)];
  const r = estimateScale({ words, walls: house(1), pixels: paper(1) });
  assert.equal(r.samples.length, 2, "contradictory: both measured");
  assert.deepEqual([r.pxPerM, r.confidence], [null, "none"], "contradictory");
  assert.ok(r.spreadPct > 15, `contradictory: spread ${r.spreadPct}`);
  assert.match(r.reason, /Click one wall and type its length/, "contradictory: reason");
}

// Spread between 5 and 15% is "check": 100 and 85 px/m, median 92.5, spread 8.1%.
{
  const words = [...label("4.85 m x 3.85 m", 250, 200, 1), ...label("5.706 m x 9.176 m", 750, 400, 1)];
  const r = estimateScale({ words, walls: house(1), pixels: paper(1) });
  assert.equal(r.confidence, "check", `5–15% spread: ${r.spreadPct}`);
  near(r.pxPerM, 92.5, 0.1, "5–15% spread: median");
}

// ------------------------------------------------------------ dimension lines (Source B)
{
  const W = 1300;
  const H = 1100;
  const pixels = blank(W, H);
  const ink = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) pixels.rgba.fill(0, (y * W + x) * 4, (y * W + x) * 4 + 3);
  };
  // Horizontal chain under the house: ticks at x 100, 600 and 1100, so 5 m + 5 m.
  ink(100, 1000, 1101, 1001);
  for (const x of [100, 600, 1100]) ink(x, 990, x + 1, 1011);
  // Vertical 8 m line left of the house, ticks at y 100 and 900, broken where its text sits.
  ink(50, 100, 51, 470);
  ink(50, 530, 51, 901);
  for (const y of [100, 900]) ink(40, y, 61, y + 1);

  const above = (text: string, cx: number): OcrWord => ({ text, confidence: 90, box: { x0: cx - 24, y0: 980, x1: cx + 24, y1: 994 } });
  const chain = estimateScale({ words: [above("5.0 m", 350), above("5.0 m", 850)], walls: house(1), pixels });
  assert.equal(chain.samples.length, 2, `chain: two dimension samples (${JSON.stringify(chain.rejected)})`);
  near(chain.pxPerM, 100, 0.5, "chain: each label measures its own segment");
  assert.equal(chain.confidence, "good", "chain");

  // Vertical text arrives with a tall box and vertical: true, sitting in the line's gap.
  const vertical: OcrWord = { text: "8.0 m", confidence: 90, vertical: true, box: { x0: 43, y0: 476, x1: 57, y1: 524 } };
  const v = estimateScale({ words: [vertical], walls: house(1), pixels });
  near(v.pxPerM, 100, 0.5, "vertical dimension line");
  assert.equal(v.confidence, "check", "vertical: one sample");

  // A length with no line beside it gives no sample.
  const lone = estimateScale({ words: [{ text: "2.7 m", confidence: 90, box: { x0: 600, y0: 500, x1: 650, y1: 514 } }], walls: house(1), pixels });
  assert.deepEqual([lone.samples.length, lone.confidence], [0, "none"], "length with no line");

  // A wall is not a dimension line: a label just above the 10 px middle-left wall, drawn in.
  ink(100, 495, 600, 505);
  const wall = estimateScale({ words: [{ text: "5.0 m", confidence: 90, box: { x0: 325, y0: 476, x1: 375, y1: 490 } }], walls: house(1), pixels });
  assert.equal(wall.samples.length, 0, "a wall is not taken for a dimension line");
}

console.log("OK");
