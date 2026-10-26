/**
 * test-pdf-q5.ts — step Q.5: two drawing conventions in the PDF reader's openings (src/lib/pdf/openings.ts),
 * each proven failing-first on its own SYNTHETIC fixture (scripts/make-pdf-fixtures.ts). No real plan
 * and no holdout file was read for this step.
 *
 *   1. plan-window-faces.pdf  a window drawn with both wall-face strokes carried straight across the gap
 *                             and two or three inner lines between them is a window: the face lines do
 *                             not count towards the 2-3 line limit. Only when every parallel line in the
 *                             gap runs jamb to jamb, so a sliding door drawn with track lines and panels
 *                             is never a window (it reads as unclassified, a door).
 *   2. plan-door-frame.pdf    a leaf drawn as a thin rectangle whose four sides are split across several
 *                             paths, set back from the arc's centre by a door-frame return (at most
 *                             120 mm), 80-100% of the radius long, the arc ending at its far corner, lying
 *                             inside the swept quarter. plan-door-return.pdf: a real 0.8 m return wall
 *                             at a door's hinge jamb, whose far corner is within 2% of the arc's end,
 *                             is kept: it lies outside the swing.
 *
 * FAILING FIRST (on the code before each fix; docs/HANDOFF.md §46 has the output):
 *   1. every "faces4" window read as unclassified (four full-gap lines);
 *   2. every framed leaf not found ("no leaf"), so the doors unclassified, and the leaves paired into walls.
 * Q5_ONLY=1 or 2 runs one section.
 * Run: npx tsx scripts/test-pdf-q5.ts
 */
import assert from "node:assert/strict";
import { classifyOpening, findArcs, type Seg, type Span } from "../src/lib/pdf/openings";
import { planVerdict, verdictText } from "../src/lib/pdf/verdict";
import { build, exactOpenings, exactWalls, sameWall, truth, vectorFrame } from "./test-pdf-conventions";

const only = process.env.Q5_ONLY;
const run = (n: string) => !only || only === n;

// ------------------------------------------------------------------ synthetic pieces, page metres
let path = 0;
const seg = (x1: number, y1: number, x2: number, y2: number, p = path++): Seg => ({ x1, y1, x2, y2, path: p });
/** An open polyline as ONE path. */
const polyline = (pts: [number, number][]): Seg[] => {
  const p = path++;
  return pts.slice(1).map((q, i) => seg(pts[i][0], pts[i][1], q[0], q[1], p));
};
/** A quarter arc about c from angle a0 through `sweep` (radians), r, as 16 straight pieces in one path. */
const polyArc = (c: [number, number], r: number, a0: number, sweep: number): Seg[] =>
  polyline(Array.from({ length: 17 }, (_, i) => [c[0] + r * Math.cos(a0 + (sweep * i) / 16), c[1] + r * Math.sin(a0 + (sweep * i) / 16)] as [number, number]));
/** A rectangle x0..x1 × y0..y1 drawn as three paths: near end + one long side, far end, other long side. */
const threePaths = (x0: number, x1: number, y0: number, y1: number): Seg[] => [...polyline([[x1, y0], [x0, y0], [x0, y1]]), seg(x0, y1, x1, y1), seg(x1, y1, x1, y0)];

function windowsSynthetic() {
  // A 1.2 m gap in a 0.2 m wall on y = 0.
  const sp: Span = { axis: "h", c: 0, t: 0.2, s0: 0, s1: 1.2 };
  const across = (...vs: number[]) => vs.map((v) => seg(0, v, 1.2, v));
  const classOf = (lines: Seg[]) => classifyOpening(sp, lines, [], new Set()).class;
  assert.equal(classOf(across(-0.1, 0.1, -0.1 / 3, 0.1 / 3)), "window", "both faces carried across and two inner lines: a window");
  assert.equal(classOf(across(-0.1, 0.1, -0.05, 0, 0.05)), "window", "both faces and three inner lines: a window");
  assert.equal(classOf(across(-0.1, 0.1, 0)), "window", "both faces and one glass line: a window, as before (three lines)");
  assert.equal(classOf(across(-0.06, 0.06)), "window", "two glazing lines in a real gap: a window, as before");
  assert.equal(classOf(across(-0.1, 0.1, -0.075, -0.025, 0.025, 0.075)), "unclassified", "both faces and FOUR inner lines: not a window");
  assert.equal(classOf(across(-0.1, -0.1 / 3, 0.1 / 3, 0.07)), "unclassified", "one face and three inner lines: four lines, no rule fits");
  // The sliding door with track lines: the same faces and two tracks, and two staggered panels of 55%.
  const panels = [seg(0, -0.06, 0.66, -0.06), seg(0, -0.02, 0.66, -0.02), seg(0.54, 0.02, 1.2, 0.02), seg(0.54, 0.06, 1.2, 0.06)];
  assert.equal(classOf([...across(-0.1, 0.1, -0.04, 0.04), ...panels]), "unclassified", "faces, two tracks and staggered panels: never a window");
  console.log("1. synthetic: faces + 2 or 3 inner lines a window; faces + 1 (three lines) and 2 glazing lines as before; 4 inner lines, or tracks with panels, not a window");
}

