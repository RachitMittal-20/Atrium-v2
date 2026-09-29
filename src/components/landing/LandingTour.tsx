/*
 * src/components/landing/LandingTour.tsx
 *
 * The photographed half of the landing page: mansion → lobby → living →
 * dining → piano room, driven entirely by scroll.
 *
 * How it works:
 *  - One pinned, full-screen stage holds every photo stacked on top of each
 *    other (first scene at the bottom).
 *  - A single GSAP timeline is scrubbed by ScrollTrigger (which reads the
 *    Lenis-smoothed scroll set up in SmoothScrollProvider). For each next
 *    room, its layer opens from a narrow arch in the centre to full screen,
 *    echoing the arched windows in the photos, while the previous photo
 *    slowly pushes in so the move feels like walking forward.
 *  - Titles cross-fade with their rooms. The last room reveals the call to
 *    action that leads into the app (/studio).
 *  - "Step inside" on the mansion glides the scroll to the lobby reveal via
 *    scrollToOffset (Lenis), instead of jumping.
 * The blueprint and construction 3D scenes (Phase 8) will mount above this.
 */
"use client";

import { useRef } from "react";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { LANDING_SCENES } from "@/data/landingScenes";
import { scrollToOffset } from "@/store/scrollStore";

gsap.registerPlugin(ScrollTrigger, useGSAP);

// Clip shapes GSAP interpolates between. Same structure (4 insets + 4 radii)
// so the tween is smooth. Closed = a zero-height arch at the bottom centre
// (fully hidden, so rooms further down the stack never peek through); it
// grows up and outward like a doorway opening, ending as the full frame.
const ARCH_CLOSED = "inset(100% 38% 0% 38% round 40vw 40vw 0vw 0vw)";
const ARCH_OPEN = "inset(0% 0% 0% 0% round 0vw 0vw 0vw 0vw)";

export function LandingTour() {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<ScrollTrigger | null>(null);

  useGSAP(
    () => {
      const layers = gsap.utils.toArray<HTMLElement>("[data-layer]");
      const photos = gsap.utils.toArray<HTMLElement>("[data-photo]");
      const texts = gsap.utils.toArray<HTMLElement>("[data-text]");
      const steps = layers.length - 1; // number of room-to-room transitions

      // Every layer after the first starts closed; every text after the first hidden.
      gsap.set(layers.slice(1), { clipPath: ARCH_CLOSED });
      gsap.set(texts.slice(1), { autoAlpha: 0, y: 24 });

      const tl = gsap.timeline({
        defaults: { ease: "none" }, // scroll itself provides the easing feel via Lenis
        scrollTrigger: {
          trigger: root.current,
          start: "top top",
          end: `+=${steps * 140}%`, // ~1.4 screens of scrolling per room
          pin: true,
          scrub: true,
          onRefresh: (self) => (trigger.current = self),
        },
      });

      for (let i = 1; i <= steps; i++) {
        const at = i - 1; // each transition occupies one unit of timeline time
        tl.to(photos[i - 1], { scale: 1.12, duration: 1 }, at) // push into the current room
          .to(texts[i - 1], { autoAlpha: 0, y: -24, duration: 0.3 }, at)
          .to(layers[i], { clipPath: ARCH_OPEN, duration: 0.8 }, at + 0.1) // next room opens through the arch
          .fromTo(photos[i], { scale: 1.25 }, { scale: 1, duration: 0.9 }, at + 0.1)
          .to(texts[i], { autoAlpha: 1, y: 0, duration: 0.3 }, at + 0.65);
      }
    },
    { scope: root },
  );

  // Glide to the moment the lobby has fully opened (end of transition 1).
  const stepInside = () => {
    const st = trigger.current;
    if (!st) return;
    const steps = LANDING_SCENES.length - 1;
    scrollToOffset(st.start + ((st.end - st.start) * 0.9) / steps);
  };

  const last = LANDING_SCENES.length - 1;

  return (
    <section ref={root} aria-label="A walk through the house" className="relative h-svh w-full overflow-hidden bg-iron">
      {LANDING_SCENES.map((scene, i) => (
        <div key={scene.id} data-layer className="absolute inset-0 will-change-[clip-path]">
          {/* eslint-disable-next-line @next/next/no-img-element -- full-bleed scroll art; next/image adds no value under a transform */}
          <img
            data-photo
            src={scene.image}
            alt={scene.alt}
            className="h-full w-full object-cover will-change-transform"
            loading={i < 2 ? "eager" : "lazy"}
            fetchPriority={i === 0 ? "high" : "auto"}
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

          {i === 0 && (
            <button
              type="button"
              onClick={stepInside}
              className="pointer-events-auto mt-8 rounded-full border border-vellum/70 px-7 py-3 text-sm font-medium transition-colors hover:bg-vellum hover:text-iron"
            >
              Step inside
            </button>
          )}

          {i === last && (
            <Link
              href="/studio"
              className="pointer-events-auto mt-8 inline-block rounded-full bg-gilt px-8 py-3.5 text-base font-medium text-vellum transition-colors hover:bg-vellum hover:text-iron"
            >
              Upload a blueprint
            </Link>
          )}
        </div>
      ))}
    </section>
  );
}
