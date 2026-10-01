/**
 * test-persist.ts — asserts for browser-local autosave: the stored format and
 * strict reader (src/lib/persist/planStorage.ts), the debounce (driven by a fake
 * clock), the store wiring (src/store/persistence.ts, with a fake localStorage)
 * and, importantly, that a save → reload keeps room names, walls, openings and
 * valid room loops — including a concave (L-shaped) room's custom name through a
 * later edit that changes its wall loop (the label-point matching in rooms.ts).
 * Run: npx tsx scripts/test-persist.ts (throws on the first failure).
 */
import assert from "node:assert/strict";
import { samplePlan } from "../src/data/samplePlan";
import {
  AUTOSAVE_DELAY_MS,
  AUTOSAVE_MAX_WAIT_MS,
  createAutosaver,
  loadSavedPlan,
  parseStoredPlan,
  SCHEMA_VERSION,
  serializePlan,
  STORAGE_KEY,
  type KeyValueStore,
  type SaveStatus,
  type Timers,
} from "../src/lib/persist/planStorage";
import { JOINT_EPS, wallLength } from "../src/lib/plan/geometry";
import { deriveRooms, pointInPolygon } from "../src/lib/plan/rooms";
import { validatePlan } from "../src/lib/plan/validate";
import { restoreSavedPlan, startPersistence, useSaveStatus } from "../src/store/persistence";
import { usePlanStore } from "../src/store/planStore";
import { useSelectionStore } from "../src/store/selectionStore";
import { useToolStore } from "../src/store/toolStore";
import type { Plan } from "../src/types/plan";

const s = () => usePlanStore.getState();
const fresh = () => s().loadPlan(structuredClone(samplePlan));
const roomName = (p: Plan, id: string) => p.rooms.find((r) => r.id === id)?.name;

/** A localStorage stand-in that counts writes. */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const store: KeyValueStore & { writes: number; data: Map<string, string>; failWrites: boolean } = {
    writes: 0,
    data,
    failWrites: false,
    getItem: (k) => data.get(k) ?? null,
    setItem(k, v) {
      if (store.failWrites) throw new Error("QuotaExceededError");
      store.writes++;
      data.set(k, v);
    },
    removeItem: (k) => void data.delete(k),
  };
  return store;
}

/** A clock the test advances by hand; timers fire in order of their due time. */
function fakeClock() {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    set: (fn, ms) => {
      pending.set(next, { at: now + ms, fn });
      return next++;
    },
    clear: (h) => void pending.delete(h as number),
    now: () => now,
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...pending.entries()].filter(([, t]) => t.at <= end).sort((p, q) => p[1].at - q[1].at)[0];
      if (!due) break;
      pending.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = end;
  };
  return { timers, advance, pendingCount: () => pending.size };
}

/** Every room's wall loop is a closed chain of existing walls: each wall shares a joint with the next. */
function assertLoopsValid(plan: Plan, tag: string) {
  const walls = new Map(plan.walls.map((w) => [w.id, w]));
  const near = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y) < JOINT_EPS;
  for (const room of plan.rooms) {
    assert.ok(room.wallIds.length >= 3, `${tag}: ${room.name} has at least 3 walls`);
    const loop = room.wallIds.map((id) => walls.get(id));
    assert.ok(loop.every(Boolean), `${tag}: every wall of ${room.name} exists`);
    loop.forEach((w, i) => {
      const nx = loop[(i + 1) % loop.length]!;
      const shared = [w!.a, w!.b].some((p) => near(p, nx.a) || near(p, nx.b));
      assert.ok(shared, `${tag}: ${room.name}: ${w!.id} and ${nx.id} meet at a joint`);
    });
  }
  // and the loops are exactly what the walls enclose
  const derived = deriveRooms(plan);
  assert.equal(derived.length, plan.rooms.length, `${tag}: same number of rooms as the walls enclose`);
  for (const d of derived) {
    const stored = plan.rooms.find((r) => r.id === d.id);
    assert.ok(stored && stored.wallIds.length === d.wallIds.length && stored.wallIds.every((id) => d.wallIds.includes(id)), `${tag}: stored loop of ${d.name} matches the walls`);
  }
}

