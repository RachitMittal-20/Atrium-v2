/**
 * rows.ts — what the Takeoff table shows for each takeoff (step M.2a), pure: the measured
 * value, the status against a typed reference, the basis, the effective value, the stale
 * marker, the totals and the CSV. Fixed rules, not tuned later:
 *   - a length is OK when |measured − reference| ≤ max(2 mm, 0.2% of the reference), an
 *     area when it is ≤ max(0.005 m², 0.4%); otherwise Flagged; no reference: "No reference".
 *   - an override never replaces the measured value: both are kept, the status still compares
 *     the measured one, and the effective value is the override when there is one.
 *   - basis: the worst provenance among the walls the points sit on (a face corner, a wall
 *     end, a jamb or a midpoint, within 1 µm): "Traced approximate" < "Drawn" (hand-drawn,
 *     sample, image-imported, or a PDF wall since edited) < "PDF exact"; "Free points" when
 *     no point is on a wall.
 *   - stale: the walls' hash (ids, ends, thicknesses) differs from the one stored when the
 *     takeoff was measured. Points are absolute and do not follow the walls.
 * Totals are sums of unrounded values, rounded once at display (src/lib/units/format.ts).
 * Connects to: src/lib/takeoff/geometry.ts, src/lib/units/format.ts; used by
 * src/components/studio/TakeoffPanel.tsx, src/store/planStore.ts (the hash), scripts/test-takeoff.ts.
 */
import { areaValue, AREA_LABEL, LENGTH_LABEL, lengthValue, type AreaUnit, type LengthUnit } from "@/lib/units/format";
import { wallLength } from "@/lib/plan/geometry";
import type { Plan, Takeoff, Wall } from "@/types/plan";
import { areaWithCutouts, polylineLength, snapTargets, type Pt, type Result, type Side } from "./geometry";

// ---------------------------------------------------------------- the walls' hash

/** cyrb53 of the walls' ids, ends and thicknesses, sorted by id: any move, resize, add or delete changes it. */
export function wallsHash(walls: Wall[]): string {
  const text = [...walls]
    .sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0))
    .map((w) => `${w.id}:${w.a.x},${w.a.y},${w.b.x},${w.b.y},${w.thickness}`)
    .join(";");
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

// ---------------------------------------------------------------- status

export type Status = "ok" | "flagged" | "none";
export const STATUS_TEXT: Record<Status, string> = { ok: "OK", flagged: "Flagged", none: "No reference" };

/** The allowed difference for a reference: max(2 mm, 0.2%) for a length, max(0.005 m², 0.4%) for an area. */
export const tolerance = (kind: Takeoff["kind"], reference: number) => (kind === "length" ? Math.max(0.002, 0.002 * Math.abs(reference)) : Math.max(0.005, 0.004 * Math.abs(reference)));

/** OK within the tolerance (inclusive; 1 nm of slack for float dust), else Flagged; "none" with no reference. */
export function takeoffStatus(kind: Takeoff["kind"], measured: number, reference?: number): Status {
  if (reference === undefined) return "none";
  return Math.abs(measured - reference) <= tolerance(kind, reference) + 1e-9 ? "ok" : "flagged";
}

// ---------------------------------------------------------------- basis

export type Basis = "PDF exact" | "Traced approximate" | "Drawn" | "Free points";
const RANK: Record<Exclude<Basis, "Free points">, number> = { "Traced approximate": 0, Drawn: 1, "PDF exact": 2 };

const wallBasis = (w: Wall): Exclude<Basis, "Free points"> => (w.provenance === "traced" ? "Traced approximate" : w.provenance === "vector" && !w.edited ? "PDF exact" : "Drawn");

/** The worst provenance among the walls the points sit on; "Free points" when none does. */
export function basisOf(plan: Pick<Plan, "walls" | "openings">, points: Pt[]): Basis {
  const targets = snapTargets(plan);
  const ids = new Set<string>();
  for (const p of points) for (const t of targets) if (Math.hypot(t.point[0] - p[0], t.point[1] - p[1]) <= 1e-6) ids.add(t.wallId);
  let worst: Exclude<Basis, "Free points"> | null = null;
  for (const w of plan.walls) {
    if (!ids.has(w.id)) continue;
    const b = wallBasis(w);
    if (!worst || RANK[b] < RANK[worst]) worst = b;
  }
  return worst ?? "Free points";
}

// ---------------------------------------------------------------- rows

/** The measured value: a polyline's length, or an area minus its cutouts. */
export const measure = (t: Pick<Takeoff, "kind" | "points" | "cutouts">): Result<number> => (t.kind === "length" ? polylineLength(t.points) : areaWithCutouts(t.points, t.cutouts));

export interface TakeoffRow {
  takeoff: Takeoff;
  basis: Basis;
  /** Null when the stored points no longer make a valid measurement (never stored that way by the tool). */
  measured: number | null;
  /** measured − reference, metres or m². */
  difference: number | null;
  status: Status;
  /** The override when there is one, else the measured value. */
  effective: number | null;
  stale: boolean;
}

