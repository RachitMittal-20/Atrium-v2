/**
 * test-new-plan.ts — step N.1, the studio's way back and its first-run hint, at store level.
 *   - New plan (projectStore.newPlan) from an autosaved, edited plan: "sample" gives the shipped sample,
 *     "empty" gives a plan with nothing in it (the old takeoffs, calibration and drawing gone), each ONE undo
 *     step, Undo brings the edited plan back exactly, Redo returns the new one, nothing "Edited";
 *   - the autosave sees it: through the real startPersistence wiring and a fake localStorage, the
 *     stored plan after a flush is the new plan, and after Undo the edited one again;
 *   - the saved baseline follows it (isDirty is false right after, true after an edit) and the panes' epoch goes up;
 *   - the hint's flag logic (src/lib/studioHint.ts, src/store/hintStore.ts): shown for the untouched sample and for an
 *     empty plan, not after one edit, not for a sample that went through the autosave and back, not once dismissed,
 *     and the dismissal is read back on a new "page load" and lives only under its own localStorage key.
 * Run: npx tsx scripts/test-new-plan.ts
 */
import assert from "node:assert/strict";
import { samplePlan } from "../src/data/samplePlan";
import { parseStoredPlan, serializePlan, STORAGE_KEY, type KeyValueStore } from "../src/lib/persist/planStorage";
import { isEmptyPlan, isUntouchedSample, planSignature, showHint } from "../src/lib/studioHint";
import { HINT_KEY, restoreHint, useHintStore } from "../src/store/hintStore";
import { flushSavedPlan, startPersistence } from "../src/store/persistence";
import { usePlanStore } from "../src/store/planStore";
import { isDirty, markSaved, newPlan, useProjectStore } from "../src/store/projectStore";
import type { Plan } from "../src/types/plan";

const s = () => usePlanStore.getState();

/** A localStorage stand-in. */
function fakeStorage() {
  const data = new Map<string, string>();
  const store: KeyValueStore & { data: Map<string, string> } = {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
  return store;
}

const storage = fakeStorage();
const g = globalThis as unknown as Record<string, unknown>;
g.window = { localStorage: storage, addEventListener: () => {} };
g.document = { addEventListener: () => {}, visibilityState: "visible" };

// ---------------------------------------------------------------- the visitor arrives with an edited, autosaved plan
{
  s().loadPlan(structuredClone(samplePlan));
  s().renamePlan("Flat on Elm Street");
  assert.equal(s().calibratePlan(1.02, "tape measure"), null, "test setup: a calibration");
  s().addTakeoff({ name: "North run", kind: "length", points: [[0, 0], [4, 0]] });
  s().deleteWall("w-BC");
  storage.setItem(STORAGE_KEY, serializePlan(s().plan));
  const edited: Plan = structuredClone(s().plan);
  assert.ok(edited.takeoffs?.length && edited.calibrations?.length, "test setup: the edited plan has a takeoff and a calibration");

  s().loadPlan(structuredClone(samplePlan)); // a page load starts from the sample ...
  startPersistence(); // ... and restores the autosave
  assert.equal(s().plan.name, "Flat on Elm Street", "arrived with the old autosave");
  assert.ok(!showHint(s().plan, false), "an edited plan does not get the hint");
  markSaved();
  s().renamePlan("Flat on Elm Street 2"); // unsaved work
  assert.ok(isDirty(), "there is unsaved work");
  const editedLive: Plan = structuredClone(s().plan);
  const pastBefore = s().past.length;
  const epoch = useProjectStore.getState().epoch;

  // ---- New plan > sample
  newPlan("sample");
  assert.equal(planSignature(s().plan), planSignature(samplePlan), "New plan > sample: the shipped sample");
  assert.equal(s().plan.takeoffs, undefined, "the old takeoffs are gone");
  assert.equal(s().plan.calibrations, undefined, "and the calibration");
  assert.equal(s().past.length, pastBefore + 1, "one undo step");
  assert.ok(!isDirty(), "a new plan is the saved baseline: nothing to lose");
  assert.equal(useProjectStore.getState().epoch, epoch + 1, "both panes remount to fit it");
  assert.ok(s().plan.walls.every((w) => w.edited === undefined) && s().plan.openings.every((o) => o.edited === undefined), "nothing becomes Edited");
  assert.ok(showHint(s().plan, false) && isUntouchedSample(s().plan), "and it is an untouched sample: the hint shows");
  const asSample: Plan = structuredClone(s().plan);

  // the autosave sees it
  flushSavedPlan();
  assert.deepEqual(parseStoredPlan(storage.getItem(STORAGE_KEY)), asSample, "autosave stored the new plan");
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)!).plan.name, samplePlan.name);

  s().undo();
  assert.deepEqual(s().plan, editedLive, "Ctrl+Z brings the old plan back exactly");
  flushSavedPlan();
  assert.deepEqual(parseStoredPlan(storage.getItem(STORAGE_KEY)), editedLive, "and the autosave follows the undo");
  s().redo();
  assert.deepEqual(s().plan, asSample, "Redo returns the new plan");
  s().undo();

  // ---- New plan > empty
  newPlan("empty");
  assert.ok(isEmptyPlan(s().plan) && s().plan.rooms.length === 0, "New plan > empty: nothing in it");
  assert.equal(s().plan.takeoffs, undefined);
  assert.equal(s().plan.background, undefined);
  assert.equal(s().past.length, pastBefore + 1, "one undo step");
  assert.ok(showHint(s().plan, false), "an empty plan gets the hint");
  flushSavedPlan();
  assert.deepEqual(parseStoredPlan(storage.getItem(STORAGE_KEY)), s().plan, "autosave stored the empty plan, and the strict reader accepts it");
  s().addWall({ a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, thickness: 0.15, height: 2.7 });
  assert.ok(isDirty() && !showHint(s().plan, false), "one wall later: unsaved, and no hint");
  s().undo();
  s().undo();
  assert.deepEqual(s().plan, editedLive, "two undos: back to the edited plan");
}

