/*
 * src/app/limits/page.tsx — /limits (step D.1): in plain words, what Atrium reads well, what it does not,
 * what is a default, how exact the numbers are, what "Not usable" means and where files go (nowhere).
 * Static server page, linked from the landing footer (src/app/page.tsx) and the import screen header
 * (src/app/studio/import/page.tsx). The wording says how little real-world testing there has been, on purpose:
 * keep it true when the reader changes (docs/HANDOFF.md section 35 lists what was and was not tested).
 */
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Limits",
  description: "What Atrium reads well from a floor plan, what it does not, and where your files go.",
};

const H2 = "font-display mt-10 text-xl";
const UL = "mt-3 flex list-disc flex-col gap-2 pl-5";

export default function Limits() {
  return (
    <main className="min-h-svh bg-limestone px-4 py-10 text-iron sm:px-6">
      <article className="mx-auto max-w-2xl">
        <nav aria-label="Pages" className="mb-8 flex flex-wrap gap-x-4 text-sm text-smoke">
          <Link href="/" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-iron">
            Atrium home
          </Link>
          <Link href="/studio/import" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-iron">
            Import a floor plan
          </Link>
        </nav>

        <h1 className="font-display text-2xl sm:text-3xl">What Atrium reads well, and what it doesn&apos;t</h1>
        <p className="mt-4">
          Atrium turns a floor plan into a model you can edit and walk through. It is a demo, and it reads some drawings much better than others. This page says which, so you know what to expect before you try your own plan.
        </p>
        <p className="mt-3 rounded border border-gilt/60 bg-vellum p-4" data-testid="limits-tested">
          <strong className="font-medium">How much it has been tested:</strong> the reader has been tested on synthetic drawings and a few real plans, not on a wide range of real CAD files. Expect surprises, and please use &ldquo;Report a problem&rdquo; when you meet one.
        </p>

        <h2 className={H2}>What reads well</h2>
        <ul className={UL}>
          <li>
            <strong className="font-medium">Vector PDFs with printed dimensions.</strong> A PDF exported from drawing software, where the walls are real lines and the sizes are printed text. Atrium takes the walls from the lines and the scale from the printed dimensions, and then checks the model against those same dimensions.
          </li>
          <li>
            <strong className="font-medium">Clean images.</strong> A straight-on scan or screenshot with dark walls on a light page, and a printed scale or room sizes it can read.
          </li>
          <li>Straight walls that run square to the page, with doors and windows drawn the usual way: a door with its swing arc, a window with its glazing lines.</li>
        </ul>

        <h2 className={H2}>What does not</h2>
        <ul className={UL}>
          <li>
            <strong className="font-medium">Scans and photos with no dimensions.</strong> With nothing to measure from, Atrium cannot know the scale. You can set it yourself by typing the length of one wall, and every size is then only as good as that one number.
          </li>
          <li>
            <strong className="font-medium">Diagonal and curved walls.</strong> They are mostly missed or only roughly traced. Openings in them are not read.
          </li>
          <li>
            <strong className="font-medium">Doors and windows that are not drawn clearly.</strong> A gap with no swing or glazing becomes a door by default. Sliding, bi-fold, pocket, revolving and arched doors can be missed or read as something else, and so can a double door drawn in thin lines.
          </li>
          <li>Furniture, stairs and hatching drawn as lines can be mistaken for walls. The review lists what it left out, but it can be wrong.</li>
          <li>One floor at a time: a PDF with several floors is read one page at a time.</li>
        </ul>

        <h2 className={H2}>Heights are defaults</h2>
        <p className="mt-3">
          A floor plan has no heights. Walls are 2.7 m high, doors 2.1 m and windows 1.2 m on a 0.9 m sill until you change them in the studio. Doors and windows read from a PDF say &ldquo;Default height&rdquo; there until you do.
        </p>

        <h2 className={H2}>Measurements are only as exact as the drawing</h2>
        <p className="mt-3">
          From a vector PDF, walls are placed from the drawing&apos;s own lines. From an image they are traced to about one pixel, and the studio marks those walls &ldquo;Traced, approximate&rdquo;. If the drawing is wrong, or was shrunk to fit the paper, the model is wrong in the same way. The review compares the model with every printed dimension it could match, so you can see where they disagree before you build.
        </p>

        <h2 className={H2}>The verdict can say &ldquo;Not usable&rdquo;</h2>
        <p className="mt-3">
          Before you build, the review judges the plan it would make: Good, Check or Not usable, with the reasons (for example, walls that form separate pieces, loose wall ends, or no closed room). Not usable means you would mostly have to redraw the plan, so Atrium asks twice before building it. It is a rule of thumb, not a guarantee in either direction.
        </p>

        <h2 className={H2}>Your files never leave your browser</h2>
        <p className="mt-3">
          Reading, building and editing all happen on your device. A plan, a PDF or a 3D model is not uploaded anywhere, and there are no accounts. Your plan is saved in this browser&apos;s own storage, so clearing site data removes it: use Save project in the studio to keep a copy as a file. Atrium asks no other website for anything while you use it. &ldquo;Report a problem&rdquo; sends nothing either: it shows you a short text to copy or download, and it holds no part of your file.
        </p>

        <p className="mt-10 text-sm text-smoke">
          <Link href="/studio/import" className="underline underline-offset-4 hover:text-iron">
            Try it with a sample plan
          </Link>
        </p>
      </article>
    </main>
  );
}
