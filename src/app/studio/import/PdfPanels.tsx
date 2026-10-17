"use client";

/*
 * src/app/studio/import/PdfPanels.tsx — the PDF parts of the import screen
 * (page.tsx), step M.1a:
 *   - PagePicker: one button per page of a multi-page PDF (at most 30 listed),
 *     with the thumbnail the PDF worker drew for it, its paper size and its
 *     number; choosing one reads that page;
 *   - PdfPanel: on the review screen, the page's kind as a badge ("Vector
 *     PDF", "Scanned PDF", "Mixed PDF"), its notes ("Read from PDF vectors",
 *     the tracing tolerance, or "Scanned PDF: measurements are approximate"),
 *     and for a vector page the scale the PDF gave with its sources: the
 *     printed dimensions, the title block, and the warning when they disagree;
 *   - CoveragePanel (step M.1b): how much of the plan was read exactly from the
 *     PDF's lines (snap.ts's Coverage): "N of M walls read exactly from the PDF
 *     (X% of wall length); K walls are traced approximately (about Y mm)", the
 *     traced walls (also drawn in gilt dashes on the overlay) with why, the
 *     out-of-range gaps (step M.1d: collinear gaps outside 0.45–4 m, not read as
 *     openings, listed with their sizes and highlighted on the overlay), the
 *     diagonal and curved walls skipped, openings snapped, traced and added,
 *     and any fallback. Step M.1c adds the openings line ("A of B openings read
 *     exactly (doors D, windows W, unclassified U); C traced approximately; K
 *     arcs not used"), the default heights, and lists of the unclassified
 *     openings (assumed doors), the traced ones and the arcs not used, with why.
 *     Step M.2b adds the dropped-phantom sentence ("N traced openings dropped because
 *     the PDF draws solid wall there (sizes: …)").
 * Connects to: src/types/pdf.ts (PdfInfo), src/lib/pdf/extract.ts (paperName),
 * src/lib/pdf/snap.ts (Coverage).
 */
import { DOOR_SIZE, WINDOW_SIZE } from "@/data/samplePlan";
import { paperName } from "@/lib/pdf/extract";
import { OPENING_WIDTH } from "@/lib/pdf/openings";
import { conflictText, PDF_ONLY_LINE, type Coverage } from "@/lib/pdf/snap";
import { formatLength, STUDIO_DP, type LengthUnit } from "@/lib/units/format";
import { useUnitsStore } from "@/store/unitsStore";
import type { PdfInfo } from "@/types/pdf";
import type { PdfPageSize } from "./importFile";

const KIND_TEXT: Record<PdfInfo["kind"], string> = { vector: "Vector PDF", scanned: "Scanned PDF", mixed: "Mixed PDF" };
const STATUS_TEXT = { good: "Scale found", check: "Please confirm the scale", none: "No scale found" } as const;

