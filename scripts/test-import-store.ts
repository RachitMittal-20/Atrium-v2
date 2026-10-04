/**
 * test-import-store.ts — asserts for where imported models live (step I.1): the
 * Plan's Item.import through planStorage (old plans unchanged, new ones round-trip,
 * no file bytes in the autosave), the plan store's import actions (add, update,
 * hide, delete a node, restore, delete the item: each ONE undo step, redo works),
 * the in-memory asset store against the interface (the same bytes give the same id),
 * an asset kept after its item is deleted so Undo brings the model back, and a
 * missing asset giving the placeholder state.
 * Run: npx tsx scripts/test-import-store.ts (throws on the first failure).
 */
import assert from "node:assert/strict";
import { samplePlan } from "../src/data/samplePlan";
import { assetIdOf, memoryAssetStore } from "../src/lib/import/assetStore";
import { requestAsset, setAssetStoreForTests, useAssetCache } from "../src/lib/import/assetCache";
import { parseStoredPlan, serializePlan } from "../src/lib/persist/planStorage";
import { validatePlan } from "../src/lib/plan/validate";
import { deriveRooms } from "../src/lib/plan/rooms";
import { collisionStats, getCollision } from "../src/lib/walk/collision";
import { usePlanStore } from "../src/store/planStore";
import { useSelectionStore } from "../src/store/selectionStore";
import type { ImportInfo, Plan } from "../src/types/plan";
import { CUBE, makeGlb } from "./make-import-fixtures";

const s = () => usePlanStore.getState();
const fresh = () => s().loadPlan(structuredClone(samplePlan));