// ---------------------------------------------------------------- format

fresh();
{
  const raw = serializePlan(s().plan, new Date("2026-05-01T10:00:00Z"));
  const env = JSON.parse(raw);
  assert.deepEqual(Object.keys(env).sort(), ["plan", "savedAt", "schema"], "the envelope holds a version, a time and the plan, nothing else");
  assert.equal(env.schema, SCHEMA_VERSION, "schema marker is written");
  assert.equal(env.savedAt, "2026-05-01T10:00:00.000Z");
  assert.deepEqual(parseStoredPlan(raw), s().plan, "save then load gives equivalent Plan data");
  assert.deepEqual(Object.keys(env.plan).sort(), ["id", "items", "meta", "name", "openings", "rooms", "units", "walls"], "only Plan fields are stored");
}

// ---------------------------------------------------------------- corrupt or incompatible data falls back to null

{
  const good = JSON.parse(serializePlan(samplePlan));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the test pokes at arbitrary JSON
  const bad = (mutate: (e: any) => void) => {
    const e = structuredClone(good);
    mutate(e);
    return JSON.stringify(e);
  };
  const cases: [string, string | null | undefined][] = [
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["not JSON", "not json {{{"],
    ["truncated JSON", serializePlan(samplePlan).slice(0, 200)],
    ["a number", "42"],
    ["an array", "[]"],
    ["null literal", "null"],
    ["empty object", "{}"],
    ["no schema marker", bad((e) => delete e.schema)],
    ["newer schema", bad((e) => (e.schema = SCHEMA_VERSION + 1))],
    ["schema as text", bad((e) => (e.schema = "1"))],
    ["no plan", bad((e) => delete e.plan)],
    ["plan is a string", bad((e) => (e.plan = "x"))],
    ["walls not an array", bad((e) => (e.plan.walls = {}))],
    ["wall without b", bad((e) => delete e.plan.walls[0].b)],
    ["wall coordinate as text", bad((e) => (e.plan.walls[0].a.x = "0"))],
    ["wall coordinate null (NaN saved by JSON)", bad((e) => (e.plan.walls[0].a.x = null))],
    ["zero thickness", bad((e) => (e.plan.walls[0].thickness = 0))],
    ["door swing side unknown", bad((e) => (e.plan.openings.find((o: { kind: string }) => o.kind === "door").swing = "up"))],
    ["opening kind unknown", bad((e) => (e.plan.openings[0].kind = "gate"))],
    ["opening on a missing wall", bad((e) => (e.plan.openings[0].wallId = "w-nope"))],
    ["room on a missing wall", bad((e) => (e.plan.rooms[0].wallIds[0] = "w-nope"))],
    ["duplicate wall ids", bad((e) => (e.plan.walls[1].id = e.plan.walls[0].id))],
    ["units not metres", bad((e) => (e.plan.units = "ft"))],
    ["no meta", bad((e) => delete e.plan.meta)],
  ];
  for (const [name, raw] of cases) assert.equal(parseStoredPlan(raw), null, `corrupt data is ignored: ${name}`);

  // stray extra keys are dropped, not carried into the store
  const extra = bad((e) => {
    e.plan.selectedId = "w-AB";
    e.plan.walls[0].hovered = true;
    e.tool = "measure";
  });
  const parsed = parseStoredPlan(extra)!;
  assert.ok(parsed, "extra keys do not make a good plan bad");
  assert.deepEqual(parsed, samplePlan, "and they are dropped");

  // a store that throws reads as "nothing saved"
  const throwing: KeyValueStore = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => {}, removeItem: () => {} };
  assert.equal(loadSavedPlan(throwing), null);
}

