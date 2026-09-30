/**
 * src/lib/blueprint/ocr.ts
 *
 * Reads the text printed on a floor plan with tesseract.js, for two users:
 *   - roomLabels.ts gets the room names, as text lines (`PlanLabel`), so it can
 *     use them instead of a size-based guess;
 *   - scale.ts gets every word with its box (`OcrWord`), to find the printed
 *     dimensions and work out pixels per metre.
 * Call it on the deskewed, UNFILLED image (see CLAUDE.md Conventions).
 *
 * tesseract.js is dynamically imported so it (and the language file it fetches
 * from the jsdelivr CDN on first use) never loads until a blueprint is actually
 * analysed. The same code runs in the browser and under Node: the image is
 * cropped and scaled here in plain JS and handed over as PGM bytes, so no
 * canvas is needed. Under Node the language file is cached as
 * ./eng.traineddata (git-ignored); the first run needs the network.
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
 *
 * Vertical text (dimensions written along a vertical line) is unreadable
 * upright, so the words also come from a second pass over a copy turned 90°
 * clockwise, which stands bottom-to-top text upright; those boxes are mapped
 * back and the words marked `vertical`.
 * ponytail: one rotated pass only, so vertical text written top-to-bottom is
 * not read; add a counter-clockwise pass if plans turn up that use it.
 */

import type { OcrWord, PixelRect, PlanPixels } from "@/types/blueprint";
import type { PlanLabel } from "./roomLabels";

/** Below this, a line is treated as noise rather than a room name. */
const MIN_CONFIDENCE = 55;
const WHOLE_IMAGE_TARGET_PX = 3600;
const CROP_TARGET_PX = 900;

export interface PlanOcr {
  /** Text lines good enough to be room names; what roomLabels.ts receives. */
  labels: PlanLabel[];
  /** Every word of the whole-image passes, unfiltered, in the given image's pixel space. */
  words: OcrWord[];
  /** Why OCR could not run (blocked CDN, ...), or null. `labels` and `words` are then empty. */
  error: string | null;
}

/** Crops `rect` out of `source` (the whole image when null), scales it up by
 *  pixel repetition — the sharp, blocky edges this leaves read better to OCR
 *  than a smoothed blow-up of a dozen-pixel-tall letter — and encodes it as a
 *  binary greyscale PGM, a format tesseract reads in the browser and in Node.
 *  Transparent pixels become paper. */
function toPgm(source: PlanPixels, rect: PixelRect | null, scale: number): Uint8Array {
  const x0 = rect?.x0 ?? 0;
  const y0 = rect?.y0 ?? 0;
  const w = (rect?.x1 ?? source.width) - x0;
  const h = (rect?.y1 ?? source.height) - y0;
  const ow = Math.max(1, Math.round(w * scale));
  const oh = Math.max(1, Math.round(h * scale));
  const header = new TextEncoder().encode(`P5\n${ow} ${oh}\n255\n`);
  const out = new Uint8Array(header.length + ow * oh);
  out.set(header);
  for (let y = 0; y < oh; y++) {
    const sy = y0 + Math.min(h - 1, Math.floor(y / scale));
    for (let x = 0; x < ow; x++) {
      const i = (sy * source.width + x0 + Math.min(w - 1, Math.floor(x / scale))) * 4;
      const { rgba } = source;
      out[header.length + y * ow + x] = rgba[i + 3] < 128 ? 255 : Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
    }
  }
  return out;
}

/** The image turned 90° clockwise: source (x, y) lands on (height - 1 - y, x). */
function rotateClockwise(source: PlanPixels): PlanPixels {
  const { width: w, height: h, rgba } = source;
  const out = new Uint8ClampedArray(rgba.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const from = (y * w + x) * 4;
      out.set(rgba.subarray(from, from + 4), (x * h + (h - 1 - y)) * 4);
    }
  return { width: h, height: w, rgba: out };
}

