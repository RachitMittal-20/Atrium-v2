"use client";

/*
 * src/components/studio/PlanPanel.tsx — the editor's right panel. With nothing
 * selected: counts, total net floor area, an m² / sq ft toggle (display only;
 * the plan stays in metres) and the Rooms list, where each name is editable in
 * place through planStore.renameRoom. While a wall is selected the Summary is
 * replaced by WallPanel.tsx, while a door or window is selected by
 * OpeningPanel.tsx, and while an imported 3D model is selected by ItemPanel.tsx. Anything an edit broke is listed underneath as a
 * warning, never silently. A right column at 768 px and wider; below that a
 * collapsible sheet under the canvas. Every length and area here follows the one units
 * setting (src/store/unitsStore.ts, step U.1) through useUnitFormat; the area switch below
 * the summary is a view of that setting (m², mm², sq ft). Room rows are rounded for display
 * and the total is summed from the exact areas, which the note under the list says. The
 * Takeoff section (TakeoffPanel.tsx, step M.2a) sits under Rooms, and the Schedule (SchedulePanel.tsx, step
 * X.2: rooms and openings, the same derived rooms as the list above) at the bottom. When the plan
 * has an imported drawing (step M.2c) and the 2D plan is showing, a "Drawing" section holds the
 * same toggle and opacity slider as the 2D pane, says when the file is not in this browser
 * ("Import it again to see the background"), and removes the drawing from the plan (one undo
 * step; the file stays in the asset store). Mounted by src/app/studio/page.tsx.
 */
import { useEffect, useState } from "react";
import { DrawingControls } from "@/components/plan2d/DrawingControls";
import { AREA_LABEL, AREA_UNITS } from "@/lib/units/format";
import { useDerivedRooms, usePlanStore } from "@/store/planStore";
import { useBackgroundStore } from "@/store/backgroundStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useUnitsStore } from "@/store/unitsStore";
import { EditableText } from "./EditableText";
import { ItemPanel } from "./ItemPanel";
import { OpeningPanel } from "./OpeningPanel";
import { SchedulePanel } from "./SchedulePanel";
import { TakeoffPanel } from "./TakeoffPanel";
import { useUnitFormat } from "./useUnitFormat";
import { WallPanel } from "./WallPanel";

/** `view2d`: the 2D plan is showing (the drawing is only ever drawn there). */
export function PlanPanel({ view2d = true }: { view2d?: boolean }) {
  const plan = usePlanStore((s) => s.plan);
  const renameRoom = usePlanStore((s) => s.renameRoom);
  const rooms = useDerivedRooms();
  const selectedId = useSelectionStore((s) => s.selectedId);
  const openingId = useSelectionStore((s) => s.openingId);
  const itemId = useSelectionStore((s) => s.itemId);
  const warnings = useSelectionStore((s) => s.warnings);
  const [open, setOpen] = useState(false); // the phone sheet; ignored at md and wider

  const fmt = useUnitFormat();
  const areaUnit = useUnitsStore((s) => s.area);
  const setAreaUnit = useUnitsStore((s) => s.setArea);
  const area = fmt.area;
  // Summed from the exact areas and rounded once; the rows are each rounded on their own.
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
          <WallPanel />
        ) : openingId ? (
          <OpeningPanel key={openingId} /> // keyed: a note about one opening never shows on the next
        ) : itemId ? (
          <ItemPanel key={itemId} />
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
            <h2 id="warnings-h" className="mb-1 text-sm font-medium text-gilt-ink">
              Worth a look
            </h2>
            <ul className="flex flex-col gap-1 text-xs text-smoke">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </section>
        )}

        {plan.background && view2d && <DrawingSection assetId={plan.background.assetId} kind={plan.background.kind} />}

        <div role="group" aria-label="Area units" className="flex w-fit rounded border border-stone p-0.5 text-sm">
          {AREA_UNITS.map((u) => (
            <button
              key={u}
              type="button"
              data-testid={`units-${u}`}
              aria-pressed={areaUnit === u}
              onClick={() => setAreaUnit(u)}
              className={`min-h-9 rounded-sm px-3 ${areaUnit === u ? "bg-cyanotype text-vellum" : "text-smoke hover:bg-limestone"}`}
            >
              {AREA_LABEL[u]}
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
          {rooms.length > 1 && (
            <p className="mt-2 text-xs text-smoke" data-testid="rooms-note">
              Rows are rounded; the total is summed from exact values.
            </p>
          )}
        </section>

        <TakeoffPanel />
        <SchedulePanel />
      </div>
    </aside>
  );
}

/** The imported drawing under the 2D plan (step M.2c): its controls, whether its file is here, and Remove. */
function DrawingSection({ assetId, kind }: { assetId: string; kind: "pdf" | "image" }) {
  const asset = useBackgroundStore((s) => s.asset);
  const status = asset?.id === assetId ? asset.status : "loading";
  useEffect(() => void useBackgroundStore.getState().load(assetId), [assetId]);
  return (
    <section aria-labelledby="drawing-h" data-testid="panel-drawing" data-status={status} className="flex flex-col gap-2">
      <h2 id="drawing-h" className="text-sm font-medium">
        Drawing
      </h2>
      <p className="text-xs text-smoke" data-testid="panel-drawing-status" role={status === "missing" ? "status" : undefined}>
        {status === "missing"
          ? `The ${kind === "pdf" ? "PDF" : "image"} this plan was imported from isn't stored in this browser. Import it again to see the background.`
          : status === "loading"
            ? "Loading the drawing…"
            : `The ${kind === "pdf" ? "PDF page" : "image"} this plan was imported from, under the 2D plan.`}
      </p>
      {status !== "missing" && <DrawingControls prefix="panel" />}
      <button
        type="button"
        data-testid="panel-drawing-remove"
        onClick={() => usePlanStore.getState().clearBackground()}
        className="min-h-9 w-fit rounded border border-stone px-3 text-xs hover:bg-limestone"
      >
        Remove drawing
      </button>
    </section>
  );
}