export function PagePicker({ count, listed, thumbs, onPick }: { count: number; listed: PdfPageSize[]; thumbs: Record<number, string>; onPick: (n: number) => void }) {
  return (
    <section aria-labelledby="pages-heading" className="mx-auto flex max-w-4xl flex-col gap-4" data-testid="page-picker">
      <div>
        <h2 id="pages-heading" className="font-display text-lg">
          Choose the page with the floor plan
        </h2>
        <p className="text-sm text-smoke">
          This PDF has {count} pages.{count > listed.length && ` The first ${listed.length} are listed; to read a later page, save it as its own PDF.`}
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {listed.map((p) => (
          <li key={p.number}>
            <button
              type="button"
              data-testid={`page-${p.number}`}
              onClick={() => onPick(p.number)}
              className="flex w-full flex-col items-center gap-2 rounded border border-stone bg-vellum p-2 text-sm text-iron transition-colors hover:border-gilt focus-visible:outline-2 focus-visible:outline-gilt"
            >
              <span className="flex h-36 w-full items-center justify-center bg-limestone">
                {thumbs[p.number] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a blob: URL drawn by the PDF worker
                  <img src={thumbs[p.number]} alt="" className="max-h-36 max-w-full border border-stone bg-white" />
                ) : (
                  <span className="text-xs text-smoke">Drawing…</span>
                )}
              </span>
              <span>
                Page {p.number} <span className="text-smoke">· {paperName(p.width, p.height)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PdfPanel({ pdf }: { pdf: PdfInfo }) {
  const s = pdf.scale;
  const ratio = s?.mPerPt ? Math.round(s.mPerPt / ((25.4 / 72) * 0.001)) : null;
  return (
    <section aria-labelledby="pdf-heading" className="flex flex-col gap-3 rounded border border-stone bg-vellum p-4" data-testid="pdf-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="pdf-heading" className="font-display text-lg">
          PDF
        </h2>
        <span data-testid="pdf-badge" data-kind={pdf.kind} className={`rounded-full px-3 py-1 text-sm ${pdf.kind === "scanned" ? "bg-stone text-iron" : "bg-cyanotype text-vellum"}`}>
          {KIND_TEXT[pdf.kind]}
        </span>
      </div>
      <p className="-mt-2 text-sm text-smoke">
        Page {pdf.pageNumber} of {pdf.pageCount}, {pdf.paper}
      </p>
      <ul className="flex flex-col gap-1 text-sm" data-testid="pdf-notes">
        {pdf.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      {s && (
        <div className="flex flex-col gap-2 border-t border-stone pt-3" data-testid="pdf-scale">
          <p>
            <strong data-testid="pdf-scale-status" data-confidence={s.confidence}>
              {STATUS_TEXT[s.confidence]}
            </strong>
            {ratio && <span className="text-smoke"> · measures 1:{ratio} on {pdf.paper}</span>}
          </p>
          <p className="text-sm" data-testid="pdf-scale-reason">
            {s.reason}
          </p>
          {s.mismatch && (
            <p role="status" className="rounded border border-gilt/60 bg-limestone p-3 text-sm" data-testid="pdf-mismatch">
              {s.mismatch}
            </p>
          )}
          <ul className="list-disc pl-5 text-sm text-smoke" data-testid="pdf-scale-sources">
            <li>
              Printed dimensions:{" "}
              {s.dimensions.n === 0
                ? "none measured"
                : `${s.dimensions.n} measured${s.dimensions.n > 1 ? `, within ${s.dimensions.spreadPct.toFixed(1)}% of each other` : ""}`}
              {s.rejected.length > 0 && `; ${s.rejected.length} with no line beside it`}
            </li>
            <li>Title block: {s.title ? `${s.title.text} on ${pdf.paper}` : "no scale printed"}</li>
          </ul>
        </div>
      )}
    </section>
  );
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The coverage line, as the review screen and the tests read it. */
export function coverageLine(c: Coverage, unit: LengthUnit = "mm"): string {
  const pct = c.lengthM > 0 ? Math.round((100 * c.exactLengthM) / c.lengthM) : 0;
  return `${c.exact} of ${c.walls} walls read exactly from the PDF (${pct}% of wall length); ${count(c.traced, "wall is", "walls are")} traced approximately (about ${formatLength(c.traceMm / 1000, unit)}).`;
}

/** The openings line (step M.1c), as the review screen and the tests read it. */
export function openingsLine(c: Coverage): string {
  const o = c.openings;
  return `${o.exact} of ${o.total} openings read exactly (doors ${o.doors}, windows ${o.windows}, unclassified ${o.unclassified}); ${o.traced} traced approximately; ${count(o.arcsNotUsed, "arc", "arcs")} not used.`;
}

/** The out-of-range gap sentence (step M.1d), or "" when there are none. */
export function gapsLine(c: Coverage, unit: LengthUnit = "mm"): string {
  const g = c.outOfRangeGaps;
  if (!g.length) return "";
  // The studio's own decimals, so metres read "0.45 m to 4.00 m … 0.30 m, 4.60 m" rather than three places.
  const len = (m: number) => formatLength(m, unit, STUDIO_DP.length);
  return `${count(g.length, "gap", "gaps")} outside ${len(OPENING_WIDTH[0])} to ${len(OPENING_WIDTH[1])} ${g.length === 1 ? "was" : "were"} not read as openings (sizes: ${g.map((x) => len(x.size)).join(", ")}).`;
}

/** Step Q.1: the furniture sentence (walls.ts rules 6 and 7, and the clutter rule), or "" when nothing was left out. */
export function furnitureLine(c: Pick<Coverage, "furniture">): string {
  const n = c.furniture.length;
  return n ? `${count(n, "group of lines was", "groups of lines were")} read as furniture or fixtures, not walls, and left out:` : "";
}
const FURNITURE_KIND = { loop: "Small closed loop", island: "Free-standing group", small: "Short piece joined to nothing" } as const;

/** Step Q.2 (rule 8b): how many free wall ends the PDF-only plan keeps, and where, or "" when none. */
export function freeEndsLine(c: Pick<Coverage, "freeEnds">, unit: LengthUnit = "mm"): string {
  const n = c.freeEnds.length;
  if (!n) return "";
  const len = (m: number) => formatLength(m, unit, STUDIO_DP.length);
  const where = c.freeEnds.slice(0, 3).map((p) => `x ${len(p.x)}, y ${len(p.y)}`).join("; ");
  return `${count(n, "free wall end remains", "free wall ends remain")}, as the PDF draws ${n === 1 ? "it" : "them"} (${where}${n > 3 ? "; …" : ""} from the plan's top-left): a wall stopping short, or one the PDF does not draw. Check ${n === 1 ? "it" : "them"} on the plan.`;
}

/** Step Q.2: one detached group as the overlay labels it and the report lists it ("Left out: title
 *  block, 8.65 × 3.53 m" or "Kept: separate building, 4.20 × 3.20 m"). */
export function detachedLabel(d: Coverage["detached"][number], unit: LengthUnit = "mm"): string {
  const len = (m: number) => formatLength(m, unit, STUDIO_DP.length);
  return `${d.dropped ? "Left out: title block" : "Kept: separate building"}, ${len(d.size.w)} × ${len(d.size.d)}`;
}

/** Step Q.2: the detached-groups sentence (walls.ts rule 7b), or "" when there are none. */
export function detachedLine(c: Pick<Coverage, "detached">): string {
  const n = c.detached.length;
  return n ? `${count(n, "group of walls lies", "groups of walls lie")} outside the building, joined to nothing in it, outlined on the plan:` : "";
}

/** The dropped-phantom sentence (step M.2b), or "" when nothing was dropped. */
export function droppedLine(c: Coverage, unit: LengthUnit = "mm"): string {
  const d = c.droppedOpenings;
  if (!d.length) return "";
  const len = (m: number) => formatLength(m, unit, STUDIO_DP.length);
  return `${count(d.length, "traced opening", "traced openings")} dropped because the PDF draws solid wall there (sizes: ${d.map((o) => len(o.size)).join(", ")}).`;
}

export function CoveragePanel({ coverage: c }: { coverage: Coverage }) {
  const unit = useUnitsStore((st) => st.length); // the one units setting (step U.1)
  const len = (m: number) => formatLength(m, unit, STUDIO_DP.length);
  const wallLen = (w: Coverage["tracedWalls"][number]) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
  return (
    <section aria-labelledby="coverage-heading" className="flex flex-col gap-2 rounded border border-stone bg-vellum p-4" data-testid="coverage">
      <h2 id="coverage-heading" className="font-display text-lg">
        Read from the PDF
      </h2>
      <p data-testid="coverage-line" data-exact={c.exact} data-walls={c.walls} data-traced={c.traced}>
        {coverageLine(c, unit)}
      </p>
      {c.pdfOnly && (
        <p className="font-medium" data-testid="coverage-pdf-only">
          {PDF_ONLY_LINE}
        </p>
      )}
      {c.pdfOnly && c.freeEnds.length > 0 && (
        <p data-testid="coverage-free-ends" data-count={c.freeEnds.length}>
          {freeEndsLine(c, unit)}
        </p>
      )}
      <p data-testid="coverage-openings-line" data-exact={c.openings.exact} data-total={c.openings.total} data-traced={c.openings.traced} data-unclassified={c.openings.unclassified} data-arcs={c.openings.arcsNotUsed}>
        {openingsLine(c)}
      </p>
      {c.droppedOpenings.length > 0 && (
        <p className="text-sm text-smoke" data-testid="coverage-dropped-line" data-dropped={c.droppedOpenings.length} data-sizes={c.droppedOpenings.map((o) => o.size.toFixed(4)).join(" ")}>
          {droppedLine(c, unit)} The tracing read a gap the PDF does not draw.
        </p>
      )}
      {c.outOfRangeGaps.length > 0 && (
        <p data-testid="coverage-gaps-line" data-gaps={c.outOfRangeGaps.length} data-sizes={c.outOfRangeGaps.map((g) => g.size.toFixed(4)).join(" ")}>
          <span aria-hidden className="mr-2 inline-block h-2.5 w-4 border-2 border-dashed border-overlay-door align-middle" />
          {gapsLine(c, unit)} A gap narrower than {len(OPENING_WIDTH[0])} is closed as wall; a wider one leaves the wall open. Draw or place them yourself.
        </p>
      )}
      {c.conflicts.length > 0 && (
        <ul className="list-disc pl-5" data-testid="coverage-conflicts" data-count={c.conflicts.length}>
          {c.conflicts.map((x, i) => (
            <li key={i} data-kind={x.kind} data-width={x.width.toFixed(4)} data-traced={x.traced?.length ?? 0}>
              <span aria-hidden className="mr-2 inline-block h-2.5 w-4 border-2 border-dashed border-overlay-door align-middle" />
              {conflictText(x, i, unit)} Atrium never puts a wall&apos;s end inside an opening: place it again in the studio if it is real.
            </li>
          ))}
        </ul>
      )}
      {c.openings.total > 0 && (
        <p className="text-sm text-smoke" data-testid="coverage-heights">
          Heights are not in a PDF: doors are {len(DOOR_SIZE.height)} and windows {len(WINDOW_SIZE.height)} on a {len(WINDOW_SIZE.sillHeight)} sill (default height). Change them in the studio.
        </p>
      )}
      {c.furniture.length > 0 && (
        <details className="text-sm" open={c.furniture.length <= 6}>
          <summary className="cursor-pointer" data-testid="coverage-furniture-line" data-count={c.furniture.length}>
            {furnitureLine(c)}
          </summary>
          <ul className="mt-1 list-disc pl-5 text-smoke" data-testid="coverage-furniture">
            {c.furniture.map((f, i) => (
              <li key={i} data-kind={f.kind} data-w={f.size.w.toFixed(4)} data-d={f.size.d.toFixed(4)} data-x={f.centre.x.toFixed(4)} data-y={f.centre.y.toFixed(4)}>
                <span className="text-iron">
                  {FURNITURE_KIND[f.kind]}, {len(f.size.w)} × {len(f.size.d)}
                </span>
                , centred at x {len(f.centre.x)}, y {len(f.centre.y)} from the plan&apos;s top-left ({count(f.walls, "piece", "pieces")})
              </li>
            ))}
          </ul>
        </details>
      )}
      {c.detached.length > 0 && (
        <details className="text-sm" open>
          <summary className="cursor-pointer" data-testid="coverage-detached-line" data-count={c.detached.length} data-dropped={c.detached.filter((d) => d.dropped).length}>
            <span aria-hidden className="mr-2 inline-block h-2.5 w-4 border-2 border-dashed border-overlay-end align-middle" />
            {detachedLine(c)}
          </summary>
          <ul className="mt-1 list-disc pl-5 text-smoke" data-testid="coverage-detached">
            {c.detached.map((d, i) => (
              <li key={i} data-dropped={d.dropped} data-w={d.size.w.toFixed(4)} data-d={d.size.d.toFixed(4)}>
                <span className="text-iron">{detachedLabel(d, unit)}</span> ({count(d.walls, "piece", "pieces")}): {d.why}
              </li>
            ))}
          </ul>
        </details>
      )}
      {c.unclassifiedOpenings.length > 0 && (
        <details className="text-sm" open={c.unclassifiedOpenings.length <= 6}>
          <summary className="cursor-pointer">
            <span aria-hidden className="mr-2 inline-block h-2.5 w-4 border-2 border-dashed border-overlay-end align-middle" />
            Unclassified openings, boxed on the plan
          </summary>
          <ul className="mt-1 list-disc pl-5 text-smoke" data-testid="coverage-unclassified">
            {c.unclassifiedOpenings.map((o) => (
              <li key={o.id} data-opening={o.id}>
                <span className="text-iron">
                  Opening {o.id}, {len(Math.hypot(o.b.x - o.a.x, o.b.y - o.a.y))}
                </span>
                : Opening type not drawn; assumed door
              </li>
            ))}
          </ul>
        </details>
      )}
      {c.tracedOpenings.length > 0 && (
        <details className="text-sm" open={c.tracedOpenings.length <= 6}>
          <summary className="cursor-pointer">
            <span aria-hidden className="mr-2 inline-block h-2.5 w-4 border-2 border-dashed border-gilt align-middle" />
            Traced openings, boxed on the plan
          </summary>
          <ul className="mt-1 list-disc pl-5 text-smoke" data-testid="coverage-traced-openings">
            {c.tracedOpenings.map((o) => (
              <li key={o.id} data-opening={o.id}>
                <span className="text-iron">
                  Opening {o.id}, {len(Math.hypot(o.b.x - o.a.x, o.b.y - o.a.y))}
                </span>
                : {o.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      {c.unusedArcs.length > 0 && (
        <details className="text-sm text-smoke">
          <summary className="cursor-pointer text-iron">Arcs not used as door swings</summary>
          <ul className="mt-1 list-disc pl-5" data-testid="coverage-arcs">
            {c.unusedArcs.map((a, i) => (
              <li key={i}>
                Radius {len(a.r)}, {Math.round(a.sweep)}°: {a.why}
              </li>
            ))}
          </ul>
        </details>
      )}
      {c.traced > 0 && (
        <details className="text-sm" open={c.traced <= 6}>
          <summary className="cursor-pointer">
            <span aria-hidden className="mr-2 inline-block h-2.5 w-4 border-t-2 border-dashed border-gilt align-middle" />
            Traced walls, dashed on the plan
          </summary>
          <ul className="mt-1 list-disc pl-5 text-smoke" data-testid="coverage-traced">
            {c.tracedWalls.map((w) => (
              <li key={w.id} data-wall={w.id}>
                <span className="text-iron">
                  Wall {w.id}, {len(wallLen(w))}
                </span>
                : {w.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      <ul className="list-disc pl-5 text-sm text-smoke" data-testid="coverage-counts">
        <li data-testid="coverage-skipped">
          {count(c.skipped.diagonal, "diagonal wall", "diagonal walls")} and {count(c.skipped.curved, "curved wall", "curved walls")} skipped (not read yet)
        </li>
        <li data-testid="coverage-openings">
          Doors and windows: {c.openings.snapped} snapped to the PDF, {count(c.openings.replaced, "traced one", "traced ones")} replaced by the PDF&apos;s, {c.openings.traced} traced, {c.openings.added} added from the PDF
        </li>
        {c.added > 0 && <li>{count(c.added, "wall the tracing missed was", "walls the tracing missed were")} added from the PDF</li>}
      </ul>
      {c.notes.length > 0 && (
        <details className="text-sm text-smoke" open={c.fellBack}>
          <summary className="cursor-pointer text-iron">{count(c.notes.length, "note", "notes")}</summary>
          <ul className="mt-1 list-disc pl-5" data-testid="coverage-notes">
            {c.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
