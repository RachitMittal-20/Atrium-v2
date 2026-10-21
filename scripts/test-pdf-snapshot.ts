/**
 * test-pdf-snapshot.ts — step S.1: every PDF fixture's reading and build, frozen. A change to the
 * PDF reader (walls.ts, openings.ts, snap.ts, scale.ts, extract.ts) must leave every fixture in
 * tests/fixtures/pdf/reading-snapshot.json reading and building exactly as it did; a fixture whose
 * reading SHOULD change is named in CHANGED below with why, so no change passes unnoticed.
 *
 * Per fixture: the VectorWalls (walls, openings with kind / class / hinge / swing side, gaps, furniture,
 * detached groups, conflicts, arc counts, skipped and dropped counts), the built plan (walls with
 * provenance, openings), the coverage counts and notes, the rooms (name, area) and the plan verdict.
 * Coordinates rounded to 1 µm, areas to 1e-6 m². PDFs with no entry (new fixtures) are listed, not compared.
 *
 * Run: npx tsx scripts/test-pdf-snapshot.ts            (compare)
 *      SNAPSHOT_WRITE=1 npx tsx scripts/test-pdf-snapshot.ts   (freeze the current readings)
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analysePdfPage } from "../src/lib/pdf/analysePdf";
import { buildPdfPlan } from "../src/lib/pdf/snap";
import { planVerdict } from "../src/lib/pdf/verdict";
import { deriveRooms } from "../src/lib/plan/rooms";
import { openNode, pdfjs, renderNode } from "./pdf-node";
import { DIR, truth } from "./test-pdf-conventions";

const FILE = join(DIR, "reading-snapshot.json");
/** Fixtures whose reading is allowed to differ from the snapshot, and why (empty: none may). */
const CHANGED: Record<string, string> = {
  "plan-single-line.pdf": "step S.1: w-KM, drawn as one 0.1 m stroke, is a wall read from the PDF (14 of 14 exact; it was traced)",
  "plan-chatgpt-flat.pdf": "step Q.4a: its one out-of-range gap (115 mm at x 6428–6543, y 2384.5 mm) is the face break where the 115 mm wall at x 6485.5 meets the y 2384.5 wall at a T, so it is no longer reported (gaps [0.115] -> [], outOfRangeGaps 1 -> 0); nothing else changed",
};

/**
 * Step C.3: the picture-trace is the one part of a reading that depends on the machine, because it traces
 * a raster that @napi-rs/canvas (Skia) draws, and Skia's anti-aliasing differs a little between a Mac and
 * Linux. On plan-against-wall.pdf that renumbered the traced walls (p19 on a Mac, p22 on Linux; "p15" or
 * "p15+p16") and, on Linux, gave a traced opening no wall, so a note appeared. Everything the PDF itself
 * says (walls, openings, rooms, counts, verdict) is still compared exactly. In the notes only, a traced
 * wall's id is compared as "p#", and the note that counts traced openings with no wall under them is not
 * compared (the plan's openings, which it reports on, are). Used for comparing, never for the frozen file.
 */
const stable = (v: unknown): string =>
  JSON.stringify(v, (k, x) => (k === "notes" && Array.isArray(x) ? x.filter((n) => !/had no wall under them/.test(n)).map((n) => String(n).replace(/\bp\d+(\+p\d+)*\b/g, "p#")) : x));

const round = (v: unknown): unknown => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 || 0 : v);

