"use client";

/*
 * src/app/studio/error.tsx — the error boundary for /studio and /studio/import (step D.1; the import page is
 * nested inside the studio segment, so one file covers both). A thrown render error shows plain words and a
 * Reload button instead of a blank page. The error's own message is NOT shown (it can be a developer's text);
 * it goes to the console for whoever has it open. Autosave stores only the Plan after 800 ms of quiet
 * (src/store/persistence.ts), so reloading brings the last saved plan back. Next 16 passes `retry`, which
 * re-fetches and re-renders the segment; Reload is the safer button here because a store may hold the bad
 * state. scripts/test-error-screen.ts renders this component with a thrown error; scripts/e2e-feedback.ts
 * breaks a real page and checks the boundary catches it.
 */
import { useEffect } from "react";

export default function StudioError({ error }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-svh items-center justify-center bg-limestone px-4 text-iron">
      <section role="alert" data-testid="error-boundary" className="flex max-w-md flex-col items-start gap-4 rounded border border-stone bg-vellum p-6">
        <h1 className="font-display text-xl">Something went wrong</h1>
        <p>Something went wrong in this page. Your plan is saved in this browser. Reload to continue.</p>
        <button type="button" data-testid="error-reload" onClick={() => window.location.reload()} className="min-h-11 rounded bg-cyanotype px-4 text-sm text-vellum">
          Reload
        </button>
      </section>
    </main>
  );
}
