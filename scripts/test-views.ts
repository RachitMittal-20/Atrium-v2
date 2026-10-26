/**
 * test-views.ts — step V.1, the bird's-eye view and Recenter, in Node (part of npm test).
 * Written before src/lib/view/camera.ts existed, so it failed first on the missing module.
 *
 * 1. homeView and topView (src/lib/view/camera.ts) for the sample plan, a long thin plan
 *    (40 × 2 m), a PDF plan read from plan-chatgpt-flat.pdf and an empty plan, at the two
 *    screens' aspects (1440 × 900 and 390 × 844) and the 3D panes' own (1040 × 844 and
 *    390 × 624, measured in Chromium): every number finite; every corner of the plan's box
 *    (floor to the tallest wall) in front of the camera and inside the frustum; the frame
 *    fitted, so the limiting corner sits exactly at 1 / 1.1 of the half-width or half-height;
 *    home looks along the three-quarter direction at the plan's centre on the ground; top
 *    looks straight down (within 0.01°) from above the tallest wall, north up the screen, and with
 *    the pane's control strip kept clear (CONTROL_STRIP_PX at the top and bottom) no corner of the
 *    plan lands in it; a bad inset (NaN, negative, too big) is clamped, never NaN.
 * 2. homeView is FitCamera's fit, number for number: the formula the studio framed the plan
 *    with before V.1, copied here, gives the same pose within 1e-9 m. frameBox (I.1b) gives
 *    the same result through the shared fitDistance as its own loop did.
 * 3. The view store: Top, Recenter and back to Orbit are view state only. The plan object,
 *    its history, the autosave payload and the selection are untouched; nothing called "top"
 *    reaches the payload; Top survives a walk (exit returns to Top), Orbit while walking ends it.
 * 4. R, the Recenter key, collides with no tool key, no walking key (W A S D, G) and no
 *    character a typed distance, angle or percentage uses.
 * Run: npx tsx scripts/test-views.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { samplePlan } from "../src/data/samplePlan";
import { emptyPlan } from "../src/data/emptyPlan";
import { frameBox } from "../src/lib/handles3d/math";
import { analysePdfPage } from "../src/lib/pdf/analysePdf";
import { buildPdfPlan } from "../src/lib/pdf/snap";
import { serializePlan } from "../src/lib/persist/planStorage";
import { CONTROL_STRIP_PX, HOME_DIRECTION, homeView, MAX_INSET, planBounds, TOP_TILT, topView, VIEW_PADDING, type PlanBounds } from "../src/lib/view/camera";
import { usePlanStore } from "../src/store/planStore";
import { useSelectionStore } from "../src/store/selectionStore";
import { TOOL_SHORTCUTS } from "../src/store/toolStore";
import { GHOST_KEY, RECENTER_KEY, useViewStore } from "../src/store/viewStore";
import type { Plan, Vec3 } from "../src/types/plan";
import { openNode, pdfjs, renderNode } from "./pdf-node";

const FOV = 45; // Scene3D's camera
const NEAR = 0.1;
const SIZES: [string, number, number][] = [
  ["1440×900", 1440, 900],
  ["390×844", 390, 844],
  ["pane 1040×844", 1040, 844],
  ["pane 390×624", 390, 624],
];
const ASPECTS: [string, number][] = SIZES.map(([l, w, h]) => [l, w / h]);
const pass = (msg: string) => console.log(`  PASS ${msg}`);
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const unit = (v: Vec3): Vec3 => {
  const n = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / n, y: v.y / n, z: v.z / n };
};
const finite = (p: { position: Vec3; target: Vec3 }) => [p.position, p.target].every((v) => [v.x, v.y, v.z].every(Number.isFinite));
const corners = (b: PlanBounds): Vec3[] => [b.x0, b.x1].flatMap((x) => [b.z0, b.z1].flatMap((z) => [0, b.height].map((y) => ({ x, y, z }))));

/** Where each corner lands on screen, as a fraction of the half-width and half-height (1 = the frame's edge), and its depth. */
function onScreen(pose: { position: Vec3; target: Vec3 }, aspect: number, pts: Vec3[]) {
  const forward = unit(sub(pose.target, pose.position));
  const right = unit(cross(forward, { x: 0, y: 1, z: 0 })); // three's lookAt with up = +Y
  const up = cross(right, forward);
  const tanV = Math.tan((FOV * Math.PI) / 360);
  const tanH = tanV * aspect;
  return pts.map((p) => {
    const rel = sub(p, pose.position);
    const depth = dot(rel, forward);
    return { depth, sx: dot(rel, right) / (depth * tanH), sy: dot(rel, up) / (depth * tanV) };
  });
}

