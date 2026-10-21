/*
 * src/app/not-found.tsx — the 404 page for every route (step D.1): plain words and the two ways back.
 */
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-limestone px-4 text-iron">
      <section data-testid="not-found" className="flex max-w-md flex-col items-start gap-4 rounded border border-stone bg-vellum p-6">
        <h1 className="font-display text-xl">This page doesn&apos;t exist</h1>
        <p>The link may be mistyped or out of date.</p>
        <div className="flex flex-wrap gap-4 text-sm">
          <Link href="/" className="inline-flex min-h-11 items-center underline underline-offset-4">
            Atrium home
          </Link>
          <Link href="/studio" className="inline-flex min-h-11 items-center underline underline-offset-4">
            Open the studio
          </Link>
        </div>
      </section>
    </main>
  );
}
