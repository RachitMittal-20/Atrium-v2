"use client";

/*
 * src/components/studio/WallPanel.tsx — the right panel while a wall is
 * selected: its length, thickness and height as exact numbers, which rooms it
 * bounds, how many doors and windows sit on it, the straight wall it is a piece
 * of when detection split one at a T-junction, and Delete (which takes this
 * piece only, never the rest of the run). It replaces the
 * Summary section in PlanPanel.tsx and offers a way back to it.
 *
 * A typed length moves the wall's b end along its own direction, exactly like
 * dragging the b handle in the 2D plan — the same dragEndpoint from
 * src/lib/plan/edit.ts, so joined walls follow and the 0.2 m minimum holds.
 * Thickness and height go through planStore.updateWall, clamped with the reason
 * shown. Values are read in metres or feet with parseTypedLength, so 3.8, 3.8 m,
 * 380 cm and 12'6" all work; anything else puts the old value back and says why.
 * Connects to: src/store/{planStore,selectionStore}.ts, src/lib/plan/edit.ts.
 */
import { useState } from "react";
import { parseTypedLength } from "@/app/studio/import/importFile";
import { clampField, dragEndpoint, HEIGHT_RANGE, lengthTarget, MIN_WALL_LENGTH, newProblems, THICKNESS_RANGE } from "@/lib/plan/edit";
import { wallLength } from "@/lib/plan/geometry";
import { validatePlan } from "@/lib/plan/validate";
import { useDerivedRooms, usePlanStore } from "@/store/planStore";
import { useSelectedRun, useSelectionStore } from "@/store/selectionStore";
import { formatLength, type Unit } from "./PlanPanel";

/** A text field holding one number. The field always goes back to the stored
 *  value after a commit, so an invalid entry simply reappears as it was and the
 *  caller shows the reason. */
export function NumberField({ label, value, testId, onCommit }: { label: string; value: string; testId: string; onCommit: (raw: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="flex min-h-10 items-center justify-between gap-2 text-sm">
      <span className="text-smoke">{label}</span>
      <input
        data-testid={testId}
        aria-label={label}
        value={draft ?? value}
        inputMode="decimal"
        spellCheck={false}
        onFocus={(e) => {
          setDraft(value);
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null && draft.trim() && draft !== value) onCommit(draft);
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
        className="w-28 rounded border border-stone bg-vellum px-2 py-1 text-right hover:bg-limestone focus:bg-white/70"
      />
    </label>
  );
}

export function WallPanel({ unit }: { unit: Unit }) {
  const plan = usePlanStore((s) => s.plan);
  const rooms = useDerivedRooms();
  const selectedId = useSelectionStore((s) => s.selectedId);
  const run = useSelectedRun();
  const select = useSelectionStore((s) => s.select);
  const setWarnings = useSelectionStore((s) => s.setWarnings);
  const [note, setNote] = useState<string | null>(null);

  const wall = plan.walls.find((w) => w.id === selectedId);
  if (!wall) return null;

  const bounds = rooms.filter((r) => r.wallIds.includes(wall.id)).map((r) => r.name);
  // The run's pieces are collinear and end to end, so their lengths add up to the whole wall.
  const runLength = plan.walls.filter((w) => run.includes(w.id)).reduce((sum, w) => sum + wallLength(w), 0);
  const on = plan.openings.filter((o) => o.wallId === wall.id);
  const doors = on.filter((o) => o.kind === "door").length;
  const windows = on.length - doors;

  /** Metres from what the user typed, or a note saying why it wasn't read. */
  const metres = (raw: string): number | string => parseTypedLength(raw) ?? `"${raw.trim()}" isn't a length. Try 2.4, 2.4 m, 240 cm or 7'10".`;

  const setLength = (raw: string) => {
    const m = metres(raw);
    if (typeof m === "string") return m;
    if (m < MIN_WALL_LENGTH) return `Walls can't be shorter than ${MIN_WALL_LENGTH.toFixed(2)} m.`;
    // The same move as dragging the b handle: the b end slides along the wall's direction.
    const baseline = validatePlan(plan);
    const out = dragEndpoint(plan.walls, wall.id, "b", lengthTarget(wall, m));
    usePlanStore.getState().transaction(() => usePlanStore.getState().moveWallEndpoint(wall.id, "b", out.point));
    setWarnings(newProblems(baseline, validatePlan(usePlanStore.getState().plan)));
    return out.limited ?? null;
  };

  const setSize = (key: "thickness" | "height", range: readonly [number, number], label: string) => (raw: string) => {
    const m = metres(raw);
    if (typeof m === "string") return m;
    const { value, note: why } = clampField(m, range, label);
    usePlanStore.getState().updateWall(wall.id, { [key]: value });
    return why ?? null;
  };

  const say = (fn: (raw: string) => string | null) => (raw: string) => setNote(fn(raw));

  return (
    <section aria-labelledby="wall-h" data-testid="wall-panel">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 id="wall-h" className="text-sm font-medium">
          Selected wall
        </h2>
        <button type="button" data-testid="back-to-summary" onClick={() => select(null)} className="min-h-9 rounded px-1 text-sm text-gilt underline hover:bg-limestone">
          Back to summary
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <NumberField label="Length" value={formatLength(wallLength(wall), unit)} testId="wall-length" onCommit={say(setLength)} />
        <NumberField label="Thickness" value={formatLength(wall.thickness, unit)} testId="wall-thickness" onCommit={say(setSize("thickness", THICKNESS_RANGE, "Thickness"))} />
        <NumberField label="Height" value={formatLength(wall.height, unit)} testId="wall-height" onCommit={say(setSize("height", HEIGHT_RANGE, "Height"))} />
      </div>

      {note && (
        <p role="status" data-testid="wall-note" className="mt-2 text-xs text-smoke">
          {note}
        </p>
      )}

      {run.length > 1 && (
        <p data-testid="wall-run" className="mt-2 text-xs text-smoke">
          Part of a straight wall of {run.length} pieces, {formatLength(runLength, unit)}.
        </p>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-smoke">Bounds</dt>
        <dd className="text-right" data-testid="wall-rooms">
          {bounds.length > 0 ? bounds.join(", ") : "No room yet"}
        </dd>
        <dt className="text-smoke">Doors</dt>
        <dd className="text-right" data-testid="wall-doors">
          {doors}
        </dd>
        <dt className="text-smoke">Windows</dt>
        <dd className="text-right" data-testid="wall-windows">
          {windows}
        </dd>
      </dl>

      <button
        type="button"
        data-testid="wall-delete"
        onClick={() => usePlanStore.getState().deleteWall(wall.id)} // selectionStore clears the selection when the wall goes
        className="mt-3 min-h-10 w-full rounded border border-stone bg-vellum px-3 text-sm text-iron hover:bg-limestone"
      >
        {/* Only ever this piece: the rest of the run stays. */}
        Delete {run.length > 1 ? "this piece" : "wall"}
        {on.length > 0 ? ` and its ${on.length} ${on.length === 1 ? "opening" : "openings"}` : ""}
      </button>
    </section>
  );
}
