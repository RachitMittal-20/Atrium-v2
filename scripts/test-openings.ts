/**
 * test-openings.ts — checks src/lib/blueprint/openings.ts three ways.
 *
 * 1. Fixtures 01–04 (tracked in tests/fixtures), run the way the pipeline runs
 *    them: deskew, walls, vectorize, then detectOpenings on the deskewed
 *    unfilled image. Known truth at 100 px/m, in metres from the house's
 *    top-left centre-line corner (the smallest wall-endpoint x and y, the same
 *    origin footprint.ts measures from). Each image must give exactly 4 windows
 *    and 4 doors, each matched one to one to a truth opening of its kind on
 *    the same wall line, with centre and width within the tolerances below.
 *    The tolerances were decided before the first run and are not tuned.
 *    Expected width: the fixture generator draws every wall piece half a
 *    thickness past each cut, so the gap as drawn (what widthPx measures) is
 *    the nominal width minus the thickness of the wall it sits in. That
 *    thickness is the generator's own value per image (GENERATOR_T), not the
 *    mask's measurement, so a wrong mask cannot move the target.
 * 2. Hand-built walls on a clean drawn image: a window whose glazing line has
 *    a 3 px break; a stub with nothing opposite (unpaired, not an opening);
 *    two openings on one wall line; an opening right next to a corner, where
 *    one end is the joint of an interior wall.
 * 3. Guards for the window rule (openings.ts LINE_DARKNESS), on scan-like
 *    pages. The generator of 04 is not in the repo, so its noise is taken
 *    directly: the page's paper is an ink-free 260 × 200 patch of 04 itself
 *    (deskewed), the drawing is blurred and multiplied onto it, and the result
 *    goes through a JPEG round trip for block artefacts. (i) A plain door gap
 *    must stay a door; the largest darkness sum along it is printed next to
 *    the threshold. (ii) A blurred 1 px glazing line, as faint relative to its
 *    paper as 04's right-wall window, must be a window, and the global ink
 *    threshold alone must miss it at more than 20% of the gap (so the old
 *    rule would have called it a door).
 * Run: npx tsx scripts/test-openings.ts
 */
import assert from "node:assert/strict";
import sharp from "sharp";
import { deskew } from "../src/lib/blueprint/deskew";
import { detectWalls } from "../src/lib/blueprint/hollowWalls";
import { detectOpenings, gapDarkness, inkLevel, isH } from "../src/lib/blueprint/openings";
import { vectorize } from "../src/lib/blueprint/vectorize";
import { binarize, luminance } from "../src/lib/blueprint/wallMask";
import type { OpeningCandidate, PixelWall, PlanPixels } from "../src/types/blueprint";

const CENTRE_TOL = 15; // px along the wall
const WIDTH_TOL = 20; // px, against the drawn width (see header)
const PX_PER_M = 100;
console.log(`tolerances: centre ±${CENTRE_TOL} px, width ±${WIDTH_TOL} px`);

async function load(file: string) {
  const { data, info } = await sharp(file).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return deskew({ width: info.width, height: info.height, rgba: data }).pixels;
}

