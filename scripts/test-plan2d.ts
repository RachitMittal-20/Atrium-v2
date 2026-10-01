/**
 * test-plan2d.ts — asserts for src/lib/plan2d/{view,openings}.ts: the camera
 * maths (round trip, zoom about the cursor, clamping, fit, scale bar) and the
 * opening frame and door swing on a horizontal and a vertical wall.
 * Run: npx tsx scripts/test-plan2d.ts (throws on the first failure).
 */
import assert from "node:assert/strict";
import { doorSwing, openingFrame } from "../src/lib/plan2d/openings";
import { fitView, niceScaleBar, screenToWorld, worldToScreen, zoomAt, type View } from "../src/lib/plan2d/view";

const close = (a: number, b: number, eps: number, msg: string) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

// --- worldToScreen / screenToWorld round trip; y is not flipped
{
  const v: View = { scale: 37.5, tx: 120, ty: -40 };
  const p = { x: 3.2, y: 7.9 };
  const back = screenToWorld(v, worldToScreen(v, p));
  close(back.x, p.x, 1e-9, "round trip x");
  close(back.y, p.y, 1e-9, "round trip y");
  assert.ok(worldToScreen(v, { x: 0, y: 1 }).y > worldToScreen(v, { x: 0, y: 0 }).y, "plan y points down the screen");
}

// --- zoomAt keeps the world point under the cursor, and clamps at 5 and 500
{
  const v: View = { scale: 40, tx: 100, ty: 60 };
  const cursor = { x: 333, y: 217 };
  const world = screenToWorld(v, cursor);
  for (const f of [1.25, 0.8, 3, 0.1]) {
    const z = zoomAt(v, cursor, f);
    const s = worldToScreen(z, world);
    close(s.x, cursor.x, 0.01, `zoom x${f}`);
    close(s.y, cursor.y, 0.01, `zoom x${f}`);
  }
  const big = zoomAt(v, cursor, 1000);
  assert.equal(big.scale, 500, "clamped at 500");
  const small = zoomAt(v, cursor, 0.0001);
  assert.equal(small.scale, 5, "clamped at 5");
  for (const z of [big, small]) {
    const s = worldToScreen(z, world);
    close(s.x, cursor.x, 0.01, "clamped zoom keeps the point");
    close(s.y, cursor.y, 0.01, "clamped zoom keeps the point");
  }
}

// --- fitView: the whole bounds inside the viewport with at least the padding
{
  const bounds = { x0: -0.1, y0: -0.1, x1: 10.1, y1: 8.1 }; // the sample plan with wall thickness
  for (const [width, height] of [[390, 600], [1200, 800], [1600, 300]]) {
    for (const padding of [0.1, 0.05]) {
      const v = fitView(bounds, { width, height }, padding);
      const tl = worldToScreen(v, { x: bounds.x0, y: bounds.y0 });
      const br = worldToScreen(v, { x: bounds.x1, y: bounds.y1 });
      const tag = `${width}x${height} pad ${padding}`;
      assert.ok(tl.x >= padding * width - 1e-6 && tl.y >= padding * height - 1e-6, `${tag}: top left inside`);
      assert.ok(br.x <= width * (1 - padding) + 1e-6 && br.y <= height * (1 - padding) + 1e-6, `${tag}: bottom right inside`);
      // centred, and touching the padding on the limiting axis
      close(tl.x + br.x, width, 1e-6, `${tag}: centred x`);
      close(tl.y + br.y, height, 1e-6, `${tag}: centred y`);
    }
  }
  const tiny = fitView({ x0: 1, y0: 1, x1: 1, y1: 1 }, { width: 400, height: 300 });
  assert.ok(Number.isFinite(tiny.scale) && tiny.scale <= 500, "a degenerate box does not blow up");
}

// --- niceScaleBar: 60-140 px at every scale from 5 to 500, sampled finely
{
  for (let scale = 5; scale <= 500; scale *= 1.01) {
    const px = niceScaleBar(scale) * scale;
    assert.ok(px >= 60 && px <= 140, `scale ${scale.toFixed(2)}: bar is ${px.toFixed(1)} px`);
  }
  assert.equal(niceScaleBar(40), 2, "40 px/m → 2 m");
}

// --- openingFrame and doorSwing
const len = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);
const walls = {
  horizontal: { a: { x: 1, y: 2 }, b: { x: 6, y: 2 } }, // east
  vertical: { a: { x: 3, y: 8 }, b: { x: 3, y: 3 } }, // north, so a→b is not the positive axis
};
for (const [name, wall] of Object.entries(walls)) {
  const op = { offset: 2, width: 0.9 };
  const f = openingFrame(wall, op);
  const dir = { x: Math.sign(wall.b.x - wall.a.x), y: Math.sign(wall.b.y - wall.a.y) };
  close(len(f.start, f.end), 0.9, 1e-9, `${name}: gap width`);
  close(len(wall.a, f.centre), 2, 1e-9, `${name}: centre is offset from a`);
  close((f.start.x - wall.a.x) * dir.x + (f.start.y - wall.a.y) * dir.y, 2 - 0.45, 1e-9, `${name}: start is the end nearer a`);
  close(f.dir.x * dir.x + f.dir.y * dir.y, 1, 1e-9, `${name}: dir runs a→b`);
  close(f.normal.x * f.dir.x + f.normal.y * f.dir.y, 0, 1e-9, `${name}: normal ⟂ dir`);
  close(f.normal.x * -f.dir.y + f.normal.y * f.dir.x, 1, 1e-9, `${name}: normal is the left of a→b`);

  const sw = doorSwing(wall, op);
  assert.deepEqual(sw.hinge, f.start, `${name}: hinge at the end nearer a`);
  close(len(sw.hinge, sw.leafEnd), 0.9, 1e-9, `${name}: leaf length = width`);
  close(len(sw.hinge, sw.arcEnd), 0.9, 1e-9, `${name}: arc radius = width`);
  const l = { x: sw.leafEnd.x - sw.hinge.x, y: sw.leafEnd.y - sw.hinge.y };
  const a = { x: sw.arcEnd.x - sw.hinge.x, y: sw.arcEnd.y - sw.hinge.y };
  close(l.x * a.x + l.y * a.y, 0, 1e-9, `${name}: arc end is 90° from the leaf`);
  close(l.x * f.normal.x + l.y * f.normal.y, 0.9, 1e-9, `${name}: leaf swings to the normal's positive side`);
}

console.log("test-plan2d: ok");
