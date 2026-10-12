/**
 * unitsStore.ts — the display units the user chose: one length unit (mm, m, ft-in) and one
 * area unit (m², mm², sq ft), step M.2a. Display only: the plan is always metres. Kept in
 * localStorage under "atrium.units" (never in the plan or the autosave); a missing, blocked
 * or garbled entry gives m and m². The area unit is also the Summary's m² | sq ft toggle
 * (src/app/studio/page.tsx maps it onto the older two-way Unit the room list and the
 * other panels use; they show m² while mm² is chosen).
 * Connects to: src/lib/units/format.ts; read by src/app/studio/page.tsx,
 * src/components/studio/TakeoffPanel.tsx and src/components/plan2d/TakeoffLayer.tsx.
 */
import { create } from "zustand";
import { AREA_UNITS, LENGTH_UNITS, type AreaUnit, type LengthUnit } from "@/lib/units/format";

export const UNITS_KEY = "atrium.units";

interface UnitsState {
  length: LengthUnit;
  area: AreaUnit;
  setLength: (u: LengthUnit) => void;
  setArea: (u: AreaUnit) => void;
}

function read(): { length: LengthUnit; area: AreaUnit } {
  const fallback = { length: "m" as LengthUnit, area: "m2" as AreaUnit };
  try {
    const v = JSON.parse(window.localStorage.getItem(UNITS_KEY) ?? "null");
    return {
      length: LENGTH_UNITS.includes(v?.length) ? v.length : fallback.length,
      area: AREA_UNITS.includes(v?.area) ? v.area : fallback.area,
    };
  } catch {
    return fallback; // no window (server, tests), blocked storage, or not JSON
  }
}

function write(s: { length: LengthUnit; area: AreaUnit }) {
  try {
    window.localStorage.setItem(UNITS_KEY, JSON.stringify({ length: s.length, area: s.area }));
  } catch {
    // blocked or full: the choice still holds for this page
  }
}

export const useUnitsStore = create<UnitsState>((set, get) => ({
  ...read(),
  setLength: (length) => {
    set({ length });
    write(get());
  },
  setArea: (area) => {
    set({ area });
    write(get());
  },
}));
