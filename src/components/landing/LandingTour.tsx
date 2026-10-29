/*
 * src/components/landing/LandingTour.tsx
 *
 * The photographed half of the landing page: lobby → living → dining →
 * piano room, driven entirely by scroll (step H.2: it starts in the lobby, where
 * the hero's camera has just walked in at the front door).
 *
 * How it works:
 *  - One pinned, full-screen stage holds every photo stacked on top of each
 *    other (first scene at the bottom).
 *  - A single GSAP timeline is scrubbed by ScrollTrigger (which reads the
 *    Lenis-smoothed scroll set up in SmoothScrollProvider). Two versions of it,
 *    chosen by gsap.matchMedia (step L.2):
 *      from 640 px: for each next room, its layer opens from a narrow arch in the
 *      centre to full screen, echoing the arched windows in the photos, while
 *      the previous photo slowly pushes in so the move feels like walking forward;
 *      under 640 px (a phone), or with prefers-reduced-motion at any width (step A.1): a plain crossfade. No clip-path, no photo scaling, and the
 *      layers carry will-change: opacity (and nothing else), so each fade is a compositor blend of two layers instead of a
 *      main-thread repaint of a full-screen photo (measured: without it, 5 to 11 frames over 50 ms through the tour at
 *      390; with it 0 or 1). A faded-out layer is visibility: hidden, which GSAP's autoAlpha sets.
 *  - Titles cross-fade with their rooms. The last room reveals the call to
 *    action that leads into the app (/studio).
 *  - (Step H.2 removed "Step inside": the hero's camera now steps inside.)
 *  - Photos (step L.2): the five are 0.7 to 1.2 MB each, so only the first has a
 *    real src at load (eager, high priority). Native loading="lazy" is not enough: the tour starts one screen
 *    below the fold, which is inside the browser's lazy-load distance, so all five were fetched before the first
 *    scroll. The others hold a 1 px placeholder until `allowed` says they are near: the lobby once the tour
 *    section enters the viewport, then one room ahead of the scroll's progress.
 *    Every photo has its real width and height.
 * BlueprintScene (step 8.1) sits above this and overlaps its first screen: its pin starts exactly where the
 * blueprint stage, faded out, stops sticking. The construction scene (8.2) is deferred.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { LANDING_SCENES } from "@/data/landingScenes";

gsap.registerPlugin(ScrollTrigger, useGSAP);

// Clip shapes GSAP interpolates between. Same structure (4 insets + 4 radii)
// so the tween is smooth. Closed = a zero-height arch at the bottom centre
// (fully hidden, so rooms further down the stack never peek through); it
// grows up and outward like a doorway opening, ending as the full frame.
const ARCH_CLOSED = "inset(100% 38% 0% 38% round 40vw 40vw 0vw 0vw)";
const ARCH_OPEN = "inset(0% 0% 0% 0% round 0vw 0vw 0vw 0vw)";

/** A transparent 1 px GIF (a data: URL, so no request) standing in for a photo that is not yet near. */
const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
/** The photographs' real size, set as attributes so the browser knows their shape before they load. */
const PHOTO_W = 1600;
const PHOTO_H = 900;

