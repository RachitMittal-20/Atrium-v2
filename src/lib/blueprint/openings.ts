/**
 * src/lib/blueprint/openings.ts
 *
 * Finds doors and windows as gaps in the wall lines vectorize.ts found, in
 * deskewed PIXEL space (the scale is not known yet; a later stage converts to
 * metres). `pixels` must be the deskewed but UNFILLED image: the hollow-wall
 * fill paints a window's glazing line as wall (see CLAUDE.md, Conventions),
 * so windows drawn that way in a hollow plan have no gap and are not found.
 *
 * Pairing: every wall end used by only one wall (a free end) looks outward
 * along its own wall for the nearest end of another collinear wall, which may
 * itself be free (a gap mid-wall) or a joint (an opening right next to a
 * corner). Each such pair is one opening. There is no maximum gap, so two
 * free ends across a room can pair into a fake opening; the scale stage drops
 * those by real width. Free ends that pair with nothing (stubs, jambs,
 * furniture) are returned in `unpaired` for the review screen, never as
 * openings.
 *
 * Classification: a window if a thin dark line runs along at least 80% of the
 * gap's length inside the wall band (centre line ± half the thickness);
 * otherwise a door. Swing arcs are not used. A wide plain gap is still called
 * a door; the scale stage decides door versus passage by width once the scale
 * is known. Widths are the clear gap between the wall ends as drawn, so they
 * include the known jamb absorption of up to about 0.2 m, and an end snapped
 * into a T-joint can make an opening up to one wall thickness too wide.
 *
 * What counts as a dark line (LINE_DARKNESS): each 1 px step along the gap
 * is a hit when the darkness summed across the wall band, Σ (paper − pixel),
 * is at least half of one fully inked pixel, 0.5 × (paper − ink level).
 * `paper` is the median grey of that cross-section and the ink level is the
 * median grey of the pixels `binarize` calls ink. Why a sum and not the global
 * ink threshold (wallMask.ts `binarize`): a scanned 1 px line is blurred into
 * a few grey pixels that can all sit above that threshold (tests/fixtures/04's
 * right-wall window is grey 117 at its darkest, on paper 225), so the
 * threshold loses it. Blur spreads a line but keeps its total darkness, so the
 * sum survives. Half a pixel is the midpoint between "no line" and "a 1 px
 * line", the same halfway split a threshold makes between paper and ink.
 * scripts/test-openings.ts guards both sides: a noisy plain gap stays a door
 * and a blurred 1 px line is a window.
 *
 * Connects to: vectorize.ts (the PixelWall[] input); wallMask.ts (`luminance`
 * and `binarize`, so grey levels and "ink" mean the same here as everywhere
 * else); scripts/vectorize-overlay.ts and scripts/test-openings.ts, which call
 * detectOpenings; scripts/footprint.ts, which reuses `isH`.
 */
import type { OpeningCandidate, PixelWall, PlanPixels } from "@/types/blueprint";
import type { Vec2 } from "@/types/plan";
import { binarize, luminance } from "./wallMask";

/** Share of the gap's length that must hold a dark line for a window. */
const GLAZING_SHARE = 0.8;
/** Darkness a step needs across the band, in fully inked pixels (see header). */
export const LINE_DARKNESS = 0.5;

/** Dominant axis of a wall: merged joints can tilt a wall slightly. */
export const isH = (w: PixelWall) => Math.abs(w.b.x - w.a.x) >= Math.abs(w.b.y - w.a.y);

const key = (p: Vec2) => `${p.x},${p.y}`;

/** Endpoints used by only one wall, with the wall they belong to. */
function freeEnds(walls: PixelWall[]) {
  const count = new Map<string, number>();
  for (const w of walls) for (const p of [w.a, w.b]) count.set(key(p), (count.get(key(p)) ?? 0) + 1);
  return walls.flatMap((w) => [w.a, w.b].filter((p) => count.get(key(p)) === 1).map((p) => ({ p, w })));
}

/** Median grey level of the pixels `binarize` calls ink: what full ink looks
 *  like in this image. 0 when there is no ink at all. */
