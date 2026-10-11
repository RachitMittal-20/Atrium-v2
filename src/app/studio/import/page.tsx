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
 * plan store's loadPlan and goes to /studio.
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
 * coverage (CoveragePanel, with the traced walls dashed on the overlay) and a
 * second table, "Model versus printed". The layout is a grid: on a phone the
 * plan, then the side panels (PDF, coverage, scale, Build), then the tables;
 * from lg the tables sit under the plan beside the panels.
 *
 * Nothing is kept except the plan loaded into the store, which autosaves to
 * the browser (src/store/persistence.ts). Editing walls
 * here is a later piece; this screen only reviews.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { buildFromAnalysis, STAGES, type Analysis, type AnalysisWarning, type Stage } from "@/lib/blueprint/analyse";
import { usePlanStore } from "@/store/planStore";
import { usePersistenceReady } from "@/store/persistence";
import { dimensionRows, modelRows, rowsToCsv, type Overrides } from "@/lib/pdf/dimensions";
import { buildPdfPlan, planToPixels, type PdfBuild } from "@/lib/pdf/snap";
import type { PlanScale } from "@/types/blueprint";
import type { PdfInfo } from "@/types/pdf";
import type { Vec2 } from "@/types/plan";
import { DimensionCheck } from "./DimensionCheck";
import { Cancelled, checkFile, decodeImage, isPdf, runAnalysis, runPdf, STAGE_LABELS, type PdfPageSize } from "./importFile";
import { CoveragePanel, PagePicker, PdfPanel } from "./PdfPanels";
import { PlanViewer } from "./PlanViewer";
import { primaryBtn, ScalePanel, secondaryBtn } from "./ScalePanel";

type Phase =
  | { kind: "idle" }
  | { kind: "busy"; stage: Stage | null; fraction: number; pdf?: boolean }
  | { kind: "pages"; count: number; listed: PdfPageSize[] }
  | { kind: "error"; message: string }
  | { kind: "results"; analysis: Analysis; original: { width: number; height: number }; pdf?: PdfInfo };

type Built = ReturnType<typeof buildFromAnalysis> | PdfBuild;

