/**
 * src/lib/blueprint/wallMask.ts
 *
 * Stage 1 of the Blueprint to 3D pipeline: find the walls in a floor-plan
 * image. Plans draw walls as thick solid strokes and everything else
 * (text, dimension lines, furniture outlines, door arcs) as thin strokes,
 * so the trick is thickness: measure the dominant thick-stroke width, then
 * erase everything thinner (a morphological opening). What survives is the
 * wall mask. Doors and windows, drawn thin, vanish and leave gaps — which
 * is exactly how the 3D model wants them.
 */

import { BlueprintError, type PlanPixels, type WallMask } from "@/types/blueprint";
import { labelComponents, openMask } from "./grid";

/** Otsu's threshold on a 256-bin histogram: the grey level that best splits
 *  ink from paper. */
function otsu(hist: Uint32Array, total: number): number {
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let wB = 0;
  let sumB = 0;
  let best = 0;
  let bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > bestVar) {
      bestVar = v;
      best = t;
    }
  }
  return best;
}

/** 1 = ink (dark), 0 = paper. Transparent pixels count as paper. */
function binarize(pixels: PlanPixels): Uint8Array {
  const { width, height, rgba } = pixels;
  const n = width * height;
  const lum = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3];
    const l =
      a < 128
        ? 255
        : Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]);
    lum[i] = l;
    hist[l]++;
  }
  // Clamped so a nearly blank or very low-contrast image cannot pick a
  // silly threshold.
  const t = Math.min(170, Math.max(70, otsu(hist, n)));
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = lum[i] <= t ? 1 : 0;
  return out;
}

/** Ink "mass" by run length: hist[L] = pixels lying in horizontal or
 *  vertical runs of length L (runs longer than the cap are pooled). The
 *  peak among thick lengths is the wall thickness. */
function runMassHistogram(ink: Uint8Array, w: number, h: number, cap: number): Float64Array {
  const hist = new Float64Array(cap + 1);
  const flush = (len: number) => {
    if (len > 0) hist[Math.min(len, cap)] += len;
  };
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x < w; x++) {
      if (ink[y * w + x]) run++;
      else { flush(run); run = 0; }
    }
    flush(run);
  }
  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = 0; y < h; y++) {
      if (ink[y * w + x]) run++;
      else { flush(run); run = 0; }
    }
    flush(run);
  }
  return hist;
}

/** Finds the walls of a floor-plan image as a binary mask. */
export function extractWalls(pixels: PlanPixels): WallMask {
  const { width, height } = pixels;
  const ink = binarize(pixels);

  const cap = Math.max(6, Math.floor(Math.min(width, height) / 8));
  const hist = runMassHistogram(ink, width, height, cap);
  let total = 0;
  for (let l = 1; l <= cap; l++) total += hist[l];

  // Peak mass among lengths that can be walls (>= 4 px), ignoring the
  // pooled last bin unless nothing else stands out.
  let mode = 0;
  let best = 0;
  let thick = 0;
  for (let l = 4; l < cap; l++) {
    thick += hist[l];
    if (hist[l] > best) { best = hist[l]; mode = l; }
  }
  if (mode === 0 || total === 0 || thick / total < 0.05) {
    throw new BlueprintError(
      "Couldn't find solid walls in this image. Use a plan where walls are drawn as thick dark lines, or try the manual option.",
    );
  }

  const k = Math.max(3, Math.round(0.3 * mode)) | 1;
  const opened = openMask(ink, width, height, k);

  // Drop specks and short stubs: real wall pieces span several wall widths.
  const comps = labelComponents(opened, width, height);
  const mask = new Uint8Array(opened.length);
  let kept = 0;
  for (let i = 0; i < opened.length; i++) {
    const id = comps.labels[i];
    if (!id) continue;
    const [x0, y0, x1, y1] = comps.bbox[id];
    if (Math.max(x1 - x0, y1 - y0) >= 3 * mode) { mask[i] = 1; kept++; }
  }
  if (kept < 20 * mode) {
    throw new BlueprintError("The walls in this image are too faint or too small to read. Try a larger, higher-contrast image.");
  }
  return { width, height, mask, wallThickness: mode };
}
