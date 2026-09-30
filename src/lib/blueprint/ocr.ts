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
// Second read of size labels: text is scaled to about this height, single line,
// and only these characters may be returned (digits, x, X, ×, quote marks,
// apostrophe, period, comma, hyphen, m and space).
const REREAD_TEXT_PX = 48;
const REREAD_MAX_SCALE = 8;
const SIZE_CHARS = "0123456789xX\u00d7'\"\u2018\u2019\u201c\u201d.,-m ";

export interface PlanOcr {
  /** Text lines good enough to be room names; what roomLabels.ts receives. */
  labels: PlanLabel[];
  /** Every word of the whole-image passes, unfiltered, in the given image's pixel space. */
  words: OcrWord[];
  /** Why OCR could not run (blocked CDN, ...), or null. `labels` and `words` are then empty. */
  error: string | null;
  /** Every second read (see ocrPlan): both readings and which one `words` kept. */
  rereads: { first: string; firstConfidence: number; second: string; secondConfidence: number; kept: "first" | "second" }[];
}

/** Crops `rect` out of `source` (the whole image when null), scales it up and
 *  encodes it as a binary greyscale PGM, a format tesseract reads in the
 *  browser and in Node. Transparent pixels become paper.
 *  Scaling is by pixel repetition by default — the sharp, blocky edges this
 *  leaves read better to OCR than a smoothed blow-up of a dozen-pixel-tall
 *  letter in a whole plan. `smooth` interpolates between pixels instead
 *  (bilinear): for the second read of one tiny label, blocks as big as the
 *  foot marks hide them, and a smooth blow-up keeps them. */
