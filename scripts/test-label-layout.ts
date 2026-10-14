/**
 * test-label-layout.ts — step L.1: 2D labels never overprint (src/lib/plan2d/labelLayout.ts, the
 * inputs in src/lib/plan2d/labels.ts, the Labels setting in src/store/labelsStore.ts).
 *   - the sample plan's real labels (its four rooms' names and areas, a Length takeoff, three Wall
 *     takeoffs printing on the partition, eleven takeoffs carried from a PDF, one model's name and the
 *     scale bar) at five zoom levels, in Full and in Compact (the default while the drawing shows), on a
 *     desktop pane and a 358 px phone pane: no two placed rectangles intersect, the selected takeoff is
 *     always placed, and every label is placed, hidden or off screen, none lost;
 *   - priority: a high label takes its natural place before a low one is considered, so with room for
 *     three of four the LOWEST priority is the one hidden and the highest does not move, whatever order
 *     the labels arrive in;
 *   - never hidden: a selected takeoff, and the scale bar, stay (forced, overlapping) when nothing fits,
 *     while the labels below them go;
 *   - determinism: the same input gives the same output, shuffled input order the same output;
 *   - stability: a 3 px pan (any direction) changes no label's placement relative to its point or the hidden set;
 *   - a leader line only when a label moved by more than half its height, and then from its anchor;
 *   - the hidden count is reported (ids listed, and placed + hidden + offscreen = every label);
 *   - long values: a long label wraps at its colon onto two lines, a still-too-long line is shortened with
 *     an ellipsis, and the full text is kept for a tooltip; mm² values are in the label;
 *   - the Labels setting: Full, Compact and Off pick the kinds; with the drawing shown and no choice it is
 *     Compact, once chosen the choice stays; the store writes "atrium.labels", restores it, and falls back
 *     on garbled or blocked storage.
 * FAILING FIRST is in scripts/e2e-labels.ts --baseline: the same plan on the tree without this pass had
 * 11 overlapping pairs over the five zoom levels, read from the rendered SVG.
 * Run: npx tsx scripts/test-label-layout.ts
 */
import assert from "node:assert/strict";
import { samplePlan } from "../src/data/samplePlan";
import { layoutLabels, MAX_LINE_PX, PRIORITY, STEPS, wrapLabel, type Label, type LayoutResult, type Placed } from "../src/lib/plan2d/labelLayout";
import { buildLabels, controlObstacles, effectiveDetail, keepsLayout, PAN_KEEP_PX, resolveLabels, scaleBarObstacle, shows, toLayout, type LabelDetail, type LabelSources } from "../src/lib/plan2d/labels";
import { fitView, worldToScreen, zoomAt, type Bounds, type View } from "../src/lib/plan2d/view";
import { wallOutline } from "../src/lib/plan/geometry";
import { deriveRooms } from "../src/lib/plan/rooms";
import { niceScaleBarFor } from "../src/lib/units/format";
import { LABELS_KEY, restoreLabelSettings, useLabelsStore } from "../src/store/labelsStore";
import type { Takeoff } from "../src/types/plan";

// ---- a localStorage for Node (the labels store reads and writes window.localStorage)
const disk = new Map<string, string>();
let blocked = false;
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => {
      if (blocked) throw new Error("blocked");
      return disk.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (blocked) throw new Error("blocked");
      disk.set(k, v);
    },
  },
};

const rect = (p: Placed) => ({ x: p.x - p.width / 2, y: p.y - p.height / 2, w: p.width, h: p.height });
const overlap = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) => a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9;
const intersections = (r: LayoutResult) => {
  const fixed = (k: string) => k === "control" || k === "scalebar" || k === "live"; // obstacles may sit on each other; they never move
  const rs = r.placed.map((p) => ({ id: p.id, fixed: fixed(p.kind), ...rect(p) }));
  const out: string[] = [];
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) if (!(rs[i].fixed && rs[j].fixed) && overlap(rs[i], rs[j])) out.push(`${rs[i].id} ⟷ ${rs[j].id}`);
  return out;
};
const label = (id: string, kind: Label["kind"], x: number, y: number, w = 80, h = 16): Label => ({ id, kind, priority: PRIORITY[kind], anchor: { x, y }, width: w, height: h });
const BOUNDS = (w: number, h: number): Bounds => ({ x0: 0, y0: 0, x1: w, y1: h });

