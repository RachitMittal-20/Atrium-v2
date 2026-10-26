"use client";

/*
 * src/components/studio/SchedulePanel.tsx — the Schedule section of the right panel (step X.2, roadmap
 * 7.1), collapsible and closed at first: the rooms (name, net area, perimeter) and the openings (type,
 * width, height, sill, count; the length unit once, in the table's caption) from src/lib/export/schedule.ts, with totals summed from exact values and
 * rounded once. The rooms are useDerivedRooms(), the very list the Summary and the Rooms list show, so the
 * numbers cannot disagree. Values follow the one units setting (useUnitFormat). "Download CSV" is the
 * Export menu's "Area schedule (CSV)". The tables scroll sideways inside their own box, so a phone page
 * never does. Mounted by PlanPanel.tsx under the Takeoff section.
 */
import { useMemo, useState } from "react";
import { buildSchedule, KIND_TEXT } from "@/lib/export/schedule";
import { LENGTH_LABEL } from "@/lib/units/format";
import { useDerivedRooms, usePlanStore } from "@/store/planStore";
import { downloadSchedule } from "./ExportDialog";
import { useUnitFormat } from "./useUnitFormat";

const TH = "py-1 pr-2 font-medium text-smoke";
const TD = "py-1 pr-2";

export function SchedulePanel() {
  const plan = usePlanStore((s) => s.plan);
  const rooms = useDerivedRooms();
  const s = useMemo(() => buildSchedule(plan, rooms), [plan, rooms]);
  const { len, lenValue, area, length } = useUnitFormat();
  const [open, setOpen] = useState(false);

  return (
    <section aria-labelledby="schedule-h" data-testid="schedule-panel" className="flex min-w-0 flex-col gap-2">
      <h2 id="schedule-h" className="text-sm font-medium">
        <button type="button" aria-expanded={open} aria-controls="schedule-body" data-testid="schedule-toggle" onClick={() => setOpen(!open)} className="flex min-h-9 w-full items-center justify-between rounded text-left hover:bg-limestone">
          <span>Schedule</span>
          <span className="text-smoke" aria-hidden>
            {open ? "▾" : "▸"}
          </span>
        </button>
      </h2>
      {open && (
        <div id="schedule-body" className="flex min-w-0 flex-col gap-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-max border-collapse text-left text-xs" data-testid="schedule-rooms">
              <caption className="pb-1 text-left text-xs font-medium">Rooms</caption>
              <thead>
                <tr className="border-b border-stone">
                  <th className={TH}>Room</th>
                  <th className={`${TH} text-right`}>Net area</th>
                  <th className={`${TH} text-right`}>Perimeter</th>
                </tr>
              </thead>
              <tbody>
                {s.rooms.map((r) => (
                  <tr key={r.id} data-room-id={r.id}>
                    <td className={TD}>{r.name}</td>
                    <td className={`${TD} text-right`}>{area(r.area)}</td>
                    <td className={`${TD} text-right`}>{len(r.perimeter)}</td>
                  </tr>
                ))}
                <tr className="border-t border-stone font-medium">
                  <td className={TD}>Total</td>
                  <td className={`${TD} text-right`} data-testid="schedule-total-area" data-value={s.totals.area}>
                    {area(s.totals.area)}
                  </td>
                  <td className={`${TD} text-right`}>{len(s.totals.perimeter)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max border-collapse text-left text-xs" data-testid="schedule-openings">
              {/* The unit once, in the caption, so the five columns fit the panel. */}
              <caption className="pb-1 text-left text-xs font-medium" data-testid="schedule-openings-unit">
                Openings, sizes in {LENGTH_LABEL[length]}
              </caption>
              <thead>
                <tr className="border-b border-stone">
                  <th className={TH}>Type</th>
                  <th className={`${TH} text-right`}>Width</th>
                  <th className={`${TH} text-right`}>Height</th>
                  <th className={`${TH} text-right`}>Sill</th>
                  <th className={`${TH} pr-0 text-right`}>Count</th>
                </tr>
              </thead>
              <tbody>
                {s.openings.map((o, i) => (
                  <tr key={i}>
                    <td className={TD}>{KIND_TEXT[o.kind]}</td>
                    <td className={`${TD} text-right`}>{lenValue(o.width)}</td>
                    <td className={`${TD} text-right`}>{lenValue(o.height)}</td>
                    <td className={`${TD} text-right`}>{lenValue(o.sill)}</td>
                    <td className={`${TD} pr-0 text-right`}>{o.count}</td>
                  </tr>
                ))}
                <tr className="border-t border-stone font-medium">
                  <td className={TD} colSpan={4}>
                    Total: {s.totals.doors} doors, {s.totals.windows} windows
                  </td>
                  <td className={`${TD} pr-0 text-right`} data-testid="schedule-total-openings">
                    {s.totals.doors + s.totals.windows}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-smoke">Rows are rounded; totals are summed from exact values.</p>
          <button type="button" data-testid="schedule-csv" onClick={downloadSchedule} className="min-h-9 w-fit rounded border border-stone px-3 text-xs hover:bg-limestone">
            Download CSV
          </button>
        </div>
      )}
    </section>
  );
}
