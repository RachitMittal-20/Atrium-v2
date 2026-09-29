/**
 * src/lib/blueprint/roomLabels.ts
 *
 * Uses the room names printed on the plan (read by ocr.ts) to improve on
 * the size-based guess (furniture.ts's guessRoomNames) two ways:
 *   - a room with exactly one label found inside it gets renamed to that
 *     label instead of "Bedroom 2";
 *   - a room with two or more labels inside it is one the wall/room
 *     detector under-split — a bathroom and a hallway that share no
 *     doorway gap wide enough to separate them, say — and is split back
 *     into one room per label, with a straight cut through the room
 *     wherever the labels are furthest apart, in the direction (left-to-
 *     right or top-to-bottom) that keeps the cut straight. Not a per-pixel
 *     nearest-label split: with three or more labels that produces pie-
 *     slice wedges fanning out from each label's point, which then blow
 *     up into hundreds of sliver-thin floor rectangles once the diagonal
 *     edges are decomposed into boxes — the flickering hairline seams a
 *     real wall would never have, since a real wall is always straight.
 * A room with no label inside it (OCR missed it, or the label sits over
 * a wall/icon) is left exactly as detectRooms produced it, to be named by
 * the usual size-based guess.
 */

import type { RoomMap } from "@/types/blueprint";

export interface PlanLabel {
  /** Text as OCR read it, e.g. "Bathroom 1" — used as the room's name
   *  more or less verbatim (only whitespace is cleaned up). */
  text: string;
  /** Anchor point in the (possibly downscaled) plan image's pixel space —
   *  the same space as WallMask/RoomMap. */
  x: number;
  y: number;
  confidence: number;
}

export interface LabeledRooms {
  map: RoomMap;
  /** Room id -> cleaned label text, for every room a label was matched to. */
  names: Map<number, string>;
}

const cleanText = (text: string): string => text.replace(/\s+/g, " ").trim();

/** True for the room's own printed dimension line ("3.0m x 2.75m",
 *  "4.0m x 9.5m") that sits right under its name on the plan. That text
 *  has exactly three letters -- the two "m"s and the "x" -- which is
 *  enough to pass looksLikeLabel's letter-count check below, so without
 *  this it reads as a second, independent room label next to the real
 *  name. The two-or-more-labels path further down then treats that as a
 *  room the wall detector under-split and cuts it into slivers, one of
 *  which inherits the dimension text as its "name" and gets no furniture
 *  -- this was the actual cause behind almost every over-split / missing-
 *  furniture report this feature has produced, not the shape of the cut
 *  itself. */
function looksLikeDimension(text: string): boolean {
  // OCR sometimes misreads the leading digit of a dimension as a similar-
  // looking letter (a "5" or "0" read as "O"/"o", most often on the small,
  // low-res crops these lines get read from) -- normalise those back to
  // digits before testing the shape, so "Om x 55m" (really "5m x 5.5m" or
  // similar) is still recognised as a dimension line rather than slipping
  // through as a second room label.
  const normalized = text.trim().replace(/o/gi, "0");
  return /^\d+(\.\d+)?\s*m?\s*[x×]\s*\d+(\.\d+)?\s*m?$/i.test(normalized);
}

/** True if a piece of OCR output is worth treating as a room name at all —
 *  filters out the stray symbols and furniture-icon noise OCR tends to
 *  produce on a line drawing, without being fussy about real labels. */
function looksLikeLabel(text: string): boolean {
  if (looksLikeDimension(text)) return false;
  const letters = text.replace(/[^A-Za-z]/g, "");
  return letters.length >= 3;
}

/** The room id at (x, y), or the id of the nearest labelled pixel within
 *  `maxRadius` if that exact spot is a wall, a gap, or just outside the
 *  room by a pixel or two (OCR's bounding box is a rough estimate, and a
 *  label often sits right at a room's edge). */
