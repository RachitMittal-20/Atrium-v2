"use client";

/*
 * src/components/studio/ProjectDialog.tsx — Save project and Open project (step E.1), one native
 * <dialog> opened with showModal() (the page behind is inert, focus is trapped, Escape closes),
 * plus the hidden real file input Open uses. The TopBar menu items call `startSave()` and
 * `startOpen()`; the work is in src/store/projectStore.ts and the format in
 * src/lib/persist/projectFile.ts.
 *   - Save: a checkbox "Include imported models and the drawing (larger file)", on by default,
 *     and the file's size before saving (about, from the asset store's own byte counts). It
 *     downloads <plan name>.atrium.json. Save is off when the file would be over what Open accepts.
 *   - Open: with unsaved changes it first asks; then the file picker; the result (opened, or why not) is
 *     said in the dialog. Opening is one undo step, so Undo takes the previous plan back.
 * Files are read and written in this browser and never uploaded. Mounted by src/app/studio/page.tsx.
 */
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { formatBytes, MAX_PROJECT_BYTES } from "@/lib/persist/projectFile";
import { isDirty, openProject, projectSizes, saveProject } from "@/store/projectStore";
import { usePlanStore } from "@/store/planStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useToolStore } from "@/store/toolStore";
import { useViewStore } from "@/store/viewStore";

type Mode = "save" | "confirm" | "busy" | "result";
const useDialog = create<{ mode: Mode | null; message: string; ok: boolean }>(() => ({ mode: null, message: "", ok: true }));
const close = () => useDialog.setState({ mode: null });

let picker: HTMLInputElement | null = null; // the hidden file input, set by the mounted component
const choose = () => picker?.click();

export const startSave = () => useDialog.setState({ mode: "save" });
/** Open: ask first when the plan has changes that were never saved to a file, else go straight to the picker. */
export function startOpen() {
  if (isDirty()) useDialog.setState({ mode: "confirm" });
  else choose();
}

/** A file name from the plan's name: no path or reserved characters. */
const fileName = (planName: string) => `${planName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim().replace(/^\.+/, "") || "project"}.atrium.json`;

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const BTN = "min-h-11 rounded border border-stone px-4 text-sm hover:bg-limestone";
const PRIMARY = "min-h-11 rounded bg-cyanotype px-4 text-sm text-vellum disabled:opacity-50";