/** The plan's box is inside the frustum, beyond the near plane, and fitted: its widest corner at exactly 1 / padding of
 *  the half-width, or of the half-height left once `inset` (a fraction of the height) is kept clear at the top and bottom. */
function checkFramed(name: string, pose: { position: Vec3; target: Vec3 }, b: PlanBounds, aspect: number, what: string, inset = 0) {
  assert.ok(finite(pose), `${name} ${what}: every number is finite (${JSON.stringify(pose)})`);
  const s = onScreen(pose, aspect, corners(b));
  const room = 1 - 2 * inset; // of the half-height
  for (const c of s) {
    assert.ok(c.depth > NEAR, `${name} ${what}: a corner is behind the near plane (depth ${c.depth})`);
    assert.ok(Math.abs(c.sx) <= 1 / VIEW_PADDING + 1e-9 && Math.abs(c.sy) <= room / VIEW_PADDING + 1e-9, `${name} ${what}: a corner is outside the padded frame (${c.sx.toFixed(4)}, ${c.sy.toFixed(4)})`);
  }
  const widest = Math.max(...s.map((c) => Math.max(Math.abs(c.sx), Math.abs(c.sy) / room)));
  assert.ok(Math.abs(widest - 1 / VIEW_PADDING) < 1e-6, `${name} ${what}: fitted with 10% padding (widest corner at ${widest.toFixed(6)} of the room, want ${(1 / VIEW_PADDING).toFixed(6)})`);
  return widest;
}

/** FitCamera's own fit as it was before V.1 (Scene3D.tsx), copied: the reference homeView must equal. */
function oldFit(b: PlanBounds, aspect: number) {
  const target = { x: b.cx, y: 0, z: b.cz };
  const dir = unit({ x: 0.5, y: 0.65, z: 0.75 });
  const forward = { x: -dir.x, y: -dir.y, z: -dir.z };
  const right = unit(cross(forward, { x: 0, y: 1, z: 0 }));
  const up = cross(right, forward);
  const tanV = Math.tan(((FOV * Math.PI) / 180) / 2);
  const tanH = tanV * aspect;
  let distance = 0;
  for (const x of [b.x0, b.x1])
    for (const z of [b.z0, b.z1])
      for (const y of [0, b.height]) {
        const rel = sub({ x, y, z }, target);
        const f = dot(rel, forward);
        distance = Math.max(distance, (1.1 * Math.abs(dot(rel, right))) / tanH - f, (1.1 * Math.abs(dot(rel, up))) / tanV - f);
      }
  return { position: { x: target.x + dir.x * distance, y: target.y + dir.y * distance, z: target.z + dir.z * distance }, target };
}

/** frameBox's corner loop as it was before V.1 (src/lib/handles3d/math.ts), copied. */
function oldFrameBox(box: { min: Vec3; max: Vec3 }, camera: { position: Vec3; target: Vec3; fovDeg: number }, aspect: number, padding: number) {
  const target = { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2, z: (box.min.z + box.max.z) / 2 };
  let back = unit(sub(camera.position, camera.target));
  const elevation = Math.min(89, Math.max(5, (Math.asin(Math.max(-1, Math.min(1, back.y))) * 180) / Math.PI)) * (Math.PI / 180);
  const flat = { x: back.x / Math.hypot(back.x, back.z), z: back.z / Math.hypot(back.x, back.z) };
  back = { x: flat.x * Math.cos(elevation), y: Math.sin(elevation), z: flat.z * Math.cos(elevation) };
  const forward = { x: -back.x, y: -back.y, z: -back.z };
  const right = unit(cross(forward, { x: 0, y: 1, z: 0 }));
  const up = cross(right, forward);
  const tanV = Math.tan((camera.fovDeg * Math.PI) / 360);
  const tanH = tanV * aspect;
  let distance = 0;
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) {
        const rel = sub({ x, y, z }, target);
        const f = dot(rel, forward);
        distance = Math.max(distance, (padding * Math.abs(dot(rel, right))) / tanH - f, (padding * Math.abs(dot(rel, up))) / tanV - f, 0.2 - f);
      }
  return { position: { x: target.x + back.x * distance, y: Math.max(0.1, target.y + back.y * distance), z: target.z + back.z * distance }, target };
}

function longThin(): Plan {
  const p = structuredClone(samplePlan);
  const w = (id: string, a: [number, number], b: [number, number]) => ({ ...samplePlan.walls[0], id, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] } });
  return { ...p, walls: [w("n", [0, 0], [40, 0]), w("e", [40, 0], [40, 2]), w("s", [40, 2], [0, 2]), w("w", [0, 2], [0, 0])], openings: [], rooms: [], takeoffs: [] };
}

