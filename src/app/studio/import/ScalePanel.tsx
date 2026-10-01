"use client";

/*
 * src/app/studio/import/ScalePanel.tsx — the one thing the user must do on
 * the import screen (page.tsx): choose the plan's scale, in pixels per metre
 * of the deskewed image. It never guesses; every option needs a press.
 *
 *   good   "Scale found: … from the printed sizes", with a Use button.
 *   check  the same as "Please confirm", with the samples it came from.
 *   none   says no scale was found.
 *   unit-less sizes  "Are the printed sizes in feet or metres?", each answer
 *          with the plan size it implies so the plausible one stands out.
 *   always "Set the scale yourself": the user clicks two points in
 *          PlanViewer.tsx (picking), types the real length (parseTypedLength:
 *          3.8, 3.8 m, 12'6", 12 ft 6 in), and scaleFromPoints gives pxPerM,
 *          shown with the whole plan's implied size as a sanity check.
 *
 * Connects to: scale.ts (ScaleEstimate, scaleFromPoints), importFile.ts.
 */
import { useId, useState } from "react";
import type { Analysis } from "@/lib/blueprint/analyse";
import { scaleFromPoints } from "@/lib/blueprint/scale";
import type { PlanScale } from "@/types/blueprint";
import type { Vec2 } from "@/types/plan";
import { formatSize, parseTypedLength, planSize } from "./importFile";

const SOURCE_TEXT: Record<PlanScale["source"], string> = {
  ocr: "from the printed sizes",
  manual: "from your measurement",
  "unitless-feet": "reading the printed sizes as feet",
  "unitless-metres": "reading the printed sizes as metres",
};

const btn = "min-h-11 rounded-full px-5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
export const primaryBtn = `${btn} bg-gilt text-vellum hover:bg-iron`;
export const secondaryBtn = `${btn} border border-iron/40 text-iron hover:bg-vellum`;

interface Props {
  analysis: Analysis;
  chosen: PlanScale | null;
  onChoose: (s: PlanScale) => void;
  picking: boolean;
  setPicking: (on: boolean) => void;
  points: Vec2[];
  clearPoints: () => void;
}

