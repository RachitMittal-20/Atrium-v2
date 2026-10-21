/**
 * test-review-worker.ts — step W.1: the import screen's vector review and Build model run in
 * src/workers/review.worker.ts, started by runReview (src/app/studio/import/importFile.ts). Here the
 * REAL worker module runs in a Node worker thread (scripts/worker-thread.ts), so every request and
 * reply really crosses a thread through structured clone.
 *
 *   1. Message passing, every PDF fixture: the review through the thread equals, exactly, what the
 *      page computed on its main thread before W.1 (buildPdfPlan, planVerdict, modelRows; and for
 *      Build model withPdfTakeoffs, copied below as it was), apart from the build's creation time.
 *      The analysis crosses without its pixel bytes. Overrides laid on afterwards (withOverrides)
 *      equal overrides passed to modelRows and dimensionRows.
 *   2. Errors end in plain words, never a stack: a BlueprintError keeps its own message; a bug, a
 *      worker that won't start, a reply that can't be read or has the wrong shape each give a
 *      fixed sentence. cancel() rejects with Cancelled and terminates the worker.
 *   3. Timeout: the TEST-ONLY runaway (`__runaway`) makes the thread loop forever; this thread's
 *      heartbeat keeps ticking, and the watchdog (shortened here) rejects with TOO_LONG, stalled,
 *      and terminates the thread. The page's own watchdog is REVIEW_STALL_MS = 60 s (the e2e,
 *      scripts/e2e-pdf-watchdog.ts, waits it out in a real browser).
 * Run: npx tsx scripts/test-review-worker.ts
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { Cancelled, JobError, REVIEW_STALL_MS, runReview, STALL_MS, TOO_LONG, type WorkerLike } from "../src/app/studio/import/importFile";
import type { Analysis } from "../src/lib/blueprint/analyse";
import { analysePdfPage } from "../src/lib/pdf/analysePdf";
import { dimensionRows, modelRows, withOverrides, type Overrides } from "../src/lib/pdf/dimensions";
import { reviewPdf, type ReviewRequest } from "../src/lib/pdf/review";
import { buildPdfPlan, type PdfBuild } from "../src/lib/pdf/snap";
import { approximateIndexes, pdfTakeoffs } from "../src/lib/pdf/takeoffs";
import { planVerdict } from "../src/lib/pdf/verdict";
import { wallsHash } from "../src/lib/takeoff/rows";
import type { PdfInfo } from "../src/types/pdf";
import { openNode, pdfjs, renderNode } from "./pdf-node";
import { DIR, truth } from "./test-pdf-conventions";

const ENTRY = join(__dirname, "../src/workers/review.worker.ts");
const BOOT = join(__dirname, "worker-thread.ts");

/** A real worker thread running `entry`, as runReview's WorkerLike; `exited` resolves when the thread ends,
 *  `console()` is what the thread wrote to its console (kept, not printed). */
function thread(entry = ENTRY, opts: { keep?: boolean } = {}) {
  const t = new Worker(BOOT, { workerData: { entry }, execArgv: ["--import", "tsx"], stdout: true, stderr: true });
  let output = "";
  t.stdout.on("data", (d) => (output += d));
  t.stderr.on("data", (d) => (output += d));
  const exited = new Promise<void>((resolve) => t.on("exit", () => resolve()));
  const w: WorkerLike = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage: (m) => t.postMessage(m),
    terminate: () => void (opts.keep || t.terminate()), // `keep`: one thread serves many jobs, ended by `end`
  };
  t.on("message", (data) => w.onmessage?.({ data } as MessageEvent));
  t.on("error", (e) => w.onerror?.(e as unknown as ErrorEvent));
  t.on("messageerror", (e) => w.onmessageerror?.(e as unknown as MessageEvent));
  return { worker: w, exited, end: () => t.terminate(), console: () => output };
}

/** A fake worker that answers a request with `reply` (or reports an unreadable reply). */
function fake(reply: (w: WorkerLike) => void) {
  let terminated = false;
  const w: WorkerLike = { onmessage: null, onerror: null, onmessageerror: null, postMessage: () => queueMicrotask(() => reply(w)), terminate: () => (terminated = true) };
  return { worker: w, terminated: () => terminated };
}

/** The build's creation time is stamped when it is built; nothing else may differ. */
const timeless = <T>(v: T): T => JSON.parse(JSON.stringify(v, (k, x) => (k === "createdAt" || k === "updatedAt" ? "(time)" : x)));

