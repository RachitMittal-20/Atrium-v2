/*
 * src/app/page.tsx — the landing page.
 * Phase 1: the photographed tour only. The blueprint-on-a-table and
 * construction-site 3D scenes (Phase 8) will be placed before <LandingTour />.
 */
import { LandingTour } from "@/components/landing/LandingTour";

export default function Home() {
  return (
    <main>
      <LandingTour />
      {/* A short resting area after the pin releases, so the last room isn't cut off abruptly. */}
      <footer className="flex h-[40svh] items-center justify-center bg-limestone text-sm text-smoke">
        Atrium, a demo by Rachit Mittal
      </footer>
    </main>
  );
}
