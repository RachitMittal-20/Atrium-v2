/**
 * src/lib/blueprint/nameRooms.ts
 *
 * Names the rooms of a freshly built Plan from the room-name labels OCR read
 * on the plan. Pure: no OCR here, the labels come in.
 *
 * Rules:
 *   - Each label's centre (deskewed pixels) goes to metres with the same
 *     origin and scale buildPlan used: x = (px - origin.x) / pxPerM, y likewise.
 *   - A label names the room whose net floor polygon (deriveRooms) contains
 *     its centre. A label in no room (outside the building, or on a wall band)
 *     is listed in `unplaced`.
 *   - Two or more labels in one room are joined with " / " in reading order:
 *     rows top to bottom, each row left to right; identical text once. Label
 *     centres less than ROW_M apart vertically are one row, so two words OCR
 *     placed a pixel or two apart on the same line keep their left-to-right order.
 *   - Not names: anything that parses as a size or a length (scale.ts
 *     parseSizeLabel / parseLength), any text holding two numbers joined by x
 *     or × even with stray symbols around them ("12 x 14", "13 x 16°",
 *     "18 x 1%", "15 x19": OCR's misreads of foot marks), and text with no
 *     letter at all (OCR noise such as "|" or "—").
 *   - Names are title-cased: "BEDROOM 1" -> "Bedroom 1", "BATH / KITCHEN" ->
 *     "Bath / Kitchen". Rooms with no label keep deriveRooms' "Room N".
 *
 * The returned plan's `rooms` holds the derived rooms (their wall loops) with
 * these names, so the plan store's loadPlan, which matches stored rooms by
 * wall loop, keeps them.
 *
 * Connects to: ocr.ts (PlanLabel, via roomLabels.ts), scale.ts (the size and
 * length parsers), lib/plan/rooms.ts (deriveRooms, pointInPolygon,
 * toStoredRoom); called by analyse.ts buildFromAnalysis; exercised by
 * scripts/test-analyse.ts.
 */
import { deriveRooms, pointInPolygon, toStoredRoom } from "@/lib/plan/rooms";
import type { Plan, Vec2 } from "@/types/plan";
import type { PlanLabel } from "./roomLabels";
import { parseLength, parseSizeLabel } from "./scale";

/** Label centres closer than this vertically (metres) are on one row: about one
 *  line of 3 mm lettering at 1:100. */
const ROW_M = 0.3;

export interface NamingReport {
  /** Each label used, with the id of the room it named. */
  placed: { name: string; room: string }[];
  /** Labels whose centre is in no room. */
  unplaced: string[];
}

/** Two numbers joined by x or ×, with only non-letters (spaces, quote marks, °, %) between. */
const SIZE_LIKE = /\d[^\p{L}\d]*[x×][^\p{L}\d]*\d/iu;

/** True for text that is a size or length rather than a name. */
const notAName = (t: string) => parseSizeLabel(t) !== null || parseLength(t) !== null || SIZE_LIKE.test(t) || !/\p{L}/u.test(t);

/** "BATH / KITCHEN" -> "Bath / Kitchen": each word's first letter upper case, the rest lower. */
export const titleCase = (t: string) =>
  t
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/(^|[\s/(-])(\p{L})/gu, (_, before: string, c: string) => before + c.toUpperCase());

export function nameRooms(plan: Plan, labels: PlanLabel[], origin: Vec2, pxPerM: number): { plan: Plan; report: NamingReport } {
  const rooms = deriveRooms(plan);
  const report: NamingReport = { placed: [], unplaced: [] };
  const byRoom = new Map<string, { name: string; at: Vec2 }[]>();

  for (const label of labels) {
    if (notAName(label.text)) continue;
    const name = titleCase(label.text);
    const at = { x: (label.x - origin.x) / pxPerM, y: (label.y - origin.y) / pxPerM };
    const room = rooms.find((r) => pointInPolygon(at, r.polygon));
    if (!room) {
      report.unplaced.push(name);
      continue;
    }
    byRoom.set(room.id, [...(byRoom.get(room.id) ?? []), { name, at }]);
    report.placed.push({ name, room: room.id });
  }

  const named = rooms.map((r) => {
    const found = byRoom.get(r.id);
    if (!found) return r;
    // Rows top to bottom (a new row starts ROW_M below the row's first label), each left to right.
    const sorted = [...found].sort((p, q) => p.at.y - q.at.y);
    const rows: (typeof found)[] = [];
    for (const l of sorted) {
      const row = rows[rows.length - 1];
      if (row && l.at.y - row[0].at.y < ROW_M) row.push(l);
      else rows.push([l]);
    }
    const names = rows.flatMap((row) => row.sort((p, q) => p.at.x - q.at.x).map((l) => l.name));
    return { ...r, name: [...new Set(names)].join(" / ") };
  });

  return { plan: { ...plan, rooms: named.map(toStoredRoom) }, report };
}
