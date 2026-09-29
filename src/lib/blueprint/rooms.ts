/**
 * src/lib/blueprint/rooms.ts
 *
 * Stage 2: turn the wall mask into rooms. Doors and windows are gaps in
 * the wall mask, so a plain flood fill would pour every room into its
 * neighbours and the outdoors. Two seals, both sized in metres from the
 * real-world scale, handle that:
 *   - a big seal (windows can be 2-3 m, and a row of windows spaced close
 *     together can add up to much more) finds the OUTDOORS: the region
 *     touching the image border once even large gaps are closed;
 *   - a small seal (about a doorway) separates rooms from each other,
 *     after cutting away the outdoor band that would otherwise link them.
 * Room seeds and the outdoors then grow outward at the same speed over
 * every non-wall pixel; they meet at the openings, so each floor reaches
 * its walls and nothing floods outside.
 *
 * Both seals are tried at a few sizes rather than one fixed size. Too
 * small and a window cluster on an outer wall never seals, so a whole
 * room leaks into the outdoors and silently vanishes — no floor, no
 * furniture, and nothing says why. Too big and it can seal a real
 * doorway, merging two rooms into one. There is no single size that is
 * always right, so every combination is scored by how much of the
 * building's floor area ends up inside some room, and the best one wins.
 */

import { BlueprintError, type PixelRoom, type RoomMap, type WallMask } from "@/types/blueprint";
import { dilate, labelComponents } from "./grid";

const ROOM_SEAL_RADIUS_M = 0.55;
const OUTDOOR_SEAL_SCALES_M = [1.5, 2.2, 3, 4, 5.5];
const ROOM_SEAL_SCALES = [1, 0.6, 0.35, 0.2];
/** Regions smaller than this are slivers, not rooms — scaled with the room
 *  seal radius, so a smaller seal (tried when the first pass under-covers)
 *  doesn't let through slivers it would otherwise have sealed shut. */
const MIN_ROOM_AREA_M2 = 1.5;
/** Good enough to stop searching for a better seal combination. */
const GOOD_ENOUGH_COVERAGE = 0.92;

const OUTSIDE = -1;

interface Attempt {
  map: RoomMap;
  /** Fraction of the building's non-wall pixels that ended up in some
   *  room (vs. lost to the outdoors or dropped as a sliver). */
  coverage: number;
}

/** One detection attempt at a given outdoor seal radius and room seal
 *  radius, both in pixels, and the area (px^2) below which a region is a
 *  sliver rather than a room. Returns null only when no room survives at all. */