/** The page's own code before W.1 (import/page.tsx), kept here verbatim as the reference. */
function oldWithPdfTakeoffs(built: PdfBuild, pdf: PdfInfo | undefined, overrides: Overrides): PdfBuild {
  const matches = pdf?.scale?.matches ?? [];
  if (!matches.length || !("coverage" in built)) return built;
  const c = built.coverage;
  const hash = wallsHash(built.plan.walls);
  const toPlan = (x: number, y: number) => ({ x: x * c.mPerPt - c.origin.x, y: y * c.mPerPt - c.origin.y });
  const approximate = approximateIndexes(modelRows(matches, built.plan, toPlan, (3 * c.traceMm) / 1000));
  const takeoffs = pdfTakeoffs(matches, toPlan, overrides, approximate).map((t, i) => ({ ...t, id: `tp-${i + 1}`, wallsHash: hash }));
  if (!takeoffs.length) return built;
  return { ...built, plan: { ...built.plan, takeoffs: [...(built.plan.takeoffs ?? []), ...takeoffs] } };
}
function oldReview(analysis: Analysis, pdf: PdfInfo, scale: ReviewRequest["scale"]) {
  const build = buildPdfPlan(analysis, pdf, scale);
  const c = build.coverage;
  const model = pdf.scale?.matches.length ? modelRows(pdf.scale.matches, build.plan, (x, y) => ({ x: x * c.mPerPt - c.origin.x, y: y * c.mPerPt - c.origin.y }), (3 * c.traceMm) / 1000) : [];
  return { build, verdict: planVerdict(build.plan, build.coverage), model };
}

async function reading(file: string) {
  const doc = await openNode(new Uint8Array(readFileSync(join(DIR, file))));
  const out = await analysePdfPage(pdfjs, await doc.getPage(truth(file)?.planPage ?? 1), { pageCount: doc.numPages, render: renderNode, ocr: async () => ({ labels: [], words: [], error: null, rereads: [] }) });
  await doc.loadingTask.destroy();
  return out;
}

async function messagePassing() {
  const shared = thread(ENTRY, { keep: true });
  const files = readdirSync(DIR).filter((f) => f.endsWith(".pdf")).sort();
  let reviewed = 0;
  let carried = 0;
  for (const file of files) {
    const { analysis, pdf } = await reading(file);
    if (!pdf.vectorWalls || !analysis.scale.pxPerM) continue; // no review on these pages (scanned, outlined text, no scale)
    const scale = { pxPerM: analysis.scale.pxPerM, source: "pdf" as const };
    const got = await runReview({ analysis, pdf, scale }, { make: () => shared.worker }).result;
    const want = oldReview(analysis, pdf, scale);
    assert.deepEqual(timeless(got), timeless(want), `${file}: the review through the worker equals the old main-thread review`);
    assert.deepEqual(timeless(reviewPdf({ analysis, pdf, scale })), timeless(want), `${file}: reviewPdf equals it in-process too`);
    // Build model: the takeoffs carried with an override, as the old page did.
    const matches = pdf.scale?.matches ?? [];
    const carry: Overrides = matches.length ? { 0: { valueM: 1.2345, note: "typed on the review" } } : {};
    const built = await runReview({ analysis, pdf, scale, carry }, { make: () => shared.worker }).result;
    assert.deepEqual(timeless(built.build), timeless(oldWithPdfTakeoffs(buildPdfPlan(analysis, pdf, scale), pdf, carry)), `${file}: Build model through the worker equals the old page's build`);
    if (matches.length) {
      carried++;
      const c = want.build.coverage;
      const toPlan = (x: number, y: number) => ({ x: x * c.mPerPt - c.origin.x, y: y * c.mPerPt - c.origin.y });
      const ov: Overrides = { [matches.length - 1]: { valueM: 2, note: "n" }, 0: { valueM: 3, note: "" } };
      assert.deepEqual(withOverrides(got.model, ov, (r) => r.index), modelRows(matches, want.build.plan, toPlan, (3 * c.traceMm) / 1000, ov), `${file}: model overrides laid on equal overrides passed`);
      assert.deepEqual(withOverrides(dimensionRows(matches, c.mPerPt), ov, (_r, i) => i), dimensionRows(matches, c.mPerPt, ov), `${file}: and for the printed rows`);
    }
    reviewed++;
  }
  await shared.end();
  assert.ok(reviewed >= 40, `every vector fixture reviewed (${reviewed})`);
  console.log(`  1. message passing: ${reviewed} fixtures reviewed and built through a worker thread, equal to the old main-thread code (${carried} with dimensions carried as takeoffs)`);
  return reviewed;
}