// ---- the sample plan's real labels
const rooms = deriveRooms(samplePlan);
const faces = (id: string) => wallOutline(samplePlan.walls.find((w) => w.id === id)!, samplePlan.walls); // [a-right, b-right, b-left, a-left]
const HI = faces("w-HI");
const wallTakeoff = (id: string, name: string, pts: [number, number][]): Takeoff => ({ id, name, kind: "length", points: pts, wallsHash: "h" });
const xy = (p: { x: number; y: number }): [number, number] => [p.x, p.y];
const takeoffs: Takeoff[] = [
  { id: "t-south", name: "Length 1", kind: "length", points: [[-0.1, 8.1], [10.1, 8.1]], wallsHash: "h" },
  wallTakeoff("t-left", "North wall, left face", [xy(HI[3]), xy(HI[2])]),
  wallTakeoff("t-centre", "North wall, centre line", [[HI[3].x, 4], [HI[2].x, 4]]),
  wallTakeoff("t-right", "North wall, right face", [xy(HI[0]), xy(HI[1])]),
  { id: "t-area", name: "Bedroom 1", kind: "area", points: [[0.1, 0.1], [4, 0.1], [4, 4], [0.1, 4]], wallsHash: "h" },
  ...Array.from({ length: 11 }, (_, i): Takeoff => ({ id: `t-pdf-${i}`, name: `PDF ${4000 + i * 100} mm`, kind: "length", points: [[i * 0.9, 8.6], [i * 0.9 + 0.9, 8.6]], wallsHash: "h", source: "pdf" as const })),
];
const sources = (detail: LabelDetail, selected: string | null = "t-centre"): LabelSources => ({
  rooms,
  takeoffs,
  showTakeoffs: true,
  selectedTakeoffId: selected,
  items: [{ id: "i1", name: "Cupboard.glb", poly: [{ x: 6, y: 1 }, { x: 7, y: 1 }, { x: 7, y: 1.6 }, { x: 6, y: 1.6 }] }],
  selectedItemId: null,
  units: { length: "m", area: "m2" },
  detail,
});
const bounds = (() => {
  const ps = samplePlan.walls.flatMap((w) => wallOutline(w, samplePlan.walls));
  return { x0: Math.min(...ps.map((p) => p.x)), y0: Math.min(...ps.map((p) => p.y)), x1: Math.max(...ps.map((p) => p.x)), y1: Math.max(...ps.map((p) => p.y)) };
})();
const ZOOMS = [0.64, 1, 1.56, 2.44, 3.81]; // out two, fit, in two, four and six zoom-button steps
const PANES = [{ name: "desktop", width: 1100, height: 800 }, { name: "phone", width: 358, height: 480 }];

/** The controls floating over a pane of this size, like the studio's: the zoom column and the bottom row (L.1b). */
const controlsFor = (pane: { width: number; height: number }) => [
  { id: "control:zoom", x: pane.width - 48, y: 8, width: 40, height: 128 },
  { id: "control:drawing", x: 16, y: pane.height - 108, width: 232, height: 46 },
  { id: "control:set-scale", x: 16, y: pane.height - 60, width: 87, height: 44 },
  { id: "control:labels", x: 111, y: pane.height - 60, width: 144, height: 46 },
];

