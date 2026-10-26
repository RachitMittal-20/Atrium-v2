"use client";

/*
 * src/components/studio/TakeoffPanel.tsx — the Takeoff section of the right panel (step M.2a),
 * collapsible. The length and area unit switches (src/store/unitsStore.ts; the area one is the
 * Summary's toggle too), "Show takeoffs", "Set scale…" (step M.2b), and a table with one row per
 * takeoff: its name (editable), kind, basis, measured value, a typed reference (the wall panel's
 * parser; a bare number is in the current unit), the difference, the status (OK, Flagged, No
 * reference), an override with its note (the measured value is always kept and shown beside it),
 * the stale marker with "Mark as current", and Delete. Each change is one planStore call, so one
 * undo step. Clicking a row selects it, and the 2D plan draws it in gilt. Totals sum the
 * unrounded values (measured, and effective with overrides) and round once. "Download CSV" and
 * "Copy table" give the same cells. The table scrolls sideways inside its own box, so a phone
 * page never does.
 *
 * Step M.2b, "From PDF": the dimensions carried in at Build model (Takeoff.source === "pdf") are
 * a group of their own, collapsible, with how many there are and how many are Flagged, and the
 * same units, references, overrides, stale marker and CSV as the rest. A line under it says that
 * a Set scale changes their measured values, so a row that flags afterwards is the drawing
 * disagreeing with the new scale — which is the signal, not a bug. "Set scale…" starts the
 * two-point flow in the 2D plan (src/store/calibrateStore.ts, CalibrateDialog.tsx). Once a Set scale
 * has been applied (step M.2c), the From PDF heading and every "PDF exact" basis add
 * "Rescaled x1.0234" (the product of every factor), so a Flagged row reads as a rescaled plan.
 *
 * Connects to: src/lib/takeoff/rows.ts, src/lib/units/format.ts,
 * src/store/{planStore,takeoffStore,unitsStore,calibrateStore}.ts; mounted by PlanPanel.tsx.
 */
import { useMemo, useRef, useState } from "react";
import { csvFileName, STATUS_TEXT, tableCells, takeoffRow, toCsv, toTsv, totals, wallsHash, type TakeoffRow, type Units } from "@/lib/takeoff/rows";
import { MAX_PDF_TAKEOFFS } from "@/lib/pdf/takeoffs";
import { AREA_LABEL, AREA_UNITS, formatArea, formatLength, LENGTH_LABEL, LENGTH_UNITS, parseAreaInput, parseLengthInput } from "@/lib/units/format";
import { rescaledText } from "@/lib/plan/calibrate";
import { useCalibrateStore } from "@/store/calibrateStore";
import { usePlanStore } from "@/store/planStore";
import { useTakeoffStore } from "@/store/takeoffStore";
import { useUnitsStore } from "@/store/unitsStore";
import type { Takeoff } from "@/types/plan";
import { EditableText } from "./EditableText";

const BADGE: Record<TakeoffRow["status"], string> = {
  ok: "border-cyanotype text-cyanotype",
  flagged: "border-gilt bg-gilt/15 text-iron",
  none: "border-stone text-smoke",
};

