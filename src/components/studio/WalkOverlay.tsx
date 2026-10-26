"use client";

/**
 * WalkOverlay.tsx — the 3D pane's own controls (not the top bar, so they fit at 390 px).
 * Top-left: the camera group Orbit | Top | Walk (step V.1 added Top, the bird's-eye view;
 * under the sm breakpoint the three stack in a column at the left edge, about 55 px wide, so the
 * band beside it, where the model can be, stays tappable as it was before Top), the "Walk through walls" toggle (viewStore.ghost,
 * step G.1; disabled outside walk, key G, with a status line while on; under the sm breakpoint
 * it is hidden outside walk, so a dead button never covers the model on a phone), and while
 * walking a one-line hint, an Exit button and, on touch screens, a joystick bottom-left (move
 * and strafe) while a drag anywhere else on the canvas looks. Top-right, alone: Recenter
 * (step V.1, key R, shown in every mode: orbit and Top glide to the home or top view of the
 * whole plan, walking returns to the start pose), a 44 px icon button with its name for
 * screen readers and a tooltip. The top-left column stops 4.5rem short of the right edge, so
 * a wrapped row (Exit, then Walk through walls on a phone) never runs under Recenter, and
 * nothing at the top reaches the joystick at the bottom. Also shows viewStore's one-line
 * notice ("Walk needs at least one closed room.", "A wall moved onto you…") in a polite live
 * region.
 *
 * Rendered by Scene3D as a SIBLING of the focusable canvas host, so pressing
 * these buttons never counts as walking input, and hidden with the 3D pane in
 * the 2D-only view. The joystick writes viewStore.walkJoystick, which
 * src/components/three/WalkControls.tsx reads every frame.
 */
import { useEffect, useRef, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { GHOST_STATUS, useViewStore, walkJoystick } from "@/store/viewStore";

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
  const ghost = useViewStore((s) => s.ghost);
  const top = useViewStore((s) => s.top);
  const touch = useSyncExternalStore(watchCoarse, hasTouch, () => false);
  const walkButton = useRef<HTMLButtonElement>(null);

  const enter = () => {
    if (useViewStore.getState().enterWalk()) host.current?.focus({ preventScroll: true }); // the keys go to the 3D view
  };
  const exit = () => {
    useViewStore.getState().exitWalk();
    walkButton.current?.focus(); // the Exit button is gone; keep focus somewhere sensible
  };
  const recenter = () => {
    useViewStore.getState().recenter();
    if (useViewStore.getState().mode === "walk") host.current?.focus({ preventScroll: true }); // W A S D keep working
  };
  const toggle = (on: boolean) => `min-h-11 min-w-11 rounded-sm px-2 sm:px-3 ${on ? "bg-cyanotype text-vellum" : "hover:bg-limestone"}`;

  return (
    <>
      <div className="pointer-events-none absolute left-2 top-2 z-10 flex max-w-[calc(100%-4.5rem)] flex-col items-start gap-1.5 text-sm text-iron">
        <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 max-sm:items-start">
          {/* Under sm the three buttons stack at the left edge (step V.1): in a row, Top pushed Walk 28 px further right, over
              the model beside it at 390 (e2e-import3d's lifted cube, after a small orbit, sat right there). */}
          <div role="group" aria-label="Camera" className="flex rounded border border-stone bg-vellum p-0.5 shadow-sm max-sm:flex-col">
            <button type="button" data-testid="camera-orbit" aria-pressed={!walking && !top} onClick={() => useViewStore.getState().chooseOrbit()} className={toggle(!walking && !top)}>
              Orbit
            </button>
            <button
              type="button"
              data-testid="camera-top"
              aria-pressed={!walking && top}
              title="Look down on the whole plan"
              onClick={() => useViewStore.getState().setTop(true)}
              className={toggle(!walking && top)}
            >
              Top
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
          <button
            type="button"
            data-testid="walk-ghost"
            aria-pressed={ghost}
            aria-keyshortcuts="G"
            disabled={!walking}
            title={walking ? "Walk through walls (G)" : "Walk through walls works in Walk"}
            onClick={() => {
              useViewStore.getState().setGhost(!ghost);
              host.current?.focus({ preventScroll: true }); // W A S D keep working
            }}
            // Under sm it shows only while walking: disabled, it swallowed taps on the model behind it at 390.
            className={`min-h-11 rounded border border-stone px-3 shadow-sm disabled:cursor-not-allowed disabled:bg-vellum disabled:opacity-60 ${walking ? "" : "max-sm:hidden"} ${ghost ? "bg-cyanotype text-vellum" : "bg-vellum hover:bg-limestone"}`}
          >
            Walk through walls
          </button>
        </div>
        {walking && ghost && (
          <p data-testid="walk-ghost-status" className="rounded border-l-2 border-cyanotype bg-vellum/90 px-2 py-1 text-xs shadow-sm">
            {GHOST_STATUS}
          </p>
        )}
        {walking && (
          <p data-testid="walk-hud" className="rounded bg-vellum/90 px-2 py-1 text-xs shadow-sm">
            {touch ? "Drag to look. Use the joystick to move." : "Walk: W A S D to move, drag to look, Shift to run, G to walk through walls, Esc to exit"}
          </p>
        )}
        {/* Always in the DOM so screen readers announce a new notice. */}
        <p role="status" data-testid="walk-notice" className={notice ? "rounded border-l-2 border-gilt bg-vellum px-2 py-1 text-xs shadow-sm" : "sr-only"}>
          {notice}
        </p>
      </div>
      <button
        type="button"
        data-testid="camera-recenter"
        aria-keyshortcuts="R"
        title={walking ? "Recenter: back to the start (R)" : "Recenter the view on the whole plan (R)"}
        onClick={recenter}
        className="absolute right-2 top-2 z-10 grid h-11 w-11 place-items-center rounded border border-stone bg-vellum text-iron shadow-sm hover:bg-limestone"
      >
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="5.5" />
          <circle cx="12" cy="12" r="1" />
          <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
        </svg>
        <span className="sr-only">Recenter</span>
      </button>
      {walking && touch && <Joystick />}
    </>
  );
}
