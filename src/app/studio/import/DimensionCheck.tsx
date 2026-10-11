"use client";

/*
 * src/app/studio/import/DimensionCheck.tsx — the dimension check on the import
 * screen (page.tsx) for a vector PDF page (step M.1a). One row per dimension
 * text matched to a line: the printed value, the line measured at the scale in
 * use, the difference in mm (or feet and inches to 1/16") and in %, and the
 * status from src/lib/pdf/dimensions.ts (OK within max(2 mm, 0.2%), else
 * Flagged).
 *
 * A flagged row can be overridden with a typed value and a note. The override
 * is kept beside the measured value (both stay in the table and the CSV) and
 * the row says "Overridden"; it can be removed. Overrides live in the page's
 * state only and change nothing else in this step.
 *
 * The table scrolls sideways inside its own container, so the page never does
 * at 390 px. "Download CSV" saves the table in millimetres.
 */
import { Fragment, useId, useState } from "react";
import { dimensionRows, fixed, formatFeetInches, formatMm, rowsToCsv, statusText, type Overrides } from "@/lib/pdf/dimensions";
import type { DimensionMatch } from "@/types/pdf";
import { parseTypedLength } from "./importFile";
import { primaryBtn, secondaryBtn } from "./ScalePanel";

type Units = "mm" | "ftin";

interface Props {
  matches: DimensionMatch[];
  /** Metres per point at the scale in use. */
  mPerPt: number;
  /** True when the user has chosen a scale; otherwise the PDF's own is used. */
  chosen: boolean;
  overrides: Overrides;
  setOverrides: (o: Overrides) => void;
}

const small = "min-h-11 rounded-full px-3 text-sm transition-colors";

