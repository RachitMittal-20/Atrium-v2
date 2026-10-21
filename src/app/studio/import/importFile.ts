/**
 * src/app/studio/import/importFile.ts
 *
 * The non-visual half of the import screen (page.tsx):
 *   - checkFile / decodeImage: accept PNG, JPEG or WebP up to 25 MB and turn
 *     it into PlanPixels with createImageBitmap and an OffscreenCanvas
 *     (browser only; createImageBitmap applies the photo's EXIF rotation), or
 *     a PDF up to 50 MB (isPdf);
 *   - runAnalysis: hands the pixels to src/workers/analyse.worker.ts and
 *     relays its progress; cancel() terminates the worker;
 *   - runPdf: hands a PDF's bytes to src/workers/pdf.worker.ts, which lists
 *     its pages (with thumbnails when there are several), then reads the
 *     chosen one; cancel() terminates the worker and frees the thumbnails;
 *   - runReview (step W.1): hands a read vector PDF page to src/workers/review.worker.ts, which
 *     builds the review (buildPdfPlan, the verdict, the model rows) or, for Build model, the plan
 *     with its carried takeoffs, so none of that runs on the page's main thread;
 *   - parseTypedLength: what the user types for a known length, in metres;
 *   - planSize: the size of the whole plan at a given scale, for the sanity
 *     checks in ScalePanel.tsx.
 * Messages here are shown to the user as they are.
 *
 * Every way a worker can fail reaches the page as one of those messages (step X.1):
 * an error it reports, a script error (onerror), a reply that can't be read
 * (onmessageerror), or silence: a worker that sends nothing for STALL_MS is stopped
 * and reported, so a runaway loop never leaves the page waiting forever. A worker
 * that runs out of memory takes the tab down with it before any of these can run;
 * the page reader's pixel budget and caps (src/lib/pdf/render.ts, extract.ts) are
 * what keep it from getting there.
 *
 * The review worker (step W.1) answers once, so its watchdog is shorter, REVIEW_STALL_MS (60 s),
 * and its silence ends in TOO_LONG with `stalled` set, which the page shows with "Start again".
 * Its other failures end in plain words too (`JobError`): a BlueprintError's own message, or a
 * fixed sentence for a bug, a script that won't start or a reply that can't be read; the details
 * go to the console only. The analysis and PDF workers keep STALL_MS: OCR on a big scan can be
 * silent for longer than a minute, and image input is unchanged.
 */
import type { Analysis, Stage } from "@/lib/blueprint/analyse";
import { parseLength } from "@/lib/blueprint/scale";
import type { PlanPixels } from "@/types/blueprint";
import { MAX_PDF_BYTES, PDF_MESSAGES } from "@/lib/pdf/open";
import { MAX_EDGE, overBudget, PIXEL_BUDGET } from "@/lib/pdf/render";
import type { PdfInfo } from "@/types/pdf";
import type { AnalyseReply, AnalyseRequest } from "@/workers/analyse.worker";
import type { PdfReply, PdfRequest } from "@/workers/pdf.worker";
import { slimAnalysis, type PdfReview, type ReviewRequest } from "@/lib/pdf/review";
import type { ReviewWorkerReply, ReviewWorkerRequest } from "@/workers/review.worker";

const MAX_BYTES = 25 * 1024 * 1024;
/** A worker that sends nothing for this long has stalled (step X.1). OCR on a big scan reports each stage, never minutes apart. */
export const STALL_MS = 180_000;
const STALLED = "Reading this plan stopped responding, so it was cancelled. Export just the floor plan, or a smaller sheet, and try again.";

/** Step W.1: the review worker answers once; silence this long means a runaway. */
export const REVIEW_STALL_MS = 60_000;
export const TOO_LONG = "This drawing took too long to read. Try a smaller page or export a simpler PDF.";
/** What a failed review or Build model says: always plain words; `stalled` when the watchdog stopped it. */
export class JobError extends Error {
  constructor(
    message: string,
    readonly stalled = false,
  ) {
    super(message);
  }
}

/** Calls `onStall` once if `poke` isn't called for `ms`; `stop` ends it. */
function watchdog(onStall: () => void, ms = STALL_MS) {
  let timer = setTimeout(onStall, ms);
  return {
    poke: () => {
      clearTimeout(timer);
      timer = setTimeout(onStall, ms);
    },
    stop: () => clearTimeout(timer),
  };
}
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

export const isPdf = (file: File) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

/** A message for a file we won't read, or null when it's worth decoding. */
export function checkFile(file: File): string | null {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (isPdf(file)) return file.size > MAX_PDF_BYTES ? PDF_MESSAGES.tooBig(file.size) : null;
  if (!IMAGE_TYPES.includes(file.type) && !["png", "jpg", "jpeg", "webp"].includes(ext))
    return "That file isn't a plan we can read. Upload a PDF, or a PNG, JPEG or WebP picture of your plan.";
  if (file.size > MAX_BYTES) return `That image is ${(file.size / 1024 / 1024).toFixed(0)} MB. The limit is 25 MB, so save it smaller and try again.`;
  return null;
}

