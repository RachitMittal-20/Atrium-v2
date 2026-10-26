"use client";

/*
 * src/components/studio/OpeningPanel.tsx — the right panel while a door or
 * window is selected (selectionStore.openingId). It shows what the opening is
 * and which wall it sits on, and edits it with exact numbers: width, height,
 * sill (windows only: doors start at the floor), and the centre's distance
 * from the wall's start. A door shows its swing side, a Left/Right choice and
 * a Flip button, which flips the side and nothing else, plus (step M.1d) a
 * Hinge side A end / B end choice, which moves the leaf to the other jamb and
 * nothing else — the two together are the door's four states. Delete removes the
 * opening and leaves its wall.
 *
 * Every rule is pure, in src/lib/plan/edit.ts (resizeOpening, slideOpening,
 * openingSize): this panel only parses what was typed (parseTypedLength, so
 * 0.9, 90 cm and 3' all work), rounds it to 0.1 mm (step M.1d, so a typed value is kept
 * as typed), and hands the result to
 * planStore.updateOpening — one undo step per edit. A value that had to be
 * clamped says why underneath. Replaces the Summary in PlanPanel.tsx, the same
 * way WallPanel.tsx does for a wall, and reuses its NumberField.
 * An opening imported from a PDF (step M.1c) says where its numbers came from,
 * as a wall does: "Read from PDF", "Traced, approximate" or, once changed,
 * "Edited"; and "Default height" while its height and sill are the importer's
 * defaults (a PDF has no heights).
 * Connects to: src/store/{planStore,selectionStore}.ts, src/lib/plan/edit.ts.
 */
import { useState } from "react";
import { openingSize, resizeOpening, roundTo, slideOpening, TYPED_STEP } from "@/lib/plan/edit";
import { wallLength } from "@/lib/plan/geometry";
import { usePlanStore } from "@/store/planStore";
import { useSelectionStore } from "@/store/selectionStore";
import type { HingeEnd, SwingSide } from "@/types/plan";
import { lengthHint } from "@/lib/units/format";
import { rescaledText } from "@/lib/plan/calibrate";
import { same, useUnitFormat } from "./useUnitFormat";
import { NumberField } from "./WallPanel";

const SIDE_WORDS: Record<SwingSide, string> = { left: "Left", right: "Right" };
const HINGE_WORDS: Record<HingeEnd, string> = { a: "A end", b: "B end" };

export function OpeningPanel() {
  const fmt = useUnitFormat();
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

  /** Metres from what was typed, rounded to 0.1 mm (step M.1d: kept as typed), or a note
   *  saying why it wasn't read. */
  const metres = (raw: string): number | string => {
    const m = fmt.parseLen(raw);
    return m === null ? `"${raw.trim()}" isn't a length. ${lengthHint(fmt.length)}` : roundTo(m, TYPED_STEP);
  };

  const setWidth = (raw: string) => {
    const m = metres(raw);
    if (typeof m === "string") return m;
    if (same(m, opening.width)) return null; // unchanged: no edit, no undo step
    const r = resizeOpening(usePlanStore.getState().plan, id, m);
    if ("error" in r) return r.error;
    usePlanStore.getState().updateOpening(id, { width: r.width, offset: r.offset }); // one step, even when the centre shifts
    return r.note ?? null;
  };
  const setOffset = (raw: string) => {
    const m = metres(raw);
    if (typeof m === "string") return m;
    if (same(m, opening.offset)) return null;
    const r = slideOpening(usePlanStore.getState().plan, id, m);
    usePlanStore.getState().updateOpening(id, { offset: r.offset });
    return r.limited ?? null;
  };
  const setSize = (key: "height" | "sillHeight") => (raw: string) => {
    const m = metres(raw);
    if (typeof m === "string") return m;
    if (same(m, opening[key])) return null;
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
  const hinge: HingeEnd = opening.hinge ?? "a"; // no hinge stored means the a jamb, as every door did before step M.1d
  const setHinge = (end: HingeEnd) => {
    usePlanStore.getState().updateOpening(id, { hinge: end }); // one undo step, and the swing side is untouched
    setNote(null);
  };

  return (
    <section aria-labelledby="opening-h" data-testid="opening-panel">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 id="opening-h" className="text-sm font-medium">
          Selected {name}
        </h2>
        <button type="button" data-testid="opening-back" onClick={() => select(null)} className="min-h-9 rounded px-1 text-sm text-gilt-ink underline hover:bg-limestone">
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
          <button type="button" data-testid="opening-wall" onClick={() => select(wall.id)} className="min-h-9 rounded px-1 text-gilt-ink underline hover:bg-limestone">
            {fmt.len(wallLength(wall))} wall
          </button>
        </dd>
      </dl>

      {(opening.provenance || opening.defaultHeight) && (
        <p data-testid="opening-provenance" data-provenance={opening.provenance} data-edited={opening.edited ? "true" : undefined} data-default-height={opening.defaultHeight ? "true" : undefined} className="mb-2 text-xs text-smoke">
          {[
            opening.provenance && (opening.edited ? "Edited" : opening.provenance === "vector" ? "Read from PDF" : "Traced, approximate"),
            opening.provenance && !opening.edited && rescaledText(plan.calibrations), // step M.2c: after a Set scale
            opening.defaultHeight && "Default height",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      <div className="flex flex-col gap-1">
        <NumberField label="Width" value={fmt.len(opening.width)} testId="opening-width" onCommit={say(setWidth)} />
        <NumberField label="Height" value={fmt.len(opening.height)} testId="opening-height" onCommit={say(setSize("height"))} />
        {!door && <NumberField label="Sill" value={fmt.len(opening.sillHeight)} testId="opening-sill" onCommit={say(setSize("sillHeight"))} />}
        <NumberField label="Centre from wall start" value={fmt.len(opening.offset)} testId="opening-offset" onCommit={say(setOffset)} />
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
          <p className="mt-1 text-xs text-smoke">Looking along the wall from its start.</p>
          <button type="button" data-testid="opening-flip" onClick={flip} className="mt-2 min-h-10 w-full rounded border border-stone bg-vellum px-3 text-sm text-iron hover:bg-limestone">
            Flip swing
          </button>

          {/* Which jamb the leaf pivots on (step M.1d). Separate from the swing side: the two
              make four door states, and flipping the swing never moves the hinge. */}
          <div className="mt-3 flex items-center justify-between gap-2 text-sm">
            <span className="text-smoke" id="hinge-label">
              Hinge side
            </span>
            <div role="group" aria-labelledby="hinge-label" className="flex rounded border border-stone p-0.5" data-testid="opening-hinge" data-hinge={hinge}>
              {(["a", "b"] as const).map((e) => (
                <button
                  key={e}
                  type="button"
                  data-testid={`hinge-${e}`}
                  aria-pressed={hinge === e}
                  onClick={() => hinge !== e && setHinge(e)}
                  className={`min-h-9 rounded-sm px-3 ${hinge === e ? "bg-cyanotype text-vellum" : "text-smoke hover:bg-limestone"}`}
                >
                  {HINGE_WORDS[e]}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-1 text-xs text-smoke">The jamb the leaf pivots on: the wall&apos;s start (A) or its end (B).</p>
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
