/**
 * test-project-file.ts — asserts for step E.1, the project file (name.atrium.json): the pure
 * format (src/lib/persist/projectFile.ts) and the store actions around it (replacePlan in
 * src/store/planStore.ts, save and open in src/store/projectStore.ts).
 *   - round trip: save then open gives an identical plan, with takeoffs, calibrations, the
 *     background mapping and imported-item descriptors;
 *   - assets by content hash: bytes survive base64 and land in another asset store under the same
 *     id; without "include", no assets are written and the asset shows the existing missing state;
 *   - a wrong file, a newer version, damage, a bad asset and an oversize file each give a plain
 *     message and change NOTHING (plan, history, asset store);
 *   - opening is exactly one undo step, and redo puts the opened plan back;
 *   - an old plan with none of the newer fields loads;
 *   - view settings never reach the file; a "__proto__" key pollutes nothing.
 * Runs on Linux (CI): no compressed or time-zone-dependent output is compared, no gitignored input.
 * Run: npx tsx scripts/test-project-file.ts (throws on the first failure).
 */
import assert from "node:assert/strict";
import { samplePlan } from "../src/data/samplePlan";
import { assetIdOf, memoryAssetStore } from "../src/lib/import/assetStore";
import { setAssetStoreForTests } from "../src/lib/import/assetCache";
import { SCHEMA_VERSION } from "../src/lib/persist/planStorage";
import { buildProject, checkProjectSize, MAX_PROJECT_BYTES, PROJECT_FORMAT, readProject, referencedAssetIds } from "../src/lib/persist/projectFile";
import { usePlanStore } from "../src/store/planStore";
import { isDirty, markSaved, openProject, saveProject } from "../src/store/projectStore";
import type { ImportInfo, Plan } from "../src/types/plan";

const s = () => usePlanStore.getState();
const bytes = (...n: number[]) => new Uint8Array(n);

/** A plan with everything the file must carry, built through the real store actions. */
async function richPlan(store: ReturnType<typeof memoryAssetStore>): Promise<{ plan: Plan; modelId: string; drawingId: string }> {
  s().loadPlan(structuredClone(samplePlan));
  const w = s().plan.walls[0];
  s().addTakeoff({ name: "North wall", kind: "length", points: [[w.a.x, w.a.y], [w.b.x, w.b.y]], reference: { value: 4.1, note: "printed" } });
  s().addTakeoff({ name: "Floor", kind: "area", points: [[0, 0], [3, 0], [3, 2]], cutouts: [[[0.5, 0.2], [1, 0.2], [1, 0.5]]] });
  assert.equal(s().calibratePlan(1.02, "checked against the drawing"), null);
  const drawingId = await store.put("plan.pdf", [{ name: "plan.pdf", bytes: bytes(37, 80, 68, 70, 45, 1, 2, 3, 250, 251, 252) }]);
  s().setBackground({ assetId: drawingId, kind: "pdf", page: 1, mapping: { a: 0.0123, b: 0, c: 0, d: 0.0123, e: -1.5, f: -2.25 } });
  const modelId = await store.put("chair.obj", [
    { name: "chair.obj", bytes: bytes(118, 32, 48, 32, 48, 32, 48, 10, 0, 255) },
    { name: "chair.mtl", bytes: bytes(110, 101, 119, 109, 116, 108, 10) },
  ]);
  const info: ImportInfo = { assetId: modelId, name: "Chair", format: "obj", unitToMetres: 0.01, upAxis: "y", doubleSided: false, nodeOverrides: { "0/1": { hidden: true }, "2": { transform: { t: [0.1, 0, -0.2], rotY: 0.5, s: 1.5 } } } };
  s().addImportedItem(info, { x: 2, y: 0, z: 3 });
  return { plan: structuredClone(s().plan), modelId, drawingId };
}

const NOW = new Date("2026-10-21T09:00:00Z");

