"use client";

/*
 * src/components/studio/ToolRail.tsx — the editor's tool rail: a left column at
 * 768 px and wider, a bottom bar below. Select and Measure work (the active one
 * is pressed, with a gilt edge); the other tools are aria-disabled (still
 * focusable, so keyboard users can read why) until later steps. The active tool
 * lives in src/store/toolStore.ts. Mounted by src/app/studio/page.tsx.
 */
import type { ReactNode } from "react";
import { useToolStore, type Tool } from "@/store/toolStore";

const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

/** `tool` is set for the tools that work; the rest are "coming soon". */
const TOOLS: { id: string; tool?: Tool; label: string; tip: string; icon: ReactNode }[] = [
  { id: "select", tool: "select", label: "Select", tip: "Select and inspect", icon: svg(<path d="M6 3l12 8-5.5 1.5L10 18 6 3z" />) },
  { id: "wall", label: "Wall", tip: "Wall: coming soon", icon: svg(<><path d="M3 9h18v6H3z" /><path d="M9 9v6M15 9v6" /></>) },
  { id: "door", label: "Door", tip: "Door: coming soon", icon: svg(<><path d="M5 20V4M5 20h14" /><path d="M5 4a16 16 0 0 1 14 16" /></>) },
  { id: "window", label: "Window", tip: "Window: coming soon", icon: svg(<><path d="M4 6h16v12H4z" /><path d="M12 6v12M4 12h16" /></>) },
  { id: "measure", tool: "measure", label: "Measure", tip: "Measure a distance in the 2D plan", icon: svg(<><path d="M3 15L15 3l6 6L9 21z" /><path d="M7 11l2 2M10 8l2 2M13 5l2 2" /></>) },
];

export function ToolRail() {
  const active = useToolStore((s) => s.tool);
  const setTool = useToolStore((s) => s.setTool);
  return (
    <nav aria-label="Tools" className="flex shrink-0 justify-around gap-1 bg-cyanotype p-1 text-vellum max-md:order-last md:w-20 md:flex-col md:justify-start md:gap-2 md:p-2">
      {TOOLS.map((t) => {
        const ready = t.tool !== undefined;
        const on = ready && t.tool === active;
        return (
          <button
            key={t.id}
            type="button"
            data-testid={`tool-${t.id}`}
            aria-pressed={ready ? on : undefined}
            aria-disabled={!ready}
            aria-describedby={`tip-${t.id}`}
            onClick={(e) => (t.tool ? setTool(t.tool) : e.preventDefault())}
            className={`group relative flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded border-b-2 px-1 py-1.5 text-xs md:flex-none md:border-b-0 md:border-l-2 ${
              on ? "border-gilt bg-vellum/15" : ready ? "border-transparent hover:bg-vellum/10" : "cursor-not-allowed border-transparent opacity-50 hover:opacity-80 focus-visible:opacity-100"
            }`}
          >
            {t.icon}
            {t.label}
            {/* Tooltip on hover and keyboard focus; to the right of the rail, above the bar on a phone. */}
            <span
              id={`tip-${t.id}`}
              role="tooltip"
              className="pointer-events-none absolute z-30 hidden whitespace-nowrap rounded border border-stone bg-vellum px-2 py-1 text-xs text-iron shadow group-hover:block group-focus-visible:block max-md:bottom-full max-md:mb-2 max-md:left-1/2 max-md:-translate-x-1/2 md:left-full md:ml-2 md:top-1/2 md:-translate-y-1/2"
            >
              {t.tip}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