// restoring from bad storage leaves the current (sample) plan exactly as it was
{
  for (const junk of ["garbage", "{}", JSON.stringify({ schema: 99, plan: samplePlan })]) {
    fresh();
    const before = s().plan;
    assert.equal(restoreSavedPlan(fakeStorage({ [STORAGE_KEY]: junk })), false, `restore refuses ${junk.slice(0, 20)}`);
    assert.equal(s().plan, before, "the plan in the store is untouched");
  }
  fresh();
  const before = s().plan;
  assert.equal(restoreSavedPlan(fakeStorage()), false, "nothing saved: the sample plan stays");
  assert.equal(s().plan, before);
}

// ---------------------------------------------------------------- debounce (fake clock)

{
  const clock = fakeClock();
  const storage = fakeStorage();
  const statuses: SaveStatus[] = [];
  const saver = createAutosaver({ storage, timers: clock.timers, onStatus: (st) => statuses.push(st) });
  fresh();
  const base = s().plan;

  // many rapid changes: nothing is written inline, nothing during the burst, one write after it settles
  for (let i = 0; i < 6; i++) { // 6 × 700 ms = 4.2 s, inside the 5 s max wait
    saver.schedule({ ...base, name: `edit ${i}` });
    assert.equal(storage.writes, 0, "schedule never writes inline");
    clock.advance(AUTOSAVE_DELAY_MS - 100); // each change lands before the previous one's wait ran out
  }
  assert.equal(storage.writes, 0, "a burst of changes writes nothing while it lasts");
  clock.advance(100);
  assert.equal(storage.writes, 1, "one write once the changes stop");
  assert.equal(parseStoredPlan(storage.getItem(STORAGE_KEY))!.name, "edit 5", "and it is the newest plan");
  assert.deepEqual(statuses.slice(-2), ["pending", "saved"]);
  clock.advance(60_000);
  assert.equal(storage.writes, 1, "no further writes");

  // a wait of exactly the delay writes; one ms less does not
  saver.schedule({ ...base, name: "later" });
  clock.advance(AUTOSAVE_DELAY_MS - 1);
  assert.equal(storage.writes, 1);
  clock.advance(1);
  assert.equal(storage.writes, 2);

  // changes that never pause are still written within the max wait
  for (let t = 0; t < 12_000; t += 400) {
    saver.schedule({ ...base, name: `drag ${t}` });
    clock.advance(400);
  }
  assert.ok(storage.writes >= 4 && storage.writes <= 6, `a long continuous drag writes every few seconds, not on every change (${storage.writes} writes)`);
  assert.ok(AUTOSAVE_MAX_WAIT_MS > AUTOSAVE_DELAY_MS);

  // flush writes at once; cancel drops
  const w = storage.writes;
  saver.schedule({ ...base, name: "flushed" });
  saver.flush();
  assert.equal(storage.writes, w + 1, "flush writes immediately");
  assert.equal(clock.pendingCount(), 0, "and clears the timer");
  saver.flush();
  assert.equal(storage.writes, w + 1, "flush with nothing pending writes nothing");
  saver.schedule({ ...base, name: "cancelled" });
  saver.cancel();
  clock.advance(10_000);
  assert.equal(storage.writes, w + 1, "cancel drops the pending write");

  // a full or blocked store reports an error and recovers later; it never throws
  storage.failWrites = true;
  saver.schedule({ ...base, name: "no room" });
  clock.advance(AUTOSAVE_DELAY_MS);
  assert.equal(statuses.at(-1), "error", "a failed write reports an error");
  storage.failWrites = false;
  saver.schedule({ ...base, name: "room again" });
  clock.advance(AUTOSAVE_DELAY_MS);
  assert.equal(statuses.at(-1), "saved", "and the next write succeeds");
}

// ---------------------------------------------------------------- save → reload: names, walls, openings, loops (Part C)

