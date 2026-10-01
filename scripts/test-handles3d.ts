/**
 * test-handles3d.ts — asserts for src/lib/handles3d/math.ts, the pure maths the
 * 3D Push/Pull tool uses to turn a pointer into a distance along an axis:
 * rayAxisParam (the point on an axis nearest a ray, null when the ray is nearly
 * parallel to it), isClick (a press and release that is a click, not a drag) and
 * screenFallbackDistance (metres from pixels, for when the ray is too parallel).
 * Run: npx tsx scripts/test-handles3d.ts (throws on the first failure).
 */
import assert from "node:assert/strict";
import {
  isClick,
  PARALLEL_DEG,
  pullDistance,
  rayAxisParam,
  screenFallbackDistance,
  startPull,
  type CameraInfo,
  type Ray,
} from "../src/lib/handles3d/math";

const close = (a: number, b: number, eps: number, msg: string) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const Y = { x: 0, y: 1, z: 0 };
const O = { x: 0, y: 0, z: 0 };
const ray = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): Ray => ({ origin: { x: ox, y: oy, z: oz }, direction: { x: dx, y: dy, z: dz } });

// --- isClick: under 5 px of movement AND under 500 ms. Written first, before the function.
const at = (x: number, y: number, t: number) => ({ x, y, t });
assert.equal(isClick(at(100, 100, 0), at(100, 100, 0)), true, "no movement, no time: a click");
assert.equal(isClick(at(100, 100, 0), at(103, 100, 120)), true, "3 px and 120 ms: a click");
assert.equal(isClick(at(100, 100, 0), at(102, 103, 300)), true, "diagonal 3.6 px: a click");
assert.equal(isClick(at(100, 100, 0), at(100, 104.9, 499)), true, "just under both limits: a click");
assert.equal(isClick(at(100, 100, 0), at(100, 105, 100)), false, "exactly 5 px is not under 5 px");
assert.equal(isClick(at(100, 100, 0), at(103, 104, 100)), false, "diagonal 5 px (3,4) is not a click");
assert.equal(isClick(at(100, 100, 0), at(130, 100, 100)), false, "30 px: a drag");
assert.equal(isClick(at(100, 100, 0), at(100, 100, 500)), false, "exactly 500 ms is not under 500 ms");
assert.equal(isClick(at(100, 100, 0), at(101, 100, 900)), false, "a long press: not a click");
assert.equal(isClick(at(100, 100, 1000), at(100, 100, 1300)), true, "time is a difference, not an absolute");
assert.equal(isClick(at(100, 100, 0), at(96, 100, 100)), true, "movement left counts the same as right");
assert.equal(isClick(at(100, 100, 50), at(100, 100, 40)), false, "a release before the press (clock went backwards) is not a click");

// --- rayAxisParam: exact answers for known rays and a vertical axis through the origin
assert.equal(rayAxisParam(ray(10, 2, 0, -1, 0, 0), O, Y), 2, "a horizontal ray crossing the axis at height 2");
close(rayAxisParam(ray(10, 2, 5, -1, 0, 0), O, Y)!, 2, 1e-12, "a skew ray 5 m off the axis: the nearest point is still at height 2");
close(rayAxisParam(ray(0, 3, 10, 0, 0, -7), O, Y)!, 3, 1e-12, "direction need not be unit length");
close(rayAxisParam(ray(10, 10, 0, -1, -1, 0), O, Y)!, 0, 1e-12, "a 45° ray crossing at the origin");
close(rayAxisParam(ray(6, 8, 0, -6, -4, 0), O, Y)!, 4, 1e-12, "a sloped ray: crosses x = 0 at height 4");
close(rayAxisParam(ray(6, 8, 0, -6, 4, 0), O, Y)!, 12, 1e-12, "a rising ray: crosses at height 12");
close(rayAxisParam(ray(10, -2, 0, -1, 0, 0), O, Y)!, -2, 1e-12, "negative t is below the axis origin");
// an axis that does not start at the origin and is not vertical
close(rayAxisParam(ray(0, 5, 0, 0, -1, 0), { x: 2, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })!, -2, 1e-12, "axis along +x through (2,0,0): a ray straight down at x = 0 is t = -2");
close(rayAxisParam(ray(5, 5, 0, 0, -1, 0), { x: 2, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })!, 3, 1e-12, "and straight down at x = 5 it is t = 3");
close(rayAxisParam(ray(10, 2, 0, -1, 0, 0), O, { x: 0, y: -4, z: 0 })!, -2, 1e-12, "axis direction is normalised and may point down");

// --- the near-parallel threshold: 8 degrees, either way round
const tilted = (deg: number, flip = 1) => ray(3, 0, 0, Math.sin((deg * Math.PI) / 180), flip * Math.cos((deg * Math.PI) / 180), 0);
assert.equal(PARALLEL_DEG, 8);
assert.equal(rayAxisParam(tilted(7.9), O, Y), null, "7.9° off the axis is nearly parallel");
assert.notEqual(rayAxisParam(tilted(8.1), O, Y), null, "8.1° is not");
assert.equal(rayAxisParam(tilted(7.9, -1), O, Y), null, "pointing the other way along the axis counts too");
assert.notEqual(rayAxisParam(tilted(8.1, -1), O, Y), null);
assert.equal(rayAxisParam(ray(1, 5, 0, 0, 1, 0), O, Y), null, "exactly parallel");
assert.equal(rayAxisParam(ray(1, 5, 0, 0, -1, 0), O, Y), null, "exactly anti-parallel");

