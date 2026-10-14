"use client";

/*
 * src/components/plan2d/LabelText.tsx — draws one laid-out label (step L.1): its lines, centred on
 * the rectangle the layout pass gave it, with the limestone halo every plan label has. A label that
 * was wrapped or shortened carries its whole text in a <title> (the browser's tooltip) and takes
 * pointer events so the tooltip can show; the pointer events bubble to the plan's own handlers, which
 * pick by plan coordinates, so nothing is picked or blocked by this text. A label that wasn't changed
 * has only its text as a child, so `textContent` is exactly what is shown. Every label carries the SVG filter
 * `#label-plate` (defined in PlanCanvas's svg): the pane's colour at 80% behind the text's own box, so the drawing
 * under the plan does not read through it. A filter, not a <rect> beside the text, so the plan-room-label children
 * stay [name, area] and the layout's rectangles are untouched.
 * Connects to: src/lib/plan2d/labels.ts (DrawnLabel); used by PlanCanvas.tsx and TakeoffLayer.tsx.
 */
import type { DrawnLabel } from "@/lib/plan2d/labels";
import { LINE_EM } from "@/lib/plan2d/labelLayout";

const halo = { paintOrder: "stroke", strokeWidth: 3, strokeLinejoin: "round" } as const;

export function LabelText({ label, className }: { label: DrawnLabel; className: string }) {
  const lh = label.px * LINE_EM;
  const n = label.lines.length;
  return (
    <text
      x={label.cx}
      y={label.cy - ((n - 1) * lh) / 2}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={label.px}
      className={className}
      style={halo}
      filter="url(#label-plate)"
      data-label={label.id}
      data-kind={label.kind}
      pointerEvents={label.changed ? "all" : undefined}
    >
      {label.changed && <title>{label.full}</title>}
      {n === 1
        ? label.lines[0]
        : label.lines.map((s, i) => (
            <tspan key={i} x={label.cx} dy={i === 0 ? 0 : lh}>
              {s}
            </tspan>
          ))}
    </text>
  );
}