async function errors() {
  const { analysis, pdf } = await reading("plan-filled.pdf");
  const scale = { pxPerM: analysis.scale.pxPerM!, source: "pdf" as const };
  const plain = (e: unknown, want: string, what: string) => {
    assert.ok(e instanceof JobError, `${what}: a JobError`);
    assert.equal(e.message, want, `${what}: the message`);
    assert.equal(e.stalled, false, `${what}: not a stall`);
    assert.doesNotMatch(e.message, /\bat \w|Error\b|TypeError|undefined|\.ts\b/, `${what}: no stack or technical words`);
  };
  const fails = async (job: { result: Promise<unknown> }) => {
    try {
      await job.result;
    } catch (e) {
      return e;
    }
    assert.fail("the job was expected to fail");
  };
  const REVIEW_FAILED = "Something went wrong while checking this reading. Try another file, or export the plan page as an image.";
  // The page's own console.error lines for these failures are expected; keep them out of the output.
  const pageConsole: string[] = [];
  const realError = console.error;
  console.error = (...a: unknown[]) => void pageConsole.push(a.map(String).join(" "));

  // A BlueprintError (a page with no line work) keeps its own words.
  let t = thread();
  plain(await fails(runReview({ analysis, pdf: { ...pdf, vectorWalls: null }, scale }, { make: () => t.worker })), "This page has no PDF line work to read walls from.", "a user error");
  await t.exited;
  // A bug inside the build (walls that are not a list) gives the fixed sentence.
  t = thread();
  plain(await fails(runReview({ analysis: { ...analysis, walls: null as unknown as Analysis["walls"] }, pdf, scale }, { make: () => t.worker })), REVIEW_FAILED, "a bug");
  await t.exited;
  assert.match(t.console(), /\[review\.worker\] TypeError/, "the bug's details went to the worker's console");
  // A worker whose script won't start.
  t = thread(join(__dirname, "no-such-worker.ts"));
  plain(await fails(runReview({ analysis, pdf, scale }, { make: () => t.worker })), "Your browser couldn't start the plan checker. Reload the page and try again.", "a worker that won't start");
  await t.exited;
  // A reply that can't be read, and one of the wrong shape.
  let f = fake((w) => w.onmessageerror?.({} as MessageEvent));
  plain(await fails(runReview({ analysis, pdf, scale }, { make: () => f.worker })), REVIEW_FAILED, "an unreadable reply");
  assert.ok(f.terminated(), "the worker is terminated after an unreadable reply");
  f = fake((w) => w.onmessage?.({ data: { type: "something else" } } as MessageEvent));
  plain(await fails(runReview({ analysis, pdf, scale }, { make: () => f.worker })), REVIEW_FAILED, "a reply of the wrong shape");
  // An error with user=false never shows its message, whatever it says.
  f = fake((w) => w.onmessage?.({ data: { type: "error", message: "TypeError: x is undefined at snap.ts:1", user: false } } as MessageEvent));
  plain(await fails(runReview({ analysis, pdf, scale }, { make: () => f.worker })), REVIEW_FAILED, "a bug's own message");
  // Cancel.
  t = thread();
  const job = runReview({ analysis, pdf, scale }, { make: () => t.worker, runaway: true });
  job.cancel();
  assert.ok((await fails(job)) instanceof Cancelled, "cancel() rejects with Cancelled");
  await t.exited; // terminated
  console.error = realError;
  assert.ok(pageConsole.some((l) => l.includes("review worker failed")), "the start failure's details went to the console");
  console.log("  2. errors: a user error keeps its words; a bug, a worker that won't start, unreadable and wrong-shaped replies give fixed plain sentences; cancel terminates");
}

async function timeout() {
  assert.equal(REVIEW_STALL_MS, 60_000, "the page's review watchdog is 60 s");
  assert.equal(STALL_MS, 180_000, "the analysis and PDF workers keep their 180 s");
  const { analysis, pdf } = await reading("plan-filled.pdf");
  const t = thread();
  let beats = 0;
  let last = Date.now();
  let maxGap = 0;
  const beat = setInterval(() => {
    const now = Date.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
    beats++;
  }, 20);
  const started = Date.now();
  const STALL = 1500;
  let error: unknown;
  try {
    await runReview({ analysis, pdf, scale: { pxPerM: analysis.scale.pxPerM!, source: "pdf" } }, { make: () => t.worker, stallMs: STALL, runaway: true }).result;
  } catch (e) {
    error = e;
  }
  const waited = Date.now() - started;
  clearInterval(beat);
  assert.ok(error instanceof JobError && error.stalled, "the runaway ends in a stalled JobError");
  assert.equal(error.message, TOO_LONG);
  assert.ok(waited >= STALL && waited < STALL + 1000, `the watchdog fired after ${waited} ms (stall ${STALL} ms)`);
  assert.ok(beats >= 40, `this thread's heartbeat kept ticking while the worker looped (${beats} beats)`);
  assert.ok(maxGap < 300, `its longest gap was ${maxGap} ms`);
  await t.exited; // the looping thread was terminated
  console.log(`  3. timeout: the runaway thread looped, ${beats} heartbeats here (longest gap ${maxGap} ms), the watchdog said "${TOO_LONG}" after ${waited} ms and terminated it`);
}

async function main() {
  await messagePassing();
  await errors();
  await timeout();
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
