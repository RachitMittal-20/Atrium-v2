"use client";

/*
 * src/components/studio/ToolRail.tsx — the editor's tool rail: a left column at
 * 768 px and wider, a bottom bar below. Select, Wall (step 4.4), Door and
 * Window (step 4.5), Measure (step 4.6), Push/Pull (step 4.7, key P), Move
 * (step 4.7b, key V), Rotate (Q) and Scale (Z) (step I.1b, imported models) work; the
 * active one is aria-pressed and set in src/store/toolStore.ts. The 3D tools are
 * aria-disabled, with a tooltip that
 * says why, in the 2D-only view and while walking. A disabled button stays
 * focusable, so keyboard users can read why. Mounted by src/app/studio/page.tsx.
 */
import type { ReactNode } from "react";
import { useToolStore, type Tool } from "@/store/toolStore";
import { useViewStore } from "@/store/viewStore";

const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

/** `tool` is set for the tools that work; the rest show "coming soon". */
const TOOLS: { id: string; label: string; tool?: Tool; tip?: string; needs3d?: boolean; icon: ReactNode }[] = [
  { id: "select", label: "Select", tool: "select", tip: "Select and inspect", icon: svg(<path d="M6 3l12 8-5.5 1.5L10 18 6 3z" />) },
  { id: "wall", label: "Wall", tool: "wall", tip: "Draw walls", icon: svg(<><path d="M3 9h18v6H3z" /><path d="M9 9v6M15 9v6" /></>) },
  { id: "door", label: "Door", tool: "door", tip: "Place a door on a wall", icon: svg(<><path d="M5 20V4M5 20h14" /><path d="M5 4a16 16 0 0 1 14 16" /></>) },
  { id: "window", label: "Window", tool: "window", tip: "Place a window on a wall", icon: svg(<><path d="M4 6h16v12H4z" /><path d="M12 6v12M4 12h16" /></>) },
  { id: "pushpull", label: "Push/Pull", tool: "pushpull", tip: "Push or pull a face in the 3D view (P)", needs3d: true, icon: svg(<><path d="M4 15l8 4 8-4M4 15V9l8-4 8 4v6" /><path d="M12 19V9M9 12l3-3 3 3" /></>) },
  { id: "move", label: "Move", tool: "move", tip: "Move a door, window, wall, corner or imported model in the 3D view (V)", needs3d: true, icon: svg(<><path d="M12 3v18M3 12h18" /><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" /></>) },
  { id: "rotate", label: "Rotate", tool: "rotate", tip: "Turn an imported model or part in the 3D view (Q)", needs3d: true, icon: svg(<><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 4v4h-4" /></>) },
  { id: "scale", label: "Scale", tool: "scale", tip: "Scale an imported model or part in the 3D view (Z)", needs3d: true, icon: svg(<><path d="M4 20h7v-7H4z" /><path d="M13 11l7-7M15 4h5v5" /></>) },
  { id: "measure", label: "Measure", tool: "measure", tip: "Measure a distance in the 2D plan", icon: svg(<><path d="M3 15L15 3l6 6L9 21z" /><path d="M7 11l2 2M10 8l2 2M13 5l2 2" /></>) },
];

/** Why a 3D tool can't be used right now, or null when it can. */
const blocked3d = (label: string, view3d: boolean, walking: boolean) => (!view3d ? `${label} works in the 3D view` : walking ? `Exit Walk to use ${label}` : null);

/** `view3d`: the 3D pane is showing, so Push/Pull and Move can be used (unless walking). */
export function ToolRail({ view3d }: { view3d: boolean }) {
  const active = useToolStore((s) => s.tool);
  const setTool = useToolStore((s) => s.setTool);
  const walking = useViewStore((s) => s.mode === "walk");
  return (
    <nav aria-label="Tools" className="flex shrink-0 justify-around gap-0 bg-cyanotype p-1 text-vellum max-md:order-last md:w-20 md:flex-col md:justify-start md:gap-2 md:p-2">
      {TOOLS.map((t) => {
        const why = t.needs3d ? blocked3d(t.label, view3d, walking) : null; // needs the 3D pane, and it is hidden or walking
        const off = !t.tool || why !== null;
        const on = !off && t.tool === active;
        return (
          <button
            key={t.id}
            type="button"
            data-testid={`tool-${t.id}`}
            aria-pressed={t.tool ? on : undefined}
            aria-disabled={off}
            aria-describedby={`tip-${t.id}`}
            onClick={(e) => (off || !t.tool ? e.preventDefault() : setTool(t.tool))}
            className={`group relative flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded border-b-2 px-0.5 py-1.5 text-center text-[10px] leading-tight md:flex-none md:px-1 md:text-xs md:border-b-0 md:border-l-2 ${
              on ? "border-gilt bg-vellum/15" : !off ? "border-transparent hover:bg-vellum/10" : "cursor-not-allowed border-transparent opacity-50 hover:opacity-80 focus-visible:opacity-100"
            }`}
          >
            {t.icon}
            {t.label.replace("/", "/\u200b") /* nine tools share a phone's bar: "Push/Pull" may break after the slash, nothing else */}
            {/* Tooltip on hover and keyboard focus; to the right of the rail, above the bar on a phone. */}
            <span
              id={`tip-${t.id}`}
              role="tooltip"
              className="pointer-events-none absolute z-30 hidden whitespace-nowrap rounded border border-stone bg-vellum px-2 py-1 text-xs text-iron shadow group-hover:block group-focus-visible:block max-md:bottom-full max-md:mb-2 max-md:left-1/2 max-md:-translate-x-1/2 md:left-full md:ml-2 md:top-1/2 md:-translate-y-1/2"
            >
              {why ?? t.tip ?? `${t.label}: coming soon`}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
