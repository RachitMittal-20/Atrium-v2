"use client";

/*
 * src/app/studio/import/page.tsx — upload and review screen (step 3.5, piece A).
 *
 * Flow: choose or drop an image (or "Try a sample plan") → decode it to
 * PlanPixels on this thread (importFile.ts) → analyse it in a Web Worker
 * (src/workers/analyse.worker.ts) while the five stages are shown with a
 * Cancel button → review: the deskewed image with the detection overlay
 * (PlanViewer.tsx), one line per analysis warning, and the scale panel
 * (ScalePanel.tsx) → "Build model" (enabled only once a scale is chosen)
 * runs buildFromAnalysis and shows a summary → "Open in studio" calls the
 * plan store's loadPlan, writes it to storage at once (flushSavedPlan, step
 * F.1) and goes to /studio.
 *
 * A PDF (step M.1a) goes to src/workers/pdf.worker.ts instead, which does all
 * the PDF work: a file with several pages first shows the page picker
 * (PdfPanels.tsx), then the chosen page is read and analysed there. Its review
 * adds the PDF panel (the page's kind, notes, and the scale with its sources)
 * and, for a vector page with printed dimensions, the dimension check
 * (DimensionCheck.tsx) under the plan. The overlay, scale panel and Build
 * model flow are the same.
 *
 * Step M.1b: a vector page with a scale is built by snap.ts's buildPdfPlan
 * (walls read exactly from the PDF's lines, merged with the traced ones)
 * instead of buildFromAnalysis. Once a scale is in use (the chosen one, else
 * the PDF's), that build is made at review time too, so the screen shows its
 * coverage (CoveragePanel, with the traced walls dashed on the overlay and, since
 * step M.1c, the traced and unclassified openings boxed) and a
 * second table, "Model versus printed". The layout is a grid: on a phone the
 * plan, then the side panels (PDF, coverage, scale, Build), then the tables;
 * from lg the tables sit under the plan beside the panels.
 *
 * Step M.2b: at Build model every printed dimension the review matched to a line is carried
 * into the plan as a takeoff with source "pdf" (src/lib/pdf/takeoffs.ts), so the studio's
 * Takeoff panel keeps checking the model against the drawing's own numbers; the summary says
 * how many, and when the 200-row cap bit. Scanned pages and images carry none.
 *
 * Step M.2c: Build model also keeps the drawing for the studio's 2D background. The file the
 * user picked (the whole PDF, or the image) goes into the I.1a asset store (IndexedDB), and the
 * plan gets `background` = its asset id, kind, page and the mapping from the drawing's own units
 * to plan metres, taken from the very numbers this build used (src/lib/background/mapping.ts):
 * the vector build's Coverage, or the image pipeline's downscale, deskew, origin and scale. When
 * storage is refused the build still completes, with the note "The drawing could not be kept for
 * the background".
 *
 * Step W.1: none of the vector review runs on this thread. buildPdfPlan, its rooms and coverage,
 * the verdict and the model-versus-printed rows are built in src/workers/review.worker.ts
 * (runReview, importFile.ts): first as a last progress stage, "Checking the reading", before the
 * review screen shows; again in the worker when a different scale is chosen (the last review stays
 * on screen, marked pending, and Build waits for the new one); and Build model's own build, with
 * its carried takeoffs. A worker silent for 60 s is stopped and the screen says TOO_LONG with
 * "Start again"; other failures are plain words. The first table's rows (dimensionRows) are one
 * map over the PDF worker's matches and stay here; overrides are laid on the worker's model rows
 * here (withOverrides), so typing one never waits. Images and scanned pages (buildFromAnalysis)
 * are built here as before.
 *
 * Nothing else is kept except the plan loaded into the store, which autosaves to
 * the browser (src/store/persistence.ts). Editing walls
 * here is a later piece; this screen only reviews.
 */