function nearestRoomId(map: RoomMap, x: number, y: number, maxRadius: number): number | null {
  const { width, height, labels } = map;
  const cx = Math.round(x);
  const cy = Math.round(y);
  if (cx >= 0 && cx < width && cy >= 0 && cy < height) {
    const here = labels[cy * width + cx];
    if (here > 0) return here;
  }
  for (let r = 1; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring only
        const x2 = cx + dx;
        const y2 = cy + dy;
        if (x2 < 0 || x2 >= width || y2 < 0 || y2 >= height) continue;
        const id = labels[y2 * width + x2];
        if (id > 0) return id;
      }
    }
  }
  return null;
}

export function applyRoomLabels(source: RoomMap, rawLabels: PlanLabel[]): LabeledRooms {
  const labels = rawLabels.filter((l) => looksLikeLabel(l.text));
  if (labels.length === 0) return { map: source, names: new Map() };

  const byRoom = new Map<number, PlanLabel[]>();
  for (const label of labels) {
    const id = nearestRoomId(source, label.x, label.y, 12);
    if (id === null) continue;
    const list = byRoom.get(id) ?? [];
    list.push(label);
    byRoom.set(id, list);
  }
  if (byRoom.size === 0) return { map: source, names: new Map() };

  const names = new Map<number, string>();
  const outLabels = Int32Array.from(source.labels);
  const rooms = source.rooms.filter((r) => !byRoom.has(r.id) || byRoom.get(r.id)!.length < 2);
  let nextId = Math.max(0, ...source.rooms.map((r) => r.id)) + 1;

  for (const [roomId, group] of byRoom) {
    if (group.length === 1) {
      names.set(roomId, cleanText(group[0].text));
      continue;
    }
    // Under-split: divide this room's pixels with a straight cut rather
    // than a per-pixel nearest-label assignment. Whichever axis the
    // labels are more spread out along (left-to-right vs. top-to-bottom)
    // is the one a real wall would most plausibly run across; sorting the
    // labels along that axis and cutting straight through the midpoint
    // between each neighbouring pair turns the room into a small number
    // of clean bands, each one still a simple rectangle-ish shape a floor
    // (and furniture.ts's own placement) can work with — never the
    // ragged, radiating wedges a true Voronoi split produces once there
    // are three or more labels to divide between.
    const stats = group.map(() => ({ area: 0, b: [source.width, source.height, 0, 0] as [number, number, number, number] }));
    const room = source.rooms.find((r) => r.id === roomId)!;
    const [bx0, by0, bx1, by1] = room.bbox;
    const spreadX = Math.max(...group.map((l) => l.x)) - Math.min(...group.map((l) => l.x));
    const spreadY = Math.max(...group.map((l) => l.y)) - Math.min(...group.map((l) => l.y));
    const horizontal = spreadX >= spreadY;
    const order = group.map((_, g) => g).sort((a, b) => (horizontal ? group[a].x - group[b].x : group[a].y - group[b].y));
    const cuts = order.slice(0, -1).map((g, i) => {
      const next = order[i + 1];
      return ((horizontal ? group[g].x : group[g].y) + (horizontal ? group[next].x : group[next].y)) / 2;
    });
    const bandFor = (v: number): number => {
      let band = 0;
      while (band < cuts.length && v >= cuts[band]) band++;
      return order[band];
    };
    for (let y = Math.max(0, by0); y < Math.min(source.height, by1); y++) {
      for (let x = Math.max(0, bx0); x < Math.min(source.width, bx1); x++) {
        const i = y * source.width + x;
        if (source.labels[i] !== roomId) continue;
        const best = bandFor(horizontal ? x : y);
        const newId = nextId + best;
        outLabels[i] = newId;
        const s = stats[best];
        s.area++;
        if (x < s.b[0]) s.b[0] = x;
        if (y < s.b[1]) s.b[1] = y;
        if (x + 1 > s.b[2]) s.b[2] = x + 1;
        if (y + 1 > s.b[3]) s.b[3] = y + 1;
      }
    }
    group.forEach((label, g) => {
      if (stats[g].area === 0) return; // this label's slice vanished (shouldn't normally happen)
      const id = nextId + g;
      rooms.push({ id, area: stats[g].area, bbox: stats[g].b });
      names.set(id, cleanText(label.text));
    });
    nextId += group.length;
  }

  return { map: { width: source.width, height: source.height, labels: outLabels, rooms }, names };
}