/** The layout for the sample plan at one zoom, the way PlanCanvas runs it. */
function run(detail: LabelDetail, pane: { width: number; height: number }, zoom: number, shift = { x: 0, y: 0 }, selected: string | null = "t-centre") {
  const fit = fitView(bounds, pane);
  const centre = { x: pane.width / 2, y: pane.height / 2 };
  const z = zoomAt(fit, centre, zoom);
  const view: View = { ...z, tx: z.tx + shift.x, ty: z.ty + shift.y };
  const labels = buildLabels(sources(detail, selected), view);
  const bar = niceScaleBarFor(view.scale, "m");
  const input = [...toLayout(labels, view), scaleBarObstacle(pane, bar.metres * view.scale, bar.label), ...controlObstacles(controlsFor(pane))];
  return { view, labels, input, result: layoutLabels(input, BOUNDS(pane.width, pane.height)) };
}

let hiddenTotal = 0;
let placedTotal = 0;
for (const detail of ["full", "compact"] as const)
  for (const pane of PANES)
    for (const zoom of ZOOMS) {
      const { input, result, labels } = run(detail, pane, zoom);
      const tag = `${detail} ${pane.name} ×${zoom}`;
      assert.deepEqual(intersections(result), [], `${tag}: no two placed rectangles intersect`);
      // …and none touches a control's own rectangle (the obstacles are grown by 12 px, so this holds with room to spare)
      for (const c of controlsFor(pane))
        for (const p of result.placed.filter((q) => q.kind !== "control" && q.kind !== "scalebar")) assert.ok(!(p.x - p.width / 2 < c.x + c.width && c.x < p.x + p.width / 2 && p.y - p.height / 2 < c.y + c.height && c.y < p.y + p.height / 2) || p.forced, `${tag}: ${p.id} is clear of ${c.id}`);
      assert.equal(result.placed.length + result.hidden.length + result.offscreen.length, input.length, `${tag}: every label is placed, hidden or off screen`);
      // On screen it is placed; panned wholly out of the pane (the deepest zoom) it is off screen, which is not hidden.
      assert.ok(result.placed.some((p) => p.id === "takeoff:t-centre") || result.offscreen.includes("takeoff:t-centre"), `${tag}: the selected takeoff is placed, or off screen`);
      assert.ok(!result.hidden.includes("takeoff:t-centre"), `${tag}: and never hidden`);
      assert.ok(result.placed.some((p) => p.id === "scalebar"), `${tag}: the scale bar is placed`);
      for (const p of result.placed.filter((q) => q.kind !== "control" && q.kind !== "scalebar")) assert.ok(p.x - p.width / 2 >= 2 - 1e-9 && p.x + p.width / 2 <= pane.width - 2 + 1e-9 && p.y - p.height / 2 >= 2 - 1e-9 && p.y + p.height / 2 <= pane.height - 2 + 1e-9 || p.forced, `${tag}: ${p.id} is inside the pane with 2 px of padding`);
      // never lose one: a hidden label is listed by id, and is a label that was built
      for (const id of result.hidden) assert.ok(labels.some((l) => l.id === id), `${tag}: hidden ${id} was a built label`);
      hiddenTotal += result.hidden.length;
      placedTotal += result.placed.length;
    }
console.log(`sample plan: Full and Compact, desktop and phone, five zoom levels: no intersections (${placedTotal} placed, ${hiddenTotal} hidden in all)`);

// The default sample at fit really stacks the partition's three takeoffs apart instead of printing them on each other.
{
  const { result } = run("full", PANES[0], 1);
  const three = ["t-left", "t-centre", "t-right"].map((id) => result.placed.find((p) => p.id === `takeoff:${id}`));
  assert.ok(three.every(Boolean), "the three partition takeoffs are all placed at fit on a desktop pane");
  assert.equal(new Set(three.map((p) => Math.round(p!.y))).size, 3, "…on three different lines");
  assert.equal(three.find((p) => p!.id === "takeoff:t-centre")!.moved, 0, "the selected one keeps its natural place");
  console.log(`partition: the selected takeoff stays, the other two moved ${three.filter((p) => p!.id !== "takeoff:t-centre").map((p) => p!.moved.toFixed(1)).join(" and ")} px`);
}

