/*
 * src/app/page.tsx — the landing page.
 * First the blueprint scene (step 8.1): the studio's sample plan as a cyanotype sheet that rises into 3D walls as
 * you scroll, then hands over to the photographed tour. The two still drawings are server components passed into
 * the client scene, so their maths stays on the server; the 3D canvas loads lazily inside BlueprintScene. The
 * blueprint section overlaps the tour by one screen (see BlueprintScene), and the dark ground on <main> is what
 * shows above the rising mansion during the hand-over. The footer links to /limits (step D.1).
 */
import Link from "next/link";
import { BlueprintEndState, BlueprintSheet } from "@/components/landing/BlueprintDrawings";
import { BlueprintScene } from "@/components/landing/BlueprintScene";
import { LandingTour } from "@/components/landing/LandingTour";

export default function Home() {
  return (
    <main className="bg-iron">
      <BlueprintScene sheet={<BlueprintSheet />} endState={<BlueprintEndState />} />
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
