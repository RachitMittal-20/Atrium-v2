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
 *   - parseTypedLength: what the user types for a known length, in metres;
 *   - planSize: the size of the whole plan at a given scale, for the sanity
 *     checks in ScalePanel.tsx.
 * Messages here are shown to the user as they are.
 */
import type { Analysis, Stage } from "@/lib/blueprint/analyse";
import { parseLength } from "@/lib/blueprint/scale";
import type { PlanPixels } from "@/types/blueprint";
import { MAX_PDF_BYTES, PDF_MESSAGES } from "@/lib/pdf/open";
import type { PdfInfo } from "@/types/pdf";
import type { AnalyseReply, AnalyseRequest } from "@/workers/analyse.worker";
import type { PdfReply, PdfRequest } from "@/workers/pdf.worker";

const MAX_BYTES = 25 * 1024 * 1024;
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

export async function decodeImage(blob: Blob): Promise<PlanPixels> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
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
    const finish = () => worker.terminate();
    cancel = () => {
      finish();
      reject(new Cancelled());
    };
    worker.onmessage = (e: MessageEvent<AnalyseReply>) => {
      const msg = e.data;
      if (msg.type === "progress") return onProgress(msg.stage, msg.fraction);
      finish();
      if (msg.type === "done") resolve(msg.analysis);
      else reject(new Error(msg.user ? msg.message : "Something went wrong while reading this plan. Try another image, or a cleaner scan of it."));
    };
    worker.onerror = (e) => {
      console.error("[import] analysis worker failed", e);
      finish();
      reject(new Error("Your browser couldn't start the plan reader. Reload the page and try again."));
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
  const finish = () => {
    over = true;
    worker.terminate();
  };
  worker.onmessage = (e: MessageEvent<PdfReply>) => {
    const msg = e.data;
    // pdf.js's core, imported in the worker, also posts its own handshake here: skip anything not ours.
    if (over || !msg || typeof msg !== "object" || "sourceName" in msg) return;
    if (msg.type === "pages") on.pages(msg.count, msg.listed);
    else if (msg.type === "thumb") {
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
    finish();
    on.error("Your browser couldn't start the PDF reader. Reload the page and try again.");
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
    page: (n) => worker.postMessage({ type: "page", number: n } satisfies PdfRequest),
    cancel: () => {
      finish();
      urls.forEach((u) => URL.revokeObjectURL(u));
    },
  };
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

