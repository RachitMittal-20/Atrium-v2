"use client";

/*
 * src/components/studio/StudioHints.tsx — the studio's two first-run aids (step N.1), both laid over the
 * canvas area (the <main> in src/app/studio/page.tsx) so neither moves anything when it shows or goes:
 *   - StudioHint: one short, dismissible line for a visitor looking at the untouched sample or an
 *     empty plan (when: src/lib/studioHint.ts). Dismissal is remembered in localStorage by
 *     src/store/hintStore.ts, a view setting that is never in the plan. The line is click-through; only
 *     its "Got it" button takes the pointer, and it is a real button, so Tab reaches it. Hidden while walking.
 *   - EmptyPlanCard: for a plan with no walls, a message and two buttons ("Import a floor plan" to the import
 *     screen, "Draw a wall" to pick the Wall tool, which brings the 2D plan up). It steps aside as soon as another tool is
 *     chosen or a wall exists. The Rooms and Takeoff panels have their own one-line empty states.
 */
import Link from "next/link";
import { showHint } from "@/lib/studioHint";
import { useHintStore } from "@/store/hintStore";
import { usePlanStore } from "@/store/planStore";
import { useToolStore } from "@/store/toolStore";
import { useViewStore } from "@/store/viewStore";

export function StudioHint() {
  const plan = usePlanStore((s) => s.plan);
  const dismissed = useHintStore((s) => s.dismissed);
  const walking = useViewStore((s) => s.mode === "walk");
  if (walking || !showHint(plan, dismissed)) return null;
  return (
    <div className="pointer-events-none absolute inset-x-2 bottom-2 z-20 flex justify-center">
      <aside aria-label="Tip" data-testid="studio-hint" className="flex max-w-md items-center gap-2 rounded border border-stone bg-vellum/95 py-1 pl-3 pr-1 text-sm text-iron shadow">
        <p>Drag a wall to move it. Press P to push or pull a face, K for takeoff, Walk to look around.</p>
        <button
          type="button"
          data-testid="studio-hint-dismiss"
          onClick={() => useHintStore.getState().dismiss()}
          className="pointer-events-auto min-h-11 shrink-0 rounded px-3 text-sm text-cyanotype hover:bg-limestone"
        >
          Got it
        </button>
      </aside>
    </div>
  );
}

export function EmptyPlanCard() {
  const empty = usePlanStore((s) => s.plan.walls.length === 0);
  const tool = useToolStore((s) => s.tool);
  const walking = useViewStore((s) => s.mode === "walk");
  if (!empty || tool !== "select" || walking) return null;
  const btn = "inline-flex min-h-11 items-center justify-center rounded px-4 text-sm";
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
      <section aria-labelledby="empty-plan-h" data-testid="empty-plan" className="pointer-events-auto flex max-w-sm flex-col gap-3 rounded border border-stone bg-vellum p-4 text-center shadow">
        <h2 id="empty-plan-h" className="font-display text-lg">
          This plan is empty
        </h2>
        <p className="text-sm text-smoke">Import a floor plan to build a model from it, or draw the first wall yourself.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Link href="/studio/import" data-testid="empty-import" className={`${btn} bg-cyanotype text-vellum`}>
            Import a floor plan
          </Link>
          <button type="button" data-testid="empty-draw" onClick={() => useToolStore.getState().setTool("wall")} className={`${btn} border border-stone hover:bg-limestone`}>
            Draw a wall
          </button>
        </div>
      </section>
    </div>
  );
}