export function takeoffRow(plan: Plan, t: Takeoff, hash = wallsHash(plan.walls)): TakeoffRow {
  const m = measure(t);
  const measured = m.ok ? m.value : null;
  const ref = t.reference?.value;
  return {
    takeoff: t,
    basis: basisOf(plan, [...t.points, ...(t.cutouts ?? []).flat()]),
    measured,
    difference: measured !== null && ref !== undefined ? measured - ref : null,
    status: measured === null ? "none" : takeoffStatus(t.kind, measured, ref),
    effective: t.override?.value ?? measured,
    stale: t.wallsHash !== hash,
  };
}

/** Sums of the unrounded values, for rounding once at display. */
export function totals(rows: TakeoffRow[]) {
  const sum = (kind: Takeoff["kind"], key: "measured" | "effective") => rows.filter((r) => r.takeoff.kind === kind).reduce((s, r) => s + (r[key] ?? 0), 0);
  return { lengthMeasured: sum("length", "measured"), lengthEffective: sum("length", "effective"), areaMeasured: sum("area", "measured"), areaEffective: sum("area", "effective") };
}

/** The next free "Length N" or "Area N". */
export function nextName(takeoffs: Takeoff[], kind: Takeoff["kind"]): string {
  const word = kind === "length" ? "Length" : "Area";
  const n = takeoffs.reduce((max, t) => Math.max(max, Number(t.name.match(new RegExp(`^${word} (\\d+)$`))?.[1] ?? 0)), 0);
  return `${word} ${n + 1}`;
}

/** "South wall, right face": the wall's side of the plan (by its middle against the walls' box) and the line measured. */
export function wallTakeoffName(plan: Pick<Plan, "walls">, wallId: string, side: Side): string {
  const w = plan.walls.find((x) => x.id === wallId);
  const line = side === "centre" ? "centre line" : `${side} face`;
  if (!w || wallLength(w) === 0) return `Wall, ${line}`;
  const xs = plan.walls.flatMap((x) => [x.a.x, x.b.x]);
  const ys = plan.walls.flatMap((x) => [x.a.y, x.b.y]);
  const [cx, cy] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  const [mx, my] = [(w.a.x + w.b.x) / 2, (w.a.y + w.b.y) / 2];
  const [dx, dy] = [Math.abs(w.b.x - w.a.x), Math.abs(w.b.y - w.a.y)];
  const where = dx > 2 * dy ? (my > cy ? "South" : "North") : dy > 2 * dx ? (mx > cx ? "East" : "West") : "Diagonal";
  return `${where} wall, ${line}`;
}

// ---------------------------------------------------------------- CSV and copy

export interface Units {
  length: LengthUnit;
  area: AreaUnit;
}

/** A value in the row's own unit, no unit text (the header says it). */
const value = (kind: Takeoff["kind"], v: number | null | undefined, u: Units) => (v === null || v === undefined ? "" : kind === "length" ? lengthValue(v, u.length) : areaValue(v, u.area));

/** The table as cells, header first: values in the chosen units, the difference in mm (lengths) or m² (areas). */
export function tableCells(rows: TakeoffRow[], u: Units): string[][] {
  const units = `${LENGTH_LABEL[u.length]} | ${AREA_LABEL[u.area]}`;
  const head = ["name", "kind", "basis", `measured (${units})`, `reference (${units})`, "difference (mm | m²)", "status", `override (${units})`, "override note", `effective (${units})`, "stale"];
  const body = rows.map((r) => {
    const t = r.takeoff;
    const diff = r.difference === null ? "" : t.kind === "length" ? (Number((r.difference * 1000).toFixed(1)) || 0).toFixed(1) : (Number(r.difference.toFixed(3)) || 0).toFixed(3);
    return [t.name, t.kind, r.basis, value(t.kind, r.measured, u), value(t.kind, t.reference?.value, u), diff, STATUS_TEXT[r.status], value(t.kind, t.override?.value, u), t.override?.note ?? "", value(t.kind, r.effective, u), r.stale ? "yes" : "no"];
  });
  return [head, ...body];
}

/** RFC 4180: a cell with a comma, quote or line break is quoted, its quotes doubled. */
const quote = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const toCsv = (cells: string[][]) => cells.map((r) => r.map(quote).join(",")).join("\r\n") + "\r\n";
/** Tab-separated for pasting into a spreadsheet; tabs and line breaks inside a cell become spaces. */
export const toTsv = (cells: string[][]) => cells.map((r) => r.map((c) => c.replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n") + "\n";

/** "Two-bedroom house" → "two-bedroom-house-takeoffs.csv". */
export const csvFileName = (planName: string) => `${planName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "plan"}-takeoffs.csv`;
