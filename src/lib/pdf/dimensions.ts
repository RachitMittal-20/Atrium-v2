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
 * Each row says how the printed line was measured ("between ticks" or "line
 * length", and "read by OCR" when the text came from OCR). modelRows is the
 * second check (step M.1b): the printed values against the BUILT model.
 *
 * Also the two unit formats of the table (millimetres, and feet and inches to
 * 1/16") and the CSV text (both checks). Connects to: src/types/pdf.ts, the
 * import screen's DimensionCheck.tsx; tested by scripts/test-pdf.ts and
 * scripts/test-pdf-walls.ts.
 */
import type { Plan, Vec2, Wall } from "@/types/plan";
import type { DimensionMatch, DimensionRow } from "@/types/pdf";

export const OK_MM = 2;
export const OK_PCT = 0.2;

export type Overrides = Record<number, { valueM: number; note: string }>;

/** "between ticks" or "line length", plus ", read by OCR" for an OCR reading. */
export const howMeasured = (m: Pick<DimensionMatch, "measure" | "source">) => `${m.measure === "ticks" ? "between ticks" : "line length"}${m.source === "ocr" ? ", read by OCR" : ""}`;

/** One row: the printed value against a length, with the OK rule and any override. */
function row(m: DimensionMatch, measuredM: number, override: DimensionRow["override"], extra: Partial<DimensionRow> = {}): DimensionRow {
  const diffMm = (measuredM - m.metres) * 1000;
  const diffPct = ((measuredM - m.metres) / m.metres) * 100;
  const ok = Math.abs(diffMm) <= Math.max(OK_MM, (OK_PCT / 100) * m.metres * 1000);
  return { text: m.text, how: howMeasured(m), printedM: m.metres, measuredM, diffMm, diffPct, status: override ? "overridden" : ok ? "ok" : "flagged", override, ...extra };
}

export function dimensionRows(matches: DimensionMatch[], mPerPt: number, overrides: Overrides = {}): DimensionRow[] {
  return matches.map((m, i) => row(m, m.lengthPt * mPerPt, overrides[i] ?? null));
}

/**
 * The second check, "Model versus printed" (step M.1b): each printed dimension
 * whose two measured ends land on the BUILT model, against the model's own
 * length between those places. `toPlan` maps page points to plan metres.
 *
 * An end lands on a wall that runs across the dimension (within 2°) at its
 * centre line or either face, or on a door or window jamb in a wall running
 * along it, whichever is nearest along the dimension within `tol` metres.
 * What the model length runs between is said in words: "centre to centre",
 * "inside faces" (the faces of two walls that look at each other: a room's
 * span), "outside faces", "opening width" (two jambs of one opening), or a mix
 * ("centre to face", "face to face", "to a jamb"). A dimension with an end
 * on nothing is left out. A row whose walls include a traced one, or that lands
 * on a traced opening's jamb (step M.1c), is `approximate`. A printed opening
 * width lands on both jambs of the door or window ("opening width"). Rows carry
 * their match's index (`index`) for overrides.
 */
export function modelRows(matches: DimensionMatch[], plan: Pick<Plan, "walls" | "openings">, toPlan: (x: number, y: number) => Vec2, tol: number, overrides: Overrides = {}): (DimensionRow & { index: number })[] {
  const out: (DimensionRow & { index: number })[] = [];
  const PAR = Math.sin((2 * Math.PI) / 180);
  matches.forEach((m, index) => {
    const e1 = toPlan(m.ends.x1, m.ends.y1);
    const e2 = toPlan(m.ends.x2, m.ends.y2);
    const L = Math.hypot(e2.x - e1.x, e2.y - e1.y);
    if (L === 0) return;
    const u = { x: (e2.x - e1.x) / L, y: (e2.y - e1.y) / L };
    const along = (p: Vec2) => p.x * u.x + p.y * u.y;
    const acrossOf = (p: Vec2) => p.x * -u.y + p.y * u.x;
    type Hit = { s: number; kind: "centre" | "face" | "jamb"; side: -1 | 0 | 1; wall: Wall; opening?: string; traced?: boolean; far: number };
    const hits: Omit<Hit, "far">[] = [];
    for (const w of plan.walls) {
      const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
      const d = { x: (w.b.x - w.a.x) / len, y: (w.b.y - w.a.y) / len };
      const cross = Math.abs(d.x * u.y - d.y * u.x);
      if (cross >= 1 - PAR) {
        // Runs across the dimension: its centre line and faces sit at fixed places along it.
        const s = along(w.a);
        hits.push({ s, kind: "centre", side: 0, wall: w }, { s: s - w.thickness / 2, kind: "face", side: -1, wall: w }, { s: s + w.thickness / 2, kind: "face", side: 1, wall: w });
      } else if (cross <= PAR)
        for (const o of plan.openings.filter((o) => o.wallId === w.id))
          for (const k of [-1, 1] as const) hits.push({ s: along({ x: w.a.x + d.x * (o.offset + (k * o.width) / 2), y: w.a.y + d.y * (o.offset + (k * o.width) / 2) }), kind: "jamb", side: 0, wall: w, opening: o.id, traced: o.provenance === "traced" });
    }
    const land = (e: Vec2): Hit | null => {
      let best: Hit | null = null;
      for (const h of hits) {
        const ds = Math.abs(h.s - along(e));
        if (ds > tol) continue;
        // Nearest along; then the wall nearest the dimension line across it.
        const w = h.wall;
        const far = Math.min(Math.abs(acrossOf(w.a) - acrossOf(e)), Math.abs(acrossOf(w.b) - acrossOf(e)));
        if (!best || ds < Math.abs(best.s - along(e)) - 1e-9 || (Math.abs(ds - Math.abs(best.s - along(e))) <= 1e-9 && far < best.far)) best = { ...h, far };
      }
      return best;
    };
    const [p, q] = [land(e1), land(e2)].sort((a, b) => (a?.s ?? 0) - (b?.s ?? 0));
    if (!p || !q || p === q) return;
    const kinds = [p.kind, q.kind].sort().join("+");
    const spans =
      kinds === "centre+centre"
        ? "centre to centre"
        : kinds === "face+face"
          ? p.side === 1 && q.side === -1
            ? "inside faces"
            : p.side === -1 && q.side === 1
              ? "outside faces"
              : "face to face"
          : kinds === "jamb+jamb"
            ? p.opening === q.opening
              ? "opening width"
              : "jamb to jamb"
            : kinds === "centre+face"
              ? "centre to face"
              : `${p.kind === "jamb" ? q.kind : p.kind} to a jamb`;
    const approximate = p.wall.provenance === "traced" || q.wall.provenance === "traced" || !p.wall.provenance || !q.wall.provenance || Boolean(p.traced || q.traced);
    out.push({ ...row(m, q.s - p.s, overrides[index] ?? null, { spans, approximate }), index });
  });
  return out;
}

/** `v` to `digits` decimals, with a sign when asked, and never "-0.0". */
export function fixed(v: number, digits: number, signed = false): string {
  const r = Number(v.toFixed(digits)) || 0; // -0 and a value that rounds to zero become 0
  return `${signed && r > 0 ? "+" : ""}${r.toFixed(digits)}`;
}

/** "3800.0 mm" (signed: "+1.2 mm"). */
export const formatMm = (m: number, signed = false) => `${fixed(m * 1000, 1, signed)} mm`;

/** "4.0000 m": metres to 0.1 mm, for the tables when metres is the display unit. */
export const formatMetres4 = (m: number, signed = false) => `${fixed(m, 4, signed)} m`;

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

/**
 * The check as CSV, always in millimetres; the printed text is kept as printed.
 * The dimension check first; with model rows, a blank line and the "Model versus
 * printed" section after it, with its own header.
 */
export function rowsToCsv(rows: DimensionRow[], model: DimensionRow[] = []): string {
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const tail = (r: DimensionRow) => [STATUS[r.status], r.override ? (r.override.valueM * 1000).toFixed(1) : "", q(r.override?.note ?? "")];
  const head = ["printed", "printed_mm", "measured_mm", "difference_mm", "difference_pct", "measured", "status", "override_mm", "note"];
  const body = rows.map((r) => [q(r.text), (r.printedM * 1000).toFixed(1), (r.measuredM * 1000).toFixed(1), r.diffMm.toFixed(1), r.diffPct.toFixed(3), q(r.how), ...tail(r)].join(","));
  const out = [head.join(","), ...body];
  if (model.length) {
    out.push("", "model versus printed", ["printed", "printed_mm", "model_mm", "difference_mm", "difference_pct", "model_spans", "approximate", "status", "override_mm", "note"].join(","));
    out.push(...model.map((r) => [q(r.text), (r.printedM * 1000).toFixed(1), (r.measuredM * 1000).toFixed(1), r.diffMm.toFixed(1), r.diffPct.toFixed(3), q(r.spans ?? ""), r.approximate ? "yes" : "no", ...tail(r)].join(",")));
  }
  return out.join("\n") + "\n";
}
