"use client";

/*
 * src/app/studio/import/DimensionCheck.tsx — the two dimension tables on the
 * import screen (page.tsx) for a vector PDF page.
 *
 *   - "Dimension check" (step M.1a, kind "printed"): one row per dimension text
 *     matched to a line: the printed value, the line measured at the scale in
 *     use (between its ticks, or the line's own length; "read by OCR" when the
 *     text was; step M.1b), the difference in mm (or feet and inches to 1/16")
 *     and in %, and the status (OK within max(2 mm, 0.2%), else Flagged).
 *   - "Model versus printed" (step M.1b, kind "model"): the printed value
 *     against the length the BUILT model gives between the places the
 *     dimension's ends land (centre to centre, inside faces, outside faces,
 *     opening width…, said in the row), with the same status rule; a row on a
 *     traced wall says "approximate".
 *
 * Rows come from src/lib/pdf/dimensions.ts (dimensionRows, modelRows); this
 * component only shows them. A flagged row can be overridden with a typed value
 * and a note. The override is kept beside the measured value (both stay in the
 * table and the CSV) and the row says "Overridden"; it can be removed.
 * Overrides live in the page's state only and change nothing else.
 *
 * The table scrolls sideways inside its own container, so the page never does
 * at 390 px. "Download CSV" saves both tables in millimetres (`csv`). Test ids:
 * the first table keeps M.1a's (dimension-check, dim-row, dims-csv, …); the
 * second uses "model-" ones (model-check, model-row, model-csv, …).
 */
import { Fragment, useId, useState } from "react";
import { fixed, formatFeetInches, formatMm, statusText, type Overrides } from "@/lib/pdf/dimensions";
import type { DimensionRow } from "@/types/pdf";
import { parseTypedLength } from "./importFile";
import { primaryBtn, secondaryBtn } from "./ScalePanel";

type Units = "mm" | "ftin";
type Row = DimensionRow & { index?: number };

interface Props {
  kind: "printed" | "model";
  rows: Row[];
  /** "at the scale in use", "at the PDF's scale", or for the model check what it was built at. */
  measuredAt: string;
  overrides: Overrides;
  setOverrides: (o: Overrides) => void;
  /** Both checks as CSV text. */
  csv: () => string;
}

const small = "min-h-11 rounded-full px-3 text-sm transition-colors";