// ---- priority: three of four fit; the LOWEST is hidden, the highest does not move, whatever the arrival order
{
  const four = [label("d", "room-name", 100, 30), label("a", "takeoff-selected", 100, 30), label("c", "room-area", 100, 30), label("b", "takeoff", 100, 30)];
  const res = layoutLabels(four, BOUNDS(200, 60));
  assert.deepEqual(res.hidden, ["d"], "the lowest priority (room name) is the one hidden");
  assert.equal(res.placed.find((p) => p.id === "a")!.moved, 0, "the highest priority stays on its natural place");
  assert.ok(res.placed.find((p) => p.id === "b")!.moved > 0 && res.placed.find((p) => p.id === "c")!.moved > 0, "the middle ones move");
  assert.deepEqual(intersections(res), [], "and nothing overlaps");
  // The same labels in the opposite order: a low one listed first never takes a high one's place.
  assert.deepEqual(layoutLabels([...four].reverse(), BOUNDS(200, 60)), res, "arrival order does not matter");
  // The order of kinds: takeoff over room area over room name over a carried PDF dimension over a model's name.
  const order = ["takeoff-selected", "scalebar", "takeoff", "room-area", "room-name", "takeoff-pdf", "item", "wall", "opening"] as const;
  for (let i = 1; i < order.length; i++) assert.ok(PRIORITY[order[i - 1]] > PRIORITY[order[i]], `${order[i - 1]} outranks ${order[i]}`);
  assert.ok(PRIORITY.live > PRIORITY["takeoff-selected"] && PRIORITY["takeoff-selected"] > PRIORITY.scalebar, "live read-outs, then the selected takeoff, then the scale bar");
  console.log("priority: of four stacked labels the lowest is hidden, the highest never moves, input order is irrelevant");
}

// ---- never hidden: a selected takeoff and the scale bar overlap rather than vanish
{
  const tight = BOUNDS(120, 24);
  const res = layoutLabels([label("s1", "takeoff-selected", 60, 12), label("s2", "takeoff-selected", 60, 12), label("low", "takeoff", 60, 12), label("bar", "scalebar", 60, 12)], tight);
  assert.deepEqual(res.hidden, ["low"], "only the label below the selected takeoff goes");
  assert.deepEqual(res.placed.map((p) => p.id).sort(), ["bar", "s1", "s2"], "the selected takeoffs and the scale bar are all still placed");
  assert.ok(res.placed.some((p) => p.forced), "at least one of them had to overlap (forced)");
  const live = layoutLabels([label("pill", "live", 60, 12), label("bar", "scalebar", 60, 12)], BOUNDS(200, 100));
  assert.equal(live.placed.length, 2, "a live label and the scale bar are both placed, even on the same spot");
  assert.ok(live.placed.every((p) => p.moved === 0), "fixed labels never move");
  console.log("never hidden: selected takeoffs and the scale bar stay (forced when they must), the label below them goes");
}

// ---- off screen is not hidden
{
  const res = layoutLabels([label("in", "takeoff", 50, 50), label("out", "takeoff", 500, 500)], BOUNDS(100, 100));
  assert.deepEqual(res.offscreen, ["out"], "a label wholly outside the pane is off screen");
  assert.deepEqual(res.hidden, [], "and not counted as hidden");
}

// ---- determinism and shuffled input
{
  const { input } = run("full", PANES[0], 1.56);
  const first = layoutLabels(input, BOUNDS(1100, 800));
  assert.deepEqual(layoutLabels(input, BOUNDS(1100, 800)), first, "the same input gives the same output");
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 20; k++) {
    const shuffled = [...input].sort(() => rnd() - 0.5);
    assert.deepEqual(layoutLabels(shuffled, BOUNDS(1100, 800)).placed.map((p) => [p.id, p.dx, p.dy]).sort(), first.placed.map((p) => [p.id, p.dx, p.dy]).sort(), `shuffle ${k}: the same placement`);
    assert.deepEqual([...layoutLabels(shuffled, BOUNDS(1100, 800)).hidden].sort(), [...first.hidden].sort(), `shuffle ${k}: the same hidden set`);
  }
  console.log(`determinism: 20 shuffles of ${input.length} labels, identical placement`);
}

