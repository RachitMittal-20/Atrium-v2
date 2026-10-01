"use client";

/**
 * PushPullOverlay.tsx — what the 3D Push/Pull tool says on screen (step 4.7a):
 * a one-line status at the bottom of the 3D pane, and a label that follows the
 * pointer with the signed distance ("+0.35 m"), the resulting value ("Height
 * 3.05 m"), which pieces move ("Wall of 2 pieces" or "This piece only") and, on a
 * further line, why a limit stopped the pull. Over a face that does nothing yet
 * the label says "Not yet". Any typed distance shows in the label as it is typed,
 * and a small "123" button opens a real input for touch screens, which have no
 * keyboard to type into the canvas with.
 *
 * Rendered by Scene3D as a sibling of the focusable canvas host (like WalkOverlay),
 * so pressing its buttons is never canvas input. Shown only while the tool is
 * Push/Pull and the 3D pane is not walking. Reads src/store/pushPullStore.ts;
 * pointer events pass through it except on the "123" button and its field.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isWired, roleName, scopeLabel } from "@/lib/plan/pushpull";
import { usePushPullStore } from "@/store/pushPullStore";
import { useToolStore } from "@/store/toolStore";
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
const STATUS_PULL = "Move and click to finish, or type a distance and press Enter. Escape cancels.";

export function PushPullOverlay() {
  const pushPullTool = useToolStore((s) => s.tool === "pushpull");
  const walking = useViewStore((s) => s.mode === "walk");
  const active = pushPullTool && !walking;
  const hover = usePushPullStore((s) => s.hover);
  const pull = usePushPullStore((s) => s.pull);
  const typed = usePushPullStore((s) => s.typed);
  const message = usePushPullStore((s) => s.message);
  const pointer = usePushPullStore((s) => s.pointer);
  const fieldOpen = usePushPullStore((s) => s.fieldOpen);
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

  const result = pull?.result ?? null;
  const face = pull?.face ?? hover;
  const lines: { id: string; text: string; tone?: "note" | "soft" }[] = [];
  if (pull && result) {
    lines.push({ id: "distance", text: signed(result.distance) });
    lines.push({ id: "height", text: `Height ${result.height.toFixed(2)} m` });
    lines.push({ id: "scope", text: scopeLabel(result), tone: "soft" });
    if (result.note) lines.push({ id: "note", text: result.note, tone: "note" });
  } else if (pull) {
    lines.push({ id: "scope", text: "Move the pointer to pull", tone: "soft" });
  } else if (face) {
    lines.push({ id: "face", text: isWired(face.role) ? roleName(face.role) : `${roleName(face.role)}: Not yet` });
  }
  if (typed !== "") lines.push({ id: "typed", text: `Typing: ${typed}`, tone: "soft" });
  if (message && !(face && !isWired(face.role) && message === "Not yet")) lines.push({ id: "message", text: message, tone: "note" });

  // beside the pointer, flipped to the other side near the pane's right and bottom edges
  const showLabel = (lines.length > 0 || (coarse && pull)) && pointer !== null;
  const flipX = pointer !== null && box.w > 0 && pointer.x > box.w * 0.6;
  const flipY = pointer !== null && box.h > 0 && pointer.y > box.h * 0.75;

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 overflow-hidden" data-testid="pushpull-overlay">
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
        {pull ? STATUS_PULL : STATUS_IDLE}
      </p>
    </div>
  );
}
