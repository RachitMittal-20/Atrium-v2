"use client";

/*
 * src/components/studio/TopBar.tsx — the editor's top bar: plan name (editable,
 * undoable through planStore.renamePlan), Undo and Redo, the 3D | 2D | Split
 * switch, a view-options popover (ceilings), an Import menu ("Floor plan image…"
 * goes to /studio/import; "3D model…" opens a file picker whose files go to
 * src/store/importStore.ts, step I.1), an Export menu whose formats are all
 * "Coming soon" (so there is no project file yet to warn about imported models),
 * and a quiet autosave status (src/store/persistence.ts). Split is hidden below 640 px.
 * Mounted by src/app/studio/page.tsx.
 */
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ACCEPT } from "@/lib/import/loadModel";
import { useImportStore } from "@/store/importStore";
import { useCanRedo, useCanUndo, usePlanStore } from "@/store/planStore";
import { useSaveStatus } from "@/store/persistence";
import { EditableText } from "./EditableText";

export type View = "3d" | "2d" | "split";

const icon = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);

const BTN = "inline-flex min-h-10 items-center gap-1.5 rounded px-2.5 text-sm hover:bg-vellum/10";

/** A button that opens a small vellum panel; closes on Escape, outside click or tabbing away. `children` may take a close function. */
function Popover({ label, shortLabel, glyph, testId, children }: { label: string; shortLabel: string; glyph: ReactNode; testId: string; children: ReactNode | ((close: () => void) => ReactNode) }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          setOpen(false);
          button.current?.focus();
        }
      }}
      onBlur={(e) => e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node) && setOpen(false)}
    >
      <button ref={button} type="button" data-testid={testId} aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)} className={BTN}>
        {glyph}
        <span className="max-sm:sr-only">{shortLabel}</span>
      </button>
      {open && <div className="absolute right-0 top-full z-30 mt-2 w-56 rounded border border-stone bg-vellum p-2 text-sm text-iron shadow-lg">{typeof children === "function" ? children(() => setOpen(false)) : children}</div>}
    </div>
  );
}

export function TopBar({ view, setView, showCeiling, setShowCeiling }: { view: View; setView: (v: View) => void; showCeiling: boolean; setShowCeiling: (v: boolean) => void }) {
  const name = usePlanStore((s) => s.plan.name);
  const { renamePlan, undo, redo } = usePlanStore.getState();
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  const saveStatus = useSaveStatus((s) => s.status);
  const picker = useRef<HTMLInputElement>(null);

  const views: { id: View; label: string; cls?: string }[] = [
    { id: "3d", label: "3D" },
    { id: "2d", label: "2D" },
    { id: "split", label: "Split", cls: "max-sm:hidden" },
  ];

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 bg-cyanotype px-3 py-1.5 text-vellum">
      <EditableText value={name} onCommit={renamePlan} label="Plan name" testId="plan-name" className="font-display min-w-0 flex-1 basis-40 py-1 text-lg text-vellum hover:bg-vellum/10 focus:bg-vellum/20 md:max-w-sm md:flex-none" />

      <button type="button" data-testid="undo" onClick={undo} disabled={!canUndo} className={`${BTN} disabled:opacity-40 disabled:hover:bg-transparent`}>
        {icon(<path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />)}
        <span className="max-sm:sr-only">Undo</span>
      </button>
      <button type="button" data-testid="redo" onClick={redo} disabled={!canRedo} className={`${BTN} disabled:opacity-40 disabled:hover:bg-transparent`}>
        {icon(<path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" />)}
        <span className="max-sm:sr-only">Redo</span>
      </button>

      {/* Autosave status: on a phone it is read aloud only, to keep the bar short. */}
      <span role="status" data-testid="save-status" data-state={saveStatus} className="text-xs text-vellum/80 max-sm:sr-only">
        {{ idle: "", pending: "Saving…", saved: "Saved in this browser", error: "Couldn't save in this browser" }[saveStatus]}
      </span>

      <div role="group" aria-label="View" className="flex rounded border border-vellum/40 p-0.5 md:ml-auto">
        {views.map((v) => (
          <button
            key={v.id}
            type="button"
            data-testid={`view-${v.id}`}
            aria-pressed={view === v.id}
            onClick={() => setView(v.id)}
            className={`min-h-9 rounded-sm px-3 text-sm ${v.cls ?? ""} ${view === v.id ? "bg-vellum text-cyanotype" : "hover:bg-vellum/10"}`}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-1 md:ml-0">
        <Popover label="View options" shortLabel="View" testId="view-options" glyph={icon(<path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" />)}>
          <label className="flex min-h-10 items-center gap-2 px-1">
            <input type="checkbox" data-testid="show-ceilings" checked={showCeiling} onChange={(e) => setShowCeiling(e.target.checked)} className="h-4 w-4 accent-cyanotype" />
            Show ceilings
          </label>
        </Popover>

        <Popover label="Import" shortLabel="Import" testId="import-menu" glyph={icon(<path d="M12 15V4M7 9l5-5 5 5M5 20h14" />)}>
          {(close) => (
            <ul>
              <li>
                <Link href="/studio/import" data-testid="import-link" className="flex min-h-10 items-center rounded px-2 hover:bg-limestone">
                  Floor plan image…
                </Link>
              </li>
              <li>
                <button
                  type="button"
                  data-testid="import-model"
                  onClick={() => {
                    close();
                    picker.current?.click();
                  }}
                  className="flex min-h-10 w-full items-center rounded px-2 text-left hover:bg-limestone"
                >
                  3D model…
                </button>
              </li>
            </ul>
          )}
        </Popover>
        {/* The real file input, outside the menu so it outlives it. Files are read in this browser and never uploaded. */}
        <input
          ref={picker}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          data-testid="import-model-input"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = ""; // so choosing the same file again still fires
            void useImportStore.getState().openFiles(files);
          }}
        />

        <Popover label="Export" shortLabel="Export" testId="export-menu" glyph={icon(<path d="M12 4v11M7 10l5 5 5-5M5 20h14" />)}>
          <ul>
            {["GLB", "OBJ", "PDF", "DXF", "CSV"].map((f) => (
              <li key={f}>
                <button type="button" aria-disabled="true" onClick={(e) => e.preventDefault()} className="flex min-h-10 w-full cursor-not-allowed items-center justify-between rounded px-2 text-left text-smoke hover:bg-limestone">
                  {f} <span className="text-xs">Coming soon</span>
                </button>
              </li>
            ))}
          </ul>
        </Popover>
      </div>
    </header>
  );
}
