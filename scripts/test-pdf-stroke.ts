/**
 * test-pdf-stroke.ts — step S.1: walls drawn as ONE thick stroked line, a common CAD export style.
 * The convention (walls.ts): a straight, solid, stroked segment whose width at the drawing's scale is
 * 50–600 mm is a wall's centre line, as thick as the stroke is wide; a thinner stroke stays annotation
 * or furniture. Every rule is proven on SYNTHETIC fixtures (scripts/make-pdf-fixtures.ts):
 *
 *   plan-single-stroke.pdf  the sample house, every wall one stroke on its centre line (230 mm exterior,
 *                           115 mm interior at 1:100), node to node with BUTT caps (a half-thickness
 *                           notch at every corner), broken at its openings; line-leaf doors in all four
 *                           hinge / side combinations, three-line windows, twelve thin stair treads
 *                           standing on the south wall, the furniture set and ticked mm dimensions.
 *   -round, -square         the same with round or projecting caps: the geometry is the centre line,
 *                           whatever the cap paints, so the reading is the same.
 *   -mixed                  the exterior walls as paired outlines drawn with a HEAVY 1.5 pt pen (53 mm at
 *                           1:100, inside the 50–600 mm band), the interior walls single strokes.
 *
 * FAILING FIRST (before walls.ts read strokes, measured with a one-off script, docs/HANDOFF.md §30; every cap alike):
 * plan-single-stroke read 0 of its 14 walls: 17 junk "walls" (stair treads paired into 0.44 m slabs,
 * furniture), 15 separate pieces, 27 free ends, no room, and the verdict "Not usable: the walls form
 * 15 separate pieces (the largest holds 28% of the wall length), 27 free wall ends, no closed room and
 * 4 openings the PDF draws were left out." The mixed page read its 9 outlined walls and none of the 5
 * strokes; the treads became 11 slabs joined to the south wall; one 75.9 m² "room"; Not usable.
 *
 * Checked on every variant: every wall within 0.5 mm of the truth and its thickness within 0.5 mm, all
 * from the PDF; every opening's kind, class, jambs, a door's hinge jamb and side; four rooms, named,
 * with areas within 1e-6 m² of the hand-computed inside faces; no wall in the stairs; verdict Good.
 * Then, on synthetic pages: L, T and X junctions; a stroke under 50 mm is no wall; two heavy-pen faces
 * are ONE wall, not two thin ones; the ends of a heavy-pen outline are not walls.
 * Run: npx tsx scripts/test-pdf-stroke.ts
 */
import assert from "node:assert/strict";
import { readVectorWalls } from "../src/lib/pdf/walls";
import { planVerdict, verdictText } from "../src/lib/pdf/verdict";
import { deriveRooms } from "../src/lib/plan/rooms";
import type { PdfSegment } from "../src/types/pdf";
import { build, exactOpenings, exactWalls, truth, vectorFrame } from "./test-pdf-conventions";

const FILES = ["plan-single-stroke.pdf", "plan-single-stroke-round.pdf", "plan-single-stroke-square.pdf", "plan-single-stroke-mixed.pdf"];

/** Net areas of the four rooms, from the inside faces (exterior 0.23 m, interior 0.115 m walls). */
const E = 0.115; // half an exterior wall
const I = 0.0575; // half an interior wall
const AREAS: Record<string, number> = {
  "Bedroom 1": (4 - I - E) * (4 - I - E),
  "Bedroom 2": (4 - I - E) * (4 - I - E),
  Bathroom: (3 - I - E) * (3 - I - E),
  // The L: x 4–10 by y 0–5, plus x 4–7 by y 5–8 (between two interior walls), each to its inside faces.
  "Living Room": (6 - I - E) * (5 - I - E) + (3 - 2 * I) * (3 - E + I),
};

async function fixture(file: string) {
  const t = truth(file);
  const r = await build(file);
  const vw = r.pdf.vectorWalls!;
  // The reading itself: openings exact, with hinge and side.
  assert.deepEqual(exactOpenings(file, vectorFrame(vw).openings), [], `${file}: every opening read exactly (kind, class, jambs, hinge, side)`);
  assert.equal(vw.openings.length, t.planOpenings.length, `${file}: no extra openings read`);
  // The build: every wall exact, all from the PDF.
  exactWalls(file, r.b);
  assert.equal(r.b.plan.openings.length, t.planOpenings.length, `${file}: every opening built (${r.b.coverage.notes.join(" | ")})`);
  assert.equal(r.b.coverage.openings.exact, t.planOpenings.length, `${file}: every opening from the PDF`);
  const rooms = deriveRooms(r.b.plan);
  assert.deepEqual(rooms.map((x) => x.name).sort(), Object.keys(AREAS).sort(), `${file}: the four rooms, named`);
  for (const x of rooms) assert.ok(Math.abs(x.area - AREAS[x.name]) <= 1e-6, `${file}: ${x.name} ${x.area} m², expected ${AREAS[x.name]}`);
  // exactWalls already holds every built wall to a true one, so the stairs, furniture and dimensions
  // built none; the stairs (x 4.3–6.72, y 6.885–7.885, plan frame) are not even read as a wall.
  const o = r.b.coverage.origin;
  const inStairs = (p: { x: number; y: number }) => p.x - o.x > 4.25 && p.x - o.x < 6.8 && p.y - o.y > 6.85 && p.y - o.y < 7.86;
  assert.ok(!vw.walls.some((w) => inStairs(w.a) || inStairs(w.b)), `${file}: no wall read in the stairs`);
  // Rule 7c: the treads pair into overlapping slabs joined to the south wall; dropped, and reported as one run.
  const treads = (vw.furniture ?? []).filter((f) => f.kind === "treads");
  assert.ok(treads.length === 1 && Math.abs(treads[0].box.x1 - treads[0].box.x0 - 2.42) <= 1e-3 && Math.abs(treads[0].box.y1 - treads[0].box.y0 - 1) <= 1e-3, `${file}: the stairs reported once as treads, 2.42 × 1 m (${JSON.stringify(treads)})`);
  const v = planVerdict(r.b.plan, r.b.coverage);
  assert.equal(v.level, "good", `${file}: ${verdictText(v)}`);
  console.log(`${file}: ${r.b.coverage.exact} of ${r.b.plan.walls.length} walls and ${r.b.coverage.openings.exact} of ${t.planOpenings.length} openings from the PDF; rooms ${rooms.map((x) => `${x.name} ${x.area.toFixed(4)} m²`).join(", ")}; ${verdictText(v)}`);
}