function toPgm(source: PlanPixels, rect: PixelRect | null, scale: number, smooth = false): Uint8Array {
  const x0 = rect?.x0 ?? 0;
  const y0 = rect?.y0 ?? 0;
  const w = (rect?.x1 ?? source.width) - x0;
  const h = (rect?.y1 ?? source.height) - y0;
  const ow = Math.max(1, Math.round(w * scale));
  const oh = Math.max(1, Math.round(h * scale));
  const header = new TextEncoder().encode(`P5\n${ow} ${oh}\n255\n`);
  const out = new Uint8Array(header.length + ow * oh);
  out.set(header);
  const { rgba } = source;
  /** Grey level of crop pixel (x, y), clamped to the crop. */
  const grey = (x: number, y: number) => {
    const i = ((y0 + Math.min(h - 1, Math.max(0, y))) * source.width + x0 + Math.min(w - 1, Math.max(0, x))) * 4;
    return rgba[i + 3] < 128 ? 255 : 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  };
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      let v: number;
      if (smooth) {
        // Output pixel centre in crop coordinates, then the four pixels around it.
        const sx = (x + 0.5) / scale - 0.5;
        const sy = (y + 0.5) / scale - 0.5;
        const ix = Math.floor(sx);
        const iy = Math.floor(sy);
        const fx = sx - ix;
        const fy = sy - iy;
        v = (grey(ix, iy) * (1 - fx) + grey(ix + 1, iy) * fx) * (1 - fy) + (grey(ix, iy + 1) * (1 - fx) + grey(ix + 1, iy + 1) * fx) * fy;
      } else v = grey(Math.floor(x / scale), Math.floor(y / scale));
      out[header.length + y * ow + x] = Math.round(v);
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

/** One OCR text line with its words, all in the read image's pixel space. */
interface ReadLine extends OcrWord {
  words: OcrWord[];
}

/** Text that may be a room size ("12 x 14"): digits and an x. Its whole line is read again. */
const looksLikeSize = (text: string) => /\d/.test(text) && /[xX\u00d7]/.test(text);
/** A word that may be a length ("12'6\"", "3.8m"): digits with a quote mark or an m. */
const looksLikeLength = (text: string) => /\d/.test(text) && /['"\u2018\u2019\u201c\u201d\u2032\u2033m]/.test(text);

/** Which of two readings of the same text to keep (the second read, see ocrPlan).
 *  OCR drops a small "." or "," far more often than it invents one, so when the
 *  two differ only by those marks (spacing aside) the reading with more of them
 *  wins whatever the confidences: "8.0m" beats "80m". Otherwise the one
 *  tesseract is more confident of wins; the first stands on a tie or when the
 *  second read found nothing. */
export function pickReading(first: { text: string; confidence: number }, second: { text: string; confidence: number }): "first" | "second" {
  if (!second.text) return "first";
  const bare = (t: string) => t.replace(/[.,\s]/g, "");
  const marks = (t: string) => t.match(/[.,]/g)?.length ?? 0;
  const [m1, m2] = [marks(first.text), marks(second.text)];
  if (m1 !== m2 && bare(first.text) === bare(second.text)) return m1 > m2 ? "first" : "second";
  return second.confidence > first.confidence ? "second" : "first";
}

/** Reads the plan's text: room-name lines from the whole image and again from
 *  a padded crop of each given region, and every word of the whole image.
 *  `rotatedPass` adds the words of the 90°-rotated copy (vertical text).
 *
 *  Second read: the whole-image pass is tuned for scattered text of any kind,
 *  and it often loses the small marks a dimension depends on (a foot mark read
 *  as "°", a decimal point dropped). So every line that looks like a size, and
 *  every other word that looks like a length, is read again on its own: just
 *  its box, upscaled, as a single text line, with only the characters a
 *  dimension can contain allowed (SIZE_CHARS). `pickReading` chooses between
 *  the two: the one that kept a "." or "," the other dropped, else the one
 *  tesseract is more confident of. This changes `words` only; `labels` always come
 *  from the first read, so roomLabels.ts receives what it always did.
 *
 *  Never throws — a plan with no readable text just yields empty lists, and a
 *  blocked CDN fetch yields empty lists plus `error`. */
export async function ocrPlan(pixels: PlanPixels, regions: PixelRect[], rotatedPass = true): Promise<PlanOcr> {
  try {
    const { createWorker, PSM } = await import("tesseract.js");
    const worker = await createWorker("eng");
    try {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      const rereads: PlanOcr["rereads"] = [];

      /** OCRs `rect` of `source` scaled up by `scale`; boxes come back in `source` pixels. */
      const recognise = async (source: PlanPixels, rect: PixelRect | null, scale: number, smooth = false) => {
        const ox = rect?.x0 ?? 0;
        const oy = rect?.y0 ?? 0;
        // tesseract.js takes raw image-file bytes in both environments, but its
        // types only name Buffer for that, hence the cast.
        const { data } = await worker.recognize(toPgm(source, rect, scale, smooth) as unknown as Buffer);
        const map = (it: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }): OcrWord => ({
          text: it.text.trim(),
          confidence: it.confidence,
          box: { x0: ox + it.bbox.x0 / scale, y0: oy + it.bbox.y0 / scale, x1: ox + it.bbox.x1 / scale, y1: oy + it.bbox.y1 / scale },
        });
        const lines: ReadLine[] = (data.lines ?? []).map((line) => ({ ...map(line), words: line.words.map(map).filter((w) => w.text) })).filter((line) => line.text);
        return { lines, confidence: data.confidence };
      };

      /** The second read of `first` (a line or a word): its words, or null when the first reading stands. */
      const readAgain = async (source: PlanPixels, first: OcrWord) => {
        const { box } = first;
        const h = box.y1 - box.y0;
        const pad = Math.ceil(h / 2); // tesseract reads text that touches the image edge badly
        const rect = {
          x0: Math.max(0, Math.floor(box.x0 - pad)),
          y0: Math.max(0, Math.floor(box.y0 - pad)),
          x1: Math.min(source.width, Math.ceil(box.x1 + pad)),
          y1: Math.min(source.height, Math.ceil(box.y1 + pad)),
        };
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: SIZE_CHARS });
        const page = await recognise(source, rect, Math.min(REREAD_MAX_SCALE, Math.max(1, REREAD_TEXT_PX / h)), true);
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, tessedit_char_whitelist: "" });
        const words = page.lines.flatMap((line) => line.words);
        const second = words.map((w) => w.text).join(" ");
        const kept = pickReading(first, { text: second, confidence: page.confidence });
        rereads.push({ first: first.text, firstConfidence: first.confidence, second, secondConfidence: page.confidence, kept });
        return kept === "second" ? words : null;
      };

      /** OCRs `rect` of `source` at about `targetLongSide` px; `reread` adds the second read. */
      const read = async (source: PlanPixels, rect: PixelRect | null, targetLongSide: number, reread: boolean) => {
        const w = (rect?.x1 ?? source.width) - (rect?.x0 ?? 0);
        const h = (rect?.y1 ?? source.height) - (rect?.y0 ?? 0);
        if (w < 8 || h < 8) return { lines: [], words: [] };
        const { lines } = await recognise(source, rect, Math.min(6, Math.max(1, targetLongSide / Math.max(w, h))));
        const words: OcrWord[] = [];
        for (const line of lines) {
          if (!reread) {
            words.push(...line.words);
          } else if (looksLikeSize(line.text)) {
            words.push(...((await readAgain(source, line)) ?? line.words));
          } else {
            for (const word of line.words) {
              words.push(...((looksLikeLength(word.text) ? await readAgain(source, word) : null) ?? [word]));
            }
          }
        }
        return { lines, words };
      };

      const found: PlanLabel[] = [];
      const keepLabels = (lines: OcrWord[]) => {
        for (const line of lines) {
          if (line.confidence < MIN_CONFIDENCE) continue;
          found.push({ text: line.text, x: (line.box.x0 + line.box.x1) / 2, y: (line.box.y0 + line.box.y1) / 2, confidence: line.confidence });
        }
      };

      const whole = await read(pixels, null, WHOLE_IMAGE_TARGET_PX, true);
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
          false,
        );
        keepLabels(crop.lines);
      }

      if (rotatedPass) {
        const turned = await read(rotateClockwise(pixels), null, WHOLE_IMAGE_TARGET_PX, true);
        // Undo the turn: rotated (x', y') came from (y', height - x').
        for (const { text, confidence, box } of turned.words)
          words.push({ text, confidence, vertical: true, box: { x0: box.y0, y0: pixels.height - box.x1, x1: box.y1, y1: pixels.height - box.x0 } });
      }

      return { labels: dedupe(found), words, error: null, rereads };
    } finally {
      await worker.terminate();
    }
  } catch (error) {
    console.warn("[blueprint] OCR unavailable, falling back to guessed room names", error);
    return { labels: [], words: [], error: error instanceof Error ? error.message : String(error), rereads: [] };
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
