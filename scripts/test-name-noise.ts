/**
 * test-name-noise.ts — step N.1 item 4: OCR fragments must not end up in room names.
 * Real image imports named rooms "Oo) / Primary Bedroom / Lal", "O / Closed Kitchen",
 * "We / Bathroom 2" and "| Safa / Carpet / Living Room": each fragment is its own OCR
 * label and nameRooms joins them with " / ". `cleanRoomLabels` drops them, and
 * `buildFromAnalysis` (images and scanned pages only) applies it.
 *
 * Checked two ways:
 *   - through the real path: analyseBlueprint on fixture 02 with an injected fake OCR (as
 *     test-analyse.ts does), then buildFromAnalysis at 100 px/m, the four noisy labels in the
 *     four rooms, and again with clean labels that must not change;
 *   - the pure function on its own, rule by rule (under 3 letters, symbols and digits, the
 *     55% confidence rule, known short names kept);
 *   - the vector-PDF path is unchanged: nameRooms called directly still joins the noisy labels
 *     exactly as before (snap.ts calls it directly and never cleans).
 * Run: npx tsx scripts/test-name-noise.ts
 */
import assert from "node:assert/strict";
import sharp from "sharp";
import { analyseBlueprint, buildFromAnalysis, type OcrResult } from "../src/lib/blueprint/analyse";
import { cleanRoomLabels, nameRooms } from "../src/lib/blueprint/nameRooms";
import type { PlanLabel } from "../src/lib/blueprint/roomLabels";
import type { PlanPixels } from "../src/types/blueprint";

const MANUAL_100 = { pxPerM: 100, source: "manual" as const };
const label = (text: string, x: number, y: number, confidence = 90): PlanLabel => ({ text, x, y, confidence });
const fakeOcr = (labels: PlanLabel[]) => async (): Promise<OcrResult> => ({ labels, words: [], error: null, rereads: [] });

// Room centres in fixture 02's pixels (the same ones test-analyse.ts uses).
const ROOMS = { a: [310, 263], b: [800, 263], c: [400, 663], d: [930, 663] } as const;
const row = (room: keyof typeof ROOMS, ...texts: string[]): PlanLabel[] =>
  texts.map((t, i) => label(t, ROOMS[room][0] + (i - (texts.length - 1) / 2) * 80, ROOMS[room][1]));

async function load(file: string): Promise<PlanPixels> {
  const { data, info } = await sharp(`tests/fixtures/${file}`).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, rgba: data };
}

/** Room names (sorted) of fixture 02 built with these labels, through the real image path. */
async function built(pixels: PlanPixels, labels: PlanLabel[]) {
  const analysis = await analyseBlueprint(pixels, { ocr: fakeOcr(labels) });
  return buildFromAnalysis(analysis, MANUAL_100, {}, "02").plan.rooms.map((r) => r.name).sort();
}

async function main() {
  const pixels = await load("02_thick_exterior_thin_interior.png");

  // The four labels from the live site, one per room, fragments on the same row as the real name.
  const noisy = [...row("a", "Oo)", "Primary Bedroom", "Lal"), ...row("b", "O", "Closed Kitchen"), ...row("c", "We", "Bathroom 2"), ...row("d", "| Safa", "Carpet", "Living Room")];
  assert.deepEqual(
    await built(pixels, noisy),
    ["Bathroom 2", "Closed Kitchen", "Primary Bedroom", "Safa / Carpet / Living Room"],
    "fragments dropped, real words kept, in reading order",
  );

  // Clean labels must not change: known short names, numbers, slashes, upper case, a joined pair.
  const cleanSets: [PlanLabel[], string[]][] = [
    [[...row("a", "BEDROOM 1"), ...row("b", "BEDROOM 2"), ...row("c", "LIVING"), ...row("d", "BATH / KITCHEN")], ["Bath / Kitchen", "Bedroom 1", "Bedroom 2", "Living"]],
    [[...row("a", "Bath"), ...row("b", "WC"), ...row("c", "Hall"), ...row("d", "Study")], ["Bath", "Hall", "Study", "Wc"]],
    [[...row("a", "Dining", "Room"), ...row("b", "Den"), ...row("c", "Bed 1"), ...row("d", "Master Bath 2")], ["Bed 1", "Den", "Dining / Room", "Master Bath 2"]],
  ];
  for (const [labels, want] of cleanSets) assert.deepEqual(await built(pixels, labels), want, `clean labels unchanged: ${want.join(", ")}`);

  // A fragment is dropped, so its room goes back to the default name rather than naming it from noise.
  assert.deepEqual((await built(pixels, row("a", "Oo)"))).filter((n) => !n.startsWith("Room ")), [], "a room with only a fragment keeps its default name");

  // ---- the pure function, rule by rule
  const texts = (labels: PlanLabel[]) => cleanRoomLabels(labels).map((l) => l.text);
  assert.deepEqual(texts([label("O", 0, 0), label("We", 0, 0), label("Oo)", 0, 0), label("Lal", 0, 0)]), [], "under 3 letters, and 3 letters that are no known name");
  assert.deepEqual(texts([label("|", 0, 0), label("12 / 3", 0, 0), label("--", 0, 0), label("(1)", 0, 0)]), [], "symbols and digits only");
  assert.deepEqual(texts([label("Kitchen", 0, 0, 54), label("Kitchen", 0, 0, 55)]), ["Kitchen"], "the 55% rule: 54 dropped, 55 kept");
  assert.deepEqual(texts([label("WC", 0, 0), label("Den", 0, 0), label("BR 1", 0, 0), label("Bath", 0, 0), label("Hall", 0, 0), label("Study", 0, 0)]), ["WC", "Den", "BR 1", "Bath", "Hall", "Study"], "known short names and 4+ letter words kept");
  assert.deepEqual(texts([label("| Safa", 0, 0), label("Safa |", 0, 0), label("Bath / Kitchen", 0, 0)]), ["Safa", "Safa", "Bath / Kitchen"], "a symbol-only word at either end is removed; a separator between words stays");
  assert.deepEqual(texts([label("x1%", 0, 0)]), [], "mostly symbols and digits");
  const given = [label("Kitchen", 5, 6)];
  assert.deepEqual(cleanRoomLabels(given), given, "position and confidence are untouched");

  // ---- the PDF text path is unchanged: nameRooms itself does not clean (snap.ts calls it directly)
  {
    const analysis = await analyseBlueprint(pixels, { ocr: fakeOcr([]) });
    const b = buildFromAnalysis(analysis, MANUAL_100, {}, "02");
    const names = nameRooms(b.plan, noisy, b.report.origin, 100).plan.rooms.map((r) => r.name).sort();
    assert.ok(names.includes("Oo) / Primary Bedroom / Lal") && names.includes("O / Closed Kitchen") && names.includes("We / Bathroom 2"), `nameRooms alone still joins every label as it always did: ${names.join(" | ")}`);
  }

  console.log("name noise: four live-site labels cleaned, clean labels unchanged, rules and the PDF path checked");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