// ------------------------------------------------------------ 1. fixtures
/** h: the wall runs along x at y = line; v: along y at x = line. from/to along the wall. */
type Truth = { kind: "window" | "door"; h: boolean; line: number; from: number; to: number };
const TRUTH: Truth[] = [
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
const exterior = (t: Truth) => t.line === 0 || t.line === (t.h ? 8 : 10);
/** Wall thickness the fixture generator drew, [exterior, interior], in px. */
const GENERATOR_T: Record<string, [number, number]> = {
  "01_clean_uniform.png": [15, 15],
  "02_thick_exterior_thin_interior.png": [25, 8],
  "03_with_dimensions.png": [20, 10],
  "04_fake_scan.jpg": [20, 10],
};

const oH = (o: OpeningCandidate) => isH({ a: o.a, b: o.b, thickness: 0 });

async function fixtures() {
  const failures: string[] = []; // collected so one run shows every miss, then asserted empty
  for (const [file, [tExt, tInt]] of Object.entries(GENERATOR_T)) {
    const pixels = await load(`tests/fixtures/${file}`);
    const { walls } = vectorize(detectWalls(pixels).mask);
    const { openings, unpaired } = detectOpenings(walls, pixels);
    const x0 = Math.min(...walls.flatMap((w) => [w.a.x, w.b.x]));
    const y0 = Math.min(...walls.flatMap((w) => [w.a.y, w.b.y]));
    const kinds = (k: string) => openings.filter((o) => o.kind === k).length;
    if (kinds("window") !== 4 || kinds("door") !== 4 || unpaired.length)
      failures.push(`${file}: ${kinds("window")} windows, ${kinds("door")} doors, ${unpaired.length} unpaired; want 4, 4, 0`);
    const used = new Set<OpeningCandidate>();
    for (const t of TRUTH) {
      const [lineO, alongO] = t.h ? [y0, x0] : [x0, y0];
      const centre = alongO + ((t.from + t.to) / 2) * PX_PER_M;
      const want = (t.to - t.from) * PX_PER_M - (exterior(t) ? tExt : tInt);
      const onLine = openings.filter((o) => {
        const [across, along] = oH(o) ? [o.centre.y, o.centre.x] : [o.centre.x, o.centre.y];
        return !used.has(o) && o.kind === t.kind && oH(o) === t.h && Math.abs(across - (lineO + t.line * PX_PER_M)) <= o.wallThicknessPx / 2 && Math.abs(along - centre) <= CENTRE_TOL;
      });
      const m = onLine.find((o) => Math.abs(o.widthPx - want) <= WIDTH_TOL) ?? onLine[0];
      const where = `${t.kind} on ${t.h ? "y" : "x"}=${t.line} at ${t.from}–${t.to} m`;
      if (!m) {
        failures.push(`${file}: no ${t.kind} on that wall within ±${CENTRE_TOL} px of ${where}`);
        continue;
      }
      used.add(m);
      const along = oH(m) ? m.centre.x : m.centre.y;
      const residual = m.widthPx - want;
      const ok = Math.abs(residual) <= WIDTH_TOL;
      const line = `${file}: ${where}: centre ${(along - centre).toFixed(1)} px off; width ${m.widthPx.toFixed(1)} − expected ${want} = ${residual >= 0 ? "+" : ""}${residual.toFixed(1)} px`;
      console.log(`${ok ? "PASS" : "FAIL"} ${line}`);
      if (!ok) failures.push(line);
    }
  }
  assert.deepEqual(failures, [], `fixtures:\n  ${failures.join("\n  ")}`);
}

// ------------------------------------------------------------ 2. hand-built
type W = [number, number, number, number]; // centre line ax, ay, bx, by (axis-aligned)
type Rect = [number, number, number, number]; // [x0, y0, x1, y1)
const T = 10;
const [PW, PH] = [260, 200];

/** Rects for walls drawn as T-thick bars along their centre lines, plus extras. */
const inkRects = (walls: W[], extra: Rect[]): Rect[] => [
  ...walls.map(([ax, ay, bx, by]): Rect =>
    ay === by ? [Math.min(ax, bx), ay - T / 2, Math.max(ax, bx), ay + T / 2] : [ax - T / 2, Math.min(ay, by), ax + T / 2, Math.max(ay, by)],
  ),
  ...extra,
];
const pixelWalls = (walls: W[]): PixelWall[] => walls.map(([ax, ay, bx, by]) => ({ a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: T }));

/** Clean white page with black walls and extras. */
function page(walls: W[], extra: Rect[] = []): { walls: PixelWall[]; pixels: PlanPixels } {
  const rgba = new Uint8ClampedArray(PW * PH * 4).fill(255);
  for (const [x0, y0, x1, y1] of inkRects(walls, extra))
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) rgba.fill(0, (y * PW + x) * 4, (y * PW + x) * 4 + 3);
  return { walls: pixelWalls(walls), pixels: { width: PW, height: PH, rgba } };
}
const summary = (os: OpeningCandidate[]) => os.map((o) => `${o.kind} ${o.centre.x},${o.centre.y} w${o.widthPx}`).sort();
// A room: left x 25, right x 215, top y 25, bottom y 165. Each case supplies its top wall pieces.
const room = (top: W[], more: W[] = []): W[] => [...top, [25, 165, 215, 165], [25, 25, 25, 165], [215, 25, 215, 165], ...more];