// ---- stability: a small pan changes nothing
// Raw, the greedy layout is NOT continuous at the pane's edge (a label clamped into the pane can tip from one
// candidate spot to another when its anchor moves 3 px), which is why PlanCanvas keeps the last layout through a
// pan of PAN_KEEP_PX or less (keepsLayout). First what the raw layout does, then what the app does.
{
  let rawDiffers = 0;
  let combos = 0;
  let worst = 0;
  for (const pane of PANES)
    for (const zoom of ZOOMS)
      for (const shift of [{ x: 3, y: 0 }, { x: 0, y: 3 }, { x: -3, y: 2 }]) {
        const [a, b] = [run("full", pane, zoom), run("full", pane, zoom, shift)];
        combos++;
        const was = new Map(a.result.placed.map((p) => [p.id, p]));
        const same = [...b.result.hidden].sort().join() === [...a.result.hidden].sort().join() && b.result.placed.every((p) => {
          const q = was.get(p.id);
          const d = q ? Math.hypot(p.dx - q.dx, p.dy - q.dy) : Infinity;
          if (Number.isFinite(d)) worst = Math.max(worst, d);
          return q && d < 1e-9;
        });
        if (!same) rawDiffers++;
        // What the app does: the camera it laid out at is kept for a pan this small, so the layout is the very same one.
        assert.ok(keepsLayout(a.view, b.view), `${pane.name} ×${zoom} pan ${JSON.stringify(shift)}: a 3 px pan keeps the layout`);
        const drawnA = resolveLabels(a.labels, a.result, a.view);
        const drawnB = resolveLabels(a.labels, a.result, b.view); // the OLD layout, at the panned camera
        for (const [id, l] of drawnA) {
          const m = drawnB.get(id)!;
          assert.ok(Math.abs(m.cx - l.cx - shift.x) < 1e-9 && Math.abs(m.cy - l.cy - shift.y) < 1e-9, `${pane.name} ×${zoom}: ${id} is carried by the pan, to the pixel`);
        }
      }
  assert.equal(keepsLayout({ scale: 80, tx: 0, ty: 0 }, { scale: 80, tx: PAN_KEEP_PX, ty: 0 }), true, "a pan of exactly the limit keeps it");
  assert.equal(keepsLayout({ scale: 80, tx: 0, ty: 0 }, { scale: 80, tx: PAN_KEEP_PX + 1, ty: 0 }), false, "a bigger pan lays out again");
  assert.equal(keepsLayout({ scale: 80, tx: 0, ty: 0 }, { scale: 80.5, tx: 0, ty: 0 }), false, "and so does any zoom");
  console.log(`stability: ${rawDiffers} of ${combos} 3 px pans would change the raw layout (largest change ${worst.toFixed(1)} px, at a pane edge); with the layout kept for pans up to ${PAN_KEEP_PX} px every one is carried by the pan and nothing else moves`);
}
{
  // Away from the edges the raw layout is exact anyway: the same offsets to the last digit.
  const [a, b] = [run("full", PANES[0], 1), run("full", PANES[0], 1, { x: 3, y: 3 })];
  for (const p of a.result.placed.filter((p) => p.id.startsWith("room-") || p.id.startsWith("takeoff:t-"))) {
    const q = b.result.placed.find((x) => x.id === p.id)!;
    assert.ok(Math.abs(p.dx - q.dx) < 1e-9 && Math.abs(p.dy - q.dy) < 1e-9, `${p.id}: identical offsets after a 3 px pan at fit`);
  }
}

