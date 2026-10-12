/**
 * format.ts — display units for lengths and areas (pure, no React). The plan and every
 * takeoff stay in metres and square metres; a value is rounded ONCE, here, at display.
 * A total is summed from the unrounded values and rounded after (`formatLengthTotal`),
 * so three 0.6 mm values show "1 mm" each and "2 mm" together, not "3 mm".
 *
 * Length units: mm (whole millimetres), m (3 decimals), ft-in (feet and inches to the
 * nearest 1/16", 12'-6 3/16", carried so 11 15.99/16" shows as the next foot). Area units:
 * m² (3 decimals), mm² (whole, grouped by thousands), sq ft (3 decimals).
 *
 * Typed input goes through the existing parser (parseTypedLength in
 * src/app/studio/import/importFile.ts); this file only adds that a bare number means
 * the field's current unit, and turns "6 3/16" into "6.1875" first. Areas had no parser,
 * so `parseAreaInput` reads a number with an optional area unit.
 *
 * The chosen units live in src/store/unitsStore.ts (localStorage "atrium.units"),
 * never in the plan: ONE setting that every length and area in the studio follows
 * (step U.1). The studio's panels and labels have always shown metres to 2 decimals
 * and areas to 1, the takeoff table 3 and 3; `formatLength` and `formatArea` take the
 * decimals for the unit's metric / sq ft forms as a last argument (STUDIO_DP), and mm,
 * mm² and ft-in ignore it (whole mm, whole mm², 1/16"). `nicestScaleBar` picks the
 * 2D plan's scale bar in the chosen unit. Used by every studio panel, the 2D plan, the
 * 3D tool labels, src/lib/takeoff/rows.ts and src/lib/units/current.ts; tested by
 * scripts/test-takeoff.ts and scripts/test-units-store.ts.
 */
import { parseTypedLength } from "./typed";

export type LengthUnit = "mm" | "m" | "ftin";
export type AreaUnit = "m2" | "mm2" | "sqft";

export const LENGTH_UNITS: readonly LengthUnit[] = ["mm", "m", "ftin"];
export const AREA_UNITS: readonly AreaUnit[] = ["m2", "mm2", "sqft"];
/** Button and header labels. */
export const LENGTH_LABEL: Record<LengthUnit, string> = { mm: "mm", m: "m", ftin: "ft-in" };
export const AREA_LABEL: Record<AreaUnit, string> = { m2: "m²", mm2: "mm²", sqft: "sq ft" };

const INCH = 0.0254;
const FOOT = 0.3048;
const SQFT_PER_M2 = 1 / (FOOT * FOOT); // 10.7639…

/** Feet and inches to the nearest 1/16": 12'-6 3/16", 1'-0", 11 13/16", 0". Whole sixteenths are counted first, so 11.99" carries to 1'-0". */
function feetInches(m: number): string {
  const total = Math.round((Math.abs(m) / INCH) * 16); // sixteenths of an inch
  const ft = Math.floor(total / 192);
  const inch = Math.floor((total % 192) / 16);
  let num = total % 16;
  let den = 16;
  while (num > 0 && num % 2 === 0) {
    num /= 2;
    den /= 2;
  }
  const inches = num ? (inch ? `${inch} ${num}/${den}` : `${num}/${den}`) : `${inch}`;
  return `${m < 0 && total > 0 ? "−" : ""}${ft ? `${ft}'-` : ""}${inches}"`;
}

/** `v` to `digits` decimals, never "-0". */
const fixed = (v: number, digits: number) => (Number(v.toFixed(digits)) || 0).toFixed(digits);

/** The decimals the studio shows: metres to 2 (the takeoff table's default is 3), m² and sq ft to 1 (default 3). */
export const STUDIO_DP = { length: 2, area: 1 } as const;

/** The number alone, as a CSV cell or a field holds it: "3800", "3.800", "12'-6 3/16\"". `dp` replaces the 3 decimals of metres. */
export function lengthValue(metres: number, unit: LengthUnit, dp = 3): string {
  if (!Number.isFinite(metres)) return "–";
  if (unit === "mm") return fixed(metres * 1000, 0);
  if (unit === "m") return fixed(metres, dp);
  return feetInches(metres);
}

/** A length with its unit: "3800 mm", "3.800 m", "12'-6 3/16\"" (feet-inches carry their own marks). */
export const formatLength = (metres: number, unit: LengthUnit, dp = 3) => (unit === "ftin" ? lengthValue(metres, unit) : `${lengthValue(metres, unit, dp)} ${unit}`);

/** The number alone; `group` puts thousands separators in mm² ("1,000,000"), never in a CSV. `dp` replaces the 3 decimals of m² and sq ft. */
export function areaValue(m2: number, unit: AreaUnit, group = false, dp = 3): string {
  if (!Number.isFinite(m2)) return "–";
  if (unit === "m2") return fixed(m2, dp);
  if (unit === "sqft") return fixed(m2 * SQFT_PER_M2, dp);
  const mm2 = Number(fixed(m2 * 1e6, 0));
  return group ? mm2.toLocaleString("en-US") : String(mm2);
}