async function main() {
  // ---------------------------------------------------------------- the in-memory asset store honours the interface
  const store = memoryAssetStore();
  setAssetStoreForTests(store);
  const MARK = "ATRIUM-ASSET-BYTES-MARKER";
  const glb = makeGlb([{ ...CUBE, name: MARK }]); // the marker is inside the file's bytes (its JSON chunk)
  const files = [{ name: "cube.glb", bytes: glb }];
  const id = await store.put("Cube", files);
  assert.match(id, /^[0-9a-f]{16}$/, "the id is 16 hex characters");
  assert.equal(await store.put("Cube again", [{ name: "other-name.glb", bytes: glb.slice() }]), id, "the same bytes give the same id, whatever the name");
  assert.equal(id, await assetIdOf(files));
  assert.notEqual(await assetIdOf([{ name: "x.glb", bytes: makeGlb([CUBE]) }]), id, "different bytes, a different id");
  const pair = [{ name: "t.obj", bytes: new Uint8Array([1, 2]) }, { name: "t.mtl", bytes: new Uint8Array([3]) }];
  assert.equal(await assetIdOf(pair), await assetIdOf([...pair].reverse()), "several files: the order they were picked in doesn't matter");
  assert.equal(await store.has(id), true);
  assert.deepEqual((await store.get(id))!.files[0].bytes, glb, "get gives the bytes back");
  assert.equal(await store.get("0000000000000000"), null);
  assert.deepEqual(await store.list(), [{ id, name: "Cube", bytes: glb.length }], "list: one entry, stored once");
  const other = await store.put("Pair", pair);
  await store.remove(other);
  assert.equal(await store.has(other), false, "remove");

  // ---------------------------------------------------------------- planStorage: old plans unchanged, imported items round-trip, no bytes
  fresh();
  const old = { ...structuredClone(samplePlan), items: [{ id: "i-old", catalogId: "sofa-01", position: { x: 1, y: 0, z: 1 }, rotationY: 0, scale: 1, colorOverrides: {} }] };
  assert.deepEqual(parseStoredPlan(JSON.stringify({ schema: 1, savedAt: "2026-01-01T00:00:00.000Z", plan: old })), old, "an old plan's JSON, without import fields, loads unchanged");

  const info: ImportInfo = { assetId: id, name: "Cube", format: "glb", unitToMetres: 1, upAxis: "y", doubleSided: false, nodeOverrides: {} };
  const historyBefore = s().past.length;
  const itemId = s().addImportedItem(info, { x: 4, y: 0, z: 3 });
  assert.equal(s().past.length, historyBefore + 1, "add: one undo step");
  const item = s().plan.items.find((i) => i.id === itemId)!;
  assert.equal(item.catalogId, `import:${id}`, 'catalogId is "import:" + the asset id');
  assert.deepEqual(item.import, info);
  assert.notEqual(item.import, info, "the store keeps its own copy");
  const raw = serializePlan(s().plan);
  assert.deepEqual(parseStoredPlan(raw), s().plan, "a plan with an imported item round-trips through planStorage");
  assert.ok(!raw.includes(MARK), "the autosave payload contains none of the file's bytes");
  assert.ok(!raw.includes(Buffer.from(glb).toString("base64").slice(0, 40)), "not even base64-encoded");
  assert.ok(raw.length < serializePlan(samplePlan).length + 600, `and grows only by the item's settings (${raw.length} bytes)`);

  // step I.1b: part transforms. An old plan whose nodeOverrides have no transform loads unchanged; one with part
  // transforms round-trips; a bad transform makes the stored plan untrusted (ignored, like any other bad shape)
  {
    const withFlags = { ...structuredClone(samplePlan), items: [{ id: "i-flags", catalogId: `import:${id}`, position: { x: 1, y: 0, z: 1 }, rotationY: 0, scale: 1, colorOverrides: {}, import: { ...info, nodeOverrides: { "0": { hidden: true }, "1/2": { deleted: true } } } }] };
    assert.deepEqual(parseStoredPlan(JSON.stringify({ schema: 1, savedAt: "2026-01-01T00:00:00.000Z", plan: withFlags })), withFlags, "I.1a nodeOverrides (no transform) load unchanged");
    const moved = structuredClone(withFlags);
    moved.items[0].import.nodeOverrides = { "0": { hidden: true, transform: { t: [0.25, -0.1, 0.5], rotY: 0.7853981633974483, s: 1.5 } }, "1/0": { transform: { t: [0, 0, 0.2], rotY: 0, s: 1 } } } as never;
    const back = parseStoredPlan(serializePlan(moved as Plan));
    assert.deepEqual(back, moved, "part transforms round-trip through planStorage");
    for (const bad of [{ t: [0, 0], rotY: 0, s: 1 }, { t: [0, 0, 0], rotY: 0, s: 0 }, { t: [0, "1", 0], rotY: 0, s: 1 }, { t: [0, 0, 0], s: 1 }]) {
      const broken = structuredClone(moved);
      (broken.items[0].import.nodeOverrides as Record<string, unknown>)["1/0"] = { transform: bad };
      assert.equal(parseStoredPlan(serializePlan(broken as Plan)), null, `a malformed transform is refused: ${JSON.stringify(bad)}`);
    }
    assert.ok(!serializePlan(moved as Plan).includes(MARK), "still no file bytes in the autosave");
  }

  // imported models are meshes only: the validator, rooms and collision ignore them
  const withModel = s().plan;
  const without = { ...withModel, items: [] };
  assert.deepEqual(validatePlan(withModel), validatePlan(without), "validatePlan ignores imported items");
  assert.deepEqual(deriveRooms(withModel), deriveRooms(without), "rooms ignore them");
  getCollision(withModel);
  const builds = collisionStats.builds;
  s().updateItem(itemId, { position: { x: 5, y: 0, z: 3 } });
  getCollision(s().plan);
  assert.equal(collisionStats.builds, builds, "collision is not rebuilt when a model moves (it reads walls and openings only)");
  s().undo();
  const again = itemId;

  // ---------------------------------------------------------------- plan store actions: ONE undo step each, redo works
  const step = (what: string, act: () => void, check: (p: Plan) => void) => {
    const before = structuredClone(s().plan);
    const n = s().past.length;
    act();
    assert.equal(s().past.length, n + 1, `${what}: exactly one undo step`);
    const after = structuredClone(s().plan);
    check(after);
    s().undo();
    assert.deepEqual(s().plan, before, `${what}: one undo puts it back`);
    s().redo();
    assert.deepEqual(s().plan, after, `${what}: redo applies it again`);
  };
  const it = () => s().plan.items.find((i) => i.id === again)!;
  step("update position, turn and scale", () => s().updateItem(again, { position: { x: 1, y: 0.5, z: 2 }, rotationY: Math.PI / 2, scale: 1.5 }), () => {
    assert.deepEqual(it().position, { x: 1, y: 0.5, z: 2 });
    assert.equal(it().scale, 1.5);
  });
  step("rename", () => s().updateItem(again, { import: { ...it().import!, name: "Box" } }), () => assert.equal(it().import!.name, "Box"));
  step("hide a node", () => s().setNodeOverride(again, "0", { hidden: true }), () => assert.deepEqual(it().import!.nodeOverrides, { "0": { hidden: true } }));
  step("delete a node", () => s().setNodeOverride(again, "0", { hidden: true, deleted: true }), () => assert.deepEqual(it().import!.nodeOverrides, { "0": { hidden: true, deleted: true } }));
  s().setNodeOverride(again, "1/2", { deleted: true });
  step(
    "restore every deleted node (the panel's one transaction)",
    () =>
      s().transaction(() => {
        for (const [path, o] of Object.entries(it().import!.nodeOverrides)) if (o.deleted) s().setNodeOverride(again, path, { hidden: o.hidden });
      }),
    () => assert.deepEqual(it().import!.nodeOverrides, { "0": { hidden: true } }, "deleted flags gone, a hidden part stays hidden"),
  );
  step("show it again (false flags are dropped, not stored)", () => s().setNodeOverride(again, "0", { hidden: false }), () => assert.deepEqual(it().import!.nodeOverrides, {}));

  // ---------------------------------------------------------------- deleting an item keeps its asset, so Undo works
  useSelectionStore.getState().selectItem(again);
  step("delete the item", () => s().deleteItem(again), (p) => assert.equal(p.items.some((i) => i.id === again), false));
  s().undo(); // the item is back…
  assert.ok(s().plan.items.some((i) => i.id === again));
  s().deleteItem(again);
  assert.equal(useSelectionStore.getState().itemId, null, "the selection lets go of a deleted item");
  assert.equal(await store.has(id), true, "the asset is kept when its item is deleted");
  s().undo();
  await requestAsset(id);
  const back = useAssetCache.getState().assets[id];
  assert.equal(back?.status, "ready", "after Undo the model loads again from the store");
  assert.equal(back?.status === "ready" && back.model.stats.triangles, 12);

  // ---------------------------------------------------------------- a missing asset gives the placeholder state
  const gone = "fedcba9876543210";
  s().addImportedItem({ ...info, assetId: gone, name: "Lost chair" }, { x: 0, y: 0, z: 0 });
  await requestAsset(gone);
  assert.deepEqual(useAssetCache.getState().assets[gone], { status: "missing" }, "no bytes in the store: missing (the 3D view draws the grey box)");
  // bytes that no longer parse: an error state with a plain message
  const brokenId = await store.put("Broken", [{ name: "broken.glb", bytes: new Uint8Array([1, 2, 3]) }]);
  await requestAsset(brokenId);
  const broken = useAssetCache.getState().assets[brokenId];
  assert.equal(broken?.status, "error");
  assert.match(broken?.status === "error" ? broken.message : "", /doesn't look like a GLB file/);

  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
