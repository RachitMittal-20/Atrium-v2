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
 *     printed dimensions, the title block, and the warning when they disagree.
 * Connects to: src/types/pdf.ts (PdfInfo), src/lib/pdf/extract.ts (paperName).
 */
import { paperName } from "@/lib/pdf/extract";
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
