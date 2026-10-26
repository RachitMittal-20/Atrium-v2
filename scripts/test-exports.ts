/**
 * test-exports.ts — step X.2: the area schedule, the takeoff report PDF and the GLB / OBJ model
 * (src/lib/export/{schedule,report,model3d}.ts). Written FAILING FIRST: before those modules existed
 * this file failed at its imports (the schedule-equals-summary and GLB round-trip checks with it).
 *   1. schedule = Summary: for the sample plan and for plan-filled.pdf built as the import screen
 *      builds it, every room row is the room list's own (deriveRooms through the plan store, what
 *      useDerivedRooms gives the Summary and the room list), the total net area is the Summary's sum,
 *      and the openings' counts are the Summary's doors and windows;
 *   2. CSV: RFC 4180 escaping of a room name with a comma and quotes, values in the chosen units, and
 *      totals summed from exact values (three rooms of 1.0004 m² show 1.000 each and 3.001 together);
 *   3. the report: A4 landscape; its text (read back through pdf.js) holds the title, plan name, date,
 *      units, every room, every takeoff with its measured value AND its override, the PDF dimension rows
 *      with their status, the verdict and its reasons, the scale source and the footer, and no wall
 *      coordinate, no asset id and no file name;
 *   4. GLB: parsed back with three's GLTFLoader: one node per wall and per room, named by id (read from
 *      the file's JSON: the loader sanitises ":" and "." out of names), the floors' net areas (extras)
 *      equal to the Summary's within 1e-6 m², their triangles' area within float32 precision (1e-6
 *      relative; glTF positions are 32-bit), Y up, metres;
 *   5. OBJ: one object per wall and floor, named by id, with the vertex counts of the exported meshes.
 * No byte comparison of compressed or time-stamped output: text and values only. The date is passed in.
 * Run: npx tsx scripts/test-exports.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as THREE from "three";
import { samplePlan } from "../src/data/samplePlan";
import { buildSchedule, scheduleCells, type Schedule } from "../src/lib/export/schedule";
import { buildReport, REPORT_FOOTER } from "../src/lib/export/report";
import { exportScene, toGlb, toObj } from "../src/lib/export/model3d";
import { analysePdfPage } from "../src/lib/pdf/analysePdf";
import { modelRows } from "../src/lib/pdf/dimensions";
import { buildPdfPlan } from "../src/lib/pdf/snap";
import { approximateIndexes, pdfTakeoffs } from "../src/lib/pdf/takeoffs";
import { planVerdict, VERDICT_LABEL } from "../src/lib/pdf/verdict";
import { deriveRooms } from "../src/lib/plan/rooms";
import { takeoffRow, toCsv, wallsHash } from "../src/lib/takeoff/rows";
import { formatArea, formatLength } from "../src/lib/units/format";
import { usePlanStore } from "../src/store/planStore";
import type { Plan, Takeoff } from "../src/types/plan";
import type { Truth } from "./make-pdf-fixtures";
import { openNode, pdfjs, renderNode } from "./pdf-node";

const DIR = join(process.cwd(), "tests/fixtures/pdf");
const truths: Truth[] = JSON.parse(readFileSync(join(DIR, "truth.json"), "utf8"));
const noOcr = async () => ({ words: [], lines: [], confidence: 0 });

// GLTFExporter writes a GLB through the browser's FileReader, which Node does not have.
// The test-only stand-in reads the Blob the same way (Node has Blob).
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

/** plan-filled.pdf built as the import screen builds it, with its printed dimensions carried in. */
async function pdfPlan(file: string): Promise<Plan> {
  const t = truths.find((x) => x.file === file)!;
  const doc = await openNode(new Uint8Array(readFileSync(join(DIR, file))));
  const out = await analysePdfPage(pdfjs, await doc.getPage(t.planPage), { pageCount: doc.numPages, render: renderNode, ocr: noOcr as never });
  await doc.loadingTask.destroy();
  const b = buildPdfPlan(out.analysis, out.pdf, { pxPerM: out.analysis.scale.pxPerM!, source: "pdf" });
  const c = b.coverage;
  const toPlan = (x: number, y: number) => ({ x: x * c.mPerPt - c.origin.x, y: y * c.mPerPt - c.origin.y });
  const matches = out.pdf.scale!.matches;
  const approximate = approximateIndexes(modelRows(matches, b.plan, toPlan, (3 * c.traceMm) / 1000));
  const hash = wallsHash(b.plan.walls);
  const takeoffs: Takeoff[] = pdfTakeoffs(matches, toPlan, {}, approximate).map((k, i) => ({ ...k, id: `tp-${i + 1}`, wallsHash: hash }));
  return { ...b.plan, takeoffs, background: { assetId: "0123456789abcdef", kind: "pdf", page: 1, mapping: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } } };
}

