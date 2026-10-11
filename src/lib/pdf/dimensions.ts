/**
 * src/lib/pdf/dimensions.ts
 *
 * The dimension check: for every dimension text matched to a line
 * (DimensionMatch, from scale.ts), the printed value beside the line's length
 * measured at the scale in use. Pure.
 *
 *   measured  = line length in points × metres per point
 *   difference = measured - printed (mm, and % of printed)
 *   status    = "ok" within max(2 mm, 0.2% of printed), else "flagged";
 *               "overridden" once the user typed a value for the row.
 *
 * An override is the user's value and a note, kept BESIDE the measured value:
 * it never replaces it, and the row says "Overridden". Overrides belong to the
 * import screen's state (keyed by row index) and go into the CSV.
 *
 * Also the two unit formats of the table (millimetres, and feet and inches to
 * 1/16") and the CSV text. Connects to: src/types/pdf.ts, the import screen's
 * DimensionCheck.tsx; tested by scripts/test-pdf.ts.
 */
import type { DimensionMatch, DimensionRow } from "@/types/pdf";

export const OK_MM = 2;
export const OK_PCT = 0.2;

export type Overrides = Record<number, { valueM: number; note: string }>;

export function dimensionRows(matches: DimensionMatch[], mPerPt: number, overrides: Overrides = {}): DimensionRow[] {
  return matches.map((m, i) => {
    const measuredM = m.lengthPt * mPerPt;
    const diffMm = (measuredM - m.metres) * 1000;
    const diffPct = ((measuredM - m.metres) / m.metres) * 100;
    const ok = Math.abs(diffMm) <= Math.max(OK_MM, (OK_PCT / 100) * m.metres * 1000);
    const override = overrides[i] ?? null;
    return { text: m.text, printedM: m.metres, measuredM, diffMm, diffPct, status: override ? "overridden" : ok ? "ok" : "flagged", override };
  });
}

/** `v` to `digits` decimals, with a sign when asked, and never "-0.0". */
export function fixed(v: number, digits: number, signed = false): string {
  const r = Number(v.toFixed(digits)) || 0; // -0 and a value that rounds to zero become 0
  return `${signed && r > 0 ? "+" : ""}${r.toFixed(digits)}`;
}

/** "3800.0 mm" (signed: "+1.2 mm"). */
export const formatMm = (m: number, signed = false) => `${fixed(m * 1000, 1, signed)} mm`;

/** Feet and inches to the nearest 1/16": 12' 6 3/16", 0", 1/16" (signed: "+1/16"). */
export function formatFeetInches(m: number, signed = false): string {
  const total = Math.round((Math.abs(m) / 0.0254) * 16); // sixteenths of an inch
  const ft = Math.floor(total / 192);
  const inch = Math.floor((total % 192) / 16);
  let num = total % 16;
  let den = 16;
  while (num > 0 && num % 2 === 0) {
    num /= 2;
    den /= 2;
  }
  const frac = num ? `${num}/${den}` : "";
  const inches = inch || !frac ? `${inch}${frac ? " " + frac : ""}` : frac;
  const sign = signed && total > 0 ? (m < 0 ? "−" : "+") : m < 0 && total > 0 ? "−" : "";
  return `${sign}${ft ? `${ft}' ` : ""}${inches}"`;
}

const STATUS = { ok: "OK", flagged: "Flagged", overridden: "Overridden" } as const;
export const statusText = (s: DimensionRow["status"]) => STATUS[s];

/** The table as CSV, always in millimetres; the printed text is kept as printed. */
export function rowsToCsv(rows: DimensionRow[]): string {
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const head = ["printed", "printed_mm", "measured_mm", "difference_mm", "difference_pct", "status", "override_mm", "note"];
  const body = rows.map((r) =>
    [q(r.text), (r.printedM * 1000).toFixed(1), (r.measuredM * 1000).toFixed(1), r.diffMm.toFixed(1), r.diffPct.toFixed(3), STATUS[r.status], r.override ? (r.override.valueM * 1000).toFixed(1) : "", q(r.override?.note ?? "")].join(","),
  );
  return [head.join(","), ...body].join("\n") + "\n";
}
