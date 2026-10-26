/**
 * BlueprintDrawings.tsx — the two still pictures of the landing page's blueprint scene (step 8.1), drawn from the
 * REAL sample plan on the server. This file has no "use client": it is a server component, rendered into the
 * page's HTML, so neither its maths nor three.js (which BlueprintEndState reads the wall meshes with) is sent to
 * the browser. src/app/page.tsx passes both to BlueprintScene as props.
 *
 *   BlueprintSheet     the cyanotype sheet: the plan as the studio's 2D plan draws it (sheetShapes in
 *                      src/lib/landing/blueprint.ts), pale lines on cyanotype paper with a one-metre grid, framed
 *                      on sheetBox. It is the scene's first paint, the first step of the static fallback, and the
 *                      texture the 3D canvas lays on the ground (BlueprintCanvas serialises this very element, so
 *                      the 3D sheet is the same drawing).
 *   BlueprintEndState  the end state for reduced motion and for browsers without WebGL: the studio's wall meshes,
 *                      openings cut, seen along the 3D scene's last viewing direction (axonometricFaces).
 *
 * Colours are the design tokens through Tailwind's fill-* and stroke-* classes; lengths are plan metres.
 * Connects to: src/data/samplePlan.ts, src/lib/landing/{blueprint,blueprintMeshes}.ts,
 * src/components/landing/{BlueprintScene,BlueprintCanvas}.tsx.
 */
import { samplePlan } from "@/data/samplePlan";
import { sheetBox, sheetShapes } from "@/lib/landing/blueprint";
import { axonometricFaces } from "@/lib/landing/blueprintMeshes";
import type { Vec2 } from "@/types/plan";

const pts = (ps: Vec2[]) => ps.map((p) => `${p.x},${p.y}`).join(" ");
const LINE = 0.035; // metres: about 2 px on a phone, 2.5 px on a desktop

export function BlueprintSheet() {
  const box = sheetBox(samplePlan);
  const sheet = sheetShapes(samplePlan);
  const grid: number[][] = [];
  for (let x = Math.ceil(box.x); x <= box.x + box.w; x++) grid.push([x, box.y, x, box.y + box.h]);
  for (let y = Math.ceil(box.y); y <= box.y + box.h; y++) grid.push([box.x, y, box.x + box.w, y]);
  return (
    <svg
      data-blueprint-sheet
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      preserveAspectRatio="xMidYMid meet"
      className="absolute inset-0 h-full w-full"
      role="img"
      aria-label="The sample plan drawn as a blueprint: two bedrooms, a living room and a bathroom"
    >
      <rect x={box.x} y={box.y} width={box.w} height={box.h} className="fill-cyanotype" />
      <g className="stroke-vellum" strokeOpacity={0.12} strokeWidth={0.015}>
        {grid.map(([x1, y1, x2, y2]) => (
          <line key={`${x1},${y1},${x2},${y2}`} x1={x1} y1={y1} x2={x2} y2={y2} />
        ))}
      </g>
      {sheet.walls.map((o, i) => o.length > 0 && <polygon key={i} points={pts(o)} className="fill-vellum stroke-vellum" strokeWidth={0.01} />)}
      {sheet.gaps.map((g) => (
        <polygon key={g.id} points={pts(g.band)} className="fill-cyanotype" />
      ))}
      <g fill="none" className="stroke-vellum" strokeWidth={LINE} strokeLinecap="round">
        {sheet.doors.map((d) => (
          <g key={d.id}>
            <line x1={d.hinge.x} y1={d.hinge.y} x2={d.leafEnd.x} y2={d.leafEnd.y} />
            <path d={`M${d.leafEnd.x},${d.leafEnd.y}A${d.r},${d.r} 0 0 ${d.sweep} ${d.arcEnd.x},${d.arcEnd.y}`} strokeWidth={LINE * 0.6} />
          </g>
        ))}
        {sheet.windows.map((w) => (
          <g key={w.id}>
            {w.lines.map(([p, q], i) => (
              <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} strokeWidth={i === 2 ? LINE * 0.6 : LINE} />
            ))}
          </g>
        ))}
      </g>
    </svg>
  );
}

const SHADE = { top: "fill-vellum", lit: "fill-limestone", shade: "fill-stone" } as const;

export function BlueprintEndState() {
  const { faces, sheet, viewBox } = axonometricFaces(samplePlan);
  const p = (ps: [number, number][]) => ps.map(([x, y]) => `${x},${y}`).join(" ");
  return (
    <svg
      data-blueprint-end
      viewBox={viewBox.join(" ")}
      preserveAspectRatio="xMidYMid meet"
      className="absolute inset-x-0 bottom-0 top-[26%] h-[74%] w-full px-4 pb-6"
      role="img"
      aria-label="The same plan raised into walls, with its doors and windows cut out"
    >
      <polygon points={p(sheet)} className="fill-cyanotype" />
      <g className="stroke-cyanotype" strokeWidth={0.02} strokeLinejoin="round">
        {faces.map((f, i) => (
          <polygon key={i} points={p(f.points)} className={SHADE[f.shade]} />
        ))}
      </g>
    </svg>
  );
}
