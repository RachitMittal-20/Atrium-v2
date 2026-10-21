/**
 * src/workers/review.worker.ts
 *
 * Step W.1: builds the import screen's review of a read vector PDF page off the main thread —
 * buildPdfPlan with its rooms, coverage and naming, the plan verdict and the model-versus-printed
 * rows (src/lib/pdf/review.ts) — and, for Build model, the same build with the printed dimensions
 * carried as takeoffs. A runaway here (an endless loop, a huge allocation in pure geometry) can
 * only stall this worker: the page's watchdog (runReview in src/app/studio/import/importFile.ts)
 * terminates it after 60 s of silence and says so in plain words, and the tab stays responsive.
 * It imports no pdf.js, so it starts quickly; the page starts one per job and it is terminated
 * when it has answered.
 *
 * Protocol (types below):
 *   in   { type: "review", request }   a ReviewRequest; the analysis without its pixel bytes
 *   out  { type: "done", review }       a PdfReview (structured-clone safe)
 *        { type: "error", message, user }  user = a BlueprintError, whose message is written for
 *                                          people; anything else is a bug, and its details go to
 *                                          the console only, never to the page
 *
 * The TEST-ONLY runaway switch that makes this worker loop forever is in src/lib/pdf/review.ts, not
 * here: Turbopack also copies every worker entry's own source verbatim into .next/static/media, so
 * a switch written in this file would ship in the production build even though its compiled branch
 * is dead code.
 */
import { reviewPdf, type PdfReview, type ReviewRequest } from "@/lib/pdf/review";
import { BlueprintError } from "@/types/blueprint";

export type ReviewWorkerRequest = { type: "review"; request: ReviewRequest };
export type ReviewWorkerReply = { type: "done"; review: PdfReview } | { type: "error"; message: string; user: boolean };

const post = (msg: ReviewWorkerReply) => self.postMessage(msg);

self.onmessage = (e: MessageEvent<ReviewWorkerRequest>) => {
  const msg = e.data;
  if (msg?.type !== "review") return;
  try {
    post({ type: "done", review: reviewPdf(msg.request) });
  } catch (err) {
    const user = err instanceof BlueprintError;
    (user ? console.warn : console.error)("[review.worker]", err); // the details to the console, never to the page
    post({ type: "error", message: user ? err.message : "", user });
  }
};