/** The build for a page: a vector PDF with walls read from its lines goes through snap.ts. */
function buildFor(analysis: Analysis, pdf: PdfInfo | undefined, scale: PlanScale): Built {
  return pdf?.vectorWalls ? buildPdfPlan(analysis, pdf, scale) : buildFromAnalysis(analysis, scale);
}

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
  const [dragging, setDragging] = useState(false);
  const [chosen, setChosen] = useState<PlanScale | null>(null);
  const [picking, setPicking] = useState(false);
  const [points, setPoints] = useState<Vec2[]>([]);
  const [built, setBuilt] = useState<Built | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [overrides, setOverrides] = useState<Overrides>({});
  const [modelOverrides, setModelOverrides] = useState<Overrides>({});
  const pdfPageRef = useRef<(n: number) => void>(() => {});
  const fileRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<() => void>(() => {});

  const reset = () => {
    cancelRef.current();
    setPhase({ kind: "idle" });
    setChosen(null);
    setPicking(false);
    setPoints([]);
    setBuilt(null);
    setBuildError(null);
    setThumbs({});
    setOverrides({});
    setModelOverrides({});
  };

  async function start(blob: Blob) {
    reset();
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
    setPhase({ kind: "busy", stage: null, fraction: 0, pdf: true });
    const job = runPdf(file, {
      pages: (count, listed) => (count === 1 ? job.page(1) : setPhase({ kind: "pages", count, listed })),
      thumb: (n, url) => setThumbs((t) => ({ ...t, [n]: url })),
      progress: (stage, fraction) => setPhase({ kind: "busy", stage, fraction, pdf: true }),
      done: (analysis, pdf) => {
        // Development only: scripts/e2e-pdf-import.ts reads these.
        if (process.env.NODE_ENV === "development") Object.assign(window, { __importAnalysis: analysis, __importPdf: pdf });
        setPhase({ kind: "results", analysis, original: { width: analysis.pixels.width, height: analysis.pixels.height }, pdf });
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
    else void start(file);
  }

  async function trySample() {
    try {
      const res = await fetch("/samples/sample-plan.png");
      if (!res.ok) throw new Error();
      await start(await res.blob());
    } catch {
      setPhase({ kind: "error", message: "The sample plan couldn't be loaded. Check your connection and try again." });
    }
  }

  const choose = (s: PlanScale) => {
    setChosen(s);
    setBuilt(null); // a new scale makes the old build stale
    setPicking(false);
  };

  // A vector PDF's merged build at the scale in use (the chosen one, else the PDF's), for the
  // coverage report and the model check before Build; Build makes the same plan.
  const results = phase.kind === "results" ? phase : null;
  const scaleInUse: PlanScale | null = chosen ?? (results?.pdf?.vectorWalls && results.analysis.scale.pxPerM ? { pxPerM: results.analysis.scale.pxPerM, source: "pdf" } : null);
  const review = useMemo(() => {
    if (!results?.pdf?.vectorWalls || !scaleInUse) return null;
    try {
      return buildPdfPlan(results.analysis, results.pdf, scaleInUse);
    } catch {
      return null; // Build model shows the error
    }
  }, [results, scaleInUse?.pxPerM]); // eslint-disable-line react-hooks/exhaustive-deps -- the scale's value, not its object

  function build(analysis: Analysis, pdf?: PdfInfo) {
    if (!chosen) return;
    try {
      setBuilt(buildFor(analysis, pdf, chosen));
      setBuildError(null);
    } catch (e) {
      setBuilt(null);
      setBuildError(e instanceof Error ? e.message : "The model couldn't be built from this reading.");
    }
  }

  function openInStudio() {
    if (!built) return;
    usePlanStore.getState().loadPlan(built.plan);
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
            {phase.stage === null && <li className="text-iron">{phase.pdf ? "Reading the PDF…" : "Opening your image…"}</li>}
            {STAGES.map((s) => {
              const at = phase.stage === null ? -1 : STAGES.indexOf(phase.stage);
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
            Try another file
          </button>
        </section>
      )}

      {phase.kind === "results" && (
        // Grid: phone order is plan, panels, tables; from lg the panels span both rows on the right.
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start" data-testid="results">
          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            <PlanViewer
              analysis={phase.analysis}
              picking={picking}
              points={points}
              onPick={(p) => setPoints((ps) => (ps.length >= 2 ? [p] : [...ps, p]))}
              traced={
                review && scaleInUse
                  ? review.coverage.tracedWalls.map((w) => {
                      const px = planToPixels(review.coverage, scaleInUse.pxPerM);
                      return { id: w.id, a: px(w.a), b: px(w.b), thickness: w.thickness * scaleInUse.pxPerM };
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
            {phase.analysis.warnings.length > 0 && (
              <ul role="status" className="flex flex-col gap-1 rounded border border-gilt/50 bg-vellum p-4 text-sm" data-testid="warnings">
                {phase.analysis.warnings.map((w) => (
                  <li key={w.code}>{warningText(w, phase.analysis)}</li>
                ))}
              </ul>
            )}

            {phase.pdf && <PdfPanel pdf={phase.pdf} />}
            {review && <CoveragePanel coverage={review.coverage} />}

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

            <button type="button" className={primaryBtn} disabled={!chosen} onClick={() => build(phase.analysis, phase.pdf)}>
              Build model
            </button>
            {!chosen && <p className="-mt-2 text-sm text-smoke">Choose a scale first.</p>}
            {buildError && <p role="alert">{buildError}</p>}
            {built && <Summary built={built} onOpen={openInStudio} />}

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
function Tables(p: { pdf: PdfInfo; chosen: PlanScale | null; review: PdfBuild | null; overrides: Overrides; setOverrides: (o: Overrides) => void; modelOverrides: Overrides; setModelOverrides: (o: Overrides) => void }) {
  const scale = p.pdf.scale!;
  const mPerPt = p.chosen ? p.pdf.pxPerPt / p.chosen.pxPerM : scale.mPerPt!;
  const rows = dimensionRows(scale.matches, mPerPt, p.overrides);
  const c = p.review?.coverage;
  // Ends within 3 raster pixels of a wall line, face or jamb land on it.
  const model = p.review && c ? modelRows(scale.matches, p.review.plan, (x, y) => ({ x: x * c.mPerPt - c.origin.x, y: y * c.mPerPt - c.origin.y }), (3 * c.traceMm) / 1000, p.modelOverrides) : [];
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
function Summary({ built, onOpen }: { built: Built; onOpen: () => void }) {
  const { plan, report } = built;
  const count = (k: string) => plan.openings.filter((o) => o.kind === k).length;
  const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;
  // Free ends are listed as their own line, so their validator messages are left out here.
  const problems = report.problems.filter((p) => !p.includes("isn't shared with any other wall"));
  const notes = [
    report.freeEnds.length > 0 && `${n(report.freeEnds.length, "wall end doesn't", "wall ends don't")} meet another wall.`,
    report.wideOpenings.length > 0 && `${n(report.wideOpenings.length, "wide opening", "wide openings")} (over 2.4 m) kept as ${report.wideOpenings.length === 1 ? "a door" : "doors"}.`,
    report.droppedPairs.length > 0 && `${n(report.droppedPairs.length, "gap", "gaps")} over 4 m left open rather than made into a door.`,
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
