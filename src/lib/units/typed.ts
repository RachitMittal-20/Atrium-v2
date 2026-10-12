/**
 * typed.ts — the one parser for a typed length: "3.8", "3.8 m", "380 cm", "12'6\"", "12 ft 6 in".
 * A bare number is metres HERE, by definition; the fields that show a unit add their own
 * (src/lib/units/format.ts parseLengthInput). It lives apart from the import screen's
 * importFile.ts on purpose: that file starts the analyse and PDF workers
 * (`new Worker(new URL(...))`), and the pure edit rules and the unit formatting import this
 * parser, so importing it through importFile.ts made a cycle through the PDF worker's bundle
 * (edit.ts → format.ts → importFile.ts → pdf.worker → snap.ts → edit.ts), which stalled
 * `next build` (Turbopack). importFile.ts re-exports it, so existing imports keep working.
 * Connects to: src/lib/blueprint/scale.ts (parseLength).
 */
import { parseLength } from "@/lib/blueprint/scale";

/** A typed length in metres: "3.8", "3.8 m", "380 cm", "12'6\"", "12 ft 6 in",
 *  "12 ft". A bare number is metres. Null when it isn't one length. */
export function parseTypedLength(raw: string): number | null {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/\s*(?:feet|foot|ft)\.?(?![a-z])/g, "'")
    .replace(/\s*(?:inches|inch|in)\.?(?![a-z])/g, '"');
  return parseLength(/^\d+(?:\.\d+)?$/.test(s) ? `${s} m` : s);
}