/** Decodes an image, held to the pixel budget (step X.1): a bigger one is scaled down, keeping its
 *  shape, before any canvas is made. analyse.ts reads at most 2400 px a side anyway. */
export async function decodeImage(blob: Blob): Promise<PlanPixels> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
    if (overBudget(bitmap.width, bitmap.height)) {
      const f = Math.min(MAX_EDGE / Math.max(bitmap.width, bitmap.height), Math.sqrt(PIXEL_BUDGET / (bitmap.width * bitmap.height)));
      const big = bitmap;
      bitmap = await createImageBitmap(big, { resizeWidth: Math.max(1, Math.floor(big.width * f)), resizeHeight: Math.max(1, Math.floor(big.height * f)), resizeQuality: "high" });
      big.close();
    }
  } catch {
    throw new Error("That image couldn't be opened. It may be damaged, or saved in a format your browser can't read.");
  }
  const { width, height } = bitmap;
  const ctx = new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Your browser couldn't prepare the image. Try another browser.");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { width, height, rgba: ctx.getImageData(0, 0, width, height).data };
}

export const STAGE_LABELS: Record<Stage, string> = {
  straighten: "Straightening",
  "find walls": "Finding walls",
  "find openings": "Finding doors and windows",
  "read text": "Reading text",
  "work out scale": "Working out scale",
};

/** Thrown by runAnalysis' promise when the user cancelled; the page ignores it. */
export class Cancelled extends Error {}

/** Starts the worker. `pixels.rgba` is transferred, so it's unusable here afterwards. */
export function runAnalysis(pixels: PlanPixels, onProgress: (stage: Stage, fraction: number) => void): { result: Promise<Analysis>; cancel: () => void } {
  const worker = new Worker(new URL("../../../workers/analyse.worker.ts", import.meta.url), { type: "module" });
  let cancel = () => {};
  const result = new Promise<Analysis>((resolve, reject) => {
    const fail = (message: string) => {
      finish();
      reject(new Error(message));
    };
    const dog = watchdog(() => fail(STALLED));
    const finish = () => {
      dog.stop();
      worker.terminate();
    };
    cancel = () => {
      finish();
      reject(new Cancelled());
    };
    worker.onmessage = (e: MessageEvent<AnalyseReply>) => {
      dog.poke();
      const msg = e.data;
      if (msg.type === "progress") return onProgress(msg.stage, msg.fraction);
      finish();
      if (msg.type === "done") resolve(msg.analysis);
      else reject(new Error(msg.user ? msg.message : "Something went wrong while reading this plan. Try another image, or a cleaner scan of it."));
    };
    worker.onerror = (e) => {
      console.error("[import] analysis worker failed", e);
      fail("Your browser couldn't start the plan reader. Reload the page and try again.");
    };
    worker.onmessageerror = (e) => {
      console.error("[import] analysis worker's reply couldn't be read", e);
      fail("Something went wrong while reading this plan. Try another image, or a cleaner scan of it.");
    };
  });
  const request: AnalyseRequest = { type: "analyse", pixels };
  worker.postMessage(request, [pixels.rgba.buffer as ArrayBuffer]);
  return { result, cancel };
}

export type PdfPageSize = { number: number; width: number; height: number };

/** Starts the PDF worker on a file. `page(n)` reads page n (call it once the
 *  pages are listed); thumbnails arrive as object URLs, freed by cancel(). */