async function windows() {
  const t = truth("plan-window-faces.pdf");
  const r = await build(t.file);
  const vw = r.pdf.vectorWalls!;
  const ops = vectorFrame(vw).openings;
  console.log(`   read: ${vw.openings.map((o) => `${o.kind}/${o.class}`).join(", ")}`);
  assert.deepEqual(exactOpenings(t.file, ops), [], "every opening read exactly, with its class (the sliding door with tracks unclassified)");
  const sliding = t.planOpenings.find((o) => o.id === "sl-living")!;
  const read = ops.find((o) => Math.hypot(o.a.x - sliding.a.x, o.a.y - sliding.a.y) < 5e-4 || Math.hypot(o.b.x - sliding.a.x, o.b.y - sliding.a.y) < 5e-4)!;
  assert.ok(read.kind === "door" && read.class === "unclassified", "the sliding door with track lines is a door, unclassified, never a window");
  exactWalls(t.file, r.b);
  const v = planVerdict(r.b.plan, r.b.coverage);
  assert.equal(v.level, "good", verdictText(v));
  const c = r.b.coverage.openings;
  console.log(`1. plan-window-faces: ${t.planOpenings.filter((o) => o.kind === "window").length} windows with face strokes read as windows; the sliding door with tracks ${read.kind}/${read.class}; ${r.b.coverage.exact} walls and ${c.exact} openings exact; ${verdictText(v)}`);
}

function leavesSynthetic() {
  // A 0.9 m door hinged at (0, 0) on a wall along y = 0, opening towards +y: the arc from the open leaf's
  // tip (0, 0.9) to the strike jamb (0.9, 0). Its centre and radius are exact.
  const arc = () => polyArc([0, 0], 0.9, Math.PI / 2, -Math.PI / 2);
  const leafOf = (extra: Seg[]) => {
    const segs = [...arc(), ...extra];
    const a = findArcs(segs)[0];
    return { why: a.why, leaf: a.leaf.map((i) => segs[i]) };
  };
  // The framed leaf: 60 mm thick, set back 75 mm, its far corner on the arc's end, towards the strike.
  const framed = threePaths(0, 0.06, 0.075, 0.9);
  let got = leafOf(framed);
  assert.ok(got.why === null && got.leaf.length === 4 && got.leaf.every((s) => framed.includes(s)), `a framed leaf in three paths is the leaf (${got.why})`);
  // Set back 120 mm (the limit) and 130 mm (over it); 80% and 75% of the radius long.
  assert.equal(leafOf(threePaths(0, 0.06, 0.12, 0.9)).why, null, "set back 120 mm: the leaf");
  assert.match(leafOf(threePaths(0, 0.06, 0.13, 0.9)).why ?? "", /no leaf/, "set back 130 mm: no leaf");
  // The length bound bites only on a small door (r under 0.6 m): with r 0.55 m, set back 110 mm leaves
  // 0.44 m (80%), 115 mm 0.435 m (79%), both within the frame's 120 mm.
  const small = (back: number) => {
    const segs = [...polyArc([0, 0], 0.55, Math.PI / 2, -Math.PI / 2), ...threePaths(0, 0.04, back, 0.55)];
    return findArcs(segs)[0].why;
  };
  assert.equal(small(0.11), null, "r 0.55 m, 0.44 m long (80%): the leaf");
  assert.match(small(0.115) ?? "", /no leaf/, "r 0.55 m, 0.435 m long (79%): no leaf");
}