// ---- leader lines
{
  let seen = 0;
  for (const pane of PANES)
    for (const zoom of ZOOMS) {
      const { result } = run("full", pane, zoom);
      for (const p of result.placed) {
        assert.equal(p.leader !== null, p.moved > p.height / 2, `${pane.name} ×${zoom}: ${p.id} moved ${p.moved.toFixed(2)} of height ${p.height.toFixed(2)}`);
        if (p.leader) seen++;
      }
    }
  assert.ok(seen > 0, "at least one leader appears in the sample runs");
  const res = layoutLabels([label("a", "takeoff", 100, 50), label("b", "takeoff", 100, 50)], BOUNDS(300, 200));
  const moved = res.placed.find((p) => p.id === "b")!;
  assert.equal(moved.moved, 16, "the second label moves by one height");
  assert.deepEqual(moved.leader!.from, { x: 100, y: 50 }, "its leader starts at the anchor");
  assert.equal(res.placed.find((p) => p.id === "a")!.leader, null, "the one that stayed has none");
  // Clamped by less than half a height: no leader.
  const edge = layoutLabels([label("e", "takeoff", 100, 5)], BOUNDS(300, 200)).placed[0];
  assert.ok(edge.moved > 0 && edge.moved <= 8 && edge.leader === null, `a label nudged ${edge.moved} px off the edge has no leader`);
  assert.deepEqual(STEPS, [1, 1.5, 2, 2.5, 3], "offsets run to three label heights");
  console.log(`leaders: only where a label moved more than half its height (${seen} in the sample runs)`);
}

// ---- the hidden count is reported
{
  const crowd = Array.from({ length: 12 }, (_, i) => label(`c${String(i).padStart(2, "0")}`, "takeoff", 100, 30));
  const res = layoutLabels(crowd, BOUNDS(200, 60));
  assert.ok(res.hidden.length > 0 && res.hidden.length + res.placed.length === 12, `${res.hidden.length} hidden + ${res.placed.length} placed = 12`);
  assert.deepEqual([...res.hidden].sort(), res.hidden, "hidden ids come back in priority-then-id order (all equal priority here: by id)");
  console.log(`hidden count: ${res.hidden.length} of 12 stacked labels reported by id`);
}

// ---- long values
{
  const short = wrapLabel("Bedroom 1: 12.600 m²", 12);
  assert.deepEqual(short, { lines: ["Bedroom 1: 12.600 m²"], changed: false, shortened: false }, "a short label is untouched");
  const long = wrapLabel("North wall, left face: 14,822,500,000 mm²", 12);
  assert.equal(long.lines.length, 2, "a long label wraps onto two lines");
  assert.deepEqual(long.lines, ["North wall, left face:", "14,822,500,000 mm²"], "at the colon, so the value never breaks");
  assert.ok(long.changed && !long.shortened, "wrapped, nothing lost");
  const silly = wrapLabel("A".repeat(80), 12);
  assert.ok(silly.shortened && silly.lines.length === 1 && silly.lines[0].endsWith("…") && silly.lines[0].length * 12 * 0.6 <= MAX_LINE_PX, "a line that still doesn't fit is shortened with an ellipsis");
  // From the builder: the area takeoff in mm² keeps its whole value in `full` for the tooltip, and the room list is untouched.
  const big: LabelSources = { ...sources("full"), units: { length: "mm", area: "mm2" }, takeoffs: [{ id: "big", name: "Whole house level, ground floor", kind: "area", points: [[0, 0], [3850.0, 0], [3850.0, 3850.0], [0, 3850.0]], wallsHash: "h" }] };
  const l = buildLabels(big, { scale: 80, tx: 0, ty: 0 }).find((x) => x.id === "takeoff:big")!;
  assert.match(l.full, /: 14,822,500,000,000 mm²$/, `the whole value is kept: ${l.full}`);
  assert.ok(l.changed && l.lines.length === 2 && l.lines.every((s) => s.length * 12 * 0.6 <= MAX_LINE_PX), `wrapped to ${JSON.stringify(l.lines)}`);
  console.log(`long values: ${JSON.stringify(long.lines)}; ellipsis only past a line; the builder keeps "${l.full}" for the tooltip`);
}