export function ProjectDialog() {
  const { mode, message, ok } = useDialog();
  const ref = useRef<HTMLDialogElement>(null);
  const planName = usePlanStore((s) => s.plan.name);
  const [include, setInclude] = useState(true);
  const [sizes, setSizes] = useState<Awaited<ReturnType<typeof projectSizes>> | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (mode && !el.open) el.showModal();
    if (!mode && el.open) el.close();
  }, [mode]);

  useEffect(() => {
    if (mode !== "save") return;
    setInclude(true);
    setSizes(null);
    void projectSizes().then(setSizes);
  }, [mode]);

  const size = sizes ? (include ? sizes.withAssets : sizes.without) : null;
  const tooBig = size !== null && size > MAX_PROJECT_BYTES;

  const save = async () => {
    setSaving(true);
    const { text, missing } = await saveProject(include);
    download(text, fileName(planName));
    setSaving(false);
    if (missing > 0) useDialog.setState({ mode: "result", ok: true, message: `Saved. ${missing} imported file${missing === 1 ? " is" : "s are"} no longer in this browser's storage, so ${missing === 1 ? "it was" : "they were"} left out.` });
    else close();
  };

  const picked = async (file: File) => {
    useDialog.setState({ mode: "busy", ok: true, message: `Opening ${file.name}…` });
    const out = await openProject(file);
    if (out.ok) {
      // A new plan: leave a walk or a half-made tool, drop any selection of the old one.
      useViewStore.getState().exitWalk();
      useToolStore.getState().setTool("select");
      useSelectionStore.getState().select(null);
      useDialog.setState({ mode: "result", ok: true, message: `Opened ${file.name}. Undo goes back to the previous plan.` });
    } else useDialog.setState({ mode: "result", ok: false, message: out.error });
  };

  return (
    <>
      <input
        ref={(el) => void (picker = el)}
        type="file"
        accept=".json,application/json"
        hidden
        data-testid="project-file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // so choosing the same file again still fires
          if (file) void picked(file);
        }}
      />
      <dialog
        ref={ref}
        aria-labelledby="project-h"
        data-testid="project-dialog"
        data-mode={mode ?? ""}
        onClose={() => mode !== "busy" && close()}
        className="m-auto max-h-[90svh] w-[min(28rem,calc(100vw-1rem))] rounded border border-stone bg-vellum p-0 text-iron shadow-xl backdrop:bg-iron/40"
      >
        <div className="flex flex-col gap-3 p-4">
          {mode === "save" && (
            <>
              <h2 id="project-h" className="font-display text-lg">
                Save project
              </h2>
              <p className="text-sm text-smoke">One file with this plan, its takeoffs and scale changes. It stays on your device.</p>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" data-testid="project-include-assets" checked={include} onChange={(e) => setInclude(e.target.checked)} className="h-4 w-4 accent-cyanotype" />
                Include imported models and the drawing (larger file)
              </label>
              <p className="text-sm" data-testid="project-size" data-bytes={size ?? ""} role="status">
                {size === null ? "Working out the size…" : `File size: about ${formatBytes(size)}`}
                {sizes && include && sizes.count === 0 && sizes.missing === 0 ? ". This plan has no imported models or drawing." : ""}
              </p>
              {sizes && include && sizes.missing > 0 && <p className="text-sm text-gilt">{sizes.missing} imported file{sizes.missing === 1 ? " isn't" : "s aren't"} in this browser's storage, so {sizes.missing === 1 ? "it" : "they"} can't be included.</p>}
              {tooBig && <p role="alert" className="text-sm text-gilt">This would be over 200 MB, more than Open accepts. Untick the box to save the plan alone.</p>}
              <div className="mt-1 flex flex-wrap justify-end gap-2">
                <button type="button" data-testid="project-cancel" onClick={close} className={BTN}>
                  Cancel
                </button>
                <button type="button" data-testid="project-save" disabled={size === null || tooBig || saving} onClick={() => void save()} className={PRIMARY}>
                  Save
                </button>
              </div>
            </>
          )}
          {mode === "confirm" && (
            <>
              <h2 id="project-h" className="font-display text-lg">
                Open a project?
              </h2>
              <p className="text-sm">The plan you have open has changes that aren't saved to a project file. Opening a file replaces it. You can undo the open afterwards.</p>
              <div className="mt-1 flex flex-wrap justify-end gap-2">
                <button type="button" data-testid="project-cancel" onClick={close} className={BTN}>
                  Cancel
                </button>
                <button type="button" data-testid="project-save-first" onClick={startSave} className={BTN}>
                  Save first…
                </button>
                <button
                  type="button"
                  data-testid="project-choose"
                  onClick={() => {
                    close();
                    choose(); // still inside the click, so the browser allows the picker
                  }}
                  className={PRIMARY}
                >
                  Choose a file…
                </button>
              </div>
            </>
          )}
          {(mode === "busy" || mode === "result") && (
            <>
              <h2 id="project-h" className="font-display text-lg">
                {mode === "busy" ? "Opening project" : ok ? "Done" : "Couldn't open this file"}
              </h2>
              <p role={ok ? "status" : "alert"} data-testid="project-message" data-ok={ok} className="text-sm">
                {message}
              </p>
              {mode === "result" && (
                <div className="mt-1 flex justify-end">
                  <button type="button" data-testid="project-close" autoFocus onClick={close} className={PRIMARY}>
                    Close
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