/** Reads the plan's text: room-name lines from the whole image and again from
 *  a padded crop of each given region, and every word of the whole image.
 *  `rotatedPass` adds the words of the 90°-rotated copy (vertical text).
 *  Never throws — a plan with no readable text just yields empty lists, and a
 *  blocked CDN fetch yields empty lists plus `error`. */
export async function ocrPlan(pixels: PlanPixels, regions: PixelRect[], rotatedPass = true): Promise<PlanOcr> {
  try {
    const { createWorker, PSM } = await import("tesseract.js");
    const worker = await createWorker("eng");
    try {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });

      /** OCRs `rect` of `source`; returns its lines and words with boxes back in `source` pixels. */
      const read = async (source: PlanPixels, rect: PixelRect | null, targetLongSide: number) => {
        const ox = rect?.x0 ?? 0;
        const oy = rect?.y0 ?? 0;
        const w = (rect?.x1 ?? source.width) - ox;
        const h = (rect?.y1 ?? source.height) - oy;
        if (w < 8 || h < 8) return { lines: [], words: [] };
        const scale = Math.min(6, Math.max(1, targetLongSide / Math.max(w, h)));
        // tesseract.js takes raw image-file bytes in both environments, but its
        // types only name Buffer for that, hence the cast.
        const { data } = await worker.recognize(toPgm(source, rect, scale) as unknown as Buffer);
        const map = (items: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[]): OcrWord[] =>
          items
            .map((it) => ({
              text: it.text.trim(),
              confidence: it.confidence,
              box: { x0: ox + it.bbox.x0 / scale, y0: oy + it.bbox.y0 / scale, x1: ox + it.bbox.x1 / scale, y1: oy + it.bbox.y1 / scale },
            }))
            .filter((it) => it.text);
        return { lines: map(data.lines ?? []), words: map(data.words ?? []) };
      };

      const found: PlanLabel[] = [];
      const keepLabels = (lines: OcrWord[]) => {
        for (const line of lines) {
          if (line.confidence < MIN_CONFIDENCE) continue;
          found.push({ text: line.text, x: (line.box.x0 + line.box.x1) / 2, y: (line.box.y0 + line.box.y1) / 2, confidence: line.confidence });
        }
      };

      const whole = await read(pixels, null, WHOLE_IMAGE_TARGET_PX);
      keepLabels(whole.lines);
      const words = whole.words;
      for (const rect of regions) {
        const pad = Math.round(Math.min(rect.x1 - rect.x0, rect.y1 - rect.y0) * 0.08) + 4;
        const crop = await read(
          pixels,
          {
            x0: Math.max(0, rect.x0 - pad),
            y0: Math.max(0, rect.y0 - pad),
            x1: Math.min(pixels.width, rect.x1 + pad),
            y1: Math.min(pixels.height, rect.y1 + pad),
          },
          CROP_TARGET_PX,
        );
        keepLabels(crop.lines);
      }

      if (rotatedPass) {
        const turned = await read(rotateClockwise(pixels), null, WHOLE_IMAGE_TARGET_PX);
        // Undo the turn: rotated (x', y') came from (y', height - x').
        for (const { text, confidence, box } of turned.words)
          words.push({ text, confidence, vertical: true, box: { x0: box.y0, y0: pixels.height - box.x1, x1: box.y1, y1: pixels.height - box.x0 } });
      }

      return { labels: dedupe(found), words, error: null };
    } finally {
      await worker.terminate();
    }
  } catch (error) {
    console.warn("[blueprint] OCR unavailable, falling back to guessed room names", error);
    return { labels: [], words: [], error: error instanceof Error ? error.message : String(error) };
  }
}

/** Reads every room label it can find, in the whole image and again in a
 *  padded crop of each given region. Never throws — a plan with no
 *  readable text, or a blocked CDN fetch, just yields an empty list, and
 *  the caller falls back to guessed names exactly as before OCR existed. */
export async function ocrPlanLabels(pixels: PlanPixels, regions: PixelRect[]): Promise<PlanLabel[]> {
  return (await ocrPlan(pixels, regions, false)).labels;
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
