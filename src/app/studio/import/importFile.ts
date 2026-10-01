/**
 * src/app/studio/import/importFile.ts
 *
 * The non-visual half of the import screen (page.tsx):
 *   - checkFile / decodeImage: accept PNG, JPEG or WebP up to 25 MB and turn
 *     it into PlanPixels with createImageBitmap and an OffscreenCanvas
 *     (browser only; createImageBitmap applies the photo's EXIF rotation);
 *   - runAnalysis: hands the pixels to src/workers/analyse.worker.ts and
 *     relays its progress; cancel() terminates the worker;
 *   - parseTypedLength: what the user types for a known length, in metres;
 *   - planSize: the size of the whole plan at a given scale, for the sanity
 *     checks in ScalePanel.tsx.
 * Messages here are shown to the user as they are.
 */
import type { Analysis, Stage } from "@/lib/blueprint/analyse";
import { parseLength } from "@/lib/blueprint/scale";
import type { PlanPixels } from "@/types/blueprint";
import type { AnalyseReply, AnalyseRequest } from "@/workers/analyse.worker";

const MAX_BYTES = 25 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** A message for a file we won't read, or null when it's worth decoding. */
export function checkFile(file: File): string | null {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (file.type === "application/pdf" || ext === "pdf") return "PDFs aren't supported yet. Export the page as an image and upload that.";
  if (!IMAGE_TYPES.includes(file.type) && !["png", "jpg", "jpeg", "webp"].includes(ext))
    return "That file isn't an image we can read. Upload a PNG, JPEG or WebP picture of your plan.";
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

/** A typed length in metres: "3.8", "3.8 m", "380 cm", "12'6\"", "12 ft 6 in",
 *  "12 ft". A bare number is metres. Null when it isn't one length. */
export function parseTypedLength(raw: string): number | null {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/\s*(?:feet|foot|ft)\.?(?![a-z])/g, "'")
    .replace(/\s*(?:inches|inch|in)\.?(?![a-z])/g, '"');
  return parseLength(/^\d+(?:\.\d+)?$/.test(s) ? `${s} m` : s);
}

/** Width and depth in metres of the walls' extent (centre lines) at `pxPerM`. */
export function planSize(analysis: Analysis, pxPerM: number): { width: number; depth: number } {
  const xs = analysis.walls.flatMap((w) => [w.a.x, w.b.x]);
  const ys = analysis.walls.flatMap((w) => [w.a.y, w.b.y]);
  if (xs.length === 0) return { width: 0, depth: 0 };
  return { width: (Math.max(...xs) - Math.min(...xs)) / pxPerM, depth: (Math.max(...ys) - Math.min(...ys)) / pxPerM };
}

/** "10.2 m × 8.2 m" */
export const formatSize = ({ width, depth }: { width: number; depth: number }) => `${width.toFixed(1)} m × ${depth.toFixed(1)} m`;