export function runPdf(
  file: File,
  on: {
    pages: (count: number, listed: PdfPageSize[]) => void;
    thumb: (pageNumber: number, url: string) => void;
    progress: (stage: Stage | null, fraction: number) => void;
    done: (analysis: Analysis, pdf: PdfInfo) => void;
    error: (message: string) => void;
  },
): { page: (n: number) => void; cancel: () => void } {
  const worker = new Worker(new URL("../../../workers/pdf.worker.ts", import.meta.url), { type: "module" });
  const urls: string[] = [];
  let over = false;
  // Silence counts only while the worker owes an answer: not while the page picker waits for a choice.
  let waiting = true;
  const finish = () => {
    over = true;
    dog.stop();
    worker.terminate();
  };
  const fail = (message: string) => {
    if (over) return;
    finish();
    on.error(message);
  };
  const dog = watchdog(() => waiting && fail(STALLED));
  worker.onmessage = (e: MessageEvent<PdfReply>) => {
    const msg = e.data;
    // pdf.js's core, imported in the worker, also posts its own handshake here: skip anything not ours.
    if (over || !msg || typeof msg !== "object" || "sourceName" in msg) return;
    dog.poke();
    if (msg.type === "pages") {
      waiting = msg.count === 1; // one page is read at once; several wait for the picker
      on.pages(msg.count, msg.listed);
    } else if (msg.type === "thumb") {
      const url = URL.createObjectURL(msg.blob);
      urls.push(url);
      on.thumb(msg.number, url);
    } else if (msg.type === "progress") on.progress(msg.stage, msg.fraction);
    else {
      finish();
      if (msg.type === "done") on.done(msg.analysis, msg.pdf);
      else on.error(msg.user ? msg.message : "Something went wrong while reading this PDF. Try another file, or export the plan page as an image.");
    }
  };
  worker.onerror = (e) => {
    console.error("[import] PDF worker failed", e);
    fail("Your browser couldn't start the PDF reader. Reload the page and try again.");
  };
  worker.onmessageerror = (e) => {
    console.error("[import] PDF worker's reply couldn't be read", e);
    fail("Something went wrong while reading this PDF. Try another file, or export the plan page as an image.");
  };
  file.arrayBuffer().then(
    (bytes) => {
      const request: PdfRequest = { type: "open", bytes };
      worker.postMessage(request, [bytes]);
    },
    () => {
      finish();
      on.error("That file couldn't be read. Try choosing it again.");
    },
  );
  return {
    page: (n) => {
      waiting = true;
      dog.poke();
      worker.postMessage({ type: "page", number: n } satisfies PdfRequest);
    },
    cancel: () => {
      finish();
      urls.forEach((u) => URL.revokeObjectURL(u));
    },
  };
}

/** What runReview needs of a Worker; scripts/test-review-worker.ts passes a worker thread instead. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  onmessageerror: ((e: MessageEvent) => void) | null;
}

const REVIEW_FAILED = "Something went wrong while checking this reading. Try another file, or export the plan page as an image.";

/**
 * Step W.1: builds a review (or, with `request.carry`, the Build model plan) in its own worker.
 * The promise rejects with Cancelled after cancel(), else with a JobError in plain words. The
 * analysis goes without its pixel bytes. `runaway` is the TEST-ONLY switch (src/lib/pdf/review.ts).
 */
export function runReview(request: ReviewRequest, opts: { make?: () => WorkerLike; stallMs?: number; runaway?: boolean } = {}): { result: Promise<PdfReview>; cancel: () => void } {
  const worker = opts.make ? opts.make() : (new Worker(new URL("../../../workers/review.worker.ts", import.meta.url), { type: "module" }) as WorkerLike);
  let cancel = () => {};
  const result = new Promise<PdfReview>((resolve, reject) => {
    let over = false;
    const finish = () => {
      over = true;
      dog.stop();
      worker.terminate();
    };
    const fail = (error: Error) => {
      if (over) return;
      finish();
      reject(error);
    };
    const dog = watchdog(() => fail(new JobError(TOO_LONG, true)), opts.stallMs ?? REVIEW_STALL_MS);
    cancel = () => fail(new Cancelled());
    worker.onmessage = (e: MessageEvent<ReviewWorkerReply>) => {
      const msg = e.data;
      if (over) return;
      if (msg?.type === "done") {
        finish();
        resolve(msg.review);
      } else fail(new JobError(msg?.type === "error" && msg.user && msg.message ? msg.message : REVIEW_FAILED));
    };
    worker.onerror = (e) => {
      console.error("[import] review worker failed", e);
      fail(new JobError("Your browser couldn't start the plan checker. Reload the page and try again."));
    };
    worker.onmessageerror = (e) => {
      console.error("[import] review worker's reply couldn't be read", e);
      fail(new JobError(REVIEW_FAILED));
    };
  });
  const test = process.env.NODE_ENV !== "production" && opts.runaway && { __runaway: true }; // compiled out of production
  const msg: ReviewWorkerRequest = { type: "review", request: { ...request, analysis: slimAnalysis(request.analysis), ...test } };
  worker.postMessage(msg);
  return { result, cancel };
}

// parseTypedLength lives in src/lib/units/typed.ts (it must not sit beside the Worker constructors below: see there); re-exported for the import screen and its tests.
export { parseTypedLength } from "@/lib/units/typed";

/** Width and depth in metres of the walls' extent (centre lines) at `pxPerM`. */
export function planSize(analysis: Analysis, pxPerM: number): { width: number; depth: number } {
  const xs = analysis.walls.flatMap((w) => [w.a.x, w.b.x]);
  const ys = analysis.walls.flatMap((w) => [w.a.y, w.b.y]);
  if (xs.length === 0) return { width: 0, depth: 0 };
  return { width: (Math.max(...xs) - Math.min(...xs)) / pxPerM, depth: (Math.max(...ys) - Math.min(...ys)) / pxPerM };
}

