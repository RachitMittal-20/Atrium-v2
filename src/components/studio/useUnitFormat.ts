"use client";

/*
 * src/components/studio/useUnitFormat.ts — the studio's one way to show and read a length or
 * an area (step U.1). It follows src/store/unitsStore.ts, so a component that uses it
 * re-renders when the unit changes. `len` and `area` are the text shown (metres to 2
 * decimals, m² and sq ft to 1: what the studio has always shown; mm, mm² and ft-in in
 * their own rounding), `parseLen` reads a typed length where a bare number means the
 * current unit, and `same` says two lengths are the same stored value (within 1e-9), so
 * a field never writes a value that did not change.
 * Connects to: src/lib/units/format.ts, src/store/unitsStore.ts; used by the panels, the
 * 2D plan and the tool overlays.
 */
import { areaValue, formatArea, formatLength, lengthValue, parseLengthInput, sameLength, STUDIO_DP } from "@/lib/units/format";
import { useUnitsStore } from "@/store/unitsStore";

/** Two stored lengths (m) that differ by less than a nanometre are the same value (format.ts). */
export const same = sameLength;

export function useUnitFormat() {
  const length = useUnitsStore((s) => s.length);
  const area = useUnitsStore((s) => s.area);
  return {
    length,
    areaUnit: area,
    len: (m: number) => formatLength(m, length, STUDIO_DP.length),
    /** The number alone, without its unit. */
    lenValue: (m: number) => lengthValue(m, length, STUDIO_DP.length),
    area: (m2: number) => formatArea(m2, area, STUDIO_DP.area),
    areaValue: (m2: number) => areaValue(m2, area, true, STUDIO_DP.area),
    parseLen: (raw: string) => parseLengthInput(raw, length),
  };
}