async function reading(file: string) {
  const doc = await openNode(new Uint8Array(readFileSync(join(DIR, file))));
  const out = await analysePdfPage(pdfjs, await doc.getPage(truth(file)?.planPage ?? 1), { pageCount: doc.numPages, render: renderNode, ocr: async () => ({ labels: [], words: [], error: null, rereads: [] }) });
  await doc.loadingTask.destroy();
  const vw = out.pdf.vectorWalls;
  const vector = vw && {
    walls: vw.walls.map((w) => [w.a.x, w.a.y, w.b.x, w.b.y, w.thickness]),
    openings: vw.openings.map((o) => [o.wallId, o.kind, o.class ?? null, o.a.x, o.a.y, o.b.x, o.b.y, o.swing ?? null, o.hingeEnd ?? null]),
    skipped: vw.skipped,
    dropped: vw.dropped,
    clutter: vw.clutter.length,
    arcs: vw.arcs && { found: vw.arcs.found, used: vw.arcs.used, notUsed: vw.arcs.notUsed.map((a) => a.why) },
    gaps: vw.gaps?.map((g) => g.size),
    furniture: vw.furniture?.map((f) => [f.kind, f.walls, f.box.x0, f.box.y0, f.box.x1, f.box.y1]),
    detached: vw.detached?.map((g) => [g.walls, g.dropped, g.why]),
    conflicts: vw.conflicts?.map((c) => [c.kind, c.width, c.why]),
  };
  if (!vw || !out.analysis.scale.pxPerM) return { kind: out.pdf.kind, route: out.pdf.route, vector, build: null };
  const b = buildPdfPlan(out.analysis, out.pdf, { pxPerM: out.analysis.scale.pxPerM, source: "pdf" });
  const { tracedWalls, tracedOpenings, droppedOpenings, unclassifiedOpenings, unusedArcs, outOfRangeGaps, furniture, detached, conflicts, ...counts } = b.coverage;
  const plan = {
    walls: b.plan.walls.map((w) => [w.id, w.provenance ?? null, w.a.x, w.a.y, w.b.x, w.b.y, w.thickness]),
    openings: b.plan.openings.map((o) => [o.id, o.wallId, o.kind, o.offset, o.width, o.swing ?? null, o.hinge ?? null, o.provenance ?? null]),
    rooms: deriveRooms(b.plan).map((r) => [r.name, r.area]),
  };
  const coverage = { ...counts, tracedWalls: tracedWalls.map((w) => w.reason), tracedOpenings: tracedOpenings.length, droppedOpenings: droppedOpenings.length, unclassifiedOpenings: unclassifiedOpenings.length, unusedArcs: unusedArcs.length, outOfRangeGaps: outOfRangeGaps.length, furniture: furniture.length, detached: detached.length, conflicts: conflicts.length };
  return { kind: out.pdf.kind, route: out.pdf.route, vector, build: { plan, coverage, verdict: planVerdict(b.plan, b.coverage).level } };
}

async function main() {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".pdf")).sort();
  const got: Record<string, unknown> = {};
  for (const f of files) got[f] = JSON.parse(JSON.stringify(await reading(f), (_k, v) => round(v)));
  if (process.env.SNAPSHOT_WRITE) {
    writeFileSync(FILE, JSON.stringify(got) + "\n");
    console.log(`wrote ${FILE}: ${files.length} fixtures`);
    return;
  }
  assert.ok(existsSync(FILE), "no snapshot: run with SNAPSHOT_WRITE=1 first");
  const frozen: Record<string, unknown> = JSON.parse(readFileSync(FILE, "utf8"));
  const differ: string[] = [];
  for (const f of Object.keys(frozen)) {
    assert.ok(f in got, `${f}: in the snapshot but no longer a fixture`);
    if (stable(got[f]) === stable(frozen[f])) continue;
    if (CHANGED[f]) console.log(`   ${f}: differs, as expected (${CHANGED[f]})`);
    else differ.push(f);
  }
  for (const f of differ) {
    const [a, b] = [frozen[f] as Record<string, unknown>, got[f] as Record<string, unknown>];
    for (const k of Object.keys({ ...a, ...b })) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.log(`   ${f} ${k}:\n     was ${JSON.stringify(a[k])}\n     now ${JSON.stringify(b[k])}`);
  }
  assert.deepEqual(differ, [], "every older fixture reads and builds exactly as frozen");
  const unchecked = Object.keys(CHANGED).filter((f) => stable(got[f]) === stable(frozen[f]));
  assert.deepEqual(unchecked, [], "a fixture listed as changed must actually differ (stale entry)");
  const fresh = files.filter((f) => !(f in frozen));
  console.log(`snapshot: ${Object.keys(frozen).length} fixtures as frozen${Object.keys(CHANGED).length ? ` (${Object.keys(CHANGED).length} changed as stated)` : ""}; not in the snapshot: ${fresh.join(", ") || "none"}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
