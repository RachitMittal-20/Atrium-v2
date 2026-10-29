/**
 * BlueprintScene.tsx — the first screen of the landing page (step 8.1; a whole story since step H.2): the studio's REAL
 * sample plan drawn as a cyanotype sheet under the headline "From one drawing, a whole house". Scrolling raises the plan's
 * walls out of the sheet as glowing lines, a scan band turns them solid, the house is finished and dressed, the camera
 * circles it and walks in at the front door, and the stage fades onto the photo tour's lobby (LandingTour) beneath.
 *
 * How it scrolls. The section is 800svh tall and its full-screen stage is CSS-sticky inside it, so the stage holds
 * still for seven screens of scrolling. The section's bottom overlaps the tour by 100svh (negative margin), so the
 * tour's own pin starts at exactly the scroll where this stage stops sticking. One GSAP timeline, scrubbed by
 * ScrollTrigger (which reads Lenis through SmoothScrollProvider), runs over those seven screens:
 *   0 → 1                `progress.p` (the story's scroll), which the 3D canvas turns into its phases and its camera
 *                        (marks in src/lib/landing/timeline.ts: build, scan, finish, tour, enter);
 *   SCAN_START → SCAN_END   the headline fades away (the camera kept the model below it during the build);
 *   TOUR_START → TOUR_END   a one-line caption at the bottom while the camera circles the house;
 *   LIGHT_START → LIGHT_END   daylight (a vellum wash) fills the view as the camera crosses the threshold;
 *   FADE_START → FADE_END   the stage, wash and all, dissolves onto the lobby, which ends pinned where the stage was.
 * The stage is transparent (and hidden from pointers) by the time it unsticks, so nothing ever slides over the tour.
 *
 * Three modes, chosen in the browser (`data-mode`):
 *   "3d"      WebGL and motion allowed: BlueprintCanvas, loaded lazily (next/dynamic, no SSR), so three.js and
 *             react-three-fiber are never in the landing page's first-load JavaScript. Until its first frame is
 *             drawn the server-rendered sheet shows, and the canvas then fades in over the same drawing.
 *   "static"  prefers-reduced-motion, or no WebGL: no canvas and no three.js at all, and the short 300svh section of
 *             step 8.1 (STATIC_MARKS; reduced motion gets it from CSS before any script). A two-step crossfade between
 *             the server-rendered sheet and the server-rendered end state at the middle of the build, and the same
 *             hand-over as a step at FADE_START. Nothing moves.
 *   "pending" the server's render and hydration, before the browser has been asked: the sheet alone.
 *
 * `sheet` and `endState` are server components (BlueprintDrawings.tsx), passed in by src/app/page.tsx, so their
 * drawing code stays on the server. Test hooks are plain attributes, never window globals: data-mode, data-ready
 * (the canvas has drawn the sheet), data-step (static mode), data-renders (frames the canvas has drawn),
 * data-build-end and data-fade-start.
 *
 * Step L.2. The preloader (the wordmark and a thin bar, fixed over the page, so nothing moves when it goes) covers the
 * page only while the 3D canvas is getting ready: it goes when the canvas has drawn the sheet, or PRELOADER_MAX_MS after
 * navigation started, or at once when the scene is static (reduced motion hides it in CSS before any script runs) or the
 * canvas fails to load; and a CSS animation (globals.css, .preloader) hides it after the same time even if no script
 * runs at all. It never takes a pointer. A canvas that fails to load or start is caught here (CanvasBoundary) and the
 * scene falls back to the static mode, instead of the error taking the landing page down. `data-preloader` says
 * "showing", or "done:<ms>" with the time since navigation started.
 * Connects to: src/lib/landing/timeline.ts, src/components/landing/{BlueprintCanvas,BlueprintDrawings,LandingTour}.tsx,
 * src/components/motion/SmoothScrollProvider.tsx; tested by scripts/e2e-landing.ts and scripts/test-landing-scene.ts.
 */
"use client";