/** A stroked segment in points, `w` pt wide, for the synthetic pages (1 pt = 1 m here: mPerPt 1). */
let path = 0;
const stroke = (x1: number, y1: number, x2: number, y2: number, w: number): PdfSegment => ({ x1, y1, x2, y2, width: w, filled: false, path: path++, curve: false });
const read = (segments: PdfSegment[]) => readVectorWalls({ segments }, 1);
const ends = (ws: { a: { x: number; y: number }; b: { x: number; y: number }; thickness: number }[]) =>
  ws.map((w) => `(${w.a.x}, ${w.a.y})-(${w.b.x}, ${w.b.y}) ${w.thickness}`).sort();

function junctions() {
  // L: two strokes meeting at a corner node, butt caps (the geometry ends at the node).
  assert.deepEqual(ends(read([stroke(0, 0, 4, 0, 0.2), stroke(0, 0, 0, 3, 0.2)]).walls), ["(0, 0)-(0, 3) 0.2", "(0, 0)-(4, 0) 0.2"], "L: two walls meeting at the corner");
  // T: a stem ending on another wall's centre line splits it there.
  assert.deepEqual(ends(read([stroke(0, 0, 4, 0, 0.2), stroke(2, 0, 2, 3, 0.1)]).walls), ["(0, 0)-(2, 0) 0.2", "(2, 0)-(2, 3) 0.1", "(2, 0)-(4, 0) 0.2"], "T: the host split at the stem");
  // A stem drawn only to the host's FACE (a common export) moves to the centre line: the joint rule.
  assert.deepEqual(ends(read([stroke(0, 0, 4, 0, 0.2), stroke(2, 0.1, 2, 3, 0.1)]).walls), ["(0, 0)-(2, 0) 0.2", "(2, 0)-(2, 3) 0.1", "(2, 0)-(4, 0) 0.2"], "T to the face: the stem's end moves to the centre line");
  // X: two strokes crossing split each other.
  assert.deepEqual(ends(read([stroke(0, 2, 4, 2, 0.15), stroke(2, 0, 2, 4, 0.15)]).walls), ["(0, 2)-(2, 2) 0.15", "(2, 0)-(2, 2) 0.15", "(2, 2)-(2, 4) 0.15", "(2, 2)-(4, 2) 0.15"], "X: both walls split at the crossing");
  console.log("junctions: L, T (to the centre line and to the face) and X, as strokes");
}

function widths() {
  // Under 50 mm at scale: annotation, never a wall. 50 and 600 mm: walls; over 600 mm: not.
  for (const [w, n] of [[0.049, 0], [0.05, 1], [0.6, 1], [0.61, 0]] as const) assert.equal(read([stroke(0, 0, 3, 0, w)]).walls.length, n, `a ${w * 1000} mm stroke: ${n} wall`);
  // A dashed stroke (a centre or hidden line) is never a wall, however wide.
  assert.equal(read([{ ...stroke(0, 0, 3, 0, 0.2), dashed: true }]).walls.length, 0, "a dashed wide stroke: no wall");
  // Heavy pens: a wall's two faces drawn 53 mm wide, 0.23 m apart, are ONE 0.23 m wall, not two thin ones;
  // the outline's ends (across the wall, inside it) are not walls either.
  const heavy = read([stroke(0, 0, 4, 0, 0.053), stroke(0, 0.23, 4, 0.23, 0.053), stroke(0, 0, 0, 0.23, 0.053), stroke(4, 0, 4, 0.23, 0.053)]);
  assert.deepEqual(ends(heavy.walls), ["(0, 0.115)-(4, 0.115) 0.23"], "heavy pen: one wall between the two faces");
  console.log("widths: 49 mm no, 50 and 600 mm yes, 610 mm no, dashed no; heavy-pen faces pair as one wall");
}

async function main() {
  junctions();
  widths();
  for (const f of FILES) await fixture(f);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
