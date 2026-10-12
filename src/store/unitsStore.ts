/**
 * unitsStore.ts — THE display units, the one source every length and area in the studio
 * follows (step U.1, from M.2a): one length unit (mm, m, ft-in; stored as "ftin") and one
 * area unit (m², mm², sq ft). Display only: the plan, the takeoffs and everything stored
 * stay in metres and m². Kept in localStorage under "atrium.units" (never in the plan or
 * the autosave); a missing, blocked or garbled entry gives m and m², and "ft-in" is read
 * as "ftin". The TopBar's Units menu, the Summary and Takeoff panels' switches and the
 * import screen's dimension tables are all views of this store. Every change is mirrored to
 * src/lib/units/current.ts, so the pure edit rules and the 3D tool labels use it too.
 * Connects to: src/lib/units/{format,current}.ts; read by almost every studio component.
 */
import { create } from "zustand";
import { setCurrentUnits } from "@/lib/units/current";
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
    const saved = v?.length === "ft-in" ? "ftin" : v?.length;
    return {
      length: LENGTH_UNITS.includes(saved) ? saved : fallback.length,
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
    setCurrentUnits(get());
  },
  setArea: (area) => {
    set({ area });
    write(get());
    setCurrentUnits(get());
  },
}));

/** Reads the saved choice into the store and the mirror: done once when the module loads (before anything is drawn); the tests call it to play a page load. */
export function restoreUnits() {
  const saved = read();
  useUnitsStore.setState(saved);
  setCurrentUnits(saved);
}
restoreUnits();