export function DimensionCheck({ kind, rows, measuredAt, overrides, setOverrides, csv }: Props) {
  const model = kind === "model";
  // Test ids: M.1a's for the first table, "model-" ones for the second.
  const tid = {
    section: model ? "model-check" : "dimension-check",
    row: model ? "model-row" : "dim-row",
    cell: (s: string) => (model ? `model-${s}` : `dim-${s}`),
    table: (s: string) => (model ? `model-${s}` : `dims-${s}`),
    input: (s: string) => (model ? `model-${s}` : s),
  };
  const [units, setUnits] = useState<Units>("mm");
  const [editing, setEditing] = useState<number | null>(null);
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const valueId = useId();
  const noteId = useId();
  const headingId = useId();
  const fmt = (m: number, signed = false) => (units === "mm" ? formatMm(m, signed) : formatFeetInches(m, signed));
  const flagged = rows.filter((r) => r.status === "flagged").length;
  const overridden = rows.filter((r) => r.status === "overridden").length;
  const approximate = rows.filter((r) => r.approximate).length;
  const keyOf = (r: Row, i: number) => r.index ?? i; // overrides are kept by dimension, so both tables can share the page's numbering

  const startEdit = (i: number) => {
    setEditing(i);
    setValue("");
    setNote("");
    setError(null);
  };
  const save = (k: number) => {
    const m = parseTypedLength(value);
    if (m === null || m <= 0) return setError("Type one length, like 4000 mm, 4 m or 13' 1\".");
    if (!note.trim()) return setError("Add a note saying why, so the change is on record.");
    setOverrides({ ...overrides, [k]: { valueM: m, note: note.trim() } });
    setEditing(null);
  };
  const remove = (k: number) => {
    const next = { ...overrides };
    delete next[k];
    setOverrides(next);
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([csv()], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "dimension-check.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const cols = model ? 7 : 6;

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3 rounded border border-stone bg-vellum p-4" data-testid={tid.section}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="font-display text-lg">
          {model ? "Model versus printed" : "Dimension check"}
        </h2>
        <div role="group" aria-label="Units" className="flex rounded-full border border-stone">
          {(
            [
              ["mm", "mm"],
              ["ftin", "ft-in"],
            ] as const
          ).map(([u, label]) => (
            <button key={u} type="button" aria-pressed={units === u} data-testid={tid.input(`units-${u}`)} onClick={() => setUnits(u)} className={`${small} ${units === u ? "bg-cyanotype text-vellum" : "text-iron hover:bg-limestone"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm" data-testid={tid.table("summary")}>
        {rows.length} {rows.length === 1 ? "dimension" : "dimensions"} {model ? `checked against the model ${measuredAt}` : `measured ${measuredAt}`}: {rows.length - flagged - overridden} OK, {flagged} flagged
        {overridden > 0 && `, ${overridden} overridden`}
        {approximate > 0 && `; ${approximate} on traced walls, so approximate`}.
      </p>
      <p className="-mt-2 text-xs text-smoke">
        OK means within 2 mm or 0.2%, whichever is larger.
        {model && " The model length runs between the places the dimension's ends land: wall centre lines, faces or door and window jambs."}
      </p>

      {/* relative: the sr-only header label is absolutely positioned and would otherwise escape the scroller and widen the page */}
      <div className="relative overflow-x-auto" data-testid={tid.table("scroll")}>
        <table className={`w-full text-left text-sm ${model ? "min-w-160" : "min-w-136"}`} data-testid={tid.table("table")}>
          <thead className="text-smoke">
            <tr className="border-b border-stone">
              <th className="py-2 pr-3 font-normal">Printed</th>
              <th className="py-2 pr-3 font-normal">{model ? "Model" : "Measured"}</th>
              {model && <th className="py-2 pr-3 font-normal">Between</th>}
              <th className="py-2 pr-3 font-normal">Difference</th>
              <th className="py-2 pr-3 font-normal">%</th>
              <th className="py-2 pr-3 font-normal">Status</th>
              <th className="py-2 font-normal">
                <span className="sr-only">Override</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const k = keyOf(r, i);
              return (
                <Fragment key={k}>
                  <tr className="border-b border-stone/60 align-top" data-testid={tid.row} data-status={r.status} data-printed={r.text} data-approximate={r.approximate ? "true" : undefined}>
                    <td className="py-2 pr-3">
                      <span className="whitespace-nowrap">{r.text}</span>
                      {units === "ftin" || !/mm|cm|m$/.test(r.text) ? <span className="block text-xs text-smoke">{fmt(r.printedM)}</span> : null}
                      {!model && (
                        <span className="block whitespace-nowrap text-xs text-smoke" data-testid="dim-how">
                          {r.how}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3" data-testid={tid.cell("measured")}>
                      {fmt(r.measuredM)}
                    </td>
                    {model && (
                      <td className="whitespace-nowrap py-2 pr-3" data-testid="model-spans">
                        {r.spans}
                      </td>
                    )}
                    <td className="whitespace-nowrap py-2 pr-3" data-testid={tid.cell("diff")}>
                      {fmt(r.measuredM - r.printedM, true)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3">{fixed(r.diffPct, 2, true)}%</td>
                    <td className={`whitespace-nowrap py-2 pr-3 ${r.status === "flagged" ? "font-medium text-gilt" : r.status === "ok" ? "text-cyanotype" : "text-iron"}`} data-testid={tid.cell("status")}>
                      {statusText(r.status)}
                      {r.approximate && <span className="block text-xs text-smoke">approximate</span>}
                    </td>
                    <td className="py-1 text-right">
                      {r.status === "flagged" && editing !== k && (
                        <button type="button" className={`${small} border border-iron/40 text-iron hover:bg-limestone`} onClick={() => startEdit(k)} data-testid={tid.cell("override")}>
                          Override
                        </button>
                      )}
                      {r.status === "overridden" && (
                        <button type="button" className={`${small} text-smoke underline underline-offset-4 hover:text-iron`} onClick={() => remove(k)}>
                          Remove override
                        </button>
                      )}
                    </td>
                  </tr>
                  {r.override && (
                    <tr className="border-b border-stone/60" data-testid={tid.cell("override-note")}>
                      <td colSpan={cols} className="pb-2 text-sm">
                        Overridden: <strong>{fmt(r.override.valueM)}</strong> ({model ? "model" : "measured"} {fmt(r.measuredM)} is kept). {r.override.note}
                      </td>
                    </tr>
                  )}
                  {editing === k && (
                    <tr className="border-b border-stone/60">
                      <td colSpan={cols} className="py-2">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                          <label htmlFor={valueId} className="flex flex-col gap-1 text-sm text-smoke">
                            Correct value
                            <input id={valueId} data-testid={tid.input("override-value")} value={value} onChange={(e) => setValue(e.target.value)} placeholder="4000 mm" className="min-h-11 rounded border border-stone bg-limestone px-3 text-iron" />
                          </label>
                          <label htmlFor={noteId} className="flex flex-1 flex-col gap-1 text-sm text-smoke">
                            Note
                            <input id={noteId} data-testid={tid.input("override-note")} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why the printed value is wrong" className="min-h-11 rounded border border-stone bg-limestone px-3 text-iron" />
                          </label>
                          <div className="flex gap-2">
                            <button type="button" className={primaryBtn} onClick={() => save(k)} data-testid={tid.input("override-save")}>
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
              );
            })}
          </tbody>
        </table>
      </div>
      <button type="button" className={`${secondaryBtn} self-start`} onClick={download} data-testid={tid.table("csv")}>
        Download CSV
      </button>
    </section>
  );
}
