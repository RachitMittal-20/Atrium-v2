/*
 * src/app/page.tsx — the landing page.
 * Phase 1: the photographed tour only. The blueprint-on-a-table and
 * construction-site 3D scenes (Phase 8) will be placed before <LandingTour />.
 * The footer links to /limits (step D.1).
 */
import Link from "next/link";
import { LandingTour } from "@/components/landing/LandingTour";

export default function Home() {
  return (
    <main>
      <LandingTour />
      {/* A short resting area after the pin releases, so the last room isn't cut off abruptly. */}
      <footer className="flex h-[40svh] flex-col items-center justify-center gap-1 bg-limestone text-sm text-smoke">
        <span>Atrium, a demo by Rachit Mittal</span>
        <Link href="/limits" data-testid="limits-link" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-iron">
          What Atrium reads well, and what it doesn&apos;t
        </Link>
      </footer>
    </main>
  );
}