// ---- the Labels setting
{
  const view: View = { scale: 80, tx: 0, ty: 0 };
  const kinds = (d: LabelDetail) => new Set(buildLabels(sources(d, "t-left"), view).map((l) => l.kind));
  assert.ok(kinds("full").has("room-name") && kinds("full").has("takeoff-pdf") && kinds("full").has("item"), "Full: names, carried dimensions and models' names");
  assert.deepEqual([...kinds("compact")].sort(), ["room-area", "takeoff", "takeoff-selected"], "Compact: room areas and takeoff labels, the selected one included");
  assert.deepEqual([...kinds("off")], ["takeoff-selected"], "Off: only the selected takeoff");
  for (const k of ["takeoff-selected", "item-selected"] as const) assert.ok(shows("off", k), `Off still shows ${k}`);
  assert.equal(shows("compact", "room-name"), false);
  const sel = buildLabels({ ...sources("off"), selectedItemId: "i1" }, view).map((l) => l.kind);
  assert.ok(sel.includes("item-selected"), "a selected model keeps its name even when Off");
  // The default: Compact while the drawing shows and nothing was ever chosen; a choice always wins.
  assert.equal(effectiveDetail(null, false), "full");
  assert.equal(effectiveDetail(null, true), "compact");
  assert.equal(effectiveDetail("full", true), "full", "a chosen Full beats the drawing's default");
  assert.equal(effectiveDetail("off", false), "off");
  // The store: never chosen → null; choose writes and restore reads back; a choice survives a drawing toggling.
  assert.equal(useLabelsStore.getState().choice, null, "never chosen");
  useLabelsStore.getState().choose("compact");
  assert.equal(disk.get(LABELS_KEY), JSON.stringify({ detail: "compact" }), "the choice is in localStorage atrium.labels");
  useLabelsStore.setState({ choice: null });
  restoreLabelSettings();
  assert.equal(useLabelsStore.getState().choice, "compact", "and a new page load reads it back");
  assert.equal(effectiveDetail(useLabelsStore.getState().choice, false), "compact", "so Compact stays when the drawing is hidden");
  for (const bad of ["not json", JSON.stringify({ detail: "huge" }), JSON.stringify({ detail: 3 }), "null"]) {
    disk.set(LABELS_KEY, bad);
    restoreLabelSettings();
    assert.equal(useLabelsStore.getState().choice, null, `garbled storage ${bad} means never chosen`);
  }
  blocked = true;
  restoreLabelSettings();
  assert.equal(useLabelsStore.getState().choice, null, "blocked storage reads as never chosen");
  assert.doesNotThrow(() => useLabelsStore.getState().choose("off"), "choosing with blocked storage does not throw");
  assert.equal(useLabelsStore.getState().choice, "off", "and holds for the page");
  blocked = false;
  console.log("Labels setting: Full / Compact / Off pick the kinds; Compact is the default under the drawing; the choice is stored and kept");
}