import { lenText } from "@/lib/units/current";
import { useUnitsStore } from "@/store/unitsStore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { buildFromAnalysis, STAGES, type Analysis, type AnalysisWarning, type Stage } from "@/lib/blueprint/analyse";
import { usePlanStore } from "@/store/planStore";
import { flushSavedPlan, usePersistenceReady } from "@/store/persistence";
import { dimensionRows, rowsToCsv, withOverrides, type Overrides } from "@/lib/pdf/dimensions";
import { planToPixels, type PdfBuild } from "@/lib/pdf/snap";
import type { PdfReview } from "@/lib/pdf/review";
import { verdictText } from "@/lib/pdf/verdict";
import { buildMapping } from "@/lib/background/mapping";
import { keepDrawing } from "@/lib/background/keep";
import { assetStore } from "@/lib/import/assetCache";
import { MAX_PDF_TAKEOFFS } from "@/lib/pdf/takeoffs";
import type { PlanScale } from "@/types/blueprint";
import type { PdfInfo } from "@/types/pdf";
import type { Vec2 } from "@/types/plan";
import { DimensionCheck } from "./DimensionCheck";
import { Cancelled, checkFile, decodeImage, isPdf, JobError, runAnalysis, runPdf, runReview, STAGE_LABELS, type PdfPageSize } from "./importFile";
import { CoveragePanel, detachedLabel, PagePicker, PdfPanel, VerdictBanner } from "./PdfPanels";
import { PlanViewer } from "./PlanViewer";
import { primaryBtn, ScalePanel, secondaryBtn } from "./ScalePanel";

type Phase =
  | { kind: "idle" }
  | { kind: "busy"; stage: Stage | null; fraction: number; pdf?: boolean; checking?: boolean }
  | { kind: "pages"; count: number; listed: PdfPageSize[] }
  | { kind: "error"; message: string; again?: boolean }
  | { kind: "results"; analysis: Analysis; original: { width: number; height: number }; pdf?: PdfInfo };

type Built = ReturnType<typeof buildFromAnalysis> | PdfBuild;

/** Development only: scripts/e2e-pdf-watchdog.ts sets `window.__reviewRunaway` to make the review worker loop forever (TEST ONLY; compiled out of production). */
const runaway = () => process.env.NODE_ENV === "development" && Boolean((window as { __reviewRunaway?: boolean }).__reviewRunaway);
const noJob = { cancel: () => {} };

/** One plain-words line per analysis warning. */
function warningText(w: AnalysisWarning, a: Analysis): string {
  switch (w.code) {
    case "rotated":
      return `Your plan was straightened by ${Math.abs(a.angleDeg).toFixed(1)} degrees.`;
    case "hollow-mode":
      return "This plan uses hollow walls, so windows may be missing. You can add them in the studio.";
    case "low-confidence":
      return "We're not confident about this reading. Check the walls before you build.";
    case "ocr-failed":
      return "We couldn't read the text on your plan, so room names and printed sizes are missing.";
    case "no-scale":
      return "We couldn't find the scale on your plan. Set it yourself in the scale panel.";
    case "check-scale":
      return "The printed sizes don't quite agree. Please confirm the scale.";
  }
}

