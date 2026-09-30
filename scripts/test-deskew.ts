/**
 * test-deskew.ts — builds a small synthetic plan by hand (white page, black
 * 12 px walls: a two-room box with a door gap in the dividing wall), tilts it
 * by known angles with rotatePixels, and checks that src/lib/blueprint/deskew.ts
 * recovers each angle within 0.3° and that the straightened image vectorizes
 * (wallMask.ts → vectorize.ts) to the same wall count as the untilted original.
 *
 * It also guards against a deskew regression on a real file:
 * tests/fixtures/04_fake_scan.jpg (a 10 × 8 m house scanned at a 2.2° tilt, see
 * tests/fixtures/README.md) must FAIL the footprint truth check (footprint.ts)
 * when deskew is skipped and pass when it runs, which also shows the check has
 * teeth. The fixture is tracked in git, so a missing file fails the test with a
 * message saying so (it is not skipped).
 * Run: npx tsx scripts/test-deskew.ts
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import sharp from "sharp";
import { footprintCheck } from "./footprint";
import { deskew, rotatePixels } from "../src/lib/blueprint/deskew";
import { vectorize } from "../src/lib/blueprint/vectorize";
import { extractWalls } from "../src/lib/blueprint/wallMask";
import type { PlanPixels } from "../src/types/blueprint";

// Rects are [x0, y0, x1, y1) in pixels. Outer box (60,60)-(640,460); the
// dividing wall at x 344..355 has a 60 px door gap at y 230..289.
const W = 700;
const H = 520;
const rects = [
  [60, 60, 640, 72],
  [60, 448, 640, 460],
  [60, 60, 72, 460],
  [628, 60, 640, 460],
  [344, 72, 356, 230],
  [344, 290, 356, 448],
];
const rgba = new Uint8ClampedArray(W * H * 4).fill(255); // white, opaque
for (const [x0, y0, x1, y1] of rects)
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) rgba.fill(0, (y * W + x) * 4, (y * W + x) * 4 + 3);
const plan: PlanPixels = { width: W, height: H, rgba };

const wallCount = (p: PlanPixels) => vectorize(extractWalls(p)).walls.length;
const want = wallCount(plan);
assert.equal(want, 8, "original: 4 outer walls split by the divider (6) + 2 divider pieces");

// An upright plan comes back as the very same object.
const upright = deskew(plan);
assert.equal(upright.angleDeg, 0, "upright: angle");
assert.equal(upright.pixels, plan, "upright: input returned unchanged");

for (const angle of [-3, 1.5, 6]) {
  const { pixels, angleDeg } = deskew(rotatePixels(plan, angle));
  assert.ok(Math.abs(angleDeg - angle) <= 0.3, `${angle}°: recovered ${angleDeg}°`);
  assert.equal(wallCount(pixels), want, `${angle}°: wall count after deskew`);
}

// Real tilted scan: the footprint check must fail without deskew and pass with it.
async function scan04() {
  const file = "tests/fixtures/04_fake_scan.jpg";
  assert.ok(existsSync(file), `FAIL: ${file} is missing. It is tracked in git; restore it with: git checkout -- tests/fixtures`);
  const { data, info } = await sharp(file).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const raw: PlanPixels = { width: info.width, height: info.height, rgba: data };
  const footprint = (p: PlanPixels) => {
    const mask = extractWalls(p);
    return footprintCheck(vectorize(mask).walls, mask.wallThickness);
  };
  const tilted = footprint(raw);
  const straight = footprint(deskew(raw).pixels);
  const show = (f: typeof tilted) => `${f.width.toFixed(2)}×${f.height.toFixed(2)} px ±${f.tol.toFixed(1)} ${f.pass ? "PASS" : "FAIL"}`;
  console.log(`04 without deskew: ${show(tilted)}\n04 with deskew:    ${show(straight)}`);
  assert.equal(tilted.pass, false, "04 without deskew must fail the footprint check");
  assert.equal(straight.pass, true, "04 with deskew must pass the footprint check");
}

scan04().then(() => console.log("OK"));
