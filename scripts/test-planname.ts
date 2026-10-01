/**
 * test-planname.ts — planStore.renamePlan: undoable; empty or whitespace-only
 * names are rejected (old name kept, no history entry); names are trimmed and
 * capped at 80 characters. Run: npx tsx scripts/test-planname.ts
 */
import assert from "node:assert/strict";
import { samplePlan } from "../src/data/samplePlan";
import { PLAN_NAME_MAX, usePlanStore } from "../src/store/planStore";

const s = () => usePlanStore.getState();
s().loadPlan(structuredClone(samplePlan));
const old = s().plan.name;

s().renamePlan("  My flat  ");
assert.equal(s().plan.name, "My flat", "trimmed");
assert.equal(s().past.length, 1);
s().undo();
assert.equal(s().plan.name, old, "undo restores the old name");
s().redo();
assert.equal(s().plan.name, "My flat", "redo reapplies");

for (const bad of ["", "   ", "\t\n"]) {
  s().renamePlan(bad);
  assert.equal(s().plan.name, "My flat", `rejects ${JSON.stringify(bad)}`);
}
assert.equal(s().past.length, 1, "rejected names add no history");

s().renamePlan("My flat");
assert.equal(s().past.length, 1, "same name adds no history");

s().renamePlan("x".repeat(200));
assert.equal(s().plan.name.length, PLAN_NAME_MAX, "capped at 80");
assert.equal(PLAN_NAME_MAX, 80);
s().renamePlan("a".repeat(79) + "  b");
assert.equal(s().plan.name, "a".repeat(79), "no trailing space left after the cap");

console.log("test-planname: ok");
