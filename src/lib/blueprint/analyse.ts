/**
 * src/lib/blueprint/analyse.ts
 *
 * One call from image pixels to everything the review screen needs
 * (analyseBlueprint), and one call from that plus a chosen scale to a named,
 * editable Plan (buildFromAnalysis).
 *
 * analyseBlueprint runs these stages in order, reporting each to onProgress
 * before it starts and yielding a macrotask between them so a browser page can
 * repaint:
 *   1. straighten      downscale when the longer side is over maxSide (area
 *                      averaging), then deskew.ts
 *   2. find walls      hollowWalls.ts detectWalls (solid or hollow, by its own
 *                      mode rule), then vectorize.ts
 *   3. find openings   openings.ts, on the deskewed UNFILLED image
 *   4. read text       ocr.ts ocrPlan on the deskewed UNFILLED image (or the
 *                      injected `ocr`, for tests)
 *   5. work out scale  scale.ts estimateScale
 * Every coordinate it returns is in the processed (downscaled, deskewed) pixel
 * space; `pixels` is that image, for display. imageScale = processed px per
 * original px.
 *
 * Browser-safe: it takes PlanPixels and imports no sharp, canvas, fs or node:
 * module, and touches no DOM at module level (scripts/test-browser-safe.ts
 * walks its imports). tesseract.js is loaded lazily inside ocr.ts.
 *
 * Connects to: deskew.ts, hollowWalls.ts, vectorize.ts, openings.ts, ocr.ts,
 * scale.ts, toPlan.ts (buildPlan), nameRooms.ts; exercised by
 * scripts/test-analyse.ts and scripts/analyse-report.ts.
 */
import { BlueprintError, type BuildReport, type OcrWord, type OpeningCandidate, type PixelWall, type PlanPixels, type PlanScale } from "@/types/blueprint";
import type { Plan, Vec2 } from "@/types/plan";
import { deskew } from "./deskew";
import { detectWalls } from "./hollowWalls";
import { nameRooms, type NamingReport } from "./nameRooms";
import { ocrPlan, type PlanOcr } from "./ocr";
import { detectOpenings } from "./openings";
import type { PlanLabel } from "./roomLabels";
import { estimateScale, type ScaleEstimate } from "./scale";
import { buildPlan } from "./toPlan";
import { vectorize } from "./vectorize";

// Warning thresholds. PROVISIONAL: set from the 8 images in test-plans/ before
// this file was first run, not tuned on its results. They only raise a banner
// ("low-confidence"); nothing is ever blocked on them.
/** Share of the wall mask explained by the found walls (vectorize.ts coverage).
 *  The synthetic fixtures sit near 1.0; diagonal walls and clutter pull it
 *  down, and under 0.90 a visible part of the mask has no wall. */
const MIN_COVERAGE = 0.9;
/** Share of the drawing's ink the walls kept (WallMask.inkCapture). Under 0.60
 *  most of the ink is something other than wall (text, furniture, hatching, a
 *  photo), so the walls found are likely incomplete or wrong. */
const MIN_INK_CAPTURE = 0.6;
/** Longest side processed by default; larger images are area-averaged down. */
const MAX_SIDE = 2400;

export const STAGES = ["straighten", "find walls", "find openings", "read text", "work out scale"] as const;
export type Stage = (typeof STAGES)[number];

export type OcrResult = PlanOcr;

export interface AnalysisWarning {
  code: "rotated" | "hollow-mode" | "low-confidence" | "no-scale" | "check-scale" | "ocr-failed";
  message: string;
}

export interface Analysis {
  /** The processed (downscaled, deskewed) image, for display. */
  pixels: PlanPixels;
  angleDeg: number;
  /** Processed pixels per original pixel; 1 when not downscaled. */
  imageScale: number;
  mode: "solid" | "hollow";
  modeReason: string;
  walls: PixelWall[];
  openings: OpeningCandidate[];
  unpaired: Vec2[];
  words: OcrWord[];
  labels: PlanLabel[];
  scale: ScaleEstimate;
  coverage: number;
  inkCapture: number;
  /** Milliseconds per stage. */
  timings: Record<Stage, number>;
  warnings: AnalysisWarning[];
}

/** Resizes to ow × oh by area averaging: each output pixel is the mean of the
 *  source area it covers, partial pixels weighted by overlap. Separable. */
