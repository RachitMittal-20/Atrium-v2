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
 *   - Stair words are never names (step V.2, `withoutStairs`): UP, DN and DOWN as whole words, and
 *     "UP TO …" / "DN TO …" to the end of the line, are taken out of every label first, so "Up / Hall"
 *     names the room "Hall" and a lone "UP" names nothing. Both the PDF text and OCR come through here.
 *   - Names are title-cased: "BEDROOM 1" -> "Bedroom 1", "BATH / KITCHEN" ->
 *     "Bath / Kitchen". Rooms with no label keep deriveRooms' "Room N".
 *
 * `cleanRoomLabels` (step N.1) is NOT part of nameRooms: image and scanned-page imports run it
 * first (analyse.ts buildFromAnalysis) because OCR leaves fragments ("Oo)", "Lal", "| Safa")
 * that this function would join into the name. The PDF text path (pdf/snap.ts) calls nameRooms
 * directly, on text the PDF itself holds, and is unchanged.
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
import { MIN_LABEL_CONFIDENCE, type PlanLabel } from "./roomLabels";
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

/** Names of three letters or fewer that are real (abbreviations on plans too). Longer words need no list. */
const KNOWN_SHORT = new Set(["wc", "wic", "tv", "br", "ba", "lr", "dr", "kit", "den", "spa", "gym", "bar", "lab", "mud", "bed", "rec", "fam", "off"]);

/**
 * Drops OCR noise from room-name labels before they are joined (step N.1):
 *   - a label under MIN_LABEL_CONFIDENCE (the reader's own 55% rule);
 *   - symbol-only words at either end of a label are removed ("| Safa" -> "Safa"); one between words stays ("Bath / Kitchen");
 *   - then a label with more symbols and digits than letters, or with 3 letters or fewer that
 *     contain no known short name (WC, Den, Bed, BR…), is dropped: "O", "We", "Oo)", "Lal".
 * Four or more letters always pass, so Bath, Hall and Study need no list. Position and confidence
 * are untouched. Known gap: a 3-letter real name not in KNOWN_SHORT is lost (the room keeps "Room N").
 */
export function cleanRoomLabels(labels: PlanLabel[]): PlanLabel[] {
  const out: PlanLabel[] = [];
  for (const l of labels) {
    if (l.confidence < MIN_LABEL_CONFIDENCE) continue;
    const words = l.text.split(/\s+/).filter(Boolean);
    while (words.length && !/[\p{L}\d]/u.test(words[0])) words.shift(); // a stray "|" at either end, never the "/" inside "Bath / Kitchen"
    while (words.length && !/[\p{L}\d]/u.test(words[words.length - 1])) words.pop();
    const text = words.join(" ");
    const letters = (text.match(/\p{L}/gu) ?? []).length;
    if (letters * 2 < text.replace(/\s/g, "").length) continue; // mostly symbols and digits
    if (letters <= 3 && !words.some((w) => KNOWN_SHORT.has(w.replace(/[^\p{L}]/gu, "").toLowerCase()))) continue;
    out.push(text === l.text ? l : { ...l, text });
  }
  return out;
}

/** Step V.2: a stair direction ("UP TO FIRST FLOOR", "DN TO BASEMENT") from the word to the end of the line. */
const STAIR_TO = /(?<![\p{L}\d])(?:UP|DN|DOWN)\s+TO(?![\p{L}\d]).*$/iu;
/** Step V.2: a stair word on its own (UP, DN, DOWN), never inside a word: Cupboard, Upper and Downstairs stay. */
const STAIR_WORD = /(?<![\p{L}\d])(?:UP|DN|DOWN)(?![\p{L}\d])/giu;
const symbolOnly = (w: string) => !/[\p{L}\d]/u.test(w);

/**
 * Step V.2: a label without its stair words ("" when it was only one). Stair arrows say "UP" or "DN" inside or
 * beside a hall's name, and nameRooms joined them in ("Up / Hall"). What a removed word leaves behind is tidied:
 * symbol-only words at either end go ("↑", "/", "()"), and a run of them between words becomes the first ("Hall / / Kitchen").
 */
export function withoutStairs(text: string): string {
  const stripped = text.replace(STAIR_TO, "").replace(STAIR_WORD, "");
  if (stripped === text) return text; // no stair word: exactly as it was
  const words = stripped.replace(/\(\s*\)/g, "").split(/\s+/).filter(Boolean);
  while (words.length && symbolOnly(words[0])) words.shift();
  while (words.length && symbolOnly(words[words.length - 1])) words.pop();
  return words.filter((w, i) => !(symbolOnly(w) && symbolOnly(words[i - 1] ?? "x"))).join(" ");
}

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
    const text = withoutStairs(label.text); // step V.2: both paths come through here, PDF text and OCR alike
    if (!text || notAName(text)) continue;
    const name = titleCase(text);
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
