/**
 * mapping.ts — the affine map from an imported drawing's own units to plan metres (step M.2c).
 * Pure, no React. Plan.background.mapping is one of these (src/types/plan.ts, SVG matrix order:
 * x' = a·x + c·y + e, y' = b·x + d·y + f), captured at Build model from the SAME numbers the
 * builder used, so the drawing lands under the walls it describes:
 *
 *   - a vector PDF page built by snap.ts (buildPdfPlan): plan = pt × mPerPt − origin, with the
 *     build's own Coverage.mPerPt and Coverage.origin (the scale in use and the top-left of the
 *     final walls, in page metres). The plan's coordinates are rounded to 0.1 mm, so a PDF point
 *     lands within 0.05 mm of its plan point.
 *   - everything that went through the image pipeline (an image, a scanned PDF, a vector page
 *     with no scale): units → the original raster's pixels (× pxPerUnit: 1 for an image, the
 *     PDF's pixels per point for a page) → analyse.ts's downscale (each axis by its own rounded
 *     size ratio) → deskew.ts's rotation (the forward form of rotatePixels' inverse map, about
 *     the two canvases' centres) → buildPlan's (px − origin) / pxPerM. Every coordinate here is
 *     continuous (a pixel's centre is its index + 0.5), as vectorize.ts's are.
 *
 * Calibration multiplies every plan-space length about an origin; `scaleAbout` is the same map
 * applied after the drawing's, so calibrate.ts keeps the drawing aligned.
 * Connects to: src/types/plan.ts, src/lib/plan/calibrate.ts, src/app/studio/import/page.tsx
 * (capture), src/components/plan2d/BackgroundLayer.tsx (drawing); tested by scripts/test-background.ts.
 */
import type { Analysis } from "@/lib/blueprint/analyse";
import type { PlanScale } from "@/types/blueprint";
import type { Affine, Vec2 } from "@/types/plan";
import type { PdfInfo } from "@/types/pdf";

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export const apply = (m: Affine, p: Vec2): Vec2 => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });

/** `outer` after `inner`: p ↦ outer(inner(p)). */
export function compose(outer: Affine, inner: Affine): Affine {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

export function invert(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c;
  return { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det, e: (m.c * m.f - m.d * m.e) / det, f: (m.b * m.e - m.a * m.f) / det };
}

export const scaling = (sx: number, sy = sx): Affine => ({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });
export const translation = (x: number, y: number): Affine => ({ a: 1, b: 0, c: 0, d: 1, e: x, f: y });

/** Plan metres per drawing unit (the mapping is uniform: no drawing is stretched one way). */
export const unitScale = (m: Affine) => Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));

/** `m` followed by a scale of `factor` about `origin` in plan metres: what a recalibration does to the plan. */
export function scaleAbout(m: Affine, factor: number, origin: Vec2 = { x: 0, y: 0 }): Affine {
  return compose({ a: factor, b: 0, c: 0, d: factor, e: origin.x * (1 - factor), f: origin.y * (1 - factor) }, m);
}

/** A vector PDF page's mapping, from the build's Coverage: plan = pt × mPerPt − origin. */
export const pdfVectorMapping = (c: { mPerPt: number; origin: Vec2 }): Affine => ({ a: c.mPerPt, b: 0, c: 0, d: c.mPerPt, e: -c.origin.x, f: -c.origin.y });

/** render.ts's raster size for a page of `size` points at `pxPerPt`. */
export const rasterSize = (size: { width: number; height: number }, pxPerPt: number) => ({
  width: Math.ceil(size.width * pxPerPt - 1e-6),
  height: Math.ceil(size.height * pxPerPt - 1e-6),
});

/**
 * The mapping for anything that went through the image pipeline (header). `original` is the
 * raster analyseBlueprint was given; `processed` is Analysis.pixels' size; `origin` is the
 * build report's origin in processed pixels.
 */
export function rasterMapping(o: {
  pxPerUnit: number;
  original: { width: number; height: number };
  imageScale: number;
  angleDeg: number;
  processed: { width: number; height: number };
  origin: Vec2;
  pxPerM: number;
}): Affine {
  // analyse.ts: below the size cap the image is used as it is; above it, each side is rounded.
  const small = o.imageScale < 1 ? { width: Math.round(o.original.width * o.imageScale), height: Math.round(o.original.height * o.imageScale) } : o.original;
  let m = compose(scaling(small.width / o.original.width, small.height / o.original.height), scaling(o.pxPerUnit));
  if (o.angleDeg !== 0) {
    // deskew.ts turns the small image by -angleDeg with rotatePixels, whose inverse map is
    // src = R·(out − c_out) + c_src, R = [[cos, sin], [−sin, cos]] with cos = cos(θ), sin = sin(θ)
    // for θ = angleDeg in radians. Forward: out = Rᵀ·(src − c_src) + c_out.
    const t = (o.angleDeg * Math.PI) / 180;
    const [cos, sin] = [Math.cos(t), Math.sin(t)];
    const turn: Affine = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
    m = compose(translation(o.processed.width / 2, o.processed.height / 2), compose(turn, compose(translation(-small.width / 2, -small.height / 2), m)));
  }
  // buildPlan's (px − origin) / pxPerM. vectorize.ts already works in pixel centres (c + 0.5), so no half-pixel shift.
  return compose(scaling(1 / o.pxPerM), compose(translation(-o.origin.x, -o.origin.y), m));
}

/**
 * The mapping Build model stores (header): a vector build (snap.ts, its whole-plan fallback
 * included) carries mPerPt and origin in its Coverage; anything else went through buildPlan on
 * the image pipeline's raster — a PDF page rendered at pdf.pxPerPt, or the image as decoded
 * (`original`, its size after the photo's own rotation, as the browser shows it).
 */
export function buildMapping(
  built: { coverage?: { mPerPt: number; origin: Vec2 }; report: { origin: Vec2 } },
  analysis: Pick<Analysis, "imageScale" | "angleDeg"> & { pixels: { width: number; height: number } },
  pdf: Pick<PdfInfo, "pxPerPt" | "pageSize"> | undefined,
  scale: Pick<PlanScale, "pxPerM">,
  original: { width: number; height: number },
): Affine {
  if (built.coverage) return pdfVectorMapping(built.coverage);
  return rasterMapping({
    pxPerUnit: pdf ? pdf.pxPerPt : 1,
    original: pdf ? rasterSize(pdf.pageSize, pdf.pxPerPt) : original,
    imageScale: analysis.imageScale,
    angleDeg: analysis.angleDeg,
    processed: { width: analysis.pixels.width, height: analysis.pixels.height },
    origin: built.report.origin,
    pxPerM: scale.pxPerM,
  });
}
