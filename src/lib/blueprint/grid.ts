/**
 * src/lib/blueprint/grid.ts
 *
 * The small pixel-grid toolkit both blueprint stages share: morphological
 * opening (wallMask.ts uses it to delete thin lines) and connected-
 * component labelling (wallMask.ts uses it to drop stray specks, rooms.ts
 * uses it to find room cores). Pure functions over flat typed arrays —
 * no DOM, no three.js — so they run the same in the browser and in a
 * Node test. Two real callers is what justifies a shared module here
 * rather than duplicating them (see the project's "no abstraction until
 * two callers" rule).
 *
 * Every mask is a Uint8Array of 0/1, row-major (index = y * width + x).
 */

/**
 * Window sums over a k×k square centred on each pixel, computed with a
 * summed-area table so the cost is O(pixels), independent of k. The
 * window is clipped at the image border; the second array holds how many
 * in-bounds pixels each clipped window actually contains, which lets
 * erode() treat "outside the image" as filled (so a wall that runs off
 * the edge of a tightly cropped plan is not eaten away at the border).
 */
function windowSums(mask: Uint8Array, width: number, height: number, k: number): { sum: Int32Array; count: Int32Array } {
  const r = (k - 1) >> 1;
  const w1 = width + 1;
  // Summed-area table, one row/column larger than the image so lookups
  // never need a special case for the first row or column.
  const table = new Int32Array(w1 * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += mask[y * width + x];
      table[(y + 1) * w1 + (x + 1)] = table[y * w1 + (x + 1)] + rowSum;
    }
  }

  const sum = new Int32Array(width * height);
  const count = new Int32Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(height, y + r + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width, x + r + 1);
      sum[y * width + x] = table[y1 * w1 + x1] - table[y0 * w1 + x1] - table[y1 * w1 + x0] + table[y0 * w1 + x0];
      count[y * width + x] = (x1 - x0) * (y1 - y0);
    }
  }
  return { sum, count };
}

/** A pixel survives only if its whole k×k neighbourhood is set (pixels
 *  beyond the image edge count as set — see windowSums). */
function erode(mask: Uint8Array, width: number, height: number, k: number): Uint8Array {
  const { sum, count } = windowSums(mask, width, height, k);
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = sum[i] === count[i] ? 1 : 0;
  return out;
}

/** A pixel is set if anything in its k×k neighbourhood is set. */
export function dilate(mask: Uint8Array, width: number, height: number, k: number): Uint8Array {
  const { sum } = windowSums(mask, width, height, k);
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = sum[i] > 0 ? 1 : 0;
  return out;
}

/**
 * Morphological opening: erode then dilate with the same k×k square. Any
 * shape narrower than k pixels in both directions is erased entirely
 * (thin strokes, text, furniture outlines), while every shape at least k
 * pixels thick comes back exactly as it was — which is what lets a wall
 * survive and a chair outline not. `k` is forced odd so the square is
 * centred on its pixel and the opening does not shift shapes by a pixel.
 */
export function openMask(mask: Uint8Array, width: number, height: number, k: number): Uint8Array {
  const odd = k | 1;
  return dilate(erode(mask, width, height, odd), width, height, odd);
}

/** The result of labelling a mask's 4-connected regions. */
export interface Components {
  /** labels[i] = component id (1..count) for set pixels, 0 for unset. */
  labels: Int32Array;
  count: number;
  /** area[id] = pixel count; index 0 is unused so ids index directly. */
  area: number[];
  /** bbox[id] = [x0, y0, x1, y1) inclusive-exclusive, index 0 unused. */
  bbox: [number, number, number, number][];
}

/** Labels the 4-connected regions of a mask (up/down/left/right only, so
 *  two regions touching only at a corner stay separate — the safe choice
 *  for rooms, which must not "leak" diagonally through a wall corner). */
export function labelComponents(mask: Uint8Array, width: number, height: number): Components {
  const labels = new Int32Array(width * height);
  const area: number[] = [0];
  const bbox: [number, number, number, number][] = [[0, 0, 0, 0]];
  const stack = new Int32Array(width * height);
  let count = 0;

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    count++;
    let a = 0;
    let x0 = width;
    let y0 = height;
    let x1 = 0;
    let y1 = 0;
    // Iterative flood fill on an explicit stack — a recursive one would
    // overflow on a room-sized region.
    let top = 0;
    stack[top++] = start;
    labels[start] = count;
    while (top > 0) {
      const i = stack[--top];
      const x = i % width;
      const y = (i - x) / width;
      a++;
      if (x < x0) x0 = x;
      if (x + 1 > x1) x1 = x + 1;
      if (y < y0) y0 = y;
      if (y + 1 > y1) y1 = y + 1;
      if (x > 0 && mask[i - 1] && !labels[i - 1]) { labels[i - 1] = count; stack[top++] = i - 1; }
      if (x < width - 1 && mask[i + 1] && !labels[i + 1]) { labels[i + 1] = count; stack[top++] = i + 1; }
      if (y > 0 && mask[i - width] && !labels[i - width]) { labels[i - width] = count; stack[top++] = i - width; }
      if (y < height - 1 && mask[i + width] && !labels[i + width]) { labels[i + width] = count; stack[top++] = i + width; }
    }
    area.push(a);
    bbox.push([x0, y0, x1, y1]);
  }
  return { labels, count, area, bbox };
}