async function main() {
  const from = memoryAssetStore();
  setAssetStoreForTests(from);
  const { plan, modelId, drawingId } = await richPlan(from);
  assert.deepEqual(referencedAssetIds(plan).sort(), [drawingId, modelId].sort(), "the plan names the drawing and the model");

  // ---- 1. round trip: the plan, byte for byte as data
  {
    const assets = [(await from.get(modelId))!, (await from.get(drawingId))!];
    const text = buildProject(plan, assets, NOW);
    const file = JSON.parse(text);
    assert.deepEqual(Object.keys(file), ["format", "schema", "savedAt", "plan", "assets"], "a project file holds a format, a version, a time, the plan and the assets, nothing else");
    assert.equal(file.format, PROJECT_FORMAT);
    assert.equal(file.schema, SCHEMA_VERSION);
    assert.equal(file.savedAt, "2026-10-21T09:00:00.000Z");
    assert.ok(!/atrium\.(units|labels|background)|"detail"|"camera"|"opacity"/.test(text), "view settings (units, labels, camera, drawing opacity) never reach the file");
    const back = await readProject(text);
    assert.ok(back.ok, back.ok ? "" : back.error);
    assert.deepEqual(back.plan, plan, "save then open gives an identical plan");
    assert.equal(back.plan.takeoffs?.length, 2);
    assert.equal(back.plan.calibrations?.[0].factor, 1.02);
    assert.deepEqual(back.plan.background, plan.background, "the background mapping is exact");
    assert.deepEqual(back.plan.items.find((i) => i.import)?.import, plan.items.find((i) => i.import)?.import, "the imported item's descriptor is exact");
    console.log("round trip: plan, takeoffs, calibrations, background mapping and item descriptors identical");

    // ---- 2. assets by hash, into a different store
    assert.equal(back.assets.length, 2);
    const to = memoryAssetStore();
    for (const a of back.assets) assert.equal(await to.put(a.name, a.files), a.id, "stored under the content hash it was saved with");
    for (const id of [modelId, drawingId]) {
      const a = (await from.get(id))!;
      const b = (await to.get(id))!;
      assert.ok(b, `${id} is in the new store`);
      assert.deepEqual(b.files.map((f) => [f.name, [...f.bytes]]), a.files.map((f) => [f.name, [...f.bytes]]), "the bytes are the same");
      assert.equal(await assetIdOf(b.files), id, "and hash to the same id");
    }
    // without the assets: the plan alone, and the missing state is the existing one (no bytes in the store)
    const lean = buildProject(plan, [], NOW);
    assert.ok(!("assets" in JSON.parse(lean)), "no assets key when none are included");
    const leanBack = await readProject(lean);
    assert.ok(leanBack.ok && leanBack.assets.length === 0);
    assert.deepEqual(leanBack.ok && leanBack.plan, plan);
    assert.ok(lean.length < text.length / 2 || text.length < 20000, "and the file is smaller");
    console.log("assets: bytes and ids survive base64 into another store; without them the file holds the plan only");
  }

  // ---- 3. save and open through the store, one undo step
  {
    const to = memoryAssetStore();
    setAssetStoreForTests(from);
    const saved = await saveProject(true, NOW);
    assert.equal(saved.missing, 0);
    assert.equal(saved.text, buildProject(plan, [(await from.get(modelId))!, (await from.get(drawingId))!], NOW), "saveProject reads the plan's assets from the store");
    const parsed = JSON.parse(saved.text);
    assert.deepEqual(parsed.assets.map((a: { id: string }) => a.id), [...parsed.assets.map((a: { id: string }) => a.id)].sort(), "assets are written in id order, so the file is deterministic");

    // a different session: other plan, other (empty) asset store, some history
    setAssetStoreForTests(to);
    s().loadPlan(structuredClone(samplePlan));
    s().renamePlan("Something else");
    const before = s().plan;
    const pastBefore = s().past.length;
    markSaved();
    assert.ok(!isDirty(), "just saved: nothing unsaved");
    s().renamePlan("Edited after");
    assert.ok(isDirty(), "an edit after saving is unsaved");
    const pastMid = s().past.length;
    const opened = await openProject({ size: saved.text.length, text: async () => saved.text });
    assert.ok(opened.ok, opened.ok ? "" : opened.error);
    assert.deepEqual(s().plan, plan, "opening replaces the plan with the saved one");
    assert.equal(s().past.length, pastMid + 1, "opening is exactly one undo step");
    assert.ok(!isDirty(), "and what was just opened is not 'unsaved'");
    assert.ok(await to.has(modelId) && (await to.has(drawingId)), "both assets are in the store after opening");
    s().undo();
    assert.equal(s().plan.name, "Edited after", "one undo brings the previous plan back");
    assert.equal(s().past.length, pastMid);
    assert.notEqual(s().plan, before, "(it is the plan as it was just before opening)");
    s().redo();
    assert.deepEqual(s().plan, plan, "redo puts the opened plan back");
    assert.ok(s().past.length > pastBefore);
    console.log("store: open replaces the plan in one undo step, writes the assets, and unsaved state follows save and open");
  }

  // ---- 4. a file with no assets: the existing "missing" state (the bytes are simply not there)
  {
    const empty = memoryAssetStore();
    setAssetStoreForTests(empty);
    s().loadPlan(structuredClone(samplePlan));
    const text = buildProject(plan, [], NOW);
    const opened = await openProject({ size: text.length, text: async () => text });
    assert.ok(opened.ok);
    assert.deepEqual(s().plan, plan);
    assert.equal(await empty.has(modelId), false, "no asset bytes were invented: the model shows 'Import it again'");
    console.log("no assets: the plan opens, the asset store stays empty (missing state)");
  }

  // ---- 5. refusals change nothing, in plain words
  {
    const store = memoryAssetStore();
    setAssetStoreForTests(store);
    s().loadPlan(structuredClone(samplePlan));
    s().renamePlan("Untouched");
    const planBefore = s().plan;
    const pastBefore = s().past.length;
    const good = JSON.parse(buildProject(plan, [(await from.get(modelId))!, (await from.get(drawingId))!], NOW));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pokes at arbitrary JSON
    const variant = (mutate: (f: any) => void) => {
      const f = structuredClone(good);
      mutate(f);
      return JSON.stringify(f);
    };
    const cases: [string, string, RegExp][] = [
      ["empty file", "", /isn't an Atrium project/],
      ["not JSON", "not json {{{", /isn't an Atrium project/],
      ["a different JSON file", '{"hello":"world"}', /isn't an Atrium project/],
      ["an array", "[]", /isn't an Atrium project/],
      ["the browser's autosave envelope (no format tag)", JSON.stringify({ schema: 1, savedAt: "x", plan }), /isn't an Atrium project/],
      ["a newer version", variant((f) => (f.schema = SCHEMA_VERSION + 1)), /newer version of Atrium/],
      ["no version", variant((f) => delete f.schema), /damaged/],
      ["a version of 0", variant((f) => (f.schema = 0)), /damaged/],
      ["a fractional version", variant((f) => (f.schema = 1.5)), /damaged/],
      ["truncated", JSON.stringify(good).slice(0, 400), /damaged|isn't an Atrium project/],
      ["a wall with no ends", variant((f) => delete f.plan.walls[0].a), /damaged/],
      ["an opening on a wall that is not there", variant((f) => (f.plan.openings[0].wallId = "nope")), /damaged/],
      ["no plan", variant((f) => delete f.plan), /damaged/],
      ["assets that are not a list", variant((f) => (f.assets = "x")), /damaged/],
      ["an asset with bad base64", variant((f) => (f.assets[0].files[0].data = "not base64!!")), /damaged/],
      ["an asset whose bytes do not match its id", variant((f) => (f.assets[0].files[0].data = "AAAA")), /damaged/],
      ["an asset with no files", variant((f) => (f.assets[0].files = [])), /damaged/],
      ["an asset with a file name that is not text", variant((f) => (f.assets[0].files[0].name = 7)), /damaged/],
      ["an asset id that is not a hash", variant((f) => (f.assets[0].id = "../../etc")), /damaged/],
      ["two assets with one id", variant((f) => (f.assets[1].id = f.assets[0].id)), /damaged/],
    ];
    for (const [what, text, message] of cases) {
      const out = await openProject({ size: text.length, text: async () => text });
      assert.ok(!out.ok, `${what}: refused`);
      if (!out.ok) assert.match(out.error, message, `${what}: says why in plain words (${out.error})`);
      assert.equal(s().plan, planBefore, `${what}: the plan is the same object`);
      assert.equal(s().past.length, pastBefore, `${what}: no history was added`);
      assert.deepEqual(await store.list(), [], `${what}: no asset was written`);
    }
    // oversize: refused from the size alone, the file is never read
    assert.equal(checkProjectSize(MAX_PROJECT_BYTES), null, "exactly the limit is allowed");
    assert.match(checkProjectSize(MAX_PROJECT_BYTES + 1) ?? "", /200 MB/, "one byte over is refused");
    let read = false;
    const big = await openProject({ size: MAX_PROJECT_BYTES + 1, text: async () => ((read = true), "{}") });
    assert.ok(!big.ok && /200 MB/.test(big.error), "an oversize file gives a plain error");
    assert.equal(read, false, "and is not even read");
    assert.equal(s().plan, planBefore);
    assert.equal(s().past.length, pastBefore);
    // text that is longer than the size it claimed is refused too (a lying size cannot sneak a big file in)
    const liar = await readProject("x".repeat(64), MAX_PROJECT_BYTES + 1);
    assert.ok(!liar.ok && /200 MB/.test(liar.error));
    console.log(`refusals: ${cases.length} bad files and an oversize one each give a plain error and change nothing`);
  }

  // ---- 6. an old plan, none of the newer fields, loads (a project file with no assets and no takeoffs, calibrations or background)
  {
    const old = JSON.stringify({ format: PROJECT_FORMAT, schema: SCHEMA_VERSION, savedAt: "2026-01-01T00:00:00Z", plan: samplePlan });
    const out = await readProject(old);
    assert.ok(out.ok, out.ok ? "" : out.error);
    for (const k of ["takeoffs", "calibrations", "background"]) assert.ok(!(k in out.plan), `no ${k} field appears`);
    assert.equal(out.plan.walls.length, samplePlan.walls.length);
    assert.deepEqual(out.assets, []);
    setAssetStoreForTests(memoryAssetStore());
    const opened = await openProject({ size: old.length, text: async () => old });
    assert.ok(opened.ok);
    assert.equal(s().plan.name, samplePlan.name);
    console.log("old plan: a project without the newer fields opens and gains none");
  }

  // ---- 7. hostile content is inert
  {
    const good = JSON.parse(buildProject(samplePlan, [], NOW));
    const text = JSON.stringify(good).replace('"format"', '"__proto__":{"polluted":true},"format"').replace('"walls"', '"constructor":{"prototype":{"polluted2":true}},"walls"');
    const out = await readProject(text);
    assert.ok(out.ok, out.ok ? "" : out.error);
    assert.equal(({} as Record<string, unknown>).polluted, undefined, "__proto__ in the file pollutes nothing");
    assert.equal(({} as Record<string, unknown>).polluted2, undefined);
    assert.ok(!JSON.stringify(out.plan).includes("polluted"), "and stray keys never reach the plan");
    const named = JSON.stringify({ ...good, plan: { ...good.plan, name: "<img src=x onerror=alert(1)>" } });
    const n = await readProject(named);
    assert.ok(n.ok && n.plan.name === "<img src=x onerror=alert(1)>", "text is data: kept as text (the UI only ever renders it as text)");
    console.log("hostile content: stray and __proto__ keys are dropped, text stays text");
  }
}

main().then(
  () => console.log("OK"),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
