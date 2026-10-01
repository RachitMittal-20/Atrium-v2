"use client";

/**
 * WalkOverlay.tsx — the 3D pane's own controls, top-left of the pane (not the
 * top bar, so they fit at 390 px): the Orbit | Walk toggle, and while walking a
 * one-line hint, an Exit button and, on touch screens, a joystick bottom-left
 * (move and strafe) while a drag anywhere else on the canvas looks. Also shows
 * viewStore's one-line notice ("Walk needs at least one closed room.", "A wall
 * moved onto you…") in a polite live region.
 *
 * Rendered by Scene3D as a SIBLING of the focusable canvas host, so pressing
 * these buttons never counts as walking input, and hidden with the 3D pane in
 * the 2D-only view. The joystick writes viewStore.walkJoystick, which
 * src/components/three/WalkControls.tsx reads every frame.
 */
import { useEffect, useRef, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useViewStore, walkJoystick } from "@/store/viewStore";

const COARSE = "(any-pointer: coarse)";
const watchCoarse = (cb: () => void) => {
  const mq = window.matchMedia(COARSE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const hasTouch = () => window.matchMedia(COARSE).matches || navigator.maxTouchPoints > 0;

const BASE = 96; // px, joystick base
const TRAVEL = 36; // px the knob moves from centre at full deflection

/** Touch joystick: drag the knob; up is forward, right strafes right. Each axis -1..1. */
function Joystick() {
  const knob = useRef<HTMLDivElement>(null);
  const active = useRef<number | null>(null);
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > TRAVEL) {
      dx *= TRAVEL / d;
      dy *= TRAVEL / d;
    }
    walkJoystick.strafe = dx / TRAVEL;
    walkJoystick.forward = -dy / TRAVEL; // screen y points down
    if (knob.current) knob.current.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  const end = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== active.current) return;
    active.current = null;
    walkJoystick.forward = walkJoystick.strafe = 0;
    if (knob.current) knob.current.style.transform = "";
  };
  useEffect(() => () => void (walkJoystick.forward = walkJoystick.strafe = 0), []);

  return (
    <div
      data-testid="walk-joystick"
      aria-hidden // touch only; the keyboard has W A S D
      style={{ width: BASE, height: BASE }}
      className="absolute bottom-4 left-4 z-10 flex touch-none select-none items-center justify-center rounded-full border border-stone bg-vellum/70 shadow-sm"
      onPointerDown={(e) => {
        if (active.current !== null) return;
        active.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={(e) => e.pointerId === active.current && move(e)}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    >
      <div ref={knob} className="pointer-events-none h-11 w-11 rounded-full border border-cyanotype bg-cyanotype/80" />
    </div>
  );
}

export function WalkOverlay({ host }: { host: RefObject<HTMLDivElement | null> }) {
  const walking = useViewStore((s) => s.mode === "walk");
  const notice = useViewStore((s) => s.notice);
  const touch = useSyncExternalStore(watchCoarse, hasTouch, () => false);
  const walkButton = useRef<HTMLButtonElement>(null);

  const enter = () => {
    if (useViewStore.getState().enterWalk()) host.current?.focus({ preventScroll: true }); // the keys go to the 3D view
  };
  const exit = () => {
    useViewStore.getState().exitWalk();
    walkButton.current?.focus(); // the Exit button is gone; keep focus somewhere sensible
  };
  const toggle = (on: boolean) => `min-h-11 min-w-11 rounded-sm px-3 ${on ? "bg-cyanotype text-vellum" : "hover:bg-limestone"}`;

  return (
    <>
      <div className="pointer-events-none absolute left-2 top-2 z-10 flex max-w-[calc(100%-1rem)] flex-col items-start gap-1.5 text-sm text-iron">
        <div className="pointer-events-auto flex items-center gap-1.5">
          <div role="group" aria-label="Camera" className="flex rounded border border-stone bg-vellum p-0.5 shadow-sm">
            <button type="button" data-testid="camera-orbit" aria-pressed={!walking} onClick={() => walking && useViewStore.getState().exitWalk()} className={toggle(!walking)}>
              Orbit
            </button>
            <button ref={walkButton} type="button" data-testid="camera-walk" aria-pressed={walking} onClick={enter} className={toggle(walking)}>
              Walk
            </button>
          </div>
          {walking && (
            <button type="button" data-testid="walk-exit" onClick={exit} className="min-h-11 rounded border border-stone bg-vellum px-3 shadow-sm hover:bg-limestone">
              Exit
            </button>
          )}
        </div>
        {walking && (
          <p data-testid="walk-hud" className="rounded bg-vellum/90 px-2 py-1 text-xs shadow-sm">
            {touch ? "Drag to look. Use the joystick to move." : "Walk: W A S D to move, drag to look, Shift to run, Esc to exit"}
          </p>
        )}
        {/* Always in the DOM so screen readers announce a new notice. */}
        <p role="status" data-testid="walk-notice" className={notice ? "rounded border-l-2 border-gilt bg-vellum px-2 py-1 text-xs shadow-sm" : "sr-only"}>
          {notice}
        </p>
      </div>
      {walking && touch && <Joystick />}
    </>
  );
}