// ---------------------------------------------------------------- the hint's flag logic
{
  s().loadPlan(structuredClone(samplePlan));
  assert.ok(showHint(s().plan, false), "the untouched sample shows it");
  assert.ok(!showHint(s().plan, true), "not once dismissed");
  s().renamePlan("Mine");
  assert.ok(!showHint(s().plan, false), "one edit (a rename) and it is gone");
  s().loadPlan(structuredClone(samplePlan));
  s().moveWallEndpoint("w-AB", "a", { x: -0.5, y: 0 });
  assert.ok(!showHint(s().plan, false), "moving a wall is an edit");
  // a sample that went through the autosave and back is still untouched
  s().loadPlan(parseStoredPlan(serializePlan(structuredClone(samplePlan)))!);
  assert.ok(showHint(s().plan, false), "an untouched sample restored from storage still shows it");

  // dismissal: its own key, read back on a new page load
  const other = JSON.stringify({ keep: "me" });
  storage.setItem("atrium.units", other);
  restoreHint();
  assert.equal(useHintStore.getState().dismissed, false, "not dismissed on a first visit");
  useHintStore.getState().dismiss();
  assert.equal(storage.getItem(HINT_KEY), JSON.stringify({ dismissed: true }), "stored under its own key, nothing else");
  assert.equal(storage.getItem("atrium.units"), other, "other settings untouched");
  useHintStore.setState({ dismissed: false }); // a new page load forgets memory ...
  restoreHint(); // ... and reads storage
  assert.equal(useHintStore.getState().dismissed, true, "still dismissed after a reload");
  assert.ok(!showHint(s().plan, useHintStore.getState().dismissed), "so the hint does not come back");
  assert.ok(!JSON.stringify(s().plan).includes("dismiss"), "never in the plan");
  storage.setItem(HINT_KEY, "{garbled");
  restoreHint();
  assert.equal(useHintStore.getState().dismissed, false, "a garbled entry means not dismissed");
}

console.log("new plan: sample and empty are one undo step, autosave follows, hint logic and its dismissal checked");
delete g.window;
delete g.document;
