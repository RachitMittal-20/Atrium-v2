/**
 * src/components/motion/SmoothScrollProvider.tsx
 *
 * The one animation clock for ATRIUM. Wraps the whole app (mounted once in
 * the root layout) and makes gsap.ticker the single driver of everything
 * that moves: Lenis smooth scroll, ScrollTrigger, and — in later prompts —
 * the three.js render loop. Nothing in this app should call
 * requestAnimationFrame directly; everything hangs off gsap.ticker so
 * scroll, DOM animation, and WebGL can never drift out of sync.
 *
 * Responsibilities:
 *  - register ScrollTrigger + SplitText once, app-wide
 *  - create a Lenis instance with a slow, weighted feel and drive it from
 *    gsap.ticker instead of its own rAF loop
 *  - disable GSAP's lag smoothing, since a dropped frame should skip ahead
 *    rather than cause the whole scroll to visibly jump
 *  - wire ScrollTrigger to read scroll position from Lenis via
 *    scrollerProxy, so pinning and trigger math use the smoothed value
 *  - publish normalised scroll progress (0-1) to scrollStore every frame
 *  - when the user has prefers-reduced-motion set, skip Lenis entirely and
 *    fall back to plain native scroll, still keeping scrollStore in sync
 */
"use client";

import { useEffect, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import Lenis from "lenis";
import { useScrollStore } from "@/store/scrollStore";

gsap.registerPlugin(ScrollTrigger, SplitText);

interface SmoothScrollProviderProps {
  children: ReactNode;
}

export function SmoothScrollProvider({ children }: SmoothScrollProviderProps) {
  const setProgress = useScrollStore((state) => state.setProgress);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    // Reduced motion: no Lenis, no scrollerProxy override — ScrollTrigger
    // reads the window's native scroll directly, and we just mirror it
    // into scrollStore with a plain listener.
    if (prefersReducedMotion) {
      const onNativeScroll = () => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        setProgress(max > 0 ? window.scrollY / max : 0);
      };
      onNativeScroll();
      window.addEventListener("scroll", onNativeScroll, { passive: true });
      return () => window.removeEventListener("scroll", onNativeScroll);
    }

    // A slightly slow, weighted feel: gentle lerp, smooth wheel, native
    // (non-smoothed) touch — smoothing touch scrolling tends to feel laggy
    // on trackpads and phones rather than premium.
    const lenis = new Lenis({
      lerp: 0.1,
      smoothWheel: true,
      syncTouch: false,
      autoRaf: false, // we drive raf ourselves from gsap.ticker below
    });

    // gsap.ticker reports elapsed time in seconds; Lenis expects
    // milliseconds. This is the single tick that drives scroll.
    const onTick = (time: number) => {
      lenis.raf(time * 1000);
    };
    gsap.ticker.add(onTick);

    // A dropped frame should skip ahead, not cause a visible catch-up jump.
    gsap.ticker.lagSmoothing(0);

    // Every Lenis scroll: recompute ScrollTrigger positions and publish
    // normalised progress for any component (eventually the 3D scene) that
    // wants scroll position without its own scroll listener.
    const onLenisScroll = () => {
      ScrollTrigger.update();
      setProgress(lenis.progress);
    };
    lenis.on("scroll", onLenisScroll);

    // ScrollTrigger normally reads window.scrollY; this makes it read (and
    // seek) through Lenis instead, so pinning and trigger math stay
    // correct against the smoothed scroll position rather than the raw one.
    ScrollTrigger.scrollerProxy(document.body, {
      scrollTop(value) {
        if (value !== undefined) {
          lenis.scrollTo(value, { immediate: true });
        }
        return lenis.scroll;
      },
      getBoundingClientRect() {
        return { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
      },
    });

    ScrollTrigger.refresh();

    return () => {
      gsap.ticker.remove(onTick);
      lenis.off("scroll", onLenisScroll);
      lenis.destroy();
    };
  }, [setProgress]);

  return <>{children}</>;
}
