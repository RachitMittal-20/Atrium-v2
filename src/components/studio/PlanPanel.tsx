"use client";

/*
 * src/components/studio/PlanPanel.tsx — the editor's right panel. With nothing
 * selected: counts, total net floor area, an m² / sq ft toggle (display only;
 * the plan stays in metres) and the Rooms list, where each name is editable in
 * place through planStore.renameRoom. While a wall is selected the Summary is
 * replaced by WallPanel.tsx, while a door or window is selected by
 * OpeningPanel.tsx, and while an imported 3D model is selected by ItemPanel.tsx. Anything an edit broke is listed underneath as a
 * warning, never silently. A right column at 768 px and wider; below that a
 * collapsible sheet under the canvas. The unit lives in the studio page, so the
 * 2D plan's area labels follow the same toggle.
 * Mounted by src/app/studio/page.tsx.
 */
import { useState } from "react";
import { useDerivedRooms, usePlanStore } from "@/store/planStore";
import { useSelectionStore } from "@/store/selectionStore";
import { EditableText } from "./EditableText";
import { ItemPanel } from "./ItemPanel";
import { OpeningPanel } from "./OpeningPanel";
import { WallPanel } from "./WallPanel";

const SQFT_PER_M2 = 10.7639;
const FEET_PER_M = 3.28084;
export type Unit = "m2" | "sqft";

/** An area in m² as text in the chosen unit; shared with the 2D plan's labels. */
export const formatArea = (m2: number, unit: Unit) => (unit === "m2" ? `${m2.toFixed(1)} m²` : `${(m2 * SQFT_PER_M2).toFixed(1)} sq ft`);

/** A length in metres as text; feet when the panel is showing imperial areas. */
export const formatLength = (m: number, unit: Unit) => (unit === "m2" ? `${m.toFixed(2)} m` : `${(m * FEET_PER_M).toFixed(2)} ft`);

export function PlanPanel({ unit, setUnit }: { unit: Unit; setUnit: (u: Unit) => void }) {
  const plan = usePlanStore((s) => s.plan);
  const renameRoom = usePlanStore((s) => s.renameRoom);
  const rooms = useDerivedRooms();
  const selectedId = useSelectionStore((s) => s.selectedId);
  const openingId = useSelectionStore((s) => s.openingId);
  const itemId = useSelectionStore((s) => s.itemId);
  const warnings = useSelectionStore((s) => s.warnings);
  const [open, setOpen] = useState(false); // the phone sheet; ignored at md and wider

  const area = (m2: number) => formatArea(m2, unit);
  const total = rooms.reduce((sum, r) => sum + r.area, 0);
  const doors = plan.openings.filter((o) => o.kind === "door").length;
  const windows = plan.openings.filter((o) => o.kind === "window").length;

  return (
    <aside aria-label="Plan details" className="flex shrink-0 flex-col border-t border-stone bg-vellum max-md:max-h-[55svh] md:w-80 md:border-l md:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="plan-details"
        onClick={() => setOpen(!open)}
        className="flex min-h-12 items-center justify-between px-4 text-sm md:hidden"
      >
        <span>Plan details</span>
        <span className="text-smoke">
          {rooms.length} {rooms.length === 1 ? "room" : "rooms"} · {area(total)} {open ? "▾" : "▴"}
        </span>
      </button>

      <div id="plan-details" data-lenis-prevent className={`min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4 max-md:border-t max-md:border-stone md:flex ${open ? "flex" : "hidden"}`}>
        {/* A selected wall takes the Summary's place; "Back to summary" clears the selection. */}
        {selectedId ? (
          <WallPanel unit={unit} />
        ) : openingId ? (
          <OpeningPanel key={openingId} unit={unit} /> // keyed: a note about one opening never shows on the next
        ) : itemId ? (
          <ItemPanel key={itemId} unit={unit} />
        ) : (
          <section aria-labelledby="summary-h">
            <h2 id="summary-h" className="mb-2 text-sm font-medium">
              Summary
            </h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm" data-testid="summary">
              <dt className="text-smoke">Walls</dt>
              <dd className="text-right">{plan.walls.length}</dd>
              <dt className="text-smoke">Doors</dt>
              <dd className="text-right">{doors}</dd>
              <dt className="text-smoke">Windows</dt>
              <dd className="text-right">{windows}</dd>
              <dt className="text-smoke">Net floor area</dt>
              <dd className="text-right" data-testid="total-area">
                {area(total)}
              </dd>
            </dl>
          </section>
        )}

        {/* What the last edit broke, in the validator's own words. */}
        {warnings.length > 0 && (
          <section aria-labelledby="warnings-h" data-testid="plan-warnings">
            <h2 id="warnings-h" className="mb-1 text-sm font-medium text-gilt">
              Worth a look
            </h2>
            <ul className="flex flex-col gap-1 text-xs text-smoke">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </section>
        )}

        <div role="group" aria-label="Area units" className="flex w-fit rounded border border-stone p-0.5 text-sm">
          {(["m2", "sqft"] as const).map((u) => (
            <button
              key={u}
              type="button"
              data-testid={`units-${u}`}
              aria-pressed={unit === u}
              onClick={() => setUnit(u)}
              className={`min-h-9 rounded-sm px-3 ${unit === u ? "bg-cyanotype text-vellum" : "text-smoke hover:bg-limestone"}`}
            >
              {u === "m2" ? "m²" : "sq ft"}
            </button>
          ))}
        </div>

        <section aria-labelledby="rooms-h">
          <h2 id="rooms-h" className="mb-2 text-sm font-medium">
            Rooms
          </h2>
          {rooms.length === 0 ? (
            <p className="text-sm text-smoke" data-testid="no-rooms">
              No closed rooms yet. Rooms appear when walls form a closed loop.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {rooms.map((r, i) => (
                // A label, so clicking anywhere on the row (the area too) focuses the name input.
                <li key={r.id}>
                  <label className="flex min-h-10 cursor-text items-center justify-between gap-2 rounded text-sm hover:bg-limestone">
                    <EditableText value={r.name} onCommit={(n) => renameRoom(r.id, n)} label={`Room name, ${r.name}`} testId={`room-name-${i}`} className="flex-1 py-1.5" />
                    <span className="shrink-0 pr-1 text-smoke" data-testid={`room-area-${i}`}>
                      {area(r.area)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
}