function areaResize({ width: w, height: h, rgba }: PlanPixels, ow: number, oh: number): PlanPixels {
  /** For each output index along one axis, the source indexes and their weights. */
  const taps = (n: number, m: number) =>
    Array.from({ length: m }, (_, i) => {
      const s = n / m;
      const [lo, hi] = [i * s, (i + 1) * s];
      const out: [number, number][] = [];
      for (let j = Math.floor(lo); j < Math.min(n, Math.ceil(hi)); j++) out.push([j, (Math.min(hi, j + 1) - Math.max(lo, j)) / s]);
      return out;
    });
  const tx = taps(w, ow);
  const ty = taps(h, oh);
  const mid = new Float32Array(ow * h * 4); // resized across, full height
  for (let y = 0; y < h; y++)
    for (let x = 0; x < ow; x++)
      for (const [j, k] of tx[x]) for (let c = 0; c < 4; c++) mid[(y * ow + x) * 4 + c] += rgba[(y * w + j) * 4 + c] * k;
  const out = new Uint8ClampedArray(ow * oh * 4);
  for (let y = 0; y < oh; y++)
    for (let x = 0; x < ow; x++)
      for (let c = 0; c < 4; c++) {
        let v = 0;
        for (const [j, k] of ty[y]) v += mid[(j * ow + x) * 4 + c] * k;
        out[(y * ow + x) * 4 + c] = Math.round(v);
      }
  return { width: ow, height: oh, rgba: out };
}

const nextTask = () => new Promise<void>((r) => setTimeout(r, 0));

export async function analyseBlueprint(
  input: PlanPixels,
  opts: { onProgress?: (stage: string, fraction: number) => void; ocr?: (p: PlanPixels) => Promise<OcrResult>; maxSide?: number } = {},
): Promise<Analysis> {
  const timings = {} as Record<Stage, number>;
  /** Runs one stage: report it, time it, then yield so the page can repaint. */
  const stage = async <T>(name: Stage, fn: () => T | Promise<T>): Promise<T> => {
    opts.onProgress?.(name, STAGES.indexOf(name) / STAGES.length);
    const t0 = performance.now();
    const out = await fn();
    timings[name] = performance.now() - t0;
    await nextTask();
    return out;
  };

  const { pixels, angleDeg, imageScale } = await stage("straighten", () => {
    const long = Math.max(input.width, input.height);
    const maxSide = opts.maxSide ?? MAX_SIDE;
    const f = long > maxSide ? maxSide / long : 1;
    const small = f < 1 ? areaResize(input, Math.round(input.width * f), Math.round(input.height * f)) : input;
    return { ...deskew(small), imageScale: f };
  });
  const found = await stage("find walls", () => {
    const d = detectWalls(pixels);
    return { ...d, ...vectorize(d.mask) };
  });
  const { openings, unpaired } = await stage("find openings", () => detectOpenings(found.walls, pixels));
  const ocr = await stage("read text", () => (opts.ocr ?? ((p: PlanPixels) => ocrPlan(p, [])))(pixels));
  const scale = await stage("work out scale", () => estimateScale({ words: ocr.words, walls: found.walls, pixels }));

  const warnings: AnalysisWarning[] = [];
  const { inkCapture } = found.mask;
  if (angleDeg !== 0) warnings.push({ code: "rotated", message: `The plan was straightened by ${angleDeg.toFixed(1)}°.` });
  if (found.mode === "hollow")
    warnings.push({ code: "hollow-mode", message: "Walls are drawn as outlines. Windows drawn inside those walls are not detected; add them by hand." });
  if (found.coverage < MIN_COVERAGE || inkCapture < MIN_INK_CAPTURE)
    warnings.push({
      code: "low-confidence",
      message: `The walls may be incomplete (${Math.round(found.coverage * 100)}% of the wall shapes explained, ${Math.round(inkCapture * 100)}% of the drawing kept). Check them against the image.`,
    });
  if (ocr.error) warnings.push({ code: "ocr-failed", message: `The text on the plan could not be read (${ocr.error}).` });
  if (scale.confidence === "none") warnings.push({ code: "no-scale", message: scale.reason });
  if (scale.confidence === "check") warnings.push({ code: "check-scale", message: scale.reason });

  return {
    pixels,
    angleDeg,
    imageScale,
    mode: found.mode,
    modeReason: found.reason,
    walls: found.walls,
    openings,
    unpaired,
    words: ocr.words,
    labels: ocr.labels,
    scale,
    coverage: found.coverage,
    inkCapture,
    timings,
    warnings,
  };
}

/** The Plan for an analysis at a chosen scale: buildPlan, then nameRooms, with
 *  real creation times. A scale that is not a finite positive number is
 *  refused (BlueprintError). */
export function buildFromAnalysis(
  analysis: Analysis,
  scale: PlanScale,
  edits: { removeWalls?: string[] } = {},
  name = "Imported plan",
): { plan: Plan; report: BuildReport; naming: NamingReport } {
  if (!Number.isFinite(scale.pxPerM) || scale.pxPerM <= 0)
    throw new BlueprintError(`The plan scale must be a positive number of pixels per metre, not ${scale.pxPerM}.`);
  const { width, height } = analysis.pixels;
  const built = buildPlan({ walls: analysis.walls, openings: analysis.openings, unpaired: analysis.unpaired, imageSize: { width, height }, name }, scale, edits);
  const { plan, report: naming } = nameRooms(built.plan, analysis.labels, built.report.origin, scale.pxPerM);
  const now = new Date().toISOString();
  return { plan: { ...plan, meta: { ...plan.meta, createdAt: now, updatedAt: now } }, report: built.report, naming };
}