export function DimensionCheck({ matches, mPerPt, chosen, overrides, setOverrides }: Props) {
  const [units, setUnits] = useState<Units>("mm");
  const [editing, setEditing] = useState<number | null>(null);
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const valueId = useId();
  const noteId = useId();
  const rows = dimensionRows(matches, mPerPt, overrides);
  const fmt = (m: number, signed = false) => (units === "mm" ? formatMm(m, signed) : formatFeetInches(m, signed));
  const flagged = rows.filter((r) => r.status === "flagged").length;
  const overridden = rows.filter((r) => r.status === "overridden").length;

  const startEdit = (i: number) => {
    setEditing(i);
    setValue("");
    setNote("");
    setError(null);
  };
  const save = (i: number) => {
    const m = parseTypedLength(value);
    if (m === null || m <= 0) return setError("Type one length, like 4000 mm, 4 m or 13' 1\".");
    if (!note.trim()) return setError("Add a note saying why, so the change is on record.");
    setOverrides({ ...overrides, [i]: { valueM: m, note: note.trim() } });
    setEditing(null);
  };
  const remove = (i: number) => {
    const next = { ...overrides };
    delete next[i];
    setOverrides(next);
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([rowsToCsv(rows)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "dimension-check.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <section aria-labelledby="dims-heading" className="flex min-w-0 flex-col gap-3 rounded border border-stone bg-vellum p-4" data-testid="dimension-check">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="dims-heading" className="font-display text-lg">
          Dimension check
        </h2>
        <div role="group" aria-label="Units" className="flex rounded-full border border-stone">
          {(
            [
              ["mm", "mm"],
              ["ftin", "ft-in"],
            ] as const
          ).map(([u, label]) => (
            <button key={u} type="button" aria-pressed={units === u} data-testid={`units-${u}`} onClick={() => setUnits(u)} className={`${small} ${units === u ? "bg-cyanotype text-vellum" : "text-iron hover:bg-limestone"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm" data-testid="dims-summary">
        {rows.length} {rows.length === 1 ? "dimension" : "dimensions"} measured {chosen ? "at the scale in use" : "at the PDF's scale"}: {rows.length - flagged - overridden} OK, {flagged} flagged
        {overridden > 0 && `, ${overridden} overridden`}.
      </p>
      <p className="-mt-2 text-xs text-smoke">OK means within 2 mm or 0.2%, whichever is larger.</p>

      {/* relative: the sr-only header label is absolutely positioned and would otherwise escape the scroller and widen the page */}
      <div className="relative overflow-x-auto" data-testid="dims-scroll">
        <table className="w-full min-w-[34rem] text-left text-sm" data-testid="dims-table">
          <thead className="text-smoke">
            <tr className="border-b border-stone">
              <th className="py-2 pr-3 font-normal">Printed</th>
              <th className="py-2 pr-3 font-normal">Measured</th>
              <th className="py-2 pr-3 font-normal">Difference</th>
              <th className="py-2 pr-3 font-normal">%</th>
              <th className="py-2 pr-3 font-normal">Status</th>
              <th className="py-2 font-normal">
                <span className="sr-only">Override</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <Fragment key={i}>
                <tr className="border-b border-stone/60 align-top" data-testid="dim-row" data-status={r.status} data-printed={r.text}>
                  <td className="py-2 pr-3">
                    <span className="whitespace-nowrap">{r.text}</span>
                    {units === "ftin" || !/mm|cm|m$/.test(r.text) ? <span className="block text-xs text-smoke">{fmt(r.printedM)}</span> : null}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3" data-testid="dim-measured">
                    {fmt(r.measuredM)}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3" data-testid="dim-diff">
                    {fmt(r.measuredM - r.printedM, true)}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3">{fixed(r.diffPct, 2, true)}%</td>
                  <td className={`whitespace-nowrap py-2 pr-3 ${r.status === "flagged" ? "font-medium text-gilt" : r.status === "ok" ? "text-cyanotype" : "text-iron"}`} data-testid="dim-status">
                    {statusText(r.status)}
                  </td>
                  <td className="py-1 text-right">
                    {r.status === "flagged" && editing !== i && (
                      <button type="button" className={`${small} border border-iron/40 text-iron hover:bg-limestone`} onClick={() => startEdit(i)} data-testid="dim-override">
                        Override
                      </button>
                    )}
                    {r.status === "overridden" && (
                      <button type="button" className={`${small} text-smoke underline underline-offset-4 hover:text-iron`} onClick={() => remove(i)}>
                        Remove override
                      </button>
                    )}
                  </td>
                </tr>
                {r.override && (
                  <tr className="border-b border-stone/60" data-testid="dim-override-note">
                    <td colSpan={6} className="pb-2 text-sm">
                      Overridden: <strong>{fmt(r.override.valueM)}</strong> (measured {fmt(r.measuredM)} is kept). {r.override.note}
                    </td>
                  </tr>
                )}
                {editing === i && (
                  <tr className="border-b border-stone/60">
                    <td colSpan={6} className="py-2">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                        <label htmlFor={valueId} className="flex flex-col gap-1 text-sm text-smoke">
                          Correct value
                          <input id={valueId} data-testid="override-value" value={value} onChange={(e) => setValue(e.target.value)} placeholder="4000 mm" className="min-h-11 rounded border border-stone bg-limestone px-3 text-iron" />
                        </label>
                        <label htmlFor={noteId} className="flex flex-1 flex-col gap-1 text-sm text-smoke">
                          Note
                          <input id={noteId} data-testid="override-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why the printed value is wrong" className="min-h-11 rounded border border-stone bg-limestone px-3 text-iron" />
                        </label>
                        <div className="flex gap-2">
                          <button type="button" className={primaryBtn} onClick={() => save(i)} data-testid="override-save">
                            Save
                          </button>
                          <button type="button" className={secondaryBtn} onClick={() => setEditing(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                      {error && (
                        <p role="alert" className="mt-1 text-sm">
                          {error}
                        </p>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className={`${secondaryBtn} self-start`} onClick={download} data-testid="dims-csv">
        Download CSV
      </button>
    </section>
  );
}