// Window whose 2 px glazing line (y 24..25) has a 3 px break at x 128..130.
{
  const { walls, pixels } = page(room([[25, 25, 100, 25], [160, 25, 215, 25]]), [[100, 24, 128, 26], [131, 24, 160, 26]]);
  const { openings, unpaired } = detectOpenings(walls, pixels);
  assert.deepEqual(summary(openings), ["window 130,25 w60"], "broken glazing line");
  assert.equal(unpaired.length, 0, "broken glazing line: unpaired");
}

// Stub: an interior wall from the bottom wall (split at x 120) up to y 100, with nothing opposite.
{
  const { walls, pixels } = page([[25, 25, 215, 25], [25, 165, 120, 165], [120, 165, 215, 165], [25, 25, 25, 165], [215, 25, 215, 165], [120, 165, 120, 100]]);
  const { openings, unpaired } = detectOpenings(walls, pixels);
  assert.deepEqual(openings, [], "stub: no openings");
  assert.deepEqual(unpaired, [{ x: 120, y: 100 }], "stub: its free end is unpaired");
}

// Two openings on one wall line: a plain gap (door) at x 70..110 and a glazed gap (window) at x 140..180.
{
  const { walls, pixels } = page(room([[25, 25, 70, 25], [110, 25, 140, 25], [180, 25, 215, 25]]), [[140, 24, 180, 26]]);
  const { openings, unpaired } = detectOpenings(walls, pixels);
  assert.deepEqual(summary(openings), ["door 90,25 w40", "window 160,25 w40"], "two openings on one line");
  assert.equal(unpaired.length, 0, "two openings: unpaired");
}

// Opening right next to a corner: the gap x 120..160 on the top wall ends at the
// joint where an interior wall x = 160 meets it (the bottom wall is split there too).
{
  const { walls, pixels } = page([
    [25, 25, 120, 25], [160, 25, 215, 25], [25, 165, 160, 165], [160, 165, 215, 165],
    [25, 25, 25, 165], [215, 25, 215, 165], [160, 25, 160, 165],
  ]);
  const { openings, unpaired } = detectOpenings(walls, pixels);
  assert.deepEqual(summary(openings), ["door 140,25 w40"], "next to a corner");
  assert.equal(unpaired.length, 0, "next to a corner: unpaired");
}
console.log("hand-built: broken glazing line, stub, two openings on one line, next to a corner");

// ------------------------------------------------------------ 3. scan-like guards
const PATCH = { left: 300, top: 500 }; // ink-free paper in deskewed 04 (asserted below)
/** Blur for the drawing. Measured, not derived: a 1 px black line blurred at
 *  σ 1.0 (then JPEG) is darkest at 0.52 × its paper, like 04's right-wall
 *  window (117–126 on paper 225, 0.52–0.56). It holds about half the total
 *  darkness of 04's line (which is nearer 2 px wide), so it is the harder case. */
const LINE_SIGMA = 1.0;

/** Scan-like page: the drawing (walls + extras, black on white) blurred at
 *  `sigma`, multiplied onto 04's paper patch, then JPEG-encoded and decoded. */