/** A text field that commits on Enter or blur and says why when it can't read the value; empty clears it. */
function ValueField({ value, parse, onCommit, label, testId, placeholder, width = "w-24" }: { value: string; parse: (raw: string) => number | null; onCommit: (v: number | null) => void; label: string; testId: string; placeholder?: string; width?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);
  const commit = () => {
    const raw = draft?.trim();
    setDraft(null);
    if (cancelled.current || raw === undefined || raw === value) return;
    if (raw === "") {
      setError(null);
      onCommit(null);
      return;
    }
    const v = parse(raw);
    if (v === null) setError(`"${raw}" isn't a value`);
    else {
      setError(null);
      onCommit(v);
    }
  };
  return (
    <span className="flex flex-col">
      <input
        data-testid={testId}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        value={draft ?? value}
        placeholder={placeholder}
        spellCheck={false}
        onFocus={(e) => {
          cancelled.current = false;
          setDraft(value);
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
        className={`${width} min-h-8 rounded border border-stone bg-limestone/60 px-1.5 text-xs`}
      />
      {error && (
        <span role="alert" className="text-[11px] text-gilt-ink">
          {error}
        </span>
      )}
    </span>
  );
}

function Switch<T extends string>({ label, values, names, value, set, testPrefix }: { label: string; values: readonly T[]; names: Record<T, string>; value: T; set: (v: T) => void; testPrefix: string }) {
  return (
    <div role="group" aria-label={label} className="flex w-fit rounded border border-stone p-0.5 text-xs">
      {values.map((u) => (
        <button key={u} type="button" data-testid={`${testPrefix}-${u}`} aria-pressed={value === u} onClick={() => set(u)} className={`min-h-9 rounded-sm px-2.5 ${value === u ? "bg-cyanotype text-vellum" : "text-smoke hover:bg-limestone"}`}>
          {names[u]}
        </button>
      ))}
    </div>
  );
}

/** One table of rows; `group` marks the From PDF one. Module level, so a plan change never
 *  remounts it and a half-typed value in one of its fields is never lost. */
function RowsTable({ list, group, units, selectedId, select, rescaled }: { list: TakeoffRow[]; group?: "pdf"; units: Units; selectedId: string | null; select: (id: string) => void; rescaled: string | null }) {
  const store = usePlanStore.getState();
    const fmt = (t: Takeoff, v: number | null | undefined) => (v === null || v === undefined ? "–" : t.kind === "length" ? formatLength(v, units.length) : formatArea(v, units.area));
    const signed = (t: Takeoff, v: number | null) => (v === null ? "–" : `${v > 0 ? "+" : ""}${fmt(t, v)}`);
    const parse = (t: Takeoff) => (raw: string) => (t.kind === "length" ? parseLengthInput(raw, units.length) : parseAreaInput(raw, units.area));
    const unitOf = (t: Takeoff) => (t.kind === "length" ? LENGTH_LABEL[units.length] : AREA_LABEL[units.area]);
    return (
      // relative: an absolutely placed child can never widen the page beyond this scroll box
      <div className="relative max-w-full overflow-x-auto rounded border border-stone" data-testid="takeoff-table-wrap" data-group={group ?? "studio"}>
        <table className="min-w-max border-collapse text-left text-xs" data-testid="takeoff-table" data-group={group ?? "studio"}>
          <thead className="bg-limestone/60 text-smoke">
            <tr>
              {["Name", "Kind", "Basis", "Measured", "Reference", "Difference", "Status", "Override", "Walls", ""].map((h, i) => (
                <th key={i} scope="col" className="px-2 py-1.5 font-normal">
                  {h || <span className="sr-only">Delete</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const t = r.takeoff;
              const on = t.id === selectedId;
              return (
                <tr
                  key={t.id}
                  data-testid="takeoff-row"
                  data-takeoff={t.id}
                  data-source={t.source ?? "studio"}
                  data-status={r.status}
                  data-selected={on}
                  aria-selected={on}
                  onClick={() => select(t.id)}
                  onFocusCapture={() => select(t.id)}
                  className={`border-t border-stone align-top ${on ? "bg-gilt/10" : "hover:bg-limestone/60"}`}
                >
                  <td className="px-2 py-1.5">
                    <EditableText value={t.name} onCommit={(n) => store.updateTakeoff(t.id, { name: n })} label={`Takeoff name, ${t.name}`} testId="takeoff-name" className="w-36 py-1" />
                  </td>
                  <td className="px-2 py-1.5">{t.kind === "length" ? "Length" : "Area"}</td>
                  <td className="px-2 py-1.5" data-testid="takeoff-basis">
                    {r.basis}
                    {r.basis === "PDF exact" && rescaled && ` · ${rescaled}`}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap" data-testid="takeoff-measured">
                    {fmt(t, r.measured)}
                    {r.basis === "Traced approximate" && <span className="block text-smoke">approximate</span>}
                  </td>
                  <td className="px-2 py-1.5">
                    <ValueField
                      key={`${t.reference?.value}-${unitOf(t)}`}
                      value={t.reference ? fmt(t, t.reference.value) : ""}
                      parse={parse(t)}
                      onCommit={(v) => store.updateTakeoff(t.id, { reference: v === null ? null : { value: v, note: t.reference?.note } })}
                      label={`Reference for ${t.name}, in ${unitOf(t)}`}
                      placeholder={unitOf(t)}
                      testId="takeoff-ref"
                    />
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap" data-testid="takeoff-diff">
                    {signed(t, r.difference)}
                  </td>
                  <td className="px-2 py-1.5">
                    <span data-testid="takeoff-status" data-status={r.status} className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 ${BADGE[r.status]}`}>
                      {STATUS_TEXT[r.status]}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-col gap-1">
                      <ValueField
                        key={`${t.override?.value}-${unitOf(t)}`}
                        value={t.override ? fmt(t, t.override.value) : ""}
                        parse={parse(t)}
                        onCommit={(v) => store.updateTakeoff(t.id, { override: v === null ? null : { value: v, note: t.override?.note } })}
                        label={`Override for ${t.name}, in ${unitOf(t)}`}
                        placeholder="value"
                        testId="takeoff-override"
                      />
                      {t.override && (
                        <>
                          <EditableText value={t.override.note ?? ""} onCommit={(n) => store.updateTakeoff(t.id, { override: { value: t.override!.value, note: n } })} label={`Override note for ${t.name}`} testId="takeoff-override-note" className="w-36 border border-stone py-1" />
                          <span className="whitespace-nowrap text-smoke" data-testid="takeoff-overridden">
                            Overridden: {fmt(t, t.override.value)}, measured {fmt(t, r.measured)}
                          </span>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    {r.stale ? (
                      <div className="flex w-40 flex-col gap-1" data-testid="takeoff-stale">
                        <span className="text-gilt-ink">Walls have moved since this was measured</span>
                        <button type="button" data-testid="takeoff-mark-current" onClick={() => store.markTakeoffCurrent(t.id)} className="min-h-8 w-fit rounded border border-stone px-2 hover:bg-limestone">
                          Mark as current
                        </button>
                      </div>
                    ) : (
                      <span className="text-smoke">Current</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <button type="button" data-testid="takeoff-delete" aria-label={`Delete ${t.name}`} onClick={(e) => (e.stopPropagation(), store.deleteTakeoff(t.id))} className="min-h-8 rounded border border-stone px-2 hover:bg-limestone">
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
  );
}

export function TakeoffPanel() {
  const plan = usePlanStore((s) => s.plan);
  const rescaled = rescaledText(plan.calibrations); // step M.2c
  const units = useUnitsStore();
  const { selectedId, show, select, setShow } = useTakeoffStore();
  const [open, setOpen] = useState(true);
  const [openPdf, setOpenPdf] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  const rows = useMemo(() => {
    const hash = wallsHash(plan.walls);
    return (plan.takeoffs ?? []).map((t) => takeoffRow(plan, t, hash));
  }, [plan]);
  const pdfRows = rows.filter((r) => r.takeoff.source === "pdf");
  const mine = rows.filter((r) => r.takeoff.source !== "pdf");
  const flagged = pdfRows.filter((r) => r.status === "flagged").length;
  const sum = totals(rows);

  const download = () => {
    const blob = new Blob([toCsv(tableCells(rows, units))], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = csvFileName(plan.name);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toTsv(tableCells(rows, units)));
      setCopied("Copied. Paste it into a spreadsheet.");
    } catch {
      setCopied("Copying isn't allowed here. Use Download CSV.");
    }
  };

  return (
    <section aria-labelledby="takeoff-h" data-testid="takeoff-panel" className="flex min-w-0 flex-col gap-2">
      <h2 id="takeoff-h" className="text-sm font-medium">
        <button type="button" aria-expanded={open} aria-controls="takeoff-body" data-testid="takeoff-toggle" onClick={() => setOpen(!open)} className="flex min-h-9 w-full items-center justify-between rounded text-left hover:bg-limestone">
          <span>Takeoffs ({rows.length})</span>
          <span className="text-smoke" aria-hidden>
            {open ? "▾" : "▸"}
          </span>
        </button>
      </h2>
      {open && (
        <div id="takeoff-body" className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Switch label="Length unit" values={LENGTH_UNITS} names={LENGTH_LABEL} value={units.length} set={units.setLength} testPrefix="takeoff-unit" />
            <Switch label="Area unit" values={AREA_UNITS} names={AREA_LABEL} value={units.area} set={units.setArea} testPrefix="takeoff-unit" />
          </div>
          <label className="flex min-h-9 items-center gap-2 text-xs">
            <input type="checkbox" data-testid="takeoff-show" checked={show} onChange={(e) => setShow(e.target.checked)} className="size-4 accent-cyanotype" />
            Show takeoffs
          </label>
          {/* Step M.2b: set the plan's scale from two points you know the distance between. */}
          <button type="button" data-testid="takeoff-set-scale" onClick={() => useCalibrateStore.getState().start()} className="min-h-9 w-fit rounded border border-stone px-3 text-xs hover:bg-limestone">
            Set scale…
          </button>

          {/* From PDF: the dimensions carried in at Build model */}
          {pdfRows.length > 0 && (
            <section aria-labelledby="takeoff-pdf-h" className="flex min-w-0 flex-col gap-2" data-testid="takeoff-pdf">
              <h3 id="takeoff-pdf-h" className="text-xs font-medium">
                <button
                  type="button"
                  aria-expanded={openPdf}
                  aria-controls="takeoff-pdf-body"
                  data-testid="takeoff-pdf-toggle"
                  data-count={pdfRows.length}
                  data-flagged={flagged}
                  onClick={() => setOpenPdf(!openPdf)}
                  className="flex min-h-9 w-full items-center justify-between rounded text-left hover:bg-limestone"
                >
                  <span>
                    From PDF ({pdfRows.length}) · {flagged} flagged{rescaled && ` · ${rescaled}`}
                  </span>
                  <span className="text-smoke" aria-hidden>
                    {openPdf ? "▾" : "▸"}
                  </span>
                </button>
              </h3>
              {openPdf && (
                <div id="takeoff-pdf-body" className="flex min-w-0 flex-col gap-2">
                  <RowsTable list={pdfRows} group="pdf" units={units} selectedId={selectedId} select={select} rescaled={rescaled} />
                  <p className="text-[11px] text-smoke" data-testid="takeoff-pdf-note">
                    These are the drawing&apos;s printed dimensions, measured on the model. Set scale changes what they measure, so a row that flags afterwards is the printed numbers disagreeing with the new scale.
                    {pdfRows.length >= MAX_PDF_TAKEOFFS && ` Only the first ${MAX_PDF_TAKEOFFS} dimensions were carried in.`}
                  </p>
                </div>
              )}
            </section>
          )}

          {mine.length === 0 ? (
            <p className="text-xs text-smoke" data-testid="takeoff-empty">
              No takeoffs of your own yet. Choose Takeoff in the tools (K) and click points, corners or a wall in the 2D plan.
            </p>
          ) : (
            <RowsTable list={mine} units={units} selectedId={selectedId} select={select} rescaled={rescaled} />
          )}

          {rows.length > 0 && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs" data-testid="takeoff-totals">
              <dt className="text-smoke">Lengths</dt>
              <dd data-testid="takeoff-total-length">
                {formatLength(sum.lengthMeasured, units.length)} measured · {formatLength(sum.lengthEffective, units.length)} effective
              </dd>
              <dt className="text-smoke">Areas</dt>
              <dd data-testid="takeoff-total-area">
                {formatArea(sum.areaMeasured, units.area)} measured · {formatArea(sum.areaEffective, units.area)} effective
              </dd>
            </dl>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="button" data-testid="takeoff-csv" disabled={rows.length === 0} onClick={download} className="min-h-9 rounded border border-stone px-3 text-xs hover:bg-limestone disabled:opacity-50">
              Download CSV
            </button>
            <button type="button" data-testid="takeoff-copy" disabled={rows.length === 0} onClick={copy} className="min-h-9 rounded border border-stone px-3 text-xs hover:bg-limestone disabled:opacity-50">
              Copy table
            </button>
          </div>
          {copied && (
            <p role="status" className="text-xs text-smoke">
              {copied}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