{
  fresh();
  const sampleWallCount = s().plan.walls.length;
  // rename two rooms, one of them the concave (L-shaped) living room
  s().renameRoom("r-living", "Great room");
  s().renameRoom("r-bed1", "Study");
  // modify walls: slide joint K (shared by w-KM and w-KL), thicken a wall, resize a door
  s().moveWallEndpoint("w-KM", "a", { x: 7, y: 4.5 });
  s().updateWall("w-AB", { thickness: 0.25 });
  s().updateOpening("d-bath", { width: 0.85 });
  const swingBefore = s().plan.openings.find((o) => o.id === "d-bed1")!.swing;
  s().flipDoor("d-bed1"); // step 4.5: the swing side is stored data and must survive a reload
  const live = s().plan;
  assert.notEqual(live.openings.find((o) => o.id === "d-bed1")!.swing, swingBefore, "the door really flipped");
  assert.equal(roomName(live, "r-living"), "Great room");
  assert.equal(roomName(live, "r-bed1"), "Study");

  // the living room really is concave: its centroid is not what a label should use, and the label point is inside
  const living = deriveRooms(live).find((r) => r.id === "r-living")!;
  assert.ok(pointInPolygon(living.labelPoint, living.polygon), "the concave room's label point lies inside it");
  const hull = living.polygon.length;
  assert.ok(hull >= 6, `living room is an L with ${hull} corners`);

  // save, reload
  const storage = fakeStorage({ [STORAGE_KEY]: serializePlan(live) });
  const stored = loadSavedPlan(storage)!;
  assert.deepEqual(stored, live, "the stored Plan equals the live one");

  s().loadPlan(structuredClone(samplePlan)); // a different plan is in the store, as at a fresh page load
  assert.equal(roomName(s().plan, "r-living"), "Living room");
  const pastBefore = s().past.length;
  assert.equal(restoreSavedPlan(storage), true);
  const back = s().plan;

  assert.deepEqual(back.rooms, live.rooms, "room names, ids, loops and materials survive unchanged");
  assert.equal(roomName(back, "r-living"), "Great room", "the concave room's name survives");
  assert.equal(roomName(back, "r-bed1"), "Study");
  assert.ok(back.rooms.every((r) => !/^Room \d+$/.test(r.name)), "no stored name was replaced by a generated default");
  assert.deepEqual(back.walls, live.walls, "wall geometry is preserved");
  assert.deepEqual(back.walls.find((w) => w.id === "w-KM")!.a, { x: 7, y: 4.5 }, "the moved joint stayed moved");
  assert.equal(back.walls.find((w) => w.id === "w-AB")!.thickness, 0.25);
  assert.equal(back.walls.length, sampleWallCount);
  assert.deepEqual(back.openings, live.openings, "openings are preserved");
  assert.equal(back.openings.find((o) => o.id === "d-bath")!.width, 0.85);
  assert.equal(back.openings.find((o) => o.id === "d-bed1")!.swing, live.openings.find((o) => o.id === "d-bed1")!.swing, "a flipped door keeps its swing side");
  assert.deepEqual(back, live, "the whole Plan is equivalent");
  assertLoopsValid(back, "after reload");
  assert.deepEqual(validatePlan(back), validatePlan(live), "same validation result as before the save");
  assert.equal(s().past.length, 0, "a restored plan starts with empty history");
  assert.ok(pastBefore === 0);
  for (const o of back.openings) assert.ok(wallLength(back.walls.find((w) => w.id === o.wallId)!) >= o.width, "openings still fit their walls");

  // the loaded plan still edits properly: removing w-KL merges the bathroom into the L-shaped room.
  // The surviving loop is new, so the name comes from label-point matching, not from an exact loop match.
  s().deleteWall("w-KL");
  const merged = s().plan;
  assert.equal(merged.rooms.length, back.rooms.length - 1, "two rooms merged into one");
  assert.equal(roomName(merged, "r-living"), "Great room", "the concave room's name survives an edit made after the reload");
  assert.ok(!merged.rooms.some((r) => r.name === "Bathroom"), "and the smaller room's name is the one that goes");
  assert.ok(merged.rooms.every((r) => !/^Room \d+$/.test(r.name)));
  assertLoopsValid(merged, "after an edit following the reload");

  // the same, but saved AFTER the merge: a second save → reload keeps the name on the new loop
  const again = parseStoredPlan(serializePlan(merged))!;
  s().loadPlan(again);
  assert.equal(roomName(s().plan, "r-living"), "Great room", "a second save and reload keeps it");
  assert.deepEqual(s().plan.rooms, merged.rooms);
}

