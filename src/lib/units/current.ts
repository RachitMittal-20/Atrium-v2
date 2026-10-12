/**
 * current.ts — the display units, for code that builds text but is not a React component
 * (step U.1): the pure edit rules' messages ("Walls can't be shorter than 0.20 m."), the
 * Push/Pull and Move labels, the validator's warnings. src/store/unitsStore.ts is the one
 * setting; it calls `setCurrentUnits` whenever it changes, and this module only mirrors it,
 * so the pure code never imports a store. In Node (the tests) nothing sets it, and the
 * defaults, metres and m², give exactly the text these messages always had.
 *
 * `lenText(m, dp)` is a length in the chosen unit. In metres it keeps each message's own
 * wording: `dp` decimals ("0.20 m"), or, with no `dp`, the number as written ("0.3 m"); in
 * mm and ft-in the unit's own rounding (whole mm; 1/16"). `areaText` is an area, one
 * decimal in m² and sq ft, as the room list has always shown.
 * Connects to: src/lib/units/format.ts; used by src/lib/plan/{edit,pushpull,validate}.ts,
 * src/lib/plan2d/measure.ts and src/store/itemToolStore.ts.
 */
import { formatArea, formatLength, lengthValue, STUDIO_DP, type AreaUnit, type LengthUnit } from "./format";

let length: LengthUnit = "m";
let area: AreaUnit = "m2";

export function setCurrentUnits(u: { length: LengthUnit; area: AreaUnit }) {
  length = u.length;
  area = u.area;
}
export const currentUnits = () => ({ length, area });

/** A length in the chosen unit, as message text. */
export function lenText(m: number, dp?: number): string {
  if (length === "m") return dp === undefined ? `${m} m` : `${m.toFixed(dp)} m`;
  return formatLength(m, length);
}

/** A signed distance ("+0.35 m", "-0.10 m"); the sign is a minus sign as the labels always had. */
export const signedLenText = (m: number, dp = STUDIO_DP.length) => `${m < 0 ? "-" : "+"}${lenText(Math.abs(m), dp)}`;

/** An area in the chosen unit, as message text. */
export const areaText = (m2: number) => formatArea(m2, area, STUDIO_DP.area);

/** "3.2 × 2.1 × 0.8 m": three sizes, 3 significant figures in metres (as model sizes always read), each in the chosen unit otherwise. */
export function sizeText(a: number, b: number, c: number): string {
  if (length === "m") {
    const n = (v: number) => String(Number(v.toPrecision(3)));
    return `${n(a)} × ${n(b)} × ${n(c)} m`;
  }
  const v = (m: number) => lengthValue(m, length);
  return length === "mm" ? `${v(a)} × ${v(b)} × ${v(c)} mm` : `${v(a)} × ${v(b)} × ${v(c)}`;
}

/** "10.2 m × 8.2 m": a plan's width and depth, one decimal in metres. */
export const planSizeText = (width: number, depth: number) => (length === "m" ? `${width.toFixed(1)} m × ${depth.toFixed(1)} m` : `${formatLength(width, length)} × ${formatLength(depth, length)}`);

/** "0.55–1.45 m": a span along a wall, two decimals in metres; in mm and ft-in each end in the unit. */
export const rangeText = (a: number, b: number) => (length === "m" ? `${a.toFixed(2)}–${b.toFixed(2)} m` : `${formatLength(a, length)}–${formatLength(b, length)}`);

/** The snap grid (always 0.05 m) in the display unit: "5 cm grid", "50 mm grid", 1 15/16" grid. */
export const gridText = () => `${length === "m" ? "5 cm" : formatLength(0.05, length)} grid`;

/** "10.0 × 8.0 m": the extent of the walls, in the display unit (the import dialog's "Your plan is …"). */
export const planExtentText = (width: number, depth: number) => (length === "m" ? `${width.toFixed(1)} × ${depth.toFixed(1)} m` : `${lengthValue(width, length)} × ${lengthValue(depth, length)}${length === "mm" ? " mm" : ""}`);

/** The Push/Pull field's placeholder: "0.3 or 30 cm" in metres, a bare number is in the display unit. */
export const distancePlaceholder = () => ({ m: "0.3 or 30 cm", mm: "300 or 30 cm", ftin: "1 or 6 in" })[length];