/** The Summary and the room list, as PlanPanel computes them from the plan store. */
function summaryOf(plan: Plan) {
  usePlanStore.getState().loadPlan(plan);
  const stored = usePlanStore.getState().plan;
  const rooms = deriveRooms(stored); // = useDerivedRooms()
  return {
    plan: stored,
    rooms,
    total: rooms.reduce((sum, r) => sum + r.area, 0),
    doors: stored.openings.filter((o) => o.kind === "door").length,
    windows: stored.openings.filter((o) => o.kind === "window").length,
  };
}

/** Every text item pdf.js finds, page by page. */
async function pdfText(bytes: Uint8Array): Promise<{ items: string[]; sizes: [number, number][] }> {
  const doc = await openNode(bytes.slice());
  const items: string[] = [];
  const sizes: [number, number][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    sizes.push([vp.width, vp.height]);
    const content = await page.getTextContent();
    for (const it of content.items) if ("str" in it && it.str.trim()) items.push(it.str);
  }
  await doc.loadingTask.destroy();
  return { items, sizes };
}

async function glbScene(buffer: ArrayBuffer): Promise<THREE.Object3D> {
  return new Promise((resolve, reject) => new GLTFLoader().parse(buffer, "", (g) => resolve(g.scene), reject));
}

/** The node names as the file stores them (GLTFLoader sanitises ":" and "." out of the names it gives three). */
function glbNodeNames(buffer: ArrayBuffer): string[] {
  const view = new DataView(buffer);
  assert.equal(view.getUint32(0, true), 0x46546c67, "GLB magic");
  const length = view.getUint32(12, true);
  assert.equal(view.getUint32(16, true), 0x4e4f534a, "the first chunk is JSON");
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)));
  return (json.nodes as { name?: string; mesh?: number }[]).filter((n) => n.mesh !== undefined).map((n) => n.name ?? "");
}

/** Area of every triangle of a mesh's geometry, in world space (float64 sums of the float32 vertices). */
function meshArea(mesh: THREE.Mesh): number {
  mesh.updateWorldMatrix(true, false);
  const g = mesh.geometry;
  const pos = g.getAttribute("position");
  const index = g.getIndex();
  const n = index ? index.count : pos.count;
  const at = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
  let sum = 0;
  for (let i = 0; i < n; i += 3) {
    const [a, b, c] = [at(i), at(i + 1), at(i + 2)];
    sum += new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).length() / 2;
  }
  return sum;
}

