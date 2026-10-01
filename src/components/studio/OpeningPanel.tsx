"use client";

/*
 * src/components/studio/OpeningPanel.tsx — the right panel while a door or
 * window is selected (selectionStore.openingId). It shows what the opening is
 * and which wall it sits on, and edits it with exact numbers: width, height,
 * sill (windows only: doors start at the floor), and the centre's distance
 * from the wall's start. A door shows its swing side, a Left/Right choice and
 * a Flip button, which flips the side and nothing else. Delete removes the
 * opening and leaves its wall.
 *
 * Every rule is pure, in src/lib/plan/edit.ts (resizeOpening, slideOpening,
 * openingSize): this panel only parses what was typed (parseTypedLength, so
 * 0.9, 90 cm and 3' all work), rounds it to 1 cm, and hands the result to
 * planStore.updateOpening — one undo step per edit. A value that had to be
 * clamped says why underneath. Replaces the Summary in PlanPanel.tsx, the same
 * way WallPanel.tsx does for a wall, and reuses its NumberField.
 * Connects to: src/store/{planStore,selectionStore}.ts, src/lib/plan/edit.ts.
 */
import { useState } from "react";
import { parseTypedLength } from "@/app/studio/import/importFile";
import { openingSize, resizeOpening, roundTo, slideOpening } from "@/lib/plan/edit";
import { wallLength } from "@/lib/plan/geometry";
import { usePlanStore } from "@/store/planStore";
import { useSelectionStore } from "@/store/selectionStore";
import type { SwingSide } from "@/types/plan";
import { formatLength, type Unit } from "./PlanPanel";
import { NumberField } from "./WallPanel";

const SIDE_WORDS: Record<SwingSide, string> = { left: "Left", right: "Right" };

export function OpeningPanel({ unit }: { unit: Unit }) {
  const plan = usePlanStore((s) => s.plan);
  const openingId = useSelectionStore((s) => s.openingId);
  const select = useSelectionStore((s) => s.select);
  const [note, setNote] = useState<string | null>(null);

  const opening = plan.openings.find((o) => o.id === openingId);
  const wall = opening && plan.walls.find((w) => w.id === opening.wallId);
  if (!opening || !wall) return null;
  const id = opening.id;
  const door = opening.kind === "door";
  const name = door ? "door" : "window";

  /** Metres from what was typed, rounded to 1 cm, or a note saying why it wasn't read. */
  const metres = (raw: string): number | string => {
    const m = parseTypedLength(raw);
    return m === null ? `"${raw.trim()}" isn't a length. Try 0.9, 0.9 m, 90 cm or 3'.` : roundTo(m);
  };

  const setWidth = (raw: string) => {
    const m = metres(raw);
    if (typeof m === "string") return m;
    const r = resizeOpening(usePlanStore.getState().plan, id, m);
    if ("error" in r) return r.error;
    usePlanStore.getState().updateOpening(id, { width: r.width, offset: r.offset }); // one step, even when the centre shifts
    return r.note ?? null;
  };
  const setOffset = (raw: string) => {
    const m = metres(raw);
    if (typeof m === "string") return m;
    const r = slideOpening(usePlanStore.getState().plan, id, m);
    usePlanStore.getState().updateOpening(id, { offset: r.offset });
    return r.limited ?? null;
  };
  const setSize = (key: "height" | "sillHeight") => (raw: string) => {
    const m = metres(raw);
    if (typeof m === "string") return m;
    const r = openingSize(usePlanStore.getState().plan, id, key, m);
    if ("error" in r) return r.error;
    usePlanStore.getState().updateOpening(id, { [key]: r.value });
    return r.note ?? null;
  };
  const say = (fn: (raw: string) => string | null) => (raw: string) => setNote(fn(raw));
  const flip = () => {
    usePlanStore.getState().flipDoor(id);
    setNote(null);
  };

  const side: SwingSide = opening.swing ?? "left";

  return (
    <section aria-labelledby="opening-h" data-testid="opening-panel">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 id="opening-h" className="text-sm font-medium">
          Selected {name}
        </h2>
        <button type="button" data-testid="opening-back" onClick={() => select(null)} className="min-h-9 rounded px-1 text-sm text-gilt underline hover:bg-limestone">
          Back to summary
        </button>
      </div>

      <dl className="mb-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-smoke">Type</dt>
        <dd className="text-right" data-testid="opening-type">
          {door ? "Door" : "Window"}
        </dd>
        <dt className="text-smoke">On wall</dt>
        <dd className="text-right">
          {/* Selecting the wall swaps this panel for the wall's own. */}
          <button type="button" data-testid="opening-wall" onClick={() => select(wall.id)} className="min-h-9 rounded px-1 text-gilt underline hover:bg-limestone">
            {formatLength(wallLength(wall), unit)} wall
          </button>
        </dd>
      </dl>

      <div className="flex flex-col gap-1">
        <NumberField label="Width" value={formatLength(opening.width, unit)} testId="opening-width" onCommit={say(setWidth)} />
        <NumberField label="Height" value={formatLength(opening.height, unit)} testId="opening-height" onCommit={say(setSize("height"))} />
        {!door && <NumberField label="Sill" value={formatLength(opening.sillHeight, unit)} testId="opening-sill" onCommit={say(setSize("sillHeight"))} />}
        <NumberField label="Centre from wall start" value={formatLength(opening.offset, unit)} testId="opening-offset" onCommit={say(setOffset)} />
      </div>

      {door && (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-smoke" id="swing-label">
              Swing side
            </span>
            <div role="group" aria-labelledby="swing-label" className="flex rounded border border-stone p-0.5" data-testid="opening-swing" data-swing={side}>
              {(["left", "right"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  data-testid={`swing-${s}`}
                  aria-pressed={side === s}
                  onClick={() => side !== s && flip()}
                  className={`min-h-9 rounded-sm px-3 ${side === s ? "bg-cyanotype text-vellum" : "text-smoke hover:bg-limestone"}`}
                >
                  {SIDE_WORDS[s]}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-1 text-xs text-smoke">Looking along the wall from its start; the hinge is at the end nearer the start.</p>
          <button type="button" data-testid="opening-flip" onClick={flip} className="mt-2 min-h-10 w-full rounded border border-stone bg-vellum px-3 text-sm text-iron hover:bg-limestone">
            Flip swing
          </button>
        </div>
      )}

      {note && (
        <p role="status" data-testid="opening-note" className="mt-2 text-xs text-smoke">
          {note}
        </p>
      )}

      <button
        type="button"
        data-testid="opening-delete"
        onClick={() => usePlanStore.getState().deleteOpening(id)} // selectionStore clears the selection when it goes
        className="mt-3 min-h-10 w-full rounded border border-stone bg-vellum px-3 text-sm text-iron hover:bg-limestone"
      >
        Delete {name}
      </button>
    </section>
  );
}
