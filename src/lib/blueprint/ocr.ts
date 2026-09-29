/**
 * src/lib/blueprint/ocr.ts
 *
 * Reads the room names printed on a floor plan, so roomLabels.ts can use
 * them instead of a size-based guess. Runs entirely in the browser with
 * tesseract.js, which is dynamically imported so it (and the ~4 MB
 * language file it fetches from a CDN on first use) never loads until a
 * blueprint is actually analysed.
 *
 * Plan labels are small text sitting among wall lines, doors and
 * furniture icons — exactly what a generic OCR pass reads worst. Reading
 * the whole image at once mostly returns noise (tested against a real
 * plan: confidence near zero, half the words garbled symbols). Two things
 * fix that: upscaling before OCR (text a dozen pixels tall has almost no
 * shape to recognise; text scaled up 3-5x does), and reading each
 * detected room's own small crop as well as the whole image (a label the
 * whole-image pass missed, e.g. because a nearby icon confused the page
 * layout analysis, often comes through cleanly once it's the only thing
 * being looked at).
 */

import type { PixelRect, PlanPixels } from "@/types/blueprint";
import type { PlanLabel } from "./roomLabels";

/** Below this, a line is treated as noise rather than a room name. */
const MIN_CONFIDENCE = 55;
const WHOLE_IMAGE_TARGET_PX = 3600;
const CROP_TARGET_PX = 900;

function toCanvas(pixels: PlanPixels): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels.rgba), pixels.width, pixels.height), 0, 0);
  return canvas;
}

/** Crops `rect` out of `source` (the whole rect when omitted) and scales
 *  it up with smoothing off — the sharp, blocky edges this leaves read
 *  better to OCR than a smoothed blow-up of a dozen-pixel-tall letter. */
function upscale(source: HTMLCanvasElement, rect: PixelRect | null, scale: number): HTMLCanvasElement {
  const x0 = rect?.x0 ?? 0;
  const y0 = rect?.y0 ?? 0;
  const w = (rect?.x1 ?? source.width) - x0;
  const h = (rect?.y1 ?? source.height) - y0;
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(w * scale));
  out.height = Math.max(1, Math.round(h * scale));
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, x0, y0, w, h, 0, 0, out.width, out.height);
  return out;
}

/** Reads every room label it can find, in the whole image and again in a
 *  padded crop of each given region. Never throws — a plan with no
 *  readable text, or a blocked CDN fetch, just yields an empty list, and
 *  the caller falls back to guessed names exactly as before OCR existed. */
export async function ocrPlanLabels(pixels: PlanPixels, regions: PixelRect[]): Promise<PlanLabel[]> {
  try {
    const { createWorker, PSM } = await import("tesseract.js");
    const worker = await createWorker("eng");
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const source = toCanvas(pixels);
    const found: PlanLabel[] = [];

    const read = async (rect: PixelRect | null, targetLongSide: number) => {
      const w = (rect?.x1 ?? pixels.width) - (rect?.x0 ?? 0);
      const h = (rect?.y1 ?? pixels.height) - (rect?.y0 ?? 0);
      if (w < 8 || h < 8) return;
      const scale = Math.min(6, Math.max(1, targetLongSide / Math.max(w, h)));
      const canvas = upscale(source, rect, scale);
      const { data } = await worker.recognize(canvas);
      const ox = rect?.x0 ?? 0;
      const oy = rect?.y0 ?? 0;
      for (const line of data.lines ?? []) {
        const text = line.text.trim();
        if (!text || line.confidence < MIN_CONFIDENCE) continue;
        found.push({
          text,
          x: ox + (line.bbox.x0 + line.bbox.x1) / 2 / scale,
          y: oy + (line.bbox.y0 + line.bbox.y1) / 2 / scale,
          confidence: line.confidence,
        });
      }
    };

    await read(null, WHOLE_IMAGE_TARGET_PX);
    for (const rect of regions) {
      const pad = Math.round(Math.min(rect.x1 - rect.x0, rect.y1 - rect.y0) * 0.08) + 4;
      await read(
        {
          x0: Math.max(0, rect.x0 - pad),
          y0: Math.max(0, rect.y0 - pad),
          x1: Math.min(pixels.width, rect.x1 + pad),
          y1: Math.min(pixels.height, rect.y1 + pad),
        },
        CROP_TARGET_PX,
      );
    }

    await worker.terminate();
    return dedupe(found);
  } catch (error) {
    console.warn("[blueprint] OCR unavailable, falling back to guessed room names", error);
    return [];
  }
}

/** Lowercased, letters-and-digits-only form of a label, for comparing two
 *  OCR reads of what might be the same physical text regardless of case,
 *  spacing, or punctuation differences between passes. */
function normalizeForCompare(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** True when `a` and `b` are plausibly two OCR reads of the same printed
 *  text. Tesseract's whole-image pass and a room's own tight crop scale
 *  and segment the same words differently, so a second read of one label
 *  often comes back missing a leading or trailing letter or two ("Dining
 *  Room" -> "ining Roo") rather than matching exactly -- an exact-text
 *  dedupe misses that and roomLabels.ts then treats it as a second,
 *  independent label on the room, triggering an unwanted split. Fold both
 *  strings down to bare letters/digits and treat one as a duplicate of
 *  the other once it's a long-enough contiguous fragment of it. */
function sameLabelText(a: string, b: string): boolean {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
  // Require a decent amount of overlap so short, genuinely different
  // labels (e.g. "Den" / "Ten") can't accidentally match each other.
  if (shorter.length < 4) return false;
  return longer.includes(shorter);
}

/** The whole-image pass and each region crop overlap, so the same label
 *  often comes back more than once -- sometimes read cleanly both times,
 *  sometimes garbled/truncated in one of the two reads; keep the
 *  highest-confidence reading of each cluster (same or near-same text,
 *  close together) instead of double-counting it as two labels in
 *  roomLabels.ts's split step. */
function dedupe(labels: PlanLabel[]): PlanLabel[] {
  const out: PlanLabel[] = [];
  for (const label of labels) {
    const match = out.find(
      (o) =>
        sameLabelText(o.text, label.text) &&
        Math.abs(o.x - label.x) < 40 &&
        Math.abs(o.y - label.y) < 40,
    );
    if (!match) {
      out.push(label);
      continue;
    }
    // Keep the more complete reading as the label's text (a garbled crop
    // read can score a higher confidence than a clean but merely "normal"
    // whole-image read, so confidence alone isn't a good tie-breaker for
    // which text to keep), but always keep the higher of the two
    // confidences so downstream MIN_CONFIDENCE filtering isn't affected.
    if (label.text.length > match.text.length) match.text = label.text;
    if (label.confidence > match.confidence) match.confidence = label.confidence;
  }
  return out;
}