export function inkLevel(lum: Uint8Array, ink: Uint8Array) {
  const hist = new Uint32Array(256);
  let total = 0;
  for (let i = 0; i < lum.length; i++) if (ink[i]) (hist[lum[i]]++, total++);
  for (let l = 0, seen = 0; l < 256; l++) if ((seen += hist[l]) * 2 >= total && total) return l;
  return 0;
}

/**
 * For each 1 px step from a to b (sampled at its midpoint), the darkness
 * summed across the band (± half around the a→b line) and the darkness it
 * `needs` to count as a line: LINE_DARKNESS × (paper − ink). Exported so the
 * test can print how close a plain gap comes to the threshold.
 */
export function gapDarkness(lum: Uint8Array, ink: number, width: number, height: number, a: Vec2, b: Vec2, half: number) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.round(len));
  const [ux, uy] = [(b.x - a.x) / len, (b.y - a.y) / len];
  const r = Math.round(half);
  const steps: { darkness: number; needs: number }[] = [];
  for (let s = 0; s < n; s++) {
    const t = ((s + 0.5) / n) * len;
    const across: number[] = [];
    for (let d = -r; d <= r; d++) {
      const x = Math.round(a.x + ux * t - uy * d);
      const y = Math.round(a.y + uy * t + ux * d);
      if (x >= 0 && y >= 0 && x < width && y < height) across.push(lum[y * width + x]);
    }
    if (!across.length) {
      steps.push({ darkness: 0, needs: Infinity }); // off the image: no line
      continue;
    }
    const paper = [...across].sort((p, q) => p - q)[across.length >> 1];
    steps.push({
      darkness: across.reduce((sum, v) => sum + Math.max(0, paper - v), 0),
      needs: LINE_DARKNESS * (paper - ink),
    });
  }
  return steps;
}

export function detectOpenings(walls: PixelWall[], pixels: PlanPixels): { openings: OpeningCandidate[]; unpaired: Vec2[] } {
  const lum = luminance(pixels);
  const ink = inkLevel(lum, binarize(pixels));
  const ends = freeEnds(walls);
  const paired = new Set<string>();
  const openings: OpeningCandidate[] = [];
  for (const e of ends) {
    if (paired.has(key(e.p))) continue;
    const other = e.w.a === e.p ? e.w.b : e.w.a;
    const dir = { x: Math.sign(e.p.x - other.x), y: Math.sign(e.p.y - other.y) }; // outward from the wall
    let best: { q: Vec2; w: PixelWall } | null = null;
    let bestGap = Infinity;
    for (const w of walls) {
      if (w === e.w || isH(w) !== isH(e.w)) continue;
      for (const q of [w.a, w.b]) {
        const across = isH(e.w) ? Math.abs(e.p.y - q.y) : Math.abs(e.p.x - q.x);
        const gap = (q.x - e.p.x) * dir.x + (q.y - e.p.y) * dir.y;
        if (gap > 0 && gap < bestGap && !paired.has(key(q)) && across <= Math.max(e.w.thickness, w.thickness) / 2)
          [best, bestGap] = [{ q, w }, gap];
      }
    }
    if (!best) continue;
    paired.add(key(e.p)).add(key(best.q));
    const [a, b] = [e.p, best.q];
    const wallThicknessPx = Math.max(e.w.thickness, best.w.thickness); // the band the pairing accepted
    const steps = gapDarkness(lum, ink, pixels.width, pixels.height, a, b, wallThicknessPx / 2);
    const glazingLine = steps.filter((s) => s.darkness >= s.needs).length / steps.length >= GLAZING_SHARE;
    openings.push({
      a,
      b,
      centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      widthPx: Math.hypot(b.x - a.x, b.y - a.y),
      wallThicknessPx,
      kind: glazingLine ? "window" : "door",
      evidence: { glazingLine },
    });
  }
  return { openings, unpaired: ends.filter((e) => !paired.has(key(e.p))).map((e) => e.p) };
}