import { Component, useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import dynamic from "next/dynamic";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { BUILD_END, FADE_END, FADE_START, LIGHT_END, LIGHT_START, PRELOADER_MAX_MS, SCAN_END, SCAN_START, TOUR_END, TOUR_START } from "@/lib/landing/timeline"; // not blueprint.ts or story.ts: that would bring their geometry into first load

gsap.registerPlugin(ScrollTrigger, useGSAP);

const BlueprintCanvas = dynamic(() => import("./BlueprintCanvas"), { ssr: false });

type Mode = "pending" | "3d" | "static";

/** The static mode keeps step 8.1's short section (two screens of scroll, nothing moving): the sheet, then at `swap` the
 *  end-state drawing, then at `out` the hand-over. `buildEnd` is what data-build-end says there (the old build's end). */
const STATIC_MARKS = { buildEnd: 0.8, swap: 0.4, out: 0.85 };

const REDUCED = "(prefers-reduced-motion: reduce)";
let webgl: boolean | undefined;
/** Whether this browser gives a WebGL context at all; asked once, and the probe's context is released at once. */
function hasWebGL(): boolean {
  if (webgl === undefined) {
    try {
      const probe = document.createElement("canvas");
      const ctx = probe.getContext("webgl2") ?? probe.getContext("webgl");
      webgl = Boolean(ctx);
      ctx?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      webgl = false;
    }
  }
  return webgl;
}
const subscribe = (change: () => void) => {
  const m = window.matchMedia(REDUCED);
  m.addEventListener("change", change);
  return () => m.removeEventListener("change", change);
};
const browserMode = (): Mode => (window.matchMedia(REDUCED).matches || !hasWebGL() ? "static" : "3d");
const serverMode = (): Mode => "pending";

/** Catches a canvas that cannot load (a failed chunk) or start (no WebGL after all), so the page carries on as static. */
class CanvasBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function BlueprintScene({ sheet, endState }: { sheet: ReactNode; endState: ReactNode }) {
  const root = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const progress = useRef({ p: 0 }); // the hero's scroll, 0 → 1, tweened by the timeline and read by the canvas every tick (step H.2: was the build's b)
  const browser = useSyncExternalStore(subscribe, browserMode, serverMode);
  const [failed, setFailed] = useState(false);
  const mode: Mode = failed ? "static" : browser;
  const [ready, setReady] = useState(false);
  const [preloader, setPreloader] = useState<"showing" | "leaving" | "gone">("showing");
  const [step, setStep] = useState(0); // static mode: 0 the sheet, 1 the end state, 2 handed over
  // Stable, so the canvas's ticker effect is not torn down (and its frame count reset) when this re-renders.
  const onReady = useCallback(() => setReady(true), []);
  const onRender = useCallback((n: number) => root.current?.setAttribute("data-renders", String(n)), []);

  // The preloader's end: the canvas is ready, or the scene is static, or the time is up (measured from navigation start).
  useEffect(() => {
    if (preloader !== "showing" || mode === "pending") return;
    const leave = () => {
      root.current?.setAttribute("data-preloader", `done:${Math.round(performance.now())}`);
      setPreloader("leaving");
    };
    if (mode === "static" || ready) {
      leave();
      return;
    }
    const timer = setTimeout(leave, Math.max(0, PRELOADER_MAX_MS - performance.now()));
    return () => clearTimeout(timer);
  }, [mode, ready, preloader]);
  useEffect(() => {
    if (preloader !== "leaving") return;
    const timer = setTimeout(() => setPreloader("gone"), 300); // the fade-out (duration-300) has finished
    return () => clearTimeout(timer);
  }, [preloader]);

  useGSAP(
    () => {
      const trigger = { trigger: root.current, start: "top top", end: "bottom bottom" };
      if (mode === "3d") {
        gsap
          .timeline({ defaults: { ease: "none" }, scrollTrigger: { ...trigger, scrub: true } })
          .to(progress.current, { p: 1, duration: 1 }, 0)
          // The headline goes once the walls have risen; the tour's caption shows while the camera circles the house.
          .to("[data-headline]", { autoAlpha: 0, y: -16, duration: SCAN_END - SCAN_START }, SCAN_START)
          .fromTo("[data-tour-caption]", { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.04 }, TOUR_START)
          .to("[data-tour-caption]", { autoAlpha: 0, duration: 0.04 }, TOUR_END - 0.04)
          .fromTo("[data-door-light]", { autoAlpha: 0 }, { autoAlpha: 1, duration: LIGHT_END - LIGHT_START }, LIGHT_START)
          .to(stage.current, { autoAlpha: 0, duration: FADE_END - FADE_START }, FADE_START);
      } else if (mode === "static") {
        const at = (self: ScrollTrigger) => setStep(self.progress >= STATIC_MARKS.out ? 2 : self.progress >= STATIC_MARKS.swap ? 1 : 0);
        ScrollTrigger.create({ ...trigger, onUpdate: at, onRefresh: at });
      }
    },
    { scope: root, dependencies: [mode], revertOnUpdate: true },
  );

  return (
    <section
      ref={root}
      aria-label="The sample plan becomes a house"
      data-testid="blueprint-scene"
      data-mode={mode}
      data-ready={ready}
      data-step={step}
      data-preloader="showing"
      data-build-end={mode === "static" ? STATIC_MARKS.buildEnd : BUILD_END}
      data-fade-start={mode === "static" ? STATIC_MARKS.out : FADE_START}
      // Reduced motion gets the short static section from the first paint (CSS), a browser without WebGL once it is known.
      className={`relative -mb-[100svh] ${mode === "static" ? "h-[300svh]" : "h-[800svh] motion-reduce:h-[300svh]"}`}
    >
      <div
        ref={stage}
        data-testid="blueprint-stage"
        className={`sticky top-0 z-10 h-svh w-full overflow-hidden bg-iron ${mode === "static" ? `transition-[opacity,visibility] duration-500 ${step === 2 ? "invisible opacity-0" : ""}` : ""}`}
      >
        {sheet}
        {mode === "static" && (
          <div data-testid="blueprint-end" className={`absolute inset-0 bg-iron transition-opacity duration-500 ${step >= 1 ? "opacity-100" : "opacity-0"}`}>
            {endState}
          </div>
        )}
        {mode === "3d" && (
          <div data-testid="blueprint-canvas" aria-hidden className={`pointer-events-none absolute inset-0 transition-opacity duration-500 ${ready ? "opacity-100" : "opacity-0"}`}>
            <CanvasBoundary onError={() => setFailed(true)}>
              <BlueprintCanvas progress={progress} stage={stage} onReady={onReady} onRender={onRender} />
            </CanvasBoundary>
          </div>
        )}
        <div data-headline className="pointer-events-none absolute inset-x-0 top-0 px-6 pt-10 text-center text-vellum sm:pt-14">
          <h1 className="font-display text-2xl leading-tight sm:text-4xl">From one drawing, a whole house</h1>
          <p className="mx-auto mt-3 max-w-[46ch] text-base text-vellum/85 sm:text-lg">This is the studio&apos;s own sample plan. Scroll to raise its walls.</p>
        </div>
        {mode === "3d" && <div data-door-light aria-hidden className="pointer-events-none invisible absolute inset-0 bg-vellum opacity-0" />}
        {mode === "3d" && (
          <p data-tour-caption className="invisible pointer-events-none absolute inset-x-0 bottom-0 px-6 pb-12 text-center text-base text-iron opacity-0 sm:pb-16 sm:text-lg">
            Every wall, door and window came from the plan. Keep scrolling to step inside.
          </p>
        )}
      </div>
      {preloader !== "gone" && (
        <div
          data-testid="preloader"
          aria-hidden
          style={{ "--preloader-max": `${PRELOADER_MAX_MS - 250}ms` } as CSSProperties}
          className={`preloader pointer-events-none fixed inset-0 z-50 flex flex-col items-center justify-center bg-iron transition-opacity duration-300 motion-reduce:hidden ${preloader === "leaving" ? "opacity-0" : "opacity-100"}`}
        >
          <span className="font-display text-3xl text-vellum">Atrium</span>
          <div className="mt-6 h-px w-40 bg-vellum/20">
            <div className={`preloader-bar h-full bg-gilt ${preloader === "leaving" ? "is-done" : ""}`} />
          </div>
        </div>
      )}
    </section>
  );
}