function detectAt(source: WallMask, rBig: number, rSmall: number, minAreaPx: number): Attempt | null {
  // Work on a padded copy so the outdoors always exists around the
  // building, even when the image is cropped tight to the walls.
  const pad = 2 * rBig + 2;
  const width = source.width + 2 * pad;
  const height = source.height + 2 * pad;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < source.height; y++) {
    mask.set(source.mask.subarray(y * source.width, (y + 1) * source.width), (y + pad) * width + pad);
  }

  // 1. Outdoors: border-touching region after the big seal.
  const sealedBig = dilate(mask, width, height, 2 * rBig + 1);
  const freeBig = new Uint8Array(mask.length);
  for (let i = 0; i < freeBig.length; i++) freeBig[i] = sealedBig[i] ? 0 : 1;
  const bigComps = labelComponents(freeBig, width, height);
  const outdoorId = bigComps.labels[0]; // the padded corner is always outdoors
  const outdoor = new Uint8Array(mask.length);
  if (outdoorId > 0) {
    for (let i = 0; i < outdoor.length; i++) outdoor[i] = bigComps.labels[i] === outdoorId ? 1 : 0;
  }
  const outdoorBand = dilate(outdoor, width, height, 2 * rBig + 1);

  // 2. Room seeds: small seal, minus everything near the outdoors.
  const sealedSmall = dilate(mask, width, height, 2 * rSmall + 1);
  const seedFree = new Uint8Array(mask.length);
  for (let i = 0; i < seedFree.length; i++) seedFree[i] = sealedSmall[i] || outdoorBand[i] ? 0 : 1;
  const comps = labelComponents(seedFree, width, height);

  const remap = new Int32Array(comps.count + 1);
  let n = 0;
  for (let id = 1; id <= comps.count; id++) if (comps.area[id] >= minAreaPx) remap[id] = ++n;
  if (n === 0) return null;

  // 3. Competitive growth over non-wall pixels.
  const labels = new Int32Array(mask.length);
  const queue = new Int32Array(mask.length);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < labels.length; i++) {
    if (outdoor[i]) { labels[i] = OUTSIDE; queue[tail++] = i; }
    else if (remap[comps.labels[i]]) { labels[i] = remap[comps.labels[i]]; queue[tail++] = i; }
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % width;
    const l = labels[i];
    const push = (j: number) => {
      if (!mask[j] && labels[j] === 0) { labels[j] = l; queue[tail++] = j; }
    };
    if (x > 0) push(i - 1);
    if (x < width - 1) push(i + 1);
    if (i >= width) push(i - width);
    if (i < labels.length - width) push(i + width);
  }

  // 4. Crop back, number rooms top-to-bottom / left-to-right so "Room 1" is stable.
  const w = source.width;
  const h = source.height;
  const cropped = new Int32Array(w * h);
  const stats = new Map<number, { area: number; b: [number, number, number, number] }>();
  let roomPixels = 0;
  let freePixels = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (source.mask[y * w + x]) continue; // a wall pixel is neither room nor "free"
      freePixels++;
      const l = labels[(y + pad) * width + x + pad];
      if (l <= 0) continue;
      roomPixels++;
      cropped[y * w + x] = l;
      const s = stats.get(l);
      if (!s) stats.set(l, { area: 1, b: [x, y, x + 1, y + 1] });
      else {
        s.area++;
        if (x < s.b[0]) s.b[0] = x;
        if (y < s.b[1]) s.b[1] = y;
        if (x + 1 > s.b[2]) s.b[2] = x + 1;
        if (y + 1 > s.b[3]) s.b[3] = y + 1;
      }
    }
  }
  const order = [...stats.entries()].sort((a, b) => a[1].b[1] - b[1].b[1] || a[1].b[0] - b[1].b[0]);
  const rename = new Map<number, number>();
  const rooms: PixelRoom[] = [];
  order.forEach(([old, s], idx) => {
    rename.set(old, idx + 1);
    rooms.push({ id: idx + 1, area: s.area, bbox: s.b });
  });
  for (let i = 0; i < cropped.length; i++) {
    if (cropped[i] > 0) cropped[i] = rename.get(cropped[i]) ?? 0;
  }
  return {
    map: { width: w, height: h, labels: cropped, rooms },
    coverage: freePixels > 0 ? roomPixels / freePixels : 0,
  };
}

/**
 * Finds the rooms in a wall mask. Tries a grid of outdoor/room seal sizes
 * (see the file header) and keeps whichever covers the most of the
 * building's floor area, stopping early once a combination covers nearly
 * all of it.
 */
export function detectRooms(source: WallMask, pxPerMetre: number): RoomMap {
  const minAreaPx = MIN_ROOM_AREA_M2 * pxPerMetre * pxPerMetre;
  let best: Attempt | null = null;
  for (const outdoorM of OUTDOOR_SEAL_SCALES_M) {
    const rBig = Math.max(2, Math.round(outdoorM * pxPerMetre));
    for (const roomScale of ROOM_SEAL_SCALES) {
      const rSmall = Math.max(1, Math.round(ROOM_SEAL_RADIUS_M * pxPerMetre * roomScale));
      if (rSmall >= rBig) continue;
      const attempt = detectAt(source, rBig, rSmall, minAreaPx);
      if (attempt && (!best || attempt.coverage > best.coverage)) best = attempt;
      if (best && best.coverage >= GOOD_ENOUGH_COVERAGE) return best.map;
    }
  }
  if (!best) {
    throw new BlueprintError(
      "No enclosed rooms were found. Check that the image is a plain floor plan with thick wall lines and a mostly closed outline, enter the real building length if you know it, or use the manual option.",
    );
  }
  return best.map;
}
