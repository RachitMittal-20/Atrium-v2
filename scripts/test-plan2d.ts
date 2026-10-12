/**
 * test-plan2d.ts — asserts for src/lib/plan2d/{view,openings}.ts: the camera
 * maths (round trip, zoom about the cursor, clamping, fit, scale bar) and the
 * opening frame and door swing on a horizontal and a vertical wall, and (step M.1d)
 * the hinge jamb: all four hinge × swing states of one hand-checked door, derived
 * both in 2D (doorSwing) and in 3D (doorLeaf3d, the leaf's pivot and turn), checked
 * against each other.
 * Run: npx tsx scripts/test-plan2d.ts (throws on the first failure).
 */
import assert from "node:assert/strict";
import { doorLeaf3d, LEAF_OPEN } from "../src/lib/plan/meshBuilders";
import { doorSides, doorSwing, openingFrame } from "../src/lib/plan2d/openings";
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

// --- step M.1d: the hinge jamb, in 2D and in 3D, for all four states of one hand-checked door
// FAILING FIRST (the 3D half): before M.1d the leaf always pivoted on the a jamb and its turn
// read the swing alone, so hinge "b" put the 3D leaf on the wrong jamb and turned it the wrong way.
//
// By hand. A wall from a(1, 2) to b(6, 2): a→b is (1, 0), its normal (the left of a→b, (-dy, dx))
// is (0, 1), which is SOUTH on the page because plan y points down. A 0.9 m door centred 2 m
// along it has its jambs at x = 1 + 1.55 = 2.55 (nearer a) and x = 1 + 2.45 = 3.45 (nearer b).
// So: hinge "a" pivots at (2.55, 2) and hinge "b" at (3.45, 2); swing "left" puts the leaf's tip
// 0.9 m SOUTH of the pivot, swing "right" 0.9 m NORTH of it. In the 3D mesh's local frame
// (+x along a→b, +z the same left normal) the pivot's local x is −0.4 for "a" and +0.4 for "b"
// (half the width less the 0.05 m frame member), and the leaf's tip must land on the same side.
{
  const wall = { a: { x: 1, y: 2 }, b: { x: 6, y: 2 } };
  const FRAME = 0.05;
  const base = { offset: 2, width: 0.9 };
  const WANT = {
    "a/left": { hinge: { x: 2.55, y: 2 }, tip: { x: 2.55, y: 2.9 }, pivotX: -0.4 },
    "a/right": { hinge: { x: 2.55, y: 2 }, tip: { x: 2.55, y: 1.1 }, pivotX: -0.4 },
    "b/left": { hinge: { x: 3.45, y: 2 }, tip: { x: 3.45, y: 2.9 }, pivotX: 0.4 },
    "b/right": { hinge: { x: 3.45, y: 2 }, tip: { x: 3.45, y: 1.1 }, pivotX: 0.4 },
  } as const;
  for (const hinge of ["a", "b"] as const)
    for (const swing of ["left", "right"] as const) {
      const key = `${hinge}/${swing}` as keyof typeof WANT;
      const want = WANT[key];
      const op = { ...base, swing, hinge };
      // 2D: the hinge is the named jamb and the leaf reaches the swing side.
      const sw = doorSwing(wall, op);
      close(len(sw.hinge, want.hinge), 0, 1e-9, `${key}: 2D hinge at the named jamb`);
      close(len(sw.leafEnd, want.tip), 0, 1e-9, `${key}: 2D leaf tip on the swing side`);
      close(len(sw.arcEnd, hinge === "a" ? { x: 3.45, y: 2 } : { x: 2.55, y: 2 }), 0, 1e-9, `${key}: 2D arc closes on the OTHER jamb`);
      // 3D: the same jamb, and the leaf's tip on the same side of the wall.
      const leaf = doorLeaf3d(op, FRAME);
      close(leaf.pivotX, want.pivotX, 1e-9, `${key}: 3D pivot x is the hinge jamb`);
      close(leaf.length, 0.8, 1e-9, `${key}: 3D leaf length is the width less both frame members`);
      assert.equal(Math.sign(leaf.boxX), hinge === "a" ? 1 : -1, `${key}: the closed leaf reaches the far jamb`);
      close(Math.abs(leaf.turn), LEAF_OPEN, 1e-9, `${key}: it stands LEAF_OPEN open`);
      // The tip in local coordinates: rotateY(turn) maps local +x to (cos, 0, -sin).
      const [c, s] = [Math.cos(leaf.turn), Math.sin(leaf.turn)];
      const tip = { x: leaf.pivotX + 2 * leaf.boxX * c, z: -2 * leaf.boxX * s };
      assert.equal(Math.sign(tip.z), swing === "left" ? 1 : -1, `${key}: the 3D tip is on the swing side (local +z is the left normal)`);
      // Still leaning towards the far jamb (it is only LEAF_OPEN open, not the 2D drawing's 90°).
      assert.equal(Math.sign(tip.x - leaf.pivotX), Math.sign(leaf.boxX), `${key}: the 3D leaf leans towards the far jamb`);
      // The side the 2D plan draws the leaf on, measured against the wall's normal, is the same sign.
      const f = openingFrame(wall, op);
      const side2d = Math.sign((sw.leafEnd.x - sw.hinge.x) * f.normal.x + (sw.leafEnd.y - sw.hinge.y) * f.normal.y);
      assert.equal(Math.sign(tip.z), side2d, `${key}: 2D and 3D put the leaf on the same side of the wall`);
      // doorSides is the one reading both of them share.
      assert.deepEqual(doorSides(op), { atA: hinge === "a", side: swing === "left" ? 1 : -1 }, `${key}: doorSides`);
    }
  // A door with no hinge stored behaves exactly as hinge "a" did before M.1d.
  const old = doorSwing(wall, { ...base, swing: "left" });
  assert.deepEqual(old, doorSwing(wall, { ...base, swing: "left", hinge: "a" }), "no hinge stored draws as hinge a (older plans unchanged)");
  assert.deepEqual(doorLeaf3d({ ...base, swing: "left" }, 0.05), doorLeaf3d({ ...base, swing: "left", hinge: "a" }, 0.05), "and so does the 3D leaf");
  console.log("test-plan2d: the hinge jamb in 2D and 3D, all four hinge × swing states of a hand-checked door, and no hinge = hinge a");
}

console.log("test-plan2d: ok");
