"use client";

/**
 * PushPullOverlay.tsx — what the 3D Push/Pull and Move tools say on screen (steps
 * 4.7a and 4.7b): a one-line status at the bottom of the 3D pane, a label that
 * follows the pointer, and the grabbed opening edge drawn as a 3 px blue line.
 * The label shows the signed distance ("+0.35 m"), the resulting value ("Height
 * 3.05 m", "Width 1.10 m", "Sill 0.60 m", "Centre 2.65 m from the wall start"),
 * what moves or stays ("Wall of 2 pieces", "This piece only", "Fixed: the sill")
 * and, on a further line, why a limit stopped it. Over a face that can't be pulled
 * it says why ("Not yet", "A door stays on the floor", "Wall moves arrive with the
 * side faces"). In Move a typed distance goes the way the pointer last moved, + along
 * the wall towards its end before it has moved; the label says which. Any typed
 * distance shows in the label as it is typed, and a small "123" button opens a real
 * input for touch screens, which have no keyboard to type into the canvas with.
 *
 * Rendered by Scene3D as a sibling of the focusable canvas host (like WalkOverlay),
 * so pressing its buttons is never canvas input. Shown only while a 3D tool is
 * active and the 3D pane is not walking. Reads src/store/pushPullStore.ts and the
 * plan; pointer events pass through it except on the "123" button and its field.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SCENE_COLORS } from "@/data/materials";
import { NOT_YET, roleName, scopeLabel } from "@/lib/plan/pushpull";
import { usePlanStore } from "@/store/planStore";
import { usePushPullStore } from "@/store/pushPullStore";
import { is3dTool, useToolStore } from "@/store/toolStore";
import { useViewStore } from "@/store/viewStore";

const COARSE = "(any-pointer: coarse)";
const watchCoarse = (cb: () => void) => {
  const mq = window.matchMedia(COARSE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const signed = (m: number) => `${m < 0 ? "-" : "+"}${Math.abs(m).toFixed(2)} m`;
const OFFSET = 18; // px between the pointer and the label

export const STATUS_IDLE = "Click a face to push or pull it. Type a distance and press Enter.";
export const STATUS_MOVE_IDLE = "Drag a door or window along its wall. Type a distance and press Enter.";
const STATUS_PULL = "Move and click to finish, or type a distance and press Enter. Escape cancels.";

export function PushPullOverlay() {
  const tool = useToolStore((s) => s.tool);
  const walking = useViewStore((s) => s.mode === "walk");
  const active = is3dTool(tool) && !walking;
  const moving = tool === "move";
  const hover = usePushPullStore((s) => s.hover);
  const edge = usePushPullStore((s) => s.edge);
  const pull = usePushPullStore((s) => s.pull);
  const typed = usePushPullStore((s) => s.typed);
  const message = usePushPullStore((s) => s.message);
  const pointer = usePushPullStore((s) => s.pointer);
  const fieldOpen = usePushPullStore((s) => s.fieldOpen);
  const openings = usePlanStore((s) => s.plan.openings);
  const coarse = useSyncExternalStore(watchCoarse, () => window.matchMedia(COARSE).matches || navigator.maxTouchPoints > 0, () => false);

  // the pane's size, to keep the label inside it
  const root = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [active]);

  if (!active) return null;

  const result = pull?.result ?? null; // a wall top's
  const opening = pull?.opening ?? null; // a door's or window's
  const face = pull?.face ?? hover;
  const kindOf = (id: string | null) => openings.find((o) => o.id === id)?.kind ?? "opening";
  const lines: { id: string; text: string; tone?: "note" | "soft" }[] = [];
  if (pull && result) {
    lines.push({ id: "distance", text: signed(result.distance) });
    lines.push({ id: "height", text: `Height ${result.height.toFixed(2)} m` });
    lines.push({ id: "scope", text: scopeLabel(result), tone: "soft" });
    if (result.note) lines.push({ id: "note", text: result.note, tone: "note" });
  } else if (pull && opening && !opening.refused) {
    lines.push({ id: "distance", text: signed(opening.distance) });
    lines.push({ id: "value", text: opening.value });
    lines.push({ id: "fixed", text: opening.fixed, tone: "soft" });
    if (opening.note) lines.push({ id: "note", text: opening.note, tone: "note" });
  } else if (pull) {
    lines.push({ id: "scope", text: "Move the pointer to pull", tone: "soft" });
  } else if (face && message === null) {
    lines.push({ id: "face", text: moving ? `Move this ${kindOf(face.openingId)}` : roleName(face.role) });
  } else if (face && message === NOT_YET) {
    lines.push({ id: "face", text: `${roleName(face.role)}: Not yet` });
  }
  if (moving && pull) lines.push({ id: "direction", text: pull.direction > 0 ? "Typed: towards the wall's end →" : "← Typed: towards the wall's start", tone: "soft" });
  if (typed !== "") lines.push({ id: "typed", text: `Typing: ${typed}`, tone: "soft" });
  if (message && message !== NOT_YET) lines.push({ id: "message", text: message, tone: "note" });

  // beside the pointer, flipped to the other side near the pane's right and bottom edges
  const showLabel = (lines.length > 0 || (coarse && pull)) && pointer !== null;
  const flipX = pointer !== null && box.w > 0 && pointer.x > box.w * 0.6;
  const flipY = pointer !== null && box.h > 0 && pointer.y > box.h * 0.75;

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 overflow-hidden" data-testid="pushpull-overlay">
      {edge && (
        // the grabbed edge of a door or window, 3 px wide so it can be seen even where the face itself is edge-on
        <svg className="absolute inset-0 h-full w-full" aria-hidden data-testid="pushpull-edge">
          <line x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} stroke={SCENE_COLORS.toolHighlight} strokeWidth={3} strokeLinecap="round" />
        </svg>
      )}
      {showLabel && pointer && (
        <div
          role="status"
          data-testid="pushpull-label"
          className="absolute w-max max-w-[min(18rem,calc(100%-1rem))] rounded border border-stone bg-vellum px-2.5 py-1.5 text-xs text-iron shadow"
          style={{ left: pointer.x + (flipX ? -OFFSET : OFFSET), top: pointer.y + (flipY ? -OFFSET : OFFSET), transform: `translate(${flipX ? "-100%" : "0"}, ${flipY ? "-100%" : "0"})` }}
        >
          {lines.map((l) => (
            <p key={l.id} data-testid={`pushpull-${l.id}`} className={l.id === "distance" ? "text-sm font-medium" : l.tone === "note" ? "text-gilt" : l.tone === "soft" ? "text-smoke" : ""}>
              {l.text}
            </p>
          ))}
          {coarse && pull && (
            <div className="pointer-events-auto mt-1 flex items-center gap-1.5">
              <button
                type="button"
                data-testid="pushpull-123"
                aria-expanded={fieldOpen}
                aria-label="Type a distance"
                onClick={() => usePushPullStore.getState().openField(!fieldOpen)}
                className="min-h-10 min-w-12 rounded border border-stone bg-limestone px-2 text-iron"
              >
                123
              </button>
              {fieldOpen && (
                <input
                  autoFocus
                  data-testid="pushpull-input"
                  inputMode="decimal"
                  aria-label="Distance, then Enter"
                  placeholder="0.3 or 30 cm"
                  value={typed}
                  onChange={(e) => usePushPullStore.getState().setTyped(e.target.value.slice(0, 24))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      usePushPullStore.getState().applyTyped();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      usePushPullStore.getState().cancel();
                    }
                  }}
                  className="min-h-10 w-28 rounded border border-stone bg-limestone px-2 text-iron"
                />
              )}
            </div>
          )}
        </div>
      )}
      <p
        role="status"
        data-testid="pushpull-status"
        className="absolute bottom-3 left-1/2 w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded border border-stone bg-vellum px-3 py-1.5 text-center text-xs text-iron shadow"
      >
        {pull ? STATUS_PULL : moving ? STATUS_MOVE_IDLE : STATUS_IDLE}
      </p>
    </div>
  );
}