async function scanPage(paper: Uint8Array, walls: W[], extra: Rect[], sigma: number) {
  const drawing = new Uint8Array(PW * PH).fill(255);
  for (const [x0, y0, x1, y1] of inkRects(walls, extra)) for (let y = y0; y < y1; y++) drawing.fill(0, y * PW + x0, y * PW + x1);
  const blurred = await sharp(drawing, { raw: { width: PW, height: PH, channels: 1 } }).blur(sigma).extractChannel(0).raw().toBuffer(); // sharp outputs 3 channels otherwise
  const rgb = new Uint8Array(PW * PH * 3);
  for (let i = 0; i < PW * PH; i++) rgb.fill(Math.round((paper[i] * blurred[i]) / 255), i * 3, i * 3 + 3);
  const jpeg = await sharp(rgb, { raw: { width: PW, height: PH, channels: 3 } }).jpeg({ quality: 80 }).toBuffer();
  const { data } = await sharp(jpeg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { walls: pixelWalls(walls), pixels: { width: PW, height: PH, rgba: data } as PlanPixels };
}

async function scanGuards() {
  const scan = await load("tests/fixtures/04_fake_scan.jpg");
  const [lum, ink] = [luminance(scan), binarize(scan)];
  const paper = new Uint8Array(PW * PH);
  for (let y = 0; y < PH; y++)
    for (let x = 0; x < PW; x++) {
      const i = (PATCH.top + y) * scan.width + PATCH.left + x;
      assert.equal(ink[i], 0, `04 paper patch has ink at ${PATCH.left + x},${PATCH.top + y}`);
      paper[y * PW + x] = lum[i];
    }
  const gapA = { x: 100, y: 25 };
  const gapB = { x: 160, y: 25 };
  const top: W[] = [[25, 25, 100, 25], [160, 25, 215, 25]];

  // (i) Plain door gap: walls blurred like the window line, nothing in the gap.
  {
    const { walls, pixels } = await scanPage(paper, room(top), [], LINE_SIGMA);
    const { openings } = detectOpenings(walls, pixels);
    const l = luminance(pixels);
    const steps = gapDarkness(l, inkLevel(l, binarize(pixels)), PW, PH, gapA, gapB, T / 2);
    const largest = steps.reduce((m, s) => (s.darkness > m.darkness ? s : m));
    // Closest to firing: near the wall ends the blurred wall darkens the band's median paper, so the threshold drops there.
    const closest = steps.reduce((m, s) => (s.darkness / s.needs > m.darkness / m.needs ? s : m));
    const hits = steps.filter((s) => s.darkness >= s.needs).length;
    console.log(
      `scan-like door gap: largest darkness sum ${largest.darkness.toFixed(0)} vs threshold ${largest.needs.toFixed(0)} at that step; closest to threshold ${closest.darkness.toFixed(0)} vs ${closest.needs.toFixed(0)}; steps over threshold ${hits}/${steps.length} (a window needs 80%)`,
    );
    assert.deepEqual(summary(openings), ["door 130,25 w60"], "scan-like door gap stays a door");
  }

  // (ii) Blurred 1 px glazing line along the centre line (y 25) across the gap.
  {
    const { walls, pixels } = await scanPage(paper, room(top), [[100, 25, 160, 26]], LINE_SIGMA);
    const { openings } = detectOpenings(walls, pixels);
    const l = luminance(pixels);
    const b = binarize(pixels);
    let darkest = 255;
    let paperSum = 0;
    let binarized = 0;
    for (let x = 100; x < 160; x++) {
      if ([...Array(11)].some((_, d) => b[(20 + d) * PW + x])) binarized++;
      if (x < 110 || x >= 150) continue; // faintness away from the blurred wall ends
      let col = 255;
      for (let y = 20; y <= 30; y++) col = Math.min(col, l[y * PW + x]);
      darkest = Math.min(darkest, col);
      paperSum += l[15 * PW + x]; // 10 px above the line: paper
    }
    const steps = gapDarkness(l, inkLevel(l, b), PW, PH, gapA, gapB, T / 2);
    const hits = steps.filter((s) => s.darkness >= s.needs).length;
    console.log(
      `scan-like glazing line: darkest ${darkest} on paper ~${(paperSum / 40).toFixed(0)} (${(darkest / (paperSum / 40)).toFixed(2)} × paper; 04's right wall ~0.53); global ink threshold sees it at ${binarized}/60 steps, the darkness sum at ${hits}/${steps.length}`,
    );
    // The global ink threshold alone must miss most of it, or this would not test the darkness sum.
    assert.ok(binarized / 60 < 0.8, `blurred line: global ink threshold sees it at ${binarized}/60, so this does not test the darkness sum`);
    assert.deepEqual(summary(openings), ["window 130,25 w60"], "blurred 1 px glazing line is a window");
  }
}

fixtures()
  .then(scanGuards)
  .then(() => console.log("OK"));
