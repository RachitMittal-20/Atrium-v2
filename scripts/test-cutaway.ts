/**
 * test-cutaway.ts — step V.2, the Cutaway view (a render setting, never plan data).
 *   1. cutReport: which wall and opening geometry is above the cut height, for the sample plan and
 *      plan-chatgpt-flat.pdf's plan as the import screen builds it, checked against the real wall
 *      meshes (buildWallMeshData) vertex by vertex; a wall lower than the cut has nothing above it.
 *   2. cutRaycast: a wall mesh's raycast never returns a point above the cut, so nothing clipped away
 *      can be picked; a ray down into a cut wall still finds the wall (its visible section).
 *   3. cutInForce: off in Walk and while Push/Pull or Move is active, on otherwise when chosen.
 *   4. The store: OFF for the sample and for opened projects, ON after an import, and the user's own
 *      choice kept over both; Room names follow Cutaway until chosen; only "atrium.cutaway" is written.
 *   5. Toggling changes nothing else: the plan (serializePlan with a fixed date, and the same object),
 *      its history, the GLB's triangle counts, the 3D export's meshes, the schedule and the takeoffs.
 *      Written before the feature, so it first stopped at the missing module; it can only pass once
 *      the feature exists.
 * Run: npx tsx scripts/test-cutaway.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";

const disk = new Map<string, string>();
// GLTFExporter writes a GLB through the browser's FileReader (the same stand-in as test-exports.ts).
class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(b: Blob) {
    void b.arrayBuffer().then((r) => ((this.result = r), this.onloadend?.()));
  }
  readAsDataURL(b: Blob) {
    void b.arrayBuffer().then((r) => ((this.result = `data:${b.type};base64,${Buffer.from(r).toString("base64")}`), this.onloadend?.()));
  }
}
(globalThis as { FileReader?: unknown }).FileReader ??= NodeFileReader;

async function main() {
  const { samplePlan } = await import("../src/data/samplePlan");
  const { buildWallMeshData, buildWallGeometry } = await import("../src/lib/plan/meshBuilders");
  const { analysePdfPage } = await import("../src/lib/pdf/analysePdf");
  const { buildPdfPlan } = await import("../src/lib/pdf/snap");
  const { serializePlan } = await import("../src/lib/persist/planStorage");
  const { exportScene, toGlb } = await import("../src/lib/export/model3d");
  const { buildSchedule } = await import("../src/lib/export/schedule");
  const { CUT_HEIGHT, cutReport, cutRaycast, cutInForce } = await import("../src/lib/view/cutaway");
  const { usePlanStore } = await import("../src/store/planStore");
  const { openNode, pdfjs, renderNode } = await import("./pdf-node");
  type Plan = import("../src/types/plan").Plan;

  const pdfPlan = async (): Promise<Plan> => {
    const doc = await openNode(new Uint8Array(readFileSync(join(__dirname, "../tests/fixtures/pdf/plan-chatgpt-flat.pdf"))));
    const r = await analysePdfPage(pdfjs, await doc.getPage(1), { pageCount: 1, render: renderNode, ocr: async () => ({ labels: [], words: [], error: null, rereads: [] }) });
    await doc.loadingTask.destroy();
    return buildPdfPlan(r.analysis, r.pdf, { pxPerM: r.analysis.scale.pxPerM!, source: "pdf" }).plan;
  };
  const pdf = await pdfPlan();
  // a localStorage for Node (cutawayStore reads and writes window.localStorage), set only now: with a `window`, pdf.js
  // above would take Node for a browser, and the store reads storage when it loads
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: { getItem: (k: string) => disk.get(k) ?? null, setItem: (k: string, v: string) => void disk.set(k, v) },
  };
  const { useCutawayStore, cutawayOn, roomNamesOn, CUTAWAY_KEY, restoreCutawaySettings } = await import("../src/store/cutawayStore");
  const sample = structuredClone(samplePlan);
  assert.equal(CUT_HEIGHT, 1.2, "the default cut is 1.2 m");

  // ---- 1. cutReport against the real meshes
  const low = structuredClone(samplePlan);
  low.walls = low.walls.map((w) => (w.id === "w-AB" ? { ...w, height: 1.0 } : w));
  low.openings = low.openings.filter((o) => o.wallId !== "w-AB");
  for (const [name, plan] of [["sample", sample], ["PDF plan-chatgpt-flat", pdf], ["sample with a 1.0 m wall", low]] as const) {
    const report = cutReport(plan, CUT_HEIGHT);
    assert.equal(report.walls.length, plan.walls.length, `${name}: every wall reported`);
    assert.equal(report.openings.length, plan.openings.length, `${name}: every opening reported`);
    for (const r of report.walls) {
      const wall = plan.walls.find((w) => w.id === r.id)!;
      const pos = buildWallMeshData(wall, plan.walls, plan.openings).geometry.getAttribute("position");
      let top = -Infinity;
      let above = 0;
      for (let i = 0; i < pos.count; i++) {
        top = Math.max(top, pos.getY(i));
        if (pos.getY(i) > CUT_HEIGHT + 1e-6) above++; // positions are float32: 1e-6 m
      }
      assert.ok(Math.abs(r.above - Math.max(0, top - CUT_HEIGHT)) < 1e-6, `${name} ${r.id}: ${r.above} m above the cut, the mesh says ${top - CUT_HEIGHT}`);
      assert.equal(above > 0, r.above > 0, `${name} ${r.id}: vertices above the cut exactly when the report says so`);
    }
    for (const r of report.openings) {
      const o = plan.openings.find((x) => x.id === r.id)!;
      assert.ok(Math.abs(r.above - Math.max(0, o.sillHeight + o.height - CUT_HEIGHT)) < 1e-12, `${name} ${r.id}: opening above the cut`);
    }
    console.log(`${name}: ${report.walls.filter((r) => r.above > 0).length} of ${plan.walls.length} walls and ${report.openings.filter((r) => r.above > 0).length} of ${plan.openings.length} openings reach above ${CUT_HEIGHT} m`);
  }
  assert.equal(cutReport(low, CUT_HEIGHT).walls.find((r) => r.id === "w-AB")!.above, 0, "a 1.0 m wall is wholly below the cut");
  assert.ok(cutReport(sample, CUT_HEIGHT).walls.every((r) => Math.abs(r.above - 1.5) < 1e-12), "every 2.7 m sample wall has 1.5 m above the cut");

  // ---- 2. the raycast honours the cut
  {
    const wall = sample.walls.find((w) => w.id === "w-AB")!;
    const mesh = new THREE.Mesh(buildWallGeometry(wall, sample.walls, sample.openings), new THREE.MeshStandardMaterial());
    mesh.raycast = cutRaycast;
    const mid = { x: (wall.a.x + wall.b.x) / 2, z: (wall.a.y + wall.b.y) / 2 };
    const rc = new THREE.Raycaster();
    const cast = (from: THREE.Vector3, dir: THREE.Vector3) => (rc.set(from, dir.normalize()), rc.intersectObject(mesh, false));
    const down = () => cast(new THREE.Vector3(mid.x, 10, mid.z), new THREE.Vector3(0, -1, 0));
    // the wall runs along x (A to B): a ray across it at a height, from the south
    const across = (y: number) => cast(new THREE.Vector3(mid.x, y, mid.z + 5), new THREE.Vector3(0, 0, -1));

    assert.ok(Math.abs(down()[0].point.y - wall.height) < 1e-6, "with no cut, a ray from above meets the wall's top");
    assert.equal(across(2).length > 0, true, "with no cut, a ray at 2 m meets the wall");
    mesh.userData.cutY = CUT_HEIGHT;
    assert.ok(down().length > 0 && down().every((h) => h.point.y <= CUT_HEIGHT + 1e-9), `with the cut, a ray down into the wall finds its section, never above the cut: ${down().map((h) => h.point.y.toFixed(3)).join(", ")}`);
    assert.equal(across(2).length, 0, "with the cut, nothing at 2 m is hit");
    assert.equal(cast(new THREE.Vector3(mid.x, 10, mid.z + wall.thickness), new THREE.Vector3(0, -1, 0)).length, 0, "a ray down just beside the wall finds no section");
    assert.ok(across(1).length > 0, "with the cut, a ray at 1 m still meets the wall");
    assert.equal(mesh.material.side, THREE.FrontSide, "the material is left as it was");
    delete mesh.userData.cutY;
    assert.ok(Math.abs(down()[0].point.y - wall.height) < 1e-6, "the cut gone, the top is hit again");
  }

  // ---- 3. when the cut is in force
  assert.equal(cutInForce({ on: true, walking: false, tool: "select" }), true);
  assert.equal(cutInForce({ on: true, walking: false, tool: "rotate" }), true, "Rotate and Scale are models only: the cut stays");
  assert.equal(cutInForce({ on: false, walking: false, tool: "select" }), false);
  assert.equal(cutInForce({ on: true, walking: true, tool: "select" }), false, "full height in Walk");
  assert.equal(cutInForce({ on: true, walking: false, tool: "pushpull" }), false, "full height for Push/Pull (wall tops)");
  assert.equal(cutInForce({ on: true, walking: false, tool: "move" }), false, "full height for Move (wall sides, corners)");

  // ---- 4. the store
  const st = () => useCutawayStore.getState();
  assert.equal(cutawayOn(st()), false, "the sample (nothing imported, nothing chosen): off");
  assert.equal(roomNamesOn(st()), false, "room names follow cutaway");
  st().setImported(true);
  assert.equal(cutawayOn(st()), true, "a plan built from an import: on");
  assert.equal(roomNamesOn(st()), true, "room names follow cutaway");
  st().setImported(false);
  assert.equal(cutawayOn(st()), false, "an opened project: off");
  st().setCutaway(true);
  assert.equal(cutawayOn(st()), true, "the user's choice beats the default");
  st().setImported(true);
  st().setCutaway(false);
  assert.equal(cutawayOn(st()), false, "...both ways: off on an import once chosen");
  st().setRoomNames(true);
  assert.equal(roomNamesOn(st()) && !cutawayOn(st()), true, "room names chosen on their own");
  assert.deepEqual([...disk.keys()], [CUTAWAY_KEY], "only the view setting's own key is written");
  assert.deepEqual(JSON.parse(disk.get(CUTAWAY_KEY)!), { cutaway: false, roomNames: true, imported: true });
  useCutawayStore.setState({ cutaway: null, roomNames: null, imported: false });
  restoreCutawaySettings();
  assert.deepEqual({ c: st().cutaway, r: st().roomNames, i: st().imported }, { c: false, r: true, i: true }, "a reload brings the choices back");
  disk.set(CUTAWAY_KEY, "{not json");
  restoreCutawaySettings();
  assert.deepEqual({ c: st().cutaway, r: st().roomNames, i: st().imported }, { c: null, r: null, i: false }, "a garbled entry means never chosen");

  // ---- 5. toggling changes nothing else
  usePlanStore.getState().loadPlan(pdf);
  usePlanStore.getState().renamePlan("Cutaway check"); // one history step, so the history is not trivially empty
  const glbTriangles = async (plan: Plan) => {
    const buffer = await toGlb(plan);
    const view = new DataView(buffer);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, view.getUint32(12, true))));
    return (json.meshes as { name?: string; primitives: { indices?: number; attributes: { POSITION: number } }[] }[]).map((m) => [
      m.name ?? "",
      m.primitives.reduce((s, p) => s + (p.indices !== undefined ? json.accessors[p.indices].count : json.accessors[p.attributes.POSITION].count) / 3, 0),
    ]);
  };
  const exportMeshes = (plan: Plan) => {
    const out: [string, number][] = [];
    exportScene(plan).traverse((o) => {
      const g = (o as THREE.Mesh).geometry;
      if (g) out.push([o.name, (g.index?.count ?? g.getAttribute("position").count) / 3]);
    });
    return out;
  };
  const snapshot = async () => {
    const s = usePlanStore.getState();
    return {
      plan: s.plan,
      json: serializePlan(s.plan, new Date(0)),
      past: s.past.length,
      future: s.future.length,
      glb: await glbTriangles(s.plan),
      meshes: exportMeshes(s.plan),
      schedule: JSON.stringify(buildSchedule(s.plan)),
      takeoffs: JSON.stringify(s.plan.takeoffs ?? []),
    };
  };
  const before = await snapshot();
  for (const step of [() => st().setCutaway(true), () => st().setRoomNames(false), () => st().setImported(false), () => st().setCutaway(false), () => st().setRoomNames(true), () => st().setImported(true)]) {
    step();
    const after = await snapshot();
    assert.equal(after.plan, before.plan, "the plan is the same object");
    assert.equal(after.json, before.json, "the saved plan JSON is identical");
    assert.equal(after.past, before.past, "no history step");
    assert.equal(after.future, before.future, "no redo step");
    assert.deepEqual(after.glb, before.glb, "the GLB's triangle counts are identical");
    assert.deepEqual(after.meshes, before.meshes, "the 3D export's meshes are identical");
    assert.equal(after.schedule, before.schedule, "the schedule is identical");
    assert.equal(after.takeoffs, before.takeoffs, "the takeoffs are identical");
  }
  assert.ok(!before.json.includes("cutaway") && !before.json.includes("roomNames"), "the plan JSON never mentions the view setting");
  console.log(`cutaway: cut report and raycast checked; toggling left the plan, ${before.glb.length} GLB meshes, the schedule and takeoffs unchanged`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
