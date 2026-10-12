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
 * never in the plan. Used by src/components/studio/TakeoffPanel.tsx,
 * src/components/plan2d/TakeoffLayer.tsx and src/lib/takeoff/rows.ts; tested by
 * scripts/test-takeoff.ts.
 */
import { parseTypedLength } from "@/app/studio/import/importFile";

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

/** The number alone, as a CSV cell or a field holds it: "3800", "3.800", "12'-6 3/16\"". */
export function lengthValue(metres: number, unit: LengthUnit): string {
  if (!Number.isFinite(metres)) return "–";
  if (unit === "mm") return fixed(metres * 1000, 0);
  if (unit === "m") return fixed(metres, 3);
  return feetInches(metres);
}

/** A length with its unit: "3800 mm", "3.800 m", "12'-6 3/16\"" (feet-inches carry their own marks). */
export const formatLength = (metres: number, unit: LengthUnit) => (unit === "ftin" ? lengthValue(metres, unit) : `${lengthValue(metres, unit)} ${unit}`);

/** The number alone; `group` puts thousands separators in mm² ("1,000,000"), never in a CSV. */
export function areaValue(m2: number, unit: AreaUnit, group = false): string {
  if (!Number.isFinite(m2)) return "–";
  if (unit === "m2") return fixed(m2, 3);
  if (unit === "sqft") return fixed(m2 * SQFT_PER_M2, 3);
  const mm2 = Number(fixed(m2 * 1e6, 0));
  return group ? mm2.toLocaleString("en-US") : String(mm2);
}

/** An area with its unit: "12.600 m²", "1,000,000 mm²", "10.764 sq ft". */
export const formatArea = (m2: number, unit: AreaUnit) => `${areaValue(m2, unit, true)} ${AREA_LABEL[unit]}`;

/** Total of several lengths, rounded once. */
export const formatLengthTotal = (metres: number[], unit: LengthUnit) => formatLength(metres.reduce((s, m) => s + m, 0), unit);

/** Total of several areas, rounded once. */
export const formatAreaTotal = (m2: number[], unit: AreaUnit) => formatArea(m2.reduce((s, v) => s + v, 0), unit);

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