// ---------------------------------------------------------------- store wiring: restore, debounced autosave, no UI state, no history

async function checkWiring() {
  const SAVED = (() => {
    fresh();
    s().renamePlan("Flat on Elm Street");
    s().renameRoom("r-bed2", "Nursery");
    return serializePlan(s().plan);
  })();
  const storage = fakeStorage({ [STORAGE_KEY]: SAVED });
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = { localStorage: storage, addEventListener: () => {} };
  g.document = { addEventListener: () => {}, visibilityState: "visible" };

  fresh(); // a page load starts from the sample
  startPersistence();
  assert.equal(s().plan.name, "Flat on Elm Street", "loading the studio restores the last saved plan");
  assert.equal(roomName(s().plan, "r-bed2"), "Nursery");
  assert.equal(s().past.length, 0, "restoring adds no undo entry");
  assert.equal(storage.writes, 0, "and does not write the plan straight back");
  assert.equal(useSaveStatus.getState().status, "idle");

  // transient UI state is set, then an edit is made; none of that state may reach storage
  useSelectionStore.getState().select("w-HI");
  useSelectionStore.getState().hover("w-AB");
  useToolStore.getState().setTool("measure");
  useToolStore.getState().placeMeasurePoint({ x: 1.234, y: 5.678 });
  const pastBefore = s().past.length;
  for (let i = 0; i < 30; i++) s().moveWallEndpoint("w-AB", "a", { x: -0.01 * i, y: 0 }); // a drag: many changes in a row
  s().renamePlan("Flat on Elm Street, edited");
  assert.equal(storage.writes, 0, "edits do not write inline");
  assert.equal(useSaveStatus.getState().status, "pending");
  const historyAfterEdits = s().past.length;

  const start = Date.now();
  while (storage.writes === 0 && Date.now() - start < AUTOSAVE_DELAY_MS + 1500) await new Promise((r) => setTimeout(r, 25));
  const waited = Date.now() - start;
  assert.equal(storage.writes, 1, "the edits were saved once, after the debounce");
  assert.ok(waited >= AUTOSAVE_DELAY_MS - 100, `not before the debounce delay (${waited} ms)`);
  assert.equal(useSaveStatus.getState().status, "saved");
  assert.equal(s().past.length, historyAfterEdits, "autosaving added nothing to undo history");
  assert.ok(historyAfterEdits > pastBefore, "(the edits themselves did)");

  const raw = storage.getItem(STORAGE_KEY)!;
  assert.deepEqual(parseStoredPlan(raw), s().plan, "the saved plan is the current plan");
  const env = JSON.parse(raw);
  assert.deepEqual(Object.keys(env).sort(), ["plan", "savedAt", "schema"], "nothing but the plan envelope is stored");
  for (const word of ["selectedId", "hoveredId", "measurement", "1.234", "5.678", "\"tool\"", "\"tx\"", "zoom", "past", "future"]) {
    assert.ok(!raw.includes(word), `transient state "${word}" is not in storage`);
  }
  assert.equal([...storage.data.keys()].length, 1, "and only one key is written");

  useToolStore.getState().setTool("select");
  useSelectionStore.getState().select(null);
  useSelectionStore.getState().hover(null);
  delete g.window;
  delete g.document;
}

// (async because the debounce is waited out in real time; the CJS test runner has no top-level await)
checkWiring().then(
  () => console.log("OK"),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