// ---- natural positions: a label nobody disturbs sits where it always did
{
  const { labels, result, view } = run("full", PANES[0], 1, { x: 0, y: 0 }, null);
  const drawn = resolveLabels(labels, result, view);
  const bed = rooms.find((r) => r.name === "Bedroom 1")!;
  const p = worldToScreen(view, bed.labelPoint);
  const [name, area] = [drawn.get(`room-name:${bed.id}`)!, drawn.get(`room-area:${bed.id}`)!];
  assert.ok(Math.abs(name.cx - p.x) < 1e-9 && Math.abs(area.cx - p.x) < 1e-9, "room labels stay centred on their label point");
  assert.ok(name.cy < p.y && area.cy > p.y && area.cy - name.cy < 40, "the name above and the area below it, as before");
  assert.equal(resolveLabels(labels, result, view).size, labels.length - result.hidden.length, "everything not hidden is drawn");
}
// ---- obstacles: the plan's controls (step L.1b)
{
  const box = { id: "control:zoom", x: 100, y: 100, width: 60, height: 40 };
  const [c] = controlObstacles([box], 0);
  assert.equal(c.kind, "control");
  assert.equal(controlObstacles([box])[0].width, 60 + 2 * PAN_KEEP_PX, "grown by PAN_KEEP_PX on every side unless told otherwise");
  // A label anchored dead under the obstacle moves out from under it.
  const res = layoutLabels([c, label("under", "takeoff", 130, 120)], BOUNDS(400, 300));
  const p = res.placed.find((x) => x.id === "under")!;
  assert.ok(p.moved > 0, `the label moved (${p.moved.toFixed(1)} px)`);
  assert.deepEqual(intersections(res), [], "and it no longer touches the obstacle");
  assert.equal(res.placed.find((x) => x.id === "control:zoom")!.moved, 0, "the obstacle itself never moves");
  assert.ok(p.leader !== null, "it carries a leader back to where it belongs");
  // An obstacle that fills the pane leaves no room: the label is hidden, and counted.
  const [wall] = controlObstacles([{ id: "control:all", x: 0, y: 0, width: 400, height: 300 }], 0);
  const lost = layoutLabels([wall, label("lost", "takeoff", 200, 150), label("lost2", "room-area", 100, 80)], BOUNDS(400, 300));
  assert.deepEqual([...lost.hidden].sort(), ["lost", "lost2"], "no free rectangle: hidden");
  // A selected takeoff is the exception: it stays on its spot rather than vanish.
  const keep = layoutLabels([wall, label("sel", "takeoff-selected", 200, 150)], BOUNDS(400, 300));
  assert.ok(keep.hidden.length === 0 && keep.placed.find((x) => x.id === "sel")!.forced, "a selected takeoff is forced, never hidden");
  // An obstacle partly outside the pane is not clamped: it stays where its element is.
  const [edge] = controlObstacles([{ id: "control:edge", x: 380, y: 10, width: 40, height: 40 }], 0);
  const e = layoutLabels([edge], BOUNDS(400, 300)).placed[0];
  assert.deepEqual([e.x, e.y], [400, 30], "an obstacle is placed exactly at its own centre");
  // Obstacles never count as hidden or off screen when they are on the pane.
  console.log("obstacles: a label under a control moves (leader) or is hidden and counted; a selected takeoff stays; controls never move");
}

// ---- a room too small for its label is hidden by the pass, and counted (step L.1b)
{
  const nameAndArea = (res: LayoutResult) => res.hidden.filter((id) => id.startsWith("room-"));
  const tiny = run("full", PANES[0], 0.01); // clamped to 5 px/m: a 4 m room is 20 px across
  assert.equal(tiny.view.scale, 5);
  const small = tiny.labels.filter((l) => l.tooSmall);
  assert.equal(small.length, 8, "all four rooms' names and areas are built, flagged too small");
  assert.deepEqual([...nameAndArea(tiny.result)].sort(), small.map((l) => l.id).sort(), "…and every one is in the hidden list");
  assert.ok(tiny.result.hidden.length >= 8, `so the hidden count includes them (${tiny.result.hidden.length})`);
  assert.equal(tiny.result.placed.length + tiny.result.hidden.length + tiny.result.offscreen.length, tiny.input.length, "nothing is lost");
  const fit = run("full", PANES[0], 1);
  assert.deepEqual(fit.labels.filter((l) => l.tooSmall), [], "at fit no room is too small");
  assert.deepEqual(nameAndArea(fit.result), [], "so none is hidden for size");
  // Compact has no names to hide: only the four areas.
  assert.equal(run("compact", PANES[0], 0.01).labels.filter((l) => l.tooSmall).length, 4, "Compact: the four areas");
  // Off screen is not hidden for size.
  const off = layoutLabels([{ ...label("far", "room-area", 900, 900), tooSmall: true }], BOUNDS(100, 100));
  assert.deepEqual([off.hidden, off.offscreen], [[], ["far"]], "a small room's label that is off screen is off screen, not hidden");
  // A resolved layout draws none of them.
  assert.equal(resolveLabels(tiny.labels, tiny.result, tiny.view).size, tiny.labels.length - tiny.result.hidden.length);
  console.log(`too small: ${small.length} room labels hidden by the pass and counted (${tiny.result.hidden.length} hidden at 5 px/m)`);
}
console.log("test-label-layout: OK");
