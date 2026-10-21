/**
 * test-feedback.ts — step D.1, "Report a problem": the report text holds counts, the verdict, scale status,
 * the browser, the screen and the typed note, and NOTHING from the file. A plan and a reading are stuffed
 * with bait (a plan name, a file name, room names, item names, odd coordinates, free-text warnings, notes and
 * scale reasons), run through the real collectors, and the text must contain none of it. The bait is checked
 * to be really in the inputs, so a collector that read a field it should not would show up here.
 * Run: npx tsx scripts/test-feedback.ts
 */
import assert from "node:assert/strict";
import { samplePlan } from "../src/data/samplePlan";
import { buildReport, importFacts, NOTE_MAX, planCounts, studioFacts, type ReportEnv } from "../src/lib/feedback/report";
import { planVerdict } from "../src/lib/pdf/verdict";

const FILE = "Hartwell-Residence-final-v7.pdf";
const PLAN = "Hartwell Residence";
const ROOMS = ["Zanzibar Suite", "Quincy's Study", "Orchid Pantry"];
const ITEM = "Bespoke-Armoire-Model";

// A plan whose every number is unusual, so a coordinate would be unmistakable.
const plan = structuredClone(samplePlan);
plan.name = PLAN;
plan.walls = plan.walls.map((w, i) => ({ ...w, a: { x: w.a.x + 100.123456 + i, y: w.a.y + 200.654321 }, b: { x: w.b.x + 100.123456 + i, y: w.b.y + 200.654321 } }));
plan.rooms = plan.rooms.map((r, i) => ({ ...r, name: ROOMS[i % ROOMS.length] }));
plan.items = [{ id: "x1", catalogId: "import:abc", position: { x: 123.456789, y: 0, z: 987.654321 }, rotationY: 0, scale: 1, colorOverrides: {}, import: { name: ITEM, format: "glb", unit: "m", upAxis: "y" } as never }];

// A reading and a PDF whose free text carries the bait: none of it may travel.
const analysis = {
  scale: { confidence: "check" as const, reason: `Dimension 4.123456 m on ${FILE}`, samples: [{ text: "Zanzibar Suite 5.4 x 3.2" }] },
  warnings: [{ code: "no-scale", message: `Could not read ${FILE}` }, { code: "rotated", message: "straightened by 1.2345 degrees" }],
  pixels: { width: 777, height: 555 },
};
const pdf = { kind: "vector", route: "vector", pageNumber: 2, pageCount: 3, ocrText: true, scale: { confidence: "good" as const, reason: `title block of ${FILE}` }, notes: [`${FILE} page 2 north wall at 98.7654`], fileName: FILE };

const env: ReportEnv = { appVersion: "0.1.0+abc1234", userAgent: "Mozilla/5.0 (Test) Chrome/130.0", language: "en-US", screen: { width: 1440, height: 900, ratio: 2 }, window: { width: 1440, height: 780 } };

const studio = buildReport(studioFacts(plan), env, "");
const verdict = planVerdict(plan, { detached: [], conflicts: [], refused: 0 });
const imported = buildReport(importFacts({ analysis, pdf, chosenSource: "pdf", plan, verdict }), env, "It built two rooms but the kitchen is missing.");
const failed = buildReport(importFacts({}), env, "");

const bait = [FILE, "Hartwell", PLAN, ...ROOMS, ITEM, "Armoire", "100.123", "200.654", "123.456", "987.654", "98.7654", "4.123456", "1.2345", "777", "555"];
for (const [what, text] of [["studio", studio], ["import review", imported], ["failed read", failed]] as const) {
  for (const b of bait) assert.ok(!text.includes(b), `${what}: the report holds "${b}"`);
  // No coordinate-looking number anywhere: a decimal with two or more places (the version is 0.1.0 and the pixel ratio is whole).
  assert.ok(!/\d+\.\d{2,}/.test(text), `${what}: a long decimal reached the report:\n${text}`);
  assert.ok(!/\(\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*\)/.test(text), `${what}: a point reached the report`);
}
// The bait is real: the inputs do carry it (so the checks above could have failed).
assert.ok(JSON.stringify(plan).includes(PLAN) && JSON.stringify(plan).includes("Zanzibar Suite") && JSON.stringify(plan).includes("100.123456"));
assert.ok(JSON.stringify([analysis, pdf]).includes(FILE) && JSON.stringify(pdf).includes("98.7654"));

// What it DOES hold.
assert.ok(studio.includes("App version: 0.1.0+abc1234") && studio.includes("Where: studio"));
const c = planCounts(plan);
assert.equal(c.walls, plan.walls.length);
assert.ok(studio.includes(`${c.walls} walls, ${c.doors} doors, ${c.windows} windows, ${c.rooms} rooms, 1 imported models`), studio);
assert.ok(/Verdict: (Good|Check|Not usable): /.test(studio), studio);
assert.ok(imported.includes("Where: import review"));
assert.ok(imported.includes("Scale: chosen from pdf; the reading's own check: good"), imported);
assert.ok(imported.includes("PDF: vector page (vector route), page 2 of 3, text read by OCR"), imported);
assert.ok(imported.includes("Warnings: no-scale, rotated"), imported);
assert.ok(imported.includes("Note: It built two rooms but the kitchen is missing."));
assert.ok(imported.includes("Browser: Mozilla/5.0 (Test) Chrome/130.0") && imported.includes("Screen: 1440 x 900 at 2x, window 1440 x 780"));
assert.ok(failed.includes("Where: import (reading failed)") && !failed.includes("Counts:") && !failed.includes("Verdict:"), failed);
assert.ok(failed.includes("Note: (none)") && failed.includes("not sent anywhere"));

// The note is the person's own words, cut to NOTE_MAX.
const long = buildReport(studioFacts(plan), env, "x".repeat(NOTE_MAX + 500));
assert.equal(long.split("\n").find((l) => l.startsWith("Note: "))!.length, "Note: ".length + NOTE_MAX);

// A verdict's reasons come from planVerdict's own sentences: with free ends and no room it names counts only.
const broken = structuredClone(plan);
broken.rooms = [];
broken.walls = broken.walls.slice(0, 3);
const bad = buildReport(studioFacts(broken), env, "");
assert.ok(/Verdict: (Check|Not usable): /.test(bad), bad);
for (const b of bait) assert.ok(!bad.includes(b), `broken plan: "${b}"`);

console.log("test-feedback: OK");