async function pdfPlan(): Promise<Plan> {
  const doc = await openNode(new Uint8Array(readFileSync(join(__dirname, "../tests/fixtures/pdf/plan-chatgpt-flat.pdf"))));
  const r = await analysePdfPage(pdfjs, await doc.getPage(1), { pageCount: 1, render: renderNode, ocr: async () => ({ labels: [], words: [], error: null, rereads: [] }) });
  await doc.loadingTask.destroy();
  return buildPdfPlan(r.analysis, r.pdf, { pxPerM: r.analysis.scale.pxPerM!, source: "pdf" }).plan;
}

async function main() {
  // ---- 1 and 2: the pure views
  const plans: [string, Plan][] = [
    ["sample", structuredClone(samplePlan)],
    ["long thin 40 × 2 m", longThin()],
    ["PDF plan-chatgpt-flat", await pdfPlan()],
    ["empty", emptyPlan("2026-10-26T00:00:00.000Z")],
  ];
  for (const [name, plan] of plans) {
    const b = planBounds(plan.walls);
    assert.ok([b.x0, b.x1, b.z0, b.z1, b.height, b.cx, b.cz, b.size].every(Number.isFinite), `${name}: bounds are finite (${JSON.stringify(b)})`);
    for (const [label, w, h] of SIZES) {
      const aspect = w / h;
      const home = homeView(b, aspect, FOV);
      checkFramed(name, home, b, aspect, `home at ${label}`);
      assert.deepEqual(home.target, { x: b.cx, y: 0, z: b.cz }, `${name} home at ${label}: aims at the plan's centre on the ground`);
      const dir = unit(sub(home.position, home.target));
      assert.ok(Math.hypot(dir.x - HOME_DIRECTION.x, dir.y - HOME_DIRECTION.y, dir.z - HOME_DIRECTION.z) < 1e-12, `${name} home at ${label}: from the three-quarter direction`);
      const ref = oldFit(b, aspect);
      const off = Math.hypot(...(["x", "y", "z"] as const).map((k) => home.position[k] - ref.position[k]));
      assert.ok(off < 1e-9, `${name} home at ${label}: the same pose FitCamera framed before V.1 (off by ${off} m)`);

      checkFramed(name, topView(b, aspect, FOV), b, aspect, `top at ${label} with no inset`);
      const inset = CONTROL_STRIP_PX / h;
      const top = topView(b, aspect, FOV, inset);
      checkFramed(name, top, b, aspect, `top at ${label}`, inset);
      // nothing of the plan in the control strip: every corner's screen y is below the strip and above the same band at the bottom
      for (const c of onScreen(top, aspect, corners(b))) {
        const py = ((1 - c.sy) / 2) * h;
        assert.ok(py >= CONTROL_STRIP_PX - 1e-6 && py <= h - CONTROL_STRIP_PX + 1e-6, `${name} top at ${label}: a corner at y ${py.toFixed(1)} px is in the ${CONTROL_STRIP_PX} px control strip`);
      }
      const down = unit(sub(top.target, top.position));
      const tilt = (Math.acos(Math.min(1, -down.y)) * 180) / Math.PI;
      assert.ok(tilt < 0.01, `${name} top at ${label}: looks straight down (${tilt.toExponential(2)}° off)`);
      assert.ok(Math.abs(tilt - (TOP_TILT * 180) / Math.PI) < 1e-6, `${name} top at ${label}: tilted by exactly TOP_TILT, so OrbitControls keeps it`);
      assert.ok(top.position.y > b.height + 0.2, `${name} top at ${label}: above the tallest wall (${top.position.y.toFixed(2)} m)`);
      assert.ok(top.position.x === b.cx && Math.abs(top.position.z - b.cz) < 1e-3 * top.position.y, `${name} top at ${label}: over the plan's centre`);
      assert.ok(down.z < 0, `${name} top at ${label}: north (−z, up the 2D plan) is up the screen`);
    }
    pass(`${name}: home and top framed with 10% padding at ${ASPECTS.map((a) => a[0]).join(", ")}; home = the old FitCamera pose; top straight down, above the walls, clear of the ${CONTROL_STRIP_PX} px control strip`);
  }

  // a bad inset is clamped, never NaN
  {
    const b = planBounds(samplePlan.walls);
    for (const bad of [Number.NaN, -1, 2, Infinity]) assert.ok(finite(topView(b, 1.2, FOV, bad)), `top with inset ${bad}: finite`);
    checkFramed("sample", topView(b, 1.2, FOV, 0.9), b, 1.2, "top with inset 0.9 (clamped)", MAX_INSET);
    pass(`topView: an inset of NaN, -1, 2 or Infinity gives finite numbers; 0.9 is held to ${MAX_INSET}`);
  }

  // frameBox through the shared fitDistance: the same answers as its own loop before V.1
  {
    const box = { min: { x: -1, y: 0, z: 2 }, max: { x: 3, y: 2.5, z: 4 } };
    for (const cam of [
      { position: { x: 10, y: 8, z: 12 }, target: { x: 0, y: 0, z: 0 }, fovDeg: 45 },
      { position: { x: 0, y: 30, z: 0.001 }, target: { x: 0, y: 0, z: 0 }, fovDeg: 45 },
      { position: { x: -5, y: 0.2, z: 1 }, target: { x: 0, y: 1, z: 0 }, fovDeg: 70 },
    ])
      for (const [, aspect] of ASPECTS) {
        const a = frameBox(box, cam, aspect, 1.15);
        const r = oldFrameBox(box, cam, aspect, 1.15);
        assert.ok(Math.hypot(a.position.x - r.position.x, a.position.y - r.position.y, a.position.z - r.position.z) < 1e-9, "frameBox unchanged");
      }
    pass("frameBox: the same poses through the shared fitDistance as its own loop gave");
  }

  // ---- 3: the view store
  {
    usePlanStore.getState().loadPlan(structuredClone(samplePlan));
    const v = useViewStore.getState;
    const s = usePlanStore.getState;
    useSelectionStore.getState().select(samplePlan.walls[0].id);
    const plan0 = s().plan;
    const past0 = s().past.length;
    const saved0 = serializePlan(plan0, new Date(0));
    assert.equal(v().top, false, "Top is off by default");
    v().setTop(true);
    assert.equal(v().top, true, "Top on");
    assert.equal(v().request?.kind, "top", "Top asks the camera for the top view");
    const n = v().request!.n;
    v().recenter();
    assert.equal(v().request?.kind, "top", "Recenter in Top re-frames the top view");
    assert.ok(v().request!.n > n, "as a new request");
    assert.equal(v().enterWalk(), true);
    assert.equal(v().top, true, "Top is kept through a walk");
    const w0 = v().walkHome;
    v().recenter();
    assert.equal(v().walkHome, w0 + 1, "Recenter while walking asks WalkControls for the start pose");
    v().exitWalk();
    assert.equal(v().mode, "orbit");
    assert.equal(v().top, true, "leaving the walk returns to Top (the camera itself is restored exactly)");
    v().setTop(false);
    assert.equal(v().top, false);
    assert.equal(v().request?.kind, "back", "Orbit from Top goes back to the camera from before Top");
    v().recenter();
    assert.equal(v().request?.kind, "home", "Recenter in Orbit asks for the home view");
    v().enterWalk();
    v().setTop(true);
    assert.equal(v().mode, "orbit", "Top while walking ends the walk");
    assert.equal(v().top, true);
    v().enterWalk();
    v().chooseOrbit();
    assert.equal(v().top, false, "the Orbit button while walking leaves Top too");
    assert.equal(s().plan, plan0, "the plan object is untouched");
    assert.equal(s().past.length, past0, "no undo step");
    assert.equal(useSelectionStore.getState().selectedId, samplePlan.walls[0].id, "the selection is untouched");
    const saved1 = serializePlan(s().plan, new Date(0));
    assert.equal(saved1, saved0, "the autosave payload is the same");
    assert.ok(!/"top"|"request"|"walkHome"/.test(saved1), "no view setting in the payload");
    assert.deepEqual(Object.keys(JSON.parse(saved1)).sort(), ["plan", "savedAt", "schema"]);
    pass("view store: Top, Recenter and Orbit change no plan, history, payload or selection; Top survives a walk");
  }

  // ---- 4: R is free
  {
    const tools = Object.values(TOOL_SHORTCUTS);
    assert.equal(RECENTER_KEY, "r");
    assert.ok(!tools.includes(RECENTER_KEY), `${RECENTER_KEY} is no tool's key (${tools.join(", ")})`);
    assert.ok(!"wasd".includes(RECENTER_KEY) && (RECENTER_KEY as string) !== GHOST_KEY, `${RECENTER_KEY} is not a walking key`);
    assert.ok(!/^[0-9.,'"+\-−cmftin %°]$/i.test(RECENTER_KEY), `${RECENTER_KEY} is not a key a typed distance, angle or percentage uses`);
    const all = [...tools, GHOST_KEY, RECENTER_KEY];
    assert.equal(new Set(all).size, all.length, `no two single-key shortcuts are the same: ${all.join(", ")}`);
    pass(`recenter key ${RECENTER_KEY.toUpperCase()}: unique among ${tools.join(", ")}, ${GHOST_KEY}, W A S D and typed-value keys`);
  }
  console.log("\nOK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
