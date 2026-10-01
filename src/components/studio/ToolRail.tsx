"use client";

/*
 * src/components/studio/ToolRail.tsx — the editor's tool rail: a left column at
 * 768 px and wider, a bottom bar below. Only Select works in step 4.1; the
 * other tools are aria-disabled (still focusable, so keyboard users can read
 * why) until steps 4.3 and later. Mounted by src/app/studio/page.tsx.
 */
import type { ReactNode } from "react";

const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

const TOOLS: { id: string; label: string; ready: boolean; icon: ReactNode }[] = [
  { id: "select", label: "Select", ready: true, icon: svg(<path d="M6 3l12 8-5.5 1.5L10 18 6 3z" />) },
  { id: "wall", label: "Wall", ready: false, icon: svg(<><path d="M3 9h18v6H3z" /><path d="M9 9v6M15 9v6" /></>) },
  { id: "door", label: "Door", ready: false, icon: svg(<><path d="M5 20V4M5 20h14" /><path d="M5 4a16 16 0 0 1 14 16" /></>) },
  { id: "window", label: "Window", ready: false, icon: svg(<><path d="M4 6h16v12H4z" /><path d="M12 6v12M4 12h16" /></>) },
  { id: "measure", label: "Measure", ready: false, icon: svg(<><path d="M3 15L15 3l6 6L9 21z" /><path d="M7 11l2 2M10 8l2 2M13 5l2 2" /></>) },
];

export function ToolRail() {
  return (
    <nav aria-label="Tools" className="flex shrink-0 justify-around gap-1 bg-cyanotype p-1 text-vellum max-md:order-last md:w-20 md:flex-col md:justify-start md:gap-2 md:p-2">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          data-testid={`tool-${t.id}`}
          aria-pressed={t.ready ? true : undefined}
          aria-disabled={!t.ready}
          aria-describedby={`tip-${t.id}`}
          onClick={(e) => !t.ready && e.preventDefault()}
          className={`group relative flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded border-b-2 px-1 py-1.5 text-xs md:flex-none md:border-b-0 md:border-l-2 ${
            t.ready ? "border-gilt bg-vellum/15" : "cursor-not-allowed border-transparent opacity-50 hover:opacity-80 focus-visible:opacity-100"
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
            {t.ready ? "Select and inspect" : `${t.label}: coming soon`}
          </span>
        </button>
      ))}
    </nav>
  );
}
