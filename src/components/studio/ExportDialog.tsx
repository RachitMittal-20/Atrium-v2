"use client";

/*
 * src/components/studio/ExportDialog.tsx — the Export menu's file exports (step X.2): one native <dialog>
 * (showModal(), so the page is inert, focus is trapped and Escape closes) for "Report (PDF)", "3D model
 * (GLB)" and "3D model (OBJ)", and `downloadSchedule()` for "Area schedule (CSV)", which needs no dialog.
 * The TopBar calls `startExport(kind)`. The dialog says what the file holds, and for GLB and OBJ that
 * imported 3D models are NOT included; Download builds the file and saves it.
 * The builders are loaded only now, with a dynamic import: src/lib/export/report.ts (pdf-lib) and
 * src/lib/export/model3d.ts (three's GLTFExporter and OBJExporter), so none of them is in the
 * studio's first load. Everything is made in this browser; nothing is uploaded or fetched (the report's
 * fonts are the PDF standard fonts every reader has). Values follow the one units setting
 * (src/store/unitsStore.ts). A failure is said in plain words, the details go to the console.
 * Mounted by src/app/studio/page.tsx; the area schedule's panel is SchedulePanel.tsx.
 */
import { useEffect, useRef } from "react";
import { create } from "zustand";
import { restoreFocus } from "@/lib/focusReturn";
import { buildSchedule, exportFileName, scheduleCells } from "@/lib/export/schedule";
import { toCsv } from "@/lib/takeoff/rows";
import { AREA_LABEL, LENGTH_LABEL } from "@/lib/units/format";
import { usePlanStore } from "@/store/planStore";
import { useUnitsStore } from "@/store/unitsStore";

export type ExportKind = "pdf" | "glb" | "obj";
const useExport = create<{ kind: ExportKind | null; busy: boolean; error: string | null }>(() => ({ kind: null, busy: false, error: null }));
export const startExport = (kind: ExportKind) => useExport.setState({ kind, busy: false, error: null });
const close = () => useExport.setState({ kind: null });

/** Saves `data` as a file through a temporary link: the browser's own download, nothing sent anywhere. */
export function saveFile(data: BlobPart, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Area schedule (CSV): rooms then openings, in the current units. */
export function downloadSchedule() {
  const plan = usePlanStore.getState().plan;
  const { length, area } = useUnitsStore.getState();
  saveFile(toCsv(scheduleCells(buildSchedule(plan), { length, area })), "text/csv;charset=utf-8", exportFileName(plan.name, "schedule.csv"));
}

const TITLE: Record<ExportKind, string> = { pdf: "Report (PDF)", glb: "3D model (GLB)", obj: "3D model (OBJ)" };

async function build(kind: ExportKind) {
  const plan = usePlanStore.getState().plan;
  if (kind === "pdf") {
    const { length, area } = useUnitsStore.getState();
    const { buildReport } = await import("@/lib/export/report");
    const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const bytes = await buildReport({ plan, units: { length, area }, date });
    saveFile(bytes.slice().buffer, "application/pdf", exportFileName(plan.name, "report.pdf"));
  } else {
    const { toGlb, toObj } = await import("@/lib/export/model3d");
    if (kind === "glb") saveFile(await toGlb(plan), "model/gltf-binary", exportFileName(plan.name, "model.glb"));
    else saveFile(toObj(plan), "text/plain", exportFileName(plan.name, "model.obj"));
  }
}

const BTN = "min-h-11 rounded border border-stone px-4 text-sm hover:bg-limestone";
const PRIMARY = "min-h-11 rounded bg-cyanotype px-4 text-sm text-vellum disabled:opacity-50";

export function ExportDialog() {
  const { kind, busy, error } = useExport();
  const ref = useRef<HTMLDialogElement>(null);
  const units = useUnitsStore();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (kind && !el.open) el.showModal();
    if (!kind && el.open) el.close();
  }, [kind]);

  const go = async () => {
    if (!kind) return;
    useExport.setState({ busy: true, error: null });
    try {
      await build(kind);
      close();
    } catch (e) {
      console.error("Export failed", e);
      useExport.setState({ busy: false, error: "The file could not be made in this browser. Try again, or reload the page." });
    }
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="export-h"
      data-testid="export-dialog"
      data-kind={kind ?? ""}
      data-busy={busy}
      onClose={() => {
        close();
        restoreFocus(); // the menu item that opened this is gone: focus goes back to its menu button
      }}
      className="m-auto max-h-[90svh] w-[min(28rem,calc(100vw-1rem))] rounded border border-stone bg-vellum p-0 text-iron shadow-xl backdrop:bg-iron/40"
    >
      {kind && (
        <div className="flex flex-col gap-3 p-4">
          <h2 id="export-h" className="font-display text-lg">
            {TITLE[kind]}
          </h2>
          {kind === "pdf" ? (
            <p className="text-sm text-smoke">
              A4 landscape: the room and openings schedules, every takeoff and PDF dimension with its status and any override beside the measured value, the plan&apos;s verdict, where its
              scale came from, and a drawing of the plan with room names. Lengths in {LENGTH_LABEL[units.length]}, areas in {AREA_LABEL[units.area]}, as set in Units.
            </p>
          ) : (
            <>
              <p className="text-sm text-smoke">
                The walls with their door and window openings cut, and the room floors, in metres with Y up. Each wall and floor is named by its id.
              </p>
              <p className="text-sm" data-testid="export-not-included">
                Imported 3D models are not included, and neither are door and window frames or ceilings.
              </p>
            </>
          )}
          <p className="text-xs text-smoke">The file is made in this browser and stays on your device.</p>
          {error && (
            <p role="alert" className="text-sm text-gilt-ink" data-testid="export-error">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={BTN} onClick={close} disabled={busy}>
              Cancel
            </button>
            <button type="button" data-testid="export-download" className={PRIMARY} onClick={() => void go()} disabled={busy}>
              {busy ? "Preparing…" : "Download"}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