export function ScalePanel({ analysis, chosen, onChoose, picking, setPicking, points, clearPoints }: Props) {
  const { scale } = analysis;
  const [typed, setTyped] = useState("");
  const lengthId = useId();
  const size = (pxPerM: number) => formatSize(planSize(analysis, pxPerM));
  const same = (s: PlanScale) => chosen?.source === s.source && Math.abs(chosen.pxPerM - s.pxPerM) < 1e-9;

  /** A "Use" button that turns into a note once its scale is chosen. */
  const use = (s: PlanScale, label = "Use this scale") =>
    same(s) ? (
      <p className="text-sm font-medium text-cyanotype">In use</p>
    ) : (
      <button type="button" className={primaryBtn} onClick={() => onChoose(s)}>
        {label}
      </button>
    );

  // The manual measurement, once both points and a length are in.
  const metres = parseTypedLength(typed);
  let manual: PlanScale | null = null;
  let manualError: string | null = null;
  if (points.length === 2 && typed.trim()) {
    if (metres === null) manualError = "Type one length, like 3.8, 3.8 m, 12'6\" or 12 ft 6 in.";
    else
      try {
        manual = { pxPerM: scaleFromPoints(points[0], points[1], metres), source: "manual" };
      } catch (e) {
        manualError = e instanceof Error ? e.message : String(e);
      }
  }

  const found = scale.pxPerM !== null && scale.confidence !== "none" ? { pxPerM: scale.pxPerM, source: "ocr" as const } : null;

  return (
    <section aria-labelledby="scale-heading" className="flex flex-col gap-4 rounded border border-stone bg-vellum p-4">
      <div>
        <h2 id="scale-heading" className="font-display text-lg">
          Scale
        </h2>
        <p className="text-sm text-smoke">Tell us how big the plan is, so the model comes out the right size.</p>
      </div>

      {found && scale.confidence === "good" && (
        <div className="flex flex-col gap-2" data-testid="scale-found">
          <p>
            Scale found: <strong data-testid="suggested-scale">{found.pxPerM.toFixed(1)}</strong> px/m from the printed sizes.
          </p>
          <p className="text-sm text-smoke">The whole plan would be {size(found.pxPerM)}.</p>
          {use(found)}
        </div>
      )}

      {found && scale.confidence === "check" && (
        <div className="flex flex-col gap-2" data-testid="scale-found">
          <p>
            Please confirm: <strong data-testid="suggested-scale">{found.pxPerM.toFixed(1)}</strong> px/m from the printed sizes.
          </p>
          <p className="text-sm text-smoke">{scale.reason}</p>
          <ul className="list-disc pl-5 text-sm text-smoke">
            {scale.samples.map((s, i) => (
              <li key={i}>
                “{s.text}” gives {s.pxPerM.toFixed(1)} px/m
              </li>
            ))}
          </ul>
          <p className="text-sm text-smoke">The whole plan would be {size(found.pxPerM)}.</p>
          {use(found, "Confirm this scale")}
        </div>
      )}

      {!found && (
        <p data-testid="scale-none">
          We couldn&apos;t find a scale printed on this plan. Set it yourself below: click both ends of a wall you know the length of, then type that length.
        </p>
      )}

      {scale.unitless && (
        <div className="flex flex-col gap-2">
          <p>Some sizes on the plan have no unit. Are the printed sizes in feet or metres?</p>
          {(
            [
              ["Feet", { pxPerM: scale.unitless.ifFeet.pxPerM, source: "unitless-feet" }, scale.unitless.ifFeet],
              ["Metres", { pxPerM: scale.unitless.ifMetres.pxPerM, source: "unitless-metres" }, scale.unitless.ifMetres],
            ] as const
          ).map(([label, s, fp]) => (
            <div key={label} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm">
                {label}: the plan would be {fp.width.toFixed(1)} m × {fp.depth.toFixed(1)} m
              </span>
              {use(s, label)}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-stone pt-4">
        {!picking ? (
          <button type="button" className={`${found || scale.unitless ? secondaryBtn : primaryBtn} self-start`} onClick={() => setPicking(true)}>
            Set the scale yourself
          </button>
        ) : (
          <>
            <p className="text-sm">
              {points.length < 2
                ? `Click ${points.length === 0 ? "one end" : "the other end"} of a wall or a length you know on the plan.`
                : "Now type the real length between the two points."}
            </p>
            <label htmlFor={lengthId} className="text-sm text-smoke">
              Length between the points
            </label>
            <input
              id={lengthId}
              data-testid="manual-length"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              inputMode="text"
              placeholder="3.8 m or 12'6&quot;"
              className="min-h-11 rounded border border-stone bg-limestone px-3 text-iron"
            />
            {manualError && <p className="text-sm text-iron">{manualError}</p>}
            {manual && (
              <p className="text-sm" data-testid="manual-result">
                That makes {manual.pxPerM.toFixed(1)} px/m, so the whole plan is {size(manual.pxPerM)}.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {manual && use(manual)}
              <button type="button" className={secondaryBtn} onClick={clearPoints} disabled={points.length === 0}>
                Clear points
              </button>
              <button
                type="button"
                className={secondaryBtn}
                onClick={() => {
                  clearPoints();
                  setPicking(false);
                }}
              >
                Stop measuring
              </button>
            </div>
          </>
        )}
      </div>

      <p className="text-sm" data-testid="chosen-scale" aria-live="polite">
        {chosen ? (
          <>
            Using {chosen.pxPerM.toFixed(1)} px/m, {SOURCE_TEXT[chosen.source]}.
          </>
        ) : (
          <span className="text-smoke">No scale chosen yet.</span>
        )}
      </p>
    </section>
  );
}