// --- screenFallbackDistance: metres per pixel at the anchor's depth times the upward pointer movement
const cam = (elevDeg: number, L: number, fov = 45): CameraInfo => {
  const e = (elevDeg * Math.PI) / 180;
  return { position: { x: 0, y: L * Math.sin(e), z: L * Math.cos(e) }, forward: { x: 0, y: -Math.sin(e), z: -Math.cos(e) }, fovDeg: fov };
};
{
  const c = cam(0, 10); // level camera 10 m away, 45° vertical fov, 900 px tall viewport
  const mpp = (2 * 10 * Math.tan((45 / 2) * (Math.PI / 180))) / 900;
  close(screenFallbackDistance({ x: 0, y: -90 }, c, O, 900), 90 * mpp, 1e-12, "90 px up: 90 × metres per pixel");
  close(screenFallbackDistance({ x: 0, y: 90 }, c, O, 900), -90 * mpp, 1e-12, "down is negative");
  close(screenFallbackDistance({ x: 500, y: 0 }, c, O, 900), 0, 1e-12, "sideways movement is nothing");
  close(screenFallbackDistance({ x: 0, y: -90 }, cam(0, 20), O, 900), 2 * 90 * mpp, 1e-12, "twice as far away: twice the metres per pixel");
}

// --- the fallback against the ray method. For a vertical axis and a camera whose ray to the anchor is ψ
// below the horizontal, the ray method's answer is the fallback's divided by cos ψ (derived in math.ts).
// They agree to 5% only while ψ is under about 18°; at the 8° threshold (ψ = 82°) they are about 7 times apart.
// That is why the method is fixed when a face is grabbed, never switched mid-pull.
/** The ray through a pixel `dyUpPx` above the screen centre, for a pinhole camera looking along `c.forward` (in the y-z plane). */
const throughPixel = (c: CameraInfo, dyUpPx: number, H: number): Ray => {
  const f = c.forward;
  const e = Math.asin(-f.y); // the camera's elevation above the horizontal
  const up = { y: Math.cos(e), z: -Math.sin(e) }; // perpendicular to forward, pointing up the screen
  const k = ((2 * dyUpPx) / H) * Math.tan((c.fovDeg * Math.PI) / 360);
  return { origin: c.position, direction: { x: 0, y: f.y + k * up.y, z: f.z + k * up.z } };
};
for (const [elev, within] of [[0.0001, 0.001], [10, 0.02], [15, 0.04]] as const) {
  const c = cam(elev, 12);
  const dy = 1; // a 1 px pointer movement upward
  const exact = rayAxisParam(throughPixel(c, dy, 900), O, Y)! - rayAxisParam(throughPixel(c, 0, 900), O, Y)!;
  const fallback = screenFallbackDistance({ x: 0, y: -dy }, c, O, 900);
  close(exact / fallback, 1, within, `camera ${elev}° above the horizon: the two methods agree (${(exact / fallback).toFixed(4)})`);
}
for (const elev of [30, 60, 81.5]) {
  const c = cam(elev, 12);
  const exact = rayAxisParam(throughPixel(c, 0.2, 900), O, Y)! - rayAxisParam(throughPixel(c, 0, 900), O, Y)!;
  const fallback = screenFallbackDistance({ x: 0, y: -0.2 }, c, O, 900);
  const expected = 1 / Math.cos((elev * Math.PI) / 180);
  close(exact / fallback, expected, expected * 0.03, `camera ${elev}° up: exact / fallback = 1 / cos ψ = ${expected.toFixed(2)}`);
}

// --- startPull / pullDistance: measured from the grab, so the face does not jump
{
  const c = cam(0, 12); // level camera 12 m from the axis, at height 0
  const anchor = { x: 0, y: 2.7, z: 0 };
  /** The ray from the camera that crosses the axis at height `h`. */
  const crossing = (h: number): Ray => ({ origin: c.position, direction: { x: 0, y: h / 12, z: -1 } });
  const grab = startPull(crossing(2.7), anchor, Y, { x: 700, y: 300 });
  assert.notEqual(grab.startT, null, "a level camera uses the ray method");
  close(pullDistance(grab, crossing(2.7), { x: 700, y: 300 }, c, 900)!, 0, 1e-12, "no pointer movement is no distance, however far from the face's centre the grab was");
  close(pullDistance(grab, crossing(2.7 + 0.35), { x: 700, y: 280 }, c, 900)!, 0.35, 1e-9, "ray crosses the axis 0.35 m higher: +0.35");
  close(pullDistance(grab, crossing(2.7 - 0.5), { x: 700, y: 330 }, c, 900)!, -0.5, 1e-9, "0.5 m lower: -0.5");
  // grabbed at a point NOT on the face's anchor height: the distance is still measured from the grab
  const offset = startPull(crossing(1.2), anchor, Y, { x: 700, y: 400 });
  close(pullDistance(offset, crossing(1.2 + 0.35), { x: 700, y: 380 }, c, 900)!, 0.35, 1e-9, "a grab 1.5 m below the anchor still starts at 0");
}
{
  // looking nearly straight down (7° off the axis): the ray method refuses, the grab uses pixels for the whole pull
  const c = cam(83, 12);
  const anchor = { x: 0, y: 2.7, z: 0 };
  const grab = startPull({ origin: c.position, direction: { x: 0, y: -Math.cos((7 * Math.PI) / 180), z: -Math.sin((7 * Math.PI) / 180) } }, anchor, Y, { x: 700, y: 300 });
  assert.equal(grab.startT, null, "a ray 7° off the axis at the grab chooses the screen fallback");
  const d = pullDistance(grab, { origin: c.position, direction: { x: 0, y: -1, z: 0 } }, { x: 700, y: 220 }, c, 900);
  close(d!, screenFallbackDistance({ x: 0, y: -80 }, c, anchor, 900), 1e-12, "and the distance is the fallback's: 80 px up");
  assert.ok(d! > 0, "up the screen is positive");
}

console.log("OK");
