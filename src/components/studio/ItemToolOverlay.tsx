"use client";

/**
 * ItemToolOverlay.tsx — what Move, Rotate and Scale say on screen about imported 3D
 * models (step I.1b), beside the 3D canvas like PushPullOverlay (so pressing its
 * buttons is never canvas input). Reads src/store/itemToolStore.ts.
 *   - A label next to the pointer while a model is hovered or dragged: the change
 *     ("+0.35 m, -0.10 m", "+15°", "Scale 150%"), the result ("At x 2.35 m, y 1.90 m",
 *     "Height 0.50 m", "Rotation 45°", "Size 1.8 × 1.2 × 1.13 m") and why a limit
 *     stopped it ("Can't go below the floor").
 *   - Rotate and Scale: a status line at the bottom of the pane, with a real input for
 *     the typed value ("Turn by" degrees, "Scale to" percent), so a touch screen, which
 *     has no keyboard to type into the canvas with, can type one too. Enter applies it to
 *     the selected model (its active part), else the hovered one.
 *   - Move, whenever the plan has an imported model: a Floor | Lift toggle above
 *     Push/Pull's status line, for touch, where there is no Shift. It is read at the
 *     press, as Shift is. (In a pointer label it could not be reached on touch: a second
 *     finger cancels the drag it would be part of.)
 * Shown only while one of the three tools is active and the 3D pane is not walking.
 */
import { useEffect, useRef, useState } from "react";
import { useItemToolStore } from "@/store/itemToolStore";
import { usePlanStore } from "@/store/planStore";
import { useSelectionStore } from "@/store/selectionStore";
import { isItemTool, useToolStore } from "@/store/toolStore";
import { useViewStore } from "@/store/viewStore";

const OFFSET = 18; // px between the pointer and the label
export const STATUS_ROTATE = "Drag an imported model to turn it about its base point, or type degrees. Alt: no snapping.";
export const STATUS_SCALE = "Drag away from or towards a model's base point to scale it, or type a percentage. Alt: no snapping.";
const STATUS_DRAG = "Release to finish. Escape cancels.";

export function ItemToolOverlay() {
  const tool = useToolStore((s) => s.tool);
  const walking = useViewStore((s) => s.mode === "walk");
  const active = isItemTool(tool) && !walking;
  const drag = useItemToolStore((s) => s.drag);
  const hover = useItemToolStore((s) => s.hover);
  const typed = useItemToolStore((s) => s.typed);
  const message = useItemToolStore((s) => s.message);
  const pointer = useItemToolStore((s) => s.pointer);
  const liftMode = useItemToolStore((s) => s.liftMode);
  const hasModels = usePlanStore((s) => s.plan.items.some((i) => i.import));
  const selectedModel = useSelectionStore((s) => s.itemId);

  const root = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [active]);

  if (!active) return null;

  const lines: { id: string; text: string; tone?: "note" | "soft" }[] = [];
  const target = drag?.target ?? hover;
  if (drag?.label) {
    lines.push({ id: "distance", text: drag.label.distance });
    lines.push({ id: "value", text: drag.label.value });
    if (drag.label.note) lines.push({ id: "note", text: drag.label.note, tone: "note" });
    if (drag.kind === "move") lines.push({ id: "mode", text: drag.lift ? "Up and down" : "On the floor (Shift: up and down)", tone: "soft" });
  } else if (target) {
    const what = target.path !== null ? "part" : "model";
    lines.push({ id: "value", text: tool === "move" ? `Move this ${what}` : tool === "rotate" ? `Turn this ${what}` : `Scale this ${what}` });
  }
  if (typed !== "") lines.push({ id: "typed", text: `Typing: ${typed}`, tone: "soft" });
  if (message) lines.push({ id: "message", text: message, tone: "note" });

  const showLabel = lines.length > 0 && pointer !== null && (drag !== null || hover !== null);
  const flipX = pointer !== null && box.w > 0 && pointer.x > box.w * 0.6;
  const flipY = pointer !== null && box.h > 0 && pointer.y > box.h * 0.75;
  const kind = tool as "move" | "rotate" | "scale";
  const canType = selectedModel !== null || hover !== null || drag !== null;

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 overflow-hidden" data-testid="item-overlay">
      {showLabel && pointer && (
        <div
          role="status"
          data-testid="item-label"
          className="absolute w-max max-w-[min(18rem,calc(100%-1rem))] rounded border border-stone bg-vellum px-2.5 py-1.5 text-xs text-iron shadow"
          style={{ left: pointer.x + (flipX ? -OFFSET : OFFSET), top: pointer.y + (flipY ? -OFFSET : OFFSET), transform: `translate(${flipX ? "-100%" : "0"}, ${flipY ? "-100%" : "0"})` }}
        >
          {lines.map((l) => (
            <p key={l.id} data-testid={`item-label-${l.id}`} className={l.id === "distance" ? "text-sm font-medium" : l.tone === "note" ? "text-gilt" : l.tone === "soft" ? "text-smoke" : ""}>
              {l.text}
            </p>
          ))}
        </div>
      )}

      {kind === "move" && hasModels && (
        <div role="group" aria-label="Move imported models" className="pointer-events-auto absolute bottom-14 left-1/2 flex -translate-x-1/2 overflow-hidden rounded border border-stone bg-vellum text-xs shadow">
          {(["floor", "lift"] as const).map((m) => (
            <button
              key={m}
              type="button"
              data-testid={`item-mode-${m}`}
              aria-pressed={(m === "lift") === liftMode}
              onClick={() => useItemToolStore.getState().setLiftMode(m === "lift")}
              className={`min-h-10 px-3 ${(m === "lift") === liftMode ? "bg-cyanotype text-vellum" : "text-iron hover:bg-limestone"}`}
            >
              {m === "floor" ? "Floor" : "Lift"}
            </button>
          ))}
        </div>
      )}

      {kind !== "move" && (
        <div
          role="status"
          data-testid="item-status"
          className="pointer-events-auto absolute bottom-3 left-1/2 flex w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded border border-stone bg-vellum px-3 py-1.5 text-center text-xs text-iron shadow"
        >
          <span>{drag ? STATUS_DRAG : kind === "rotate" ? STATUS_ROTATE : STATUS_SCALE}</span>
          <label className="flex items-center gap-1.5">
            <span className="text-smoke">{kind === "rotate" ? "Turn by (°)" : "Scale to (%)"}</span>
            <input
              data-testid="item-typed-input"
              inputMode="decimal"
              disabled={!canType}
              placeholder={kind === "rotate" ? "30" : "150"}
              value={typed}
              onChange={(e) => useItemToolStore.getState().setTyped(e.target.value.slice(0, 12))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  useItemToolStore.getState().applyTyped(kind);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation(); // clears the field; the selection stays
                  useItemToolStore.getState().cancel();
                }
              }}
              className="min-h-9 w-20 rounded border border-stone bg-limestone px-2 text-iron disabled:opacity-50"
            />
          </label>
        </div>
      )}
    </div>
  );
}