/** An area with its unit: "12.600 m²", "1,000,000 mm²", "10.764 sq ft". */
export const formatArea = (m2: number, unit: AreaUnit, dp = 3) => `${areaValue(m2, unit, true, dp)} ${AREA_LABEL[unit]}`;

/** Total of several lengths, rounded once. */
export const formatLengthTotal = (metres: number[], unit: LengthUnit) => formatLength(metres.reduce((s, m) => s + m, 0), unit);

/** Total of several areas, rounded once. */
export const formatAreaTotal = (m2: number[], unit: AreaUnit, dp = 3) => formatArea(m2.reduce((s, v) => s + v, 0), unit, dp);

/** "6 3/16" → "6.1875" and a lone "3/16" → "0.1875", so the parser can read inch fractions. */
const fractions = (raw: string) =>
  raw.replace(/(\d+)\s+(\d+)\/(\d+)/g, (_, w, n, d) => String(+w + +n / +d)).replace(/(^|[^\d.])(\d+)\/(\d+)/g, (_, pre, n, d) => `${pre}${+n / +d}`);

/**
 * A typed length in metres, or null. A bare number is in `unit` (mm, m, or feet for
 * ft-in); anything with a unit goes through parseTypedLength: "3.8 m", "380 cm",
 * "12'6\"", "12 ft 6 in", "12'-6 3/16\"".
 */
export function parseLengthInput(raw: string, unit: LengthUnit): number | null {
  const s = fractions(raw.trim().replace(",", "."));
  if (/^\d+(?:\.\d+)?$/.test(s) || /^\.\d+$/.test(s)) {
    const n = Number(s);
    return unit === "ftin" ? n * FOOT : parseTypedLength(`${n} ${unit}`);
  }
  return parseTypedLength(s);
}

/** A typed area in m², or null: a number with an optional unit (m², m2, mm², mm2, sq ft, sqft, ft²); a bare number is in `unit`. */
export function parseAreaInput(raw: string, unit: AreaUnit): number | null {
  const m = raw
    .trim()
    .toLowerCase()
    .replace(/,/g, "")
    .match(/^(\d+(?:\.\d+)?|\.\d+)\s*(m2|m²|sq\s*m|mm2|mm²|sq\s*ft|sqft|ft2|ft²|sf)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const u: AreaUnit = !m[2] ? unit : m[2].startsWith("mm") ? "mm2" : /ft|sf/.test(m[2]) ? "sqft" : "m2";
  return u === "m2" ? n : u === "mm2" ? n / 1e6 : n / SQFT_PER_M2;
}

/**
 * The 2D plan's scale bar in the chosen unit (step U.1): the nicest length whose on-screen
 * length is 60–140 px at `scale` px per metre, and its label. Steps: mm and m use 1, 2, 2.5,
 * 5 × 10ⁿ (so 500 mm, 1 m, 2.5 m); ft-in uses 1, 2, 3, 6 inches, then 1, 2, 4, 5 × 10ⁿ feet.
 * Each step is at most 2× the one before, so some step always fits.
 */
export function niceScaleBarFor(scale: number, unit: LengthUnit): { metres: number; label: string } {
  const steps: number[] = []; // metres, ascending
  if (unit === "ftin") {
    steps.push(...[1, 2, 3, 6].map((i) => i * INCH));
    for (let exp = 0; exp <= 4; exp++) steps.push(...[1, 2, 4, 5].map((f) => f * 10 ** exp * FOOT));
  } else {
    const base = unit === "mm" ? 0.001 : 1;
    for (let exp = unit === "mm" ? 0 : -1; exp <= 7; exp++) steps.push(...[1, 2, 2.5, 5].map((m) => m * 10 ** exp * base));
  }
  const metres = steps.find((m) => m * scale >= 60 && m * scale <= 140) ?? steps[0];
  return { metres, label: unit === "m" ? `${+metres.toFixed(3)} m` : formatLength(metres, unit) };
}

/** "Try 2.4, 240 cm or 7'10"." for a field showing `unit`: examples a typed length can take, the bare number first. */
export const lengthHint = (unit: LengthUnit) => (unit === "ftin" ? `Try 7'10", 7 ft 10 in or 2.4 m.` : unit === "mm" ? `Try 2400, 2400 mm, 2.4 m or 7'10".` : `Try 2.4, 240 cm or 7'10".`);

/** Two stored lengths (m) that differ by less than a nanometre are the same value. */
export const sameLength = (a: number, b: number) => Math.abs(a - b) <= 1e-9;

/**
 * Whether a number field's text should be committed on blur: it was edited (not empty, not the
 * text it showed). A field shows a ROUNDED value, so leaving it untouched must never write
 * the rounded text back over the stored one; and typing the same text again is no edit either.
 */
export const shouldCommit = (draft: string | null, shown: string) => draft !== null && draft.trim() !== "" && draft !== shown;