async function main() {
  const filled = await pdfPlan("plan-filled.pdf");

  // ================================================================= 1. schedule = Summary and room list
  for (const [label, plan] of [["sample", samplePlan as Plan], ["plan-filled.pdf", filled]] as const) {
    const s = summaryOf(plan);
    const sch = buildSchedule(s.plan);
    assert.ok(s.rooms.length > 0, `${label}: has rooms`);
    assert.deepEqual(
      sch.rooms.map((r) => [r.id, r.name, r.area, r.perimeter]),
      s.rooms.map((r) => [r.id, r.name, r.area, r.perimeter]),
      `${label}: every room row is the room list's own (exact, same order)`,
    );
    assert.equal(sch.totals.area, s.total, `${label}: the total net area is the Summary's, exactly`);
    assert.equal(sch.totals.doors, s.doors, `${label}: doors`);
    assert.equal(sch.totals.windows, s.windows, `${label}: windows`);
    assert.equal(sch.openings.reduce((n, o) => n + o.count, 0), s.plan.openings.length, `${label}: every opening is counted once`);
    for (const o of sch.openings) assert.ok(o.count >= 1 && (o.kind === "door" || o.kind === "window"), `${label}: an opening row`);
    console.log(`  ${label}: ${sch.rooms.length} rooms, ${sch.openings.length} opening types, net ${s.total.toFixed(6)} m²`);
  }

  // ================================================================= 2. CSV: escaping, units, totals from exact values
  {
    const s: Schedule = {
      rooms: [
        { id: "r1", name: 'Hall, "main"', area: 1.0004, perimeter: 4.0004 },
        { id: "r2", name: "Study", area: 1.0004, perimeter: 4.0004 },
        { id: "r3", name: "Store", area: 1.0004, perimeter: 4.0004 },
      ],
      openings: [{ kind: "door", width: 0.9, height: 2.1, sill: 0, count: 2 }],
      totals: { area: 3.0012, perimeter: 12.0012, doors: 2, windows: 0 },
    };
    const csv = toCsv(scheduleCells(s, { length: "m", area: "m2" }));
    const lines = csv.split("\r\n");
    assert.ok(lines.includes(`"Hall, ""main""",1.000,4.000`), `a name with a comma and quotes is quoted, its quotes doubled:\n${csv}`);
    assert.ok(lines.includes("Total,3.001,12.001"), `totals are summed from exact values (rows show 1.000, the total 3.001):\n${csv}`);
    assert.ok(lines.includes("name,net area (m²),perimeter (m)"), "the units are in the header");
    assert.ok(lines.includes("door,0.900,2.100,0.000,2"), "an opening row");
    const mm = toCsv(scheduleCells(s, { length: "mm", area: "sqft" }));
    assert.ok(mm.includes("width (mm)") && mm.includes("door,900,2100,0,2") && mm.includes("net area (sq ft)"), `the chosen units:\n${mm}`);
  }

  // ================================================================= 3. the report
  {
    const s = summaryOf(filled);
    const t0 = s.plan.takeoffs![0];
    usePlanStore.getState().updateTakeoff(t0.id, { override: { value: 9.876, note: "site check" } });
    usePlanStore.getState().addTakeoff({ name: "Hall run", kind: "length", points: [[0, 0], [3, 0]], reference: { value: 3.05 }, override: { value: 3.1 } });
    usePlanStore.getState().addTakeoff({ name: "Kitchen floor", kind: "area", points: [[0, 0], [2, 0], [2, 2], [0, 2]] });
    const plan = usePlanStore.getState().plan;
    const units = { length: "mm", area: "m2" } as const;
    const bytes = await buildReport({ plan, units, date: "1 January 2026" });
    const { items, sizes } = await pdfText(bytes);
    const text = items.join("\n");
    const has = (s: string, what: string) => assert.ok(items.some((i) => i.includes(s)), `${what}: "${s}" not in the report:\n${text}`);

    assert.ok(sizes.length >= 2, "a cover page and at least one table page");
    for (const [w, h] of sizes) assert.ok(Math.abs(w - 841.89) < 0.01 && Math.abs(h - 595.28) < 0.01, `every page is A4 landscape (${w} × ${h})`);
    has("Takeoff report", "title");
    has(plan.name, "plan name");
    has("1 January 2026", "date");
    has("lengths in mm, areas in m²", "units used");
    for (const r of deriveRooms(plan)) has(r.name, "room name");
    has(formatArea(buildSchedule(plan).totals.area, "m2"), "the schedule's total");
    const rows = plan.takeoffs!.map((t) => takeoffRow(plan, t));
    for (const r of rows) {
      const fmt = (v: number) => (r.takeoff.kind === "length" ? formatLength(v, units.length) : formatArea(v, units.area));
      has(r.takeoff.name, "takeoff name");
      has(fmt(r.measured!), `${r.takeoff.name}: measured`);
      if (r.takeoff.override) has(fmt(r.takeoff.override.value), `${r.takeoff.name}: override beside the measured value`);
    }
    assert.ok(rows.some((r) => r.takeoff.source === "pdf") && rows.some((r) => r.takeoff.source !== "pdf"), "both kinds of rows are in this plan");
    has("PDF dimensions", "the PDF dimension table");
    for (const st of new Set(rows.filter((r) => r.takeoff.source === "pdf").map((r) => r.status))) has({ ok: "OK", flagged: "Flagged", none: "No reference" }[st], "a PDF row's status");
    has("Flagged", "the overridden PDF row compares its MEASURED value, so stays as measured; the hall run is flagged");
    const v = planVerdict(plan, { detached: [], conflicts: [], refused: 0 });
    has(`Verdict: ${VERDICT_LABEL[v.level]}`, "verdict");
    for (const reason of v.reasons) has(reason, "verdict reason");
    has("Scale:", "scale source");
    has(REPORT_FOOTER, "footer");
    assert.equal(items.filter((i) => i === REPORT_FOOTER).length, sizes.length, "the footer on every page");
    assert.ok(!text.includes("0123456789abcdef"), "no asset id");
    assert.ok(!/\.(pdf|png|jpe?g|json)\b/i.test(text), "no file names");
    for (const w of plan.walls)
      for (const c of [w.a.x, w.a.y, w.b.x, w.b.y]) if (!Number.isInteger(c)) assert.ok(!items.some((i) => i.includes(String(c))), `no wall coordinate (${c}) in the text`);
    console.log(`  report: ${sizes.length} pages, ${items.length} text items, ${bytes.length} bytes`);
  }

  // ================================================================= 4. GLB round trip
  for (const [label, plan] of [["sample", samplePlan as Plan], ["plan-filled.pdf", filled]] as const) {
    const s = summaryOf(plan);
    const glb = await toGlb(s.plan);
    const names = glbNodeNames(glb);
    assert.deepEqual(names.filter((n) => n.startsWith("wall:")).sort(), s.plan.walls.map((w) => `wall:${w.id}`).sort(), `${label}: one node per wall, named by id`);
    assert.deepEqual(names.filter((n) => n.startsWith("floor:")).sort(), s.rooms.map((r) => `floor:${r.id}`).sort(), `${label}: one node per room floor, named by room id`);
    assert.equal(names.length, s.plan.walls.length + s.rooms.length, `${label}: nothing else in the file`);
    const scene = await glbScene(glb);
    const meshes: THREE.Mesh[] = [];
    scene.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh));
    const walls = meshes.filter((m) => m.userData.wallId);
    const floors = meshes.filter((m) => m.userData.roomId);
    assert.equal(walls.length, s.plan.walls.length, `${label}: the wall count parses back`);
    assert.equal(floors.length, s.rooms.length, `${label}: the room count parses back`);
    assert.deepEqual(floors.map((m) => m.userData.name).sort(), s.rooms.map((r) => r.name).sort(), `${label}: each floor carries its room's name (extras)`);
    // The net areas the file carries (extras, JSON doubles) are the Summary's to 1e-6 m².
    const carried = floors.reduce((sum, m) => sum + (m.userData.netArea as number), 0);
    assert.ok(Math.abs(carried - s.total) <= 1e-6, `${label}: floor area in the file ${carried} vs the Summary's ${s.total}`);
    // The triangles themselves: glTF stores positions as 32-bit floats (about 7 significant digits),
    // so the area read back from them is only that good: within 1e-6 RELATIVE (the sample's is 5.9e-6 m²
    // off on 74.695 m², 8e-8 relative). A 1e-6 m² bound on the triangles cannot hold at float32.
    const area = floors.reduce((sum, m) => sum + meshArea(m), 0);
    assert.ok(Math.abs(area - s.total) <= 1e-6 * s.total, `${label}: floor triangles' area ${area} vs the Summary's ${s.total} (diff ${Math.abs(area - s.total)})`);
    const box = new THREE.Box3().setFromObject(scene);
    const tallest = Math.max(...s.plan.walls.map((w) => w.height));
    assert.ok(Math.abs(box.min.y) < 1e-6 && Math.abs(box.max.y - tallest) < 1e-5, `${label}: Y up, metres (y ${box.min.y}..${box.max.y}, tallest wall ${tallest})`);
    for (const f of floors) assert.ok(Math.abs(new THREE.Box3().setFromObject(f).max.y) < 1e-9, `${label}: floors at y = 0`);
    console.log(`  GLB ${label}: ${walls.length} walls, ${floors.length} floors, floor area off by ${Math.abs(area - s.total).toExponential(1)} m²`);
  }

  // ================================================================= 5. OBJ
  {
    const s = summaryOf(samplePlan as Plan);
    const obj = toObj(s.plan);
    const counts = new Map<string, number>();
    let current = "";
    for (const line of obj.split("\n")) {
      if (line.startsWith("o ")) counts.set((current = line.slice(2).trim()), 0);
      else if (line.startsWith("v ")) counts.set(current, counts.get(current)! + 1);
    }
    const expected = new Map<string, number>();
    exportScene(s.plan).traverse((o) => (o as THREE.Mesh).isMesh && expected.set(o.name, (o as THREE.Mesh).geometry.getAttribute("position").count));
    assert.deepEqual(new Map([...counts].sort()), new Map([...expected].sort()), "OBJ objects and their vertex counts are the exported meshes'");
    assert.equal([...counts.keys()].filter((k) => k.startsWith("wall:")).length, s.plan.walls.length, "one OBJ object per wall");
    assert.equal([...counts.keys()].filter((k) => k.startsWith("floor:")).length, s.rooms.length, "one OBJ object per room floor");
    console.log(`  OBJ: ${counts.size} objects, ${[...counts.values()].reduce((a, b) => a + b, 0)} vertices`);
  }

  console.log("test-exports: OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