export function LandingTour() {
  const root = useRef<HTMLDivElement>(null);
  const [allowed, setAllowed] = useState(1); // how many photos (from the first) may load; only ever grows
  const allow = useCallback((n: number) => setAllowed((a) => Math.max(a, Math.min(n, LANDING_SCENES.length))), []);

  // The lobby loads as soon as the tour section is a screen or less from view (it is, from the first scroll of the build).
  useEffect(() => {
    if (!root.current) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) allow(2);
    });
    io.observe(root.current);
    return () => io.disconnect();
  }, [allow]);

  useGSAP(
    () => {
      const layers = gsap.utils.toArray<HTMLElement>("[data-layer]");
      const photos = gsap.utils.toArray<HTMLElement>("[data-photo]");
      const texts = gsap.utils.toArray<HTMLElement>("[data-text]");
      const steps = layers.length - 1; // number of room-to-room transitions
      // One room ahead of the scroll: at room-to-room progress t (0 to steps), photos up to ceil(t) + 2 may load.
      const scroll = (per: number) => ({
        trigger: root.current,
        start: "top top",
        end: `+=${steps * per}%`,
        pin: true,
        scrub: true,
        onUpdate: (self: ScrollTrigger) => allow(2 + Math.ceil(self.progress * steps)),
      });

      const mm = gsap.matchMedia();

      // From 640 px: the arches, with the photo pushing in. Not under prefers-reduced-motion (step A.1): the scroll-linked
      // zoom and the growing arch are exactly the motion that setting asks to be spared, so that case takes the crossfade.
      mm.add("(min-width: 640px) and (prefers-reduced-motion: no-preference)", () => {
        // Every layer after the first starts closed; every text after the first hidden.
        gsap.set(layers.slice(1), { clipPath: ARCH_CLOSED });
        gsap.set(texts.slice(1), { autoAlpha: 0, y: 24 });

        const tl = gsap.timeline({
          defaults: { ease: "none" }, // scroll itself provides the easing feel via Lenis
          scrollTrigger: scroll(140), // ~1.4 screens of scrolling per room
        });

        for (let i = 1; i <= steps; i++) {
          const at = i - 1; // each transition occupies one unit of timeline time
          tl.to(photos[i - 1], { scale: 1.12, duration: 1 }, at) // push into the current room
            .to(texts[i - 1], { autoAlpha: 0, y: -24, duration: 0.3 }, at)
            .to(layers[i], { clipPath: ARCH_OPEN, duration: 0.8 }, at + 0.1) // next room opens through the arch
            .fromTo(photos[i], { scale: 1.25 }, { scale: 1, duration: 0.9 }, at + 0.1)
            .to(texts[i], { autoAlpha: 1, y: 0, duration: 0.3 }, at + 0.65);
        }
      });

      // Under 640 px, or with reduced motion at any width: a crossfade. Opacity only; a layer that has been covered is
      // hidden, so two are painted at most.
      mm.add("(max-width: 639px), (prefers-reduced-motion: reduce)", () => {
        gsap.set(layers.slice(1), { autoAlpha: 0 });
        gsap.set(texts.slice(1), { autoAlpha: 0 });

        const tl = gsap.timeline({ defaults: { ease: "none" }, scrollTrigger: scroll(100) });

        for (let i = 1; i <= steps; i++) {
          const at = i - 1;
          tl.to(texts[i - 1], { autoAlpha: 0, duration: 0.3 }, at)
            .to(layers[i], { autoAlpha: 1, duration: 0.6 }, at + 0.2)
            .set(layers[i - 1], { autoAlpha: 0 }, at + 0.8) // fully covered by now
            .to(texts[i], { autoAlpha: 1, duration: 0.3 }, at + 0.7);
        }
      });

      return () => mm.revert();
    },
    { scope: root, dependencies: [allow] },
  );

  const last = LANDING_SCENES.length - 1;

  return (
    <section ref={root} aria-label="A walk through the house" className="relative h-svh w-full overflow-hidden bg-iron">
      {LANDING_SCENES.map((scene, i) => (
        <div key={scene.id} data-layer className="absolute inset-0 max-sm:will-change-[opacity] sm:will-change-[clip-path]">
          {/* eslint-disable-next-line @next/next/no-img-element -- full-bleed scroll art; next/image adds no value under a transform */}
          <img
            data-photo
            src={i < allowed ? scene.image : BLANK}
            alt={scene.alt}
            width={PHOTO_W}
            height={PHOTO_H}
            className="h-full w-full object-cover sm:will-change-transform"
            // Eager once allowed (step H.2): `allowed` is the real gate; left lazy, Chromium did not fetch the living room
            // while its layer was still clipped shut, so the next room was not ready when its arch opened.
            loading={i < allowed ? "eager" : "lazy"}
            // The first photo is three screens below the hero (a drawing, not a photograph), so it must not outrank the hero's own
            // script and font on a slow link (step A.1). Still eager: it is requested at once, just after what the first screen needs.
            fetchPriority={i === 0 ? "low" : "auto"}
          />
          {/* Warm dusk wash at the bottom so white type stays readable on bright photos */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-iron/70 via-iron/10 to-transparent" />
        </div>
      ))}

      {/* Text layers sit above every photo, one per scene, cross-faded by the timeline. */}
      {LANDING_SCENES.map((scene, i) => (
        <div
          key={`${scene.id}-text`}
          data-text
          className="pointer-events-none absolute inset-x-0 bottom-0 px-6 pb-14 text-center text-vellum sm:pb-20"
        >
          <h2 className="font-display text-3xl leading-tight sm:text-5xl">{scene.title}</h2>
          <p className="mx-auto mt-3 max-w-[46ch] text-base text-vellum/85 sm:text-lg">{scene.caption}</p>

          {/* Honesty note: the photographs are AI-generated, not Atrium output. Quiet, wraps at 390 px. */}
          {i === 0 && (
            <p className="mx-auto mt-4 max-w-[40ch] text-xs text-vellum [text-shadow:0_1px_3px_rgb(0_0_0/0.7),0_0_12px_rgb(0_0_0/0.45)]">
              Illustrative photographs. Atrium makes plain walls, doors and windows from your plan, as shown in the studio.
            </p>
          )}

          {i === last && (
            <Link
              href="/studio"
              className="pointer-events-auto mt-8 inline-block rounded-full bg-gilt-ink px-8 py-3.5 text-base font-medium text-vellum transition-colors hover:bg-vellum hover:text-iron"
            >
              Upload a blueprint
            </Link>
          )}
        </div>
      ))}
    </section>
  );
}
