/**
 * src/lib/pdf/review.ts — step W.1: everything the import screen builds from a read vector PDF
 * page, in one pure call, so it can run in src/workers/review.worker.ts and never on the page's
 * main thread (a runaway there, like X.1's polylabel, froze and then killed the tab).
 *
 * `reviewPdf` is, unchanged, what the page used to do itself:
 *   - build: snap.ts's buildPdfPlan at the scale in use (rooms, coverage, naming, report);
 *   - verdict: verdict.ts's planVerdict on that plan (step H.1);
 *   - model: dimensions.ts's modelRows, the "Model versus printed" table, WITHOUT overrides: the
 *     page lays the user's overrides on with `withOverrides`, which gives exactly what passing
 *     them to modelRows gives, so typing an override never waits for a worker;
 *   - with `carry` (Build model only): the printed dimensions carried into the plan as takeoffs
 *     with source "pdf" (step M.2b), `carry` being the first table's overrides. This was the
 *     page's withPdfTakeoffs.
 * The printed-dimension table (dimensionRows) stays on the page: it is one arithmetic map over the
 * matches the PDF worker already found, it needs no build, and it is shown without one.
 *
 * Everything in and out is structured-clone safe (plain objects, arrays, strings and numbers; no
 * functions, Maps or class instances), which scripts/test-review-worker.ts proves by passing every
 * fixture through a real worker thread. The analysis may come without its pixels' bytes:
 * buildPdfPlan reads only their width and height (`slimAnalysis`).
 *
 * TEST ONLY: a request with `__runaway: true` loops forever and never answers, so the e2e
 * (scripts/e2e-pdf-watchdog.ts) and scripts/test-review-worker.ts can prove the page's watchdog and
 * heartbeat. It is compiled out of production builds (NODE_ENV is "production" there, so the branch
 * and the field's name are dead code; the dev-hook grep checks .next/static for both names).
 *
 * Connects to: snap.ts, verdict.ts, dimensions.ts, takeoffs.ts, src/lib/takeoff/rows.ts
 * (wallsHash); run by src/workers/review.worker.ts, started by src/app/studio/import/importFile.ts
 * (runReview) for src/app/studio/import/page.tsx.
 */
import type { Analysis } from "@/lib/blueprint/analyse";
import { wallsHash } from "@/lib/takeoff/rows";
import type { PlanScale } from "@/types/blueprint";
import type { DimensionRow, PdfInfo } from "@/types/pdf";
import { modelRows, type Overrides } from "./dimensions";
import { buildPdfPlan, type PdfBuild } from "./snap";
import { approximateIndexes, pdfTakeoffs } from "./takeoffs";
import { planVerdict, type Verdict } from "./verdict";

export interface ReviewRequest {
  analysis: Analysis;
  pdf: PdfInfo;
  scale: PlanScale;
  /** Build model: carry the printed dimensions as takeoffs, with these overrides of the first table. */
  carry?: Overrides;
  /** TEST ONLY (header): loop forever. */
  __runaway?: boolean;
}

export interface PdfReview {
  build: PdfBuild;
  verdict: Verdict;
  /** The model-versus-printed rows, without overrides (empty when the page has no matched dimensions). */
  model: (DimensionRow & { index: number })[];
}

/** The analysis with an empty pixel buffer: what the worker needs, without copying 16 MB of pixels to it. */
export const slimAnalysis = (a: Analysis): Analysis => ({ ...a, pixels: { width: a.pixels.width, height: a.pixels.height, rgba: new Uint8ClampedArray(0) } });

/** Page points to plan metres for a build, as the model check and the carried takeoffs use it. */
const toPlanOf = (b: PdfBuild) => (x: number, y: number) => ({ x: x * b.coverage.mPerPt - b.coverage.origin.x, y: y * b.coverage.mPerPt - b.coverage.origin.y });
/** Ends within 3 raster pixels of a wall line, face or jamb land on it. */
const tolOf = (b: PdfBuild) => (3 * b.coverage.traceMm) / 1000;

/**
 * Step M.2b: every printed dimension the review matched becomes a takeoff with source "pdf", so the
 * studio keeps checking the model against the drawing's own numbers. Ids are "tp-N", not random, so
 * building the same page twice saves the same bytes. `model` is modelRows without overrides (their
 * `approximate` flags don't depend on overrides).
 */
function withPdfTakeoffs(built: PdfBuild, pdf: PdfInfo, overrides: Overrides, model: PdfReview["model"]): PdfBuild {
  const matches = pdf.scale?.matches ?? [];
  if (!matches.length) return built;
  const hash = wallsHash(built.plan.walls);
  const takeoffs = pdfTakeoffs(matches, toPlanOf(built), overrides, approximateIndexes(model)).map((t, i) => ({ ...t, id: `tp-${i + 1}`, wallsHash: hash }));
  if (!takeoffs.length) return built;
  return { ...built, plan: { ...built.plan, takeoffs: [...(built.plan.takeoffs ?? []), ...takeoffs] } };
}

/** The review (or, with `carry`, the Build model result) for a read vector page (header). Throws buildPdfPlan's errors. */
export function reviewPdf({ analysis, pdf, scale, carry, ...test }: ReviewRequest): PdfReview {
  if (process.env.NODE_ENV !== "production" && test.__runaway) for (;;); // TEST ONLY (header): never answers
  const built = buildPdfPlan(analysis, pdf, scale);
  const matches = pdf.scale?.matches ?? [];
  const model = matches.length ? modelRows(matches, built.plan, toPlanOf(built), tolOf(built)) : [];
  const verdict = planVerdict(built.plan, built.coverage);
  return { build: carry ? withPdfTakeoffs(built, pdf, carry, model) : built, verdict, model };
}