/** Section 2's synthetic checks after the length check above is settled (kept apart so the failing-first output is clear). */
function leavesGuards() {
  const arc = () => polyArc([0, 0], 0.9, Math.PI / 2, -Math.PI / 2);
  const leafOf = (extra: Seg[]) => {
    const segs = [...arc(), ...extra];
    return findArcs(segs)[0];
  };
  // The same rectangle mirrored to the far side of the radial line: outside the swing, so never the leaf.
  assert.match(leafOf(threePaths(-0.06, 0, 0.075, 0.9)).why ?? "", /no leaf/, "a rectangle outside the swept quarter is not the leaf");
  // A real return wall flush with the hinge jamb (100 mm thick, from the face 0.1 m to 0.9 m, 10 mm off):
  // its far corner is 10 mm from the arc's end, within the 2% (18 mm), but it stands outside the swing.
  assert.match(leafOf(threePaths(-0.11, -0.01, 0.1, 0.9)).why ?? "", /no leaf/, "a return wall beside the hinge jamb is not the leaf");
  // The far corner off the arc's end (30 mm short), or a side not closed: not the leaf.
  assert.match(leafOf(threePaths(0, 0.06, 0.075, 0.87)).why ?? "", /no leaf/, "far corner 30 mm short of the arc's end: no leaf");
  const open = threePaths(0, 0.06, 0.075, 0.9).slice(0, 3); // the other long side missing
  assert.match(leafOf(open).why ?? "", /no leaf/, "three sides only: no leaf");
  // A rectangle with no arc is never a door: the gap stays unclassified.
  const sp: Span = { axis: "h", c: 0, t: 0.2, s0: 0, s1: 0.9 };
  const rect = threePaths(0, 0.06, 0.075, 0.9);
  assert.equal(findArcs(rect).length, 0, "a rectangle alone has no arc");
  assert.equal(classifyOpening(sp, rect, findArcs(rect), new Set()).class, "unclassified", "and its gap stays unclassified");
  console.log("2. synthetic: framed three-path leaves found (set back up to 120 mm, 80-100% long, far corner on the arc); outside the swing, a return wall, a short leaf, an open rectangle: no leaf; no arc: unclassified");
}

async function doorFrame() {
  for (const file of ["plan-door-frame.pdf", "plan-door-return.pdf"]) {
    const t = truth(file);
    const r = await build(t.file);
    const vw = r.pdf.vectorWalls!;
    console.log(`   ${file}: ${vw.openings.map((o) => `${o.kind}/${o.class}${o.hingeEnd ? `@${o.hingeEnd}` : ""}`).join(", ")}; arcs ${vw.arcs?.used}/${vw.arcs?.found} used (${vw.arcs?.notUsed.map((a) => a.why).join("; ") || "none unused"}); ${vw.walls.length} walls`);
    assert.deepEqual(exactOpenings(t.file, vectorFrame(vw).openings), [], `${file}: every opening read exactly, with its hinge jamb and side`);
    assert.equal(vw.arcs?.notUsed.length, 0, `${file}: every swing arc used`);
    const v = planVerdict(r.b.plan, r.b.coverage);
    assert.equal(v.level, "good", verdictText(v));
    if (file === "plan-door-return.pdf") {
      // The PDF's reading has every true wall, the return wall included, within 0.5 mm: it is never taken for a leaf.
      const read = vectorFrame(vw).walls;
      assert.deepEqual(t.planWalls.filter((tw) => !read.some((w) => sameWall(w, [tw]))).map((w) => w.id), [], `${file}: every true wall read from the PDF`);
      assert.equal(read.length, t.planWalls.length, `${file}: and nothing else`);
      // Built, the return wall's free end makes the merge keep its traced copy, as plan-free-end's nib (M.1b's
      // validator rounds; step Q.2's rule 8b ties): kept, within a few raster pixels, every other wall exact.
      const ret = r.b.plan.walls.filter((w) => Math.abs(w.a.x - 6.49) < 0.01 && Math.abs(w.b.x - 6.49) < 0.01 && Math.abs(w.b.y - w.a.y) > 0.8);
      assert.equal(ret.length, 1, `${file}: the 0.8 m return wall is built`);
      assert.ok(r.b.coverage.exact >= t.planWalls.length - 1 && r.b.coverage.exact + r.b.coverage.traced === r.b.plan.walls.length, `${file}: every wall but at most the return exact (${r.b.coverage.exact} of ${r.b.plan.walls.length})`);
      console.log(`2. plan-door-return: the return wall read from the PDF within 0.5 mm and built (${ret[0].provenance}, ${Math.abs(ret[0].b.y - ret[0].a.y).toFixed(3)} m centre line, ${ret[0].thickness} m), the framed front door beside it read; ${verdictText(v)}`);
    } else {
      exactWalls(t.file, r.b);
      console.log(`2. plan-door-frame: 4 framed doors (hinged at both ends, both sides) read exactly, ${r.b.coverage.exact} walls exact; ${verdictText(v)}`);
    }
  }
}

async function main() {
  if (run("1")) {
    windowsSynthetic();
    await windows();
  }
  if (run("2")) {
    leavesSynthetic();
    leavesGuards();
    await doorFrame();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