export default function ImportPage() {
  const router = useRouter();
  usePersistenceReady(); // start autosave here too, so the imported plan is saved and not replaced by an older save in /studio
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const units = useUnitsStore((st) => st.length); // the overlay's detached-group labels (step Q.2)
  const [dragging, setDragging] = useState(false);
  const [chosen, setChosen] = useState<PlanScale | null>(null);
  const [picking, setPicking] = useState(false);
  const [points, setPoints] = useState<Vec2[]>([]);
  const [built, setBuilt] = useState<Built | null>(null);
  const [drawingNote, setDrawingNote] = useState<string | null>(null);
  /** The file being read, kept for the 2D background at Build model (step M.2c). */
  const sourceRef = useRef<{ name: string; blob: Blob; kind: "pdf" | "image" } | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [overrides, setOverrides] = useState<Overrides>({});
  const [modelOverrides, setModelOverrides] = useState<Overrides>({});
  const pdfPageRef = useRef<(n: number) => void>(() => {});
  const fileRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<() => void>(() => {});
  // Step W.1: the vector review and Build model run in the review worker. `reviewFor` is the scale the review is (being) built at.
  const [review, setReview] = useState<(PdfReview & { pxPerM: number }) | null>(null); // with the scale it was built at
  const [reviewPending, setReviewPending] = useState(false);
  const [building, setBuilding] = useState(false);
  const reviewJob = useRef(noJob);
  const buildJob = useRef(noJob);
  const reviewFor = useRef<number | null>(null);
  useEffect(
    () => () => {
      reviewJob.current.cancel();
      buildJob.current.cancel();
    },
    [],
  );

  const stopJobs = () => {
    reviewJob.current.cancel();
    buildJob.current.cancel();
    reviewFor.current = null;
    setReview(null);
    setReviewPending(false);
    setBuilding(false);
  };

  /** A worker that went silent for 60 s: everything stops and the screen says so, with Start again. */
  const tooLong = (message: string) => {
    cancelRef.current();
    stopJobs();
    setPhase({ kind: "error", message, again: true });
  };

  /** Builds the review at `scale` in the review worker; `then` runs once it is in (or has failed in plain words). */
  function startReview(analysis: Analysis, pdf: PdfInfo, scale: PlanScale, then?: () => void) {
    reviewJob.current.cancel();
    reviewFor.current = scale.pxPerM;
    setReviewPending(true);
    const job = runReview({ analysis, pdf, scale }, { runaway: runaway() });
    reviewJob.current = job;
    job.result.then(
      (r) => {
        setReview({ ...r, pxPerM: scale.pxPerM });
        setReviewPending(false);
        then?.();
      },
      (e) => {
        if (e instanceof Cancelled) return;
        if (e instanceof JobError && e.stalled) return tooLong(e.message);
        // As before W.1: a reading the builder refuses has no review, and Build model says why.
        setReview(null);
        setReviewPending(false);
        then?.();
      },
    );
  }

  const reset = () => {
    cancelRef.current();
    stopJobs();
    setPhase({ kind: "idle" });
    setChosen(null);
    setPicking(false);
    setPoints([]);
    setBuilt(null);
    setDrawingNote(null);
    sourceRef.current = null;
    setBuildError(null);
    setThumbs({});
    setOverrides({});
    setModelOverrides({});
  };

  async function start(blob: Blob, name: string) {
    reset();
    sourceRef.current = { name, blob, kind: "image" };
    setPhase({ kind: "busy", stage: null, fraction: 0 });
    try {
      const pixels = await decodeImage(blob);
      const original = { width: pixels.width, height: pixels.height };
      const job = runAnalysis(pixels, (stage, fraction) => setPhase({ kind: "busy", stage, fraction }));
      cancelRef.current = job.cancel;
      const analysis = await job.result;
      cancelRef.current = () => {};
      // Development only: scripts/e2e-import.ts compares these OCR words with a Node run.
      if (process.env.NODE_ENV === "development") (window as unknown as { __importAnalysis?: Analysis }).__importAnalysis = analysis;
      setPhase({ kind: "results", analysis, original });
    } catch (e) {
      if (e instanceof Cancelled) return;
      setPhase({ kind: "error", message: e instanceof Error && e.message ? e.message : "Something went wrong while reading this plan. Try another image." });
    }
  }

  /** Reads a PDF in its worker: the page picker for several pages, else straight to page 1. */
  function startPdf(file: File) {
    reset();
    sourceRef.current = { name: file.name, blob: file, kind: "pdf" };
    setPhase({ kind: "busy", stage: null, fraction: 0, pdf: true });
    const job = runPdf(file, {
      pages: (count, listed) => (count === 1 ? job.page(1) : setPhase({ kind: "pages", count, listed })),
      thumb: (n, url) => setThumbs((t) => ({ ...t, [n]: url })),
      progress: (stage, fraction) => setPhase({ kind: "busy", stage, fraction, pdf: true }),
      done: (analysis, pdf) => {
        // Development only: scripts/e2e-pdf-import.ts reads these.
        if (process.env.NODE_ENV === "development") Object.assign(window, { __importAnalysis: analysis, __importPdf: pdf });
        const show = () => setPhase({ kind: "results", analysis, original: { width: analysis.pixels.width, height: analysis.pixels.height }, pdf });
        // Step W.1: a vector page with walls and a scale is checked in the review worker before the review screen shows.
        if (pdf.vectorWalls && analysis.scale.pxPerM) {
          setPhase({ kind: "busy", stage: null, fraction: 1, pdf: true, checking: true });
          startReview(analysis, pdf, { pxPerM: analysis.scale.pxPerM, source: "pdf" }, show);
        } else show();
      },
      error: (message) => setPhase({ kind: "error", message }),
    });
    pdfPageRef.current = (n) => {
      setPhase({ kind: "busy", stage: null, fraction: 0, pdf: true });
      job.page(n);
    };
    cancelRef.current = job.cancel; // also frees the thumbnails
  }

  function takeFile(file: File | undefined) {
    if (!file) return;
    const problem = checkFile(file);
    if (problem) {
      reset();
      setPhase({ kind: "error", message: problem });
    } else if (isPdf(file)) startPdf(file);
    else void start(file, file.name);
  }

  async function trySample() {
    try {
      const res = await fetch("/samples/sample-plan.png");
      if (!res.ok) throw new Error();
      await start(await res.blob(), "sample-plan.png");
    } catch {
      setPhase({ kind: "error", message: "The sample plan couldn't be loaded. Check your connection and try again." });
    }
  }

  // `review` is a vector PDF's merged build at the scale in use (the chosen one, else the PDF's), for
  // the coverage report and the model check before Build; Build makes the same plan. Built in the
  // review worker (step W.1): a new scale value starts a new review, the same value keeps this one.
  const results = phase.kind === "results" ? phase : null;

  const choose = (s: PlanScale) => {
    setChosen(s);
    setBuilt(null); // a new scale makes the old build stale
    setPicking(false);
    buildJob.current.cancel(); // and a build still running for the old one
    setBuilding(false);
    if (results?.pdf?.vectorWalls && s.pxPerM !== reviewFor.current) startReview(results.analysis, results.pdf, s);
  };

  // Step H.1: the verdict on the plan Build would make. Not usable asks for a second click.
  const verdict = review?.verdict ?? null;
  const [armedFor, setArmedFor] = useState<PdfReview | null>(null);
  const unusable = verdict?.level === "unusable";
  const armed = unusable && armedFor === review; // armed for THIS reading; a new scale makes a new review and disarms

  async function build(analysis: Analysis, original: { width: number; height: number }, pdf?: PdfInfo) {
    if (!chosen) return;
    let next: Built;
    try {
      if (pdf?.vectorWalls) {
        // Step W.1: the vector build, with the printed dimensions carried as takeoffs, in the review worker.
        buildJob.current.cancel();
        setBuilding(true);
        const job = runReview({ analysis, pdf, scale: chosen, carry: overrides }, { runaway: runaway() });
        buildJob.current = job;
        next = (await job.result).build;
        setBuilding(false);
      } else next = buildFromAnalysis(analysis, chosen);
      setBuildError(null);
    } catch (e) {
      if (e instanceof Cancelled) return;
      if (e instanceof JobError && e.stalled) return tooLong(e.message);
      setBuilding(false);
      setBuilt(null);
      setBuildError(e instanceof Error && e.message ? e.message : "The model couldn't be built from this reading.");
      return;
    }
    // Step M.2c: keep the drawing for the 2D background; storage refused only adds a note.
    const source = sourceRef.current;
    let note: string | null = null;
    if (source) {
      const kept = await keepDrawing(next.plan, { name: source.name, bytes: new Uint8Array(await source.blob.arrayBuffer()), kind: source.kind, page: pdf?.pageNumber }, buildMapping(next, analysis, pdf, chosen, original), assetStore());
      next = { ...next, plan: kept.plan };
      note = kept.note;
    }
    setBuilt(next);
    setDrawingNote(note);
  }

  function openInStudio() {
    if (!built) return;
    usePlanStore.getState().loadPlan(built.plan);
    flushSavedPlan(); // in storage before we navigate: a restore in the new document must not bring the previous plan back (step F.1)
    router.push("/studio");
  }

  return (
    <main className="min-h-svh bg-limestone px-4 py-6 text-iron sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-xl sm:text-2xl">Import a floor plan</h1>
        <Link href="/studio" className="text-sm text-smoke underline underline-offset-4 hover:text-iron">
          Back to the studio
        </Link>
      </header>

      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf,image/png,image/jpeg,image/webp"
        className="hidden"
        data-testid="file-input"
        onChange={(e) => {
          takeFile(e.target.files?.[0]);
          e.target.value = ""; // choosing the same file again still fires
        }}
      />

      {phase.kind === "idle" && (
        <div
          data-testid="drop-zone"
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            takeFile(e.dataTransfer.files[0]);
          }}
          className={`mx-auto flex max-w-2xl flex-col items-center gap-4 rounded border-2 border-dashed px-4 py-12 text-center transition-colors sm:px-8 ${dragging ? "border-gilt bg-vellum" : "border-stone"}`}
        >
          <h2 className="font-display text-lg">Drop a floor plan PDF or image here</h2>
          <p className="text-sm text-smoke">
            A PDF up to 50 MB, or a PNG, JPEG or WebP up to 25 MB. A PDF exported from a drawing program reads best; a straight-on scan or a phone photo works too.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <button type="button" className={primaryBtn} onClick={() => fileRef.current?.click()}>
              Choose a file
            </button>
            <button type="button" className={secondaryBtn} onClick={trySample}>
              Try a sample plan
            </button>
          </div>
        </div>
      )}

      {phase.kind === "busy" && (
        <section aria-labelledby="busy-heading" className="mx-auto flex max-w-md flex-col gap-4 rounded border border-stone bg-vellum p-6" data-testid="progress">
          <h2 id="busy-heading" className="font-display text-lg">
            Reading your plan
          </h2>
          <div
            role="progressbar"
            aria-label="Progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(phase.fraction * 100)}
            className="h-2 overflow-hidden rounded-full bg-stone"
          >
            <div className="h-full bg-gilt transition-[width] duration-300" style={{ width: `${Math.max(4, phase.fraction * 100)}%` }} />
          </div>
          <ul className="flex flex-col gap-1 text-sm" aria-live="polite">
            {phase.stage === null && !phase.checking && <li className="text-iron">{phase.pdf ? "Reading the PDF…" : "Opening your image…"}</li>}
            {STAGES.map((s) => {
              const at = phase.checking ? STAGES.length : phase.stage === null ? -1 : STAGES.indexOf(phase.stage);
              const i = STAGES.indexOf(s);
              const state = i < at ? "done" : i === at ? "now" : "later";
              return (
                <li key={s} className={`flex items-center gap-2 ${state === "later" ? "text-smoke" : "text-iron"}`} aria-current={state === "now" ? "step" : undefined}>
                  <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${state === "done" ? "bg-cyanotype" : state === "now" ? "bg-gilt" : "bg-stone"}`} />
                  {STAGE_LABELS[s]}
                  {state === "done" && <span className="sr-only">, done</span>}
                </li>
              );
            })}
            {phase.checking && (
              // Step W.1: the review build, in its own worker, after the five reading stages.
              <li className="flex items-center gap-2 text-iron" aria-current="step">
                <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-gilt" />
                Checking the reading
              </li>
            )}
          </ul>
          <button type="button" className={`${secondaryBtn} self-start`} onClick={reset}>
            Cancel
          </button>
        </section>
      )}

      {phase.kind === "pages" && (
        <div className="flex flex-col gap-4">
          <PagePicker count={phase.count} listed={phase.listed} thumbs={thumbs} onPick={(n) => pdfPageRef.current(n)} />
          <button type="button" className={`${secondaryBtn} self-center`} onClick={reset}>
            Try another file
          </button>
        </div>
      )}

      {phase.kind === "error" && (
        <section role="alert" className="mx-auto flex max-w-md flex-col items-start gap-4 rounded border border-stone bg-vellum p-6" data-testid="error">
          <p data-testid="error-message">{phase.message}</p>
          <button type="button" className={primaryBtn} onClick={reset}>
            {phase.again ? "Start again" : "Try another file"}
          </button>
        </section>
      )}

      {phase.kind === "results" && (
        // Grid: phone order is plan, panels, tables; from lg the panels span both rows on the right.
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start" data-testid="results" data-review={reviewPending ? "pending" : review ? "ready" : "none"}>
          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            <PlanViewer
              analysis={phase.analysis}
              picking={picking}
              points={points}
              onPick={(p) => setPoints((ps) => (ps.length >= 2 ? [p] : [...ps, p]))}
              traced={
                review
                  ? review.build.coverage.tracedWalls.map((w) => {
                      const px = planToPixels(review.build.coverage, review.pxPerM, phase.pdf?.rasterOrigin);
                      return { id: w.id, a: px(w.a), b: px(w.b), thickness: w.thickness * review.pxPerM };
                    })
                  : undefined
              }
              openingMarks={
                review
                  ? (() => {
                      const px = planToPixels(review.build.coverage, review.pxPerM, phase.pdf?.rasterOrigin);
                      const toPx = (m: { id: string; a: Vec2; b: Vec2; thickness: number }) => ({ id: m.id, a: px(m.a), b: px(m.b), thickness: m.thickness * review.pxPerM });
                      // Step M.1d: the gaps outside 0.45–4 m are highlighted too; `size` is dropped, the box is the gap.
                      // Step Q.2: so are the openings a wall ends inside, which are not read either.
                      return { traced: review.build.coverage.tracedOpenings.map(toPx), unclassified: review.build.coverage.unclassifiedOpenings.map(toPx), gaps: [...review.build.coverage.outOfRangeGaps.map((g, i) => toPx({ id: `gap${i + 1}`, ...g })), ...review.build.coverage.conflicts.map((x, i) => toPx({ id: `conflict${i + 1}`, ...x }))] };
                    })()
                  : undefined
              }
              detached={
                review
                  ? review.build.coverage.detached.map((d, i) => {
                      // Step Q.2: each detached group's footprint, outlined with its size.
                      const px = planToPixels(review.build.coverage, review.pxPerM, phase.pdf?.rasterOrigin);
                      return { id: `detached${i + 1}`, min: px(d.min), max: px(d.max), label: detachedLabel(d, units), dropped: d.dropped };
                    })
                  : undefined
              }
            />
            {phase.analysis.imageScale < 1 && !phase.pdf && (
              <p className="mt-1 text-sm text-smoke">
                Your {phase.original.width} × {phase.original.height} px image was read at {phase.analysis.pixels.width} × {phase.analysis.pixels.height} px.
              </p>
            )}
          </div>

          <aside className="flex w-full flex-col gap-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            {verdict && <VerdictBanner verdict={verdict} />}
            {phase.analysis.warnings.length > 0 && (
              <ul role="status" className="flex flex-col gap-1 rounded border border-gilt/50 bg-vellum p-4 text-sm" data-testid="warnings">
                {phase.analysis.warnings.map((w) => (
                  <li key={w.code}>{warningText(w, phase.analysis)}</li>
                ))}
              </ul>
            )}

            {phase.pdf && <PdfPanel pdf={phase.pdf} />}
            {review && verdict && <CoveragePanel coverage={review.build.coverage} verdict={verdict} />}
            {reviewPending && (
              <p role="status" className="text-sm text-smoke" data-testid="review-pending">
                Checking the reading at this scale…
              </p>
            )}

            <ScalePanel
              analysis={phase.analysis}
              foundSource={phase.pdf?.route === "vector" ? "pdf" : "ocr"}
              chosen={chosen}
              onChoose={choose}
              picking={picking}
              setPicking={setPicking}
              points={points}
              clearPoints={() => setPoints([])}
            />

            <button
              type="button"
              className={primaryBtn}
              disabled={!chosen || reviewPending || building}
              onClick={() => {
                if (unusable && !armed) return setArmedFor(review); // Not usable: the first click only asks
                void build(phase.analysis, phase.original, phase.pdf);
              }}
            >
              {building ? "Building…" : unusable ? (armed ? "Confirm: build anyway" : "Build anyway") : "Build model"}
            </button>
            {armed && verdict && (
              <p role="status" className="-mt-2 text-sm" data-testid="build-anyway-note">
                {verdictText(verdict)} Building it as read gives a model you will mostly have to redraw. Click again to build it.
              </p>
            )}
            {!chosen && <p className="-mt-2 text-sm text-smoke">Choose a scale first.</p>}
            {buildError && <p role="alert">{buildError}</p>}
            {built && <Summary built={built} carried={phase.pdf?.scale?.matches.length ?? 0} drawingNote={drawingNote} onOpen={openInStudio} />}

            <button type="button" className={`${secondaryBtn} self-start`} onClick={reset}>
              Try another file
            </button>
          </aside>

          {phase.pdf?.scale && phase.pdf.scale.matches.length > 0 && (phase.pdf.scale.mPerPt || chosen) && (
            <Tables pdf={phase.pdf} chosen={chosen} review={review} overrides={overrides} setOverrides={setOverrides} modelOverrides={modelOverrides} setModelOverrides={setModelOverrides} />
          )}
        </div>
      )}
    </main>
  );
}

/** The dimension check and, once the PDF's walls are built, the model check; one CSV for both. */
function Tables(p: { pdf: PdfInfo; chosen: PlanScale | null; review: PdfReview | null; overrides: Overrides; setOverrides: (o: Overrides) => void; modelOverrides: Overrides; setModelOverrides: (o: Overrides) => void }) {
  const scale = p.pdf.scale!;
  const mPerPt = p.chosen ? p.pdf.pxPerPt / p.chosen.pxPerM : scale.mPerPt!;
  const rows = dimensionRows(scale.matches, mPerPt, p.overrides);
  // The model rows come from the review worker (step W.1) without overrides; the user's are laid on here.
  const model = p.review ? withOverrides(p.review.model, p.modelOverrides, (r) => r.index) : [];
  const csv = () => rowsToCsv(rows, model);
  const at = p.chosen ? "at the scale in use" : "at the PDF's scale";
  return (
    <div className="flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-start-2">
      <DimensionCheck kind="printed" rows={rows} measuredAt={at} overrides={p.overrides} setOverrides={p.setOverrides} csv={csv} />
      {model.length > 0 && <DimensionCheck kind="model" rows={model} measuredAt={`built ${at}`} overrides={p.modelOverrides} setOverrides={p.setModelOverrides} csv={csv} />}
    </div>
  );
}

/** What the build made, in plain words, and the way into the studio. */
function Summary({ built, carried, drawingNote, onOpen }: { built: Built; carried: number; drawingNote: string | null; onOpen: () => void }) {
  const { plan, report } = built;
  useUnitsStore((st) => st.length); // re-render when the display unit changes (the notes below quote lengths)
  const count = (k: string) => plan.openings.filter((o) => o.kind === k).length;
  const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;
  // Free ends are listed as their own line, so their validator messages are left out here.
  const problems = report.problems.filter((p) => !p.includes("isn't shared with any other wall"));
  const notes = [
    report.freeEnds.length > 0 && `${n(report.freeEnds.length, "wall end doesn't", "wall ends don't")} meet another wall.`,
    report.wideOpenings.length > 0 && `${n(report.wideOpenings.length, "wide opening", "wide openings")} (over ${lenText(2.4)}) kept as ${report.wideOpenings.length === 1 ? "a door" : "doors"}.`,
    report.droppedPairs.length > 0 && `${n(report.droppedPairs.length, "gap", "gaps")} over ${lenText(4)} left open rather than made into a door.`,
    report.unbridged.length > 0 && `${n(report.unbridged.length, "opening", "openings")} couldn't be placed on a wall.`,
    report.removedWalls.length > 0 && `${n(report.removedWalls.length, "very short wall", "very short walls")} removed.`,
  ].filter(Boolean) as string[];

  return (
    <section aria-labelledby="summary-heading" className="flex flex-col gap-3 rounded border border-stone bg-vellum p-4" data-testid="summary">
      <h2 id="summary-heading" className="font-display text-lg">
        Your model
      </h2>
      <p data-testid="summary-counts">
        <span title="Wall pieces are merged across doors and windows.">{n(plan.walls.length, "wall", "walls")} after joining</span>, {n(count("door"), "door", "doors")}, {n(count("window"), "window", "windows")}, {n(plan.rooms.length, "room", "rooms")}.
      </p>
      <p className="-mt-2 text-xs text-smoke">Wall pieces are merged across doors and windows, so this is fewer than the pieces found.</p>
      {plan.rooms.length > 0 ? (
        <ul className="list-disc pl-5 text-sm" data-testid="summary-rooms">
          {plan.rooms.map((r) => (
            <li key={r.id}>{r.name}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm">No closed rooms were found, so the floor isn&apos;t divided into rooms yet. You can still open the plan and close the gaps in the studio.</p>
      )}
      {(plan.takeoffs?.length ?? 0) > 0 && (
        <p className="text-sm text-smoke" data-testid="summary-takeoffs" data-takeoffs={plan.takeoffs!.length}>
          {n(plan.takeoffs!.length, "printed dimension", "printed dimensions")} carried into the studio as takeoffs, to check against the model there.
          {carried > MAX_PDF_TAKEOFFS && ` Only the first ${MAX_PDF_TAKEOFFS} of ${carried} were carried.`}
        </p>
      )}
      {drawingNote && (
        <p className="text-sm text-smoke" data-testid="summary-drawing-note">
          {drawingNote}
        </p>
      )}
      {notes.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-smoke">
          {notes.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      {problems.length > 0 && (
        <details className="text-sm text-smoke">
          <summary className="cursor-pointer text-iron">{n(problems.length, "thing", "things")} to check in the studio</summary>
          <ul className="mt-1 list-disc pl-5">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </details>
      )}
      <button type="button" className={primaryBtn} onClick={onOpen}>
        Open in studio
      </button>
    </section>
  );
}
