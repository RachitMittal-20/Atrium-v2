"use client";

/*
 * src/components/feedback/ReportDialog.tsx — "Report a problem" (step D.1): a button and a native <dialog>
 * (showModal(), so the page is inert, focus is trapped and Escape closes) that show EXACTLY the text that
 * would be copied, with an optional note you type, "Copy to clipboard" and "Download as text". Nothing is
 * sent anywhere. The text is built by src/lib/feedback/report.ts from the facts `collect()` returns when the
 * dialog opens; that file's allow-list is why no plan geometry, name or file content can appear.
 * Used by the studio's top bar (TopBar.tsx) and the import screen (src/app/studio/import/page.tsx).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { buildReport, NOTE_MAX, readEnv, type ReportEnv, type ReportFacts } from "@/lib/feedback/report";

const BTN = "min-h-11 rounded border border-stone px-4 text-sm hover:bg-limestone";
const PRIMARY = "min-h-11 rounded bg-cyanotype px-4 text-sm text-vellum";

export function ReportProblem({ collect, className, testId, children }: { collect: () => ReportFacts; className: string; testId: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState<{ facts: ReportFacts; env: ReportEnv } | null>(null);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  const text = open ? buildReport(open.facts, open.env, note) : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied to the clipboard.");
    } catch {
      // No clipboard permission (or an older browser): select the text and use the old command.
      area.current?.select();
      setStatus(document.execCommand("copy") ? "Copied to the clipboard." : "Couldn't copy. Select the text and copy it, or download it.");
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "atrium-report.txt";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setStatus("Downloaded atrium-report.txt.");
  };

  return (
    <>
      <button
        type="button"
        data-testid={testId}
        className={className}
        onClick={() => {
          setNote("");
          setStatus("");
          setOpen({ facts: collect(), env: readEnv() });
        }}
      >
        {children}
      </button>
      <dialog
        ref={ref}
        aria-labelledby="report-h"
        data-testid="report-dialog"
        onClose={() => setOpen(null)}
        className="m-auto max-h-[90svh] w-[min(36rem,calc(100vw-1rem))] rounded border border-stone bg-vellum p-0 text-iron shadow-xl backdrop:bg-iron/40"
      >
        {open && (
          <div className="flex max-h-[90svh] flex-col gap-3 overflow-y-auto p-4">
            <h2 id="report-h" className="font-display text-lg">
              Report a problem
            </h2>
            <p className="text-sm text-smoke">This is everything the report holds, and nothing from your file. Nothing is sent: copy it or download it, then send it to whoever shared Atrium with you.</p>
            <label className="flex flex-col gap-1 text-sm">
              What went wrong? (optional)
              <textarea data-testid="report-note" value={note} maxLength={NOTE_MAX} rows={3} onChange={(e) => setNote(e.target.value)} className="rounded border border-stone bg-limestone p-2 text-sm" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              The report
              <textarea ref={area} data-testid="report-text" readOnly value={text} rows={12} className="rounded border border-stone bg-limestone p-2 font-mono text-xs" />
            </label>
            <p role="status" data-testid="report-status" className="min-h-5 text-sm">
              {status}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" data-testid="report-close" onClick={() => setOpen(null)} className={BTN}>
                Close
              </button>
              <button type="button" data-testid="report-download" onClick={download} className={BTN}>
                Download as text
              </button>
              <button type="button" data-testid="report-copy" onClick={() => void copy()} className={PRIMARY}>
                Copy to clipboard
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
