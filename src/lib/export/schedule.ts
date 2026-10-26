/**
 * schedule.ts — the area schedule (step X.2, roadmap 7.1), pure: a derived table of the plan's rooms
 * (name, net area, perimeter) and openings (type, width, height, sill, count), with totals.
 *
 * The rooms are `deriveRooms(plan)`, the same source `useDerivedRooms` gives the Summary and the room
 * list (src/store/planStore.ts), so the numbers cannot disagree; a component passes the rooms it already
 * has. Totals are sums of the exact values, rounded once at display (src/lib/units/format.ts), like
 * the Summary's total and the takeoff table's. Openings are grouped by kind and by width, height and
 * sill to 0.1 mm (a typed value's precision, `TYPED_STEP`), largest count first.
 *
 * `scheduleCells` is the CSV: a Rooms section and an Openings section, a blank line between, values in
 * the chosen units with the units in each header, written by rows.ts's RFC 4180 `toCsv`.
 * Connects to: src/lib/plan/rooms.ts, src/lib/takeoff/rows.ts (Units, toCsv), src/lib/units/format.ts;
 * used by src/components/studio/SchedulePanel.tsx, TopBar.tsx (Area schedule (CSV)),
 * src/lib/export/report.ts, and scripts/test-exports.ts.
 */
import { deriveRooms, type DerivedRoom } from "@/lib/plan/rooms";
import type { Units } from "@/lib/takeoff/rows";
import { AREA_LABEL, areaValue, LENGTH_LABEL, lengthValue } from "@/lib/units/format";
import type { OpeningKind, Plan } from "@/types/plan";

export interface RoomLine {
  id: string;
  name: string;
  /** Net floor area, m² (DerivedRoom.area). */
  area: number;
  /** Perimeter of the net floor outline, m. */
  perimeter: number;
}

export interface OpeningLine {
  kind: OpeningKind;
  width: number;
  height: number;
  sill: number;
  count: number;
}

export interface Schedule {
  rooms: RoomLine[];
  openings: OpeningLine[];
  /** Sums of the exact values. */
  totals: { area: number; perimeter: number; doors: number; windows: number };
}

/** 0.1 mm, the grouping step: a typed value's precision. */
const key = (v: number) => Math.round(v * 1e4);

export function buildSchedule(plan: Plan, rooms: DerivedRoom[] = deriveRooms(plan)): Schedule {
  const groups = new Map<string, OpeningLine>();
  for (const o of plan.openings) {
    const k = [o.kind, key(o.width), key(o.height), key(o.sillHeight)].join(":");
    const g = groups.get(k);
    if (g) g.count++;
    else groups.set(k, { kind: o.kind, width: o.width, height: o.height, sill: o.sillHeight, count: 1 });
  }
  const openings = [...groups.values()].sort((p, q) => (p.kind === q.kind ? q.count - p.count || p.width - q.width : p.kind === "door" ? -1 : 1));
  return {
    rooms: rooms.map((r) => ({ id: r.id, name: r.name, area: r.area, perimeter: r.perimeter })),
    openings,
    totals: {
      area: rooms.reduce((sum, r) => sum + r.area, 0), // the Summary's own sum, same order
      perimeter: rooms.reduce((sum, r) => sum + r.perimeter, 0),
      doors: plan.openings.filter((o) => o.kind === "door").length,
      windows: plan.openings.filter((o) => o.kind === "window").length,
    },
  };
}

export const KIND_TEXT: Record<OpeningKind, string> = { door: "Door", window: "Window" };

/** The CSV's cells: Rooms, a blank line, Openings. Numbers in the chosen units, no unit text (the headers say it). */
export function scheduleCells(s: Schedule, u: Units): string[][] {
  const len = (m: number) => lengthValue(m, u.length);
  const L = LENGTH_LABEL[u.length];
  return [
    ["Rooms"],
    ["name", `net area (${AREA_LABEL[u.area]})`, `perimeter (${L})`],
    ...s.rooms.map((r) => [r.name, areaValue(r.area, u.area), len(r.perimeter)]),
    ["Total", areaValue(s.totals.area, u.area), len(s.totals.perimeter)],
    [],
    ["Openings"],
    ["type", `width (${L})`, `height (${L})`, `sill (${L})`, "count"],
    ...s.openings.map((o) => [o.kind, len(o.width), len(o.height), len(o.sill), String(o.count)]),
    ["Total", "", "", "", String(s.totals.doors + s.totals.windows)],
  ];
}

/** "Two-bedroom house", "schedule.csv" → "two-bedroom-house-schedule.csv" (rows.ts's csvFileName rule). */
export const exportFileName = (planName: string, suffix: string) => `${planName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "plan"}-${suffix}`;
